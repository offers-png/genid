import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getAuthenticatedRecord: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  getSession: vi.fn(),
  getSessionSteps: vi.fn(),
  getCertificateForSession: vi.fn(),
  markStepFinal: vi.fn(),
  finalizeSession: vi.fn(),
  createCertificate: vi.fn(),
  setSessionC2paManifestId: vi.fn(),
  lookupGenid: vi.fn(),
  tryBeginFinalizing: vi.fn(),
  tryReclaimStaleFinalizing: vi.fn(),
  abortFinalizing: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  downloadFromSessionBucket: vi.fn(),
  uploadToSessionBucket: vi.fn(),
  c2paExportStoragePath: vi.fn(() => 'c2pa/path.png'),
}))
vi.mock('@/lib/certificate', () => ({
  generateCertificatePdf: vi.fn(),
  buildCertificateSteps: vi.fn(),
}))
vi.mock('@/lib/chain', () => ({
  computeSessionRootHash: vi.fn(() => 'computed-root-hash'),
}))
vi.mock('@/lib/blockchain', () => ({
  stampOnBlockchain: vi.fn(),
}))
vi.mock('@/lib/c2pa', () => ({
  embedC2paManifest: vi.fn(),
}))
vi.mock('@/lib/lifecycle', () => ({
  archiveNonFinalSteps: vi.fn(),
}))

import { getAuthenticatedRecord } from '@/lib/auth'
import {
  getSession,
  getSessionSteps,
  markStepFinal,
  finalizeSession,
  createCertificate,
  lookupGenid,
  tryBeginFinalizing,
  tryReclaimStaleFinalizing,
  abortFinalizing,
  type SessionRecord,
  type StepRecord,
} from '@/lib/supabase'
import { generateCertificatePdf, buildCertificateSteps } from '@/lib/certificate'
import { stampOnBlockchain } from '@/lib/blockchain'
import { archiveNonFinalSteps } from '@/lib/lifecycle'
import { POST } from '@/app/api/session/[id]/finalize/route'

const SESSION_ID = 'session-1'
const OWNER_GENID = 'AB12345'

function req(body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/session/${SESSION_ID}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function call() {
  return POST(req(), { params: Promise.resolve({ id: SESSION_ID }) })
}

function fakeOwner(genidCode = OWNER_GENID) {
  return {
    id: '1',
    genid_code: genidCode,
    user_name: 'Owner',
    email: 'owner@example.com',
    stripe_verification_id: null,
    verified: true,
    name_verified: true,
    created_at: new Date().toISOString(),
  }
}

function fakeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    genid_code: OWNER_GENID,
    content_type: 'image',
    status: 'active',
    final_step_id: null,
    session_root_hash: null,
    polygon_anchor_tx: null,
    identity_verification_tier: 'id_verified',
    c2pa_manifest_id: null,
    created_at: new Date().toISOString(),
    finalized_at: null,
    finalizing_since: null,
    ...overrides,
  }
}

const fakeStep: StepRecord = {
  id: 'step-1',
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
  output_hash: 'hash',
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSessionSteps).mockResolvedValue([fakeStep])
  vi.mocked(buildCertificateSteps).mockResolvedValue([
    { stepNumber: 1, stepType: 'generate', editType: null, promptText: null, userNote: null, outputHash: 'hash', stepSignature: 'sig', responseTimestamp: null, imageBuffer: null, isFinal: true },
  ])
  vi.mocked(generateCertificatePdf).mockResolvedValue(Buffer.from('pdf-bytes'))
  vi.mocked(lookupGenid).mockResolvedValue(fakeOwner())
  vi.mocked(stampOnBlockchain).mockResolvedValue({ txHash: '0xabc', network: 'polygon', blockNumber: 1, timestamp: Date.now() })
  vi.mocked(archiveNonFinalSteps).mockResolvedValue({ archivedCount: 0, skippedCount: 1, bytesBefore: 0, bytesAfter: 0 })
  vi.mocked(createCertificate).mockResolvedValue({
    id: 'cert-1',
    session_id: SESSION_ID,
    generated_at: new Date().toISOString(),
    pdf_export_path: `${SESSION_ID}/certificate.pdf`,
    json_export_path: null,
    c2pa_manifest_embedded: false,
    public_verify_url: 'http://localhost/session/verify/' + SESSION_ID,
    total_steps: 1,
    total_duration_seconds: 5,
    content_type: 'image',
    identity_verification_tier: 'id_verified',
    final_output_thumbnail_path: null,
  })
  vi.mocked(markStepFinal).mockResolvedValue(undefined)
  vi.mocked(finalizeSession).mockResolvedValue(undefined)
})

