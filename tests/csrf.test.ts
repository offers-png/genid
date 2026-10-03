import { describe, it, expect } from 'vitest'
import { isValidCsrfToken, CSRF_COOKIE_NAME } from '@/lib/csrf'

function reqWithCookie(cookieValue: string | undefined) {
  return {
    cookies: {
      get: (name: string) => (name === CSRF_COOKIE_NAME && cookieValue !== undefined ? { value: cookieValue } : undefined),
    },
  }
}

describe('isValidCsrfToken', () => {
  it('accepts a submitted token that matches the cookie', () => {
    expect(isValidCsrfToken(reqWithCookie('abc123'), 'abc123')).toBe(true)
  })

  it('rejects a submitted token that does not match the cookie', () => {
    expect(isValidCsrfToken(reqWithCookie('abc123'), 'different')).toBe(false)
  })

  it('rejects when the cookie is missing entirely', () => {
    expect(isValidCsrfToken(reqWithCookie(undefined), 'abc123')).toBe(false)
  })

  it('rejects a missing, empty, or non-string submitted token', () => {
    expect(isValidCsrfToken(reqWithCookie('abc123'), undefined)).toBe(false)
    expect(isValidCsrfToken(reqWithCookie('abc123'), '')).toBe(false)
    expect(isValidCsrfToken(reqWithCookie('abc123'), 12345)).toBe(false)
  })

  it('rejects tokens of different lengths without throwing', () => {
    expect(isValidCsrfToken(reqWithCookie('short'), 'a-much-longer-value')).toBe(false)
  })
})
