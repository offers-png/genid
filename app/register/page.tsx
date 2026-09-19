'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Step = 'form' | 'awaiting_confirmation'

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: 'That confirmation link is missing its token.',
  invalid_or_expired: 'That confirmation link is invalid or has expired. Request a new one below.',
  account_not_found: 'That confirmation link no longer points to a registration in progress.',
  server_error: 'Something went wrong confirming that link. Please try again.',
}

function RegisterForm() {
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error')

  const [step, setStep] = useState<Step>('form')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const checkRes = await fetch(`/api/genid/issue?email=${encodeURIComponent(email)}`)
      if (checkRes.ok) {
        window.location.href = `/register/callback?email=${encodeURIComponent(email)}`
        return
      }
    } catch {
      // not found, continue to registration
    }

    try {
      // Identity verification doesn't start yet — this only reserves the
      // registry row and sends a confirmation link to this email. Stripe
      // isn't involved until that link is clicked (Sept 19 third fix —
      // nothing here proved the submitter controls this inbox before).
      const res = await fetch('/api/register/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          window.location.href = `/register/callback?email=${encodeURIComponent(email)}`
          return
        }
        setError(data.error ?? 'Something went wrong')
        setLoading(false)
        return
      }

      setStep('awaiting_confirmation')
      setLoading(false)
    } catch {
      setError('Network error — please try again')
      setLoading(false)
    }
  }

  if (step === 'awaiting_confirmation') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-14 h-14 bg-green-900/50 rounded-full flex items-center justify-center text-2xl mx-auto mb-6">✓</div>
        <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
        <p className="text-gray-400 text-sm">
          We sent a confirmation link to <span className="text-gray-300">{email}</span>. Click it to continue —
          it expires in 15 minutes. Identity verification with Stripe starts right after.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-20">
      <div className="text-center mb-10">
        <div className="w-14 h-14 bg-violet-600 rounded-xl flex items-center justify-center text-2xl font-bold mx-auto mb-4">G</div>
        <h1 className="text-3xl font-bold text-white mb-2">Get Your GENID</h1>
        <p className="text-gray-400">Confirm your email, then verify your identity once. Stamp your AI content forever.</p>
      </div>

      {linkError && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300 mb-6">
          {ERROR_MESSAGES[linkError] ?? 'That confirmation link could not be used.'}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
          <input
            type="text"
            required
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Your full name"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
          />
          <p className="text-xs text-gray-500 mt-1">Your GENID will start with the first 2 letters (e.g. SA11212)</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>
        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300">{error}</div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
        >
          {loading ? 'Sending...' : 'Confirm Email to Continue →'}
        </button>
        <div className="pt-2 space-y-2">
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <span className="text-green-500 mt-0.5">✓</span>
            <span>Confirm your email first — takes a few seconds</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <span className="text-green-500 mt-0.5">✓</span>
            <span>Then government ID + selfie verification — takes 2 minutes</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <span className="text-green-500 mt-0.5">✓</span>
            <span>One-time process — your GENID is yours permanently</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <span className="text-green-500 mt-0.5">✓</span>
            <span>$1.50 identity verification fee charged by Stripe</span>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="max-w-lg mx-auto px-6 py-20 text-center text-gray-400">Loading…</div>}>
      <RegisterForm />
    </Suspense>
  )
}
