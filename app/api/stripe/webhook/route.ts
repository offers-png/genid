import { NextRequest, NextResponse } from 'next/server'
import { constructWebhookEvent, retrieveVerificationSession } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'

// Stripe sends webhook events for identity verification status changes
export async function POST(req: NextRequest) {
  const payload = await req.arrayBuffer()
  const signature = req.headers.get('stripe-signature') ?? ''

  let event
  try {
    event = constructWebhookEvent(Buffer.from(payload), signature)
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  if (event.type === 'identity.verification_session.verified') {
    const session = await retrieveVerificationSession(event.data.object.id)
    const email = session.metadata?.email

    if (email) {
      await supabaseAdmin
        .from('genid_registry')
        .update({
          verified: true,
          stripe_verification_id: session.id,
        })
        .eq('email', email)
    }
  }

  if (event.type === 'identity.verification_session.requires_input') {
    // Verification failed or needs more info — keep verified: false
    const session = event.data.object
    console.warn('Verification requires more input:', session.id, session.last_error)
  }

  return NextResponse.json({ received: true })
}
