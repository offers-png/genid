import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getAuthenticatedRecord: vi.fn(),
}))
vi.mock('@/lib/apiKeys', () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
}))

import { getAuthenticatedRecord } from '@/lib/auth'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/apiKeys'
import { GET, POST } from '@/app/api/account/api-keys/route'
import { DELETE } from '@/app/api/account/api-keys/[id]/route'

const VERIFIED_RECORD = {
  id: '1', genid_code: 'SA12345', user_name: 'Test', email: 'test@example.com',
  stripe_verification_id: 'vs_123', verified: true, created_at: 'now',
}

function req(method: string) {
  return new NextRequest('http://localhost/api/account/api-keys', { method })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/account/api-keys', () => {
  it('requires a session', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(null)
    const res = await GET(req('GET'))
    expect(res.status).toBe(401)
    expect(listApiKeys).not.toHaveBeenCalled()
  })

  it('lists keys scoped to the caller', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(listApiKeys).mockResolvedValue([{ id: 'k1', genid_code: 'SA12345', key_prefix: 'gk_live_abcd', created_at: 'now', last_used_at: null, revoked_at: null }])

    const res = await GET(req('GET'))
    expect(res.status).toBe(200)
    expect(listApiKeys).toHaveBeenCalledWith('SA12345')
    const body = await res.json()
    expect(body.keys).toHaveLength(1)
  })
})

describe('POST /api/account/api-keys', () => {
  it('requires a session', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(null)
    const res = await POST(req('POST'))
    expect(res.status).toBe(401)
    expect(createApiKey).not.toHaveBeenCalled()
  })

  it('rejects an unverified identity with 403, without minting a key', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue({ ...VERIFIED_RECORD, verified: false })
    const res = await POST(req('POST'))
    expect(res.status).toBe(403)
    expect(createApiKey).not.toHaveBeenCalled()
  })

  it('mints a new key for a verified identity and returns the raw value', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(createApiKey).mockResolvedValue({
      rawKey: 'gk_live_rawvalue',
      record: { id: 'k1', genid_code: 'SA12345', key_prefix: 'gk_live_rawv', created_at: 'now', last_used_at: null, revoked_at: null },
    })

    const res = await POST(req('POST'))
    expect(res.status).toBe(200)
    expect(createApiKey).toHaveBeenCalledWith('SA12345')
    const body = await res.json()
    expect(body.key).toBe('gk_live_rawvalue')
  })
})

describe('DELETE /api/account/api-keys/[id]', () => {
  function delReq() {
    return new NextRequest('http://localhost/api/account/api-keys/key-1', { method: 'DELETE' })
  }

  it('requires a session', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(null)
    const res = await DELETE(delReq(), { params: Promise.resolve({ id: 'key-1' }) })
    expect(res.status).toBe(401)
    expect(revokeApiKey).not.toHaveBeenCalled()
  })

  it('revokes a key owned by the caller', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(revokeApiKey).mockResolvedValue(true)

    const res = await DELETE(delReq(), { params: Promise.resolve({ id: 'key-1' }) })
    expect(res.status).toBe(200)
    expect(revokeApiKey).toHaveBeenCalledWith('SA12345', 'key-1')
  })

  it('returns 404 when the key does not exist, is not the caller\'s, or is already revoked', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(revokeApiKey).mockResolvedValue(false)

    const res = await DELETE(delReq(), { params: Promise.resolve({ id: 'not-mine' }) })
    expect(res.status).toBe(404)
  })
})
