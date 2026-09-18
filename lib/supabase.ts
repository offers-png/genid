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
  identity_verification_tier: string | null
  c2pa_manifest_id: string | null
  created_at: string
  finalized_at: string | null
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

// Atomically claims a session for finalizing — an UPDATE ... WHERE
// status = 'active' either affects exactly one row (we won the race) or
// zero (someone else already claimed it, or it's in some other state), so
// two concurrent finalize calls can't both proceed through generation,
// upload, and anchoring for the same session.
export async function tryBeginFinalizing(sessionId: string): Promise<boolean> {
  const { data, error } = await getAdmin()
    .from('genid_sessions')
    .update({ status: 'finalizing' })
    .eq('id', sessionId)
    .eq('status', 'active')
    .select('id')

  if (error) throw new Error(`Failed to begin finalize: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// Releases a finalize lock this same request acquired, so a failure partway
// through (e.g. PDF generation throws) leaves the session retriable instead
// of stuck in 'finalizing' forever. Scoped to WHERE status = 'finalizing' so
// it can never clobber a session that some other path already moved on from.
export async function abortFinalizing(sessionId: string): Promise<void> {
  const { error } = await getAdmin()
    .from('genid_sessions')
    .update({ status: 'active' })
    .eq('id', sessionId)
    .eq('status', 'finalizing')

  if (error) throw new Error(`Failed to release finalize lock: ${error.message}`)
}

export async function finalizeSession(
  sessionId: string,
  finalStepId: string,
  sessionRootHash: string,
  polygonAnchorTx: string | null
): Promise<void> {
  const { error } = await getAdmin()
    .from('genid_sessions')
    .update({
      status: 'finalized',
      final_step_id: finalStepId,
      finalized_at: new Date().toISOString(),
      session_root_hash: sessionRootHash,
      polygon_anchor_tx: polygonAnchorTx,
    })
    .eq('id', sessionId)

  if (error) throw new Error(`Failed to finalize session: ${error.message}`)
}

export async function createStep(
  entry: Omit<StepRecord, 'id' | 'created_at' | 'output_archived' | 'archive_hash' | 'archive_signature'>
): Promise<StepRecord> {
  const { data, error } = await getAdmin().from('genid_steps').insert(entry).select().single()
  if (error || !data) throw new Error(`Failed to create step: ${error?.message}`)
  return data as StepRecord
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

export async function markStepArchived(stepId: string, archiveHash: string, archiveSignature: string): Promise<void> {
  const { error } = await getAdmin()
    .from('genid_steps')
    .update({ output_archived: true, archive_hash: archiveHash, archive_signature: archiveSignature })
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
