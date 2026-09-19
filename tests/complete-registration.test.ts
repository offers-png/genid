import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { REGISTRATION_TOKEN_COOKIE_NAME } from '@/lib/auth'

// POST /api/auth/complete-registration signs a caller in immediately once
// their Stripe Identity verification completes, using a short-lived,
// single-use registration token delivered as an httpOnly cookie by
// POST /api/stripe/session, bound to the EXACT Stripe verification session
// it was issued alongside (Sept 19 second fix). The first fix (single-use,
// short-lived, browser-bound via cookie) wasn't sufficient on its own:
// POST /api/stripe/session doesn't reject a second registration attempt
// for an email that's merely pending, only a fully-verified one — so an
// attacker could start their OWN registration using a victim's email while
// the victim's real verification is in progress, get their own genuinely
// valid token, and redeem it once the VICTIM finishes verifying, since
// genid_registry.verified is a plain per-email flag with no record of
// which session set it. Requiring the token's own recorded session id to
// match genid_registry.stripe_verification_id (written by the webhook
// only on that exact session's verified event) closes that. Real
// single-use/expiry/session-scoping semantics against actual Postgres are
// covered separately in
// tests/integration/registration-token.integration.test.ts — this file
// covers the ROUTE's decision given what consumeRegistrationToken reports.

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
import { consumeRegistrationToken, type RegistrationTokenClaim } from '@/lib/auth'
import * as authModule from '@/lib/auth'
import * as mailerModule from '@/lib/mailer'
import { POST as completeRegistration } from '@/app/api/auth/complete-registration/route'

const EMAIL = 'victim@example.com'
const GENID_CODE = 'NC12345'
const VICTIM_TOKEN = 'victim-raw-registration-token'
const VICTIM_SESSION_ID = 'vs_victim_real_verification'
const ATTACKER_TOKEN = 'attacker-raw-registration-token'
const ATTACKER_SESSION_ID = 'vs_attacker_own_session_never_verified'

function reqWithCookie(cookieValue?: string) {
  return new NextRequest('http://localhost/api/auth/complete-registration', {
    method: 'POST',
    headers: cookieValue ? { Cookie: `${REGISTRATION_TOKEN_COOKIE_NAME}=${cookieValue}` } : {},
  })
}

function claim(overrides: Partial<RegistrationTokenClaim> = {}): RegistrationTokenClaim {
  return { email: EMAIL, stripeVerificationSessionId: VICTIM_SESSION_ID, ...overrides }
}

// The registry as it looks once the VICTIM's real verification completes —
// stripe_verification_id is whichever session Stripe actually confirmed.
function verifiedRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    genid_code: GENID_CODE,
    user_name: 'Victim Creator',
    email: EMAIL,
    stripe_verification_id: VICTIM_SESSION_ID,
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
    const res = await completeRegistration(reqWithCookie(VICTIM_TOKEN))
    expect(res.status).toBe(401)
    expect(consumeRegistrationToken).toHaveBeenCalledWith(VICTIM_TOKEN)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('rejects when the redeemed email has no verified registry record', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(claim())
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord({ verified: false }))
    const res = await completeRegistration(reqWithCookie(VICTIM_TOKEN))
    expect(res.status).toBe(403)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('rejects when the token has no recorded Stripe session id at all', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(claim({ stripeVerificationSessionId: null }))
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())
    const res = await completeRegistration(reqWithCookie(VICTIM_TOKEN))
    expect(res.status).toBe(403)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it("rejects when the token's own Stripe session doesn't match the session that actually got verified", async () => {
    // The email IS verified — just not by way of the session this
    // particular token was issued alongside.
    vi.mocked(consumeRegistrationToken).mockResolvedValue(claim({ stripeVerificationSessionId: ATTACKER_SESSION_ID }))
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord({ stripe_verification_id: VICTIM_SESSION_ID }))
    const res = await completeRegistration(reqWithCookie(ATTACKER_TOKEN))
    expect(res.status).toBe(403)
    expect(res.cookies.get('genid_session')).toBeUndefined()
  })

  it('issues a signed session cookie and clears the registration-token cookie when the session matches', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(claim())
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    const res = await completeRegistration(reqWithCookie(VICTIM_TOKEN))
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

// The exact scenario reported: an attacker starts their own registration
// using the victim's email while the victim's real verification is still
// pending, gets their own valid (single-use, unexpired, correctly-cookied)
// token — and must still be unable to sign in once the victim's real
// verification completes.
describe('Two browsers registering the same email', () => {
  it("rejects the attacker's own token even after the victim's verification completes, and still lets the victim in", async () => {
    // Both tokens are individually valid, unexpired, and correctly
    // delivered to their own browser — that part of the Sept 19 fix holds.
    // Each just carries a different Stripe session id, recorded at the
    // moment each browser started its own registration attempt.
    const attackerClaim = claim({ stripeVerificationSessionId: ATTACKER_SESSION_ID })
    const victimClaim = claim({ stripeVerificationSessionId: VICTIM_SESSION_ID })

    // The victim finishes real ID verification; the webhook writes
    // stripe_verification_id = the VICTIM's session, never the attacker's.
    const registryAfterVictimVerifies = verifiedRecord({ stripe_verification_id: VICTIM_SESSION_ID })
    vi.mocked(lookupByEmail).mockResolvedValue(registryAfterVictimVerifies)

    // Attacker's browser tries to redeem its own, perfectly valid token —
    // must fail, since their session was never the one that got verified.
    vi.mocked(consumeRegistrationToken).mockResolvedValueOnce(attackerClaim)
    const attackerRes = await completeRegistration(reqWithCookie(ATTACKER_TOKEN))
    expect(attackerRes.status).toBe(403)
    expect(attackerRes.cookies.get('genid_session')).toBeUndefined()

    // The legitimate victim, redeeming their own token afterward, still
    // succeeds — this isn't a blanket lockout, only the mismatched session
    // is rejected.
    vi.mocked(consumeRegistrationToken).mockResolvedValueOnce(victimClaim)
    const victimRes = await completeRegistration(reqWithCookie(VICTIM_TOKEN))
    expect(victimRes.status).toBe(200)
    expect(victimRes.cookies.get('genid_session')).toBeDefined()
  })
})

describe('End-to-end: register -> Stripe verification -> /dashboard, no email step', () => {
  it('signs the caller in via the session cookie without ever touching magic-link email delivery', async () => {
    vi.mocked(consumeRegistrationToken).mockResolvedValue(claim())
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    const completeRes = await completeRegistration(reqWithCookie(VICTIM_TOKEN))
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
    vi.mocked(consumeRegistrationToken).mockResolvedValue(claim())
    vi.mocked(lookupByEmail).mockResolvedValue(verifiedRecord())

    const createMagicLinkSpy = vi.spyOn(authModule, 'createMagicLinkToken')
    const sendMagicLinkSpy = vi.spyOn(mailerModule, 'sendMagicLinkEmail')

    const res = await completeRegistration(reqWithCookie(VICTIM_TOKEN))
    expect(res.status).toBe(200)

    expect(createMagicLinkSpy).not.toHaveBeenCalled()
    expect(sendMagicLinkSpy).not.toHaveBeenCalled()
  })
})
