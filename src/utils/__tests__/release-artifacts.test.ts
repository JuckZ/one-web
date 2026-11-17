// @vitest-environment node
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { PRIMARY_ASSETS, verifyRelease } from '../../../scripts/release-artifacts'
import { releaseTag, stableVersion } from '../../../scripts/release-version'
import { userscriptMetadata, validateUserscriptPair } from '../../../scripts/userscript-metadata'

const temporary: string[] = []
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const license = 'MIT License\nCopyright Test\n'
const metadata = userscriptMetadata('0.1.0')
const user = `${metadata}/*\n${license}*/\n(function() { ${'const value = 1;\n'.repeat(20)} })();\n`
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'oneweb-release-test-'))
  temporary.push(directory)
  const files: Record<string, Buffer> = { 'LICENSE': Buffer.from(license), 'one-web.user.js': Buffer.from(user), 'one-web.meta.js': Buffer.from(metadata) }
  for (const firefox of [false, true]) {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({
      manifest_version: 3,
      name: 'OneWeb',
      version: '0.1.0',
      browser_specific_settings: { gecko: { id: 'one-web@juckz.local' } },
      background: firefox ? { scripts: ['./dist/background.js'] } : { service_worker: './dist/background.js' },
    }))
    zip.file('dist/background.js', 'console.log("test")')
    zip.file('assets/icon.png', 'test')
    zip.file('sidebar.html', '<html></html>')
    zip.file('LICENSE', license)
    files[firefox ? 'one-web-firefox-unsigned.xpi' : 'one-web-chromium.zip'] = await zip.generateAsync({ type: 'nodebuffer' })
  }
  await save(directory, files)
  return { directory, files }
}
async function save(directory: string, files: Record<string, Buffer>, dirty = false) {
  files['release-manifest.json'] = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    repository: 'JuckZ/one-web',
    version: '0.1.0',
    tag: 'v0.1.0',
    source: { commit: 'a'.repeat(40), dirty },
    assets: Object.fromEntries(PRIMARY_ASSETS.map(name => [name, { bytes: files[name].length, sha256: hash(files[name]) }])),
  }))
  files.SHA256SUMS = Buffer.from(Object.keys(files).filter(name => name !== 'SHA256SUMS').sort().map(name => `${hash(files[name])}  ${name}\n`).join(''))
  for (const [name, bytes] of Object.entries(files))
    await writeFile(path.join(directory, name), bytes)
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('release public contract', () => {
  it('supports future stable versions with a single canonical grammar and exact tags', () => {
    expect(stableVersion('1.2.65535')).toBe('1.2.65535')
    expect(releaseTag('1.2.3', 'v1.2.3')).toBe('v1.2.3')
    for (const value of ['0.0.0', '01.1.0', '1.2', '1.2.3.4', '65536.0.0', '1.2.3-rc.1', '1.2.3+dev', '1.2.3\n'])
      expect(() => stableVersion(value)).toThrow()
    expect(() => releaseTag('1.2.3', 'v1.2.4')).toThrow()
  })
  it('rejects a changed update origin, identity, extra grants or executable meta body', () => {
    validateUserscriptPair(user, metadata, '0.1.0')
    for (const pair of [
      [user.replace('releases/latest', 'evil/latest'), metadata],
      [user.replace('@name         OneWeb', '@name         Another'), metadata],
      [user.replace('@grant        GM_getValue', '@grant        GM_xmlhttpRequest'), metadata],
      [user, `${metadata}alert(1)`],
      [user.replace('@version      0.1.0', '@version      0.1.1'), metadata],
    ])
      expect(() => validateUserscriptPair(pair[0], pair[1], '0.1.0')).toThrow()
  })
  it('accepts a complete bundle and checks archive identity/background/license', async () => {
    const { directory } = await fixture()
    expect((await verifyRelease(directory, true)).version).toBe('0.1.0')
  })
  it('detects corrupted bytes even when file names are unchanged', async () => {
    const { directory } = await fixture()
    await writeFile(path.join(directory, 'one-web.user.js'), `${user}corrupt`)
    await expect(verifyRelease(directory)).rejects.toThrow('size/hash mismatch')
  })
  it('rejects missing and extra artifacts', async () => {
    const { directory } = await fixture()
    await writeFile(path.join(directory, 'unexpected.txt'), 'x')
    await expect(verifyRelease(directory)).rejects.toThrow('inventory')
    await rm(path.join(directory, 'unexpected.txt'))
    await rm(path.join(directory, 'one-web.meta.js'))
    await expect(verifyRelease(directory)).rejects.toThrow('inventory')
  })
  it('rejects dirty published source while permitting an honest local rehearsal', async () => {
    const { directory, files } = await fixture()
    await save(directory, files, true)
    expect((await verifyRelease(directory)).source.dirty).toBe(true)
    await expect(verifyRelease(directory, true)).rejects.toThrow('clean source')
  })
  it('checks canonical metadata even when malicious bytes are rehashed', async () => {
    const { directory, files } = await fixture()
    files['one-web.meta.js'] = Buffer.from(`${metadata}alert(1)`)
    await save(directory, files)
    await expect(verifyRelease(directory)).rejects.toThrow('canonical version')
  })
  it('checks embedded manifest versions after checksums pass', async () => {
    const { directory, files } = await fixture()
    const zip = await JSZip.loadAsync(files['one-web-chromium.zip'])
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    zip.file('manifest.json', JSON.stringify({ ...manifest, version: '0.1.1' }))
    files['one-web-chromium.zip'] = await zip.generateAsync({ type: 'nodebuffer' })
    await save(directory, files)
    await expect(verifyRelease(directory)).rejects.toThrow('versions must agree')
  })
  it.each(['../dist/background.js', '/dist/background.js', 'https://evil.test/a.js', './dist/background.js?x'])('rejects unsafe background entry %s after rehashing', async (entry) => {
    const { directory, files } = await fixture()
    const zip = await JSZip.loadAsync(files['one-web-chromium.zip'])
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    zip.file('manifest.json', JSON.stringify({ ...manifest, background: { service_worker: entry } }))
    files['one-web-chromium.zip'] = await zip.generateAsync({ type: 'nodebuffer' })
    await save(directory, files)
    await expect(verifyRelease(directory)).rejects.toThrow('Missing background entry')
  })

  it('rejects ZIP traversal names even when JSZip sanitizes them', async () => {
    const { directory, files } = await fixture()
    const zip = await JSZip.loadAsync(files['one-web-chromium.zip'])
    zip.file('../hidden.txt', 'unexpected')
    files['one-web-chromium.zip'] = await zip.generateAsync({ type: 'nodebuffer' })
    await save(directory, files)
    await expect(verifyRelease(directory)).rejects.toThrow('unexpected build files')
  })

  it('rejects a changed provenance manifest or checksum list', async () => {
    const { directory } = await fixture()
    const sums = await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')
    await writeFile(path.join(directory, 'SHA256SUMS'), sums.replace(/[a-f0-9]/, 'z'))
    await expect(verifyRelease(directory)).rejects.toThrow('SHA256SUMS')
  })
})
