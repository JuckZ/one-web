import { PageContentRuntime } from '~/assistantContent/runtime'
/* eslint no-template-curly-in-string: off -- Prompt placeholders are literal text, not JavaScript interpolation. */
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { AssistantClient, handleAssistantMessage } from '~/modules/builtin/assistant/protocol'
import { handlePageContextMessage, PageContextClient, PageContextController } from '~/workspace/page-context'
import { AssistantView } from '../assistant-view'

function storage() {
  const entries: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: structuredClone(entries[key]) }),
    set: async (value: Record<string, unknown>) => { Object.assign(entries, structuredClone(value)) },
  }
}

it('preserves a draft through first configuration and renders an untrusted answer as text', async () => {
  let permitted = false
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => permitted },
    fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '<img src=x data-model-xss>安全文本' } }],
    }), { headers: { 'Content-Type': 'application/json' } }),
  })
  const client = new AssistantClient({
    sendMessage: async message => handleAssistantMessage(controller, message, {
      id: 'test',
      url: 'chrome-extension://test/sidebar.html',
      documentId: 'ui',
    }, 'test', 'chrome-extension://test/'),
  })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new AssistantView(root, {
    client,
    permissions: { request: async () => {
      permitted = true
      return true
    } },
  })
  await view.open('assistant')
  const fill = (label: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  fill('消息', '保留这份草稿')
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[data-testid="assistant-configuration"]')).not.toBeNull())
  fill('服务地址', 'https://model.example/v1/')
  fill('模型（每行一个）', 'fixture')
  fill('API key', 'test-key')
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-save-provider"]')!.click()
  await vi.waitFor(() => expect(root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')?.value).toBe('保留这份草稿'))
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('<img src=x data-model-xss>安全文本'))
  expect(root.querySelector('[data-model-xss]')).toBeNull()
  expect(root.querySelector('[data-testid="assistant-status"]')?.textContent).toContain('已完成')
  view.dispose()
})

it('returns inline configuration to the current draft and delegates only the settings route to its host', async () => {
  const fetch = vi.fn()
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => false },
    fetch,
  })
  const client = new AssistantClient({
    sendMessage: async message => handleAssistantMessage(controller, message, {
      id: 'test',
      url: 'chrome-extension://test/sidebar.html',
      documentId: 'ui',
    }, 'test', 'chrome-extension://test/'),
  })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  let view: AssistantView
  const onDraftReturn = vi.fn(async () => view.open('reading'))
  view = new AssistantView(root, { client, permissions: { request: async () => false }, onDraftReturn })
  await view.open('reading')
  const input = root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!
  input.value = '保留阅读草稿'
  input.dispatchEvent(new Event('input'))
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[data-testid="assistant-back"]')).not.toBeNull())
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-back"]')!.click()
  await vi.waitFor(() => expect(root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')?.value).toBe('保留阅读草稿'))
  expect(root.querySelector('h1')?.textContent).toBe('阅读与理解')
  expect(onDraftReturn).not.toHaveBeenCalled()
  await view.open('settings')
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-back"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('h1')?.textContent).toBe('阅读与理解'))
  expect(root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')?.value).toBe('保留阅读草稿')
  expect(onDraftReturn).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
  view.dispose()
})

it('imports subtitles and sends them with a user-authored prompt selected in the reading workspace', async () => {
  const sent: Array<{ role: string, content: string }> = []
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    fetch: async (_url, init) => {
      sent.push(...JSON.parse(init!.body as string).messages)
      return new Response(JSON.stringify({ choices: [{ message: { content: '字幕摘要' } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const client = new AssistantClient({
    sendMessage: async message => handleAssistantMessage(controller, message, {
      id: 'test',
      url: 'chrome-extension://test/sidebar.html',
      documentId: 'ui',
    }, 'test', 'chrome-extension://test/'),
  })
  await client.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new AssistantView(root, {
    client,
    permissions: { request: async () => true },
    readFile: async () => '1\n00:00:00,000 --> 00:00:02,000\nKnown subtitle content.\n',
  })
  const fill = (label: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
    expect(input, label).not.toBeNull()
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  await view.open('settings')
  fill('提示词名称', '整理字幕')
  fill('提示词模板', '用 ${language} 整理字幕；用户要求：${text}')
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-save-prompt"]')!.click()
  await vi.waitFor(async () => expect(await client.listPrompts()).toHaveLength(1))
  await view.open('reading')
  const file = root.querySelector<HTMLInputElement>('[aria-label="导入文本或字幕"]')!
  Object.defineProperty(file, 'files', { value: [new File(['fixture'], 'captions.srt')] })
  file.dispatchEvent(new Event('change'))
  await vi.waitFor(() => expect(root.textContent).toContain('captions.srt'))
  const prompt = root.querySelector<HTMLSelectElement>('[aria-label="提示词"]')!
  prompt.value = (await client.listPrompts())[0].id
  prompt.dispatchEvent(new Event('change'))
  fill('消息', '保留重点')
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('字幕摘要'))
  expect(sent[0].content).toContain('用 zh-CN 整理字幕；用户要求：保留重点')
  expect(sent[1].content).toContain('Known subtitle content.')
  view.dispose()
})

it('manages prompt edits and order and requires an explicit confirmation before clearing local history', async () => {
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '本机回答' } }] }), { headers: { 'Content-Type': 'application/json' } }),
  })
  const client = new AssistantClient({
    sendMessage: async message => handleAssistantMessage(controller, message, {
      id: 'test',
      url: 'chrome-extension://test/sidebar.html',
      documentId: 'ui',
    }, 'test', 'chrome-extension://test/'),
  })
  await client.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  await client.savePrompt({ title: '第一', template: 'one' })
  await client.savePrompt({ title: '第二', template: 'two' })
  const request = await client.start({ intent: 'chat', text: '需要清理的历史', modelId: 'fixture' })
  await vi.waitFor(async () => expect((await client.openConversation(request.conversationId)).messages.at(-1)?.status).toBe('completed'))
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new AssistantView(root, { client, permissions: { request: async () => true } })
  await view.open('settings')
  root.querySelector<HTMLButtonElement>('[aria-label="编辑提示词 第二"]')!.click()
  root.querySelector<HTMLInputElement>('[aria-label="提示词名称"]')!.value = '改后的提示词'
  root.querySelector<HTMLTextAreaElement>('[aria-label="提示词模板"]')!.value = 'Updated template'
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-save-prompt"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[aria-label="上移提示词 改后的提示词"]')).not.toBeNull())
  expect((await client.listPrompts()).map(item => item.title)).toEqual(['第一', '改后的提示词'])
  root.querySelector<HTMLButtonElement>('[aria-label="上移提示词 改后的提示词"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('.assistant-prompt-row strong')?.textContent).toBe('改后的提示词'))
  expect((await client.listPrompts()).map(item => item.title)).toEqual(['改后的提示词', '第一'])
  root.querySelector<HTMLButtonElement>('[aria-label="删除提示词 第一"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[aria-label="删除提示词 第一"]')).toBeNull())
  expect(await client.listPrompts()).toHaveLength(1)
  const history = root.querySelector<HTMLInputElement>('[aria-label="保存本机对话历史"]')!
  history.checked = false
  history.dispatchEvent(new Event('change'))
  await vi.waitFor(async () => expect(await client.preferences()).toEqual({ historyEnabled: false }))
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-clear-history"]')!.click()
  expect(await client.listConversations()).toHaveLength(1)
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-confirm-clear-history"]')!.click()
  await vi.waitFor(async () => expect(await client.listConversations()).toEqual([]))
  view.dispose()
})

