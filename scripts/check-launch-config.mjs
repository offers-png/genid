// Pre-launch config check (Sept 18 fifth follow-up, "complete the deferred
// registration/email work"). Everything required to make registration
// (Stripe Identity) and sign-in (Resend magic links) actually work in
// production is external account setup, not code — this script can't do
// that setup, but it CAN tell you exactly what's missing in about 5
// seconds, instead of finding out the hard way when a real user hits
// "Send sign-in link" or finishes Stripe Identity verification.
//
// Run this with your REAL production environment variables loaded (e.g. in
// a Render shell, or with your production .env sourced locally) — running
// it against dev/test keys will just confirm your dev setup, not prod's.
//
// Usage:
//   node scripts/check-launch-config.mjs
//
// Checks:
//   1. Every environment variable lib/env.ts requires is present.
//   2. If RESEND_API_KEY is set: calls Resend's API to confirm the domain
//      in AUTH_FROM_EMAIL is actually verified there. An unverified (or
//      missing) domain means Resend will reject sends outright — sign-in
//      links will never reach anyone.
//   3. If STRIPE_SECRET_KEY is set: calls Stripe to confirm a webhook
//      endpoint exists pointed at NEXT_PUBLIC_APP_URL + /api/stripe/webhook
//      and is enabled. Without this, Stripe Identity verifications
//      complete on Stripe's side but genid_registry.verified never flips
//      to true — registration silently never finishes.

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'GENID_SIGNING_SECRET',
  'OPENAI_API_KEY',
  'C2PA_SIGNING_CERT_CHAIN_PEM',
  'C2PA_SIGNING_KEY_PEM',
  'AUTH_SESSION_SECRET',
  'RESEND_API_KEY',
  'AUTH_FROM_EMAIL',
  'NEXT_PUBLIC_APP_URL',
]

const results = []
function report(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('--- Required environment variables ---')
for (const key of REQUIRED_ENV_VARS) {
  report(key, Boolean(process.env[key]), process.env[key] ? undefined : 'not set')
}

function extractDomain(fromEmail) {
  const match = /<([^>]+)>/.exec(fromEmail ?? '') ?? [null, fromEmail]
  const address = match[1] ?? ''
  return address.split('@')[1]?.toLowerCase() ?? null
}

console.log('\n--- Resend: sending domain verification ---')
if (!process.env.RESEND_API_KEY || !process.env.AUTH_FROM_EMAIL) {
  report('Resend domain check', false, 'skipped — RESEND_API_KEY or AUTH_FROM_EMAIL not set')
} else {
  const domain = extractDomain(process.env.AUTH_FROM_EMAIL)
  if (!domain) {
    report('Resend domain check', false, `could not parse a domain out of AUTH_FROM_EMAIL="${process.env.AUTH_FROM_EMAIL}"`)
  } else {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      })
      if (!res.ok) {
        report('Resend domain check', false, `Resend API returned ${res.status} — is RESEND_API_KEY valid?`)
      } else {
        const body = await res.json()
        const match = (body.data ?? []).find((d) => domain === d.name || domain.endsWith(`.${d.name}`))
        if (!match) {
          report('Resend domain check', false, `no domain matching "${domain}" found in this Resend account — add and verify it in the Resend dashboard`)
        } else if (match.status !== 'verified') {
          report('Resend domain check', false, `domain "${match.name}" exists in Resend but status is "${match.status}", not "verified" — check its DNS records`)
        } else {
          report('Resend domain check', true, `"${match.name}" is verified`)
        }
      }
    } catch (err) {
      report('Resend domain check', false, `request failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

console.log('\n--- Stripe: Identity verification webhook ---')
if (!process.env.STRIPE_SECRET_KEY || !process.env.NEXT_PUBLIC_APP_URL) {
  report('Stripe webhook check', false, 'skipped — STRIPE_SECRET_KEY or NEXT_PUBLIC_APP_URL not set')
} else {
  try {
    const { default: Stripe } = await import('stripe')
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' })
    const expectedUrl = new URL('/api/stripe/webhook', process.env.NEXT_PUBLIC_APP_URL).toString()
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
    const match = endpoints.data.find((e) => e.url === expectedUrl)
    if (!match) {
      report(
        'Stripe webhook check',
        false,
        `no webhook endpoint found for ${expectedUrl} — create one in the Stripe dashboard (Developers -> Webhooks) listening for identity.verification_session.verified / .requires_input / .canceled`
      )
    } else if (match.status !== 'enabled') {
      report('Stripe webhook check', false, `endpoint for ${expectedUrl} exists but its status is "${match.status}", not "enabled"`)
    } else {
      const requiredEvents = [
        'identity.verification_session.verified',
        'identity.verification_session.requires_input',
        'identity.verification_session.canceled',
      ]
      const missingEvents = requiredEvents.filter((e) => !match.enabled_events.includes(e) && !match.enabled_events.includes('*'))
      if (missingEvents.length > 0) {
        report('Stripe webhook check', false, `endpoint is enabled but missing event(s): ${missingEvents.join(', ')}`)
      } else {
        report('Stripe webhook check', true, `enabled endpoint for ${expectedUrl} subscribes to all required events`)
      }
    }
  } catch (err) {
    report('Stripe webhook check', false, `request failed: ${err instanceof Error ? err.message : err}`)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'All checks passed.' : `${failed.length} check(s) failed:`}`)
for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)

process.exit(failed.length === 0 ? 0 : 1)
