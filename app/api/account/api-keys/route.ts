import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedRecord } from '@/lib/auth'
import { createApiKey, listApiKeys } from '@/lib/apiKeys'

// GET — lists the caller's own API keys (never the raw key — key_prefix
// only, same as any key-management UI). POST — mints a new one. Both
// session-cookie-authenticated only (not API-key-authenticated): minting
// new keys from an existing key would let a leaked key mint its own
// replacements faster than it could be revoked, which defeats the point
// of being able to revoke it.
export async function GET(req: NextRequest) {
  const record = await getAuthenticatedRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const keys = await listApiKeys(record.genid_code)
  return NextResponse.json({ keys })
}

export async function POST(req: NextRequest) {
  const record = await getAuthenticatedRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  if (!record.verified) {
    return NextResponse.json(
      { error: 'Complete Stripe identity verification before generating an API key.' },
      { status: 403 }
    )
  }

  const { rawKey, record: keyRecord } = await createApiKey(record.genid_code)

  // The only point in this key's lifetime the raw value is ever available —
  // shown once, never stored, never retrievable again.
  return NextResponse.json({ key: rawKey, record: keyRecord })
}
