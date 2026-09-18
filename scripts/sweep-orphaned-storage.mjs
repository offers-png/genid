// Cleanup job for genid_orphaned_storage_log (migration 012, Sept 18 fourth
// follow-up, "Fix orphaned storage cleanup"). Two code paths log a row here
// when they fail to delete a storage object that no longer has any DB row
// referencing it: the step route's upload-before-atomic-insert path, and
// lib/lifecycle.ts's archival delete-of-the-original step. This script
// re-attempts the delete for every unswept row and marks it swept once the
// object is confirmed gone (Supabase Storage's remove() is idempotent, so a
// row for an object that's already gone — deleted by an earlier run, or by
// hand — is swept just the same as one this run actually deletes).
//
// Usage:
//   node scripts/sweep-orphaned-storage.mjs           # dry run, prints what it would delete
//   node scripts/sweep-orphaned-storage.mjs --apply   # actually deletes and marks swept
//
// Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in the
// environment it's run in (e.g. `render run` / a Render shell, or with
// .env.local sourced locally, or a scheduled Render cron job).

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'genid-sessions'
const apply = process.argv.includes('--apply')

function requireEnv(key) {
  const value = process.env[key]
  if (!value) {
    console.error(`Missing required environment variable: ${key}`)
    process.exit(1)
  }
  return value
}

const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'))

const { data: rows, error } = await supabase
  .from('genid_orphaned_storage_log')
  .select('id, storage_path, reason, session_id, created_at')
  .is('swept_at', null)
  .order('created_at', { ascending: true })

if (error) {
  console.error('Failed to load orphaned storage log:', error.message)
  process.exit(1)
}

console.log(`${rows.length} unswept orphaned path(s) found.${apply ? '' : ' (dry run — pass --apply to delete and mark swept)'}`)

let swept = 0
let failed = 0

for (const row of rows) {
  console.log(`  [${row.reason}] ${row.storage_path} (logged ${row.created_at})`)

  if (!apply) continue

  const { error: removeError } = await supabase.storage.from(BUCKET).remove([row.storage_path])
  if (removeError) {
    console.error(`    failed to delete: ${removeError.message}`)
    failed++
    continue
  }

  const { error: updateError } = await supabase
    .from('genid_orphaned_storage_log')
    .update({ swept_at: new Date().toISOString() })
    .eq('id', row.id)
  if (updateError) {
    console.error(`    deleted but failed to mark swept: ${updateError.message}`)
    failed++
    continue
  }

  swept++
}

console.log(`\nDone. ${swept} swept, ${failed} failed.`)
if (!apply && rows.length > 0) {
  console.log('Re-run with --apply to actually delete these and mark them swept.')
}
