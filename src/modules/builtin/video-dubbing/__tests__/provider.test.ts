import { Buffer } from 'node:buffer'
// @vitest-environment node
import type { RequestListener } from 'node:http'
import { createServer } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { DubbingProvider } from '../provider'

const servers: ReturnType<typeof createServer>[] = []
afterEach(() => servers.splice(0).forEach(server => server.close()))
async function fixture(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`
}
const cues = [{ id: 'c1', startMs: 0, endMs: 2000, sourceText: 'hello', sourceCueIds: ['1'] }]
it('uses only fixed compatible routes and maps translated IDs before producing bounded audio (T2)', async () => {
  const received: Array<{ path: string, key: string, body: any }> = []
  const baseUrl = await fixture(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    received.push({ path: req.url!, key: req.headers.authorization!, body: JSON.parse(text) })
    if (req.url === '/v1/chat/completions') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ cues: [{ id: 'c1', translatedText: '你好' }] }) } }],
        }),
      )
    }
    else {
      res.setHeader('Content-Type', 'audio/wav')
      res.end(Buffer.from([1, 2, 3]))
    }
  })
  const provider = new DubbingProvider({
    translation: { baseUrl, key: 'translation-secret', model: 'translator' },
    speech: { baseUrl, key: 'speech-secret', model: 'speaker', voice: 'alloy' },
  })
  const result = await provider.prepare(cues, 'zh-CN', new AbortController().signal)
  expect(result[0]).toMatchObject({ id: 'c1', translatedText: '你好', audio: 'AQID', bytes: 3, mime: 'audio/wav' })
  expect(received.map(row => [row.path, row.key])).toEqual([
    ['/v1/chat/completions', 'Bearer translation-secret'],
    ['/v1/audio/speech', 'Bearer speech-secret'],
  ])
  expect(received[1].body).toMatchObject({ input: '你好', voice: 'alloy', response_format: 'mp3' })
})

it('rejects missing cue IDs, service errors, redirects and oversized audio without leaking keys', async () => {
  let mode = 'missing'
  const baseUrl = await fixture((_req, res) => {
    if (mode === 'redirect') {
      res.writeHead(302, { Location: 'https://example.org/' })
      res.end()
      return
    }
    if (mode === '429') {
      res.writeHead(429)
      res.end('secret-server-detail')
      return
    }
    if (_req.url?.endsWith('chat/completions')) {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ cues: mode === 'missing' ? [] : [{ id: 'c1', translatedText: '你好' }] }),
              },
            },
          ],
        }),
      )
    }
    else {
      res.setHeader('Content-Type', 'audio/mpeg')
      res.end(Buffer.alloc(4194305))
    }
  })
  const provider = new DubbingProvider({
    translation: { baseUrl, key: 'SECRET', model: 'm' },
    speech: { baseUrl, key: 'SECRET', model: 'm', voice: 'v' },
  })
  await expect(provider.prepare(cues, 'zh', new AbortController().signal)).rejects.toThrow('翻译结果')
  mode = '429'
  await expect(provider.prepare(cues, 'zh', new AbortController().signal)).rejects.toThrow('429')
  mode = 'redirect'
  await expect(provider.prepare(cues, 'zh', new AbortController().signal)).rejects.toThrow('重定向')
  mode = 'large'
  await expect(provider.prepare(cues, 'zh', new AbortController().signal)).rejects.toThrow('上限')
})

it('an explicit retry reuses successful translation and speech and only repeats the failed speech item', async () => {
  const spoken: string[] = []
  let translations = 0
  let fail = true
  const baseUrl = await fixture(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    if (req.url?.endsWith('chat/completions')) {
      translations++
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  cues: [
                    { id: 'c1', translatedText: 'first' },
                    { id: 'c2', translatedText: 'second' },
                  ],
                }),
              },
            },
          ],
        }),
      )
    }
    else {
      spoken.push(body.input)
      if (body.input === 'second' && fail) {
        fail = false
        res.writeHead(503)
        res.end()
        return
      }
      res.setHeader('Content-Type', 'audio/wav')
      res.end(Buffer.from([1, 2, 3]))
    }
  })
  const provider = new DubbingProvider({
    translation: { baseUrl, key: 'key', model: 'm' },
    speech: { baseUrl, key: 'key', model: 'm', voice: 'v' },
  })
  const batch = [...cues, { ...cues[0], id: 'c2', startMs: 2000, endMs: 4000 }]
  await expect(provider.prepare(batch, 'zh', new AbortController().signal)).rejects.toThrow('503')
  expect((await provider.prepare(batch, 'zh', new AbortController().signal)).map(cue => cue.translatedText)).toEqual([
    'first',
    'second',
  ])
  expect((await provider.prepare([batch[0]], 'zh', new AbortController().signal))[0].translatedText).toBe('first')
  expect(translations).toBe(1)
  expect(spoken).toEqual(['first', 'second', 'second'])
  provider.discardAudio(['c1'])
  await provider.prepare([batch[0]], 'zh', new AbortController().signal)
  expect(translations).toBe(1)
  expect(spoken).toEqual(['first', 'second', 'second', 'first'])
})
