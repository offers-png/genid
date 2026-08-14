import crypto from 'crypto'

// Step hashing per Build Spec Section 5.1:
//   step_N.hash = SHA256(step_N.content + step_(N-1).signature)
//   step_N.signature = HMAC(step_N.hash, signing_key)
//
// Phase 1 only ever writes step 1 of a session (priorStepSignature is always
// null there — nothing to chain from yet). The function still follows the
// documented formula so Phase 2/3 don't need to touch how step 1 was signed.
//
// "step content" isn't given an exact serialization in the spec — this pins
// it down as session_id:step_number:output_hash:prompt_text:model_used:response_timestamp,
// joined with ':'. Keep this format stable once Phase 3 starts verifying chains.
export function computeStepHash(content: string, priorStepSignature: string | null): string {
  const input = priorStepSignature ? `${content}${priorStepSignature}` : content
  return crypto.createHash('sha256').update(input).digest('hex')
}

export function signStepHash(stepHash: string, signingSecret: string): string {
  return crypto.createHmac('sha256', signingSecret).update(stepHash).digest('hex')
}
