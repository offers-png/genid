import { NextRequest, NextResponse } from 'next/server'
import { lookupByEmail } from '@/lib/supabase'
import { createMagicLinkToken, countRecentMagicLinkRequestsForEmail } from '@/lib/auth'
import { sendMagicLinkEmail } from '@/lib/mailer'
import { env } from '@/lib/env'
import { MAGIC_LINK_RATE_LIMIT, MAGIC_LINK_RATE_WINDOW_MS } from '@/lib/limits'

// POST { email } — start of the magic-link sign-in flow (Punch List #4).
// Always returns the same generic response regardless of whether the email
// is registered OR rate-limited, so this endpoint can't be used to
// enumerate registered emails — the token is simply never created/sent for
// an email with no registry row, and (Sept follow-up) is also silently
// skipped once that email has requested MAGIC_LINK_RATE_LIMIT links within
// the window. A 429 here would itself leak "this email exists and you've
// hit the limit" to an attacker who doesn't already know that — returning
// the identical response either way is what keeps this endpoint from being
// usable to spam a registered user's inbox or burn the Resend quota.
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const record = await lookupByEmail(email)
    if (record) {
      const recentRequests = await countRecentMagicLinkRequestsForEmail(email, MAGIC_LINK_RATE_WINDOW_MS)
      if (recentRequests < MAGIC_LINK_RATE_LIMIT) {
        const token = await createMagicLinkToken(email)
        const link = `${env.appUrl}/api/auth/verify?token=${encodeURIComponent(token)}`
        await sendMagicLinkEmail(email, link)
      } else {
        console.warn(`Magic link rate limit hit for ${email}: ${recentRequests} requests in the last ${MAGIC_LINK_RATE_WINDOW_MS / 60000} minutes.`)
      }
    }

    return NextResponse.json({
      message: 'If an account exists for this email, a sign-in link has been sent.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send sign-in link'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
