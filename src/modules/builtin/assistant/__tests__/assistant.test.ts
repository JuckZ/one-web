/* eslint no-template-curly-in-string: off -- Prompt placeholders are literal text, not JavaScript interpolation. */
// @vitest-environment node
import type { RequestListener } from 'node:http'
import { createServer } from 'node:http'
import { AssistantController } from '../controller'
import { AssistantClient, handleAssistantMessage } from '../protocol'

const servers: ReturnType<typeof createServer>[] = []
afterEach(() => servers.splice(0).forEach(server => server.close()))

function storage() {
  const values: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)) },
  }
}

async function fixture(handler: RequestListener, local = storage(), permissions = { contains: async () => true }) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`
  const secrets = storage()
  const createController = () => new AssistantController({
    storage: local,
    secrets,
    permissions,
  })
  const controller = createController()
  const createClient = (target = controller, owner = 'workspace-a') => new AssistantClient({
    sendMessage: async message => handleAssistantMessage(target, message, {
      id: 'test',
      url: 'chrome-extension://test/dist/sidebar/index.html',
      documentId: owner,
    }, 'test', 'chrome-extension://test/'),
  })
  const client = createClient()
  await client.configureProvider({ baseUrl, models: ['fixture'], key: 'synthetic-secret', remember: false })
  return { client, controller, baseUrl, createController, createClient }
}

it('configures a redacted provider and completes a real compatible HTTP request through the public client', async () => {
  const received: Array<{ path: string, key: string, body: unknown }> = []
  const { client, baseUrl } = await fixture(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    received.push({ path: req.url!, key: req.headers.authorization!, body: JSON.parse(body) })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '你好，这是回答。' } }] }))
  })
  expect(await client.readConfiguration()).toEqual({
    baseUrl,
    models: ['fixture'],
    keyConfigured: true,
    remember: false,
  })
  const request = await client.start({ intent: 'chat', text: '请问候我', modelId: 'fixture' })
  await vi.waitFor(async () => {
    const conversation = await client.openConversation(request.conversationId)
    expect(conversation.messages.at(-1)).toMatchObject({ role: 'assistant', text: '你好，这是回答。', status: 'completed' })
  })
  expect(received).toHaveLength(1)
  expect(received[0]).toMatchObject({
    path: '/v1/chat/completions',
    key: 'Bearer synthetic-secret',
    body: { model: 'fixture', stream: true, messages: expect.arrayContaining([{ role: 'user', content: '请问候我' }]) },
  })
})

it('reserves translation capacity after permission lookup so concurrent chats cannot exceed the host limit', async () => {
  let delayNextPermission = false
  let waitingForPermission = false
  let releasePermission = () => {}
  let requests = 0
  const { controller, client } = await fixture(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests++
    const messages = JSON.parse(body).messages
    if (messages[0].content.includes('Preserve every ID exactly once')) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: '{"translations":[{"id":"first","text":"译文"}]}' } }] }))
      return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    res.write('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n')
  }, storage(), {
    contains: async () => {
      if (delayNextPermission) {
        delayNextPermission = false
        waitingForPermission = true
        await new Promise<void>((resolve) => {
          releasePermission = resolve
        })
      }
      return true
    },
  })
  delayNextPermission = true
  const abort = new AbortController()
  const translation = controller.translateBlocks([{ id: 'first', text: 'First paragraph.' }], 'zh-CN', 'translation', abort.signal)
  await vi.waitFor(() => expect(waitingForPermission).toBe(true))
  const first = await client.start({ intent: 'chat', text: '第一条生成', modelId: 'fixture' })
  const second = await client.start({ intent: 'chat', text: '第二条生成', modelId: 'fixture' })
  await vi.waitFor(() => expect(requests).toBe(2))
  releasePermission()
  try {
    await expect(translation).rejects.toThrow('两个请求')
    expect(requests).toBe(2)
  }
  finally {
    abort.abort()
    await client.cancel(first.requestId)
    await client.cancel(second.requestId)
  }
})

it('shows partial SSE output across UTF-8 and event boundaries and completes only at DONE', async () => {
  let finish = () => {}
  const { client } = await fixture(async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    const first = new TextEncoder().encode(': ping\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n')
    for (const byte of first) {
      res.write(new Uint8Array([byte]))
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    finish = () => res.end('data: {"choices":\n' + 'data: [{"delta":{"content":"世界"}}]}\n\n' + 'data: [DONE]\n\n')
  })
  const request = await client.start({ intent: 'chat', text: '问候', modelId: 'fixture' })
  await vi.waitFor(async () => {
    expect((await client.openConversation(request.conversationId)).messages.at(-1))
      .toMatchObject({ text: '你好', status: 'streaming' })
  })
  finish()
  await vi.waitFor(async () => {
    expect((await client.openConversation(request.conversationId)).messages.at(-1))
      .toMatchObject({ text: '你好世界', status: 'completed' })
  })
})

it('stops a request, rejects duplicate generation and prevents late output from replacing its successor', async () => {
  const pending: Array<() => void> = []
  const { client } = await fixture((_req, res) => {
    const index = pending.length
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: index ? '新回答' : '部分回答' } }] })}\n\n`)
    pending.push(() => res.end('data: {"choices":[{"delta":{"content":"尾部"}}]}\n\ndata: [DONE]\n\n'))
  })
  const first = await client.start({ intent: 'chat', text: '第一次', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(first.conversationId)).messages.at(-1)?.text).toBe('部分回答'))
  await expect(client.start({ conversationId: first.conversationId, intent: 'chat', text: '重复', modelId: 'fixture' }))
    .rejects
    .toThrow('正在生成')
  await client.cancel(first.requestId)
  const next = await client.start({ conversationId: first.conversationId, intent: 'chat', text: '第二次', modelId: 'fixture' })
  await vi.waitFor(() => expect(pending).toHaveLength(2))
  pending[0]()
  pending[1]()
  await vi.waitFor(async () => expect((await client.openConversation(next.conversationId)).messages.at(-1))
    .toMatchObject({ text: '新回答尾部', status: 'completed' }))
  expect((await client.openConversation(first.conversationId)).messages[1])
    .toMatchObject({ text: '部分回答', status: 'cancelled' })
})

