import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { CSRF_COOKIE_NAME, CSRF_COOKIE_MAX_AGE_SECONDS, CSRF_TOKEN_HEADER_NAME } from '@/lib/csrf'

// Narrowly scoped to GET /register and GET /login (see matcher below) — this
// is NOT a site-wide CSP/nonce proxy. Keeping it scoped avoids the exact
// collision risk flagged in the Oct 2026 HawkScan review: a broad nonce-
// based CSP here would fight whatever CSP the Render/Cloudflare edge is
// already injecting (confirmed by grepping this repo — nothing in app code
// sets that header), breaking Next's own inline hydration scripts. This
// proxy never touches Content-Security-Policy at all.
//
// Issues a fresh CSRF token on every GET to /register or /login: set as an
// httpOnly cookie (read back and compared server-side on the POST to
// /api/register/start or /api/auth/request-link — see lib/csrf.ts) and
// forwarded as a request header so each page's Server Component can embed
// the SAME value into a hidden <input> in the initial server-rendered HTML.
// That's required, not optional — StackHawk's Anti-CSRF Tokens rule does a
// plain (non-JS) fetch of the page and checks for a token literally present
// in that raw HTML; a token added after hydration (e.g. via a client-side
// useEffect fetch) would never be seen by it, and wouldn't be a real
// double-submit defense either, since nothing would bind it to this
// response's Set-Cookie.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (request.method !== 'GET' || (pathname !== '/register' && pathname !== '/login')) {
    return NextResponse.next()
  }

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(CSRF_TOKEN_HEADER_NAME, token)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
  })
  return response
}

export const config = {
  matcher: ['/register', '/login'],
}
