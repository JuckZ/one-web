import type { AssistantStorage } from '~/modules/builtin/assistant/contracts'
import { isRecord } from '~/modules/builtin/assistant/contracts'
import type { InstalledModuleRecord } from '~/modules/types'

export const destinations = ['assistant', 'reading', 'translation', 'writing', 'tools', 'history', 'favorites', 'settings'] as const
export type WorkspaceDestination = typeof destinations[number] | `module:${string}`
export interface WorkspaceSnapshot {
  destination: WorkspaceDestination
  favorites: string[]
  recent: string[]
  modules: InstalledModuleRecord[]
  note: string
}

const STORAGE_KEY = 'oneweb.workspace.v1'

export class WorkspaceController {
  private state: WorkspaceSnapshot = { destination: 'assistant', favorites: [], recent: [], modules: [], note: '' }
  private readonly listeners = new Set<(_state: WorkspaceSnapshot) => void>()
  private writes = Promise.resolve()
  private initialized = false

  constructor(private readonly _options: { storage: AssistantStorage, listModules: () => Promise<InstalledModuleRecord[]> }) {}

  async initialize() {
    const modules = await this._options.listModules()
    if (!this.initialized) {
      const stored = (await this._options.storage.get(STORAGE_KEY))[STORAGE_KEY]
      if (isRecord(stored) && stored.version === 1) {
        if (this.validDestination(stored.destination))
          this.state.destination = stored.destination
        if (Array.isArray(stored.favorites))
          this.state.favorites = stored.favorites.filter((id): id is string => typeof id === 'string').slice(0, 100)
        if (Array.isArray(stored.recent))
          this.state.recent = stored.recent.filter((id): id is string => typeof id === 'string').slice(0, 12)
      }
      this.initialized = true
    }
    this.state.modules = structuredClone(modules)
    if (this.state.destination.startsWith('module:') && !modules.some(record => `module:${record.manifest.id}` === this.state.destination)) {
      this.state.destination = 'assistant'
      this.state.note = '此前的工具已不存在，已返回助手。'
      await this.persist()
    }
    this.emit()
  }

  private validDestination(value: unknown): value is WorkspaceDestination {
    return typeof value === 'string' && (destinations.includes(value as typeof destinations[number])
      || /^module:[\w.-]{1,128}$/.test(value))
  }

  async open(destination: WorkspaceDestination) {
    if (!this.validDestination(destination))
      throw new Error('工作区位置无效')
    if (destination.startsWith('module:')) {
      const id = destination.slice(7)
      if (!this.state.modules.some(record => record.manifest.id === id))
        throw new Error('工具已不存在，请刷新工具列表')
      this.state.recent = [id, ...this.state.recent.filter(previous => previous !== id)].slice(0, 12)
    }
    this.state.destination = destination
    this.state.note = ''
    await this.persist()
    this.emit()
  }

  async favorite(id: string) {
    if (!this.state.modules.some(record => record.manifest.id === id))
      throw new Error('工具已不存在')
    this.state.favorites = this.state.favorites.includes(id)
      ? this.state.favorites.filter(previous => previous !== id)
      : [...this.state.favorites, id]
    await this.persist()
    this.emit()
  }

  snapshot() { return structuredClone(this.state) }

  subscribe(listener: (_state: WorkspaceSnapshot) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private persist() {
    const state = structuredClone({ version: 1, destination: this.state.destination, favorites: this.state.favorites, recent: this.state.recent })
    this.writes = this.writes.catch(() => {}).then(() => this._options.storage.set({ [STORAGE_KEY]: state }))
    return this.writes
  }

  private emit() { for (const listener of this.listeners) listener(this.snapshot()) }
  dispose() { this.listeners.clear() }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}

export class WorkspaceView {
  readonly outlet = element('section', '', 'workspace-outlet')
  private readonly nav = element('nav', '', 'workspace-nav')
  private readonly note = element('p', '', 'workspace-note')
  private unsubscribe: () => void
  private query = ''
  private toolsRenderer?: (_outlet: HTMLElement, _state: WorkspaceSnapshot) => void

