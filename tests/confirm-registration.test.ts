import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME } from '@/lib/auth'

// GET /api/auth/confirm-registration (Sept 19 third fix) — consuming this
// link is what proves the registrant controls their email BEFORE Stripe
// Identity verification is ever allowed to start. It records that proof
// durably (email_confirmed_at) and mints the short-lived token
// POST /api/stripe/session requires, delivered as an httpOnly cookie
// rather than a URL param.

vi.mock('@/lib/supabase', () => ({
  lookupByEmail: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('@/lib/auth', () => ({
  consumeMagicLinkToken: vi.fn(),
  createMagicLinkToken: vi.fn(),
  EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME: 'genid_email_confirmation_token',
  MAGIC_LINK_TTL_SECONDS: 60 * 15,
}))

import { lookupByEmail, supabaseAdmin } from '@/lib/supabase'
import { consumeMagicLinkToken, createMagicLinkToken } from '@/lib/auth'
import { GET as confirmRegistration } from '@/app/api/auth/confirm-registration/route'

const EMAIL = 'new-creator@example.com'
const RAW_TOKEN = 'raw-confirmation-token'

function req(token?: string) {
  const url = token
    ? `http://localhost/api/auth/confirm-registration?token=${encodeURIComponent(token)}`
    : 'http://localhost/api/auth/confirm-registration'
  return new NextRequest(url)
}

function mockConfirmUpdate(error: { message: string } | null = null) {
  const updateEq2 = vi.fn().mockResolvedValue({ error })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEq1 })
  vi.mocked(supabaseAdmin.from).mockReturnValue({ update: updateSpy } as unknown as ReturnType<typeof supabaseAdmin.from>)
  return { updateSpy, updateEq1, updateEq2 }
}

function unverifiedRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    genid_code: 'NC12345',
    user_name: 'New Creator',
    email: EMAIL,
    stripe_verification_id: null,
    verified: false,
    name_verified: false,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/auth/confirm-registration', () => {
  it('redirects with missing_token when no token is present', async () => {
    const res = await confirmRegistration(req(undefined))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/register?error=missing_token')
    expect(consumeMagicLinkToken).not.toHaveBeenCalled()
  })

  it('redirects with invalid_or_expired when the token cannot be consumed', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(null)
    const res = await confirmRegistration(req(RAW_TOKEN))
    expect(res.headers.get('location')).toContain('/register?error=invalid_or_expired')
  })

  it('redirects with account_not_found when the token redeems an email with no registry row', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(null)
    const res = await confirmRegistration(req(RAW_TOKEN))
    expect(res.headers.get('location')).toContain('/register?error=account_not_found')
  })

  it('redirects straight to /register/callback when the email is already verified (idempotent)', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(unverifiedRecord({ verified: true }))
    const res = await confirmRegistration(req(RAW_TOKEN))
    expect(res.headers.get('location')).toContain(`/register/callback?email=${encodeURIComponent(EMAIL)}`)
    expect(createMagicLinkToken).not.toHaveBeenCalled()
  })

  it('records email_confirmed_at, mints a confirmation-proof token, sets it as an httpOnly cookie, and redirects to /register/verify-identity', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(unverifiedRecord())
    vi.mocked(createMagicLinkToken).mockResolvedValue('confirmation-proof-token')
    const { updateSpy, updateEq1, updateEq2 } = mockConfirmUpdate()

    const res = await confirmRegistration(req(RAW_TOKEN))

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ email_confirmed_at: expect.any(String) }))
    expect(updateEq1).toHaveBeenCalledWith('email', EMAIL)
    expect(updateEq2).toHaveBeenCalledWith('verified', false)

    expect(createMagicLinkToken).toHaveBeenCalledWith(EMAIL)

    const cookie = res.cookies.get(EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME)
    expect(cookie?.value).toBe('confirmation-proof-token')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')

    expect(res.headers.get('location')).toContain('/register/verify-identity')
    // Never in the URL — same reasoning as the registration token cookie.
    expect(res.headers.get('location')).not.toContain('confirmation-proof-token')
  })

  it('redirects with server_error and does not mint a proof token if recording the confirmation fails', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(unverifiedRecord())
    mockConfirmUpdate({ message: 'db unavailable' })

    const res = await confirmRegistration(req(RAW_TOKEN))
    expect(res.headers.get('location')).toContain('/register?error=server_error')
    expect(createMagicLinkToken).not.toHaveBeenCalled()
  })
})
