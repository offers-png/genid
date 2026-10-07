import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedRecord } from '@/lib/auth'
import { exportAccountData } from '@/lib/account'

// GET — the account's own data as one downloadable JSON document (sessions,
// steps, certificates, stamp history, API key metadata — never raw key
// secrets, which aren't recoverable even by us). Session-cookie-authenticated
// only, not API-key-authenticated — same reasoning as POST /api/account/api-keys:
// a leaked API key shouldn't be able to pull a full account export any more
// than it should be able to mint new keys.
export async function GET(req: NextRequest) {
  const record = await getAuthenticatedRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const data = await exportAccountData(record.genid_code)
  if (!data) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="genid-${record.genid_code}-export.json"`,
    },
  })
}
