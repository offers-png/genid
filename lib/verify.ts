import { getSession, getSessionSteps } from './supabase'
import { downloadFromSessionBucket } from './storage'
import { hashBuffer } from './steganography'
import { buildStepContent, computeStepHash, computeSessionRootHash, signStepHash, buildArchiveContent } from './chain'
import { verifyOnBlockchain } from './blockchain'
import { env } from './env'
import { withTimeout, BLOCKCHAIN_READ_TIMEOUT_MS } from './limits'

// Recompute-and-compare verification (Build Spec Section 5.2.4) — the
// endpoint that lets a third party with no GenID account confirm a
// session's integrity without trusting the app's own claims.
//
// Two independent things can go wrong, and this checks both:
//  - CONTENT tampering on any single step: caught by fileHashValid (rehash
//    the stored file against output_hash) and signatureValid (recompute
//    step_hash/step_signature from the step's own fields). An attacker
//    can't forge a matching HMAC without GENID_SIGNING_SECRET, so this
//    alone catches any edit to any field of any step.
//  - STRUCTURAL tampering — a step deleted, reordered, or inserted — where
//    every remaining step's own signature is still individually valid.
//    Caught by chainLinkValid: each step's stored prior_step_signature is
//    compared against the actual current step_signature of the row that
//    precedes it, not just trusted at face value.
//
// A step whose output_archived flag is set (lib/lifecycle.ts, Build Spec
// Section 7) has had its ORIGINAL file replaced with a compressed archival
// copy after finalize, so re-hashing it can never match output_hash again
// — that's expected, not tampering. But that doesn't mean the archived
// step's file integrity goes unchecked: archiveIntegrityValid checks the
// CURRENT file against archive_hash, and archive_hash against a signature
// bound to this session, this step, and the ORIGINAL output_hash (not just
// the archive_hash in isolation — see buildArchiveContent), so an archive
// signature computed for one step can't validate for a different step or
// session. A step marked archived with no archive_hash/archive_signature
// recorded (or one that fails either check) has NO PROOF of its current
// file's integrity, and is reported as unverified — not silently passed —
// because "we can't check this" and "this checks out" are different claims.

export interface StepVerification {
  stepId: string
  stepNumber: number
  stepType: string
  fileHashValid: boolean
  fileArchived: boolean
  archiveIntegrityValid: boolean | null
  signatureValid: boolean
  chainLinkValid: boolean
  valid: boolean
}

// Distinct outcomes for the Polygon anchor check (Sept 18 second
// follow-up, "missing evidence, unavailable services, and detected
// tampering should produce distinct results"):
//  - not_anchored: no tx was ever recorded — nothing to check, not a
//    failure (anchoring is optional).
//  - confirmed: the tx exists on-chain and its calldata contains this
//    session's root hash.
//  - mismatch: the tx exists on-chain but its calldata does NOT contain
//    the expected root hash — positive evidence of a problem.
//  - not_found: the recorded tx hash doesn't resolve to any transaction
//    on-chain at all.
//  - unavailable: the chain couldn't be reached/queried (RPC error,
//    timeout) — we simply don't know, which is not the same claim as
//    "checked and it's wrong."
export type PolygonAnchorStatus = 'not_anchored' | 'confirmed' | 'mismatch' | 'not_found' | 'unavailable'

export interface SessionVerification {
  sessionId: string
  found: boolean
  finalized: boolean
  stepCount: number
  steps: StepVerification[]
  chainValid: boolean
  rootHashValid: boolean | null
  storedRootHash: string | null
  polygonAnchorTx: string | null
  polygonStatus: PolygonAnchorStatus
  overallValid: boolean
}

function notFoundResult(sessionId: string): SessionVerification {
  return {
    sessionId,
    found: false,
    finalized: false,
    stepCount: 0,
    steps: [],
    chainValid: false,
    rootHashValid: null,
    storedRootHash: null,
    polygonAnchorTx: null,
    polygonStatus: 'not_anchored',
    overallValid: false,
  }
}

