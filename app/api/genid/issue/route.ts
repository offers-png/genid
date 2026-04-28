import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Called from the callback page after Stripe Identity verification
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('genid_registry')
    .select('genid_code, user_name, verified, created_at')
    .eq('email', email)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'No registration found for this email' }, { status: 404 })
  }

  return NextResponse.json(data)
}
