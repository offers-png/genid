'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ApiKeyRecord {
  id: string
  genid_code: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

type LoadState = 'loading' | 'signed_out' | 'ready' | 'error'

export default function ApiKeysPage() {
  const [state, setState] = useState<LoadState>('loading')
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [error, setError] = useState('')
  const [notVerified, setNotVerified] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/account/api-keys')
      if (res.status === 401) {
        setState('signed_out')
        return
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load API keys')
      setKeys(data.keys ?? [])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — please try again')
      setState('error')
    }
  }

  useEffect(() => {
    async function run() {
      await load()
    }
    run()
  }, [])

  async function handleGenerate() {
    setGenerating(true)
    setError('')
    setNotVerified(false)
    try {
      const res = await fetch('/api/account/api-keys', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 403) setNotVerified(true)
        else setError(data.error ?? 'Failed to generate key')
        return
      }
      setNewKey(data.key)
      setCopied(false)
      await load()
    } catch {
      setError('Network error — please try again')
    } finally {
      setGenerating(false)
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Anything using it will stop working immediately.')) return
    try {
      const res = await fetch(`/api/account/api-keys/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to revoke key')
        return
      }
      await load()
    } catch {
      setError('Network error — please try again')
    }
  }

  async function handleCopy() {
    if (!newKey) return
    try {
      await navigator.clipboard.writeText(newKey)
      setCopied(true)
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // key is still shown as selectable text, so this isn't fatal.
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">API Keys</h1>
          <p className="text-gray-400">
            Call GenID&apos;s stamping API directly — see{' '}
            <a href="https://github.com/offers-png/genid/blob/main/API.md" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
              API.md
            </a>{' '}
            for the full reference.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-violet-400 hover:text-violet-300 whitespace-nowrap">
          ← Dashboard
        </Link>
      </div>

      {state === 'loading' && <div className="text-gray-500 text-sm">Loading…</div>}

      {state === 'signed_out' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-4">Sign in to manage API keys.</p>
          <Link href="/login" className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-block">
            Sign in →
          </Link>
        </div>
      )}

      {state === 'error' && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-sm text-red-300 mb-6">{error}</div>
      )}

      {state === 'ready' && (
        <div className="space-y-6">
          {newKey && (
            <div className="bg-green-950/30 border border-green-800 rounded-xl p-6">
              <div className="text-green-400 font-semibold mb-2">New API key created</div>
              <p className="text-sm text-gray-400 mb-3">
                Copy this now — it won&apos;t be shown again. If you lose it, revoke it below and generate a new one.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-violet-300 font-mono break-all select-all">
                  {newKey}
                </code>
                <button
                  onClick={handleCopy}
                  className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-sm text-red-300">{error}</div>
          )}

          {notVerified && (
            <div className="bg-yellow-950/30 border border-yellow-800 rounded-lg p-4 text-sm text-yellow-300">
              Complete Stripe identity verification before generating an API key — only a verified GENID can stamp content via the API.
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {generating ? 'Generating…' : '+ Generate New Key'}
          </button>

          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Your Keys</h2>
            {keys.length === 0 ? (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
                No API keys yet.
              </div>
            ) : (
              <div className="space-y-3">
                {keys.map(key => (
                  <div key={key.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm text-white">{key.key_prefix}…</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Created {new Date(key.created_at).toLocaleString()}
                          {key.last_used_at && <> · last used {new Date(key.last_used_at).toLocaleString()}</>}
                        </div>
                      </div>
                      {key.revoked_at ? (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-500 border border-gray-700">
                          Revoked
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRevoke(key.id)}
                          className="text-sm text-red-400 hover:text-red-300"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
