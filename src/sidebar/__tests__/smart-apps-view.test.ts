/* eslint no-template-curly-in-string: off -- Prompt variables are fixture text. */
import { SmartAppsController } from '~/apps/controller'
import { handleSmartAppsMessage, SmartAppsClient } from '~/apps/protocol'
import { PAGE_CHANNEL } from '~/assistantContent/runtime'
import { AssistantClient } from '~/modules/builtin/assistant/protocol'
import { PageContextClient } from '~/workspace/page-context'
import { SmartAppsView } from '../smart-apps-view'

const captureFixture = 'capture-token'
const extensionBase = 'chrome-extension://fixture/'

function setup(assistantTransport?: { sendMessage: (_message: unknown) => Promise<unknown> }) {
  const data: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)) },
  }
  const controller = new SmartAppsController({ storage })
  const client = new SmartAppsClient({ sendMessage: async message => handleSmartAppsMessage(controller, message, { id: 'fixture', url: `${extensionBase}sidebar.html` }, 'fixture', extensionBase) })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new SmartAppsView(root, {
    client,
    assistant: new AssistantClient(assistantTransport ?? { sendMessage: async () => { throw new Error('No model request expected') } }),
    page: new PageContextClient({ sendMessage: async (message) => {
      const command = (message as { command: string }).command
      return { channel: PAGE_CHANNEL, ok: true, value: command === 'current'
        ? { title: 'Article', url: 'https://example.com/article', originPattern: 'https://example.com/*' }
        : { token: captureFixture, title: 'Article', url: 'https://example.com/article', text: 'x'.repeat(40000), type: 'page', capturedAt: Date.now(), truncated: false } }
    } }),
    permissions: { request: async () => false },
    sandboxUrl: `${extensionBase}sandbox.html`,
    openModule: async () => {},
    setModuleEnabled: async () => {},
    settings: async () => {},
  })
  return { root, view, client, storage }
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

function click(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label)
  expect(button, label).toBeDefined()
  button!.click()
}

function fill(root: HTMLElement, label: string, value: string) {
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
  expect(field).not.toBeNull()
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

it('creates both app forms, edits and disables them, and deletes only the confirmed app', async () => {
  const { root, view, client, storage } = setup()
  await view.open([])
  click(root, '＋ 新建智能工具')
  expect(root.querySelector('dialog')?.getAttribute('open')).not.toBeNull()
  const types = root.querySelectorAll<HTMLButtonElement>('.smart-app-type-card')
  expect(types).toHaveLength(2)
  types[0].click()
  fill(root, '工具名称', '网页重点')
  fill(root, '提示词', '总结 ${title}: ${text}')
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(root.querySelector('[aria-label="打开 网页重点"]')).not.toBeNull())
  expect(root.querySelector('dialog')).toBeNull()
  click(root, '＋ 新建智能工具')
  root.querySelectorAll<HTMLButtonElement>('.smart-app-type-card')[1].click()
  fill(root, '工具名称', '计数器')
  fill(root, '应用 HTML', '<button onclick="this.textContent=Number(this.textContent)+1">0</button>')
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(root.querySelector('[aria-label="打开 计数器"]')).not.toBeNull())
  expect((await new SmartAppsController({ storage }).list()).map(app => app.kind)).toEqual(['web-tool', 'mini-app'])
  // The application source remains data in the management view.
  expect(root.querySelector('[onclick]')).toBeNull()
  click(root, '启用 计数器')
  await vi.waitFor(() => expect(root.querySelector('[aria-label="启用 计数器"]')?.getAttribute('aria-checked')).toBe('false'))
  const miniRow = root.querySelector<HTMLElement>('[aria-label="打开 计数器"]')!.closest<HTMLElement>('article')!
  click(miniRow, '编辑')
  fill(root, '工具名称', '小计数器')
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(root.querySelector('[aria-label="打开 小计数器"]')).not.toBeNull())
  const row = root.querySelector<HTMLElement>('[aria-label="打开 小计数器"]')!.closest<HTMLElement>('article')!
  click(row, '删除')
  click(root, '保留应用')
  expect(await client.list()).toHaveLength(2)
  click(row, '删除')
  click(root, '确认删除')
  await vi.waitFor(async () => expect(await client.list()).toHaveLength(1))
  expect((await client.list())[0].name).toBe('网页重点')
  view.dispose()
})

