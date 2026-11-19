/* eslint-disable no-template-curly-in-string -- embedded scripts execute inside Firefox extension/chrome contexts */
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import net, { type AddressInfo, type Socket } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import fs from 'fs-extra'
import { type FirefoxAssistantRequests, runFirefoxAssistantScenario } from './firefox-assistant-scenario'
import { resolveFirefoxBinary, terminateProcessGroup } from './firefox-runner'
import { type FirefoxSmartAppsDriver, runFirefoxSmartAppsScenario } from './firefox-smart-apps-scenario'
import { prepareFirefoxTestAudio } from './firefox-test-audio'

export { terminateProcessGroup } from './firefox-runner'

const EXTENSION_ID = 'one-web@juckz.local'
const EXTENSION_SIDEBAR_IDENTITY = EXTENSION_ID.split('@')[0]
const PAGE_TOOLBOX_ID = 'dev.oneweb.page-toolbox'
const SEND_TO_OPENLIST_ID = 'dev.oneweb.send-to-openlist'
const VIDEO_DUBBING_ID = 'dev.oneweb.video-dubbing'
const NETWORK_MANAGEMENT_ID = 'dev.oneweb.clash-control'
const COMMAND_TIMEOUT_MS = 30_000
const STARTUP_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 100

type JsonRecord = Record<string, unknown>
interface FirefoxClashRequests { version: number, configs: number, proxies: number, unauthorized: number }
const FIREFOX_CLASH_SECRET = 'oneweb-firefox-network-clash-secret'

export function encodeLengthPrefixedJson(value: unknown) {
  const payload = JSON.stringify(value)
  return Buffer.from(`${Buffer.byteLength(payload)}:${payload}`)
}

export class LengthPrefixedJsonDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer | string) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    const messages: unknown[] = []
    while (true) {
      const separator = this.buffer.indexOf(58)
      if (separator < 1)
        break
      const lengthText = this.buffer.subarray(0, separator).toString()
      if (!/^\d+$/.test(lengthText))
        throw new TypeError('Invalid length-prefixed JSON header')
      const length = Number(lengthText)
      const end = separator + 1 + length
      if (!Number.isSafeInteger(length) || length < 0)
        throw new TypeError('Invalid length-prefixed JSON size')
      if (this.buffer.length < end)
        break
      messages.push(JSON.parse(this.buffer.subarray(separator + 1, end).toString()))
      this.buffer = this.buffer.subarray(end)
    }
    return messages
  }
}

export class FirefoxProcessLog {
  private output = ''
  private rdpPort: number | null = null

  push(chunk: Buffer | string) {
    this.output += chunk.toString()
    const matches = [...this.output.matchAll(/Firefox args:[^\n]*-start-debugger-server\s+(\d+)/g)]
    const ports = new Set(matches.map(match => Number(match[1])))
    if (ports.size > 1)
      throw new Error('Firefox launch output contains conflicting RDP ports')
    const [port] = ports
    if (port !== undefined) {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
        throw new Error('Firefox launch output contains an invalid RDP port')
      this.rdpPort = port
    }
    if (this.output.length > 256 * 1024)
      this.output = this.output.slice(-128 * 1024)
    return this.rdpPort
  }

  get port() { return this.rdpPort }
  get tail() { return this.output.slice(-8_192) }
}

export function firefoxAddonOrigin(response: unknown, extensionId = EXTENSION_ID) {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return null
  const addons = (response as JsonRecord).addons
  if (!Array.isArray(addons))
    return null
  const addon = addons.find((candidate) => {
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as JsonRecord).id === extensionId
  }) as JsonRecord | undefined
  if (!addon || addon.temporarilyInstalled !== true || typeof addon.manifestURL !== 'string')
    return null
  let manifestUrl: URL
  try {
    manifestUrl = new URL(addon.manifestURL)
  }
  catch {
    return null
  }
  return manifestUrl.protocol === 'moz-extension:' && manifestUrl.hostname && manifestUrl.pathname === '/manifest.json'
    ? `moz-extension://${manifestUrl.host}`
    : null
}

export function validateFirefoxArtifactManifest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Firefox artifact manifest is invalid')
  const manifest = value as JsonRecord
  const gecko = manifest.browser_specific_settings as JsonRecord | undefined
  const geckoSettings = gecko?.gecko as JsonRecord | undefined
  const sidebar = manifest.sidebar_action as JsonRecord | undefined
  if (manifest.manifest_version !== 3
    || geckoSettings?.id !== EXTENSION_ID
    || sidebar?.default_panel !== 'sidebar.html'
    || Object.hasOwn(manifest, 'side_panel')) {
    throw new TypeError('Firefox artifact does not expose the expected production sidebar boundary')
  }
  const permissions = manifest.permissions
  const optionalOrigins = manifest.optional_host_permissions
  if (!Array.isArray(permissions)
    || permissions.includes('<all_urls>')
    || !permissions.includes('contextMenus')
    || !Array.isArray(optionalOrigins)
    || !optionalOrigins.includes('http://*/*')
    || !optionalOrigins.includes('https://*/*')) {
    throw new TypeError('Firefox artifact permission boundary is invalid')
  }
  return true
}

function delay(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} is invalid`)
  return value as JsonRecord
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(message)
}

class MarionetteClient {
  private readonly decoder = new LengthPrefixedJsonDecoder()
  private readonly pending = new Map<number, {
    reject: (_error: Error) => void
    resolve: (_value: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  private sequence = 0
  private socket: Socket | null = null
  private handshake: JsonRecord | null = null

  async connect(port: number) {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    this.socket = socket
    socket.on('data', chunk => this.accept(chunk))
    socket.on('error', error => this.failAll(error))
    socket.on('close', () => this.failAll(new Error('Marionette connection closed')))
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    await pollUntil(() => this.handshake, STARTUP_TIMEOUT_MS, 'Marionette handshake')
    assert(this.handshake?.applicationType === 'gecko', 'Unexpected Marionette application type')
  }

  private accept(chunk: Buffer) {
    for (const message of this.decoder.push(chunk)) {
      if (!Array.isArray(message)) {
        this.handshake = asRecord(message, 'Marionette handshake')
        continue
      }
      const [, id, error, result] = message
      if (typeof id !== 'number')
        continue
      const deferred = this.pending.get(id)
      if (!deferred)
        continue
      clearTimeout(deferred.timer)
      this.pending.delete(id)
      if (error)
        deferred.reject(new Error(`Marionette command failed: ${JSON.stringify(error)}`))
      else
        deferred.resolve(result)
    }
  }

  private failAll(error: Error) {
    for (const deferred of this.pending.values()) {
      clearTimeout(deferred.timer)
      deferred.reject(error)
    }
    this.pending.clear()
  }

  command(name: string, parameters: JsonRecord = {}) {
    if (!this.socket)
      return Promise.reject(new Error('Marionette is not connected'))
    const id = ++this.sequence
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Marionette command timed out: ${name}`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(id, { reject, resolve, timer })
      this.socket!.write(encodeLengthPrefixedJson([0, id, name, parameters]))
    })
  }

  close() {
    this.socket?.destroy()
    this.socket = null
    this.failAll(new Error('Marionette connection closed'))
  }
}

class RdpClient {
  private readonly decoder = new LengthPrefixedJsonDecoder()
  private pending: {
    reject: (_error: Error) => void
    resolve: (_value: unknown) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  private rootReady = false
  private socket: Socket | null = null

  async connect(port: number) {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    this.socket = socket
    socket.on('data', chunk => this.accept(chunk))
    socket.on('error', error => this.fail(error))
    socket.on('close', () => this.fail(new Error('Firefox RDP connection closed')))
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    await pollUntil(() => this.rootReady, STARTUP_TIMEOUT_MS, 'Firefox RDP root actor')
  }

  private accept(chunk: Buffer) {
    for (const message of this.decoder.push(chunk)) {
      const record = asRecord(message, 'Firefox RDP response')
      if (!this.rootReady && record.from === 'root') {
        this.rootReady = true
        continue
      }
      if (!this.pending || record.from !== 'root')
        continue
      const deferred = this.pending
      this.pending = null
      clearTimeout(deferred.timer)
      if (record.error)
        deferred.reject(new Error(`Firefox RDP request failed: ${JSON.stringify(record)}`))
      else
        deferred.resolve(record)
    }
  }

  private fail(error: Error) {
    if (!this.pending)
      return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = null
  }

  request(type: string) {
    if (!this.socket || this.pending)
      return Promise.reject(new Error('Firefox RDP client is unavailable'))
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`Firefox RDP request timed out: ${type}`))
      }, COMMAND_TIMEOUT_MS)
      this.pending = { reject, resolve, timer }
      this.socket!.write(encodeLengthPrefixedJson({ to: 'root', type }))
    })
  }

  close() {
    this.socket?.destroy()
    this.socket = null
    this.fail(new Error('Firefox RDP connection closed'))
  }
}

async function pollUntil<T>(
  read: () => T | Promise<T>,
  timeout: number,
  label: string,
  accept: (_value: T) => boolean = Boolean,
) {
  const deadline = Date.now() + timeout
  let latest: T
  while (Date.now() < deadline) {
    latest = await read()
    if (accept(latest))
      return latest
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`${label} did not become ready within ${timeout} ms`)
}

function renderPageToolboxFixture(label: string) {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Firefox Page Toolbox ',
    label,
    '</title></head><body contenteditable="false">',
    '<input id="toolbox-password" type="password" value="page-local-secret">',
    '<p id="toolbox-copy-target">untrusted &lt;script&gt;page text&lt;/script&gt;</p>',
    '<a id="send-openlist-resource" href="https://cdn.example/firefox?sig=a%2Bb#drop" title="&lt;img data-send-xss src=x&gt;">resource</a>',
    '<iframe id="toolbox-child-frame" src="/frame"></iframe>',
    '<script>',
    'window.__pageToolboxFixture={copyBlocks:0};',
    'document.body.addEventListener("copy",event=>{window.__pageToolboxFixture.copyBlocks++;event.preventDefault()});',
    '</script></body></html>',
  ].join('')
}

