import { NextRequest, NextResponse } from 'next/server'
import { lookupByEmail, createSession, createStep } from '@/lib/supabase'
import { uploadToSessionBucket, stepStoragePath } from '@/lib/storage'
import { hashBuffer } from '@/lib/steganography'
import { computeStepHash, signStepHash } from '@/lib/chain'
import { openAiImageAdapter } from '@/lib/adapters/openai-image'
import { env } from '@/lib/env'

// The single Phase 1 Model Adapter. Swapping providers later means adding a
// new file under lib/adapters/ and changing this one line.
const adapter = openAiImageAdapter

// POST { email, promptText }
// Creates a session, generates step 1 inside GenID's own pipeline (not
// uploaded from elsewhere), and signs it. Phase 1 scope: one step, one
// content type, no iteration yet.
export async function POST(req: NextRequest) {
  try {
    const { email, promptText } = await req.json()
    if (!email || !promptText) {
      return NextResponse.json({ error: 'email and promptText are required' }, { status: 400 })
    }

    const record = await lookupByEmail(email)
    if (!record) {
      return NextResponse.json({ error: 'No GENID found for this email. Please register first.' }, { status: 404 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'Your identity has not been verified yet.' }, { status: 403 })
    }

    const session = await createSession({
      genid_code: record.genid_code,
      content_type: 'image',
      // Only verified identities reach this point, so the tier is always
      // id_verified — Phase 4 identity binding itself is out of scope here.
      identity_verification_tier: 'id_verified',
    })

    const generation = await adapter.generateImage({ promptText })
    const outputHash = hashBuffer(generation.outputBuffer)
    const storagePath = stepStoragePath(session.id, 1, generation.ext)
    await uploadToSessionBucket(storagePath, generation.outputBuffer, generation.mimeType)

    // Step 1 has no prior step to chain from (prior_step_signature stays
    // null). The formula still follows Build Spec Section 5.1 so Phase 2/3
    // don't have to rewrite how step 1 was signed.
    const stepContent = [
      session.id,
      1,
      outputHash,
      promptText,
      generation.modelUsed,
      generation.responseTimestamp.toISOString(),
    ].join(':')
    const stepHash = computeStepHash(stepContent, null)
    const stepSignature = signStepHash(stepHash, env.genidSigningSecret)

    const step = await createStep({
      session_id: session.id,
      step_number: 1,
      step_type: 'generate',
      edit_type: null,
      prompt_text: promptText,
      model_used: generation.modelUsed,
      model_request_id: generation.modelRequestId,
      request_timestamp: generation.requestTimestamp.toISOString(),
      response_timestamp: generation.responseTimestamp.toISOString(),
      output_storage_path: storagePath,
      output_hash: outputHash,
      prior_step_signature: null,
      step_hash: stepHash,
      step_signature: stepSignature,
      user_note: null,
      auto_suggested_note: null,
      is_final_selection: false,
    })

    return NextResponse.json({
      sessionId: session.id,
      stepId: step.id,
      outputHash,
      stepSignature,
      mimeType: generation.mimeType,
      imageBase64: generation.outputBuffer.toString('base64'),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Session creation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