it('keeps IME Enter local and retries a failed response only after the user clicks retry', async () => {
  let requests = 0
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    fetch: async () => {
      requests++
      return requests === 1
        ? new Response('', { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '重试成功' } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const client = new AssistantClient({
    sendMessage: async message => handleAssistantMessage(controller, message, {
      id: 'test',
      url: 'chrome-extension://test/sidebar.html',
      documentId: 'ui',
    }, 'test', 'chrome-extension://test/'),
  })
  await client.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new AssistantView(root, { client, permissions: { request: async () => true } })
  await view.open('assistant')
  const input = root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!
  input.value = '中文输入'
  input.dispatchEvent(new Event('input'))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(requests).toBe(0)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(root.querySelector('[data-testid="assistant-status"]')?.textContent).toContain('429'))
  expect(requests).toBe(1)
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-retry"]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('重试成功'))
  expect(requests).toBe(2)
  view.dispose()
})

it('keeps a new conversation empty when the previous browser message arrives late', async () => {
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '旧回答' } }] }), { headers: { 'Content-Type': 'application/json' } }),
  })
  let release = () => {}
  let delayed = false
  const client = new AssistantClient({
    sendMessage: async (message) => {
      const result = await handleAssistantMessage(controller, message, {
        id: 'test',
        url: 'chrome-extension://test/sidebar.html',
        documentId: 'ui',
      }, 'test', 'chrome-extension://test/')
      if ((message as { command?: string }).command === 'open' && !delayed) {
        delayed = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return result
    },
  })
  await client.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new AssistantView(root, { client, permissions: { request: async () => true } })
  await view.open('assistant')
  const input = root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!
  input.value = '旧问题'
  input.dispatchEvent(new Event('input'))
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(delayed).toBe(true))
  await view.newConversation()
  release()
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(root.textContent).not.toContain('旧问题')
  expect(root.textContent).not.toContain('旧回答')
  expect(root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!.value).toBe('')
  view.dispose()
})

