import type { InstalledModuleRecord } from '../../types'
import type {
  CookieBrowserBoundary,
  CookieImportPreview,
  CookieMutation,
  CookiePreparation,
  CookieResult,
  CookieScope,
  CookieSnapshot,
  ManagedCookie,
} from './contracts'
import { COOKIE_BATCH_LIMIT, COOKIE_FILE_LIMIT, COOKIE_LIMIT, COOKIE_MANAGER_ENTRY_ID, COOKIE_MANAGER_MODULE_ID, COOKIE_RECORD_LIMIT } from './contracts'
import { exportCookieJson, parseCookieJson, utf8Size } from './json'
import { cookieIdentity, cookieSetDetails, cookieUrl, normalizeBrowserCookie, sameCookie } from './model'

interface ControllerOptions {
  registry: { get: (_id: string) => Promise<InstalledModuleRecord | null> }
  permissions: { contains: (_permissions: { permissions: string[], origins: string[] }) => Promise<boolean> }
  tabs: {
    query: (_query: { active: true, currentWindow: true }) => Promise<Array<{ id?: number, url?: string }>>
    get: (_id: number) => Promise<{ id?: number, url?: string }>
  }
  cookies: CookieBrowserBoundary
  firefox?: boolean
  now?: () => number
}

interface PreparationState extends CookiePreparation {
  tabId?: number
  generation: number
  expiresAt: number
  installedAt: string
}

function withinSite(hostname: string | null, domain: string, hostOnly: boolean) {
  const host = domain.replace(/^\./, '')
  return hostname === null || hostname === host || (!hostOnly && hostname.endsWith(`.${host}`))
}

