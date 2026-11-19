import { readPageReference } from '~/assistantContent/page-reference'
import { ASSISTANT_STORAGE_KEY } from '~/modules/builtin/assistant/contracts'
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { handleTabSourceMessage, TabSourceClient, TabSourceController } from '../tab-sources'

function setup() {
  const tabs = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, url: `https://page${index + 1}.example/article?private=${index}`, title: `Page ${index + 1}`, lastAccessed: 12 - index, windowId: 1, doc: `doc-${index}`, status: 'complete' }))
  const revoked = new Set<string>()
  const permissions = { contains: async ({ origins }: { origins: string[] }) => !origins.some(origin => revoked.has(origin)) }
  let now = 0
  const read = vi.fn(async (tabId: number, capture: boolean) => {
    const tab = tabs.find(tab => tab.id === tabId)!
    return { href: tab.url, documentId: tab.doc, ...(capture ? { text: `Body of ${tab.title}`, method: 'article', truncated: false } : {}) }
  })
  const focus = vi.fn(async () => {})
  const controller = new TabSourceController({ list: async () => tabs, get: async id => tabs.find(tab => tab.id === id), permissions, focus, read, now: () => now })
  const sender = { id: 'oneweb', url: 'chrome-extension://oneweb/sidebar.html', documentId: 'owner' }
  const handle = (message: unknown, from = sender) => handleTabSourceMessage(controller, message, from, 'oneweb', 'chrome-extension://oneweb/')
  const client = new TabSourceClient({ sendMessage: async message => handle(message) })
  return { tabs, permissions, revoked, read, focus, controller, client, handle, sender, advance: () => {
    now += 601000
  } }
}

it('lists only metadata, accepts explicit candidates, and binds sources to a trusted workspace', async () => {
  const { tabs, revoked, read, focus, controller, client, handle, sender } = setup()
  tabs.push({ ...tabs[0], id: 50, url: 'chrome://settings' })
  tabs.push({ ...tabs[0], id: 51, url: 'https://chromewebstore.google.com/detail/example' })
  const choices = await client.list()
  expect(choices).toHaveLength(12)
  expect(JSON.stringify(choices)).not.toContain('private=')
  expect(read).not.toHaveBeenCalled()
  expect(handle({ channel: 'oneweb.tab-sources.v1', command: 'list' }, { ...sender, url: 'https://page1.example' })).toBeUndefined()
  await expect(controller.attach(choices[0].token, 'other')).rejects.toThrow()
  revoked.add(choices[0].originPattern)
  await expect(client.attach(choices[0].token)).rejects.toThrow('授权')
  expect(read).not.toHaveBeenCalled()
  revoked.clear()
  const source = await client.attach(choices[0].token)
  expect(source).toMatchObject({ title: 'Page 1', url: 'https://page1.example/article' })
  expect(source).not.toHaveProperty('text')
  expect(await client.attach(choices[0].token)).toEqual(source)
  expect((await controller.resolve([source.token], 'owner'))[0].text).toBe('Body of Page 1')
  await expect(controller.resolve([source.token], 'other')).rejects.toThrow()
  await client.focus(source.token)
  expect(focus).toHaveBeenCalledWith(1, 1)
  await client.remove(source.token)
  await expect(controller.resolve([source.token], 'owner')).rejects.toThrow('失效')
})

it('fails closed for an old candidate, a same-URL reload, removal, revocation, expiry and disconnect', async () => {
  const { tabs, revoked, controller, client, advance } = setup()
  const original = (await client.list())[0]
  tabs[0].url += '-changed'
  await expect(client.attach(original.token)).rejects.toThrow('变化')
  let choices = await client.list()
  const first = await client.attach(choices[0].token)
  const second = await client.attach(choices[1].token)
  tabs[1].doc = 'new-document-same-url'
  await expect(controller.resolve([first.token, second.token], 'owner')).rejects.toThrow('Page 2')
  expect(await controller.resolve([first.token], 'owner')).toHaveLength(1)
  revoked.add(choices[0].originPattern)
  await expect(controller.resolve([first.token], 'owner')).rejects.toThrow('Page 1')
  revoked.clear()
  controller.invalidate(1)
  await expect(client.attach(choices[0].token)).rejects.toThrow()
  choices = await client.list()
  const third = await client.attach(choices[0].token)
  advance()
  await expect(controller.resolve([third.token], 'owner')).rejects.toThrow()
  choices = await client.list()
  const fourth = await client.attach(choices[0].token)
  controller.clearOwner('owner')
  await expect(controller.resolve([fourth.token], 'owner')).rejects.toThrow()
})

