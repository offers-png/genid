import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { constructWebhookEvent, retrieveVerificationSession } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const payload = await req.arrayBuffer()
  const signature = req.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = constructWebhookEvent(Buffer.from(payload), signature)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  try {
    if (event.type === 'identity.verification_session.verified') {
      const session = await retrieveVerificationSession(event.data.object.id)
      const email = session.metadata?.email
      if (!email) return NextResponse.json({ received: true })

      // The certificate displays user_name as "Verified AI content created
      // by {name}" — that claim is only true if the name came from Stripe's
      // document check, not from whatever the registrant self-reported at
      // signup. name_verified makes that distinction explicit and durable
      // (Punch List #2 follow-up) instead of implicit in "did user_name
      // happen to get overwritten" — every branch below sets it, on
      // purpose, rather than leaving it to whatever it defaulted to.
      const verifiedOutputs = session.verified_outputs
      const verifiedName = [verifiedOutputs?.first_name, verifiedOutputs?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim()

      // Sept 19 third fix: don't trust session.metadata.email on its own —
      // it's just a value OUR server set at session-creation time, and
      // nothing here proves the registrant who finished this particular
      // Stripe flow actually controls that inbox. email_confirmed_at is
      // only ever set by GET /api/auth/confirm-registration, right after
      // consuming a magic-link token mailed to that exact address — so
      // requiring it here (rather than writing verified: true
      // unconditionally) is what closes the registration-time hijack this
      // whole flow exists to prevent: an attacker registering with a
      // victim's email and completing verification with their own,
      // genuinely real, identity.
      const updatePayload = verifiedName
        ? {
            verified: true,
            verification_status: 'verified',
            stripe_verification_id: session.id,
            user_name: verifiedName,
            name_verified: true,
          }
        : {
            // Stripe confirmed identity but this verification flow
            // returned no name in verified_outputs (happens for some
            // document/flow combinations) — identity is verified, but the
            // DISPLAY NAME is still whatever the registrant typed. Leave
            // user_name untouched and explicitly mark it unverified rather
            // than silently letting the self-reported value keep riding on
            // `verified: true`.
            verified: true,
            verification_status: 'verified',
            stripe_verification_id: session.id,
            name_verified: false,
          }
      if (!verifiedName) {
        console.warn(
          `Stripe verification ${session.id} for ${email} succeeded with no verified_outputs name — ` +
            'user_name stays self-reported and name_verified is set to false.'
        )
      }

      const { data: updated, error: updateError } = await supabaseAdmin
        .from('genid_registry')
        .update(updatePayload)
        .eq('email', email)
        .not('email_confirmed_at', 'is', null)
        .select('id')

      if (updateError) {
        console.error(`Failed to write verified: true for ${email} (session ${session.id}):`, updateError.message)
      } else if (!updated || updated.length === 0) {
        console.warn(
          `Stripe verification ${session.id} reported metadata.email=${email}, but that registry row has no ` +
            'email_confirmed_at — refusing to mark it verified. This email was never confirmed via ' +
            'GET /api/auth/confirm-registration for this registration attempt.'
        )
      }

      return NextResponse.json({ received: true })
    }

    if (event.type === 'identity.verification_session.requires_input') {
      const session = event.data.object as Stripe.Identity.VerificationSession
      const email = session.metadata?.email
      if (!email) return NextResponse.json({ received: true })

      const lastError = session.last_error
      const reason = lastError?.reason ?? 'document_unreadable'

      await supabaseAdmin
        .from('genid_registry')
        .update({ verification_status: `failed:${reason}` })
        .eq('email', email)
        .eq('verified', false) // never downgrade a verified record

      return NextResponse.json({ received: true })
    }

    if (event.type === 'identity.verification_session.canceled') {
      const session = event.data.object as Stripe.Identity.VerificationSession
      const email = session.metadata?.email
      if (!email) return NextResponse.json({ received: true })

      await supabaseAdmin
        .from('genid_registry')
        .update({ verification_status: 'canceled' })
        .eq('email', email)
        .eq('verified', false)

      return NextResponse.json({ received: true })
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
