import { expect, it, vi } from 'vitest'
import { CONFIG_KEY } from '~/modules/builtin/video-dubbing/config'
import { DUBBING_PORT } from '~/modules/builtin/video-dubbing/contracts'
import { VideoDubbingController } from '~/modules/builtin/video-dubbing/controller'
import { DubbingClient, handleDubbingMessage } from '~/modules/builtin/video-dubbing/protocol'
import { VideoDubbingView } from '../video-dubbing-view'

it('saves user configuration through the real management protocol and clears credential inputs (T3)', async () => {
  let saved: Record<string, unknown> = {}
  const grants: string[][] = []
  const controller = new VideoDubbingController({
    extensionId: 'oneweb',
    registry: {
      async get() {
        return { enabled: true }
      },
    },
    storage: {
      async get() {
        return saved
      },
      async set(value) {
        saved = value
      },
      async remove() {
        saved = {}
      },
    },
    permissions: {
      async contains() {
        return true
      },
    },
    tabs: {
      async query() {
        return []
      },
      async get() {
        return {}
      },
    },
    injection: {
      async discover() {
        throw new Error('no tab')
      },
      async inject() {},
    },
  })
  const client = new DubbingClient({
    sendMessage: async message =>
      handleDubbingMessage(
        controller,
        message,
        { id: 'oneweb', url: 'chrome-extension://oneweb/sidebar.html' },
        'oneweb',
        'chrome-extension://oneweb/',
      ),
  })
  const view = new VideoDubbingView(document.createElement('section'), {
    client,
    permissions: {
      async request({ origins }) {
        grants.push(origins)
        return true
      },
    },
  })
  document.body.append(view.root)
  await new Promise(resolve => setTimeout(resolve, 0))
  const fill = (label: string, value: string) => {
    ;(view.root.querySelector(`[aria-label="${label}"]`) as HTMLInputElement).value = value
  }
  fill('翻译服务地址', 'https://api.example.org/v1/')
  fill('翻译模型', 'translator')
  fill('翻译 API key', 'SECRET-T')
  fill('语音服务地址', 'https://speech.example.org/v1/')
  fill('语音模型', 'speaker')
  fill('语音 API key', 'SECRET-S')
  fill('声音', 'alloy')
  ;(view.root.querySelector('[data-action="save"]') as HTMLButtonElement).click()
  expect(view.root.getAttribute('aria-busy')).toBe('true')
  expect((view.root.querySelector('[data-action="open"]') as HTMLButtonElement).disabled).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(grants).toEqual([['https://api.example.org/*', 'https://speech.example.org/*']])
  expect(view.root.getAttribute('aria-busy')).toBe('false')
  expect(view.root.textContent).toContain('配置已保存')
  expect((view.root.querySelector('[aria-label="翻译 API key"]') as HTMLInputElement).value).toBe('')
  expect(view.root.textContent).not.toContain('SECRET-T')
  view.destroy()
})

