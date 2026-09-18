'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Status = 'checking_auth' | 'signed_out' | 'idle' | 'generating' | 'error'

// Entry point only — creates session step 1, then hands off to the durable,
// bookmarkable /session/[id] view. This page never renders workspace state
// itself, so refreshing or navigating away and back doesn't lose anything:
// the session lives at its own URL from the moment it exists.
//
// Identity comes from the signed-in session cookie, not a typed email — a
// bare email field used to be enough to create sessions under anyone's
// GENID code (Security & Trust Fix Punch List #4, Sept 18 follow-up).
export default function NewSessionPage() {
  const router = useRouter()
  const [promptText, setPromptText] = useState('')
  const [status, setStatus] = useState<Status>('checking_auth')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me').then((res) => {
      if (cancelled) return
      setStatus(res.ok ? 'idle' : 'signed_out')
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!promptText) return

    setStatus('generating')
    setError('')

    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Generation failed')
        setStatus('error')
        return
      }

      router.push(`/session/${data.sessionId}`)
    } catch {
      setError('Network error — please try again')
      setStatus('error')
    }
  }

  if (status === 'checking_auth') {
    return <div className="max-w-2xl mx-auto px-6 py-16 text-gray-500 text-sm">Loading…</div>
  }

  if (status === 'signed_out') {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-4">Sign in to start a session.</p>
          <Link href="/login" className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-block">
            Sign in →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Create a Session</h1>
          <p className="text-gray-400">
            Generate, regenerate, and edit inside GenID — every version is captured automatically as
            you go, nothing is deleted, and you choose which one becomes the certified final.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <a href="/dashboard" className="text-sm text-violet-400 hover:text-violet-300">
          ← View past sessions
        </a>
      </div>

      <form onSubmit={handleGenerate} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Prompt</label>
          <textarea
            required
            rows={4}
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder="Describe the image you want to create…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>

        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!promptText || status === 'generating'}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
        >
          {status === 'generating' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              Generating…
            </span>
          ) : 'Generate →'}
        </button>
      </form>
    </div>
  )
}
