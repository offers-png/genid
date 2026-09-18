import { verifySession } from '@/lib/verify'
import { getSession, lookupGenid } from '@/lib/supabase'
import { downloadFromSessionBucket, c2paExportStoragePath } from '@/lib/storage'
import { readC2paManifest } from '@/lib/c2pa'

// Public verification page (Build Spec Section 5.2.5) — no login required.
// A client, lawyer, or platform holding a certificate ID can land here
// directly and get a pass/fail read without a GenID account or this repo's
// source code.
export default async function VerifySessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await verifySession(id)

  if (!result.found) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="bg-gray-900 border border-red-800 rounded-xl p-8 text-center">
          <div className="text-2xl mb-2">✕</div>
          <h1 className="text-xl font-bold text-white mb-1">Session Not Found</h1>
          <p className="text-gray-400 text-sm">No GenID session exists with this ID.</p>
        </div>
      </div>
    )
  }

  const session = await getSession(id)
  const record = session ? await lookupGenid(session.genid_code) : null

  let c2pa: { validationState: string | null; validationStatus: unknown[] } | null = null
  let c2paCheckUnavailable = false
  if (session?.c2pa_manifest_id) {
    try {
      const buffer = await downloadFromSessionBucket(c2paExportStoragePath(id))
      const read = await readC2paManifest(buffer)
      c2pa = { validationState: read.validationState, validationStatus: read.validationStatus }
    } catch {
      // A manifest WAS recorded for this session — this is "we couldn't
      // read it right now" (storage/parsing issue), not "no manifest
      // exists." Distinct claims; the page should say which one this is.
      c2paCheckUnavailable = true
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Verification Result</h1>
        <p className="text-gray-400 text-sm break-all">Session {id}</p>
      </div>

      <div
        className={`rounded-xl border p-8 text-center mb-8 ${
          result.overallValid ? 'bg-gray-900 border-green-800' : 'bg-gray-900 border-red-800'
        }`}
      >
        <div className="text-3xl mb-2">{result.overallValid ? '✓' : '✕'}</div>
        <h2 className="text-xl font-bold text-white mb-1">
          {result.overallValid ? 'Integrity Verified' : 'Integrity Check Failed'}
        </h2>
        <p className="text-gray-400 text-sm">
          {result.overallValid
            ? 'Every step in this session, in order, matches its recorded signature.'
            : 'One or more steps do not match their recorded signature, or the chain has been altered.'}
        </p>
      </div>

      {record && (
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="text-xs text-gray-500 mb-1 font-mono">CREATOR</div>
          <div className="text-white">{record.user_name} ({record.genid_code})</div>
          <div className="text-xs text-gray-500 mt-1">
            {record.name_verified
              ? 'Name confirmed by ID document.'
              : 'Name self-reported at registration, not confirmed by an ID document.'}
            {' '}This shows who submitted this content through GenID — not necessarily who created the
            underlying image or whether it was AI-generated.
          </div>
        </div>
      )}

      <div className="space-y-3 mb-8">
        {result.steps.map(step => (
          <div
            key={step.stepId}
            className={`rounded-lg p-4 border ${step.valid ? 'bg-gray-900 border-gray-800' : 'bg-red-950/40 border-red-800'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-200">
                Step {step.stepNumber} — {step.stepType}
              </span>
              <span className={`text-xs font-mono ${step.valid ? 'text-green-400' : 'text-red-400'}`}>
                {step.valid ? 'VALID' : 'INVALID'}
              </span>
            </div>
            <div className="flex gap-4 text-xs text-gray-500 font-mono">
              <span
                className={
                  (step.fileArchived ? step.archiveIntegrityValid === true : step.fileHashValid)
                    ? 'text-gray-500'
                    : 'text-red-400'
                }
              >
                {step.fileArchived ? 'archive integrity' : 'file hash'}
              </span>
              <span className={step.signatureValid ? 'text-gray-500' : 'text-red-400'}>signature</span>
              <span className={step.chainLinkValid ? 'text-gray-500' : 'text-red-400'}>chain link</span>
            </div>
            {step.fileArchived && (
              <p className="text-xs text-gray-600 mt-2">
                This step&apos;s stored file was compressed for archival after finalize, per the retention policy.
                {step.archiveIntegrityValid === true
                  ? ' The compressed file has been checked against a hash and signature bound to this exact session/step/original-hash, recorded at archive time — a different, weaker guarantee than an unarchived step’s file hash, which matches the original output_hash directly.'
                  : ' No valid archive proof exists for this step’s current file — either none was recorded, or the recorded proof does not match. This step reports as UNVERIFIED even though its signature chain may still be intact, because the archived file’s own integrity cannot be confirmed.'}
              </p>
            )}
          </div>
        ))}
      </div>

      {result.finalized && (
        <div className="bg-gray-800 rounded-lg p-4 mb-3">
          <div className="text-xs text-gray-500 mb-1 font-mono">SESSION ROOT HASH</div>
          <div className="font-mono text-xs text-gray-300 break-all mb-2">{result.storedRootHash}</div>
          <div className={`text-xs ${result.rootHashValid ? 'text-green-400' : 'text-red-400'}`}>
            {result.rootHashValid ? 'Matches recomputed root hash' : 'Does not match recomputed root hash'}
          </div>
        </div>
      )}

      {result.polygonAnchorTx && (
        <div className="bg-gray-800 rounded-lg p-4 mb-3">
          <div className="text-xs text-gray-500 mb-1 font-mono">POLYGON ANCHOR</div>
          <div className="font-mono text-xs text-gray-300 break-all mb-2">{result.polygonAnchorTx}</div>
          <div
            className={`text-xs ${
              result.polygonStatus === 'confirmed'
                ? 'text-green-400'
                : result.polygonStatus === 'unavailable'
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }`}
          >
            {result.polygonStatus === 'confirmed' && 'Confirmed on-chain — calldata matches the session root hash'}
            {result.polygonStatus === 'mismatch' && 'Found on-chain, but its calldata does NOT match this session’s root hash'}
            {result.polygonStatus === 'not_found' && 'This transaction hash could not be found on-chain'}
            {result.polygonStatus === 'unavailable' && 'Could not reach the blockchain to check right now — this is not evidence of a problem, just an unconfirmed check'}
          </div>
        </div>
      )}

      {c2paCheckUnavailable && (
        <div className="bg-gray-800 rounded-lg p-4 mb-3">
          <div className="text-xs text-gray-500 mb-1 font-mono">C2PA / CAWG MANIFEST</div>
          <div className="text-xs text-yellow-400">
            A manifest was recorded for this session, but it could not be read right now (storage or parsing
            issue) — this is not evidence the manifest is invalid, just an unconfirmed check. Try again later.
          </div>
        </div>
      )}

      {c2pa && (
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1 font-mono">C2PA / CAWG MANIFEST</div>
          <div className="text-sm text-gray-300 mb-2">
            Structurally {c2pa.validationState === 'Valid' ? 'valid' : 'invalid'} — readable by any C2PA-compatible
            tool. Signed with a real certificate that is <strong className="text-gray-100">not yet a member of the
            official C2PA Trust List</strong>, so third-party verifiers will correctly report the signing credential
            as untrusted until that registration is complete.
          </div>
          <ul className="text-xs font-mono text-gray-500 space-y-1">
            {c2pa.validationStatus.map((status, i) => {
              const s = status as { code?: string; explanation?: string }
              return <li key={i}>{s.code ?? 'unknown'}{s.explanation ? ` — ${s.explanation}` : ''}</li>
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
