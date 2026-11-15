import { byteLength, isRecord } from '~/modules/builtin/assistant/contracts'
import { PageQuoteAnchors } from './quotes'
import { PageAssistantSurface } from './surface'
import { readVideoPage } from './video-reading'

export const PAGE_CHANNEL = 'oneweb.page-context.v1'
export interface PageCommand { command: string, [key: string]: unknown }

export class PageContentRuntime {
  private disposed = false
  private readonly blocks = new Map<string, { source: Element, text: string, translation?: HTMLElement }>()
  private readonly translations = new Set<HTMLElement>()
  private translationObserver: MutationObserver | undefined
  private translationTimer: ReturnType<typeof setTimeout> | undefined
  private translationBytes = 0
  private translationCount = 0
  private translationCompleted = 0
  private translationTruncated = false
  private translationStopped = false
  private translationLanguage = 'zh-CN'
  private translationStyle: HTMLStyleElement | undefined
  private readonly translationMarker = crypto.randomUUID()
  private display = { mode: 'bilingual', fontSize: 0, style: 'border' }
  private readonly quotes: PageQuoteAnchors
  private readonly imageIds = new Map<string, HTMLImageElement>()
  private surface: PageAssistantSurface | null = null
  private readonly edits = new Map<string, {
    node: HTMLElement
    original: string
    selected: string
    start?: number
    end?: number
    range?: Range
    expires: number
  }>()

  constructor(private readonly _document: Document, private readonly _transport?: { sendMessage: (_message: unknown) => Promise<unknown> }) {
    this.quotes = new PageQuoteAnchors(_document)
  }

  async handle(message: PageCommand): Promise<unknown> {
    if (this.disposed)
      throw new Error('页面已失效')
    if (!isRecord(message))
      throw new Error('页面操作无效')
    if (message.command === 'ping')
      return null
    if (message.command === 'capture-viewport') {
      const view = this._document.defaultView!
      return { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio, scrollX: view.scrollX, scrollY: view.scrollY, visible: this._document.visibilityState === 'visible' }
    }
    if (message.command === 'capture-ui') {
      this.surface?.captureHidden(message.hidden === true)
      if (message.hidden === true && this._document.visibilityState === 'visible')
        await new Promise<void>(resolve => this._document.defaultView!.requestAnimationFrame(() => this._document.defaultView!.requestAnimationFrame(() => resolve())))
      return null
    }
    if (message.command === 'page-images') {
      this.imageIds.clear()
      const images: Array<{ id: string, title: string }> = []
      for (const image of [...this._document.images].slice(0, 1000)) {
        if (images.length >= 50 || image.closest('[data-oneweb-assistant]') || !image.complete || !image.naturalWidth)
          continue
        const rect = image.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight)
          continue
        const id = crypto.randomUUID()
        this.imageIds.set(id, image)
        images.push({ id, title: (image.alt || `可见图片 ${images.length + 1}`).slice(0, 200) })
      }
      return images
    }
    if (message.command === 'image-rectangle') {
      const image = this.imageIds.get(message.id as string)
      if (!image?.isConnected || !image.complete || !image.naturalWidth)
        throw new Error('图片已变化，请重新选择')
      const rect = image.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    if (['video-snapshot', 'video-cues', 'video-seek'].includes(message.command))
      return readVideoPage(message)
    if (message.command === 'surface-enable') {
      if (!this._transport)
        throw new Error('网页助手连接不可用')
      this.surface ??= new PageAssistantSurface(this._document, this._transport)
      return null
    }
    if (message.command === 'surface-disable') {
      this.surface?.dispose()
      this.surface = null
      return null
    }
    if (message.command === 'quick-ask-open') {
      await this.surface?.quickAsk()
      return null
    }
    if (message.command === 'page-links') {
      if (typeof message.query !== 'string' || message.query.length > 256)
        throw new Error('搜索内容过长')
      const query = message.query.toLocaleLowerCase()
      const seen = new Set<string>()
      const links: Array<{ title: string, url: string }> = []
      for (const link of [...this._document.querySelectorAll<HTMLAnchorElement>('a[href]')].slice(0, 2000)) {
        if (links.length >= 30)
          break
        const title = (link.textContent ?? '').trim().slice(0, 200)
        try {
          const url = new URL(link.href)
          if (!title || !/^https?:$/.test(url.protocol) || url.username || url.password || seen.has(url.href)
            || !`${title} ${url.href}`.toLocaleLowerCase().includes(query)) {
            continue
          }
          seen.add(url.href)
          links.push({ title, url: url.href })
        }
        catch {}
      }
      return links
    }
    if (message.command === 'capture')
      return this.capture()
    if (message.command === 'quote-capture')
      return this.quotes.capture()
    if (message.command === 'quote-locate') {
      const value = this.quotes.locate(message.anchor)
      if (message.notify === true)
        this.surface?.notice(value.message)
      return value
    }
    if (message.command === 'selection')
      return this.selection(message.editor === true)
    if (message.command === 'apply')
      return this.apply(message.token, message.text, message.mode)
    if (message.command === 'translation-blocks')
      return this.translationBlocks(message.incremental === true, message.recoverPending === true)
    if (message.command === 'translation-watch') {
      if (typeof message.language === 'string' && /^[\w-]{2,32}$/.test(message.language))
        this.translationLanguage = message.language
      this.watchTranslation()
      return null
    }
    if (message.command === 'translation-state')
      return { watching: !!this.translationObserver, stopped: this.translationStopped, language: this.translationLanguage, completed: this.translationCompleted, total: this.translationCount, truncated: this.translationTruncated }
    if (message.command === 'translation-stop') {
      this.stopTranslation()
      return null
    }
    if (message.command === 'translation-display')
      return this.translationDisplay(message.display)
    if (message.command === 'translation-apply')
      return this.applyTranslations(message.translations, message.language)
    if (message.command === 'translation-restore') {
      this.restore()
      return null
    }
    if (message.command === 'dispose') {
      this.dispose()
      return null
    }
    throw new Error('不支持的页面操作')
  }

