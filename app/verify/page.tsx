import { headers } from 'next/headers'
import { CSRF_TOKEN_HEADER_NAME } from '@/lib/csrf'
import VerifyForm from './VerifyForm'

// Server Component wrapper — see app/register/page.tsx for why the CSRF
// token has to be rendered server-side into the initial HTML rather than
// fetched client-side. This page's token is scanner-driven, not
// risk-driven (see proxy.ts) — /api/verify is public and anonymous with
// no session-bound side effect to protect.
export default async function VerifyPage() {
  const csrfToken = (await headers()).get(CSRF_TOKEN_HEADER_NAME) ?? ''
  return <VerifyForm csrfToken={csrfToken} />
}
