import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  validatePromptText,
  validateUploadSize,
  validateImageDimensions,
  withTimeout,
  ValidationError,
  PROMPT_MAX_LENGTH,
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_DIMENSION_PX,
} from '@/lib/limits'

describe('validatePromptText', () => {
  it('accepts and trims a normal prompt', () => {
    expect(validatePromptText('  a cat wearing a hat  ')).toBe('a cat wearing a hat')
  })

  it('rejects an empty or whitespace-only prompt', () => {
    expect(() => validatePromptText('')).toThrow(ValidationError)
    expect(() => validatePromptText('   ')).toThrow(ValidationError)
  })

  it('rejects a non-string value', () => {
    expect(() => validatePromptText(undefined)).toThrow(ValidationError)
    expect(() => validatePromptText(123)).toThrow(ValidationError)
  })

  it('rejects a prompt over the max length', () => {
    expect(() => validatePromptText('a'.repeat(PROMPT_MAX_LENGTH + 1))).toThrow(ValidationError)
  })

  it('accepts a prompt exactly at the max length', () => {
    expect(validatePromptText('a'.repeat(PROMPT_MAX_LENGTH))).toHaveLength(PROMPT_MAX_LENGTH)
  })
})

describe('validateUploadSize', () => {
  it('accepts a normal-sized upload', () => {
    expect(() => validateUploadSize(1024)).not.toThrow()
  })

  it('rejects an empty upload', () => {
    expect(() => validateUploadSize(0)).toThrow(ValidationError)
  })

  it('rejects an upload over the max size', () => {
    expect(() => validateUploadSize(MAX_UPLOAD_BYTES + 1)).toThrow(ValidationError)
  })
})

describe('validateImageDimensions', () => {
  it('accepts a normal image', async () => {
    const buffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()
    await expect(validateImageDimensions(buffer)).resolves.toBeUndefined()
  })

  it('rejects an unreadable/corrupt file', async () => {
    await expect(validateImageDimensions(Buffer.from('not an image'))).rejects.toThrow(ValidationError)
  })

  it('rejects an image over the max dimension', async () => {
    const buffer = await sharp({
      create: { width: MAX_IMAGE_DIMENSION_PX + 100, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()
    await expect(validateImageDimensions(buffer)).rejects.toThrow(ValidationError)
  })
})

describe('withTimeout', () => {
  it('resolves normally when the promise finishes before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('done'), 1000, 'test op')
    expect(result).toBe('done')
  })

  it('rejects once the timeout elapses for a hung promise', async () => {
    const neverResolves = new Promise(() => {})
    await expect(withTimeout(neverResolves, 20, 'test op')).rejects.toThrow(/timed out/)
  })
})
