import Stripe from 'stripe'

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia',
    })
  }
  return _stripe
}

export async function createIdentityVerificationSession(params: {
  email: string
  returnUrl: string
}): Promise<{ sessionId: string; url: string }> {
  const session = await getStripe().identity.verificationSessions.create({
    type: 'document',
    metadata: { email: params.email },
    options: {
      document: {
        allowed_types: ['driving_license', 'id_card', 'passport'],
        require_id_number: false,
        require_live_capture: true,
        require_matching_selfie: true,
      },
    },
    return_url: params.returnUrl,
  })

  return {
    sessionId: session.id,
    url: session.url!,
  }
}

export async function retrieveVerificationSession(sessionId: string) {
  // verified_outputs isn't included by default — must be explicitly expanded,
  // or verified_outputs comes back undefined and the webhook has nothing to
  // reconcile the stored name against.
  return await getStripe().identity.verificationSessions.retrieve(sessionId, {
    expand: ['verified_outputs'],
  })
}

export function constructWebhookEvent(payload: Buffer, signature: string) {
  return getStripe().webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  )
}
