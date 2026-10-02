import { describe, it, expect, vi } from 'vitest'
import { MAX_MULTIPART_BYTES, readLimitedFormData } from '@/lib/uploads'

function streamed(declared?: string) {
  let reads = 0
  const cancel = vi.fn()
  const body = new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel,
  }, { highWaterMark: 0 })
  const headers = new Headers({ 'content-type': 'multipart/form-data; boundary=test' })
  if (declared) headers.set('content-length', declared)
  const req = new Request('http://localhost', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)
  return { req, cancel, reads: () => reads }
}
describe('bounded multipart reader', () => {
  it.each([undefined, '1'])('stops oversized streams with declared length %s', async (length) => {
    const stream = streamed(length)
    await expect(readLimitedFormData(stream.req)).rejects.toMatchObject({ status: 413 })
    expect(stream.cancel).toHaveBeenCalled()
    expect(stream.reads()).toBe(16)
  })
  it('rejects an oversized Content-Length without reading', async () => {
    const stream = streamed(String(MAX_MULTIPART_BYTES + 1))
    await expect(readLimitedFormData(stream.req)).rejects.toMatchObject({ status: 413 })
    expect(stream.reads()).toBe(0)
  })
  it('parses normal uploads and rejects malformed multipart', async () => {
    const form = new FormData()
    form.set('image', new File(['bytes'], 'test.png'))
    const data = await readLimitedFormData(new Request('http://localhost', { method: 'POST', body: form }))
    expect((data.get('image') as File).size).toBe(5)
    await expect(readLimitedFormData(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'invalid' }))).rejects.toMatchObject({ status: 400 })
  })
})
