import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/apiKeys', () => ({
  resolveApiKey: vi.fn(),
}))
vi.mock('@/lib/stamping', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stamping')>('@/lib/stamping')
  return { ...actual, stampImageForIdentity: vi.fn() }
})
// Fake upload bytes below aren't a real decodable image — stub the
// dimension check the way the other upload-route tests do, since that's
// not what this suite is testing.
vi.mock('@/lib/limits', async () => {
  const actual = await vi.importActual<typeof import('@/lib/limits')>('@/lib/limits')
  return { ...actual, validateImageDimensions: vi.fn() }
})

import { resolveApiKey } from '@/lib/apiKeys'
import { stampImageForIdentity, QuotaExceededError, ContentLogWriteError } from '@/lib/stamping'
import { POST } from '@/app/api/v1/stamp/route'

const VERIFIED_RECORD = {
  id: '1',
  genid_code: 'SA12345',
  user_name: 'Test Creator',
  email: 'test@example.com',
  stripe_verification_id: 'vs_123',
  verified: true,
  created_at: 'now',
}

function req(opts: { authorization?: string; image?: File | null }) {
  const formData = new FormData()
  if (opts.image !== null) {
    formData.append('image', opts.image ?? new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' }))
  }
  const headers: Record<string, string> = {}
  if (opts.authorization !== undefined) headers.authorization = opts.authorization
  return new NextRequest('http://localhost/api/v1/stamp', { method: 'POST', body: formData, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/stamp', () => {
  it('rejects with 401 when no Authorization header is present', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue(null)
    const res = await POST(req({}))
    expect(res.status).toBe(401)
    expect(stampImageForIdentity).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the API key does not resolve to any identity', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue(null)
    const res = await POST(req({ authorization: 'Bearer gk_live_invalid' }))
    expect(res.status).toBe(401)
  })

  it('rejects with 403 when the resolved identity is not Stripe-verified', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue({ ...VERIFIED_RECORD, verified: false })
    const res = await POST(req({ authorization: 'Bearer gk_live_valid' }))
    expect(res.status).toBe(403)
    expect(stampImageForIdentity).not.toHaveBeenCalled()
  })

  it('rejects with 400 when no image is supplied', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue(VERIFIED_RECORD)
    const res = await POST(req({ authorization: 'Bearer gk_live_valid', image: null }))
    expect(res.status).toBe(400)
  })

  it('stamps the image and returns the expected JSON shape on success', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(stampImageForIdentity).mockResolvedValue({
      stampedBuffer: Buffer.from('stamped-bytes'),
      stampedHash: 'stamped-hash',
      originalHash: 'original-hash',
      timestamp: 1730000000,
      txHash: '0xabc',
      logEntry: { id: 'log-1', genid_code: 'SA12345', content_hash: 'stamped-hash', file_name: 'test.png', file_type: 'image/png', platform: 'GENID Protocol', blockchain_tx_hash: '0xabc', blockchain_network: 'polygon', created_at: 'now' },
    })

    const res = await POST(req({ authorization: 'Bearer gk_live_valid' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      verificationRecordId: 'log-1',
      genidCode: 'SA12345',
      contentHash: 'stamped-hash',
      originalContentHash: 'original-hash',
      blockchainTxHash: '0xabc',
      notaryTimestamp: 1730000000,
      image: { contentType: 'image/png' },
    })
    expect(body.image.base64).toBe(Buffer.from('stamped-bytes').toString('base64'))
    expect(stampImageForIdentity).toHaveBeenCalledWith('SA12345', expect.any(Buffer), 'image/png', 'test.png')
  })

  it('maps QuotaExceededError to 429', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(stampImageForIdentity).mockRejectedValue(new QuotaExceededError('too many'))
    const res = await POST(req({ authorization: 'Bearer gk_live_valid' }))
    expect(res.status).toBe(429)
  })

  it('maps ContentLogWriteError to 500', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(stampImageForIdentity).mockRejectedValue(new ContentLogWriteError('log failed'))
    const res = await POST(req({ authorization: 'Bearer gk_live_valid' }))
    expect(res.status).toBe(500)
  })
})
