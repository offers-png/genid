import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _admin: SupabaseClient | null = null

function getAdmin(): SupabaseClient {
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
