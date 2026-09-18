import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { EMBED_RATE_LIMIT } from '@/lib/limits'

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = 'test-genid-signing-secret'
})

vi.mock('@/lib/auth', () => ({
  getAuthenticatedRecord: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  logContent: vi.fn(),
  countRecentEmbedsForGenid: vi.fn(),
}))
vi.mock('@/lib/blockchain', () => ({
  stampOnBlockchain: vi.fn(),
}))

import { getAuthenticatedRecord } from '@/lib/auth'
import { logContent, countRecentEmbedsForGenid } from '@/lib/supabase'
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
  vi.mocked(logContent).mockResolvedValue({
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
})

describe('POST /api/embed — rate limiting', () => {
  it('stamps normally when under the rate limit', async () => {
    vi.mocked(countRecentEmbedsForGenid).mockResolvedValue(0)

    const res = await callEmbed()
    expect(res.status).toBe(200)
    expect(stampOnBlockchain).toHaveBeenCalled()
  }, 10000)

  it('rejects with 429 once the limit is hit, without touching blockchain or content log', async () => {
    vi.mocked(countRecentEmbedsForGenid).mockResolvedValue(EMBED_RATE_LIMIT)

    const res = await callEmbed()
    expect(res.status).toBe(429)
    expect(stampOnBlockchain).not.toHaveBeenCalled()
    expect(logContent).not.toHaveBeenCalled()
  })

  it('allows stamping again once the count falls back under the limit', async () => {
    vi.mocked(countRecentEmbedsForGenid).mockResolvedValue(EMBED_RATE_LIMIT - 1)

    const res = await callEmbed()
    expect(res.status).toBe(200)
  }, 10000)
})
