import type { Plugin } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const FIREFOX_VENDOR_RECEIPT = 'oneweb-react-vendor-policy.json'
const POLICY = 'oneweb-react-vendor-v1'
const CHUNK_NAME = 'oneweb-react-vendor'
const CHUNK_FILE = /^chunks\/oneweb-react-vendor-[\w-]+\.js$/
// React/react-dom 19.3.1 and its locked scheduler production sources.
// Dependency updates require source review and new digests.
export const REACT_SOURCE_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'react/index.js': '60caffdecbdc5db3bc4ec4e83df9488345ccb271d07533b9210bf5750918d97e',
  'react/jsx-runtime.js': 'b392951a77d0a2e6a6bd017e49d768481ae5b63c4109c6c31f622cf7b2433edc',
  'react/cjs/react.production.js': '0b5529981841afa1b58c76ba85c29bb681ff5f07cd8cde6a10b967d3915b8e1c',
  'react/cjs/react-jsx-runtime.production.js': '1e46f15002696985e80c61d47aaa30dabb03c954270a690f5f7dfbbacfa9002b',
  'react-dom/index.js': 'ba1a3e33489f868371561777607e3ee5091df0f7ea3f1a10f789d6b86e4c1505',
  'react-dom/client.js': '00e348ab3d6bc2eef908345d0bc4e008c95bcfecec060dfda5c4967953761396',
  'react-dom/cjs/react-dom.production.js': '7a05d7f7bb2b02aae84018a88d4815a2181eef48d2cb8172d403eaa2b131eefd',
  'react-dom/cjs/react-dom-client.production.js': 'a319b413b7a19ee34422d9a12a8e7afd003c07846716d278ba1a0898e8cb6251',
  'scheduler/index.js': '145965504d60007bc25486ab930b0367867dcd5d579ccd343c148d69349a7cfb',
  'scheduler/cjs/scheduler.production.js': '679adff761d31e9426604f80c0e99be44a3e6f4c6834b0218ecf0312a67c171f',
})
const DOM_CLIENT = 'react-dom/cjs/react-dom-client.production.js'

export function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

export function reactSource(id: string) {
  const normalized = id.replaceAll('\\', '/').replace(/^\0/, '')
  const match = /^(.*\/node_modules\/)((?:react|react-dom|scheduler)\/[^?]+)(?:\?commonjs-(?:proxy|exports|es-import|entry|module))?$/.exec(normalized)
  return match ? { file: `${match[1]}${match[2]}`, source: match[2] } : null
}

export function verifyReactSources(
  moduleIds: readonly string[],
  read: (_file: string) => Uint8Array = readFileSync,
) {
  if (!moduleIds.length)
    throw new Error('Firefox vendor chunk has no module provenance')
  const sources: Record<string, string> = {}
  for (const id of moduleIds) {
    const source = reactSource(id)
    if (!source || !Object.hasOwn(REACT_SOURCE_SHA256, source.source))
      throw new Error(`Firefox vendor chunk contains an unapproved module: ${id}`)
    const digest = sha256(read(source.file))
    if (digest !== REACT_SOURCE_SHA256[source.source])
      throw new Error(`Firefox vendor source digest changed: ${source.source}`)
    sources[source.source] = digest
  }
  if (!Object.hasOwn(sources, DOM_CLIENT))
    throw new Error('Firefox vendor chunk is missing the pinned React DOM client')
  return sources
}

export function firefoxVendorPolicyPlugin(): Plugin {
  let multiPage = false
  return {
    name: 'oneweb-firefox-react-vendor-policy',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      multiPage = !config.build.lib
    },
    outputOptions(output) {
      if (!multiPage)
        return
      return {
        ...output,
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          // Bundler glue is not upstream React source; keep it outside.
          if (id === '\0commonjsHelpers.js')
            return 'oneweb-commonjs-helpers'
          if (reactSource(id))
            return CHUNK_NAME
        },
      }
    },
    generateBundle(_options, bundle) {
      if (!multiPage)
        return
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk' && item.name === CHUNK_NAME)
      if (chunks.length !== 1 || chunks[0].type !== 'chunk')
        throw new Error('Expected exactly one Firefox React vendor chunk')
      const chunk = chunks[0]
      if (!CHUNK_FILE.test(chunk.fileName))
        throw new Error('Unexpected Firefox React vendor chunk filename')
      const sources = verifyReactSources(chunk.moduleIds)
      this.emitFile({
        type: 'asset',
        fileName: FIREFOX_VENDOR_RECEIPT,
        source: JSON.stringify({ policy: POLICY, file: chunk.fileName, sha256: sha256(chunk.code), sources }, null, 2),
      })
    },
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// Bind diagnostics to the exact assignments, not a whole file or rule.
export function reactInnerHtmlSites(code: string) {
  const sites = [...code.matchAll(/(?<![\w$])[A-Z_$][\w$]*\.innerHTML\s*=\s*[A-Z_$][\w$]*(?=\s*[,;)}])/gi)].map((match) => {
    const offset = match.index!
    const line = code.slice(0, offset).split('\n').length
    const column = offset - code.lastIndexOf('\n', offset - 1)
    return `${line}:${column}`
  })
  if (sites.length !== 2 || new Set(sites).size !== 2)
    throw new Error('Pinned React DOM assignments no longer match the vendor policy')
  return new Set(sites)
}

export function checkFirefoxLintReport(root: string, value: unknown) {
  if (!record(value) || !record(value.summary))
    throw new Error('Invalid Firefox linter report')
  for (const key of ['errors', 'warnings', 'notices'] as const) {
    if (!Array.isArray(value[key]) || value.summary[key] !== value[key].length)
      throw new Error(`Invalid Firefox linter ${key}`)
  }
  const { errors, warnings, notices } = value as Record<'errors' | 'warnings' | 'notices', unknown[]>
  if (errors.length || notices.length)
    throw new Error('Firefox linter reported errors or notices')
  if (!warnings.length)
    return 0
  const receipt: unknown = JSON.parse(readFileSync(path.join(root, FIREFOX_VENDOR_RECEIPT), 'utf8'))
  if (!record(receipt) || receipt.policy !== POLICY || typeof receipt.file !== 'string'
    || !CHUNK_FILE.test(receipt.file) || !record(receipt.sources)
    || !Object.hasOwn(receipt.sources, DOM_CLIENT)) {
    throw new Error('Firefox React vendor provenance is missing or invalid')
  }
  for (const [source, digest] of Object.entries(receipt.sources)) {
    if (!Object.hasOwn(REACT_SOURCE_SHA256, source) || digest !== REACT_SOURCE_SHA256[source])
      throw new Error(`Firefox React vendor provenance changed: ${source}`)
  }
  const code = readFileSync(path.join(root, receipt.file), 'utf8')
  if (sha256(code) !== receipt.sha256)
    throw new Error('Firefox React vendor chunk digest changed')
  const remaining = reactInnerHtmlSites(code)
  for (const warning of warnings) {
    if (!record(warning) || warning.code !== 'UNSAFE_VAR_ASSIGNMENT'
      || warning._type !== 'warning' || warning.message !== 'Unsafe assignment to innerHTML'
      || warning.file !== receipt.file || !Number.isSafeInteger(warning.line)
      || !Number.isSafeInteger(warning.column)
      || !remaining.delete(`${warning.line}:${warning.column}`)) {
      throw new Error(`Firefox linter diagnostic is outside the React vendor policy: ${JSON.stringify(warning)}`)
    }
  }
  if (remaining.size)
    throw new Error('Firefox linter did not report the two pinned React DOM assignments')
  return warnings.length
}
