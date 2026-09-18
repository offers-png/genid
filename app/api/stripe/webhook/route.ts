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

      if (verifiedName) {
        await supabaseAdmin
          .from('genid_registry')
          .update({
            verified: true,
            verification_status: 'verified',
            stripe_verification_id: session.id,
            user_name: verifiedName,
            name_verified: true,
          })
          .eq('email', email)
      } else {
        // Stripe confirmed identity but this verification flow returned no
        // name in verified_outputs (happens for some document/flow
        // combinations) — identity is verified, but the DISPLAY NAME is
        // still whatever the registrant typed. Leave user_name untouched
        // and explicitly mark it unverified rather than silently letting
        // the self-reported value keep riding on `verified: true`.
        console.warn(
          `Stripe verification ${session.id} for ${email} succeeded with no verified_outputs name — ` +
            'user_name stays self-reported and name_verified is set to false.'
        )
        await supabaseAdmin
          .from('genid_registry')
          .update({
            verified: true,
            verification_status: 'verified',
            stripe_verification_id: session.id,
            name_verified: false,
          })
          .eq('email', email)
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
