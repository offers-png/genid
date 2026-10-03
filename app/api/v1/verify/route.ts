import { readLimitedFormData, UploadRequestError } from '@/lib/uploads'
import { NextRequest, NextResponse } from 'next/server'
import { verifyImageBuffer } from '@/lib/verification'
import {
  validateUploadSize,
  validateImageDimensions,
  ValidationError,
  checkInMemoryRateLimit,
  getClientIp,
  VERIFY_RATE_LIMIT,
  VERIFY_RATE_WINDOW_MS,
} from '@/lib/limits'

// POST /api/v1/verify — external developer API (Oct 2026). See API.md.
//
// multipart/form-data: { image }. No API key required — public and
// anonymous by design, matching the legacy POST /api/verify (anyone can
// verify a file with no GenID account).
//
// Implemented as POST, not GET: verifying requires sending the actual
// image bytes, and a GET request body isn't reliably supported across
// HTTP clients/fetch()/proxies, nor is it RESTful for an upload. A
// GET-with-query-param-URL design was considered and rejected — fetching
// an arbitrary caller-supplied URL server-side is a new SSRF surface this
// spec didn't ask for and this change doesn't introduce. No CSRF check
// here (unlike POST /api/verify) — that defense only applies to
// browser-originated form submissions carrying an ambient cookie; an
// external API caller has no such cookie to forge.
//
// Wraps the same verifyImageBuffer (lib/verification.ts) the legacy page
// calls — same rate limit, same validation, shared result shape.
export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req)
    if (!checkInMemoryRateLimit(`v1-verify:${clientIp}`, VERIFY_RATE_LIMIT, VERIFY_RATE_WINDOW_MS)) {
      return NextResponse.json(
        { error: 'Too many verification requests. Please wait a few minutes and try again.' },
        { status: 429 }
      )
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

    const result = await verifyImageBuffer(imageBuffer)
    return NextResponse.json(result)
  } catch (err: unknown) {
    if (err instanceof UploadRequestError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    const message = err instanceof Error ? err.message : 'Verification failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
