import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import sharp from 'sharp'

let realPngBuffer: Buffer

beforeAll(async () => {
  process.env.GENID_SIGNING_SECRET = 'test-genid-signing-secret'
  realPngBuffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer()
})

vi.mock('@/lib/supabase', () => ({
  getSession: vi.fn(),
  getSessionSteps: vi.fn(),
  markStepArchived: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  downloadFromSessionBucket: vi.fn(),
  uploadToSessionBucket: vi.fn(),
  deleteFromSessionBucket: vi.fn(),
  archiveStepStoragePath: (sessionId: string, stepNumber: number) => `${sessionId}/step_${stepNumber}_archive.png`,
}))

import { getSession, getSessionSteps, markStepArchived, type SessionRecord, type StepRecord } from '@/lib/supabase'
import { downloadFromSessionBucket, uploadToSessionBucket, deleteFromSessionBucket } from '@/lib/storage'
import { archiveNonFinalSteps } from '@/lib/lifecycle'

const SESSION_ID = 'session-1'

function fakeSession(): SessionRecord {
  return {
    id: SESSION_ID,
    genid_code: 'AB12345',
    content_type: 'image',
    status: 'finalized',
    final_step_id: 'step-final',
    session_root_hash: 'root-hash',
    polygon_anchor_tx: null,
    identity_verification_tier: 'id_verified',
    c2pa_manifest_id: null,
    created_at: new Date().toISOString(),
    finalized_at: new Date().toISOString(),
    finalizing_since: null,
  }
}

function fakeNonFinalStep(): StepRecord {
  return {
    id: 'step-1',
    session_id: SESSION_ID,
    step_number: 1,
    step_type: 'regenerate',
    edit_type: null,
    prompt_text: 'a prompt',
    model_used: 'test-model',
    model_request_id: null,
    request_timestamp: new Date().toISOString(),
    response_timestamp: new Date().toISOString(),
    output_storage_path: `${SESSION_ID}/step_1.png`,
    output_hash: 'original-output-hash',
    prior_step_signature: null,
    step_hash: 'stephash',
    step_signature: 'stepsig',
    user_note: null,
    auto_suggested_note: null,
    is_final_selection: false,
    output_archived: false,
    archive_hash: null,
    archive_signature: null,
    created_at: new Date().toISOString(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(fakeSession())
  vi.mocked(downloadFromSessionBucket).mockResolvedValue(realPngBuffer)
  vi.mocked(uploadToSessionBucket).mockResolvedValue(undefined)
  vi.mocked(deleteFromSessionBucket).mockResolvedValue(undefined)
})

describe('archiveNonFinalSteps — recoverability (Sept 18 second follow-up)', () => {
  it('uploads to a NEW path, commits the DB row, THEN deletes the original — in that order', async () => {
    vi.mocked(getSessionSteps).mockResolvedValue([fakeNonFinalStep()])
    vi.mocked(markStepArchived).mockResolvedValue(undefined)

    const callOrder: string[] = []
    vi.mocked(uploadToSessionBucket).mockImplementation(async (path: string) => {
      callOrder.push(`upload:${path}`)
    })
    vi.mocked(markStepArchived).mockImplementation(async () => {
      callOrder.push('db-commit')
    })
    vi.mocked(deleteFromSessionBucket).mockImplementation(async (path: string) => {
      callOrder.push(`delete:${path}`)
    })

    await archiveNonFinalSteps(SESSION_ID)

    expect(callOrder).toEqual([
      `upload:${SESSION_ID}/step_1_archive.png`,
      'db-commit',
      `delete:${SESSION_ID}/step_1.png`,
    ])
  })

  it('never deletes the original file if the DB write fails — leaves the step safely retriable', async () => {
    vi.mocked(getSessionSteps).mockResolvedValue([fakeNonFinalStep()])
    vi.mocked(markStepArchived).mockRejectedValue(new Error('DB connection lost'))

    await expect(archiveNonFinalSteps(SESSION_ID)).rejects.toThrow('DB connection lost')

    // The original must still be intact — nothing should have tried to
    // delete it, since the DB never committed the switch to the new path.
    expect(deleteFromSessionBucket).not.toHaveBeenCalled()
  })

  it('does not fail the whole batch if deleting the (now-unreferenced) original fails', async () => {
    vi.mocked(getSessionSteps).mockResolvedValue([fakeNonFinalStep()])
    vi.mocked(markStepArchived).mockResolvedValue(undefined)
    vi.mocked(deleteFromSessionBucket).mockRejectedValue(new Error('storage hiccup'))

    const result = await archiveNonFinalSteps(SESSION_ID)

    // The DB commit already succeeded — a failed cleanup is a leftover
    // file, not a correctness problem, so this must not throw.
    expect(result.archivedCount).toBe(1)
    expect(markStepArchived).toHaveBeenCalled()
  })

  it('skips the final/selected step, already-archived steps, and steps with no stored output', async () => {
    const finalStep = { ...fakeNonFinalStep(), id: 'step-final', is_final_selection: true }
    const alreadyArchived = { ...fakeNonFinalStep(), id: 'step-2', output_archived: true }
    const noOutput = { ...fakeNonFinalStep(), id: 'step-3', output_storage_path: null }
    vi.mocked(getSessionSteps).mockResolvedValue([finalStep, alreadyArchived, noOutput])

    const result = await archiveNonFinalSteps(SESSION_ID)

    expect(result.archivedCount).toBe(0)
    expect(result.skippedCount).toBe(3)
    expect(uploadToSessionBucket).not.toHaveBeenCalled()
    expect(markStepArchived).not.toHaveBeenCalled()
  })
})
