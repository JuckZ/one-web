import type { InstalledModuleRecord } from '../../../types'
import type { CookieDetails, CookieSetDetails, ManagedCookie } from '../contracts'
import { CookieManagerController } from '../controller'
import { CookieManagerClient, handleCookieManagerMessage } from '../protocol'

const cookie = {
  name: 'session',
  value: 'synthetic-value',
  domain: 'example.com',
  path: '/',
  hostOnly: true,
  secure: true,
  httpOnly: true,
  session: true,
  sameSite: 'lax' as const,
  storeId: '0',
}

function fixture(firefox = false) {
  const record: InstalledModuleRecord = {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: 'dev.oneweb.cookie-manager',
      name: 'Cookie Manager',
      entry_id: 'cookie-manager',
      icon_path: '/assets/icon-128.png',
      version: '0.1.0',
      description: 'Manage cookies locally',
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: [],
      activation: 'manual',
      min_host_version: '0.0.1',
    },
    enabled: true,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  }
  let permitted = false
  let reads = 0
  let now = Date.now()
  let afterRead: (() => void) | undefined
  let afterGet: (() => void) | undefined
  let allowedHost: string | undefined
  let url = 'https://example.com/account'
  let rows: ManagedCookie[] = [cookie, { ...cookie, storeId: 'container-2' }]
  const find = (details: CookieDetails) => {
    const url = new URL(details.url)
    return rows.filter(row => row.storeId === details.storeId && row.name === details.name
      && (row.domain.replace(/^\./, '') === url.hostname
        || (!row.hostOnly && url.hostname.endsWith(row.domain)))
        && url.pathname.startsWith(row.path)
        && JSON.stringify(row.partitionKey) === JSON.stringify(details.partitionKey)
        && row.firstPartyDomain === details.firstPartyDomain)
      .sort((a, b) => b.path.length - a.path.length)[0]
  }
  const controller = new CookieManagerController({
    firefox,
    now: () => now,
    registry: { get: async () => record },
    permissions: { contains: async () => permitted },
    tabs: {
      query: async () => [{ id: 7, url }],
      get: async () => ({ id: 7, url }),
    },
    cookies: {
      getAllCookieStores: async () => [{ id: '0' }, { id: 'container-2' }],
      getAll: async ({ storeId }) => {
        reads++
        afterRead?.()
        return structuredClone(rows.filter(row => row.storeId === storeId))
      },
      get: async (details: CookieDetails) => {
        const target = structuredClone(find(details))
        afterGet?.()
        return target
      },
      remove: async (details: CookieDetails) => {
        const target = find(details)
        rows = rows.filter(row => row !== target)
        return target ? { name: target.name } : null
      },
      set: async (details: CookieSetDetails) => {
        if (allowedHost && new URL(details.url).hostname !== allowedHost)
          return null
        const domain = details.domain || new URL(details.url).hostname
        const next: ManagedCookie = {
          name: details.name,
          value: details.value,
          domain,
          path: details.path,
          storeId: details.storeId,
          hostOnly: !details.domain,
          secure: details.secure,
          httpOnly: details.httpOnly,
          sameSite: details.sameSite,
          session: details.expirationDate === undefined,
          ...(details.expirationDate === undefined ? {} : { expirationDate: details.expirationDate }),
          ...(details.partitionKey ? { partitionKey: details.partitionKey } : {}),
          ...(details.firstPartyDomain === undefined ? {} : { firstPartyDomain: details.firstPartyDomain }),
        }
        rows = rows.filter(row => !(row.name === next.name && row.domain === next.domain
          && row.path === next.path && row.storeId === next.storeId
          && JSON.stringify(row.partitionKey) === JSON.stringify(next.partitionKey)))
        rows.push(next)
        return structuredClone(next)
      },
    },
  })
  return {
    controller,
    record,
    permit: () => {
      permitted = true
    },
    reads: () => reads,
    navigate: (next: string) => {
      url = next
    },
    onlyHost: (host: string) => {
      allowedHost = host
    },
    afterRead: (callback: () => void) => {
      afterRead = callback
    },
    afterGet: (callback: () => void) => {
      afterGet = callback
    },
    revoke: () => {
      permitted = false
    },
    elapse: (ms: number) => {
      now += ms
    },
    rows: (next: typeof rows) => {
      rows = ['0', 'container-2'].flatMap(storeId => next.map(row => ({ ...row, storeId })))
    },
  }
}

it('reads no cookies before permission and keeps the same cookie in two stores distinct', async () => {
  const f = fixture()
  const preparation = await f.controller.prepare('all')
  expect(preparation.ok).toBe(true)
  if (!preparation.ok)
    throw new Error('Expected preparation')
  expect(await f.controller.open(preparation.value.token)).toEqual({ ok: false, reason: 'permission-required' })
  expect(f.reads()).toBe(0)
  f.permit()
  const opened = await f.controller.open(preparation.value.token)
  expect(opened.ok).toBe(true)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  expect(opened.value.entries.map(entry => entry.cookie.storeId)).toEqual(['0', 'container-2'])
  expect(new Set(opened.value.entries.map(entry => entry.id)).size).toBe(2)
})

