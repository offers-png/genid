import { describe, it, expect, vi, beforeAll } from 'vitest'
import { buildStepContent, computeStepHash, signStepHash, buildArchiveContent } from '@/lib/chain'
import { hashBuffer } from '@/lib/steganography'
import type { SessionRecord, StepRecord } from '@/lib/supabase'

const SIGNING_SECRET = 'test-genid-signing-secret'

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = SIGNING_SECRET
})

vi.mock('@/lib/supabase', () => ({
  getSession: vi.fn(),
  getSessionSteps: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  downloadFromSessionBucket: vi.fn(),
}))
vi.mock('@/lib/blockchain', () => ({
  verifyOnBlockchain: vi.fn(),
}))

import { getSession, getSessionSteps } from '@/lib/supabase'
import { downloadFromSessionBucket } from '@/lib/storage'
import { verifySession } from '@/lib/verify'

const SESSION_ID = '11111111-1111-1111-1111-111111111111'

function buildValidStep(params: {
  id: string
  sessionId: string
  stepNumber: number
  outputHash: string
  priorSignature: string | null
  responseTimestamp: Date
}): StepRecord {
  const content = buildStepContent({
    sessionId: params.sessionId,
    stepNumber: params.stepNumber,
    outputHash: params.outputHash,
    promptText: 'a prompt',
    editType: null,
    modelUsed: 'test-model',
    responseTimestamp: params.responseTimestamp,
  })
  const stepHash = computeStepHash(content, params.priorSignature)
  const stepSignature = signStepHash(stepHash, SIGNING_SECRET)

  return {
    id: params.id,
    session_id: params.sessionId,
    step_number: params.stepNumber,
    step_type: params.stepNumber === 1 ? 'generate' : 'regenerate',
    edit_type: null,
    prompt_text: 'a prompt',
    model_used: 'test-model',
    model_request_id: null,
    request_timestamp: params.responseTimestamp.toISOString(),
    response_timestamp: params.responseTimestamp.toISOString(),
    output_storage_path: `${params.sessionId}/step_${params.stepNumber}.png`,
    output_hash: params.outputHash,
    prior_step_signature: params.priorSignature,
    step_hash: stepHash,
    step_signature: stepSignature,
    user_note: null,
    auto_suggested_note: null,
    is_final_selection: params.stepNumber === 1,
    output_archived: false,
    archive_hash: null,
    archive_signature: null,
    created_at: params.responseTimestamp.toISOString(),
  }
}

function fakeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    genid_code: 'AB12345',
    content_type: 'image',
    status: 'finalized',
    final_step_id: 'step-1',
    session_root_hash: null,
    polygon_anchor_tx: null,
    polygon_anchor_root_hash: null,
    identity_verification_tier: 'id_verified',
    c2pa_manifest_id: null,
    created_at: new Date().toISOString(),
    finalized_at: new Date().toISOString(),
    finalizing_since: null,
    ...overrides,
  }
}

