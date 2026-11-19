import { afterEach, expect, it, vi } from 'vitest'
import { VideoDubbingView } from '~/sidebar/video-dubbing-view'
import { VideoDubbingController } from '../controller'
import { createDubbingInjection } from '../injection'
import { DubbingClient, handleDubbingMessage } from '../protocol'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  delete (window as any).__INITIAL_STATE__
})

function platform(url: string, state: unknown) {
  let currentUrl = url
  let saved: Record<string, unknown> = {}
  vi.stubGlobal('location', new URL(url))
  ;(window as any).__INITIAL_STATE__ = state
  document.body.innerHTML = '<div class="bpx-player-container"><video src="https://media.example.org/video.webm"></video></div>'
  const messages: any[] = []
  let receive!: (_message: unknown) => void
  let disconnected = false
  const grants = new Set(['https://www.bilibili.com/*', 'https://api.bilibili.com/*'])
  const tabs = {
    async query() { return [{ id: 42, url: currentUrl }] },
    async get() { return { id: 42, url: currentUrl } },
  }
  const injection = createDubbingInjection({
    async executeScript(details) {
      return [{ frameId: 0, documentId: 'doc', result: details.func ? await details.func() : undefined }]
    },
  }, tabs)
  const controller = new VideoDubbingController({
    extensionId: 'oneweb',
    registry: { async get() { return { enabled: true } } },
    storage: {
      async get() { return saved },
      async set(value) { saved = { ...saved, ...value } },
      async remove(key) { delete saved[key] },
    },
    permissions: { async contains({ origins }) { return origins.every(origin => grants.has(origin)) } },
    tabs,
    injection,
  })
  const client = new DubbingClient({
    sendMessage: async message => handleDubbingMessage(
      controller,
      message,
      { id: 'oneweb', url: 'chrome-extension://oneweb/sidebar.html' },
      'oneweb',
      'chrome-extension://oneweb/',
    ),
  })
  return {
    client,
    controller,
    messages,
    grants,
    navigate(value: string) { currentUrl = value },
    async connect(senderUrl = currentUrl, documentId = 'doc') {
      await controller.acceptPort({
        name: 'oneweb.video-dubbing.player.v1',
        sender: { id: 'oneweb', tab: { id: 42 }, frameId: 0, documentId, url: senderUrl },
        postMessage(message) { messages.push(message) },
        disconnect() { disconnected = true },
        onMessage: { addListener(listener) { receive = listener } },
        onDisconnect: { addListener() {} },
      })
    },
    receive(message: unknown) { receive(message) },
    disconnected: () => disconnected,
  }
}

const state = {
  videoData: {
    bvid: 'BV1xx411c7mD',
    aid: 123,
    title: 'Bilibili fixture',
    pages: [{ page: 1, cid: 1001 }, { page: 2, cid: 1002 }],
  },
}

it('opens the selected Bilibili part and binds its content connection through the real injection (T2)', async () => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, data: { cid: 1002, subtitle: { subtitles: [] } } })))
  const opened = await app.client.request('open')
  expect(opened.player).toMatchObject({ videoId: 'bilibili:BV1xx411c7mD:2', title: 'Bilibili fixture', tracks: [] })
  await app.connect()
  expect(app.messages[0]).toMatchObject({ type: 'bound', binding: { videoId: 'bilibili:BV1xx411c7mD:2' } })
  app.controller.invalidate()
})

const config = {
  translation: { baseUrl: 'https://translation.example.org/v1/', key: 'PRIVATE-T', model: 'translate' },
  speech: { baseUrl: 'https://speech.example.org/v1/', key: 'PRIVATE-S', model: 'speech', voice: 'alloy' },
}
async function configure(app: ReturnType<typeof platform>) {
  app.grants.add('https://translation.example.org/*')
  app.grants.add('https://speech.example.org/*')
  await app.client.request('save', { config })
}

it('loads the current Bilibili part subtitle only after its exact CDN permission and normalizes seconds (T2)', async () => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: string, options: RequestInit) => {
    requests.push(input)
    expect(options.redirect).toBe('error')
    if (input.startsWith('https://api.bilibili.com/x/player/wbi/v2?')) {
      expect(new URL(input).searchParams.get('cid')).toBe('1002')
      expect(options.credentials).toBe('include')
      return new Response(JSON.stringify({ code: 0, data: { cid: 1002, subtitle: { subtitles: [
        { id: 7, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/fixture.json?auth_key=a%2Fb' },
      ] } } }))
    }
    expect(options.credentials).toBe('omit')
    return new Response(JSON.stringify({ body: [{ from: 1.25, to: 3.5, content: 'Hello Bilibili' }] }))
  })
  await configure(app)
  const opened = await app.client.request('open')
  expect(opened.player?.tracks[0]).toMatchObject({ id: 'bili-7', label: 'English', language: 'en' })
  await app.connect()
  await expect(app.client.request('start', { language: 'zh-CN', trackId: 'bili-7' })).rejects.toThrow('字幕源')
  expect(requests).toHaveLength(1)
  app.grants.add('https://aisubtitle.hdslb.com/*')
  await app.client.request('start', { language: 'zh-CN', trackId: 'bili-7' })
  expect(requests[1]).toBe('https://aisubtitle.hdslb.com/bfs/subtitle/fixture.json?auth_key=a%2Fb')
  expect(app.messages.at(-1)).toMatchObject({
    type: 'start',
    cues: [{ id: 'bili-1', startMs: 1250, endMs: 3500, sourceText: 'Hello Bilibili' }],
  })
  expect(JSON.stringify(app.messages)).not.toMatch(/PRIVATE-|auth_key/)
  app.controller.invalidate()
})

