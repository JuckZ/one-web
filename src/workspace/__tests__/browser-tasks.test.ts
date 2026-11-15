/* eslint no-template-curly-in-string: off -- Browser prompt templates use literal placeholders. */
import type { PageTool, PageToolsSnapshot } from '../page-tools'
import { PageContentRuntime } from '~/assistantContent/runtime'
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { handlePageActionMessage, PageActionClient, PageActionController } from '../page-actions'
import { PageContextController } from '../page-context'

async function setup() {
  document.body.innerHTML = '<main><p>Known browser article.</p></main><textarea>Original reply</textarea>'
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items))
    },
  }
  const sent: Array<{ messages: Array<{ role: string, content: string }> }> = []
  const runtime = new PageContentRuntime(document)
  const permissions = { contains: async () => true }
  const injection = { connect: async () => ({ documentId: 'page', request: async (message: { command: string }) => runtime.handle(message) }) }
  let href = 'https://example.org/article'
  const pageContext = new PageContextController({
    tabs: { query: async () => [{ id: 7, url: href, title: 'Article' }] },
    permissions,
    injection,
  })
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions,
    resolveAttachment: (token, owner) => pageContext.resolveAttachment(token, owner),
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init!.body as string))
      return new Response('{"choices":[{"message":{"content":"Task result"}}]}', { headers: { 'Content-Type': 'application/json' } })
    },
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const opened: string[] = []
  const actions = new PageActionController({ storage, permissions, injection, pageContext, assistant, openWorkspace: async () => {}, openWeb: async (url) => {
    opened.push(url)
  } })
  const sender = { id: 'oneweb', tab: { id: 7 }, frameId: 0, documentId: 'page', url: 'https://example.org/article' }
  const client = new PageActionClient({
    sendMessage: async message => handlePageActionMessage(actions, message, sender, 'oneweb', 'chrome-extension://oneweb/'),
  })
  return { client, assistant, runtime, sent, opened, sender, navigate: (value: string) => {
    href = value
  } }
}

it('runs a saved page action with real article context and exposes workspace prompts without exposing their templates', async () => {
  const { client, assistant, runtime, sent } = await setup()
  const prompt = await assistant.savePrompt({ title: '工具条提示词', template: '解释 ${text}' })
  const action = await client.request<PageTool>('tool-save', { action: { title: '论点', scope: 'page', template: '找出论点：${text}' } })
  expect(await client.request('tool-edit', { id: action.id })).toMatchObject({ template: '找出论点：${text}' })
  await expect(client.request('tool-edit', { id: `prompt:${prompt.id}` })).rejects.toThrow('自定义动作')
  const snapshot = await client.request<PageToolsSnapshot>('tools')
  expect(snapshot.actions).toContainEqual(expect.objectContaining({ id: `prompt:${prompt.id}`, title: '工具条提示词' }))
  expect(JSON.stringify(snapshot)).not.toContain('解释 ${text}')
  await client.start(action.id)
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed', text: 'Task result' }))
  expect(sent[0].messages.at(-1)?.content).toContain('找出论点：Known browser article.')
  expect((await client.request<PageToolsSnapshot>('tools')).actions.find(tool => tool.id === action.id)?.recent).toBe(true)
  runtime.dispose()
})

it('accepts a stale same-origin SPA sender URL only with the matching native document and saves the actual current source', async () => {
  const { client, runtime, sender, navigate } = await setup()
  navigate('https://example.org/next?part=2')
  await client.start('summarize-page')
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed' }))
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('main > p')!)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  expect(await client.request('clip-save')).toMatchObject({ url: 'https://example.org/next?part=2' })
  sender.documentId = 'different-native-document'
  await expect(client.request('tools')).rejects.toThrow('身份')
  runtime.dispose()
})

it('asks with explicit context, follows up in one conversation and opens only validated web targets', async () => {
  const { client, runtime, sent, opened } = await setup()
  const link = document.createElement('a')
  link.href = 'https://example.org/related'
  link.textContent = 'Related reference'
  document.querySelector('main')!.append(link)
  await client.request('ask-prepare')
  await client.request('ask-start', { text: '问候', context: 'none' })
  await vi.waitFor(async () => expect(await client.request('ask-poll')).toMatchObject({ status: 'completed' }))
  expect(JSON.stringify(sent[0])).not.toContain('Known browser article')
  await client.request('ask-start', { text: '解释这页', context: 'page' })
  await vi.waitFor(async () => expect(await client.request('ask-poll')).toMatchObject({ status: 'completed' }))
  expect(JSON.stringify(sent[1])).toContain('Known browser article')
  expect(JSON.stringify(sent[1])).toContain('问候')
  expect(await client.request('ask-targets', { query: 'reference' })).toEqual([{ title: 'Related reference', url: 'https://example.org/related' }])
  await client.request('ask-open', { url: 'https://example.org/related' })
  await client.request('ask-search', { query: 'browser question' })
  expect(opened).toEqual(['https://example.org/related', 'https://www.google.com/search?q=browser+question'])
  await expect(client.request('ask-open', { url: 'javascript:alert(1)' })).rejects.toThrow('网页地址')
  runtime.dispose()
})

it('drafts at an editor caret and inserts only after explicit approval, preserving the original selection on conflicts', async () => {
  const { client, runtime, sent } = await setup()
  const editor = document.querySelector('textarea')!
  editor.focus()
  editor.setSelectionRange(8, 8)
  await client.request('start', { action: 'compose', text: '写一句问候' })
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed' }))
  expect(sent[0].messages.at(-1)?.content).toContain('写一句问候')
  expect(editor.value).toBe('Original reply')
  await client.request('apply', { mode: 'insert' })
  expect(editor.value).toBe('OriginalTask result reply')
  editor.focus()
  editor.setSelectionRange(0, 8)
  await client.request('start', { action: 'reply', text: '礼貌回复这条消息', context: 'page' })
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed' }))
  expect(sent[1].messages.at(-1)?.content).toContain('Known browser article.')
  await client.start('reply', true)
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed' }))
  expect(sent[2].messages.at(-1)?.content).toContain('礼貌回复这条消息')
  expect(sent[2].messages.at(-1)?.content).toContain('Known browser article.')
  editor.value = 'Changed by page'
  await expect(client.request('apply', { mode: 'replace' })).rejects.toThrow('变化')
  expect(editor.value).toBe('Changed by page')
  runtime.dispose()
})
