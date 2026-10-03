import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

vi.mock('@/lib/apiKeys', () => ({
  getCallerRecord: vi.fn(),
}))
vi.mock('@/lib/sessionPipeline', () => ({
  createSessionWithFirstStep: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  listSessionsForGenid: vi.fn(),
  getCertificatesForSessions: vi.fn(),
  reservePaidOperation: vi.fn(),
}))
vi.mock('@/lib/adapters/openai-image', () => ({
  openAiImageAdapter: { name: 'openai-gpt-image-1', generateImage: vi.fn() },
}))

import { getCallerRecord } from '@/lib/apiKeys'
import { createSessionWithFirstStep } from '@/lib/sessionPipeline'
import { reservePaidOperation } from '@/lib/supabase'
import { POST } from '@/app/api/session/route'

const VERIFIED_RECORD = {
  id: '1', genid_code: 'SA12345', user_name: 'Test Creator', email: 'test@example.com',
  stripe_verification_id: 'vs_123', verified: true, created_at: 'now',
}

async function uploadReq(opts: { authorization?: string; image?: File | null; imageBuffer?: Buffer }) {
  const formData = new FormData()
  if (opts.image !== null) {
    const buf = opts.imageBuffer ?? (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer())
    formData.append('image', new File([new Uint8Array(buf)], 'external.png', { type: 'image/png' }))
  }
  const headers: Record<string, string> = {}
  if (opts.authorization !== undefined) headers.authorization = opts.authorization
  return new NextRequest('http://localhost/api/session', { method: 'POST', body: formData, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/session — multipart upload start (external image)', () => {
  it('rejects with 401 when the caller resolves from neither a session cookie nor an API key', async () => {
    vi.mocked(getCallerRecord).mockResolvedValue(null)
    const res = await POST(await uploadReq({ authorization: 'Bearer gk_live_invalid' }))
    expect(res.status).toBe(401)
    expect(createSessionWithFirstStep).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the resolved identity is not Stripe-verified', async () => {
    vi.mocked(getCallerRecord).mockResolvedValue({ ...VERIFIED_RECORD, verified: false })
    const res = await POST(await uploadReq({ authorization: 'Bearer gk_live_valid' }))
    expect(res.status).toBe(403)
    expect(createSessionWithFirstStep).not.toHaveBeenCalled()
  })

  it('rejects with 400 when no image is supplied', async () => {
    vi.mocked(getCallerRecord).mockResolvedValue(VERIFIED_RECORD)
    const res = await POST(await uploadReq({ authorization: 'Bearer gk_live_valid', image: null }))
    expect(res.status).toBe(400)
  })

  it('rejects with 429 when the per-identity embed quota is exhausted', async () => {
    vi.mocked(getCallerRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(reservePaidOperation).mockResolvedValue(false)
    const res = await POST(await uploadReq({ authorization: 'Bearer gk_live_valid' }))
    expect(res.status).toBe(429)
    expect(createSessionWithFirstStep).not.toHaveBeenCalled()
  })

  it('creates a session from the uploaded image, normalized to PNG, with step_type "upload"', async () => {
    vi.mocked(getCallerRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(reservePaidOperation).mockResolvedValue(true)
    vi.mocked(createSessionWithFirstStep).mockResolvedValue({
      session: { id: 'session-1', genid_code: 'SA12345', content_type: 'image', status: 'active', final_step_id: null, session_root_hash: null, polygon_anchor_tx: null, polygon_anchor_root_hash: null, identity_verification_tier: 'id_verified', c2pa_manifest_id: null, created_at: 'now', finalized_at: null, finalizing_since: null },
      step: { id: 'step-1', session_id: 'session-1', step_number: 1, step_type: 'upload', edit_type: null, prompt_text: null, model_used: null, model_request_id: null, request_timestamp: 'now', response_timestamp: 'now', output_storage_path: 'session-1/step_1.png', output_hash: 'abc123', prior_step_signature: null, step_hash: 'def456', step_signature: 'sig789', user_note: null, auto_suggested_note: null, is_final_selection: false, output_archived: false, archive_hash: null, archive_signature: null, created_at: 'now' },
    })

    // A real JPEG input — confirms the route normalizes to PNG itself
    // rather than trusting the upload's declared content type.
    const jpegBuffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 0, b: 0 } } }).jpeg().toBuffer()
    const res = await POST(await uploadReq({ authorization: 'Bearer gk_live_valid', imageBuffer: jpegBuffer }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ sessionId: 'session-1', stepId: 'step-1', outputHash: 'abc123', stepSignature: 'sig789' })

    expect(createSessionWithFirstStep).toHaveBeenCalledWith(
      'SA12345',
      expect.objectContaining({ mimeType: 'image/png', ext: 'png', modelUsed: null, promptText: null, stepType: 'upload' })
    )
    const [, materials] = vi.mocked(createSessionWithFirstStep).mock.calls[0]
    // The buffer actually handed to the pipeline must be real PNG bytes,
    // not the raw JPEG that was uploaded.
    const normalizedMeta = await sharp(materials.outputBuffer).metadata()
    expect(normalizedMeta.format).toBe('png')
  })

  it('authenticates via session cookie just as well as an API key (getCallerRecord handles both)', async () => {
    vi.mocked(getCallerRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(reservePaidOperation).mockResolvedValue(true)
    vi.mocked(createSessionWithFirstStep).mockResolvedValue({
      session: { id: 'session-2', genid_code: 'SA12345', content_type: 'image', status: 'active', final_step_id: null, session_root_hash: null, polygon_anchor_tx: null, polygon_anchor_root_hash: null, identity_verification_tier: 'id_verified', c2pa_manifest_id: null, created_at: 'now', finalized_at: null, finalizing_since: null },
      step: { id: 'step-2', session_id: 'session-2', step_number: 1, step_type: 'upload', edit_type: null, prompt_text: null, model_used: null, model_request_id: null, request_timestamp: 'now', response_timestamp: 'now', output_storage_path: 'session-2/step_1.png', output_hash: 'h', prior_step_signature: null, step_hash: 'h2', step_signature: 's', user_note: null, auto_suggested_note: null, is_final_selection: false, output_archived: false, archive_hash: null, archive_signature: null, created_at: 'now' },
    })

    // No Authorization header at all — getCallerRecord is mocked to
    // resolve anyway, standing in for a valid session cookie.
    const res = await POST(await uploadReq({}))
    expect(res.status).toBe(200)
  })
})
