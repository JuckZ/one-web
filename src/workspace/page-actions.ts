import type { PageContextController, PageContextOptions, PageSession, TranslationDisplay } from './page-context'
import type { VideoReadingController } from './video-reading'
import type { VisionController } from './vision'
import type { AssistantAttachment, AssistantIntent, AssistantMessage, AssistantStorage } from '~/modules/builtin/assistant/contracts'
import { byteLength, isRecord } from '~/modules/builtin/assistant/contracts'
import type { AssistantController } from '~/modules/builtin/assistant/controller'
import { isTrustedModuleManagementSender } from '~/modules/management-protocol'
import { ClippingController } from './clippings'
import { PageToolsController } from './page-tools'

export const PAGE_ACTION_CHANNEL = 'oneweb.page-action.v1'
const STORAGE_KEY = 'oneweb.page-assistant.v1'
export interface SiteTranslationSettings { automatic: boolean, language: string, display: TranslationDisplay }
export interface PageAssistantPreferences { enabled: boolean, sites: Array<{ origin: string, enabled: boolean, translation?: SiteTranslationSettings }> }
const defaultTranslation: SiteTranslationSettings = { automatic: false, language: 'zh-CN', display: { mode: 'bilingual', fontSize: 0, style: 'border' } }
interface PageSender { id?: string, url?: string, documentId?: string, frameId?: number, tab?: { id?: number } }
const actionInstructions: Record<string, string> = {
  translate: '翻译附加的选文',
  explain: '解释附加选文中的含义和术语',
  summarize: '总结附加内容',
  rewrite: '改写附加的选文，保留原意',
  formal: '将附加选文改为正式语气，保留原意',
  shorter: '精简附加的选文，保留重点',
  longer: '扩写附加选文，保持原意，不编造事实',
}

export class PageActionController {
  private preferences: PageAssistantPreferences = { enabled: false, sites: [] }
  private readonly ready: Promise<void>
  private readonly surfaces = new Map<number, { origin: string, session: PageSession }>()
  private readonly requests = new Map<string, { tabId: number, conversationId: string, requestId: string, attachment: AssistantAttachment, action: string, instruction: string, language: string }>()
  private readonly handoffs = new Map<string, { draft: string, intent: AssistantIntent, expires: number }>()
  private readonly hiddenVisits = new Map<number, string>()
  private readonly stoppedTranslations = new Map<number, string>()
  private readonly questions = new Map<string, { tabId: number, selection?: AssistantAttachment, conversationId?: string, requestId?: string }>()
  private readonly clippings: ClippingController
  private readonly revisits = new Map<number, { id: string, expires: number }>()
  private readonly clipSelections = new Map<string, { anchor: unknown, expires: number, tabId: number }>()
  private readonly tools: PageToolsController

  constructor(private readonly _options: {
    storage: AssistantStorage
    permissions: PageContextOptions['permissions']
    injection: PageContextOptions['injection']
    pageContext: PageContextController
    assistant: AssistantController
    openWorkspace: (_token: string) => Promise<unknown>
    openTool?: (_moduleId: string) => Promise<unknown>
    openWeb?: (_url: string) => Promise<unknown>
    video?: VideoReadingController
    vision?: VisionController
  }) {
    this.tools = new PageToolsController(_options.storage, () => _options.assistant.listPrompts())
    this.clippings = new ClippingController(_options.storage)
    this.ready = this.load()
  }

  private async load() {
    const value = (await this._options.storage.get(STORAGE_KEY))[STORAGE_KEY]
    if (isRecord(value) && typeof value.enabled === 'boolean' && Array.isArray(value.sites) && value.sites.length <= 100) {
      this.preferences = {
        enabled: value.enabled,
        sites: value.sites.filter((site): site is { origin: string, enabled: boolean } => {
          if (!isRecord(site) || typeof site.origin !== 'string' || typeof site.enabled !== 'boolean')
            return false
          try {
            const url = new URL(site.origin)
            return /^https?:$/.test(url.protocol) && url.origin === site.origin
          }
          catch {
            return false
          }
        }),
      }
    }
  }

  async readPreferences() {
    await this.ready
    return structuredClone(this.preferences)
  }

  private async save(next: PageAssistantPreferences) {
    await this._options.storage.set({ [STORAGE_KEY]: next })
    this.preferences = next
  }

