'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: 'That sign-in link is missing its token.',
  invalid_or_expired: 'That sign-in link is invalid or has expired. Request a new one below.',
  account_not_found: 'That sign-in link no longer points to an active account.',
  server_error: 'Something went wrong verifying that link. Please try again.',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError('')

    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        setStatus('error')
        return
      }
      setStatus('sent')
    } catch {
      setError('Network error — please try again')
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <div className="w-14 h-14 bg-green-900/50 rounded-full flex items-center justify-center text-2xl mx-auto mb-6">✓</div>
        <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
        <p className="text-gray-400 text-sm">
          If an account exists for <span className="text-gray-300">{email}</span>, a sign-in link has been sent.
          It expires in 15 minutes.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="text-center mb-10">
        <div className="w-14 h-14 bg-violet-600 rounded-xl flex items-center justify-center text-2xl font-bold mx-auto mb-4">G</div>
        <h1 className="text-3xl font-bold text-white mb-2">Sign in</h1>
        <p className="text-gray-400">We&apos;ll email you a one-time sign-in link — no password.</p>
      </div>

      {linkError && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300 mb-6">
          {ERROR_MESSAGES[linkError] ?? 'That sign-in link could not be used.'}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
        />

        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300">{error}</div>
        )}

        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white py-3 rounded-lg font-medium transition-colors"
        >
          {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        No GENID yet? <Link href="/register" className="text-violet-400 hover:text-violet-300">Register →</Link>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-6 py-20 text-center text-gray-400">Loading…</div>}>
      <LoginForm />
    </Suspense>
  )
}
