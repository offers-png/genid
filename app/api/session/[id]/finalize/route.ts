import { NextRequest, NextResponse } from 'next/server'
import {
  getSession,
  getSessionSteps,
  getCertificateForSession,
  markStepFinal,
  finalizeSession,
  createCertificate,
  lookupGenid,
  type StepRecord,
} from '@/lib/supabase'
import { downloadFromSessionBucket, uploadToSessionBucket } from '@/lib/storage'
import { generateCertificatePdf, type CertificateStep } from '@/lib/certificate'
import { computeSessionRootHash } from '@/lib/chain'
import { stampOnBlockchain } from '@/lib/blockchain'
import { env } from '@/lib/env'

// POST { stepId? } — the "finalize" button (Build Spec Sections 3.2.7 and
// 4.1.5 "Mark Final"). Marks the caller-chosen step final (defaulting to the
// latest step when omitted), computes the session_root_hash from every
// step's signature in order, anchors only that root hash to Polygon
// (Section 5.2.3 — not every step, for cost control), and generates the
// Authorship Certificate.
//
// Ordering matters here: the certificate PDF is built and uploaded BEFORE
// any write marks the session finalized. If PDF generation throws (it did —
// pdfkit's font files weren't reachable in the Render deploy, now fixed via
// serverExternalPackages in next.config.ts), the session is untouched and
// this same endpoint can just be called again.
//
// That also makes this route its own recovery path for sessions that got
// stuck under the old ordering (finalized in the DB, no certificate ever
// written): if status is already 'finalized', reuse the already-committed
// final_step_id / session_root_hash / polygon_anchor_tx instead of
// re-picking a step or paying for a second Polygon transaction, and just
// (re)generate the certificate. If a certificate already exists, return it
// as-is — this endpoint is idempotent, not just retriable.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await params
    const body = await req.json().catch(() => ({}))
    const requestedStepId = (body as { stepId?: string })?.stepId

    const session = await getSession(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status === 'abandoned') {
      return NextResponse.json({ error: 'Session is abandoned' }, { status: 409 })
    }

    const alreadyFinalized = session.status === 'finalized'

    if (alreadyFinalized) {
      const existing = await getCertificateForSession(sessionId)
      if (existing) {
        const pdfBuffer = await downloadFromSessionBucket(existing.pdf_export_path!)
        return NextResponse.json({
          certificateId: existing.id,
          pdfBase64: pdfBuffer.toString('base64'),
          sessionRootHash: session.session_root_hash,
          polygonAnchorTx: session.polygon_anchor_tx,
          verifyUrl: existing.public_verify_url,
        })
      }
    }

    const steps = await getSessionSteps(sessionId)

    let finalStep: StepRecord | undefined
    if (alreadyFinalized) {
      // Recovering a stuck session — the final step was already chosen and
      // committed; don't let a retry silently change it.
      finalStep = steps.find((s) => s.id === session.final_step_id)
      if (!finalStep) {
        return NextResponse.json(
          { error: 'Session is finalized but its final step record is missing — cannot recover' },
          { status: 500 }
        )
      }
    } else {
      finalStep = requestedStepId ? steps.find((s) => s.id === requestedStepId) : steps[steps.length - 1]
      if (!finalStep) {
        const error = requestedStepId ? 'stepId does not belong to this session' : 'Session has no steps to finalize'
        return NextResponse.json({ error }, { status: 400 })
      }
    }

    const record = await lookupGenid(session.genid_code)
    if (!record) {
      return NextResponse.json({ error: 'Registry record not found for this session' }, { status: 500 })
    }

    // Root hash covers every step in the chain, in order — not just the
    // final selection — since the whole point is proving the sequence
    // wasn't reordered or pruned, not just that the chosen output is intact.
    // Reuse what's already stored on a recovery pass rather than recomputing.
    const sessionRootHash = session.session_root_hash ?? computeSessionRootHash(steps.map((s) => s.step_signature ?? ''))

    let polygonAnchorTx = session.polygon_anchor_tx
    if (!polygonAnchorTx) {
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
    }

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

    // Everything above this line is read-only or idempotent to repeat. The
    // PDF generation below is the step that actually failed in production —
    // nothing has been written to genid_sessions/genid_steps yet, so a
    // throw here still leaves the session cleanly retriable.
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

    // Only now commit the finalized state.
    await markStepFinal(finalStep.id)
    if (!alreadyFinalized) {
      await finalizeSession(sessionId, finalStep.id, sessionRootHash, polygonAnchorTx)
    }

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
