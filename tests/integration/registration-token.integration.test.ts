import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import crypto from 'crypto'

// Real Postgres (via PGlite), exercising the EXACT SQL shape
// lib/auth.ts's createRegistrationToken/consumeRegistrationToken use
// against migrations 013/014's real schema — not a mock asserting a claim
// "would" be atomic, a token "would" expire, or a session id "would" stay
// scoped to its own token. This is what proves the properties the Sept 19
// fixes depend on: single-use, short-lived, bound to whichever holder
// presents the exact token value (never substitutable by email or any
// other guessable field), AND — the second fix — that each token's own
// recorded Stripe verification session id is what has to match, not just
// the email being verified by way of some other session.

let db: PGlite

interface TokenClaim {
  email: string
  stripeVerificationSessionId: string | null
}

async function createDb(): Promise<PGlite> {
  const instance = new PGlite()
  await instance.exec(`
    create table genid_registration_tokens (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      token_hash text not null unique,
      stripe_verification_session_id text,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz default now()
    );
  `)
  return instance
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Mirrors createRegistrationToken's insert exactly, minus the
// getAdmin()/supabase-js indirection.
async function insertToken(
  db: PGlite,
  email: string,
  token: string,
  stripeVerificationSessionId: string,
  expiresAt: Date
): Promise<void> {
  await db.query(
    `insert into genid_registration_tokens (email, token_hash, stripe_verification_session_id, expires_at)
     values ($1, $2, $3, $4)`,
    [email, hashToken(token), stripeVerificationSessionId, expiresAt.toISOString()]
  )
}

// Mirrors consumeRegistrationToken's atomic claim exactly: UPDATE ... WHERE
// used_at IS NULL AND expires_at > now() RETURNING email,
// stripe_verification_session_id. Uses Postgres's own now(), not a JS
// Date, so this is a real check against the engine's clock and comparison
// semantics — not a reimplementation of them.
async function consumeToken(db: PGlite, token: string): Promise<TokenClaim | null> {
  const res = await db.query<TokenClaim>(
    `update genid_registration_tokens set used_at = now()
     where token_hash = $1 and used_at is null and expires_at > now()
     returning email, stripe_verification_session_id as "stripeVerificationSessionId"`,
    [hashToken(token)]
  )
  return res.rows[0] ?? null
}

beforeEach(async () => {
  db = await createDb()
})

afterEach(async () => {
  await db.close()
})

describe('registration tokens — real Postgres atomic claim, expiry, and session scoping', () => {
  it('redeems a fresh, unexpired token and returns its email and session id', async () => {
    const token = randomToken()
    await insertToken(db, 'new-creator@example.com', token, 'vs_real_session', new Date(Date.now() + 30 * 60 * 1000))

    const result = await consumeToken(db, token)
    expect(result).toEqual({ email: 'new-creator@example.com', stripeVerificationSessionId: 'vs_real_session' })
  })

  it('rejects an expired token, even though it was never used', async () => {
    const token = randomToken()
    // Inserted already past its expiry — the exact shape of a registration
    // that stalled on Stripe's side longer than the token's TTL.
    await insertToken(db, 'slow-verifier@example.com', token, 'vs_slow', new Date(Date.now() - 60 * 1000))

    const result = await consumeToken(db, token)
    expect(result).toBeNull()

    // And used_at must still be untouched — an expired claim attempt isn't
    // itself a "use" that could burn a token someone else might still (if
    // the clock were different) redeem.
    const row = await db.query<{ used_at: string | null }>(
      `select used_at from genid_registration_tokens where token_hash = $1`,
      [hashToken(token)]
    )
    expect(row.rows[0].used_at).toBeNull()
  })

  it('rejects a reused token — the second redemption of an already-consumed token fails', async () => {
    const token = randomToken()
    await insertToken(db, 'creator@example.com', token, 'vs_creator', new Date(Date.now() + 30 * 60 * 1000))

    const first = await consumeToken(db, token)
    const second = await consumeToken(db, token)

    expect(first).toEqual({ email: 'creator@example.com', stripeVerificationSessionId: 'vs_creator' })
    expect(second).toBeNull()
  })

  it('rejects a token from a different browser/registration — a valid-looking but wrong token value never matches someone else\'s row', async () => {
    const browserAToken = randomToken()
    const browserBToken = randomToken()
    await insertToken(db, 'victim@example.com', browserAToken, 'vs_browser_a', new Date(Date.now() + 30 * 60 * 1000))
    await insertToken(db, 'victim@example.com', browserBToken, 'vs_browser_b', new Date(Date.now() + 30 * 60 * 1000))

    // An attacker (or a second tab) presenting ITS OWN token can only ever
    // redeem its own row — never the other browser's, even for the exact
    // same email. Binding is by the specific secret token value, not email.
    const resultForB = await consumeToken(db, browserBToken)
    expect(resultForB).toEqual({ email: 'victim@example.com', stripeVerificationSessionId: 'vs_browser_b' })

    // Browser A's token is still completely untouched by B's redemption,
    // and still reports ITS OWN session id, not browser B's.
    const resultForA = await consumeToken(db, browserAToken)
    expect(resultForA).toEqual({ email: 'victim@example.com', stripeVerificationSessionId: 'vs_browser_a' })
  })

  it('rejects a value that was never issued at all — a guess gets nothing to claim', async () => {
    await insertToken(db, 'creator@example.com', randomToken(), 'vs_creator', new Date(Date.now() + 30 * 60 * 1000))

    const guessed = await consumeToken(db, randomToken())
    expect(guessed).toBeNull()
  })

  // The exact scenario reported (Sept 19 second fix): two different
  // registration attempts for the SAME email — an attacker starting their
  // own registration while a victim's real one is still pending — must
  // still produce two tokens whose recorded session ids are each scoped to
  // their OWN attempt, never conflated because they share an email.
  it("two tokens for the same email (two browsers) each report their OWN session id, never each other's", async () => {
    const victimToken = randomToken()
    const attackerToken = randomToken()
    await insertToken(db, 'victim@example.com', victimToken, 'vs_victim_real_verification', new Date(Date.now() + 30 * 60 * 1000))
    await insertToken(db, 'victim@example.com', attackerToken, 'vs_attacker_own_session', new Date(Date.now() + 30 * 60 * 1000))

    const attackerClaim = await consumeToken(db, attackerToken)
    const victimClaim = await consumeToken(db, victimToken)

    expect(attackerClaim?.stripeVerificationSessionId).toBe('vs_attacker_own_session')
    expect(victimClaim?.stripeVerificationSessionId).toBe('vs_victim_real_verification')

    // The application-level check this enables: only a claim whose session
    // id equals whatever genid_registry.stripe_verification_id actually
    // got set to (here, the victim's real session) should be honored.
    const actuallyVerifiedSessionId = 'vs_victim_real_verification'
    expect(attackerClaim?.stripeVerificationSessionId).not.toBe(actuallyVerifiedSessionId)
    expect(victimClaim?.stripeVerificationSessionId).toBe(actuallyVerifiedSessionId)
  })
})
