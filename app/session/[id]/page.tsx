import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getSession, getSessionSteps, getCertificateForSession } from '@/lib/supabase'
import { resolveSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'
import SessionWorkspace, { type StepView } from '../SessionWorkspace'

// The durable, bookmarkable view of a session — reachable from the
// dashboard, a saved link, or browser history, not just live in the tab
// that created it.
//
// Step images are NOT downloaded/base64-encoded here — for a session with
// many steps that meant blocking this page's render on N sequential/
// parallel Storage round-trips and embedding every image (at whatever
// resolution it happened to be stored at) directly into the page payload
// (Sept 18 second follow-up, "Improve large-session loading"). Instead
// each StepView just carries an imageUrl pointing at
// /api/session/[id]/step/[stepId]/image, which the browser fetches lazily
// per <img> tag, in parallel, with normal HTTP caching — the same data,
// loaded the way browsers are actually good at loading images.
//
// A session's own URL used to be enough to view it — no ownership check at
// all (Security & Trust Fix Punch List #4, Sept 18 follow-up). Not signed
// in redirects to /login; signed in as someone else's identity 404s rather
// than confirming the session exists for a non-owner.
export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params

  const cookieStore = await cookies()
  const caller = await resolveSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value)
  if (!caller) redirect('/login')

  const session = await getSession(sessionId)
  if (!session) notFound()
  if (session.genid_code !== caller.genid_code) notFound()

  const steps = await getSessionSteps(sessionId)

  const stepViews: StepView[] = steps.map((step): StepView => ({
    id: step.id,
    stepNumber: step.step_number,
    stepType: step.step_type,
    editType: step.edit_type,
    promptText: step.prompt_text,
    userNote: step.user_note,
    outputHash: step.output_hash ?? '',
    stepSignature: step.step_signature ?? '',
    imageUrl: `/api/session/${sessionId}/step/${step.id}/image`,
  }))

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
