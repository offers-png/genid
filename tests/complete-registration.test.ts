import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/auth/complete-registration signs a caller in immediately once
// their Stripe Identity verification completes, using the verification
// session id (vsid) stashed client-side before the Stripe redirect (see
// app/register/page.tsx and app/register/callback/page.tsx) — matched
// against genid_registry.stripe_verification_id, which the webhook writes
// in the same update that sets verified: true. This is what lets
// register -> verify -> land on /dashboard skip a magic-link email step
// entirely.

beforeAll(() => {
  process.env.AUTH_SESSION_SECRET = 'test-auth-session-secret-do-not-use-in-prod'
})

vi.mock('@/lib/supabase', () => ({
  lookupByEmail: vi.fn(),
}))

import { lookupByEmail } from '@/lib/supabase'
import { POST as completeRegistration } from '@/app/api/auth/complete-registration/route'

const EMAIL = 'new-creator@example.com'
const GENID_CODE = 'NC12345'
const VSID = 'vs_test_1234567890'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/auth/complete-registration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function verifiedRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    genid_code: GENID_CODE,
    user_name: 'New Creator',
    email: EMAIL,
    stripe_verification_id: VSID,
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
  it('rejects a request missing email or vsid', async () => {
    const res1 = await completeRegistration(req({ email: EMAIL }))
    expect(res1.status).toBe(400)
    const res2 = await completeRegistration(req({ vsid: VSID }))
    expect(res2.status).toBe(400)
  })

  it('rejects when no registry row exists for the email', async () => {
    vi.mocked(lookupByEmail).mockResolvedValue(null)
    const res = await completeRegistration(req({ email: EMAIL, vsid: VSID }))
    expect(res.status).toBe(403)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('rejects when the record is not yet verified, even with the right vsid', async () => {
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord({ verified: false }))
    const res = await completeRegistration(req({ email: EMAIL, vsid: VSID }))
    expect(res.status).toBe(403)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('rejects when vsid does not match stripe_verification_id (e.g. an attacker guessing the email)', async () => {
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())
    const res = await completeRegistration(req({ email: EMAIL, vsid: 'vs_wrong_guess' }))
    expect(res.status).toBe(403)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('issues a signed session cookie when verified and vsid matches stripe_verification_id', async () => {
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())
    const res = await completeRegistration(req({ email: EMAIL, vsid: VSID }))
    expect(res.status).toBe(200)

    const cookie = res.cookies.get('genid_session')
    expect(cookie).toBeDefined()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.path).toBe('/')
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30)

    const body = await res.json()
    expect(body.genidCode).toBe(GENID_CODE)
  })
})

describe('End-to-end: register -> Stripe verification -> /dashboard, no email step', () => {
  it('signs the caller in via the session cookie without ever touching magic-link email delivery', async () => {
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    // --- Complete registration using the vsid the browser stashed before
    // redirecting to Stripe (this is what /register/callback does once its
    // poll sees verified: true) ---
    const completeRes = await completeRegistration(req({ email: EMAIL, vsid: VSID }))
    expect(completeRes.status).toBe(200)
    const sessionCookie = completeRes.cookies.get('genid_session')
    expect(sessionCookie).toBeDefined()

    // --- The resulting cookie alone should now authenticate every
    // ownership-gated route, the same as a magic-link-issued cookie would
    // — proving /dashboard is reachable with zero additional email step ---
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
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    const authModule = await import('@/lib/auth')
    const mailerModule = await import('@/lib/mailer')
    const createMagicLinkSpy = vi.spyOn(authModule, 'createMagicLinkToken')
    const sendMagicLinkSpy = vi.spyOn(mailerModule, 'sendMagicLinkEmail')

    const res = await completeRegistration(req({ email: EMAIL, vsid: VSID }))
    expect(res.status).toBe(200)

    expect(createMagicLinkSpy).not.toHaveBeenCalled()
    expect(sendMagicLinkSpy).not.toHaveBeenCalled()
  })
})
