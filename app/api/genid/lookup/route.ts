import { NextRequest, NextResponse } from 'next/server'
import { lookupGenid, getContentHistory } from '@/lib/supabase'
import { VERIFY_RATE_LIMIT, VERIFY_RATE_WINDOW_MS, checkInMemoryRateLimit, getClientIp } from '@/lib/limits'

// Public endpoint: look up a GENID code to get creator info + content
// history. GENID codes are only 2 letters + 5 digits (~67M combinations)
// and this had no rate limit at all — an IP-based limiter, same pattern as
// /api/verify, at least bounds how fast that space can be brute-forced.
export async function GET(req: NextRequest) {
  const clientIp = getClientIp(req)
  if (!checkInMemoryRateLimit(`lookup:${clientIp}`, VERIFY_RATE_LIMIT, VERIFY_RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many lookup requests. Please wait a few minutes and try again.' },
      { status: 429 }
    )
  }

  const code = req.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.json({ error: 'GENID code required' }, { status: 400 })
  }

  const record = await lookupGenid(code.toUpperCase())
  if (!record) {
    return NextResponse.json({ error: 'GENID not found' }, { status: 404 })
  }

  const history = await getContentHistory(code.toUpperCase())

  return NextResponse.json({
    genidCode: record.genid_code,
    creatorName: record.user_name,
    verified: record.verified,
    nameVerified: record.name_verified ?? false,
    registeredAt: record.created_at,
    contentCount: history.length,
    recentContent: history.slice(0, 5),
  })
}
