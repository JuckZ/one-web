// @vitest-environment node
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMagpieGateway } from '../../../e2e/live/magpie-gateway'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(status = 200) {
  vi.stubEnv('ONEWEB_LIVE_LLM', '1')
  vi.stubEnv('ONEWEB_LIVE_LLM_MODEL', '')
  const realKey = 'synthetic-upstream-secret'
  const seen: Array<{ url: string, authorization?: string, cookie?: string, body: string }> = []
  const stream = ': real protocol fixture\r\ndata: {"choices":[{"delta":{"content":"result"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
  const upstream = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    seen.push({ url: request.url!, authorization: request.headers.authorization, cookie: request.headers.cookie, body })
    response.writeHead(status, { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'private=upstream', 'X-Debug-Key': realKey })
    response.end(status === 200 ? stream : `private upstream diagnostic: ${realKey}`)
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    upstream.closeAllConnections()
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  })
  const directory = await mkdtemp(path.join(tmpdir(), 'oneweb-live-config-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const configPath = path.join(directory, 'config.toml')
  await writeFile(configPath, `model="fixture-model"\nmodel_provider="windows_gateway"\n[model_providers.windows_gateway]\nbase_url="http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1"\nexperimental_bearer_token="${realKey}"\n`)
  const gateway = await createMagpieGateway({ configPath, articleHtml: '<main>synthetic article</main>' })
  cleanups.push(() => gateway.close())
  const body = JSON.stringify({ model: gateway.model, stream: true, messages: [{ role: 'user', content: 'synthetic prompt' }] })
  const send = (authorization = gateway.browserKey, target = '/v1/chat/completions', input = body) => fetch(`${gateway.origin}${target}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authorization}`, 'Content-Type': 'application/json', 'Cookie': 'browser=private' },
    body: input,
  })
  return { gateway, realKey, seen, stream, body, send }
}

it('requires explicit live opt-in before reading even a nonexistent configuration', async () => {
  vi.stubEnv('ONEWEB_LIVE_LLM', '')
  await expect(createMagpieGateway({ configPath: '/nonexistent/no-secret-read.toml' })).rejects.toThrow('ONEWEB_LIVE_LLM=1')
})

it('streams identical upstream bytes while keeping credentials and cookies out of the browser response and summary', async () => {
  const { gateway, realKey, seen, stream, body, send } = await setup()
  const response = await send()
  expect(response.status).toBe(200)
  expect(await response.text()).toBe(stream)
  expect(seen).toEqual([{ url: '/v1/chat/completions', authorization: `Bearer ${realKey}`, cookie: undefined, body }])
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(response.headers.get('x-debug-key')).toBeNull()
  await vi.waitFor(() => expect(gateway.stats.requests[0].durationMs).toBeGreaterThanOrEqual(0))
  expect(JSON.stringify(gateway.stats)).not.toContain(realKey)
  expect(JSON.stringify(gateway.stats)).not.toContain('synthetic prompt')
  expect(JSON.stringify(gateway.stats)).not.toContain('result')
  expect(gateway.stats.requests[0].responseBytes).toBe(Buffer.byteLength(stream))
})

it('rejects wrong aliases, unknown routes and model overrides before any upstream request', async () => {
  const { gateway, seen, send } = await setup()
  expect((await send('wrong-alias')).status).toBe(401)
  expect((await send(gateway.browserKey, '/v1/responses')).status).toBe(404)
  expect((await send(gateway.browserKey, '/v1/chat/completions', JSON.stringify({ model: 'other', stream: true, messages: [{ role: 'user', content: 'x' }] }))).status).toBe(400)
  expect(seen).toEqual([])
  expect(gateway.stats.requests).toEqual([])
})

it('redacts upstream errors and never retries them', async () => {
  const { gateway, realKey, seen, send } = await setup(429)
  const response = await send()
  expect(response.status).toBe(429)
  expect(await response.text()).not.toContain(realKey)
  expect(response.headers.get('x-debug-key')).toBeNull()
  expect(seen).toHaveLength(1)
  expect(gateway.stats.requests).toHaveLength(1)
  expect(gateway.stats.requests[0].status).toBe(429)
})
