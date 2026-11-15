import type { PreparedClip, SessionMedia } from '../session'
import { expect, it } from 'vitest'
import { DubbingSession } from '../session'

const cues = [
  { id: 'a', startMs: 0, endMs: 2000, sourceText: 'one', sourceCueIds: ['1'] },
  { id: 'b', startMs: 4000, endMs: 6000, sourceText: 'two', sourceCueIds: ['2'] },
]
function media(): SessionMedia & { offset: number, playing: string | null } {
  return {
    currentTimeMs: 5000,
    paused: false,
    playbackRate: 1,
    volume: 0.8,
    muted: false,
    audioEnded: true,
    audioTimeMs: 0,
    offset: 0,
    playing: null,
    pauseVideo() {
      this.paused = true
    },
    async playVideo() {
      this.paused = false
    },
    async playAudio(clip, offset) {
      this.offset = offset
      this.playing = clip.id
      this.audioEnded = false
    },
    pauseAudio() {},
    async resumeAudio() {},
    stopAudio() {
      this.playing = null
      this.audioEnded = true
    },
    setDubVolume() {},
  }
}
async function prepare(items: typeof cues): Promise<PreparedClip[]> {
  return items.map(cue => ({
    ...cue,
    translatedText: `${cue.sourceText} translated`,
    durationMs: 3000,
    audio: 'AA==',
    mime: 'audio/wav',
    bytes: 1,
  }))
}

it('starts at the current cue and maps a seek inside the cue to an audio offset (T1)', async () => {
  const player = media()
  const session = new DubbingSession(player, prepare)
  await session.start(cues)
  expect(player.playing).toBe('b')
  expect(player.offset).toBe(1500)
  expect(session.snapshot()).toMatchObject({ state: 'playing', cue: { id: 'b', translatedText: 'two translated' } })
})

it('never resumes video or audio when a user paused while speech was preparing', async () => {
  const player = media()
  let deliver!: (_clips: PreparedClip[]) => void
  const session = new DubbingSession(player, () => new Promise(resolve => (deliver = resolve)))
  const starting = session.start(cues)
  session.pause()
  deliver(await prepare([cues[1]]))
  await starting
  expect(player.paused).toBe(true)
  expect(player.playing).toBeNull()
  expect(session.snapshot()).toMatchObject({ state: 'paused', reason: 'user' })
  await session.resume()
  expect(player.playing).toBe('b')
})

it('invalidates late results on seek and stop, restores original volume and keeps the user rate', async () => {
  const player = media()
  const pending: Array<(_clips: PreparedClip[]) => void> = []
  const session = new DubbingSession(player, () => new Promise(resolve => pending.push(resolve)))
  const first = session.start(cues)
  player.currentTimeMs = 1000
  const seeking = session.seek()
  pending[1](await prepare([cues[0]]))
  await seeking
  pending[0](await prepare([cues[1]]))
  await first
  expect(player.playing).toBe('a')
  expect(session.snapshot().generation).toBe(2)
  session.updateSettings({ originalVolume: 0.1, dubVolume: 0.5 })
  expect(player.volume).toBe(0.1)
  player.playbackRate = 1.5
  session.stop()
  expect(player.playing).toBeNull()
  expect(player.volume).toBe(0.8)
  expect(player.playbackRate).toBe(1.5)
  expect(session.snapshot().state).toBe('idle')
})

it('buffers at cue boundaries, serializes overlong speech and only resumes engine-owned pauses', async () => {
  const player = media()
  player.currentTimeMs = 0
  const session = new DubbingSession(player, prepare)
  await session.start(cues)
  player.currentTimeMs = 2000
  await session.tick()
  expect(player.paused).toBe(true)
  expect(session.snapshot().reason).toBe('dubbing-overrun')
  player.audioEnded = true
  await session.tick()
  expect(player.paused).toBe(false)
  player.currentTimeMs = 4100
  await session.tick()
  expect(player.playing).toBe('b')
  session.pause()
  player.audioEnded = true
  await session.tick()
  expect(player.paused).toBe(true)
  session.stop()
})

it('plays the next overlapping sentence from its beginning after the previous speech overruns (T1, AC-01)', async () => {
  const player = media()
  player.currentTimeMs = 0
  const session = new DubbingSession(player, prepare)
  await session.start([
    cues[0],
    { ...cues[1], startMs: 1500, endMs: 4000 },
  ])
  player.currentTimeMs = 2010
  await session.tick()
  expect(player.playing).toBe('a')
  expect(player.paused).toBe(true)
  player.audioEnded = true
  await session.tick()
  expect(player.playing).toBe('b')
  expect(player.offset).toBe(0)
  expect(session.snapshot()).toMatchObject({ state: 'playing', cue: { id: 'b' } })
  session.stop()
})

it('preserves a loaded clip when autoplay is blocked so a direct user resume needs no duplicate synthesis', async () => {
  const player = media()
  let allowed = false
  player.playAudio = async function (clip, offset) {
    this.playing = clip.id
    this.offset = offset
    this.audioEnded = false
    if (!allowed)
      throw new DOMException('blocked', 'NotAllowedError')
  }
  player.resumeAudio = async () => {
    allowed = true
  }
  const session = new DubbingSession(player, prepare)
  await session.start(cues)
  expect(session.snapshot()).toMatchObject({ state: 'paused', reason: 'autoplay' })
  expect(player.playing).toBe('b')
  session.setBlocked(null)
  await session.tick()
  expect(allowed).toBe(false)
  await session.resume()
  expect(session.snapshot().state).toBe('playing')
})

