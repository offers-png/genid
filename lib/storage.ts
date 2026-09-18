import { getAdmin } from './supabase'

// Supabase Storage layer for session step output files (Build Spec Section 7,
// folded into Phase 1 since the session write path needs it immediately).
// Bucket is private — every read goes through an API route using the
// service-role key, never a direct client-side fetch.

const BUCKET = 'genid-sessions'

export function stepStoragePath(sessionId: string, stepNumber: number, ext: string): string {
  return `${sessionId}/step_${stepNumber}.${ext}`
}

// A distinct path for a step's compressed archival copy (lib/lifecycle.ts)
// — never the same object as the original. Archival uploads here FIRST,
// then atomically repoints the step's output_storage_path column at this
// path, then deletes the original — see markStepArchived. Never reusing
// the original path means a crash before that DB write can't leave a
// mismatched file sitting under a path the DB still thinks is the original.
export function archiveStepStoragePath(sessionId: string, stepNumber: number): string {
  return `${sessionId}/step_${stepNumber}_archive.png`
}

export function c2paExportStoragePath(sessionId: string): string {
  return `${sessionId}/c2pa-export.png`
}

// Generic upload/download against the session bucket — used for step output
// files (via stepStoragePath) and for certificate/C2PA exports alike.
// upsert defaults to false for step outputs, whose whole point is
// immutability once written; the finalize route passes upsert: true for
// the certificate PDF and C2PA export, which are safe (and need) to
// regenerate on a retry.
export async function uploadToSessionBucket(
  path: string,
  buffer: Buffer,
  contentType: string,
  opts?: { upsert?: boolean }
): Promise<void> {
  const { error } = await getAdmin()
    .storage.from(BUCKET)
    .upload(path, buffer, { contentType, upsert: opts?.upsert ?? false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

export async function downloadFromSessionBucket(path: string): Promise<Buffer> {
  const { data, error } = await getAdmin().storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'not found'}`)
  return Buffer.from(await data.arrayBuffer())
}

// Best-effort cleanup — callers treat a failure here as non-fatal (a
// leftover object wastes storage but never corrupts anything the DB
// references, since it's only ever called after the DB has already been
// repointed away from this path).
export async function deleteFromSessionBucket(path: string): Promise<void> {
  const { error } = await getAdmin().storage.from(BUCKET).remove([path])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}

// Durable record of a storage path no longer referenced by any DB row, for
// scripts/sweep-orphaned-storage.mjs (or any future cleanup job) to find
// and remove later (Sept 18 fourth follow-up, "Fix orphaned storage
// cleanup"). A plain console.error isn't enough on its own — production
// logs aren't reliably retained or queryable, so a path logged only there
// is effectively lost. The insert itself is best-effort: if even that
// fails, this still falls back to console.error as the last resort.
export async function recordOrphanedStoragePath(
  path: string,
  reason: string,
  sessionId: string | null = null
): Promise<void> {
  const { error } = await getAdmin()
    .from('genid_orphaned_storage_log')
    .insert({ storage_path: path, reason, session_id: sessionId })

  if (error) {
    console.error(`Failed to record orphaned storage path ${path} (reason: ${reason}):`, error.message)
  }
}

// Deletes a path known to no longer be referenced by any DB row; if the
// delete itself fails, records it instead of silently leaving it behind.
export async function cleanupOrphanedPath(path: string, reason: string, sessionId: string | null = null): Promise<void> {
  try {
    await deleteFromSessionBucket(path)
  } catch (err) {
    console.error(`Failed to delete orphaned storage path ${path} (reason: ${reason}), logging for later sweep:`, err)
    await recordOrphanedStoragePath(path, reason, sessionId)
  }
}

// Sums the size of every object stored under a session's prefix (step
// outputs, the certificate PDF, the C2PA export) — the basic per-session
// storage-cost visibility called for in Build Spec Section 7.1.4.
export async function getSessionStorageBytes(sessionId: string): Promise<number> {
  const { data, error } = await getAdmin().storage.from(BUCKET).list(sessionId)
  if (error || !data) return 0
  return data.reduce((sum, file) => sum + (file.metadata?.size ?? 0), 0)
}
