'use client'

import { useState } from 'react'
import Link from 'next/link'

interface SessionUsage {
  id: string
  status: 'active' | 'finalized' | 'abandoned'
  createdAt: string
  bytes: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function StoragePage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [totalBytes, setTotalBytes] = useState<number | null>(null)
  const [sessions, setSessions] = useState<SessionUsage[]>([])
  const [error, setError] = useState('')

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setTotalBytes(null)
    setSessions([])

    try {
      const res = await fetch(`/api/session/storage-summary?email=${encodeURIComponent(email)}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Lookup failed.')
        setLoading(false)
        return
      }

      setTotalBytes(data.totalBytes)
      setSessions(data.sessions ?? [])
    } catch {
      setError('Network error — please try again')
    }
    setLoading(false)
  }

  const maxBytes = Math.max(1, ...sessions.map(s => s.bytes))

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Storage Usage</h1>
          <p className="text-gray-400">Per-session storage — step outputs, certificates, and C2PA exports.</p>
        </div>
        <Link href="/dashboard" className="text-sm text-violet-400 hover:text-violet-300 whitespace-nowrap">
          ← Dashboard
        </Link>
      </div>

      <form onSubmit={handleLookup} className="flex gap-3 mb-10">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap"
        >
          {loading ? 'Loading...' : 'Check Usage'}
        </button>
      </form>

      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-sm text-red-300 mb-6">{error}</div>
      )}

      {totalBytes !== null && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="text-xs text-gray-500 mb-1 font-mono">TOTAL STORAGE</div>
            <div className="text-3xl font-bold text-white">{formatBytes(totalBytes)}</div>
            <div className="text-xs text-gray-500 mt-1">{sessions.length} session{sessions.length === 1 ? '' : 's'}</div>
          </div>

          {sessions.length === 0 ? (
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
              No sessions yet.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map(session => (
                <div key={session.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <Link href={`/session/${session.id}`} className="text-white hover:text-violet-300 transition-colors">
                      Session {session.id.slice(0, 8)}…
                    </Link>
                    <span className="text-gray-400 font-mono">{formatBytes(session.bytes)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-600 rounded-full"
                      style={{ width: `${Math.max(2, (session.bytes / maxBytes) * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {session.status} · {new Date(session.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-600">
            Non-final steps of finalized sessions are compressed for archival — see{' '}
            <a href="https://github.com/offers-png/genid/blob/main/DATA_RETENTION.md" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
              the data-retention policy
            </a>{' '}
            for what that changes and what it doesn&apos;t.
          </p>
        </div>
      )}
    </div>
  )
}
