import { NextRequest, NextResponse } from 'next/server'
import { lookupByEmail } from '@/lib/supabase'
import {
  createSessionToken,
  consumeRegistrationToken,
  SESSION_COOKIE_NAME,
  REGISTRATION_TOKEN_COOKIE_NAME,
} from '@/lib/auth'

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, matches createSessionToken's TTL

// POST (no body) — signs the caller in immediately once their Stripe
// Identity verification completes, without a magic-link email round trip.
// /register/callback calls this once its poll sees verified: true.
//
// Identity comes entirely from the genid_registration_token cookie
// POST /api/stripe/session set — never from a client-supplied email or
// verification id. That cookie is short-lived, single-use (migration 013,
// consumeRegistrationToken), and only ever reaches the browser it was set
// on: a caller who merely knows a pending registrant's email, or who
// captured a value that was once valid, has no way to present it. This
// replaces an earlier version of this route that compared a
// client-supplied Stripe verification session id against
// genid_registry.stripe_verification_id — a durable value that never
// changes once set, so it could be replayed indefinitely by anyone who
// ever learned it, from any browser. /login (magic link) is untouched;
// it's still what handles a returning visit after this cookie's 30 days
// expire or on a new device.
export async function POST(req: NextRequest) {
  try {
    const registrationToken = req.cookies.get(REGISTRATION_TOKEN_COOKIE_NAME)?.value
    if (!registrationToken) {
      return NextResponse.json({ error: 'No registration in progress on this browser.' }, { status: 401 })
    }

    const email = await consumeRegistrationToken(registrationToken)
    if (!email) {
      return NextResponse.json({ error: 'This registration link has expired or already been used.' }, { status: 401 })
    }

    const record = await lookupByEmail(email)
    if (!record || !record.verified) {
      return NextResponse.json({ error: 'Could not confirm this verification.' }, { status: 403 })
    }

    const sessionToken = createSessionToken(record.email, record.genid_code)

    const response = NextResponse.json({ genidCode: record.genid_code })
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE,
    })
    // Single-use already (consumeRegistrationToken), but clearing it too
    // means a stale cookie doesn't linger in the browser after redemption.
    response.cookies.delete(REGISTRATION_TOKEN_COOKIE_NAME)
    return response
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to complete registration'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
