import type { DubbingCue, TranslatedCue } from './contracts'
import { normalizeCues } from './subtitles'

export interface PreparedClip extends TranslatedCue {
  durationMs: number
  audio: string
  mime: string
  bytes: number
}
export interface SessionMedia {
  currentTimeMs: number
  paused: boolean
  playbackRate: number
  volume: number
  muted: boolean
  videoEnded?: boolean
  audioEnded: boolean
  audioTimeMs: number
  audioError?: string | null
  pauseVideo: () => void
  playVideo: () => Promise<void>
  playAudio: (_clip: PreparedClip, _offsetMs: number, _rate: number) => Promise<void>
  pauseAudio: () => void
  resumeAudio: () => Promise<void>
  stopAudio: () => void
  setDubVolume: (_volume: number) => void
}
export interface DubbingSnapshot {
  state: 'idle' | 'preparing' | 'buffering' | 'playing' | 'paused' | 'error'
  reason: string | null
  cue: TranslatedCue | null
  generation: number
  error: string | null
}
export type PrepareClips = (_cues: DubbingCue[], _signal: AbortSignal) => Promise<PreparedClip[]>

/** Media time is the authority. Async work may publish only into its own generation. */
export class DubbingSession {
  private cues: DubbingCue[] = []
  private current: PreparedClip | null = null
  private display: TranslatedCue | null = null
  private state: DubbingSnapshot['state'] = 'idle'
  private generation = 0
  private error: string | null = null
  private userPaused = false
  private blocked: 'ad' | 'media-buffering' | null = null
  private reason: string | null = null
  private original: { volume: number, muted: boolean } | null = null
  private abort = new AbortController()
  private cache = new Map<string, PreparedClip>()
  private finished = new Set<string>()
  private working: number | null = null
  private videoOwned = false
  private autoplayBlocked = false
  private prefill: { generation: number, promise: Promise<void> } | null = null
  private prefillError: Error | null = null
  private alignmentTimeMs: number | null = null

  constructor(
    private readonly _media: SessionMedia,
    private readonly _prepare: PrepareClips,
  ) {}

  async start(cues: DubbingCue[]) {
    const valid = normalizeCues(cues)
    const fresh = this.original === null
    this.original ??= { volume: this._media.volume, muted: this._media.muted }
    if (fresh)
      this.userPaused = this._media.paused
    this.cues = valid
    this.abort.abort()
    this.abort = new AbortController()
    ++this.generation
    this.current = null
    this.display = null
    this.autoplayBlocked = false
    this.cache.clear()
    const now = this._media.currentTimeMs
    this.alignmentTimeMs = now
    this.finished = new Set(valid.filter(cue => cue.endMs <= now).map(cue => cue.id))
    this._media.stopAudio()
    this.error = null
    this.prefill = null
    this.prefillError = null
    this.state = 'preparing'
    await this.tick()
  }

  private hold(reason: string) {
    this.reason = reason
    if (!this.userPaused && !this._media.paused) {
      this.videoOwned = true
      this._media.pauseVideo()
    }
    this.state = this.userPaused ? 'paused' : 'buffering'
  }

  private async release(generation: number) {
    if (this.videoOwned && !this.userPaused && !this.blocked && generation === this.generation) {
      this.videoOwned = false
      if (!this._media.videoEnded)
        await this._media.playVideo()
    }
    this.reason = this.userPaused ? 'user' : this.blocked
  }

