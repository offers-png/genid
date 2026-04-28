import { NextRequest, NextResponse } from 'next/server'
import { createIdentityVerificationSession } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'
import { issueUniqueGenid } from '@/lib/genid'

export async function POST(req: NextRequest) {
  try {
    const { fullName, email } = await req.json()

    if (!fullName || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    // Check if email already registered
    const { data: existing } = await supabaseAdmin
      .from('genid_registry')
      .select('genid_code, verified')
      .eq('email', email)
      .single()

    if (existing?.verified) {
      return NextResponse.json(
        { error: 'This email already has a verified GENID', genidCode: existing.genid_code },
        { status: 409 }
      )
    }

    // Pre-create the registry record (unverified) so we can link it after Stripe callback
    if (!existing) {
      const genidCode = await issueUniqueGenid(fullName)
      await supabaseAdmin.from('genid_registry').insert({
        genid_code: genidCode,
        user_name: fullName,
        email,
        verified: false,
      })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const { sessionId, url } = await createIdentityVerificationSession({
      email,
      returnUrl: `${baseUrl}/register/callback?email=${encodeURIComponent(email)}`,
    })

    return NextResponse.json({ sessionId, url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
