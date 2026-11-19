import { MiniAppRunner } from '~/apps/mini-app-runner'
import { byteLength, matchesApp, renderWebToolPrompt, type SmartApp } from '~/apps/model'
/* eslint no-template-curly-in-string: off -- User-authored prompt variables are literal text. */
import type { SmartAppsClient } from '~/apps/protocol'
import type { AssistantClient } from '~/modules/builtin/assistant/protocol'
import type { InstalledModuleRecord } from '~/modules/types'
import type { PageContextClient } from '~/workspace/page-context'
import { uiNode as node } from './assistant-view'
import { mountSmartAppsList, type SmartAppsFilter, type SmartAppsSort } from './smart-apps-list'

export interface SmartAppsViewOptions {
  client: SmartAppsClient
  assistant: AssistantClient
  page: PageContextClient
  permissions: { request: (_query: { origins: string[] }) => Promise<boolean> }
  sandboxUrl: string
  openModule: (_id: string) => Promise<unknown>
  setModuleEnabled: (_id: string, _enabled: boolean) => Promise<unknown>
  settings: () => Promise<unknown>
  copy?: (_text: string) => Promise<void>
}

export class SmartAppsView {
  private apps: SmartApp[] = []
  private modules: InstalledModuleRecord[] = []
  private query = ''
  private filter: SmartAppsFilter = 'all'
  private sort: SmartAppsSort = 'default'
  private listView: ReturnType<typeof mountSmartAppsList> | null = null
  private status = node('p', '', 'smart-apps-status')
  private dialog: HTMLDialogElement | null = null
  private runner = new MiniAppRunner()
  private generation = 0
  private requestId: string | null = null
  private activeApp: string | null = null
  private activeKind: SmartApp['kind'] | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private pollingResolve: (() => void) | undefined
  private mounted = false
  private runningPage = ''
  private starting = false
  private loadEpoch = 0

  constructor(readonly root: HTMLElement, private readonly _options: SmartAppsViewOptions) {
    root.classList.add('smart-apps')
    root.dataset.testid = 'smart-apps'
    this.status.setAttribute('role', 'status')
  }

  async open(modules: InstalledModuleRecord[]) {
    this.mounted = true
    const loadEpoch = ++this.loadEpoch
    if (this.activeApp || this.requestId || this.starting)
      await this.stop()
    if (!this.mounted || loadEpoch !== this.loadEpoch)
      return
    const generation = this.generation
    this.modules = modules
    const apps = await this._options.client.list()
    if (!this.mounted || generation !== this.generation || loadEpoch !== this.loadEpoch)
      return
    this.apps = apps
    this.render()
  }

  // Registry refreshes update list data without reopening a running tool or dialog.
  updateModules(modules: InstalledModuleRecord[]) {
    this.modules = modules
    if (this.mounted)
      this.populateList()
  }

  private button(label: string, action: () => unknown, className = 'secondary-button') {
    const button = node('button', label, className)
    button.type = 'button'
    button.addEventListener('click', () => {
      try {
        void Promise.resolve(action()).catch(error => this.message(error))
      }
      catch (error) { this.message(error) }
    })
    return button
  }

  private message(value: unknown) {
    if (!this.mounted)
      return
    this.status.textContent = value instanceof Error ? value.message : String(value)
  }

  private async reload() {
    const generation = this.generation
    const apps = await this._options.client.list()
    if (!this.mounted || generation !== this.generation)
      return
    this.apps = apps
    // A mutation may finish after the user has launched an app. Refresh the
    // library data without replacing that app's runner or in-flight output.
    if (!this.activeApp)
      this.render()
  }

  async libraryChanged() {
    if (!this.mounted)
      return
    const generation = this.generation
    const apps = await this._options.client.list()
    if (!this.mounted || generation !== this.generation)
      return
    this.apps = apps
    if (this.activeApp && !this.apps.some(app => app.id === this.activeApp && app.enabled)) {
      await this.stop()
      this.message('应用已停用或删除')
      this.render()
    }
    else if (!this.activeApp && !this.dialog?.open) {
      this.render()
    }
  }

