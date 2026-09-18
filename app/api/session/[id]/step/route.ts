import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSessionSteps, createStepIfActive, isSessionNotActiveError, countRecentGenerationsForGenid } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { uploadToSessionBucket, downloadFromSessionBucket, stepStoragePath } from '@/lib/storage'
import { hashBuffer } from '@/lib/steganography'
import { buildStepContent, computeStepHash, signStepHash } from '@/lib/chain'
import { openAiImageAdapter } from '@/lib/adapters/openai-image'
import { applyCrop, applyColorAdjust, validateCropParams, validateColorAdjustParams } from '@/lib/edits'
import { env } from '@/lib/env'
import {
  validatePromptText,
  ValidationError,
  GENERATION_RATE_LIMIT,
  GENERATION_RATE_WINDOW_MS,
  withTimeout,
  EXTERNAL_CALL_TIMEOUT_MS,
} from '@/lib/limits'

const adapter = openAiImageAdapter

// POST { action: 'regenerate', promptText, userNote? }
//    | { action: 'edit', editType: 'crop' | 'color_adjust', params, userNote? }
//
// Adds step (latest.step_number + 1) to an active session. Regenerate calls
// the model adapter again; edit transforms the latest step's stored output
// via sharp — no new generation call. Either way the new step chains from
// the true latest step's signature (Build Spec Section 5.1), independent of
// which step is currently marked final — the chain has to cover every step,
// not just the one the user prefers.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await params
    const body = await req.json()
    const { action, userNote } = body as { action?: string; userNote?: string }

    const caller = await getAuthenticatedRecord(req)
    if (!caller) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }

    const session = await getSession(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.genid_code !== caller.genid_code) {
      return NextResponse.json({ error: 'You do not have access to this session.' }, { status: 403 })
    }
    if (session.status !== 'active') {
      return NextResponse.json({ error: `Session is ${session.status}, cannot add steps` }, { status: 409 })
    }

    const steps = await getSessionSteps(sessionId)
    const priorStep = steps[steps.length - 1]
    if (!priorStep) {
      return NextResponse.json({ error: 'Session has no prior step to build on' }, { status: 400 })
    }

    const nextStepNumber = priorStep.step_number + 1
    const requestTimestamp = new Date()

    let outputBuffer: Buffer
    let mimeType = 'image/png'
    let ext = 'png'
    let stepType: 'regenerate' | 'edit'
    let editType: string | null = null
    let promptText: string | null = null
    let modelUsed: string | null = null
    let modelRequestId: string | null = null

    if (action === 'regenerate') {
      let nextPrompt: string
      try {
        nextPrompt = validatePromptText(body.promptText)
      } catch (err) {
        if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
        throw err
      }

      // Every regenerate calls a paid external model API.
      const recentGenerations = await countRecentGenerationsForGenid(caller.genid_code, GENERATION_RATE_WINDOW_MS)
      if (recentGenerations >= GENERATION_RATE_LIMIT) {
        return NextResponse.json(
          { error: `Rate limit exceeded: max ${GENERATION_RATE_LIMIT} generations per ${GENERATION_RATE_WINDOW_MS / 60000} minutes. Please wait and try again.` },
          { status: 429 }
        )
      }

      const generation = await withTimeout(adapter.generateImage({ promptText: nextPrompt }), EXTERNAL_CALL_TIMEOUT_MS, 'Image generation')
      outputBuffer = generation.outputBuffer
      mimeType = generation.mimeType
      ext = generation.ext
      stepType = 'regenerate'
      promptText = nextPrompt
      modelUsed = generation.modelUsed
      modelRequestId = generation.modelRequestId
    } else if (action === 'edit') {
      const requestedEditType = body.editType as string | undefined
      if (requestedEditType !== 'crop' && requestedEditType !== 'color_adjust') {
        return NextResponse.json({ error: 'editType must be crop or color_adjust' }, { status: 400 })
      }
      if (!priorStep.output_storage_path) {
        return NextResponse.json({ error: 'Prior step has no stored output to edit' }, { status: 400 })
      }
      try {
        if (requestedEditType === 'crop') validateCropParams(body.params)
        else validateColorAdjustParams(body.params)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid edit params'
        return NextResponse.json({ error: message }, { status: 400 })
      }
      const sourceBuffer = await downloadFromSessionBucket(priorStep.output_storage_path)
      outputBuffer =
        requestedEditType === 'crop'
          ? await applyCrop(sourceBuffer, body.params)
          : await applyColorAdjust(sourceBuffer, body.params)
      stepType = 'edit'
      editType = requestedEditType
    } else {
      return NextResponse.json({ error: 'action must be regenerate or edit' }, { status: 400 })
    }

    const responseTimestamp = new Date()
    const outputHash = hashBuffer(outputBuffer)

    // An edit whose output is byte-identical to what it started from is a
    // no-op — most commonly the edit panel submitted at its default
    // (identity) parameters. Recording it anyway would put a real action
    // label (c2pa.cropped / c2pa.color_adjustments) on the signed record
    // and in the C2PA manifest for a change that didn't happen, which is
    // actively misleading, not just a wasted step. Reject before any
    // upload or DB write — regenerate isn't checked here since two
    // independent AI generations producing identical bytes isn't a
    // realistic no-op case.
    if (stepType === 'edit' && outputHash === priorStep.output_hash) {
      console.warn(
        `No-op ${editType} edit rejected for session ${sessionId}, step ${nextStepNumber}: output identical to prior step ${priorStep.step_number}.`
      )
      return NextResponse.json(
        { error: 'This edit produced no change from the previous version. Adjust the crop or color values before applying.' },
        { status: 400 }
      )
    }

    const storagePath = stepStoragePath(sessionId, nextStepNumber, ext)
    await uploadToSessionBucket(storagePath, outputBuffer, mimeType)

    const stepContent = buildStepContent({
      sessionId,
      stepNumber: nextStepNumber,
      outputHash,
      promptText,
      editType,
      modelUsed,
      responseTimestamp,
    })
    const stepHash = computeStepHash(stepContent, priorStep.step_signature)
    const stepSignature = signStepHash(stepHash, env.genidSigningSecret)

    // Checks the session is still 'active' and inserts the step inside one
    // Postgres transaction (migration 010) — closes the race where this
    // request's slow external generation call above could otherwise let a
    // concurrent finalize flip the session to 'finalizing' and read/hash
    // the step list before this insert lands.
    let step
    try {
      step = await createStepIfActive({
        session_id: sessionId,
        step_number: nextStepNumber,
        step_type: stepType,
        edit_type: editType,
        prompt_text: promptText,
        model_used: modelUsed,
        model_request_id: modelRequestId,
        request_timestamp: requestTimestamp.toISOString(),
        response_timestamp: responseTimestamp.toISOString(),
        output_storage_path: storagePath,
        output_hash: outputHash,
        prior_step_signature: priorStep.step_signature,
        step_hash: stepHash,
        step_signature: stepSignature,
        user_note: userNote ?? null,
        auto_suggested_note: null,
        is_final_selection: false,
      })
    } catch (err: unknown) {
      if (isSessionNotActiveError(err)) {
        return NextResponse.json(
          { error: 'This session started finalizing while this request was in progress — the new output was discarded.' },
          { status: 409 }
        )
      }
      throw err
    }

    // No imageBase64 here — see the matching comment in
    // POST /api/session for why (the client fetches the image by URL).
    return NextResponse.json({
      stepId: step.id,
      stepNumber: step.step_number,
      stepType: step.step_type,
      editType: step.edit_type,
      outputHash,
      stepSignature,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Step creation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
