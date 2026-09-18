import { getSession, getSessionSteps } from './supabase'
import { downloadFromSessionBucket } from './storage'
import { hashBuffer } from './steganography'
import { buildStepContent, computeStepHash, computeSessionRootHash, signStepHash } from './chain'
import { verifyOnBlockchain } from './blockchain'
import { env } from './env'

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
// CURRENT file against archive_hash (recorded at archive time over the
// compressed bytes) and archive_hash against archive_signature, so an
// archived step's stored file still has to match something specific —
// just not output_hash.

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
  polygonConfirmed: boolean | null
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
    polygonConfirmed: null,
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
        // Archived before archive_hash/archive_signature existed (this
        // step predates that migration) — there's nothing recorded to
        // check the current file against. Left null (not failed): the
        // same "skip the file check" behavior this had before archive
        // integrity tracking existed, not a false tamper report on data
        // that was never wrong in the first place.
        archiveIntegrityValid = null
      } else {
        // The original bytes are gone by design — check the CURRENT
        // (compressed) file against the hash recorded at archive time,
        // and that hash against its own signature, instead of skipping
        // the file check entirely.
        const archiveSignatureValid = signStepHash(step.archive_hash, signingSecret) === step.archive_signature

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
        (step.output_archived ? archiveIntegrityValid !== false : fileHashValid) && signatureValid && chainLinkValid,
    })

    signaturesInOrder.push(step.step_signature ?? '')
    priorStoredSignature = step.step_signature
  }

  const chainValid = stepResults.length > 0 && stepResults.every((s) => s.valid)

  let rootHashValid: boolean | null = null
  if (session.status === 'finalized' && session.session_root_hash) {
    rootHashValid = computeSessionRootHash(signaturesInOrder) === session.session_root_hash
  }

  let polygonConfirmed: boolean | null = null
  if (session.polygon_anchor_tx) {
    try {
      const chainResult = await verifyOnBlockchain(session.polygon_anchor_tx)
      polygonConfirmed =
        chainResult.confirmed && !!session.session_root_hash && !!chainResult.payload?.includes(session.session_root_hash)
    } catch {
      polygonConfirmed = false
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
    polygonConfirmed,
    overallValid: chainValid && rootHashValid !== false && polygonConfirmed !== false,
  }
}
