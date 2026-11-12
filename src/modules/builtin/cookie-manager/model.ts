/* eslint-disable no-control-regex -- Cookie field validation must reject ASCII control characters. */
import type { CookieSetDetails, ManagedCookie } from './contracts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeCookie(value: unknown): ManagedCookie | null {
  if (!isRecord(value))
    return null
  const keys = ['name', 'value', 'domain', 'path', 'storeId', 'hostOnly', 'secure', 'httpOnly', 'session', 'sameSite', 'expirationDate', 'partitionKey', 'firstPartyDomain']
  if (Object.keys(value).some(key => !keys.includes(key)))
    return null
  for (const key of ['name', 'value', 'domain', 'path', 'storeId']) {
    if (typeof value[key] !== 'string')
      return null
  }
  for (const key of ['hostOnly', 'secure', 'httpOnly', 'session']) {
    if (typeof value[key] !== 'boolean')
      return null
  }
  const cookie = value as unknown as ManagedCookie
  if (!cookie.storeId || /[\x00-\x20\x7F()<>@,;:\\"/[\]?={}]/.test(cookie.name)
    || /[\x00-\x1F\x7F]/.test(cookie.value + cookie.domain + cookie.path)
    || !cookie.path.startsWith('/')
    || !['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite)) {
    return null
  }
  const host = cookie.domain.replace(/^\./, '')
  try {
    const url = new URL(`https://${host}/`)
    if (!host || url.hostname !== host || url.port || url.username || url.password || url.pathname !== '/'
      || (cookie.hostOnly && cookie.domain.startsWith('.'))) {
      return null
    }
  }
  catch {
    return null
  }
  if (cookie.session
    ? cookie.expirationDate !== undefined
    : (
        typeof cookie.expirationDate !== 'number' || !Number.isFinite(cookie.expirationDate)
        || cookie.expirationDate <= 0
      )) {
    return null
  }
  if (cookie.sameSite === 'no_restriction' && !cookie.secure)
    return null
  if (cookie.name.startsWith('__Secure-') && !cookie.secure)
    return null
  if (cookie.name.startsWith('__Host-') && (!cookie.secure || !cookie.hostOnly || cookie.path !== '/'))
    return null
  if ((cookie.name.startsWith('__Http-') || cookie.name.startsWith('__Host-Http-'))
    && (!cookie.secure || !cookie.httpOnly)) {
    return null
  }
  if (value.firstPartyDomain !== undefined && (typeof value.firstPartyDomain !== 'string'
    || /[\x00-\x20\x7F]/.test(value.firstPartyDomain))) {
    return null
  }
  if (value.partitionKey !== undefined) {
    const partition = value.partitionKey
    if (!isRecord(partition) || typeof partition.topLevelSite !== 'string'
      || Object.keys(partition).some(key => !['topLevelSite', 'hasCrossSiteAncestor'].includes(key))
      || (partition.hasCrossSiteAncestor !== undefined && typeof partition.hasCrossSiteAncestor !== 'boolean')) {
      return null
    }
    try {
      const url = new URL(partition.topLevelSite)
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== partition.topLevelSite)
        return null
    }
    catch {
      return null
    }
  }
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    storeId: cookie.storeId,
    hostOnly: cookie.hostOnly,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    session: cookie.session,
    sameSite: cookie.sameSite,
    ...(!cookie.session ? { expirationDate: cookie.expirationDate } : {}),
    ...(cookie.partitionKey
      ? { partitionKey: {
          topLevelSite: cookie.partitionKey.topLevelSite,
          ...(cookie.partitionKey.hasCrossSiteAncestor === undefined ? {} : { hasCrossSiteAncestor: cookie.partitionKey.hasCrossSiteAncestor }),
        } }
      : {}),
    ...(cookie.firstPartyDomain === undefined ? {} : { firstPartyDomain: cookie.firstPartyDomain }),
  }
}

export function normalizeBrowserCookie(value: unknown) {
  if (!isRecord(value))
    return null
  const record = { ...value }
  // Firefox reports null for the absence of a partition; files use an absent key.
  if (record.partitionKey === null)
    delete record.partitionKey
  return normalizeCookie(record)
}

export function sameCookie(a: unknown, b: unknown) {
  const left = normalizeBrowserCookie(a)
  const right = normalizeCookie(b)
  return left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right)
}

export function cookieIdentity(cookie: ManagedCookie) {
  return JSON.stringify([
    cookie.storeId,
    cookie.domain,
    cookie.path,
    cookie.name,
    cookie.hostOnly,
    cookie.partitionKey
      ? [cookie.partitionKey.topLevelSite, cookie.partitionKey.hasCrossSiteAncestor ?? null]
      : null,
    cookie.firstPartyDomain ?? null,
  ])
}

export function cookieUrl(cookie: ManagedCookie, origins: string[]) {
  const scheme = cookie.secure || !origins[0]?.startsWith('http://') ? 'https:' : 'http:'
  const current = origins.length === 1 ? new URL(origins[0]).hostname : null
  const host = current || cookie.domain.replace(/^\./, '')
  return `${scheme}//${host}${cookie.path}`
}

export function cookieSetDetails(cookie: ManagedCookie, origins: string[]): CookieSetDetails {
  return {
    url: cookieUrl(cookie, origins),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    storeId: cookie.storeId,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
    ...(!cookie.session ? { expirationDate: cookie.expirationDate } : {}),
    ...(cookie.partitionKey ? { partitionKey: { ...cookie.partitionKey } } : {}),
    ...(cookie.firstPartyDomain === undefined ? {} : { firstPartyDomain: cookie.firstPartyDomain }),
  }
}
