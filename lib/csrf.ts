import crypto from 'crypto'

// Double-submit-cookie CSRF tokens for the two pre-login forms (/register,
// /login) that StackHawk's Anti CSRF Tokens Scanner flagged (CWE-352, Oct
// 2026). Neither form has a session cookie to protect with SameSite — this
// is the standalone mechanism: proxy.ts issues a token as an httpOnly
// cookie on GET and forwards it to the page as a header so it can be
// rendered into a hidden <input> in the initial HTML; the POST handler
// below confirms the submitted value matches the cookie the browser still
// holds. A cross-origin page can submit a guessed/stale value but can't
// read this cookie to produce a matching one.
export const CSRF_COOKIE_NAME = 'genid_csrf'
export const CSRF_TOKEN_HEADER_NAME = 'x-csrf-token'
export const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 // 1 hour — generous for a slow form fill

export function isValidCsrfToken(
  req: { cookies: { get(name: string): { value: string } | undefined } },
  submittedToken: unknown
): boolean {
  if (typeof submittedToken !== 'string' || submittedToken.length === 0) return false

  const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value
  if (!cookieToken) return false

  const a = Buffer.from(cookieToken)
  const b = Buffer.from(submittedToken)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
