import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import {
  listSessionsForGenid,
  getCertificatesForSessions,
  reservePaidOperation,
} from '@/lib/supabase'
import { getCallerRecord } from '@/lib/apiKeys'
import { createSessionWithFirstStep } from '@/lib/sessionPipeline'
import { readLimitedFormData, UploadRequestError } from '@/lib/uploads'
import { openAiImageAdapter } from '@/lib/adapters/openai-image'
import {
  validatePromptText,
  validateUploadSize,
  validateImageDimensions,
  ValidationError,
  GENERATION_RATE_LIMIT,
  GENERATION_RATE_WINDOW_MS,
  EMBED_RATE_LIMIT,
  EMBED_RATE_WINDOW_MS,
  withTimeout,
  EXTERNAL_CALL_TIMEOUT_MS,
} from '@/lib/limits'

// The single Phase 1 Model Adapter. Swapping providers later means adding a
// new file under lib/adapters/ and changing this one line.
const adapter = openAiImageAdapter

// GET — lists the SIGNED-IN identity's sessions (most recent first), so a
// session is reachable again from a dashboard, not just its one-time URL.
// Previously took a bare ?email= query param — anyone who knew a target's
// email could list their sessions with no proof of ownership. The identity
// now comes from the session cookie only (Security & Trust Fix Punch List
// #4, Sept 18 follow-up) — or, as of Oct 2026, an API key (lib/apiKeys.ts),
// resolved to the identical GenidRecord shape.
export async function GET(req: NextRequest) {
  const record = await getCallerRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
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

// POST — creates a session and its first step. Two request shapes, same
// downstream pipeline either way (hash-chaining, and later C2PA/Polygon
// anchor/certificate at finalize time — see lib/sessionPipeline.ts):
//
//   application/json { promptText }       -> generates step 1 inside
//                                            GenID's own pipeline (OpenAI).
//   multipart/form-data { image }         -> step 1 IS the uploaded file —
//                                            for an image made elsewhere
//                                            (Higgsfield, HeyGen, Midjourney,
//                                            etc.) that still needs the full
//                                            certification pipeline, not
//                                            just the lightweight stamp
//                                            POST /api/v1/stamp already
//                                            covers. Added Oct 2026, "expose
//                                            full certification pipeline via
//                                            API key."
//
// Both branches accept either a session cookie or an API key
// (getCallerRecord, lib/apiKeys.ts) — the identity comes from whichever
// credential the caller presents, never a client-supplied email/genid_code.
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    return handleUploadStart(req)
  }
  return handlePromptStart(req)
}

async function handlePromptStart(req: NextRequest) {
  try {
    const body = await req.json()
    let promptText: string
    try {
      promptText = validatePromptText(body?.promptText)
    } catch (err) {
      if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }

    const record = await getCallerRecord(req)
    if (!record) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'Your identity has not been verified yet.' }, { status: 403 })
    }

    // Every generate/regenerate step calls a paid external model API —
    // bound spend per identity, not just validate input shape.
    const reserved = await reservePaidOperation(record.genid_code, 'generation')
    if (!reserved) {
      return NextResponse.json(
        { error: `Rate limit exceeded: max ${GENERATION_RATE_LIMIT} generations per ${GENERATION_RATE_WINDOW_MS / 60000} minutes. Please wait and try again.` },
        { status: 429 }
      )
    }

    const generation = await withTimeout(adapter.generateImage({ promptText }), EXTERNAL_CALL_TIMEOUT_MS, 'Image generation')

    const { session, step } = await createSessionWithFirstStep(record.genid_code, {
      outputBuffer: generation.outputBuffer,
      mimeType: generation.mimeType,
      ext: generation.ext,
      modelUsed: generation.modelUsed,
      modelRequestId: generation.modelRequestId,
      requestTimestamp: generation.requestTimestamp,
      responseTimestamp: generation.responseTimestamp,
      promptText,
      stepType: 'generate',
    })

    // No imageBase64 here — the file is already uploaded by this point, so
    // the client just fetches /api/session/[id]/step/[stepId]/image
    // directly instead of the response carrying the full image bytes
    // twice (once as this JSON payload, once again when displayed).
    return NextResponse.json({
      sessionId: session.id,
      stepId: step.id,
      outputHash: step.output_hash,
      stepSignature: step.step_signature,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Session creation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function handleUploadStart(req: NextRequest) {
  try {
    const record = await getCallerRecord(req)
    if (!record) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'Your identity has not been verified yet.' }, { status: 403 })
    }

    const formData = await readLimitedFormData(req)
    const imageFile = formData.get('image')
    if (!(imageFile instanceof File)) {
      return NextResponse.json({ error: 'Image is required (multipart/form-data field "image")' }, { status: 400 })
    }

    validateUploadSize(imageFile.size)
    const rawBuffer = Buffer.from(await imageFile.arrayBuffer())
    try {
      validateUploadSize(rawBuffer.length)
      await validateImageDimensions(rawBuffer)
    } catch (err) {
      if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }

    // Shares the /api/embed / POST /api/v1/stamp quota (not a new 'upload'
    // operation) — same per-identity budget for "an externally-sourced
    // image goes through GenID's pipeline," whether that ends in a stamped
    // file or a full certified session.
    const reserved = await reservePaidOperation(record.genid_code, 'embed')
    if (!reserved) {
      return NextResponse.json(
        { error: `Rate limit exceeded: max ${EMBED_RATE_LIMIT} uploads per ${EMBED_RATE_WINDOW_MS / 60000} minutes. Please wait and try again.` },
        { status: 429 }
      )
    }

    // Normalize to PNG regardless of the input format (JPEG/WebP/PNG) —
    // every downstream consumer assumes PNG bytes (C2PA embedding hardcodes
    // image/png; the OpenAI adapter and embedGenid already only ever
    // produce PNG, for the same reason).
    const outputBuffer = await sharp(rawBuffer).png({ compressionLevel: 9 }).toBuffer()
    const now = new Date()

    const { session, step } = await createSessionWithFirstStep(record.genid_code, {
      outputBuffer,
      mimeType: 'image/png',
      ext: 'png',
      modelUsed: null,
      modelRequestId: null,
      requestTimestamp: now,
      responseTimestamp: now,
      promptText: null,
      stepType: 'upload',
    })

    return NextResponse.json({
      sessionId: session.id,
      stepId: step.id,
      outputHash: step.output_hash,
      stepSignature: step.step_signature,
    })
  } catch (err: unknown) {
    if (err instanceof UploadRequestError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    const message = err instanceof Error ? err.message : 'Session creation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
