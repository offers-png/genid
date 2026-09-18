import { describe, it, expect, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

// One complete generate -> edit -> finalize -> download -> verify flow,
// driven through the REAL route handlers and REAL business logic
// (lib/chain.ts hash-chaining, lib/edits.ts sharp transforms,
// lib/lifecycle.ts archival, lib/certificate.ts PDF generation,
// lib/verify.ts recompute-and-compare) against an in-memory fake for the
// only two things that are genuinely external: the database
// (@/lib/supabase) and object storage (@/lib/storage), plus the model
// provider, blockchain, and C2PA signing, which this test fakes at their
// real module boundaries the same way the app would swap providers.
//
// This is what a passing run actually proves: the hash computed when a
// step is WRITTEN is bit-for-bit the same value lib/verify.ts recomputes
// when READING it back, through the real finalize ordering (lock-then-
// publish, anchor content-binding) added this round — not that two mocks
// happen to agree with each other.

beforeAll(() => {
  process.env.GENID_SIGNING_SECRET = 'e2e-test-genid-signing-secret'
})

const GENID_CODE = 'E2E1234'
const OWNER = {
  id: 'owner-1',
  genid_code: GENID_CODE,
  user_name: 'E2E Test Creator',
  email: 'e2e@example.com',
  stripe_verification_id: 'vs_test',
  verified: true,
  name_verified: true,
  created_at: new Date().toISOString(),
}

// ---- In-memory fake "database" ----
interface FakeSession {
  id: string
  genid_code: string
  content_type: string
  status: string
  final_step_id: string | null
  session_root_hash: string | null
  polygon_anchor_tx: string | null
  polygon_anchor_root_hash: string | null
  identity_verification_tier: string | null
  c2pa_manifest_id: string | null
  created_at: string
  finalized_at: string | null
  finalizing_since: string | null
  finalizing_lock_token: string | null
}

const sessions = new Map<string, FakeSession>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const steps = new Map<string, any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const certificates = new Map<string, any>()
const storageFiles = new Map<string, Buffer>()
let idCounter = 0
const nextId = (prefix: string) => `${prefix}-${++idCounter}`

vi.mock('@/lib/auth', () => ({
  getAuthenticatedRecord: vi.fn(async () => OWNER),
}))

vi.mock('@/lib/supabase', () => ({
  createSession: vi.fn(async (entry: Record<string, unknown>) => {
    const row: FakeSession = {
      id: nextId('session'),
      genid_code: entry.genid_code as string,
      content_type: entry.content_type as string,
      status: 'active',
      final_step_id: null,
      session_root_hash: null,
      polygon_anchor_tx: null,
      polygon_anchor_root_hash: null,
      identity_verification_tier: entry.identity_verification_tier as string,
      c2pa_manifest_id: null,
      created_at: new Date().toISOString(),
      finalized_at: null,
      finalizing_since: null,
      finalizing_lock_token: null,
    }
    sessions.set(row.id, row)
    return row
  }),
  getSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
  getSessionSteps: vi.fn(async (sessionId: string) =>
    [...steps.values()].filter((s) => s.session_id === sessionId).sort((a, b) => a.step_number - b.step_number)
  ),
  createStepIfActive: vi.fn(async (entry: Record<string, unknown>) => {
    const session = sessions.get(entry.session_id as string)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    if (session.status !== 'active') throw new Error('SESSION_NOT_ACTIVE')
    const row = {
      id: nextId('step'),
      ...entry,
      is_final_selection: false,
      output_archived: false,
      archive_hash: null,
      archive_signature: null,
      created_at: new Date().toISOString(),
    }
    steps.set(row.id, row)
    return row
  }),
  countRecentGenerationsForGenid: vi.fn(async () => 0),
  tryBeginFinalizing: vi.fn(async (sessionId: string) => {
    const session = sessions.get(sessionId)
    if (!session || session.status !== 'active') return { acquired: false, token: null }
    const token = nextId('token')
    session.status = 'finalizing'
    session.finalizing_since = new Date().toISOString()
    session.finalizing_lock_token = token
    return { acquired: true, token }
  }),
  tryReclaimStaleFinalizing: vi.fn(async () => ({ acquired: false, token: null })),
  abortFinalizing: vi.fn(async (sessionId: string, token: string) => {
    const session = sessions.get(sessionId)
    if (session && session.status === 'finalizing' && session.finalizing_lock_token === token) {
      session.status = 'active'
      session.finalizing_since = null
      session.finalizing_lock_token = null
    }
  }),
  recordPolygonAnchorTx: vi.fn(async (sessionId: string, token: string, txHash: string, rootHash: string) => {
    const session = sessions.get(sessionId)
    if (!session || session.status !== 'finalizing' || session.finalizing_lock_token !== token) return false
    session.polygon_anchor_tx = txHash
    session.polygon_anchor_root_hash = rootHash
    session.finalizing_since = new Date().toISOString()
    return true
  }),
  finalizeSession: vi.fn(async (sessionId: string, finalStepId: string, rootHash: string, anchorTx: string | null, token: string) => {
    const session = sessions.get(sessionId)
    if (!session || session.status !== 'finalizing' || session.finalizing_lock_token !== token) return false
    session.status = 'finalized'
    session.final_step_id = finalStepId
    session.session_root_hash = rootHash
    session.polygon_anchor_tx = anchorTx
    session.finalized_at = new Date().toISOString()
    session.finalizing_lock_token = null
    return true
  }),
  markStepFinal: vi.fn(async (stepId: string, sessionId: string) => {
    for (const s of steps.values()) if (s.session_id === sessionId) s.is_final_selection = false
    const step = steps.get(stepId)
    if (step) step.is_final_selection = true
  }),
  markStepArchived: vi.fn(async (stepId: string, archiveHash: string, archiveSignature: string, newPath: string) => {
    const step = steps.get(stepId)
    if (step) {
      step.output_archived = true
      step.archive_hash = archiveHash
      step.archive_signature = archiveSignature
      step.output_storage_path = newPath
    }
  }),
  setSessionC2paManifestId: vi.fn(async (sessionId: string, manifestId: string) => {
    const session = sessions.get(sessionId)
    if (session) session.c2pa_manifest_id = manifestId
  }),
  getCertificateForSession: vi.fn(async (sessionId: string) => [...certificates.values()].find((c) => c.session_id === sessionId) ?? null),
  createCertificate: vi.fn(async (entry: Record<string, unknown>) => {
    const row = { id: nextId('cert'), generated_at: new Date().toISOString(), ...entry }
    certificates.set(row.id as string, row)
    return row
  }),
  lookupGenid: vi.fn(async (genidCode: string) => (genidCode === GENID_CODE ? OWNER : null)),
}))

vi.mock('@/lib/storage', () => ({
  stepStoragePath: (sessionId: string, stepNumber: number, ext: string) => `${sessionId}/step_${stepNumber}.${ext}`,
  archiveStepStoragePath: (sessionId: string, stepNumber: number) => `${sessionId}/step_${stepNumber}_archive.png`,
  c2paExportStoragePath: (sessionId: string) => `${sessionId}/c2pa-export.png`,
  uploadToSessionBucket: vi.fn(async (path: string, buffer: Buffer) => {
    storageFiles.set(path, buffer)
  }),
  downloadFromSessionBucket: vi.fn(async (path: string) => {
    const buf = storageFiles.get(path)
    if (!buf) throw new Error(`fake storage: not found: ${path}`)
    return buf
  }),
  deleteFromSessionBucket: vi.fn(async (path: string) => {
    storageFiles.delete(path)
  }),
}))

let lastAnchorPayload = ''
vi.mock('@/lib/blockchain', () => ({
  stampOnBlockchain: vi.fn(async ({ genidCode, contentHash, fileName }: { genidCode: string; contentHash: string; fileName: string }) => {
    lastAnchorPayload = `GENID:${genidCode}|HASH:${contentHash}|FILE:${fileName}`
    return { txHash: '0xE2EFAKE', network: 'polygon', blockNumber: 1, timestamp: Math.floor(Date.now() / 1000) }
  }),
  verifyOnBlockchain: vi.fn(async () => ({ confirmed: true, payload: lastAnchorPayload, blockNumber: 1 })),
}))

vi.mock('@/lib/c2pa', () => ({
  // C2PA signing needs real certs this test environment doesn't have —
  // exercising its documented non-fatal path is itself part of what this
  // flow should prove (finalize must still succeed without one).
  embedC2paManifest: vi.fn().mockRejectedValue(new Error('no C2PA signing cert configured in this test')),
}))

vi.mock('@/lib/adapters/openai-image', () => ({
  openAiImageAdapter: {
    name: 'fake-e2e-adapter',
    generateImage: vi.fn(async () => {
      const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 12, g: 34, b: 56 } } })
        .png()
        .toBuffer()
      return {
        outputBuffer: buffer,
        mimeType: 'image/png',
        ext: 'png',
        modelUsed: 'fake-e2e-model',
        modelRequestId: 'req-e2e-1',
        requestTimestamp: new Date(),
        responseTimestamp: new Date(),
      }
    }),
  },
}))

