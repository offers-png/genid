import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { peekRegistrationToken, REGISTRATION_TOKEN_COOKIE_NAME } from '@/lib/auth'

// GET (no query params) — polled from /register/callback to check whether
// the caller's own in-progress registration has finished verifying.
//
// Sept 30 fix: this used to take a bare, client-supplied `email` and
// return that registrant's genid_code, user_name, verified, and
// verification_status to anyone who asked — no cookie, no ownership
// check, no rate limit. Confirmed live: an unauthenticated request for a
// known email leaked that person's full name, GENID code, and
// verification status. That's the exact bug class every other route here
// was rewritten to eliminate (see the top-of-file comment in lib/auth.ts)
// — this one was just missed.
//
// Identity now comes entirely from the genid_registration_token cookie
// (set by POST /api/stripe/session once the caller's email is confirmed)
// — read, not consumed (peekRegistrationToken), since this is a status
// poll called repeatedly and the token still needs to authenticate
// POST /api/auth/complete-registration once verification finishes. A
// caller with no such cookie has no in-progress registration to check on.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(REGISTRATION_TOKEN_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: 'No registration in progress on this browser.' }, { status: 401 })
  }

  const claim = await peekRegistrationToken(token)
  if (!claim) {
    return NextResponse.json({ error: 'This registration link has expired or already been used.' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('genid_registry')
    .select('genid_code, user_name, verified, verification_status, created_at')
    .eq('email', claim.email)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'No registration found for this email' }, { status: 404 })
  }

  return NextResponse.json(data)
}
