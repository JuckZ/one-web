import type { PageCommand } from '~/assistantContent/runtime'
import { PAGE_CHANNEL } from '~/assistantContent/runtime'
import type { AssistantAttachment } from '~/modules/builtin/assistant/contracts'
import { byteLength, isRecord } from '~/modules/builtin/assistant/contracts'
import type { AssistantController } from '~/modules/builtin/assistant/controller'
import { isTrustedModuleManagementSender } from '~/modules/management-protocol'

export interface PageTab { id?: number, url?: string, title?: string, lastAccessed?: number }
export interface PageSession {
  documentId: string
  request: (_command: PageCommand) => Promise<unknown>
}
export type PageAttachment = AssistantAttachment & { editable?: boolean }
export interface PageContextOptions {
  tabs: { query: (_query: { active: boolean, currentWindow: boolean }) => Promise<PageTab[]> }
  permissions: { contains: (_query: { origins: string[] }) => Promise<boolean> }
  injection: { connect: (_tab: PageTab) => Promise<PageSession> }
  now?: () => number
  assistant?: AssistantController
  fallbackPage?: () => Promise<PageTab | undefined>
}

export interface PageTranslationStatus { status: 'translating' | 'completed' | 'cancelled' | 'failed', completed: number, total: number, truncated: boolean, error?: string }
export interface TranslationDisplay { mode: 'bilingual' | 'translation', fontSize: number, style: 'border' | 'plain' }
export interface TranslationDocumentState { watching: boolean, stopped: boolean, language: string, completed: number, total: number, truncated: boolean }
interface TranslationJob {
  owner: string
  tabId: number
  href: string
  language: string
  session: PageSession
  abort: AbortController
  value: PageTranslationStatus
  dynamic: boolean
  recoverPending?: boolean
  work: Promise<void>
}

export class PageContextController {
  private readonly captures = new Map<string, { owner: string, attachment: PageAttachment, href: string, session: PageSession, editToken?: string }>()
  private readonly translations = new Map<string, TranslationJob>()

  constructor(private readonly _options: PageContextOptions) {}

  async currentPage() {
    let [tab] = await this._options.tabs.query({ active: true, currentWindow: true })
    if (tab?.url?.startsWith('chrome-extension:') || tab?.url?.startsWith('moz-extension:'))
      tab = await this._options.fallbackPage?.() ?? tab
    if (tab?.id === undefined || !tab.url || !/^https?:$/.test(new URL(tab.url).protocol))
      throw new Error('请先打开一个普通网页')
    const url = new URL(tab.url)
    return { tab, originPattern: `${url.origin}/*` }
  }

  async captureCurrentPage(owner: string, selection = false, editor = false): Promise<PageAttachment> {
    const { tab, originPattern } = await this.currentPage()
    if (!await this._options.permissions.contains({ origins: [originPattern] }))
      throw new Error('请先授权当前站点')
    const session = await this._options.injection.connect(tab)
    const result = await session.request({ command: selection ? 'selection' : 'capture', editor })
    if (!isRecord(result) || typeof result.text !== 'string' || !result.text.trim() || byteLength(result.text) > 65536 || typeof result.truncated !== 'boolean')
      throw new Error('页面返回了无效正文')
    const current = await this.currentPage()
    if (current.tab.id !== tab.id || current.tab.url !== tab.url)
      throw new Error('当前页面已变化，请重新附加')
    for (const [token, item] of this.captures) {
      if (this.now() - item.attachment.capturedAt > 600000)
        this.captures.delete(token)
    }
    if (this.captures.size >= 32)
      throw new Error('临时页面过多，请稍后重试')
    const source = new URL(tab.url!)
    source.search = ''
    source.hash = ''
    if (byteLength(source.href) > 2048)
      throw new Error('页面地址过长')
    const attachment: PageAttachment = {
      token: crypto.randomUUID(),
      title: Array.from(tab.title ?? '当前网页').slice(0, 512).join(''),
      url: source.href,
      text: result.text,
      type: selection ? 'selection' : 'page',
      truncated: result.truncated,
      capturedAt: this.now(),
      tabId: tab.id,
      documentId: session.documentId,
      ...(['article', 'visible-text'].includes(result.method as string) ? { extraction: result.method as 'article' | 'visible-text' } : {}),
      ...(selection ? { editable: result.editable === true } : {}),
    }
    this.captures.set(attachment.token, { owner, attachment, href: tab.url!, session, editToken: typeof result.editToken === 'string' ? result.editToken : undefined })
    return structuredClone(attachment)
  }

