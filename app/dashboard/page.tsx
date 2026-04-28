'use client'

import { useState } from 'react'

interface GenidRecord {
  genid_code: string
  user_name: string
  verified: boolean
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

export default function DashboardPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [record, setRecord] = useState<GenidRecord | null>(null)
  const [error, setError] = useState('')

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setRecord(null)

    try {
      // First get the genid_code from email
      const emailRes = await fetch(`/api/genid/issue?email=${encodeURIComponent(email)}`)
      const emailData = await emailRes.json()

      if (!emailRes.ok) {
        setError(emailData.error ?? 'No GENID found for this email.')
        setLoading(false)
        return
      }

      // Then look up full record with content history
      const codeRes = await fetch(`/api/genid/lookup?code=${encodeURIComponent(emailData.genid_code)}`)
      const codeData = await codeRes.json()

      if (!codeRes.ok) {
        setError(codeData.error ?? 'Lookup failed.')
        setLoading(false)
        return
      }

      setRecord(codeData)
    } catch {
      setError('Network error — please try again')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Your GENID Dashboard</h1>
        <p className="text-gray-400">Enter your registered email to view your GENID and stamping history.</p>
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
          {loading ? 'Loading...' : 'Load Dashboard'}
        </button>
      </form>

      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-sm text-red-300 mb-6">
          {error}
          {error.includes('No GENID') && (
            <div className="mt-2">
              <a href="/register" className="text-violet-400 hover:text-violet-300">Register for a GENID →</a>
            </div>
          )}
        </div>
      )}

      {record && (
        <div className="space-y-6">
          {/* Identity Card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs text-gray-500 font-mono mb-1">VERIFIED CREATOR</div>
                <div className="text-xl font-semibold text-white">{record.user_name}</div>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${record.verified ? 'bg-green-900/50 text-green-400 border border-green-800' : 'bg-yellow-900/50 text-yellow-400 border border-yellow-800'}`}>
                {record.verified ? '✓ Identity Verified' : '⏳ Pending Verification'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1 font-mono">GENID CODE</div>
                <div className="font-mono font-bold text-violet-400 text-2xl tracking-widest">{record.genid_code}</div>
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
