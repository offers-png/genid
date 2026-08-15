import crypto from 'crypto'
import { Builder, CallbackSigner, CallbackCredentialHolder, IdentityAssertionBuilder, IdentityAssertionSigner, Reader } from '@contentauth/c2pa-node'
import type { StepRecord } from './supabase'
import { env } from './env'

// C2PA / CAWG manifest generation (Build Spec Section 8).
//
// *** TRUST STATUS — READ BEFORE CHANGING ANYTHING BELOW ***
// The certificate this signs with is a real, valid, non-self-signed X.509
// chain — but it was NOT issued through the official C2PA Conformance
// Program by a Trust-List CA (SSL.com / DigiCert / Trufo as of early 2026).
// That program requires a formal security/conformance evaluation of GenID
// as an organization; it is an external registration process, not
// something resolvable in code. Every manifest this module produces will
// therefore verify as structurally VALID in any C2PA reader (confirmed via
// a real embed → read-back round trip during development) but will report
// `signingCredential.untrusted` — exactly as it should, since nothing here
// claims a trust status GenID hasn't earned yet. Do not point this at a
// self-signed leaf certificate "to make the error go away" — the SDK
// itself refuses to sign with a self-signed cert (confirmed directly), and
// swapping in a fake trust configuration to suppress that would make the
// output actively misleading rather than honestly unverified.
//
// The CAWG identity assertion below is signed by the same credential, as
// an org-level attestation ("GenID Protocol asserts this creator's
// verified identity") — this is CAWG's supported X.509 enterprise/publisher
// pattern, not a per-creator credential. It carries the same trust caveat.

const DIGITAL_SOURCE_TYPE_AI = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
const SOFTWARE_AGENT = { name: 'GenID Protocol', version: '0.1.0' }
const SIGNING_ALG = 'es256'
const RESERVE_SIZE = 20000

function loadSigningMaterials(): { certChain: Buffer; privateKey: crypto.KeyObject } {
  const certChain = Buffer.from(env.c2paSigningCertChainPem, 'utf-8')
  const privateKey = crypto.createPrivateKey(Buffer.from(env.c2paSigningKeyPem, 'utf-8'))
  return { certChain, privateKey }
}

// Raw (IEEE P1363 r||s) ECDSA signature — the format COSE/JOSE ES256 expects,
// not the DER encoding Node's crypto.sign produces by default.
function signRawEcdsa(data: Buffer, privateKey: crypto.KeyObject): Buffer {
  return crypto.sign(null, data, { key: privateKey, dsaEncoding: 'ieee-p1363' })
}

function actionForStep(step: StepRecord): { action: string; when: string; parameters?: { description: string } } | null {
  const when = step.response_timestamp ?? step.created_at
  const description = step.user_note ?? step.prompt_text ?? undefined
  const parameters = description ? { description } : undefined

  switch (step.step_type) {
    case 'regenerate':
      return { action: 'c2pa.edited', when, ...(parameters && { parameters }) }
    case 'edit':
      if (step.edit_type === 'crop') return { action: 'c2pa.cropped', when, ...(parameters && { parameters }) }
      if (step.edit_type === 'color_adjust') return { action: 'c2pa.color_adjustments', when, ...(parameters && { parameters }) }
      return { action: 'c2pa.edited', when, ...(parameters && { parameters }) }
    case 'generate':
    case 'discard':
    default:
      // 'generate' is handled separately as the manifest's required
      // inception action; 'discard' isn't a real edit to the asset.
      return null
  }
}

export interface C2paEmbedResult {
  signedImageBuffer: Buffer
  manifestLabel: string | null
  validationState: string | null
  validationStatus: unknown[]
}