describe('archive integrity binding (Punch List #5)', () => {
  it('reports a correctly bound and matching archive as verified', async () => {
    const step1Bytes = Buffer.from('step-1-bytes')
    const step1 = buildValidStep({
      id: 'step-1',
      sessionId: SESSION_ID,
      stepNumber: 1,
      outputHash: hashBuffer(step1Bytes),
      priorSignature: null,
      responseTimestamp: new Date('2026-01-01T00:00:00Z'),
    })
    const step2 = buildValidStep({
      id: 'step-2',
      sessionId: SESSION_ID,
      stepNumber: 2,
      outputHash: 'original-hash-2',
      priorSignature: step1.step_signature,
      responseTimestamp: new Date('2026-01-01T00:05:00Z'),
    })

    const compressedBuffer = Buffer.from('compressed-bytes-for-step-2')
    const archiveHash = hashBuffer(compressedBuffer)
    const archiveContent = buildArchiveContent(SESSION_ID, step2.id, step2.output_hash!, archiveHash)
    step2.output_archived = true
    step2.archive_hash = archiveHash
    step2.archive_signature = signStepHash(archiveContent, SIGNING_SECRET)

    vi.mocked(getSession).mockResolvedValue(fakeSession())
    vi.mocked(getSessionSteps).mockResolvedValue([step1, step2])
    vi.mocked(downloadFromSessionBucket).mockImplementation(async (path: string) =>
      path.includes('step_2') ? compressedBuffer : step1Bytes
    )

    const result = await verifySession(SESSION_ID)
    const archivedStep = result.steps.find((s) => s.stepId === 'step-2')!

    expect(archivedStep.archiveIntegrityValid).toBe(true)
    expect(archivedStep.valid).toBe(true)
    expect(result.chainValid).toBe(true)
  })

  it('reports UNVERIFIED (not passed) when no archive proof was ever recorded', async () => {
    const step1 = buildValidStep({
      id: 'step-1',
      sessionId: SESSION_ID,
      stepNumber: 1,
      outputHash: 'original-hash-1',
      priorSignature: null,
      responseTimestamp: new Date('2026-01-01T00:00:00Z'),
    })
    const step2 = buildValidStep({
      id: 'step-2',
      sessionId: SESSION_ID,
      stepNumber: 2,
      outputHash: 'original-hash-2',
      priorSignature: step1.step_signature,
      responseTimestamp: new Date('2026-01-01T00:05:00Z'),
    })
    // Archived, but archive_hash/archive_signature were never recorded —
    // e.g. this step predates archive integrity tracking entirely.
    step2.output_archived = true
    step2.archive_hash = null
    step2.archive_signature = null

    vi.mocked(getSession).mockResolvedValue(fakeSession())
    vi.mocked(getSessionSteps).mockResolvedValue([step1, step2])
    vi.mocked(downloadFromSessionBucket).mockResolvedValue(Buffer.from('whatever'))

    const result = await verifySession(SESSION_ID)
    const archivedStep = result.steps.find((s) => s.stepId === 'step-2')!

    expect(archivedStep.archiveIntegrityValid).toBe(false)
    expect(archivedStep.valid).toBe(false)
    expect(result.chainValid).toBe(false)
    expect(result.overallValid).toBe(false)
  })

  it('rejects an archive signature computed for a DIFFERENT step (cross-step replay)', async () => {
    const step1 = buildValidStep({
      id: 'step-1',
      sessionId: SESSION_ID,
      stepNumber: 1,
      outputHash: 'original-hash-1',
      priorSignature: null,
      responseTimestamp: new Date('2026-01-01T00:00:00Z'),
    })
    const step2 = buildValidStep({
      id: 'step-2',
      sessionId: SESSION_ID,
      stepNumber: 2,
      outputHash: 'original-hash-2',
      priorSignature: step1.step_signature,
      responseTimestamp: new Date('2026-01-01T00:05:00Z'),
    })

    const compressedBuffer = Buffer.from('compressed-bytes-shared-by-coincidence')
    const archiveHash = hashBuffer(compressedBuffer)
    // Signed as if it belonged to a totally different step/session — this is
    // what an attacker gets if they copy a valid archive_hash/signature pair
    // from elsewhere onto this row.
    const foreignArchiveContent = buildArchiveContent('other-session-id', 'other-step-id', 'other-hash', archiveHash)
    step2.output_archived = true
    step2.archive_hash = archiveHash
    step2.archive_signature = signStepHash(foreignArchiveContent, SIGNING_SECRET)

    vi.mocked(getSession).mockResolvedValue(fakeSession())
    vi.mocked(getSessionSteps).mockResolvedValue([step1, step2])
    vi.mocked(downloadFromSessionBucket).mockResolvedValue(compressedBuffer)

    const result = await verifySession(SESSION_ID)
    const archivedStep = result.steps.find((s) => s.stepId === 'step-2')!

    expect(archivedStep.archiveIntegrityValid).toBe(false)
    expect(archivedStep.valid).toBe(false)
  })

  it('rejects a tampered archived file even with a valid recorded proof', async () => {
    const step1 = buildValidStep({
      id: 'step-1',
      sessionId: SESSION_ID,
      stepNumber: 1,
      outputHash: 'original-hash-1',
      priorSignature: null,
      responseTimestamp: new Date('2026-01-01T00:00:00Z'),
    })
    const step2 = buildValidStep({
      id: 'step-2',
      sessionId: SESSION_ID,
      stepNumber: 2,
      outputHash: 'original-hash-2',
      priorSignature: step1.step_signature,
      responseTimestamp: new Date('2026-01-01T00:05:00Z'),
    })

    const originalCompressed = Buffer.from('the-real-archived-bytes')
    const archiveHash = hashBuffer(originalCompressed)
    const archiveContent = buildArchiveContent(SESSION_ID, step2.id, step2.output_hash!, archiveHash)
    step2.output_archived = true
    step2.archive_hash = archiveHash
    step2.archive_signature = signStepHash(archiveContent, SIGNING_SECRET)

    vi.mocked(getSession).mockResolvedValue(fakeSession())
    vi.mocked(getSessionSteps).mockResolvedValue([step1, step2])
    // Someone swapped the stored file after archival — current bytes no
    // longer hash to archive_hash even though the proof itself is valid.
    vi.mocked(downloadFromSessionBucket).mockResolvedValue(Buffer.from('swapped-in-bytes'))

    const result = await verifySession(SESSION_ID)
    const archivedStep = result.steps.find((s) => s.stepId === 'step-2')!

    expect(archivedStep.archiveIntegrityValid).toBe(false)
    expect(archivedStep.valid).toBe(false)
  })
})