it('discards an enumeration interrupted by revocation and never restores its preparation', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  f.afterRead(() => {
    f.revoke()
    f.controller.invalidate()
  })
  expect(await f.controller.open(preparation.value.token)).toEqual({ ok: false, reason: 'lifecycle-cancelled' })
  f.permit()
  expect(await f.controller.open(preparation.value.token)).toEqual({ ok: false, reason: 'lifecycle-cancelled' })
})

it('deletes only selected identities when names repeat across paths, stores and partitions', async () => {
  const f = fixture()
  f.permit()
  f.rows([
    cookie,
    { ...cookie, path: '/account' },
    { ...cookie, partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: false } },
    { ...cookie, partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true } },
  ])
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  const selected = opened.value.entries[2]
  expect(await f.controller.delete(opened.value.id, [selected.id]))
    .toMatchObject({ ok: true, value: [{ id: selected.id, ok: true }] })
  const refreshed = await f.controller.refresh(opened.value.id)
  if (!refreshed.ok)
    throw new Error('Expected snapshot')
  expect(refreshed.value.entries.map(item => [
    item.cookie.storeId,
    item.cookie.path,
    item.cookie.partitionKey?.hasCrossSiteAncestor ?? null,
  ])).toEqual([
    ['0', '/', null],
    ['0', '/account', null],
    ['0', '/', true],
    ['container-2', '/', null],
    ['container-2', '/account', null],
    ['container-2', '/', false],
    ['container-2', '/', true],
  ])
})

it('creates and edits a cookie through the public controller without changing a peer store', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  const entry = opened.value.entries[0]
  expect(await f.controller.save(opened.value.id, { ...entry.cookie, value: 'edited' }, entry.id))
    .toMatchObject({ ok: true })
  let refreshed = await f.controller.refresh(opened.value.id)
  if (!refreshed.ok)
    throw new Error('Expected refreshed snapshot')
  expect(refreshed.value.entries.map(item => [item.cookie.storeId, item.cookie.value])).toEqual([
    ['0', 'edited'],
    ['container-2', 'synthetic-value'],
  ])
  expect(await f.controller.save(refreshed.value.id, { ...cookie, name: 'new-cookie', httpOnly: false }))
    .toMatchObject({ ok: true })
  refreshed = await f.controller.refresh(refreshed.value.id)
  if (!refreshed.ok)
    throw new Error('Expected refreshed snapshot')
  expect(refreshed.value.entries.map(item => item.cookie.name)).toEqual(['session', 'new-cookie', 'session'])
})

it('keeps current-site reads host-aware and rejects a preparation after navigation to another site', async () => {
  const f = fixture()
  f.permit()
  f.navigate('https://sub.example.com/account')
  f.rows([
    cookie,
    { ...cookie, domain: '.example.com', hostOnly: false },
    { ...cookie, domain: 'sub.example.com' },
    { ...cookie, domain: 'unrelated.test' },
  ])
  const preparation = await f.controller.prepare('current')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  expect(opened.value.entries.map(entry => entry.cookie.domain)).toEqual([
    '.example.com',
    'sub.example.com',
    '.example.com',
    'sub.example.com',
  ])
  const pending = await f.controller.prepare('current')
  if (!pending.ok)
    throw new Error('Expected preparation')
  f.navigate('https://unrelated.test/')
  expect(await f.controller.open(pending.value.token)).toEqual({ ok: false, reason: 'lifecycle-cancelled' })
})

it('rejects an edit if the website changed the cookie after it was displayed', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  f.rows([{ ...cookie, value: 'website-refreshed-session' }])
  const entry = opened.value.entries[0]
  expect(await f.controller.save(opened.value.id, { ...entry.cookie, value: 'stale-editor' }, entry.id))
    .toEqual({ ok: false, reason: 'stale-cookie' })
  expect(await f.controller.save(opened.value.id, cookie))
    .toEqual({ ok: false, reason: 'stale-cookie' })
  const refreshed = await f.controller.refresh(opened.value.id)
  if (!refreshed.ok)
    throw new Error('Expected snapshot')
  expect(refreshed.value.entries.every(item => item.cookie.value === 'website-refreshed-session')).toBe(true)
})

