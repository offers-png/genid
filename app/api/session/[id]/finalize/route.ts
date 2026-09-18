import { NextRequest, NextResponse } from 'next/server'
import {
  getSession,
  getSessionSteps,
  getCertificateForSession,
  markStepFinal,
  finalizeSession,
  createCertificate,
  setSessionC2paManifestId,
  lookupGenid,
  tryBeginFinalizing,
  tryReclaimStaleFinalizing,
  abortFinalizing,
  recordPolygonAnchorTx,
  type StepRecord,
} from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { downloadFromSessionBucket, uploadToSessionBucket, c2paExportStoragePath } from '@/lib/storage'
import { generateCertificatePdf, buildCertificateSteps, type CertificateStep } from '@/lib/certificate'
import { computeSessionRootHash } from '@/lib/chain'
import { stampOnBlockchain } from '@/lib/blockchain'
import { withTimeout, EXTERNAL_CALL_TIMEOUT_MS } from '@/lib/limits'
import { embedC2paManifest } from '@/lib/c2pa'
import { archiveNonFinalSteps } from '@/lib/lifecycle'
import { env } from '@/lib/env'

// A lock older than this is treated as abandoned (crashed process, killed
// container) rather than a slow-but-live finalize — see
// tryReclaimStaleFinalizing. Normal finalize work (PDF + one Polygon call)
// finishes in well under a minute; 10 minutes gives generous headroom for a
// genuinely slow anchor call before assuming the original request is dead.
const STALE_LOCK_MS = 10 * 60 * 1000

