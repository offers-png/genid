import { describe, it, expect, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { VERIFY_RATE_LIMIT } from '@/lib/limits'

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = 'test-genid-signing-secret'
})

vi.mock('@/lib/steganography', () => ({
  extractGenid: vi.fn().mockResolvedValue(null),
  hashBuffer: vi.fn().mockReturnValue('some-hash'),
  verifyNotarySignature: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  lookupGenid: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
}))
// Real checkInMemoryRateLimit/getClientIp — this suite is specifically
// about the rate-limiting behavior, unlike verify-content-binding.test.ts
// which stubs it out. Upload validation is stubbed since these fake bytes
// aren't a real decodable image.
vi.mock('@/lib/limits', async () => {
  const actual = await vi.importActual<typeof import('@/lib/limits')>('@/lib/limits')
  return {
    ...actual,
    validateUploadSize: vi.fn(),
    validateImageDimensions: vi.fn(),
  }
})

import { POST } from '@/app/api/verify/route'

function callVerify(ip: string) {
  const formData = new FormData()
  formData.append('image', new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' }))
  const req = new NextRequest('http://localhost/api/verify', {
    method: 'POST',
    body: formData,
    headers: { 'x-forwarded-for': ip },
  })
  return POST(req)
}

describe('POST /api/verify — rate limiting', () => {
  it('allows requests from a fresh IP up to the limit', async () => {
    const ip = '10.0.0.1'
    for (let i = 0; i < VERIFY_RATE_LIMIT; i++) {
      const res = await callVerify(ip)
      expect(res.status).toBe(200)
    }
  })

  it('rejects with 429 once a single IP exceeds the limit within the window', async () => {
    const ip = '10.0.0.2'
    for (let i = 0; i < VERIFY_RATE_LIMIT; i++) {
      await callVerify(ip)
    }
    const res = await callVerify(ip)
    expect(res.status).toBe(429)
  })

  it('tracks separate IPs independently', async () => {
    const busyIp = '10.0.0.3'
    for (let i = 0; i < VERIFY_RATE_LIMIT; i++) {
      await callVerify(busyIp)
    }
    const blocked = await callVerify(busyIp)
    expect(blocked.status).toBe(429)

    const freshIp = '10.0.0.4'
    const allowed = await callVerify(freshIp)
    expect(allowed.status).toBe(200)
  })
})
