import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/stripe', () => ({
  constructWebhookEvent: vi.fn(),
  retrieveVerificationSession: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { constructWebhookEvent, retrieveVerificationSession } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from '@/app/api/stripe/webhook/route'

const EMAIL = 'creator@example.com'

function mockUpdateCapture() {
  const eqSpy = vi.fn().mockResolvedValue({ error: null })
  const updateSpy = vi.fn((update: Record<string, unknown>) => {
    void update
    return { eq: eqSpy }
  })
  vi.mocked(supabaseAdmin.from).mockReturnValue({ update: updateSpy } as unknown as ReturnType<typeof supabaseAdmin.from>)
  return { updateSpy, eqSpy }
}

function req() {
  return new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: JSON.stringify({ id: 'evt_1' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(constructWebhookEvent).mockReturnValue({
    type: 'identity.verification_session.verified',
    data: { object: { id: 'vs_123' } },
  } as unknown as ReturnType<typeof constructWebhookEvent>)
})

describe('POST /api/stripe/webhook — name binding (Punch List #2 follow-up)', () => {
  it('sets user_name to the Stripe-verified name and name_verified: true when Stripe returns one', async () => {
    vi.mocked(retrieveVerificationSession).mockResolvedValue({
      id: 'vs_123',
      metadata: { email: EMAIL },
      verified_outputs: { first_name: 'Jane', last_name: 'Doe' },
    } as unknown as Awaited<ReturnType<typeof retrieveVerificationSession>>)
    const { updateSpy, eqSpy } = mockUpdateCapture()

    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user_name: 'Jane Doe', name_verified: true, verified: true })
    )
    expect(eqSpy).toHaveBeenCalledWith('email', EMAIL)
  })

  it('never marks a self-reported name as verified when Stripe returns no name', async () => {
    vi.mocked(retrieveVerificationSession).mockResolvedValue({
      id: 'vs_123',
      metadata: { email: EMAIL },
      verified_outputs: { first_name: null, last_name: null },
    } as unknown as Awaited<ReturnType<typeof retrieveVerificationSession>>)
    const { updateSpy } = mockUpdateCapture()

    const res = await POST(req())
    expect(res.status).toBe(200)
    const call = updateSpy.mock.calls[0][0]
    expect(call).not.toHaveProperty('user_name')
    expect(call).toMatchObject({ name_verified: false, verified: true })
  })

  it('never marks a self-reported name as verified when verified_outputs is entirely absent', async () => {
    vi.mocked(retrieveVerificationSession).mockResolvedValue({
      id: 'vs_123',
      metadata: { email: EMAIL },
      verified_outputs: undefined,
    } as unknown as Awaited<ReturnType<typeof retrieveVerificationSession>>)
    const { updateSpy } = mockUpdateCapture()

    await POST(req())
    const call = updateSpy.mock.calls[0][0]
    expect(call).not.toHaveProperty('user_name')
    expect(call.name_verified).toBe(false)
  })
})
