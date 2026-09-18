import { NextRequest, NextResponse } from 'next/server'
import { lookupByEmail } from '@/lib/supabase'
import { createMagicLinkToken } from '@/lib/auth'
import { sendMagicLinkEmail } from '@/lib/mailer'
import { env } from '@/lib/env'

// POST { email } — start of the magic-link sign-in flow (Punch List #4).
// Always returns the same generic response regardless of whether the email
// is registered, so this endpoint can't be used to enumerate registered
// emails — the token itself is simply never created/sent for an email with
// no registry row.
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const record = await lookupByEmail(email)
    if (record) {
      const token = await createMagicLinkToken(email)
      const link = `${env.appUrl}/api/auth/verify?token=${encodeURIComponent(token)}`
      await sendMagicLinkEmail(email, link)
    }

    return NextResponse.json({
      message: 'If an account exists for this email, a sign-in link has been sent.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send sign-in link'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
