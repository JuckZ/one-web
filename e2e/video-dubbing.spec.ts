import type { BrowserContext } from '@playwright/test'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createServer } from 'node:http'
import { test as base, expect } from './fixtures'

function wav(seconds: number) {
  const samples = seconds * 24000
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF')
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24)
  buffer.writeUInt32LE(48000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i / 24000) * 440 * Math.PI * 2) * 2000), 44 + i * 2)
  return buffer
}

type FaultMode = 'ok' | 'quota' | 'decode' | 'hold'
interface DubbingFixture {
  baseUrl: string
  calls: string[]
  translations: string[][]
  speechInputs: string[]
  timings: Array<{ operation: string, startedAt: number, completedAt: number, cueIds?: string[] }>
  abandoned: number
  setMode: (_mode: FaultMode) => void
  release: () => void
}
const test = base.extend<{ dubbingServer: DubbingFixture }>({
  // eslint-disable-next-line no-empty-pattern
  dubbingServer: async ({}, use) => {
    const calls: string[] = []
    const translations: string[][] = []
    const speechInputs: string[] = []
    const timings: DubbingFixture['timings'] = []
    let mode: FaultMode = 'ok'
    let abandoned = 0
    const held = new Set<() => void>()
    const release = () => {
      for (const resolve of held) resolve()
      held.clear()
    }
    const server = createServer(async (req, res) => {
      const timing = { operation: req.url!, startedAt: Date.now(), completedAt: 0 } as DubbingFixture['timings'][number]
      timings.push(timing)
      res.once('finish', () => {
        timing.completedAt = Date.now()
      })
      let body = ''
      for await (const chunk of req) body += chunk
      calls.push(req.url!)
      if (req.url === '/v1/chat/completions') {
        const request = JSON.parse(body)
        const cues = JSON.parse(request.messages[1].content).cues
        translations.push(cues.map((cue: { id: string }) => cue.id))
        timing.cueIds = cues.map((cue: { id: string }) => cue.id)
        if (mode === 'quota') {
          res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"error":"synthetic quota"}')
          return
        }
        if (mode === 'hold') {
          await new Promise<void>((resolve) => {
            held.add(resolve)
            res.once('close', () => {
              if (!res.writableEnded)
                abandoned++
              held.delete(resolve)
              resolve()
            })
          })
          if (res.destroyed)
            return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    cues: cues.map((cue: { id: string }) => ({
                      id: cue.id,
                      translatedText: `你好，欢迎观看 ${cue.id}`,
                    })),
                  }),
                },
              },
            ],
          }),
        )
      }
      else if (req.url === '/v1/audio/speech') {
        speechInputs.push(JSON.parse(body).input)
        res.setHeader('Content-Type', 'audio/wav')
        res.end(mode === 'decode' ? Buffer.from('invalid audio fixture') : wav(3))
      }
      else {
        res.writeHead(404).end()
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`
    try {
      await use({
        baseUrl,
        calls,
        translations,
        speechInputs,
        timings,
        get abandoned() { return abandoned },
        setMode(value) { mode = value },
        release,
      })
    }
    finally {
      server.closeAllConnections()
      release()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  },
  extraHostOrigins: async ({ dubbingServer }, use) => {
    await use([
      `${new URL(dubbingServer.baseUrl).origin}/*`,
      'https://www.youtube.com/*',
      'https://www.bilibili.com/*',
      'https://api.bilibili.com/*',
      'https://aisubtitle.hdslb.com/*',
      'https://course.example.org/*',
    ])
  },
})

async function prepareDubbing(
  context: BrowserContext,
  extensionId: string,
  baseUrl: string,
  options: {
    nativeCaptions?: boolean
    autoRefreshCaptions?: boolean
    platform?: 'youtube' | 'bilibili' | 'html5'
    captionsUnavailable?: boolean
    cueWindows?: Array<[number, number]>
    initialTime?: number
    startPaused?: boolean
  } = {},
) {
  const { nativeCaptions = false, autoRefreshCaptions = false, platform = 'youtube', captionsUnavailable = false } = options
  const cueWindows = options.cueWindows ?? [0, 4000, 8000, 12000].map(start => [start, start + 2000])
  const origin = platform === 'bilibili'
    ? 'https://www.bilibili.com'
    : platform === 'html5' ? 'https://course.example.org' : 'https://www.youtube.com'
  const platformRequests: string[] = []
  if (platform === 'bilibili') {
    await context.route('https://api.bilibili.com/**', async (route) => {
      platformRequests.push(route.request().url())
      const cid = Number(new URL(route.request().url()).searchParams.get('cid'))
      await route.fulfill({ json: captionsUnavailable
        ? { code: -101, message: 'not logged in' }
        : {
            code: 0,
            data: { cid, subtitle: { subtitles: [
              { id: 7, lan: 'en', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/fixture.json?auth_key=fixture' },
            ] } },
          } })
    })
    await context.route('https://aisubtitle.hdslb.com/**', async (route) => {
      platformRequests.push(route.request().url())
      await route.fulfill({ json: { body: [0, 4, 8, 12].map(from => ({ from, to: from + 2, content: 'Hello Bilibili' })) } })
    })
  }
  await context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/fixture.webm') {
      const bytes = fs.readFileSync('e2e/assets/dubbing.webm')
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '')
      if (range) {
        const start = Number(range[1])
        const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
        await route.fulfill({
          status: 206,
          contentType: 'video/webm',
          headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${bytes.length}` },
          body: bytes.subarray(start, end + 1),
        })
      }
      else {
        await route.fulfill({ contentType: 'video/webm', headers: { 'accept-ranges': 'bytes' }, body: bytes })
      }
      return
    }
    if (url.pathname === '/api/timedtext') {
      if (nativeCaptions && !url.searchParams.has('native')) {
        await route.fulfill({ body: '', contentType: 'application/json' })
        return
      }
      await route.fulfill({
        json: {
          events: cueWindows.map(([start, end]) => ({
            tStartMs: start,
            dDurationMs: end - start,
            segs: [{ utf8: 'Hello world' }],
          })),
        },
      })
      return
    }
    const id = platform === 'youtube' ? 'movie_player' : platform === 'bilibili' ? 'bilibili-player' : 'course-player'
    const reader = platform === 'youtube'
      ? `document.getElementById('movie_player').getPlayerResponse=()=>({videoDetails:{videoId:'fixture',title:'Dubbing fixture'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=fixture',languageCode:'en',name:{simpleText:'English'}}]}}});`
      : platform === 'bilibili'
        ? `window.__INITIAL_STATE__={videoData:{bvid:'BV1xx411c7mD',aid:123,title:'Bilibili fixture',pages:[{page:1,cid:1001},{page:2,cid:1002}]}};`
        : ''
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Dubbing fixture</title><div id="${id}" class="${platform === 'bilibili' ? 'bpx-player-container' : ''}" style="position:relative;width:800px;height:450px"><video controls src="/fixture.webm" style="width:100%;height:100%"></video><button id="native-cc" class="ytp-subtitles-button" aria-pressed="${autoRefreshCaptions}" onclick="const wasOn=this.getAttribute('aria-pressed')==='true';this.setAttribute('aria-pressed',String(!wasOn));if(!wasOn)fetch('/api/timedtext?v=fixture&lang=en&fmt=json3&native=1')">CC fixture</button></div><script>${reader}</script>`,
    })
  })
  const site = await context.newPage()
  await site.goto(`${origin}${platform === 'bilibili' ? '/video/BV1xx411c7mD/?p=2' : platform === 'html5' ? '/lesson/one' : '/watch?v=fixture'}`)
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/sidebar.html?moduleId=dev.oneweb.video-dubbing`)
  const card = panel.locator('[data-module-id="dev.oneweb.video-dubbing"][data-testid="module-card"]')
  await expect(card).toBeVisible()
  await card.getByTestId('module-toggle').click()
  for (const [label, value] of Object.entries({
    '翻译服务地址': baseUrl,
    '翻译模型': 'fixture',
    '翻译 API key': 'TEST-T',
    '语音服务地址': baseUrl,
    '语音模型': 'fixture',
    '语音 API key': 'TEST-S',
    '声音': 'fixture',
  }))
    await card.getByLabel(label, { exact: true }).fill(value)
  await card.locator('[data-action="save"]').click()
  await expect(card).toContainText('配置已保存')
  await site.bringToFront()
  // Evaluate DOM actions because a normal tab used as a side-panel fixture would take tab focus.
  const action = async (name: string) => {
    const view = panel.getByTestId('video-dubbing')
    await expect(view).toHaveAttribute('aria-busy', 'false')
    await panel.evaluate(name => (document.querySelector(`[data-testid="video-dubbing"] [data-action="${name}"]`) as HTMLButtonElement).click(), name)
    await expect(view).toHaveAttribute('aria-busy', 'false')
  }
  await action('refresh')
  await expect(card).toContainText('请授权并读取视频')
  await action('open')
  await expect(site.locator('#oneweb-video-dubbing')).toBeVisible()
  if (platform !== 'html5' && !captionsUnavailable) {
    await expect(card.getByLabel('字幕轨道')).toContainText('English')
  }
  else {
    await card.getByLabel('导入字幕', { exact: true }).setInputFiles({
      name: 'platform.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nImported platform cue\n\n2\n00:00:08,000 --> 00:00:12,000\nImported later cue'),
    })
    await expect(card).toContainText('已导入 platform.srt')
  }
  if (options.initialTime !== undefined) {
    await site.locator('video').evaluate((video: HTMLVideoElement, time) => {
      video.currentTime = time
    }, options.initialTime)
    await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.seeking)).toBe(false)
  }
  await site.locator('video').evaluate(async (video: HTMLVideoElement, startPaused) => {
    video.volume = 0.65
    video.muted = true
    if (!startPaused)
      await video.play()
  }, options.startPaused === true)
  if (nativeCaptions && !autoRefreshCaptions) {
    await site.getByRole('button', { name: 'CC fixture' }).click()
    await expect
      .poll(() =>
        panel.evaluate(
          async () =>
            (
              await chrome.runtime.sendMessage({
                channel: 'oneweb.video-dubbing.management.v1',
                command: 'status',
                data: {},
              })
            ).value.player.tracks[0].url,
        ),
      )
      .toContain('native=1')
  }
  await action('start')
  if (options.startPaused)
    await site.locator('video').evaluate((video: HTMLVideoElement) => video.play())
  const overlay = site.locator('#oneweb-video-dubbing')
  await expect(overlay).toContainText('你好，欢迎观看', { timeout: 20000 })
  return { site, panel, card, action, overlay, platformRequests }
}

interface MediaSample {
  recordedAt: number
  kind: 'video' | 'audio'
  event: string
  source: string
  time: number
  duration: number
  videoTime: number
  videoEnded: boolean
}
type ObservedMediaWindow = typeof window & { onewebMediaSamples: MediaSample[] }
async function observeMedia(context: BrowserContext) {
  await context.addInitScript(() => {
    const samples: MediaSample[] = []
    ;(window as ObservedMediaWindow).onewebMediaSamples = samples
    for (const name of ['playing', 'ended', 'pause', 'emptied']) {
      document.addEventListener(name, (event) => {
        const target = event.target
        if (!(target instanceof HTMLMediaElement))
          return
        if (target instanceof HTMLAudioElement && !target.hasAttribute('data-oneweb-dub-audio'))
          return
        const video = document.querySelector('video')!
        samples.push({
          recordedAt: Date.now(),
          kind: target instanceof HTMLVideoElement ? 'video' : 'audio',
          event: event.type,
          source: target.getAttribute('src') ?? '',
          time: target.currentTime,
          duration: target.duration,
          videoTime: video.currentTime,
          videoEnded: video.ended,
        })
      }, true)
    }
  })
}

test('Video Dubbing completes an uninterrupted short full video and records actual batch latency', async ({
  context,
  extensionId,
  dubbingServer,
}, testInfo) => {
  await observeMedia(context)
  const startedAt = Date.now()
  const cueWindows: Array<[number, number]> = Array.from({ length: 6 }, (_, index) => [index * 3000, index * 3000 + 1800])
  const { site, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, { cueWindows })
  await expect(overlay).toContainText('未启动', { timeout: 45_000 })
  const samples = await site.evaluate(() => (window as ObservedMediaWindow).onewebMediaSamples)
  const speechEnds = samples.filter(sample => sample.kind === 'audio' && sample.event === 'ended')
  const uniqueStarts = samples.filter(sample => sample.kind === 'audio' && sample.event === 'playing')
    .filter((sample, index, all) => all.findIndex(other => other.source === sample.source) === index)
  expect(speechEnds).toHaveLength(6)
  expect(uniqueStarts).toHaveLength(6)
  for (const sample of speechEnds)
    expect(sample.time).toBeGreaterThanOrEqual(2.98)
  for (const sample of uniqueStarts.slice(1))
    expect(sample.time).toBeLessThan(0.15)
  expect(samples.filter(sample => sample.kind === 'video' && sample.event === 'ended')).toHaveLength(1)
  expect(await site.locator('video').evaluate((video: HTMLVideoElement) => ({ ended: video.ended, paused: video.paused, volume: video.volume })))
    .toEqual({ ended: true, paused: true, volume: 0.65 })
  expect(dubbingServer.translations.length).toBeGreaterThanOrEqual(2)
  const translationBatches = dubbingServer.timings.filter(timing => timing.operation.endsWith('/chat/completions'))
  const firstPlaying = uniqueStarts[0].recordedAt
  const metrics = {
    method: 'natural complete 20-second fixture video; no manual pause, seek, acceleration or mocked media',
    provider: 'deterministic local JSON/WAV service; not LAN/cloud quality or human listening',
    setupAndFirstPlaybackMs: firstPlaying - startedAt,
    providerStartToFirstPlaybackMs: firstPlaying - translationBatches[0].startedAt,
    continuousObservationMs: speechEnds.at(-1)!.recordedAt - firstPlaying,
    fullVideoEnded: true,
    fullSpeechCount: speechEnds.length,
    batches: translationBatches.map(batch => ({ cueIds: batch.cueIds, responseMs: batch.completedAt - batch.startedAt })),
    media: samples,
  }
  const metricsPath = testInfo.outputPath('continuous-playback-and-latency.json')
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2))
  await testInfo.attach('continuous-playback-and-latency.json', { path: metricsPath, contentType: 'application/json' })
})

test('Video Dubbing plays complete sequential speech across overlapping and short subtitle windows', async ({
  context,
  extensionId,
  dubbingServer,
}, testInfo) => {
  await observeMedia(context)
  const { site, overlay, action } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, {
    cueWindows: [[0, 2000], [1500, 4000], [4100, 5200]],
  })
  await expect.poll(() => site.evaluate(() =>
    (window as ObservedMediaWindow).onewebMediaSamples.filter(s => s.kind === 'audio' && s.event === 'ended').length,
  ), { timeout: 20000 }).toBe(3)
  const samples = await site.evaluate(() => (window as ObservedMediaWindow).onewebMediaSamples)
  const starts = samples.filter(s => s.kind === 'audio' && s.event === 'playing')
    .filter((sample, index, items) => items.findIndex(item => item.source === sample.source) === index)
  expect(starts).toHaveLength(3)
  for (const start of starts.slice(1))
    expect(start.time).toBeLessThan(0.15)
  const ends = samples.filter(s => s.kind === 'audio' && s.event === 'ended')
  for (const end of ends) {
    expect(end.time).toBeGreaterThanOrEqual(2.98)
    expect(end.duration).toBeCloseTo(3, 1)
  }
  expect(samples.indexOf(ends[0])).toBeLessThan(samples.indexOf(starts[1]))
  expect(samples.indexOf(ends[1])).toBeLessThan(samples.indexOf(starts[2]))
  expect(samples.some(s => s.kind === 'video' && s.event === 'pause' && !s.videoEnded)).toBe(true)
  await expect(overlay).not.toContainText('配音失败')
  await testInfo.attach('complete-sequential-media.json', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
  await action('stop')
})

test('Video Dubbing plays complete final speech after natural video end and supports pause and resume', async ({
  context,
  extensionId,
  dubbingServer,
}, testInfo) => {
  await observeMedia(context)
  const { site, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, {
    // Keep the cue beyond native duration so overrun gating cannot pause just before ended.
    cueWindows: [[18500, 21000]],
    initialTime: 18.5,
    startPaused: true,
  })
  expect(await site.locator('video').evaluate((video: HTMLVideoElement) => video.duration)).toBeLessThan(21)
  await site.waitForFunction(() => document.querySelector<HTMLVideoElement>('video')!.ended)
  const audio = site.locator('audio[data-oneweb-dub-audio]')
  await expect.poll(() => audio.evaluate((audio: HTMLAudioElement) => !!audio.getAttribute('src') && !audio.paused), { intervals: [20] }).toBe(true)
  await overlay.getByRole('button', { name: '暂停', exact: true }).click()
  await expect.poll(() => audio.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  await overlay.getByRole('button', { name: '继续播放', exact: true }).click()
  await expect(overlay).toContainText('未启动', { timeout: 10000 })
  const samples = await site.evaluate(() => (window as ObservedMediaWindow).onewebMediaSamples)
  const start = samples.find(s => s.kind === 'audio' && s.event === 'playing')
  expect(start!.time).toBeLessThan(0.15)
  const end = samples.find(s => s.kind === 'audio' && s.event === 'ended')
  expect(end).toMatchObject({ videoEnded: true })
  expect(end!.time).toBeGreaterThanOrEqual(2.98)
  const videoEnd = samples.findIndex(s => s.kind === 'video' && s.event === 'ended')
  expect(videoEnd).toBeGreaterThanOrEqual(0)
  expect(samples.indexOf(end!)).toBeGreaterThan(videoEnd)
  expect(samples.slice(videoEnd + 1).filter(s => s.kind === 'video' && s.event === 'playing')).toHaveLength(0)
  expect(await site.locator('video').evaluate((video: HTMLVideoElement) => video.ended && video.paused)).toBe(true)
  expect(await audio.getAttribute('src')).toBeNull()
  await testInfo.attach('complete-final-media.json', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
})

test('Video Dubbing production module plays real media, pauses, seeks and cleans up on disable', async ({
  context,
  extensionId,
  dubbingServer,
}, testInfo) => {
  const { baseUrl, calls } = dubbingServer
  const { site, panel, overlay } = await prepareDubbing(context, extensionId, baseUrl)

  await expect
    .poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1)
  await overlay.getByRole('button', { name: '暂停', exact: true }).click()
  await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  await expect
    .poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.paused))
    .toBe(true)
  await overlay.getByRole('button', { name: '继续播放', exact: true }).click()
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 8.5
    video.playbackRate = 1.5
  })
  await expect
    .poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThanOrEqual(8.5)
  await expect(overlay).toContainText('你好，欢迎观看 yt-3')
  await expect
    .poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.5)
  await site.screenshot({ path: testInfo.outputPath('video-dubbing-playing.png') })
  expect(calls).toContain('/v1/chat/completions')
  expect(calls).toContain('/v1/audio/speech')
  await panel.evaluate(() =>
    (
      document.querySelector(
        '[data-module-id="dev.oneweb.video-dubbing"] [data-testid="module-toggle"]',
      ) as HTMLButtonElement
    ).click(),
  )
  await expect(overlay).toHaveCount(0)
  expect(
    await site.locator('video').evaluate((video: HTMLVideoElement) => ({
      volume: video.volume,
      muted: video.muted,
      rate: video.playbackRate,
    })),
  ).toEqual({ volume: 0.65, muted: true, rate: 1.5 })
})

test('Video Dubbing keeps captions in fullscreen and stops on SPA navigation and background loss', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, panel, overlay, action } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  await site.locator('#movie_player').evaluate(element => element.requestFullscreen())
  await expect
    .poll(() =>
      site.evaluate(() => document.fullscreenElement?.contains(document.getElementById('oneweb-video-dubbing'))),
    )
    .toBe(true)
  await site.evaluate(() => document.exitFullscreen())
  await site.evaluate(() => history.pushState({}, '', '/watch?v=next-video'))
  await expect(overlay).toHaveCount(0)
  await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
  expect(await site.locator('video').evaluate((video: HTMLVideoElement) => video.volume)).toBe(0.65)
  await site.goto('https://www.youtube.com/watch?v=fixture')
  await site.bringToFront()
  await action('refresh')
  await expect(panel.locator('[data-testid="video-dubbing"]')).toContainText('请授权并读取视频')
  await action('open')
  await expect(overlay).toBeVisible()
  await site.locator('video').evaluate((video: HTMLVideoElement) => video.play())
  await action('start')
  await expect(overlay).toContainText('你好，欢迎观看')
  const cdp = await context.browser()!.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const worker = targetInfos.find(
      target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`),
    )
    expect(worker).toBeTruthy()
    await cdp.send('Target.closeTarget', { targetId: worker!.targetId })
  }
  finally {
    await cdp.detach()
  }
  await expect(overlay).toHaveCount(0)
  await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
})

test('Video Dubbing isolates two tab sessions and stops both when their site permission is removed', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, panel, overlay, action } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  const peer = await context.newPage()
  await peer.goto('https://www.youtube.com/watch?v=fixture')
  await peer.bringToFront()
  await action('refresh')
  await action('open')
  const peerOverlay = peer.locator('#oneweb-video-dubbing')
  await expect(peerOverlay).toBeVisible()
  await peer.locator('video').evaluate((video: HTMLVideoElement) => video.play())
  await action('start')
  await expect(peerOverlay).toContainText('你好，欢迎观看')
  await expect(overlay).toBeVisible()
  await peerOverlay.getByRole('button', { name: '暂停', exact: true }).click()
  await expect.poll(() => peer.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  const before = await site.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)
  await expect
    .poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(before + 0.1)
  await panel.evaluate(() => chrome.permissions.remove({ origins: ['https://www.youtube.com/*'] }))
  await expect(peerOverlay).toHaveCount(0)
  await expect(overlay).toHaveCount(0)
  await expect(peer.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
  await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
})

test('Video Dubbing reads a native CC request without a webRequest permission or a page network hook', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, { nativeCaptions: true })
  await expect(overlay).toContainText('你好，欢迎观看')
  await overlay.getByRole('button', { name: '停止', exact: true }).click()
  await expect(overlay).toContainText('未启动')
  await expect
    .poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.paused))
    .toBe(true)
})

test('Video Dubbing recovers an empty YouTube subtitle response when native CC is already on', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, card, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, {
    nativeCaptions: true,
    autoRefreshCaptions: true,
  })
  await expect(overlay).toContainText('Hello world')
  await expect(card.locator('[role="status"]')).not.toHaveAttribute('data-state', 'error')
  await expect(site.locator('.ytp-subtitles-button')).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1)
})

test('Video Dubbing imports a video-bound UTF-8 subtitle file and keeps it after an invalid replacement', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { card, action, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  await card
    .getByLabel('导入字幕', { exact: true })
    .setInputFiles({
      name: 'valid.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:00,000 --> 00:00:15,000\nImported subtitle'),
    })
  await expect(card).toContainText('已导入 valid.srt')
  await action('start')
  await expect(overlay).toContainText('Imported subtitle')
  await expect(overlay).toContainText('你好，欢迎观看 cue-1')
  await card
    .getByLabel('导入字幕', { exact: true })
    .setInputFiles({ name: 'invalid.srt', mimeType: 'text/plain', buffer: Buffer.from('invalid') })
  await expect(card).toContainText('无法识别 SRT')
  await action('start')
  await expect(overlay).toContainText('Imported subtitle')
  await action('stop')
  await expect(overlay).toContainText('未启动')
})

test('Video Dubbing plays Bilibili platform captions, seeks, enters fullscreen and cleans up on part changes', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, panel, overlay, action, platformRequests } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, { platform: 'bilibili' })
  expect(platformRequests.some(url => new URL(url).searchParams.get('cid') === '1002')).toBe(true)
  await expect.poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.1)
  await overlay.getByRole('button', { name: '暂停', exact: true }).click()
  await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  await overlay.getByRole('button', { name: '继续播放', exact: true }).click()
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 8.5
  })
  await expect(overlay).toContainText('你好，欢迎观看 bili-3')
  await site.locator('.bpx-player-container').evaluate(element => element.requestFullscreen())
  await expect.poll(() => site.evaluate(() => document.fullscreenElement?.contains(document.getElementById('oneweb-video-dubbing')))).toBe(true)
  await site.evaluate(() => document.exitFullscreen())
  await site.evaluate(() => history.pushState({}, '', '/video/BV1xx411c7mD/?p=1'))
  await expect(overlay).toHaveCount(0)
  await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
  expect(await site.locator('video').evaluate((video: HTMLVideoElement) => video.volume)).toBe(0.65)
  await site.bringToFront()
  await action('refresh')
  await action('open')
  await expect(panel.getByTestId('video-dubbing')).toContainText('English')
  expect(platformRequests.some(url => new URL(url).searchParams.get('cid') === '1001')).toBe(true)
  await action('start')
  await expect(overlay).toContainText('你好，欢迎观看')
  await panel.evaluate(() => chrome.permissions.remove({ origins: ['https://aisubtitle.hdslb.com/*'] }))
  await expect(overlay).toHaveCount(0)
})

test('Video Dubbing preserves Bilibili import fallback when platform captions require login and stops on API revocation', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, panel, card, overlay, platformRequests } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, { platform: 'bilibili', captionsUnavailable: true })
  await expect(card).toContainText('字幕接口不可用')
  await expect(overlay).toContainText('Imported platform cue')
  expect(platformRequests.every(url => new URL(url).hostname === 'api.bilibili.com')).toBe(true)
  await panel.evaluate(() => chrome.permissions.remove({ origins: ['https://api.bilibili.com/*'] }))
  await expect(overlay).toHaveCount(0)
  await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
})

test('Video Dubbing plays imported subtitles on another HTML5 site and cleans up when its media source changes', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, card, overlay, action, platformRequests } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, { platform: 'html5' })
  expect(platformRequests).toEqual([])
  await expect(overlay).toContainText('Imported platform cue')
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 8.5
  })
  await expect(overlay).toContainText('Imported later cue')
  await expect(overlay).toContainText('你好，欢迎观看 cue-2')
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.src = '/fixture.webm?next=1'
  })
  await expect(overlay).toHaveCount(0)
  await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
  await site.bringToFront()
  await action('refresh')
  await action('open')
  await expect(card).not.toContainText('已导入 platform.srt')
  await action('start')
  await expect(card).toContainText('没有可用字幕')
})

test('Video Dubbing shows quota failure without automatic paid retries and recovers on explicit retry', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, action, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  await action('stop')
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 0
  })
  const before = dubbingServer.calls.length
  dubbingServer.setMode('quota')
  await action('start')
  await expect(overlay).toContainText('HTTP 429')
  await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  const failedPosition = await site.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)
  const failed = dubbingServer.calls.length
  expect(dubbingServer.calls.slice(before)).toEqual(['/v1/chat/completions'])
  await site.waitForTimeout(600)
  expect(dubbingServer.calls.length).toBe(failed)
  expect(await site.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(failedPosition, 2)
  dubbingServer.setMode('ok')
  await overlay.getByRole('button', { name: '继续播放', exact: true }).click()
  await expect(overlay).toContainText('你好，欢迎观看 yt-1')
  await expect.poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.1)
  await action('stop')
})

test('Video Dubbing discards undecodable speech and retries that speech without retranslating the cue', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, action, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  await action('stop')
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 0
  })
  dubbingServer.setMode('decode')
  const translatedBefore = dubbingServer.translations.filter(ids => ids.includes('yt-1')).length
  const speechBefore = dubbingServer.speechInputs.filter(text => text.endsWith('yt-1')).length
  await action('start')
  await expect(overlay).toContainText('语音无法解码')
  expect(dubbingServer.translations.filter(ids => ids.includes('yt-1'))).toHaveLength(translatedBefore + 1)
  expect(dubbingServer.speechInputs.filter(text => text.endsWith('yt-1'))).toHaveLength(speechBefore + 1)
  dubbingServer.setMode('ok')
  await overlay.getByRole('button', { name: '继续播放', exact: true }).click()
  await expect(overlay).toContainText('你好，欢迎观看 yt-1')
  await expect.poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.1)
  expect(dubbingServer.translations.filter(ids => ids.includes('yt-1'))).toHaveLength(translatedBefore + 1)
  expect(dubbingServer.speechInputs.filter(text => text.endsWith('yt-1'))).toHaveLength(speechBefore + 2)
  await action('stop')
})

test('Video Dubbing aborts a pending translation on stop and never synthesizes its late result', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, action, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  await action('stop')
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 0
  })
  dubbingServer.setMode('hold')
  const before = dubbingServer.calls.length
  const speechBefore = dubbingServer.speechInputs.length
  await action('start')
  await expect.poll(() => dubbingServer.calls.length).toBe(before + 1)
  await expect(overlay).toContainText('缓冲中')
  await action('stop')
  await expect.poll(() => dubbingServer.abandoned).toBe(1)
  dubbingServer.release()
  await expect(overlay).toContainText('未启动')
  await site.waitForTimeout(600)
  expect(dubbingServer.calls.length).toBe(before + 1)
  expect(dubbingServer.speechInputs.length).toBe(speechBefore)
  expect(await site.locator('audio[data-oneweb-dub-audio]').getAttribute('src')).toBeNull()
})

test('Video Dubbing times out a real pending HTTP request without retrying or starting speech', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  test.setTimeout(100_000)
  const { site, action, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  await action('stop')
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 0
  })
  dubbingServer.setMode('hold')
  const before = dubbingServer.calls.length
  const speechBefore = dubbingServer.speechInputs.length
  await action('start')
  await expect(overlay).toContainText('配音失败', { timeout: 75_000 })
  await expect.poll(() => dubbingServer.abandoned).toBe(1)
  await site.waitForTimeout(600)
  expect(dubbingServer.calls.slice(before)).toEqual(['/v1/chat/completions'])
  expect(dubbingServer.speechInputs.length).toBe(speechBefore)
  expect(await site.locator('audio[data-oneweb-dub-audio]').getAttribute('src')).toBeNull()
  await action('stop')
})

test('Video Dubbing reports a late audio element failure and restarts playback on explicit retry', async ({
  context,
  extensionId,
  dubbingServer,
}) => {
  const { site, overlay, action } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl)
  await context.route('https://www.youtube.com/invalid-late.wav', route => route.fulfill({
    contentType: 'audio/wav',
    body: 'invalid audio fixture',
  }))
  await expect.poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.1)
  await site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => {
    audio.src = '/invalid-late.wav'
    audio.load()
    void audio.play().catch(() => {})
  })
  await expect(overlay).toContainText('语音播放失败')
  await overlay.getByRole('button', { name: '继续播放', exact: true }).click()
  await expect(overlay).toContainText('配音中')
  await expect.poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.1)
  await action('stop')
})

test('Video Dubbing seeks repeatedly across a real three-hour media timeline without repeating cached service calls', async ({
  context,
  extensionId,
  dubbingServer,
}, testInfo) => {
  const { site, panel, card, action, overlay } = await prepareDubbing(context, extensionId, dubbingServer.baseUrl, { platform: 'html5' })
  await context.route('https://course.example.org/fixture-long.webm', (route) => {
    const bytes = fs.readFileSync('e2e/assets/dubbing-long.webm')
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '')
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/webm',
      headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}) },
      body: bytes.subarray(start, end + 1),
    })
  })
  await site.locator('video').evaluate((video: HTMLVideoElement) => {
    video.src = '/fixture-long.webm'
  })
  await expect(overlay).toHaveCount(0)
  await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.duration)).toBe(10800)
  await site.bringToFront()
  await action('open')
  const translationsBefore = dubbingServer.translations.length
  const speechBefore = dubbingServer.speechInputs.length
  await card.getByLabel('导入字幕', { exact: true }).setInputFiles({
    name: 'three-hours.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from([
      '1\n00:00:00,000 --> 00:00:02,000\nLong cue 1',
      '2\n01:00:00,000 --> 01:00:02,000\nLong cue 2',
      '3\n02:00:00,000 --> 02:00:02,000\nLong cue 3',
      '4\n02:59:00,000 --> 02:59:04,000\nLong cue 4',
    ].join('\n\n')),
  })
  await site.locator('video').evaluate((video: HTMLVideoElement) => video.play())
  await action('start')
  await expect(overlay).toContainText('Long cue 1')
  const metrics: unknown[] = []
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const [index, time] of [0.5, 3600.5, 7200.5, 10740.5].entries()) {
      const generation = await panel.evaluate(async () => (await chrome.runtime.sendMessage({
        channel: 'oneweb.video-dubbing.management.v1',
        command: 'status',
      })).value.snapshot.generation)
      await site.locator('video').evaluate((video: HTMLVideoElement, time) => {
        video.currentTime = time
      }, time)
      await expect.poll(() => panel.evaluate(async () => (await chrome.runtime.sendMessage({
        channel: 'oneweb.video-dubbing.management.v1',
        command: 'status',
      })).value.snapshot.generation)).toBeGreaterThan(generation)
      await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.seeking)).toBe(false)
      await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThanOrEqual(time)
      await expect(overlay).toContainText(`Long cue ${index + 1}`)
      await expect(overlay).toContainText(`你好，欢迎观看 cue-${index + 1}`)
      await expect.poll(() => site.locator('audio[data-oneweb-dub-audio]').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.1)
      await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(1)
      metrics.push(await site.evaluate(() => ({
        videoTime: document.querySelector('video')!.currentTime,
        audioTime: document.querySelector('audio')!.currentTime,
        heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
      })))
    }
  }
  for (const id of ['cue-1', 'cue-2', 'cue-3', 'cue-4']) {
    expect(dubbingServer.translations.slice(translationsBefore).filter(ids => ids.includes(id))).toHaveLength(1)
    expect(dubbingServer.speechInputs.slice(speechBefore).filter(text => text.endsWith(id))).toHaveLength(1)
  }
  await action('stop')
  await panel.evaluate(() => (document.querySelector('[data-module-id="dev.oneweb.video-dubbing"] [data-testid="module-toggle"]') as HTMLButtonElement).click())
  await expect(overlay).toHaveCount(0)
  await expect(site.locator('audio[data-oneweb-dub-audio]')).toHaveCount(0)
  await testInfo.attach('three-hour-seek-metrics.json', {
    body: JSON.stringify({ method: 'three-hour media, 12 accelerated seeks, not three hours of wall time', metrics }, null, 2),
    contentType: 'application/json',
  })
})
