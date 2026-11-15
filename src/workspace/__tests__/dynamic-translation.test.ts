import { PageContentRuntime } from '~/assistantContent/runtime'
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { PageContextController } from '../page-context'

it('translates new and edited paragraphs once, switches display and stops observing without undoing site edits', async () => {
  document.body.innerHTML = '<main><p class="site-style">First paragraph.</p></main>'
  const data: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items))
    },
  }
  const sent: string[] = []
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions: { contains: async () => true },
    fetch: async (_url, init) => {
      const blocks = JSON.parse(JSON.parse(init!.body as string).messages.at(-1).content).blocks as Array<{ id: string, text: string }>
      sent.push(...blocks.map(block => block.text))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        translations: blocks.map(block => ({ id: block.id, text: `译：${block.text}` })),
      }) } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', key: 'test', models: ['test'], remember: false })
  const notifications: unknown[] = []
  const runtime = new PageContentRuntime(document, { sendMessage: async (message) => {
    notifications.push(message)
  } })
  const controller = new PageContextController({
    assistant,
    tabs: { query: async () => [{ id: 1, url: 'https://example.org/page' }] },
    permissions: { contains: async () => true },
    injection: { connect: async () => ({ documentId: 'doc', request: message => runtime.handle(message) }) },
  })
  await controller.translatePage('zh-CN', 'page', { dynamic: true })
  await vi.waitFor(() => expect(controller.translationStatus('page')).toMatchObject({ status: 'completed', completed: 1 }))
  const added = document.createElement('p')
  added.textContent = 'Second paragraph.'
  document.querySelector('main')!.append(added)
  await vi.waitFor(() => expect(notifications).toContainEqual(expect.objectContaining({ command: 'translation-update' })))
  await controller.translateMore('page')
  await controller.translateMore('page')
  expect(sent).toEqual(['First paragraph.', 'Second paragraph.'])
  await controller.translationDisplay('page', { mode: 'translation', fontSize: 19, style: 'plain' })
  expect(document.querySelector('p')!.getAttribute('data-oneweb-original')).toBeTruthy()
  expect(document.querySelector<HTMLElement>('[data-oneweb-translation]')!.style.fontSize).toBe('19px')
  added.textContent = 'Site changed paragraph.'
  await controller.translateMore('page')
  expect(sent).toEqual(['First paragraph.', 'Second paragraph.', 'Site changed paragraph.'])
  expect(document.querySelectorAll('[data-oneweb-translation]')).toHaveLength(2)
  controller.stopTranslation('page')
  const count = notifications.length
  await new Promise(resolve => setTimeout(resolve, 400))
  added.textContent = 'New content after stop.'
  await controller.translateMore('page')
  await new Promise(resolve => setTimeout(resolve, 400))
  expect(sent).toHaveLength(3)
  expect(notifications).toHaveLength(count)
  await controller.restorePage('page')
  expect(document.querySelector('main')!.textContent).toBe('First paragraph.New content after stop.')
  expect(document.querySelector('p')!.className).toBe('site-style')
  expect(document.querySelectorAll('[data-oneweb-original],[data-oneweb-translation]')).toHaveLength(0)
  runtime.dispose()
})

it('bounds per-document translation work and replaces a repeated result without creating duplicate page nodes', async () => {
  document.body.innerHTML = `<main>${Array.from({ length: 530 }, (_, index) => `<p>Paragraph ${index}.</p>`).join('')}</main>`
  const runtime = new PageContentRuntime(document)
  const value = await runtime.handle({ command: 'translation-blocks' }) as { blocks: Array<{ id: string, text: string }>, truncated: boolean }
  expect(value.blocks).toHaveLength(512)
  expect(value.truncated).toBe(true)
  const translations = value.blocks.slice(0, 8).map(block => ({ id: block.id, text: '译文' }))
  await runtime.handle({ command: 'translation-apply', language: 'zh-CN', translations })
  await runtime.handle({ command: 'translation-apply', language: 'zh-CN', translations })
  expect(document.querySelectorAll('[data-oneweb-translation]')).toHaveLength(8)
  expect(await runtime.handle({ command: 'translation-blocks', incremental: true })).toMatchObject({ blocks: [], truncated: true })
  await runtime.handle({ command: 'translation-restore' })
  expect(document.querySelectorAll('p')).toHaveLength(530)
  expect(document.querySelectorAll('[data-oneweb-translation]')).toHaveLength(0)
  runtime.dispose()
})

it('resumes a retained document after background recreation without replaying translated blocks or restarting a stopped visit', async () => {
  document.body.innerHTML = '<main><p>Before worker suspension.</p></main>'
  const data: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(data, items) },
  }
  const sent: string[] = []
  const permissions = { contains: async () => true }
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions,
    fetch: async (_url, init) => {
      const blocks = JSON.parse(JSON.parse(init!.body as string).messages.at(-1).content).blocks as Array<{ id: string, text: string }>
      sent.push(...blocks.map(block => block.text))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        translations: blocks.map(block => ({ id: block.id, text: '译文' })),
      }) } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', key: 'test', models: ['test'], remember: false })
  const runtime = new PageContentRuntime(document)
  const options = {
    assistant,
    permissions,
    tabs: { query: async () => [{ id: 1, url: 'https://example.org/page' }] },
    injection: { connect: async () => ({ documentId: 'doc', request: (message: { command: string }) => runtime.handle(message) }) },
  }
  const first = new PageContextController(options)
  await first.translatePage('zh-CN', 'page', { dynamic: true })
  await vi.waitFor(() => expect(first.translationStatus('page')).toMatchObject({ status: 'completed' }))
  const pending = document.createElement('p')
  pending.textContent = 'Collected before worker suspension.'
  document.querySelector('main')!.append(pending)
  expect(await runtime.handle({ command: 'translation-blocks', incremental: true })).toMatchObject({
    blocks: [{ text: 'Collected before worker suspension.' }],
  })
  const second = new PageContextController(options)
  await second.resumeTranslation('page')
  await vi.waitFor(() => expect(second.translationStatus('page')).toMatchObject({ status: 'completed', completed: 2, total: 2 }))
  const paragraph = document.createElement('p')
  paragraph.textContent = 'After worker suspension.'
  document.querySelector('main')!.append(paragraph)
  await second.translateMore('page')
  expect(sent).toEqual(['Before worker suspension.', 'Collected before worker suspension.', 'After worker suspension.'])
  expect(second.translationStatus('page')).toMatchObject({ completed: 3, total: 3 })
  second.stopTranslation('page')
  const third = new PageContextController(options)
  expect(await third.resumeTranslation('page')).toBeNull()
  expect(await third.translationDocumentState()).toMatchObject({ stopped: true, watching: false })
  runtime.dispose()
})
