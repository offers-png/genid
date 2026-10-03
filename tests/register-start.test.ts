import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MAGIC_LINK_RATE_LIMIT, REGISTRATION_IP_RATE_LIMIT } from '@/lib/limits'

// POST /api/register/start (Sept 19 third fix) — the first step of
// registration now only reserves the registry row and sends a
// confirmation link; it never creates a Stripe verification session
// itself. That's what stops an attacker from ever reaching Stripe
// verification for an email they don't control — they'd need to read the
// confirmation email to get any further.

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('@/lib/genid', () => ({
  issueUniqueGenid: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  createMagicLinkToken: vi.fn(),
  countRecentMagicLinkRequestsForEmail: vi.fn(),
}))
vi.mock('@/lib/mailer', () => ({
  sendRegistrationConfirmationEmail: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { issueUniqueGenid } from '@/lib/genid'
import { createMagicLinkToken, countRecentMagicLinkRequestsForEmail } from '@/lib/auth'
import { sendRegistrationConfirmationEmail } from '@/lib/mailer'
import { POST as registerStart } from '@/app/api/register/start/route'

const EMAIL = 'new-creator@example.com'
const FULL_NAME = 'New Creator'
const CSRF_TOKEN = 'test-csrf-token-0123456789'

// Every test below exercises the route's own logic, not the CSRF check
// itself (that's covered separately below) — so this helper carries a
// valid double-submit pair (cookie + body field) by default. Tests that
// need to override csrfToken can still pass it in `body`.
function req(body: Record<string, unknown>, ip?: string) {
  return new NextRequest('http://localhost/api/register/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `genid_csrf=${CSRF_TOKEN}`,
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify({ csrfToken: CSRF_TOKEN, ...body }),
  })
}

// Mirrors the route's chain: .from('genid_registry').select(...).eq(...).single()
// for the existence check, then either .insert(...) for a new row or
// .update(...).eq(...).eq(...) to reset a duplicate unverified row.
function mockRegistryChain(existing: { genid_code: string; verified: boolean } | null, insertError: { code: string } | null = null) {
  const updateEq2 = vi.fn().mockResolvedValue({ error: null })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEq1 })
  const insertSpy = vi.fn().mockResolvedValue({ error: insertError })
  const singleSpy = vi.fn().mockResolvedValue({ data: existing })
  const selectEq = vi.fn().mockReturnValue({ single: singleSpy })
  const selectSpy = vi.fn().mockReturnValue({ eq: selectEq })

  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: selectSpy,
    insert: insertSpy,
    update: updateSpy,
  } as unknown as ReturnType<typeof supabaseAdmin.from>)

  return { selectSpy, insertSpy, updateSpy, updateEq1, updateEq2 }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(issueUniqueGenid).mockResolvedValue('NC12345')
  vi.mocked(createMagicLinkToken).mockResolvedValue('raw-confirmation-token')
  vi.mocked(countRecentMagicLinkRequestsForEmail).mockResolvedValue(0)
})

describe('POST /api/register/start', () => {
  it('rejects a request missing fullName or email', async () => {
    const res1 = await registerStart(req({ email: EMAIL }))
    expect(res1.status).toBe(400)
    const res2 = await registerStart(req({ fullName: FULL_NAME }))
    expect(res2.status).toBe(400)
  })

  it('rejects with 409 when the email already has a verified GENID', async () => {
    mockRegistryChain({ genid_code: 'AB12345', verified: true })
    const res = await registerStart(req({ fullName: FULL_NAME, email: EMAIL }))
    expect(res.status).toBe(409)
    expect(createMagicLinkToken).not.toHaveBeenCalled()
    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled()
  })

  it('creates a pending registry row for a new email and sends a confirmation link, never touching Stripe', async () => {
    mockRegistryChain(null)
    const res = await registerStart(req({ fullName: FULL_NAME, email: EMAIL }))
    expect(res.status).toBe(200)

    expect(issueUniqueGenid).toHaveBeenCalledWith(FULL_NAME)
    expect(createMagicLinkToken).toHaveBeenCalledWith(EMAIL)
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      EMAIL,
      expect.stringContaining('/api/auth/confirm-registration?token=raw-confirmation-token')
    )

    const body = await res.json()
    expect(body.message).toMatch(/check your email/i)
  })

  it('resets an existing unverified row to pending on a duplicate registration attempt', async () => {
    const { insertSpy, updateEq1, updateEq2 } = mockRegistryChain(null, { code: '23505' })
    const res = await registerStart(req({ fullName: FULL_NAME, email: EMAIL }))
    expect(res.status).toBe(200)
    expect(insertSpy).toHaveBeenCalled()
    expect(updateEq1).toHaveBeenCalledWith('email', EMAIL)
    expect(updateEq2).toHaveBeenCalledWith('verified', false)
  })

  it('silently skips sending once the confirmation-email rate limit is hit, without creating a Stripe session', async () => {
    mockRegistryChain(null)
    vi.mocked(countRecentMagicLinkRequestsForEmail).mockResolvedValue(MAGIC_LINK_RATE_LIMIT)

    const res = await registerStart(req({ fullName: FULL_NAME, email: EMAIL }))
    expect(res.status).toBe(429)
    expect(createMagicLinkToken).not.toHaveBeenCalled()
    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled()
  })

  // Sept 30 fix: the per-email limit above doesn't stop one IP driving that
  // same budget across many different addresses. This uses the real
  // checkInMemoryRateLimit/getClientIp (not mocked in this file) with a
  // dedicated IP so it can't be affected by, or affect, the other tests'
  // shared default ('unknown') bucket.
  it('rejects with 429 once one IP exceeds the registration attempt limit, regardless of email', async () => {
    const ip = '203.0.113.50'
    mockRegistryChain(null)

    for (let i = 0; i < REGISTRATION_IP_RATE_LIMIT; i++) {
      const res = await registerStart(req({ fullName: FULL_NAME, email: `attempt-${i}@example.com` }, ip))
      expect(res.status).toBe(200)
    }

    const blocked = await registerStart(req({ fullName: FULL_NAME, email: 'one-more@example.com' }, ip))
    expect(blocked.status).toBe(429)
  })

  it('rejects with 403 when the CSRF token is missing or does not match the cookie', async () => {
    mockRegistryChain(null)

    const noToken = await registerStart(req({ fullName: FULL_NAME, email: EMAIL, csrfToken: undefined }))
    expect(noToken.status).toBe(403)

    const wrongToken = await registerStart(req({ fullName: FULL_NAME, email: EMAIL, csrfToken: 'not-the-cookie-value' }))
    expect(wrongToken.status).toBe(403)

    expect(createMagicLinkToken).not.toHaveBeenCalled()
  })
})
