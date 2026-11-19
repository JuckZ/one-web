/* eslint no-template-curly-in-string: off -- Prompt placeholders are literal text, not JavaScript interpolation. */
import type { AssistantAttachment, AssistantIntent, AssistantPrompt, Conversation, PublicProvider } from '~/modules/builtin/assistant/contracts'
import { MAX_TAB_SOURCES } from '~/modules/builtin/assistant/contracts'
import type { AssistantClient } from '~/modules/builtin/assistant/protocol'
import { serviceBase } from '~/modules/builtin/video-dubbing/config'
import { dubbingSite } from '~/modules/builtin/video-dubbing/sites'
import type { PageActionClient, PageAssistantPreferences } from '~/workspace/page-actions'
import type { PageContextClient, PageTranslationStatus } from '~/workspace/page-context'
import type { TabSource, TabSourceClient } from '~/workspace/tab-sources'
import type { VisionConfiguration } from '~/workspace/vision'
import { createAssistantPicker } from './assistant-picker'

export type AssistantMode = 'assistant' | 'reading' | 'translation' | 'writing' | 'history' | 'favorites' | 'settings'
export interface AssistantViewOptions {
  client: AssistantClient
  permissions: { request: (_query: { origins: string[] }) => Promise<boolean> }
  clipboard?: { writeText: (_text: string) => Promise<void> }
  onConversationOpen?: () => void | Promise<void>
  onDraftReturn?: () => void | Promise<void>
  readFile?: (_file: File) => Promise<string>
  pageContext?: PageContextClient
  pageActions?: PageActionClient
  tabSources?: TabSourceClient
}

export function uiNode<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  if (className)
    node.className = className
  return node
}

export class AssistantView {
  private configuration: PublicProvider | null = null
  private mode: AssistantMode = 'assistant'
  private configuring = false
  private conversation: Conversation | null = null
  private draft = ''
  private modelId = ''
  private language = 'zh-CN'
  private attachment: AssistantAttachment | null = null
  private tabSources: Array<TabSource & { disconnected?: boolean }> = []
  private attachingTab?: symbol
  private resettingConversation?: Promise<unknown>
  private requestId: string | null = null
  private feedback = ''
  private disposed = false
  private busy = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly messages = uiNode('div', '', 'assistant-messages')
  private readonly status = uiNode('p', '', 'assistant-status')
  private fields = new Map<string, HTMLInputElement | HTMLTextAreaElement>()
  private collection: Conversation[] = []
  private prompts: AssistantPrompt[] = []
  private promptId = ''
  private pageInfo: { title: string, url: string, originPattern: string } | null = null
  private translation: PageTranslationStatus | null = null
  private translationTimer: ReturnType<typeof setTimeout> | undefined
  private pagePreferences: PageAssistantPreferences = { enabled: false, sites: [] }
  private historyEnabled = true
  private generation = 0
  private draftIntent: AssistantIntent | undefined
  private visionConfiguration: VisionConfiguration | null = null
  private captionOrigins: string[] = []

  constructor(readonly root: HTMLElement, private readonly _options: AssistantViewOptions) {
    root.classList.add('assistant-workspace')
    root.dataset.testid = 'assistant-workspace'
    this.status.dataset.testid = 'assistant-status'
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
  }

  async open(mode: AssistantMode) {
    this.mode = mode
    this.configuring = mode === 'settings'
    try {
      this.configuration = await this._options.client.readConfiguration()
      this.prompts = await this._options.client.listPrompts()
      await this.refreshCurrentPage()
      if (mode === 'settings' && this._options.pageActions) {
        this.pagePreferences = await this._options.pageActions.preferences()
        this.visionConfiguration = await this._options.pageActions.request<VisionConfiguration | null>('vision-configuration')
      }
      if (mode === 'settings')
        this.historyEnabled = (await this._options.client.preferences()).historyEnabled
      if (this.promptId && !this.prompts.some(prompt => prompt.id === this.promptId))
        this.promptId = ''
      if (mode === 'history' || mode === 'favorites')
        this.collection = await this._options.client.listConversations()
      if (!this.configuration?.models.includes(this.modelId))
        this.modelId = this.configuration?.models[0] ?? ''
    }
    catch (error) {
      this.feedback = this.error(error)
    }
    if (!this.disposed)
      this.render()
  }

  private button(text: string, testId: string, action: () => void | Promise<void>, className = 'secondary-button') {
    const button = uiNode('button', text, className)
    button.type = 'button'
    button.dataset.testid = testId
    button.addEventListener('click', () => {
      try {
        void Promise.resolve(action()).catch(error => this.message(this.error(error)))
      }
      catch (error) {
        this.message(this.error(error))
      }
    })
    return button
  }

  private message(text: string) {
    if (this.disposed)
      return
    this.feedback = text
    this.status.textContent = text
  }

