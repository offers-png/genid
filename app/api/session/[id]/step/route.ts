import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSessionSteps, createStep } from '@/lib/supabase'
import { uploadToSessionBucket, downloadFromSessionBucket, stepStoragePath } from '@/lib/storage'
import { hashBuffer } from '@/lib/steganography'
import { computeStepHash, signStepHash } from '@/lib/chain'
import { openAiImageAdapter } from '@/lib/adapters/openai-image'
import { applyCrop, applyColorAdjust } from '@/lib/edits'
import { env } from '@/lib/env'

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

    const session = await getSession(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
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
      const nextPrompt = body.promptText as string | undefined
      if (!nextPrompt) {
        return NextResponse.json({ error: 'promptText is required for regenerate' }, { status: 400 })
      }
      const generation = await adapter.generateImage({ promptText: nextPrompt })
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
    const storagePath = stepStoragePath(sessionId, nextStepNumber, ext)
    await uploadToSessionBucket(storagePath, outputBuffer, mimeType)

    const stepContent = [
      sessionId,
      nextStepNumber,
      outputHash,
      promptText ?? editType ?? '',
      modelUsed ?? '',
      responseTimestamp.toISOString(),
    ].join(':')
    const stepHash = computeStepHash(stepContent, priorStep.step_signature)
    const stepSignature = signStepHash(stepHash, env.genidSigningSecret)

    const step = await createStep({
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

    return NextResponse.json({
      stepId: step.id,
      stepNumber: step.step_number,
      stepType: step.step_type,
      editType: step.edit_type,
      outputHash,
      stepSignature,
      mimeType,
      imageBase64: outputBuffer.toString('base64'),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Step creation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
