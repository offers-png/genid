import crypto from 'crypto'
import { getAdmin, lookupGenid, type GenidRecord } from './supabase'

// External developer API keys (Oct 2026) — a second auth method alongside
// the magic-link session cookie (lib/auth.ts), for callers with no browser
// (a backend service, a CLI, a Figma plugin's sandboxed webview that
// can't easily hold a cookie jar). Deliberately kept separate from
// lib/auth.ts rather than folded in: session cookies prove "this browser
// completed a magic-link flow", API keys prove "this caller holds a secret
// the dashboard showed a verified user once" — different enough
// provenance that mixing them into one function would blur what a given
// code path is actually trusting.

const KEY_PREFIX = 'gk_live_'
const KEY_RANDOM_BYTES = 32 // 256 bits — resolveApiKey's hash lookup is the only brute-force surface, and it's rate-limited at the database/network layer same as any other request
const KEY_PREFIX_DISPLAY_LENGTH = KEY_PREFIX.length + 8 // enough to tell keys apart in a revoke list, not enough to narrow a brute-force search

export interface ApiKeyRecord {
  id: string
  genid_code: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

// Returns the raw key exactly once — the caller (the dashboard route) must
// hand it to the user in that same response, because after this call
// returns, nothing in this system can ever produce it again (only its hash
// is stored). Requires an already-verified identity: an unverified
// registration has no Stripe-confirmed identity for the stamped output to
// actually attest to, so there's nothing legitimate an API key minted at
// this stage could be used for.
export async function createApiKey(genidCode: string): Promise<{ rawKey: string; record: ApiKeyRecord }> {
  const rawKey = `${KEY_PREFIX}${crypto.randomBytes(KEY_RANDOM_BYTES).toString('base64url')}`
  const keyPrefix = rawKey.slice(0, KEY_PREFIX_DISPLAY_LENGTH)

  const { data, error } = await getAdmin()
    .from('genid_api_keys')
    .insert({ genid_code: genidCode, key_hash: hashKey(rawKey), key_prefix: keyPrefix })
    .select('id, genid_code, key_prefix, created_at, last_used_at, revoked_at')
    .single()

  if (error || !data) throw new Error(`Failed to create API key: ${error?.message ?? 'no data returned'}`)
  return { rawKey, record: data as ApiKeyRecord }
}

export async function listApiKeys(genidCode: string): Promise<ApiKeyRecord[]> {
  const { data, error } = await getAdmin()
    .from('genid_api_keys')
    .select('id, genid_code, key_prefix, created_at, last_used_at, revoked_at')
    .eq('genid_code', genidCode)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list API keys: ${error.message}`)
  return (data ?? []) as ApiKeyRecord[]
}

// Scoped to genidCode so one identity can't revoke another's key by
// guessing/enumerating ids — the dashboard route passes the CALLER's own
// genidCode from their session, never a client-supplied one.
export async function revokeApiKey(genidCode: string, keyId: string): Promise<boolean> {
  const { data, error } = await getAdmin()
    .from('genid_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('genid_code', genidCode)
    .is('revoked_at', null)
    .select('id')

  if (error) throw new Error(`Failed to revoke API key: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// Resolves a Bearer token to the same GenidRecord shape
// getAuthenticatedRecord (lib/auth.ts) produces from a session cookie, so
// every downstream check (record.verified, reservePaidOperation keyed by
// genid_code, ownership checks) works identically regardless of which auth
// method got the caller there. Re-checks the live registry row (not a
// cached copy) on every call, same reasoning as resolveSessionCookie: a
// key minted before an identity's verified/genid_code state changed
// shouldn't keep trading on the old state.
export async function resolveApiKey(authorizationHeader: string | null): Promise<GenidRecord | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null
  const rawKey = authorizationHeader.slice('Bearer '.length).trim()
  if (!rawKey) return null

  const admin = getAdmin()
  const { data: keyRow, error } = await admin
    .from('genid_api_keys')
    .select('id, genid_code')
    .eq('key_hash', hashKey(rawKey))
    .is('revoked_at', null)
    .maybeSingle()

  if (error || !keyRow) return null

  // Best-effort — a failed last_used_at write shouldn't block the actual
  // request this key is authenticating.
  void admin.from('genid_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id).then(
    () => {},
    () => {}
  )

  return lookupGenid(keyRow.genid_code)
}
