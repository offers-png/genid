import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  createSession: vi.fn(),
  createStepIfActive: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  uploadToSessionBucket: vi.fn(),
  stepStoragePath: vi.fn((sessionId: string, stepNumber: number, ext: string) => `${sessionId}/step_${stepNumber}.${ext}`),
}))

import { createSession, createStepIfActive } from '@/lib/supabase'
import { uploadToSessionBucket } from '@/lib/storage'
import { createSessionWithFirstStep } from '@/lib/sessionPipeline'

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = 'session-pipeline-test-secret'
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createSession).mockResolvedValue({
    id: 'session-1', genid_code: 'SA12345', content_type: 'image', status: 'active',
    final_step_id: null, session_root_hash: null, polygon_anchor_tx: null,
    polygon_anchor_root_hash: null, identity_verification_tier: 'id_verified',
    c2pa_manifest_id: null, created_at: 'now', finalized_at: null, finalizing_since: null,
  })
  vi.mocked(createStepIfActive).mockImplementation(async (entry) => ({
    id: 'step-1', created_at: 'now', output_archived: false, archive_hash: null, archive_signature: null,
    ...entry,
  }))
})

describe('createSessionWithFirstStep', () => {
  it('creates an image session and uploads the output to step 1\'s storage path', async () => {
    await createSessionWithFirstStep('SA12345', {
      outputBuffer: Buffer.from('fake-png-bytes'),
      mimeType: 'image/png',
      ext: 'png',
      modelUsed: 'gpt-image-1',
      modelRequestId: 'req-1',
      requestTimestamp: new Date('2026-10-01T00:00:00Z'),
      responseTimestamp: new Date('2026-10-01T00:00:05Z'),
      promptText: 'a cat wearing a hat',
      stepType: 'generate',
    })

    expect(createSession).toHaveBeenCalledWith({
      genid_code: 'SA12345',
      content_type: 'image',
      identity_verification_tier: 'id_verified',
    })
    expect(uploadToSessionBucket).toHaveBeenCalledWith('session-1/step_1.png', expect.any(Buffer), 'image/png')
  })

  it('records step_type "upload" with a null model/prompt for an externally-sourced image', async () => {
    const { step } = await createSessionWithFirstStep('SA12345', {
      outputBuffer: Buffer.from('fake-png-bytes'),
      mimeType: 'image/png',
      ext: 'png',
      modelUsed: null,
      modelRequestId: null,
      requestTimestamp: new Date('2026-10-01T00:00:00Z'),
      responseTimestamp: new Date('2026-10-01T00:00:00Z'),
      promptText: null,
      stepType: 'upload',
    })

    expect(step.step_type).toBe('upload')
    expect(step.model_used).toBeNull()
    expect(step.prompt_text).toBeNull()
    expect(step.prior_step_signature).toBeNull()
  })

  it('computes a real, non-empty step hash/signature regardless of which path produced the output', async () => {
    const { step } = await createSessionWithFirstStep('SA12345', {
      outputBuffer: Buffer.from('fake-png-bytes'),
      mimeType: 'image/png',
      ext: 'png',
      modelUsed: null,
      modelRequestId: null,
      requestTimestamp: new Date(),
      responseTimestamp: new Date(),
      promptText: null,
      stepType: 'upload',
    })

    expect(step.output_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(step.step_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(step.step_signature).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a different output_hash for different bytes, and the same hash for the same bytes', async () => {
    const materials = (buf: Buffer) => ({
      outputBuffer: buf, mimeType: 'image/png', ext: 'png', modelUsed: null, modelRequestId: null,
      requestTimestamp: new Date(), responseTimestamp: new Date(), promptText: null, stepType: 'upload' as const,
    })

    const { step: stepA } = await createSessionWithFirstStep('SA12345', materials(Buffer.from('image-a')))
    const { step: stepB } = await createSessionWithFirstStep('SA12345', materials(Buffer.from('image-b')))
    const { step: stepC } = await createSessionWithFirstStep('SA12345', materials(Buffer.from('image-a')))

    expect(stepA.output_hash).not.toBe(stepB.output_hash)
    expect(stepA.output_hash).toBe(stepC.output_hash)
  })
})
