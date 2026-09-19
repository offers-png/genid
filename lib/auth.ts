import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { getAdmin, lookupByEmail, type GenidRecord } from './supabase'
import { env } from './env'

// Session ownership (Security & Trust Fix Punch List #4, Sept 18 follow-up).
//
// Before this, "ownership" of a session/genid_code was a bare email string
// passed as a query param or form field — anyone who knew (or guessed) a
// target's email could list their sessions, create sessions under their
// GENID code, or drive their finalize/step endpoints. There was no proof
// the caller actually controlled that email address.
//
// This introduces a two-token scheme:
//  - a MAGIC LINK token: random, single-use, short-lived (15 min), stored
//    hashed in genid_magic_link_tokens. Proves control of an email inbox.
//  - a SESSION token: a signed, stateless cookie (HMAC-SHA256 over a JSON
//    payload) issued once a magic link is consumed. Every route that acts
//    on a session or the registry now derives the caller's identity from
//    this cookie, never from a client-supplied email/genid_code.

export const SESSION_COOKIE_NAME = 'genid_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
export const MAGIC_LINK_TTL_SECONDS = 60 * 15 // 15 minutes

// Registration token (Sept 19 fix, replacing a reusable Stripe verification
// id check — see migration 013). 30 minutes, longer than a magic link's,
// because Stripe document review can genuinely take a while and this token
// has to survive the ENTIRE trip out to Stripe and back, not just a click.
export const REGISTRATION_TOKEN_COOKIE_NAME = 'genid_registration_token'
const REGISTRATION_TOKEN_TTL_SECONDS = 60 * 30 // 30 minutes

// Email confirmation proof (Sept 19 third fix, requiring proof of email
// control BEFORE Stripe verification ever starts — see migration 015).
// This is literally a second magic-link token (createMagicLinkToken /
// consumeMagicLinkToken below), minted right after the first one is
// redeemed, and carried to POST /api/stripe/session as an httpOnly cookie
// rather than a URL param — same reasoning as REGISTRATION_TOKEN_COOKIE_NAME.
export const EMAIL_CONFIRMATION_TOKEN_COOKIE_NAME = 'genid_email_confirmation_token'

export interface SessionPayload {
  email: string
  genidCode: string
  issuedAt: number
  expiresAt: number
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64')
}

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function signSessionToken(payload: SessionPayload): string {
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)))
  const signature = hmac(encodedPayload, env.authSessionSecret)
  return `${encodedPayload}.${signature}`
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encodedPayload, signature] = parts

  const expectedSignature = hmac(encodedPayload, env.authSessionSecret)
  if (expectedSignature.length !== signature.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) return null

  let payload: SessionPayload
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'))
  } catch {
    return null
  }

  if (typeof payload.email !== 'string' || typeof payload.genidCode !== 'string' || typeof payload.expiresAt !== 'number') {
    return null
  }
  if (Date.now() > payload.expiresAt) return null

  return payload
}

export function createSessionToken(email: string, genidCode: string): string {
  const issuedAt = Date.now()
  return signSessionToken({
    email,
    genidCode,
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_SECONDS * 1000,
  })
}

// Resolves the caller's registry record from their session cookie value.
// Re-checks the current registry row (not just the cookie's claims) so a
// session token issued before an email/genid_code change can't outlive it.
export async function resolveSessionCookie(cookieValue: string | undefined): Promise<GenidRecord | null> {
  if (!cookieValue) return null
  const payload = verifySessionToken(cookieValue)
  if (!payload) return null

  const record = await lookupByEmail(payload.email)
  if (!record || record.genid_code !== payload.genidCode) return null
  return record
}

// For API route handlers (NextRequest carries cookies directly).
export async function getAuthenticatedRecord(req: NextRequest): Promise<GenidRecord | null> {
  return resolveSessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value)
}

