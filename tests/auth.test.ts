import { describe, it, expect, vi, beforeAll } from 'vitest'
import crypto from 'crypto'

const AUTH_SECRET = 'test-auth-session-secret-do-not-use-in-prod'

beforeAll(() => {
  process.env.AUTH_SESSION_SECRET = AUTH_SECRET
})

vi.mock('@/lib/supabase', () => ({
  lookupByEmail: vi.fn(),
  getAdmin: vi.fn(),
}))

import { lookupByEmail, getAdmin } from '@/lib/supabase'
import {
  createSessionToken,
  verifySessionToken,
  resolveSessionCookie,
  createMagicLinkToken,
  consumeMagicLinkToken,
} from '@/lib/auth'

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = createSessionToken('user@example.com', 'AB12345')
    const payload = verifySessionToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.email).toBe('user@example.com')
    expect(payload?.genidCode).toBe('AB12345')
  })

  it('rejects a token with a tampered payload', () => {
    const token = createSessionToken('user@example.com', 'AB12345')
    const [payload, signature] = token.split('.')
    // Swap in a different genid_code's payload — an attacker trying to
    // escalate to someone else's identity without knowing the secret.
    const forgedPayload = Buffer.from(JSON.stringify({
      email: 'user@example.com',
      genidCode: 'VICTIM99',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60,
    })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const forged = `${forgedPayload}.${signature}`
    expect(verifySessionToken(forged)).toBeNull()
    void payload
  })

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken('user@example.com', 'AB12345')
    const originalSecret = process.env.AUTH_SESSION_SECRET
    process.env.AUTH_SESSION_SECRET = 'a-completely-different-secret'
    try {
      expect(verifySessionToken(token)).toBeNull()
    } finally {
      process.env.AUTH_SESSION_SECRET = originalSecret
    }
  })

  it('rejects an expired token', () => {
    // Reach past the public API to construct an already-expired payload,
    // signed correctly — this is what a token looks like 30 days + 1s later.
    const expired = createSessionToken('user@example.com', 'AB12345')
    const [encodedPayload] = expired.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    payload.expiresAt = Date.now() - 1000
    const reencodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const signature = crypto.createHmac('sha256', AUTH_SECRET).update(reencodedPayload).digest('hex')
    expect(verifySessionToken(`${reencodedPayload}.${signature}`)).toBeNull()
  })

  it('rejects garbage input', () => {
    expect(verifySessionToken('not-a-valid-token')).toBeNull()
    expect(verifySessionToken('')).toBeNull()
  })
})

describe('resolveSessionCookie (ownership re-check against live registry)', () => {
  it('returns null when no cookie is present', async () => {
    expect(await resolveSessionCookie(undefined)).toBeNull()
  })

  it('returns null when the token is valid but the registry row no longer matches', async () => {
    const token = createSessionToken('user@example.com', 'AB12345')
    vi.mocked(lookupByEmail).mockResolvedValueOnce({
      id: '1',
      genid_code: 'DIFFERENT', // the email's genid_code changed since the token was issued
      user_name: 'User',
      email: 'user@example.com',
      stripe_verification_id: null,
      verified: true,
      created_at: new Date().toISOString(),
    })
    expect(await resolveSessionCookie(token)).toBeNull()
  })

  it('returns the record when the token matches the current registry row', async () => {
    const token = createSessionToken('user@example.com', 'AB12345')
    const record = {
      id: '1',
      genid_code: 'AB12345',
      user_name: 'User',
      email: 'user@example.com',
      stripe_verification_id: null,
      verified: true,
      created_at: new Date().toISOString(),
    }
    vi.mocked(lookupByEmail).mockResolvedValueOnce(record)
    expect(await resolveSessionCookie(token)).toEqual(record)
  })
})

describe('magic link tokens', () => {
  it('is single-use: the second consumption of the same token fails', async () => {
    let used = false
    const fakeAdmin = {
      from: () => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (used) return { data: null, error: null }
                    used = true
                    return { data: { email: 'user@example.com' }, error: null }
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    }
    vi.mocked(getAdmin).mockReturnValue(fakeAdmin as unknown as ReturnType<typeof getAdmin>)

    const token = await createMagicLinkToken('user@example.com')
    const first = await consumeMagicLinkToken(token)
    const second = await consumeMagicLinkToken(token)

    expect(first).toBe('user@example.com')
    expect(second).toBeNull()
  })
})
