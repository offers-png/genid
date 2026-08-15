import { NextRequest, NextResponse } from 'next/server'
import {
  lookupByEmail,
  createSession,
  createStep,
  listSessionsForGenid,
  getCertificatesForSessions,
} from '@/lib/supabase'
import { uploadToSessionBucket, stepStoragePath } from '@/lib/storage'
import { hashBuffer } from '@/lib/steganography'
import { buildStepContent, computeStepHash, signStepHash } from '@/lib/chain'
import { openAiImageAdapter } from '@/lib/adapters/openai-image'
import { env } from '@/lib/env'

// The single Phase 1 Model Adapter. Swapping providers later means adding a
// new file under lib/adapters/ and changing this one line.
const adapter = openAiImageAdapter

// GET ?email= — lists an identity's sessions (most recent first) so a
// session is reachable again from a dashboard, not just its one-time URL.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const record = await lookupByEmail(email)
  if (!record) {
    return NextResponse.json({ error: 'No GENID found for this email' }, { status: 404 })
  }

  const sessions = await listSessionsForGenid(record.genid_code)
  const certificates = await getCertificatesForSessions(sessions.map((s) => s.id))
  const certificateBySession = new Map(certificates.map((c) => [c.session_id, c]))

  return NextResponse.json({
    sessions: sessions.map((session) => {
      const certificate = certificateBySession.get(session.id)
      return {
        id: session.id,
        contentType: session.content_type,
        status: session.status,
        createdAt: session.created_at,
        finalizedAt: session.finalized_at,
        certificate: certificate
          ? { id: certificate.id, verifyUrl: certificate.public_verify_url }
          : null,
      }
    }),
  })
}

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
    const stepContent = buildStepContent({
      sessionId: session.id,
      stepNumber: 1,
      outputHash,
      promptText,
      editType: null,
      modelUsed: generation.modelUsed,
      responseTimestamp: generation.responseTimestamp,
    })
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
