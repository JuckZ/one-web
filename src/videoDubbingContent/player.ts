import type { DubbingBinding, DubbingCue } from '~/modules/builtin/video-dubbing/contracts'
import { isRecord } from '~/modules/builtin/video-dubbing/contracts'
import type { PreparedClip, SessionMedia } from '~/modules/builtin/video-dubbing/session'
import { DubbingSession } from '~/modules/builtin/video-dubbing/session'

interface PlayerPort {
  postMessage: (_message: unknown) => void
  disconnect?: () => void
  onMessage: { addListener: (_listener: (_message: unknown) => void) => void }
  onDisconnect: { addListener: (_listener: () => void) => void }
}
export interface PlayerMedia extends SessionMedia {
  consumeEngineEvent?: (_event: 'pause' | 'play') => boolean
  dispose?: () => void
  updateAudioRate?: () => void
}
export function mountDubbingPlayer({
  video,
  port,
  media,
  decode,
}: {
  video: HTMLVideoElement
  port: PlayerPort
  media: PlayerMedia
  decode: (_audio: string) => Promise<number>
}) {
  let binding: DubbingBinding | null = null
  let destroyed = false
  let active = false
  let pendingSeek = false
  let display = 'both'
  let captionObserver: PerformanceObserver | null = null
  let lastSnapshot = ''
  const pending = new Map<
    string,
    { resolve: (_clips: PreparedClip[]) => void, reject: (_error: Error) => void, cleanup: () => void }
  >()
  const root = document.createElement('div')
  root.id = 'oneweb-video-dubbing'
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', 'OneWeb 视频配音')
  root.style.cssText
    = 'position:absolute;bottom:56px;left:10%;width:80%;box-sizing:border-box;z-index:2147483647;background:rgba(15,23,42,.92);color:#fff;padding:12px;border-radius:10px;font:16px/1.5 system-ui;text-align:center;pointer-events:auto;'
  const status = document.createElement('div')
  const source = document.createElement('div')
  const translated = document.createElement('div')
  translated.style.fontWeight = '600'
  const controls = document.createElement('div')
  controls.style.cssText = 'display:flex;gap:8px;justify-content:center;align-items:center;font-size:12px;'
  const mode = document.createElement('select')
  mode.setAttribute('aria-label', '字幕显示')
  for (const [value, text] of [
    ['both', '双语'],
    ['source', '原文'],
    ['translated', '译文'],
    ['none', '隐藏字幕'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    mode.append(option)
  }
  mode.addEventListener('change', () => {
    display = mode.value
    render()
  })
  controls.append(mode)
  root.append(status, source, translated, controls)
  const container = video.closest<HTMLElement>('#movie_player, .bpx-player-container, #bilibili-player, .bilibili-player')
    ?? video.parentElement ?? document.body
  const oldPosition = container.style.position
  if (getComputedStyle(container).position === 'static')
    container.style.position = 'relative'
  container.append(root)

  const session = new DubbingSession(
    media,
    (cues, signal) =>
      new Promise((resolve, reject) => {
        if (!binding || destroyed || signal.aborted) {
          reject(new Error('会话已取消'))
          return
        }
        const requestId = crypto.randomUUID()
        const abort = () => {
          port.postMessage({ type: 'cancel', requestId })
          pending.delete(requestId)
          cleanup()
          reject(new Error('会话已取消'))
        }
        const timer = setTimeout(abort, 65000)
        function cleanup() {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
        }
        signal.addEventListener('abort', abort, { once: true })
        pending.set(requestId, { resolve, reject, cleanup })
        port.postMessage({ type: 'prepare', requestId, generation: binding.generation, ids: cues.map(cue => cue.id) })
      }),
  )

  const button = (text: string, action: () => void) => {
    const element = document.createElement('button')
    element.textContent = text
    element.type = 'button'
    element.style.cssText
      = 'font:inherit;border:1px solid #64748b;border-radius:5px;padding:3px 8px;background:#334155;color:white;cursor:pointer;'
    element.addEventListener('click', action)
    controls.append(element)
  }
  button('继续播放', () => {
    void session.resume().catch((error) => {
      status.textContent = `请再次点击继续播放：${error instanceof Error ? error.message : '自动播放被阻止'}`
    })
  })
  button('暂停', () => session.pause())
  button('停止', () => {
    port.postMessage({ type: 'stop' })
    active = false
    session.stop()
    render()
  })

  function render() {
    if (destroyed)
      return
    const snapshot = session.snapshot()
    if (active && media.videoEnded && snapshot.state === 'idle') {
      active = false
      port.postMessage({ type: 'stop' })
    }
    const labels: Record<string, string> = {
      idle: '未启动',
      preparing: '准备中',
      buffering: '缓冲中',
      playing: '配音中',
      paused: '已暂停',
      error: '配音失败，请点击继续播放或侧栏重试',
    }
    status.textContent = `${labels[snapshot.state]}${snapshot.error ? ` · ${snapshot.error}` : ''}${snapshot.reason ? ` · ${snapshot.reason}` : ''}`
    source.textContent = display === 'both' || display === 'source' ? (snapshot.cue?.sourceText ?? '') : ''
    translated.textContent = display === 'both' || display === 'translated' ? (snapshot.cue?.translatedText ?? '') : ''
    const serialized = JSON.stringify(snapshot)
    if (serialized !== lastSnapshot) {
      lastSnapshot = serialized
      port.postMessage({ type: 'status', snapshot })
    }
  }

  port.onMessage.addListener((message) => {
    if (destroyed || !isRecord(message))
      return
    if (message.type === 'bound' && isRecord(message.binding)) {
      binding = message.binding as unknown as DubbingBinding
      if (typeof PerformanceObserver !== 'undefined') {
        captionObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType !== 'resource' || entry.name.length > 8192)
              continue
            let url: URL
            try {
              url = new URL(entry.name)
            }
            catch {
              continue
            }
            if (
              url.origin === location.origin
              && url.pathname === '/api/timedtext'
              && url.searchParams.get('v') === binding?.videoId
            ) {
              port.postMessage({ type: 'caption-request', url: entry.name })
            }
          }
        })
        captionObserver.observe({ type: 'resource', buffered: true })
      }
      return
    }
    if (message.type === 'prepared' || message.type === 'failed') {
      if (!binding || message.generation !== binding.generation || typeof message.requestId !== 'string')
        return
      const request = pending.get(message.requestId)
      if (!request)
        return
      pending.delete(message.requestId)
      request.cleanup()
      if (message.type === 'failed') {
        request.reject(new Error(typeof message.error === 'string' ? message.error : '服务请求失败'))
        return
      }
      void (async () => {
        if (!Array.isArray(message.clips))
          throw new Error('语音结果无效')
        const clips: PreparedClip[] = []
        for (const clip of message.clips) {
          if (
            !isRecord(clip)
            || typeof clip.audio !== 'string'
            || clip.audio.length > 5592408
            || typeof clip.bytes !== 'number'
            || clip.bytes > 4194304
          ) {
            throw new Error('语音结果无效')
          }
          clips.push({
            ...clip,
            durationMs: await decode(clip.audio).catch((error) => {
              port.postMessage({ type: 'discard-audio', generation: message.generation, ids: [clip.id] })
              throw error
            }),
          } as unknown as PreparedClip)
        }
        request.resolve(clips)
      })().catch(() => request.reject(new Error('语音无法解码，请检查服务音频格式')))
      return
    }
    if (
      !binding
      || !isRecord(message.binding)
      || message.binding.sessionId !== binding.sessionId
      || message.binding.videoId !== binding.videoId
      || typeof message.binding.generation !== 'number'
      || message.binding.generation < binding.generation
    ) {
      return
    }
    binding = message.binding as unknown as DubbingBinding
    if (message.type === 'refresh-captions') {
      const cc = video.closest('#movie_player')?.querySelector<HTMLButtonElement>('.ytp-subtitles-button')
      if (cc && !cc.disabled) {
        if (cc.getAttribute('aria-pressed') === 'true')
          cc.click()
        cc.click()
      }
    }
    else if (message.type === 'start' && Array.isArray(message.cues)) {
      active = true
      void session
        .start(message.cues as DubbingCue[])
        .then(render)
        .catch(() => {
          status.textContent = '字幕无效'
        })
    }
    else if (message.type === 'advanced' && active && pendingSeek) {
      pendingSeek = false
      void session.seek().then(render)
    }
    else if (message.type === 'stop') {
      pendingSeek = false
      active = false
      session.stop()
    }
    else if (message.type === 'pause') {
      session.pause()
    }
    else if (message.type === 'resume') {
      void session
        .resume()
        .then(render)
        .catch(() => {
          status.textContent = '请在视频内点击继续播放'
        })
    }
    else if (message.type === 'volumes' && isRecord(message.settings)) {
      session.updateSettings(message.settings)
    }
    render()
  })
  const listeners: Array<[string, EventListener]> = []
  const listen = (name: string, handler: () => void) => {
    video.addEventListener(name, handler)
    listeners.push([name, handler])
  }
  listen('pause', () => {
    const engineEvent = media.consumeEngineEvent?.('pause')
    if (active && !engineEvent && !video.ended)
      session.pause()
  })
  listen('play', () => {
    const engineEvent = media.consumeEngineEvent?.('play')
    if (active && !engineEvent)
      void session.resume().catch(() => {})
  })
  listen('seeking', () => {
    if (!active)
      return
    media.stopAudio()
    session.setBlocked('media-buffering')
    pendingSeek = true
    port.postMessage({ type: 'advance' })
  })
  listen('seeked', () => session.setBlocked(null))
  listen('waiting', () => {
    if (active)
      session.setBlocked('media-buffering')
  })
  listen('playing', () => {
    if (active)
      session.setBlocked(null)
  })
  listen('ratechange', () => media.updateAudioRate?.())
  listen('ended', () => {
    if (active)
      void session.tick().then(render)
  })
  const fullscreen = () => {
    const target = document.fullscreenElement
    if (target?.contains(video))
      target.append(root)
    else container.append(root)
  }
  document.addEventListener('fullscreenchange', fullscreen)
  const timer = setInterval(() => {
    if (active) {
      const ad = !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')
      session.setBlocked(ad ? 'ad' : video.readyState < 3 && !video.ended ? 'media-buffering' : null)
      void session.tick().then(render)
    }
    else {
      render()
    }
  }, 100)
  function destroy() {
    if (destroyed)
      return
    destroyed = true
    clearInterval(timer)
    captionObserver?.disconnect()
    for (const request of pending.values()) {
      request.cleanup()
      request.reject(new Error('播放器连接已关闭'))
    }
    pending.clear()
    session.stop()
    media.dispose?.()
    for (const [name, handler] of listeners) video.removeEventListener(name, handler)
    document.removeEventListener('fullscreenchange', fullscreen)
    container.style.position = oldPosition
    root.remove()
  }
  port.onDisconnect.addListener(destroy)
  render()
  return { root, render, destroy }
}
