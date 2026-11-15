import { PageContentRuntime } from '~/assistantContent/runtime'
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { handlePageActionMessage, PageActionClient, PageActionController } from '../page-actions'
import { PageContextController } from '../page-context'

it('keeps visit hiding until navigation and persists site and global hiding independently', async () => {
  document.body.innerHTML = '<main><p>Selection fixture.</p></main>'
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)) },
  }
  const sender = { id: 'oneweb', tab: { id: 7 }, frameId: 0, documentId: 'page-a', url: 'https://example.org/article' }
  let actions: PageActionController
  const client = new PageActionClient({
    sendMessage: async message => handlePageActionMessage(actions, message, sender, 'oneweb', 'chrome-extension://oneweb/'),
  })
  const runtime = new PageContentRuntime(document, {
    sendMessage: async message => handlePageActionMessage(actions, message, sender, 'oneweb', 'chrome-extension://oneweb/'),
  })
  const permissions = { contains: async () => true }
  const injection = { connect: async () => ({ documentId: 'page-a', request: async (message: { command: string }) => runtime.handle(message) }) }
  const pageContext = new PageContextController({
    tabs: { query: async () => [{ id: 7, url: sender.url, title: 'Article' }] },
    permissions,
    injection,
  })
  const assistant = new AssistantController({ storage, secrets: storage, permissions })
  actions = new PageActionController({ storage, permissions, injection, pageContext, assistant, openWorkspace: async () => {} })
  await actions.enableSite()
  expect(document.querySelector('[data-oneweb-assistant]')).not.toBeNull()
  await client.request('hide', { scope: 'visit' })
  expect(document.querySelector('[data-oneweb-assistant]')).toBeNull()
  expect(await actions.readPreferences()).toEqual({ enabled: true, sites: [{ origin: 'https://example.org', enabled: true }] })
  await actions.syncActive()
  expect(document.querySelector('[data-oneweb-assistant]')).toBeNull()
  await actions.invalidateTab(7, true)
  await actions.syncActive()
  expect(document.querySelector('[data-oneweb-assistant]')).not.toBeNull()
  await client.request('hide', { scope: 'site' })
  await actions.syncActive()
  expect(document.querySelector('[data-oneweb-assistant]')).toBeNull()
  expect(await actions.readPreferences()).toMatchObject({ enabled: true, sites: [{ enabled: false }] })
  await actions.enableSite()
  await client.request('hide', { scope: 'global' })
  expect(await actions.readPreferences()).toMatchObject({ enabled: false, sites: [{ enabled: true }] })
  expect(await handlePageActionMessage(actions, { channel: 'oneweb.page-action.v1', command: 'preferences' }, sender, 'oneweb', 'chrome-extension://oneweb/')).toBeUndefined()
  runtime.dispose()
})

it('hands off a newly selected passage independently of the previous result source', async () => {
  document.body.innerHTML = '<main><p>First passage.</p><p>Newly selected passage.</p></main>'
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)) },
  }
  const sender = { id: 'oneweb', tab: { id: 7 }, frameId: 0, documentId: 'page-a', url: 'https://example.org/article' }
  const runtime = new PageContentRuntime(document)
  const permissions = { contains: async () => true }
  const pageContext = new PageContextController({
    tabs: { query: async () => [{ id: 7, url: sender.url, title: 'Article' }] },
    permissions,
    injection: { connect: async () => ({ documentId: 'page-a', request: async message => runtime.handle(message) }) },
  })
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions,
    resolveAttachment: (token, owner) => pageContext.resolveAttachment(token, owner),
    fetch: async () => new Response('{"choices":[{"message":{"content":"First answer."}}]}', { headers: { 'Content-Type': 'application/json' } }),
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  let handoff = ''
  const actions = new PageActionController({
    storage,
    permissions,
    pageContext,
    assistant,
    injection: { connect: async () => ({ documentId: 'page-a', request: async message => runtime.handle(message) }) },
    openWorkspace: async (token) => { handoff = token },
  })
  const client = new PageActionClient({
    sendMessage: async message => handlePageActionMessage(actions, message, sender, 'oneweb', 'chrome-extension://oneweb/'),
  })
  const select = (index: number) => {
    const range = document.createRange()
    range.selectNodeContents(document.querySelectorAll('p')[index])
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  }
  select(0)
  await client.start('translate')
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed' }))
  select(1)
  await client.request('continue')
  expect(actions.consumeHandoff(handoff).draft).toContain('First passage.')
  await client.request('continue', { selection: true })
  const draft = actions.consumeHandoff(handoff).draft
  expect(draft).toContain('Newly selected passage.')
  expect(draft).not.toContain('First passage.')
  runtime.dispose()
})

it('sends the selected translation language and keeps it when retrying after preferences change (PC-03)', async () => {
  document.body.innerHTML = '<main><p>Language fixture text.</p></main>'
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)) },
  }
  const sender = { id: 'oneweb', tab: { id: 7 }, frameId: 0, documentId: 'language-page', url: 'https://example.org/article' }
  const runtime = new PageContentRuntime(document)
  const permissions = { contains: async () => true }
  const injection = { connect: async () => ({ documentId: sender.documentId, request: async (message: Parameters<PageContentRuntime['handle']>[0]) => runtime.handle(message) }) }
  const pageContext = new PageContextController({ tabs: { query: async () => [{ id: 7, url: sender.url, title: 'Article' }] }, permissions, injection })
  const sent: unknown[] = []
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions,
    resolveAttachment: (token, owner) => pageContext.resolveAttachment(token, owner),
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)))
      return new Response('{"choices":[{"message":{"content":"Fixture translation."}}]}', { headers: { 'Content-Type': 'application/json' } })
    },
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const actions = new PageActionController({ storage, permissions, injection, pageContext, assistant, openWorkspace: async () => {} })
  const client = new PageActionClient({ sendMessage: async message => handlePageActionMessage(actions, message, sender, 'oneweb', 'chrome-extension://oneweb/') })
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('p')!)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  await client.request('toolbar-save', { settings: { mode: 'automatic', order: [], disabled: [], language: 'ja' } })
  await client.start('translate')
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed' }))
  expect(JSON.stringify(sent[0])).toContain('into ja')
  await client.request('toolbar-save', { settings: { mode: 'automatic', order: [], disabled: [], language: 'en' } })
  await client.start('translate', true)
  await vi.waitFor(async () => expect(await client.poll()).toMatchObject({ status: 'completed' }))
  expect(sent).toHaveLength(2)
  expect(JSON.stringify(sent[1])).toContain('into ja')
  expect(JSON.stringify(sent[1])).toContain('Language fixture text.')
  runtime.dispose()
})
