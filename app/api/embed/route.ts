import { NextRequest, NextResponse } from 'next/server'
// Note: stampedBuffer response uses native Response (not NextResponse) for binary compatibility
import { embedGenid, hashBuffer, generateNotarySignature } from '@/lib/steganography'
import { logContent, countRecentEmbedsForGenid } from '@/lib/supabase'
import { getAuthenticatedRecord } from '@/lib/auth'
import { stampOnBlockchain } from '@/lib/blockchain'
import { env } from '@/lib/env'
import {
  validateUploadSize,
  validateImageDimensions,
  ValidationError,
  withTimeout,
  EXTERNAL_CALL_TIMEOUT_MS,
  EMBED_RATE_LIMIT,
  EMBED_RATE_WINDOW_MS,
} from '@/lib/limits'

// POST multipart/form-data: { image }
// Returns: the steganographically-stamped image with embedded notary signature.
// Previously took a bare `email` form field to decide whose GENID code to
// stamp with — anyone who knew a target's email could embed content (and
// trigger a Polygon anchor transaction) attributed to that identity. The
// caller's identity now comes from their session cookie.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File

    if (!imageFile) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 })
    }

    const record = await getAuthenticatedRecord(req)
    if (!record) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'Your identity has not been verified yet.' }, { status: 403 })
    }

    const recentEmbeds = await countRecentEmbedsForGenid(record.genid_code, EMBED_RATE_WINDOW_MS)
    if (recentEmbeds >= EMBED_RATE_LIMIT) {
      return NextResponse.json(
        { error: 'Too many stamping requests. Please wait a few minutes and try again.' },
        { status: 429 }
      )
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
    try {
      validateUploadSize(imageBuffer.length)
      await validateImageDimensions(imageBuffer)
    } catch (err) {
      if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }

    const originalHash = hashBuffer(imageBuffer)
    const timestamp = Math.floor(Date.now() / 1000)

    const signingSecret = env.genidSigningSecret
    const notaryPayload = generateNotarySignature(
      record.genid_code,
      originalHash,
      timestamp,
      signingSecret
    )

    const stampedBuffer = await embedGenid(
      imageBuffer,
      record.genid_code,
      imageFile.type,
      notaryPayload
    )
    const stampedHash = hashBuffer(stampedBuffer)

    let txHash: string | null = null
    try {
      const stamp = await withTimeout(
        stampOnBlockchain({
          genidCode: record.genid_code,
          contentHash: stampedHash,
          fileName: imageFile.name,
        }),
        EXTERNAL_CALL_TIMEOUT_MS,
        'Polygon anchor'
      )
      txHash = stamp.txHash
    } catch (blockchainErr) {
      console.error('Blockchain stamp failed (non-fatal):', blockchainErr)
    }

    // This row is the authenticated content record /api/verify's
    // content-binding check requires (Punch List #2 follow-up) — a stamped
    // image whose log write fails can never pass verification, no matter
    // how valid its embedded signature is. Returning the image anyway
    // would hand back something that LOOKS successfully stamped but is
    // silently unverifiable forever after. Retry a few times against a
    // transient DB blip before giving up — the OpenAI/blockchain work
    // already spent to get here shouldn't be thrown away for a blip that
    // usually clears in milliseconds.
    let logEntry = null
    let lastLogError: unknown = null
    for (let attempt = 1; attempt <= 3 && !logEntry; attempt++) {
      try {
        logEntry = await logContent({
          genid_code: record.genid_code,
          content_hash: stampedHash,
          file_name: imageFile.name,
          file_type: imageFile.type,
          platform: 'GENID Protocol',
          blockchain_tx_hash: txHash,
          blockchain_network: 'polygon',
          notary_signature: notaryPayload,
          notary_timestamp: timestamp,
          notary_hash: originalHash,
        })
      } catch (err) {
        lastLogError = err
      }
      if (!logEntry && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200))
      }
    }

    if (!logEntry) {
      console.error('Failed to record content log after retries — refusing to return the stamped image:', lastLogError)
      return NextResponse.json(
        {
          error:
            'Stamping succeeded but the record could not be saved, so this image would never pass verification. Please try again.',
        },
        { status: 500 }
      )
    }

    const originalBase = imageFile.name.replace(/\.[^.]+$/, '')
    const safeBase = originalBase.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40)

    return new Response(new Uint8Array(stampedBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="genid-stamped-${safeBase}.png"`,
        'X-GENID-Code': record.genid_code,
        'X-Content-Hash': stampedHash,
        'X-Blockchain-TX': txHash ?? 'pending',
        'X-Notary-Timestamp': timestamp.toString(),
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Embedding failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