export class CookieManagerController {
  private readonly preparations = new Map<string, PreparationState>()
  private readonly snapshots = new Map<string, { snapshot: CookieSnapshot, preparation: PreparationState }>()
  private readonly closeHandles = new Map<string, PreparationState>()
  private readonly previews = new Map<string, { snapshotId: string, preview: CookieImportPreview }>()
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly _options: ControllerOptions) {}

  private async available() {
    const record = await this._options.registry.get(COOKIE_MANAGER_MODULE_ID)
    return record?.enabled && record.source === 'seeded'
      && record.manifest.runtime === 'builtin' && record.manifest.entry_id === COOKIE_MANAGER_ENTRY_ID
      ? record
      : null
  }

  private now() {
    return this._options.now?.() ?? Date.now()
  }

  private prune() {
    for (const [id, preparation] of this.preparations) {
      if (preparation.expiresAt <= this.now())
        this.preparations.delete(id)
    }
    for (const [id, state] of this.snapshots) {
      if (state.preparation.expiresAt <= this.now())
        this.close(id)
    }
    for (const [id, preparation] of this.closeHandles) {
      if (preparation.expiresAt <= this.now())
        this.close(id)
    }
  }

  private async currentSiteUnchanged(preparation: PreparationState) {
    if (preparation.tabId === undefined)
      return true
    try {
      const tab = await this._options.tabs.get(preparation.tabId)
      const url = new URL(tab.url || '')
      return url.hostname === preparation.hostname
        && preparation.origins.includes(`${url.protocol}//${url.hostname}/*`)
    }
    catch {
      return false
    }
  }

  async prepare(scope: CookieScope): Promise<CookieResult<CookiePreparation>> {
    this.prune()
    const generation = this.generation
    const record = await this.available()
    if (!record)
      return { ok: false, reason: 'module-disabled' }
    if (scope !== 'all' && scope !== 'current')
      return { ok: false, reason: 'invalid-input' }
    let hostname: string | null = null
    let tabId: number | undefined
    let origins = ['http://*/*', 'https://*/*']
    if (scope === 'current') {
      const [tab] = await this._options.tabs.query({ active: true, currentWindow: true })
      try {
        const url = new URL(tab?.url || '')
        if (!['http:', 'https:'].includes(url.protocol) || tab.id === undefined)
          return { ok: false, reason: 'invalid-site' }
        hostname = url.hostname
        tabId = tab.id
        origins = [`${url.protocol}//${hostname}/*`]
      }
      catch {
        return { ok: false, reason: 'invalid-site' }
      }
    }
    if (generation !== this.generation)
      return { ok: false, reason: 'lifecycle-cancelled' }
    if (this.preparations.size + this.snapshots.size >= 8)
      return { ok: false, reason: 'limit-exceeded' }
    const value: PreparationState = {
      token: crypto.randomUUID(),
      scope,
      hostname,
      origins,
      tabId,
      generation,
      expiresAt: this.now() + 10 * 60_000,
      installedAt: record.installedAt,
    }
    this.preparations.set(value.token, value)
    return { ok: true, value: { token: value.token, scope, hostname, origins: [...origins] } }
  }

  async open(token: string): Promise<CookieResult<CookieSnapshot>> {
    try {
      return await this.openPrepared(token)
    }
    catch {
      this.preparations.delete(token)
      return { ok: false, reason: 'browser-operation-failed' }
    }
  }

  private livePreparation(preparation: PreparationState) {
    return this.preparations.get(preparation.token) === preparation
      && preparation.generation === this.generation && preparation.expiresAt > this.now()
  }

  private async openPrepared(token: string): Promise<CookieResult<CookieSnapshot>> {
    this.prune()
    const preparation = this.preparations.get(token)
    if (!preparation)
      return { ok: false, reason: 'lifecycle-cancelled' }
    const initialAccess = await this.preparationAccess(preparation)
    if (!initialAccess.ok)
      return initialAccess
    if (!this.livePreparation(preparation))
      return { ok: false, reason: 'lifecycle-cancelled' }
    const stores = await this._options.cookies.getAllCookieStores()
    const entries: CookieSnapshot['entries'] = []
    let bytes = 2
    for (const store of stores) {
      if (!this.livePreparation(preparation))
        return { ok: false, reason: 'lifecycle-cancelled' }
      const cookies = await this._options.cookies.getAll({
        storeId: store.id,
        partitionKey: {},
        ...(this._options.firefox ? { firstPartyDomain: null } : {}),
      })
      if (!this.livePreparation(preparation))
        return { ok: false, reason: 'lifecycle-cancelled' }
      for (const raw of cookies) {
        const cookie = normalizeBrowserCookie(raw)
        if (!cookie)
          return { ok: false, reason: 'invalid-input' }
        if (!withinSite(preparation.hostname, cookie.domain, cookie.hostOnly))
          continue
        const recordBytes = utf8Size(JSON.stringify(cookie))
        bytes += recordBytes + 1
        if (recordBytes > COOKIE_RECORD_LIMIT || bytes > COOKIE_FILE_LIMIT)
          return { ok: false, reason: 'limit-exceeded' }
        entries.push({ id: crypto.randomUUID(), cookie: structuredClone(cookie) })
        if (entries.length > COOKIE_LIMIT)
          return { ok: false, reason: 'limit-exceeded' }
      }
    }
    const authority = await this.preparationAccess(preparation)
    if (!authority.ok)
      return authority
    if (!this.livePreparation(preparation) || !this.preparations.delete(token))
      return { ok: false, reason: 'lifecycle-cancelled' }
    const snapshot: CookieSnapshot = {
      id: crypto.randomUUID(),
      scope: preparation.scope,
      hostname: preparation.hostname,
      stores: stores.map(store => store.id),
      entries,
    }
    this.snapshots.set(snapshot.id, { snapshot, preparation })
    // Initial delivery still belongs to the preparation token until the caller
    // acknowledges the snapshot by refreshing it. Refresh already has its handle.
    if (![...this.closeHandles.values()].includes(preparation))
      this.closeHandles.set(token, preparation)
    return { ok: true, value: structuredClone(snapshot) }
  }

  async refresh(id: string): Promise<CookieResult<CookieSnapshot>> {
    const state = this.snapshots.get(id)
    if (!state)
      return { ok: false, reason: 'lifecycle-cancelled' }
    // Starting another refresh acknowledges the current snapshot. Retain only its
    // predecessor as a close handle while the next response is pending/delivered.
    for (const [previous, preparation] of this.closeHandles) {
      if (preparation === state.preparation)
        this.closeHandles.delete(previous)
    }
    this.closeHandles.set(id, state.preparation)
    this.preparations.set(state.preparation.token, state.preparation)
    this.snapshots.delete(id)
    this.clearPreviews(id)
    const result = await this.open(state.preparation.token)
    if (!result.ok)
      this.close(id)
    return result
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => undefined)
    return pending
  }

  save(id: string, cookie: ManagedCookie, entryId?: string) {
    const draft = structuredClone(cookie)
    return this.exclusive(() => this.saveOne(id, draft, entryId))
  }

  private async saveOne(id: string, cookie: ManagedCookie, entryId?: string): Promise<CookieResult<null>> {
    const parsed = parseCookieJson(JSON.stringify([cookie]))
    if (!parsed.ok)
      return parsed
    cookie = parsed.value[0]
    if (this.unsupportedPartition(cookie))
      return { ok: false, reason: 'unsupported-partition' }
    const access = await this.snapshotAccess(id)
    if (!access.ok)
      return access
    const state = access.value
    if (!state.snapshot.stores.includes(cookie.storeId)
      || !withinSite(state.preparation.hostname, cookie.domain, cookie.hostOnly)) {
      return { ok: false, reason: 'invalid-input' }
    }
    if (entryId) {
      const original = state.snapshot.entries.find(entry => entry.id === entryId)
      if (!original || cookieIdentity(original.cookie) !== cookieIdentity(cookie))
        return { ok: false, reason: 'invalid-input' }
    }
    try {
      const current = await this._options.cookies.getAll({
        storeId: cookie.storeId,
        partitionKey: {},
        ...(this._options.firefox ? { firstPartyDomain: null } : {}),
      })
      const actual = current.find(item => cookieIdentity(item) === cookieIdentity(cookie))
      const original = state.snapshot.entries.find(entry => entry.id === entryId)?.cookie
      if (original ? !sameCookie(actual, original) : actual !== undefined)
        return { ok: false, reason: 'stale-cookie' }
      const finalAccess = await this.snapshotAccess(id)
      if (!finalAccess.ok)
        return finalAccess
      const saved = await this._options.cookies.set(cookieSetDetails(cookie, state.preparation.origins))
      if (state.preparation.generation !== this.generation)
        return { ok: false, reason: 'outcome-unknown' }
      return saved ? { ok: true, value: null } : { ok: false, reason: 'browser-operation-failed' }
    }
    catch {
      return { ok: false, reason: 'browser-operation-failed' }
    }
  }

  delete(id: string, entryIds: string[]) {
    const selected = [...entryIds]
    return this.exclusive(() => this.deleteSelected(id, selected))
  }

  private async deleteSelected(id: string, entryIds: string[]): Promise<CookieResult<CookieMutation[]>> {
    const state = this.snapshots.get(id)
    if (!state)
      return { ok: false, reason: 'lifecycle-cancelled' }
    if (!entryIds.length || entryIds.length > COOKIE_BATCH_LIMIT || new Set(entryIds).size !== entryIds.length)
      return { ok: false, reason: 'limit-exceeded' }
    const selected = entryIds.map(entryId => state.snapshot.entries.find(entry => entry.id === entryId))
    if (selected.some(entry => !entry))
      return { ok: false, reason: 'invalid-input' }
    const results: CookieMutation[] = []
    for (const entry of selected) {
      if (!entry)
        continue
      let reason: string | undefined
      try {
        if (!await this.available()) {
          reason = 'module-disabled'
        }
        else if (!await this._options.permissions.contains({ permissions: ['cookies'], origins: state.preparation.origins })) {
          reason = 'permission-required'
        }
        else if (!await this.currentSiteUnchanged(state.preparation)) {
          reason = 'lifecycle-cancelled'
        }
        else {
          const cookie = entry.cookie
          if (this.unsupportedPartition(cookie)) {
            results.push({ id: entry.id, ok: false, reason: 'unsupported-partition' })
            continue
          }
          const details = {
            url: cookieUrl(cookie, state.preparation.origins),
            name: cookie.name,
            storeId: cookie.storeId,
            ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
            ...(cookie.firstPartyDomain === undefined ? {} : { firstPartyDomain: cookie.firstPartyDomain }),
          }
          const target = await this._options.cookies.get(details)
          if (!target || cookieIdentity(target) !== cookieIdentity(cookie)) {
            reason = 'ambiguous-cookie-target'
          }
          else if (!sameCookie(target, cookie)) {
            reason = 'stale-cookie'
          }
          else {
            const access = await this.snapshotAccess(id)
            if (!access.ok) {
              reason = access.reason
            }
            else {
              const removed = await this._options.cookies.remove(details)
              if (state.preparation.generation !== this.generation)
                reason = 'outcome-unknown'
              else if (!removed)
                reason = 'browser-operation-failed'
            }
          }
        }
      }
      catch {
        reason = 'browser-operation-failed'
      }
      results.push({ id: entry.id, ok: !reason, ...(reason ? { reason } : {}) })
    }
    return { ok: true, value: results }
  }

  private async snapshotAccess(id: string) {
    this.prune()
    const state = this.snapshots.get(id)
    if (!state || state.preparation.generation !== this.generation)
      return { ok: false, reason: 'lifecycle-cancelled' } as const
    const authority = await this.preparationAccess(state.preparation)
    if (!authority.ok)
      return authority
    if (this.snapshots.get(id) !== state)
      return { ok: false, reason: 'lifecycle-cancelled' } as const
    return { ok: true, value: state } as const
  }

  private async preparationAccess(preparation: PreparationState): Promise<CookieResult<null>> {
    const record = await this.available()
    if (!record)
      return { ok: false, reason: 'module-disabled' } as const
    if (record.installedAt !== preparation.installedAt)
      return { ok: false, reason: 'lifecycle-cancelled' } as const
    if (!await this._options.permissions.contains({ permissions: ['cookies'], origins: preparation.origins }))
      return { ok: false, reason: 'permission-required' } as const
    if (!await this.currentSiteUnchanged(preparation) || preparation.generation !== this.generation
      || preparation.expiresAt <= this.now()) {
      return { ok: false, reason: 'lifecycle-cancelled' } as const
    }
    return { ok: true, value: null } as const
  }

  async export(id: string, entryIds: string[]): Promise<CookieResult<string>> {
    const access = await this.snapshotAccess(id)
    if (!access.ok)
      return access
    if (!entryIds.length || entryIds.length > COOKIE_LIMIT || new Set(entryIds).size !== entryIds.length)
      return { ok: false, reason: 'limit-exceeded' }
    const entries = entryIds.map(entryId => access.value.snapshot.entries.find(entry => entry.id === entryId))
    if (entries.some(entry => !entry))
      return { ok: false, reason: 'invalid-input' }
    return exportCookieJson(entries.map(entry => entry!.cookie))
  }

  async preview(id: string, text: string, storeId: string): Promise<CookieResult<CookieImportPreview>> {
    const access = await this.snapshotAccess(id)
    if (!access.ok)
      return access
    if (!access.value.snapshot.stores.includes(storeId))
      return { ok: false, reason: 'store-unavailable' }
    const parsed = parseCookieJson(text)
    if (!parsed.ok)
      return parsed
    const mapped = parseCookieJson(JSON.stringify(parsed.value.map(cookie => ({ ...cookie, storeId }))))
    if (!mapped.ok)
      return mapped
    if (mapped.value.some(cookie => this.unsupportedPartition(cookie)))
      return { ok: false, reason: 'unsupported-partition' }
    if (mapped.value.some(cookie => !withinSite(access.value.preparation.hostname, cookie.domain, cookie.hostOnly)))
      return { ok: false, reason: 'invalid-input' }
    const preview: CookieImportPreview = {
      id: crypto.randomUUID(),
      entries: mapped.value.map(cookie => ({
        id: crypto.randomUUID(),
        cookie,
        replaces: access.value.snapshot.entries.some(entry => cookieIdentity(entry.cookie) === cookieIdentity(cookie)),
      })),
    }
    this.clearPreviews(id)
    this.previews.set(preview.id, { snapshotId: id, preview })
    return { ok: true, value: structuredClone(preview) }
  }

  import(id: string, previewId: string, entryIds: string[]): Promise<CookieResult<CookieMutation[]>> {
    const ids = [...entryIds]
    return this.exclusive(async () => {
      const access = await this.snapshotAccess(id)
      if (!access.ok)
        return access
      const state = this.previews.get(previewId)
      if (!state || state.snapshotId !== id)
        return { ok: false, reason: 'lifecycle-cancelled' }
      if (!ids.length || ids.length > COOKIE_BATCH_LIMIT || new Set(ids).size !== ids.length)
        return { ok: false, reason: 'limit-exceeded' }
      const selected = ids.map(entryId => state.preview.entries.find(entry => entry.id === entryId))
      if (selected.some(entry => !entry))
        return { ok: false, reason: 'invalid-input' }
      this.previews.delete(previewId)
      const results: CookieMutation[] = []
      for (const entry of selected) {
        if (!entry)
          continue
        const original = access.value.snapshot.entries.find(item => cookieIdentity(item.cookie) === cookieIdentity(entry.cookie))
        const result = await this.saveOne(id, entry.cookie, original?.id)
        results.push({ id: entry.id, ok: result.ok, ...(!result.ok ? { reason: result.reason } : {}) })
      }
      return { ok: true, value: results }
    })
  }

  private clearPreviews(id: string) {
    for (const [key, state] of this.previews) {
      if (state.snapshotId === id)
        this.previews.delete(key)
    }
  }

  private unsupportedPartition(cookie: ManagedCookie) {
    return this._options.firefox
      ? Boolean(cookie.partitionKey && cookie.firstPartyDomain)
      : cookie.firstPartyDomain !== undefined || Boolean(cookie.partitionKey && !cookie.secure)
  }

  async usesOriginPattern(originPattern: string) {
    this.prune()
    if (!await this.available())
      return false
    try {
      const url = new URL(originPattern)
      if (!['http:', 'https:'].includes(url.protocol))
        return false
      const scopes = [
        ...this.preparations.values(),
        ...Array.from(this.snapshots.values(), state => state.preparation),
      ]
      return scopes.some(scope => scope.generation === this.generation && scope.expiresAt > this.now()
        && scope.origins.some(origin => origin === `${url.protocol}//*/*`
          || origin === `${url.protocol}//${url.hostname}/*`))
    }
    catch {
      return false
    }
  }

  close(id: string): CookieResult<null> {
    const preparation = this.snapshots.get(id)?.preparation ?? this.preparations.get(id) ?? this.closeHandles.get(id)
    this.snapshots.delete(id)
    this.preparations.delete(id)
    this.clearPreviews(id)
    if (preparation) {
      this.preparations.delete(preparation.token)
      for (const [snapshotId, state] of this.snapshots) {
        if (state.preparation === preparation) {
          this.snapshots.delete(snapshotId)
          this.clearPreviews(snapshotId)
        }
      }
      for (const [previous, state] of this.closeHandles) {
        if (state === preparation)
          this.closeHandles.delete(previous)
      }
    }
    return { ok: true, value: null }
  }

  invalidate() {
    this.generation++
    this.preparations.clear()
    this.snapshots.clear()
    this.closeHandles.clear()
    this.previews.clear()
  }
}