  private excluded(element: Element) {
    if (element.matches('script,style,noscript,template,input,textarea,select,button,nav,header,footer,[contenteditable],[data-oneweb-assistant],[data-oneweb-translation],[hidden],[aria-hidden="true"]'))
      return true
    const style = this._document.defaultView?.getComputedStyle(element)
    return style?.display === 'none' || style?.visibility === 'hidden' || style?.contentVisibility === 'hidden'
  }

  private capture() {
    const preferred = [...this._document.querySelectorAll('main,article,[role="main"]')].find((element) => {
      let current: Element | null = element
      while (current) {
        if (this.excluded(current))
          return false
        current = current.parentElement
      }
      return true
    })
    const root = preferred ?? this._document.body
    const pieces: string[] = []
    let elements = 0
    let bytes = 0
    let truncated = false
    const append = (value: string) => {
      if (bytes >= 65536) {
        truncated = true
        return
      }
      const available = 65536 - bytes
      if (byteLength(value) > available) {
        let result = ''
        for (const character of value) {
          const length = byteLength(character)
          if (bytes + length > 65536)
            break
          result += character
          bytes += length
        }
        pieces.push(result)
        truncated = true
      }
      else {
        pieces.push(value)
        bytes += byteLength(value)
      }
    }
    const visit = (node: Node) => {
      if (truncated)
        return
      if (node.nodeType === 3) {
        append((node.textContent ?? '').replace(/\s+/g, ' '))
        return
      }
      if (node.nodeType !== 1)
        return
      const element = node as Element
      if (++elements > 3000) {
        truncated = true
        return
      }
      if (this.excluded(element))
        return
      const block = /^(?:P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|BLOCKQUOTE|BR|TR)$/.test(element.tagName)
      if (block)
        append('\n')
      for (const child of element.childNodes)
        visit(child)
      if (block)
        append('\n')
    }
    visit(root)
    const text = pieces.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n').trim()
    if (!text)
      throw new Error('此页面没有可读取的正文')
    return { text, truncated, method: preferred ? 'article' : 'visible-text' }
  }

