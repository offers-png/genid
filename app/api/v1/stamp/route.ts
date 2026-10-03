import { readLimitedFormData, UploadRequestError } from '@/lib/uploads'
import { NextRequest, NextResponse } from 'next/server'
import { resolveApiKey } from '@/lib/apiKeys'
import { stampImageForIdentity, QuotaExceededError, ContentLogWriteError } from '@/lib/stamping'
import { validateUploadSize, validateImageDimensions, ValidationError } from '@/lib/limits'

// POST /api/v1/stamp — external developer API (Oct 2026). See API.md for
// the documented contract (auth header, request/response shape, error
// codes, rate limits).
//
// Authorization: Bearer <api key>, multipart/form-data: { image }
//
// Wraps the exact same stampImageForIdentity (lib/stamping.ts) the legacy
// browser form (POST /api/embed) calls — this route's only job is
// API-key auth instead of a session cookie, upload validation, and
// formatting a JSON response an external HTTP client can consume without
// digging through response headers. Rate limiting is the same per-identity
// quota /api/embed uses (reservePaidOperation, migration 016) — keyed by
// genid_code, which both auth methods resolve to the same record for, so
// one API key can't be used to exceed what that identity could already do
// from the browser.
export async function POST(req: NextRequest) {
  try {
    const record = await resolveApiKey(req.headers.get('authorization'))
    if (!record) {
      return NextResponse.json({ error: 'Invalid or missing API key. Pass it as: Authorization: Bearer <key>' }, { status: 401 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'This identity has not completed Stripe identity verification yet.' }, { status: 403 })
    }

    const formData = await readLimitedFormData(req)
    const imageFile = formData.get('image')

    if (!(imageFile instanceof File)) {
      return NextResponse.json({ error: 'Image is required (multipart/form-data field "image")' }, { status: 400 })
    }

    validateUploadSize(imageFile.size)

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
    try {
      validateUploadSize(imageBuffer.length)
      await validateImageDimensions(imageBuffer)
    } catch (err) {
      if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }

    const { stampedBuffer, stampedHash, originalHash, timestamp, txHash, logEntry } = await stampImageForIdentity(
      record.genid_code,
      imageBuffer,
      imageFile.type,
      imageFile.name
    )

    return NextResponse.json({
      verificationRecordId: logEntry.id,
      genidCode: record.genid_code,
      contentHash: stampedHash,
      originalContentHash: originalHash,
      blockchainTxHash: txHash,
      notaryTimestamp: timestamp,
      image: {
        contentType: 'image/png',
        base64: stampedBuffer.toString('base64'),
      },
    })
  } catch (err: unknown) {
    if (err instanceof UploadRequestError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    if (err instanceof QuotaExceededError) return NextResponse.json({ error: err.message }, { status: 429 })
    if (err instanceof ContentLogWriteError) return NextResponse.json({ error: err.message }, { status: 500 })
    const message = err instanceof Error ? err.message : 'Stamping failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
