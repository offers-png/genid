import { NextRequest, NextResponse } from 'next/server'
import { createIdentityVerificationSession } from '@/lib/stripe'
import { lookupByEmail } from '@/lib/supabase'
import {
  consumeMagicLinkToken,
  createRegistrationToken,
  EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME,
  REGISTRATION_TOKEN_COOKIE_NAME,
} from '@/lib/auth'

const REGISTRATION_TOKEN_COOKIE_MAX_AGE = 60 * 30 // 30 minutes, matches createRegistrationToken's TTL

// POST (no body) — creates the Stripe Identity verification session for a
// registration whose email has already been confirmed (Sept 19 third
// fix). Reached only via /register/verify-identity, right after GET
// /api/auth/confirm-registration sets the confirmation-proof cookie this
// route reads — never from a client-supplied email string. That's what
// stops an attacker from ever reaching Stripe verification for an email
// they don't control: they'd have needed the confirmation email to land
// in an inbox they can read.
export async function POST(req: NextRequest) {
  try {
    const confirmationToken = req.cookies.get(EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME)?.value
    if (!confirmationToken) {
      return NextResponse.json({ error: 'No confirmed registration in progress on this browser.' }, { status: 401 })
    }

    const email = await consumeMagicLinkToken(confirmationToken)
    if (!email) {
      return NextResponse.json({ error: 'This confirmation link has expired or already been used.' }, { status: 401 })
    }

    const record = await lookupByEmail(email)
    if (!record || record.verified) {
      return NextResponse.json({ error: 'Could not start identity verification for this registration.' }, { status: 403 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const { sessionId, url } = await createIdentityVerificationSession({
      email,
      returnUrl: `${baseUrl}/register/callback?email=${encodeURIComponent(email)}`,
    })

    // Issues the short-lived, single-use registration token (lib/auth.ts)
    // that lets /register/callback sign the caller straight in once Stripe
    // confirms verification, without a magic-link email round trip.
    // Delivered as an httpOnly cookie — not returned in the JSON body and
    // never touched by client-side JS — specifically so it's bound to
    // whatever browser holds this cookie rather than to any value a client
    // could read, copy, or replay from a different browser. Also bound to
    // THIS exact Stripe verification session id, so a token can only ever
    // redeem off of the session it was actually issued for.
    const registrationToken = await createRegistrationToken(email, sessionId)
    const response = NextResponse.json({ url })
    response.cookies.set(REGISTRATION_TOKEN_COOKIE_NAME, registrationToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: REGISTRATION_TOKEN_COOKIE_MAX_AGE,
    })
    // Single-use already (consumeMagicLinkToken), but clearing it too means
    // a stale cookie doesn't linger in the browser after redemption.
    response.cookies.delete(EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME)
    return response
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
