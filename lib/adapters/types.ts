// Model Adapter Layer (Build Spec Section 2.2) — plug-in-per-provider interface.
// Phase 1 implements exactly one concrete adapter against this shape; adding a
// second provider later means writing another file, not touching the session route.

export interface GenerationRequest {
  promptText: string
}

export interface GenerationResult {
  outputBuffer: Buffer
  mimeType: string
  ext: string
  modelUsed: string
  modelRequestId: string
  requestTimestamp: Date
  responseTimestamp: Date
}

export interface ModelAdapter {
  name: string
  generateImage(req: GenerationRequest): Promise<GenerationResult>
}
