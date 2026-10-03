import { headers } from 'next/headers'
import { CSRF_TOKEN_HEADER_NAME } from '@/lib/csrf'
import RegisterForm from './RegisterForm'

// Server Component wrapper — reads the per-request CSRF token proxy.ts
// generated for this GET and renders it into RegisterForm's hidden input,
// so the token is present in the initial server-rendered HTML (required:
// see proxy.ts for why a client-side-only token wouldn't satisfy either
// the scanner or the double-submit defense itself). headers() is a
// dynamic API, so this page is rendered per-request rather than statically
// — expected and fine for a low-traffic auth page.
export default async function RegisterPage() {
  const csrfToken = (await headers()).get(CSRF_TOKEN_HEADER_NAME) ?? ''
  return <RegisterForm csrfToken={csrfToken} />
}