// Thrown for any validation/precondition failure once we may already hold
// the finalize lock. A single catch block below both releases the lock (if
// held) and maps this to the right HTTP status — so "release the lock on
// validation failures," not just on unexpected exceptions, is structural
// rather than something each early-return branch has to remember to do.
class FinalizeError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// POST { stepId? } — the "finalize" button (Build Spec Sections 3.2.7 and
// 4.1.5 "Mark Final"). Marks the caller-chosen step final (defaulting to the
// latest step when omitted), computes the session_root_hash from every
// step's signature in order, anchors only that root hash to Polygon
// (Section 5.2.3 — not every step, for cost control), and generates the
// Authorship Certificate.
//
// Ordering matters here: the certificate PDF is built and uploaded BEFORE
// any write marks the session finalized. If PDF generation throws (it did —
// pdfkit's font files weren't reachable in the Render deploy, now fixed via
// serverExternalPackages in next.config.ts), the session is untouched and
// this same endpoint can just be called again.
//
// That also makes this route its own recovery path for sessions that got
// stuck under the old ordering (finalized in the DB, no certificate ever
// written): if status is already 'finalized', reuse the already-committed
// final_step_id / session_root_hash / polygon_anchor_tx instead of
// re-picking a step or paying for a second Polygon transaction, and just
// (re)generate the certificate. If a certificate already exists, return it
// as-is — this endpoint is idempotent, not just retriable.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let sessionId: string | undefined
  let lockAcquired = false
  let lockToken: string | null = null

  try {
    const resolvedParams = await params
    sessionId = resolvedParams.id
    const body = await req.json().catch(() => ({}))
    const requestedStepId = (body as { stepId?: string })?.stepId

    const caller = await getAuthenticatedRecord(req)
    if (!caller) {
      throw new FinalizeError('Sign in required.', 401)
    }

    const session = await getSession(sessionId)
    if (!session) {
      throw new FinalizeError('Session not found', 404)
    }
    if (session.genid_code !== caller.genid_code) {
      throw new FinalizeError('You do not have access to this session.', 403)
    }
    if (session.status === 'abandoned') {
      throw new FinalizeError('Session is abandoned', 409)
    }

    if (session.status === 'finalizing') {
      let isStale: boolean
      if (!session.finalizing_since) {
        // A 'finalizing' row with no timestamp is a data anomaly (every
        // path that sets this status also sets finalizing_since) — we
        // can't tell how long it's actually been held. The safe choice,
        // given every write below is idempotent-safe to redo, is to treat
        // it as reclaimable rather than blocking this session forever.
        console.warn(`Session ${sessionId} is 'finalizing' with no finalizing_since recorded — treating its lock as reclaimable.`)
        isStale = true
      } else {
        isStale = Date.now() - new Date(session.finalizing_since).getTime() > STALE_LOCK_MS
      }

      if (isStale) {
        const reclaim = await tryReclaimStaleFinalizing(sessionId, STALE_LOCK_MS)
        lockAcquired = reclaim.acquired
        lockToken = reclaim.token
      }
      if (!lockAcquired) {
        throw new FinalizeError(
          'Session is already being finalized by another request — try again shortly.',
          409
        )
      }
      // Reclaimed a stale lock: fall through and treat this exactly like a
      // fresh attempt on an 'active' session. Nothing is committed under
      // OUR token until the token-gated finalizeSession() call below, so
      // every step until then is safe to redo — a half-finished prior
      // attempt just gets its work recomputed or its already-persisted,
      // token-scoped writes (recordPolygonAnchorTx) reused as-is.
    }

    const alreadyFinalized = session.status === 'finalized'

    // Claim the session before doing any of the multi-step work below. This
    // is the actual race guard: two concurrent calls can both pass the
    // status checks above, but only one of them can win this atomic
    // update — the loser gets a clear "already finalizing" error instead of
    // redoing the generation/anchoring/upload work and racing on the final
    // writes.
    if (!alreadyFinalized && !lockAcquired) {
      const claim = await tryBeginFinalizing(sessionId)
      lockAcquired = claim.acquired
      lockToken = claim.token
      if (!lockAcquired) {
        throw new FinalizeError(
          'Session is already being finalized by another request — try again shortly.',
          409
        )
      }
    }

    if (alreadyFinalized) {
      const existing = await getCertificateForSession(sessionId)
      if (existing) {
        const pdfBuffer = await downloadFromSessionBucket(existing.pdf_export_path!)
        return NextResponse.json({
          certificateId: existing.id,
          pdfBase64: pdfBuffer.toString('base64'),
          sessionRootHash: session.session_root_hash,
          polygonAnchorTx: session.polygon_anchor_tx,
          verifyUrl: existing.public_verify_url,
        })
      }
    }

    const steps = await getSessionSteps(sessionId)

    let finalStep: StepRecord | undefined
    if (alreadyFinalized) {
      // Recovering a stuck session — the final step was already chosen and
      // committed; don't let a retry silently change it.
      finalStep = steps.find((s) => s.id === session.final_step_id)
      if (!finalStep) {
        throw new FinalizeError('Session is finalized but its final step record is missing — cannot recover', 500)
      }
    } else {
      finalStep = requestedStepId ? steps.find((s) => s.id === requestedStepId) : steps[steps.length - 1]
      if (!finalStep) {
        const message = requestedStepId ? 'stepId does not belong to this session' : 'Session has no steps to finalize'
        throw new FinalizeError(message, 400)
      }
    }

    const record = await lookupGenid(session.genid_code)
    if (!record) {
      throw new FinalizeError('Registry record not found for this session', 500)
    }

    // Root hash covers every step in the chain, in order — not just the
    // final selection — since the whole point is proving the sequence
    // wasn't reordered or pruned, not just that the chosen output is intact.
    // Reuse what's already stored on a recovery pass rather than recomputing.
    const sessionRootHash = session.session_root_hash ?? computeSessionRootHash(steps.map((s) => s.step_signature ?? ''))

    let polygonAnchorTx = session.polygon_anchor_tx
    if (!polygonAnchorTx && !alreadyFinalized) {
      try {
        const stamp = await withTimeout(
          stampOnBlockchain({
            genidCode: session.genid_code,
            contentHash: sessionRootHash,
            fileName: `session-${sessionId}`,
          }),
          EXTERNAL_CALL_TIMEOUT_MS,
          'Polygon anchor'
        )
        polygonAnchorTx = stamp.txHash
        // Persist the tx and refresh the lock heartbeat IMMEDIATELY — not
        // at the end with everything else. If this request's lock later
        // gets reclaimed as stale (e.g. it crashes during the still-slow
        // PDF/C2PA work below), the new holder's getSession() read will
        // already see this txHash and skip anchoring again, instead of
        // submitting a second on-chain transaction for the same root hash.
        if (lockToken) {
          await recordPolygonAnchorTx(sessionId, lockToken, polygonAnchorTx)
        }
      } catch (blockchainErr) {
        console.error('Polygon anchor failed (non-fatal):', blockchainErr)
      }
    }

    const generatedAt = new Date()
    const totalDurationSeconds = Math.max(
      0,
      Math.round((generatedAt.getTime() - new Date(session.created_at).getTime()) / 1000)
    )

    const certificateSteps: CertificateStep[] = await buildCertificateSteps(steps, finalStep.id)

    const publicVerifyUrl = `${env.appUrl}/session/verify/${sessionId}`

    // C2PA manifest embedding (Build Spec Section 8) — best-effort and
    // deliberately non-fatal, done before the PDF so the certificate can
    // accurately say whether one is attached. It signs with a real, valid,
    // non-self-signed certificate chain, but one issued outside the
    // official C2PA Conformance Program, so it reads as untrusted in any
    // third-party verifier (see lib/c2pa.ts for the full explanation,
    // verified against a real embed/read-back round trip). A C2PA failure
    // here never touches genid_sessions/genid_steps, so it can't re-create
    // the stuck-session bug the ordering in this route already prevents.
    let c2paManifestId: string | null = null
    const finalCertStep = certificateSteps.find((s) => s.isFinal)
    if (finalCertStep?.imageBuffer) {
      try {
        const c2paResult = await embedC2paManifest({
          sessionId,
          genidCode: session.genid_code,
          steps,
          finalImageBuffer: finalCertStep.imageBuffer,
        })
        await uploadToSessionBucket(c2paExportStoragePath(sessionId), c2paResult.signedImageBuffer, 'image/png', {
          upsert: true,
        })
        c2paManifestId = c2paResult.manifestLabel
      } catch (c2paErr) {
        console.error('C2PA manifest embedding failed (non-fatal):', c2paErr)
      }
    }

    // Everything above this line is read-only or idempotent to repeat. The
    // PDF generation below is the step that actually failed in production —
    // nothing has been written to genid_sessions/genid_steps yet, so a
    // throw here still leaves the session cleanly retriable.
    const pdfBuffer = await generateCertificatePdf({
      genidCode: session.genid_code,
      creatorName: record.user_name,
      nameVerified: record.name_verified ?? false,
      sessionId: session.id,
      totalSteps: steps.length,
      totalDurationSeconds,
      steps: certificateSteps,
      generatedAt,
      verifyUrl: publicVerifyUrl,
      c2paManifestEmbedded: c2paManifestId !== null,
      sessionRootHash,
      polygonAnchorTx,
    })

    const pdfPath = `${sessionId}/certificate.pdf`
    await uploadToSessionBucket(pdfPath, pdfBuffer, 'application/pdf', { upsert: true })

    // Only now commit the finalized state. finalizeSession — the write
    // that actually transitions the session out of 'finalizing' — goes
    // FIRST and is token-gated: if this request's lock has since been
    // reclaimed by another process (this one ran long enough to look
    // dead), that update affects zero rows and we must stop here rather
    // than going on to mark a step final or write a certificate as if we
    // still owned this session's finalize.
    if (!alreadyFinalized) {
      if (!lockToken) {
        throw new FinalizeError('Internal error: finalizing without a lock token', 500)
      }
      const committed = await finalizeSession(sessionId, finalStep.id, sessionRootHash, polygonAnchorTx, lockToken)
      if (!committed) {
        // Not our lock to release — a different request already holds
        // it under a different token. Nothing we did above was written
        // anywhere durable except the token-scoped anchor tx (already
        // safely reusable by whoever holds the lock now), so there is
        // nothing to clean up.
        lockAcquired = false
        throw new FinalizeError(
          'This session’s finalize lock was reclaimed by another request while this one was still working — nothing was committed. Please retry.',
          409
        )
      }
    }
    await markStepFinal(finalStep.id, sessionId)
    if (c2paManifestId) {
      await setSessionC2paManifestId(sessionId, c2paManifestId)
    }

    // Storage lifecycle (Build Spec Section 7) — compress every non-final
    // step's stored output now that the session is finalized. Non-fatal and
    // idempotent (skips already-archived steps), so a re-run of finalize on
    // an already-finalized session just leaves this as a no-op.
    try {
      await archiveNonFinalSteps(sessionId)
    } catch (archiveErr) {
      console.error('Non-final step archival failed (non-fatal):', archiveErr)
    }

    const certificate = await createCertificate({
      session_id: sessionId,
      pdf_export_path: pdfPath,
      json_export_path: null,
      c2pa_manifest_embedded: c2paManifestId !== null,
      public_verify_url: publicVerifyUrl,
      total_steps: steps.length,
      total_duration_seconds: totalDurationSeconds,
      content_type: session.content_type,
      identity_verification_tier: session.identity_verification_tier,
      final_output_thumbnail_path: finalStep.output_storage_path,
    })

    return NextResponse.json({
      certificateId: certificate.id,
      pdfBase64: pdfBuffer.toString('base64'),
      sessionRootHash,
      polygonAnchorTx,
      verifyUrl: publicVerifyUrl,
      c2paManifestEmbedded: c2paManifestId !== null,
    })
  } catch (err: unknown) {
    // Release the lock so the session isn't stuck in 'finalizing' forever —
    // token-scoped in abortFinalizing, so this is a harmless no-op both
    // when the failure happened after finalizeSession() already moved the
    // session to 'finalized' (handled by this route's own stuck-session
    // recovery path instead) AND when a different request has since
    // reclaimed this lock under a new token (releasing THAT lock would be
    // exactly the bug this token scheme exists to prevent). Runs for EVERY
    // failure path once the lock is held, including plain validation
    // errors (FinalizeError), not just unexpected exceptions.
    if (lockAcquired && sessionId && lockToken) {
      try {
        await abortFinalizing(sessionId, lockToken)
      } catch (releaseErr) {
        console.error('Failed to release finalize lock:', releaseErr)
      }
    }
    if (err instanceof FinalizeError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Finalize failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
