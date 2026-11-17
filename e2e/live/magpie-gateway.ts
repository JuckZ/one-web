import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

export interface MagpieConfiguration { baseUrl: string, model: string, key: string }
export interface MagpieRequestSummary {
  model: string
  status: number
  durationMs: number
  requestBytes: number
  responseBytes: number
  aborted: boolean
  completed: boolean
}

/** Read credentials into this Node process only. Never send them to Playwright or its reporters. */
function readMagpieConfiguration(configPath?: string): MagpieConfiguration {
  const filename = configPath ?? process.env.ONEWEB_LIVE_CODEX_CONFIG
    ?? path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'config.toml')
  const script = [
    'import json,os,sys,tomllib',
    'from pathlib import Path',
    'p=Path(sys.argv[1]);c=tomllib.loads(p.read_text())',
    'profile=c.get("profiles",{}).get(c.get("profile"),{})',
    'provider=c.get("model_providers",{}).get(profile.get("model_provider",c.get("model_provider")),{})',
    'key=provider.get("experimental_bearer_token") or provider.get("api_key") or os.environ.get(provider.get("env_key",""),"")',
    'if not key and provider.get("requires_openai_auth") and p.with_name("auth.json").exists(): key=json.loads(p.with_name("auth.json").read_text()).get("OPENAI_API_KEY","")',
    'print(json.dumps({"baseUrl":provider.get("base_url"),"model":profile.get("model",c.get("model")),"key":key}))',
  ].join('\n')
  const result = spawnSync('python3', ['-c', script, filename], { encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024 })
  // Do not include subprocess stdout/stderr: parse failures can include secret-bearing config lines.
  if (result.status !== 0 || result.error)
    throw new Error('无法读取 Codex 网关配置（需要 Python 3.11+），请检查 ONEWEB_LIVE_CODEX_CONFIG')
  let value: Partial<MagpieConfiguration>
  try {
    value = JSON.parse(result.stdout)
  }
  catch { throw new Error('Codex 网关配置格式无效') }
  if (typeof value.baseUrl !== 'string' || typeof value.model !== 'string' || !value.model.trim()
    || typeof value.key !== 'string' || !value.key || /[\r\n]/.test(value.key)) {
    throw new Error('Codex 配置缺少网关地址、模型或可用凭据')
  }
  let url: URL
  try {
    url = new URL(value.baseUrl)
  }
  catch { throw new Error('Codex 网关地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Codex 网关必须是无凭据、无查询参数的 HTTP(S) 服务地址')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return { baseUrl: url.href, model: process.env.ONEWEB_LIVE_LLM_MODEL?.trim() || value.model, key: value.key }
}

function respond(response: ServerResponse, status: number, text: string, contentType = 'application/json') {
  if (response.destroyed)
    return
  response.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': 'no-store' })
  response.end(text)
}

async function readInput(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of request) {
    const chunk = Buffer.from(value)
    size += chunk.byteLength
    if (size > 262144)
      throw new Error('request-size')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** A real HTTP relay, not an LLM fixture: upstream bytes are streamed unchanged and never recorded. */
export async function createMagpieGateway(options: { articleHtml?: string, configPath?: string } = {}) {
  if (process.env.ONEWEB_LIVE_LLM !== '1')
    throw new Error('真实模型测试需要显式设置 ONEWEB_LIVE_LLM=1；默认不读取凭据或请求网关')
  const configuration = readMagpieConfiguration(options.configPath)
  const endpoint = new URL('chat/completions', configuration.baseUrl)
  const browserKey = `oneweb-live-alias-${randomUUID()}`
  const stats = { requests: [] as MagpieRequestSummary[] }
  const active = new Set<AbortController>()
  let closed = false
  const article = options.articleHtml ?? '<!doctype html><title>OneWeb live test</title><main><p>Public synthetic test content.</p></main>'
  const server = createServer((request, response) => {
    const handle = async () => {
      const address = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'GET' && address.pathname === '/article') {
        respond(response, 200, article, 'text/html')
        return
      }
      if (request.method !== 'POST' || address.pathname !== '/v1/chat/completions' || address.search) {
        respond(response, 404, '{"error":"Unknown live-test route"}')
        return
      }
      if (closed || request.headers.authorization !== `Bearer ${browserKey}`) {
        respond(response, 401, '{"error":"Invalid live-test credential"}')
        return
      }
      let body: Buffer
      try {
        body = await readInput(request)
      }
      catch {
        respond(response, 413, '{"error":"Live request exceeds 256 KiB"}')
        return
      }
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(body.toString('utf8'))
      }
      catch {
        respond(response, 400, '{"error":"Invalid live request JSON"}')
        return
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some(key => !['model', 'stream', 'messages'].includes(key))
        || payload.model !== configuration.model || payload.stream !== true || !Array.isArray(payload.messages)
        || !payload.messages.length || payload.messages.length > 64
        || payload.messages.some(message => !message || typeof message !== 'object'
          || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
        respond(response, 400, '{"error":"Only the configured model and text chat are allowed"}')
        return
      }
      const summary: MagpieRequestSummary = { model: configuration.model, status: 0, durationMs: 0, requestBytes: body.byteLength, responseBytes: 0, aborted: false, completed: false }
      stats.requests.push(summary)
      const started = performance.now()
      const abort = new AbortController()
      active.add(abort)
      const disconnected = () => {
        if (!response.writableEnded) {
          summary.aborted = true
          abort.abort()
        }
      }
      response.on('close', disconnected)
      const timer = setTimeout(() => abort.abort(), 120000)
      let upstream: Response | undefined
      try {
        upstream = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          signal: abort.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${configuration.key}` },
          body,
        })
        summary.status = upstream.status
        if (!upstream.ok || !upstream.body) {
          // Upstream diagnostic bodies/headers may contain secrets; expose only the HTTP status.
          await upstream.body?.cancel().catch(() => {})
          respond(response, upstream.ok ? 502 : upstream.status, '{"error":"Magpie upstream request failed"}')
          return
        }
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'text/event-stream', 'Cache-Control': 'no-store' })
        const reader = upstream.body.getReader()
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done)
              break
            summary.responseBytes += chunk.value.byteLength
            if (summary.responseBytes > 2 * 1024 * 1024)
              throw new Error('response-size')
            if (!response.write(chunk.value))
              await once(response, 'drain', { signal: abort.signal })
          }
          response.end()
          summary.completed = true
        }
        finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      }
      catch {
        summary.aborted ||= abort.signal.aborted
        if (!response.headersSent)
          respond(response, 502, '{"error":"Magpie upstream connection failed or timed out"}')
        else
          response.destroy()
      }
      finally {
        clearTimeout(timer)
        summary.durationMs = Math.round(performance.now() - started)
        active.delete(abort)
        response.off('close', disconnected)
      }
    }
    void handle().catch(() => respond(response, 500, '{"error":"Live test relay failed"}'))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    model: configuration.model,
    browserKey,
    stats,
    async close() {
      closed = true
      for (const abort of active) abort.abort()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
