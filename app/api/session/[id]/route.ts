import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSessionSteps } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await getSession(id)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const steps = await getSessionSteps(id)
  return NextResponse.json({ session, steps })
}