  async enableSite(origin?: string) {
    await this.ready
    const { tab } = await this._options.pageContext.currentPage()
    const currentOrigin = new URL(tab.url!).origin
    const target = origin ?? currentOrigin
    if (origin && !this.preferences.sites.some(site => site.origin === origin))
      throw new Error('请从当前网页添加站点')
    if (!await this._options.permissions.contains({ origins: [`${target}/*`] }))
      throw new Error('请先授权此站点')
    const sites = this.preferences.sites.filter(site => site.origin !== target)
    if (sites.length >= 100)
      throw new Error('站点数量已达上限')
    await this.save({ enabled: true, sites: [...sites, { ...this.preferences.sites.find(site => site.origin === target), origin: target, enabled: true }] })
    if (target === currentOrigin) {
      this.hiddenVisits.delete(tab.id!)
      await this.syncActive()
    }
    return this.readPreferences()
  }

  async setEnabled(enabled: boolean) {
    await this.ready
    if (typeof enabled !== 'boolean')
      throw new Error('网页助手设置无效')
    await this.save({ ...this.preferences, enabled })
    if (!enabled)
      await this.disposeSurfaces()
    else
      await this.syncActive()
    return this.readPreferences()
  }

  async syncActive(temporary = false) {
    await this.ready
    const { tab, originPattern } = await this._options.pageContext.currentPage()
    const origin = new URL(tab.url!).origin
    if (!temporary && (!this.preferences.enabled || !this.preferences.sites.some(site => site.origin === origin && site.enabled)))
      return false
    if (!await this._options.permissions.contains({ origins: [originPattern] }))
      return false
    const session = await this._options.injection.connect(tab)
    if (!temporary && this.hiddenVisits.get(tab.id!) === session.documentId)
      return false
    this.hiddenVisits.delete(tab.id!)
    await session.request({ command: 'surface-enable' })
    this.surfaces.set(tab.id!, { origin, session })
    const revisit = this.revisits.get(tab.id!)
    if (revisit) {
      this.revisits.delete(tab.id!)
      if (revisit.expires > Date.now()) {
        const clipping = await this.clippings.get(revisit.id)
        if (clipping.url.split('#')[0] === tab.url!.split('#')[0])
          await session.request({ command: 'quote-locate', anchor: clipping.anchor, notify: true })
      }
    }
    const translation = this.preferences.sites.find(site => site.origin === origin)?.translation
    if (translation?.automatic && this.stoppedTranslations.get(tab.id!) !== session.documentId && !this._options.pageContext.translationOwner(tab.id!)) {
      const state = await this._options.pageContext.translationDocumentState()
      if (state.watching)
        await this._options.pageContext.resumeTranslation(`translation:${tab.id}`)
      else if (!state.stopped)
        await this._options.pageContext.translatePage(translation.language, `translation:${tab.id}`, { dynamic: true, display: translation.display })
    }
    return true
  }

  private owner(sender: PageSender) {
    return `page:${sender.tab!.id}:${sender.documentId ?? sender.url}`
  }

  async quickAsk() {
    if (!await this.syncActive(true))
      throw new Error('请先授权当前站点，再使用 Quick Ask')
    const { tab } = await this._options.pageContext.currentPage()
    const session = await this._options.injection.connect(tab)
    await session.request({ command: 'quick-ask-open' })
  }

  async toolCommand(message: Record<string, unknown>) {
    if (message.command === 'tool-edit') {
      if (typeof message.id !== 'string' || !message.id.startsWith('custom:'))
        throw new Error('这里只能编辑自定义动作')
      return this.tools.resolve(message.id)
    }
    if (message.command === 'tool-save')
      return this.tools.saveAction(message.action)
    if (message.command === 'tool-delete')
      return this.tools.deleteAction(message.id as string)
    if (message.command === 'tool-favorite')
      return this.tools.favorite(message.id as string, message.favorite as boolean)
    if (message.command === 'toolbar-save')
      return this.tools.configureToolbar(message.settings)
    if (message.command === 'dock-save')
      return this.tools.configureDock(message.settings)
    return this.tools.snapshot(message.query as string | undefined)
  }

