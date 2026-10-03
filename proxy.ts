import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { CSRF_COOKIE_NAME, CSRF_COOKIE_MAX_AGE_SECONDS, CSRF_TOKEN_HEADER_NAME } from '@/lib/csrf'

// Two independent concerns live here, merged from two parallel fixes
// (Oct 2 security pass + Oct 2026 HawkScan CSRF follow-up) — kept as one
// file only because Next.js allows exactly one proxy.ts, not because
// they're related:
//
// 1. CSP + nonce (originally authored against commit 1e305ad, see
//    SECURITY-FIX-HANDOFF.md): every matched response gets a strict,
//    per-request-nonce'd Content-Security-Policy, replacing the static
//    fallback policy next.config.ts sets for anything this proxy doesn't
//    touch. style-src keeps 'unsafe-inline' deliberately — the dashboard
//    storage-usage bar (app/dashboard/storage/page.tsx) sets a computed
//    width via a React inline style attribute, which nonces can't cover
//    (CSP has no nonce mechanism for the style="" attribute itself, only
//    for <style> elements) — narrowing further would need converting that
//    one spot to a <style nonce> block instead.
//
// 2. CSRF double-submit token, GET /register and GET /login only: issues
//    a token as an httpOnly cookie, forwarded as a request header so each
//    page's Server Component can render it into a hidden <input> in the
//    initial HTML (see lib/csrf.ts for why that has to happen server-side
//    rather than client-side). This never touches Content-Security-Policy
//    — it reuses whatever this function already produces for every path,
//    so there's no second, competing CSP header in play.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const nonce = randomBytes(32).toString('base64')
  const dev = process.env.NODE_ENV === 'development'
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Image previews and React components use inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  const headers = new Headers(request.headers)
  headers.set('Content-Security-Policy', csp)
  headers.set('x-nonce', nonce)

  const isCsrfTokenPage = request.method === 'GET' && (pathname === '/register' || pathname === '/login')
  let csrfToken: string | null = null
  if (isCsrfTokenPage) {
    csrfToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
    headers.set(CSRF_TOKEN_HEADER_NAME, csrfToken)
  }

  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('Cache-Control', 'private, no-store')

  if (csrfToken) {
    response.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
    })
  }

  return response
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)'],
}
