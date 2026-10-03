import { readLimitedFormData, UploadRequestError } from '@/lib/uploads'
import { NextRequest, NextResponse } from 'next/server'
// Note: stampedBuffer response uses native Response (not NextResponse) for binary compatibility
import { getAuthenticatedRecord } from '@/lib/auth'
import { stampImageForIdentity, QuotaExceededError, ContentLogWriteError } from '@/lib/stamping'
import { validateUploadSize, validateImageDimensions, ValidationError } from '@/lib/limits'

// POST multipart/form-data: { image }
// Returns: the steganographically-stamped image with embedded notary signature.
// Previously took a bare `email` form field to decide whose GENID code to
// stamp with — anyone who knew a target's email could embed content (and
// trigger a Polygon anchor transaction) attributed to that identity. The
// caller's identity now comes from their session cookie.
//
// The actual stamping work (quota reservation, embed, blockchain anchor,
// content-log write) lives in lib/stamping.ts, shared with POST
// /api/v1/stamp (Oct 2026) — this route is now just: authenticate via
// session cookie, validate the upload, call the shared function, and
// format the binary response the browser form expects.
export async function POST(req: NextRequest) {
  try {
    const record = await getAuthenticatedRecord(req)
    if (!record) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    if (!record.verified) {
      return NextResponse.json({ error: 'Your identity has not been verified yet.' }, { status: 403 })
    }

    const formData = await readLimitedFormData(req)
    const imageFile = formData.get('image')

    if (!(imageFile instanceof File)) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 })
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

    const { stampedBuffer, stampedHash, txHash, timestamp } = await stampImageForIdentity(
      record.genid_code,
      imageBuffer,
      imageFile.type,
      imageFile.name
    )

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
    if (err instanceof UploadRequestError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    if (err instanceof QuotaExceededError) return NextResponse.json({ error: err.message }, { status: 429 })
    if (err instanceof ContentLogWriteError) return NextResponse.json({ error: err.message }, { status: 500 })
    const message = err instanceof Error ? err.message : 'Embedding failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
