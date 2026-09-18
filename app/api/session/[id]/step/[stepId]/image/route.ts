import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSessionSteps } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { downloadFromSessionBucket } from '@/lib/storage'

// GET — serves one step's CURRENT image bytes directly, so the client can
// point an <img>/<Image> tag at a URL and let the browser fetch/cache each
// one lazily, instead of the server downloading and base64-encoding every
// step's image into one huge initial page payload (Sept 18 second
// follow-up, "Improve large-session loading"). "Current" means whatever is
// actually stored right now — the full-resolution original before
// finalize, or the compressed archival copy afterward (lib/lifecycle.ts) —
// exactly what output_storage_path already points at.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id: sessionId, stepId } = await params

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

  const steps = await getSessionSteps(sessionId)
  const step = steps.find((s) => s.id === stepId)
  if (!step || !step.output_storage_path) {
    return NextResponse.json({ error: 'Step image not found' }, { status: 404 })
  }

  const buffer = await downloadFromSessionBucket(step.output_storage_path)

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      // Private (ownership-gated, not a public/shared URL) but safe to
      // cache hard once fetched — a step's stored bytes never change
      // except the one-time archival swap, which is itself a deliberate,
      // infrequent event this cache duration is short enough to ride out
      // in practice for an active browsing session.
      'Cache-Control': 'private, max-age=300',
    },
  })
}
