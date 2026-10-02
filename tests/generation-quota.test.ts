import { beforeEach, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/auth', () => ({ getAuthenticatedRecord: async () => ({ genid_code: 'AB12345', verified: true }) }))
vi.mock('@/lib/supabase', () => ({ reservePaidOperation: vi.fn(), createSession: vi.fn(), createStepIfActive: vi.fn() }))
vi.mock('@/lib/adapters/openai-image', () => ({ openAiImageAdapter: { generateImage: vi.fn() } }))
import { reservePaidOperation, createSession } from '@/lib/supabase'
import { openAiImageAdapter } from '@/lib/adapters/openai-image'
import { POST } from '@/app/api/session/route'
beforeEach(() => { vi.clearAllMocks() })
it.each([false, new Error('Quota unavailable')])('blocks generation before work when reservation fails (%s)', async (outcome) => {
  if (outcome instanceof Error) vi.mocked(reservePaidOperation).mockRejectedValueOnce(outcome)
  else vi.mocked(reservePaidOperation).mockResolvedValueOnce(outcome)
  const req = new NextRequest('http://localhost/api/session', { method: 'POST', body: JSON.stringify({ promptText: 'test image' }), headers: { 'content-type': 'application/json' } })
  expect((await POST(req)).status).toBe(outcome === false ? 429 : 500)
  expect(reservePaidOperation).toHaveBeenCalledWith('AB12345', 'generation')
  expect(createSession).not.toHaveBeenCalled()
  expect(openAiImageAdapter.generateImage).not.toHaveBeenCalled()
})
