import sharp from 'sharp'
import crypto from 'crypto'

// LSB (Least Significant Bit) steganography
// We encode data into the least significant bit of each R, G, B channel value.
// This change is invisible to the human eye (1-bit change in 0-255 scale = ~0.4% change).
// The encoded data survives format preservation (PNG → PNG, JPEG → JPEG at high quality).

const MAGIC_HEADER = 'GENID:'  // 6 chars — marks the start of encoded data
const BITS_PER_CHANNEL = 1     // use only the LSB of each channel

function textToBits(text: string): number[] {
  const bits: number[] = []
  for (const char of text) {
    const code = char.charCodeAt(0)
    for (let i = 7; i >= 0; i--) {
      bits.push((code >> i) & 1)
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
    if (code === 0) break  // null terminator
    text += String.fromCharCode(code)
  }
  return text
}

export async function embedGenid(
  imageBuffer: Buffer,
  genidCode: string,
  mimeType: string
): Promise<Buffer> {
  const payload = MAGIC_HEADER + genidCode + '\0'  // null-terminated
  const bits = textToBits(payload)

  const image = sharp(imageBuffer)
  const { width, height, channels } = await image.metadata()

  if (!width || !height || !channels) throw new Error('Could not read image metadata')
  if (channels < 3) throw new Error('Image must have at least 3 channels (RGB)')

  const rawBuffer = await image.raw().toBuffer()
  const pixelData = new Uint8Array(rawBuffer)

  const availableBits = Math.floor(pixelData.length / channels) * 3  // R+G+B only, skip alpha
  if (bits.length > availableBits) {
    throw new Error(`Image too small to embed GENID. Need ${bits.length} bits, have ${availableBits}.`)
  }

  let bitIndex = 0
  for (let pixel = 0; pixel < Math.floor(pixelData.length / channels) && bitIndex < bits.length; pixel++) {
    const baseOffset = pixel * channels
    // Embed into R, G, B channels only (not alpha)
    for (let ch = 0; ch < 3 && bitIndex < bits.length; ch++) {
      const byteIndex = baseOffset + ch
      // Clear LSB and set it to our bit
      pixelData[byteIndex] = (pixelData[byteIndex] & 0xfe) | bits[bitIndex]
      bitIndex++
    }
  }

  const outputBuffer = Buffer.from(pixelData)

  // Re-encode as PNG to avoid JPEG re-compression destroying the LSB data
  // If input was PNG, output PNG. For JPEG inputs, we output PNG to preserve bits.
  return await sharp(outputBuffer, {
    raw: { width: width!, height: height!, channels: channels as 1 | 2 | 3 | 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export async function extractGenid(imageBuffer: Buffer): Promise<string | null> {
  const image = sharp(imageBuffer)
  const { width, height, channels } = await image.metadata()

  if (!width || !height || !channels || channels < 3) return null

  const rawBuffer = await image.raw().toBuffer()
  const pixelData = new Uint8Array(rawBuffer)

  const extractedBits: number[] = []
  const maxBitsToRead = (MAGIC_HEADER.length + 20) * 8  // header + max genid length

  for (let pixel = 0; pixel < Math.floor(pixelData.length / channels) && extractedBits.length < maxBitsToRead; pixel++) {
    const baseOffset = pixel * channels
    for (let ch = 0; ch < 3 && extractedBits.length < maxBitsToRead; ch++) {
      extractedBits.push(pixelData[baseOffset + ch] & 1)
    }
  }

  const decoded = bitsToText(extractedBits)

  if (!decoded.startsWith(MAGIC_HEADER)) return null

  const genidCode = decoded.slice(MAGIC_HEADER.length).split('\0')[0]
  if (!genidCode || genidCode.length < 4) return null

  return genidCode
}

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
