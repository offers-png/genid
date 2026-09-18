import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MAGIC_LINK_RATE_LIMIT } from '@/lib/limits'

vi.mock('@/lib/supabase', () => ({
  lookupByEmail: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  createMagicLinkToken: vi.fn(),
  countRecentMagicLinkRequestsForEmail: vi.fn(),
}))
vi.mock('@/lib/mailer', () => ({
  sendMagicLinkEmail: vi.fn(),
}))

import { lookupByEmail } from '@/lib/supabase'
import { createMagicLinkToken, countRecentMagicLinkRequestsForEmail } from '@/lib/auth'
import { sendMagicLinkEmail } from '@/lib/mailer'
import { POST } from '@/app/api/auth/request-link/route'

const EMAIL = 'user@example.com'

function req(email: unknown) {
  return new NextRequest('http://localhost/api/auth/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookupByEmail).mockResolvedValue({
    id: '1',
    genid_code: 'AB12345',
    user_name: 'User',
    email: EMAIL,
    stripe_verification_id: null,
    verified: true,
    name_verified: true,
    created_at: new Date().toISOString(),
  })
  vi.mocked(createMagicLinkToken).mockResolvedValue('raw-token')
})

describe('POST /api/auth/request-link — rate limiting', () => {
  it('sends a link when under the rate limit', async () => {
    vi.mocked(countRecentMagicLinkRequestsForEmail).mockResolvedValue(0)

    const res = await POST(req(EMAIL))
    expect(res.status).toBe(200)
    expect(sendMagicLinkEmail).toHaveBeenCalledWith(EMAIL, expect.stringContaining('raw-token'))
  })

  it('silently skips sending once the rate limit is hit, without changing the response', async () => {
    vi.mocked(countRecentMagicLinkRequestsForEmail).mockResolvedValue(MAGIC_LINK_RATE_LIMIT)

    const res = await POST(req(EMAIL))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.message).toMatch(/if an account exists/i)
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    expect(createMagicLinkToken).not.toHaveBeenCalled()
  })

  it('returns the identical response for an unregistered email as for a rate-limited one (no enumeration side channel)', async () => {
    vi.mocked(lookupByEmail).mockResolvedValue(null)

    const unregisteredRes = await POST(req('nobody@example.com'))
    const unregisteredBody = await unregisteredRes.json()

    vi.mocked(lookupByEmail).mockResolvedValue({
      id: '1',
      genid_code: 'AB12345',
      user_name: 'User',
      email: EMAIL,
      stripe_verification_id: null,
      verified: true,
      name_verified: true,
      created_at: new Date().toISOString(),
    })
    vi.mocked(countRecentMagicLinkRequestsForEmail).mockResolvedValue(MAGIC_LINK_RATE_LIMIT)
    const rateLimitedRes = await POST(req(EMAIL))
    const rateLimitedBody = await rateLimitedRes.json()

    expect(unregisteredRes.status).toBe(rateLimitedRes.status)
    expect(unregisteredBody).toEqual(rateLimitedBody)
  })

  it('sends again once a later request falls back under the limit (window has moved on)', async () => {
    vi.mocked(countRecentMagicLinkRequestsForEmail).mockResolvedValue(MAGIC_LINK_RATE_LIMIT - 1)

    const res = await POST(req(EMAIL))
    expect(res.status).toBe(200)
    expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
  })
})
