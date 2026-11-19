import { byteLength, MAX_MINI_APP_BYTES } from './model'
import { MINI_APP_RUNNER_CHANNEL } from './sandbox-policy'

interface MiniAppMountOptions { html: string, sandboxUrl: string, title?: string }
interface RuntimeOrigin { isSameOrigin: (_other: RuntimeOrigin) => boolean }
interface OriginFactory { from: (_event: MessageEvent) => RuntimeOrigin }

/** A sandbox is a rendering destination only; no privileged messages are accepted from apps. */
export class MiniAppRunner {
  private frame: HTMLIFrameElement | null = null
  private cancel: (() => void) | null = null

  async mount(root: HTMLElement, options: MiniAppMountOptions): Promise<void> {
    this.dispose()
    if (typeof options.html !== 'string' || !options.html.trim() || byteLength(options.html) > MAX_MINI_APP_BYTES)
      throw new Error('小应用内容为空或超过大小限制')
    const url = new URL(options.sandboxUrl)
    if (!['chrome-extension:', 'moz-extension:'].includes(url.protocol) || !url.hostname
      || url.pathname !== '/sandbox.html' || url.search || url.hash) {
      throw new Error('小应用必须使用 OneWeb 打包的隔离运行页')
    }
    const token = crypto.randomUUID()
    url.hash = token
    const frame = document.createElement('iframe')
    frame.className = 'smart-app-preview'
    frame.title = options.title || '小应用预览'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('allow', 'camera \'none\'; microphone \'none\'; geolocation \'none\'; clipboard-read \'none\'; clipboard-write \'none\'')
    frame.referrerPolicy = 'no-referrer'
    this.frame = frame
    await new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      let loaded = false
      let pinnedOrigin: RuntimeOrigin | null = null
      const originFactory = (globalThis as typeof globalThis & { Origin?: OriginFactory }).Origin
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        window.removeEventListener('message', handleMessage)
        this.cancel = null
        if (error) {
          frame.remove()
          if (this.frame === frame)
            this.frame = null
          reject(error)
        }
        else { resolve() }
      }
      function handleMessage(event: MessageEvent) {
        if (event.source !== frame.contentWindow || event.origin !== 'null'
          || !event.data || typeof event.data !== 'object'
          || event.data.channel !== MINI_APP_RUNNER_CHANNEL || event.data.token !== token
          || !['ready', 'loaded', 'error'].includes(event.data.type)) {
          return
        }
        if (originFactory) {
          try {
            const senderOrigin = originFactory.from(event)
            if (pinnedOrigin && !senderOrigin.isSameOrigin(pinnedOrigin))
              return
            pinnedOrigin = senderOrigin
          }
          catch { return }
        }
        if (event.data.type === 'ready' && !loaded) {
          loaded = true
          // Opaque sandbox origins require '*'; source, nonce and optional Origin pin bind the peer.
          frame.contentWindow?.postMessage({ channel: MINI_APP_RUNNER_CHANNEL, token, type: 'render', html: options.html }, '*')
        }
        else if (loaded && event.data.type === 'loaded') {
          finish()
        }
        else if (event.data.type === 'error') {
          finish(new Error('小应用运行页加载失败'))
        }
      }
      timeout = setTimeout(() => finish(new Error('小应用运行页连接超时，请刷新后重试')), 8000)
      this.cancel = () => finish(new Error('小应用预览已关闭'))
      window.addEventListener('message', handleMessage)
      frame.src = url.href
      root.append(frame)
    })
  }

  dispose() {
    this.cancel?.()
    this.cancel = null
    this.frame?.remove()
    this.frame = null
  }
}
