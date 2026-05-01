import sharp from 'sharp'
import crypto from 'crypto'

// LSB (Least Significant Bit) steganography + HMAC notary signatures.
// Encodes data into the LSB of each R, G, B channel value (alpha skipped).
// 1-bit changes are visually undetectable. Output re-encoded as PNG so
// embedded bits survive (JPEG would destroy them).

const MAGIC_HEADER = 'GENID:'
const NULL_BYTE = '\0'
const SIG_HEX_LEN = 16            // 16 hex chars = 64 bits — compact, secure for HMAC truncation
const MAX_PAYLOAD_CHARS = 256     // upper bound on extraction read

function textToBits(text: string): number[] {
  const bits: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    for (let b = 7; b >= 0; b--) {
      bits.push((code >> b) & 1)
    }
  }
  return bits
}

function bitsToText(bits: number[]): string {
  let text = ''
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let code = 0
    for (let j = 0; j < 8; j++) {
      code = (code << 1) | bits[i + j]
    }
    if (code === 0) break
    text += String.fromCharCode(code)
    if (text.length >= MAX_PAYLOAD_CHARS) break
  }
  return text
}

/**
 * Embeds a GENID payload into image pixels via LSB steganography.
 *
 * Payload format on disk (between MAGIC_HEADER and NULL_BYTE):
 *   GENID:SA61289                                       // legacy / no-notary
 *   GENID:SA61289|SIG:<16hex>|TS:<unix>|HASH:<64hex>    // notary
 *
 * Pass `notaryPayload` as `SIG:<hex>|TS:<unix>|HASH:<hex>` (no leading pipe).
 */
export async function embedGenid(
  imageBuffer: Buffer,
  genidCode: string,
  _mimeType: string,
  notaryPayload?: string
): Promise<Buffer> {
  const payload = notaryPayload
    ? `${MAGIC_HEADER}${genidCode}|${notaryPayload}${NULL_BYTE}`
    : `${MAGIC_HEADER}${genidCode}${NULL_BYTE}`
  const bits = textToBits(payload)

  const image = sharp(imageBuffer)
  const { width, height, channels } = await image.metadata()
  if (!width || !height || !channels) throw new Error('Could not read image metadata')
  if (channels < 3) throw new Error('Image must have at least 3 channels (RGB)')

  const rawBuffer = await image.raw().toBuffer()
  const pixelData = new Uint8Array(rawBuffer)

  const availableBits = Math.floor(pixelData.length / channels) * 3
  if (bits.length > availableBits) {
    throw new Error(`Image too small to embed GENID. Need ${bits.length} bits, have ${availableBits}.`)
  }

  let bitIndex = 0
  for (let pixel = 0; pixel < Math.floor(pixelData.length / channels) && bitIndex < bits.length; pixel++) {
    const baseOffset = pixel * channels
    for (let ch = 0; ch < 3 && bitIndex < bits.length; ch++) {
      const byteIndex = baseOffset + ch
      pixelData[byteIndex] = (pixelData[byteIndex] & 0xfe) | bits[bitIndex]
      bitIndex++
    }
  }

  return await sharp(Buffer.from(pixelData), {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export interface ExtractedPayload {
  code: string                  // e.g. "SA61289"
  signature?: string            // 16-hex HMAC fragment
  timestamp?: number            // unix seconds
  hash?: string                 // 64-hex SHA-256 of original
  raw: string                   // everything after MAGIC_HEADER, up to NULL
}

/**
 * Extracts and parses the GENID payload. Returns null if no MAGIC_HEADER present.
 */
export async function extractGenid(imageBuffer: Buffer): Promise<ExtractedPayload | null> {
  const image = sharp(imageBuffer)
  const { width, height, channels } = await image.metadata()
  if (!width || !height || !channels || channels < 3) return null

  const rawBuffer = await image.raw().toBuffer()
  const pixelData = new Uint8Array(rawBuffer)

  const extractedBits: number[] = []
  const maxBitsToRead = MAX_PAYLOAD_CHARS * 8

  for (let pixel = 0; pixel < Math.floor(pixelData.length / channels) && extractedBits.length < maxBitsToRead; pixel++) {
    const baseOffset = pixel * channels
    for (let ch = 0; ch < 3 && extractedBits.length < maxBitsToRead; ch++) {
      extractedBits.push(pixelData[baseOffset + ch] & 1)
    }
  }

  const decoded = bitsToText(extractedBits)
  if (!decoded.startsWith(MAGIC_HEADER)) return null

  const raw = decoded.slice(MAGIC_HEADER.length).split('\0')[0]
  if (!raw) return null

  const parts = raw.split('|')
  const code = parts[0]
  if (!code || code.length < 4) return null

  const result: ExtractedPayload = { code, raw }
  for (const p of parts.slice(1)) {
    if (p.startsWith('SIG:')) result.signature = p.slice(4)
    else if (p.startsWith('TS:')) {
      const n = parseInt(p.slice(3), 10)
      if (Number.isFinite(n)) result.timestamp = n
    }
    else if (p.startsWith('HASH:')) result.hash = p.slice(5)
  }

  return result
}

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Generates a notary payload to embed alongside the GENID code.
 *
 * The HMAC input is `${genidCode}:${fullContentHash}:${timestamp}`.
 * The full hash is embedded in the payload so verify can recompute the
 * HMAC deterministically — without that, hash(stamped) ≠ hash(original)
 * and every signature would read as invalid.
 *
 * Returned format: `SIG:<16hex>|TS:<unix>|HASH:<64hex>`
 */
export function generateNotarySignature(
  genidCode: string,
  contentHash: string,
  timestamp: number,
  signingSecret: string
): string {
  const message = `${genidCode}:${contentHash}:${timestamp}`
  const sig = crypto
    .createHmac('sha256', signingSecret)
    .update(message)
    .digest('hex')
    .substring(0, SIG_HEX_LEN)
  return `SIG:${sig}|TS:${timestamp}|HASH:${contentHash}`
}

/**
 * Verifies a notary signature against the embedded payload.
 * Constant-time comparison via crypto.timingSafeEqual.
 */
export function verifyNotarySignature(
  genidCode: string,
  embeddedHash: string,
  timestamp: number,
  embeddedSig: string,
  signingSecret: string
): boolean {
  if (!genidCode || !embeddedHash || !timestamp || !embeddedSig) return false
  const message = `${genidCode}:${embeddedHash}:${timestamp}`
  const expected = crypto
    .createHmac('sha256', signingSecret)
    .update(message)
    .digest('hex')
    .substring(0, SIG_HEX_LEN)

  if (expected.length !== embeddedSig.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(embeddedSig))
  } catch {
    return false
  }
}
