// One-off reconciliation for existing genid_registry rows (Punch List #2
// follow-up, "reconcile existing records"). Migration 009 defaults
// name_verified to false for every row, including already-verified ones,
// because this repo never stored Stripe's verified_outputs before now —
// there was no evidence to check user_name against. This script supplies
// that evidence retroactively, for the rows where it's still available.
//
// For every verified row with a stored stripe_verification_id and
// name_verified = false, it re-retrieves that Stripe Identity verification
// session (expanding verified_outputs) and, if Stripe still has a verified
// name on file, updates user_name/name_verified to match. Stripe does not
// retain verification session data indefinitely, so a row may come back
// with no usable verified_outputs even though it verified successfully
// months ago — those rows are left as self-reported/unverified, which is
// the honest outcome, not an error.
//
// Usage:
//   node scripts/reconcile-verified-names.mjs           # dry run, prints what it would change
//   node scripts/reconcile-verified-names.mjs --apply   # actually writes the updates
//
// Requires STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// in the environment it's run in (e.g. `render run` / a Render shell, or
// with .env.local sourced locally). Never run this against a database you
// don't already have service-role access to.

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const apply = process.argv.includes('--apply')

function requireEnv(key) {
  const value = process.env[key]
  if (!value) {
    console.error(`Missing required environment variable: ${key}`)
    process.exit(1)
  }
  return value
}

const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'), { apiVersion: '2026-04-22.dahlia' })
const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'))

const { data: rows, error } = await supabase
  .from('genid_registry')
  .select('id, email, genid_code, user_name, stripe_verification_id, name_verified')
  .eq('verified', true)
  .eq('name_verified', false)
  .not('stripe_verification_id', 'is', null)

if (error) {
  console.error('Failed to load registry rows:', error.message)
  process.exit(1)
}

console.log(`${rows.length} verified row(s) with name_verified = false to check.${apply ? '' : ' (dry run — pass --apply to write changes)'}`)

let updated = 0
let noEvidence = 0
let failed = 0

for (const row of rows) {
  try {
    const session = await stripe.identity.verificationSessions.retrieve(row.stripe_verification_id, {
      expand: ['verified_outputs'],
    })
    const verifiedName = [session.verified_outputs?.first_name, session.verified_outputs?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim()

    if (!verifiedName) {
      console.log(`  [no evidence] ${row.genid_code} (${row.email}) — Stripe has no verified name on file, leaving as-is`)
      noEvidence++
      continue
    }

    console.log(`  [reconcile] ${row.genid_code} (${row.email}): "${row.user_name}" -> "${verifiedName}"`)
    updated++

    if (apply) {
      const { error: updateError } = await supabase
        .from('genid_registry')
        .update({ user_name: verifiedName, name_verified: true })
        .eq('id', row.id)
      if (updateError) throw updateError
    }
  } catch (err) {
    console.error(`  [failed] ${row.genid_code} (${row.email}):`, err instanceof Error ? err.message : err)
    failed++
  }
}

console.log(`\nDone. ${updated} would be updated, ${noEvidence} had no recoverable name, ${failed} failed to check.`)
if (!apply && updated > 0) {
  console.log('Re-run with --apply to write these changes.')
}
