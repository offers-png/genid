'use client'

import { useState } from 'react'

type Step = 'form' | 'redirecting'

export default function RegisterPage() {
    const [step, setStep] = useState<Step>('form')
    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)
        setError('')

      // Check if already registered first
      try {
              const checkRes = await fetch(`/api/genid/issue?email=${encodeURIComponent(email)}`)
              if (checkRes.ok) {
                        window.location.href = `/register/callback?email=${encodeURIComponent(email)}`
                        return
              }
      } catch {
              // not found, continue to Stripe
      }

      try {
              const res = await fetch('/api/stripe/session', {
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

          setStep('redirecting')
              window.location.href = data.url
      } catch {
              setError('Network error — please try again')
              setLoading(false)
      }
  }

  return (
        <div className="max-w-lg mx-auto px-6 py-20">
              <div className="text-center mb-10">
                      <div className="w-14 h-14 bg-violet-600 rounded-xl flex items-center justify-center text-2xl font-bold mx-auto mb-4">G</div>
                      <h1 className="text-3xl font-bold text-white mb-2">Get Your GENID</h1>
                      <p className="text-gray-400">Verify your identity once. Stamp your AI content forever.</p>
              </div>
        
          {step === 'form' && (
                  <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-5">
                            <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                                        <input
                                                        type="text"
                                                        required
                                                        value={fullName}
                                                        onChange={e => setFullName(e.target.value)}
                                                        placeholder="Saleh Al-Rashid"
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
                              {loading ? 'Checking...' : 'Verify Identity with Stripe →'}
                            </button>
                            <div className="pt-2 space-y-2">
                                        <div className="flex items-start gap-2 text-xs text-gray-500">
                                                      <span className="text-green-500 mt-0.5">✓</span>
                                                      <span>Government ID + selfie verification — takes 2 minutes</span>
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
              )}
        
          {step === 'redirecting' && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                            <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                            <h2 className="text-white font-semibold mb-2">Redirecting to Stripe Identity</h2>
                            <p className="text-gray-400 text-sm">You&apos;ll verify your government ID and take a selfie. Takes about 2 minutes.</p>
                  </div>
              )}
        </div>
      )
}

