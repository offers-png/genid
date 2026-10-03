import { createSession, createStepIfActive, type SessionRecord, type StepRecord } from './supabase'
import { uploadToSessionBucket, stepStoragePath } from './storage'
import { hashBuffer } from './steganography'
import { buildStepContent, computeStepHash, signStepHash } from './chain'
import { env } from './env'

// Shared by both ways a session's first step can be produced: GenID's own
// OpenAI generation (POST /api/session with a JSON { promptText } body) and
// an externally-generated image uploaded through the API (same route, a
// multipart body — Oct 2026, "expose full certification pipeline via API
// key"). Extracted so there's exactly one place that creates the session
// row, uploads the output, and computes step 1's hash/signature — matching
// the extraction pattern lib/stamping.ts and lib/verification.ts already
// established for the stamp/verify pair.
//
// Step 1 has no prior step to chain from (prior_step_signature stays
// null). The hash formula still follows Build Spec Section 5.1 regardless
// of how the output was produced.
export interface FirstStepMaterials {
  outputBuffer: Buffer
  mimeType: string
  ext: string
  // null for an uploaded image — there's no GenID-internal model call to
  // attribute it to, unlike a 'generate' step.
  modelUsed: string | null
  modelRequestId: string | null
  requestTimestamp: Date
  responseTimestamp: Date
  promptText: string | null
  stepType: 'generate' | 'upload'
}

export async function createSessionWithFirstStep(
  genidCode: string,
  materials: FirstStepMaterials
): Promise<{ session: SessionRecord; step: StepRecord }> {
  const session = await createSession({
    genid_code: genidCode,
    content_type: 'image',
    // Only verified identities reach this point (checked by the caller),
    // so the tier is always id_verified — Phase 4 identity binding itself
    // is out of scope here.
    identity_verification_tier: 'id_verified',
  })

  const outputHash = hashBuffer(materials.outputBuffer)
  const storagePath = stepStoragePath(session.id, 1, materials.ext)
  await uploadToSessionBucket(storagePath, materials.outputBuffer, materials.mimeType)

  const stepContent = buildStepContent({
    sessionId: session.id,
    stepNumber: 1,
    outputHash,
    promptText: materials.promptText,
    editType: null,
    modelUsed: materials.modelUsed,
    responseTimestamp: materials.responseTimestamp,
  })
  const stepHash = computeStepHash(stepContent, null)
  const stepSignature = signStepHash(stepHash, env.genidSigningSecret)

  const step = await createStepIfActive({
    session_id: session.id,
    step_number: 1,
    step_type: materials.stepType,
    edit_type: null,
    prompt_text: materials.promptText,
    model_used: materials.modelUsed,
    model_request_id: materials.modelRequestId,
    request_timestamp: materials.requestTimestamp.toISOString(),
    response_timestamp: materials.responseTimestamp.toISOString(),
    output_storage_path: storagePath,
    output_hash: outputHash,
    prior_step_signature: null,
    step_hash: stepHash,
    step_signature: stepSignature,
    user_note: null,
    auto_suggested_note: null,
    is_final_selection: false,
  })

  return { session, step }
}
