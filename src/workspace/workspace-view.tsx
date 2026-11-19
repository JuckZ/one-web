import { QueryClientProvider } from '@tanstack/react-query'
import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { destinations, type WorkspaceController, type WorkspaceDestination, type WorkspaceSnapshot } from './workspace'

const labels = ['助手', '阅读', '翻译', '写作', '工具', '历史', '收藏', '设置']
const marks = ['✳', '▤', '文', '✎', '▦', '◷', '☆', '⚙']

function Navigation({ view }: { view: WorkspaceView }) {
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot)
  return (
    <>
      {destinations.map((destination, index) => (
        <button
          key={destination}
          type="button"
          className="workspace-nav-button"
          data-destination={destination}
          aria-label={labels[index]}
          aria-current={state.destination === destination ? 'page' : 'false'}
          onClick={() => { void view.navigate(destination) }}
        >
          <span className="workspace-nav-icon" aria-hidden="true">{marks[index]}</span>
          <span className="workspace-nav-label">{labels[index]}</span>
        </button>
      ))}
    </>
  )
}

// Keep one stable outlet for the existing module views. React owns navigation;
// the host alone owns privileged view mount/dispose and remote iframe sessions.
export class WorkspaceView {
  readonly outlet = document.createElement('section')
  private readonly nav = document.createElement('nav')
  private readonly note = document.createElement('p')
  private readonly reactRoot
  private readonly history = createHashHistory()
  private readonly router
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe
  private readonly unsubscribeRoute
  private state: WorkspaceSnapshot
  private ready = false
  private disposed = false
  private routeEpoch = 0
  private toolsRenderer?: (_outlet: HTMLElement, _state: WorkspaceSnapshot) => void

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getSnapshot = () => this.state

  constructor(readonly root: HTMLElement, private readonly _controller: WorkspaceController) {
    this.state = _controller.snapshot()
    root.classList.add('workspace-layout')
    this.nav.className = 'workspace-nav'
    this.nav.setAttribute('aria-label', '工作区导航')
    this.outlet.className = 'workspace-outlet'
    this.note.className = 'workspace-note'
    this.note.setAttribute('role', 'status')
    this.note.hidden = true
    root.append(this.nav, this.outlet, this.note)
    const route = createRootRoute({ component: () => <Navigation view={this} /> })
    this.router = createRouter({
      routeTree: route.addChildren([
        createRoute({ getParentRoute: () => route, path: '/' }),
        createRoute({ getParentRoute: () => route, path: '/$destination' }),
      ]),
      history: this.history,
      defaultPendingMs: 0,
    })
    this.unsubscribeRoute = this.router.subscribe('onResolved', () => {
      if (this.ready)
        void this.acceptRoute()
    })
    this.reactRoot = createRoot(this.nav)
    flushSync(() => this.reactRoot.render(
      <QueryClientProvider client={_controller.queries}><RouterProvider router={this.router} /></QueryClientProvider>,
    ))
    this.unsubscribe = _controller.subscribe((state) => {
      if (this.disposed)
        return
      this.state = state
      for (const listener of this.listeners)
        listener()
      this.render(state)
      if (this.ready && this.routeDestination() !== state.destination)
        void this.navigate(state.destination)
    })
  }

  async initialize() {
    await this._controller.initialize()
    await this.router.load()
    if (this.disposed)
      return
    this.ready = true
    if (this.history.location.pathname === '/')
      await this.navigate(this.state.destination, true)
    else
      await this.acceptRoute()
  }

  private routeDestination(): string {
    try {
      return decodeURIComponent(this.history.location.pathname.slice(1))
    }
    catch { return '' }
  }

  private async acceptRoute() {
    const epoch = ++this.routeEpoch
    const destination = this.routeDestination()
    if (destination === this.state.destination)
      return
    try {
      await this._controller.open(destination as WorkspaceDestination)
    }
    catch (error) {
      if (this.disposed || epoch !== this.routeEpoch)
        return
      this.note.textContent = error instanceof Error ? error.message : '工作区位置无效'
      this.note.hidden = false
      await this.navigate(this.state.destination, true)
    }
  }

  navigate(destination: WorkspaceDestination, replace = false) {
    return this.router.navigate({ to: '/$destination', params: { destination }, replace })
  }

  setToolsRenderer(render: (_outlet: HTMLElement, _state: WorkspaceSnapshot) => void) { this.toolsRenderer = render }

  private render(state: WorkspaceSnapshot) {
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
    const header = document.createElement('header')
    header.className = 'workspace-page-heading'
    const title = document.createElement('h1')
    title.textContent = '随手可用的工具'
    header.append(title)
    const search = document.createElement('input')
    search.className = 'workspace-search'
    search.type = 'search'
    search.placeholder = '搜索工具…'
    search.setAttribute('aria-label', '搜索工具')
    const list = document.createElement('div')
    list.className = 'workspace-tool-grid'
    const populate = () => {
      list.replaceChildren()
      const rank = (id: string) => state.favorites.includes(id) ? -100 : state.recent.includes(id) ? state.recent.indexOf(id) - 20 : 0
      for (const record of [...state.modules].sort((a, b) => rank(a.manifest.id) - rank(b.manifest.id))) {
        const { id, name, description } = record.manifest
        if (!`${name} ${description}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))
          continue
        const card = document.createElement('article')
        card.className = 'workspace-tool-card'
        const favorite = state.favorites.includes(id)
        const star = document.createElement('button')
        star.type = 'button'
        star.className = 'workspace-tool-star'
        star.textContent = favorite ? '★' : '☆'
        star.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'} ${name}`)
        star.setAttribute('aria-pressed', String(favorite))
        star.onclick = () => {
          void this._controller.favorite(id).catch(error => this.showError(error))
        }
        const open = document.createElement('button')
        open.type = 'button'
        open.className = 'workspace-tool-open'
        open.dataset.openModule = id
        const heading = document.createElement('h2')
        heading.textContent = name
        const summary = document.createElement('p')
        summary.textContent = description
        open.append(heading, summary)
        open.onclick = () => {
          void this.navigate(`module:${id}`)
        }
        card.append(star, open)
        list.append(card)
      }
      if (!list.children.length)
        list.textContent = '没有匹配的工具。'
    }
    search.oninput = populate
    populate()
    this.outlet.append(header, search, list)
  }

  private showError(error: unknown) {
    this.note.textContent = error instanceof Error ? error.message : '操作失败'
    this.note.hidden = false
  }

  dispose() {
    this.disposed = true
    this.ready = false
    this.unsubscribe()
    this.unsubscribeRoute()
    this.reactRoot.unmount()
    this.history.destroy()
    this.listeners.clear()
    this.root.replaceChildren()
  }
}
