import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSessionSteps } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const caller = await getAuthenticatedRecord(req)
  if (!caller) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const session = await getSession(id)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  if (session.genid_code !== caller.genid_code) {
    return NextResponse.json({ error: 'You do not have access to this session.' }, { status: 403 })
  }

  const steps = await getSessionSteps(id)
  return NextResponse.json({ session, steps })
}
