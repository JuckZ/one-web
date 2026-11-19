import type { PlayerInfo } from '../contracts'
import { expect, it } from 'vitest'
import { VIDEO_DUBBING_MODULE_ID } from '../contracts'
import { VideoDubbingController } from '../controller'
import { DubbingClient, handleDubbingMessage } from '../protocol'

const extensionId = 'oneweb'
const sender = { id: extensionId, url: 'chrome-extension://oneweb/sidebar.html' }
function setup(deferredDiscovery?: Promise<PlayerInfo>) {
  let saved: Record<string, unknown> = {}
  let enabled = true
  let granted = true
  const sent: unknown[] = []
  const controller = new VideoDubbingController({
    extensionId,
    registry: {
      async get() {
        return { enabled }
      },
    },
    storage: {
      async get() {
        return saved
      },
      async set(value) {
        saved = { ...saved, ...value }
      },
      async remove(key) {
        delete saved[key]
      },
    },
    permissions: {
      async contains() {
        return granted
      },
    },
    tabs: {
      async query() {
        return [{ id: 42, url: 'https://www.youtube.com/watch?v=abc123' }]
      },
      async get() {
        return { id: 42, url: 'https://www.youtube.com/watch?v=abc123' }
      },
    },
    injection: {
      async discover() {
        if (deferredDiscovery)
          return deferredDiscovery
        return {
          documentId: 'doc',
          videoId: 'abc123',
          title: 'Demo',
          tracks: [
            {
              id: 'track-0',
              label: 'English',
              language: 'en',
              url: 'https://www.youtube.com/api/timedtext?v=abc123&lang=en',
            },
          ],
        }
      },
      async inject() {
        sent.push('injected')
      },
    },
  })
  const client = new DubbingClient({
    sendMessage: async message =>
      handleDubbingMessage(controller, message, sender, extensionId, 'chrome-extension://oneweb/'),
  })
  return {
    controller,
    client,
    sent,
    disable() {
      enabled = false
    },
    revoke() {
      granted = false
    },
  }
}
const config = {
  translation: { baseUrl: 'https://api.example.org/v1', key: 'TOPSECRET', model: 'translator' },
  speech: { baseUrl: 'https://speech.example.org/v1/', key: 'VOICESECRET', model: 'speaker', voice: 'alloy' },
}
it('saves only trusted local service config, redacts keys and injects only on explicit authorized open (T2)', async () => {
  const { client, controller, sent } = setup()
  const value = await client.request('save', { config })
  expect(JSON.stringify(value)).not.toContain('TOPSECRET')
  expect(JSON.stringify(await client.request('status'))).toContain('keyConfigured')
  expect(sent).toEqual([])
  await client.request('open')
  expect(sent).toEqual(['injected'])
  expect(controller.moduleId).toBe(VIDEO_DUBBING_MODULE_ID)
})

it('saves explicitly authorized Windows LAN services and returns their exact sources without keys (T2)', async () => {
  const { client, controller } = setup()
  const value = await client.request('save', {
    config: {
      translation: { ...config.translation, baseUrl: 'http://192.168.31.100:8765/v1' },
      speech: { ...config.speech, baseUrl: 'http://172.16.0.12:8766/v1/' },
    },
  })
  expect(value.configuration).toEqual({
    translation: {
      baseUrl: 'http://192.168.31.100:8765/v1/',
      model: 'translator',
      keyConfigured: true,
    },
    speech: {
      baseUrl: 'http://172.16.0.12:8766/v1/',
      model: 'speaker',
      voice: 'alloy',
      keyConfigured: true,
    },
  })
  expect(await controller.usesOriginPattern('http://192.168.31.100:8765/*')).toBe(true)
  expect(await controller.usesOriginPattern('http://172.16.0.12:8766/*')).toBe(true)
  expect(JSON.stringify(await client.request('status'))).not.toMatch(/TOPSECRET|VOICESECRET/)
  controller.invalidate()
})

it('keeps the configured LAN services when an unsafe HTTP address, missing key or missing source grant is rejected (T2)', async () => {
  const { client, controller, revoke } = setup()
  const lan = {
    translation: { ...config.translation, baseUrl: 'http://10.0.0.8:8765/v1/' },
    speech: { ...config.speech, baseUrl: 'http://192.168.31.100:8766/v1/' },
  }
  const saved = (await client.request('save', { config: lan })).configuration
  for (const baseUrl of [
    'http://11.0.0.1:8765/v1/',
    'http://172.15.255.255:8765/v1/',
    'http://172.32.0.0:8765/v1/',
    'http://192.167.255.255:8765/v1/',
    'http://192.169.0.0:8765/v1/',
    'http://8.8.8.8:8765/v1/',
    'http://100.64.0.1:8765/v1/',
    'http://169.254.1.1:8765/v1/',
    'http://workstation.local:8765/v1/',
    'http://192.168.31.100.evil.example:8765/v1/',
    'http://user:password@192.168.31.100:8765/v1/',
    'http://192.168.31.100:8765/v1/?key=secret',
    'http://192.168.31.100:8765/v1/#fragment',
  ]) {
    await expect(client.request('save', {
      config: { ...lan, translation: { ...lan.translation, baseUrl } },
    })).rejects.toThrow('服务')
    expect((await client.request('status')).configuration).toEqual(saved)
  }
  await expect(client.request('save', {
    config: { ...lan, translation: { ...lan.translation, baseUrl: 'http://10.0.0.9:8765/v1/', key: '' } },
  })).rejects.toThrow('key')
  expect((await client.request('status')).configuration).toEqual(saved)
  revoke()
  await expect(client.request('save', { config: lan })).rejects.toThrow('授权')
  expect((await client.request('status')).configuration).toEqual(saved)
  controller.invalidate()
})

