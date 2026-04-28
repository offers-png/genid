import { NextRequest, NextResponse } from 'next/server'
import { lookupGenid, getContentHistory } from '@/lib/supabase'

// Public endpoint: look up a GENID code to get creator info + content history
export async function GET(req: NextRequest) {
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
    registeredAt: record.created_at,
    contentCount: history.length,
    recentContent: history.slice(0, 5),
  })
}