function renderNetworkFixture(frame: boolean) {
  const recorder = '<script nonce="network">document.documentElement.dataset.network=JSON.stringify({peer:typeof RTCPeerConnection,track:typeof MediaStreamTrack,description:typeof RTCSessionDescription,media:typeof navigator.mediaDevices,mediaBlocked:navigator.mediaDevices===null,ice:typeof RTCIceCandidate,channel:typeof RTCDataChannel})</script>'
  const srcdoc = recorder.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Firefox WebRTC fixture</title>${recorder}</head><body>${frame ? '' : `<iframe id="network-http" src="/network-frame"></iframe><iframe id="network-srcdoc" srcdoc="${srcdoc}"></iframe>`}</body></html>`
}

async function startFixtures() {
  const sendToken = 'oneweb-firefox-openlist-token'
  const sendRequests = { me: 0, tools: 0, add: 0, undone: 0, unauthorized: 0 }
  const sendTasks: Array<Record<string, unknown>> = []
  const videoBytes = await fs.readFile(new URL('../e2e/assets/dubbing.webm', import.meta.url))
  const speechBytes = dubbingWav()
  const dubbingRequests = { translation: 0, speech: 0 }
  const assistantRequests: FirefoxAssistantRequests = { text: 0, translation: 0, aborted: 0, tabReferences: [] }
  const clashRequests: FirefoxClashRequests = { version: 0, configs: 0, proxies: 0, unauthorized: 0 }
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/assistant/article') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end('<!doctype html><meta charset="utf-8"><title>Firefox assistant acceptance</title><main><h1>Firefox reading fixture</h1><p id="assistant-source">Known Firefox page context.</p><p>Another bounded paragraph.</p></main><textarea>Hello world!</textarea>')
      return
    }
    if (url.pathname === '/assistant/second') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end('<!doctype html><meta charset="utf-8"><title>Second Firefox source</title><main>Distinct second source.</main>')
      return
    }
    if (url.pathname === '/assistant/v1/chat/completions') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const input = JSON.parse(Buffer.concat(chunks).toString())
        if (input.messages[0]?.content.includes('Preserve every ID exactly once')) {
          assistantRequests.translation++
          const blocks = JSON.parse(input.messages.at(-1).content).blocks as Array<{ id: string, text: string }>
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: {
            content: JSON.stringify({ translations: blocks.map(block => ({ id: block.id, text: `译文 ${block.text}` })) }),
          } }] }))
          return
        }
        assistantRequests.text++
        for (const message of input.messages) {
          if (message.role === 'user' && message.content.startsWith('Reference ['))
            assistantRequests.tabReferences.push(message.content)
        }
        response.on('close', () => {
          if (!response.writableEnded)
            assistantRequests.aborted++
        })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        if (JSON.stringify(input.messages).includes('HOLD-FIREFOX-STREAM')) {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Firefox pending' } }] })}\n\n`)
          return
        }
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Firefox <b>safe</b>' } }] })}\n\ndata: [DONE]\n\n`)
      })
      return
    }
    if (['/version', '/configs', '/proxies'].includes(url.pathname)) {
      if (request.method !== 'GET' || request.headers.authorization !== `Bearer ${FIREFOX_CLASH_SECRET}`) {
        clashRequests.unauthorized++
        response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}')
        return
      }
      const endpoint = url.pathname.slice(1) as 'version' | 'configs' | 'proxies'
      clashRequests[endpoint]++
      const payloads = {
        version: { meta: true, version: 'firefox-network-fixture-1.0' },
        configs: { mode: 'rule' },
        proxies: { proxies: {
          'Firefox Proxy': { type: 'Selector', now: 'Firefox Node', all: ['Firefox Node'] },
          'Firefox Node': { type: 'Direct', alive: true },
        } },
      }
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json' }).end(JSON.stringify(payloads[endpoint]))
      return
    }
    if (url.pathname === '/network-page' || url.pathname === '/network-frame') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': 'script-src \'nonce-network\'; frame-src \'self\'',
      }).end(renderNetworkFixture(url.pathname === '/network-frame'))
      return
    }
    if (url.pathname === '/dubbing-video') {
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><title>Firefox HTML5 dubbing fixture</title><div style="position:relative;width:800px;height:450px"><video controls preload="auto" src="/dubbing.webm" style="width:100%;height:100%"></video></div>')
      return
    }
    if (url.pathname === '/dubbing.webm') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), videoBytes.length - 1) : videoBytes.length - 1
      if (start > end || start >= videoBytes.length) {
        response.writeHead(416, { 'content-range': `bytes */${videoBytes.length}` }).end()
        return
      }
      response.writeHead(range ? 206 : 200, {
        'content-type': 'video/webm',
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        ...(range ? { 'content-range': `bytes ${start}-${end}/${videoBytes.length}` } : {}),
      }).end(videoBytes.subarray(start, end + 1))
      return
    }
    if (url.pathname.startsWith('/dub/v1/')) {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        if (url.pathname === '/dub/v1/chat/completions') {
          dubbingRequests.translation++
          const input = JSON.parse(Buffer.concat(chunks).toString())
          const cues = JSON.parse(input.messages[1].content).cues as Array<{ id: string }>
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              cues: cues.map(cue => ({ id: cue.id, translatedText: `Firefox translated ${cue.id}` })),
            }) } }],
          }))
        }
        else if (url.pathname === '/dub/v1/audio/speech') {
          dubbingRequests.speech++
          response.writeHead(200, { 'content-type': 'audio/wav' }).end(speechBytes)
        }
        else {
          response.writeHead(404).end()
        }
      })
      return
    }
    const reply = (code: number, data: unknown, status = 200) => response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    }).end(JSON.stringify({ code, message: code === 200 ? 'success' : 'failed', data }))
    if (url.pathname.startsWith('/api/') && !/^oneweb-[0-9a-f]{8}$/u.test(String(request.headers['client-id'] || ''))) {
      reply(400, null, 400)
      return
    }
    if (url.pathname === '/api/public/offline_download_tools') {
      sendRequests.tools += 1
      reply(200, ['FirefoxTool'])
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.headers.authorization !== sendToken) {
        sendRequests.unauthorized += 1
        reply(401, null, 401)
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/me') {
        sendRequests.me += 1
        reply(200, { id: 1, username: 'firefox-fixture' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/task/offline_download/undone') {
        sendRequests.undone += 1
        reply(200, sendTasks)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/fs/add_offline_download') {
        const chunks: Buffer[] = []
        request.on('data', chunk => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          let body: JsonRecord | null = null
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRecord
          }
          catch {}
          if (!body
            || !Array.isArray(body.urls)
            || body.urls.length !== 1
            || body.tool !== 'FirefoxTool'
            || body.delete_policy !== 'delete_on_upload_succeed') {
            reply(400, null, 400)
            return
          }
          sendRequests.add += 1
          const task = { id: `firefox-task-${sendRequests.add}`, name: '<img data-firefox-xss src=x>', state: 1, status: 'running', progress: 0, total_bytes: 0, error: '' }
          sendTasks.push(task)
          reply(200, { tasks: [{ id: task.id }] })
        })
        return
      }
      reply(404, null, 404)
      return
    }
    if (url.pathname === '/frame') {
      response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><body><input id="frame-password" type="password" value="frame-secret"></body>')
      return
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'no-store' }).end()
      return
    }
    const label = request.headers.host?.startsWith('localhost') ? 'beta' : 'alpha'
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
      .end(renderPageToolboxFixture(label))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(80, '127.0.0.1', resolve)
  })
  return {
    alphaOrigin: 'http://127.0.0.1',
    betaOrigin: 'http://localhost',
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    server,
    sendRequests,
    sendToken,
    dubbingRequests,
    assistantRequests,
    clashRequests,
  }
}

/** Self-generated PCM tone exercises the real browser decoder without cloud credentials. */
function dubbingWav() {
  const samples = 3 * 24000
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24)
  bytes.writeUInt32LE(48000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(Math.round(Math.sin(i / 24000 * 440 * Math.PI * 2) * 2000), 44 + i * 2)
  return bytes
}