it('reads overlapping cues serially without dropping a short nested cue and does not prepare beyond the forward window', async () => {
  const player = media()
  player.currentTimeMs = 0
  const timeline = [
    cues[0],
    { ...cues[1], startMs: 500, endMs: 1000 },
    { ...cues[1], id: 'far', startMs: 90000, endMs: 92000 },
  ]
  const session = new DubbingSession(player, prepare)
  await session.start(timeline)
  player.currentTimeMs = 2000
  await session.tick()
  player.audioEnded = true
  await session.tick()
  expect(player.playing).toBe('b')
  expect(player.offset).toBe(0)
  player.audioEnded = true
  await session.tick()
  expect(session.snapshot().state).toBe('playing')
  expect(session.snapshot().error).toBeNull()
  session.stop()
})

it('starts the first ready sentence while later speech is still pending and buffers only when it is needed', async () => {
  const player = media()
  player.currentTimeMs = 0
  let deliver!: (_clips: PreparedClip[]) => void
  const later = new Promise<PreparedClip[]>(resolve => (deliver = resolve))
  const session = new DubbingSession(player, items => (items.some(cue => cue.id === 'b') ? later : prepare(items)))
  const starting = session.start(cues)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(player.playing).toBe('a')
  expect(session.snapshot().state).toBe('playing')
  player.audioEnded = true
  player.currentTimeMs = 4100
  const ticking = session.tick()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(player.paused).toBe(true)
  deliver(await prepare([cues[1]]))
  await Promise.all([starting, ticking])
  expect(player.playing).toBe('b')
  session.stop()
})

it('keeps bilingual subtitle text for its video window when the spoken clip finishes early', async () => {
  const player = media()
  player.currentTimeMs = 0
  const session = new DubbingSession(player, prepare)
  await session.start(cues)
  player.currentTimeMs = 1000
  player.audioEnded = true
  await session.tick()
  expect(session.snapshot().cue).toMatchObject({ id: 'a', sourceText: 'one', translatedText: 'one translated' })
  player.currentTimeMs = 3000
  await session.tick()
  expect(session.snapshot().cue).toBeNull()
  session.stop()
})

it('surfaces a late media playback failure and permits an explicit retry instead of buffering forever (T1)', async () => {
  const player = Object.assign(media(), { audioError: null as string | null })
  player.currentTimeMs = 0
  const session = new DubbingSession(player, prepare)
  await session.start(cues)
  player.audioError = '语音播放失败，请重试或检查音频设备'
  player.currentTimeMs = 2100
  await session.tick()
  expect(session.snapshot()).toMatchObject({ state: 'error', error: '语音播放失败，请重试或检查音频设备' })
  expect(player.playing).toBeNull()
  player.audioError = null
  player.currentTimeMs = 500
  await session.resume()
  expect(session.snapshot()).toMatchObject({ state: 'playing', error: null, cue: { id: 'a' } })
  session.stop()
})

it('holds the failed subtitle position until an explicit retry instead of silently playing past it (T1)', async () => {
  const player = media()
  let failing = true
  const session = new DubbingSession(player, async (items) => {
    if (failing)
      throw new Error('服务请求失败 HTTP 502')
    return prepare(items)
  })
  await session.start(cues)
  expect(session.snapshot()).toMatchObject({ state: 'error', reason: 'error' })
  expect(player.paused).toBe(true)
  expect(player.currentTimeMs).toBe(5000)
  expect(player.playing).toBeNull()
  failing = false
  await session.resume()
  expect(player.currentTimeMs).toBe(5000)
  expect(player.paused).toBe(false)
  expect(session.snapshot()).toMatchObject({ state: 'playing', error: null, cue: { id: 'b' } })
  session.stop()
})

it('walks a three-hour timeline within the audio budget and rebinds repeated seeks to the exact cue (T1)', async () => {
  const player = media()
  player.currentTimeMs = 0
  const prepared: string[] = []
  const timeline = Array.from({ length: 180 }, (_, minute) => ({
    id: `minute-${minute}`,
    startMs: minute * 60000,
    endMs: minute * 60000 + 2000,
    sourceText: `Minute ${minute}`,
    sourceCueIds: [`${minute}`],
  }))
  const session = new DubbingSession(player, async (items) => {
    prepared.push(...items.map(cue => cue.id))
    return (await prepare(items)).map(clip => ({ ...clip, bytes: 4194304 }))
  })
  await session.start(timeline)
  for (let minute = 1; minute < 180; minute++) {
    player.audioEnded = true
    player.currentTimeMs = minute * 60000
    await session.tick()
    expect(session.snapshot()).toMatchObject({ state: 'playing', error: null, cue: { id: `minute-${minute}` } })
  }
  // Preparing every 4-MiB clip simultaneously would exceed the 20-MiB player budget.
  expect(prepared).toHaveLength(180)
  expect(new Set(prepared).size).toBe(180)
  for (const time of [1000, 10741000, 61000, 5401000, 1000]) {
    player.currentTimeMs = time
    await session.seek()
    expect(player.playing).toBe(`minute-${Math.floor(time / 60000)}`)
    expect(player.offset).toBe(1500)
  }
  session.stop()
  expect(player.volume).toBe(0.8)
  expect(session.snapshot().state).toBe('idle')
})
