import type { GenerationRequest, GenerationResult, ModelAdapter } from './types'

// The one Phase 1 Model Adapter (Build Spec Section 3.2.2) — OpenAI's
// gpt-image-1. Raw fetch rather than the openai SDK to keep this a thin,
// swappable wrapper, matching the rest of the codebase's dependency-light style.

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
const MODEL = 'gpt-image-1'

export const openAiImageAdapter: ModelAdapter = {
  name: 'openai-gpt-image-1',

  async generateImage(req: GenerationRequest): Promise<GenerationResult> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY')

    const requestTimestamp = new Date()
    const res = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: req.promptText,
        size: '1024x1024',
        n: 1,
      }),
    })
    const responseTimestamp = new Date()

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`OpenAI image generation failed (${res.status}): ${errBody}`)
    }

    // gpt-image-1 always returns base64, never a hosted url — convenient here
    // since we need the raw bytes to hash and store anyway.
    const requestId = res.headers.get('x-request-id') ?? 'unknown'
    const json = (await res.json()) as { data?: { b64_json?: string }[] }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new Error('OpenAI response contained no image data')

    return {
      outputBuffer: Buffer.from(b64, 'base64'),
      mimeType: 'image/png',
      ext: 'png',
      modelUsed: MODEL,
      modelRequestId: requestId,
      requestTimestamp,
      responseTimestamp,
    }
  },
}
