import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { VERIFY_RATE_LIMIT } from '@/lib/limits'

vi.mock('@/lib/verification', () => ({
  verifyImageBuffer: vi.fn(),
}))
vi.mock('@/lib/limits', async () => {
  const actual = await vi.importActual<typeof import('@/lib/limits')>('@/lib/limits')
  return { ...actual, validateImageDimensions: vi.fn() }
})

import { verifyImageBuffer } from '@/lib/verification'
import { POST } from '@/app/api/v1/verify/route'

function req(ip: string, image: File | null = null) {
  const formData = new FormData()
  if (image !== null) formData.append('image', image)
  else formData.append('image', new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' }))
  return new NextRequest('http://localhost/api/v1/verify', {
    method: 'POST',
    body: formData,
    headers: { 'x-forwarded-for': ip },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/verify', () => {
  it('requires no authentication — a plain request without any API key or cookie succeeds', async () => {
    vi.mocked(verifyImageBuffer).mockResolvedValue({
      verified: true,
      genidCode: 'SA12345',
      contentHash: 'hash',
      message: 'ok',
    })
    const res = await POST(req('10.1.0.1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.genidCode).toBe('SA12345')
  })

  it('rejects with 400 when no image is supplied', async () => {
    const formData = new FormData()
    const request = new NextRequest('http://localhost/api/v1/verify', {
      method: 'POST',
      body: formData,
      headers: { 'x-forwarded-for': '10.1.0.2' },
    })
    const res = await POST(request)
    expect(res.status).toBe(400)
    expect(verifyImageBuffer).not.toHaveBeenCalled()
  })

  it('enforces the same per-IP limit/window as legacy /api/verify, in its own counter bucket', async () => {
    vi.mocked(verifyImageBuffer).mockResolvedValue({ verified: false, contentHash: 'hash', message: 'none' })
    const ip = '10.1.0.3'
    for (let i = 0; i < VERIFY_RATE_LIMIT; i++) {
      const res = await POST(req(ip))
      expect(res.status).toBe(200)
    }
    const blocked = await POST(req(ip))
    expect(blocked.status).toBe(429)
  })
})
