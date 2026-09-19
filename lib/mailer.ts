import { env } from './env'

// Magic-link delivery via Resend's HTTP API — no SDK needed, one fetch call.
// RESEND_API_KEY is required in production; in development, with no key set,
// the link is logged instead so the flow is testable without an account.
// Logging a live sign-in link is never acceptable once real users exist, so
// that fallback is refused outright outside development.
export async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const apiKey = env.resendApiKey

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY is not set — cannot send sign-in emails in production.')
    }
    console.warn(`[dev-only] Magic link for ${email}: ${link}`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.authFromEmail,
      to: email,
      subject: 'Your GenID sign-in link',
      html:
        `<p>Click below to sign in to GenID. This link expires in 15 minutes and can only be used once.</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p>If you didn't request this, you can ignore this email.</p>`,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to send magic link email: ${res.status} ${body}`)
  }
}

// Confirms control of the registrant's inbox BEFORE Stripe Identity
// verification ever starts (Sept 19 third fix) — same delivery mechanism
// and same dev-mode/production-refusal behavior as sendMagicLinkEmail
// above, just distinct copy so a registrant isn't told they're "signing
// in" to an account that doesn't exist yet.
export async function sendRegistrationConfirmationEmail(email: string, link: string): Promise<void> {
  const apiKey = env.resendApiKey

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY is not set — cannot send registration confirmation emails in production.')
    }
    console.warn(`[dev-only] Registration confirmation for ${email}: ${link}`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.authFromEmail,
      to: email,
      subject: 'Confirm your email to continue registering with GenID',
      html:
        `<p>Click below to confirm this email address and continue registering with GenID. ` +
        `This link expires in 15 minutes and can only be used once.</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p>If you didn't request this, you can ignore this email.</p>`,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to send registration confirmation email: ${res.status} ${body}`)
  }
}
