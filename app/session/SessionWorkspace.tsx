'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

type Status = 'active' | 'busy' | 'finalizing' | 'finalized'
type ActionPanel = 'none' | 'regenerate' | 'edit'

export interface StepView {
  id: string
  stepNumber: number
  stepType: string
  editType: string | null
  promptText: string | null
  userNote: string | null
  outputHash: string
  stepSignature: string
  mimeType: string
  imageBase64: string
}

export interface CertificateView {
  certificateId: string
  verifyUrl: string | null
  c2paManifestEmbedded: boolean
}

// The iterate/regenerate/edit/finalize workspace for one session. Seeded
// from props rather than owning session creation itself, so the exact same
// component serves a freshly-created session (app/session/page.tsx, right
// after the first generate) and a resumed one loaded by ID
// (app/session/[id]/page.tsx) — a session is reachable again from wherever
// it's linked, not just live in the tab that created it.
export default function SessionWorkspace({
  sessionId,
  initialSteps,
  initialFinalStepId,
  initialStatus,
  initialCertificate,
}: {
  sessionId: string
  initialSteps: StepView[]
  initialFinalStepId: string | null
  initialStatus: 'active' | 'finalized'
  initialCertificate: CertificateView | null
}) {
  const router = useRouter()

  const [status, setStatus] = useState<Status>(initialStatus)
  const [error, setError] = useState('')

  const [steps, setSteps] = useState<StepView[]>(initialSteps)
  const [viewingStepId, setViewingStepId] = useState<string | null>(
    initialFinalStepId ?? initialSteps[initialSteps.length - 1]?.id ?? null
  )
  const [finalStepId, setFinalStepId] = useState<string | null>(
    initialFinalStepId ?? initialSteps[initialSteps.length - 1]?.id ?? null
  )
  const [certificate, setCertificate] = useState<CertificateView | null>(initialCertificate)

  const [panel, setPanel] = useState<ActionPanel>('none')
  const [note, setNote] = useState('')
  const [regeneratePrompt, setRegeneratePrompt] = useState('')
  const [editType, setEditType] = useState<'crop' | 'color_adjust'>('color_adjust')
  const [crop, setCrop] = useState({ leftPct: 0, topPct: 0, widthPct: 1, heightPct: 1 })
  const [colorAdjust, setColorAdjust] = useState({ brightness: 1, saturation: 1 })

  const viewingStep = steps.find(s => s.id === viewingStepId) ?? steps[steps.length - 1] ?? null

  const isNoOpEdit =
    editType === 'color_adjust'
      ? colorAdjust.brightness === 1 && colorAdjust.saturation === 1
      : crop.leftPct === 0 && crop.topPct === 0 && crop.widthPct === 1 && crop.heightPct === 1

  async function submitStep(body: Record<string, unknown>) {
    setStatus('busy')
    setError('')

    try {
      const res = await fetch(`/api/session/${sessionId}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Step failed')
        setStatus('active')
        return
      }

      const step: StepView = {
        id: data.stepId,
        stepNumber: data.stepNumber,
        stepType: data.stepType,
        editType: data.editType,
        promptText: (body.promptText as string) ?? null,
        userNote: (body.userNote as string) ?? null,
        outputHash: data.outputHash,
        stepSignature: data.stepSignature,
        mimeType: data.mimeType,
        imageBase64: data.imageBase64,
      }
      setSteps(prev => [...prev, step])
      setViewingStepId(step.id)
      setFinalStepId(step.id)
      setPanel('none')
      setNote('')
      setRegeneratePrompt('')
      // Reset edit params back to identity defaults so reopening the Edit
      // panel next time doesn't silently carry over this step's values —
      // that's exactly how a later no-op submission happens unnoticed.
      setCrop({ leftPct: 0, topPct: 0, widthPct: 1, heightPct: 1 })
      setColorAdjust({ brightness: 1, saturation: 1 })
      setStatus('active')
    } catch {
      setError('Network error — please try again')
      setStatus('active')
    }
  }

  function handleRegenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!regeneratePrompt) return
    submitStep({ action: 'regenerate', promptText: regeneratePrompt, userNote: note || undefined })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (isNoOpEdit) return
    const params = editType === 'crop' ? crop : colorAdjust
    submitStep({ action: 'edit', editType, params, userNote: note || undefined })
  }

  async function handleFinalize() {
    if (!finalStepId) return

    setStatus('finalizing')
    setError('')

    try {
      const res = await fetch(`/api/session/${sessionId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId: finalStepId }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Finalize failed')
        setStatus('active')
        return
      }

      setCertificate({
        certificateId: data.certificateId,
        verifyUrl: data.verifyUrl,
        c2paManifestEmbedded: data.c2paManifestEmbedded ?? false,
      })
      setStatus('finalized')
    } catch {
      setError('Network error — please try again')
      setStatus('active')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Session</h1>
          <p className="text-gray-500 text-xs font-mono break-all">{sessionId}</p>
        </div>
        <a href="/dashboard" className="text-sm text-violet-400 hover:text-violet-300 whitespace-nowrap">
          ← All Sessions
        </a>
      </div>

      {status !== 'finalized' && viewingStep && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
            <Image
              src={`data:${viewingStep.mimeType};base64,${viewingStep.imageBase64}`}
              alt={`Step ${viewingStep.stepNumber} output`}
              width={512}
              height={512}
              unoptimized
              className="w-full rounded-lg object-contain"
            />

            <div className="text-sm text-gray-400">
              Step {viewingStep.stepNumber} — {viewingStep.stepType}
              {viewingStep.editType ? ` (${viewingStep.editType})` : ''}
              {viewingStep.id === finalStepId && <span className="text-violet-400 ml-2">★ marked final</span>}
            </div>
            {viewingStep.promptText && <p className="text-sm text-gray-300">{viewingStep.promptText}</p>}
            {viewingStep.userNote && <p className="text-sm text-gray-500 italic">&ldquo;{viewingStep.userNote}&rdquo;</p>}

            <div className="grid grid-cols-1 gap-3">
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1 font-mono">OUTPUT HASH (SHA-256)</div>
                <div className="font-mono text-xs text-gray-300 break-all">{viewingStep.outputHash}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1 font-mono">STEP SIGNATURE (HMAC-SHA256)</div>
                <div className="font-mono text-xs text-gray-300 break-all">{viewingStep.stepSignature}</div>
              </div>
            </div>
          </div>

          {steps.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {steps.map(step => (
                <button
                  key={step.id}
                  onClick={() => setViewingStepId(step.id)}
                  className={`relative flex-shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                    step.id === viewingStepId ? 'border-violet-500' : 'border-gray-800 hover:border-gray-600'
                  }`}
                >
                  <Image
                    src={`data:${step.mimeType};base64,${step.imageBase64}`}
                    alt={`Step ${step.stepNumber}`}
                    width={64}
                    height={64}
                    unoptimized
                    className="w-16 h-16 object-cover"
                  />
                  {step.id === finalStepId && (
                    <span className="absolute top-0.5 right-0.5 text-violet-400 text-xs">★</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {viewingStep.id !== finalStepId && (
            <button
              onClick={() => setFinalStepId(viewingStep.id)}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              Use this version as final ★
            </button>
          )}

          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setPanel(panel === 'regenerate' ? 'none' : 'regenerate')}
              disabled={status === 'busy' || status === 'finalizing'}
              className="flex-1 border border-gray-700 hover:border-violet-500 text-gray-200 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              onClick={() => setPanel(panel === 'edit' ? 'none' : 'edit')}
              disabled={status === 'busy' || status === 'finalizing'}
              className="flex-1 border border-gray-700 hover:border-violet-500 text-gray-200 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Edit
            </button>
          </div>

          {panel === 'regenerate' && (
            <form onSubmit={handleRegenerate} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <label className="block text-sm font-medium text-gray-300">New Prompt</label>
              <textarea
                required
                rows={3}
                value={regeneratePrompt}
                onChange={e => setRegeneratePrompt(e.target.value)}
                placeholder="Describe the new version…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
              />
              <NoteField note={note} setNote={setNote} />
              <button
                type="submit"
                disabled={!regeneratePrompt || status === 'busy'}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {status === 'busy' ? 'Regenerating…' : 'Regenerate →'}
              </button>
            </form>
          )}

          {panel === 'edit' && (
            <form onSubmit={handleEdit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditType('color_adjust')}
                  className={`flex-1 py-2 rounded-lg text-sm transition-colors ${editType === 'color_adjust' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-300'}`}
                >
                  Color Adjust
                </button>
                <button
                  type="button"
                  onClick={() => setEditType('crop')}
                  className={`flex-1 py-2 rounded-lg text-sm transition-colors ${editType === 'crop' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-300'}`}
                >
                  Crop
                </button>
              </div>

              {editType === 'color_adjust' && (
                <div className="space-y-3">
                  <SliderField
                    label={`Brightness (${colorAdjust.brightness.toFixed(2)})`}
                    value={colorAdjust.brightness}
                    onChange={v => setColorAdjust(prev => ({ ...prev, brightness: v }))}
                  />
                  <SliderField
                    label={`Saturation (${colorAdjust.saturation.toFixed(2)})`}
                    value={colorAdjust.saturation}
                    onChange={v => setColorAdjust(prev => ({ ...prev, saturation: v }))}
                  />
                </div>
              )}

              {editType === 'crop' && (
                <div className="grid grid-cols-2 gap-3">
                  <SliderField label="Left %" value={crop.leftPct} max={1} onChange={v => setCrop(prev => ({ ...prev, leftPct: v }))} />
                  <SliderField label="Top %" value={crop.topPct} max={1} onChange={v => setCrop(prev => ({ ...prev, topPct: v }))} />
                  <SliderField label="Width %" value={crop.widthPct} max={1} onChange={v => setCrop(prev => ({ ...prev, widthPct: v }))} />
                  <SliderField label="Height %" value={crop.heightPct} max={1} onChange={v => setCrop(prev => ({ ...prev, heightPct: v }))} />
                </div>
              )}

              <NoteField note={note} setNote={setNote} />

              {isNoOpEdit && (
                <p className="text-xs text-gray-500">
                  {editType === 'color_adjust' ? 'Adjust brightness or saturation' : 'Adjust the crop area'} before applying — this wouldn&apos;t change the image.
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'busy' || isNoOpEdit}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {status === 'busy' ? 'Applying…' : 'Apply Edit →'}
              </button>
            </form>
          )}

          <button
            onClick={handleFinalize}
            disabled={status === 'finalizing' || status === 'busy'}
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
            <p className="text-gray-400 text-sm">Your Authorship Certificate covers all {steps.length} step{steps.length === 1 ? '' : 's'}.</p>
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1 font-mono">CERTIFICATE ID</div>
            <div className="font-mono text-xs text-gray-300 break-all">{certificate.certificateId}</div>
          </div>

          <div className="flex flex-col gap-3">
            <a
              href={`/api/session/${sessionId}/certificate`}
              className="bg-violet-600 hover:bg-violet-500 text-white py-3 rounded-lg font-medium transition-colors text-center block"
            >
              Download Certificate (PDF)
            </a>
            {certificate.c2paManifestEmbedded && (
              <a
                href={`/api/session/${sessionId}/c2pa-export`}
                className="border border-gray-700 hover:border-violet-500 text-gray-300 py-2.5 rounded-lg text-sm transition-colors text-center block"
              >
                Download C2PA Export (PNG)
              </a>
            )}
            {certificate.verifyUrl && (
              <a
                href={certificate.verifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-gray-700 hover:border-violet-500 text-gray-300 py-2.5 rounded-lg text-sm transition-colors text-center block"
              >
                Verify This Session ↗
              </a>
            )}
            <button
              onClick={() => router.push('/session')}
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

function NoteField({ note, setNote }: { note: string; setNote: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">Note (optional) — what changed and why</label>
      <input
        type="text"
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="e.g. brightened background"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-colors"
      />
    </div>
  )
}

function SliderField({
  label,
  value,
  onChange,
  max = 2,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  max?: number
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      <input
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet-500"
      />
    </div>
  )
}
