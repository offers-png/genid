import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  lookupGenid: vi.fn(),
  getContentHistory: vi.fn(),
  listSessionsForGenid: vi.fn(),
  getSessionSteps: vi.fn(),
  getCertificatesForSessions: vi.fn(),
  deleteSessionRows: vi.fn(),
  anonymizeGenidRecord: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  deleteAllSessionStorageObjects: vi.fn(),
}))
vi.mock('@/lib/apiKeys', () => ({
  listApiKeys: vi.fn(),
  revokeAllApiKeys: vi.fn(),
}))

import {
  lookupGenid,
  getContentHistory,
  listSessionsForGenid,
  getSessionSteps,
  getCertificatesForSessions,
  deleteSessionRows,
  anonymizeGenidRecord,
} from '@/lib/supabase'
import { deleteAllSessionStorageObjects } from '@/lib/storage'
import { listApiKeys, revokeAllApiKeys } from '@/lib/apiKeys'
import { exportAccountData, deleteAccount } from '@/lib/account'

const RECORD = {
  id: '1', genid_code: 'SA12345', user_name: 'Test Creator', self_reported_name: 'Test Creator',
  name_verified: true, email: 'test@example.com', stripe_verification_id: 'vs_1', verified: true,
  created_at: '2026-01-01T00:00:00Z', deleted_at: null,
}

function session(overrides: { id: string; status: 'active' | 'finalizing' | 'finalized' | 'abandoned' }) {
  return {
    genid_code: 'SA12345', content_type: 'image',
    final_step_id: null, session_root_hash: null, polygon_anchor_tx: null,
    polygon_anchor_root_hash: null, identity_verification_tier: 'id_verified',
    c2pa_manifest_id: null, created_at: 'now', finalized_at: null, finalizing_since: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSessionSteps).mockResolvedValue([])
  vi.mocked(getCertificatesForSessions).mockResolvedValue([])
  vi.mocked(getContentHistory).mockResolvedValue([])
  vi.mocked(listApiKeys).mockResolvedValue([])
})

describe('deleteAccount', () => {
  it('fully deletes every active session — storage objects and DB rows', async () => {
    vi.mocked(listSessionsForGenid).mockResolvedValue([
      session({ id: 'active-1', status: 'active' }),
      session({ id: 'active-2', status: 'active' }),
    ])

    const result = await deleteAccount(RECORD)

    expect(deleteAllSessionStorageObjects).toHaveBeenCalledWith('active-1')
    expect(deleteAllSessionStorageObjects).toHaveBeenCalledWith('active-2')
    expect(deleteSessionRows).toHaveBeenCalledWith('active-1')
    expect(deleteSessionRows).toHaveBeenCalledWith('active-2')
    expect(result.deletedSessionCount).toBe(2)
  })

  it('never deletes storage or DB rows for a finalized session', async () => {
    vi.mocked(listSessionsForGenid).mockResolvedValue([session({ id: 'final-1', status: 'finalized' })])

    const result = await deleteAccount(RECORD)

    expect(deleteAllSessionStorageObjects).not.toHaveBeenCalled()
    expect(deleteSessionRows).not.toHaveBeenCalled()
    expect(result.deletedSessionCount).toBe(0)
    expect(result.retainedFinalizedSessionCount).toBe(1)
  })

  it('leaves a finalizing (in-progress) session alone entirely — neither deleted nor counted as retained', async () => {
    vi.mocked(listSessionsForGenid).mockResolvedValue([session({ id: 'inflight-1', status: 'finalizing' })])

    const result = await deleteAccount(RECORD)

    expect(deleteAllSessionStorageObjects).not.toHaveBeenCalled()
    expect(deleteSessionRows).not.toHaveBeenCalled()
    expect(result.deletedSessionCount).toBe(0)
    expect(result.retainedFinalizedSessionCount).toBe(0)
  })

  it('revokes every API key and anonymizes the registry row for this genid_code', async () => {
    vi.mocked(listSessionsForGenid).mockResolvedValue([])

    await deleteAccount(RECORD)

    expect(revokeAllApiKeys).toHaveBeenCalledWith('SA12345')
    expect(anonymizeGenidRecord).toHaveBeenCalledWith('SA12345')
  })
})

describe('exportAccountData', () => {
  it('returns null for an account that no longer exists', async () => {
    vi.mocked(lookupGenid).mockResolvedValue(null)
    const result = await exportAccountData('SA12345')
    expect(result).toBeNull()
  })

  it('returns null for a deleted account rather than exporting a tombstoned record', async () => {
    vi.mocked(lookupGenid).mockResolvedValue({ ...RECORD, deleted_at: '2026-10-01T00:00:00Z' })
    const result = await exportAccountData('SA12345')
    expect(result).toBeNull()
  })

  it('assembles sessions, stamps, and API key metadata (never raw key values) for a live account', async () => {
    vi.mocked(lookupGenid).mockResolvedValue(RECORD)
    vi.mocked(listSessionsForGenid).mockResolvedValue([session({ id: 'session-1', status: 'finalized' })])
    vi.mocked(getSessionSteps).mockResolvedValue([
      {
        id: 'step-1', session_id: 'session-1', step_number: 1, step_type: 'upload', edit_type: null,
        prompt_text: null, model_used: null, model_request_id: null, request_timestamp: 'now',
        response_timestamp: 'now', output_storage_path: 'session-1/step_1.png', output_hash: 'abc',
        prior_step_signature: null, step_hash: 'def', step_signature: 'sig', user_note: null,
        auto_suggested_note: null, is_final_selection: true, output_archived: false, archive_hash: null,
        archive_signature: null, created_at: 'now',
      },
    ])
    vi.mocked(getCertificatesForSessions).mockResolvedValue([
      { id: 'cert-1', session_id: 'session-1', generated_at: 'now', pdf_export_path: 'p', json_export_path: null, c2pa_manifest_embedded: true, public_verify_url: 'https://genid.app/session/verify/session-1', total_steps: 1, total_duration_seconds: 5, content_type: 'image', identity_verification_tier: 'id_verified', final_output_thumbnail_path: null },
    ])
    vi.mocked(listApiKeys).mockResolvedValue([
      { id: 'key-1', genid_code: 'SA12345', key_prefix: 'gk_live_abcd', created_at: 'now', last_used_at: null, revoked_at: null },
    ])

    const result = await exportAccountData('SA12345')

    expect(result?.account.genidCode).toBe('SA12345')
    expect(result?.sessions).toHaveLength(1)
    expect(result?.sessions[0].steps).toHaveLength(1)
    expect(result?.sessions[0].certificate?.id).toBe('cert-1')
    // key_prefix only (enough to tell keys apart) — the export type has no
    // field for a raw key or its hash, since neither is ever queried here.
    expect(result?.apiKeys).toEqual([
      { id: 'key-1', keyPrefix: 'gk_live_abcd', createdAt: 'now', lastUsedAt: null, revokedAt: null },
    ])
  })
})
