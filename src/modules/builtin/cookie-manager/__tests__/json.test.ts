import type { ManagedCookie } from '../contracts'
import { exportCookieJson, parseCookieJson } from '../json'

const source: ManagedCookie[] = [
  {
    name: 'session',
    value: 'synthetic中文="value"',
    domain: '.example.com',
    path: '/account',
    storeId: 'container-2',
    hostOnly: false,
    secure: true,
    httpOnly: true,
    session: false,
    expirationDate: 1_900_000_000,
    sameSite: 'no_restriction',
    partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: false },
    firstPartyDomain: '',
  },
]

it('exports a plain cookie array and preserves identity, values and attributes on import', () => {
  const exported = exportCookieJson(source)
  expect(exported.ok).toBe(true)
  if (!exported.ok)
    throw new Error('Expected JSON')
  expect(JSON.parse(exported.value)).toEqual(source)
  expect(parseCookieJson(exported.value)).toEqual({ ok: true, value: source })
})

it.each([
  {},
  { ...source[0], url: 'https://attacker.test/' },
  { ...source[0], domain: 'example.com@attacker.test' },
  { ...source[0], domain: 'example.com:8443' },
  { ...source[0], path: 'account' },
  { ...source[0], name: 'invalid;name' },
  { ...source[0], expirationDate: null },
  { ...source[0], expirationDate: 'tomorrow' },
  { ...source[0], session: true },
  { ...source[0], sameSite: 'none' },
  { ...source[0], secure: false },
  { ...source[0], partitionKey: { topLevelSite: 'https://top.example', surprise: true } },
  { ...source[0], partitionKey: { topLevelSite: 'javascript:alert(1)' } },
  { ...source[0], partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: 'false' } },
  { ...source[0], name: '__Host-session', hostOnly: false },
])('rejects an invalid record before producing an import preview: %j', (record) => {
  expect(parseCookieJson(JSON.stringify([record])).ok).toBe(false)
})

it('bounds import size and rejects duplicate identities instead of hiding a later overwrite', () => {
  expect(parseCookieJson(' '.repeat(8 * 1024 * 1024 + 1))).toEqual({ ok: false, reason: 'limit-exceeded' })
  expect(parseCookieJson(JSON.stringify(Array.from({ length: 10_001 }, () => source[0]))))
    .toEqual({ ok: false, reason: 'limit-exceeded' })
  expect(parseCookieJson(JSON.stringify([{ ...source[0], value: 'x'.repeat(16 * 1024) }])))
    .toEqual({ ok: false, reason: 'limit-exceeded' })
  expect(parseCookieJson(JSON.stringify([source[0], { ...source[0], value: 'another' }])).ok).toBe(false)
  expect(exportCookieJson([{ ...source[0], url: 'https://untrusted.test' } as ManagedCookie]).ok).toBe(false)
})
