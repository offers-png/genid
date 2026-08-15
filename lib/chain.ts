import crypto from 'crypto'

// Step hashing per Build Spec Section 5.1:
//   step_N.hash = SHA256(step_N.content + step_(N-1).signature)
//   step_N.signature = HMAC(step_N.hash, signing_key)
//   session_root_hash = SHA256(concat of all step signatures in order)
export function computeStepHash(content: string, priorStepSignature: string | null): string {
  const input = priorStepSignature ? `${content}${priorStepSignature}` : content
  return crypto.createHash('sha256').update(input).digest('hex')
}

export function signStepHash(stepHash: string, signingSecret: string): string {
  return crypto.createHmac('sha256', signingSecret).update(stepHash).digest('hex')
}

export function computeSessionRootHash(signaturesInOrder: string[]): string {
  return crypto.createHash('sha256').update(signaturesInOrder.join('')).digest('hex')
}

export interface StepContentInput {
  sessionId: string
  stepNumber: number
  outputHash: string
  promptText: string | null
  editType: string | null
  modelUsed: string | null
  responseTimestamp: Date
}

// "step content" isn't given an exact serialization in the spec — this pins
// it down as session_id:step_number:output_hash:(prompt or edit type):model:response_timestamp,
// joined with ':'. Both write paths (POST /api/session, POST /api/session/[id]/step)
// and the verify path (lib/verify.ts) call this SAME function, so write-time
// and verify-time can never silently drift apart — a hand-copied format string
// in two places is exactly how "tamper detected" false positives happen.
export function buildStepContent(input: StepContentInput): string {
  return [
    input.sessionId,
    input.stepNumber,
    input.outputHash,
    input.promptText ?? input.editType ?? '',
    input.modelUsed ?? '',
    input.responseTimestamp.toISOString(),
  ].join(':')
}
