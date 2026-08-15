import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/verify'

// GET — no login required (Build Spec Section 5.3 "a third party with no
// GenID account can run the verification"). Recomputes the chain from
// stored raw data and returns a pass/fail integrity result.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await verifySession(id)

  if (!result.found) {
    return NextResponse.json(result, { status: 404 })
  }

  return NextResponse.json(result)
}
