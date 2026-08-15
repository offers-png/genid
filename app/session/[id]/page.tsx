import { notFound } from 'next/navigation'
import { getSession, getSessionSteps, getCertificateForSession } from '@/lib/supabase'
import { downloadFromSessionBucket } from '@/lib/storage'
import SessionWorkspace, { type StepView } from '../SessionWorkspace'

// The durable, bookmarkable view of a session — reachable from the
// dashboard, a saved link, or browser history, not just live in the tab
// that created it. Loads everything server-side (including each step's
// image, base64-encoded here rather than served through a separate route)
// and hands it to the same workspace component the creation flow uses.
export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params

  const session = await getSession(sessionId)
  if (!session) notFound()

  const steps = await getSessionSteps(sessionId)

  const stepViews: StepView[] = await Promise.all(
    steps.map(async (step): Promise<StepView> => {
      let imageBase64 = ''
      if (step.output_storage_path) {
        try {
          const buffer = await downloadFromSessionBucket(step.output_storage_path)
          imageBase64 = buffer.toString('base64')
        } catch {
          imageBase64 = ''
        }
      }
      return {
        id: step.id,
        stepNumber: step.step_number,
        stepType: step.step_type,
        editType: step.edit_type,
        promptText: step.prompt_text,
        userNote: step.user_note,
        outputHash: step.output_hash ?? '',
        stepSignature: step.step_signature ?? '',
        // Every Phase 1/2 output (generation + crop/color_adjust edits) is
        // re-encoded as PNG — see lib/adapters/openai-image.ts and lib/edits.ts.
        mimeType: 'image/png',
        imageBase64,
      }
    })
  )

  const isFinalized = session.status === 'finalized'
  const certificate = isFinalized ? await getCertificateForSession(sessionId) : null

  return (
    <SessionWorkspace
      sessionId={sessionId}
      initialSteps={stepViews}
      initialFinalStepId={session.final_step_id}
      initialStatus={isFinalized ? 'finalized' : 'active'}
      initialCertificate={
        certificate
          ? {
              certificateId: certificate.id,
              verifyUrl: certificate.public_verify_url,
              c2paManifestEmbedded: certificate.c2pa_manifest_embedded,
            }
          : null
      }
    />
  )
}
