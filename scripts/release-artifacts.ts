import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { releaseTag, stableVersion } from './release-version'
import { validateUserscriptPair } from './userscript-metadata'
import { validateOneWebIdentity } from './verify-pre-release-identity'

export const PRIMARY_ASSETS = ['LICENSE', 'one-web-chromium.zip', 'one-web-firefox-unsigned.xpi', 'one-web.meta.js', 'one-web.user.js'] as const
export const RELEASE_ASSETS = [...PRIMARY_ASSETS, 'release-manifest.json', 'SHA256SUMS'].sort()
const root = fileURLToPath(new URL('../', import.meta.url))
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

interface ReleaseManifest {
  schemaVersion: number
  repository: string
  version: string
  tag: string
  source: { commit: string, dirty: boolean }
  assets: Record<string, { bytes: number, sha256: string }>
}

async function archive(directory: string, license: Buffer) {
  const zip = new JSZip()
  async function add(dir: string, prefix = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory())
        await add(path.join(dir, entry.name), `${name}/`)
      else if (entry.isFile())
        zip.file(name, await fs.readFile(path.join(dir, entry.name)), { date: new Date('2020-01-01T00:00:00Z') })
      else
        throw new Error(`Non-regular build entry: ${name}`)
    }
  }
  await add(directory)
  zip.file('LICENSE', license, { date: new Date('2020-01-01T00:00:00Z') })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function verifyRelease(directory: string, published = false): Promise<ReleaseManifest> {
  const names = (await fs.readdir(directory)).sort()
  if (JSON.stringify(names) !== JSON.stringify(RELEASE_ASSETS))
    throw new Error('Release inventory differs from the complete expected asset set')
  const entries = await Promise.all(names.map(async name => [name, await fs.readFile(path.join(directory, name))] as const))
  const files = Object.fromEntries(entries)
  const manifest: ReleaseManifest = JSON.parse(files['release-manifest.json'].toString())
  const version = stableVersion(manifest.version)
  releaseTag(version, manifest.tag)
  if (manifest.schemaVersion !== 1 || manifest.repository !== 'JuckZ/one-web'
    || !/^[a-f0-9]{40}$/.test(manifest.source?.commit) || typeof manifest.source?.dirty !== 'boolean'
    || (published && manifest.source.dirty)) {
    throw new Error('Invalid release source identity (published releases require clean source)')
  }
  if (JSON.stringify(Object.keys(manifest.assets).sort()) !== JSON.stringify([...PRIMARY_ASSETS].sort()))
    throw new Error('Manifest asset inventory mismatch')
  for (const name of PRIMARY_ASSETS) {
    if (manifest.assets[name].bytes !== files[name].length || manifest.assets[name].sha256 !== digest(files[name]))
      throw new Error(`Asset size/hash mismatch: ${name}`)
  }
  const sums = names.filter(name => name !== 'SHA256SUMS').map(name => `${digest(files[name])}  ${name}\n`).join('')
  if (files.SHA256SUMS.toString() !== sums)
    throw new Error('SHA256SUMS mismatch')
  validateUserscriptPair(files['one-web.user.js'].toString(), files['one-web.meta.js'].toString(), version)
  if (!files.LICENSE.toString().includes('MIT License') || !files['one-web.user.js'].includes(files.LICENSE))
    throw new Error('MIT license must accompany the standalone script')
  const pkg = { name: 'one-web', displayName: 'OneWeb', homepage: 'https://github.com/JuckZ/one-web', version }
  for (const [name, firefox] of [['one-web-chromium.zip', false], ['one-web-firefox-unsigned.xpi', true]] as const) {
    const zip = await JSZip.loadAsync(files[name], { checkCRC32: true })
    const paths = Object.keys(zip.files).filter(name => !zip.files[name].dir)
    if (Object.values(zip.files).some(file => file.unsafeOriginalName && file.unsafeOriginalName !== file.name)
      || paths.length < 5 || paths.some(name => /(?:^|\/)(?:\.\.?|node_modules|\.git|\.env[^/]*)(?:\/|$)|\.(?:map|pem|key)$/.test(name))) {
      throw new Error(`Archive contains missing or unexpected build files: ${name}`)
    }
    const extension = JSON.parse(await zip.file('manifest.json')?.async('string') ?? 'null')
    validateOneWebIdentity(pkg, extension)
    if (extension.manifest_version !== 3 || (firefox ? !Array.isArray(extension.background?.scripts) || extension.side_panel : typeof extension.background?.service_worker !== 'string'))
      throw new Error(`Wrong browser target in ${name}`)
    if (await zip.file('LICENSE')?.async('string') !== files.LICENSE.toString())
      throw new Error(`Missing archive license: ${name}`)
    const scripts = firefox ? extension.background.scripts : [extension.background.service_worker]
    for (const entry of scripts) {
      if (typeof entry !== 'string' || entry.includes('\\') || /[?#:%]/.test(entry)
        || entry.startsWith('/') || entry.split('/').includes('..')
        || !zip.file(entry.replace(/^\.\//, ''))) {
        throw new Error(`Missing background entry: ${entry}`)
      }
    }
  }
  return manifest
}

async function prepare(local: boolean) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const version = stableVersion(pkg.version)
  const tag = releaseTag(version, process.env.ONEWEB_RELEASE_TAG ?? `v${version}`)
  const source = { commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain', '--untracked-files=all')) }
  if (!local && (source.dirty || git('rev-parse', `${tag}^{commit}`) !== source.commit))
    throw new Error('Release requires a clean checkout at the exact version tag; use --local for a rehearsal')
  const license = await fs.readFile(path.join(root, 'LICENSE'))
  const files: Record<string, Buffer> = {
    'LICENSE': license,
    'one-web-chromium.zip': await archive(path.join(root, 'artifacts/build/chromium'), license),
    'one-web-firefox-unsigned.xpi': await archive(path.join(root, 'artifacts/build/firefox'), license),
    'one-web.user.js': await fs.readFile(path.join(root, 'artifacts/build/userscript/one-web.user.js')),
    'one-web.meta.js': await fs.readFile(path.join(root, 'artifacts/build/userscript/one-web.meta.js')),
  }
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    repository: 'JuckZ/one-web',
    version,
    tag,
    source,
    assets: Object.fromEntries(Object.entries(files).sort().map(([name, bytes]) => [name, { bytes: bytes.length, sha256: digest(bytes) }])),
  }
  files['release-manifest.json'] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  files.SHA256SUMS = Buffer.from(Object.keys(files).sort().map(name => `${digest(files[name])}  ${name}\n`).join(''))
  const directory = path.join(root, 'artifacts/release', tag)
  await fs.mkdir(directory, { recursive: true })
  // Never reuse a directory with stale/unknown assets.
  for (const name of await fs.readdir(directory)) {
    if (!RELEASE_ASSETS.includes(name))
      throw new Error(`Unexpected previous release artifact: ${name}`)
  }
  for (const [name, bytes] of Object.entries(files))
    await fs.writeFile(path.join(directory, name), bytes)
  await verifyRelease(directory, !local)
  process.stdout.write(`Verified ${local ? 'LOCAL REHEARSAL' : 'release'}: ${directory}\n`)
}

async function main() {
  if (process.argv[2] === 'prepare')
    await prepare(process.argv.slice(3).includes('--local'))
  else if (process.argv[2] === 'verify' && process.argv[3])
    process.stdout.write(`${JSON.stringify(await verifyRelease(path.resolve(process.argv[3]), process.argv.includes('--published')))}\n`)
  else
    throw new Error('Expected prepare [--local] or verify DIRECTORY [--published]')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
