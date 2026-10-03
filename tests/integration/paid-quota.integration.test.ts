import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

let db: PGlite
const state = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: state.rpc }) }))
vi.mock('@/lib/auth', () => ({ getAuthenticatedRecord: vi.fn(async () => ({ genid_code: 'TEST', verified: true })) }))
vi.mock('@/lib/blockchain', () => ({ stampOnBlockchain: vi.fn(async () => ({ txHash: 'test' })) }))
vi.mock('@/lib/supabase', async (original) => ({
  ...await original<typeof import('@/lib/supabase')>(),
  logContent: vi.fn(async () => ({ id: 'saved' })),
}))
import { reservePaidOperation } from '@/lib/supabase'
import { POST } from '@/app/api/embed/route'
import { stampOnBlockchain } from '@/lib/blockchain'

beforeAll(async () => {
  process.env.GENID_SIGNING_SECRET = 'quota-test-secret'
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.genid_registry(genid_code text primary key);
    insert into public.genid_registry values ('TEST'), ('OTHER');`)
  await db.exec(readFileSync('supabase/migrations/016_atomic_paid_quotas.sql', 'utf8'))
}, 20000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  vi.clearAllMocks()
  await db.exec('truncate public.genid_paid_quotas')
  state.rpc.mockImplementation(async (_name, args) => {
    const result = await db.query<{ allowed: boolean }>(
      'select public.reserve_paid_operation($1, $2) as allowed', [args.p_genid_code, args.p_operation])
    return { data: result.rows[0].allowed, error: null }
  })
})

describe('real migration 016 quota reservations', () => {
  it('allows only one of two concurrent HTTP requests with one stamping slot left', async () => {
    for (let i = 0; i < 19; i++) expect(await reservePaidOperation('TEST', 'embed')).toBe(true)
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } }).png().toBuffer()
    const request = () => {
      const form = new FormData()
      form.set('image', new File([new Uint8Array(png)], 'test.png', { type: 'image/png' }))
      return new NextRequest('http://localhost/api/embed', { method: 'POST', body: form })
    }
    const responses = await Promise.all([POST(request()), POST(request())])
    expect(responses.map(r => r.status).sort()).toEqual([200, 429])
    expect(stampOnBlockchain).toHaveBeenCalledTimes(1)
    // PGlite queues SQL on one connection; this verifies actual SQL + route
    // behavior, not independent Postgres connections contending on locks.
  })
  it('shares the generation budget, isolates identities/operations, and expires reservations', async () => {
    for (let i = 0; i < 9; i++) await reservePaidOperation('TEST', 'generation')
    expect(await Promise.all([reservePaidOperation('TEST', 'generation'), reservePaidOperation('TEST', 'generation')])).toEqual([true, false])
    expect(await reservePaidOperation('OTHER', 'generation')).toBe(true)
    expect(await reservePaidOperation('TEST', 'embed')).toBe(true)
    await db.exec(`update public.genid_paid_quotas set reserved_at = array[now() - interval '6 minutes']`)
    expect(await reservePaidOperation('TEST', 'generation')).toBe(true)
  })
  it('fails closed on database errors and invalid RPC responses', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } })
    await expect(reservePaidOperation('TEST', 'generation')).rejects.toThrow('Quota service unavailable')
    state.rpc.mockResolvedValue({ data: null, error: null })
    await expect(reservePaidOperation('TEST', 'embed')).rejects.toThrow('Quota service unavailable')
  })
  it('denies anonymous and authenticated execution', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await expect(db.query("select public.reserve_paid_operation('TEST', 'embed')")).rejects.toThrow('permission denied')
      await db.exec('reset role')
    }
  })
})
