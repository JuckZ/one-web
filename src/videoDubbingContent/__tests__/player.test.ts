import { expect, it, vi } from 'vitest'
import type { SessionMedia } from '~/modules/builtin/video-dubbing/session'
import { mountDubbingPlayer } from '../player'

it('renders bilingual text safely from a bound session and restores media on port disconnect (T3)', async () => {
  const video = document.createElement('video')
  document.body.append(video)
  let receive!: (_message: unknown) => void
  let disconnect!: () => void
  const sent: any[] = []
  const media: SessionMedia = {
    currentTimeMs: 0,
    paused: false,
    playbackRate: 1,
    volume: 0.7,
    muted: false,
    audioTimeMs: 0,
    audioEnded: true,
    pauseVideo() {
      this.paused = true
    },
    async playVideo() {
      this.paused = false
    },
    async playAudio() {
      this.audioEnded = false
    },
    pauseAudio() {},
    async resumeAudio() {},
    stopAudio() {
      this.audioEnded = true
    },
    setDubVolume() {},
  }
  const player = mountDubbingPlayer({
    video,
    media,
    decode: async () => 2000,
    port: {
      postMessage(message: unknown) {
        sent.push(message)
      },
      onMessage: {
        addListener(listener: (_message: unknown) => void) {
          receive = listener
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnect = listener
        },
      },
    },
  })
  const binding = { tabId: 1, documentId: 'd', videoId: 'abc', sessionId: 's', generation: 0 }
  receive({ type: 'bound', binding })
  const cue = { id: 'c1', sourceText: '<img src=x onerror=alert(1)>', sourceCueIds: ['1'], startMs: 0, endMs: 2000 }
  receive({ type: 'start', binding: { ...binding, generation: 1 }, cues: [cue] })
  await new Promise(resolve => setTimeout(resolve, 0))
  const request = sent.find(message => message.type === 'prepare')
  expect(request.ids).toEqual(['c1'])
  receive({
    type: 'prepared',
    requestId: request.requestId,
    generation: 1,
    clips: [{ ...cue, translatedText: '你好', mime: 'audio/wav', audio: 'AQ==', bytes: 1 }],
  })
  await new Promise(resolve => setTimeout(resolve, 20))
  player.render()
  expect(player.root.textContent).toContain('你好')
  expect(player.root.textContent).toContain('<img src=x')
  expect(player.root.querySelector('img')).toBeNull()
  receive({
    type: 'volumes',
    settings: { originalVolume: 0.1, dubVolume: 0.5 },
    binding: { ...binding, generation: 1 },
  })
  expect(media.volume).toBe(0.1)
  video.dispatchEvent(new Event('seeking'))
  receive({ type: 'stop', binding: { ...binding, generation: 3 } })
  receive({ type: 'advanced', binding: { ...binding, generation: 2 } })
  await new Promise(resolve => setTimeout(resolve, 0))
  player.render()
  expect(player.root.textContent).toContain('未启动')
  disconnect()
  expect(media.volume).toBe(0.7)
  expect(player.root.isConnected).toBe(false)
})

it('drains reached speech after the video ends without truncating audio or replaying the video (T3, AC-04)', async () => {
  vi.useFakeTimers()
  const video = document.createElement('video')
  document.body.append(video)
  let receive!: (_message: unknown) => void
  const sent: any[] = []
  const played: Array<{ id: string, offset: number }> = []
  const media: SessionMedia & { videoEnded: boolean } = {
    currentTimeMs: 0,
    paused: false,
    videoEnded: false,
    playbackRate: 1,
    volume: 0.7,
    muted: false,
    audioTimeMs: 0,
    audioEnded: true,
    pauseVideo() { this.paused = true },
    async playVideo() {
      if (this.videoEnded)
        throw new Error('The completed video must not restart')
      this.paused = false
    },
    async playAudio(clip, offset) {
      played.push({ id: clip.id, offset })
      this.audioEnded = false
    },
    pauseAudio() {},
    async resumeAudio() {},
    stopAudio() { this.audioEnded = true },
    setDubVolume() {},
  }
  Object.defineProperty(video, 'ended', { get: () => media.videoEnded })
  Object.defineProperty(video, 'readyState', { value: 4 })
  const player = mountDubbingPlayer({
    video,
    media,
    decode: async () => 3000,
    port: {
      postMessage(message) { sent.push(message) },
      onMessage: { addListener(listener) { receive = listener } },
      onDisconnect: { addListener() {} },
    },
  })
  const binding = { tabId: 1, documentId: 'd', videoId: 'abc', sessionId: 's', generation: 1 }
  const cues = [
    { id: 'c1', sourceText: 'First sentence', sourceCueIds: ['1'], startMs: 0, endMs: 2000 },
    { id: 'c2', sourceText: 'Last sentence', sourceCueIds: ['2'], startMs: 1500, endMs: 4000 },
  ]
  const deliver = () => {
    const request = sent.filter(message => message.type === 'prepare').at(-1)
    receive({
      type: 'prepared',
      requestId: request.requestId,
      generation: 1,
      clips: cues.filter(cue => request.ids.includes(cue.id))
        .map(cue => ({ ...cue, translatedText: cue.sourceText, mime: 'audio/wav', audio: 'AQ==', bytes: 1 })),
    })
  }
  try {
    receive({ type: 'bound', binding })
    receive({ type: 'start', binding, cues })
    deliver()
    await vi.advanceTimersByTimeAsync(0)
    deliver()
    await vi.advanceTimersByTimeAsync(0)
    expect(played).toEqual([{ id: 'c1', offset: 0 }])
    media.currentTimeMs = 2000
    media.videoEnded = true
    media.paused = true
    video.dispatchEvent(new Event('ended'))
    await vi.advanceTimersByTimeAsync(100)
    expect(media.audioEnded).toBe(false)
    expect(player.root.textContent).not.toContain('未启动')
    expect(sent.filter(message => message.type === 'stop')).toHaveLength(0)
    media.audioEnded = true
    await vi.advanceTimersByTimeAsync(100)
    expect(played).toEqual([{ id: 'c1', offset: 0 }, { id: 'c2', offset: 0 }])
    expect(media.audioEnded).toBe(false)
    media.audioEnded = true
    await vi.advanceTimersByTimeAsync(100)
    expect(player.root.textContent).toContain('未启动')
    expect(sent.filter(message => message.type === 'stop')).toHaveLength(1)
    expect(media.paused).toBe(true)
  }
  finally {
    player.destroy()
    video.remove()
    vi.useRealTimers()
  }
})