it('shows validation errors in the creation dialog and keeps the draft', async () => {
  const { root, view, client } = setup()
  await view.open([])
  click(root, '＋ 新建智能工具')
  root.querySelectorAll<HTMLButtonElement>('.smart-app-type-card')[0].click()
  fill(root, '工具名称', '无效工具')
  fill(root, '提示词', '${window.secret}')
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(root.querySelector('dialog [role="status"]')?.textContent).toContain('变量仅支持'))
  expect(root.querySelector<HTMLTextAreaElement>('[aria-label="提示词"]')!.value).toBe('${window.secret}')
  expect(await client.list()).toEqual([])
  view.dispose()
})

function assistantTransport(onCommand?: (_command: string) => Promise<unknown>) {
  const commands: string[] = []
  return {
    commands,
    sendMessage: async (message: unknown) => {
      const { channel, command } = message as { channel: string, command: string }
      commands.push(command)
      let value: unknown
      if (command === 'configuration')
        value = { baseUrl: 'https://provider.example/v1/', models: ['fixture'], keyConfigured: true, remember: false }
      else
        value = await onCommand?.(command)
      return { channel, command, ok: true, value }
    },
  }
}

it('explains oversized expanded page prompts before starting a model request', async () => {
  const transport = assistantTransport()
  const { root, view, client } = setup(transport)
  await client.create({ kind: 'web-tool', name: '重复正文', prompt: '${text}\n${text}' })
  await view.open([])
  click(root, '打开 重复正文')
  await vi.waitFor(() => expect(root.textContent).toContain('运行当前网页'))
  click(root, '运行当前网页')
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toContain('超过 64 KiB'))
  expect(transport.commands).not.toContain('start')
  view.dispose()
})

it('cancels a streaming tool when reopening the library and rejects its late result', async () => {
  let resolveAnswer: (_value: unknown) => void = () => {}
  const pending = new Promise((resolve) => {
    resolveAnswer = resolve
  })
  const transport = assistantTransport(async (command) => {
    if (command === 'start')
      return { requestId: 'request', conversationId: 'conversation' }
    if (command === 'open')
      return pending
    return null
  })
  const { root, view, client } = setup(transport)
  await client.create({ kind: 'web-tool', name: '等待中的工具', prompt: 'Summarize ${title}' })
  await view.open([])
  click(root, '打开 等待中的工具')
  await vi.waitFor(() => expect(root.textContent).toContain('运行当前网页'))
  click(root, '运行当前网页')
  await vi.waitFor(() => expect(transport.commands).toContain('open'))
  await view.open([])
  expect(transport.commands).toContain('cancel')
  resolveAnswer({ messages: [{ role: 'assistant', status: 'completed', text: 'LATE ANSWER' }] })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(root.textContent).toContain('应用与工具')
  expect(root.textContent).not.toContain('LATE ANSWER')
  view.dispose()
})

it('closing the creator during model configuration lookup prevents a late request', async () => {
  let resolveConfiguration: (_value: unknown) => void = () => {}
  const pending = new Promise((resolve) => {
    resolveConfiguration = resolve
  })
  const commands: string[] = []
  const transport = { sendMessage: async (message: unknown) => {
    const { channel, command } = message as { channel: string, command: string }
    commands.push(command)
    return { channel, command, ok: true, value: await pending }
  } }
  const { root, view } = setup(transport)
  await view.open([])
  click(root, '＋ 新建智能工具')
  root.querySelectorAll<HTMLButtonElement>('.smart-app-type-card')[1].click()
  fill(root, '描述你想创建的应用', '计数器')
  click(root, '用 AI 生成')
  await vi.waitFor(() => expect(commands).toContain('configuration'))
  click(root, '关闭')
  resolveConfiguration({ models: ['fixture'], keyConfigured: true })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(commands).toEqual(['configuration'])
  expect(root.querySelector('dialog')).toBeNull()
  view.dispose()
})
