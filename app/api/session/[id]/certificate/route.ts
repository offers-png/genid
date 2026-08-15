import { NextRequest, NextResponse } from 'next/server'
import { getCertificateForSession } from '@/lib/supabase'
import { downloadFromSessionBucket } from '@/lib/storage'

// GET — re-download an already-generated certificate straight from storage.
// No regeneration, no re-anchoring, no DB writes: this is the stable link
// a dashboard can point at indefinitely.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params

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
