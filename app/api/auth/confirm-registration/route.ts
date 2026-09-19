import { NextRequest, NextResponse } from 'next/server'
import { consumeMagicLinkToken, createMagicLinkToken, EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME, MAGIC_LINK_TTL_SECONDS } from '@/lib/auth'
import { lookupByEmail, supabaseAdmin } from '@/lib/supabase'
import { env } from '@/lib/env'

const EMAIL_CONFIRMATION_TOKEN_COOKIE_MAX_AGE = MAGIC_LINK_TTL_SECONDS

// GET ?token=... — the link a registration-confirmation email points at
// (Sept 19 third fix). Consumes the single-use magic-link token (proving
// control of this inbox), records that on the registry row, and mints a
// SECOND magic-link token as the confirmation proof POST /api/stripe/session
// requires before it will create a Stripe verification session — so that
// call, and the webhook that later trusts its metadata, are both gated on
// actually having confirmed this email, not on a bare client-supplied
// string.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/register?error=missing_token', env.appUrl))
  }

  let email: string | null
  try {
    email = await consumeMagicLinkToken(token)
  } catch (err) {
    console.error('Registration confirmation token consumption failed:', err)
    return NextResponse.redirect(new URL('/register?error=server_error', env.appUrl))
  }

  if (!email) {
    return NextResponse.redirect(new URL('/register?error=invalid_or_expired', env.appUrl))
  }

  const record = await lookupByEmail(email)
  if (!record) {
    // The token was valid but the registry row it pointed at is gone —
    // nothing to attach this confirmation to.
    return NextResponse.redirect(new URL('/register?error=account_not_found', env.appUrl))
  }

  if (record.verified) {
    // Already fully registered (e.g. this link was clicked twice, or after
    // verification already completed via another tab) — nothing left to
    // confirm, send them straight to the existing "your GENID is ready"
    // flow rather than restarting Stripe verification.
    return NextResponse.redirect(new URL(`/register/callback?email=${encodeURIComponent(email)}`, env.appUrl))
  }

  // Durable, server-set proof that THIS registry row's email was actually
  // confirmed — set now, independent of the short-lived proof token below,
  // so the webhook can check it even after that token is long spent.
  const { error: confirmError } = await supabaseAdmin
    .from('genid_registry')
    .update({ email_confirmed_at: new Date().toISOString() })
    .eq('email', email)
    .eq('verified', false) // never touch an already-verified record
  if (confirmError) {
    console.error('Failed to record email confirmation:', confirmError)
    return NextResponse.redirect(new URL('/register?error=server_error', env.appUrl))
  }

  // The short-lived proof POST /api/stripe/session will consume — carried
  // as an httpOnly cookie rather than a URL param, same reasoning as
  // REGISTRATION_TOKEN_COOKIE_NAME: never in a referrer, browser history,
  // or server log.
  const confirmationToken = await createMagicLinkToken(email)
  const response = NextResponse.redirect(new URL('/register/verify-identity', env.appUrl))
  response.cookies.set(EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME, confirmationToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: EMAIL_CONFIRMATION_TOKEN_COOKIE_MAX_AGE,
  })
  return response
}