async function availablePort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function waitForRdpPort(child: ChildProcess, log: FirefoxProcessLog) {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Firefox did not publish an RDP port.\n${log.tail}`)), STARTUP_TIMEOUT_MS)
    const accept = (chunk: Buffer) => {
      try {
        const port = log.push(chunk)
        if (port) {
          clearTimeout(timer)
          resolve(port)
        }
      }
      catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    }
    child.stdout?.on('data', accept)
    child.stderr?.on('data', accept)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`Firefox exited before startup (code ${code}, signal ${signal}).\n${log.tail}`))
    })
  })
}

async function connectRdp(port: number) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let latest: unknown
  while (Date.now() < deadline) {
    const client = new RdpClient()
    try {
      await client.connect(port)
      return client
    }
    catch (error) {
      latest = error
      client.close()
      await delay(150)
    }
  }
  throw new Error(`Unable to connect to Firefox RDP: ${String(latest)}`)
}

async function discoverExtensionOrigin(rdp: RdpClient) {
  return pollUntil(async () => firefoxAddonOrigin(await rdp.request('listAddons')), STARTUP_TIMEOUT_MS, 'temporary OneWeb add-on origin')
}

function unwrapValue<T>(value: unknown) {
  const record = asRecord(value, 'Marionette value')
  return record.value as T
}

async function execute(
  client: MarionetteClient,
  script: string,
  args: unknown[] = [],
  newSandbox = false,
) {
  return unwrapValue(await client.command('WebDriver:ExecuteScript', {
    args,
    newSandbox,
    script,
    scriptTimeout: COMMAND_TIMEOUT_MS,
  }))
}

async function executeAsync(
  client: MarionetteClient,
  script: string,
  args: unknown[] = [],
  newSandbox = false,
) {
  return unwrapValue(await client.command('WebDriver:ExecuteAsyncScript', {
    args,
    newSandbox,
    script,
    scriptTimeout: COMMAND_TIMEOUT_MS,
  }))
}

async function setContext(client: MarionetteClient, value: 'chrome' | 'content') {
  await client.command('Marionette:SetContext', { value })
}

async function switchWindow(client: MarionetteClient, handle: string) {
  await client.command('WebDriver:SwitchToWindow', { handle })
}

async function navigate(client: MarionetteClient, url: string) {
  await client.command('WebDriver:Navigate', { url })
}

async function newTab(client: MarionetteClient, url: string) {
  const created = asRecord(await client.command('WebDriver:NewWindow', { type: 'tab' }), 'new Firefox tab')
  assert(typeof created.handle === 'string', 'Firefox did not return a tab handle')
  await switchWindow(client, created.handle)
  await navigate(client, url)
  return created.handle
}

async function waitForPage(client: MarionetteClient, predicate: string, label: string) {
  return pollUntil(
    () => execute(client, `return Boolean(${predicate})`),
    COMMAND_TIMEOUT_MS,
    label,
  )
}

async function showModuleManagement(client: MarionetteClient, driverHandle: string) {
  await switchWindow(client, driverHandle)
  await execute(client, 'const button=document.querySelector("[data-testid=manage-modules]");if(button?.getAttribute("aria-expanded")!=="true")button?.click();return true')
  await waitForPage(client, `document.querySelector('[data-testid="module-manager"][data-surface="settings"] [data-module-id="${PAGE_TOOLBOX_ID}"] [data-testid="module-toggle"]')`, 'Firefox module management')
}

async function showBuiltinTool(client: MarionetteClient, driverHandle: string, moduleId: string, selector: string) {
  await switchWindow(client, driverHandle)
  await execute(client, [
    'const manager=document.querySelector("[data-testid=manage-modules]");',
    'if(manager?.getAttribute("aria-expanded")==="true")manager.click();',
    'document.querySelector("[data-destination=tools]").click();return true;',
  ].join(''))
  await waitForPage(client, `document.querySelector('[data-open-module="${moduleId}"]')`, 'Firefox tool entry')
  await execute(client, 'document.querySelector(`[data-open-module="${arguments[0]}"]`).click();return true', [moduleId])
  await waitForPage(client, `document.querySelector(${JSON.stringify(selector)})`, 'Firefox builtin workspace')
}

async function grantExactOrigin(client: MarionetteClient, originPattern: string) {
  await setContext(client, 'chrome')
  const result = asRecord(await executeAsync(client, [
    'const pattern=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");',
    `const policy=WebExtensionPolicy.getByID(${JSON.stringify(EXTENSION_ID)});`,
    'if(!policy?.extension)throw new Error("temporary OneWeb policy missing");',
    'await ExtensionPermissions.add(policy.id,{permissions:[],origins:[pattern]},policy.extension);',
    'const uri=Services.io.newURI(pattern.slice(0,-1));',
    'for(let attempt=0;attempt<100&&!policy.allowedOrigins.matches(uri.spec);attempt++)await new Promise(resolve=>setTimeout(resolve,50));',
    'return {ok:true,allowed:policy.allowedOrigins.matches(uri.spec),activeOrigins:policy.extension.activePermissions.origins};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join(''), [originPattern]), 'Firefox exact-origin grant')
  assert(result.ok === true, `Firefox exact-origin grant failed: ${String(result.error)}`)
  assert(result.allowed === true, `Firefox exact-origin grant did not update policy: ${JSON.stringify(result)}`)
  await setContext(client, 'content')
}

async function removeExactOrigin(client: MarionetteClient, originPattern: string) {
  await setContext(client, 'chrome')
  const result = asRecord(await executeAsync(client, [
    'const pattern=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");',
    `const policy=WebExtensionPolicy.getByID(${JSON.stringify(EXTENSION_ID)});`,
    'if(!policy?.extension)throw new Error("temporary OneWeb policy missing");',
    'await ExtensionPermissions.remove(policy.id,{permissions:[],origins:[pattern]},policy.extension);',
    'return {ok:true,activeOrigins:policy.extension.activePermissions.origins};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join(''), [originPattern]), 'Firefox exact-origin removal')
  assert(result.ok === true, `Firefox exact-origin removal failed: ${String(result.error)}`)
  await setContext(client, 'content')
}

async function activateAndApprove(client: MarionetteClient, driverHandle: string, origin: string) {
  await switchWindow(client, driverHandle)
  const result = asRecord(await executeAsync(client, [
    'const input=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const tabs=await browser.tabs.query({});',
    'const tab=tabs.find(candidate=>candidate.url&&candidate.url.startsWith(`${input.origin}/`));',
    'if(!tab)throw new Error(`site tab missing: ${input.origin}`);',
    'await browser.tabs.update(tab.id,{active:true});',
    'await new Promise(resolve=>setTimeout(resolve,100));',
    'const send=async message=>(await browser.runtime.sendMessage(message)).result;',
    'const base={channel:"oneweb.page-toolbox.management",version:1};',
    'const prepared=await send({...base,type:"PAGE_TOOLBOX_PREPARE_CURRENT_SITE"});',
    'if(!prepared?.ok)throw new Error(`prepare failed: ${JSON.stringify(prepared)}`);',
    'const confirmed=await send({...base,type:"PAGE_TOOLBOX_CONFIRM_CURRENT_SITE",token:prepared.preparation.token});',
    'if(!confirmed?.ok)throw new Error(`confirm failed: ${JSON.stringify(confirmed)}`);',
    'return {prepared,confirmed};',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [{ origin }]), 'Firefox Page Toolbox approval')
  assert(result.ok === true, `Firefox Page Toolbox approval failed: ${String(result.error)}`)
  return asRecord(result.value, 'Firefox Page Toolbox approval value')
}

async function activateAndRunSidebarSave(client: MarionetteClient, driverHandle: string, origin: string, toolIds = ['free-page-edit', 'selection-copy-release'], enabled = true) {
  await showBuiltinTool(client, driverHandle, PAGE_TOOLBOX_ID, '[data-testid=page-toolbox-control]')
  const result = asRecord(await executeAsync(client, [
    'const input=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));',
    'const tabs=await browser.tabs.query({});',
    'const tab=tabs.find(candidate=>candidate.url&&candidate.url.startsWith(`${input.origin}/`));',
    'if(!tab)throw new Error("site tab missing");',
    'await browser.tabs.update(tab.id,{active:true});',
    'await delay(100);',
    'document.querySelector("[data-testid=page-toolbox-refresh]").click();',
    'for(let attempt=0;attempt<100;attempt++){',
    'const control=document.querySelector("[data-testid=page-toolbox-control]");',
    'if(control?.dataset.state==="ready")break;',
    'await delay(50);',
    '}',
    'const control=document.querySelector("[data-testid=page-toolbox-control]");',
    'if(control?.dataset.state!=="ready")throw new Error(`sidebar not ready: ${control?.dataset.state}`);',
    'for(const toolId of input.toolIds){',
    'const checkbox=document.querySelector(`[data-tool-id="${toolId}"] input[data-page-toolbox-enabled]`);',
    'if(!(checkbox instanceof HTMLInputElement))throw new Error(`checkbox missing: ${toolId}`);',
    'checkbox.checked=input.enabled;',
    'checkbox.dispatchEvent(new Event("change",{bubbles:true}));',
    '}',
    'document.querySelector("[data-testid=page-toolbox-save]").click();',
    'for(let attempt=0;attempt<100;attempt++){',
    'const stored=await browser.storage.local.get("oneweb.module-state.v1:dev.oneweb.page-toolbox");',
    'const enabled=stored["oneweb.module-state.v1:dev.oneweb.page-toolbox"]?.settings?.sites?.[input.origin]?.enabledToolIds||[];',
    'if(input.toolIds.every(id=>enabled.includes(id)===input.enabled))return enabled;',
    'await delay(50);',
    '}',
    'throw new Error("trusted sidebar save did not settle");',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [{ origin, toolIds, enabled }]), 'Firefox trusted sidebar save')
  assert(result.ok === true, `Firefox trusted sidebar save failed: ${String(result.error)}`)
  return result.value
}

async function toggleBuiltin(client: MarionetteClient, driverHandle: string, expected: boolean) {
  await showModuleManagement(client, driverHandle)
  await execute(client, [
    `const card=document.querySelector('[data-testid="module-card"][data-module-id="${PAGE_TOOLBOX_ID}"]');`,
    'const toggle=card?.querySelector("[data-testid=module-toggle]");',
    'if(!toggle)throw new Error("Page Toolbox toggle missing");',
    `if(toggle.getAttribute('aria-checked')!==${JSON.stringify(String(expected))})toggle.click();`,
    'return true;',
  ].join(''))
  await pollUntil(async () => {
    await switchWindow(client, driverHandle)
    return execute(client, `return document.querySelector('[data-testid="module-card"][data-module-id="${PAGE_TOOLBOX_ID}"] [data-testid="module-toggle"]')?.getAttribute('aria-checked')`)
  }, COMMAND_TIMEOUT_MS, `Page Toolbox enabled=${expected}`, value => value === String(expected))
}

async function toggleSendToOpenList(client: MarionetteClient, driverHandle: string, expected: boolean) {
  await showModuleManagement(client, driverHandle)
  await execute(client, [
    `const card=document.querySelector('[data-testid="module-card"][data-module-id="${SEND_TO_OPENLIST_ID}"]');`,
    'const toggle=card?.querySelector("[data-testid=module-toggle]");',
    'if(!toggle)throw new Error("Send to OpenList toggle missing");',
    `if(toggle.getAttribute('aria-checked')!==${JSON.stringify(String(expected))})toggle.click();`,
    'return true;',
  ].join(''))
  await pollUntil(async () => {
    await switchWindow(client, driverHandle)
    return execute(client, `return document.querySelector('[data-testid="module-card"][data-module-id="${SEND_TO_OPENLIST_ID}"] [data-testid="module-toggle"]')?.getAttribute('aria-checked')`)
  }, COMMAND_TIMEOUT_MS, `Send to OpenList enabled=${expected}`, value => value === String(expected))
}

async function runFirefoxScenario(
  client: MarionetteClient,
  extensionOrigin: string,
  alphaOrigin: string,
  betaOrigin: string,
  sendToken: string,
  sendRequests: { me: number, tools: number, add: number, undone: number, unauthorized: number },
  dubbingRequests: { translation: number, speech: number },
  clashRequests: FirefoxClashRequests,
  assistantRequests: FirefoxAssistantRequests,
) {
  await client.command('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } })
  const handles = await client.command('WebDriver:GetWindowHandles')
  assert(Array.isArray(handles) && typeof handles[0] === 'string', 'Firefox did not expose an initial tab')
  const alphaHandle = handles[0]
  await navigate(client, `${alphaOrigin}/toolbox`)
  const betaHandle = await newTab(client, `${betaOrigin}/toolbox`)
  const sidebarUrl = `${extensionOrigin}/sidebar.html`
  const driverHandle = await newTab(client, sidebarUrl)
  await waitForPage(client, 'document.readyState==="complete"&&document.querySelector("[data-testid=manage-modules]")', 'trusted Firefox sidebar page')

  await setContext(client, 'chrome')
  const actualSidebar = asRecord(await execute(client, [
    'const win=Services.wm.getMostRecentWindow("navigator:browser");',
    'const controller=win.SidebarController;',
    'const child=controller?.browser?.contentDocument?.querySelector("#webext-panels-browser");',
    'return {current:controller?.currentID||null,uri:child?.currentURI?.spec||null,remote:child?.isRemoteBrowser===true};',
  ].join('')), 'real Firefox sidebar')
  const nativeSidebarUrl = typeof actualSidebar.uri === 'string' ? new URL(actualSidebar.uri) : null
  const expectedSidebarUrl = new URL(sidebarUrl)
  assert(nativeSidebarUrl?.protocol === expectedSidebarUrl.protocol
    && nativeSidebarUrl.host === expectedSidebarUrl.host
    && nativeSidebarUrl.pathname === expectedSidebarUrl.pathname
    && nativeSidebarUrl.search === expectedSidebarUrl.search
    && actualSidebar.remote === true, `Firefox did not load the packaged OneWeb sidebar: ${JSON.stringify(actualSidebar)}`)
  assert(typeof actualSidebar.current === 'string' && actualSidebar.current.includes(EXTENSION_SIDEBAR_IDENTITY), 'Firefox sidebar identity is invalid')
  await setContext(client, 'content')
  await switchWindow(client, driverHandle)

  if (process.env.FIREFOX_SCENARIO === 'network') {
    await runNetworkManagementFirefoxScenario(client, driverHandle, alphaOrigin, clashRequests)
    process.stdout.write('Firefox network management targeted gate: 1/1 passed\n')
    return
  }

  // Capture isolation after the expected workspace navigation has persisted.
  await showBuiltinTool(client, driverHandle, PAGE_TOOLBOX_ID, '[data-testid=page-toolbox-control]')
  await showModuleManagement(client, driverHandle)
  await waitForPage(client, `document.querySelector('[data-testid="module-card"][data-module-id="${PAGE_TOOLBOX_ID}"]')`, 'Page Toolbox module card')

  const protectedIds = [
    'dev.juck.repolens',
    'dev.oneweb.bookmark-doctor',
    'dev.oneweb.clash-control',
  ]
  const baseline = asRecord(await executeAsync(client, [
    'const ids=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const sentinels=Object.fromEntries(ids.map((id,index)=>[`oneweb.module-state.v1:${id}`,{sentinel:id,index}]));',
    'await browser.storage.local.set(sentinels);',
    'return {permissions:await browser.permissions.getAll(),storage:await browser.storage.local.get(null)};',
    '})().then(done,error=>done({error:String(error)}));',
  ].join(''), [protectedIds]), 'Firefox isolation baseline')
  assert(!baseline.error, `Unable to capture Firefox isolation baseline: ${String(baseline.error)}`)

  await toggleBuiltin(client, driverHandle, true)
  await grantExactOrigin(client, `${alphaOrigin}/*`)
  const approval = await activateAndApprove(client, driverHandle, alphaOrigin)
  const confirmation = asRecord(approval.confirmed, 'Firefox Page Toolbox confirmation')
  assert(confirmation.injected === true, `Firefox Page Toolbox confirmation did not inject: ${JSON.stringify(approval)}`)
  await activateAndRunSidebarSave(client, driverHandle, alphaOrigin)

  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox Page Toolbox injection', value => value === 1)
  const closedControl = asRecord(await execute(client, [
    'const host=document.querySelector("[data-oneweb-page-toolbox-control]");',
    'return {closed:host?.shadowRoot===null,lightText:host?.textContent??null,tabIndex:host?.tabIndex};',
  ].join('')), 'Firefox closed Shadow control')
  assert(closedControl.closed === true && closedControl.lightText === '' && closedControl.tabIndex === 0, `Firefox Shadow control boundary is invalid: ${JSON.stringify(closedControl)}`)

  await execute(client, 'document.querySelector("[data-oneweb-page-toolbox-control]").focus();return true')
  await client.command('WebDriver:PerformActions', {
    actions: [{
      actions: [
        { type: 'keyDown', value: '\uE007' },
        { type: 'keyUp', value: '\uE007' },
        { type: 'keyDown', value: '\uE004' },
        { type: 'keyUp', value: '\uE004' },
        { type: 'keyDown', value: ' ' },
        { type: 'keyUp', value: ' ' },
      ],
      id: 'page-toolbox-keyboard',
      type: 'key',
    }],
  })
  await client.command('WebDriver:ReleaseActions')
  await pollUntil(async () => {
    const result = asRecord(await execute(client, [
      'const input=document.querySelector("#toolbox-password");',
      'input.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:2}));',
      'return {body:document.body.getAttribute("contenteditable"),password:input.getAttribute("type"),selection:[...document.querySelectorAll("style")].some(style=>style.textContent.includes("user-select:text"))};',
    ].join('')), 'Firefox Page Toolbox state')
    return result.body === 'true' && result.password === 'text' && result.selection === true
  }, COMMAND_TIMEOUT_MS, 'three Firefox Page Toolbox tools')
  await execute(client, 'document.querySelector("#toolbox-password").dispatchEvent(new MouseEvent("click",{bubbles:true,detail:2}));return true')

  await switchWindow(client, betaHandle)
  const betaState = asRecord(await execute(client, [
    'return {body:document.body.getAttribute("contenteditable"),password:document.querySelector("#toolbox-password").getAttribute("type"),control:document.querySelectorAll("[data-oneweb-page-toolbox-control]").length,selection:[...document.querySelectorAll("style")].some(style=>style.textContent.includes("user-select:text"))};',
  ].join('')), 'Firefox second-origin state')
  assert(betaState.body === 'false' && betaState.password === 'password' && betaState.control === 0 && betaState.selection === false, 'Firefox second origin was modified')

  await switchWindow(client, driverHandle)
  const reflected = asRecord(await executeAsync(client, [
    'const origin=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));',
    'const tabs=await browser.tabs.query({});const tab=tabs.find(candidate=>candidate.url?.startsWith(`${origin}/`));',
    'await browser.tabs.update(tab.id,{active:true});await delay(100);',
    'document.querySelector("[data-testid=page-toolbox-refresh]").click();',
    'for(let attempt=0;attempt<100;attempt++){',
    'const ids=[...document.querySelectorAll("[data-page-toolbox-enabled]:checked")].map(node=>node.closest("[data-tool-id]")?.dataset.toolId).filter(Boolean).sort();',
    'if(ids.length===3)return ids;await delay(50);',
    '}',
    'throw new Error("sidebar did not reflect Shadow update");',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [alphaOrigin]), 'Firefox sidebar reflection')
  assert(reflected.ok === true, `Firefox sidebar did not reflect Shadow update: ${String(reflected.error)}`)

  await switchWindow(client, alphaHandle)
  await execute(client, [
    'const fixture=document.createElement("section");fixture.id="seven-tools-fixture";',
    'fixture.innerHTML="<button id=\\"measure-a\\" style=\\"position:absolute;left:420px;top:160px;width:100px;height:80px\\">A</button><button id=\\"measure-b\\" style=\\"position:absolute;left:620px;top:320px;width:120px;height:60px\\">B</button><p id=\\"loaded-hidden\\" hidden>Loaded visual content</p><form><span id=\\"excluded-hidden\\" hidden>Form-only text</span></form><p id=\\"search-text\\">Firefox explicit query</p>";',
    'document.body.append(fixture);return true;',
  ].join(''))
  await activateAndRunSidebarSave(client, driverHandle, alphaOrigin, ['element-spacing', 'night-reading', 'hidden-content', 'selection-search'])
  // Free edit makes the body an editor; hidden-content must honor that exclusion first.
  await switchWindow(client, alphaHandle)
  assert(await execute(client, 'return document.querySelector("#loaded-hidden").hidden') === true, 'Hidden-content entered an active editor')
  await activateAndRunSidebarSave(client, driverHandle, alphaOrigin, ['free-page-edit', 'hidden-content'], false)
  await activateAndRunSidebarSave(client, driverHandle, alphaOrigin, ['hidden-content'])
  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, [
    'const dimmer=document.querySelector("[data-oneweb-page-toolbox-widget=night-reading]");',
    'return document.querySelector("#loaded-hidden").hidden===false&&document.querySelector("#excluded-hidden").hidden===true',
    '&&dimmer?.style.pointerEvents==="none"&&dimmer?.style.backgroundColor==="rgba(8, 12, 20, 0.12)"',
    '&&document.querySelectorAll("[data-oneweb-page-toolbox-widget]").length===3;',
  ].join('')), COMMAND_TIMEOUT_MS, 'Firefox four rewritten tools')
  for (const selector of ['#measure-a', '#measure-b']) {
    await execute(client, 'document.querySelector(arguments[0]).focus();return true', [selector])
    await client.command('WebDriver:PerformActions', { actions: [{ id: 'measure-keys', type: 'key', actions: [
      { type: 'keyDown', value: '\uE00A' },
      { type: 'keyDown', value: '\uE008' },
      { type: 'keyDown', value: 'm' },
      { type: 'keyUp', value: 'm' },
      { type: 'keyUp', value: '\uE008' },
      { type: 'keyUp', value: '\uE00A' },
    ] }] })
    await client.command('WebDriver:ReleaseActions')
  }
  await execute(client, [
    'const range=document.createRange();range.selectNodeContents(document.querySelector("#search-text"));',
    'const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);',
    'return true;',
  ].join(''))
  await activateAndRunSidebarSave(client, driverHandle, alphaOrigin, ['free-page-edit'])
  await switchWindow(client, alphaHandle)
  const screenshot = unwrapValue(await client.command('WebDriver:TakeScreenshot', { full: false }))
  assert(typeof screenshot === 'string', 'Firefox seven-tool screenshot was unavailable')
  const evidenceDirectory = path.resolve(process.env.ONEWEB_TEST_OUTPUT_DIR || 'artifacts/test-results/firefox-toolbox')
  await fs.ensureDir(evidenceDirectory)
  await fs.writeFile(path.join(evidenceDirectory, 'seven-tools.png'), Buffer.from(screenshot, 'base64'))

  await toggleBuiltin(client, driverHandle, false)
  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox disable cleanup', value => value === 0)
  const disabledState = asRecord(await execute(client, 'return {body:document.body.getAttribute("contenteditable"),password:document.querySelector("#toolbox-password").getAttribute("type"),selection:[...document.querySelectorAll("style")].some(style=>style.textContent.includes("user-select:text"))}'), 'Firefox disabled state')
  assert(disabledState.body === 'false' && disabledState.password === 'password' && disabledState.selection === false, 'Firefox disable did not clean Page Toolbox resources')
  const additionalDisabled = asRecord(await execute(client, 'return {widgets:document.querySelectorAll("[data-oneweb-page-toolbox-widget]").length,hidden:document.querySelector("#loaded-hidden").hidden,excluded:document.querySelector("#excluded-hidden").hidden}'), 'Firefox additional-tool cleanup')
  assert(additionalDisabled.widgets === 0 && additionalDisabled.hidden === true && additionalDisabled.excluded === true, 'Firefox additional tools did not restore owned DOM')

  await toggleBuiltin(client, driverHandle, true)
  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox re-enable injection', value => value === 1)
  await switchWindow(client, driverHandle)
  const revoked = asRecord(await executeAsync(client, [
    'const origin=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const tabs=await browser.tabs.query({});const tab=tabs.find(candidate=>candidate.url?.startsWith(`${origin}/`));',
    'await browser.tabs.update(tab.id,{active:true});await new Promise(resolve=>setTimeout(resolve,100));',
    'return (await browser.runtime.sendMessage({channel:"oneweb.page-toolbox.management",version:1,type:"PAGE_TOOLBOX_REVOKE_CURRENT_SITE"})).result;',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [alphaOrigin]), 'Firefox Page Toolbox revoke')
  assert(revoked.ok === true && asRecord(revoked.value, 'Firefox revoke result').ok === true, `Firefox revoke failed: ${String(revoked.error)}`)
  await switchWindow(client, alphaHandle)
  await pollUntil(() => execute(client, 'return document.querySelectorAll("[data-oneweb-page-toolbox-control]").length'), COMMAND_TIMEOUT_MS, 'Firefox revoke cleanup', value => value === 0)

  await toggleBuiltin(client, driverHandle, false)
  const finalState = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'Promise.all([browser.permissions.getAll(),browser.storage.local.get(null)]).then(([permissions,storage])=>done({permissions,storage}),error=>done({error:String(error)}));',
  ].join('')), 'Firefox isolation final state')
  assert(!finalState.error, `Unable to capture final Firefox state: ${String(finalState.error)}`)

  const normalize = (snapshot: JsonRecord) => {
    const clone = structuredClone(snapshot)
    const storage = asRecord(clone.storage, 'Firefox storage snapshot')
    const records = Array.isArray(storage['oneweb.modules.v1']) ? storage['oneweb.modules.v1'] as JsonRecord[] : []
    const unrelatedRecords = records.filter(record => (record.manifest as JsonRecord | undefined)?.id !== PAGE_TOOLBOX_ID)
    delete storage['oneweb.modules.v1']
    delete storage[`oneweb.module-state.v1:${PAGE_TOOLBOX_ID}`]
    return { permissions: clone.permissions, storage, unrelatedRecords }
  }
  assert(JSON.stringify(normalize(finalState)) === JSON.stringify(normalize(baseline)), 'Firefox Page Toolbox changed unrelated permissions, Registry records or module state')

  if (process.env.FIREFOX_SCENARIO === 'toolbox') {
    process.stdout.write('Firefox seven-tool lifecycle, trusted sidebar, keyboard, two-origin isolation and cleanup: passed\n')
    return
  }

  await switchWindow(client, driverHandle)
  const sendProtectedBefore = await executeAsync(client, [
    'const ids=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{const records=(await browser.storage.local.get("oneweb.modules.v1"))["oneweb.modules.v1"]||[];',
    'return Object.fromEntries(ids.map(id=>[id,records.find(record=>record.manifest?.id===id)||null]));',
    '})().then(done,error=>done({error:String(error)}));',
  ].join(''), [protectedIds])
  await toggleSendToOpenList(client, driverHandle, true)
  await grantExactOrigin(client, `${alphaOrigin}/*`)
  await switchWindow(client, driverHandle)
  const sendResult = asRecord(await executeAsync(client, [
    'const input=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const send=async message=>(await browser.runtime.sendMessage(message)).result;',
    'const base={channel:"oneweb.send-to-openlist",version:1};',
    'const profile={schemaVersion:1,id:"firefox",label:"Firefox fixture",controllerOrigin:input.origin};',
    'const prepared=await send({...base,type:"SEND_TO_OPENLIST_PREPARE",profile});',
    'if(!prepared?.ok)throw new Error(`prepare failed: ${JSON.stringify(prepared)}`);',
    'const connected=await send({...base,type:"SEND_TO_OPENLIST_CONNECT",preparation:prepared.value,token:input.token});',
    'if(!connected?.ok)throw new Error(`connect failed: ${JSON.stringify(connected)}`);',
    'const tools=await send({...base,type:"SEND_TO_OPENLIST_DISCOVER_TOOLS",destinationPath:"/firefox"});',
    'const url="https://cdn.example/firefox-resource?sig=a%2Bb";let hash=0xCBF29CE484222325n;',
    'for(let index=0;index<url.length;index++){hash^=BigInt(url.charCodeAt(index));hash=BigInt.asUintN(64,hash*0x100000001B3n)}',
    'const candidate={schemaVersion:1,id:`resource-${hash.toString(16).padStart(16,"0")}`,url,kind:"https",source:"manual"};',
    'const submitted=await send({...base,type:"SEND_TO_OPENLIST_SUBMIT",candidates:[candidate],destinationPath:"/firefox",tool:tools.value[0]});',
    'const tasks=await send({...base,type:"SEND_TO_OPENLIST_LIST_TASKS",list:"undone"});',
    'const tabs=await browser.tabs.query({});const tab=tabs.find(candidate=>candidate.url?.startsWith(`${input.origin}/`));',
    'if(!tab)throw new Error("Firefox resource page missing");await browser.tabs.update(tab.id,{active:true});',
    'const scanned=await send({...base,type:"SEND_TO_OPENLIST_SCAN_CURRENT_PAGE"});',
    'const storage=await browser.storage.local.get(null);',
    'const secretKeys=Object.entries(storage).filter(([,value])=>JSON.stringify(value).includes(input.token)).map(([key])=>key);',
    'const disconnected=await send({...base,type:"SEND_TO_OPENLIST_DISCONNECT"});',
    'const after=await browser.storage.local.get(null);',
    'return {connected,tools,submitted,tasks,scanned,secretKeys,secretRemains:JSON.stringify(after).includes(input.token),disconnected};',
    '})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));',
  ].join(''), [{ origin: alphaOrigin, token: sendToken }]), 'Firefox Send to OpenList gate')
  assert(sendResult.ok === true, `Firefox Send to OpenList failed: ${String(sendResult.error)}`)
  const sendValue = asRecord(sendResult.value, 'Firefox Send to OpenList result')
  assert((sendValue.connected as JsonRecord)?.ok === true, 'Firefox Send to OpenList did not connect')
  assert((sendValue.tools as JsonRecord)?.ok === true, 'Firefox Send to OpenList did not discover tools')
  assert((sendValue.submitted as JsonRecord)?.ok === true, 'Firefox Send to OpenList did not submit one resource')
  assert((sendValue.tasks as JsonRecord)?.ok === true, 'Firefox Send to OpenList did not list tasks')
  assert((sendValue.scanned as JsonRecord)?.ok === true, 'Firefox Send to OpenList did not scan the top frame')
  assert(JSON.stringify(sendValue.scanned).includes('https://cdn.example/firefox?sig=a%2Bb'), 'Firefox scan lost the signed URL')
  assert(JSON.stringify(sendValue.secretKeys) === JSON.stringify(['oneweb.send-to-openlist.secret.v1.firefox']), 'Firefox token escaped its dedicated record')
  assert(sendValue.secretRemains === false, 'Firefox disconnect retained the token')
  await toggleSendToOpenList(client, driverHandle, false)
  await removeExactOrigin(client, `${alphaOrigin}/*`)
  await switchWindow(client, driverHandle)
  const sendProtectedAfter = await executeAsync(client, [
    'const ids=arguments[0],done=arguments[arguments.length-1];',
    '(async()=>{const records=(await browser.storage.local.get("oneweb.modules.v1"))["oneweb.modules.v1"]||[];',
    'return Object.fromEntries(ids.map(id=>[id,records.find(record=>record.manifest?.id===id)||null]));',
    '})().then(done,error=>done({error:String(error)}));',
  ].join(''), [protectedIds])
  assert(JSON.stringify(sendProtectedAfter) === JSON.stringify(sendProtectedBefore), 'Firefox Send to OpenList changed protected module records')
  assert(sendRequests.me === 1 && sendRequests.tools === 1 && sendRequests.add === 1 && sendRequests.undone === 1 && sendRequests.unauthorized === 0, `Firefox fixed connector requests are invalid: ${JSON.stringify(sendRequests)}`)
  await runVideoDubbingFirefoxScenario(client, driverHandle, alphaOrigin, dubbingRequests)
  await runCookieManagerFirefoxScenario(client, driverHandle)
  const assistantDriver: FirefoxSmartAppsDriver = {
    execute: (script, args) => execute(client, script, args),
    executeAsync: (script, args) => executeAsync(client, script, args),
    switchWindow: handle => switchWindow(client, handle),
    newTab: url => newTab(client, url),
    wait: async (predicate, label) => { await waitForPage(client, predicate, label) },
    clickSurface: async (label) => {
      const found = asRecord(await execute(client, `
        const root=document.querySelector("[data-oneweb-assistant]")?.shadowRoot;
        return [...root.querySelectorAll("button")].find(button=>button.getAttribute("aria-label")===arguments[0]||button.textContent===arguments[0]);
      `, [label]), 'Firefox assistant native click target')
      const id = found['element-6066-11e4-a52e-4f735466cecf']
      assert(typeof id === 'string', `Firefox assistant button missing: ${label}`)
      await client.command('WebDriver:ElementClick', { id })
    },
    grant: pattern => grantExactOrigin(client, pattern),
    revoke: pattern => removeExactOrigin(client, pattern),
    click: selector => clickElement(client, selector),
    switchFrame: async (id) => { await client.command('WebDriver:SwitchToFrame', { id }) },
  }
  await runFirefoxAssistantScenario(assistantDriver, driverHandle, alphaOrigin, assistantRequests)
  await runFirefoxSmartAppsScenario(assistantDriver, driverHandle, alphaOrigin)
  await runNetworkManagementFirefoxScenario(client, driverHandle, alphaOrigin, clashRequests)
  process.stdout.write('Firefox packaged-builtin gates: 5/5 passed (Page Toolbox + Send to OpenList + Video Dubbing real media + Cookie Manager CRUD/partition/JSON/revocation/isolation + Network Management WebRTC/Clash)\n')
}

async function clickElement(client: MarionetteClient, selector: string) {
  const found = asRecord(unwrapValue(await client.command('WebDriver:FindElement', {
    using: 'css selector',
    value: selector,
  })), 'Firefox click target')
  const id = found['element-6066-11e4-a52e-4f735466cecf']
  assert(typeof id === 'string', `Firefox click target missing: ${selector}`)
  await client.command('WebDriver:ElementClick', { id })
}

async function dubbingCommand(client: MarionetteClient, driverHandle: string, origin: string, command: string, data: unknown = {}) {
  await switchWindow(client, driverHandle)
  const result = asRecord(await executeAsync(client, `
    const input=arguments[0], done=arguments[arguments.length-1];
    (async()=>{
      const tab=(await browser.tabs.query({})).find(tab=>tab.url===input.origin+"/dubbing-video");
      if(!tab)throw new Error("Firefox dubbing video tab missing");
      await browser.tabs.update(tab.id,{active:true});
      const reply=await browser.runtime.sendMessage({
        channel:"oneweb.video-dubbing.management.v1",command:input.command,data:input.data,
      });
      if(!reply?.ok)throw new Error(reply?.error||"No dubbing reply");
      return reply.value;
    })().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));
  `, [{ origin, command, data }]), 'Firefox dubbing command')
  assert(result.ok === true, `Firefox dubbing ${command} failed: ${String(result.error)}`)
  return asRecord(result.value, 'Firefox dubbing status')
}

async function runVideoDubbingFirefoxScenario(
  client: MarionetteClient,
  driverHandle: string,
  origin: string,
  requests: { translation: number, speech: number },
) {
  const videoHandle = await newTab(client, `${origin}/dubbing-video`)
  await waitForPage(client, 'document.querySelector("video")?.readyState>=3', 'Firefox real dubbing video')
  await execute(client, 'const video=document.querySelector("video");video.volume=.65;video.muted=true;return true')
  await showModuleManagement(client, driverHandle)
  await execute(client, `document.querySelector('[data-module-id="${VIDEO_DUBBING_ID}"] [data-testid="module-toggle"]').click();return true`)
  await waitForPage(client, `document.querySelector('[data-module-id="${VIDEO_DUBBING_ID}"] [data-testid="module-toggle"]')?.getAttribute("aria-checked")==="true"`, 'Firefox dubbing module enabled')
  await showBuiltinTool(client, driverHandle, VIDEO_DUBBING_ID, '[data-testid=video-dubbing]')
  // Exact fixture-origin grant applies only inside this isolated temporary profile.
  await grantExactOrigin(client, `${origin}/*`)
  await dubbingCommand(client, driverHandle, origin, 'save', {
    config: {
      translation: { baseUrl: `${origin}/dub/v1/`, key: 'TEST-T', model: 'fixture' },
      speech: { baseUrl: `${origin}/dub/v1/`, key: 'TEST-S', model: 'fixture', voice: 'fixture' },
    },
  })
  await dubbingCommand(client, driverHandle, origin, 'open')
  await switchWindow(client, videoHandle)
  await waitForPage(client, 'document.querySelector("#oneweb-video-dubbing")', 'Firefox production dubbing overlay')
  await dubbingCommand(client, driverHandle, origin, 'start', {
    language: 'zh-CN',
    subtitles: '1\n00:00:00,000 --> 00:00:02,000\nFirst Firefox cue\n\n2\n00:00:08,000 --> 00:00:12,000\nLater Firefox cue',
  })
  await switchWindow(client, videoHandle)
  await waitForPage(client, 'document.querySelector("#oneweb-video-dubbing")?.textContent.includes("已暂停")', 'Firefox paused first-cue preparation')
  // A real WebDriver click supplies user activation; audio.play is never mocked.
  await clickElement(client, '#oneweb-video-dubbing button:first-of-type')
  await waitForPage(client, 'document.querySelector("audio[data-oneweb-dub-audio]")?.currentTime>.1', 'Firefox decoded audio time advancement')
  const firstAudio = asRecord(await execute(client, 'const a=document.querySelector("audio");return {duration:a.duration,time:a.currentTime,paused:a.paused,error:a.error?.code||null}'), 'Firefox real audio playback')
  assert(firstAudio.paused === false && firstAudio.error === null && firstAudio.duration === 3, `Firefox real audio did not play: ${JSON.stringify(firstAudio)}`)
  await clickElement(client, '#oneweb-video-dubbing button:nth-of-type(2)')
  await waitForPage(client, 'document.querySelector("video").paused&&document.querySelector("audio").paused', 'Firefox pause synchronization')
  await clickElement(client, '#oneweb-video-dubbing button:first-of-type')
  await execute(client, 'const video=document.querySelector("video");video.currentTime=8.5;video.playbackRate=1.5;return true')
  await waitForPage(client, 'document.querySelector("#oneweb-video-dubbing")?.textContent.includes("Firefox translated cue-2")&&document.querySelector("audio").currentTime>.3', 'Firefox seek to later cue')
  const rate = await execute(client, 'return document.querySelector("audio").playbackRate')
  assert(rate === 1.5, `Firefox dub speed did not follow video: ${String(rate)}`)
  await dubbingCommand(client, driverHandle, origin, 'volumes', { originalVolume: 0.1, dubVolume: 0.5 })
  await switchWindow(client, videoHandle)
  await waitForPage(client, 'document.querySelector("video").volume===.1&&document.querySelector("audio").volume===.5', 'Firefox independent volumes')
  await clickElement(client, '#oneweb-video-dubbing button:nth-of-type(3)')
  await waitForPage(client, 'document.querySelector("#oneweb-video-dubbing")?.textContent.includes("未启动")&&!document.querySelector("audio").hasAttribute("src")', 'Firefox stop clears audio')
  const restored = await execute(client, 'const v=document.querySelector("video");return {volume:v.volume,muted:v.muted,rate:v.playbackRate}')
  assert(JSON.stringify(restored) === JSON.stringify({ volume: 0.65, muted: true, rate: 1.5 }), `Firefox stop did not restore media: ${JSON.stringify(restored)}`)
  await dubbingCommand(client, driverHandle, origin, 'revoke')
  await switchWindow(client, videoHandle)
  await waitForPage(client, '!document.querySelector("#oneweb-video-dubbing")&&!document.querySelector("audio[data-oneweb-dub-audio]")', 'Firefox revocation cleanup')
  const callsAfterStop = requests.translation + requests.speech
  await delay(500)
  assert(requests.translation + requests.speech === callsAfterStop, 'Firefox emitted service calls after stop/revocation')
  assert(requests.translation > 0 && requests.speech === 2, `Firefox fixture call budget failed: ${JSON.stringify(requests)}`)
  await grantExactOrigin(client, `${origin}/*`)
  await dubbingCommand(client, driverHandle, origin, 'delete')
  await removeExactOrigin(client, `${origin}/*`)
  await showModuleManagement(client, driverHandle)
  await execute(client, `document.querySelector('[data-module-id="${VIDEO_DUBBING_ID}"] [data-testid="module-toggle"]').click();return true`)
  process.stdout.write(`Firefox dubbing: real WAV decoded/played, pause/resume, seek/rate, volumes, stop/revoke cleanup; fixture requests ${JSON.stringify(requests)}\n`)
}

async function runCookieManagerFirefoxScenario(client: MarionetteClient, driverHandle: string) {
  await showModuleManagement(client, driverHandle)
  await execute(client, 'document.querySelector(\'[data-module-id="dev.oneweb.cookie-manager"] [data-testid="module-toggle"]\').click();return true')
  await pollUntil(() => execute(client, 'return document.querySelector(\'[data-module-id="dev.oneweb.cookie-manager"] [data-testid="module-toggle"]\')?.getAttribute("aria-checked")'), COMMAND_TIMEOUT_MS, 'Firefox Cookie module enabled', value => value === 'true')
  await showBuiltinTool(client, driverHandle, 'dev.oneweb.cookie-manager', '[data-testid=cookie-manager]')
  await waitForPage(client, 'document.querySelector("[data-testid=cookie-manager]")', 'Firefox Cookie Manager entry')
  // Test-only permission bootstrap in the isolated temporary Firefox profile.
  await setContext(client, 'chrome')
  const grant = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");',
    `const policy=WebExtensionPolicy.getByID(${JSON.stringify(EXTENSION_ID)});`,
    'await ExtensionPermissions.add(policy.id,{permissions:["cookies"],origins:["http://*/*","https://*/*"]},policy.extension);',
    'return {ok:true};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join('')), 'Firefox Cookie permission bootstrap')
  assert(grant.ok === true, 'Firefox Cookie permission bootstrap failed')
  await setContext(client, 'content')
  const result = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>{',
    'const check=(condition,label)=>{if(!condition)throw new Error(label);};',
    'const baseline=JSON.stringify(await browser.storage.local.get(null));',
    'const send=async(type,fields={})=>{const response=await browser.runtime.sendMessage({channel:"oneweb.cookie-manager",version:1,type,...fields});return response?.result;};',
    'await browser.cookies.set({url:"https://cookie.example/",name:"firefox-session",value:"synthetic-firefox-cookie",secure:true,httpOnly:true,sameSite:"lax"});',
    'await browser.cookies.set({url:"https://cookie.example/",name:"firefox-partition",value:"synthetic-partition-cookie",secure:true,sameSite:"no_restriction",partitionKey:{topLevelSite:"https://top.example"}});',
    'await browser.cookies.set({url:"http://http.cookie.example/",name:"firefox-http-partition",value:"synthetic-http-partition-cookie",secure:false,sameSite:"lax",partitionKey:{topLevelSite:"https://top.example"}});',
    'const preparation=await send("prepare",{scope:"all"});check(preparation?.ok,"prepare");',
    'let opened=await send("open",{token:preparation.value.token});check(opened?.ok,"open");',
    'let snapshot=opened.value;',
    'const session=snapshot.entries.find(entry=>entry.cookie.name==="firefox-session");',
    'const partition=snapshot.entries.find(entry=>entry.cookie.name==="firefox-partition");',
    'const httpPartition=snapshot.entries.find(entry=>entry.cookie.name==="firefox-http-partition");check(httpPartition?.cookie.secure===false&&httpPartition.cookie.partitionKey?.topLevelSite==="https://top.example","Firefox HTTP partition");',
    'check(session?.cookie.httpOnly&&session.cookie.storeId==="firefox-default","HttpOnly/store");',
    'check(partition?.cookie.partitionKey?.topLevelSite==="https://top.example","partition identity");',
    'const edited=await send("save",{snapshotId:snapshot.id,entryId:session.id,cookie:{...session.cookie,value:"edited-firefox-cookie"}});check(edited?.ok,`edit: ${JSON.stringify(edited)}`);',
    'opened=await send("refresh",{snapshotId:snapshot.id});check(opened?.ok,"refresh");snapshot=opened.value;',
    'const entry=snapshot.entries.find(item=>item.cookie.name==="firefox-session");',
    'const exported=await send("export",{snapshotId:snapshot.id,entryIds:[entry.id]});check(exported?.ok,"export");',
    'check(JSON.parse(exported.value)[0].value==="edited-firefox-cookie","export content");',
    'const removed=await send("delete",{snapshotId:snapshot.id,entryIds:[entry.id]});check(removed?.ok&&removed.value[0].ok,"delete");',
    'check(!await browser.cookies.get({url:"https://cookie.example/",name:"firefox-session"}),"browser deletion");',
    'opened=await send("refresh",{snapshotId:snapshot.id});check(opened?.ok,"refresh after delete");snapshot=opened.value;',
    'const preview=await send("preview",{snapshotId:snapshot.id,text:exported.value,storeId:session.cookie.storeId});check(preview?.ok,"preview");',
    'check(!await browser.cookies.get({url:"https://cookie.example/",name:"firefox-session"}),"preview zero writes");',
    'const imported=await send("import",{snapshotId:snapshot.id,previewId:preview.value.id,entryIds:[preview.value.entries[0].id]});check(imported?.ok&&imported.value[0].ok,"import");',
    'check((await browser.cookies.get({url:"https://cookie.example/",name:"firefox-session"}))?.value==="edited-firefox-cookie","JSON round trip");',
    'opened=await send("refresh",{snapshotId:snapshot.id});check(opened?.ok,"partition refresh");snapshot=opened.value;',
    'const partitionEntry=snapshot.entries.find(item=>item.cookie.name==="firefox-partition");',
    'const partitionRemoved=await send("delete",{snapshotId:snapshot.id,entryIds:[partitionEntry.id]});check(partitionRemoved?.ok&&partitionRemoved.value[0].ok,`partition delete: ${JSON.stringify(partitionRemoved)}`);',
    'check((await browser.cookies.get({url:"https://cookie.example/",name:"firefox-session"}))?.value==="edited-firefox-cookie","peer isolation");',
    'check(JSON.stringify(await browser.storage.local.get(null))===baseline,"storage isolation");',
    'await browser.permissions.remove({permissions:["cookies"]});',
    'const revoked=await send("export",{snapshotId:snapshot.id,entryIds:[partitionEntry.id]});',
    'check(revoked?.ok===false&&["permission-required","lifecycle-cancelled"].includes(revoked.reason),"revocation");',
    'return {ok:true};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join('')), 'Firefox Cookie Manager public-protocol gate')
  assert(result.ok === true, `Firefox Cookie Manager failed: ${String(result.error)}`)
}

async function networkFixtureState(client: MarionetteClient, expected: JsonRecord) {
  await waitForPage(client, 'document.documentElement.dataset.network&&document.querySelector("#network-http")?.contentDocument?.documentElement?.dataset.network&&document.querySelector("#network-srcdoc")?.contentDocument?.documentElement?.dataset.network', 'Firefox first-script WebRTC snapshots')
  const observed = asRecord(await execute(client, [
    'const read=doc=>JSON.parse(doc.documentElement.dataset.network);',
    'return {main:read(document),http:read(document.querySelector("#network-http").contentDocument),srcdoc:read(document.querySelector("#network-srcdoc").contentDocument)};',
  ].join('')), 'Firefox WebRTC page snapshots')
  for (const frame of ['main', 'http', 'srcdoc']) {
    const snapshot = asRecord(observed[frame], `Firefox ${frame} first-script snapshot`)
    assert(Object.entries(expected).every(([key, value]) => snapshot[key] === value), `Firefox ${frame} first-script WebRTC mismatch: ${JSON.stringify(snapshot)}; expected ${JSON.stringify(expected)}`)
  }
}

async function runNetworkManagementFirefoxScenario(client: MarionetteClient, driverHandle: string, origin: string, clashRequests: FirefoxClashRequests) {
  await showModuleManagement(client, driverHandle)
  await execute(client, [
    `const toggle=document.querySelector('[data-module-id="${NETWORK_MANAGEMENT_ID}"] [data-testid="module-toggle"]');`,
    'if(toggle?.getAttribute("aria-checked")!=="true")toggle?.click();return true;',
  ].join(''))
  await waitForPage(client, `document.querySelector('[data-module-id="${NETWORK_MANAGEMENT_ID}"] [data-testid="module-toggle"]')?.getAttribute("aria-checked")==="true"`, 'Firefox network module enabled')
  await showBuiltinTool(client, driverHandle, NETWORK_MANAGEMENT_ID, '[data-testid=network-management]')
  const driverUrl = await execute(client, 'return location.href')
  assert(typeof driverUrl === 'string', 'Firefox network driver URL is unavailable')
  const peerRecords = await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'browser.storage.local.get("oneweb.modules.v1").then(stored=>done(JSON.stringify((stored["oneweb.modules.v1"]||[]).filter(record=>record.manifest.id!=="dev.oneweb.clash-control"))),error=>done({error:String(error)}));',
  ].join(''))
  const scope = await execute(client, 'return document.querySelector("[data-testid=network-scope]")?.textContent')
  assert(typeof scope === 'string' && scope.includes('普通窗口') && scope.includes('隐私窗口'), 'Firefox does not explain its native WebRTC policy scope')

  // Policy-only protection needs no page access. Grant optional permissions only
  // inside the web-ext-owned temporary profile; the production manifest stays optional.
  await setContext(client, 'chrome')
  const grant = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");',
    `const policy=WebExtensionPolicy.getByID(${JSON.stringify(EXTENSION_ID)});`,
    'if(!policy?.extension)throw new Error("temporary OneWeb policy missing");',
    'await ExtensionPermissions.remove(policy.id,{permissions:[],origins:["http://*/*","https://*/*"]},policy.extension);',
    'await ExtensionPermissions.add(policy.id,{permissions:["privacy"],origins:[]},policy.extension);',
    'return {ok:true};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join('')), 'Firefox network privacy-only bootstrap')
  assert(grant.ok === true, `Firefox network permission bootstrap failed: ${String(grant.error)}`)
  await setContext(client, 'content')
  await waitForPage(client, 'typeof browser.privacy?.network?.webRTCIPHandlingPolicy?.get==="function"', 'Firefox privacy namespace')
  await pollUntil(() => executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'browser.permissions.contains({permissions:["privacy"]}).then(done,error=>done(false));',
  ].join('')), COMMAND_TIMEOUT_MS, 'Firefox privacy-only permission active')
  const before = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>({policy:await browser.privacy.network.webRTCIPHandlingPolicy.get({}),',
    'hosts:await browser.permissions.contains({origins:["http://*/*","https://*/*"]}),',
    'scripts:await browser.scripting.getRegisteredContentScripts({ids:["oneweb-network-support","oneweb-network-devices","oneweb-network-additional"]})}))()',
    '.then(done,error=>done({error:String(error)}));',
  ].join('')), 'Firefox network baseline')
  assert(!before.error && before.hosts === false, `Firefox network baseline is not privacy-only: ${JSON.stringify(before)}`)
  assert(Array.isArray(before.scripts) && before.scripts.length === 0, 'Firefox network baseline has unexpected page registrations')
  assert(asRecord(before.policy, 'Firefox network baseline policy').levelOfControl !== 'controlled_by_this_extension', 'Firefox network baseline already owns the policy')

  if (await execute(client, 'return document.querySelector("[data-testid=network-block-support]")?.checked'))
    await clickElement(client, '[data-testid=network-block-support]')
  await clickElement(client, '[data-testid=network-apply]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox WebRTC apply completed')
  const feedback = await execute(client, 'return document.querySelector("[data-testid=network-message]")?.textContent')
  assert(typeof feedback === 'string' && feedback.includes('设置已应用'), `Firefox must apply WebRTC protection; received: ${String(feedback)}`)
  const after = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>({policy:await browser.privacy.network.webRTCIPHandlingPolicy.get({}),',
    'privatePolicy:await browser.privacy.network.webRTCIPHandlingPolicy.get({incognito:true}),',
    'hosts:await browser.permissions.contains({origins:["http://*/*","https://*/*"]}),',
    'scripts:await browser.scripting.getRegisteredContentScripts({ids:["oneweb-network-support","oneweb-network-devices","oneweb-network-additional"]}),',
    'status:(await browser.runtime.sendMessage({channel:"oneweb.network-management",version:1,type:"status"}))?.result,',
    'clashPresent:Boolean(document.querySelector("[data-testid=clash-prepare]"))}))()',
    '.then(done,error=>done({error:String(error)}));',
  ].join('')), 'Firefox active network result')
  assert(!after.error, `Firefox network result failed: ${String(after.error)}`)
  const actualPolicy = asRecord(after.policy, 'Firefox active policy')
  assert(actualPolicy.value === 'disable_non_proxied_udp' && actualPolicy.levelOfControl === 'controlled_by_this_extension', `Firefox WebRTC policy did not take effect: ${JSON.stringify(actualPolicy)}`)
  assert(asRecord(after.privatePolicy, 'Firefox active private policy').value === 'disable_non_proxied_udp', 'Firefox private policy did not share the documented native setting')
  assert(Array.isArray(after.scripts) && after.scripts.length === 0, 'Firefox policy-only protection registered page scripts')
  assert(after.hosts === false, 'Firefox policy-only protection acquired page access')
  const result = asRecord(after.status, 'Firefox network status')
  const status = asRecord(result.value, 'Firefox network status value')
  assert(result.ok === true && status.protected === true && status.scriptsActive === false, 'Firefox policy-only protection status is incorrect')
  assert(after.clashPresent === true, 'Firefox network manager lost the existing Clash workflow')
  await clickElement(client, '[data-testid=network-disable]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox WebRTC protection disabled')
  const restored = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'browser.privacy.network.webRTCIPHandlingPolicy.get({}).then(done,error=>done({error:String(error)}));',
  ].join('')), 'Firefox restored policy')
  assert(JSON.stringify(restored) === JSON.stringify(before.policy), `Firefox disable did not restore the baseline policy: ${JSON.stringify(restored)}`)
  for (const policy of ['default_public_and_private_interfaces', 'default_public_interface_only']) {
    await execute(client, 'document.querySelector("[data-testid=network-policy]").value=arguments[0];return true;', [policy])
    await clickElement(client, '[data-testid=network-apply]')
    await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', `Firefox ${policy} apply completed`)
    const observed = asRecord(await executeAsync(client, [
      'const done=arguments[arguments.length-1];',
      'browser.privacy.network.webRTCIPHandlingPolicy.get({}).then(done,error=>done({error:String(error)}));',
    ].join('')), `Firefox ${policy} readback`)
    assert(observed.value === policy && observed.levelOfControl === 'controlled_by_this_extension', `Firefox policy ${policy} did not take effect: ${JSON.stringify(observed)}`)
    const privatePolicy = asRecord(await executeAsync(client, [
      'const done=arguments[arguments.length-1];',
      'browser.privacy.network.webRTCIPHandlingPolicy.get({incognito:true}).then(done,error=>done({error:String(error)}));',
    ].join('')), `Firefox ${policy} private readback`)
    assert(privatePolicy.value === policy, `Firefox private value differs from its documented global policy: ${JSON.stringify(privatePolicy)}`)
  }
  await execute(client, 'document.querySelector("[data-testid=network-policy]").value="default";return true;')
  await clickElement(client, '[data-testid=network-apply]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox default policy released control')
  const defaultResult = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>({policy:await browser.privacy.network.webRTCIPHandlingPolicy.get({}),',
    'status:(await browser.runtime.sendMessage({channel:"oneweb.network-management",version:1,type:"status"}))?.result}))()',
    '.then(done,error=>done({error:String(error)}));',
  ].join('')), 'Firefox default policy result')
  assert(JSON.stringify(defaultResult.policy) === JSON.stringify(before.policy), 'Firefox default option did not release the native policy override')
  const defaultStatus = asRecord(asRecord(defaultResult.status, 'Firefox default result').value, 'Firefox default status')
  assert(defaultStatus.protected === false && asRecord(defaultStatus.settings, 'Firefox default settings').enabled === false, 'Firefox default option still reports active protection')

  await setContext(client, 'chrome')
  const pageGrant = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");',
    `const policy=WebExtensionPolicy.getByID(${JSON.stringify(EXTENSION_ID)});`,
    'await ExtensionPermissions.add(policy.id,{permissions:[],origins:["http://*/*","https://*/*"]},policy.extension);',
    'return {ok:true};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join('')), 'Firefox network page permission bootstrap')
  assert(pageGrant.ok === true, `Firefox page permission bootstrap failed: ${String(pageGrant.error)}`)
  await setContext(client, 'content')
  await pollUntil(() => executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'browser.permissions.contains({origins:["http://*/*","https://*/*"]}).then(done,error=>done(false));',
  ].join('')), COMMAND_TIMEOUT_MS, 'Firefox network page permissions active')
  await execute(client, 'document.querySelector("[data-testid=network-policy]").value="disable_non_proxied_udp";document.querySelector("[data-testid=network-block-support]").checked=true;return true;')
  await clickElement(client, '[data-testid=network-apply]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox support blocking applied')
  const supportState = await execute(client, 'return document.querySelector("[data-testid=network-status]")?.textContent')
  assert(typeof supportState === 'string' && supportState.includes('WebRTC 防护已生效'), `Firefox support blocking failed: ${String(supportState)}`)
  const pageHandle = await newTab(client, `${origin}/network-page`)
  await networkFixtureState(client, { peer: 'undefined', track: 'undefined', description: 'undefined', media: 'object', mediaBlocked: false, ice: 'function', channel: 'function' })
  await switchWindow(client, driverHandle)
  await clickElement(client, '[data-testid=network-disable]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox support blocking disabled')
  await switchWindow(client, pageHandle)
  await navigate(client, `${origin}/network-page`)
  await networkFixtureState(client, { peer: 'function', track: 'function', description: 'function', media: 'object', mediaBlocked: false, ice: 'function', channel: 'function' })
  await switchWindow(client, driverHandle)
  for (const option of ['devices', 'additional']) {
    await execute(client, [
      'document.querySelector("[data-testid=network-block-support]").checked=false;',
      'document.querySelector("[data-testid=network-block-devices]").checked=arguments[0]==="devices";',
      'document.querySelector("[data-testid=network-block-additional]").checked=arguments[0]==="additional";return true;',
    ].join(''), [option])
    await clickElement(client, '[data-testid=network-apply]')
    await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', `Firefox ${option} blocking applied`)
    const state = await execute(client, 'return document.querySelector("[data-testid=network-status]")?.textContent')
    assert(typeof state === 'string' && state.includes('WebRTC 防护已生效'), `Firefox ${option} blocking failed: ${String(state)}`)
    await switchWindow(client, pageHandle)
    await navigate(client, `${origin}/network-page`)
    await networkFixtureState(client, option === 'devices'
      ? { peer: 'function', track: 'function', description: 'function', media: 'object', mediaBlocked: true, ice: 'function', channel: 'function' }
      : { peer: 'function', track: 'function', description: 'function', media: 'object', mediaBlocked: false, ice: 'undefined', channel: 'undefined' })
    await switchWindow(client, driverHandle)
  }
  await clickElement(client, '[data-testid=network-disable]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox independent blocking disabled')
  await switchWindow(client, pageHandle)
  await navigate(client, `${origin}/network-page`)
  await networkFixtureState(client, { peer: 'function', track: 'function', description: 'function', media: 'object', mediaBlocked: false, ice: 'function', channel: 'function' })
  await switchWindow(client, driverHandle)
  await execute(client, [
    'document.querySelector("[data-testid=network-block-support]").checked=true;',
    'document.querySelector("[data-testid=network-block-devices]").checked=false;',
    'document.querySelector("[data-testid=network-block-additional]").checked=false;return true;',
  ].join(''))
  await clickElement(client, '[data-testid=network-apply]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-status]")?.textContent.includes("WebRTC 防护已生效")&&document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox protection before addon restart')
  await setContext(client, 'chrome')
  const restarted = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {AddonManager}=ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");',
    `const addon=await AddonManager.getAddonByID(${JSON.stringify(EXTENSION_ID)});`,
    'if(!addon)throw new Error("temporary OneWeb addon missing");await addon.reload();return {ok:true};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join('')), 'Firefox temporary addon restart')
  assert(restarted.ok === true, `Firefox addon restart failed: ${String(restarted.error)}`)
  await setContext(client, 'content')
  // Reload closes extension-owned browsing contexts. Start a fresh trusted page
  // from the ordinary fixture tab rather than using the discarded old handle.
  await switchWindow(client, pageHandle)
  driverHandle = await newTab(client, driverUrl)
  await waitForPage(client, 'document.readyState==="complete"&&document.querySelector("[data-testid=manage-modules]")&&document.querySelector("[data-destination=tools]")', 'Firefox trusted sidebar after addon restart')
  await showBuiltinTool(client, driverHandle, NETWORK_MANAGEMENT_ID, '[data-testid=network-management]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-status]")?.textContent.includes("WebRTC 防护已生效")', 'Firefox explicitly enabled WebRTC restored after restart')
  await switchWindow(client, pageHandle)
  await navigate(client, `${origin}/network-page`)
  await networkFixtureState(client, { peer: 'undefined', track: 'undefined', description: 'undefined', media: 'object', mediaBlocked: false, ice: 'function', channel: 'function' })
  await switchWindow(client, driverHandle)
  const revoked = await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'browser.permissions.remove({permissions:["privacy"]}).then(done,error=>done({error:String(error)}));',
  ].join(''))
  assert(revoked === true, `Firefox privacy revocation failed: ${JSON.stringify(revoked)}`)
  await pollUntil(() => executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>{const reply=await browser.runtime.sendMessage({channel:"oneweb.network-management",version:1,type:"status"});',
    'const state=reply?.result?.value;return reply?.result?.ok===true&&state.settings.enabled===false&&state.protected===false&&state.scriptsActive===false;})()',
    '.then(done,error=>done(false));',
  ].join('')), COMMAND_TIMEOUT_MS, 'Firefox privacy revocation cancels protection and scripts')
  await switchWindow(client, pageHandle)
  await navigate(client, `${origin}/network-page`)
  await networkFixtureState(client, { peer: 'function', track: 'function', description: 'function', media: 'object', mediaBlocked: false, ice: 'function', channel: 'function' })
  await switchWindow(client, driverHandle)
  await setContext(client, 'chrome')
  const regranted = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>{',
    'const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");',
    `const policy=WebExtensionPolicy.getByID(${JSON.stringify(EXTENSION_ID)});`,
    'await ExtensionPermissions.add(policy.id,{permissions:["privacy"],origins:[]},policy.extension);return {ok:true};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join('')), 'Firefox privacy regrant for independent readback')
  assert(regranted.ok === true, `Firefox privacy regrant failed: ${String(regranted.error)}`)
  await setContext(client, 'content')
  const released = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    'browser.privacy.network.webRTCIPHandlingPolicy.get({}).then(done,error=>done({error:String(error)}));',
  ].join('')), 'Firefox policy after permission revocation')
  assert(JSON.stringify(released) === JSON.stringify(before.policy), `Firefox revocation did not release the native policy: ${JSON.stringify(released)}`)
  await clickElement(client, '[data-testid=network-apply]')
  await waitForPage(client, 'document.querySelector("[data-testid=network-status]")?.textContent.includes("WebRTC 防护已生效")&&document.querySelector("[data-testid=network-management]")?.getAttribute("aria-busy")==="false"', 'Firefox protection explicitly reapplied')
  assert(JSON.stringify(clashRequests) === JSON.stringify({ version: 0, configs: 0, proxies: 0, unauthorized: 0 }), 'Firefox WebRTC lifecycle triggered automatic Clash requests')
  const clash = asRecord(await executeAsync(client, [
    'const origin=arguments[0],secret=arguments[1],done=arguments[arguments.length-1];',
    '(async()=>{',
    'const send=async(type,fields={})=>(await browser.runtime.sendMessage({channel:"oneweb.clash-control",version:4,type,...fields}))?.result;',
    'const check=(condition,label)=>{if(!condition)throw new Error(label)};',
    'const prepared=await send("CLASH_CONTROL_PREPARE",{controllerUrl:origin});check(prepared?.ok,"prepare");',
    'const connected=await send("CLASH_CONTROL_CONNECT",{...prepared.preparation,secret});check(connected?.ok&&connected.status?.implementation==="Clash.Meta","connect");',
    'const read=await send("CLASH_CONTROL_REFRESH");check(read?.ok&&read.snapshot?.mode==="rule"&&read.snapshot.proxyGroups?.[0]?.name==="Firefox Proxy"&&read.snapshot.proxyGroups[0].selectedNode==="Firefox Node","read");',
    'const disconnected=await send("CLASH_CONTROL_DISCONNECT");check(disconnected?.ok,"disconnect");',
    'const status=await send("CLASH_CONTROL_STATUS");check(status?.ok&&status.connection?.phase==="disconnected","disconnected status");',
    'const network=(await browser.runtime.sendMessage({channel:"oneweb.network-management",version:1,type:"status"}))?.result;',
    'check(network?.ok&&network.value?.protected===true&&network.value.scriptsActive===true,"WebRTC preserved after Clash disconnect");',
    'check(!JSON.stringify(await browser.storage.local.get(null)).includes(secret),"secret persisted");',
    'return {ok:true};',
    '})().then(done,error=>done({ok:false,error:String(error)}));',
  ].join(''), [origin, FIREFOX_CLASH_SECRET]), 'Firefox Clash connection beside WebRTC protection')
  assert(clash.ok === true, `Firefox Clash/WebRTC combined flow failed: ${String(clash.error)}`)
  assert(JSON.stringify(clashRequests) === JSON.stringify({ version: 2, configs: 2, proxies: 1, unauthorized: 0 }), `Firefox Clash request contract failed: ${JSON.stringify(clashRequests)}`)
  await showModuleManagement(client, driverHandle)
  await clickElement(client, `[data-module-id="${NETWORK_MANAGEMENT_ID}"] [data-testid=module-toggle]`)
  await waitForPage(client, `document.querySelector('[data-module-id="${NETWORK_MANAGEMENT_ID}"] [data-testid=module-toggle]')?.getAttribute("aria-checked")==="false"`, 'Firefox network module disabled')
  const stopped = asRecord(await executeAsync(client, [
    'const done=arguments[arguments.length-1];',
    '(async()=>({policy:await browser.privacy.network.webRTCIPHandlingPolicy.get({}),',
    'scripts:await browser.scripting.getRegisteredContentScripts({ids:["oneweb-network-support","oneweb-network-devices","oneweb-network-additional"]}),',
    'hosts:await browser.permissions.contains({origins:["http://*/*","https://*/*"]}),',
    'peers:JSON.stringify(((await browser.storage.local.get("oneweb.modules.v1"))["oneweb.modules.v1"]||[]).filter(record=>record.manifest.id!=="dev.oneweb.clash-control"))}))()',
    '.then(done,error=>done({error:String(error)}));',
  ].join('')), 'Firefox network module cleanup')
  assert(JSON.stringify(stopped.policy) === JSON.stringify(before.policy), 'Firefox module disable did not release the native policy')
  assert(Array.isArray(stopped.scripts) && stopped.scripts.length === 0, 'Firefox module disable retained page scripts')
  assert(stopped.hosts === true, 'Firefox module disable removed shared host permissions')
  assert(stopped.peers === peerRecords, 'Firefox network lifecycle changed another module record')
  process.stdout.write(`Firefox network: four policies in normal/private readback, three independent MAIN first-script blockers across top/HTTP/srcdoc frames, restart restoration, revocation/module-disable cleanup, peer isolation, authenticated Clash prepare/connect/refresh/disconnect ${JSON.stringify(clashRequests)}\n`)
}

