// @vitest-environment node
import type { RequestListener, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { completeChat } from '../provider'

const servers: Server[] = []
const syntheticKey = 'synthetic-provider-contract-key'

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close(error => error ? reject(error) : resolve())
  })))
})

async function provider(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`, models: ['gateway-fixture'], key: syntheticKey, remember: false }
}

function event(data: unknown) {
  return `data: ${JSON.stringify(data)}\r\n\r\n`
}
const prompt = [{ role: 'user', content: 'Synthetic gateway contract probe.' }]

it('ignores role/reasoning/usage metadata, returns only visible output and releases a held-open DONE response', async () => {
  let disconnected = false
  let requests = 0
  const config = await provider((_request, response) => {
    requests++
    response.on('close', () => {
      disconnected = true
    })
    response.writeHead(200, { 'Content-Type': 'Text/Event-Stream; charset=utf-8' })
    response.write(': gateway heartbeat\r\n\r\nevent: message\r\n')
    response.write(event({ id: 'chatcmpl-synthetic', choices: [{ index: 0, delta: { role: 'assistant', content: null } }] }))
    response.write(event({ choices: [{ delta: { reasoning_content: 'INTERNAL REASONING MUST NOT BE DISPLAYED', content: null } }] }))
    response.write(event({ choices: [{ delta: { content: '可见答复' } }] }))
    response.write(event({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
    response.write(event({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }))
    response.write('data: [DONE]\r\n\r\n')
    // The gateway deliberately keeps the transport open after its application-level terminator.
  })
  const visible: string[] = []
  await expect(completeChat(config, prompt, new AbortController().signal, part => visible.push(part))).resolves.toBe('可见答复')
  expect(visible.join('')).toBe('可见答复')
  expect(visible.join('')).not.toContain('INTERNAL REASONING')
  expect(requests).toBe(1)
  await vi.waitFor(() => expect(disconnected).toBe(true))
})

it('rejects HTTP throttling without retry or secret echo and closes its held-open error body', async () => {
  let requests = 0
  let disconnected = false
  const config = await provider((_request, response) => {
    requests++
    response.on('close', () => {
      disconnected = true
    })
    response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' })
    response.write(JSON.stringify({ error: { message: `Gateway echoed Bearer ${syntheticKey}` } }))
  })
  const output: string[] = []
  const failure: unknown = await completeChat(config, prompt, new AbortController().signal, part => output.push(part)).catch(error => error)
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).toContain('HTTP 429')
  expect((failure as Error).message).not.toContain(syntheticKey)
  expect(output).toEqual([])
  expect(requests).toBe(1)
  await vi.waitFor(() => expect(disconnected).toBe(true), { timeout: 2000 })
})

it('aborts a pending stream at the HTTP boundary and never emits a late gateway tail', async () => {
  let response: ServerResponse | undefined
  let disconnected = false
  const config = await provider((_request, outgoing) => {
    response = outgoing
    outgoing.on('close', () => {
      disconnected = true
    })
    outgoing.writeHead(200, { 'Content-Type': 'text/event-stream' })
    outgoing.write(event({ choices: [{ delta: { content: '已收到的部分' } }] }))
  })
  const abort = new AbortController()
  const output: string[] = []
  const pending = completeChat(config, prompt, abort.signal, part => output.push(part))
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(output.join('')).toBe('已收到的部分'))
  abort.abort()
  await rejected
  await vi.waitFor(() => expect(disconnected).toBe(true))
  response?.end(`${event({ choices: [{ delta: { content: '不应出现的迟到尾部' } }] })}data: [DONE]\n\n`)
  expect(output.join('')).toBe('已收到的部分')
})

it('does not follow a gateway redirect or forward authorization to the redirected endpoint', async () => {
  const paths: string[] = []
  const config = await provider((request, response) => {
    paths.push(request.url!)
    if (request.url === '/v1/chat/completions') {
      response.writeHead(307, { Location: '/unexpected-model-endpoint' }).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'redirected' } }] }))
  })
  const output: string[] = []
  await expect(completeChat(config, prompt, new AbortController().signal, part => output.push(part))).rejects.toBeInstanceOf(Error)
  expect(paths).toEqual(['/v1/chat/completions'])
  expect(output).toEqual([])
})

it('keeps finish_reason-only EOF incomplete rather than silently accepting a truncated answer', async () => {
  const config = await provider((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(event({ choices: [{ delta: { content: '模型的部分答案' } }] }) + event({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
  })
  const output: string[] = []
  await expect(completeChat(config, prompt, new AbortController().signal, part => output.push(part))).rejects.toThrow('连接中断')
  expect(output.join('')).toBe('模型的部分答案')
})

it.each([
  { name: 'HTML gateway error page with HTTP 200', contentType: 'text/html', body: `<html><body>Gateway ${syntheticKey} unavailable</body></html>` },
  { name: 'SSE error event containing a credential echo', contentType: 'text/event-stream', body: `event: error\ndata: {"error":"${syntheticKey}"}\n\n` },
])('rejects $name without exposing the error body as visible output', async ({ contentType, body }) => {
  const config = await provider((_request, response) => {
    response.writeHead(200, { 'Content-Type': contentType }).end(body)
  })
  const output: string[] = []
  const failure: unknown = await completeChat(config, prompt, new AbortController().signal, part => output.push(part)).catch(error => error)
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).not.toContain(syntheticKey)
  expect(output).toEqual([])
})

it('rejects invalid UTF-8 instead of replacing corrupted bytes in a completed answer', async () => {
  const config = await provider((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(Buffer.concat([Buffer.from('data: {"choices":[{"delta":{"content":"'), Buffer.from([0xC3, 0x28]), Buffer.from('"}}]}\n\ndata: [DONE]\n\n')]))
  })
  const output: string[] = []
  await expect(completeChat(config, prompt, new AbortController().signal, part => output.push(part))).rejects.toBeInstanceOf(Error)
  expect(output).toEqual([])
})

it('limits wire bytes including gateway metadata and closes an oversized open response', async () => {
  let disconnected = false
  let sendOverflow = () => {}
  const config = await provider((_request, response) => {
    response.on('close', () => {
      disconnected = true
    })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(event({ choices: [{ delta: { content: '已验证的前缀' } }] }))
    sendOverflow = () => {
      response.write(`: ${'x'.repeat(2 * 1024 * 1024)}\n\n`)
    }
  })
  const output: string[] = []
  const pending = completeChat(config, prompt, new AbortController().signal, part => output.push(part))
  const rejected = expect(pending).rejects.toThrow('超过 2 MiB')
  await vi.waitFor(() => expect(output.join('')).toBe('已验证的前缀'))
  sendOverflow()
  await rejected
  expect(output.join('')).toBe('已验证的前缀')
  await vi.waitFor(() => expect(disconnected).toBe(true))
})
