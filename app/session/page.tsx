'use client'

import { useState } from 'react'
import Image from 'next/image'

type Status = 'idle' | 'generating' | 'generated' | 'finalizing' | 'finalized' | 'error'

interface GenerateResult {
  sessionId: string
  stepId: string
  outputHash: string
  stepSignature: string
  mimeType: string
  imageBase64: string
}

interface FinalizeResult {
  certificateId: string
  pdfBase64: string
}

export default function SessionPage() {
  const [email, setEmail] = useState('')
  const [promptText, setPromptText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [certificate, setCertificate] = useState<FinalizeResult | null>(null)
  const [error, setError] = useState('')

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !promptText) return

    setStatus('generating')
    setError('')

    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, promptText }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Generation failed')
        setStatus('error')
        return
      }

      setResult(data as GenerateResult)
      setStatus('generated')
    } catch {
      setError('Network error — please try again')
      setStatus('error')
    }
  }

  async function handleFinalize() {
    if (!result) return

    setStatus('finalizing')
    setError('')

    try {
      const res = await fetch(`/api/session/${result.sessionId}/finalize`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Finalize failed')
        setStatus('error')
        return
      }

      setCertificate(data as FinalizeResult)
      setStatus('finalized')
    } catch {
      setError('Network error — please try again')
      setStatus('error')
    }
  }

  function reset() {
    setStatus('idle')
    setResult(null)
    setCertificate(null)
    setPromptText('')
    setError('')
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Create a Session</h1>
        <p className="text-gray-400">
          Generate inside GenID and every step is captured automatically at the moment of creation —
          no upload, nothing to stamp after the fact.
        </p>
      </div>

      {status !== 'finalized' && (
        <form onSubmit={handleGenerate} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Your Registered Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={status === 'generated' || status === 'finalizing'}
              placeholder="you@example.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors disabled:opacity-60"
            />
            <p className="text-xs text-gray-500 mt-1">Must match a verified GENID identity</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Prompt</label>
            <textarea
              required
              rows={4}
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              disabled={status === 'generated' || status === 'finalizing'}
              placeholder="Describe the image you want to create…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors disabled:opacity-60"
            />
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {status !== 'generated' && (
            <button
              type="submit"
              disabled={!email || !promptText || status === 'generating'}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
            >
              {status === 'generating' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Generating…
                </span>
              ) : 'Generate →'}
            </button>
          )}
        </form>
      )}

      {result && status !== 'finalized' && (
        <div className="mt-8 bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
          <Image
            src={`data:${result.mimeType};base64,${result.imageBase64}`}
            alt="Generated output"
            width={512}
            height={512}
            unoptimized
            className="w-full rounded-lg object-contain"
          />

          <div className="grid grid-cols-1 gap-3">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1 font-mono">OUTPUT HASH (SHA-256)</div>
              <div className="font-mono text-xs text-gray-300 break-all">{result.outputHash}</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1 font-mono">STEP SIGNATURE (HMAC-SHA256)</div>
              <div className="font-mono text-xs text-gray-300 break-all">{result.stepSignature}</div>
            </div>
          </div>

          <button
            onClick={handleFinalize}
            disabled={status === 'finalizing'}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
          >
            {status === 'finalizing' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Finalizing…
              </span>
            ) : 'Finalize & Generate Certificate →'}
          </button>
        </div>
      )}

      {status === 'finalized' && certificate && (
        <div className="bg-gray-900 border border-green-800 rounded-xl p-8 space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 bg-green-900/50 rounded-full flex items-center justify-center text-2xl mx-auto mb-3">✓</div>
            <h2 className="text-xl font-bold text-white mb-1">Session Finalized</h2>
            <p className="text-gray-400 text-sm">Your Authorship Certificate is ready.</p>
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1 font-mono">CERTIFICATE ID</div>
            <div className="font-mono text-xs text-gray-300 break-all">{certificate.certificateId}</div>
          </div>

          <div className="flex flex-col gap-3">
            <a
              href={`data:application/pdf;base64,${certificate.pdfBase64}`}
              download={`genid-certificate-${certificate.certificateId}.pdf`}
              className="bg-violet-600 hover:bg-violet-500 text-white py-3 rounded-lg font-medium transition-colors text-center block"
            >
              Download Certificate (PDF)
            </a>
            <button
              onClick={reset}
              className="border border-gray-700 hover:border-gray-500 text-gray-300 py-2.5 rounded-lg text-sm transition-colors"
            >
              Start Another Session
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
