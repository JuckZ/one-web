import { afterEach, expect, it, vi } from 'vitest'
import { CONFIG_KEY } from '../config'
import { DUBBING_PORT } from '../contracts'
import { VideoDubbingController } from '../controller'
import { createDubbingInjection } from '../injection'
import { DubbingClient, handleDubbingMessage } from '../protocol'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.replaceChildren()
})

function youtube() {
  const url = 'https://www.youtube.com/watch?v=fixture'
  vi.stubGlobal('location', new URL(url))
  document.body.innerHTML = '<div id="movie_player"><video></video></div>'
  Object.assign(document.getElementById('movie_player')!, {
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'fixture', title: 'YouTube recovery fixture' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
        languageCode: 'en',
        kind: 'asr',
        name: { simpleText: 'English' },
        baseUrl: 'https://www.youtube.com/api/timedtext?v=fixture&lang=en&kind=asr',
      }] } },
    }),
  })
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    requests.push(input)
    return new Response(input.includes('native=1')
      ? JSON.stringify({
        events: [{ tStartMs: 1250, dDurationMs: 2250, segs: [{ utf8: 'Hello YouTube' }] }],
      })
      : '')
  })
  let granted = true
  const tabs = {
    async query() { return [{ id: 42, url }] },
    async get() { return { id: 42, url } },
  }
  const controller = new VideoDubbingController({
    extensionId: 'oneweb',
    registry: { async get() { return { enabled: true } } },
    storage: {
      async get() {
        return { [CONFIG_KEY]: {
          translation: { baseUrl: 'https://translation.example.org/v1/', model: 'translator', key: 'TEST-T' },
          speech: { baseUrl: 'https://speech.example.org/v1/', model: 'speech', key: 'TEST-S', voice: 'fixture' },
        } }
      },
      async set() {},
      async remove() {},
    },
    permissions: { async contains() { return granted } },
    tabs,
    injection: createDubbingInjection({
      async executeScript(details) {
        return [{ frameId: 0, documentId: 'doc', result: await details.func?.() }]
      },
    }, tabs),
  })
  const client = new DubbingClient({
    async sendMessage(message) {
      return handleDubbingMessage(controller, message, {
        id: 'oneweb',
        url: 'chrome-extension://oneweb/dist/sidebar/index.html',
      }, 'oneweb', 'chrome-extension://oneweb/')
    },
  })
  const sent: any[] = []
  let receive!: (_message: unknown) => void
  return {
    client,
    controller,
    sent,
    requests,
    receive(message: unknown) { receive(message) },
    async revoke() {
      granted = false
      await controller.permissionsChanged()
    },
    async connect() {
      await client.request('open')
      await controller.acceptPort({
        name: DUBBING_PORT,
        sender: { id: 'oneweb', tab: { id: 42 }, frameId: 0, documentId: 'doc', url },
        postMessage(message) { sent.push(message) },
        disconnect() {},
        onMessage: { addListener(listener) { receive = listener } },
        onDisconnect: { addListener() {} },
      })
    },
  }
}

it('recovers an empty subtitle only from the bound YouTube track and preserves its signed encoding (T2)', async () => {
  const app = youtube()
  try {
    await app.connect()
    const starting = app.client.request('start', { trackId: 'track-0', language: 'zh-CN' })
      .then(() => null, error => error)
    await vi.waitFor(() => expect(app.sent.some(message => message.type === 'refresh-captions')).toBe(true))
    for (const url of [
      'https://evil.example/api/timedtext?v=fixture&lang=en&kind=asr&native=1',
      'https://www.youtube.com/api/timedtext?v=other&lang=en&kind=asr&native=1',
      'https://www.youtube.com/api/timedtext?v=fixture&lang=ja&kind=asr&native=1',
      'https://www.youtube.com/api/timedtext?v=fixture&lang=en&kind=asr&tlang=zh&native=1',
    ])
      app.receive({ type: 'caption-request', url })
    expect(app.sent.some(message => message.type === 'start')).toBe(false)
    app.receive({
      type: 'caption-request',
      url: 'https://www.youtube.com/api/timedtext?v=fixture&lang=en&kind=asr&pot=fixture%2Ftoken&native=1',
    })
    expect(await starting).toBeNull()
    expect(app.sent.at(-1)).toMatchObject({
      type: 'start',
      cues: [{ startMs: 1250, endMs: 3500, sourceText: 'Hello YouTube' }],
    })
    expect(app.requests).toHaveLength(2)
    expect(app.requests[1]).toContain('pot=fixture%2Ftoken&native=1&fmt=json3')
  }
  finally {
    app.controller.invalidate()
  }
})

it.each(['stop', 'seek', 'navigation', 'permission'] as const)(
  'cancels pending YouTube recovery on %s and ignores a late native subtitle (T2)',
  async (action) => {
    const app = youtube()
    try {
      await app.connect()
      const result = app.client.request('start', { trackId: 'track-0', language: 'zh-CN' })
        .then(() => 'started', error => error.message)
      await vi.waitFor(() => expect(app.sent.some(message => message.type === 'refresh-captions')).toBe(true))
      if (action === 'stop')
        await app.client.request('stop')
      else if (action === 'seek')
        app.receive({ type: 'advance' })
      else if (action === 'permission')
        await app.revoke()
      else
        app.controller.invalidate(42)
      expect(await result).toMatch(/停止|切换/)
      app.receive({
        type: 'caption-request',
        url: 'https://www.youtube.com/api/timedtext?v=fixture&lang=en&kind=asr&native=1',
      })
      await Promise.resolve()
      expect(app.sent.some(message => message.type === 'start')).toBe(false)
      expect(app.requests).toHaveLength(1)
    }
    finally {
      app.controller.invalidate()
    }
  },
)

it('times out YouTube recovery without repeatedly refreshing CC or starting an empty timeline (T2)', async () => {
  vi.useFakeTimers()
  const app = youtube()
  try {
    await app.connect()
    const result = app.client.request('start', { trackId: 'track-0', language: 'zh-CN' })
      .then(() => 'started', error => error.message)
    await vi.waitFor(() => expect(app.sent.some(message => message.type === 'refresh-captions')).toBe(true))
    await vi.advanceTimersByTimeAsync(6000)
    expect(await result).toContain('请在 YouTube CC 选择所选轨道的语言')
    expect(app.sent.filter(message => message.type === 'refresh-captions')).toHaveLength(1)
    expect(app.sent.some(message => message.type === 'start')).toBe(false)
    expect(app.requests).toHaveLength(1)
  }
  finally {
    app.controller.invalidate()
  }
})
