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

      await supabaseAdmin
        .from('genid_registry')
        .update({
          verified: true,
          verification_status: 'verified',
          stripe_verification_id: session.id,
        })
        .eq('email', email)

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
