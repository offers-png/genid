import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { REGISTRATION_TOKEN_COOKIE_NAME } from '@/lib/auth'

// POST /api/auth/complete-registration signs a caller in immediately once
// their Stripe Identity verification completes, using the short-lived,
// single-use registration token delivered as an httpOnly cookie by
// POST /api/stripe/session (Sept 19 fix — the original version compared a
// client-supplied Stripe verification session id against the durable
// genid_registry.stripe_verification_id column, which never changes once
// set and so could be replayed indefinitely by anyone who ever learned it,
// from any browser). Real single-use/expiry semantics against actual
// Postgres are covered separately in
// tests/integration/registration-token.integration.test.ts — this file
// covers the ROUTE's behavior given what consumeRegistrationToken reports.

beforeAll(() => {
  process.env.AUTH_SESSION_SECRET = 'test-auth-session-secret-do-not-use-in-prod'
})

vi.mock('@/lib/supabase', () => ({
  lookupByEmail: vi.fn(),
}))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    consumeRegistrationToken: vi.fn(),
    createRegistrationToken: vi.fn(),
  }
})

import { lookupByEmail } from '@/lib/supabase'
import { consumeRegistrationToken } from '@/lib/auth'
import * as authModule from '@/lib/auth'
import * as mailerModule from '@/lib/mailer'
import { POST as completeRegistration } from '@/app/api/auth/complete-registration/route'

const EMAIL = 'new-creator@example.com'
const GENID_CODE = 'NC12345'
const RAW_TOKEN = 'a-raw-single-use-registration-token'

function reqWithCookie(cookieValue?: string) {
  return new NextRequest('http://localhost/api/auth/complete-registration', {
    method: 'POST',
    headers: cookieValue ? { Cookie: `${REGISTRATION_TOKEN_COOKIE_NAME}=${cookieValue}` } : {},
  })
}

function verifiedRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    genid_code: GENID_CODE,
    user_name: 'New Creator',
    email: EMAIL,
    stripe_verification_id: 'vs_irrelevant_now',
    verified: true,
    name_verified: true,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/complete-registration', () => {
  it('rejects a request with no registration-token cookie at all — a browser that never started registration here', async () => {
    const res = await completeRegistration(reqWithCookie(undefined))
    expect(res.status).toBe(401)
    expect(consumeRegistrationToken).not.toHaveBeenCalled()
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('rejects when the token cannot be redeemed (expired or already used — consumeRegistrationToken returns null)', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(null)
    const res = await completeRegistration(reqWithCookie(RAW_TOKEN))
    expect(res.status).toBe(401)
    expect(consumeRegistrationToken).toHaveBeenCalledWith(RAW_TOKEN)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('rejects when the redeemed email has no verified registry record', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord({ verified: false }))
    const res = await completeRegistration(reqWithCookie(RAW_TOKEN))
    expect(res.status).toBe(403)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('issues a signed session cookie and clears the registration-token cookie on success', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    const res = await completeRegistration(reqWithCookie(RAW_TOKEN))
    expect(res.status).toBe(200)

    const sessionCookie = res.cookies.get('genid_session')
    expect(sessionCookie).toBeDefined()
    expect(sessionCookie?.httpOnly).toBe(true)
    expect(sessionCookie?.sameSite).toBe('lax')
    expect(sessionCookie?.path).toBe('/')
    expect(sessionCookie?.maxAge).toBe(60 * 60 * 24 * 30)

    // Single-use already at the DB layer, but the browser shouldn't keep
    // holding a cookie for a token that's now spent either way.
    const clearedCookie = res.cookies.get(REGISTRATION_TOKEN_COOKIE_NAME)
    expect(clearedCookie?.value).toBe('')

    const body = await res.json()
    expect(body.genidCode).toBe(GENID_CODE)
  })
})

describe('End-to-end: register -> Stripe verification -> /dashboard, no email step', () => {
  it('signs the caller in via the session cookie without ever touching magic-link email delivery', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    const completeRes = await completeRegistration(reqWithCookie(RAW_TOKEN))
    expect(completeRes.status).toBe(200)
    const sessionCookie = completeRes.cookies.get('genid_session')
    expect(sessionCookie).toBeDefined()

    // The resulting cookie alone should now authenticate every
    // ownership-gated route, the same as a magic-link-issued cookie would.
    const { GET: meRoute } = await import('@/app/api/auth/me/route')
    const meRes = await meRoute(
      new NextRequest('http://localhost/api/auth/me', {
        headers: { Cookie: `genid_session=${sessionCookie!.value}` },
      })
    )
    expect(meRes.status).toBe(200)
    const meBody = await meRes.json()
    expect(meBody.genidCode).toBe(GENID_CODE)
    expect(meBody.email).toBe(EMAIL)
  })

  it('never calls magic-link token creation or email sending anywhere in this flow', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(EMAIL)
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    const createMagicLinkSpy = vi.spyOn(authModule, 'createMagicLinkToken')
    const sendMagicLinkSpy = vi.spyOn(mailerModule, 'sendMagicLinkEmail')

    const res = await completeRegistration(reqWithCookie(RAW_TOKEN))
    expect(res.status).toBe(200)

    expect(createMagicLinkSpy).not.toHaveBeenCalled()
    expect(sendMagicLinkSpy).not.toHaveBeenCalled()
  })
})