async function main() {
  const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const extensionDir = path.resolve(projectDir, process.env.EXTENSION_PATH || process.env.ONEWEB_EXTENSION_DIR || 'artifacts/build/firefox')
  const manifest = await fs.readJson(path.join(extensionDir, 'manifest.json'))
  validateFirefoxArtifactManifest(manifest)
  const firefoxBinary = resolveFirefoxBinary()
  const fixtures = await startFixtures()
  const marionettePort = await availablePort()
  const webExtCli = path.join(projectDir, 'node_modules/web-ext/bin/web-ext.js')
  const log = new FirefoxProcessLog()
  let child: ChildProcess | null = null
  let marionette: MarionetteClient | null = null
  let rdp: RdpClient | null = null
  let releaseAudio = async () => {}
  const failures: unknown[] = []
  try {
    const audio = await prepareFirefoxTestAudio()
    releaseAudio = audio.cleanup
    child = spawn(process.execPath, [
      webExtCli,
      'run',
      '--verbose',
      '--source-dir',
      extensionDir,
      '--target',
      'firefox-desktop',
      '--firefox',
      firefoxBinary,
      '--no-reload',
      '--no-input',
      '--start-url',
      'about:blank',
      '--arg=--headless',
      '--arg=--marionette',
      '--arg=--remote-allow-system-access',
      `--pref=marionette.port=${marionettePort}`,
    ], {
      cwd: projectDir,
      detached: process.platform !== 'win32',
      // Firefox 160 reads this environment variable for privileged automation;
      // the older --remote-allow-system-access argument alone is insufficient.
      env: { ...audio.env, NO_COLOR: '1', MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const rdpPort = await waitForRdpPort(child, log)
    rdp = await connectRdp(rdpPort)
    const extensionOrigin = await discoverExtensionOrigin(rdp)
    assert(extensionOrigin, 'Temporary OneWeb extension origin is missing')
    marionette = new MarionetteClient()
    await marionette.connect(marionettePort)
    await runFirefoxScenario(
      marionette,
      extensionOrigin,
      fixtures.alphaOrigin,
      fixtures.betaOrigin,
      fixtures.sendToken,
      fixtures.sendRequests,
      fixtures.dubbingRequests,
      fixtures.clashRequests,
      fixtures.assistantRequests,
    )
  }
  catch (error) {
    const detail = log.tail ? `\nFirefox output:\n${log.tail}` : ''
    failures.push(new Error(`${error instanceof Error ? error.stack || error.message : String(error)}${detail}`))
  }
  finally {
    // Wrap synchronous cleanup too, so one failure cannot skip other owned resources.
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => marionette?.close()),
      Promise.resolve().then(() => rdp?.close()),
      Promise.resolve().then(() => terminateProcessGroup(child?.pid)),
      Promise.resolve().then(() => fixtures.close()),
      Promise.resolve().then(() => releaseAudio()),
    ])
    for (const result of cleanup) {
      if (result.status === 'rejected')
        failures.push(result.reason)
    }
  }
  if (failures.length === 1)
    throw failures[0]
  if (failures.length > 1) {
    const details = failures.map(error => error instanceof Error ? error.stack || error.message : String(error)).join('\n')
    throw new AggregateError(failures, `Firefox scenario or resource cleanup failed:\n${details}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
