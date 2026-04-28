'use client'

import { useState, useRef } from 'react'

type Status = 'idle' | 'checking' | 'found' | 'not_found' | 'error'

interface VerifyResult {
  verified: boolean
  genidCode?: string
  creatorName?: string
  identityVerified?: boolean
  registeredAt?: string
  contentHash: string
  blockchainTxHash?: string
  stampedAt?: string
  platform?: string
  message: string
}

export default function VerifyPage() {
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImage(file)
    setPreview(URL.createObjectURL(file))
    setStatus('idle')
    setResult(null)
    setError('')
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setImage(file)
    setPreview(URL.createObjectURL(file))
    setStatus('idle')
    setResult(null)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!image) return

    setStatus('checking')
    setError('')

    try {
      const formData = new FormData()
      formData.append('image', image)

      const res = await fetch('/api/verify', {
        method: 'POST',
        body: formData,
      })

      const data: VerifyResult = await res.json()

      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Verification failed')
        setStatus('error')
        return
      }

      setResult(data)
      setStatus(data.verified ? 'found' : 'not_found')
    } catch {
      setError('Network error — please try again')
      setStatus('error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Verify an Image</h1>
        <p className="text-gray-400">
          Upload any image to check whether it carries a GENID. If it does, you&apos;ll see who created it, when, and the blockchain proof.
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-6">
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-700 hover:border-violet-600 rounded-xl p-8 text-center cursor-pointer transition-colors"
        >
          {preview ? (
            <div className="space-y-3">
              <img src={preview} alt="Preview" className="max-h-56 mx-auto rounded-lg object-contain" />
              <p className="text-sm text-gray-400">{image?.name} &mdash; click to change</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-4xl text-gray-600">🔍</div>
              <p className="text-gray-400">Drop an image here or click to upload</p>
              <p className="text-xs text-gray-600">Any JPEG, PNG, or WebP</p>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!image || status === 'checking'}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
        >
          {status === 'checking' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              Scanning for GENID...
            </span>
          ) : 'Check for GENID →'}
        </button>
      </form>

      {status === 'found' && result && (
        <div className="mt-8 bg-gray-900 border border-green-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-900/50 rounded-full flex items-center justify-center text-xl">✓</div>
            <div>
              <div className="text-green-400 font-semibold">GENID Found &amp; Verified</div>
              <div className="text-gray-400 text-sm">{result.message}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1 font-mono">CREATOR</div>
              <div className="text-white font-semibold">{result.creatorName}</div>
              {result.identityVerified && (
                <div className="text-xs text-green-400 mt-1">✓ Identity Verified</div>
              )}
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1 font-mono">GENID CODE</div>
              <div className="font-mono font-bold text-violet-400 text-lg tracking-widest">{result.genidCode}</div>
            </div>
            {result.stampedAt && (
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1 font-mono">STAMPED AT</div>
                <div className="text-white text-sm">{new Date(result.stampedAt).toLocaleString()}</div>
              </div>
            )}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1 font-mono">PLATFORM</div>
              <div className="text-white text-sm">{result.platform ?? 'GENID Protocol'}</div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1 font-mono">CONTENT HASH (SHA-256)</div>
            <div className="font-mono text-xs text-gray-300 break-all">{result.contentHash}</div>
          </div>

          {result.blockchainTxHash && (
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-2 font-mono">BLOCKCHAIN RECORD (POLYGON)</div>
              <div className="font-mono text-xs text-gray-300 break-all mb-2">{result.blockchainTxHash}</div>
              <a
                href={`https://polygonscan.com/tx/${result.blockchainTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                View on PolygonScan →
              </a>
            </div>
          )}
        </div>
      )}

      {status === 'not_found' && result && (
        <div className="mt-8 bg-gray-900 border border-yellow-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-yellow-900/50 rounded-full flex items-center justify-center text-xl">?</div>
            <div>
              <div className="text-yellow-400 font-semibold">No GENID Found</div>
              <div className="text-gray-400 text-sm">{result.message}</div>
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 mt-3">
            <div className="text-xs text-gray-500 mb-1 font-mono">CONTENT HASH</div>
            <div className="font-mono text-xs text-gray-400 break-all">{result.contentHash}</div>
          </div>
          <p className="text-xs text-gray-500 mt-4">
            This image has no embedded GENID. It may be unregistered AI content, a human-created image, or it may have been heavily re-compressed after stamping.
          </p>
        </div>
      )}
    </div>
  )
}
