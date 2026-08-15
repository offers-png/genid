import { getAdmin } from './supabase'

// Supabase Storage layer for session step output files (Build Spec Section 7,
// folded into Phase 1 since the session write path needs it immediately).
// Bucket is private — every read goes through an API route using the
// service-role key, never a direct client-side fetch.

const BUCKET = 'genid-sessions'

export function stepStoragePath(sessionId: string, stepNumber: number, ext: string): string {
  return `${sessionId}/step_${stepNumber}.${ext}`
}

// Generic upload/download against the session bucket — used for step output
// files (via stepStoragePath) and for certificate PDFs alike.
export async function uploadToSessionBucket(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const { error } = await getAdmin()
    .storage.from(BUCKET)
    .upload(path, buffer, { contentType, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

export async function downloadFromSessionBucket(path: string): Promise<Buffer> {
  const { data, error } = await getAdmin().storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'not found'}`)
  return Buffer.from(await data.arrayBuffer())
}
