'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface GenidRecord {
  genidCode: string
  creatorName: string
  verified: boolean
  nameVerified: boolean
  registeredAt: string
  contentCount: number
  recentContent: ContentEntry[]
}

interface ContentEntry {
  id: string
  content_hash: string
  file_name: string | null
  file_type: string | null
  platform: string
  blockchain_tx_hash: string | null
  created_at: string
}

interface SessionSummary {
  id: string
  contentType: string
  status: 'active' | 'finalized' | 'abandoned'
  createdAt: string
  finalizedAt: string | null
  certificate: { id: string; verifyUrl: string | null } | null
}

type LoadState = 'loading' | 'signed_out' | 'ready' | 'error'

export default function DashboardPage() {
  const router = useRouter()
  const [state, setState] = useState<LoadState>('loading')
  const [record, setRecord] = useState<GenidRecord | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const meRes = await fetch('/api/auth/me')
        if (meRes.status === 401) {
          if (!cancelled) setState('signed_out')
          return
        }
        if (!meRes.ok) throw new Error('Failed to load session')
        const me = await meRes.json()

        const [codeRes, sessionsRes] = await Promise.all([
          fetch(`/api/genid/lookup?code=${encodeURIComponent(me.genidCode)}`),
          fetch('/api/session'),
        ])
        const codeData = await codeRes.json()
        if (!codeRes.ok) throw new Error(codeData.error ?? 'Lookup failed')

        if (cancelled) return
        setRecord(codeData)
        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json()
          setSessions(sessionsData.sessions ?? [])
        }
        setState('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Network error — please try again')
          setState('error')
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Your GENID Dashboard</h1>
          <p className="text-gray-400">Your GENID and stamping history.</p>
        </div>
        {state === 'ready' && (
          <button onClick={handleSignOut} className="text-sm text-gray-400 hover:text-gray-300 whitespace-nowrap">
            Sign out
          </button>
        )}
      </div>

      {state === 'loading' && <div className="text-gray-500 text-sm">Loading…</div>}

      {state === 'signed_out' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-4">Sign in to view your GENID dashboard.</p>
          <Link href="/login" className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-block">
            Sign in →
          </Link>
        </div>
      )}

      {state === 'error' && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-sm text-red-300 mb-6">{error}</div>
      )}

      {record && (
        <div className="space-y-6">
          {/* Identity Card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs text-gray-500 font-mono mb-1">CREATOR</div>
                <div className="text-xl font-semibold text-white">{record.creatorName}</div>
                {record.verified && !record.nameVerified && (
                  <div className="text-xs text-yellow-400 mt-1">Name self-reported, not ID-verified</div>
                )}
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${record.verified ? 'bg-green-900/50 text-green-400 border border-green-800' : 'bg-yellow-900/50 text-yellow-400 border border-yellow-800'}`}>
                {record.verified ? '✓ Identity Verified' : '⏳ Pending Verification'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1 font-mono">GENID CODE</div>
                <div className="font-mono font-bold text-violet-400 text-2xl tracking-widest">{record.genidCode}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1 font-mono">TOTAL STAMPS</div>
                <div className="text-2xl font-bold text-white">{record.contentCount}</div>
                <div className="text-xs text-gray-500 mt-1">images stamped</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 col-span-2">
                <div className="text-xs text-gray-500 mb-1 font-mono">REGISTERED</div>
                <div className="text-gray-300 text-sm">{new Date(record.registeredAt).toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            <a href="/embed" className="bg-violet-600 hover:bg-violet-500 text-white py-3 rounded-lg font-medium transition-colors text-center">
              Stamp New Image
            </a>
            <a href="/verify" className="border border-gray-700 hover:border-gray-500 text-gray-300 py-3 rounded-lg font-medium transition-colors text-center">
              Verify an Image
            </a>
          </div>

          {/* Sessions */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Your Sessions</h2>
              <div className="flex items-center gap-4">
                <Link href="/dashboard/storage" className="text-sm text-gray-400 hover:text-gray-300">
                  Storage usage
                </Link>
                <Link href="/session" className="text-sm text-violet-400 hover:text-violet-300">
                  + New Session
                </Link>
              </div>
            </div>
            {sessions.length === 0 ? (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
                No sessions yet. <Link href="/session" className="text-violet-400 hover:text-violet-300">Start your first session →</Link>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map(session => (
                  <div key={session.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <a href={`/session/${session.id}`} className="text-sm font-medium text-white hover:text-violet-300 transition-colors">
                        Session {session.id.slice(0, 8)}…
                      </a>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          session.status === 'finalized'
                            ? 'bg-green-900/50 text-green-400 border border-green-800'
                            : session.status === 'active'
                            ? 'bg-violet-900/50 text-violet-400 border border-violet-800'
                            : 'bg-gray-800 text-gray-400 border border-gray-700'
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-3">
                      {session.contentType} · created {new Date(session.createdAt).toLocaleString()}
                      {session.finalizedAt && <> · finalized {new Date(session.finalizedAt).toLocaleString()}</>}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <a href={`/session/${session.id}`} className="text-violet-400 hover:text-violet-300">
                        Open Session →
                      </a>
                      {session.certificate && (
                        <a href={`/api/session/${session.id}/certificate`} className="text-violet-400 hover:text-violet-300">
                          Download Certificate →
                        </a>
                      )}
                      {session.certificate?.verifyUrl && (
                        <a
                          href={session.certificate.verifyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-gray-300"
                        >
                          Verify ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Content History */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Recent Stamps</h2>
            {record.recentContent.length === 0 ? (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
                No stamps yet. <a href="/embed" className="text-violet-400 hover:text-violet-300">Stamp your first image →</a>
              </div>
            ) : (
              <div className="space-y-3">
                {record.recentContent.map(entry => (
                  <div key={entry.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-medium text-white text-sm">{entry.file_name ?? 'Unnamed file'}</div>
                      <div className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleString()}</div>
                    </div>
                    <div className="text-xs text-gray-500 font-mono break-all mb-2">{entry.content_hash}</div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-gray-500">{entry.file_type ?? 'image'}</span>
                      <span className="text-gray-600">·</span>
                      <span className="text-gray-500">{entry.platform}</span>
                      {entry.blockchain_tx_hash && (
                        <>
                          <span className="text-gray-600">·</span>
                          <a
                            href={`https://polygonscan.com/tx/${entry.blockchain_tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-violet-400 hover:text-violet-300"
                          >
                            View on Polygon →
                          </a>
                        </>
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
