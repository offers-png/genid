import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import crypto from 'crypto'

// Real Postgres (via PGlite), exercising the EXACT SQL shape
// lib/auth.ts's createRegistrationToken/consumeRegistrationToken use
// against migration 013's real schema — not a mock asserting a claim
// "would" be atomic or a token "would" expire. This is what proves the
// three properties the Sept 19 fix depends on: single-use, short-lived,
// and bound to whichever holder presents the exact token value (never
// substitutable by email or any other guessable field).

let db: PGlite

async function createDb(): Promise<PGlite> {
  const instance = new PGlite()
  await instance.exec(`
    create table genid_registration_tokens (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      token_hash text not null unique,
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
async function insertToken(db: PGlite, email: string, token: string, expiresAt: Date): Promise<void> {
  await db.query(`insert into genid_registration_tokens (email, token_hash, expires_at) values ($1, $2, $3)`, [
    email,
    hashToken(token),
    expiresAt.toISOString(),
  ])
}

// Mirrors consumeRegistrationToken's atomic claim exactly: UPDATE ... WHERE
// used_at IS NULL AND expires_at > now() RETURNING email. Uses Postgres's
// own now(), not a JS Date, so this is a real check against the engine's
// clock and comparison semantics — not a reimplementation of them.
async function consumeToken(db: PGlite, token: string): Promise<string | null> {
  const res = await db.query<{ email: string }>(
    `update genid_registration_tokens set used_at = now()
     where token_hash = $1 and used_at is null and expires_at > now()
     returning email`,
    [hashToken(token)]
  )
  return res.rows[0]?.email ?? null
}

beforeEach(async () => {
  db = await createDb()
})

afterEach(async () => {
  await db.close()
})

describe('registration tokens — real Postgres atomic claim and expiry', () => {
  it('redeems a fresh, unexpired token and returns its email', async () => {
    const token = randomToken()
    await insertToken(db, 'new-creator@example.com', token, new Date(Date.now() + 30 * 60 * 1000))

    const email = await consumeToken(db, token)
    expect(email).toBe('new-creator@example.com')
  })

  it('rejects an expired token, even though it was never used', async () => {
    const token = randomToken()
    // Inserted already past its expiry — the exact shape of a registration
    // that stalled on Stripe's side longer than the token's TTL.
    await insertToken(db, 'slow-verifier@example.com', token, new Date(Date.now() - 60 * 1000))

    const email = await consumeToken(db, token)
    expect(email).toBeNull()

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
    await insertToken(db, 'creator@example.com', token, new Date(Date.now() + 30 * 60 * 1000))

    const first = await consumeToken(db, token)
    const second = await consumeToken(db, token)

    expect(first).toBe('creator@example.com')
    expect(second).toBeNull()
  })

  it('rejects a token from a different browser/registration — a valid-looking but wrong token value never matches someone else\'s row', async () => {
    const browserAToken = randomToken()
    const browserBToken = randomToken()
    await insertToken(db, 'victim@example.com', browserAToken, new Date(Date.now() + 30 * 60 * 1000))
    await insertToken(db, 'victim@example.com', browserBToken, new Date(Date.now() + 30 * 60 * 1000))

    // An attacker (or a second tab) presenting ITS OWN token can only ever
    // redeem its own row — never the other browser's, even for the exact
    // same email. Binding is by the specific secret token value, not email.
    const resultForB = await consumeToken(db, browserBToken)
    expect(resultForB).toBe('victim@example.com')

    // Browser A's token is still completely untouched by B's redemption.
    const resultForA = await consumeToken(db, browserAToken)
    expect(resultForA).toBe('victim@example.com')
  })

  it('rejects a value that was never issued at all — a guess gets nothing to claim', async () => {
    await insertToken(db, 'creator@example.com', randomToken(), new Date(Date.now() + 30 * 60 * 1000))

    const guessed = await consumeToken(db, randomToken())
    expect(guessed).toBeNull()
  })
})