import { POST as createSessionRoute } from '@/app/api/session/route'
import { POST as stepRoute } from '@/app/api/session/[id]/step/route'
import { POST as finalizeRoute } from '@/app/api/session/[id]/finalize/route'
import { GET as certificateRoute } from '@/app/api/session/[id]/certificate/route'
import { GET as verifyRoute } from '@/app/api/session/[id]/verify/route'

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('End-to-end: generate -> edit -> finalize -> download -> verify', () => {
  it('produces a session whose certificate and public verification both come back fully valid', async () => {
    // --- 1. Generate ---
    const generateRes = await createSessionRoute(jsonRequest('http://localhost/api/session', { promptText: 'a cat wearing a hat' }))
    expect(generateRes.status).toBe(200)
    const generateBody = await generateRes.json()
    const sessionId: string = generateBody.sessionId
    expect(sessionId).toBeTruthy()
    expect(generateBody.stepId).toBeTruthy()

    // --- 2. Edit (color adjust on step 1) ---
    const editRes = await stepRoute(
      jsonRequest(`http://localhost/api/session/${sessionId}/step`, {
        action: 'edit',
        editType: 'color_adjust',
        params: { brightness: 1.2, saturation: 0.9 },
        userNote: 'brightened it up',
      }),
      { params: Promise.resolve({ id: sessionId }) }
    )
    expect(editRes.status).toBe(200)
    const editBody = await editRes.json()
    expect(editBody.stepId).toBeTruthy()
    expect(editBody.stepNumber).toBe(2)

    // Sanity check on the fake DB directly: two distinct, chained steps.
    const sessionSteps = [...steps.values()].filter((s) => s.session_id === sessionId)
    expect(sessionSteps).toHaveLength(2)
    expect(sessionSteps[1].prior_step_signature).toBe(sessionSteps[0].step_signature)

    // --- 3. Finalize (selecting the edited step as final) ---
    const finalizeRes = await finalizeRoute(
      jsonRequest(`http://localhost/api/session/${sessionId}/finalize`, { stepId: editBody.stepId }),
      { params: Promise.resolve({ id: sessionId }) }
    )
    const finalizeBody = await finalizeRes.json()
    expect(finalizeRes.status, JSON.stringify(finalizeBody)).toBe(200)
    expect(finalizeBody.polygonAnchorTx).toBe('0xE2EFAKE')
    expect(finalizeBody.sessionRootHash).toBeTruthy()
    // C2PA signing was made to fail on purpose — finalize must still succeed.
    expect(finalizeBody.c2paManifestEmbedded).toBe(false)

    const session = sessions.get(sessionId)!
    expect(session.status).toBe('finalized')
    expect(session.final_step_id).toBe(editBody.stepId)
    // The non-final (generate) step should have been archived to a new path.
    const generateStep = sessionSteps.find((s) => s.step_number === 1)!
    expect(generateStep.output_archived).toBe(true)
    expect(generateStep.output_storage_path).toBe(`${sessionId}/step_1_archive.png`)
    // The final step is untouched by archival.
    const finalStepRow = steps.get(editBody.stepId)
    expect(finalStepRow.output_archived).toBe(false)

    // --- 4. Download the certificate ---
    const downloadRes = await certificateRoute(
      new NextRequest(`http://localhost/api/session/${sessionId}/certificate`),
      { params: Promise.resolve({ id: sessionId }) }
    )
    expect(downloadRes.status).toBe(200)
    const pdfBytes = Buffer.from(await downloadRes.arrayBuffer())
    expect(pdfBytes.subarray(0, 4).toString('latin1')).toBe('%PDF') // real pdfkit output

    // --- 5. Verify (public, no-login endpoint) ---
    const verifyRes = await verifyRoute(new NextRequest(`http://localhost/api/session/${sessionId}/verify`), {
      params: Promise.resolve({ id: sessionId }),
    })
    expect(verifyRes.status).toBe(200)
    const verifyBody = await verifyRes.json()

    expect(verifyBody.found).toBe(true)
    expect(verifyBody.finalized).toBe(true)
    expect(verifyBody.stepCount).toBe(2)
    expect(verifyBody.chainValid).toBe(true)
    expect(verifyBody.rootHashValid).toBe(true)
    expect(verifyBody.polygonStatus).toBe('confirmed')
    expect(verifyBody.overallValid).toBe(true)

    // Both steps individually verify — including the archived one, via its
    // archive_hash/archive_signature rather than output_hash.
    for (const step of verifyBody.steps) {
      expect(step.valid, `step ${step.stepNumber} should be valid: ${JSON.stringify(step)}`).toBe(true)
    }
    const archivedStepResult = verifyBody.steps.find((s: { stepNumber: number }) => s.stepNumber === 1)
    expect(archivedStepResult.fileArchived).toBe(true)
    expect(archivedStepResult.archiveIntegrityValid).toBe(true)
  })
})