  private error(error: unknown) {
    return error instanceof Error ? error.message : '操作失败，请重试'
  }

  private render() {
    if (this.disposed)
      return
    this.root.replaceChildren()
    const header = uiNode('div', '', 'assistant-heading')
    const titles: Record<AssistantMode, string> = {
      assistant: '有什么想一起完成的？',
      reading: '阅读与理解',
      translation: '跨越语言',
      writing: '把想法写出来',
      history: '对话历史',
      favorites: '收藏',
      settings: '模型与偏好',
    }
    header.append(uiNode('h1', titles[this.mode]))
    header.append(this.button('新对话', 'assistant-new', () => this.newConversation()))
    this.root.append(header)
    if (this.mode === 'history' || this.mode === 'favorites') {
      this.renderCollection()
    }
    else if (this.configuring) {
      this.renderConfiguration()
    }
    else {
      if (this.mode === 'translation')
        this.renderPageTranslation()
      this.renderMessages()
      this.root.append(this.messages)
      this.renderComposer()
    }
    this.status.textContent = this.feedback
    this.root.append(this.status)
  }

  private renderCollection() {
    const search = uiNode('input', '', 'workspace-search')
    search.type = 'search'
    search.placeholder = '搜索对话…'
    search.setAttribute('aria-label', '搜索对话')
    const list = uiNode('div', '', 'assistant-history-list')
    const populate = () => {
      list.replaceChildren()
      const matches = this.collection.filter(item => `${item.title}\n${item.messages.map(message => message.text).join('\n')}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))
      for (const item of matches) {
        const favorites = item.messages.filter(message => message.favorite)
        if (this.mode === 'favorites' && !favorites.length)
          continue
        const card = uiNode('article', '', 'assistant-history-card')
        const open = this.button(item.title, 'assistant-open-conversation', async () => {
          const generation = this.generation
          this.attachingTab = undefined
          this.tabSources = []
          await this._options.tabSources?.clear()
          const conversation = await this._options.client.openConversation(item.id)
          if (this.disposed || generation !== this.generation)
            return
          this.conversation = conversation
          this.attachment = conversation.attachment ?? null
          this.mode = 'assistant'
          this.configuring = false
          this.render()
          await this._options.onConversationOpen?.()
        })
        open.setAttribute('aria-label', `打开对话 ${item.title}`)
        card.append(open, uiNode('small', new Date(item.updatedAt).toLocaleString()))
        if (this.mode === 'favorites')
          favorites.forEach(message => card.append(uiNode('p', message.text)))
        card.append(this.button('删除', 'assistant-delete-conversation', async () => {
          await this._options.client.deleteConversation(item.id)
          this.collection = await this._options.client.listConversations()
          if (this.conversation?.id === item.id)
            this.conversation = null
          populate()
        }))
        list.append(card)
      }
      if (!list.childElementCount)
        list.append(uiNode('p', this.mode === 'favorites' ? '还没有收藏的回答。' : '这里会保存你在本机的对话。', 'assistant-empty'))
    }
    search.addEventListener('input', populate)
    populate()
    this.root.append(search, list)
  }

  private field(label: string, value: string, multiline = false, password = false) {
    const wrapper = uiNode('label', label)
    const input = multiline ? uiNode('textarea') : uiNode('input')
    input.setAttribute('aria-label', label)
    input.value = value
    input.autocomplete = 'off'
    input.spellcheck = false
    if (input instanceof HTMLInputElement)
      input.type = password ? 'password' : 'text'
    wrapper.append(input)
    this.fields.set(label, input)
    return wrapper
  }

  private renderConfiguration() {
    this.fields.clear()
    const form = uiNode('section', '', 'assistant-configuration')
    form.dataset.testid = 'assistant-configuration'
    form.append(
      uiNode('p', '使用你自己的兼容模型服务。消息和你附加的内容会发送到此服务。'),
      this.field('服务地址', this.configuration?.baseUrl ?? 'https://api.openai.com/v1/'),
      this.field('模型（每行一个）', this.configuration?.models.join('\n') ?? '', true),
      this.field('API key', '', false, true),
    )
    if (this.configuration?.keyConfigured)
      form.append(uiNode('small', '密钥已保管。服务地址保持相同时，留空可保留现有密钥。'))
    const remember = uiNode('input')
    remember.type = 'checkbox'
    remember.checked = this.configuration?.remember ?? false
    remember.setAttribute('aria-label', '记住服务密钥')
    const label = uiNode('label', '记住服务密钥（否则只在本次浏览器会话保存）')
    label.prepend(remember)
    form.append(label)
    form.append(this.button('授权并保存', 'assistant-save-provider', async () => {
      const baseUrl = serviceBase(this.fields.get('服务地址')!.value)
      const models = this.fields.get('模型（每行一个）')!.value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
      const key = this.fields.get('API key')!.value
      const granted = this._options.permissions.request({ origins: [`${new URL(baseUrl).origin}/*`] })
      if (!await granted)
        throw new Error('未获得模型服务权限')
      this.configuration = await this._options.client.configureProvider({ baseUrl, models, key, remember: remember.checked })
      this.modelId = models[0]
      this.configuring = false
      this.mode = 'assistant'
      this.feedback = '配置已保存'
      this.render()
      await this._options.onConversationOpen?.()
    }, 'primary-button'))
    form.append(this.button('返回草稿', 'assistant-back', async () => {
      this.configuring = false
      if (this.mode === 'settings' && this._options.onDraftReturn) {
        await this._options.onDraftReturn()
        return
      }
      if (this.mode === 'settings')
        this.mode = 'assistant'
      this.render()
    }))
    this.root.append(form)
    this.renderPrompts()
    this.renderPageControls()
    this.renderHistoryControls()
    this.renderVisionConfiguration()
    this.renderVideoReadingAccess()
  }

  private renderVideoReadingAccess() {
    if (!this._options.pageActions)
      return
    const panel = uiNode('section', '', 'assistant-configuration')
    panel.append(uiNode('h2', '当前视频阅读'), uiNode('p', '字幕读取独立于视频配音。授权当前站点及字幕发现来源后，可查看并授权这个视频的具体字幕来源。'))
    panel.append(this.button('授权当前视频字幕发现', 'video-reading-discovery-access', async () => {
      const site = dubbingSite(this.pageInfo?.url ?? '')
      if (!site)
        throw new Error('请先打开普通点播视频网页')
      const granted = this._options.permissions.request({ origins: site.origins })
      if (!await granted)
        throw new Error('未获得视频字幕发现权限')
      this.captionOrigins = await this._options.pageActions!.request<string[]>('video-origins')
      this.feedback = '已发现字幕来源，请核对下方来源并授权'
      this.render()
    }))
    if (this.captionOrigins.length) {
      panel.append(uiNode('p', this.captionOrigins.join('\n')), this.button('授权此视频字幕来源', 'video-reading-caption-access', async () => {
        if (!await this._options.permissions.request({ origins: this.captionOrigins }))
          throw new Error('未获得字幕来源权限')
        this.message('字幕来源已授权，可回到网页菜单使用当前视频阅读')
      }))
    }
    this.root.append(panel)
  }

  private renderVisionConfiguration() {
    if (!this._options.pageActions)
      return
    const panel = uiNode('section', '', 'assistant-configuration')
    panel.append(uiNode('h2', '截图与图片识别'), uiNode('p', '独立配置支持 image_url 输入的兼容 chat/completions 服务。仅在预览后确认发送图片；临时图像不写入历史。'))
    const field = (label: string, value: string, password = false) => {
      const wrapper = uiNode('label', label)
      const input = uiNode('input')
      input.type = password ? 'password' : 'text'
      input.value = value
      input.setAttribute('aria-label', label)
      wrapper.append(input)
      panel.append(wrapper)
      return input
    }
    const base = field('识图服务地址', this.visionConfiguration?.baseUrl ?? 'https://api.openai.com/v1/')
    const model = field('识图模型', this.visionConfiguration?.model ?? '')
    const key = field('识图 API key', '', true)
    const remember = uiNode('input')
    remember.type = 'checkbox'
    remember.checked = this.visionConfiguration?.remember ?? false
    remember.setAttribute('aria-label', '记住识图密钥')
    const label = uiNode('label', '记住识图密钥（默认仅本次浏览器会话）')
    label.prepend(remember)
    panel.append(label, uiNode('small', this.visionConfiguration?.keyConfigured ? '识图密钥已保管；同一服务留空可保留。' : '尚未配置识图密钥。'))
    panel.append(this.button('授权并保存识图服务', 'vision-save-provider', async () => {
      const baseUrl = serviceBase(base.value)
      const granted = this._options.permissions.request({ origins: [`${new URL(baseUrl).origin}/*`] })
      if (!await granted)
        throw new Error('未获得识图服务权限')
      this.visionConfiguration = await this._options.pageActions!.request<VisionConfiguration>('vision-save', { configuration: { baseUrl, model: model.value, key: key.value, remember: remember.checked } })
      key.value = ''
      this.message('识图服务已保存；可从网页悬浮菜单选择截图与图片识别')
    }), this.button('删除识图配置', 'vision-delete-provider', async () => {
      await this._options.pageActions!.request('vision-delete')
      this.visionConfiguration = null
      key.value = ''
      this.message('识图配置与密钥已删除')
    }))
    this.root.append(panel)
  }

  private renderPageControls() {
    if (!this._options.pageActions)
      return
    const section = uiNode('section', '', 'assistant-configuration')
    section.append(uiNode('h2', '网页助手'), uiNode('p', '只在你启用并授权的站点显示悬浮入口和选文工具条。建议快捷键：Alt+Shift+O 打开工作区，Alt+Shift+K 打开 Quick Ask。发生冲突时可在浏览器的扩展快捷键设置中调整。'))
    const enabled = uiNode('input')
    enabled.type = 'checkbox'
    enabled.checked = this.pagePreferences.enabled
    enabled.setAttribute('aria-label', '启用网页助手')
    enabled.addEventListener('change', () => {
      void this._options.pageActions!.setEnabled(enabled.checked).then((value) => {
        this.pagePreferences = value
        this.message(value.enabled ? '网页助手已开启' : '网页助手已全局关闭')
      }).catch((error) => {
        enabled.checked = !enabled.checked
        this.message(this.error(error))
      })
    })
    const label = uiNode('label', '启用网页助手')
    label.prepend(enabled)
    section.append(label, this.button('在此站点启用网页助手', 'assistant-enable-site', async () => {
      await this.authorizePage()
      this.pagePreferences = await this._options.pageActions!.enableSite()
      enabled.checked = true
      this.message('已在此站点启用网页助手')
    }))
    for (const site of this.pagePreferences.sites) {
      const row = uiNode('div', `${site.origin} · ${site.enabled ? '已启用' : '已隐藏'}`)
      if (!site.enabled) {
        row.append(this.button('恢复此站点', 'assistant-restore-site', async () => {
          if (!await this._options.permissions.request({ origins: [`${site.origin}/*`] }))
            throw new Error('未获得此站点的读取权限')
          this.pagePreferences = await this._options.pageActions!.enableSite(site.origin)
          row.textContent = `${site.origin} · 已恢复`
          enabled.checked = true
        }))
      }
      section.append(row)
    }
    this.root.append(section)
  }

  private renderPrompts() {
    const section = uiNode('section', '', 'assistant-configuration')
    const list = uiNode('div', '', 'assistant-prompt-list')
    let editingId: string | undefined
    section.append(uiNode('h2', '提示词'), uiNode('p', '纯文本模板，支持 ${text} 和 ${language}。'))
    const populate = () => {
      list.replaceChildren()
      this.prompts.forEach((item, index) => {
        const row = uiNode('div', '', 'assistant-prompt-row')
        row.append(uiNode('strong', item.title), uiNode('p', item.template))
        const edit = this.button('编辑', 'assistant-edit-prompt', () => {
          editingId = item.id
          this.fields.get('提示词名称')!.value = item.title
          this.fields.get('提示词模板')!.value = item.template
          this.fields.get('提示词名称')!.focus()
        })
        edit.setAttribute('aria-label', `编辑提示词 ${item.title}`)
        const remove = this.button('删除', 'assistant-delete-prompt', async () => {
          await this._options.client.deletePrompt(item.id)
          this.prompts = await this._options.client.listPrompts()
          if (editingId === item.id)
            editingId = undefined
          populate()
        })
        remove.setAttribute('aria-label', `删除提示词 ${item.title}`)
        row.append(edit)
        for (const [offset, label] of [[-1, '上移'], [1, '下移']] as const) {
          const move = this.button(label, 'assistant-move-prompt', async () => {
            const ids = this.prompts.map(prompt => prompt.id)
            ;[ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]
            await this._options.client.reorderPrompts(ids)
            this.prompts = await this._options.client.listPrompts()
            populate()
          })
          move.disabled = index + offset < 0 || index + offset >= this.prompts.length
          move.setAttribute('aria-label', `${label}提示词 ${item.title}`)
          row.append(move)
        }
        row.append(remove)
        list.append(row)
      })
    }
    populate()
    section.append(list)
    section.append(this.field('提示词名称', ''), this.field('提示词模板', '', true))
    section.append(this.button('保存提示词', 'assistant-save-prompt', async () => {
      await this._options.client.savePrompt({
        id: editingId,
        title: this.fields.get('提示词名称')!.value,
        template: this.fields.get('提示词模板')!.value,
      })
      this.prompts = await this._options.client.listPrompts()
      editingId = undefined
      populate()
      this.message('提示词已保存')
      this.fields.get('提示词名称')!.value = ''
      this.fields.get('提示词模板')!.value = ''
    }, 'primary-button'))
    this.root.append(section)
  }

  private renderHistoryControls() {
    const section = uiNode('section', '', 'assistant-configuration')
    section.append(uiNode('h2', '本机历史'), uiNode('p', '保存聊天消息和你主动附加的文本。关闭后新增对话与追问只保留在本次运行中，开启保存不会补存这些内容。'))
    const enabled = uiNode('input')
    enabled.type = 'checkbox'
    enabled.checked = this.historyEnabled
    enabled.setAttribute('aria-label', '保存本机对话历史')
    enabled.addEventListener('change', () => {
      void this._options.client.setHistoryEnabled(enabled.checked).then(() => {
        this.historyEnabled = enabled.checked
        this.message(enabled.checked ? '已开启本机历史保存' : '已关闭本机历史保存')
      }).catch((error) => {
        enabled.checked = this.historyEnabled
        this.message(this.error(error))
      })
    })
    const label = uiNode('label', '保存本机对话历史')
    label.prepend(enabled)
    const confirmation = uiNode('div', '', 'assistant-clear-confirmation')
    confirmation.hidden = true
    confirmation.append(uiNode('p', '将删除本机的全部聊天和收藏。确认清空？'))
    confirmation.append(this.button('确认清空', 'assistant-confirm-clear-history', async () => {
      await this._options.client.clearConversations()
      this.conversation = null
      this.requestId = null
      clearTimeout(this.timer)
      confirmation.hidden = true
      this.message('本机对话与收藏已清空')
    }), this.button('取消', 'assistant-cancel-clear-history', () => { confirmation.hidden = true }))
    section.append(label, this.button('清空本机历史与收藏', 'assistant-clear-history', () => {
      confirmation.hidden = false
    }), confirmation)
    this.root.append(section)
  }

  private renderMessages() {
    this.messages.replaceChildren()
    if (!this.conversation?.messages.length) {
      const welcome = uiNode('div', '', 'assistant-welcome')
      welcome.append(uiNode('span', '✳', 'assistant-spark'), uiNode('h2', '一个入口，连接你的思考与网页。'))
      welcome.append(uiNode('p', '提问、阅读、翻译与写作。由你选择模型，由你决定附加什么。'))
      this.messages.append(welcome)
      return
    }
    for (const [index, message] of this.conversation.messages.entries()) {
      const card = uiNode('article', '', `assistant-message is-${message.role}`)
      card.append(uiNode('span', message.role === 'user' ? '你' : `OneWeb · ${message.modelId ?? ''}`, 'assistant-message-label'))
      card.append(uiNode('div', message.text || (message.status === 'preparing' ? '正在连接模型…' : ''), 'assistant-message-text'))
      if (message.error)
        card.append(uiNode('p', message.error, 'assistant-error'))
      if (message.role === 'assistant' && ['failed', 'cancelled'].includes(message.status)) {
        card.append(this.button('重试', 'assistant-retry', async () => {
          this.draft = this.conversation!.messages[index - 1]?.text ?? ''
          await this.send(message.intent)
        }))
      }
      if (message.role === 'assistant' && message.text) {
        const actions = uiNode('div', '', 'assistant-message-actions')
        actions.append(
          this.button('复制', 'assistant-copy', async () => {
            await (this._options.clipboard ?? navigator.clipboard).writeText(message.text)
            this.message('已复制')
          }),
          this.button(message.favorite ? '取消收藏' : '收藏', 'assistant-favorite', async () => {
            await this._options.client.setFavorite(message.id, !message.favorite)
            this.conversation = await this._options.client.openConversation(this.conversation!.id)
            this.renderMessages()
          }),
        )
        card.append(actions)
        const sourceToken = message.attachmentToken
        if (sourceToken && sourceToken === this.attachment?.token
          && (this.attachment as AssistantAttachment & { editable?: boolean }).editable && message.status === 'completed' && this._options.pageContext) {
          actions.append(this.button('替换原选文', 'assistant-apply', async () => {
            await this._options.pageContext!.applyWritingResult(sourceToken, message.text)
            this.message('已替换选文')
          }))
        }
      }
      this.messages.append(card)
    }
  }

  private renderComposer() {
    const composer = uiNode('div', '', 'assistant-composer')
    const model = uiNode('select')
    model.setAttribute('aria-label', '模型')
    for (const value of this.configuration?.models ?? []) {
      const option = uiNode('option', value)
      option.value = value
      model.append(option)
    }
    model.value = this.modelId
    model.addEventListener('change', () => {
      this.modelId = model.value
    })
    const language = uiNode('select')
    language.setAttribute('aria-label', '目标语言')
    for (const [value, label] of [['zh-CN', '简体中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['de', 'Deutsch']]) {
      const option = uiNode('option', label)
      option.value = value
      language.append(option)
    }
    language.value = this.language
    language.addEventListener('change', () => {
      this.language = language.value
    })
    const metadata = uiNode('div', '', 'assistant-composer-meta')
    const prompt = uiNode('select')
    prompt.setAttribute('aria-label', '提示词')
    const builtin = uiNode('option', `内置：${{ reading: '阅读总结', translation: '准确翻译', writing: '写作助手' }[this.mode as 'reading'] ?? '清晰回答'}`)
    builtin.value = ''
    prompt.append(builtin)
    for (const item of this.prompts) {
      const option = uiNode('option', item.title)
      option.value = item.id
      prompt.append(option)
    }
    prompt.value = this.promptId
    prompt.addEventListener('change', () => {
      this.promptId = prompt.value
    })
    metadata.append(model, language, prompt)
    composer.append(metadata)
    if (this.attachment) {
      const source = uiNode('div', '', 'assistant-attachment')
      source.append(uiNode('span', `${this.attachment.type === 'selection' ? '选文 · ' : ''}${this.attachment.title}${this.attachment.truncated ? ' · 已截断' : ''}`))
      if (this.attachment.url)
        source.append(uiNode('small', this.attachment.url))
      if (this.attachment.extraction === 'visible-text')
        source.append(uiNode('small', '未找到正文区域，已读取可见文本'))
      source.append(this.button('移除附件', 'assistant-remove-attachment', () => {
        this.attachment = null
        this.render()
      }))
      composer.append(source)
    }
    const input = uiNode('textarea')
    input.setAttribute('aria-label', '消息')
    input.placeholder = this._options.tabSources ? '输入问题，@ 添加标签页，/ 选择提示词' : '输入问题，或告诉我你想完成什么…'
    input.value = this.draft
    input.rows = 3
    input.addEventListener('input', () => {
      this.draft = input.value
    })
    const sourceList = uiNode('div', '', 'assistant-tab-sources')
    const refreshSources = () => {
      sourceList.replaceChildren()
      if (!this.tabSources.length)
        return
      sourceList.append(uiNode('p', `已附加 ${this.tabSources.length} 个标签页 · 仅在发送时共享`, 'assistant-source-caption'))
      for (const [index, source] of this.tabSources.entries()) {
        const chip = uiNode('div', '', 'assistant-source-chip')
        const open = this.button(`[${index + 1}] ${source.title}`, 'assistant-tab-source-open', () => this._options.tabSources!.focus(source.token).then(() => {}), 'assistant-source-open')
        open.setAttribute('aria-label', `返回来源：${source.title}`)
        open.disabled = source.disconnected ?? false
        const hint = source.disconnected ? ' · 已失效，请重新添加' : source.truncated ? ' · 正文已截断' : ''
        chip.append(open, uiNode('small', `${source.url}${hint}`))
        const remove = this.button('移除', 'assistant-tab-source-remove', async () => {
          if (!source.disconnected)
            await this._options.tabSources!.remove(source.token)
          this.tabSources = this.tabSources.filter(item => item.token !== source.token)
          refreshSources()
          input.focus()
        })
        remove.setAttribute('aria-label', `移除来源：${source.title}`)
        chip.append(remove)
        sourceList.append(chip)
      }
      if (!this.draft && !this.requestId) {
        const task = this.tabSources.length === 1 ? '总结所选网页' : '比较所选网页'
        sourceList.append(this.button(task, 'assistant-tab-source-suggestion', () => {
          if (!this.draft) {
            this.draft = this.tabSources.length === 1 ? '总结所选网页的重点，并标明来源。' : '比较所选网页的共同点和差异，并标明来源。'
            input.value = this.draft
            refreshSources()
          }
          input.focus()
        }))
      }
    }
    refreshSources()
    const picker = createAssistantPicker(input, {
      listTabs: this._options.tabSources
        ? async () => {
          await this.resettingConversation
          return this._options.tabSources!.list()
        }
        : undefined,
      addTab: async (choice, signal) => {
        const client = this._options.tabSources!
        if (this.attachingTab)
          throw new Error('请等待标签页附加完成')
        if (this.busy || this.requestId)
          throw new Error('请等待当前回答完成后再添加标签页')
        if (this.tabSources.length >= MAX_TAB_SOURCES && !this.tabSources.some(item => item.tabId === choice.tabId))
          throw new Error(`最多附加 ${MAX_TAB_SOURCES} 个标签页，请先移除一个`)
        const operation = Symbol('attach tab')
        this.attachingTab = operation
        this.message('正在等待标签页授权或读取正文…')
        try {
          const authorized = await this._options.permissions.request({ origins: [choice.originPattern] })
          if (this.disposed || this.attachingTab !== operation)
            return
          if (signal.aborted) {
            this.message('已取消附加标签页')
            return
          }
          if (!authorized)
            throw new Error('未获得此标签页的站点权限')
          const source = await client.attach(choice.token)
          if (this.disposed || signal.aborted || this.attachingTab !== operation) {
            if (!this.tabSources.some(item => item.token === source.token))
              await client.remove(source.token).catch(() => {})
            if (signal.aborted && this.attachingTab === operation)
              this.message('已取消附加标签页')
            return
          }
          const existing = this.tabSources.findIndex(item => item.tabId === source.tabId)
          if (existing < 0)
            this.tabSources.push(source)
          else
            this.tabSources[existing] = source
          this.message('标签页已附加，可以继续添加或发送问题')
          if (sourceList.isConnected)
            refreshSources()
          else
            this.render()
        }
        finally {
          if (this.attachingTab === operation)
            this.attachingTab = undefined
        }
      },
      prompts: this.prompts,
      choosePrompt: (id) => {
        this.promptId = id
        prompt.value = id
        this.message(`已选择提示词：${this.prompts.find(item => item.id === id)?.title ?? ''}`)
      },
      changeDraft: (draft) => {
        this.draft = draft
        refreshSources()
      },
      report: text => this.message(text),
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.repeat && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        return
      }
      if (picker.key(event))
        return
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault()
        void this.send().catch(error => this.message(this.error(error)))
      }
    })
    const actions = uiNode('div', '', 'assistant-composer-actions')
    actions.append(this.button('模型设置', 'assistant-configure', () => {
      this.configuring = true
      this.render()
    }))
    const importLabel = uiNode('label', '导入', 'assistant-file-button')
    const file = uiNode('input')
    file.type = 'file'
    file.accept = '.txt,.md,.srt,.vtt'
    file.setAttribute('aria-label', '导入文本或字幕')
    file.addEventListener('change', () => {
      const selected = file.files?.[0]
      if (!selected)
        return
      void (async () => {
        if (selected.size > 65536)
          throw new Error('文件不能超过 64 KiB')
        const text = this._options.readFile
          ? await this._options.readFile(selected)
          : new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer())
        const attachment = await this._options.client.importText({ name: selected.name, text })
        this.setAttachment(attachment)
        this.message('已导入文本，可总结或继续提问')
      })().catch(error => this.message(this.error(error)))
    })
    importLabel.append(file)
    actions.append(importLabel)
    if (this._options.pageContext) {
      actions.append(this.button('附加当前页', 'assistant-attach-page', () => this.attachPage(false)))
      actions.append(this.button('附加选文', 'assistant-attach-selection', () => this.attachPage(true)))
    }
    actions.append(this.requestId
      ? this.button('停止生成', 'assistant-stop', async () => {
        await this._options.client.cancel(this.requestId!)
        await this.updateAnswer()
      })
      : this.button('发送', 'assistant-send', () => this.send(), 'primary-button'))
    composer.append(sourceList, input, picker.controls, picker.panel, actions)
    this.root.append(composer)
  }

  private async send(intent?: AssistantIntent) {
    if (this.busy || this.requestId || !this.draft.trim())
      return
    if (this.attachingTab || this.resettingConversation) {
      this.message(this.attachingTab ? '请等待标签页授权和正文读取完成' : '请等待新对话准备完成')
      return
    }
    if (this.tabSources.some(source => source.disconnected)) {
      this.message('请移除或重新添加已失效的网页来源，草稿已保留')
      return
    }
    if (!this.configuration?.keyConfigured) {
      this.configuring = true
      this.feedback = '请先配置模型服务，草稿已保留'
      this.render()
      return
    }
    this.busy = true
    const generation = this.generation
    const intents: Partial<Record<AssistantMode, AssistantIntent>> = {
      reading: 'summarize',
      translation: 'translate',
      writing: 'writing',
    }
    try {
      const request = await this._options.client.start({
        conversationId: this.conversation?.id,
        intent: intent ?? this.draftIntent ?? intents[this.mode] ?? 'chat',
        text: this.draft,
        modelId: this.modelId,
        language: this.language,
        attachmentToken: this.attachment?.token ?? null,
        ...(this.tabSources.length ? { tabSourceTokens: this.tabSources.map(source => source.token) } : {}),
        promptId: this.promptId || undefined,
      })
      if (this.disposed || generation !== this.generation) {
        await this._options.client.cancel(request.requestId)
        return
      }
      this.requestId = request.requestId
      const conversation = await this._options.client.openConversation(request.conversationId)
      if (this.disposed || generation !== this.generation)
        return
      this.conversation = conversation
      this.draft = ''
      this.draftIntent = undefined
      this.feedback = '正在生成…'
      this.render()
      await this.updateAnswer()
    }
    catch (error) {
      if (!this.disposed && generation === this.generation) {
        const requestId = this.requestId
        this.requestId = null
        if (requestId)
          await this._options.client.cancel(requestId).catch(() => {})
        this.feedback = this.error(error)
        this.render()
      }
    }
    finally {
      if (generation === this.generation)
        this.busy = false
    }
  }

  private async updateAnswer() {
    if (this.disposed || !this.conversation)
      return
    const generation = this.generation
    try {
      const id = this.conversation.id
      const conversation = await this._options.client.openConversation(id)
      if (this.disposed || generation !== this.generation || this.conversation?.id !== id)
        return
      this.conversation = conversation
      const answer = this.conversation.messages.at(-1)
      this.renderMessages()
      if (answer?.status === 'completed' || answer?.status === 'cancelled' || answer?.status === 'failed') {
        this.requestId = null
        this.feedback = answer.status === 'completed' ? '已完成' : answer.status === 'cancelled' ? '已停止，保留部分回答' : answer.error ?? '请求失败'
        this.render()
      }
      else {
        this.timer = setTimeout(() => {
          void this.updateAnswer()
        }, 150)
      }
    }
    catch (error) {
      if (this.disposed || generation !== this.generation)
        return
      this.requestId = null
      this.feedback = this.error(error)
      this.render()
    }
  }

  async newConversation() {
    const generation = ++this.generation
    this.busy = false
    this.attachingTab = undefined
    const requestId = this.requestId
    clearTimeout(this.timer)
    this.requestId = null
    this.conversation = null
    this.attachment = null
    this.tabSources = []
    this.draft = ''
    this.draftIntent = undefined
    this.feedback = ''
    this.configuring = false
    const leaveCollection = ['history', 'favorites', 'settings'].includes(this.mode)
    if (leaveCollection)
      this.mode = 'assistant'
    const previous = this.resettingConversation
    const reset = (async () => {
      await previous?.catch(() => {})
      if (requestId)
        await this._options.client.cancel(requestId)
      await this._options.tabSources?.clear()
      await this._options.client.close()
    })()
    this.resettingConversation = reset
    this.render()
    try {
      await reset
    }
    finally {
      if (this.resettingConversation === reset)
        this.resettingConversation = undefined
    }
    if (leaveCollection && generation === this.generation)
      await this._options.onConversationOpen?.()
  }

  setAttachment(value: AssistantAttachment) {
    this.attachment = value
    this.render()
  }

  async acceptDraft(input: { draft: string, intent: AssistantIntent }) {
    await this.newConversation()
    this.mode = input.intent === 'translate' ? 'translation' : input.intent === 'summarize' ? 'reading' : 'assistant'
    this.draft = input.draft
    this.draftIntent = input.intent
    this.render()
  }

  async refreshCurrentPage() {
    this.pageInfo = await this._options.pageContext?.currentPage().catch(() => null) ?? null
  }

  private async authorizePage() {
    const info = this.pageInfo
    if (!info)
      throw new Error('请先打开网页，再返回此入口')
    if (!await this._options.permissions.request({ origins: [info.originPattern] }))
      throw new Error('未获得此站点的读取权限')
  }

  private async attachPage(selection: boolean) {
    await this.authorizePage()
    const attachment = selection
      ? await this._options.pageContext!.readSelection()
      : await this._options.pageContext!.captureCurrentPage()
    this.setAttachment(attachment)
    this.message('已附加内容；切换页面不会替换这份来源')
  }

  private renderPageTranslation() {
    if (!this._options.pageContext)
      return
    const panel = uiNode('section', '', 'assistant-page-translation')
    panel.append(uiNode('p', '在段落旁显示译文；网页悬浮菜单中的“网页翻译”可设置此站点自动翻译、动态正文与显示样式。'))
    panel.append(
      this.button('翻译当前网页', 'assistant-translate-page', async () => {
        await this.authorizePage()
        this.translation = await this._options.pageContext!.translatePage(this.language)
        await this.updateTranslation()
      }),
      this.button('停止翻译', 'assistant-stop-translation', async () => {
        await this._options.pageContext!.stopTranslation()
        await this.updateTranslation()
      }),
      this.button('恢复原文', 'assistant-restore-page', async () => {
        await this._options.pageContext!.restorePage()
        clearTimeout(this.translationTimer)
        this.translation = null
        this.message('已恢复原文')
      }),
    )
    this.root.append(panel)
  }

  private async updateTranslation() {
    clearTimeout(this.translationTimer)
    if (this.disposed)
      return
    this.translation = await this._options.pageContext!.translationStatus()
    if (!this.translation) {
      this.message('页面翻译已结束或来源页面已变化')
      return
    }
    const { status, completed, total, error, truncated } = this.translation
    this.message(error ?? `${{ translating: '正在翻译', completed: '翻译完成', cancelled: '翻译已停止', failed: '翻译失败' }[status]} · ${completed}/${total}${truncated ? ' · 已截断' : ''}`)
    if (status === 'translating')
      this.translationTimer = setTimeout(() => { void this.updateTranslation().catch(error => this.message(this.error(error))) }, 300)
  }

  connectionLost() {
    if (this.disposed)
      return
    const answer = this.conversation?.messages.at(-1)
    if (this.requestId && answer?.id === this.requestId && ['preparing', 'streaming'].includes(answer.status))
      answer.status = 'cancelled'
    this.generation++
    clearTimeout(this.timer)
    this.requestId = null
    this.busy = false
    this.attachingTab = undefined
    this.tabSources = this.tabSources.map(source => ({ ...source, disconnected: true }))
    this.feedback = this.tabSources.length ? '助手连接已断开，请移除或重新添加网页来源' : '助手连接已断开，请重试'
    this.render()
  }

  dispose() {
    this.generation++
    this.disposed = true
    clearTimeout(this.timer)
    clearTimeout(this.translationTimer)
    void this._options.pageContext?.restorePage().catch(() => {})
    void this._options.client.close().catch(() => {})
  }
}
