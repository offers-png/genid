import { NextRequest, NextResponse } from 'next/server'
import { listSessionsForGenid } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { getSessionStorageBytes } from '@/lib/storage'

// GET — per-session storage usage for the SIGNED-IN identity (Build Spec
// Section 7.1.4: "build a storage-cost dashboard early... so you see
// per-user storage growth before it becomes a surprise bill"). Kept
// separate from GET /api/session so the main session list stays fast —
// this one does a Storage list() call per session. Previously took a bare
// ?email= — same ownership gap as GET /api/session, fixed the same way.
export async function GET(req: NextRequest) {
  const record = await getAuthenticatedRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const sessions = await listSessionsForGenid(record.genid_code)
  const sessionBytes = await Promise.all(sessions.map((s) => getSessionStorageBytes(s.id)))

  const sessionUsage = sessions.map((session, i) => ({
    id: session.id,
    status: session.status,
    createdAt: session.created_at,
    bytes: sessionBytes[i],
  }))

  return NextResponse.json({
    totalBytes: sessionBytes.reduce((sum, b) => sum + b, 0),
    sessions: sessionUsage,
  })
}
