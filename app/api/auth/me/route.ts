import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedRecord } from '@/lib/auth'

// GET — resolves the caller's identity from their session cookie. Client
// components (dashboard, session creation, embed) call this instead of
// asking the user to type their email into every page.
export async function GET(req: NextRequest) {
  const record = await getAuthenticatedRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  return NextResponse.json({
    email: record.email,
    genidCode: record.genid_code,
    userName: record.user_name,
    nameVerified: record.name_verified ?? false,
    verified: record.verified,
  })
}
