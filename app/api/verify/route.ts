import { NextRequest, NextResponse } from 'next/server'
import { extractGenid, hashBuffer } from '@/lib/steganography'
import { lookupGenid, supabaseAdmin } from '@/lib/supabase'

// POST multipart/form-data: { image }
// Returns: creator info if GENID found, or "no GENID embedded" if clean
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File

    if (!imageFile) {
      return NextResponse.json({ error: 'Image file is required' }, { status: 400 })
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
    const contentHash = hashBuffer(imageBuffer)

    // Try to extract GENID from image
    const genidCode = await extractGenid(imageBuffer)

    if (!genidCode) {
      return NextResponse.json({
        verified: false,
        message: 'No GENID found in this image. It may be unregistered AI content.',
        contentHash,
      })
    }

    // Look up the creator in the registry
    const record = await lookupGenid(genidCode)
    if (!record) {
      return NextResponse.json({
        verified: false,
        genidCode,
        message: 'GENID code found but not in registry. This may indicate tampering.',
        contentHash,
      })
    }

    // Find the content log entry for this specific file
    const { data: logEntry } = await supabaseAdmin
      .from('genid_content_log')
      .select('*')
      .eq('content_hash', contentHash)
      .single()

    return NextResponse.json({
      verified: true,
      genidCode: record.genid_code,
      creatorName: record.user_name,
      identityVerified: record.verified,
      registeredAt: record.created_at,
      contentHash,
      blockchainTxHash: logEntry?.blockchain_tx_hash ?? null,
      stampedAt: logEntry?.created_at ?? null,
      platform: logEntry?.platform ?? 'GENID Protocol',
      message: `Verified AI content created by ${record.user_name} (${record.genid_code})`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verification failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