  async resolveAttachment(token: string, owner: string) {
    const item = this.captures.get(token)
    if (!item || item.owner !== owner || this.now() - item.attachment.capturedAt > 600000)
      throw new Error('页面附件已失效，请重新附加')
    const current = await this.currentPage()
    if (current.tab.id !== item.attachment.tabId || current.tab.url !== item.href
      || !await this._options.permissions.contains({ origins: [current.originPattern] })) {
      this.captures.delete(token)
      throw new Error('页面附件已失效，请重新附加')
    }
    return structuredClone(item.attachment)
  }

  async applyWritingResult(token: string, text: string, owner: string, mode: 'insert' | 'replace' = 'replace') {
    await this.resolveAttachment(token, owner)
    const capture = this.captures.get(token)!
    if (!capture.editToken)
      throw new Error('原选区不可编辑，请复制结果')
    await capture.session.request({ command: 'apply', token: capture.editToken, text, mode })
    capture.editToken = undefined
    return null
  }

  async translatePage(language: string, owner: string, options: { dynamic?: boolean, display?: TranslationDisplay } = {}) {
    if (typeof language !== 'string' || !/^[\w-]{2,32}$/.test(language))
      throw new Error('目标语言无效')
    const { tab, originPattern } = await this.currentPage()
    if (!await this._options.permissions.contains({ origins: [originPattern] }))
      throw new Error('请先授权当前站点')
    if (!this._options.assistant)
      throw new Error('模型服务不可用')
    for (const job of this.translations.values()) {
      if (job.tabId === tab.id && job.owner !== owner)
        throw new Error('另一个工作区正在使用此页面')
    }
    await this.restorePage(owner)
    const session = await this._options.injection.connect(tab)
    const result = await session.request({ command: 'translation-blocks' })
    if (!isRecord(result) || !Array.isArray(result.blocks) || result.blocks.length > 512
      || !result.blocks.every(block => isRecord(block) && typeof block.id === 'string' && typeof block.text === 'string' && byteLength(block.text) <= 8192)) {
      throw new Error('页面返回了无效段落')
    }
    const blocks = result.blocks as Array<{ id: string, text: string }>
    const job: TranslationJob = {
      owner,
      tabId: tab.id!,
      href: tab.url!,
      language,
      session,
      abort: new AbortController(),
      value: { status: 'translating', completed: 0, total: blocks.length, truncated: result.truncated === true } as PageTranslationStatus,
      dynamic: options.dynamic === true,
      work: Promise.resolve(),
    }
    this.translations.set(owner, job)
    if (options.display)
      await this.translationDisplay(owner, options.display)
    if (job.dynamic)
      await session.request({ command: 'translation-watch', language })
    job.work = this.processTranslation(job, blocks)
    if (job.value.truncated)
      await session.request({ command: 'translation-stop' })
    return structuredClone(job.value)
  }

  private async processTranslation(job: TranslationJob, blocks: Array<{ id: string, text: string }>) {
    const originPattern = `${new URL(job.href).origin}/*`
    job.value.status = 'translating'
    try {
      for (let index = 0; index < blocks.length; index += 8) {
        const translated = await this._options.assistant!.translateBlocks(blocks.slice(index, index + 8), job.language, job.owner, job.abort.signal)
        job.abort.signal.throwIfAborted()
        const current = await this.currentPage()
        if (current.tab.id !== job.tabId || current.tab.url !== job.href || !await this._options.permissions.contains({ origins: [originPattern] }))
          throw new Error('页面或站点授权已变化')
        job.abort.signal.throwIfAborted()
        await job.session.request({ command: 'translation-apply', translations: translated, language: job.language })
        job.value.completed += translated.length
      }
      if (!job.abort.signal.aborted)
        job.value.status = 'completed'
    }
    catch (error) {
      if (!job.abort.signal.aborted) {
        job.value.status = 'failed'
        job.value.error = error instanceof Error ? error.message : '翻译失败'
        await job.session.request({ command: 'translation-stop' }).catch(() => {})
      }
    }
  }

