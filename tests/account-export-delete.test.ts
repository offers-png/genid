import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getAuthenticatedRecord: vi.fn(),
  SESSION_COOKIE_NAME: 'genid_session',
}))
vi.mock('@/lib/account', () => ({
  exportAccountData: vi.fn(),
  deleteAccount: vi.fn(),
}))

import { getAuthenticatedRecord } from '@/lib/auth'
import { exportAccountData, deleteAccount } from '@/lib/account'
import { GET as exportRoute } from '@/app/api/account/export/route'
import { POST as deleteRoute } from '@/app/api/account/delete/route'

const VERIFIED_RECORD = {
  id: '1', genid_code: 'SA12345', user_name: 'Test', email: 'test@example.com',
  stripe_verification_id: 'vs_123', verified: true, created_at: 'now',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/account/export', () => {
  it('requires a session', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(null)
    const res = await exportRoute(new NextRequest('http://localhost/api/account/export'))
    expect(res.status).toBe(401)
    expect(exportAccountData).not.toHaveBeenCalled()
  })

  it('returns the caller\'s export as a downloadable JSON attachment', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    const exportData = {
      exportedAt: 'now',
      account: { genidCode: 'SA12345', userName: 'Test', selfReportedName: null, nameVerified: false, email: 'test@example.com', verified: true, createdAt: 'now' },
      sessions: [],
      stamps: [],
      apiKeys: [],
    }
    vi.mocked(exportAccountData).mockResolvedValue(exportData)

    const res = await exportRoute(new NextRequest('http://localhost/api/account/export'))
    expect(res.status).toBe(200)
    expect(exportAccountData).toHaveBeenCalledWith('SA12345')
    expect(res.headers.get('content-disposition')).toContain('genid-SA12345-export.json')
    const body = await res.json()
    expect(body.account.genidCode).toBe('SA12345')
  })

  it('returns 404 when the account cannot be found (e.g. already deleted)', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(exportAccountData).mockResolvedValue(null)
    const res = await exportRoute(new NextRequest('http://localhost/api/account/export'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/account/delete', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('requires a session', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(null)
    const res = await deleteRoute(req({ confirmGenidCode: 'SA12345' }))
    expect(res.status).toBe(401)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('rejects when the confirmation code does not match the caller\'s own GENID code', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    const res = await deleteRoute(req({ confirmGenidCode: 'WRONG01' }))
    expect(res.status).toBe(400)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('rejects a missing confirmation entirely', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    const res = await deleteRoute(req({}))
    expect(res.status).toBe(400)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('deletes the account when the confirmation matches, and clears the session cookie', async () => {
    vi.mocked(getAuthenticatedRecord).mockResolvedValue(VERIFIED_RECORD)
    vi.mocked(deleteAccount).mockResolvedValue({ deletedSessionCount: 2, retainedFinalizedSessionCount: 1 })

    const res = await deleteRoute(req({ confirmGenidCode: 'SA12345' }))
    expect(res.status).toBe(200)
    expect(deleteAccount).toHaveBeenCalledWith(VERIFIED_RECORD)
    const body = await res.json()
    expect(body).toMatchObject({ deleted: true, deletedSessionCount: 2, retainedFinalizedSessionCount: 1 })

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('genid_session=')
    expect(setCookie.toLowerCase()).toMatch(/max-age=0/)
  })
})
