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
// verification id. That cookie is short-lived and single-use (migration
// 013, consumeRegistrationToken), and only ever reaches the browser it was
// set on: a caller who merely knows a pending registrant's email, or who
// captured a value that was once valid, has no way to present it.
//
// That alone isn't sufficient, though (Sept 19 second fix, migration 014):
// POST /api/stripe/session doesn't reject a second registration attempt
// for an email that's merely pending, only a fully-verified one — so an
// attacker could start their OWN registration using a victim's email while
// the victim's real verification is in progress, and receive their own
// genuinely single-use, unexpired, correctly-cookied token. Checking only
// record.verified here would let that token redeem the moment the VICTIM
// finishes verifying, since that flag is a plain per-email boolean with no
// record of which session set it. Requiring record.stripe_verification_id
// (written by the webhook only on an actual
// identity.verification_session.verified event) to equal the session id
// THIS token was issued alongside closes that: the attacker's token only
// redeems if their OWN session is the one Stripe confirmed, never by way
// of someone else's.
//
// /login (magic link) is untouched; it's still what handles a returning
// visit after this cookie's 30 days expire or on a new device.
export async function POST(req: NextRequest) {
  try {
    const registrationToken = req.cookies.get(REGISTRATION_TOKEN_COOKIE_NAME)?.value
    if (!registrationToken) {
      return NextResponse.json({ error: 'No registration in progress on this browser.' }, { status: 401 })
    }

    const claim = await consumeRegistrationToken(registrationToken)
    if (!claim) {
      return NextResponse.json({ error: 'This registration link has expired or already been used.' }, { status: 401 })
    }

    const record = await lookupByEmail(claim.email)
    if (
      !record ||
      !record.verified ||
      !claim.stripeVerificationSessionId ||
      record.stripe_verification_id !== claim.stripeVerificationSessionId
    ) {
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