  async visionConfiguration(message: Record<string, unknown>) {
    if (!this._options.vision)
      throw new Error('识图服务不可用')
    if (message.command === 'vision-save')
      return this._options.vision.configure(message.configuration)
    if (message.command === 'vision-delete')
      return this._options.vision.deleteConfiguration()
    return this._options.vision.readConfiguration()
  }

  async videoOrigins() {
    if (!this._options.video)
      throw new Error('视频阅读入口不可用')
    return this._options.video.requiredOrigins()
  }

  async pageCommand(message: Record<string, unknown>, sender: PageSender) {
    await this.ready
    const tabId = sender.tab?.id
    if (tabId === undefined || sender.frameId !== 0 || !sender.url)
      throw new Error('页面身份无效')
    const owner = this.owner(sender)
    const previous = this.requests.get(owner)
    if (message.command === 'cancel') {
      if (previous)
        this._options.assistant.cancel(previous.requestId, owner)
      return null
    }
    const current = await this._options.pageContext.currentPage()
    if (current.tab.id !== tabId || new URL(current.tab.url!).origin !== new URL(sender.url).origin
      || !await this._options.permissions.contains({ origins: [current.originPattern] })) {
      throw new Error('来源页面或授权已变化')
    }
    if (sender.documentId) {
      const session = await this._options.injection.connect(current.tab)
      if (session.documentId !== sender.documentId)
        throw new Error('来源页面身份已变化')
    }
    else if (current.tab.url !== sender.url) {
      throw new Error('来源页面身份已变化')
    }
    if (['tools', 'tool-edit', 'tool-save', 'tool-delete', 'tool-favorite', 'toolbar-save', 'dock-save'].includes(message.command as string))
      return this.toolCommand(message)
    if ((message.command as string).startsWith('vision-')) {
      const vision = this._options.vision
      if (!vision)
        throw new Error('识图服务不可用')
      if (message.command === 'vision-images') {
        const session = await this._options.injection.connect(current.tab)
        return session.request({ command: 'page-images' })
      }
      if (message.command === 'vision-capture')
        return vision.capture(owner, message.input)
      if (message.command === 'vision-start')
        return vision.start(owner, message.input)
      if (message.command === 'vision-poll')
        return vision.poll(owner)
      return vision.cancel(owner, message.command === 'vision-discard')
    }
    if ((message.command as string).startsWith('video-')) {
      const video = this._options.video
      if (!video)
        throw new Error('视频阅读入口不可用')
      if (message.command === 'video-open')
        return video.open(owner)
      if (message.command === 'video-load')
        return video.load(owner, message.token as string, message.trackId as string)
      if (message.command === 'video-import')
        return video.load(owner, message.token as string, 'import', message.subtitles as string)
      if (message.command === 'video-ask')
        return video.ask(owner, message.token as string, message.text as string)
      if (message.command === 'video-poll')
        return video.poll(owner)
      if (message.command === 'video-stop')
        return video.cancel(owner)
      return video.seek(owner, message.token as string, message.cueId as string)
    }
    if ((message.command as string).startsWith('clip-')) {
      if (message.command === 'clip-prepare') {
        this.clipSelections.delete(owner)
        const session = await this._options.injection.connect(current.tab)
        const anchor = await session.request({ command: 'quote-capture' }).catch(() => undefined)
        if (anchor) {
          for (const [key, entry] of this.clipSelections) {
            if (entry.expires < Date.now())
              this.clipSelections.delete(key)
          }
          if (this.clipSelections.size >= 32)
            throw new Error('临时选文过多，请稍后重试')
          this.clipSelections.set(owner, { anchor, expires: Date.now() + 600000, tabId })
        }
        return null
      }
      if (message.command === 'clip-list')
        return this.clippings.list()
      if (message.command === 'clip-note')
        return this.clippings.note(message.id as string, message.note as string)
      if (message.command === 'clip-delete')
        return this.clippings.delete(message.id as string)
      if (message.command === 'clip-save') {
        const session = await this._options.injection.connect(current.tab)
        const snapshot = this.clipSelections.get(owner)
        const anchor = snapshot && snapshot.expires > Date.now() ? snapshot.anchor : await session.request({ command: 'quote-capture' })
        return this.clippings.save({ anchor, url: current.tab.url, title: (current.tab.title ?? '当前网页').slice(0, 512), note: typeof message.note === 'string' ? message.note : '' })
      }
      const clipping = await this.clippings.get(message.id as string)
      if (clipping.url.split('#')[0] !== current.tab.url!.split('#')[0]) {
        if (message.command !== 'clip-open')
          throw new Error('请先打开保存的来源网页')
        if (!this._options.openWeb)
          throw new Error('网页打开入口不可用')
        const opened = await this._options.openWeb(clipping.url)
        if (isRecord(opened) && typeof opened.id === 'number')
          this.revisits.set(opened.id, { id: clipping.id, expires: Date.now() + 120000 })
        return { status: 'opened', message: '已打开来源，将在正文加载后定位；如已撤销站点权限，请重新授权' }
      }
      const session = await this._options.injection.connect(current.tab)
      return session.request({ command: 'quote-locate', anchor: clipping.anchor })
    }
    if ((message.command as string).startsWith('ask-')) {
      const askOwner = `${owner}:ask`
      const question = this.questions.get(askOwner) ?? { tabId }
      this.questions.set(askOwner, question)
      if (message.command === 'ask-prepare') {
        question.selection = await this._options.pageContext.captureCurrentPage(askOwner, true).catch(() => undefined)
        return null
      }
      if (message.command === 'ask-poll') {
        if (!question.conversationId || !question.requestId)
          throw new Error('请先发送问题')
        const conversation = await this._options.assistant.openConversation(question.conversationId)
        return conversation.messages.find(item => item.id === question.requestId)
      }
      if (message.command === 'ask-cancel' || message.command === 'ask-reset') {
        if (question.requestId)
          this._options.assistant.cancel(question.requestId, askOwner)
        if (message.command === 'ask-reset') {
          question.conversationId = undefined
          question.requestId = undefined
        }
        return null
      }
      if (message.command === 'ask-targets') {
        const session = await this._options.injection.connect(current.tab)
        return session.request({ command: 'page-links', query: message.query })
      }
      if (message.command === 'ask-open' || message.command === 'ask-search') {
        let value = message.url
        if (message.command === 'ask-search') {
          if (typeof message.query !== 'string' || !message.query.trim() || byteLength(message.query) > 2000)
            throw new Error('请输入搜索内容')
          const search = new URL('https://www.google.com/search')
          search.searchParams.set('q', message.query)
          value = search.href
        }
        let url: URL
        try {
          url = new URL(value as string)
        }
        catch {
          throw new Error('请输入完整的 HTTP(S) 网页地址')
        }
        if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.href.length > 4096)
          throw new Error('请输入合法的 HTTP(S) 网页地址')
        if (!this._options.openWeb)
          throw new Error('网页打开入口不可用')
        await this._options.openWeb(url.href)
        return null
      }
      if (typeof message.text !== 'string' || !message.text.trim() || byteLength(message.text) > 8000
        || !['none', 'page', 'selection'].includes(message.context as string)) {
        throw new Error('请输入不超过 8 KiB 的问题并选择上下文')
      }
      let attachment: AssistantAttachment | undefined
      if (message.context === 'page') {
        attachment = await this._options.pageContext.captureCurrentPage(askOwner)
      }
      else if (message.context === 'selection') {
        if (!question.selection)
          throw new Error('打开 Quick Ask 前请先选择原文')
        attachment = await this._options.pageContext.resolveAttachment(question.selection.token, askOwner)
      }
      const configuration = await this._options.assistant.readConfiguration()
      if (!configuration?.keyConfigured)
        throw new Error('请先配置模型服务')
      const request = await this._options.assistant.start({
        conversationId: question.conversationId,
        text: message.text,
        intent: 'chat',
        modelId: configuration.models[0],
        attachmentToken: attachment?.token ?? null,
      }, askOwner)
      Object.assign(question, request)
      return null
    }
    if ((message.command as string).startsWith('translation-')) {
      const page = this._options.pageContext
      const origin = new URL(sender.url).origin
      const translationOwner = page.translationOwner(tabId) ?? `translation:${tabId}`
      if (!page.translationOwner(tabId) && ['translation-update', 'translation-status'].includes(message.command as string))
        await page.resumeTranslation(translationOwner)
      if (message.command === 'translation-preferences')
        return structuredClone(this.preferences.sites.find(site => site.origin === origin)?.translation ?? defaultTranslation)
      if (message.command === 'translation-settings') {
        const value = message.settings
        if (!isRecord(value) || typeof value.automatic !== 'boolean' || typeof value.language !== 'string' || !/^[\w-]{2,32}$/.test(value.language)
          || !isRecord(value.display) || !['bilingual', 'translation'].includes(value.display.mode as string)
          || !Number.isInteger(value.display.fontSize) || Number(value.display.fontSize) < 0 || Number(value.display.fontSize) > 32
          || !['plain', 'border'].includes(value.display.style as string)) {
          throw new Error('翻译设置无效')
        }
        const translation = value as unknown as SiteTranslationSettings
        const existing = this.preferences.sites.find(site => site.origin === origin)
        if (!existing && this.preferences.sites.length >= 100)
          throw new Error('站点数量已达上限')
        await this.save({ enabled: true, sites: [...this.preferences.sites.filter(site => site.origin !== origin), { origin, enabled: existing?.enabled ?? true, translation }] })
        if (page.translationOwner(tabId))
          await page.translationDisplay(translationOwner, translation.display)
        return translation
      }
      if (message.command === 'translation-start') {
        const settings = this.preferences.sites.find(site => site.origin === origin)?.translation ?? defaultTranslation
        this.stoppedTranslations.delete(tabId)
        return page.translatePage(settings.language, translationOwner, { dynamic: true, display: settings.display })
      }
      if (message.command === 'translation-update')
        return page.translateMore(translationOwner)
      if (message.command === 'translation-status') {
        const status = page.translationStatus(translationOwner)
        if (status)
          return status
        const state = await page.translationDocumentState()
        return state.stopped && state.total > 0 ? { status: 'cancelled', completed: state.completed, total: state.total, truncated: state.truncated } : null
      }
      const session = await this._options.injection.connect(current.tab)
      this.stoppedTranslations.set(tabId, session.documentId)
      if (message.command === 'translation-restore') {
        if (!page.translationOwner(tabId))
          return session.request({ command: 'translation-restore' })
        return page.restorePage(translationOwner)
      }
      if (!page.translationOwner(tabId))
        return session.request({ command: 'translation-stop' })
      return page.stopTranslation(translationOwner)
    }
    if (message.command === 'hide') {
      if (!['visit', 'site', 'global'].includes(message.scope as string))
        throw new Error('隐藏范围无效')
      if (message.scope === 'site') {
        const origin = new URL(sender.url).origin
        await this.save({ ...this.preferences, sites: this.preferences.sites.map(site => site.origin === origin ? { ...site, enabled: false } : site) })
        await this.disposeSurfaces(origin)
      }
      else if (message.scope === 'global') {
        await this.setEnabled(false)
      }
      else {
        const surface = this.surfaces.get(tabId)
        if (surface)
          this.hiddenVisits.set(tabId, surface.session.documentId)
        await this.invalidateTab(tabId)
      }
      return null
    }
    if (message.command === 'continue') {
      const attachment = message.selection === true || !previous
        ? await this._options.pageContext.captureCurrentPage(owner, true)
        : previous.attachment
      return this.openDraft(attachment.text, 'chat')
    }
    if (message.command === 'poll') {
      if (!previous)
        throw new Error('页面请求已失效')
      const conversation = await this._options.assistant.openConversation(previous.conversationId)
      return conversation.messages.find(item => item.id === previous.requestId) ?? null
    }
    if (message.command === 'apply') {
      if (!previous)
        throw new Error('页面请求已失效')
      const conversation = await this._options.assistant.openConversation(previous.conversationId)
      const answer = conversation.messages.find(item => item.id === previous.requestId)
      if (answer?.status !== 'completed')
        throw new Error('请等待生成完成')
      return this._options.pageContext.applyWritingResult(previous.attachment.token, answer.text, owner, message.mode === undefined ? 'replace' : message.mode as 'insert' | 'replace')
    }
    const action = message.retry === true && previous ? previous.action : message.action as string
    const tool = await this.tools.resolve(action)
    if (tool.moduleId) {
      if (!this._options.openTool)
        throw new Error('工具入口不可用')
      await this.tools.used(action)
      await this._options.openTool(tool.moduleId)
      return { editable: false, opened: true }
    }
    const attachment = message.retry === true && previous
      ? await this._options.pageContext.resolveAttachment(previous.attachment.token, owner)
      : await this._options.pageContext.captureCurrentPage(owner, tool.scope !== 'page', tool.scope === 'editor')
    const config = await this._options.assistant.readConfiguration()
    if (!config?.keyConfigured)
      throw new Error('请到工作区配置模型服务')
    if (previous)
      this._options.assistant.cancel(previous.requestId, owner)
    const language = message.retry === true && previous ? previous.language : (await this.tools.snapshot()).toolbar.language ?? 'zh-CN'
    let instruction = tool.template
      ? tool.template.replace(/\$\{(text|language)\}/g, (_match, key) => key === 'text' ? attachment.text : language)
      : actionInstructions[action] ?? '总结附加的网页内容'
    if (message.retry === true && previous) {
      instruction = previous.instruction
    }
    else if (action === 'compose' || action === 'reply') {
      if (typeof message.text !== 'string' || !message.text.trim() || byteLength(message.text) > 8000)
        throw new Error('请填写不超过 8 KiB 的撰写或回复要求')
      instruction = `${action === 'reply' ? '依据用户明确提供的资料撰写回复' : '在附加的编辑器位置撰写'}。只返回可插入的正文。\n用户要求：${message.text}`
      if (message.context === 'page')
        instruction += `\n用户明确附加的当前网页：\n${(await this._options.pageContext.captureCurrentPage(owner)).text}`
    }
    const request = await this._options.assistant.start({
      intent: tool.intent ?? 'chat',
      text: instruction,
      modelId: config.models[0],
      language,
      attachmentToken: attachment.token,
    }, owner)
    this.requests.set(owner, { ...request, tabId, attachment, action, instruction, language })
    await this.tools.used(action).catch(() => {})
    return { editable: (attachment as AssistantAttachment & { editable?: boolean }).editable === true }
  }

  async openDraft(text: string, intent: AssistantIntent) {
    if (typeof text !== 'string' || byteLength(text) > (intent === 'summarize' ? 65536 : 16384))
      throw new Error('文本超过此入口的大小限制')
    for (const [token, value] of this.handoffs) {
      if (value.expires < Date.now())
        this.handoffs.delete(token)
    }
    if (this.handoffs.size >= 32)
      throw new Error('待打开的工作区过多')
    const token = crypto.randomUUID()
    this.handoffs.set(token, { draft: text ? `${actionInstructions[intent] ?? '请根据以下选文回答我的问题'}：\n\n${text}` : '', intent, expires: Date.now() + 600000 })
    await this._options.openWorkspace(token)
    return null
  }

  consumeHandoff(token: string) {
    const handoff = this.handoffs.get(token)
    this.handoffs.delete(token)
    if (!handoff || handoff.expires < Date.now())
      throw new Error('选文入口已失效，请重新选择')
    return { draft: handoff.draft, intent: handoff.intent }
  }

  async invalidateTab(tabId: number, navigation = false) {
    this._options.video?.invalidate(tabId)
    this._options.vision?.invalidate(tabId)
    for (const [owner, entry] of this.clipSelections) {
      if (entry.tabId === tabId)
        this.clipSelections.delete(owner)
    }
    if (navigation) {
      this.hiddenVisits.delete(tabId)
      this.stoppedTranslations.delete(tabId)
    }
    for (const [owner, request] of this.requests) {
      if (request.tabId === tabId) {
        this._options.assistant.cancelOwner(owner)
        this.requests.delete(owner)
      }
    }
    for (const [owner, question] of this.questions) {
      if (question.tabId === tabId) {
        this._options.assistant.cancelOwner(owner)
        this.questions.delete(owner)
      }
    }
    const surface = this.surfaces.get(tabId)
    this.surfaces.delete(tabId)
    if (surface)
      await surface.session.request({ command: 'surface-disable' }).catch(() => {})
  }

  async disposeSurfaces(origin?: string) {
    for (const [tabId, surface] of this.surfaces) {
      if (!origin || surface.origin === origin)
        await this.invalidateTab(tabId)
    }
  }

  async deactivateOthers(tabId: number) {
    for (const previous of [...this.surfaces.keys()]) {
      if (previous !== tabId)
        await this.invalidateTab(previous)
    }
  }

  async permissionsChanged() {
    this._options.video?.invalidate()
    this._options.vision?.invalidate()
    for (const [tabId, surface] of this.surfaces) {
      if (!await this._options.permissions.contains({ origins: [`${surface.origin}/*`] }))
        await this.invalidateTab(tabId)
    }
  }
}

