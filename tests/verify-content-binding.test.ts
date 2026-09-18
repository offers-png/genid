import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = 'test-genid-signing-secret'
})

vi.mock('@/lib/steganography', () => ({
  extractGenid: vi.fn(),
  hashBuffer: vi.fn(),
  verifyNotarySignature: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  lookupGenid: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
}))
// Upload size/dimension validation (lib/limits.ts) is covered by its own
// tests — this suite is only about the content-binding decision logic, and
// the fake "image" bytes below aren't a real decodable image.
vi.mock('@/lib/limits', () => ({
  validateUploadSize: vi.fn(),
  validateImageDimensions: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}))

import { extractGenid, hashBuffer, verifyNotarySignature } from '@/lib/steganography'
import { lookupGenid, supabaseAdmin } from '@/lib/supabase'
import { POST } from '@/app/api/verify/route'

const GENID_CODE = 'AB12345'
const CONTENT_HASH = 'uploaded-file-hash'
const EMBEDDED_HASH = 'hash-embedded-in-payload'
const TIMESTAMP = 1_700_000_000

function mockSingle(row: unknown) {
  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: row, error: row ? null : { message: 'not found' } }),
      }),
    }),
  } as unknown as ReturnType<typeof supabaseAdmin.from>)
}

async function callVerify(): Promise<{ status: number; body: Record<string, unknown> }> {
  const formData = new FormData()
  formData.append('image', new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' }))
  const req = new NextRequest('http://localhost/api/verify', { method: 'POST', body: formData })
  const res = await POST(req)
  return { status: res.status, body: await res.json() }
}

describe('POST /api/verify — content binding (Punch List #2, Sept 18 follow-up)', () => {
  beforeEach(() => {
    vi.mocked(hashBuffer).mockReturnValue(CONTENT_HASH)
    vi.mocked(lookupGenid).mockResolvedValue({
      id: '1',
      genid_code: GENID_CODE,
      user_name: 'Test Creator',
      email: 'creator@example.com',
      stripe_verification_id: null,
      verified: true,
      name_verified: true,
      created_at: new Date().toISOString(),
    })
  })

  it('verifies when the signature is valid AND the exact uploaded bytes match a logged content record', async () => {
    vi.mocked(extractGenid).mockResolvedValue({
      code: GENID_CODE,
      signature: 'sig123',
      timestamp: TIMESTAMP,
      hash: EMBEDDED_HASH,
      raw: '',
    })
    vi.mocked(verifyNotarySignature).mockReturnValue(true)
    mockSingle({
      genid_code: GENID_CODE,
      content_hash: CONTENT_HASH,
      notary_hash: EMBEDDED_HASH,
      notary_timestamp: TIMESTAMP,
      blockchain_tx_hash: null,
      platform: 'GenID Protocol',
      created_at: new Date().toISOString(),
    })

    const { body } = await callVerify()
    expect(body.verified).toBe(true)
    expect(body.contentMatchesRecord).toBe(true)
  })

  it('does NOT verify a valid signature whose bytes have no matching content record (edited-but-resigned-looking image)', async () => {
    vi.mocked(extractGenid).mockResolvedValue({
      code: GENID_CODE,
      signature: 'sig123',
      timestamp: TIMESTAMP,
      hash: EMBEDDED_HASH,
      raw: '',
    })
    vi.mocked(verifyNotarySignature).mockReturnValue(true)
    // No content_log row for these exact bytes — this is the "signature
    // embedded in a few LSBs survives edits to the rest of the image" case.
    mockSingle(null)

    const { body } = await callVerify()
    expect(body.verified).toBe(false)
    expect(body.contentMatchesRecord).toBe(false)
    expect(body.message).toMatch(/no authenticated record/i)
  })

  it('does NOT verify when the logged record belongs to a different GENID code', async () => {
    vi.mocked(extractGenid).mockResolvedValue({
      code: GENID_CODE,
      signature: 'sig123',
      timestamp: TIMESTAMP,
      hash: EMBEDDED_HASH,
      raw: '',
    })
    vi.mocked(verifyNotarySignature).mockReturnValue(true)
    mockSingle({
      genid_code: 'SOMEONE-ELSE',
      content_hash: CONTENT_HASH,
      notary_hash: EMBEDDED_HASH,
      notary_timestamp: TIMESTAMP,
      blockchain_tx_hash: null,
      platform: 'GenID Protocol',
      created_at: new Date().toISOString(),
    })

    const { body } = await callVerify()
    expect(body.verified).toBe(false)
    expect(body.contentMatchesRecord).toBe(false)
  })

  it('does not verify an invalid signature regardless of content record', async () => {
    vi.mocked(extractGenid).mockResolvedValue({
      code: GENID_CODE,
      signature: 'forged',
      timestamp: TIMESTAMP,
      hash: EMBEDDED_HASH,
      raw: '',
    })
    vi.mocked(verifyNotarySignature).mockReturnValue(false)
    mockSingle({
      genid_code: GENID_CODE,
      content_hash: CONTENT_HASH,
      notary_hash: EMBEDDED_HASH,
      notary_timestamp: TIMESTAMP,
      blockchain_tx_hash: null,
      platform: 'GenID Protocol',
      created_at: new Date().toISOString(),
    })

    const { body } = await callVerify()
    expect(body.verified).toBe(false)
  })
})