it('preserves a handed-off explanation intent for the first send and then permits ordinary follow-up', async () => {
  const instructions: string[] = []
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    fetch: async (_url, init) => {
      instructions.push(JSON.parse(init!.body as string).messages[0].content)
      return new Response(JSON.stringify({ choices: [{ message: { content: '已回答' } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const client = new AssistantClient({
    sendMessage: async message => handleAssistantMessage(controller, message, {
      id: 'test',
      url: 'chrome-extension://test/sidebar.html',
      documentId: 'ui',
    }, 'test', 'chrome-extension://test/'),
  })
  await client.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new AssistantView(root, { client, permissions: { request: async () => true } })
  await view.open('assistant')
  await view.acceptDraft({ draft: '解释这段术语', intent: 'explain' })
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[data-testid="assistant-status"]')?.textContent).toBe('已完成'))
  expect(instructions[0]).toContain('Explain the supplied text in zh-CN')
  const input = root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!
  input.value = '继续聊一聊'
  input.dispatchEvent(new Event('input'))
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(instructions).toHaveLength(2))
  expect(instructions[1]).toContain('Answer the user clearly and accurately')
  view.dispose()
})

it('offers editor replacement only for the answer generated from the current frozen selection', async () => {
  document.body.innerHTML = '<textarea id="editor-a">First original</textarea><textarea id="editor-b">Second original</textarea>'
  const runtime = new PageContentRuntime(document)
  const page = new PageContextController({
    tabs: { query: async () => [{ id: 1, url: 'https://example.org/editor', title: 'Editor' }] },
    permissions: { contains: async () => true },
    injection: { connect: async () => ({ documentId: 'editor', request: async message => runtime.handle(message) }) },
  })
  const sender = { id: 'test', url: 'chrome-extension://test/sidebar.html', documentId: 'ui' }
  const pageClient = new PageContextClient({
    sendMessage: async message => handlePageContextMessage(page, message, sender, 'test', 'chrome-extension://test/'),
  })
  let answers = 0
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    resolveAttachment: (token, owner) => page.resolveAttachment(token, owner),
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: ++answers === 1 ? 'First revised' : 'Second revised' } }] }), { headers: { 'Content-Type': 'application/json' } }),
  })
  const client = new AssistantClient({
    sendMessage: async message => handleAssistantMessage(controller, message, sender, 'test', 'chrome-extension://test/'),
  })
  await client.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const root = document.createElement('section')
  document.body.append(root)
  const view = new AssistantView(root, { client, pageContext: pageClient, permissions: { request: async () => true } })
  await view.open('writing')
  const attach = async (id: string) => {
    const editor = document.querySelector<HTMLTextAreaElement>(id)!
    editor.focus()
    editor.select()
    view.setAttachment(await pageClient.readSelection())
  }
  const send = async (answer: string) => {
    const input = root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!
    input.value = '改写当前选文'
    input.dispatchEvent(new Event('input'))
    root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('.assistant-message:last-child .assistant-message-text')?.textContent).toBe(answer))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="assistant-status"]')?.textContent).toBe('已完成'))
  }
  await attach('#editor-a')
  await send('First revised')
  expect(root.querySelectorAll('[data-testid="assistant-apply"]')).toHaveLength(1)
  await attach('#editor-b')
  expect(root.querySelectorAll('[data-testid="assistant-apply"]')).toHaveLength(0)
  await send('Second revised')
  expect(root.querySelectorAll('[data-testid="assistant-apply"]')).toHaveLength(1)
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-apply"]')!.click()
  await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('#editor-b')!.value).toBe('Second revised'))
  expect(document.querySelector<HTMLTextAreaElement>('#editor-a')!.value).toBe('First original')
  view.dispose()
  runtime.dispose()
})

it('keeps the draft sendable after the first conversation reply is lost in browser transport', async () => {
  let requests = 0
  const controller = new AssistantController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    fetch: async () => {
      requests++
      return new Response(JSON.stringify({ choices: [{ message: { content: '可恢复的回答' } }] }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  let interrupt = true
  const client = new AssistantClient({
    sendMessage: async (message) => {
      const result = await handleAssistantMessage(controller, message, {
        id: 'test',
        url: 'chrome-extension://test/sidebar.html',
        documentId: 'ui',
      }, 'test', 'chrome-extension://test/')
      if ((message as { command?: string }).command === 'open' && interrupt) {
        interrupt = false
        throw new Error('浏览器连接暂时中断')
      }
      return result
    },
  })
  await client.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new AssistantView(root, { client, permissions: { request: async () => true } })
  await view.open('assistant')
  const input = root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!
  input.value = '连接恢复后再发送'
  input.dispatchEvent(new Event('input'))
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(root.textContent).toContain('浏览器连接暂时中断'))
  expect(root.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!.value).toBe('连接恢复后再发送')
  expect(requests).toBe(1)
  root.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[data-testid="assistant-status"]')?.textContent).toBe('已完成'))
  expect(requests).toBe(2)
  view.dispose()
})
