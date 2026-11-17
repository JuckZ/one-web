import type { RepoLensConfiguration, RepoLensResult } from '~/modules/builtin/repolens/contracts'
import { normalizeRepository, REPOLENS_ORIGIN } from '~/modules/builtin/repolens/contracts'
import type { RepoLensClient } from '~/modules/builtin/repolens/protocol'

export interface RepoLensViewOptions {
  client: RepoLensClient
  permissions: { request: (_query: { origins: string[] }) => Promise<boolean> }
  clipboard?: { writeText: (_text: string) => Promise<void> }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const element = document.createElement(tag)
  element.textContent = text
  if (className)
    element.className = className
  return element
}

export class RepoLensView {
  private readonly input = node('input', '', 'workspace-search')
  private readonly status = node('p', '', 'assistant-status')
  private readonly output = node('div')
  private readonly analyzeButton = node('button', '分析项目', 'primary-button')
  private readonly stopButton = node('button', '停止', 'secondary-button')
  private readonly currentButton = node('button', '使用当前仓库', 'secondary-button')
  private currentRepo: string | null = null
  private configuration: RepoLensConfiguration = { keyConfigured: false, remember: false }
  private result: RepoLensResult | null = null
  private disposed = false
  private busy = false
  private generation = 0

  constructor(readonly root: HTMLElement, private readonly _options: RepoLensViewOptions) {
    root.dataset.testid = 'repolens-workspace'
    root.classList.add('assistant-workspace', 'repolens-workspace')
    this.input.dataset.testid = 'repolens-repository'
    this.input.id = `repolens-repository-${crypto.randomUUID()}`
    this.input.name = 'repository'
    this.input.required = true
    this.input.maxLength = 2048
    this.input.placeholder = 'vuejs/core 或 GitHub 仓库链接'
    this.input.autocapitalize = 'none'
    this.input.spellcheck = false
    this.input.autocomplete = 'off'
    this.status.dataset.testid = 'repolens-status'
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    this.analyzeButton.dataset.testid = 'repolens-analyze'
    this.analyzeButton.type = 'submit'
    this.stopButton.type = 'button'
    this.stopButton.hidden = true
    this.currentButton.type = 'button'
    this.currentButton.dataset.testid = 'repolens-current'
    this.currentButton.disabled = true
    this.currentButton.addEventListener('click', () => {
      if (this.currentRepo)
        this.input.value = this.currentRepo
    })
    this.stopButton.addEventListener('click', () => {
      void this.cancel()
    })
  }