it('requests Bilibili API and selected subtitle CDN grants from explicit management clicks (T3)', async () => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  app.grants.delete('https://api.bilibili.com/*')
  vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url.includes('api.bilibili.com')
    ? { code: 0, data: { cid: 1002, subtitle: { subtitles: [
        { id: 7, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/fixture.json' },
      ] } } }
    : { body: [{ from: 0, to: 2, content: 'Hello Bilibili' }] })))
  await configure(app)
  const requests: string[][] = []
  const view = new VideoDubbingView(document.createElement('section'), {
    client: app.client,
    permissions: { async request({ origins }) {
      requests.push(origins)
      origins.forEach(origin => app.grants.add(origin))
      return true
    } },
  })
  const click = async (action: string) => {
    ;(view.root.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click()
    await vi.waitFor(() => expect(view.root.getAttribute('aria-busy')).toBe('false'))
  }
  try {
    await vi.waitFor(() => expect(view.root.textContent).toContain('请授权并读取视频'))
    await click('open')
    expect(requests[0]).toEqual(['https://www.bilibili.com/*', 'https://api.bilibili.com/*'])
    expect(view.root.textContent).toContain('English')
    await app.connect()
    await click('start')
    expect(requests[1]).toEqual(['https://aisubtitle.hdslb.com/*'])
    expect(app.messages.at(-1)).toMatchObject({ type: 'start', cues: [{ sourceText: 'Hello Bilibili' }] })
  }
  finally {
    view.destroy()
    app.controller.invalidate()
  }
})

it('binds a single top-level HTML5 video on other HTTPS sites and starts an imported timeline without platform requests (T2)', async () => {
  const app = platform('https://course.example.org/lessons/one', null)
  app.grants.add('https://course.example.org/*')
  document.title = 'Course lesson'
  vi.stubGlobal('fetch', () => {
    throw new Error('Import must not request platform metadata')
  })
  await configure(app)
  const opened = await app.client.request('open')
  expect(opened.player).toMatchObject({
    videoId: 'html5:https://course.example.org/lessons/one',
    title: 'Course lesson',
    tracks: [],
  })
  await app.connect()
  await app.client.request('start', { language: 'zh-CN', subtitles: '1\n00:00:00,000 --> 00:00:02,000\nCourse intro' })
  expect(app.messages.at(-1)).toMatchObject({ type: 'start', cues: [{ sourceText: 'Course intro' }] })
  app.controller.invalidate()
})

it('invalidates the old Bilibili part before accepting another start or showing its imported subtitle (T2)', async () => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, data: { cid: 1002 } })))
  await configure(app)
  await app.client.request('open')
  await app.connect()
  await app.client.request('start', { language: 'zh-CN', subtitles: '1\n00:00:00,000 --> 00:00:02,000\nPart two' })
  app.navigate('https://www.bilibili.com/video/BV1xx411c7mD/?p=1')
  expect((await app.client.request('status')).player).toBeNull()
  expect(app.disconnected()).toBe(true)
  await expect(app.client.request('start', { language: 'zh-CN', subtitles: '1\n00:00:00,000 --> 00:00:02,000\nPart two' }))
    .rejects
    .toThrow('读取当前视频')
})

it('does not inject after a Bilibili API grant is revoked while caption discovery is pending (T2)', async () => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  let finish!: (_response: Response) => void
  vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => {
    finish = resolve
  }))
  const opening = app.client.request('open')
  const outcome = opening.catch(error => error)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  app.grants.delete('https://api.bilibili.com/*')
  finish(new Response(JSON.stringify({ code: 0, data: { cid: 1002 } })))
  expect(await outcome).toBeInstanceOf(Error)
  expect((await app.client.request('status')).player).toBeNull()
  app.controller.invalidate()
})

it('reports a Bilibili page without a usable native video instead of claiming that it connected (T2)', async () => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  document.querySelector('video')!.remove()
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, data: { cid: 1002 } })))
  await expect(app.client.request('open')).rejects.toThrow('HTML5 视频')
})

it('reconnects a Bilibili SPA part using its verified document ID when Chrome reports the initial document URL (T2)', async () => {
  const initialUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2'
  const app = platform(initialUrl, state)
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, data: { cid: 1001 } })))
  app.navigate('https://www.bilibili.com/video/BV1xx411c7mD/?p=1')
  await app.client.request('open')
  await app.connect(initialUrl)
  expect(app.messages.at(-1)).toMatchObject({ type: 'bound', binding: { videoId: 'bilibili:BV1xx411c7mD:1' } })
  app.controller.invalidate()
})