export async function embedC2paManifest(params: {
  sessionId: string
  genidCode: string
  steps: StepRecord[]
  finalImageBuffer: Buffer
}): Promise<C2paEmbedResult> {
  const { certChain, privateKey } = loadSigningMaterials()
  const inceptionStep = params.steps.find((s) => s.step_type === 'generate') ?? params.steps[0]

  const settings = {
    trust: { verifyTrustList: false },
    cawgTrust: { verifyTrustList: false },
    // We already know this credential is untrusted — don't make signing
    // itself throw on that; the point is to embed a spec-valid manifest,
    // not to pretend trust we don't have.
    verify: { verifyTrust: false, verifyAfterSign: false },
  }

  const builder = Builder.new(settings)
  builder.setIntent({ create: DIGITAL_SOURCE_TYPE_AI })
  builder.addAction(
    JSON.stringify({
      action: 'c2pa.created',
      when: inceptionStep?.response_timestamp ?? inceptionStep?.created_at ?? new Date().toISOString(),
      digitalSourceType: DIGITAL_SOURCE_TYPE_AI,
      softwareAgent: SOFTWARE_AGENT,
    })
  )

  for (const step of params.steps) {
    if (step.id === inceptionStep?.id) continue
    const action = actionForStep(step)
    if (action) builder.addAction(JSON.stringify({ ...action, softwareAgent: SOFTWARE_AGENT }))
  }

  const callbackSigner = CallbackSigner.newSigner(
    { alg: SIGNING_ALG, certs: [certChain], reserveSize: RESERVE_SIZE, directCoseHandling: false },
    async (data: Buffer) => signRawEcdsa(data, privateKey)
  )

  // CAWG identity assertion: an org-level attestation, signed by the same
  // credential, that GenID has a verified identity bound to this session's
  // genid_code (the Stripe Identity KYC from Phase 4 — not a CAWG-recognized
  // identity credential itself, hence 'creator' role rather than any
  // stronger claim).
  const credentialHolder = CallbackCredentialHolder.newCallbackCredentialHolder(
    RESERVE_SIZE,
    'cawg.x509',
    async (signerPayload) => signRawEcdsa(Buffer.from(JSON.stringify(signerPayload)), privateKey)
  )
  const identityBuilder = await IdentityAssertionBuilder.identityBuilderForCredentialHolder(credentialHolder)
  identityBuilder.addRoles(['creator'])
  identityBuilder.addReferencedAssertions(['c2pa.actions'])

  const identitySigner = IdentityAssertionSigner.new(callbackSigner.getHandle())
  identitySigner.addIdentityAssertion(identityBuilder)

  // The CAWG identity assertion above proves a role via GenID's own
  // attesting credential, but this SDK's identity assertion API doesn't
  // expose a place to carry the specific creator's name/genid_code as a
  // CAWG-recognized claim (that needs a per-creator credential, which is
  // the same external-infrastructure gap noted above). Recording it as a
  // custom, honestly-namespaced assertion instead of stretching the CAWG
  // one to hold data it isn't structured for.
  builder.addAssertion('com.genid.identity', {
    genid_code: params.genidCode,
    verification_method: 'stripe_identity',
  })

  const dest: { buffer: Buffer | null } = { buffer: null }
  await builder.signAsync(identitySigner, { buffer: params.finalImageBuffer, mimeType: 'image/png' }, dest)
  if (!dest.buffer) throw new Error('C2PA signing produced no output buffer')

  const reader = await Reader.fromAsset({ buffer: dest.buffer, mimeType: 'image/png' }, { verify: { verifyTrust: false } })
  const manifestJson = reader?.json()

  return {
    signedImageBuffer: dest.buffer,
    manifestLabel: manifestJson?.active_manifest ?? null,
    validationState: (manifestJson as { validation_state?: string } | undefined)?.validation_state ?? null,
    validationStatus: (manifestJson as { validation_status?: unknown[] } | undefined)?.validation_status ?? [],
  }
}

export async function readC2paManifest(imageBuffer: Buffer): Promise<{
  embedded: boolean
  validationState: string | null
  validationStatus: unknown[]
}> {
  const reader = await Reader.fromAsset({ buffer: imageBuffer, mimeType: 'image/png' }, { verify: { verifyTrust: false } })
  if (!reader) return { embedded: false, validationState: null, validationStatus: [] }

  const manifestJson = reader.json() as { validation_state?: string; validation_status?: unknown[] }
  return {
    embedded: reader.isEmbedded(),
    validationState: manifestJson.validation_state ?? null,
    validationStatus: manifestJson.validation_status ?? [],
  }
}
