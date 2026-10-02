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
// Magic-link requests are cheap to issue but not to receive — this bounds
// both the email-bombing surface against a registered user and the
// Resend send volume one email address can trigger.
export const MAGIC_LINK_RATE_LIMIT = 5
export const MAGIC_LINK_RATE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
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

export const EMBED_RATE_LIMIT = 20
export const EMBED_RATE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

// /api/verify is deliberately open to anonymous third parties (Build Spec
// Section 5.3 — no GenID account needed to check a file) — there's no
// durable identity to key a DB-backed count on the way the authenticated
// endpoints above do. IP is the only dimension available.
export const VERIFY_RATE_LIMIT = 20
export const VERIFY_RATE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

// Sept 30 fix: /api/register/start and /api/auth/confirm-registration were
// only rate-limited per email (MAGIC_LINK_RATE_LIMIT) — nothing stopped
// one IP from driving that same per-email budget across many different
// (disposable) addresses, each ending in a billed Stripe Identity
// verification session. There's no login yet at either of these steps, so
// like /api/verify, IP is the only dimension available. Tighter than
// VERIFY_RATE_LIMIT since each hit here is a real Resend send and can end
// in a real Stripe charge, not a free read.
export const REGISTRATION_IP_RATE_LIMIT = 10
export const REGISTRATION_IP_RATE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

const RATE_LIMIT_MAX_TRACKED_KEYS = 10_000
const rateLimitBuckets = new Map<string, number[]>()

function pruneRateLimitBuckets(windowMs: number): void {
  if (rateLimitBuckets.size < RATE_LIMIT_MAX_TRACKED_KEYS) return
  const now = Date.now()
  for (const [key, timestamps] of rateLimitBuckets) {
    const fresh = timestamps.filter((t) => now - t < windowMs)
    if (fresh.length === 0) rateLimitBuckets.delete(key)
    else rateLimitBuckets.set(key, fresh)
  }
}

// In-memory sliding-window limiter for endpoints with no durable identity
// to key a DB-backed count on. Per-process: resets on restart/redeploy and
// doesn't share state across horizontally-scaled instances — an accepted
// tradeoff for a public endpoint with no login, not a guarantee against a
// determined, distributed abuser. Authenticated endpoints use a DB-backed
// count instead (e.g. countRecentGenerationsForGenid in lib/supabase.ts)
// so that limit actually holds across restarts and instances.
export function checkInMemoryRateLimit(key: string, limit: number, windowMs: number): boolean {
  pruneRateLimitBuckets(windowMs)
  const now = Date.now()
  const timestamps = (rateLimitBuckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (timestamps.length >= limit) {
    rateLimitBuckets.set(key, timestamps)
    return false
  }
  timestamps.push(now)
  rateLimitBuckets.set(key, timestamps)
  return true
}

// Render (like most PaaS hosts) sets x-forwarded-for on requests proxied
// to the app; this is the standard, if spoofable-behind-no-proxy, way to
// read it. Falls back to a shared "unknown" bucket rather than throwing —
// worst case that bucket is a little tighter for everyone behind an
// unrecognized proxy, not a broken endpoint.
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

// CSRF defense for anonymous, pre-login POST endpoints (StackHawk "Anti
// CSRF Tokens Scanner" finding, Oct 2026 — flagged on /register and
// /login's forms). Those endpoints have no session cookie yet to protect
// with a SameSite attribute or a server-issued token, so this checks the
// request actually came from this app's own pages rather than a
// cross-origin page auto-submitting one. Real browsers send Origin (and/or
// Referer) on same-origin POSTs; a mismatch on either is a clear forgery
// signal. Neither header present at all is left to pass — some privacy
// proxies/extensions strip both on otherwise-legitimate requests, and
// rejecting those would turn a defense-in-depth check (these routes are
// JSON-body, no-CORS, so a true cross-origin form POST can't reach them
// anyway) into a way to break real users' registration/sign-in.
export function isSameOriginRequest(req: { headers: { get(name: string): string | null } }, appUrl: string): boolean {
  const origin = req.headers.get('origin')
  if (origin) return origin === appUrl

  const referer = req.headers.get('referer')
  if (referer) return referer.startsWith(`${appUrl}/`) || referer === appUrl

  return true
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
