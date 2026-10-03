import { headers } from 'next/headers'
import { CSRF_TOKEN_HEADER_NAME } from '@/lib/csrf'
import LoginForm from './LoginForm'

// Server Component wrapper — see app/register/page.tsx for why the CSRF
// token has to be rendered server-side into the initial HTML rather than
// fetched client-side.
export default async function LoginPage() {
  const csrfToken = (await headers()).get(CSRF_TOKEN_HEADER_NAME) ?? ''
  return <LoginForm csrfToken={csrfToken} />
}
