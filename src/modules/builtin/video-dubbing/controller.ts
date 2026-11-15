import type { DubbingBinding, DubbingCommand, DubbingCue, DubbingStatus, PlayerInfo } from './contracts'
import type { DubbingConfig } from './provider'
import type { DubbingSnapshot } from './session'
import { bilibiliSubtitleUrl, loadBilibiliCues } from './bilibili'
import { CONFIG_KEY, redactConfig, serviceOrigins, validateConfig } from './config'
import { DUBBING_PORT, isRecord, VIDEO_DUBBING_MODULE_ID } from './contracts'
import { DubbingProvider } from './provider'
import { dubbingSite } from './sites'
import { importSubtitles } from './subtitles'
import { EmptyYouTubeCaptionsError, loadYouTubeCues } from './youtube'

export interface DubbingDependencies {
  extensionId: string
  registry: { get: (_id: string) => Promise<{ enabled: boolean } | null | undefined> }
  storage: {
    get: (_key: string) => Promise<Record<string, unknown>>
    set: (_data: Record<string, unknown>) => Promise<void>
    remove: (_key: string) => Promise<void>
  }
  permissions: {
    contains: (_query: { origins: string[] }) => Promise<boolean>
    remove?: (_query: { origins: string[] }) => Promise<boolean>
  }
  originInUse?: (_pattern: string) => Promise<boolean>
  tabs: {
    query: (_query: { active: boolean, currentWindow: boolean }) => Promise<Array<{ id?: number, url?: string }>>
    get: (_id: number) => Promise<{ id?: number, url?: string }>
  }
  injection: { discover: (_tabId: number) => Promise<PlayerInfo>, inject: (_tabId: number) => Promise<void> }
}
export interface DubbingPort {
  name: string
  sender?: { id?: string, tab?: { id?: number }, frameId?: number, documentId?: string, url?: string }
  postMessage: (_message: unknown) => void
  disconnect: () => void
  onMessage: { addListener: (_listener: (_message: unknown) => void) => void }
  onDisconnect: { addListener: (_listener: () => void) => void }
}
interface Connection {
  info: PlayerInfo
  pattern: string
  origins: string[]
  binding: DubbingBinding
  port: DubbingPort | null
  cues: DubbingCue[]
  language: string
  pending: Map<string, AbortController>
  snapshot: DubbingSnapshot | null
  provider: DubbingProvider | null
  captionRefresh?: { trackId: string, resolve: (_url: string) => void, reject: (_error: Error) => void }
}
export class VideoDubbingController {
  readonly moduleId = VIDEO_DUBBING_MODULE_ID
  private revision = 0
  private tabEpochs = new Map<number, number>()
  private connections = new Map<number, Connection>()
  constructor(private readonly _deps: DubbingDependencies) {}

  private async config(): Promise<DubbingConfig | null> {
    const value = (await this._deps.storage.get(CONFIG_KEY))[CONFIG_KEY]
    return value ? validateConfig(value) : null
  }

