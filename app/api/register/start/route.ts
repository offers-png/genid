import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { issueUniqueGenid } from '@/lib/genid'
import { createMagicLinkToken, countRecentMagicLinkRequestsForEmail } from '@/lib/auth'
import { sendRegistrationConfirmationEmail } from '@/lib/mailer'
import { env } from '@/lib/env'
import { MAGIC_LINK_RATE_LIMIT, MAGIC_LINK_RATE_WINDOW_MS } from '@/lib/limits'

// POST { fullName, email } — start of registration (Sept 19 third fix).
// Previously, submitting this form went straight to
// POST /api/stripe/session, which created a Stripe Identity verification
// session for whatever email the form supplied — nothing proved the
// submitter actually controlled that inbox. An attacker could register
// with a victim's email and complete verification with their OWN real ID,
// and the webhook would mark the VICTIM's email verified with the
// ATTACKER's identity attached.
//
// This step now only reserves the registry row (same as before) and sends
// a confirmation link to that email — reusing the exact magic-link token
// machinery already built for /login (createMagicLinkToken,
// consumeMagicLinkToken, genid_magic_link_tokens), including its rate
// limit, since "how many token emails can this address receive in 15
// minutes" is the same budget whether the email is for signing in or for
// confirming a new registration. Stripe verification doesn't start until
// that link is clicked — see GET /api/auth/confirm-registration.
export async function POST(req: NextRequest) {
  try {
    const { fullName, email } = await req.json()

    if (!fullName || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('genid_registry')
      .select('genid_code, verified')
      .eq('email', email)
      .single()

    if (existing?.verified) {
      return NextResponse.json(
        { error: 'This email already has a verified GENID', genidCode: existing.genid_code },
        { status: 409 }
      )
    }

    // Pre-create the registry record (unverified) so we can link it after
    // the confirmation click and Stripe callback.
    if (!existing) {
      const genidCode = await issueUniqueGenid(fullName)
      const { error: insertError } = await supabaseAdmin.from('genid_registry').insert({
        genid_code: genidCode,
        user_name: fullName,
        self_reported_name: fullName,
        email,
        verified: false,
        verification_status: 'pending',
      })

      if (insertError) {
        if (insertError.code !== '23505') { // unique_violation — another request beat us to it
          console.error('Failed to create registry record:', insertError)
          return NextResponse.json(
            { error: 'Failed to initialize registration. Please try again.' },
            { status: 500 }
          )
        }
        // Duplicate — user already exists; reset to pending in case they re-register
        await supabaseAdmin
          .from('genid_registry')
          .update({ verification_status: 'pending' })
          .eq('email', email)
          .eq('verified', false) // never modify a verified record
      }
    }

    const recentRequests = await countRecentMagicLinkRequestsForEmail(email, MAGIC_LINK_RATE_WINDOW_MS)
    if (recentRequests >= MAGIC_LINK_RATE_LIMIT) {
      console.warn(`Registration confirmation rate limit hit for ${email}: ${recentRequests} requests in the last ${MAGIC_LINK_RATE_WINDOW_MS / 60000} minutes.`)
      return NextResponse.json(
        { error: 'Too many confirmation emails requested for this address. Please wait and try again.' },
        { status: 429 }
      )
    }

    const token = await createMagicLinkToken(email)
    const link = `${env.appUrl}/api/auth/confirm-registration?token=${encodeURIComponent(token)}`
    await sendRegistrationConfirmationEmail(email, link)

    return NextResponse.json({
      message: 'Check your email to confirm your address before identity verification begins.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
