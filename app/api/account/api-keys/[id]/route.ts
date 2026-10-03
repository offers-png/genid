import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedRecord } from '@/lib/auth'
import { revokeApiKey } from '@/lib/apiKeys'

// DELETE — revokes one of the caller's own API keys. Scoped to the
// caller's own genid_code inside revokeApiKey itself, not just checked
// here, so a client-supplied id can never revoke another identity's key.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const record = await getAuthenticatedRecord(req)
  if (!record) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const { id } = await params
  const revoked = await revokeApiKey(record.genid_code, id)
  if (!revoked) {
    return NextResponse.json({ error: 'API key not found, or already revoked' }, { status: 404 })
  }

  return NextResponse.json({ revoked: true })
}
