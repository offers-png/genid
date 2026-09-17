import { NextRequest, NextResponse } from 'next/server'
import { lookupByEmail, listSessionsForGenid } from '@/lib/supabase'
import { getSessionStorageBytes } from '@/lib/storage'

// GET ?email= — per-session storage usage for one identity (Build Spec
// Section 7.1.4: "build a storage-cost dashboard early... so you see
// per-user storage growth before it becomes a surprise bill"). Kept
// separate from GET /api/session so the main session list stays fast —
// this one does a Storage list() call per session.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const record = await lookupByEmail(email)
  if (!record) {
    return NextResponse.json({ error: 'No GENID found for this email' }, { status: 404 })
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
