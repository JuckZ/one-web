import type { SmartApp, SmartAppInput, SmartAppsStorage } from './model'
import { byteLength, isRecord, MAX_SMART_APPS, MAX_SMART_APPS_BYTES, normalizeSmartAppInput, normalizeStoredApp, SMART_APPS_STORAGE_KEY } from './model'

interface SmartAppsControllerOptions {
  storage: SmartAppsStorage
  now?: () => number
  createId?: () => string
}

/** The background owns one controller; UI contexts never write its storage directly. */
export class SmartAppsController {
  private writes: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly _options: SmartAppsControllerOptions) {
    this.now = _options.now ?? Date.now
    this.createId = _options.createId ?? (() => `app-${crypto.randomUUID()}`)
  }

  private async read(): Promise<SmartApp[]> {
    const value = (await this._options.storage.get(SMART_APPS_STORAGE_KEY))[SMART_APPS_STORAGE_KEY]
    if (value === undefined)
      return []
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.apps) || value.apps.length > MAX_SMART_APPS
      || byteLength(JSON.stringify(value)) > MAX_SMART_APPS_BYTES) {
      throw new Error('本机应用数据无效，请先导出备份或检查存储')
    }
    const apps = value.apps.map(normalizeStoredApp)
    if (new Set(apps.map(app => app.id)).size !== apps.length)
      throw new Error('本机应用标识重复')
    return apps
  }

  private async write(apps: SmartApp[]) {
    const state = { version: 1, apps }
    if (apps.length > MAX_SMART_APPS || byteLength(JSON.stringify(state)) > MAX_SMART_APPS_BYTES)
      throw new Error('本机应用空间已满（最多 50 个、合计 2 MiB），请先导出并删除不用的应用')
    await this._options.storage.set({ [SMART_APPS_STORAGE_KEY]: state })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.catch(() => {}).then(operation)
    this.writes = result
    return result
  }

  async list() {
    await this.writes.catch(() => {})
    return this.read()
  }

  async create(input: SmartAppInput): Promise<SmartApp> {
    const value = normalizeSmartAppInput(input)
    return this.serialize(async () => {
      const apps = await this.read()
      const now = this.now()
      const app = normalizeStoredApp({ ...value, id: this.createId(), createdAt: now, updatedAt: now })
      if (apps.some(previous => previous.id === app.id))
        throw new Error('应用标识重复，请重试')
      await this.write([...apps, app])
      return structuredClone(app)
    })
  }

  async update(id: string, input: SmartAppInput): Promise<SmartApp> {
    const value = normalizeSmartAppInput(input)
    return this.serialize(async () => {
      const apps = await this.read()
      const index = apps.findIndex(app => app.id === id)
      if (index < 0)
        throw new Error('应用已不存在')
      const previous = apps[index]
      if (previous.kind !== value.kind)
        throw new Error('编辑时不能改变应用类型，请新建应用')
      const app = normalizeStoredApp({ ...value, id: previous.id, enabled: input.enabled ?? previous.enabled, createdAt: previous.createdAt, updatedAt: this.now() })
      apps[index] = app
      await this.write(apps)
      return structuredClone(app)
    })
  }

  setEnabled(id: string, enabled: boolean): Promise<SmartApp> {
    if (typeof enabled !== 'boolean')
      return Promise.reject(new Error('启用状态无效'))
    return this.serialize(async () => {
      const apps = await this.read()
      const app = apps.find(candidate => candidate.id === id)
      if (!app)
        throw new Error('应用已不存在')
      app.enabled = enabled
      app.updatedAt = this.now()
      await this.write(apps)
      return structuredClone(app)
    })
  }

  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      const apps = await this.read()
      if (!apps.some(app => app.id === id))
        throw new Error('应用已不存在')
      await this.write(apps.filter(app => app.id !== id))
    })
  }

  async exportApps(ids?: string[]) {
    const apps = await this.list()
    if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')))
      throw new Error('导出应用列表无效')
    return JSON.stringify({ version: 1, apps: ids ? apps.filter(app => ids.includes(app.id)) : apps })
  }

  importApps(json: string): Promise<SmartApp[]> {
    if (typeof json !== 'string' || byteLength(json) > MAX_SMART_APPS_BYTES)
      return Promise.reject(new Error('导入文件超过大小限制'))
    let records: SmartApp[]
    try {
      const value: unknown = JSON.parse(json)
      if (!isRecord(value) || Object.keys(value).some(key => !['version', 'apps'].includes(key))
        || value.version !== 1 || !Array.isArray(value.apps) || value.apps.length > MAX_SMART_APPS) {
        throw new Error('format')
      }
      records = value.apps.map(normalizeStoredApp)
    }
    catch { return Promise.reject(new Error('导入文件格式无效，请选择 OneWeb 应用导出的 JSON 文件')) }
    return this.serialize(async () => {
      const apps = await this.read()
      const now = this.now()
      const imported = records.map(record => normalizeStoredApp({ ...record, id: this.createId(), enabled: false, createdAt: now, updatedAt: now }))
      const all = [...apps, ...imported]
      if (new Set(all.map(app => app.id)).size !== all.length)
        throw new Error('应用标识重复，请重试')
      await this.write(all)
      return structuredClone(imported)
    })
  }
}