it('restores searchable history and favorites after a worker restart and deletes through the public client', async () => {
  const { client, createClient, createController } = await fixture((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '可收藏的回答' } }] }))
  })
  const request = await client.start({ intent: 'chat', text: '历史检索示例', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(request.conversationId)).messages.at(-1)?.status).toBe('completed'))
  await client.setFavorite(request.requestId, true)
  const restored = createClient(createController())
  expect((await restored.listConversations('历史检索')).map(item => item.id)).toEqual([request.conversationId])
  expect((await restored.openConversation(request.conversationId)).messages.at(-1)?.favorite).toBe(true)
  expect(await restored.readConfiguration()).toMatchObject({ keyConfigured: true })
  await restored.deleteConversation(request.conversationId)
  expect(await restored.listConversations('')).toEqual([])
})

it('summarizes imported subtitles with an editable prompt and retains the attachment after an invalid import', async () => {
  const bodies: Array<{ messages: Array<{ role: string, content: string }> }> = []
  const { client } = await fixture(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    bodies.push(JSON.parse(text))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '字幕摘要' } }] }))
  })
  const attachment = await client.importText({ name: 'lesson.srt', text: '1\n00:00:00,000 --> 00:00:02,000\nA real subtitle.\n' })
  await expect(client.importText({ name: 'bad.srt', text: 'invalid' })).rejects.toThrow()
  const prompt = await client.savePrompt({ title: '三点总结', template: 'Summarize in three points, in ${language}: ${text}' })
  const request = await client.start({
    intent: 'summarize',
    text: '请总结字幕',
    modelId: 'fixture',
    language: 'zh-CN',
    promptId: prompt.id,
    attachmentToken: attachment.token,
  })
  await vi.waitFor(async () => expect((await client.openConversation(request.conversationId)).messages.at(-1)?.status).toBe('completed'))
  expect(bodies[0].messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('Summarize in three points, in zh-CN') })
  expect(bodies[0].messages.some(message => message.content.includes('A real subtitle.'))).toBe(true)
  expect((await client.openConversation(request.conversationId)).attachment).toMatchObject({ title: 'lesson.srt', type: 'file' })
  await expect(client.savePrompt({ title: 'bad', template: '${globalThis.process}' })).rejects.toThrow('变量')
})

