import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _admin: SupabaseClient | null = null

export function getAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _admin
}

export interface GenidRecord {
  id: string
  genid_code: string
  user_name: string
  self_reported_name?: string | null
  name_verified?: boolean
  email: string
  stripe_verification_id: string | null
  verified: boolean
  created_at: string
}

export interface ContentLogRecord {
  id: string
  genid_code: string
  content_hash: string
  file_name: string | null
  file_type: string | null
  platform: string
  blockchain_tx_hash: string | null
  blockchain_network: string
  notary_signature?: string | null
  notary_timestamp?: number | null
  notary_hash?: string | null
  created_at: string
}

export const supabaseAdmin = {
  from: (table: string) => getAdmin().from(table),
}

export async function lookupGenid(genidCode: string): Promise<GenidRecord | null> {
  const { data, error } = await getAdmin()
    .from('genid_registry')
    .select('*')
    .eq('genid_code', genidCode)
    .single()

  if (error || !data) return null
  return data as GenidRecord
}

export async function lookupByEmail(email: string): Promise<GenidRecord | null> {
  const { data, error } = await getAdmin()
    .from('genid_registry')
    .select('*')
    .eq('email', email)
    .single()

  if (error || !data) return null
  return data as GenidRecord
}

export async function getContentHistory(genidCode: string): Promise<ContentLogRecord[]> {
  const { data, error } = await getAdmin()
    .from('genid_content_log')
    .select('*')
    .eq('genid_code', genidCode)
    .order('created_at', { ascending: false })

  if (error || !data) return []
  return data as ContentLogRecord[]
}

export async function logContent(entry: Omit<ContentLogRecord, 'id' | 'created_at'>): Promise<ContentLogRecord | null> {
  const { data, error } = await getAdmin()
    .from('genid_content_log')
    .insert(entry)
    .select()
    .single()

  if (error || !data) return null
  return data as ContentLogRecord
}

export interface SessionRecord {
  id: string
  genid_code: string
  content_type: string
  status: 'active' | 'finalizing' | 'finalized' | 'abandoned'
  final_step_id: string | null
  session_root_hash: string | null
  polygon_anchor_tx: string | null
  polygon_anchor_root_hash: string | null
  identity_verification_tier: string | null
  c2pa_manifest_id: string | null
  created_at: string
  finalized_at: string | null
  finalizing_since: string | null
}

export interface StepRecord {
  id: string
  session_id: string
  step_number: number
  step_type: 'generate' | 'regenerate' | 'edit' | 'discard'
  edit_type: string | null
  prompt_text: string | null
  model_used: string | null
  model_request_id: string | null
  request_timestamp: string | null
  response_timestamp: string | null
  output_storage_path: string | null
  output_hash: string | null
  prior_step_signature: string | null
  step_hash: string | null
  step_signature: string | null
  user_note: string | null
  auto_suggested_note: string | null
  is_final_selection: boolean
  output_archived: boolean
  archive_hash: string | null
  archive_signature: string | null
  created_at: string
}

export interface CertificateRecord {
  id: string
  session_id: string
  generated_at: string
  pdf_export_path: string | null
  json_export_path: string | null
  c2pa_manifest_embedded: boolean
  public_verify_url: string | null
  total_steps: number | null
  total_duration_seconds: number | null
  content_type: string | null
  identity_verification_tier: string | null
  final_output_thumbnail_path: string | null
}

export async function createSession(entry: {
  genid_code: string
  content_type: string
  identity_verification_tier: string
}): Promise<SessionRecord> {
  const { data, error } = await getAdmin()
    .from('genid_sessions')
    .insert({ ...entry, status: 'active' })
    .select()
    .single()

  if (error || !data) throw new Error(`Failed to create session: ${error?.message}`)
  return data as SessionRecord
}

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
  const { data, error } = await getAdmin().from('genid_sessions').select('*').eq('id', sessionId).single()
  if (error || !data) return null
  return data as SessionRecord
}

export interface FinalizeLock {
  acquired: boolean
  token: string | null
}

