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
  // Mirrors the webhook's real chain: .update(...).eq('email', ...)
  // .not('email_confirmed_at', 'is', null).select('id') — resolving with a
  // matched row simulates an email that WAS confirmed (Sept 19 third fix),
  // which is what these name-binding tests are actually about.
  const selectSpy = vi.fn().mockResolvedValue({ data: [{ id: '1' }], error: null })
  const notSpy = vi.fn().mockReturnValue({ select: selectSpy })
  const eqSpy = vi.fn().mockReturnValue({ not: notSpy })
  const updateSpy = vi.fn((update: Record<string, unknown>) => {
    void update
    return { eq: eqSpy }
  })
  vi.mocked(supabaseAdmin.from).mockReturnValue({ update: updateSpy } as unknown as ReturnType<typeof supabaseAdmin.from>)
  return { updateSpy, eqSpy, notSpy, selectSpy }
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

describe('POST /api/stripe/webhook — refuses to trust metadata.email without a confirmed inbox (Sept 19 third fix)', () => {
  it('does not treat an unconfirmed email as verified, even with a genuinely completed Stripe verification', async () => {
    vi.mocked(retrieveVerificationSession).mockResolvedValue({
      id: 'vs_attacker_session',
      // An attacker's own session, metadata.email set to a victim's
      // address they never confirmed control of.
      metadata: { email: 'victim@example.com' },
      verified_outputs: { first_name: 'Attacker', last_name: 'Name' },
    } as unknown as Awaited<ReturnType<typeof retrieveVerificationSession>>)

    // The .not('email_confirmed_at', 'is', null) filter matches nothing —
    // this registry row was never confirmed for THIS attempt.
    const selectSpy = vi.fn().mockResolvedValue({ data: [], error: null })
    const notSpy = vi.fn().mockReturnValue({ select: selectSpy })
    const eqSpy = vi.fn().mockReturnValue({ not: notSpy })
    const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy })
    vi.mocked(supabaseAdmin.from).mockReturnValue({ update: updateSpy } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await POST(req())

    // Acknowledges the webhook (no reason for Stripe to retry — retrying
    // won't retroactively confirm the email), but the row was never
    // actually written as verified: the .not(...) filter ensured the
    // UPDATE matched zero rows.
    expect(res.status).toBe(200)
    expect(eqSpy).toHaveBeenCalledWith('email', 'victim@example.com')
    expect(notSpy).toHaveBeenCalledWith('email_confirmed_at', 'is', null)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('refusing to mark it verified'))

    warnSpy.mockRestore()
  })
})
