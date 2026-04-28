'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

interface GenidResult {
  genid_code: string
  user_name: string
  verified: boolean
  created_at: string
}

function CallbackContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'error'>('loading')
  const [result, setResult] = useState<GenidResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!email) {
      setStatus('error')
      setError('No email found in callback URL.')
      return
    }

    let attempts = 0
    const poll = async () => {
      try {
        const res = await fetch(`/api/genid/issue?email=${encodeURIComponent(email)}`)
        const data = await res.json()

        if (!res.ok) {
          if (attempts < 6) {
            attempts++
            setTimeout(poll, 5000)
          } else {
            setStatus('error')
            setError(data.error ?? 'Could not find your registration.')
          }
          return
        }

        setResult(data)
        setStatus(data.verified ? 'success' : 'pending')
      } catch {
        setStatus('error')
        setError('Network error — please refresh the page.')
      }
    }

    poll()
  }, [email])

  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      {status === 'loading' && (
        <>
          <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold text-white mb-2">Confirming Your Verification</h2>
          <p className="text-gray-400 text-sm">Checking with Stripe Identity... this takes a few seconds.</p>
        </>
      )}

      {status === 'success' && result && (
        <div className="bg-gray-900 border border-green-800 rounded-xl p-8">
          <div className="w-14 h-14 bg-green-900/50 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">✓</div>
          <h2 className="text-2xl font-bold text-white mb-2">Identity Verified</h2>
          <p className="text-gray-400 mb-6">Welcome, {result.user_name}. Your GENID is active.</p>
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <div className="text-xs text-gray-500 mb-1 font-mono">YOUR GENID CODE</div>
            <div className="text-4xl font-mono font-bold text-violet-400 tracking-widest">{result.genid_code}</div>
            <div className="text-xs text-gray-500 mt-2">Permanently bound to your verified identity</div>
          </div>
          <div className="flex flex-col gap-3">
            <a href="/embed" className="bg-violet-600 hover:bg-violet-500 text-white py-3 rounded-lg font-medium transition-colors block">
              Stamp Your First Image →
            </a>
            <a href="/dashboard" className="border border-gray-700 hover:border-gray-500 text-gray-300 py-3 rounded-lg font-medium transition-colors block">
              Go to Dashboard
            </a>
          </div>
        </div>
      )}

      {status === 'pending' && result && (
        <div className="bg-gray-900 border border-yellow-800 rounded-xl p-8">
          <div className="w-14 h-14 bg-yellow-900/50 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">⏳</div>
          <h2 className="text-xl font-semibold text-white mb-2">Verification In Progress</h2>
          <p className="text-gray-400 mb-4 text-sm">
            Your GENID <span className="font-mono text-violet-400">{result.genid_code}</span> has been reserved.
            Stripe is still processing your documents — this can take up to 5 minutes.
          </p>
          <p className="text-gray-500 text-xs mb-6">Check back soon or wait for a confirmation email.</p>
          <a href="/" className="border border-gray-700 text-gray-400 py-2.5 px-6 rounded-lg text-sm hover:border-gray-500 inline-block">
            Return Home
          </a>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-gray-900 border border-red-800 rounded-xl p-8">
          <div className="text-4xl mb-4">✗</div>
          <h2 className="text-xl font-semibold text-white mb-2">Something Went Wrong</h2>
          <p className="text-gray-400 text-sm mb-6">{error}</p>
          <a href="/register" className="bg-violet-600 hover:bg-violet-500 text-white py-2.5 px-6 rounded-lg text-sm inline-block">
            Try Again
          </a>
        </div>
      )}
    </div>
  )
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
        <p className="text-gray-400">Loading...</p>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