// Atomically claims a session for finalizing — an UPDATE ... WHERE
// status = 'active' either affects exactly one row (we won the race) or
// zero (someone else already claimed it, or it's in some other state), so
// two concurrent finalize calls can't both proceed through generation,
// upload, and anchoring for the same session.
//
// Returns a fresh ownership token with the lock. Every later write this
// request makes against the lock (abortFinalizing, finalizeSession) must
// present this same token — see finalizing_lock_token (migration 010) for
// why: without an owner, a request that merely ran long (not actually
// dead) could clobber a DIFFERENT request's lock after
// tryReclaimStaleFinalizing gave it away.
export async function tryBeginFinalizing(sessionId: string): Promise<FinalizeLock> {
  const token = crypto.randomUUID()
  const { data, error } = await getAdmin()
    .from('genid_sessions')
    .update({ status: 'finalizing', finalizing_since: new Date().toISOString(), finalizing_lock_token: token })
    .eq('id', sessionId)
    .eq('status', 'active')
    .select('id')

  if (error) throw new Error(`Failed to begin finalize: ${error.message}`)
  return (data?.length ?? 0) > 0 ? { acquired: true, token } : { acquired: false, token: null }
}

// Reclaims a 'finalizing' lock that's been held longer than staleAfterMs —
// recovery for a crash that skipped even the finalize route's own catch
// block (process kill, uncaught rejection), which is the one way a session
// could get stuck in 'finalizing' forever under the normal abortFinalizing
// path. Same atomic claim pattern as tryBeginFinalizing: the WHERE clause
// (status = 'finalizing' AND finalizing_since older than the cutoff) means
// only a genuinely stale lock can be reclaimed, and only one caller wins if
// several try at once. Issues a NEW token, invalidating whatever the
// previous (presumed-dead) holder had — if that holder turns out to still
// be alive, its subsequent abortFinalizing/finalizeSession calls present
// the old token and are correctly rejected as no-ops instead of disturbing
// the new holder's work.
export async function tryReclaimStaleFinalizing(sessionId: string, staleAfterMs: number): Promise<FinalizeLock> {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString()
  const token = crypto.randomUUID()
  const { data, error } = await getAdmin()
    .from('genid_sessions')
    .update({ status: 'finalizing', finalizing_since: new Date().toISOString(), finalizing_lock_token: token })
    .eq('id', sessionId)
    .eq('status', 'finalizing')
    .lt('finalizing_since', cutoff)
    .select('id')

  if (error) throw new Error(`Failed to reclaim stale finalize lock: ${error.message}`)
  return (data?.length ?? 0) > 0 ? { acquired: true, token } : { acquired: false, token: null }
}

// Releases a finalize lock this same request acquired, so a failure partway
// through (e.g. PDF generation throws) leaves the session retriable instead
// of stuck in 'finalizing' forever. Scoped to WHERE status = 'finalizing'
// AND finalizing_lock_token = token, so this can never clobber a session
// some other path already moved on from OR a lock a different request has
// since taken over (a stale reclaim would have issued a different token).
export async function abortFinalizing(sessionId: string, token: string): Promise<void> {
  const { error } = await getAdmin()
    .from('genid_sessions')
    .update({ status: 'active', finalizing_since: null, finalizing_lock_token: null })
    .eq('id', sessionId)
    .eq('status', 'finalizing')
    .eq('finalizing_lock_token', token)

  if (error) throw new Error(`Failed to release finalize lock: ${error.message}`)
}

