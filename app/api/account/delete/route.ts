import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedRecord, SESSION_COOKIE_NAME } from '@/lib/auth'
import { deleteAccount } from '@/lib/account'

// POST { confirmGenidCode } — deletes the caller's own account. Irreversible,
// so it requires the caller to echo back their own GENID code as a
// lightweight "are you sure" guard against a stray/misclicked request, on
// top of the actual protection (session-cookie auth + SameSite=lax, same
// as POST /api/account/api-keys — no separate CSRF token needed here for
// the same reason that route doesn't carry one: there's no cross-site POST
// surface against a SameSite=lax session cookie to protect against).
//
// Session-cookie-authenticated only, not API-key-authenticated — a leaked
// API key must not be able to delete the account it was scoped to.
//
// See lib/account.ts for exactly what this does and does not delete.
export async function POST(req: NextRequest) {
  const record = await getAuthenticatedRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  if (body?.confirmGenidCode !== record.genid_code) {
    return NextResponse.json(
      { error: 'Confirmation did not match. Pass { "confirmGenidCode": "<your GENID code>" } to confirm.' },
      { status: 400 }
    )
  }

  const result = await deleteAccount(record)

  const response = NextResponse.json({
    deleted: true,
    deletedSessionCount: result.deletedSessionCount,
    retainedFinalizedSessionCount: result.retainedFinalizedSessionCount,
  })
  response.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 })
  return response
}
