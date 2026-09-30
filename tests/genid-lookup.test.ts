import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { VERIFY_RATE_LIMIT } from '@/lib/limits'

// GET /api/genid/lookup (Sept 30 fix) — had no rate limit at all, and
// GENID codes are only 2 letters + 5 digits (~67M combinations). An
// IP-based limiter, same pattern as /api/verify, at least bounds how fast
// that space can be brute-forced from one source.

vi.mock('@/lib/supabase', () => ({
  lookupGenid: vi.fn(),
  getContentHistory: vi.fn(),
}))

import { lookupGenid, getContentHistory } from '@/lib/supabase'
import { GET as genidLookup } from '@/app/api/genid/lookup/route'

function req(code: string, ip: string) {
  return new NextRequest(`http://localhost/api/genid/lookup?code=${encodeURIComponent(code)}`, {
    headers: { 'x-forwarded-for': ip },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookupGenid).mockResolvedValue({
    id: '1',
    genid_code: 'AB12345',
    user_name: 'Creator',
    email: 'creator@example.com',
    stripe_verification_id: null,
    verified: true,
    name_verified: true,
    created_at: new Date().toISOString(),
  })
  vi.mocked(getContentHistory).mockResolvedValue([])
})

describe('GET /api/genid/lookup — rate limiting', () => {
  it('allows requests from a fresh IP up to the limit', async () => {
    const ip = '198.51.100.10'
    for (let i = 0; i < VERIFY_RATE_LIMIT; i++) {
      const res = await genidLookup(req('AB12345', ip))
      expect(res.status).toBe(200)
    }
  })

  it('rejects with 429 once a single IP exceeds the limit within the window', async () => {
    const ip = '198.51.100.11'
    for (let i = 0; i < VERIFY_RATE_LIMIT; i++) {
      await genidLookup(req('AB12345', ip))
    }
    const res = await genidLookup(req('AB12345', ip))
    expect(res.status).toBe(429)
    expect(lookupGenid).toHaveBeenCalledTimes(VERIFY_RATE_LIMIT)
  })

  it('tracks separate IPs independently', async () => {
    const busyIp = '198.51.100.12'
    for (let i = 0; i < VERIFY_RATE_LIMIT; i++) {
      await genidLookup(req('AB12345', busyIp))
    }
    const blocked = await genidLookup(req('AB12345', busyIp))
    expect(blocked.status).toBe(429)

    const freshIp = '198.51.100.13'
    const allowed = await genidLookup(req('AB12345', freshIp))
    expect(allowed.status).toBe(200)
  })
})