export async function verifySession(sessionId: string): Promise<SessionVerification> {
  const session = await getSession(sessionId)
  if (!session) return notFoundResult(sessionId)

  const steps = await getSessionSteps(sessionId)
  const signingSecret = env.genidSigningSecret

  let priorStoredSignature: string | null = null
  const stepResults: StepVerification[] = []
  const signaturesInOrder: string[] = []

  for (const step of steps) {
    let fileHashValid = false
    let archiveIntegrityValid: boolean | null = null

    if (step.output_archived) {
      if (!step.archive_hash || !step.archive_signature) {
        // No archive proof recorded at all (e.g. archived before this
        // column existed) — there is nothing to check the current file
        // against, so this is reported as UNVERIFIED, not passed through.
        // A missing proof and a valid proof are not the same claim.
        archiveIntegrityValid = false
      } else {
        // The original bytes are gone by design — check the CURRENT
        // (compressed) file against the hash recorded at archive time, and
        // that hash against a signature bound to this exact session/step/
        // output_hash (buildArchiveContent), instead of skipping the file
        // check entirely or trusting a bare, unbound hash.
        const archiveContent = buildArchiveContent(step.session_id, step.id, step.output_hash ?? '', step.archive_hash)
        const archiveSignatureValid = signStepHash(archiveContent, signingSecret) === step.archive_signature

        if (archiveSignatureValid && step.output_storage_path) {
          try {
            const buffer = await downloadFromSessionBucket(step.output_storage_path)
            archiveIntegrityValid = hashBuffer(buffer) === step.archive_hash
          } catch {
            archiveIntegrityValid = false
          }
        } else {
          archiveIntegrityValid = false
        }
      }
    } else if (step.output_storage_path && step.output_hash) {
      try {
        const buffer = await downloadFromSessionBucket(step.output_storage_path)
        fileHashValid = hashBuffer(buffer) === step.output_hash
      } catch {
        fileHashValid = false
      }
    }

    const content = buildStepContent({
      sessionId: step.session_id,
      stepNumber: step.step_number,
      outputHash: step.output_hash ?? '',
      promptText: step.prompt_text,
      editType: step.edit_type,
      modelUsed: step.model_used,
      responseTimestamp: new Date(step.response_timestamp ?? step.created_at),
    })
    const recomputedHash = computeStepHash(content, priorStoredSignature)
    const recomputedSignature = signStepHash(recomputedHash, signingSecret)

    const signatureValid = recomputedHash === step.step_hash && recomputedSignature === step.step_signature
    const chainLinkValid = (step.prior_step_signature ?? null) === priorStoredSignature

    stepResults.push({
      stepId: step.id,
      stepNumber: step.step_number,
      stepType: step.step_type,
      fileHashValid,
      fileArchived: step.output_archived,
      archiveIntegrityValid,
      signatureValid,
      chainLinkValid,
      valid:
        (step.output_archived ? archiveIntegrityValid === true : fileHashValid) && signatureValid && chainLinkValid,
    })

    signaturesInOrder.push(step.step_signature ?? '')
    priorStoredSignature = step.step_signature
  }

  const chainValid = stepResults.length > 0 && stepResults.every((s) => s.valid)

  let rootHashValid: boolean | null = null
  if (session.status === 'finalized' && session.session_root_hash) {
    rootHashValid = computeSessionRootHash(signaturesInOrder) === session.session_root_hash
  }

  let polygonStatus: PolygonAnchorStatus = 'not_anchored'
  if (session.polygon_anchor_tx) {
    try {
      const chainResult = await withTimeout(verifyOnBlockchain(session.polygon_anchor_tx), BLOCKCHAIN_READ_TIMEOUT_MS, 'Polygon lookup')
      if (!chainResult.confirmed) {
        polygonStatus = 'not_found'
      } else if (session.session_root_hash && chainResult.payload?.includes(session.session_root_hash)) {
        polygonStatus = 'confirmed'
      } else {
        polygonStatus = 'mismatch'
      }
    } catch {
      // Couldn't reach/query the chain — genuinely unknown, not evidence
      // of a problem. Distinct from 'mismatch'/'not_found', which ARE.
      polygonStatus = 'unavailable'
    }
  }

  return {
    sessionId,
    found: true,
    finalized: session.status === 'finalized',
    stepCount: steps.length,
    steps: stepResults,
    chainValid,
    rootHashValid,
    storedRootHash: session.session_root_hash,
    polygonAnchorTx: session.polygon_anchor_tx,
    polygonStatus,
    // 'unavailable' and 'not_anchored' are inconclusive, not failures —
    // anchoring is optional and the hash chain's tamper-evidence doesn't
    // depend on it. 'mismatch'/'not_found' are actual negative evidence.
    overallValid: chainValid && rootHashValid !== false && polygonStatus !== 'mismatch' && polygonStatus !== 'not_found',
  }
}
