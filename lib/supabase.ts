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
  status: 'active' | 'finalized' | 'abandoned'
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

export async function finalizeSession(sessionId: string, finalStepId: string): Promise<void> {
  const { error } = await getAdmin()
    .from('genid_sessions')
    .update({ status: 'finalized', final_step_id: finalStepId, finalized_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) throw new Error(`Failed to finalize session: ${error.message}`)
}

export async function createStep(entry: Omit<StepRecord, 'id' | 'created_at'>): Promise<StepRecord> {
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

export async function markStepFinal(stepId: string): Promise<void> {
  const { error } = await getAdmin().from('genid_steps').update({ is_final_selection: true }).eq('id', stepId)
  if (error) throw new Error(`Failed to mark step final: ${error.message}`)
}

export async function createCertificate(
  entry: Omit<CertificateRecord, 'id' | 'generated_at'>
): Promise<CertificateRecord> {
  const { data, error } = await getAdmin().from('genid_certificates').insert(entry).select().single()
  if (error || !data) throw new Error(`Failed to create certificate: ${error?.message}`)
  return data as CertificateRecord
}
