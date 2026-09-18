import { NextRequest, NextResponse } from 'next/server'
import { getSession, getCertificateForSession } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { downloadFromSessionBucket } from '@/lib/storage'

// GET — re-download an already-generated certificate straight from storage.
// No regeneration, no re-anchoring, no DB writes: this is the stable link
// a dashboard can point at indefinitely. Ownership-gated: the PUBLIC
// verification page/API (app/session/verify/[id]) is the intentionally
// open way for a third party to check a certificate's authenticity — this
// route is the session owner re-downloading their own PDF.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const certificate = await getCertificateForSession(sessionId)
  if (!certificate || !certificate.pdf_export_path) {
    return NextResponse.json({ error: 'No certificate exists for this session yet' }, { status: 404 })
  }

  const pdfBuffer = await downloadFromSessionBucket(certificate.pdf_export_path)

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="genid-certificate-${certificate.id}.pdf"`,
    },
  })
}