  private async site(): Promise<DubbingStatus['site']> {
    const [tab] = await this._deps.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined || !tab.url)
      return null
    const site = dubbingSite(tab.url)
    return site ? { tabId: tab.id, ...site } : null
  }

  invalidate(tabId?: number) {
    if (tabId === undefined) {
      ++this.revision
      this.tabEpochs.clear()
    }
    else {
      this.tabEpochs.set(tabId, (this.tabEpochs.get(tabId) ?? 0) + 1)
    }
    for (const [id, connection] of this.connections) {
      if (tabId !== undefined && tabId !== id)
        continue
      this.connections.delete(id)
      connection.captionRefresh?.reject(new Error('视频或配置已切换'))
      for (const pending of connection.pending.values()) pending.abort()
      connection.pending.clear()
      try {
        connection.port?.disconnect()
      }
      catch {}
    }
  }

  async permissionsChanged() {
    const config = await this.config()
    for (const [tabId, connection] of this.connections) {
      if (
        !(await this._deps.permissions.contains({
          origins: [...connection.origins, ...(config ? serviceOrigins(config) : [])],
        }))
      ) {
        this.invalidate(tabId)
      }
    }
  }

  async acceptPort(port: DubbingPort) {
    if (port.name !== DUBBING_PORT)
      return
    const sender = port.sender
    const connection = sender?.tab?.id === undefined ? undefined : this.connections.get(sender.tab.id)
    const currentTab = connection ? await this._deps.tabs.get(connection.binding.tabId).catch(() => null) : null
    const currentSite = dubbingSite(currentTab?.url ?? '')
    let senderOrigin = ''
    try {
      senderOrigin = new URL(sender?.url ?? '').origin
    }
    catch {}
    if (
      !connection
      || sender?.id !== this._deps.extensionId
      || sender.frameId !== 0
      || connection.port
      || (connection.info.documentId ? sender.documentId !== connection.info.documentId : currentTab?.url !== sender.url)
      || currentSite?.videoId !== connection.binding.videoId
      || currentSite?.pattern !== connection.pattern
      || `${senderOrigin}/*` !== connection.pattern
      || !(await this._deps.registry.get(this.moduleId))?.enabled
      || !(await this._deps.permissions.contains({ origins: connection.origins }))
    ) {
      port.disconnect()
      return
    }
    if (this.connections.get(connection.binding.tabId) !== connection) {
      port.disconnect()
      return
    }
    connection.port = port
    port.onDisconnect.addListener(() => {
      if (this.connections.get(connection.binding.tabId) === connection)
        this.invalidate(connection.binding.tabId)
    })
    port.onMessage.addListener((message) => {
      void this.playerMessage(connection, message).catch(() => {
        this.invalidate(connection.binding.tabId)
      })
    })
    port.postMessage({ type: 'bound', binding: connection.binding })
  }

  private async playerMessage(connection: Connection, message: unknown) {
    if (!isRecord(message) || this.connections.get(connection.binding.tabId) !== connection)
      return
    if (message.type === 'caption-request' && typeof message.url === 'string' && message.url.length <= 8192) {
      let url: URL
      try {
        url = new URL(message.url)
      }
      catch {
        return
      }
      if (
        url.origin !== new URL(connection.pattern).origin
        || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
        || url.pathname !== '/api/timedtext'
        || url.username
        || url.password
        || url.hash
        || url.searchParams.get('v') !== connection.binding.videoId
        || url.searchParams.has('tlang')
      ) {
        return
      }
      const track = connection.info.tracks.find(
        track =>
          track.language === url.searchParams.get('lang')
          && new URL(track.url).searchParams.get('kind') === url.searchParams.get('kind'),
      )
      if (track) {
        track.url = message.url
        if (connection.captionRefresh?.trackId === track.id)
          connection.captionRefresh.resolve(message.url)
      }
      return
    }
    if (message.type === 'status') {
      const value = message.snapshot
      if (
        isRecord(value)
        && ['idle', 'preparing', 'buffering', 'playing', 'paused', 'error'].includes(String(value.state))
        && JSON.stringify(value).length < 32768
      ) {
        connection.snapshot = value as unknown as DubbingSnapshot
      }
      return
    }
    if (
      message.type === 'discard-audio'
      && message.generation === connection.binding.generation
      && Array.isArray(message.ids)
      && message.ids.length <= 3
      && message.ids.every(id => typeof id === 'string' && connection.cues.some(cue => cue.id === id))
    ) {
      connection.provider?.discardAudio(message.ids as string[])
      return
    }
    if (message.type === 'stop') {
      connection.captionRefresh?.reject(new Error('配音已停止'))
      for (const pending of connection.pending.values()) pending.abort()
      connection.pending.clear()
      connection.provider = null
      connection.cues = []
      ++connection.binding.generation
      return
    }
    if (message.type === 'cancel' && typeof message.requestId === 'string') {
      connection.pending.get(message.requestId)?.abort()
      connection.pending.delete(message.requestId)
      return
    }
    if (message.type === 'advance') {
      connection.captionRefresh?.reject(new Error('播放位置已切换'))
      for (const pending of connection.pending.values()) pending.abort()
      connection.pending.clear()
      ++connection.binding.generation
      connection.port?.postMessage({ type: 'advanced', binding: connection.binding })
      return
    }
    if (
      message.type !== 'prepare'
      || typeof message.requestId !== 'string'
      || message.requestId.length > 128
      || !Array.isArray(message.ids)
      || !message.ids.length
      || message.ids.length > 3
      || new Set(message.ids).size !== message.ids.length
      || !message.ids.every(id => typeof id === 'string')
      || message.generation !== connection.binding.generation
      || connection.pending.size >= 2
      || connection.pending.has(message.requestId)
    ) {
      return
    }
    const cues = message.ids.map(id => connection.cues.find(cue => cue.id === id))
    if (cues.some(cue => !cue))
      return
    const abort = new AbortController()
    connection.pending.set(message.requestId, abort)
    const generation = connection.binding.generation
    try {
      const config = await this.config()
      const tab = await this._deps.tabs.get(connection.binding.tabId)
      if (
        !config
        || !(await this._deps.registry.get(this.moduleId))?.enabled
        || !tab.url
        || dubbingSite(tab.url)?.videoId !== connection.binding.videoId
        || dubbingSite(tab.url)?.pattern !== connection.pattern
        || !(await this._deps.permissions.contains({ origins: [...connection.origins, ...serviceOrigins(config)] }))
      ) {
        throw new Error('配音配置或权限已失效')
      }
      if (abort.signal.aborted || this.connections.get(connection.binding.tabId) !== connection)
        return
      connection.provider ??= new DubbingProvider(config)
      const clips = await connection.provider.prepare(cues as DubbingCue[], connection.language, abort.signal)
      if (
        !abort.signal.aborted
        && generation === connection.binding.generation
        && this.connections.get(connection.binding.tabId) === connection
      ) {
        connection.port?.postMessage({ type: 'prepared', requestId: message.requestId, generation, clips })
      }
    }
    catch (error) {
      if (!abort.signal.aborted) {
        connection.port?.postMessage({
          type: 'failed',
          requestId: message.requestId,
          generation,
          error: error instanceof Error ? error.message : '服务请求失败',
        })
      }
    }
    finally {
      if (connection.pending.get(message.requestId) === abort)
        connection.pending.delete(message.requestId)
    }
  }

  async usesOriginPattern(pattern: string) {
    const config = await this.config()
    return (
      [...this.connections.values()].some(connection => connection.origins.includes(pattern))
      || (!!config && serviceOrigins(config).includes(pattern))
    )
  }

  private refreshYouTubeCaptions(connection: Connection, trackId: string) {
    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const pending = {
        trackId,
        resolve: (url: string) => finish(undefined, url),
        reject: (error: Error) => finish(error),
      }
      function finish(error?: Error, url = '') {
        clearTimeout(timer)
        if (connection.captionRefresh === pending)
          connection.captionRefresh = undefined
        if (error)
          reject(error)
        else
          resolve(url)
      }
      timer = setTimeout(() => finish(new Error(
        '未取得对应字幕：请在 YouTube CC 选择所选轨道的语言后重试，或导入 SRT / VTT',
      )), 6000)
      connection.captionRefresh = pending
      connection.port?.postMessage({ type: 'refresh-captions', binding: { ...connection.binding } })
    })
  }

  async handle(command: DubbingCommand, data: unknown = {}): Promise<DubbingStatus> {
    if (!(await this._deps.registry.get(this.moduleId))?.enabled)
      throw new Error('模块未启用')
    const revision = this.revision
    if (command === 'save') {
      const config = validateConfig(isRecord(data) ? data.config : null, await this.config())
      if (!(await this._deps.permissions.contains({ origins: serviceOrigins(config) })))
        throw new Error('请先授权配置的服务源')
      this.invalidate()
      ++this.revision
      await this._deps.storage.set({ [CONFIG_KEY]: config })
    }
    if (command === 'delete') {
      this.invalidate()
      ++this.revision
      await this._deps.storage.remove(CONFIG_KEY)
    }
    const site = await this.site()
    if (command === 'open') {
      if (!site)
        throw new Error('请打开 YouTube、Bilibili 点播或含 HTML5 视频的网页')
      const tabEpoch = this.tabEpochs.get(site.tabId) ?? 0
      if (!(await this._deps.permissions.contains({ origins: site.origins ?? [site.pattern] })))
        throw new Error('请先授权当前站点')
      const player = await this._deps.injection.discover(site.tabId)
      if (player.videoId !== site.videoId)
        throw new Error('视频已切换，请重新读取')
      if (revision !== this.revision || tabEpoch !== (this.tabEpochs.get(site.tabId) ?? 0) || !(await this._deps.registry.get(this.moduleId))?.enabled)
        throw new Error('操作已失效')
      const currentTab = await this._deps.tabs.get(site.tabId)
      const currentSite = dubbingSite(currentTab.url ?? '')
      if (currentSite?.videoId !== site.videoId || currentSite?.pattern !== site.pattern
        || !(await this._deps.permissions.contains({ origins: site.origins ?? [site.pattern] }))) {
        throw new Error('视频或站点授权已失效，请重新读取')
      }
      this.invalidate(site.tabId)
      this.connections.set(site.tabId, {
        info: player,
        pattern: site.pattern,
        origins: site.origins ?? [site.pattern],
        binding: {
          tabId: site.tabId,
          documentId: player.documentId,
          videoId: player.videoId,
          sessionId: crypto.randomUUID(),
          generation: 0,
        },
        port: null,
        cues: [],
        language: 'zh-CN',
        pending: new Map(),
        snapshot: null,
        provider: null,
      })
      await this._deps.injection.inject(site.tabId)
    }
    let connection = site ? this.connections.get(site.tabId) : undefined
    if (connection && site && (connection.binding.videoId !== site.videoId || connection.pattern !== site.pattern)) {
      this.invalidate(site.tabId)
      connection = undefined
    }
    if (command === 'start') {
      const generation = connection?.binding.generation
      if (!connection?.port || !site)
        throw new Error('请先读取当前视频，等待播放器连接')
      connection.captionRefresh?.reject(new Error('配音已重新启动'))
      const config = await this.config()
      if (!config || !(await this._deps.permissions.contains({ origins: [...connection.origins, ...serviceOrigins(config)] })))
        throw new Error('请配置并授权翻译和语音服务')
      if (!isRecord(data) || typeof data.language !== 'string' || !/^[\w-]{2,32}$/.test(data.language))
        throw new Error('目标语言无效')
      let cues: DubbingCue[]
      if (typeof data.subtitles === 'string' && data.subtitles.trim()) {
        cues = importSubtitles(data.subtitles)
      }
      else {
        const track = connection.info.tracks.find(track => track.id === data.trackId)
        const isBilibili = site.platform === 'bilibili'
        if (!track || (isBilibili ? !bilibiliSubtitleUrl(track.url) : new URL(track.url).origin !== site.origin))
          throw new Error('没有可用字幕，请导入 SRT / VTT')
        const origin = `${new URL(track.url).origin}/*`
        if (!(await this._deps.permissions.contains({ origins: [origin] })))
          throw new Error('请先授权所选字幕源')
        if (!connection.origins.includes(origin))
          connection.origins.push(origin)
        if (isBilibili) {
          cues = await loadBilibiliCues(track.url, AbortSignal.timeout(20000))
        }
        else {
          try {
            cues = await loadYouTubeCues(track.url, AbortSignal.timeout(20000))
          }
          catch (error) {
            if (!(error instanceof EmptyYouTubeCaptionsError))
              throw error
            if (this.connections.get(site.tabId) !== connection || generation !== connection.binding.generation)
              throw new Error('视频或配置已切换')
            const refreshedUrl = await this.refreshYouTubeCaptions(connection, track.id)
            const current = dubbingSite((await this._deps.tabs.get(site.tabId)).url ?? '')
            const granted = await this._deps.permissions.contains({ origins: connection.origins })
            if (this.connections.get(site.tabId) !== connection || generation !== connection.binding.generation
              || revision !== this.revision || current?.videoId !== site.videoId
              || current.pattern !== site.pattern || !granted) {
              throw new Error('视频或配置已切换')
            }
            cues = await loadYouTubeCues(refreshedUrl, AbortSignal.timeout(20000))
          }
        }
      }
      const currentSite = dubbingSite((await this._deps.tabs.get(site.tabId)).url ?? '')
      if (
        this.connections.get(site.tabId) !== connection
        || revision !== this.revision
        || generation !== connection.binding.generation
        || currentSite?.videoId !== site.videoId
        || currentSite?.pattern !== site.pattern
        || !(await this._deps.permissions.contains({ origins: connection.origins }))
      ) {
        throw new Error('视频或配置已切换')
      }
      for (const pending of connection.pending.values()) pending.abort()
      connection.pending.clear()
      connection.cues = cues
      connection.language = data.language
      ++connection.binding.generation
      connection.port.postMessage({ type: 'start', binding: { ...connection.binding }, cues })
    }
    if (command === 'stop' || command === 'pause' || command === 'resume' || command === 'volumes') {
      if (connection?.port) {
        if (command === 'stop') {
          connection.captionRefresh?.reject(new Error('配音已停止'))
          connection.provider = null
          connection.cues = []
          for (const pending of connection.pending.values()) pending.abort()
          connection.pending.clear()
          ++connection.binding.generation
        }
        if (
          command === 'volumes'
          && (!isRecord(data)
            || !['originalVolume', 'dubVolume'].every(
              key =>
                typeof data[key] === 'number'
                && Number.isFinite(data[key])
                && Number(data[key]) >= 0
                && Number(data[key]) <= 1,
            ))
        ) {
          throw new Error('音量无效')
        }
        connection.port.postMessage({
          type: command,
          ...(command === 'volumes' ? { settings: data } : {}),
          binding: { ...connection.binding },
        })
      }
    }
    if (command === 'revoke' && site) {
      for (const [tabId, current] of this.connections) {
        if (current.pattern === site.pattern)
          this.invalidate(tabId)
      }
      if (!(await this._deps.originInUse?.(site.pattern)))
        await this._deps.permissions.remove?.({ origins: [site.pattern] })
    }
    return {
      configuration: redactConfig(await this.config()),
      site,
      player: site ? (this.connections.get(site.tabId)?.info ?? null) : null,
      snapshot: connection?.snapshot ?? null,
    }
  }
}
