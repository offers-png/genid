'use client'

import { useState, useRef } from 'react'

type Status = 'idle' | 'uploading' | 'success' | 'error'

interface EmbedResult {
  genidCode: string
  contentHash: string
  blockchainTx: string
  downloadUrl: string
  fileName: string
}

export default function EmbedPage() {
  const [email, setEmail] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<EmbedResult | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please upload a JPEG or PNG image.')
      return
    }
    setImage(file)
    setError('')
    const url = URL.createObjectURL(file)
    setPreview(url)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please drop a JPEG or PNG image.')
      return
    }
    setImage(file)
    setError('')
    setPreview(URL.createObjectURL(file))
  }

  async function handleEmbed(e: React.FormEvent) {
    e.preventDefault()
    if (!image || !email) return

    setStatus('uploading')
    setError('')

    try {
      const formData = new FormData()
      formData.append('email', email)
      formData.append('image', image)

      const res = await fetch('/api/embed', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Embedding failed')
        setStatus('error')
        return
      }

      const blob = await res.blob()
      const genidCode = res.headers.get('X-GENID-Code') ?? ''
      const contentHash = res.headers.get('X-Content-Hash') ?? ''
      const blockchainTx = res.headers.get('X-Blockchain-TX') ?? 'pending'
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const fileNameMatch = disposition.match(/filename="(.+)"/)
      const fileName = fileNameMatch?.[1] ?? 'stamped-image.png'

      const downloadUrl = URL.createObjectURL(blob)
      setResult({ genidCode, contentHash, blockchainTx, downloadUrl, fileName })
      setStatus('success')
    } catch {
      setError('Network error — please try again')
      setStatus('error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-2">Stamp Your Image</h1>
        <p className="text-gray-400">
          Upload any AI-generated image. Your GENID will be invisibly embedded using LSB steganography and logged to the Polygon blockchain.
        </p>
      </div>

      {status !== 'success' && (
        <form onSubmit={handleEmbed} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Your Registered Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
            />
            <p className="text-xs text-gray-500 mt-1">Must match your registered GENID email</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">AI-Generated Image</label>
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-700 hover:border-violet-600 rounded-xl p-8 text-center cursor-pointer transition-colors"
            >
              {preview ? (
                <div className="space-y-3">
                  <img src={preview} alt="Preview" className="max-h-48 mx-auto rounded-lg object-contain" />
                  <p className="text-sm text-gray-400">{image?.name} &mdash; click to change</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-4xl text-gray-600">↑</div>
                  <p className="text-gray-400">Drop your image here or click to upload</p>
                  <p className="text-xs text-gray-600">JPEG, PNG, WebP — max 10MB</p>
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
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!image || !email || status === 'uploading'}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
          >
            {status === 'uploading' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Embedding GENID + Logging to Blockchain...
              </span>
            ) : 'Embed GENID & Download →'}
          </button>

          <p className="text-xs text-gray-600 text-center">
            Output is always PNG to preserve the embedded data. Original file is not modified.
          </p>
        </form>
      )}

      {status === 'success' && result && (
        <div className="bg-gray-900 border border-green-800 rounded-xl p-8 space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 bg-green-900/50 rounded-full flex items-center justify-center text-2xl mx-auto mb-3">✓</div>
            <h2 className="text-xl font-bold text-white mb-1">Image Stamped Successfully</h2>
            <p className="text-gray-400 text-sm">GENID embedded. Blockchain record created.</p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1 font-mono">EMBEDDED GENID</div>
              <div className="font-mono font-bold text-violet-400 text-xl tracking-widest">{result.genidCode}</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1 font-mono">CONTENT HASH (SHA-256)</div>
              <div className="font-mono text-xs text-gray-300 break-all">{result.contentHash}</div>
            </div>
            {result.blockchainTx !== 'pending' && (
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1 font-mono">POLYGON TRANSACTION</div>
                <div className="font-mono text-xs text-gray-300 break-all">{result.blockchainTx}</div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <a
              href={result.downloadUrl}
              download={result.fileName}
              className="bg-violet-600 hover:bg-violet-500 text-white py-3 rounded-lg font-medium transition-colors text-center block"
            >
              Download Stamped Image
            </a>
            <button
              onClick={() => { setStatus('idle'); setResult(null); setImage(null); setPreview(null) }}
              className="border border-gray-700 hover:border-gray-500 text-gray-300 py-2.5 rounded-lg text-sm transition-colors"
            >
              Stamp Another Image
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 bg-gray-900/50 border border-gray-800 rounded-xl p-5 text-xs text-gray-500 space-y-1">
        <div className="font-medium text-gray-400 mb-2">How it works under the hood:</div>
        <div>1. Your GENID is encoded as &quot;GENID:XX12345\0&quot; (null-terminated)</div>
        <div>2. Each character&apos;s bits are written into the LSB of R, G, B channels</div>
        <div>3. A SHA-256 hash of the stamped file is sent to Polygon as transaction calldata</div>
        <div>4. The record is also saved to Supabase for fast public lookups</div>
      </div>
    </div>
  )
}