it('organizes prompts and lets the user clear history and turn off future persistence', async () => {
  const { client, createClient, createController } = await fixture((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '临时回答' } }] }))
  })
  const first = await client.savePrompt({ title: '第一', template: '${text}' })
  const second = await client.savePrompt({ title: '第二', template: 'Explain ${text}' })
  await client.reorderPrompts([second.id, first.id])
  expect((await client.listPrompts()).map(item => item.title)).toEqual(['第二', '第一'])
  await client.deletePrompt(first.id)
  expect((await client.listPrompts()).map(item => item.id)).toEqual([second.id])
  await client.setHistoryEnabled(false)
  const request = await client.start({ intent: 'chat', text: '不保存的对话', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(request.conversationId)).messages.at(-1)?.status).toBe('completed'))
  expect(await createClient(createController()).listConversations()).toEqual([])
  await client.clearConversations()
  expect(await client.listConversations()).toEqual([])
})

it('does not charge or retain a phantom request when saving a new conversation fails and permits an explicit retry', async () => {
  const local = storage()
  let fail = false
  let requests = 0
  const { client } = await fixture((_req, res) => {
    requests++
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '恢复后的回答' } }] }))
  }, {
    get: local.get,
    set: async (entries) => {
      if (fail)
        throw new Error('disk full')
      await local.set(entries)
    },
  })
  fail = true
  await expect(client.start({ intent: 'chat', text: '不要丢失草稿', modelId: 'fixture' })).rejects.toThrow('无法保存')
  expect(await client.listConversations()).toEqual([])
  expect(requests).toBe(0)
  fail = false
  const retried = await client.start({ intent: 'chat', text: '不要丢失草稿', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(retried.conversationId)).messages.at(-1)).toMatchObject({ status: 'completed', text: '恢复后的回答' }))
  expect(requests).toBe(1)
})

it('edits models without exposing or retyping the same service key and rolls back a failed configuration change', async () => {
  const local = storage()
  let fail = false
  const keys: string[] = []
  const { client, baseUrl, createClient, createController } = await fixture((req, res) => {
    keys.push(req.headers.authorization!)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '配置仍可用' } }] }))
  }, {
    get: local.get,
    set: async (entries) => {
      if (fail)
        throw new Error('disk full')
      await local.set(entries)
    },
  })
  await client.configureProvider({ baseUrl, models: ['second'], key: '', remember: false })
  await expect(client.configureProvider({ baseUrl: `${baseUrl}other/`, models: ['second'], key: '', remember: false })).rejects.toThrow('key')
  fail = true
  await expect(client.configureProvider({ baseUrl, models: ['wrong'], key: 'wrong-key', remember: false })).rejects.toThrow('保存')
  expect(await client.readConfiguration()).toMatchObject({ models: ['second'], keyConfigured: true })
  fail = false
  const restored = createClient(createController())
  expect(await restored.readConfiguration()).toMatchObject({ models: ['second'], keyConfigured: true })
  const request = await restored.start({ intent: 'chat', text: '继续', modelId: 'second' })
  await vi.waitFor(async () => expect((await restored.openConversation(request.conversationId)).messages.at(-1)?.status).toBe('completed'))
  expect(keys).toEqual(['Bearer synthetic-secret'])
})

