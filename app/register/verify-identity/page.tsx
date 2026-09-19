'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Status = 'starting' | 'redirecting' | 'error'

// Reached only via GET /api/auth/confirm-registration's redirect, right
// after it sets the httpOnly email-confirmation-proof cookie (Sept 19
// third fix). This page's only job is to trigger POST /api/stripe/session
// — which reads that cookie, not a client-supplied email — and forward the
// browser on to Stripe. No email/token appears in this page's own URL.
export default function VerifyIdentityPage() {
  const [status, setStatus] = useState<Status>('starting')
  const [error, setError] = useState('')
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function start() {
      try {
        const res = await fetch('/api/stripe/session', { method: 'POST' })
        const data = await res.json()

        if (!res.ok) {
          setError(data.error ?? 'Could not start identity verification.')
          setStatus('error')
          return
        }

        setStatus('redirecting')
        window.location.href = data.url
      } catch {
        setError('Network error — please try again.')
        setStatus('error')
      }
    }

    start()
  }, [])

  if (status === 'error') {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
          <h2 className="text-xl font-bold text-white mb-4">Could Not Start Identity Verification</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <Link href="/register" className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-lg font-medium transition-colors">
            Start Over
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-20">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-white font-semibold mb-2">Redirecting to Stripe Identity</h2>
        <p className="text-gray-400 text-sm">You&apos;ll verify your government ID and take a selfie. Takes about 2 minutes.</p>
      </div>
    </div>
  )
}