it('offers explicit playback actions and replaces failure feedback after a successful retry (T3)', async () => {
  const status = {
    configuration: null,
    site: { tabId: 1, origin: 'https://www.youtube.com', pattern: 'https://www.youtube.com/*', videoId: 'abc' },
    player: null,
    snapshot: null,
  }
  // Transport is the system boundary here; the production controller composition is covered above.
  const { DubbingClient: Client } = await import('~/modules/builtin/video-dubbing/protocol')
  const sent: any[] = []
  let startAllowed = false
  const client = new Client({
    async sendMessage(message: any) {
      sent.push(message)
      if (message.command === 'start' && !startAllowed)
        return { channel: message.channel, command: message.command, ok: false, error: '请配置并授权翻译和语音服务' }
      return { channel: message.channel, command: message.command, ok: true, value: status }
    },
  })
  const view = new VideoDubbingView(document.createElement('section'), {
    client,
    permissions: {
      async request() {
        return true
      },
    },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(view.root.querySelector('[aria-label="字幕轨道"]')).not.toBeNull()
  ;(view.root.querySelector('[data-action="open"]') as HTMLButtonElement).click()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(sent.some(message => message.command === 'open')).toBe(true)
  ;(view.root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(view.root.textContent).toContain('请配置并授权翻译和语音服务')
  expect(view.root.querySelector('[data-action="stop"]')).not.toBeNull()
  startAllowed = true
  ;(view.root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(view.root.textContent).not.toContain('请配置并授权翻译和语音服务')
  expect(view.root.querySelector('[role="status"]')?.getAttribute('data-state')).toBe('ready')
  view.destroy()
})

it('starts the same Bilibili video after a 45-second subtitle permission decision without losing the read session (T3)', async () => {
  vi.useFakeTimers()
  const url = 'https://www.bilibili.com/video/BV1xx411c7mD/'
  const videoId = 'bilibili:BV1xx411c7mD:1'
  const sent: unknown[] = []
  let disconnected = false
  let decide!: (_allowed: boolean) => void
  const permission = new Promise<boolean>(resolve => decide = resolve)
  let idle: ReturnType<typeof setTimeout> | undefined
  const controller = new VideoDubbingController({
    extensionId: 'oneweb',
    registry: { async get() { return { enabled: true } } },
    storage: {
      async get() {
        return {
          [CONFIG_KEY]: {
            translation: { baseUrl: 'http://127.0.0.1:8765/v1/', model: 'translator', key: 'TEST-T' },
            speech: { baseUrl: 'http://127.0.0.1:8766/v1/', model: 'windows-sapi', key: 'TEST-S', voice: 'huihui' },
          },
        }
      },
      async set() {},
      async remove() {},
    },
    permissions: { async contains() { return true } },
    tabs: {
      async query() { return [{ id: 1, url }] },
      async get() { return { id: 1, url } },
    },
    injection: {
      async discover() {
        return {
          videoId,
          documentId: 'doc',
          contentId: '1001',
          title: 'Bilibili permission fixture',
          tracks: [{
            id: 'bili-7',
            label: 'English',
            language: 'en',
            url: 'https://aisubtitle.hdslb.com/bfs/subtitle/fixture.json',
          }],
        }
      },
      async inject() {
        await controller.acceptPort({
          name: DUBBING_PORT,
          sender: { id: 'oneweb', tab: { id: 1 }, frameId: 0, documentId: 'doc', url },
          postMessage(message) { sent.push(message) },
          disconnect() { disconnected = true },
          onMessage: { addListener() {} },
          onDisconnect: { addListener() {} },
        })
      },
    },
  })
  // Model the browser's idle lifetime at the runtime transport boundary.
  const client = new DubbingClient({
    async sendMessage(message) {
      clearTimeout(idle)
      idle = setTimeout(() => controller.invalidate(), 30000)
      return handleDubbingMessage(
        controller,
        message,
        { id: 'oneweb', url: 'chrome-extension://oneweb/sidebar.html' },
        'oneweb',
        'chrome-extension://oneweb/',
      )
    },
  })
  let view: VideoDubbingView | undefined
  let subtitleRequested = false
  vi.stubGlobal('fetch', async () => {
    subtitleRequested = true
    return new Response(JSON.stringify({ body: [{ from: 0, to: 2, content: 'Hello Bilibili' }] }))
  })
  try {
    view = new VideoDubbingView(document.createElement('section'), {
      client,
      permissions: {
        async request({ origins }) {
          return origins.includes('https://aisubtitle.hdslb.com/*') ? permission : true
        },
      },
    })
    document.body.append(view.root)
    await vi.advanceTimersByTimeAsync(0)
    ;(view.root.querySelector('[data-action="open"]') as HTMLButtonElement).click()
    await vi.advanceTimersByTimeAsync(0)
    expect(view.root.textContent).toContain('Bilibili permission fixture')
    ;(view.root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    await vi.advanceTimersByTimeAsync(45000)
    expect(view.root.getAttribute('aria-busy')).toBe('true')
    expect(subtitleRequested).toBe(false)
    decide(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(view.root.getAttribute('aria-busy')).toBe('false')
    expect(sent).toContainEqual(expect.objectContaining({ type: 'start', binding: expect.objectContaining({ videoId }) }))
    expect(disconnected).toBe(false)
    expect(view.root.textContent).not.toContain('请先读取当前视频，等待播放器连接')
  }
  finally {
    view?.destroy()
    controller.invalidate()
    clearTimeout(idle)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})
