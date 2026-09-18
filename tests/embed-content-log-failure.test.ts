import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = 'test-genid-signing-secret'
})

vi.mock('@/lib/auth', () => ({
  getAuthenticatedRecord: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  logContent: vi.fn(),
}))
vi.mock('@/lib/blockchain', () => ({
  stampOnBlockchain: vi.fn(),
}))

import { getAuthenticatedRecord } from '@/lib/auth'
import { logContent } from '@/lib/supabase'
import { stampOnBlockchain } from '@/lib/blockchain'
import { POST } from '@/app/api/embed/route'

async function callEmbed() {
  const pngBuffer = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .png()
    .toBuffer()
  const formData = new FormData()
  formData.append('image', new File([new Uint8Array(pngBuffer)], 'test.png', { type: 'image/png' }))
  const req = new NextRequest('http://localhost/api/embed', { method: 'POST', body: formData })
  return POST(req)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthenticatedRecord).mockResolvedValue({
    id: '1',
    genid_code: 'AB12345',
    user_name: 'Creator',
    email: 'creator@example.com',
    stripe_verification_id: null,
    verified: true,
    name_verified: true,
    created_at: new Date().toISOString(),
  })
  vi.mocked(stampOnBlockchain).mockResolvedValue({ txHash: '0xabc', network: 'polygon', blockNumber: 1, timestamp: Date.now() })
})

describe('POST /api/embed — content-log failure handling (Sept 18 second follow-up)', () => {
  it('refuses to return the stamped image when the content-log write ultimately fails', async () => {
    vi.mocked(logContent).mockRejectedValue(new Error('DB unavailable'))

    const res = await callEmbed()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/could not be saved/i)
    // Retried before giving up.
    expect(logContent).toHaveBeenCalledTimes(3)
  }, 10000)

  it('returns the stamped image once the content log succeeds, even after earlier attempts failed', async () => {
    vi.mocked(logContent)
      .mockRejectedValueOnce(new Error('transient blip'))
      .mockResolvedValueOnce({
        id: 'log-1',
        genid_code: 'AB12345',
        content_hash: 'hash',
        file_name: 'test.png',
        file_type: 'image/png',
        platform: 'GENID Protocol',
        blockchain_tx_hash: '0xabc',
        blockchain_network: 'polygon',
        created_at: new Date().toISOString(),
      })

    const res = await callEmbed()
    expect(res.status).toBe(200)
    expect(logContent).toHaveBeenCalledTimes(2)
  }, 10000)
})