  constructor(readonly root: HTMLElement, private readonly _controller: WorkspaceController) {
    this.nav.setAttribute('aria-label', '工作区导航')
    this.note.setAttribute('role', 'status')
    root.classList.add('workspace-layout')
    root.append(this.nav, this.outlet, this.note)
    this.unsubscribe = _controller.subscribe(state => this.render(state))
  }

  async initialize() { await this._controller.initialize() }

  setToolsRenderer(render: (_outlet: HTMLElement, _state: WorkspaceSnapshot) => void) { this.toolsRenderer = render }

  private action(button: HTMLButtonElement, operation: () => Promise<unknown>) {
    button.type = 'button'
    button.addEventListener('click', () => {
      void operation().catch((error) => {
        this.note.textContent = error instanceof Error ? error.message : '操作失败'
      })
    })
    return button
  }

  private render(state: WorkspaceSnapshot) {
    this.nav.replaceChildren()
    const labels = ['助手', '阅读', '翻译', '写作', '工具', '历史', '收藏', '设置']
    const marks = ['✳', '▤', '文', '✎', '▦', '◷', '☆', '⚙']
    destinations.forEach((destination, index) => {
      const button = this.action(element('button', '', 'workspace-nav-button'), () => this._controller.open(destination))
      button.dataset.destination = destination
      button.setAttribute('aria-label', labels[index])
      button.setAttribute('aria-current', state.destination === destination ? 'page' : 'false')
      const icon = element('span', marks[index], 'workspace-nav-icon')
      icon.setAttribute('aria-hidden', 'true')
      button.append(icon, element('span', labels[index], 'workspace-nav-label'))
      this.nav.append(button)
    })
    this.note.textContent = state.note
    this.note.hidden = !state.note
    if (state.destination === 'tools') {
      if (this.toolsRenderer)
        this.toolsRenderer(this.outlet, state)
      else
        this.renderTools(state)
    }
    else if (this.outlet.dataset.surface === 'tools') {
      this.outlet.replaceChildren()
    }
    this.outlet.dataset.surface = state.destination
  }

  private renderTools(state: WorkspaceSnapshot) {
    this.outlet.replaceChildren()
    const header = element('header', '', 'workspace-page-heading')
    header.append(element('span', 'YOUR BROWSER, CONNECTED', 'workspace-eyebrow'), element('h1', '随手可用的工具'), element('p', '管理网页、整理资源，把重复的工作交给 OneWeb。'))
    const search = element('input', '', 'workspace-search')
    search.type = 'search'
    search.placeholder = '搜索工具…'
    search.setAttribute('aria-label', '搜索工具')
    search.value = this.query
    const list = element('div', '', 'workspace-tool-grid')
    const populate = () => {
      list.replaceChildren()
      const records = [...state.modules].sort((a, b) => {
        const rank = (id: string) => state.favorites.includes(id) ? -100 : state.recent.includes(id) ? state.recent.indexOf(id) - 20 : 0
        return rank(a.manifest.id) - rank(b.manifest.id)
      }).filter(record => `${record.manifest.name} ${record.manifest.description}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()))
      for (const record of records) {
        const { id, name, description } = record.manifest
        const card = element('article', '', 'workspace-tool-card')
        const favorite = state.favorites.includes(id)
        const star = this.action(element('button', favorite ? '★' : '☆', 'workspace-tool-star'), () => this._controller.favorite(id))
        star.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'} ${name}`)
        star.setAttribute('aria-pressed', String(favorite))
        const open = this.action(element('button', '', 'workspace-tool-open'), () => this._controller.open(`module:${id}`))
        open.dataset.openModule = id
        open.append(element('span', name.slice(0, 1), 'workspace-tool-mark'), element('h2', name), element('p', description), element('span', record.enabled ? '打开工具 ↗' : '已停用 · 查看并启用', 'workspace-tool-state'))
        card.append(star, open)
        list.append(card)
      }
      if (!records.length)
        list.append(element('p', '没有匹配的工具。'))
    }
    search.addEventListener('input', () => {
      this.query = search.value
      populate()
    })
    populate()
    this.outlet.append(header, search, list)
  }

  dispose() {
    this.unsubscribe()
    this.root.replaceChildren()
  }
}
