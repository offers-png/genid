'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

type Status = 'polling' | 'success' | 'timeout' | 'error' | 'failed' | 'canceled'

interface RegistrationResult {
  genid_code: string
  user_name: string
  verified: boolean
  verification_status: string
  created_at: string
}

const MAX_ATTEMPTS = 20
const POLL_INTERVAL = 3000

function CallbackContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''

  const [status, setStatus] = useState<Status>(() => (email ? 'polling' : 'error'))
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [failureReason, setFailureReason] = useState('')

  // Use a ref so the poll closure always reads the latest cancelled value
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!email) return

    cancelledRef.current = false
    let attemptCount = 0

    async function poll() {
      if (cancelledRef.current) return

      attemptCount++
      setAttempts(attemptCount)

      if (attemptCount > MAX_ATTEMPTS) {
        setStatus('timeout')
        return
      }

      try {
        const res = await fetch(`/api/genid/issue?email=${encodeURIComponent(email)}`)
        if (res.ok) {
          const data: RegistrationResult = await res.json()

          if (data.verified) {
            setResult(data)
            setStatus('success')
            return
          }

          const vs = data.verification_status ?? ''
          if (vs.startsWith('failed:')) {
            setFailureReason(vs.replace('failed:', ''))
            setStatus('failed')
            return
          }
          if (vs === 'canceled') {
            setStatus('canceled')
            return
          }
        }
      } catch {
        // network hiccup — keep polling
      }

      setTimeout(poll, POLL_INTERVAL)
    }

    poll()

    return () => {
      cancelledRef.current = true
    }
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
        <Link href="/embed" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors">
          Stamp Your First Image →
        </Link>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl">✕</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-4">Verification Failed</h2>
        <p className="text-gray-400 mb-2">Stripe could not verify your identity.</p>
        <p className="text-gray-500 text-sm mb-6">
          Reason: {failureReason.replace(/_/g, ' ')}
        </p>
        <Link href="/register" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors">
          Try Again
        </Link>
      </div>
    )
  }

  if (status === 'canceled') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl">—</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-4">Verification Canceled</h2>
        <p className="text-gray-400 mb-6">You canceled the identity verification process.</p>
        <Link href="/register" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors">
          Start Again
        </Link>
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
        <Link
          href={`/register/callback?email=${encodeURIComponent(email)}`}
          className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors mr-3"
        >
          Check Again
        </Link>
        <Link href="/" className="border border-gray-600 text-gray-300 px-8 py-3 rounded-lg font-medium transition-colors">
          Return Home
        </Link>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
          <h2 className="text-xl font-bold text-white mb-4">Something Went Wrong</h2>
          <p className="text-gray-400 mb-6">No registration found for this email.</p>
          <Link href="/register" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors">
            Try Again
          </Link>
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
