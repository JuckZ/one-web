import type { CookieResult, ManagedCookie } from './contracts'
import { COOKIE_FILE_LIMIT, COOKIE_LIMIT, COOKIE_RECORD_LIMIT } from './contracts'
import { cookieIdentity, normalizeCookie } from './model'

export function utf8Size(text: string) {
  return new TextEncoder().encode(text).byteLength
}

export function parseCookieJson(text: string): CookieResult<ManagedCookie[]> {
  try {
    if (typeof text !== 'string')
      return { ok: false, reason: 'invalid-input' }
    if (text.length > COOKIE_FILE_LIMIT || utf8Size(text) > COOKIE_FILE_LIMIT)
      return { ok: false, reason: 'limit-exceeded' }
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value))
      return { ok: false, reason: 'unsupported-format' }
    if (value.length > COOKIE_LIMIT)
      return { ok: false, reason: 'limit-exceeded' }
    const cookies: ManagedCookie[] = []
    const identities = new Set<string>()
    for (const item of value) {
      if (utf8Size(JSON.stringify(item)) > COOKIE_RECORD_LIMIT)
        return { ok: false, reason: 'limit-exceeded' }
      const cookie = normalizeCookie(item)
      if (!cookie)
        return { ok: false, reason: 'invalid-input' }
      const key = cookieIdentity(cookie)
      if (identities.has(key))
        return { ok: false, reason: 'invalid-input' }
      identities.add(key)
      cookies.push(cookie)
    }
    return { ok: true, value: cookies }
  }
  catch {
    return { ok: false, reason: 'invalid-input' }
  }
}

export function exportCookieJson(cookies: ManagedCookie[]): CookieResult<string> {
  try {
    const text = JSON.stringify(cookies, null, 2)
    const parsed = parseCookieJson(text)
    return parsed.ok ? { ok: true, value: text } : parsed
  }
  catch {
    return { ok: false, reason: 'invalid-input' }
  }
}
