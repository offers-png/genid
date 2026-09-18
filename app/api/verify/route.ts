import { NextRequest, NextResponse } from 'next/server'
import { extractGenid, hashBuffer, verifyNotarySignature } from '@/lib/steganography'
import { lookupGenid, supabaseAdmin } from '@/lib/supabase'
import { env } from '@/lib/env'

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
      const signingSecret = env.genidSigningSecret
      signatureValid = verifyNotarySignature(
        extracted.code,
        extracted.hash,
        extracted.timestamp,
        extracted.signature,
        signingSecret
      )
    }

    // Look up the authenticated content record for THESE EXACT UPLOADED
    // BYTES (content_hash is a full-file SHA-256, written once at stamp
    // time in /api/embed and never touched again). This is the actual
    // content-binding check: signatureValid alone only proves the payload
    // embedded INSIDE the uploaded file is internally self-consistent —
    // it says nothing about whether the file's own bytes are what was
    // originally issued. LSB steganography only touches a handful of
    // low-order bits; an attacker who preserves those specific bits while
    // altering everything else in the image would still extract a
    // perfectly valid, correctly-signed payload from a picture that no
    // longer matches what was actually notarized. Requiring an exact
    // content_hash match (plus the embedded hash/timestamp lining up with
    // what was logged, not just with each other) closes that gap.
    const { data: logEntry } = await supabaseAdmin
      .from('genid_content_log')
      .select('*')
      .eq('content_hash', contentHash)
      .single()

    const contentMatchesRecord =
      !!logEntry &&
      logEntry.genid_code === extracted.code &&
      logEntry.notary_hash === extracted.hash &&
      logEntry.notary_timestamp === extracted.timestamp

    const stampedAt =
      logEntry?.created_at ??
      (extracted.timestamp ? new Date(extracted.timestamp * 1000).toISOString() : null)

    const verified = signaturePresent && signatureValid && contentMatchesRecord
    const nameVerified = record.name_verified ?? false
    const message = verified
      ? nameVerified
        ? `Verified AI content created by ${record.user_name} (${record.genid_code})`
        : `Verified AI content under GENID ${record.genid_code} — the creator's identity was ID-verified, but the display name "${record.user_name}" is self-reported, not confirmed by that ID document.`
      : !signaturePresent
        ? 'GENID code found and registered, but this image has no embedded notary signature to verify. Authenticity cannot be confirmed.'
        : !signatureValid
          ? 'GENID code found and registered, but the embedded signature does not match this image. This content may have been tampered with.'
          : 'The embedded signature is internally consistent, but no authenticated record exists for these exact file bytes. This may be a copy, re-save, or partial modification of a previously stamped image — not the original stamped file.'

    return NextResponse.json({
      verified,
      genidCode: record.genid_code,
      creatorName: record.user_name,
      identityVerified: record.verified,
      nameVerified,
      registeredAt: record.created_at,
      contentHash,
      blockchainTxHash: logEntry?.blockchain_tx_hash ?? null,
      stampedAt,
      platform: logEntry?.platform ?? 'GENID Protocol',
      signaturePresent,
      signatureValid,
      contentMatchesRecord,
      embeddedHash: extracted.hash ?? null,
      message,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verification failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