// ---- Magic link tokens ----

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Always succeeds from the caller's point of view regardless of whether the
// email is registered — the route layer decides what to tell the caller,
// but the token itself is only ever created for a real registry email so a
// stray token row can't be redeemed for an identity that doesn't exist.
export async function createMagicLinkToken(email: string): Promise<string> {
  const token = randomToken()
  const { error } = await getAdmin().from('genid_magic_link_tokens').insert({
    email,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new Error(`Failed to create magic link token: ${error.message}`)
  return token
}

// Rate limiting for magic-link requests (lib/limits.ts) — without this,
// nothing stops repeatedly requesting a link for the same (registered)
// email: an email-bombing vector against that person, and a way to burn
// through the Resend send quota. Counts rows already written by
// createMagicLinkToken for this email in the window, the same
// count-then-compare pattern as countRecentGenerationsForGenid.
export async function countRecentMagicLinkRequestsForEmail(email: string, sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs).toISOString()
  const { count, error } = await getAdmin()
    .from('genid_magic_link_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', since)

  if (error) {
    console.error('Failed to count recent magic link requests (failing open):', error.message)
    return 0
  }
  return count ?? 0
}

// Single-use: the update-with-WHERE-used_at-is-null is the atomic claim, so
// two simultaneous redemptions of the same link can't both succeed.
export async function consumeMagicLinkToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token)
  const admin = getAdmin()

  const { data, error } = await admin
    .from('genid_magic_link_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('email')
    .maybeSingle()

  if (error) throw new Error(`Failed to consume magic link token: ${error.message}`)
  return data?.email ?? null
}

// ---- Registration tokens ----
//
// Replaces a previous, broken design in POST /api/auth/complete-registration
// that compared a client-supplied Stripe verification session id against
// genid_registry.stripe_verification_id: that column is a durable value
// that never changes once set, so anyone who ever learned it (browser
// history, a referrer header, a stray log line) could replay it forever,
// from any browser, to sign in as that registrant. This is single-use and
// short-lived, the same pattern as the magic-link tokens above — the
// difference is delivery: this one is handed to the browser as an httpOnly
// cookie (see POST /api/stripe/session) rather than emailed, and consumed
// by reading that same cookie back rather than a client-supplied field, so
// only the literal browser that received it can ever redeem it.
//
// Sept 19 second fix (migration 014): single-use/short-lived/browser-bound
// alone wasn't enough, because the token was keyed only by email, not by
// WHICH Stripe verification session it was issued alongside.
// POST /api/stripe/session doesn't reject a second registration attempt
// for an email that's merely pending (only a fully-verified one is
// rejected) — so an attacker could start their own registration using a
// victim's email while the victim's real verification is in progress,
// receive their own valid token, and then redeem it once the VICTIM
// finishes verifying, since genid_registry.verified is a plain per-email
// flag with no record of which session flipped it. Recording the
// session id on the token itself, and requiring it to match
// stripe_verification_id (written by the webhook only on an actual
// identity.verification_session.verified event) closes that: a token only
// redeems if ITS OWN session is the one Stripe confirmed, not merely if
// the email ended up verified by way of a different session.

export interface RegistrationTokenClaim {
  email: string
  stripeVerificationSessionId: string | null
}

// Always succeeds regardless of whether the email is already registered —
// same reasoning as createMagicLinkToken: the route layer decides what to
// tell the caller, but a stray row can only ever be redeemed for a real
// registry email.
export async function createRegistrationToken(email: string, stripeVerificationSessionId: string): Promise<string> {
  const token = randomToken()
  const { error } = await getAdmin().from('genid_registration_tokens').insert({
    email,
    token_hash: hashToken(token),
    stripe_verification_session_id: stripeVerificationSessionId,
    expires_at: new Date(Date.now() + REGISTRATION_TOKEN_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new Error(`Failed to create registration token: ${error.message}`)
  return token
}

// Single-use via the same atomic UPDATE ... WHERE used_at IS NULL claim as
// consumeMagicLinkToken — two near-simultaneous redemptions (e.g. a
// double-submitted request) can't both succeed. Returns the session id
// this specific token was issued for, alongside its email, so the caller
// can check that THAT session (not just the email in general) was verified.
export async function consumeRegistrationToken(token: string): Promise<RegistrationTokenClaim | null> {
  const tokenHash = hashToken(token)
  const admin = getAdmin()

  const { data, error } = await admin
    .from('genid_registration_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('email, stripe_verification_session_id')
    .maybeSingle()

  if (error) throw new Error(`Failed to consume registration token: ${error.message}`)
  if (!data) return null
  return { email: data.email, stripeVerificationSessionId: data.stripe_verification_session_id ?? null }
}
