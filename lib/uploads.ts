// Bound the body BEFORE multipart parsing, including chunked requests and
// dishonest/missing Content-Length. Allow 64 KiB of multipart overhead.
export const MAX_MULTIPART_BYTES = 15 * 1024 * 1024 + 64 * 1024

export class UploadRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message) }
}

export async function readLimitedFormData(req: Request): Promise<FormData> {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new UploadRequestError('Expected multipart/form-data', 400)
  }
  const declared = req.headers.get('content-length')
  if (declared && Number(declared) > MAX_MULTIPART_BYTES) {
    void req.body?.cancel().catch(() => {})
    throw new UploadRequestError('Upload request is too large', 413)
  }
  if (!req.body) throw new UploadRequestError('Upload body is required', 400)
  const reader = req.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_MULTIPART_BYTES) {
        void reader.cancel().catch(() => {})
        throw new UploadRequestError('Upload request is too large', 413)
      }
      chunks.push(new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return await new Response(new Blob(chunks), { headers: { 'content-type': contentType } }).formData()
  } catch {
    throw new UploadRequestError('Invalid multipart upload', 400)
  }
}
