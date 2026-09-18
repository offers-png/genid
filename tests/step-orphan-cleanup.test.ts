import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/session/[id]/step uploads the new step's output BEFORE the
// atomic active-check-then-insert (createStepIfActive) — so a rejected
// insert (most commonly SESSION_NOT_ACTIVE, from a concurrent finalize)
// leaves that upload with no step row pointing at it. Sept 18 fourth
// follow-up: the route must clean that up rather than leaving it orphaned
// forever.

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = 'test-genid-signing-secret'
})

const SESSION_ID = 'session-1'

vi.mock('@/lib/auth', () => ({
  getAuthenticatedRecord: vi.fn(async () => ({
    id: '1',
    genid_code: 'AB12345',
    user_name: 'Creator',
    email: 'creator@example.com',
    stripe_verification_id: null,
    verified: true,
    name_verified: true,
    created_at: new Date().toISOString(),
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getSession: vi.fn(async () => ({
    id: SESSION_ID,
    genid_code: 'AB12345',
    content_type: 'image',
    status: 'active',
    final_step_id: null,
    session_root_hash: null,
    polygon_anchor_tx: null,
    polygon_anchor_root_hash: null,
    identity_verification_tier: 'id_verified',
    c2pa_manifest_id: null,
    created_at: new Date().toISOString(),
    finalized_at: null,
    finalizing_since: null,
  })),
  getSessionSteps: vi.fn(async () => [
    {
      id: 'step-0',
      session_id: SESSION_ID,
      step_number: 1,
      step_type: 'generate',
      edit_type: null,
      prompt_text: 'a prompt',
      model_used: 'test-model',
      model_request_id: null,
      request_timestamp: new Date().toISOString(),
      response_timestamp: new Date().toISOString(),
      output_storage_path: `${SESSION_ID}/step_1.png`,
      output_hash: 'prior-output-hash',
      prior_step_signature: null,
      step_hash: 'prior-step-hash',
      step_signature: 'prior-step-sig',
      user_note: null,
      auto_suggested_note: null,
      is_final_selection: false,
      output_archived: false,
      archive_hash: null,
      archive_signature: null,
      created_at: new Date().toISOString(),
    },
  ]),
  createStepIfActive: vi.fn(),
  isSessionNotActiveError: (err: unknown) => err instanceof Error && err.message.includes('SESSION_NOT_ACTIVE'),
  countRecentGenerationsForGenid: vi.fn(async () => 0),
}))

vi.mock('@/lib/storage', () => ({
  stepStoragePath: (sessionId: string, stepNumber: number, ext: string) => `${sessionId}/step_${stepNumber}.${ext}`,
  uploadToSessionBucket: vi.fn(async () => undefined),
  downloadFromSessionBucket: vi.fn(),
  cleanupOrphanedPath: vi.fn(async () => undefined),
}))

vi.mock('@/lib/adapters/openai-image', () => ({
  openAiImageAdapter: {
    name: 'fake-adapter',
    generateImage: vi.fn(async () => ({
      outputBuffer: Buffer.from('fake-image-bytes'),
      mimeType: 'image/png',
      ext: 'png',
      modelUsed: 'fake-model',
      modelRequestId: 'req-1',
      requestTimestamp: new Date(),
      responseTimestamp: new Date(),
    })),
  },
}))

import { createStepIfActive } from '@/lib/supabase'
import { uploadToSessionBucket, cleanupOrphanedPath } from '@/lib/storage'
import { POST } from '@/app/api/session/[id]/step/route'

function callStep() {
  const req = new NextRequest(`http://localhost/api/session/${SESSION_ID}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'regenerate', promptText: 'a new prompt' }),
  })
  return POST(req, { params: Promise.resolve({ id: SESSION_ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/session/[id]/step — orphaned storage cleanup', () => {
  it('cleans up the already-uploaded file when the insert is rejected as SESSION_NOT_ACTIVE', async () => {
    vi.mocked(createStepIfActive).mockRejectedValue(new Error('SESSION_NOT_ACTIVE'))

    const res = await callStep()

    expect(res.status).toBe(409)
    expect(uploadToSessionBucket).toHaveBeenCalledTimes(1)
    expect(cleanupOrphanedPath).toHaveBeenCalledWith(
      `${SESSION_ID}/step_2.png`,
      expect.stringContaining('session no longer active'),
      SESSION_ID
    )
  })

  it('cleans up the already-uploaded file on any other insert failure too', async () => {
    vi.mocked(createStepIfActive).mockRejectedValue(new Error('unexpected DB error'))

    const res = await callStep()

    expect(res.status).toBe(500)
    expect(cleanupOrphanedPath).toHaveBeenCalledWith(
      `${SESSION_ID}/step_2.png`,
      expect.stringContaining('step insert failed'),
      SESSION_ID
    )
  })

  it('does not attempt cleanup when the insert succeeds', async () => {
    vi.mocked(createStepIfActive).mockResolvedValue({
      id: 'step-1',
      session_id: SESSION_ID,
      step_number: 2,
      step_type: 'regenerate',
      edit_type: null,
      prompt_text: 'a new prompt',
      model_used: 'fake-model',
      model_request_id: 'req-1',
      request_timestamp: new Date().toISOString(),
      response_timestamp: new Date().toISOString(),
      output_storage_path: `${SESSION_ID}/step_2.png`,
      output_hash: 'new-output-hash',
      prior_step_signature: 'prior-step-sig',
      step_hash: 'new-step-hash',
      step_signature: 'new-step-sig',
      user_note: null,
      auto_suggested_note: null,
      is_final_selection: false,
      output_archived: false,
      archive_hash: null,
      archive_signature: null,
      created_at: new Date().toISOString(),
    })

    const res = await callStep()

    expect(res.status).toBe(200)
    expect(cleanupOrphanedPath).not.toHaveBeenCalled()
  })
})
