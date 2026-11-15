import type { AssistantMessage } from '~/modules/builtin/assistant/contracts'
import type { Clipping, QuoteLocation } from '~/workspace/clippings'
import type { PageActionClient, SiteTranslationSettings } from '~/workspace/page-actions'
import type { PageTranslationStatus } from '~/workspace/page-context'
import type { VideoReadingSource } from '~/workspace/video-reading'
import { videoTimestamp } from '~/workspace/video-reading'
import type { CaptureRect, VisionPreview, VisionStatus } from '~/workspace/vision'

/** Nearby browser tasks share only their finite page protocol and dialog shell. */
export class BrowserTasksSurface {
  readonly root: HTMLElement
  private readonly status: HTMLElement
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private activeTask = ''
  private selectionOverlay: HTMLElement | undefined

  constructor(private readonly _document: Document, private readonly _client: PageActionClient) {
    this.root = this.node('section', '', 'result task-toolbox')
    this.root.setAttribute('role', 'dialog')
    this.root.hidden = true
    this.status = this.node('div', '', 'output')
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const node = this._document.createElement(tag)
    node.textContent = text
    node.className = className
    return node
  }

  private button(text: string, action: () => unknown | Promise<unknown>) {
    const button = this.node('button', text)
    button.type = 'button'
    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', (event) => {
      if (event.isTrusted)
        void Promise.resolve().then(action).catch(error => this.error(error))
    })
    return button
  }

  private field(label: string, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    const wrapper = this.node('label', label)
    input.setAttribute('aria-label', label)
    wrapper.append(input)
    return wrapper
  }

  private select(options: string[][]) {
    const select = this.node('select')
    for (const [value, label] of options) {
      const option = this.node('option', label)
      option.value = value
      select.append(option)
    }
    return select
  }

  private begin(title: string) {
    this.cancelTask()
    this.activeTask = title
    this.generation++
    clearTimeout(this.timer)
    this.root.setAttribute('aria-label', title)
    this.root.replaceChildren(this.node('strong', title), this.button('关闭任务面板', () => this.hide()))
    this.status.textContent = ''
    this.root.hidden = false
    return this.generation
  }

  private error(error: unknown) { this.status.textContent = error instanceof Error ? error.message : '操作失败' }
  hide() {
    this.cancelTask()
    this.generation++
    clearTimeout(this.timer)
    this.root.hidden = true
  }

  private cancelTask() {
    this.selectionOverlay?.remove()
    this.selectionOverlay = undefined
    const command = this.activeTask === '截图与图片识别' ? 'vision-discard' : this.activeTask === '当前视频阅读' ? 'video-stop' : this.activeTask === 'Quick Ask' ? 'ask-cancel' : ''
    if (command)
      void this._client.request(command).catch(() => {})
    this.activeTask = ''
  }

  async translation() {
    const generation = this.begin('网页翻译')
    this.root.append(this.status)
    try {
      const settings = await this._client.request<SiteTranslationSettings>('translation-preferences')
      const language = this.node('input')
      language.value = settings.language
      const automatic = this.node('input')
      automatic.type = 'checkbox'
      automatic.checked = settings.automatic
      const mode = this.select([['bilingual', '双语对照'], ['translation', '仅译文']])
      mode.value = settings.display.mode
      const size = this.select([['0', '跟随网页'], ['14', '14 px'], ['16', '16 px'], ['19', '19 px'], ['24', '24 px']])
      size.value = String(settings.display.fontSize)
      const style = this.select([['border', '侧边线'], ['plain', '纯文本']])
      style.value = settings.display.style
      const save = () => this._client.request('translation-settings', { settings: {
        automatic: automatic.checked,
        language: language.value,
        display: { mode: mode.value, fontSize: Number(size.value), style: style.value },
      } })
      const poll = async () => {
        clearTimeout(this.timer)
        if (generation !== this.generation)
          return
        const value = await this._client.request<PageTranslationStatus | null>('translation-status')
        this.status.textContent = value
          ? value.error ?? `${{ translating: '正在翻译', completed: value.truncated ? '翻译完成，增量监测已停止' : '已完成，继续监测动态正文', cancelled: '已停止', failed: '翻译失败' }[value.status]} · ${value.completed}/${value.total}${value.truncated ? ' · 内容已达限额' : ''}`
          : '已恢复原文'
        if (value && ['translating', 'completed'].includes(value.status))
          this.timer = setTimeout(() => { void poll().catch(error => this.error(error)) }, 500)
      }
      this.root.append(this.field('目标语言', language), this.field('此站点自动翻译', automatic), this.field('译文显示', mode), this.field('译文字号', size), this.field('译文样式', style), this.button('保存翻译偏好', async () => {
        await save()
        this.status.textContent = '已保存此站点偏好'
      }), this.button('开始网页翻译', async () => {
        await save()
        await this._client.request('translation-start')
        await poll()
      }), this.button('停止网页翻译', async () => {
        await this._client.request('translation-stop')
        await poll()
      }), this.button('恢复网页原文', async () => {
        await this._client.request('translation-restore')
        await poll()
      }), this.node('p', '自动翻译只在此站点已授权时运行。动态正文最多 512 段 / 512 KiB；停止后本次访问不再自动启动。'), this.status)
      await poll()
    }
    catch (error) { this.error(error) }
  }

  async quickAsk(initialContext: 'none' | 'page' = 'none') {
    const generation = this.begin('Quick Ask')
    await this._client.request('ask-prepare')
    if (generation !== this.generation)
      return
    const input = this.node('textarea')
    input.rows = 3
    const context = this.select([['none', '不附加上下文'], ['page', '当前网页正文'], ['selection', '当前选文']])
    context.value = initialContext
    const poll = async () => {
      clearTimeout(this.timer)
      if (generation !== this.generation)
        return
      const value = await this._client.request<AssistantMessage>('ask-poll')
      this.status.textContent = `${value.text}${value.error ? `\n${value.error}` : ''}${value.status === 'cancelled' ? '\n已停止' : ''}`
      if (['preparing', 'streaming'].includes(value.status))
        this.timer = setTimeout(() => { void poll().catch(error => this.error(error)) }, 150)
    }
    const send = async () => {
      await this._client.request('ask-start', { text: input.value, context: context.value })
      input.value = ''
      await poll()
    }
    input.addEventListener('keydown', (event) => {
      if (event.isTrusted && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void send().catch(error => this.error(error))
      }
    })
    this.root.append(this.field('提问内容', input), this.field('本轮附加上下文', context), this.button('发送问题', send), this.button('停止回答', async () => {
      await this._client.request('ask-cancel')
      await poll()
    }), this.button('新建问答', async () => {
      await this._client.request('ask-reset')
      this.status.textContent = ''
    }), this.status)
    const query = this.node('input')
    query.type = 'search'
    const links = this.node('div')
    this.root.append(this.field('查找网页或输入网址', query), this.button('查找当前页链接', async () => {
      const targets = await this._client.request<Array<{ title: string, url: string }>>('ask-targets', { query: query.value })
      links.replaceChildren(...targets.map(target => this.button(target.title, () => this._client.request('ask-open', { url: target.url }))))
      if (!targets.length)
        links.textContent = '当前页没有匹配链接'
    }), this.button('打开输入的网址', () => this._client.request('ask-open', { url: query.value })), this.button('用 Google 搜索', () => this._client.request('ask-search', { query: query.value })), links)
    input.focus()
  }

  async clippings() {
    this.begin('本机剪藏')
    await this._client.request('clip-prepare')
    const note = this.node('textarea')
    note.rows = 2
    const list = this.node('div')
    const refresh = async () => {
      const entries = await this._client.request<Clipping[]>('clip-list')
      list.replaceChildren()
      for (const entry of entries) {
        const row = this.node('div')
        const edit = this.node('textarea')
        edit.value = entry.note
        edit.rows = 2
        row.append(this.node('h3', entry.title), this.node('blockquote', entry.anchor.exact), this.node('small', entry.url), this.field(`笔记 ${entry.title}`, edit), this.button('保存笔记', async () => {
          await this._client.request('clip-note', { id: entry.id, note: edit.value })
          this.status.textContent = '笔记已保存'
        }), this.button('回到原文', async () => {
          const result = await this._client.request<QuoteLocation>('clip-open', { id: entry.id })
          this.status.textContent = result.message
        }), this.button('删除剪藏', async () => {
          await this._client.request('clip-delete', { id: entry.id })
          await refresh()
        }))
        list.append(row)
      }
      if (!entries.length)
        list.append(this.node('p', '还没有剪藏。先选中网页原文，再保存。'))
    }
    this.root.append(this.node('p', '保存选文、完整来源地址与笔记到本机，不默认发送给模型。'), this.field('新剪藏笔记', note), this.button('保存当前选文', async () => {
      await this._client.request('clip-save', { note: note.value })
      note.value = ''
      this.status.textContent = '选文与来源已保存'
      await refresh()
    }), this.status, list)
    await refresh()
  }

  async video() {
    const generation = this.begin('当前视频阅读')
    this.root.append(this.status)
    try {
      let source = await this._client.request<VideoReadingSource>('video-open')
      const identity = this.node('p', `${source.platform} · ${source.title} · ${source.videoId}${source.contentId ? ` · 分 P ${source.contentId}` : ''}`)
      const track = this.select(source.tracks.map(track => [track.id, `${track.label} · ${track.language}`]))
      const cues = this.node('div', '', 'task-tools-list')
      const answer = this.node('div', '', 'output')
      answer.setAttribute('role', 'status')
      answer.setAttribute('aria-label', '视频回答')
      const seek = (id: string) => this._client.request('video-seek', { token: source.token, cueId: id })
      let shown = 0
      const renderCues = () => {
        shown = Math.min(shown + 100, source.cues.length)
        cues.replaceChildren(...source.cues.slice(0, shown).map(cue => this.button(`${videoTimestamp(cue.startMs)} ${cue.sourceText}`, () => seek(cue.id))))
        if (shown < source.cues.length)
          cues.append(this.button('显示更多字幕', renderCues))
        this.status.textContent = `已读取 ${source.cues.length} 条字幕 · ${source.trackId}`
      }
      const file = this.node('input')
      file.type = 'file'
      file.accept = '.srt,.vtt,text/vtt,text/plain'
      file.addEventListener('change', () => {
        void (async () => {
          const selected = file.files?.[0]
          if (!selected)
            return
          if (selected.size > 2097152)
            throw new Error('字幕超过 2 MiB')
          source = await this._client.request<VideoReadingSource>('video-import', { token: source.token, subtitles: await selected.text() })
          shown = 0
          renderCues()
        })().catch(error => this.error(error))
      })
      const input = this.node('textarea')
      input.rows = 2
      const poll = async () => {
        clearTimeout(this.timer)
        if (generation !== this.generation)
          return
        const value = await this._client.request<AssistantMessage>('video-poll')
        answer.replaceChildren()
        for (const part of value.text.split(/(\[[\w-]+\])/g)) {
          const id = part.slice(1, -1)
          const cue = part.startsWith('[') && source.cues.find(cue => cue.id === id)
          answer.append(cue ? this.button(`${videoTimestamp(cue.startMs)} ↗`, () => seek(cue.id)) : this._document.createTextNode(part))
        }
        if (value.error)
          answer.append(this._document.createTextNode(`\n${value.error}`))
        if (value.status === 'cancelled')
          answer.append(this._document.createTextNode('\n已停止'))
        if (['preparing', 'streaming'].includes(value.status))
          this.timer = setTimeout(() => { void poll().catch(error => this.error(error)) }, 150)
      }
      const ask = async (text: string) => {
        const result = await this._client.request<{ truncated: boolean }>('video-ask', { token: source.token, text })
        if (result.truncated)
          this.status.textContent = '字幕超过请求限额，本次只发送前 54 KiB，时间轴保留全部字幕'
        await poll()
      }
      this.root.append(identity, this.field('视频字幕轨道', track), this.button('读取字幕', async () => {
        source = await this._client.request<VideoReadingSource>('video-load', { token: source.token, trackId: track.value })
        shown = 0
        renderCues()
      }), this.field('导入当前视频字幕', file), this.node('p', '只读取当前视频的字幕。没有可读轨道时可导入 SRT / VTT；不需要启动视频配音。'), this.field('视频问题', input), this.button('总结当前视频', () => ask('总结当前视频的要点，并引用对应字幕时间点')), this.button('询问视频', () => ask(input.value)), this.button('停止视频回答', async () => {
        await this._client.request('video-stop')
        await poll()
      }), this.status, answer, cues)
      if (!source.tracks.length)
        this.status.textContent = '没有可读字幕轨道，请开启播放器字幕或导入 SRT / VTT'
    }
    catch (error) { this.error(error) }
  }

  async vision() {
    const generation = this.begin('截图与图片识别')
    let preview: VisionPreview | undefined
    const image = this.node('img')
    image.alt = '所选图像预览'
    image.hidden = true
    image.style.cssText = 'max-width:100%;max-height:220px;object-fit:contain;border:1px solid #cad8cc;border-radius:8px'
    const captures = this.node('div')
    const task = this.select([['ocr', '提取文字'], ['translate', '翻译图片文字'], ['ask', '图片问答']])
    const language = this.node('input')
    language.value = 'zh-CN'
    const question = this.node('textarea')
    question.rows = 2
    const capture = async (input: object) => {
      this.root.hidden = true
      try {
        const result = await this._client.request<VisionPreview>('vision-capture', { input })
        if (generation !== this.generation) {
          await this._client.request('vision-discard')
          return
        }
        preview = result
        image.src = result.preview
        image.hidden = false
        this.status.textContent = `图像预览 · ${result.width} × ${result.height} · 尚未发送，3 分钟后失效`
      }
      finally {
        if (generation === this.generation)
          this.root.hidden = false
      }
    }
    const poll = async () => {
      clearTimeout(this.timer)
      if (generation !== this.generation)
        return
      const value = await this._client.request<VisionStatus | null>('vision-poll')
      this.status.textContent = !value
        ? '请先选择区域或图片'
        : value.status === 'running'
          ? '正在识别所选图像…'
          : value.status === 'cancelled'
            ? '识图已停止'
            : value.error ?? [value.result?.text && `提取文字：\n${value.result.text}`, value.result?.translation && `译文：\n${value.result.translation}`, value.result?.answer && `回答：\n${value.result.answer}`].filter(Boolean).join('\n\n')
      if (value?.status === 'running')
        this.timer = setTimeout(() => { void poll().catch(error => this.error(error)) }, 200)
    }
    this.root.append(this.node('p', '拖选当前可见网页或选择完整可见图片。确认预览后才发送到独立识图服务；最大 8 MiB / 4096 × 4096。'), this.button('拖选截图区域', () => {
      this.root.hidden = true
      this.pickRegion(rect => capture({ kind: 'region', rect }), generation)
    }), this.button('选择当前页图片', async () => {
      const images = await this._client.request<Array<{ id: string, title: string }>>('vision-images')
      captures.replaceChildren(...images.map(item => this.button(`识别图片 ${item.title}`, () => capture({ kind: 'image', id: item.id }))))
      if (!images.length)
        captures.textContent = '当前可见区域没有完整加载且完整可见的图片'
    }), captures, image, this.field('图像任务', task), this.field('图片翻译目标语言', language), this.field('图片问题', question), this.button('确认发送图像', async () => {
      if (!preview)
        throw new Error('请先选择区域或图片并检查预览')
      await this._client.request('vision-start', { input: { token: preview.token, task: task.value, language: language.value, question: question.value } })
      await poll()
    }), this.button('停止识图', async () => {
      await this._client.request('vision-cancel')
      await poll()
    }), this.button('取消并清除图像', async () => {
      await this._client.request('vision-discard')
      preview = undefined
      image.removeAttribute('src')
      image.hidden = true
      this.status.textContent = '已取消，临时图像已清除'
    }), this.status)
  }

  private pickRegion(selected: (_rect: CaptureRect) => Promise<void>, generation: number) {
    this.selectionOverlay?.remove()
    const overlay = this.node('div', '拖动选择截图区域 · Esc 取消')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-label', '选择截图区域')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:auto;cursor:crosshair;touch-action:none;background:#1232;color:white;padding:12px;font:14px system-ui;user-select:none'
    const rectangle = this.node('div')
    rectangle.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #8df6a8;background:#9fffb722;box-sizing:border-box'
    overlay.append(rectangle)
    let start: { x: number, y: number } | undefined
    overlay.addEventListener('wheel', event => event.preventDefault(), { passive: false })
    overlay.addEventListener('pointerdown', (event) => {
      if (!event.isTrusted || event.button !== 0)
        return
      event.preventDefault()
      event.stopPropagation()
      start = { x: event.clientX, y: event.clientY }
      overlay.setPointerCapture(event.pointerId)
    })
    const rect = (event: PointerEvent): CaptureRect => ({
      x: Math.max(0, Math.min(start!.x, event.clientX)),
      y: Math.max(0, Math.min(start!.y, event.clientY)),
      width: Math.abs(event.clientX - start!.x),
      height: Math.abs(event.clientY - start!.y),
    })
    overlay.addEventListener('pointermove', (event) => {
      if (!start)
        return
      const value = rect(event)
      Object.assign(rectangle.style, { left: `${value.x}px`, top: `${value.y}px`, width: `${value.width}px`, height: `${value.height}px` })
    })
    overlay.addEventListener('pointerup', (event) => {
      if (!event.isTrusted || !start || generation !== this.generation)
        return
      event.preventDefault()
      event.stopPropagation()
      const value = rect(event)
      start = undefined
      overlay.remove()
      this.selectionOverlay = undefined
      void selected(value).catch(error => this.error(error))
    })
    this.selectionOverlay = overlay
    this.root.getRootNode().appendChild(overlay)
  }

  dispose() {
    this.hide()
    this.root.remove()
  }
}