  private selection(editorAction = false) {
    const active = this._document.activeElement
    let text = ''
    let edit: Omit<(typeof this.edits extends Map<string, infer T> ? T : never), 'expires'> | undefined
    if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(active.type))) {
      const start = active.selectionStart
      const end = active.selectionEnd
      if (start !== null && end !== null && (end > start || editorAction)) {
        text = end > start ? active.value.slice(start, end) : active.value || '（空输入框）'
        edit = { node: active, original: active.value, selected: text, start, end }
      }
    }
    else {
      const selection = this._document.getSelection()
      if (selection?.rangeCount && (!selection.isCollapsed || editorAction)) {
        const range = selection.getRangeAt(0).cloneRange()
        const common = range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer as Element
          : range.commonAncestorContainer.parentElement
        if (common?.closest('[data-oneweb-assistant],input,textarea,[hidden],[aria-hidden="true"]'))
          throw new Error('无法读取该选区')
        text = selection.toString()
        const editor = common?.closest<HTMLElement>('[contenteditable="true"],[contenteditable=""]')
        if (editor && editor.contains(range.startContainer) && editor.contains(range.endContainer))
          edit = { node: editor, original: editor.textContent ?? '', selected: text, range }
        if (editorAction && editor && !text)
          text = editor.textContent || '（空输入框）'
      }
    }
    if (!text.trim() || byteLength(text) > 16384)
      throw new Error('请选择不超过 16 KiB 的文本')
    let editToken: string | undefined
    if (edit) {
      for (const [key, item] of this.edits) {
        if (item.expires < Date.now())
          this.edits.delete(key)
      }
      if (this.edits.size >= 32)
        throw new Error('临时选区过多，请稍后重试')
      editToken = crypto.randomUUID()
      this.edits.set(editToken, { ...edit, expires: Date.now() + 600000 })
    }
    return { text, truncated: false, editable: !!edit, editToken }
  }

  private apply(token: unknown, value: unknown, mode: unknown = 'replace') {
    if (typeof token !== 'string' || typeof value !== 'string' || !value || byteLength(value) > 65536)
      throw new Error('写作结果无效或过长')
    if (mode !== 'replace' && mode !== 'insert' && mode !== undefined)
      throw new Error('写入方式无效')
    const edit = this.edits.get(token)
    if (!edit || edit.expires < Date.now() || !edit.node.isConnected)
      throw new Error('编辑位置已失效，请复制结果')
    const { node, range } = edit
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      if (node.disabled || node.readOnly)
        throw new Error('编辑器已变为只读，请复制结果')
      if (node.value !== edit.original || node.selectionStart !== edit.start || node.selectionEnd !== edit.end)
        throw new Error('原文或选区已变化，请复制结果')
      node.setRangeText(value, mode === 'insert' ? edit.end! : edit.start!, edit.end!, 'end')
    }
    else {
      if (node.textContent !== edit.original || !range || !node.contains(range.commonAncestorContainer) || range.toString() !== edit.selected)
        throw new Error('原文或选区已变化，请复制结果')
      const selection = this._document.getSelection()
      const current = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (!current || current.startContainer !== range.startContainer || current.endContainer !== range.endContainer
        || current.startOffset !== range.startOffset || current.endOffset !== range.endOffset || node.getAttribute('contenteditable') === 'false') {
        throw new Error('编辑器选区已变化，请复制结果')
      }
      const target = range.cloneRange()
      if (mode === 'insert')
        target.collapse(false)
      else
        target.deleteContents()
      target.insertNode(this._document.createTextNode(value))
    }
    node.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }))
    this.edits.delete(token)
    return null
  }

  private translationBlocks(incremental = false, recoverPending = false) {
    if (!incremental)
      this.restore()
    for (const [id, block] of this.blocks) {
      if (!block.source.isConnected || block.source.textContent?.trim() !== block.text) {
        block.translation?.remove()
        if (block.translation)
          this.translations.delete(block.translation)
        if (block.source.getAttribute('data-oneweb-original') === this.translationMarker)
          block.source.removeAttribute('data-oneweb-original')
        this.blocks.delete(id)
      }
    }
    const known = new Set([...this.blocks.values()].map(block => block.source))
    const root = this._document.querySelector('main,article,[role="main"]') ?? this._document.body
    const blocks: Array<{ id: string, text: string }> = incremental && recoverPending
      ? [...this.blocks].filter(([, block]) => !block.translation).map(([id, block]) => ({ id, text: block.text }))
      : []
    let visited = 0
    let truncated = false
    for (const element of root.querySelectorAll('*')) {
      if (++visited > 3000) {
        truncated = true
        break
      }
      if (known.has(element) || !element.matches('p,h1,h2,h3,h4,li,blockquote') || element.querySelector('p,li,blockquote')
        || element.closest('pre,code,nav,header,footer,[contenteditable],[data-oneweb-assistant],[data-oneweb-translation]')) {
        continue
      }
      let ancestor: Element | null = element
      let excluded = false
      while (ancestor) {
        if (this.excluded(ancestor)) {
          excluded = true
          break
        }
        ancestor = ancestor.parentElement
      }
      const text = element.textContent?.trim()
      if (excluded || !text)
        continue
      if (this.translationCount >= 512 || this.translationBytes + byteLength(text) > 524288 || byteLength(text) > 8192) {
        truncated = true
        continue
      }
      this.translationBytes += byteLength(text)
      this.translationCount++
      const id = crypto.randomUUID()
      blocks.push({ id, text })
      this.blocks.set(id, { source: element, text })
    }
    if (!blocks.length && !incremental)
      throw new Error('此页面没有受支持的正文段落')
    this.translationTruncated ||= truncated
    return { blocks, truncated: this.translationTruncated, total: this.translationCount }
  }

  private applyTranslations(value: unknown, language: unknown) {
    if (!Array.isArray(value) || value.length > 8 || typeof language !== 'string' || !/^[\w-]{2,32}$/.test(language))
      throw new Error('译文格式无效')
    for (const item of value) {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string' || byteLength(item.text) > 32768)
        throw new Error('译文格式无效')
      const block = this.blocks.get(item.id)
      if (!block || !block.source.isConnected || block.source.textContent?.trim() !== block.text)
        throw new Error('页面正文已变化，请恢复后重新翻译')
    }
    for (const item of value as Array<{ id: string, text: string }>) {
      const block = this.blocks.get(item.id)!
      if (!block.translation)
        this.translationCompleted++
      block.translation?.remove()
      if (block.translation)
        this.translations.delete(block.translation)
      const translation = this._document.createElement('span')
      translation.dataset.onewebTranslation = item.id
      translation.lang = language
      translation.textContent = item.text
      translation.style.cssText = 'display:block;margin:8px 0 14px;padding:6px 12px;border-inline-start:2px solid #73a482;color:inherit;opacity:.88;white-space:pre-wrap;font:inherit;'
      block.source.after(translation)
      block.translation = translation
      this.translations.add(translation)
    }
    this.translationLanguage = language
    this.updateTranslationDisplay()
    return null
  }

  private watchTranslation() {
    this.stopTranslation()
    this.translationStopped = false
    this.translationObserver = new MutationObserver((records) => {
      if (!records.some(record => !(record.target instanceof Element && record.target.closest('[data-oneweb-assistant],[data-oneweb-translation]'))))
        return
      clearTimeout(this.translationTimer)
      this.translationTimer = setTimeout(() => {
        void this._transport?.sendMessage({ channel: 'oneweb.page-action.v1', command: 'translation-update' }).catch(() => {})
      }, 300)
    })
    this.translationObserver.observe(this._document.body, { childList: true, subtree: true, characterData: true })
  }

  private stopTranslation() {
    this.translationStopped = true
    this.translationObserver?.disconnect()
    this.translationObserver = undefined
    clearTimeout(this.translationTimer)
  }

  private translationDisplay(value: unknown) {
    if (!isRecord(value) || !['bilingual', 'translation'].includes(value.mode as string)
      || !Number.isInteger(value.fontSize) || (value.fontSize as number) < 0 || (value.fontSize as number) > 32
      || !['border', 'plain'].includes(value.style as string)) {
      throw new Error('翻译显示设置无效')
    }
    this.display = { mode: value.mode as string, fontSize: value.fontSize as number, style: value.style as string }
    this.updateTranslationDisplay()
    return null
  }

  private updateTranslationDisplay() {
    for (const block of this.blocks.values()) {
      if (block.translation && this.display.mode === 'translation') {
        block.source.setAttribute('data-oneweb-original', this.translationMarker)
      }
      else if (block.source.getAttribute('data-oneweb-original') === this.translationMarker) {
        block.source.removeAttribute('data-oneweb-original')
      }
      if (block.translation) {
        block.translation.style.fontSize = this.display.fontSize ? `${this.display.fontSize}px` : ''
        block.translation.style.borderInlineStart = this.display.style === 'plain' ? 'none' : '2px solid #73a482'
      }
    }
    if (!this.translationStyle) {
      this.translationStyle = this._document.createElement('style')
      this.translationStyle.dataset.onewebTranslationStyle = 'display'
      this.translationStyle.textContent = `[data-oneweb-original="${this.translationMarker}"]{display:none!important}`
      this._document.documentElement.append(this.translationStyle)
    }
  }

  private restore() {
    this.stopTranslation()
    for (const block of this.blocks.values()) {
      if (block.source.getAttribute('data-oneweb-original') === this.translationMarker)
        block.source.removeAttribute('data-oneweb-original')
    }
    this.translationStyle?.remove()
    this.translationStyle = undefined
    for (const node of this.translations)
      node.remove()
    this.translations.clear()
    this.blocks.clear()
    this.translationCount = 0
    this.translationCompleted = 0
    this.translationTruncated = false
    this.translationBytes = 0
  }

  dispose() {
    this.disposed = true
    this.edits.clear()
    this.imageIds.clear()
    this.quotes.dispose()
    this.restore()
    this.surface?.dispose()
    this.surface = null
  }
}