  private listProps() {
    return {
      apps: this.apps,
      modules: this.modules,
      query: this.query,
      filter: this.filter,
      sort: this.sort,
      openApp: (id: string) => this.launch(id),
      openModule: (id: string) => this._options.openModule(id),
      toggleApp: async (id: string, enabled: boolean) => {
        await this._options.client.setEnabled(id, enabled)
        await this.reload()
      },
      toggleModule: async (id: string, enabled: boolean) => {
        await this._options.setModuleEnabled(id, enabled)
        const record = this.modules.find(item => item.manifest.id === id)
        if (record) {
          record.enabled = enabled
          this.modules = [...this.modules]
        }
        this.populateList()
      },
      editApp: (app: SmartApp) => this.createDialog(app),
      removeApp: (app: SmartApp) => this.confirmRemove(app),
      onError: (error: unknown) => this.message(error),
    }
  }

  private populateList() {
    this.listView?.update(this.listProps())
  }

  private unmountList() {
    this.listView?.dispose()
    this.listView = null
  }

  private render() {
    if (!this.mounted)
      return
    if (this.listView) {
      this.populateList()
      return
    }
    this.activeApp = null
    this.activeKind = null
    this.root.replaceChildren()
    const heading = node('header', '', 'smart-apps-heading')
    const title = node('div')
    title.append(node('span', 'MAKE THE WEB YOURS', 'workspace-eyebrow'), node('h1', '应用与工具'), node('p', '把常用提示词变成网页工具，把想法变成随手可用的小应用。'))
    const create = this.button('＋ 新建智能工具', () => this.createDialog(), 'primary-button')
    create.dataset.testid = 'smart-app-create'
    heading.append(title, create)
    const toolbar = node('div', '', 'smart-apps-toolbar')
    const search = node('input')
    search.type = 'search'
    search.placeholder = '搜索工具…'
    search.setAttribute('aria-label', '搜索工具')
    search.value = this.query
    const filters = node('div', '', 'smart-apps-filters')
    const list = node('div')
    const populate = () => {
      for (const button of filters.querySelectorAll('button'))
        button.setAttribute('aria-pressed', String(button.dataset.filter === this.filter))
      this.populateList()
    }
    for (const [value, label] of [['all', '全部'], ['web-tool', '网页工具'], ['mini-app', '小应用']] as const) {
      const button = this.button(label, () => {
        this.filter = value
        populate()
      })
      button.dataset.filter = value
      filters.append(button)
    }
    search.addEventListener('input', () => {
      this.query = search.value
      populate()
    })
    const sort = node('select')
    sort.setAttribute('aria-label', '工具排序')
    for (const [value, label] of [['default', '原有顺序'], ['name-asc', '名称 A–Z'], ['name-desc', '名称 Z–A']] as const) {
      const option = node('option', label)
      option.value = value
      sort.append(option)
    }
    sort.value = this.sort
    sort.addEventListener('change', () => {
      this.sort = sort.value as SmartAppsSort
      populate()
    })
    toolbar.append(search, filters, sort)
    const footer = node('div', '', 'smart-apps-footer')
    const file = node('input')
    file.type = 'file'
    file.accept = '.json,application/json'
    file.hidden = true
    file.setAttribute('aria-label', '导入应用文件')
    file.addEventListener('change', () => {
      const selected = file.files?.[0]
      if (!selected)
        return
      if (selected.size > 2 * 1024 * 1024) {
        this.message('导入文件不能超过 2 MiB')
        return
      }
      void selected.text().then(async (json) => {
        const imported = await this._options.client.importApps(json)
        await this.reload()
        this.message(`已导入 ${imported.length} 个应用，请检查后启用`)
      }).catch(error => this.message(error))
    })
    footer.append(this.button('导入应用', () => file.click()), this.button('导出应用', async () => {
      const json = await this._options.client.exportApps()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = node('a')
      link.href = url
      link.download = 'oneweb-apps.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }), this.button('模块管理与权限', () => this._options.settings()), file)
    populate()
    this.root.append(heading, toolbar, this.status, list, footer)
    this.listView = mountSmartAppsList(list, this.listProps())
  }

  private showDialog(label: string) {
    this.dialog?.remove()
    const dialog = node('dialog', '', 'smart-app-dialog')
    dialog.setAttribute('aria-label', label)
    const top = node('header', '', 'smart-app-dialog-heading')
    const close = this.button('关闭', () => dialog.close())
    top.append(node('h2', label), close)
    dialog.append(top)
    dialog.addEventListener('close', () => {
      if (this.dialog === dialog) {
        this.dialog = null
        void this.stop()
      }
      dialog.remove()
    }, { once: true })
    this.root.append(dialog)
    this.dialog = dialog
    dialog.showModal()
    return dialog
  }

  private confirmRemove(app: SmartApp) {
    const dialog = this.showDialog('删除应用')
    dialog.append(node('p', `删除「${app.name}」？此操作只删除该应用定义，不会删除助手历史。`))
    const cancel = this.button('保留应用', () => dialog.close())
    cancel.autofocus = true
    dialog.append(cancel, this.button('确认删除', async () => {
      await this._options.client.remove(app.id)
      dialog.close()
      await this.reload()
    }))
  }

  private createDialog(existing?: SmartApp) {
    const dialog = this.showDialog(existing ? '编辑智能工具' : '新建智能工具')
    const body = node('div')
    let form: (_kind: SmartApp['kind']) => void
    const choose = () => {
      void this.stop()
      body.replaceChildren(node('p', '你想创建什么类型的智能工具？'))
      const cards = node('div', '', 'smart-app-type-grid')
      const web = this.button('', () => form('web-tool'), 'smart-app-type-card')
      web.append(node('span', '▤', 'smart-app-type-icon'), node('h3', '网页标准工具'), node('p', '让 AI 基于网页中的内容生成回答'), node('small', '适合总结、解释、提取信息和自定义阅读任务'))
      const mini = this.button('', () => form('mini-app'), 'smart-app-type-card')
      mini.append(node('span', '▣', 'smart-app-type-icon'), node('h3', '小应用'), node('p', '让 AI 为你创建交互式网页应用'), node('small', '适合计算器、清单和交互练习；也支持导入 HTML'))
      cards.append(web, mini)
      body.append(cards)
    }
    form = (kind: SmartApp['kind']) => {
      void this.stop()
      body.replaceChildren()
      const fields = node('form', '', 'smart-app-form')
      const field = (label: string, value: string, multiline = false) => {
        const input = multiline ? node('textarea') : node('input')
        const wrapper = node('label', label)
        input.value = value
        input.setAttribute('aria-label', label)
        wrapper.append(input)
        fields.append(wrapper)
        return input
      }
      const name = field('工具名称', existing?.name ?? '')
      name.required = true
      name.maxLength = 80
      name.autofocus = true
      const description = field('描述', existing?.description ?? '')
      const matches = field('适用网址（每行一个）', existing?.matches.join('\n') ?? 'https://*/*\nhttp://*/*', true)
      const content = field(kind === 'web-tool' ? '提示词' : '应用 HTML', existing ? (existing.kind === 'web-tool' ? existing.prompt : existing.html) : kind === 'web-tool' ? '请总结这篇网页，列出主要观点与行动建议。\n\n${text}' : '', true)
      content.required = true
      content.classList.add('smart-app-code')
      fields.append(node('p', kind === 'web-tool' ? '支持 ${text}、${title}、${url}。仅在你点击运行后，将当前页或选文发送给已配置的模型。' : '小应用在隔离环境中运行，不能读取网页、访问网络或浏览器权限。本次交互数据随关闭清空。', 'smart-app-help'))
      const feedback = node('p')
      feedback.setAttribute('role', 'status')
      if (kind === 'mini-app') {
        const idea = field('描述你想创建的应用', '')
        const generate = this.button('用 AI 生成', async () => {
          if (!idea.value.trim())
            throw new Error('请先描述要创建的应用')
          const generation = this.generation
          generate.disabled = true
          feedback.textContent = '正在生成，可随时关闭以取消…'
          try {
            const html = await this.askModel(`Create a complete self-contained interactive HTML application for this user request: ${idea.value}\nReturn only HTML, no explanation. Inline CSS and JavaScript are allowed. No external libraries, fetch, images, links, browser APIs, forms submitting, persistent storage or navigation. Use responsive Chinese interface with accessible labels. All data stays in memory.`)
            if (generation !== this.generation || !dialog.open)
              return
            content.value = html.replace(/^\s*```(?:html)?\s*/i, '').replace(/\n?```\s*$/, '').trim()
            feedback.textContent = '已生成。请预览并检查后保存。'
          }
          catch (error) {
            if (generation === this.generation && dialog.open)
              feedback.textContent = error instanceof Error ? error.message : '生成失败，请重试'
          }
          finally { generate.disabled = false }
        })
        fields.append(generate, this.button('预览小应用', async () => {
          const preview = node('section', '', 'smart-app-preview-container')
          body.querySelector('.smart-app-preview-container')?.remove()
          body.append(preview)
          await this.runner.mount(preview, { html: content.value, sandboxUrl: this._options.sandboxUrl, title: name.value || '小应用预览' })
        }))
      }
      const save = node('button', '保存工具', 'primary-button')
      save.type = 'submit'
      fields.addEventListener('submit', (event) => {
        event.preventDefault()
        save.disabled = true
        const common = { kind, name: name.value, description: description.value, matches: matches.value.split('\n').map(value => value.trim()).filter(Boolean), enabled: existing?.enabled ?? true }
        const input = kind === 'web-tool' ? { ...common, kind, prompt: content.value } : { ...common, kind, html: content.value }
        void (existing ? this._options.client.update(existing.id, input) : this._options.client.create(input)).then(async () => {
          dialog.close()
          await this.reload()
          this.message('工具已保存')
        }).catch((error) => {
          feedback.textContent = error instanceof Error ? error.message : '保存失败'
          save.disabled = false
        })
      })
      fields.append(feedback, save)
      if (!existing)
        fields.append(this.button('重新选择类型', choose))
      body.append(fields)
    }
    dialog.append(body)
    if (existing)
      form(existing.kind)
    else
      choose()
  }

  private async askModel(text: string, attachmentToken?: string, onText?: (_text: string) => void) {
    if (byteLength(text) > 65536)
      throw new Error('工具展开后的输入超过 64 KiB，请缩短提示词或改用选文')
    const generation = this.generation
    const configuration = await this._options.assistant.readConfiguration()
    if (!this.mounted || generation !== this.generation)
      throw new Error('操作已取消')
    if (!configuration?.keyConfigured || !configuration.models.length)
      throw new Error('请先在设置中配置模型服务，再运行或生成智能工具')
    const request = await this._options.assistant.start({ text, modelId: configuration.models[0], intent: 'chat', attachmentToken })
    if (generation !== this.generation) {
      await this._options.assistant.cancel(request.requestId)
      throw new Error('操作已取消')
    }
    this.requestId = request.requestId
    const deadline = Date.now() + 180000
    try {
      while (generation === this.generation && Date.now() < deadline) {
        const conversation = await this._options.assistant.openConversation(request.conversationId)
        if (generation !== this.generation)
          throw new Error('操作已取消')
        const message = conversation.messages.filter(item => item.role === 'assistant').at(-1)
        onText?.(message?.text ?? '')
        if (message?.status === 'completed')
          return message.text
        if (message?.status === 'failed' || message?.status === 'cancelled')
          throw new Error(message.error ?? '生成已停止')
        await new Promise<void>((resolve) => {
          this.pollingResolve = resolve
          this.timer = setTimeout(resolve, 250)
        })
      }
      await this._options.assistant.cancel(request.requestId)
      throw new Error('操作已取消或超时，请重试')
    }
    finally {
      if (this.requestId === request.requestId)
        this.requestId = null
    }
  }

  private async launch(id: string) {
    const before = this.generation
    const app = (await this._options.client.list()).find(item => item.id === id)
    if (!this.mounted || before !== this.generation)
      return
    if (!app?.enabled)
      throw new Error('请先启用此应用')
    await this.stop()
    if (!this.mounted)
      return
    this.activeApp = app.id
    this.activeKind = app.kind
    const generation = this.generation
    this.unmountList()
    this.root.replaceChildren()
    // Internal app navigation shares the library's scroll container. Start a newly opened
    // app at its heading rather than retaining the long management list's scroll position.
    if (this.root.parentElement)
      this.root.parentElement.scrollTop = 0
    const header = node('header', '', 'smart-apps-heading')
    header.append(node('h1', app.name), this.button('返回应用列表', async () => {
      await this.stop()
      this.activeApp = null
      this.activeKind = null
      await this.reload()
    }))
    this.root.append(header, this.status)
    this.message(app.kind === 'mini-app' ? '隔离运行 · 无网络与浏览器权限' : '选择网页或选文后运行，结果可复制使用')
    if (app.kind === 'mini-app') {
      const container = node('section', '', 'smart-app-preview-container')
      this.root.append(container)
      await this.runner.mount(container, { html: app.html, sandboxUrl: this._options.sandboxUrl, title: app.name })
      return
    }
    const output = node('pre', '', 'smart-app-answer')
    output.setAttribute('aria-label', '工具结果')
    const actions = node('div', '', 'smart-apps-toolbar')
    const run = async (selection: boolean) => {
      if (this.requestId || this.starting)
        return
      this.starting = true
      const runGeneration = this.generation
      try {
        const page = await this._options.page.currentPage()
        if (!matchesApp(app, page.url))
          throw new Error('此工具不适用于当前网址，请修改适用网址或切换页面')
        const capture = selection ? await this._options.page.readSelection() : await this._options.page.captureCurrentPage()
        if (runGeneration !== this.generation)
          return
        this.runningPage = page.url
        this.message(`正在分析「${capture.title}」${capture.truncated ? '（正文已截断）' : ''}…`)
        const text = renderWebToolPrompt(app, { text: capture.text, title: capture.title, url: capture.url })
        const result = await this.askModel(text, capture.token, (partial) => {
          output.textContent = partial
        })
        if (runGeneration === this.generation) {
          output.textContent = result
          this.message('已完成')
        }
      }
      catch (error) {
        if (runGeneration === this.generation)
          this.message(error)
      }
      finally {
        if (runGeneration === this.generation)
          this.starting = false
      }
    }
    // Permission is requested directly by a user click, before any await.
    const page = await this._options.page.currentPage().catch(() => null)
    if (generation !== this.generation)
      return
    if (page)
      actions.append(this.button('授权当前站点', () => this._options.permissions.request({ origins: [page.originPattern] })))
    this.runningPage = page?.url ?? ''
    actions.append(this.button('运行当前网页', () => run(false), 'primary-button'), this.button('运行选文', () => run(true)), this.button('停止', () => this.stop()), this.button('复制结果', () => (this._options.copy ?? (text => navigator.clipboard.writeText(text)))(output.textContent ?? '')))
    this.root.append(actions, output)
  }

  async pageChanged() {
    if (this.activeKind === 'web-tool') {
      const generation = this.generation
      const page = await this._options.page.currentPage().catch(() => null)
      if (!this.mounted || generation !== this.generation || this.activeKind !== 'web-tool')
        return
      if (page?.url === this.runningPage)
        return
      await this.stop()
      if (!this.mounted)
        return
      this.render()
      this.message('页面已变化，请重新打开工具并运行')
    }
  }

  private async stop() {
    this.generation++
    this.starting = false
    clearTimeout(this.timer)
    this.pollingResolve?.()
    this.pollingResolve = undefined
    this.runner.dispose()
    const request = this.requestId
    this.requestId = null
    if (request)
      await this._options.assistant.cancel(request).catch(() => {})
  }

  dispose() {
    this.loadEpoch++
    this.mounted = false
    this.dialog?.close()
    this.dialog?.remove()
    this.dialog = null
    void this.stop()
    this.unmountList()
    this.root.replaceChildren()
  }
}