  async tick() {
    if (this.state === 'idle' || this.state === 'error' || this.autoplayBlocked || this.working === this.generation)
      return
    const generation = this.generation
    this.working = generation
    try {
      if (this.current && this._media.audioError)
        throw new Error(this._media.audioError)
      if (this.blocked) {
        this._media.pauseAudio()
        this.reason = this.blocked
        this.state = 'paused'
        return
      }
      if (this.current) {
        if (this._media.audioEnded) {
          this.finished.add(this.current.id)
          this.current = null
          await this.release(generation)
        }
        else if (this._media.currentTimeMs >= this.current.endMs) {
          this.hold('dubbing-overrun')
          return
        }
      }
      const now = this._media.currentTimeMs
      // Retain only the current forward window. Audio never accumulates for the whole video.
      for (const [id, clip] of this.cache) {
        if (this.finished.has(id) || clip.startMs > now + 30000)
          this.cache.delete(id)
      }
      const next = this.cues.find(cue => !this.finished.has(cue.id))
      if (this._media.videoEnded && !this.current && (!next || next.startMs > now)) {
        this.stop()
        return
      }
      if (!next || next.startMs > now + 30000) {
        this.state = this.userPaused ? 'paused' : 'playing'
        return
      }
      if (!this.cache.has(next.id)) {
        this.hold('audio-buffering')
        if (this.prefill?.generation === generation)
          await this.prefill.promise
        if (generation !== this.generation)
          return
        if (!this.cache.has(next.id)) {
          if (this.prefillError)
            throw this.prefillError
          const clips = await this._prepare([next], this.abort.signal)
          if (generation !== this.generation)
            return
          this.storeClips(clips)
        }
        if (!this.cache.has(next.id))
          throw new Error('语音服务未返回当前字幕')
      }
      if (this.userPaused) {
        this.state = 'paused'
        this.reason = 'user'
        return
      }
      if (!this.current && next.startMs <= this._media.currentTimeMs) {
        const clip = this.cache.get(next.id)!
        // Only an explicit start/seek aligns within speech. Sequential cues must be read in full.
        const progress
          = this.alignmentTimeMs === null
            ? 0
            : Math.max(0, (this.alignmentTimeMs - clip.startMs) / (clip.endMs - clip.startMs))
        this.alignmentTimeMs = null
        const rate
          = Math.min(1.25, Math.max(1, clip.durationMs / (clip.endMs - clip.startMs))) * this._media.playbackRate
        this.current = clip
        this.display = {
          id: clip.id,
          startMs: clip.startMs,
          endMs: clip.endMs,
          sourceText: clip.sourceText,
          sourceCueIds: [...clip.sourceCueIds],
          translatedText: clip.translatedText,
        }
        await this._media.playAudio(clip, Math.min(clip.durationMs - 1, progress * clip.durationMs), rate)
        if (generation !== this.generation)
          return
      }
      await this.release(generation)
      this.state = 'playing'
      this.prefetch(generation)
    }
    catch (error) {
      if (generation !== this.generation)
        return
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.autoplayBlocked = true
        this._media.pauseVideo()
        this.state = 'paused'
        this.reason = 'autoplay'
        this.error = '请在视频内点击继续播放'
        return
      }
      this.error = error instanceof Error ? error.message : '配音失败'
      this.hold('error')
      this.state = 'error'
      this._media.stopAudio()
    }
    finally {
      if (this.working === generation)
        this.working = null
    }
  }

  private storeClips(clips: PreparedClip[]) {
    let memory = [...this.cache.values()].reduce((total, clip) => total + clip.bytes, 0)
    for (const clip of clips) {
      memory += clip.bytes - (this.cache.get(clip.id)?.bytes ?? 0)
      // 20 MiB in the player plus at most 12 MiB of retry audio in the background.
      if (!Number.isFinite(clip.durationMs) || clip.durationMs <= 0 || clip.bytes > 4194304 || memory > 20971520)
        throw new Error('语音结果超过会话预算或无法解码')
      this.cache.set(clip.id, clip)
    }
  }

  private prefetch(generation: number) {
    if (this.prefill || this.prefillError || this.userPaused || this.blocked)
      return
    const batch: DubbingCue[] = []
    let bytes = 0
    for (const cue of this.cues) {
      if (cue.startMs > this._media.currentTimeMs + 30000 || this.cache.has(cue.id) || this.finished.has(cue.id))
        continue
      const size = new TextEncoder().encode(cue.sourceText).length
      if (batch.length === 3 || bytes + size > 12000)
        break
      batch.push(cue)
      bytes += size
    }
    if (!batch.length)
      return
    const promise = this._prepare(batch, this.abort.signal)
      .then((clips) => {
        if (generation === this.generation)
          this.storeClips(clips)
      })
      .catch((error) => {
        if (generation === this.generation)
          this.prefillError = error instanceof Error ? error : new Error('语音预缓冲失败')
      })
      .finally(() => {
        if (this.prefill?.generation === generation)
          this.prefill = null
      })
    this.prefill = { generation, promise }
  }

  seek() {
    return this.start(this.cues)
  }

  updateSettings(settings: { originalVolume?: number, dubVolume?: number }) {
    if (settings.originalVolume !== undefined && Number.isFinite(settings.originalVolume))
      this._media.volume = Math.max(0, Math.min(1, settings.originalVolume))
    if (settings.dubVolume !== undefined && Number.isFinite(settings.dubVolume))
      this._media.setDubVolume(Math.max(0, Math.min(1, settings.dubVolume)))
  }

  setBlocked(reason: 'ad' | 'media-buffering' | null) {
    if (reason === this.blocked)
      return
    this.blocked = reason
    if (reason) {
      this._media.pauseAudio()
    }
    else if (!this.userPaused && !this.autoplayBlocked && this.current) {
      void this._media.resumeAudio().catch(() => {
        this.error = '请点击继续播放'
        this.state = 'error'
      })
    }
  }

  stop() {
    ++this.generation
    this.abort.abort()
    this._media.stopAudio()
    this.current = null
    this.display = null
    this.cache.clear()
    this.finished.clear()
    if (this.original) {
      this._media.volume = this.original.volume
      this._media.muted = this.original.muted
    }
    this.original = null
    this.cues = []
    this.prefill = null
    this.prefillError = null
    this.alignmentTimeMs = null
    if (this.videoOwned && !this.userPaused && !this.blocked && !this._media.videoEnded)
      void this._media.playVideo().catch(() => {})
    this.videoOwned = false
    this.state = 'idle'
    this.reason = null
    this.autoplayBlocked = false
    this.userPaused = false
    this.blocked = null
  }

  pause() {
    this.userPaused = true
    this._media.pauseVideo()
    this._media.pauseAudio()
    this.state = 'paused'
    this.reason = 'user'
  }

  async resume() {
    this.userPaused = false
    this.autoplayBlocked = false
    this.error = null
    if (this.state === 'error')
      return this.seek()
    if (this.current)
      await this._media.resumeAudio()
    await this.release(this.generation)
    if (!this._media.videoEnded)
      await this._media.playVideo()
    await this.tick()
  }

  snapshot(): DubbingSnapshot {
    const clip = this.current ?? (this.display && this._media.currentTimeMs < this.display.endMs ? this.display : null)
    const cue = clip
      ? {
          id: clip.id,
          startMs: clip.startMs,
          endMs: clip.endMs,
          sourceText: clip.sourceText,
          sourceCueIds: [...clip.sourceCueIds],
          translatedText: clip.translatedText,
        }
      : null
    return {
      state: this.state,
      reason: this.userPaused ? 'user' : this.reason,
      cue,
      generation: this.generation,
      error: this.error,
    }
  }
}
