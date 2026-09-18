import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, randomId } from './db-setup'

// Real Postgres execution of create_step_if_session_active (migration
// 010) — the function that closes the race where a slow generate/edit
// request could insert a step after finalize had already flipped the
// session to 'finalizing' and read the step list. This runs the actual
// plpgsql function body, not a JS re-implementation of what it's supposed
// to do — a bug in the real SQL (wrong column, wrong exception message,
// wrong lock target) would fail these tests; a hand-written mock of
// "insert if active" never could.

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

async function insertStep(overrides: { sessionId?: string; stepNumber?: number } = {}) {
  return db.query(
    `select * from create_step_if_session_active(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
     )`,
    [
      overrides.sessionId ?? sessionId,
      randomId(),
      overrides.stepNumber ?? 1,
      'generate',
      null,
      'a prompt',
      'test-model',
      'req-1',
      new Date().toISOString(),
      new Date().toISOString(),
      `${sessionId}/step_1.png`,
      'output-hash',
      null,
      'step-hash',
      'step-signature',
      null,
      null,
    ]
  )
}

describe('create_step_if_session_active — real Postgres', () => {
  it('inserts the step when the session is active', async () => {
    const res = await insertStep()
    expect(res.rows).toHaveLength(1)
    expect((res.rows[0] as { step_number: number }).step_number).toBe(1)

    const steps = await db.query(`select count(*)::int as count from genid_steps where session_id = $1`, [sessionId])
    expect((steps.rows[0] as { count: number }).count).toBe(1)
  })

  it('rejects the insert once the session has moved to finalizing (the actual race this closes)', async () => {
    // Simulate finalize winning the race: it flips status before this
    // step's insert runs.
    await db.query(`update genid_sessions set status = 'finalizing' where id = $1`, [sessionId])

    await expect(insertStep()).rejects.toThrow(/SESSION_NOT_ACTIVE/)

    const steps = await db.query(`select count(*)::int as count from genid_steps where session_id = $1`, [sessionId])
    expect((steps.rows[0] as { count: number }).count).toBe(0)
  })

  it('rejects the insert for a session that does not exist', async () => {
    await expect(insertStep({ sessionId: randomId() })).rejects.toThrow(/SESSION_NOT_FOUND/)
  })

  it('rejects the insert once the session is finalized', async () => {
    await db.query(`update genid_sessions set status = 'finalized' where id = $1`, [sessionId])
    await expect(insertStep()).rejects.toThrow(/SESSION_NOT_ACTIVE/)
  })

  it('enforces the unique (session_id, step_number) constraint the app relies on for chain ordering', async () => {
    await insertStep({ stepNumber: 1 })
    await expect(insertStep({ stepNumber: 1 })).rejects.toThrow()
  })
})
