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

export interface StepVerification {
  stepId: string
  stepNumber: number
  stepType: string
  fileHashValid: boolean
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
    if (step.output_storage_path && step.output_hash) {
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
      signatureValid,
      chainLinkValid,
      valid: fileHashValid && signatureValid && chainLinkValid,
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
