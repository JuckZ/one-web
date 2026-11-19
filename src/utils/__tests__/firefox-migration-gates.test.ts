import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveFirefoxBinary, terminateProcessGroup } from '../../../scripts/firefox-runner'
import {
  checkFirefoxLintReport,
  FIREFOX_VENDOR_RECEIPT,
  REACT_SOURCE_SHA256,
  reactInnerHtmlSites,
  reactSource,
  sha256,
  verifyReactSources,
} from '../../../scripts/firefox-vendor-policy'

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function lintFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'oneweb-firefox-policy-'))
  temporary.push(root)
  mkdirSync(path.join(root, 'chunks'))
  const file = 'chunks/oneweb-react-vendor-fixture.js'
  const code = 'function a(e,t){e.innerHTML=t}\nfunction b($n,r){$n.innerHTML=r;}\n'
  const source = 'react-dom/cjs/react-dom-client.production.js'
  const receipt = { policy: 'oneweb-react-vendor-v1', file, sha256: sha256(code), sources: { [source]: REACT_SOURCE_SHA256[source] } }
  writeFileSync(path.join(root, file), code)
  writeFileSync(path.join(root, FIREFOX_VENDOR_RECEIPT), JSON.stringify(receipt))
  const warnings = [...reactInnerHtmlSites(code)].map((site) => {
    const [line, column] = site.split(':').map(Number)
    return { code: 'UNSAFE_VAR_ASSIGNMENT', _type: 'warning', message: 'Unsafe assignment to innerHTML', file, line, column }
  })
  return { root, file, code, receipt, report: { errors: [], warnings, notices: [], summary: { errors: 0, warnings: 2, notices: 0 } } }
}

describe('firefox migration gates', () => {
  it('prefers the explicit binary and resolves only an installed Playwright fallback', () => {
    const locate = vi.fn(() => '/isolated/firefox')
    expect(resolveFirefoxBinary({ FIREFOX_BINARY: 'explicit-firefox' }, locate)).toBe('explicit-firefox')
    expect(locate).not.toHaveBeenCalled()
    expect(resolveFirefoxBinary({}, locate, () => true)).toBe('/isolated/firefox')
    expect(() => resolveFirefoxBinary({}, locate, () => false)).toThrow('playwright install firefox')
  })

  it('cleans only the owned Windows process tree without POSIX signals', async () => {
    const kill = vi.fn()
    const wait = vi.fn(async () => {})
    const tree = vi.fn()
    expect(await terminateProcessGroup(417, kill, wait, 'win32', tree)).toEqual(['taskkill'])
    expect(tree).toHaveBeenCalledTimes(1)
    expect(tree).toHaveBeenCalledWith(417)
    expect(kill).not.toHaveBeenCalled()
    expect(wait).not.toHaveBeenCalled()
    expect(await terminateProcessGroup(undefined, kill, wait, 'win32', tree)).toEqual([])
    expect(tree).toHaveBeenCalledTimes(1)
    await expect(terminateProcessGroup(417, kill, wait, 'win32', () => {
      throw new Error('access denied')
    })).rejects.toThrow('access denied')
  })

  it('verifies installed upstream bytes and rejects mixed or modified sources', () => {
    const require = createRequire(import.meta.url)
    const file = path.join(path.dirname(require.resolve('react-dom/package.json')), 'cjs/react-dom-client.production.js')
    expect(verifyReactSources([file])['react-dom/cjs/react-dom-client.production.js']).toBe(REACT_SOURCE_SHA256['react-dom/cjs/react-dom-client.production.js'])
    expect(reactSource(`\0${file}?commonjs-proxy`)?.source).toBe('react-dom/cjs/react-dom-client.production.js')
    expect(() => verifyReactSources([file, path.resolve('src/sidebar/main.ts')])).toThrow('unapproved module')
    expect(() => verifyReactSources([file], () => new TextEncoder().encode('changed'))).toThrow('digest changed')
  })

  it('accepts only the two diagnostics bound to verified vendor bytes', () => {
    const { root, report } = lintFixture()
    expect(checkFirefoxLintReport(root, report)).toBe(2)
    expect(checkFirefoxLintReport(root, { errors: [], warnings: [], notices: [], summary: { errors: 0, warnings: 0, notices: 0 } })).toBe(0)
  })

  it('rejects first-party warnings, other rules, duplicate positions and changed locations', () => {
    const { root, report } = lintFixture()
    for (const replacement of [
      { ...report.warnings[0], file: 'chunks/sidebar.js' },
      { ...report.warnings[0], code: 'DANGEROUS_EVAL' },
      { ...report.warnings[0], column: report.warnings[0].column + 1 },
      report.warnings[1],
    ]) {
      expect(() => checkFirefoxLintReport(root, { ...report, warnings: [replacement, report.warnings[1]] })).toThrow()
    }
    expect(() => checkFirefoxLintReport(root, { ...report, warnings: [...report.warnings, { ...report.warnings[0], file: 'background.js' }], summary: { ...report.summary, warnings: 3 } })).toThrow()
  })

  it('rejects modified chunks or unapproved provenance with unchanged diagnostic count', () => {
    const { root, file, code, receipt, report } = lintFixture()
    writeFileSync(path.join(root, file), `${code}\nconsole.log('modified')`)
    expect(() => checkFirefoxLintReport(root, report)).toThrow('chunk digest changed')
    writeFileSync(path.join(root, file), code)
    writeFileSync(path.join(root, FIREFOX_VENDOR_RECEIPT), JSON.stringify({ ...receipt, sources: { ...receipt.sources, 'src/sidebar/main.ts': sha256(readFileSync(path.join(root, file))) } }))
    expect(() => checkFirefoxLintReport(root, report)).toThrow('provenance changed')
  })

  it('rejects errors, notices and malformed counts', () => {
    const { root, report } = lintFixture()
    expect(() => checkFirefoxLintReport(root, { ...report, errors: [{}], summary: { ...report.summary, errors: 1 } })).toThrow('errors or notices')
    expect(() => checkFirefoxLintReport(root, { ...report, notices: [{}], summary: { ...report.summary, notices: 1 } })).toThrow('errors or notices')
    expect(() => checkFirefoxLintReport(root, { ...report, summary: { ...report.summary, warnings: 0 } })).toThrow('Invalid Firefox linter warnings')
  })
})
