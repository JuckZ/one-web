import { QueryClient } from '@tanstack/react-query'
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
  readonly queries = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } })
  private state: WorkspaceSnapshot = { destination: 'assistant', favorites: [], recent: [], modules: [], note: '' }
  private readonly listeners = new Set<(_state: WorkspaceSnapshot) => void>()
  private writes = Promise.resolve()
  private initialized = false
  private refreshes = Promise.resolve()
  private disposed = false

  constructor(private readonly _options: { storage: AssistantStorage, listModules: () => Promise<InstalledModuleRecord[]> }) {}

  initialize() {
    // A registry event during a read must perform a subsequent fresh query.
    this.refreshes = this.refreshes.catch(() => {}).then(() => this.refreshModules()).catch((error) => {
      if (!this.disposed)
        throw error
    })
    return this.refreshes
  }

  private async refreshModules() {
    if (this.disposed)
      return
    const modules = await this.queries.fetchQuery({ queryKey: ['workspace', 'modules'], queryFn: this._options.listModules, staleTime: 0 })
    if (this.disposed)
      return
    if (!this.initialized) {
      const stored = (await this._options.storage.get(STORAGE_KEY))[STORAGE_KEY]
      if (this.disposed)
        return
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
  dispose() {
    this.disposed = true
    this.listeners.clear()
    this.queries.clear()
  }
}

export { WorkspaceView } from './workspace-view'