it('does not dispatch an edit after lifecycle cancellation during its last read', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  f.afterRead(() => f.controller.invalidate())
  const entry = opened.value.entries[0]
  expect(await f.controller.save(opened.value.id, { ...entry.cookie, value: 'cancelled' }, entry.id))
    .toEqual({ ok: false, reason: 'lifecycle-cancelled' })
  f.afterRead(() => {})
  const next = await f.controller.prepare('all')
  if (!next.ok)
    throw new Error('Expected preparation')
  const read = await f.controller.open(next.value.token)
  if (!read.ok)
    throw new Error('Expected snapshot')
  expect(read.value.entries[0].cookie.value).toBe('synthetic-value')
})

it('allows only the first of two simultaneous edits of the same displayed value to win', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  const entry = opened.value.entries[0]
  const results = await Promise.all([
    f.controller.save(opened.value.id, { ...entry.cookie, value: 'first' }, entry.id),
    f.controller.save(opened.value.id, { ...entry.cookie, value: 'second' }, entry.id),
  ])
  expect(results).toEqual([{ ok: true, value: null }, { ok: false, reason: 'stale-cookie' }])
})

it('previews JSON without writing, imports only reviewed items into the chosen store and consumes the review', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  const json = await f.controller.export(opened.value.id, [opened.value.entries[0].id])
  expect(json.ok && JSON.parse(json.value)).toEqual([cookie])
  const preview = await f.controller.preview(
    opened.value.id,
    JSON.stringify([{ ...cookie, name: 'imported', value: 'from-file' }]),
    'container-2',
  )
  if (!preview.ok)
    throw new Error('Expected preview')
  expect(await f.controller.export(opened.value.id, [opened.value.entries[0].id])).toEqual(json)
  expect(preview.value.entries[0].cookie.storeId).toBe('container-2')
  const ids = [preview.value.entries[0].id]
  expect(await f.controller.import(opened.value.id, preview.value.id, ids))
    .toMatchObject({ ok: true, value: [{ id: ids[0], ok: true }] })
  expect(await f.controller.import(opened.value.id, preview.value.id, ids))
    .toEqual({ ok: false, reason: 'lifecycle-cancelled' })
  const refreshed = await f.controller.refresh(opened.value.id)
  if (!refreshed.ok)
    throw new Error('Expected snapshot')
  expect(refreshed.value.entries.filter(entry => entry.cookie.name === 'imported').map(entry => entry.cookie))
    .toEqual([{ ...cookie, name: 'imported', value: 'from-file', storeId: 'container-2' }])
})

it('serves the finite client protocol only to our packaged pages and rejects extra authority fields', async () => {
  const f = fixture()
  f.permit()
  const sender = { id: 'oneweb-test', url: 'chrome-extension://oneweb-test/dist/sidebar/index.html' }
  const route = (message: unknown, candidate = sender) => handleCookieManagerMessage(
    f.controller,
    message,
    candidate,
    'oneweb-test',
    'chrome-extension://oneweb-test/',
  )
  const client = new CookieManagerClient({ sendMessage: async message => route(message) })
  const preparation = await client.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await client.open(preparation.value.token)
  expect(opened.ok).toBe(true)
  const message = { channel: 'oneweb.cookie-manager', version: 1, type: 'prepare', scope: 'all' }
  expect(route(message, { id: 'oneweb-test', url: 'https://example.com/' })).toBeUndefined()
  expect(route(message, { id: 'another-extension', url: sender.url })).toBeUndefined()
  expect(route({ ...message, url: 'https://attacker.test/' })).toBeUndefined()
  expect(route({ ...message, type: 'cookies.getAll' })).toBeUndefined()
})

it('cancels deletion when authority is lost after the browser has resolved the target', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  f.afterGet(() => f.controller.invalidate())
  const entry = opened.value.entries[0]
  expect(await f.controller.delete(opened.value.id, [entry.id]))
    .toEqual({ ok: true, value: [{ id: entry.id, ok: false, reason: 'lifecycle-cancelled' }] })
})

it('bounds abandoned preparations and expires their authority without storing cookies persistently', async () => {
  const f = fixture()
  f.permit()
  const preparations = await Promise.all(Array.from({ length: 8 }, () => f.controller.prepare('all')))
  expect(preparations.every(result => result.ok)).toBe(true)
  expect(await f.controller.prepare('all')).toEqual({ ok: false, reason: 'limit-exceeded' })
  f.elapse(11 * 60_000)
  const first = preparations[0]
  if (!first.ok)
    throw new Error('Expected preparation')
  expect(await f.controller.open(first.value.token)).toEqual({ ok: false, reason: 'lifecycle-cancelled' })
  expect((await f.controller.prepare('all')).ok).toBe(true)
})

it.each(['expired', 'reinstalled', 'revoked-during-read'])('rechecks write authority when a snapshot is %s', async (change) => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  if (change === 'expired')
    f.elapse(11 * 60_000)
  if (change === 'reinstalled')
    f.record.installedAt = '2026-11-13T00:00:00.000Z'
  if (change === 'revoked-during-read')
    f.afterRead(() => f.revoke())
  const entry = opened.value.entries[0]
  expect(await f.controller.save(opened.value.id, { ...entry.cookie, value: 'must-not-write' }, entry.id))
    .toEqual({ ok: false, reason: change === 'revoked-during-read' ? 'permission-required' : 'lifecycle-cancelled' })
})

