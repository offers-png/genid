import { supabaseAdmin } from './supabase'

// Format: first 2 letters of name (uppercase) + 5 random digits
// e.g. Saleh -> SA11212
export function generateGenidCode(fullName: string): string {
  const prefix = fullName
    .trim()
    .replace(/[^a-zA-Z]/g, '')
    .substring(0, 2)
    .toUpperCase()
    .padEnd(2, 'X')

  const digits = Math.floor(10000 + Math.random() * 90000).toString()
  return `${prefix}${digits}`
}

export async function issueUniqueGenid(fullName: string): Promise<string> {
  let attempts = 0
  while (attempts < 10) {
    const code = generateGenidCode(fullName)
    const { data } = await supabaseAdmin
      .from('genid_registry')
      .select('genid_code')
      .eq('genid_code', code)
      .single()

    if (!data) return code
    attempts++
  }
  // Fallback: use timestamp suffix for guaranteed uniqueness
  const prefix = fullName.trim().replace(/[^a-zA-Z]/g, '').substring(0, 2).toUpperCase().padEnd(2, 'X')
  return `${prefix}${Date.now().toString().slice(-5)}`
}

export async function registerGenid(params: {
  fullName: string
  email: string
  stripeVerificationId: string
}): Promise<{ genidCode: string }> {
  const genidCode = await issueUniqueGenid(params.fullName)

  const { error } = await supabaseAdmin.from('genid_registry').insert({
    genid_code: genidCode,
    user_name: params.fullName,
    email: params.email,
    stripe_verification_id: params.stripeVerificationId,
    verified: true,
  })

  if (error) throw new Error(`Failed to register GENID: ${error.message}`)
  return { genidCode }
}

export async function markVerified(email: string, stripeVerificationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('genid_registry')
    .update({ verified: true, stripe_verification_id: stripeVerificationId })
    .eq('email', email)
    .select('genid_code')
    .single()

  if (error || !data) return null
  return data.genid_code
}
