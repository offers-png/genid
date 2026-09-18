import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSessionSteps, getCertificateForSession, lookupGenid } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { uploadToSessionBucket } from '@/lib/storage'
import { generateCertificatePdf, buildCertificateSteps } from '@/lib/certificate'
import { env } from '@/lib/env'

// POST — rebuilds the certificate PDF for an already-finalized session from
// data that's already committed (session_root_hash, polygon_anchor_tx,
// c2pa_manifest_embedded), with no re-anchoring and no re-signing.
//
// finalize's own idempotent early-return (existing certificate -> return it
// as-is) is deliberate — it avoids a second Polygon transaction and a
// second C2PA signature on every retry. But it also means the PDF is
// permanently frozen at whatever the certificate template looked like the
// moment it was first generated: a template-only improvement (e.g. adding
// the Blockchain Anchor section) never reaches a session finalized before
// that code shipped. This route is the deliberate escape hatch for exactly
// that case — safe to call as often as needed since it changes nothing
// about the chain, the anchor, or the manifest, only how they're rendered.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await params

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
    if (session.status !== 'finalized') {
      return NextResponse.json({ error: 'Session is not finalized yet — use finalize instead' }, { status: 409 })
    }
    if (!session.final_step_id) {
      return NextResponse.json({ error: 'Session has no final step on record' }, { status: 500 })
    }

    const existing = await getCertificateForSession(sessionId)
    if (!existing) {
      return NextResponse.json(
        { error: 'No certificate exists for this session yet — call finalize first' },
        { status: 404 }
      )
    }

    const record = await lookupGenid(session.genid_code)
    if (!record) {
      return NextResponse.json({ error: 'Registry record not found for this session' }, { status: 500 })
    }

    const steps = await getSessionSteps(sessionId)
    const certificateSteps = await buildCertificateSteps(steps, session.final_step_id)

    const generatedAt = new Date()
    const totalDurationSeconds = session.finalized_at
      ? Math.max(0, Math.round((new Date(session.finalized_at).getTime() - new Date(session.created_at).getTime()) / 1000))
      : 0
    const publicVerifyUrl = existing.public_verify_url ?? `${env.appUrl}/session/verify/${sessionId}`

    const pdfBuffer = await generateCertificatePdf({
      genidCode: session.genid_code,
      creatorName: record.user_name,
      nameVerified: record.name_verified ?? false,
      sessionId: session.id,
      totalSteps: steps.length,
      totalDurationSeconds,
      steps: certificateSteps,
      generatedAt,
      verifyUrl: publicVerifyUrl,
      c2paManifestEmbedded: existing.c2pa_manifest_embedded,
      sessionRootHash: session.session_root_hash ?? undefined,
      polygonAnchorTx: session.polygon_anchor_tx,
    })

    const pdfPath = existing.pdf_export_path ?? `${sessionId}/certificate.pdf`
    await uploadToSessionBucket(pdfPath, pdfBuffer, 'application/pdf', { upsert: true })

    return NextResponse.json({
      certificateId: existing.id,
      pdfBase64: pdfBuffer.toString('base64'),
      sessionRootHash: session.session_root_hash,
      polygonAnchorTx: session.polygon_anchor_tx,
      verifyUrl: publicVerifyUrl,
      c2paManifestEmbedded: existing.c2pa_manifest_embedded,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Certificate regeneration failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
