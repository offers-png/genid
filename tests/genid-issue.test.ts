import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { REGISTRATION_TOKEN_COOKIE_NAME } from '@/lib/auth'

// GET /api/genid/issue (Sept 30 fix) — this used to take a bare,
// client-supplied `email` and return that registrant's genid_code,
// user_name, verified, and verification_status to anyone who asked: no
// cookie, no ownership check, no rate limit. Confirmed live against
// production — an unauthenticated request for a known email leaked that
// person's full name, GENID code, and verification status. Identity now
// comes entirely from the registration-token cookie; there is no email
// input to this route at all anymore.

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('@/lib/auth', () => ({
  peekRegistrationToken: vi.fn(),
  REGISTRATION_TOKEN_COOKIE_NAME: 'genid_registration_token',
}))

import { supabaseAdmin } from '@/lib/supabase'
import { peekRegistrationToken } from '@/lib/auth'
import { GET as genidIssue } from '@/app/api/genid/issue/route'

function reqWithCookie(cookieValue?: string) {
  return new NextRequest('http://localhost/api/genid/issue', {
    headers: cookieValue ? { Cookie: `${REGISTRATION_TOKEN_COOKIE_NAME}=${cookieValue}` } : {},
  })
}

// Mocks .from('genid_registry').select(...).eq('email', X).single() to
// return whatever row `registry[X]` holds — lets tests prove the route
// only ever returns the row for the email the TOKEN resolves to, never one
// supplied any other way (there's no other way supplied at all now).
function mockRegistryLookup(registry: Record<string, { genid_code: string; user_name: string; verified: boolean; verification_status: string; created_at: string }>) {
  const eqSpy = vi.fn((_col: string, email: string) => ({
    single: async () => {
      const row = registry[email]
      return { data: row ?? null, error: row ? null : { message: 'not found' } }
    },
  }))
  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: () => ({ eq: eqSpy }),
  } as unknown as ReturnType<typeof supabaseAdmin.from>)
  return { eqSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/genid/issue', () => {
  it('rejects a request with no registration-token cookie at all', async () => {
    const res = await genidIssue(reqWithCookie(undefined))
    expect(res.status).toBe(401)
    expect(peekRegistrationToken).not.toHaveBeenCalled()
  })

  it('rejects when the token cannot be resolved (expired, already used, or never issued)', async () => {
    vi.mocked(peekRegistrationToken).mockResolvedValue(null)
    const res = await genidIssue(reqWithCookie('some-token'))
    expect(res.status).toBe(401)
  })

  it('returns the registry status for the email the token resolves to', async () => {
    vi.mocked(peekRegistrationToken).mockResolvedValue({ email: 'owner@example.com', stripeVerificationSessionId: 'vs_123' })
    mockRegistryLookup({
      'owner@example.com': {
        genid_code: 'OW12345',
        user_name: 'Owner Name',
        verified: true,
        verification_status: 'verified',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    })

    const res = await genidIssue(reqWithCookie('owner-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.genid_code).toBe('OW12345')
    expect(body.user_name).toBe('Owner Name')
  })

  it('ignores a query-string email entirely — only the cookie-resolved identity is ever looked up (the exact vulnerability being fixed)', async () => {
    vi.mocked(peekRegistrationToken).mockResolvedValue({ email: 'attacker@example.com', stripeVerificationSessionId: 'vs_attacker' })
    const { eqSpy } = mockRegistryLookup({
      'victim@example.com': {
        genid_code: 'VC11111',
        user_name: 'Victim Real Name',
        verified: true,
        verification_status: 'verified',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      'attacker@example.com': {
        genid_code: 'AT99999',
        user_name: 'Attacker',
        verified: false,
        verification_status: 'pending',
        created_at: '2026-01-02T00:00:00.000Z',
      },
    })

    // The old vulnerable version read ?email= straight off the URL. The
    // route no longer parses this URL's search params at all — attaching
    // a victim's email here must have zero effect on which row comes back.
    const req = new NextRequest('http://localhost/api/genid/issue?email=victim@example.com', {
      headers: { Cookie: `${REGISTRATION_TOKEN_COOKIE_NAME}=attacker-own-token` },
    })
    const res = await genidIssue(req)

    expect(eqSpy).toHaveBeenCalledWith('email', 'attacker@example.com')
    expect(eqSpy).not.toHaveBeenCalledWith('email', 'victim@example.com')
    const body = await res.json()
    expect(body.user_name).toBe('Attacker')
  })

  it('returns 404 when the resolved email has no registry row', async () => {
    vi.mocked(peekRegistrationToken).mockResolvedValue({ email: 'ghost@example.com', stripeVerificationSessionId: null })
    mockRegistryLookup({})

    const res = await genidIssue(reqWithCookie('some-token'))
    expect(res.status).toBe(404)
  })
})
