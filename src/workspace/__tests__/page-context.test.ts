import { PageContentRuntime } from '~/assistantContent/runtime'
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { handlePageContextMessage, PageContextClient, PageContextController } from '../page-context'

it('attaches visible article text with a scrubbed source and invalidates its token after navigation', async () => {
  document.body.innerHTML = '<nav>Navigation</nav><main><h1>My article</h1><p>Hello <b>world</b>.</p><p hidden>private hidden</p><input value="secret"><script>bad()</script></main>'
  const runtime = new PageContentRuntime(document)
  let tab = { id: 7, url: 'https://example.org/article?secret=42#token', title: 'Article' }
  const controller = new PageContextController({
    tabs: { query: async () => [tab] },
    permissions: { contains: async () => true },
    injection: { connect: async () => ({ documentId: 'doc-a', request: async message => runtime.handle(message) }) },
  })
  const sender = { id: 'oneweb', url: 'chrome-extension://oneweb/dist/sidebar/index.html', documentId: 'workspace-a' }
  const client = new PageContextClient({ sendMessage: async message => handlePageContextMessage(controller, message, sender, 'oneweb', 'chrome-extension://oneweb/') })
  const attachment = await client.captureCurrentPage()
  expect(attachment).toMatchObject({
    title: 'Article',
    url: 'https://example.org/article',
    type: 'page',
    truncated: false,
    text: 'My article\nHello world.',
    tabId: 7,
    documentId: 'doc-a',
  })
  expect(await controller.resolveAttachment(attachment.token, 'workspace-a')).toEqual(attachment)
  tab = { ...tab, url: 'https://example.org/next' }
  await controller.invalidate(7)
  await expect(controller.resolveAttachment(attachment.token, 'workspace-a')).rejects.toThrow('失效')
  runtime.dispose()
})

it('matches bilingual translations by block ID and restores only owned translations without replacing page edits', async () => {
  document.body.innerHTML = '<main><p>First paragraph.</p><p>Second paragraph.</p><pre>do not translate code</pre></main>'
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)) },
  }
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions: { contains: async () => true },
    fetch: async (_url, init) => {
      const messages = JSON.parse(init!.body as string).messages
      const blocks = JSON.parse(messages.at(-1).content).blocks
      expect(blocks.map((block: { text: string }) => block.text)).toEqual(['First paragraph.', 'Second paragraph.'])
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        translations: [{ id: blocks[1].id, text: '第二段' }, { id: blocks[0].id, text: '<img data-translation-xss>第一段' }],
      }) } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', key: 'fixture', models: ['fixture'], remember: false })
  const runtime = new PageContentRuntime(document)
  const controller = new PageContextController({
    tabs: { query: async () => [{ id: 8, url: 'https://example.org/article', title: 'Article' }] },
    permissions: { contains: async () => true },
    injection: { connect: async () => ({ documentId: 'article', request: async message => runtime.handle(message) }) },
    assistant,
  })
  const client = new PageContextClient({
    sendMessage: async message => handlePageContextMessage(controller, message, {
      id: 'oneweb',
      url: 'chrome-extension://oneweb/dist/sidebar/index.html',
      documentId: 'workspace-a',
    }, 'oneweb', 'chrome-extension://oneweb/'),
  })
  await client.translatePage('zh-CN')
  await vi.waitFor(async () => expect(await client.translationStatus()).toMatchObject({ status: 'completed', completed: 2, total: 2 }))
  const paragraphs = document.querySelectorAll('main > p')
  expect(paragraphs[0].textContent).toBe('First paragraph.')
  expect(paragraphs[0].nextElementSibling?.textContent).toBe('<img data-translation-xss>第一段')
  expect(paragraphs[1].nextElementSibling?.textContent).toBe('第二段')
  expect(document.querySelector('[data-translation-xss]')).toBeNull()
  paragraphs[0].textContent = 'Updated by page.'
  document.querySelector('main')!.append(document.createTextNode('New live content.'))
  await client.restorePage()
  expect(document.querySelectorAll('[data-oneweb-translation]')).toHaveLength(0)
  expect(document.querySelector('main')?.textContent).toBe('Updated by page.Second paragraph.do not translate codeNew live content.')
  runtime.dispose()
})

it('does not insert a late translation after the user stops during final page authorization', async () => {
  document.body.innerHTML = '<main><p>Original paragraph.</p></main>'
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)) },
  }
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions: { contains: async () => true },
    fetch: async (_url, init) => {
      const blocks = JSON.parse(JSON.parse(init!.body as string).messages.at(-1).content).blocks
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        translations: [{ id: blocks[0].id, text: '不应插入的迟到译文' }],
      }) } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', key: 'fixture', models: ['fixture'], remember: false })
  let checks = 0
  let waiting = false
  let finishAuthorization = () => {}
  const runtime = new PageContentRuntime(document)
  const controller = new PageContextController({
    tabs: { query: async () => [{ id: 8, url: 'https://example.org/article', title: 'Article' }] },
    permissions: { contains: async () => {
      if (++checks === 2) {
        waiting = true
        await new Promise<void>((resolve) => {
          finishAuthorization = resolve
        })
      }
      return true
    } },
    injection: { connect: async () => ({ documentId: 'article', request: async message => runtime.handle(message) }) },
    assistant,
  })
  const client = new PageContextClient({
    sendMessage: async message => handlePageContextMessage(controller, message, {
      id: 'oneweb',
      url: 'chrome-extension://oneweb/dist/sidebar/index.html',
      documentId: 'workspace-a',
    }, 'oneweb', 'chrome-extension://oneweb/'),
  })
  await client.translatePage('zh-CN')
  await vi.waitFor(() => expect(waiting).toBe(true))
  await client.stopTranslation()
  finishAuthorization()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(await client.translationStatus()).toMatchObject({ status: 'cancelled', completed: 0 })
  expect(document.querySelectorAll('[data-oneweb-translation]')).toHaveLength(0)
  document.querySelector('p')!.textContent = 'Page edited after stop.'
  await client.restorePage()
  expect(document.querySelector('main')!.textContent).toBe('Page edited after stop.')
  runtime.dispose()
})