  async translateMore(owner: string) {
    const job = this.translations.get(owner)
    if (!job?.dynamic || job.abort.signal.aborted || job.value.status === 'failed')
      return null
    job.work = job.work.then(async () => {
      if (job.abort.signal.aborted)
        return
      try {
        const current = await this.currentPage()
        if (current.tab.id !== job.tabId || current.tab.url !== job.href
          || !await this._options.permissions.contains({ origins: [current.originPattern] })) {
          throw new Error('页面或站点授权已变化')
        }
        const result = await job.session.request({ command: 'translation-blocks', incremental: true, recoverPending: job.recoverPending === true })
        job.abort.signal.throwIfAborted()
        if (!isRecord(result) || !Array.isArray(result.blocks) || result.blocks.length > 512
          || !result.blocks.every(block => isRecord(block) && typeof block.id === 'string' && typeof block.text === 'string' && byteLength(block.text) <= 8192)) {
          throw new Error('页面返回了无效段落')
        }
        job.value.total = typeof result.total === 'number' && Number.isInteger(result.total) && result.total <= 512 ? result.total : job.value.total + result.blocks.length
        job.value.truncated ||= result.truncated === true
        job.recoverPending = false
        await this.processTranslation(job, result.blocks as Array<{ id: string, text: string }>)
        if (job.value.truncated)
          await job.session.request({ command: 'translation-stop' })
      }
      catch (error) {
        if (!job.abort.signal.aborted) {
          job.value.status = 'failed'
          job.value.error = error instanceof Error ? error.message : '翻译失败'
          await job.session.request({ command: 'translation-stop' }).catch(() => {})
        }
      }
    })
    await job.work
    return this.translationStatus(owner)
  }

  translationOwner(tabId: number) { return [...this.translations.values()].find(job => job.tabId === tabId)?.owner }
  async translationDocumentState(): Promise<TranslationDocumentState> {
    const { tab, originPattern } = await this.currentPage()
    if (!await this._options.permissions.contains({ origins: [originPattern] }))
      throw new Error('请先授权当前站点')
    const session = await this._options.injection.connect(tab)
    const state = await session.request({ command: 'translation-state' })
    if (!isRecord(state) || typeof state.watching !== 'boolean' || typeof state.stopped !== 'boolean'
      || typeof state.language !== 'string' || !/^[\w-]{2,32}$/.test(state.language)
      || typeof state.truncated !== 'boolean' || !Number.isInteger(state.total) || Number(state.total) < 0 || Number(state.total) > 512
      || !Number.isInteger(state.completed) || Number(state.completed) < 0 || Number(state.completed) > Number(state.total)) {
      throw new Error('页面翻译状态无效')
    }
    return state as unknown as TranslationDocumentState
  }

  async resumeTranslation(owner: string) {
    const { tab } = await this.currentPage()
    const existing = this.translationOwner(tab.id!)
    if (existing)
      return this.translationStatus(existing)
    const state = await this.translationDocumentState()
    if (!state.watching || state.stopped)
      return null
    const session = await this._options.injection.connect(tab)
    const job: TranslationJob = {
      owner,
      tabId: tab.id!,
      href: tab.url!,
      session,
      language: state.language,
      dynamic: true,
      recoverPending: true,
      abort: new AbortController(),
      work: Promise.resolve(),
      value: { status: 'completed', completed: state.completed, total: state.total, truncated: state.truncated },
    }
    this.translations.set(owner, job)
    if (state.total > state.completed)
      void this.translateMore(owner)
    return this.translationStatus(owner)
  }

