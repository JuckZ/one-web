import type { PlayerMedia } from './player'
import type { PreparedClip } from '~/modules/builtin/video-dubbing/session'

function audioBytes(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
export async function decodeDuration(base64: string): Promise<number> {
  const context = new OfflineAudioContext(1, 1, 24000)
  const buffer = await context.decodeAudioData(audioBytes(base64))
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 300)
    throw new Error('语音时长无效或超过 5 分钟')
  return buffer.duration * 1000
}
export function createPlayerMedia(video: HTMLVideoElement): PlayerMedia {
  const audio = document.createElement('audio')
  audio.dataset.onewebDubAudio = ''
  audio.hidden = true
  audio.preload = 'auto'
  audio.preservesPitch = true
  ;(video.parentElement ?? document.body).append(audio)
  let objectUrl: string | null = null
  let ended = true
  let pauseEvents = 0
  let playEvents = 0
  let speed = 1
  const stopAudio = () => {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    ended = true
    if (objectUrl)
      URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  audio.addEventListener('ended', () => {
    ended = true
  })
  return {
    get currentTimeMs() {
      return video.currentTime * 1000
    },
    get paused() {
      return video.paused
    },
    set paused(_value) {},
    get playbackRate() {
      return video.playbackRate
    },
    set playbackRate(value) {
      video.playbackRate = value
    },
    get volume() {
      return video.volume
    },
    set volume(value) {
      video.volume = value
    },
    get muted() {
      return video.muted
    },
    set muted(value) {
      video.muted = value
    },
    get videoEnded() {
      return video.ended
    },
    get audioEnded() {
      return ended
    },
    set audioEnded(_value) {},
    get audioTimeMs() {
      return audio.currentTime * 1000
    },
    set audioTimeMs(_value) {},
    get audioError() {
      return audio.error ? '语音播放失败，请重试或检查音频设备' : null
    },
    pauseVideo() {
      if (!video.paused) {
        ++pauseEvents
        video.pause()
      }
    },
    async playVideo() {
      if (video.paused && !video.ended) {
        ++playEvents
        try {
          await video.play()
        }
        catch (error) {
          playEvents = Math.max(0, playEvents - 1)
          throw error
        }
      }
    },
    async playAudio(clip: PreparedClip, offsetMs: number, rate: number) {
      stopAudio()
      objectUrl = URL.createObjectURL(new Blob([audioBytes(clip.audio)], { type: clip.mime }))
      audio.src = objectUrl
      ended = false
      speed = rate / video.playbackRate
      audio.playbackRate = Math.min(4, Math.max(0.25, rate))
      audio.currentTime = offsetMs / 1000
      await audio.play()
    },
    pauseAudio() {
      audio.pause()
    },
    async resumeAudio() {
      if (!ended && audio.paused)
        await audio.play()
    },
    stopAudio,
    setDubVolume(value) {
      audio.volume = value
    },
    consumeEngineEvent(event) {
      if (event === 'pause' && pauseEvents) {
        --pauseEvents
        return true
      }
      if (event === 'play' && playEvents) {
        --playEvents
        return true
      }
      return false
    },
    updateAudioRate() {
      audio.playbackRate = Math.min(4, Math.max(0.25, video.playbackRate * speed))
    },
    dispose() {
      stopAudio()
      audio.remove()
    },
  }
}
