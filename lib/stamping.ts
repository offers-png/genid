import { embedGenid, hashBuffer, generateNotarySignature } from './steganography'
import { logContent, reservePaidOperation, type ContentLogRecord } from './supabase'
import { stampOnBlockchain } from './blockchain'
import { env } from './env'
import { withTimeout, EXTERNAL_CALL_TIMEOUT_MS } from './limits'

// Shared by the legacy browser form (POST /api/embed, session-cookie auth)
// and the external API (POST /api/v1/stamp, API-key auth, lib/apiKeys.ts) —
// extracted so there's exactly one place that reserves quota, embeds the
// payload, anchors on-chain, and writes the content-log record a later
// /api/verify call depends on, rather than two copies that could drift.
// Callers are responsible for authentication and upload validation
// (size/type/dimensions) BEFORE calling this — this function trusts
// genidCode and the image bytes it's given.

export class QuotaExceededError extends Error {}
export class ContentLogWriteError extends Error {}

export interface StampImageResult {
  stampedBuffer: Buffer
  stampedHash: string
  originalHash: string
  timestamp: number
  txHash: string | null
  logEntry: ContentLogRecord
}

export async function stampImageForIdentity(
  genidCode: string,
  imageBuffer: Buffer,
  imageType: string,
  fileName: string
): Promise<StampImageResult> {
  const reserved = await reservePaidOperation(genidCode, 'embed')
  if (!reserved) {
    throw new QuotaExceededError('Too many stamping requests. Please wait a few minutes and try again.')
  }

  const originalHash = hashBuffer(imageBuffer)
  const timestamp = Math.floor(Date.now() / 1000)

  const signingSecret = env.genidSigningSecret
  const notaryPayload = generateNotarySignature(genidCode, originalHash, timestamp, signingSecret)

  const stampedBuffer = await embedGenid(imageBuffer, genidCode, imageType, notaryPayload)
  const stampedHash = hashBuffer(stampedBuffer)

  let txHash: string | null = null
  try {
    const stamp = await withTimeout(
      stampOnBlockchain({ genidCode, contentHash: stampedHash, fileName }),
      EXTERNAL_CALL_TIMEOUT_MS,
      'Polygon anchor'
    )
    txHash = stamp.txHash
  } catch (blockchainErr) {
    console.error('Blockchain stamp failed (non-fatal):', blockchainErr)
  }

  // This row is the authenticated content record /api/verify's
  // content-binding check requires (Punch List #2 follow-up) — a stamped
  // image whose log write fails can never pass verification, no matter how
  // valid its embedded signature is. Retry a few times against a transient
  // DB blip before giving up — the OpenAI/blockchain work already spent to
  // get here shouldn't be thrown away for a blip that usually clears in
  // milliseconds.
  let logEntry: ContentLogRecord | null = null
  let lastLogError: unknown = null
  for (let attempt = 1; attempt <= 3 && !logEntry; attempt++) {
    try {
      logEntry = await logContent({
        genid_code: genidCode,
        content_hash: stampedHash,
        file_name: fileName,
        file_type: imageType,
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
    throw new ContentLogWriteError(
      'Stamping succeeded but the record could not be saved, so this image would never pass verification. Please try again.'
    )
  }

  return { stampedBuffer, stampedHash, originalHash, timestamp, txHash, logEntry }
}