it.each([
  'https://evil.example.org/bfs/subtitle/cue.json',
  'https://aisubtitle.hdslb.com.evil.org/bfs/subtitle/cue.json',
  'https://user:secret@aisubtitle.hdslb.com/bfs/subtitle/cue.json',
  'https://aisubtitle.hdslb.com/bfs/subtitle/cue.json#fragment',
  'http://aisubtitle.hdslb.com/bfs/subtitle/cue.json',
  'https://aisubtitle.hdslb.com/private/credential.json',
])('does not offer untrusted Bilibili caption URLs: %s (T2)', async (subtitleUrl) => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    code: 0,
    data: { cid: 1002, subtitle: { subtitles: [
      { id: 7, lan: 'en', lan_doc: 'English', subtitle_url: subtitleUrl },
    ] } },
  })))
  const opened = await app.client.request('open')
  expect(opened.player?.tracks).toEqual([])
  expect(opened.player?.captionNotice).toContain('导入')
  app.controller.invalidate()
})

it('resolves an AV video to its selected CID and keeps login-only subtitles as an import fallback (T2)', async () => {
  const app = platform('https://www.bilibili.com/video/av123/', state)
  vi.stubGlobal('fetch', async (url: string) => {
    expect(new URL(url).searchParams.get('aid')).toBe('123')
    expect(new URL(url).searchParams.get('cid')).toBe('1001')
    return new Response(JSON.stringify({ code: 0, data: { cid: 1001, need_login_subtitle: true } }))
  })
  await configure(app)
  const opened = await app.client.request('open')
  expect(opened.player?.captionNotice).toContain('需要网站登录')
  await app.connect()
  await app.client.request('start', { language: 'zh-CN', subtitles: '1\n00:00:00,000 --> 00:00:02,000\nImported without CC' })
  expect(app.messages.at(-1)).toMatchObject({ type: 'start', cues: [{ sourceText: 'Imported without CC' }] })
  app.controller.invalidate()
})

it.each(['missing', 'ambiguous', 'live'])('rejects an unusable generic HTML5 target: %s (T2)', async (kind) => {
  const app = platform('https://course.example.org/lesson/one', null)
  app.grants.add('https://course.example.org/*')
  if (kind === 'missing')
    document.querySelector('video')!.remove()
  if (kind === 'ambiguous')
    document.body.append(document.createElement('video'))
  if (kind === 'live')
    Object.defineProperty(document.querySelector('video'), 'duration', { value: Infinity })
  await expect(app.client.request('open')).rejects.toThrow(kind === 'live' ? '直播' : '唯一')
})

it.each([
  'http://example.org/video',
  'file:///tmp/video.html',
  'chrome://extensions/',
  'https://www.youtube.com/shorts/abc',
  'https://www.bilibili.com/bangumi/play/ep123',
])('does not treat unsupported or nonsecure pages as a supported platform: %s (T2)', async (url) => {
  const app = platform(url, state)
  expect((await app.client.request('status')).site).toBeNull()
})

it('clears an imported subtitle when the user rebinds a media player on the same generic page (T3)', async () => {
  const app = platform('https://course.example.org/lesson/one', null)
  app.grants.add('https://course.example.org/*')
  await configure(app)
  const view = new VideoDubbingView(document.createElement('section'), {
    client: app.client,
    permissions: { async request() { return true } },
  })
  const click = async (action: string) => {
    ;(view.root.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click()
    await vi.waitFor(() => expect(view.root.getAttribute('aria-busy')).toBe('false'))
  }
  try {
    await vi.waitFor(() => expect(view.root.textContent).toContain('请授权并读取视频'))
    await click('open')
    await app.connect()
    const file = view.root.querySelector('[aria-label="导入字幕"]')!
    Object.defineProperty(file, 'files', { value: [{
      name: 'old.srt',
      size: 80,
      async arrayBuffer() { return new TextEncoder().encode('1\n00:00:00,000 --> 00:00:02,000\nOld media').buffer },
    }] })
    file.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(view.root.textContent).toContain('已导入 old.srt'))
    app.controller.invalidate()
    await click('open')
    expect(view.root.textContent).not.toContain('已导入 old.srt')
    await app.connect()
    await click('start')
    expect(view.root.textContent).toContain('没有可用字幕')
  }
  finally {
    view.destroy()
    app.controller.invalidate()
  }
})

it('rejects a new Bilibili start immediately when its API permission is absent, before the removal event arrives (T2)', async () => {
  const app = platform('https://www.bilibili.com/video/BV1xx411c7mD/?p=2', state)
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, data: { cid: 1002 } })))
  await configure(app)
  await app.client.request('open')
  await app.connect()
  app.grants.delete('https://api.bilibili.com/*')
  await expect(app.client.request('start', { language: 'zh-CN', subtitles: '1\n00:00:00,000 --> 00:00:02,000\nNo authority' }))
    .rejects
    .toThrow('授权')
  expect(app.messages.at(-1).type).toBe('bound')
  app.controller.invalidate()
})