  async open() {
    const generation = ++this.generation
    try {
      this.configuration = await this._options.client.configuration()
      if (!this.disposed && generation === this.generation)
        this.render()
    }
    catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.render()
        this.message(error)
      }
    }
  }

  updateContext(repo: string | null) {
    let normalized: string | null = null
    try {
      normalized = repo ? normalizeRepository(repo) : null
    }
    catch { /* Non-repository routes clear the current-page shortcut. */ }
    if (normalized === this.currentRepo)
      return
    const previous = this.currentRepo
    this.currentRepo = normalized
    if (!this.input.value || this.input.value === previous)
      this.input.value = normalized ?? ''
    this.currentButton.disabled = !normalized
    this.currentButton.textContent = normalized ? `使用当前仓库 ${normalized}` : '当前页面不是 GitHub 仓库'
    if (this.busy)
      void this.cancel()
    this.result = null
    this.output.replaceChildren()
    this.status.textContent = normalized ? '已识别当前仓库，点击分析后才会请求 GitHub。' : '输入仓库名称开始分析。'
  }

  private render() {
    const heading = node('header', '', 'workspace-page-heading')
    heading.append(node('span', 'GITHUB INTELLIGENCE', 'workspace-eyebrow'), node('h1', 'RepoLens'), node('p', '在浏览仓库时查看概况、维护活动和相似项目。直接使用 GitHub，无需启动本地服务。'))
    const form = node('form', '', 'repolens-form')
    form.setAttribute('aria-label', 'GitHub 项目分析')
    const label = node('label', 'GitHub 仓库')
    label.htmlFor = this.input.id
    const actions = node('div', '', 'assistant-heading')
    actions.append(this.analyzeButton, this.stopButton, this.currentButton)
    form.append(label, this.input, actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!this.busy)
        void this.analyze()
    })
    const note = node('p', '仅分析公开仓库；结果保存在本机。无 Token 可用，但 GitHub 的匿名额度较低。', 'workspace-note')
    this.root.replaceChildren(heading, form, note, this.status, this.output, this.settings())
  }

  private settings() {
    const details = node('details', '', 'repolens-settings')
    details.append(node('summary', 'GitHub 连接与本机数据'))
    const form = node('form')
    form.setAttribute('aria-label', 'RepoLens 连接设置')
    const token = node('input', '', 'workspace-search')
    token.id = `repolens-token-${crypto.randomUUID()}`
    token.name = 'token'
    token.type = 'password'
    token.autocomplete = 'new-password'
    token.maxLength = 4096
    const label = node('label', 'GitHub Token（可选）')
    label.htmlFor = token.id
    const state = node('p', this.configuration.keyConfigured ? '已配置 Token；填写新值可替换，留空保存可移除。' : '未配置 Token，使用 GitHub 匿名额度。')
    const remember = node('input')
    remember.type = 'checkbox'
    remember.name = 'remember'
    remember.checked = this.configuration.remember
    const rememberLabel = node('label', '记住 Token（存于此设备）')
    rememberLabel.prepend(remember)
    const save = node('button', '保存连接设置', 'secondary-button')
    save.type = 'submit'
    form.append(label, token, state, rememberLabel, save)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const generation = ++this.generation
      save.disabled = true
      void this._options.client.configure({ token: token.value, remember: remember.checked }).then((configuration) => {
        if (this.disposed || generation !== this.generation)
          return
        this.configuration = configuration
        token.value = ''
        this.busy = false
        this.analyzeButton.disabled = false
        this.stopButton.hidden = true
        state.textContent = configuration.keyConfigured ? '已配置 Token；填写新值可替换，留空保存可移除。' : '未配置 Token，使用 GitHub 匿名额度。'
        this.status.textContent = '连接设置已保存；尚未发出网络请求。'
      }).catch(error => this.message(error)).finally(() => { save.disabled = false })
    })
    const clear = node('button', '清空分析缓存与 Star 快照', 'secondary-button')
    clear.type = 'button'
    clear.addEventListener('click', () => {
      ++this.generation
      void this._options.client.clear().then(() => {
        if (this.disposed)
          return
        this.busy = false
        this.analyzeButton.disabled = false
        this.stopButton.hidden = true
        this.result = null
        this.output.replaceChildren()
        this.status.textContent = '已清空 RepoLens 本机分析数据。'
      }).catch(error => this.message(error))
    })
    details.append(form, node('p', 'Token 只发送给 GitHub API，不进入应用报告、页面上下文或其他模块。默认只在本次浏览器会话保留。'), clear)
    return details
  }

  private message(error: unknown) {
    if (!this.disposed)
      this.status.textContent = error instanceof Error ? error.message : '操作失败，请重试'
  }

  private async analyze() {
    let repo: string
    try {
      repo = normalizeRepository(this.input.value)
    }
    catch (error) {
      this.input.setCustomValidity(error instanceof Error ? error.message : '仓库名称无效')
      this.input.reportValidity()
      this.input.addEventListener('input', () => this.input.setCustomValidity(''), { once: true })
      return
    }
    // Request in the direct click/submit turn, before awaiting another browser operation.
    const permission = this._options.permissions.request({ origins: [REPOLENS_ORIGIN] })
    const generation = ++this.generation
    this.busy = true
    this.analyzeButton.disabled = true
    this.stopButton.hidden = false
    this.result = null
    this.output.replaceChildren()
    this.status.textContent = '正在读取公开仓库并搜索相似项目…'
    try {
      if (!await permission)
        throw new Error('未授予 GitHub API 权限，可重新点击分析以授权')
      if (this.disposed || generation !== this.generation)
        return
      const result = await this._options.client.analyze(repo)
      if (this.disposed || generation !== this.generation)
        return
      this.result = result
      this.renderResult(result)
      this.status.textContent = `${result.cached ? '已读取本机缓存' : '分析完成'}${result.warnings.length ? '，部分来源暂不可用' : ''}。`
    }
    catch (error) {
      if (!this.disposed && generation === this.generation)
        this.message(error)
    }
    finally {
      if (!this.disposed && generation === this.generation) {
        this.busy = false
        this.analyzeButton.disabled = false
        this.stopButton.hidden = true
      }
    }
  }

  private renderResult(result: RepoLensResult) {
    const article = node('article', '', 'workspace-tool-card repolens-result')
    article.dataset.testid = 'repolens-result'
    const repo = result.repository
    const source = node('a', repo.fullName)
    source.href = `https://github.com/${repo.fullName}`
    source.target = '_blank'
    source.rel = 'noopener noreferrer'
    const title = node('h2')
    title.append(source)
    article.append(title, node('p', repo.description), node('p', `${repo.stars.toLocaleString()} Stars · ${repo.forks.toLocaleString()} Forks · ${repo.language ?? '语言未知'} · ${repo.license ?? '许可证未知'}`))
    article.append(node('p', `维护活跃 ${Math.round(result.health.maintenance * 100)} / 100 · 社区采用 ${Math.round(result.health.adoption * 100)} / 100`), node('small', '评分用于快速筛选，不代表安全审计或项目适配性结论。'))
    if (result.latestRelease)
      article.append(node('p', `最近发布：${result.latestRelease.name}${result.latestRelease.publishedAt ? ` · ${result.latestRelease.publishedAt.slice(0, 10)}` : ''}`))
    if (result.activity) {
      const metrics = result.activity
      article.append(node('p', `近 90 天：新增 Issue ${metrics.issuesCreated}、关闭 ${metrics.issuesClosed}；新增 PR ${metrics.pullsCreated}、合并 ${metrics.pullsMerged}。`))
    }
    article.append(node('h3', '相似开源项目'))
    const list = node('ol', '', 'repolens-similar')
    for (const item of result.similar) {
      const row = node('li')
      const link = node('a', item.repository.fullName)
      link.href = `https://github.com/${item.repository.fullName}`
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      row.append(link, node('p', `相似度 ${Math.round(item.score * 100)} / 100 · ${item.reasons.join('、') || '综合排序'}`), node('p', item.repository.description))
      list.append(row)
    }
    article.append(list)
    if (!result.similar.length)
      article.append(node('p', '本次没有获取到相似候选；可稍后重试，或配置 Token 增加可用额度。'))
    article.append(node('h3', '本机 Star 快照'))
    article.append(node('p', result.snapshots.map(item => `${item.day}：${item.stars}`).join(' · ')))
    article.append(node('small', '只在分析时记录，最多保留最近 90 次日期快照；不会补造历史。'))
    if (result.warnings.length) {
      const warnings = node('ul')
      result.warnings.forEach(warning => warnings.append(node('li', warning)))
      article.append(node('h3', '数据缺失'), warnings)
    }
    article.append(node('p', `数据来源：GitHub API · ${new Date(result.fetchedAt).toLocaleString()} · 本机 TF-IDF 排序`))
    const copy = node('button', '复制 Markdown 报告', 'secondary-button')
    copy.type = 'button'
    copy.addEventListener('click', () => {
      if (!this.result)
        return
      void (this._options.clipboard ?? navigator.clipboard).writeText(this.result.report).then(() => {
        if (!this.disposed)
          this.status.textContent = '报告已复制。'
      }).catch(error => this.message(error))
    })
    const download = node('button', '下载报告', 'secondary-button')
    download.type = 'button'
    download.addEventListener('click', () => {
      if (!this.result)
        return
      const url = URL.createObjectURL(new Blob([this.result.report], { type: 'text/markdown;charset=utf-8' }))
      const link = node('a')
      link.href = url
      link.download = `${repo.fullName.replace('/', '-')}-repolens.md`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
    article.append(copy, download)
    this.output.replaceChildren(article)
  }

  private async cancel() {
    ++this.generation
    this.busy = false
    this.analyzeButton.disabled = false
    this.stopButton.hidden = true
    this.status.textContent = '分析已停止。'
    try {
      await this._options.client.cancel()
    }
    catch (error) { this.message(error) }
  }

  dispose() {
    this.disposed = true
    ++this.generation
    void this._options.client.cancel().catch(() => {})
    this.root.replaceChildren()
  }
}
