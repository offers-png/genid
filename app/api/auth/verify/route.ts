import { NextRequest, NextResponse } from 'next/server'
import { consumeMagicLinkToken, createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { lookupByEmail } from '@/lib/supabase'
import { env } from '@/lib/env'

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, matches createSessionToken's TTL

// GET ?token=... — the link a magic-link email points at. Consumes the
// single-use token and, on success, issues the signed session cookie every
// ownership-gated route now requires instead of a bare email/genid_code.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing_token', env.appUrl))
  }

  let email: string | null
  try {
    email = await consumeMagicLinkToken(token)
  } catch (err) {
    console.error('Magic link consumption failed:', err)
    return NextResponse.redirect(new URL('/login?error=server_error', env.appUrl))
  }

  if (!email) {
    return NextResponse.redirect(new URL('/login?error=invalid_or_expired', env.appUrl))
  }

  const record = await lookupByEmail(email)
  if (!record) {
    // The token was valid but the registry row it pointed at is gone —
    // nothing to sign the caller in as.
    return NextResponse.redirect(new URL('/login?error=account_not_found', env.appUrl))
  }

  const sessionToken = createSessionToken(record.email, record.genid_code)

  const response = NextResponse.redirect(new URL('/dashboard', env.appUrl))
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  })
  return response
}