it('freezes an editor selection, previews without writing and refuses to replace text changed by the page', async () => {
  document.body.innerHTML = '<textarea aria-label="draft">Hello world!</textarea>'
  const input = document.querySelector('textarea')!
  input.focus()
  input.setSelectionRange(6, 11)
  const runtime = new PageContentRuntime(document)
  const controller = new PageContextController({
    tabs: { query: async () => [{ id: 8, url: 'https://example.org/editor', title: 'Editor' }] },
    permissions: { contains: async () => true },
    injection: { connect: async () => ({ documentId: 'editor', request: async message => runtime.handle(message) }) },
  })
  const client = new PageContextClient({
    sendMessage: async message => handlePageContextMessage(controller, message, {
      id: 'oneweb',
      url: 'chrome-extension://oneweb/dist/sidebar/index.html',
      documentId: 'workspace-a',
    }, 'oneweb', 'chrome-extension://oneweb/'),
  })
  const first = await client.readSelection()
  expect(first).toMatchObject({ text: 'world', type: 'selection', editable: true })
  expect(input.value).toBe('Hello world!')
  await client.applyWritingResult(first.token, '世界')
  expect(input.value).toBe('Hello 世界!')
  input.setSelectionRange(0, 5)
  const second = await client.readSelection()
  input.value = 'User changed the whole draft'
  await expect(client.applyWritingResult(second.token, '你好')).rejects.toThrow('已变化')
  expect(input.value).toBe('User changed the whole draft')
  runtime.dispose()
})

it('skips hidden article ancestors, bounds UTF-8 context and expires captures without retaining revoked access', async () => {
  document.body.innerHTML = `<div hidden><main>hidden parent secret</main></div><article><p>Visible text.</p><p>${'界'.repeat(30000)}</p><input type="password" value="password-secret"></article>`
  const runtime = new PageContentRuntime(document)
  let now = 0
  let granted = true
  const controller = new PageContextController({
    now: () => now,
    tabs: { query: async () => [{ id: 9, url: 'https://example.org/bounded?private=yes#token', title: '😀'.repeat(600) }] },
    permissions: { contains: async () => granted },
    injection: { connect: async () => ({ documentId: 'bounded', request: async message => runtime.handle(message) }) },
  })
  const capture = await controller.captureCurrentPage('owner')
  expect(capture.text).toMatch(/^Visible text\./)
  expect(capture.text).not.toContain('hidden parent secret')
  expect(capture.text).not.toContain('password-secret')
  expect(new TextEncoder().encode(capture.text).byteLength).toBeLessThanOrEqual(65536)
  expect(capture.truncated).toBe(true)
  expect(Array.from(capture.title)).toHaveLength(512)
  now = 600001
  await expect(controller.resolveAttachment(capture.token, 'owner')).rejects.toThrow('失效')
  const next = await controller.captureCurrentPage('owner')
  granted = false
  await expect(controller.resolveAttachment(next.token, 'owner')).rejects.toThrow('失效')
  runtime.dispose()
})

it('inserts plain text into a native contenteditable and refuses an editor selection that moved', async () => {
  document.body.innerHTML = '<div contenteditable="true">Hello <strong>world</strong>!</div>'
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!
  const select = (node: Node, start: number, end: number) => {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  }
  const runtime = new PageContentRuntime(document)
  const controller = new PageContextController({
    tabs: { query: async () => [{ id: 9, url: 'https://example.org/editor', title: 'Editor' }] },
    permissions: { contains: async () => true },
    injection: { connect: async () => ({ documentId: 'editable', request: async message => runtime.handle(message) }) },
  })
  select(editor.querySelector('strong')!.firstChild!, 0, 5)
  const first = await controller.captureCurrentPage('owner', true)
  await controller.applyWritingResult(first.token, '<b>世界</b>', 'owner')
  expect(editor.textContent).toBe('Hello <b>世界</b>!')
  expect(editor.querySelector('b')).toBeNull()
  select(editor.firstChild!, 0, 5)
  const second = await controller.captureCurrentPage('owner', true)
  select(editor.firstChild!, 1, 4)
  await expect(controller.applyWritingResult(second.token, '你好', 'owner')).rejects.toThrow('选区已变化')
  expect(editor.textContent).toBe('Hello <b>世界</b>!')
  runtime.dispose()
})
