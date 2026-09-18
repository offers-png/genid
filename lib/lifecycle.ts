import sharp from 'sharp'
import { getSession, getSessionSteps, markStepArchived } from './supabase'
import { downloadFromSessionBucket, uploadToSessionBucket } from './storage'
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

    const original = await downloadFromSessionBucket(step.output_storage_path)
    const compressed = await sharp(original)
      .resize({
        width: ARCHIVE_MAX_DIMENSION,
        height: ARCHIVE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()

    await uploadToSessionBucket(step.output_storage_path, compressed, 'image/png', { upsert: true })

    const archiveHash = hashBuffer(compressed)
    const archiveContent = buildArchiveContent(sessionId, step.id, step.output_hash ?? '', archiveHash)
    const archiveSignature = signStepHash(archiveContent, env.genidSigningSecret)
    await markStepArchived(step.id, archiveHash, archiveSignature)

    result.bytesBefore += original.length
    result.bytesAfter += compressed.length
    result.archivedCount++
  }

  return result
}