describe('POST /api/session/[id]/finalize — ownership (Punch List #4 follow-up)', () => {
  it('rejects an unauthenticated request with 401 and never touches the lock', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(fakeSession())

    const res = await call()
    expect(res.status).toBe(401)
    expect(tryBeginFinalizing).not.toHaveBeenCalled()
  })

  it('rejects a request from a caller who does not own the session with 403', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(fakeOwner('SOMEONE-ELSE'))
    vi.mocked(getSession).mockResolvedValue(fakeSession())

    const res = await call()
    expect(res.status).toBe(403)
    expect(tryBeginFinalizing).not.toHaveBeenCalled()
  })
})

describe('POST /api/session/[id]/finalize — concurrency and lock recovery (Punch List #5 follow-up)', () => {
  beforeEach(() => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(fakeOwner())
  })

  it('returns 409 and does not race when the lock is already held (concurrent finalize)', async () => {
    vi.mocked(getSession).mockResolvedValue(fakeSession({ status: 'active' }))
    vi.mocked(tryBeginFinalizing).mockResolvedValue(false) // lost the race

    const res = await call()
    expect(res.status).toBe(409)
    expect(generateCertificatePdf).not.toHaveBeenCalled()
    expect(abortFinalizing).not.toHaveBeenCalled() // never acquired, nothing to release
  })

  it('releases the lock when a validation failure happens AFTER the lock is acquired', async () => {
    vi.mocked(getSession).mockResolvedValue(fakeSession({ status: 'active' }))
    vi.mocked(tryBeginFinalizing).mockResolvedValue(true)
    vi.mocked(lookupGenid).mockResolvedValue(null) // registry record missing -> FinalizeError(500)

    const res = await call()
    expect(res.status).toBe(500)
    expect(abortFinalizing).toHaveBeenCalledWith(SESSION_ID)
  })

  it('treats a recent (non-stale) finalizing lock as still held: 409, no reclaim attempted', async () => {
    vi.mocked(getSession).mockResolvedValue(
      fakeSession({ status: 'finalizing', finalizing_since: new Date().toISOString() })
    )

    const res = await call()
    expect(res.status).toBe(409)
    expect(tryReclaimStaleFinalizing).not.toHaveBeenCalled()
  })

  it('reclaims a stale finalizing lock (crash recovery) and completes successfully', async () => {
    const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
    vi.mocked(getSession).mockResolvedValue(
      fakeSession({ status: 'finalizing', finalizing_since: staleTimestamp })
    )
    vi.mocked(tryReclaimStaleFinalizing).mockResolvedValue(true)

    const res = await call()
    expect(res.status).toBe(200)
    expect(tryReclaimStaleFinalizing).toHaveBeenCalled()
    expect(finalizeSession).toHaveBeenCalled()
  })

  it('returns 409 when a stale lock reclaim itself loses a race to another caller', async () => {
    const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    vi.mocked(getSession).mockResolvedValue(
      fakeSession({ status: 'finalizing', finalizing_since: staleTimestamp })
    )
    vi.mocked(tryReclaimStaleFinalizing).mockResolvedValue(false)

    const res = await call()
    expect(res.status).toBe(409)
    expect(abortFinalizing).not.toHaveBeenCalled()
  })
})
