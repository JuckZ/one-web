export const COOKIE_MANAGER_MODULE_ID = 'dev.oneweb.cookie-manager'
export const COOKIE_MANAGER_ENTRY_ID = 'cookie-manager'
export const COOKIE_LIMIT = 10_000
export const COOKIE_FILE_LIMIT = 8 * 1024 * 1024
export const COOKIE_RECORD_LIMIT = 16 * 1024
export const COOKIE_BATCH_LIMIT = 200

export interface ManagedCookie {
  name: string
  value: string
  domain: string
  path: string
  storeId: string
  hostOnly: boolean
  secure: boolean
  httpOnly: boolean
  session: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  expirationDate?: number
  partitionKey?: { topLevelSite: string, hasCrossSiteAncestor?: boolean }
  firstPartyDomain?: string
}

export type CookieScope = 'all' | 'current'
export type CookieResult<T> = { ok: true, value: T } | { ok: false, reason: string }

export interface CookiePreparation {
  token: string
  scope: CookieScope
  hostname: string | null
  origins: string[]
}

export interface CookieSnapshot {
  id: string
  scope: CookieScope
  hostname: string | null
  stores: string[]
  entries: Array<{ id: string, cookie: ManagedCookie }>
}

export interface CookieImportPreview {
  id: string
  entries: Array<{ id: string, cookie: ManagedCookie, replaces: boolean }>
}

export interface CookieBrowserBoundary {
  getAllCookieStores: () => Promise<Array<{ id: string }>>
  getAll: (_details: { storeId: string, partitionKey: object, firstPartyDomain?: null }) => Promise<ManagedCookie[]>
  set: (_details: CookieSetDetails) => Promise<ManagedCookie | null | undefined>
  get: (_details: CookieDetails) => Promise<ManagedCookie | null | undefined>
  remove: (_details: CookieDetails) => Promise<unknown>
}

export interface CookieDetails {
  url: string
  name: string
  storeId: string
  partitionKey?: ManagedCookie['partitionKey']
  firstPartyDomain?: string
}

export interface CookieMutation {
  id: string
  ok: boolean
  reason?: string
}

export interface CookieSetDetails {
  url: string
  name: string
  value: string
  path: string
  storeId: string
  domain?: string
  secure: boolean
  httpOnly: boolean
  sameSite: ManagedCookie['sameSite']
  expirationDate?: number
  partitionKey?: ManagedCookie['partitionKey']
  firstPartyDomain?: string
}
