import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, randomId } from './db-setup'

// Real Postgres (via PGlite), exercising the EXACT SQL shape
// lib/supabase.ts's tryBeginFinalizing/tryReclaimStaleFinalizing/
// abortFinalizing/finalizeSession use, against a real schema with the real
// status check constraint — not a mock asserting a function was "called
// with" the right arguments. See db-setup.ts for what this can and can't
// prove about true concurrency.

let db: PGlite
let sessionId: string

beforeEach(async () => {
  db = await createTestDb()
  sessionId = randomId()
  await db.query(`insert into genid_sessions (id, genid_code, status) values ($1, $2, 'active')`, [
    sessionId,
    'AB12345',
  ])
})

afterEach(async () => {
  await db.close()
})

async function tryBeginFinalizing(id: string): Promise<{ acquired: boolean; token: string | null }> {
  const token = randomId()
  const res = await db.query(
    `update genid_sessions set status = 'finalizing', finalizing_since = now(), finalizing_lock_token = $2
     where id = $1 and status = 'active' returning id`,
    [id, token]
  )
  return res.rows.length > 0 ? { acquired: true, token } : { acquired: false, token: null }
}

async function abortFinalizing(id: string, token: string): Promise<number> {
  const res = await db.query(
    `update genid_sessions set status = 'active', finalizing_since = null, finalizing_lock_token = null
     where id = $1 and status = 'finalizing' and finalizing_lock_token = $2 returning id`,
    [id, token]
  )
  return res.rows.length
}

async function finalizeSession(id: string, token: string): Promise<number> {
  const res = await db.query(
    `update genid_sessions set status = 'finalized', finalizing_lock_token = null
     where id = $1 and status = 'finalizing' and finalizing_lock_token = $2 returning id`,
    [id, token]
  )
  return res.rows.length
}

async function tryReclaimStale(id: string, staleAfterMs: number): Promise<{ acquired: boolean; token: string | null }> {
  const token = randomId()
  const res = await db.query(
    `update genid_sessions set finalizing_since = now(), finalizing_lock_token = $2
     where id = $1 and status = 'finalizing' and finalizing_since < now() - ($3 || ' milliseconds')::interval
     returning id`,
    [id, token, staleAfterMs]
  )
  return res.rows.length > 0 ? { acquired: true, token } : { acquired: false, token: null }
}

async function getStatus(id: string): Promise<{ status: string; token: string | null }> {
  const res = await db.query<{ status: string; finalizing_lock_token: string | null }>(
    `select status, finalizing_lock_token from genid_sessions where id = $1`,
    [id]
  )
  return { status: res.rows[0].status, token: res.rows[0].finalizing_lock_token }
}

describe('finalize lock — real Postgres atomic claim', () => {
  it('only the first of two identical claim attempts succeeds', async () => {
    const first = await tryBeginFinalizing(sessionId)
    const second = await tryBeginFinalizing(sessionId)

    expect(first.acquired).toBe(true)
    expect(second.acquired).toBe(false)
    expect(second.token).toBeNull()

    const state = await getStatus(sessionId)
    expect(state.status).toBe('finalizing')
    expect(state.token).toBe(first.token)
  })

  it('rejects an abort/finalize call carrying a superseded token (lock ownership)', async () => {
    const original = await tryBeginFinalizing(sessionId)
    expect(original.acquired).toBe(true)

    // Simulate a stale reclaim handing the lock to a second request.
    const reclaimed = await tryReclaimStale(sessionId, 0)
    expect(reclaimed.acquired).toBe(true)
    expect(reclaimed.token).not.toBe(original.token)

    // The ORIGINAL request, unaware it was superseded, tries to release
    // and then tries to commit — both must be no-ops against the new
    // holder's lock.
    const abortedRows = await abortFinalizing(sessionId, original.token!)
    expect(abortedRows).toBe(0)

    const finalizedRows = await finalizeSession(sessionId, original.token!)
    expect(finalizedRows).toBe(0)

    // The new holder's own commit must still work.
    const newHolderCommit = await finalizeSession(sessionId, reclaimed.token!)
    expect(newHolderCommit).toBe(1)

    const state = await getStatus(sessionId)
    expect(state.status).toBe('finalized')
  })

  it('cannot reclaim a lock that has not gone stale yet', async () => {
    await tryBeginFinalizing(sessionId)
    const reclaimed = await tryReclaimStale(sessionId, 10 * 60 * 1000) // 10 minutes
    expect(reclaimed.acquired).toBe(false)
  })

  it('abortFinalizing with the correct token successfully releases the lock', async () => {
    const claim = await tryBeginFinalizing(sessionId)
    const rows = await abortFinalizing(sessionId, claim.token!)
    expect(rows).toBe(1)

    const state = await getStatus(sessionId)
    expect(state.status).toBe('active')
    expect(state.token).toBeNull()
  })

  it('the status check constraint rejects an invalid status value', async () => {
    await expect(
      db.query(`update genid_sessions set status = 'not_a_real_status' where id = $1`, [sessionId])
    ).rejects.toThrow()
  })
})
