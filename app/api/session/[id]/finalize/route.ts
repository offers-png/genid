import { NextRequest, NextResponse } from 'next/server'
import {
  getSession,
  getSessionSteps,
  markStepFinal,
  finalizeSession,
  createCertificate,
  lookupGenid,
} from '@/lib/supabase'
import { downloadFromSessionBucket, uploadToSessionBucket } from '@/lib/storage'
import { generateCertificatePdf, type CertificateStep } from '@/lib/certificate'
import { computeSessionRootHash } from '@/lib/chain'
import { stampOnBlockchain } from '@/lib/blockchain'
import { env } from '@/lib/env'

// POST { stepId? } — the "finalize" button (Build Spec Sections 3.2.7 and
// 4.1.5 "Mark Final"). Marks the caller-chosen step final (defaulting to the
// latest step when omitted, which preserves Phase 1's single-step behavior),
// computes the session_root_hash from every step's signature in order,
// anchors only that root hash to Polygon (Section 5.2.3 — not every step,
// for cost control), and generates the Authorship Certificate.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await params
    const body = await req.json().catch(() => ({}))
    const requestedStepId = (body as { stepId?: string })?.stepId

    const session = await getSession(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status !== 'active') {
      return NextResponse.json({ error: `Session is already ${session.status}` }, { status: 409 })
    }

    const steps = await getSessionSteps(sessionId)
    const finalStep = requestedStepId ? steps.find((s) => s.id === requestedStepId) : steps[steps.length - 1]
    if (!finalStep) {
      const error = requestedStepId ? 'stepId does not belong to this session' : 'Session has no steps to finalize'
      return NextResponse.json({ error }, { status: 400 })
    }

    const record = await lookupGenid(session.genid_code)
    if (!record) {
      return NextResponse.json({ error: 'Registry record not found for this session' }, { status: 500 })
    }

    // Root hash covers every step in the chain, in order — not just the
    // final selection — since the whole point is proving the sequence
    // wasn't reordered or pruned, not just that the chosen output is intact.
    const sessionRootHash = computeSessionRootHash(steps.map((s) => s.step_signature ?? ''))

    let polygonAnchorTx: string | null = null
    try {
      const stamp = await stampOnBlockchain({
        genidCode: session.genid_code,
        contentHash: sessionRootHash,
        fileName: `session-${sessionId}`,
      })
      polygonAnchorTx = stamp.txHash
    } catch (blockchainErr) {
      console.error('Polygon anchor failed (non-fatal):', blockchainErr)
    }

    await markStepFinal(finalStep.id)
    await finalizeSession(sessionId, finalStep.id, sessionRootHash, polygonAnchorTx)

    const generatedAt = new Date()
    const totalDurationSeconds = Math.max(
      0,
      Math.round((generatedAt.getTime() - new Date(session.created_at).getTime()) / 1000)
    )

    const certificateSteps: CertificateStep[] = await Promise.all(
      steps.map(async (step): Promise<CertificateStep> => ({
        stepNumber: step.step_number,
        stepType: step.step_type,
        editType: step.edit_type,
        promptText: step.prompt_text,
        userNote: step.user_note,
        outputHash: step.output_hash,
        stepSignature: step.step_signature,
        responseTimestamp: step.response_timestamp,
        imageBuffer: step.output_storage_path ? await downloadFromSessionBucket(step.output_storage_path) : null,
        isFinal: step.id === finalStep.id,
      }))
    )

    const publicVerifyUrl = `${env.appUrl}/session/verify/${sessionId}`

    const pdfBuffer = await generateCertificatePdf({
      genidCode: session.genid_code,
      creatorName: record.user_name,
      sessionId: session.id,
      totalSteps: steps.length,
      totalDurationSeconds,
      steps: certificateSteps,
      generatedAt,
      verifyUrl: publicVerifyUrl,
    })

    const pdfPath = `${sessionId}/certificate.pdf`
    await uploadToSessionBucket(pdfPath, pdfBuffer, 'application/pdf')

    const certificate = await createCertificate({
      session_id: sessionId,
      pdf_export_path: pdfPath,
      json_export_path: null,
      c2pa_manifest_embedded: false,
      public_verify_url: publicVerifyUrl,
      total_steps: steps.length,
      total_duration_seconds: totalDurationSeconds,
      content_type: session.content_type,
      identity_verification_tier: session.identity_verification_tier,
      final_output_thumbnail_path: finalStep.output_storage_path,
    })

    return NextResponse.json({
      certificateId: certificate.id,
      pdfBase64: pdfBuffer.toString('base64'),
      sessionRootHash,
      polygonAnchorTx,
      verifyUrl: publicVerifyUrl,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Finalize failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
