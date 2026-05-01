import { NextRequest, NextResponse } from 'next/server'
import { extractGenid, hashBuffer, verifyNotarySignature } from '@/lib/steganography'
import { lookupGenid, supabaseAdmin } from '@/lib/supabase'

// POST multipart/form-data: { image }
// Returns: creator info if GENID found, plus signature verification status.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File

    if (!imageFile) {
      return NextResponse.json({ error: 'Image file is required' }, { status: 400 })
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
    const contentHash = hashBuffer(imageBuffer)

    const extracted = await extractGenid(imageBuffer)
    if (!extracted) {
      return NextResponse.json({
        verified: false,
        message: 'No GENID found in this image. It may be unregistered AI content.',
        contentHash,
      })
    }

    const record = await lookupGenid(extracted.code)
    if (!record) {
      return NextResponse.json({
        verified: false,
        genidCode: extracted.code,
        message: 'GENID code found but not in registry. This may indicate tampering.',
        contentHash,
      })
    }

    // Notary signature verification (HMAC-SHA256 over genid:embeddedHash:timestamp).
    // The embedded payload includes the full original-image hash so we can verify
    // deterministically; without that, hash(stamped) ≠ hash(original).
    let signatureValid = false
    let signaturePresent = false
    if (extracted.signature && extracted.timestamp && extracted.hash) {
      signaturePresent = true
      const signingSecret = process.env.GENID_SIGNING_SECRET ?? 'genid-default-secret'
      signatureValid = verifyNotarySignature(
        extracted.code,
        extracted.hash,
        extracted.timestamp,
        extracted.signature,
        signingSecret
      )
    }

    // Best-effort content-log lookup against the stamped-image hash for
    // blockchain TX + canonical stamp time. Falls back to embedded timestamp.
    const { data: logEntry } = await supabaseAdmin
      .from('genid_content_log')
      .select('*')
      .eq('content_hash', contentHash)
      .single()

    const stampedAt =
      logEntry?.created_at ??
      (extracted.timestamp ? new Date(extracted.timestamp * 1000).toISOString() : null)

    return NextResponse.json({
      verified: true,
      genidCode: record.genid_code,
      creatorName: record.user_name,
      identityVerified: record.verified,
      registeredAt: record.created_at,
      contentHash,
      blockchainTxHash: logEntry?.blockchain_tx_hash ?? null,
      stampedAt,
      platform: logEntry?.platform ?? 'GENID Protocol',
      signaturePresent,
      signatureValid,
      embeddedHash: extracted.hash ?? null,
      message: `Verified AI content created by ${record.user_name} (${record.genid_code})`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verification failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