it('keeps follow-ups to a saved conversation private while history saving is off', async () => {
  const { client, createClient, createController } = await fixture((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '已收到' } }] }))
  })
  const original = await client.start({ intent: 'chat', text: '保存的消息', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(original.conversationId)).messages.at(-1)?.status).toBe('completed'))
  await client.setHistoryEnabled(false)
  const next = await client.start({ conversationId: original.conversationId, intent: 'chat', text: '不要保存的追问', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(next.conversationId)).messages.at(-1)?.status).toBe('completed'))
  const restarted = createClient(createController())
  expect(await restarted.listConversations('不要保存')).toEqual([])
  expect((await restarted.openConversation(original.conversationId)).messages).toHaveLength(2)
  await client.setHistoryEnabled(true)
  expect(await createClient(createController()).listConversations('不要保存')).toEqual([])
})

it.each([
  { name: 'HTTP 429', status: 429, type: 'application/json', body: '{}', error: 'HTTP 429', text: '' },
  { name: 'malformed SSE', status: 200, type: 'text/event-stream', body: 'data: not-json\n\n', error: '流数据无效', text: '' },
  { name: 'empty result', status: 200, type: 'application/json', body: '{"choices":[{"message":{"content":""}}]}', error: '空回答', text: '' },
  { name: 'interrupted SSE', status: 200, type: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"部分文字"}}]}\n\n', error: '连接中断', text: '部分文字' },
])('retains an honest failure state for $name without automatically retrying', async ({ status, type, body, error, text }) => {
  let requests = 0
  const { client } = await fixture((_request, response) => {
    requests++
    response.writeHead(status, { 'Content-Type': type }).end(body)
  })
  const request = await client.start({ intent: 'chat', text: '失败路径', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(request.conversationId)).messages.at(-1))
    .toMatchObject({ status: 'failed', text, error: expect.stringContaining(error) }))
  expect(requests).toBe(1)
})

it('bounds active requests and lets only the owning workspace stop them', async () => {
  const { client, createClient } = await fixture((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"仍在生成"}}]}\n\n')
  })
  const first = await client.start({ intent: 'chat', text: 'A', modelId: 'fixture' })
  const peer = createClient(undefined, 'workspace-b')
  await expect(peer.cancel(first.requestId)).rejects.toThrow('另一个工作区')
  const second = await peer.start({ intent: 'chat', text: 'B', modelId: 'fixture' })
  await expect(client.start({ intent: 'chat', text: 'C', modelId: 'fixture' })).rejects.toThrow('两个')
  await client.close()
  expect((await peer.openConversation(first.conversationId)).messages.at(-1)?.status).toBe('cancelled')
  await peer.cancel(second.requestId)
  expect((await client.openConversation(second.conversationId)).messages.at(-1)?.status).toBe('cancelled')
})

it('keeps an explicitly imported text snapshot usable when a saved reading conversation is reopened', async () => {
  const references: string[] = []
  const { client, createClient, createController } = await fixture(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    references.push(JSON.parse(text).messages[1].content)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"choices":[{"message":{"content":"阅读回答"}}]}')
  })
  const attachment = await client.importText({ name: 'notes.md', text: 'Explicitly imported reference.' })
  const first = await client.start({ intent: 'summarize', text: '总结', modelId: 'fixture', attachmentToken: attachment.token })
  await vi.waitFor(async () => expect((await client.openConversation(first.conversationId)).messages.at(-1)?.status).toBe('completed'))
  const restored = createClient(createController(), 'workspace-reopened')
  const next = await restored.start({ conversationId: first.conversationId, intent: 'chat', text: '继续追问', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await restored.openConversation(next.conversationId)).messages.at(-1)?.status).toBe('completed'))
  expect(references).toHaveLength(2)
  expect(references.every(text => text.includes('Explicitly imported reference.'))).toBe(true)
})