it('rejects untrusted managers, missing grants and disabled modules; cancels the player on lifecycle invalidation', async () => {
  const { client, controller, revoke, disable } = setup()
  expect(
    handleDubbingMessage(
      controller,
      { channel: 'oneweb.video-dubbing.management.v1', command: 'status' },
      { id: 'webpage', url: 'https://evil.org' },
      extensionId,
      'chrome-extension://oneweb/',
    ),
  ).toBeUndefined()
  await client.request('open')
  const messages: any[] = []
  let disconnected = false
  const port = {
    name: 'oneweb.video-dubbing.player.v1',
    sender: {
      id: extensionId,
      tab: { id: 42 },
      frameId: 0,
      documentId: 'doc',
      url: 'https://www.youtube.com/watch?v=abc123',
    },
    postMessage(message: unknown) {
      messages.push(message)
    },
    disconnect() {
      disconnected = true
    },
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
  }
  await controller.acceptPort(port)
  expect(messages[0]).toMatchObject({ type: 'bound', binding: { tabId: 42, documentId: 'doc', videoId: 'abc123' } })
  revoke()
  await controller.permissionsChanged()
  expect(disconnected).toBe(true)
  await expect(client.request('open')).rejects.toThrow('授权')
  disable()
  await expect(client.request('status')).rejects.toThrow('未启用')
})

it('starts a video-bound imported timeline without exposing configuration to content and rejects invalid imports atomically', async () => {
  const { controller, client } = setup()
  await client.request('save', { config })
  await client.request('open')
  const messages: any[] = []
  await controller.acceptPort({
    name: 'oneweb.video-dubbing.player.v1',
    sender: {
      id: extensionId,
      tab: { id: 42 },
      frameId: 0,
      documentId: 'doc',
      url: 'https://www.youtube.com/watch?v=abc123',
    },
    postMessage(message) {
      messages.push(message)
    },
    disconnect() {},
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
  })
  await client.request('start', { language: 'zh-CN', subtitles: '1\n00:00:00,000 --> 00:00:02,000\nhello' })
  expect(messages.at(-1)).toMatchObject({ type: 'start', binding: { generation: 1 }, cues: [{ sourceText: 'hello' }] })
  expect(JSON.stringify(messages)).not.toMatch(/TOPSECRET|VOICESECRET|api.example/)
  await expect(client.request('start', { language: 'zh-CN', subtitles: 'invalid' })).rejects.toThrow('字幕')
  expect(messages.at(-1).binding.generation).toBe(1)
  await client.request('stop')
  expect(messages.at(-1).type).toBe('stop')
})

it('uses a native caption request URL only for an existing matching track on the bound YouTube video', async () => {
  const { controller, client } = setup()
  await client.request('open')
  let receive!: (_message: unknown) => void
  await controller.acceptPort({
    name: 'oneweb.video-dubbing.player.v1',
    sender: {
      id: extensionId,
      tab: { id: 42 },
      frameId: 0,
      documentId: 'doc',
      url: 'https://www.youtube.com/watch?v=abc123',
    },
    postMessage() {},
    disconnect() {},
    onMessage: {
      addListener(listener) {
        receive = listener
      },
    },
    onDisconnect: { addListener() {} },
  })
  receive({
    type: 'caption-request',
    url: 'https://www.youtube.com/api/timedtext?v=abc123&lang=en&fmt=json3&pot=fixture',
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect((await client.request('status')).player?.tracks[0].url).toContain('pot=fixture')
  receive({ type: 'caption-request', url: 'https://evil.org/api/timedtext?v=abc123&lang=en' })
  expect((await client.request('status')).player?.tracks[0].url).toContain('pot=fixture')
  controller.invalidate()
})

it('does not cancel a current-video read when an unrelated browser tab navigates', async () => {
  let finish!: (_info: PlayerInfo) => void
  const discovery = new Promise<PlayerInfo>(resolve => finish = resolve)
  const { client, controller } = setup(discovery)
  const opening = client.request('open')
  await new Promise(resolve => setTimeout(resolve, 0))
  controller.invalidate(99)
  finish({ videoId: 'abc123', title: 'Demo', documentId: 'doc', tracks: [] })
  expect((await opening).player?.videoId).toBe('abc123')
  controller.invalidate()
})