// Persists a successful Polygon anchor IMMEDIATELY (rather than waiting for
// the final finalizeSession() commit, which can be minutes later once C2PA
// embedding and PDF generation finish) so a retry — even one that reclaimed
// this request's lock after a crash — sees polygon_anchor_tx already set on
// its next getSession() read and can decide whether to reuse it. Token-scoped:
// if the lock has since been reclaimed, this write is dropped (0 rows),
// which is correct — the new holder does its own anchor and will persist
// its own tx.
//
// rootHash is stored alongside the tx (polygon_anchor_root_hash) so a later
// read can tell whether this anchor still matches the content it's about
// to finalize — a failed attempt followed by an edit changes the step list,
// and so the root hash, and a stale anchor for the OLD root hash must never
// be presented as if it covers the new content (Sept 18 third follow-up).
//
// Also refreshes finalizing_since as a heartbeat: a finalize call that's
// genuinely still progressing (not stuck) shouldn't have its lock stolen by
// tryReclaimStaleFinalizing just because the remaining work (PDF/C2PA) is
// taking a while — a real anchor transaction landing is solid evidence the
// process is alive.
export async function recordPolygonAnchorTx(
  sessionId: string,
  token: string,
  txHash: string,
  rootHash: string
): Promise<boolean> {
  const { data, error } = await getAdmin()
    .from('genid_sessions')
    .update({ polygon_anchor_tx: txHash, polygon_anchor_root_hash: rootHash, finalizing_since: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'finalizing')
    .eq('finalizing_lock_token', token)
    .select('id')

  if (error) throw new Error(`Failed to record Polygon anchor: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// Token-gated: this is the write that actually transitions the session out
// of 'finalizing', so it's the one that MUST fail loudly if this request's
// lock has been superseded — a caller that lost ownership must not go on to
// mark a step final or generate a certificate as if it still held the lock.
// Returns false (not a thrown error) when the token no longer matches, so
// the route can react without treating it as an unexpected failure.
export async function finalizeSession(
  sessionId: string,
  finalStepId: string,
  sessionRootHash: string,
  polygonAnchorTx: string | null,
  token: string
): Promise<boolean> {
  const { data, error } = await getAdmin()
    .from('genid_sessions')
    .update({
      status: 'finalized',
      final_step_id: finalStepId,
      finalized_at: new Date().toISOString(),
      session_root_hash: sessionRootHash,
      polygon_anchor_tx: polygonAnchorTx,
      finalizing_lock_token: null,
    })
    .eq('id', sessionId)
    .eq('status', 'finalizing')
    .eq('finalizing_lock_token', token)
    .select('id')

  if (error) throw new Error(`Failed to finalize session: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// Inserts a step ONLY IF the session is still 'active' at insert time,
// checked and written inside a single Postgres transaction (see
// create_step_if_session_active, migration 010) — closes the race where a
// slow generate/regenerate/edit call could still land its INSERT after
// finalize had already read the step list and computed the root hash.
// Throws a recognizable error (checked via isSessionNotActiveError) rather
// than a generic one, so the route can return 409 instead of 500.
export async function createStepIfActive(
  entry: Omit<StepRecord, 'id' | 'created_at' | 'output_archived' | 'archive_hash' | 'archive_signature'>
): Promise<StepRecord> {
  const { data, error } = await getAdmin().rpc('create_step_if_session_active', {
    p_session_id: entry.session_id,
    p_step_number: entry.step_number,
    p_step_type: entry.step_type,
    p_edit_type: entry.edit_type,
    p_prompt_text: entry.prompt_text,
    p_model_used: entry.model_used,
    p_model_request_id: entry.model_request_id,
    p_request_timestamp: entry.request_timestamp,
    p_response_timestamp: entry.response_timestamp,
    p_output_storage_path: entry.output_storage_path,
    p_output_hash: entry.output_hash,
    p_prior_step_signature: entry.prior_step_signature,
    p_step_hash: entry.step_hash,
    p_step_signature: entry.step_signature,
    p_user_note: entry.user_note,
    p_auto_suggested_note: entry.auto_suggested_note,
  })

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Failed to create step: no data returned')
  return data as StepRecord
}

export function isSessionNotActiveError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('SESSION_NOT_ACTIVE')
}

export async function getSessionSteps(sessionId: string): Promise<StepRecord[]> {
  const { data, error } = await getAdmin()
    .from('genid_steps')
    .select('*')
    .eq('session_id', sessionId)
    .order('step_number', { ascending: true })

  if (error || !data) return []
  return data as StepRecord[]
}

export async function markStepFinal(stepId: string, sessionId: string): Promise<void> {
  const admin = getAdmin()

  // Clear any prior final flag session-wide first — finalize can run again on
  // an already-finalized session (recovery path) or re-pick a different step,
  // and without this a step marked final earlier keeps its badge forever.
  const { error: clearErr } = await admin
    .from('genid_steps')
    .update({ is_final_selection: false })
    .eq('session_id', sessionId)
  if (clearErr) throw new Error(`Failed to clear prior final step: ${clearErr.message}`)

  const { error } = await admin.from('genid_steps').update({ is_final_selection: true }).eq('id', stepId)
  if (error) throw new Error(`Failed to mark step final: ${error.message}`)
}

// newStoragePath points output_storage_path at the ALREADY-UPLOADED
// compressed file — this write is what makes archival recoverable
// (lib/lifecycle.ts): the compressed file is uploaded to its own new path
// (the original is left untouched) and hashed BEFORE this call, so a crash
// before this DB write leaves the original step exactly as it was
// (output_archived still false, output_storage_path still the original —
// safely retriable) rather than a file silently swapped out from under a
// DB row that doesn't know about it yet.
export async function markStepArchived(
  stepId: string,
  archiveHash: string,
  archiveSignature: string,
  newStoragePath: string
): Promise<void> {
  const { error } = await getAdmin()
    .from('genid_steps')
    .update({
      output_archived: true,
      archive_hash: archiveHash,
      archive_signature: archiveSignature,
      output_storage_path: newStoragePath,
    })
    .eq('id', stepId)
  if (error) throw new Error(`Failed to mark step archived: ${error.message}`)
}

export async function setSessionC2paManifestId(sessionId: string, manifestId: string): Promise<void> {
  const { error } = await getAdmin().from('genid_sessions').update({ c2pa_manifest_id: manifestId }).eq('id', sessionId)
  if (error) throw new Error(`Failed to set C2PA manifest id: ${error.message}`)
}

export async function createCertificate(
  entry: Omit<CertificateRecord, 'id' | 'generated_at'>
): Promise<CertificateRecord> {
  const { data, error } = await getAdmin().from('genid_certificates').insert(entry).select().single()
  if (error) {
    // Unique constraint on session_id — a concurrent request already
    // created the certificate first. Return that one instead of failing;
    // the finalize lock makes this vanishingly rare, but the constraint
    // (and this fallback) is the actual guarantee against duplicates.
    if (error.code === '23505') {
      const existing = await getCertificateForSession(entry.session_id)
      if (existing) return existing
    }
    throw new Error(`Failed to create certificate: ${error.message}`)
  }
  if (!data) throw new Error('Failed to create certificate: no data returned')
  return data as CertificateRecord
}

export async function getCertificateForSession(sessionId: string): Promise<CertificateRecord | null> {
  const { data, error } = await getAdmin()
    .from('genid_certificates')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (error || !data) return null
  return data as CertificateRecord
}

// Rate limiting for generation requests (lib/limits.ts) — counts steps of
// type 'generate'/'regenerate' created for this identity in the given
// window, across ALL of its sessions, via PostgREST's embedded-resource
// filter (`genid_sessions!inner`) rather than fetching every step client
// side. Every generate/regenerate step calls a paid external model API, so
// this is what actually bounds spend per identity, not just per session.
export async function countRecentGenerationsForGenid(genidCode: string, sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs).toISOString()
  const { count, error } = await getAdmin()
    .from('genid_steps')
    .select('id, genid_sessions!inner(genid_code)', { count: 'exact', head: true })
    .eq('genid_sessions.genid_code', genidCode)
    .in('step_type', ['generate', 'regenerate'])
    .gte('created_at', since)

  if (error) {
    console.error('Failed to count recent generations (failing open):', error.message)
    return 0
  }
  return count ?? 0
}

export async function listSessionsForGenid(genidCode: string): Promise<SessionRecord[]> {
  const { data, error } = await getAdmin()
    .from('genid_sessions')
    .select('*')
    .eq('genid_code', genidCode)
    .order('created_at', { ascending: false })

  if (error || !data) return []
  return data as SessionRecord[]
}

export async function getCertificatesForSessions(sessionIds: string[]): Promise<CertificateRecord[]> {
  if (sessionIds.length === 0) return []
  const { data, error } = await getAdmin().from('genid_certificates').select('*').in('session_id', sessionIds)
  if (error || !data) return []
  return data as CertificateRecord[]
}