export function handlePageActionMessage(
  controller: PageActionController,
  message: unknown,
  sender: PageSender,
  extensionId: string,
  extensionBase: string,
) {
  if (!isRecord(message) || message.channel !== PAGE_ACTION_CHANNEL || sender.id !== extensionId
    || byteLength(JSON.stringify(message)) > (message.command === 'video-import' ? 2200000 : ['clip-note', 'clip-save'].includes(message.command as string) ? 70000 : 20000)) {
    return undefined
  }
  const trusted = isTrustedModuleManagementSender(sender, extensionId, extensionBase)
  const toolCommands = ['tools', 'tool-edit', 'tool-save', 'tool-delete', 'tool-favorite', 'toolbar-save', 'dock-save']
  const visionConfigurationCommands = ['vision-configuration', 'vision-save', 'vision-delete']
  const commands = trusted ? ['preferences', 'enable-site', 'enabled', 'handoff', 'video-origins', ...visionConfigurationCommands, ...toolCommands] : ['start', 'poll', 'cancel', 'apply', 'continue', 'hide', 'translation-preferences', 'translation-settings', 'translation-start', 'translation-update', 'translation-status', 'translation-stop', 'translation-restore', 'ask-prepare', 'ask-start', 'ask-poll', 'ask-cancel', 'ask-reset', 'ask-targets', 'ask-open', 'ask-search', 'clip-list', 'clip-prepare', 'clip-save', 'clip-note', 'clip-delete', 'clip-open', 'clip-locate', 'video-open', 'video-load', 'video-import', 'video-ask', 'video-poll', 'video-seek', 'video-stop', 'vision-images', 'vision-capture', 'vision-start', 'vision-poll', 'vision-cancel', 'vision-discard', ...toolCommands]
  if (!commands.includes(message.command as string))
    return undefined
  const execute = async () => {
    if (!trusted)
      return controller.pageCommand(message, sender)
    if (toolCommands.includes(message.command as string))
      return controller.toolCommand(message)
    if (visionConfigurationCommands.includes(message.command as string))
      return controller.visionConfiguration(message)
    if (message.command === 'video-origins')
      return controller.videoOrigins()
    if (message.command === 'preferences')
      return controller.readPreferences()
    if (message.command === 'enable-site')
      return controller.enableSite(message.origin as string | undefined)
    if (message.command === 'enabled')
      return controller.setEnabled(message.enabled as boolean)
    return controller.consumeHandoff(message.token as string)
  }
  return execute().then(value => ({ channel: PAGE_ACTION_CHANNEL, ok: true, value }), error => ({
    channel: PAGE_ACTION_CHANNEL,
    ok: false,
    error: error instanceof Error ? error.message : '网页助手操作失败',
  }))
}

export class PageActionClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}
  async request<T>(command: string, data: object = {}): Promise<T> {
    const result = await this._transport.sendMessage({ channel: PAGE_ACTION_CHANNEL, command, ...data })
    if (!isRecord(result) || result.channel !== PAGE_ACTION_CHANNEL)
      throw new Error('网页助手连接已断开')
    if (!result.ok)
      throw new Error(typeof result.error === 'string' ? result.error : '网页助手操作失败')
    return result.value as T
  }

  preferences() {
    return this.request<PageAssistantPreferences>('preferences')
  }

  enableSite(origin?: string) {
    return this.request<PageAssistantPreferences>('enable-site', { origin })
  }

  setEnabled(enabled: boolean) {
    return this.request<PageAssistantPreferences>('enabled', { enabled })
  }

  handoff(token: string) {
    return this.request<{ draft: string, intent: AssistantIntent }>('handoff', { token })
  }

  start(action: string, retry = false, input: { text?: string, context?: string } = {}) {
    return this.request<{ editable: boolean, opened?: boolean }>('start', { action, retry, ...input })
  }

  poll() {
    return this.request<AssistantMessage>('poll')
  }
}
