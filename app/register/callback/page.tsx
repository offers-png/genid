'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Status = 'polling' | 'success' | 'timeout' | 'error'

interface RegistrationResult {
  genid_code: string
  user_name: string
  verified: boolean
  created_at: string
}

function CallbackContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const [status, setStatus] = useState<Status>('polling')
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const [attempts, setAttempts] = useState(0)

  const MAX_ATTEMPTS = 20      // 20 attempts
  const POLL_INTERVAL = 3000   // every 3 seconds = 60 seconds max

  useEffect(() => {
    if (!email) {
      setStatus('error')
      return
    }

    let cancelled = false
    let attemptCount = 0

    async function poll() {
      if (cancelled) return

      attemptCount++
      setAttempts(attemptCount)

      if (attemptCount > MAX_ATTEMPTS) {
        setStatus('timeout')
        return
      }

      try {
        const res = await fetch(`/api/genid/issue?email=${encodeURIComponent(email)}`)
        if (res.ok) {
          const data = await res.json()
          if (data.verified) {
            setResult(data)
            setStatus('success')
            return
          }
        }
      } catch {
        // network error, keep polling
      }

      setTimeout(poll, POLL_INTERVAL)
    }

    poll()

    return () => { cancelled = true }
  }, [email])

  if (status === 'success' && result) {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl">✓</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Your GENID is Ready</h1>
        <p className="text-gray-400 mb-8">Identity verified. Your creator ID is permanently issued.</p>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 mb-8">
          <p className="text-gray-400 text-sm mb-2">Your GENID Code</p>
          <p className="text-4xl font-mono font-bold text-violet-400">{result.genid_code}</p>
          <p className="text-gray-500 text-sm mt-3">Issued to {result.user_name} · Identity Verified</p>
        </div>
        <a href="/embed" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors">
          Stamp Your First Image →
        </a>
      </div>
    )
  }

  if (status === 'timeout') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl">⏱</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-4">Verification In Progress</h2>
        <p className="text-gray-400 mb-6">
          Stripe is still processing your documents. This can take a few minutes.
          Your GENID has been reserved — check back soon.
        </p>
        <a href={`/register/callback?email=${encodeURIComponent(email)}`}
           className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors mr-3">
          Check Again
        </a>
        <a href="/" className="border border-gray-600 text-gray-300 px-8 py-3 rounded-lg font-medium transition-colors">
          Return Home
        </a>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
          <h2 className="text-xl font-bold text-white mb-4">Something Went Wrong</h2>
          <p className="text-gray-400 mb-6">No registration found for this email.</p>
          <a href="/register" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors">
            Try Again
          </a>
        </div>
      </div>
    )
  }

  // Polling state
  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      <div className="w-16 h-16 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
      <h2 className="text-2xl font-bold text-white mb-4">Verification In Progress</h2>
      <p className="text-gray-400 mb-2">
        Your GENID <span className="text-violet-400 font-mono">is being issued</span>
      </p>
      <p className="text-gray-500 text-sm">Stripe is processing your documents — this can take up to 5 minutes.</p>
      <p className="text-gray-600 text-xs mt-4">Check {attempts}/{MAX_ATTEMPTS}</p>
    </div>
  )
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-16 h-16 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
        <p className="text-gray-400">Loading...</p>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
