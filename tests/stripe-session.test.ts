import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME, REGISTRATION_TOKEN_COOKIE_NAME } from '@/lib/auth'

// POST /api/stripe/session (Sept 19 third fix) — no longer takes a
// client-supplied email at all. It only ever creates a Stripe verification
// session for the email a confirmation-proof cookie redeems to — the
// cookie GET /api/auth/confirm-registration sets right after the
// registrant proved control of that inbox. A caller with no such cookie
// (or an expired/reused one) can't reach Stripe verification for any
// email, confirmed or not.

vi.mock('@/lib/stripe', () => ({
  createIdentityVerificationSession: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  lookupByEmail: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  consumeMagicLinkToken: vi.fn(),
  createRegistrationToken: vi.fn(),
  EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME: 'genid_email_confirmation_token',
  REGISTRATION_TOKEN_COOKIE_NAME: 'genid_registration_token',
}))

import { createIdentityVerificationSession } from '@/lib/stripe'
import { lookupByEmail } from '@/lib/supabase'
import { consumeMagicLinkToken, createRegistrationToken } from '@/lib/auth'
import { POST as stripeSession } from '@/app/api/stripe/session/route'

const EMAIL = 'new-creator@example.com'
const CONFIRMATION_TOKEN = 'confirmation-proof-token'
const STRIPE_SESSION_ID = 'vs_new_session'
const STRIPE_URL = 'https://verify.stripe.com/start/test'

function reqWithCookie(cookieValue?: string) {
  return new NextRequest('http://localhost/api/stripe/session', {
    method: 'POST',
    headers: cookieValue ? { Cookie: `${EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME}=${cookieValue}` } : {},
  })
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
  vi.mocked(createIdentityVerificationSession).mockResolvedValue({ sessionId: STRIPE_SESSION_ID, url: STRIPE_URL })
  vi.mocked(createRegistrationToken).mockResolvedValue('raw-registration-token')
})

describe('POST /api/stripe/session', () => {
  it('rejects a request with no confirmation cookie at all', async () => {
    const res = await stripeSession(reqWithCookie(undefined))
    expect(res.status).toBe(401)
    expect(consumeMagicLinkToken).not.toHaveBeenCalled()
    expect(createIdentityVerificationSession).not.toHaveBeenCalled()
  })

  it('rejects when the confirmation token cannot be redeemed (expired or already used)', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(null)
    const res = await stripeSession(reqWithCookie(CONFIRMATION_TOKEN))
    expect(res.status).toBe(401)
    expect(createIdentityVerificationSession).not.toHaveBeenCalled()
  })

  it('rejects when the redeemed email has no registry row or is already verified', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(unverifiedRecord({ verified: true }))
    const res = await stripeSession(reqWithCookie(CONFIRMATION_TOKEN))
    expect(res.status).toBe(403)
    expect(createIdentityVerificationSession).not.toHaveBeenCalled()
  })

  it('creates the Stripe session for the confirmed email, binds the registration token to it, and clears the confirmation cookie', async () => {
    vi.mocked(consumeMagicLinkToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(unverifiedRecord())

    const res = await stripeSession(reqWithCookie(CONFIRMATION_TOKEN))
    expect(res.status).toBe(200)

    expect(createIdentityVerificationSession).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL })
    )
    expect(createRegistrationToken).toHaveBeenCalledWith(EMAIL, STRIPE_SESSION_ID)

    const registrationCookie = res.cookies.get(REGISTRATION_TOKEN_COOKIE_NAME)
    expect(registrationCookie?.value).toBe('raw-registration-token')
    expect(registrationCookie?.httpOnly).toBe(true)

    const clearedConfirmationCookie = res.cookies.get(EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME)
    expect(clearedConfirmationCookie?.value).toBe('')

    const body = await res.json()
    expect(body.url).toBe(STRIPE_URL)
    // Never a client-suppliable email in the response — only Stripe's URL.
    expect(body.email).toBeUndefined()
  })
})
