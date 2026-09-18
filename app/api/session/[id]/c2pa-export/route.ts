import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { downloadFromSessionBucket, c2paExportStoragePath } from '@/lib/storage'

// GET — the final image with its C2PA/CAWG manifest embedded. Same
// stable-download pattern as /certificate: no regeneration, just the
// stored file. 404s if finalize never produced one (e.g. C2PA embedding
// failed non-fatally, or the session predates Phase 6). Ownership-gated
// like /certificate — a third party checks authenticity via the public
// verify page, not by pulling the owner's export file directly.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params

  const caller = await getAuthenticatedRecord(req)
  if (!caller) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const session = await getSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'No C2PA export exists for this session' }, { status: 404 })
  }
  if (session.genid_code !== caller.genid_code) {
    return NextResponse.json({ error: 'You do not have access to this session.' }, { status: 403 })
  }
  if (!session.c2pa_manifest_id) {
    return NextResponse.json({ error: 'No C2PA export exists for this session' }, { status: 404 })
  }

  const buffer = await downloadFromSessionBucket(c2paExportStoragePath(sessionId))

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="genid-c2pa-${sessionId}.png"`,
    },
  })
}
