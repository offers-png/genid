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
import { generateCertificatePdf } from '@/lib/certificate'

// POST — Phase 1's "finalize" button (Build Spec Section 3.2.7). Marks the
// session's step as final and generates a first-pass Authorship Certificate:
// prompt, output image, timestamp, signature. session_root_hash / Polygon
// anchoring / public_verify_url are Phase 3+ — left null here rather than
// half-implemented.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await params

    const session = await getSession(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status !== 'active') {
      return NextResponse.json({ error: `Session is already ${session.status}` }, { status: 409 })
    }

    const steps = await getSessionSteps(sessionId)
    // Phase 1 has exactly one step per session — Phase 2 adds a caller-chosen
    // final selection among several.
    const finalStep = steps[steps.length - 1]
    if (!finalStep) {
      return NextResponse.json({ error: 'Session has no steps to finalize' }, { status: 400 })
    }

    const record = await lookupGenid(session.genid_code)
    if (!record) {
      return NextResponse.json({ error: 'Registry record not found for this session' }, { status: 500 })
    }

    await markStepFinal(finalStep.id)
    await finalizeSession(sessionId, finalStep.id)

    const imageBuffer = await downloadFromSessionBucket(finalStep.output_storage_path!)
    const generatedAt = new Date()

    const pdfBuffer = await generateCertificatePdf({
      genidCode: session.genid_code,
      creatorName: record.user_name,
      sessionId: session.id,
      promptText: finalStep.prompt_text ?? '',
      imageBuffer,
      outputHash: finalStep.output_hash ?? '',
      stepSignature: finalStep.step_signature ?? '',
      generatedAt,
    })

    const pdfPath = `${sessionId}/certificate.pdf`
    await uploadToSessionBucket(pdfPath, pdfBuffer, 'application/pdf')

    const totalDurationSeconds = Math.max(
      0,
      Math.round((generatedAt.getTime() - new Date(session.created_at).getTime()) / 1000)
    )

    const certificate = await createCertificate({
      session_id: sessionId,
      pdf_export_path: pdfPath,
      json_export_path: null,
      c2pa_manifest_embedded: false,
      public_verify_url: null,
      total_steps: steps.length,
      total_duration_seconds: totalDurationSeconds,
      content_type: session.content_type,
      identity_verification_tier: session.identity_verification_tier,
      final_output_thumbnail_path: finalStep.output_storage_path,
    })

    return NextResponse.json({
      certificateId: certificate.id,
      pdfBase64: pdfBuffer.toString('base64'),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Finalize failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