  async translationDisplay(owner: string, display: TranslationDisplay) {
    const job = this.translations.get(owner)
    if (!job)
      throw new Error('请先翻译当前网页')
    await job.session.request({ command: 'translation-display', display })
    return null
  }

  translationStatus(owner: string) { return structuredClone(this.translations.get(owner)?.value ?? null) }
  stopTranslation(owner: string) {
    const job = this.translations.get(owner)
    if (job && !job.abort.signal.aborted) {
      job.abort.abort()
      job.value.status = 'cancelled'
      void job.session.request({ command: 'translation-stop' }).catch(() => {})
    }
    return null
  }

  async restorePage(owner: string) {
    const job = this.translations.get(owner)
    if (job) {
      this.stopTranslation(owner)
      this.translations.delete(owner)
      await job.session.request({ command: 'translation-restore' }).catch(() => {})
    }
    return null
  }

  async invalidate(tabId?: number) {
    const sessions = new Set<PageSession>()
    for (const [token, item] of this.captures) {
      if (tabId === undefined || item.attachment.tabId === tabId) {
        this.captures.delete(token)
        sessions.add(item.session)
      }
    }
    for (const [owner, job] of this.translations) {
      if (tabId === undefined || job.tabId === tabId) {
        this.stopTranslation(owner)
        this.translations.delete(owner)
        sessions.add(job.session)
      }
    }
    await Promise.allSettled([...sessions].map(session => session.request({ command: 'dispose' })))
  }

  private now() { return this._options.now?.() ?? Date.now() }
}

export function handlePageContextMessage(
  controller: PageContextController,
  message: unknown,
  sender: { id?: string, url?: string, documentId?: string },
  extensionId: string,
  extensionBase: string,
) {
  if (!isRecord(message) || message.channel !== PAGE_CHANNEL || !['current', 'capture', 'selection', 'apply', 'translate', 'translation-status', 'translation-stop', 'restore'].includes(message.command as string)
    || !isTrustedModuleManagementSender(sender, extensionId, extensionBase)) {
    return undefined
  }
  const owner = sender.documentId ?? sender.url!
  const execute = message.command === 'translate'
    ? controller.translatePage(message.language as string, owner)
    : message.command === 'translation-status'
      ? Promise.resolve(controller.translationStatus(owner))
      : message.command === 'translation-stop'
        ? Promise.resolve(controller.stopTranslation(owner))
        : message.command === 'restore'
          ? controller.restorePage(owner)
          : message.command === 'current'
            ? controller.currentPage().then(({ tab, originPattern }) => ({ title: tab.title ?? '', url: tab.url, originPattern }))
            : message.command === 'apply'
              ? controller.applyWritingResult(message.token as string, message.text as string, owner)
              : controller.captureCurrentPage(owner, message.command === 'selection')
  return execute.then(value => ({ channel: PAGE_CHANNEL, ok: true, value }), error => ({
    channel: PAGE_CHANNEL,
    ok: false,
    error: error instanceof Error ? error.message : '页面操作失败',
  }))
}

export class PageContextClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}
  private async request<T>(command: string, data: object = {}): Promise<T> {
    const result = await this._transport.sendMessage({ channel: PAGE_CHANNEL, command, ...data })
    if (!isRecord(result) || result.channel !== PAGE_CHANNEL)
      throw new Error('页面连接已断开')
    if (!result.ok)
      throw new Error(typeof result.error === 'string' ? result.error : '页面操作失败')
    return result.value as T
  }

  currentPage() { return this.request<{ title: string, url: string, originPattern: string }>('current') }
  captureCurrentPage() { return this.request<PageAttachment>('capture') }
  readSelection() { return this.request<PageAttachment>('selection') }
  applyWritingResult(token: string, text: string) { return this.request<null>('apply', { token, text }) }
  translatePage(language: string) { return this.request<PageTranslationStatus>('translate', { language }) }
  translationStatus() { return this.request<PageTranslationStatus | null>('translation-status') }
  stopTranslation() { return this.request<null>('translation-stop') }
  restorePage() { return this.request<null>('restore') }
}
