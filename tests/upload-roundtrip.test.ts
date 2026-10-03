import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
const state = vi.hoisted(() => ({ log: null as Record<string, unknown> | null }))
vi.mock('@/lib/auth', () => ({ getAuthenticatedRecord: async () => ({ genid_code: 'AB12345', verified: true }) }))
vi.mock('@/lib/blockchain', () => ({ stampOnBlockchain: async () => ({ txHash: 'test' }) }))
vi.mock('@/lib/supabase', () => ({
  reservePaidOperation: async () => true,
  logContent: async (entry: Record<string, unknown>) => (state.log = { ...entry, id: 'log' }),
  lookupGenid: async () => ({ genid_code: 'AB12345', user_name: 'Test', verified: true, name_verified: false }),
  supabaseAdmin: { from: () => ({ select: () => ({ eq: (_key: string, hash: string) => ({
    single: async () => ({ data: state.log?.content_hash === hash ? state.log : null }),
  }) }) }) },
}))
import { POST as embed } from '@/app/api/embed/route'
import { POST as verify } from '@/app/api/verify/route'
import { MAX_UPLOAD_BYTES } from '@/lib/limits'
import { MAX_MULTIPART_BYTES } from '@/lib/uploads'

function request(path: string, bytes: Uint8Array, type = 'image/png') {
  const form = new FormData()
  form.set('image', new File([new Uint8Array(bytes)], 'sample', { type }))
  return new NextRequest(`http://localhost/api/${path}`, { method: 'POST', body: form })
}
beforeAll(() => { process.env.GENID_SIGNING_SECRET = 'roundtrip-test-secret' })
beforeEach(() => { state.log = null })
describe('real Sharp upload routes', () => {
  it.each(['png', 'jpeg'] as const)('stamps %s, returns PNG and verifies the exact output', async (format) => {
    const source = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#aabbcc80' } }).toFormat(format).toBuffer()
    const stamped = await embed(request('embed', source, `image/${format}`))
    expect(stamped.status).toBe(200)
    expect(stamped.headers.get('content-type')).toBe('image/png')
    const bytes = new Uint8Array(await stamped.arrayBuffer())
    const metadata = await sharp(bytes).metadata()
    expect(metadata).toMatchObject({ format: 'png', width: 128, height: 128 })
    const result = await verify(request('verify', bytes))
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ verified: true, genidCode: 'AB12345' })
  })
  it.each([embed, verify])('rejects corrupt files, file oversize and body oversize', async (handler) => {
    expect((await handler(request('upload', new Uint8Array([1, 2, 3])))).status).toBe(400)
    expect((await handler(request('upload', new Uint8Array(MAX_UPLOAD_BYTES + 1)))).status).toBe(400)
    expect((await handler(request('upload', new Uint8Array(MAX_MULTIPART_BYTES + 1)))).status).toBe(413)
  })
})
