import sharp from 'sharp'

// Resource limits (Sept 18 second follow-up, "Add resource limits").
// Every one of these guards a real cost or resource-exhaustion path:
// prompts and edit params reach paid external APIs / CPU-bound image
// processing with no prior bound; uploads reach the LSB embed/extract
// routines, whose cost scales with pixel count.

export class ValidationError extends Error {}

export const PROMPT_MAX_LENGTH = 2000
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15MB
export const MAX_IMAGE_DIMENSION_PX = 8000 // either side
export const GENERATION_RATE_LIMIT = 10
export const GENERATION_RATE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
export const EXTERNAL_CALL_TIMEOUT_MS = 60_000
// Shorter bound for read-only chain lookups on the public verify page —
// a slow RPC shouldn't hang a page load a third party is waiting on.
export const BLOCKCHAIN_READ_TIMEOUT_MS = 15_000

export function validatePromptText(promptText: unknown): string {
  if (typeof promptText !== 'string') throw new ValidationError('promptText must be a string')
  const trimmed = promptText.trim()
  if (trimmed.length === 0) throw new ValidationError('promptText cannot be empty')
  if (trimmed.length > PROMPT_MAX_LENGTH) {
    throw new ValidationError(`promptText cannot exceed ${PROMPT_MAX_LENGTH} characters (got ${trimmed.length})`)
  }
  return trimmed
}

export function validateUploadSize(byteLength: number): void {
  if (byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`Upload exceeds the maximum size of ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`)
  }
  if (byteLength === 0) {
    throw new ValidationError('Upload is empty')
  }
}

// Catches both "absurdly large, will blow up memory/CPU in sharp" and
// unreadable/corrupt files before they reach the actual LSB routines.
export async function validateImageDimensions(buffer: Buffer): Promise<void> {
  let meta: sharp.Metadata
  try {
    meta = await sharp(buffer).metadata()
  } catch {
    throw new ValidationError('Could not read image — file may be corrupt or an unsupported format')
  }
  if (!meta.width || !meta.height) {
    throw new ValidationError('Could not read image dimensions')
  }
  if (meta.width > MAX_IMAGE_DIMENSION_PX || meta.height > MAX_IMAGE_DIMENSION_PX) {
    throw new ValidationError(`Image dimensions cannot exceed ${MAX_IMAGE_DIMENSION_PX}px on either side (got ${meta.width}x${meta.height})`)
  }
}

// Races a promise against a timeout so a hung external call (model
// provider, blockchain RPC) can't hold a request open indefinitely.
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