it('bounds selection count and UTF-8 text without splitting a character', async () => {
  const { read, controller, client } = setup()
  const choices = await client.list()
  read.mockImplementation(async (tabId, capture) => ({ href: `https://page${tabId}.example/article?private=${tabId - 1}`, documentId: `doc-${tabId}`, ...(capture ? { text: `${'界'.repeat(10000)}tail`, truncated: false } : {}) }))
  const sources = []
  for (const choice of choices.slice(0, 10)) sources.push(await client.attach(choice.token))
  await expect(client.attach(choices[10].token)).rejects.toThrow('10')
  const resolved = await controller.resolve(sources.map(source => source.token), 'owner')
  expect(resolved.every(item => item.truncated && new TextEncoder().encode(item.text).length <= 12288 && !item.text.includes('�'))).toBe(true)
})

it('passes only selected pages to the existing provider and never persists their snapshots', async () => {
  const { controller, client, permissions } = setup()
  const values: Record<string, unknown> = {}
  const storage = { get: async (key: string) => ({ [key]: values[key] }), set: async (updates: Record<string, unknown>) => {
    Object.assign(values, structuredClone(updates))
  } }
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Fixture answer' } }] }), { headers: { 'Content-Type': 'application/json' } }))
  const assistant = new AssistantController({ storage, secrets: storage, permissions, fetch, resolveTabSources: (tokens, owner) => controller.resolve(tokens, owner) })
  await assistant.configureProvider({ baseUrl: 'https://models.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const choices = await client.list()
  const a = await client.attach(choices[0].token)
  const b = await client.attach(choices[1].token)
  const input = { text: 'Compare these tabs', modelId: 'fixture', intent: 'chat' as const, tabSourceTokens: [a.token, b.token] }
  const started = await assistant.start(input, 'owner')
  await vi.waitFor(async () => expect((await assistant.openConversation(started.conversationId)).messages.at(-1)?.status).toBe('completed'))
  const messages = JSON.parse(fetch.mock.calls[0][1]!.body as string).messages
  expect(messages.slice(1, 3).map((message: { content: string }) => message.content)).toEqual([
    expect.stringMatching(/\[1\][\s\S]*Page 1[\s\S]*Body of Page 1/),
    expect.stringMatching(/\[2\][\s\S]*Page 2[\s\S]*Body of Page 2/),
  ])
  expect(JSON.stringify(messages)).not.toMatch(/Body of Page 3|\?private=/)
  expect(JSON.stringify(values[ASSISTANT_STORAGE_KEY])).not.toMatch(/Body of Page|tabSourceTokens/)
  controller.invalidate(2)
  await expect(assistant.start({ ...input, conversationId: started.conversationId }, 'owner')).rejects.toThrow('失效')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('uses the same restricted article extraction as the existing page assistant', () => {
  document.body.innerHTML = '<main><p>Article body</p><p hidden>hidden</p><details><summary>Folded title</summary><p>Folded private text</p></details><textarea>editor</textarea><div data-oneweb-assistant>toolbar</div></main>'
  expect(readPageReference(true)).toMatchObject({ text: 'Article body\nFolded title', method: 'article' })
  expect(readPageReference(false)).not.toHaveProperty('text')
})

it('ignores candidates invalidated during listing and rejects a document swap while attaching', async () => {
  const tabs = [{ id: 1, url: 'https://page.example/article', title: 'Old document', status: 'complete' }]
  let release!: (_tabs: typeof tabs) => void
  const list = vi.fn(() => new Promise<typeof tabs>((resolve) => {
    release = resolve
  }))
  const read = vi.fn(async (_id: number, capture: boolean) => ({
    href: tabs[0].url,
    documentId: capture ? 'new-document' : 'old-document',
    text: 'not the selected document',
    truncated: false,
  }))
  const controller = new TabSourceController({
    list,
    read,
    get: async () => tabs[0],
    focus: async () => {},
    permissions: { contains: async () => true },
  })
  const old = controller.list('owner')
  controller.invalidate(1)
  release(tabs)
  await expect(old).resolves.toEqual([])
  const fresh = controller.list('owner')
  release(tabs)
  await expect(controller.attach((await fresh)[0].token, 'owner')).rejects.toThrow('变化')
  expect(read).toHaveBeenLastCalledWith(1, true, expect.objectContaining({ documentId: 'old-document' }))
})

it('replaces a stale source and only invalidates snapshots whose permission was revoked', async () => {
  const { tabs, revoked, controller, client } = setup()
  const choices = await client.list()
  const a = await client.attach(choices[0].token)
  const b = await client.attach(choices[1].token)
  tabs[0].doc = 'replacement'
  const replacement = await client.attach(choices[0].token)
  expect(replacement.tabId).toBe(a.tabId)
  expect(replacement.token).not.toBe(a.token)
  revoked.add(choices[1].originPattern)
  await expect(controller.invalidateRevoked()).resolves.toEqual([b.tabId])
  await expect(controller.resolve([b.token], 'owner')).rejects.toThrow('失效')
  await expect(controller.resolve([replacement.token], 'owner')).resolves.toHaveLength(1)
})

it('uses only a reference summary when the apparent article is inside closed details', () => {
  document.body.innerHTML = '<details><summary>Visible heading</summary><main>Hidden article</main></details><p>Visible fallback</p>'
  expect(readPageReference(true)).toMatchObject({ text: 'Visible heading\nVisible fallback', method: 'visible-text' })
  expect(readPageReference(true, { href: document.URL, documentId: 'different' })).not.toHaveProperty('text')
})

it('aborts an active request on source revocation even after its chip was removed', async () => {
  const { client, controller, permissions, revoked } = setup()
  const storage = { get: async () => ({}), set: async () => {} }
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
    return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  })
  const assistant = new AssistantController({ storage, secrets: storage, permissions, fetch, resolveTabSources: (tokens, owner) => controller.resolve(tokens, owner) })
  await assistant.configureProvider({ baseUrl: 'https://models.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const [choice, unrelated] = await client.list()
  const source = await client.attach(choice.token)
  const started = await assistant.start({ text: 'Read the source', modelId: 'fixture', intent: 'chat', tabSourceTokens: [source.token] }, 'owner')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  const signal = fetch.mock.calls[0][1]!.signal
  await client.remove(source.token)
  revoked.add(unrelated.originPattern)
  await assistant.permissionsChanged()
  expect(signal?.aborted).toBe(false)
  revoked.add(choice.originPattern)
  await assistant.permissionsChanged()
  expect(signal?.aborted).toBe(true)
  expect((await assistant.openConversation(started.conversationId)).messages.at(-1)?.status).toBe('cancelled')
})

it('does not send page text if the source grant is revoked while history is being written', async () => {
  const { client, controller, permissions, revoked } = setup()
  let unblock!: () => void
  const set = vi.fn(async () => {})
  const storage = { get: async () => ({}), set }
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  const assistant = new AssistantController({ storage, secrets: storage, permissions, fetch, resolveTabSources: (tokens, owner) => controller.resolve(tokens, owner) })
  await assistant.configureProvider({ baseUrl: 'https://models.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const [choice] = await client.list()
  const source = await client.attach(choice.token)
  set.mockImplementationOnce(() => new Promise<void>((resolve) => {
    unblock = resolve
  }))
  const starting = assistant.start({ text: 'Read the source', modelId: 'fixture', intent: 'chat', tabSourceTokens: [source.token] }, 'owner')
  await vi.waitFor(() => expect(unblock).toBeTypeOf('function'))
  revoked.add(choice.originPattern)
  unblock()
  const started = await starting
  await vi.waitFor(async () => expect((await assistant.openConversation(started.conversationId)).messages.at(-1)?.status).toBe('failed'))
  expect(fetch).not.toHaveBeenCalled()
})

it('checks all source grants together after the last document check', async () => {
  const { client, controller, permissions, read, revoked } = setup()
  const [first, second] = await client.list()
  const a = await client.attach(first.token)
  const b = await client.attach(second.token)
  const contains = vi.spyOn(permissions, 'contains')
  const readPage = read.getMockImplementation()!
  let finishSecond!: () => void
  read.mockImplementation(async (tabId, capture) => {
    if (tabId === b.tabId && !capture) {
      await new Promise<void>((resolve) => {
        finishSecond = resolve
      })
    }
    return readPage(tabId, capture)
  })
  const resolving = controller.resolve([a.token, b.token], 'owner')
  await vi.waitFor(() => {
    expect(finishSecond).toBeTypeOf('function')
    expect(contains.mock.calls.filter(([query]) => query.origins[0] === first.originPattern)).toHaveLength(2)
  })
  revoked.add(first.originPattern)
  finishSecond()
  await expect(resolving).rejects.toThrow('授权已撤销')
})
