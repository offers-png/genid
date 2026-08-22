import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/supabase'
import { downloadFromSessionBucket, c2paExportStoragePath } from '@/lib/storage'

// GET — the final image with its C2PA/CAWG manifest embedded. Same
// stable-download pattern as /certificate: no regeneration, just the
// stored file. 404s if finalize never produced one (e.g. C2PA embedding
// failed non-fatally, or the session predates Phase 6).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params

  const session = await getSession(sessionId)
  if (!session || !session.c2pa_manifest_id) {
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
