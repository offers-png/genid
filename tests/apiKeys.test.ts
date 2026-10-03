import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  getAdmin: vi.fn(),
  lookupGenid: vi.fn(),
}))

import { getAdmin, lookupGenid } from '@/lib/supabase'
import { createApiKey, listApiKeys, revokeApiKey, resolveApiKey } from '@/lib/apiKeys'

function mockFrom(methods: Record<string, unknown>) {
  vi.mocked(getAdmin).mockReturnValue({
    from: () => methods,
  } as unknown as ReturnType<typeof getAdmin>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createApiKey', () => {
  it('returns a raw key starting with the expected prefix, and persists only its hash', async () => {
    let insertedRow: Record<string, unknown> | undefined
    mockFrom({
      insert: (row: Record<string, unknown>) => {
        insertedRow = row
        return {
          select: () => ({
            single: async () => ({
              data: { id: 'key-1', genid_code: row.genid_code, key_prefix: row.key_prefix, created_at: 'now', last_used_at: null, revoked_at: null },
              error: null,
            }),
          }),
        }
      },
    })

    const { rawKey, record } = await createApiKey('SA12345')

    expect(rawKey.startsWith('gk_live_')).toBe(true)
    expect(record.genid_code).toBe('SA12345')
    expect(insertedRow?.genid_code).toBe('SA12345')
    // The raw key itself is never written — only its hash and a short prefix.
    expect(insertedRow?.key_hash).toBeDefined()
    expect(insertedRow?.key_hash).not.toBe(rawKey)
    expect(rawKey.startsWith(String(insertedRow?.key_prefix))).toBe(true)
  })

  it('throws if the insert fails', async () => {
    mockFrom({
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'db error' } }) }) }),
    })
    await expect(createApiKey('SA12345')).rejects.toThrow(/Failed to create API key/)
  })
})

describe('listApiKeys', () => {
  it('returns keys scoped to the given genid_code, ordered newest first', async () => {
    const eqSpy = vi.fn().mockReturnValue({
      order: async () => ({ data: [{ id: 'k2' }, { id: 'k1' }], error: null }),
    })
    mockFrom({ select: () => ({ eq: eqSpy }) })

    const keys = await listApiKeys('SA12345')
    expect(eqSpy).toHaveBeenCalledWith('genid_code', 'SA12345')
    expect(keys).toHaveLength(2)
  })
})

describe('revokeApiKey', () => {
  it('returns true when a matching, not-yet-revoked key was updated', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: 'key-1' }], error: null })
    const is = vi.fn().mockReturnValue({ select })
    const eq2 = vi.fn().mockReturnValue({ is })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    mockFrom({ update: () => ({ eq: eq1 }) })

    const result = await revokeApiKey('SA12345', 'key-1')
    expect(result).toBe(true)
    expect(eq1).toHaveBeenCalledWith('id', 'key-1')
    expect(eq2).toHaveBeenCalledWith('genid_code', 'SA12345')
  })

  it('returns false when no row matched (wrong id, wrong owner, or already revoked)', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const is = vi.fn().mockReturnValue({ select })
    const eq2 = vi.fn().mockReturnValue({ is })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    mockFrom({ update: () => ({ eq: eq1 }) })

    const result = await revokeApiKey('SA12345', 'not-mine')
    expect(result).toBe(false)
  })
})

describe('resolveApiKey', () => {
  it('returns null when the Authorization header is missing or malformed', async () => {
    expect(await resolveApiKey(null)).toBeNull()
    expect(await resolveApiKey('')).toBeNull()
    expect(await resolveApiKey('Basic abc123')).toBeNull()
    expect(await resolveApiKey('Bearer ')).toBeNull()
  })

  it('returns null when no active key matches the hash', async () => {
    mockFrom({
      select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    })
    expect(await resolveApiKey('Bearer gk_live_doesnotexist')).toBeNull()
  })

  it('resolves to the identity the key is scoped to, and looks it up live rather than trusting a cached shape', async () => {
    mockFrom({
      select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: 'key-1', genid_code: 'SA12345' }, error: null }) }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    })
    vi.mocked(lookupGenid).mockResolvedValue({
      id: '1', genid_code: 'SA12345', user_name: 'Test', email: 'test@example.com',
      stripe_verification_id: null, verified: true, created_at: 'now',
    })

    const record = await resolveApiKey('Bearer gk_live_validkey')
    expect(record?.genid_code).toBe('SA12345')
    expect(lookupGenid).toHaveBeenCalledWith('SA12345')
  })
})
