import { NextRequest, NextResponse } from 'next/server'
import { lookupByEmail } from '@/lib/supabase'
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth'

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, matches createSessionToken's TTL

// POST { email, vsid } — signs the caller in immediately once their Stripe
// Identity verification completes, without a magic-link email round trip.
// /register/callback polls until verified: true, then calls this with the
// Stripe verification session id that POST /api/stripe/session returned and
// that Stripe's own return_url redirect carried back to the browser.
//
// vsid is compared against genid_registry.stripe_verification_id, which
// app/api/stripe/webhook/route.ts writes in the SAME update that sets
// verified: true — so a caller can only produce a vsid that matches a
// verified record by having been the browser Stripe actually redirected
// back from that specific verification. /login (magic link) is untouched;
// it's still what handles a returning visit after this cookie's 30 days
// expire or a new device.
export async function POST(req: NextRequest) {
  try {
    const { email, vsid } = await req.json()
    if (!email || typeof email !== 'string' || !vsid || typeof vsid !== 'string') {
      return NextResponse.json({ error: 'email and vsid are required' }, { status: 400 })
    }

    const record = await lookupByEmail(email)
    if (!record || !record.verified || record.stripe_verification_id !== vsid) {
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
    return response
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to complete registration'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
