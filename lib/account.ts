import {
  lookupGenid,
  getContentHistory,
  listSessionsForGenid,
  getSessionSteps,
  getCertificatesForSessions,
  deleteSessionRows,
  anonymizeGenidRecord,
  type GenidRecord,
} from './supabase'
import { deleteAllSessionStorageObjects } from './storage'
import { listApiKeys, revokeAllApiKeys } from './apiKeys'

// Account data export & deletion (Oct 2026 compliance pass) — see
// DATA_RETENTION.md "Account & session deletion" for the design tension
// this works within: finalized sessions carry hash-chained, possibly
// Polygon-anchored proof a third party may already be relying on, so
// deletion can't mean "drop every row for this genid_code" the way it
// safely can for a session that was never finalized.

export interface AccountExport {
  exportedAt: string
  account: {
    genidCode: string
    userName: string
    selfReportedName: string | null
    nameVerified: boolean
    email: string
    verified: boolean
    createdAt: string
  }
  sessions: Array<{
    id: string
    contentType: string
    status: string
    createdAt: string
    finalizedAt: string | null
    sessionRootHash: string | null
    polygonAnchorTx: string | null
    steps: Array<{
      id: string
      stepNumber: number
      stepType: string
      promptText: string | null
      outputHash: string | null
      isFinalSelection: boolean
      createdAt: string
    }>
    certificate: {
      id: string
      generatedAt: string
      publicVerifyUrl: string | null
      c2paManifestEmbedded: boolean
    } | null
  }>
  stamps: Array<{
    id: string
    contentHash: string
    fileName: string | null
    fileType: string | null
    blockchainTxHash: string | null
    createdAt: string
  }>
  apiKeys: Array<{
    id: string
    keyPrefix: string
    createdAt: string
    lastUsedAt: string | null
    revokedAt: string | null
  }>
}

// Everything this identity's own records contain, in one JSON document —
// the self-service counterpart to a GDPR/CCPA data access request. Raw API
// key secrets are never included (they're not recoverable even by us —
// only key_hash is stored, per lib/apiKeys.ts); key_prefix is enough to
// identify which key is which.
export async function exportAccountData(genidCode: string): Promise<AccountExport | null> {
  const record = await lookupGenid(genidCode)
  if (!record || record.deleted_at) return null

  const [sessions, stamps, apiKeys] = await Promise.all([
    listSessionsForGenid(genidCode),
    getContentHistory(genidCode),
    listApiKeys(genidCode),
  ])

  const certificates = await getCertificatesForSessions(sessions.map((s) => s.id))
  const certificateBySession = new Map(certificates.map((c) => [c.session_id, c]))

  const sessionsWithSteps = await Promise.all(
    sessions.map(async (session) => {
      const steps = await getSessionSteps(session.id)
      const certificate = certificateBySession.get(session.id)
      return {
        id: session.id,
        contentType: session.content_type,
        status: session.status,
        createdAt: session.created_at,
        finalizedAt: session.finalized_at,
        sessionRootHash: session.session_root_hash,
        polygonAnchorTx: session.polygon_anchor_tx,
        steps: steps.map((step) => ({
          id: step.id,
          stepNumber: step.step_number,
          stepType: step.step_type,
          promptText: step.prompt_text,
          outputHash: step.output_hash,
          isFinalSelection: step.is_final_selection,
          createdAt: step.created_at,
        })),
        certificate: certificate
          ? {
              id: certificate.id,
              generatedAt: certificate.generated_at,
              publicVerifyUrl: certificate.public_verify_url,
              c2paManifestEmbedded: certificate.c2pa_manifest_embedded,
            }
          : null,
      }
    })
  )

  return {
    exportedAt: new Date().toISOString(),
    account: {
      genidCode: record.genid_code,
      userName: record.user_name,
      selfReportedName: record.self_reported_name ?? null,
      nameVerified: record.name_verified ?? false,
      email: record.email,
      verified: record.verified,
      createdAt: record.created_at,
    },
    sessions: sessionsWithSteps,
    stamps: stamps.map((s) => ({
      id: s.id,
      contentHash: s.content_hash,
      fileName: s.file_name,
      fileType: s.file_type,
      blockchainTxHash: s.blockchain_tx_hash,
      createdAt: s.created_at,
    })),
    apiKeys: apiKeys.map((k) => ({
      id: k.id,
      keyPrefix: k.key_prefix,
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
    })),
  }
}

export interface DeleteAccountResult {
  deletedSessionCount: number
  retainedFinalizedSessionCount: number
}

// Deletes everything that's safe to delete outright, and is explicit about
// the one category it does not touch:
//
//  - ACTIVE (never-finalized) sessions: fully deleted — DB rows AND
//    storage objects. Nothing outside GenID could be relying on a session
//    that was never certified.
//  - FINALIZED sessions: DB rows and storage objects are left untouched.
//    lib/verify.ts downloads and rehashes a finalized step's stored file
//    to prove it hasn't been tampered with — deleting that file would make
//    a legitimate certificate start reporting as unverified/tampered
//    instead of "content withheld by creator request," which is a more
//    misleading outcome than not deleting it. Properly distinguishing
//    "deliberately withdrawn" from "tampered" in lib/verify.ts is real,
//    separate work (a new column + a third verification outcome, not a
//    boolean) — noted in DATA_RETENTION.md as a follow-up, not silently
//    skipped.
//  - The account record itself: anonymized (name + email cleared to a
//    tombstone), not deleted — genid_code stays live because
//    genid_sessions/genid_steps/genid_certificates reference it, and any
//    already-finalized certificate's public verify page reads the
//    registry row live, so this anonymization takes effect there too.
//  - All API keys: revoked.
//  - The session cookie: the caller (the route handler) clears it after
//    this returns, since deleted_at now makes resolveSessionCookie reject
//    it anyway.
export async function deleteAccount(record: GenidRecord): Promise<DeleteAccountResult> {
  const sessions = await listSessionsForGenid(record.genid_code)
  const activeSessions = sessions.filter((s) => s.status === 'active')
  const finalizedSessions = sessions.filter((s) => s.status === 'finalized')

  for (const session of activeSessions) {
    await deleteAllSessionStorageObjects(session.id)
    await deleteSessionRows(session.id)
  }

  await revokeAllApiKeys(record.genid_code)
  await anonymizeGenidRecord(record.genid_code)

  return {
    deletedSessionCount: activeSessions.length,
    retainedFinalizedSessionCount: finalizedSessions.length,
  }
}
