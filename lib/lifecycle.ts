import sharp from 'sharp'
import { getSession, getSessionSteps, markStepArchived } from './supabase'
import { downloadFromSessionBucket, uploadToSessionBucket, deleteFromSessionBucket, archiveStepStoragePath, recordOrphanedStoragePath } from './storage'
import { hashBuffer } from './steganography'
import { signStepHash, buildArchiveContent } from './chain'
import { env } from './env'

// Storage lifecycle (Build Spec Section 7). Only ever touches NON-final
// steps of an already-FINALIZED session — the selected output and every
// step of an in-progress session stay full-resolution.
//
// output_hash is never recomputed or rewritten here. It stays a permanent
// record of the ORIGINAL file's hash; after archival it will no longer
// match a re-hash of the (now compressed) stored file, and that's expected
// — see the output_archived column and lib/verify.ts, which treats that
// specific mismatch as "archived," not "tampered."
//
// That doesn't mean the compressed file's integrity goes unchecked, though
// — archive_hash/archive_signature (computed here, over the COMPRESSED
// bytes) are what lib/verify.ts checks an archived step's CURRENT file
// against, so a step being archived doesn't mean its stored file can be
// swapped for anything post-archival and still read as verified.
//
// RECOVERABILITY: the compressed copy is uploaded to its OWN path (never
// overwriting the original in place), hashed from the exact bytes just
// uploaded, and only THEN is the DB updated — atomically flipping
// output_archived/archive_hash/archive_signature/output_storage_path
// together in one write (markStepArchived). Only after that write commits
// is the original file deleted, best-effort. A crash at any point before
// the DB write leaves the original step completely unchanged and safely
// retriable (nothing has been overwritten yet); a crash after leaves a
// harmless leftover original file for a later cleanup pass, never a
// mismatch between what the DB claims and what's actually stored.
//
// Compression choice: resize to a max 512px edge and re-encode as an
// adaptive-palette PNG. These are rejected/superseded drafts a user chose
// not to publish, not the deliverable — recognizable in a version-history
// thumbnail is all they need to remain.
const ARCHIVE_MAX_DIMENSION = 512

export interface ArchiveResult {
  archivedCount: number
  skippedCount: number
  bytesBefore: number
  bytesAfter: number
}

export async function archiveNonFinalSteps(sessionId: string): Promise<ArchiveResult> {
  const session = await getSession(sessionId)
  if (!session || session.status !== 'finalized') {
    throw new Error('Can only archive steps of a finalized session')
  }

  const steps = await getSessionSteps(sessionId)
  const result: ArchiveResult = { archivedCount: 0, skippedCount: 0, bytesBefore: 0, bytesAfter: 0 }

  for (const step of steps) {
    if (step.is_final_selection || step.output_archived || !step.output_storage_path) {
      result.skippedCount++
      continue
    }

    const originalPath = step.output_storage_path
    const original = await downloadFromSessionBucket(originalPath)
    const compressed = await sharp(original)
      .resize({
        width: ARCHIVE_MAX_DIMENSION,
        height: ARCHIVE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()

    // Upload to a NEW path first — the original at originalPath is not
    // touched yet, so failure anywhere up to and including this line
    // leaves the step exactly as it was before this loop iteration.
    const archivePath = archiveStepStoragePath(sessionId, step.step_number)
    await uploadToSessionBucket(archivePath, compressed, 'image/png', { upsert: true })

    const archiveHash = hashBuffer(compressed)
    const archiveContent = buildArchiveContent(sessionId, step.id, step.output_hash ?? '', archiveHash)
    const archiveSignature = signStepHash(archiveContent, env.genidSigningSecret)
    // This is the durable commit point: output_storage_path now points at
    // the compressed file, alongside the hash/signature that prove it.
    await markStepArchived(step.id, archiveHash, archiveSignature, archivePath)

    // Only now remove the original — the DB no longer references it, so a
    // failure here just wastes storage rather than losing anything.
    try {
      await deleteFromSessionBucket(originalPath)
    } catch (deleteErr) {
      console.error(`Failed to delete original file after archiving step ${step.id} (non-fatal, leftover storage):`, deleteErr)
      await recordOrphanedStoragePath(originalPath, `archive delete failed for step ${step.id}`, sessionId)
    }

    result.bytesBefore += original.length
    result.bytesAfter += compressed.length
    result.archivedCount++
  }

  return result
}