it('returns a stable read failure without exposing the browser exception', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  f.afterRead(() => {
    throw new Error('synthetic-cookie-secret')
  })
  expect(await f.controller.open(preparation.value.token))
    .toEqual({ ok: false, reason: 'browser-operation-failed' })
})

it.each([true, false])('rejects partition attributes the target browser cannot express (Firefox=%s)', async (firefox) => {
  const f = fixture(firefox)
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  const foreign: ManagedCookie = {
    ...cookie,
    name: 'foreign-partition',
    ...(firefox
      ? { partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }, firstPartyDomain: 'top.example' }
      : { firstPartyDomain: 'top.example' }),
  }
  expect(await f.controller.save(opened.value.id, foreign)).toEqual({ ok: false, reason: 'unsupported-partition' })
})

it('does not publish an enumeration if permission disappears before the read completes', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  f.afterRead(() => f.revoke())
  expect(await f.controller.open(preparation.value.token)).toEqual({ ok: false, reason: 'permission-required' })
})

it('allows editing unchanged browser cookies regardless of property enumeration order', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  f.rows([Object.fromEntries(Object.entries(cookie).reverse()) as unknown as ManagedCookie])
  const entry = opened.value.entries[0]
  expect(await f.controller.save(opened.value.id, { ...entry.cookie, value: 'edited' }, entry.id))
    .toEqual({ ok: true, value: null })
})

it('edits a parent-domain cookie using the authorized current subdomain', async () => {
  const f = fixture()
  f.permit()
  f.navigate('https://sub.example.com/')
  f.onlyHost('sub.example.com')
  f.rows([{ ...cookie, domain: '.example.com', hostOnly: false }])
  const preparation = await f.controller.prepare('current')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  const entry = opened.value.entries[0]
  expect(await f.controller.save(opened.value.id, { ...entry.cookie, value: 'edited' }, entry.id))
    .toEqual({ ok: true, value: null })
})

it('exposes Firefox unpartitioned cookies with native null partition keys as editable plain records', async () => {
  const f = fixture(true)
  f.permit()
  f.rows([{ ...cookie, partitionKey: null, firstPartyDomain: '' } as unknown as ManagedCookie])
  const client = new CookieManagerClient({
    sendMessage: async message => handleCookieManagerMessage(
      f.controller,
      message,
      { id: 'test', url: 'moz-extension://test/dist/sidebar/index.html' },
      'test',
      'moz-extension://test/',
    ),
  })
  const preparation = await client.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await client.open(preparation.value.token)
  expect(opened.ok).toBe(true)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  const entry = opened.value.entries[0]
  expect(entry.cookie).toEqual({ ...cookie, firstPartyDomain: '' })
  expect(await client.save(opened.value.id, { ...entry.cookie, value: 'edited' }, entry.id))
    .toEqual({ ok: true, value: null })
})

it('rejects oversized native records before exposing a partial enumeration', async () => {
  const f = fixture()
  f.permit()
  f.rows([{ ...cookie, value: 'x'.repeat(16 * 1024) }])
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  expect(await f.controller.open(preparation.value.token))
    .toEqual({ ok: false, reason: 'limit-exceeded' })
})

it('retains overlapping shared host grants only while its management session is active', async () => {
  const f = fixture()
  f.permit()
  const preparation = await f.controller.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  expect(await f.controller.usesOriginPattern('https://example.com/*')).toBe(true)
  const opened = await f.controller.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  expect(await f.controller.usesOriginPattern('http://localhost:8080/*')).toBe(true)
  f.controller.close(opened.value.id)
  expect(await f.controller.usesOriginPattern('https://example.com/*')).toBe(false)
})

it('reports invalid editor fields through the client without losing the existing management session', async () => {
  const f = fixture()
  f.permit()
  const client = new CookieManagerClient({
    sendMessage: async message => handleCookieManagerMessage(
      f.controller,
      message,
      { id: 'test', url: 'chrome-extension://test/dist/sidebar/index.html' },
      'test',
      'chrome-extension://test/',
    ),
  })
  const preparation = await client.prepare('all')
  if (!preparation.ok)
    throw new Error('Expected preparation')
  const opened = await client.open(preparation.value.token)
  if (!opened.ok)
    throw new Error('Expected snapshot')
  expect(await client.save(opened.value.id, { ...cookie, domain: '' }))
    .toEqual({ ok: false, reason: 'invalid-input' })
  expect((await client.export(opened.value.id, [opened.value.entries[0].id])).ok).toBe(true)
})
