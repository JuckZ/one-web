import { serviceOrigins, validateConfig } from '~/modules/builtin/video-dubbing/config'
import type { DubbingCommand, DubbingStatus } from '~/modules/builtin/video-dubbing/contracts'
import { SUBTITLE_LIMIT } from '~/modules/builtin/video-dubbing/contracts'
import type { DubbingClient } from '~/modules/builtin/video-dubbing/protocol'
import { importSubtitles } from '~/modules/builtin/video-dubbing/subtitles'

export interface VideoDubbingViewOptions {
  client: Pick<DubbingClient, 'request'>
  permissions: { request: (_query: { origins: string[] }) => Promise<boolean> }
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const result = document.createElement(tag)
  result.textContent = text
  return result
}
export class VideoDubbingView {
  private fields = new Map<string, HTMLInputElement>()
  private feedback = node('p')
  private statusLine = node('p')
  private status: DubbingStatus | null = null
  private destroyed = false
  private timer: ReturnType<typeof setInterval>
  private busy = false
  private tracks = node('select')
  private language = node('input')
  private imported: { videoId: string, text: string } | null = null
  private importNote = node('p')
  private trackKey = ''

  constructor(
    readonly root: HTMLElement,
    private readonly _options: VideoDubbingViewOptions,
  ) {
    root.className = 'video-dubbing-panel'
    root.dataset.testid = 'video-dubbing'
    root.setAttribute('aria-busy', 'false')
    root.append(
      node('h3', '视频配音'),
      node(
        'p',
        '启动后会把字幕发送到你配置的翻译与语音服务。API key 仅保存在本机扩展中。支持 YouTube、Bilibili 点播；其他顶层 HTML5 视频可导入 SRT / VTT。',
      ),
    )
    const details = node('details')
    details.open = true
    details.append(node('summary', '翻译与语音服务（兼容接口）'))
    for (const label of [
      '翻译服务地址',
      '翻译模型',
      '翻译 API key',
      '语音服务地址',
      '语音模型',
      '语音 API key',
      '声音',
    ]) {
      const wrapper = node('label', label)
      const input = node('input')
      input.setAttribute('aria-label', label)
      input.type = label.includes('key') ? 'password' : 'text'
      input.autocomplete = 'off'
      input.spellcheck = false
      wrapper.append(input)
      details.append(wrapper)
      this.fields.set(label, input)
    }
    this.button(details, 'save', '授权服务源并保存', () => this.save())
    this.button(details, 'delete', '删除配置和密钥', () => this.command('delete'))
    const controls = node('div')
    controls.className = 'video-dubbing-controls'
    this.button(controls, 'refresh', '刷新当前标签页', () => this.refresh(false))
    this.button(controls, 'open', '授权站点并读取视频', async () => {
      const site = this.status?.site
      if (!site)
        throw new Error('请先切换到 YouTube、Bilibili 点播或 HTML5 视频页并刷新')
      if (!(await this._options.permissions.request({ origins: site.origins ?? [site.pattern] })))
        throw new Error('未授予当前站点权限')
      this.imported = null
      this.importNote.textContent = ''
      await this.command('open')
      this.message(this.status?.player?.captionNotice ?? '视频已读取；选择轨道或导入字幕后启动。')
    })
    const stopForChange = () => {
      void this.command('stop').catch(error => this.message(String(error), true))
    }
    this.tracks.addEventListener('change', stopForChange)
    this.language.addEventListener('change', stopForChange)
    this.tracks.setAttribute('aria-label', '字幕轨道')
    const trackLabel = node('label', '字幕轨道')
    trackLabel.append(this.tracks)
    const languageLabel = node('label', '目标语言（如 zh-CN、en、ja）')
    this.language.setAttribute('aria-label', '目标语言')
    this.language.value = 'zh-CN'
    languageLabel.append(this.language)
    const fileLabel = node('label', '导入字幕 SRT / VTT（绑定当前视频，优先于轨道）')
    const file = node('input')
    file.type = 'file'
    file.accept = '.srt,.vtt'
    file.setAttribute('aria-label', '导入字幕')
    file.addEventListener('change', () => {
      const selected = file.files?.[0]
      const videoId = this.status?.player?.videoId
      void (async () => {
        if (!selected || !videoId)
          throw new Error('请先读取当前视频')
        if (selected.size > SUBTITLE_LIMIT)
          throw new Error('字幕超过 2 MiB')
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer())
        const cues = importSubtitles(text)
        if (this.status?.player?.videoId !== videoId)
          throw new Error('视频已切换，请重新导入')
        await this.command('stop')
        this.imported = { videoId, text }
        this.importNote.textContent = `已导入 ${selected.name} · ${cues.length} 条字幕`
      })().catch(error => this.message(error instanceof Error ? error.message : '字幕导入失败', true))
      file.value = ''
    })
    fileLabel.append(file)
    controls.append(trackLabel, languageLabel, fileLabel, this.importNote)
    this.button(controls, 'clear-import', '使用平台轨道', async () => {
      this.imported = null
      this.importNote.textContent = ''
    })
    this.button(controls, 'start', '开始配音 / 重试失败位置', async () => {
      const imported = this.imported?.videoId === this.status?.player?.videoId ? this.imported : null
      const track = this.status?.player?.tracks.find(track => track.id === this.tracks.value)
      if (!imported && track && new URL(track.url).origin !== this.status?.site?.origin) {
        if (!(await this._options.permissions.request({ origins: [`${new URL(track.url).origin}/*`] })))
          throw new Error('未授予所选字幕源权限，可改用导入字幕')
      }
      await this.command('start', {
        language: this.language.value.trim(),
        trackId: this.tracks.value,
        ...(imported ? { subtitles: imported.text } : {}),
      })
      this.message('字幕已读取；请在播放器查看配音状态。')
    })
    for (const [action, label] of [
      ['pause', '暂停'],
      ['resume', '继续播放'],
      ['stop', '停止配音'],
      ['revoke', '撤销当前站点授权'],
    ] as const)
      this.button(controls, action, label, () => this.command(action))
    const volumes = { originalVolume: 1, dubVolume: 1 }
    for (const [key, label] of [
      ['originalVolume', '原声音量'],
      ['dubVolume', '配音音量'],
    ] as const) {
      const wrapper = node('label', label)
      const input = node('input')
      input.type = 'range'
      input.min = '0'
      input.max = '1'
      input.step = '0.05'
      input.value = '1'
      input.setAttribute('aria-label', label)
      input.addEventListener('change', () => {
        volumes[key] = Number(input.value)
        void this.command('volumes', volumes).catch(error => this.message(String(error), true))
      })
      wrapper.append(input)
      controls.append(wrapper)
    }
    root.append(details, controls, this.statusLine, this.feedback)
    this.feedback.setAttribute('role', 'status')
    void this.refresh()
    this.timer = setInterval(() => {
      if (!this.busy)
        void this.refresh(false)
      // Native permission prompts can outlast the background worker's idle lifetime.
      // Keep its read session reachable without applying concurrent UI state.
      else
        void this._options.client.request('status').catch(() => {})
    }, 1000)
  }

  private button(parent: HTMLElement, action: string, label: string, task: () => Promise<unknown>) {
    const button = node('button', label)
    button.type = 'button'
    button.dataset.action = action
    button.className = 'secondary-button'
    button.addEventListener('click', () => {
      if (this.busy)
        return
      this.setBusy(true)
      // Start synchronously so permissions.request retains the click's activation.
      void task()
        .catch(error => this.message(error instanceof Error ? error.message : '操作失败', true))
        .finally(() => {
          this.setBusy(false)
        })
    })
    parent.append(button)
  }

  private setBusy(value: boolean) {
    this.busy = value
    this.root.setAttribute('aria-busy', String(value))
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = value
  }

  private message(text: string, error = false) {
    if (this.destroyed)
      return
    this.feedback.textContent = text
    this.feedback.dataset.state = error ? 'error' : 'ready'
  }

  private configInput() {
    const value = (name: string) => this.fields.get(name)!.value.trim()
    return {
      translation: { baseUrl: value('翻译服务地址'), model: value('翻译模型'), key: value('翻译 API key') },
      speech: {
        baseUrl: value('语音服务地址'),
        model: value('语音模型'),
        key: value('语音 API key'),
        voice: value('声音'),
      },
    }
  }

  private async save() {
    const input = this.configInput()
    // Blank secrets can preserve a saved key only at the same service address.
    const origins = serviceOrigins(
      validateConfig({
        translation: { ...input.translation, key: input.translation.key || 'retained' },
        speech: { ...input.speech, key: input.speech.key || 'retained' },
      }),
    )
    if (!(await this._options.permissions.request({ origins })))
      throw new Error('未授予服务访问权限')
    await this.command('save', { config: input })
    this.fields.get('翻译 API key')!.value = ''
    this.fields.get('语音 API key')!.value = ''
    this.message('配置已保存；留空 key 可保留同一地址的已有密钥。')
  }

  private apply(status: DubbingStatus, populate = false) {
    if (this.destroyed)
      return
    if (this.status?.site?.videoId !== status.site?.videoId || this.status?.site?.tabId !== status.site?.tabId
      || (this.status?.player && !status.player)) {
      this.imported = null
      this.importNote.textContent = ''
    }
    this.status = status
    const trackKey = JSON.stringify(status.player?.tracks ?? [])
    if (trackKey !== this.trackKey) {
      this.trackKey = trackKey
      const selected = this.tracks.value
      const options = (status.player?.tracks ?? []).map((track) => {
        const option = node('option', track.label)
        option.value = track.id
        return option
      })
      if (!options.length) {
        const option = node('option', '暂无可用轨道，请导入字幕')
        option.value = ''
        options.push(option)
      }
      this.tracks.replaceChildren(...options)
      if (options.some(option => option.value === selected))
        this.tracks.value = selected
    }
    if (populate && status.configuration) {
      const c = status.configuration
      for (const [label, value] of Object.entries({
        翻译服务地址: c.translation.baseUrl,
        翻译模型: c.translation.model,
        语音服务地址: c.speech.baseUrl,
        语音模型: c.speech.model,
        声音: c.speech.voice,
      }))
        this.fields.get(label)!.value = value
    }
    const snapshot = status.snapshot
    this.statusLine.textContent = `${status.configuration ? '服务已配置' : '请配置翻译和语音服务'} · ${status.player?.title ?? (status.site ? '请授权并读取视频' : '请切换到支持的视频网页')} · ${snapshot?.state ?? '未启动'}${snapshot?.reason ? ` (${snapshot.reason})` : ''}${snapshot?.error ? `：${snapshot.error}` : ''}${status.player?.captionNotice ? ` · ${status.player.captionNotice}` : ''}`
  }

  private async refresh(populate = true) {
    try {
      this.apply(await this._options.client.request('status'), populate)
    }
    catch (error) {
      this.message(error instanceof Error ? error.message : '连接失败', true)
    }
  }

  private async command(command: DubbingCommand, data: unknown = {}) {
    this.apply(await this._options.client.request(command, data))
  }

  destroy() {
    this.destroyed = true
    clearInterval(this.timer)
    for (const [name, field] of this.fields) {
      if (name.includes('key'))
        field.value = ''
    }
    this.root.remove()
  }
}
