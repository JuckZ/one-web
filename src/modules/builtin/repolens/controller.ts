import type { RepoLensConfiguration, RepoLensResult, RepoLensSnapshot, RepoLensStorage, Repository } from './contracts'
import { buildQueries, health, markdownReport, rankCandidates } from './analysis'
import { bytes, isRecord, normalizeRepository, projectRepository, REPOLENS_ORIGIN, REPOLENS_SECRET_KEY, REPOLENS_STORAGE_KEY } from './contracts'

interface StoredState {
  version: 1
  credentialId: string
  remember: boolean
  cache: RepoLensResult[]
  snapshots: Record<string, RepoLensSnapshot[]>
}
export interface RepoLensControllerOptions {
  storage: RepoLensStorage
  secrets: RepoLensStorage
  permissions: { contains: (_query: { origins: string[] }) => Promise<boolean> }
  enabled?: () => Promise<boolean>
  fetch?: typeof fetch
  now?: () => number
}
interface ActiveRun { abort: AbortController, epoch: number }

export class RepoLensController {
  private state: StoredState = { version: 1, credentialId: '', remember: false, cache: [], snapshots: {} }
  private token = ''
  private epoch = 0
  private readonly active = new Map<string, ActiveRun>()
  private readonly ownerEpochs = new Map<string, number>()
  private writes: Promise<unknown> = Promise.resolve()
  private configuring: Promise<unknown> = Promise.resolve()
  private readonly ready: Promise<void>

  constructor(private readonly _options: RepoLensControllerOptions) { this.ready = this.load() }
  private now() { return this._options.now?.() ?? Date.now() }

  private async load() {
    const stored = (await this._options.storage.get(REPOLENS_STORAGE_KEY))[REPOLENS_STORAGE_KEY]
    if (!isRecord(stored) || stored.version !== 1 || bytes(JSON.stringify(stored)) > 3 * 1024 * 1024)
      return
    this.state.credentialId = typeof stored.credentialId === 'string' ? stored.credentialId.slice(0, 64) : ''
    this.state.remember = stored.remember === true
    if (Array.isArray(stored.cache)) {
      this.state.cache = stored.cache.filter((value): value is RepoLensResult => this.validResult(value)).slice(0, 12)
    }
    if (isRecord(stored.snapshots)) {
      for (const [repo, entries] of Object.entries(stored.snapshots).slice(0, 50)) {
        try {
          const key = normalizeRepository(repo).toLowerCase()
          if (Array.isArray(entries)) {
            this.state.snapshots[key] = entries.filter((entry): entry is RepoLensSnapshot => isRecord(entry)
              && typeof entry.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.day)
              && typeof entry.stars === 'number' && Number.isFinite(entry.stars) && entry.stars >= 0).slice(-90)
          }
        }
        catch { /* Invalid stored repository keys are ignored. */ }
      }
    }
    const area = this.state.remember ? this._options.storage : this._options.secrets
    const secret = (await area.get(REPOLENS_SECRET_KEY))[REPOLENS_SECRET_KEY]
    if (isRecord(secret) && secret.id === this.state.credentialId && typeof secret.token === 'string'
      && secret.token.length <= 4096 && !/[\r\n]/.test(secret.token)) {
      this.token = secret.token
    }
  }

  private validResult(value: unknown): value is RepoLensResult {
    if (!isRecord(value) || !isRecord(value.repository) || typeof value.repository.fullName !== 'string'
      || !Array.isArray(value.similar) || !Array.isArray(value.snapshots) || !Array.isArray(value.queries)
      || !Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string')
      || !isRecord(value.health) || typeof value.health.maintenance !== 'number' || typeof value.health.adoption !== 'number'
      || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt) || typeof value.report !== 'string'
      || value.similar.length > 8 || value.snapshots.length > 90 || bytes(JSON.stringify(value)) > 128 * 1024) {
      return false
    }
    try {
      normalizeRepository(value.repository.fullName)
      return typeof value.repository.description === 'string' && Array.isArray(value.repository.topics)
        && value.similar.every(item => isRecord(item) && isRecord(item.repository)
          && typeof item.repository.fullName === 'string' && !!normalizeRepository(item.repository.fullName)
          && typeof item.score === 'number' && Number.isFinite(item.score)
          && Array.isArray(item.reasons) && item.reasons.every(reason => typeof reason === 'string'))
    }
    catch { return false }
  }

  private persist() {
    const state = structuredClone(this.state)
    this.writes = this.writes.catch(() => {}).then(() => this._options.storage.set({ [REPOLENS_STORAGE_KEY]: state }))
    return this.writes
  }

  async configuration(): Promise<RepoLensConfiguration> {
    await this.ready
    return { keyConfigured: !!this.token, remember: this.state.remember }
  }

  configure(value: unknown) {
    const operation = this.configuring.catch(() => {}).then(() => this.configurePrepared(value))
    this.configuring = operation
    return operation
  }

  private async configurePrepared(value: unknown) {
    await this.ready
    if (!isRecord(value) || typeof value.token !== 'string' || value.token.length > 4096
      || /[\r\n]/.test(value.token) || typeof value.remember !== 'boolean'
      || Object.keys(value).some(key => !['token', 'remember'].includes(key))) {
      throw new Error('GitHub Token 配置无效')
    }
    this.invalidate()
    const previousState = structuredClone(this.state)
    const previousToken = this.token
    const localBefore = (await this._options.storage.get(REPOLENS_SECRET_KEY))[REPOLENS_SECRET_KEY] ?? null
    const sessionBefore = (await this._options.secrets.get(REPOLENS_SECRET_KEY))[REPOLENS_SECRET_KEY] ?? null
    const token = value.token.trim()
    const id = crypto.randomUUID()
    const target = value.remember ? this._options.storage : this._options.secrets
    const other = value.remember ? this._options.secrets : this._options.storage
    try {
      await target.set({ [REPOLENS_SECRET_KEY]: token ? { id, token } : null })
      await other.set({ [REPOLENS_SECRET_KEY]: null })
      this.state.credentialId = id
      this.state.remember = value.remember
      this.token = token
      await this.persist()
    }
    catch {
      this.state = previousState
      this.token = previousToken
      const rollback = await Promise.allSettled([
        this._options.storage.set({ [REPOLENS_SECRET_KEY]: localBefore }),
        this._options.secrets.set({ [REPOLENS_SECRET_KEY]: sessionBefore }),
      ])
      if (rollback.some(result => result.status === 'rejected'))
        this.token = ''
      throw new Error('无法保存 GitHub Token 配置，请重试')
    }
    return this.configuration()
  }

  cancelOwner(owner: string) {
    this.ownerEpochs.set(owner, (this.ownerEpochs.get(owner) ?? 0) + 1)
    this.active.get(owner)?.abort.abort()
    this.active.delete(owner)
  }

  invalidate() {
    this.epoch++
    for (const run of this.active.values()) run.abort.abort()
    this.active.clear()
  }

  private async authorize(run?: ActiveRun, owner?: string, ownerEpoch?: number) {
    if (run && (run.abort.signal.aborted || run.epoch !== this.epoch
      || (owner !== undefined && this.ownerEpochs.get(owner) !== ownerEpoch))) {
      throw new Error('分析已取消，请重新开始')
    }
    if (this._options.enabled && !await this._options.enabled())
      throw new Error('RepoLens 已停用，请在应用管理中启用')
    if (!await this._options.permissions.contains({ origins: [REPOLENS_ORIGIN] }))
      throw new Error('请先授权 GitHub API 访问')
    if (run && (run.abort.signal.aborted || run.epoch !== this.epoch))
      throw new Error('分析已取消，请重新开始')
  }

  private async request(path: string, run: ActiveRun, raw = false): Promise<unknown> {
    await this.authorize(run)
    const abort = new AbortController()
    const stop = () => abort.abort()
    run.abort.signal.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, 15000)
    try {
      const response = await (this._options.fetch ?? fetch)(`https://api.github.com${path}`, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: abort.signal,
        headers: {
          'Accept': raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      })
      if (response.status === 403 || response.status === 429)
        throw new Error('GitHub 请求受限，请稍后重试或配置只读 Token')
      if (response.status === 404 && raw)
        return ''
      if (response.status === 404)
        throw new Error('找不到公开仓库，请检查名称')
      if (response.status === 401)
        throw new Error('GitHub Token 无效或已过期')
      if (!response.ok)
        throw new Error(`GitHub 请求失败（${response.status}）`)
      if (!response.body)
        throw new Error('GitHub 返回了空响应')
      const reader = response.body.getReader()
      const limit = raw ? 128 * 1024 : 1024 * 1024
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done)
            break
          size += chunk.value.byteLength
          if (size > limit)
            throw new Error('GitHub 响应过大，请缩小查询范围')
          chunks.push(chunk.value)
        }
      }
      finally {
        try {
          await reader.cancel()
        }
        catch { /* A revoked or cancelled stream may already be closed. */ }
        reader.releaseLock()
      }
      await this.authorize(run)
      const joined = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }
      const text = new TextDecoder().decode(joined)
      return raw ? text.slice(0, 30000) : JSON.parse(text)
    }
    finally {
      clearTimeout(timer)
      run.abort.signal.removeEventListener('abort', stop)
    }
  }

  async analyze(input: unknown, owner: string): Promise<RepoLensResult> {
    const requestedOwnerEpoch = this.ownerEpochs.get(owner) ?? 0
    this.ownerEpochs.set(owner, requestedOwnerEpoch)
    await this.ready
    const repo = normalizeRepository(input)
    await this.authorize()
    if (this.ownerEpochs.get(owner) !== requestedOwnerEpoch)
      throw new Error('分析已取消，请重新开始')
    if (this.active.has(owner))
      throw new Error('已有分析正在进行，请先停止')
    if (this.active.size >= 2)
      throw new Error('最多同时分析两个项目')
    const run: ActiveRun = { abort: new AbortController(), epoch: this.epoch }
    this.active.set(owner, run)
    const timer = setTimeout(() => run.abort.abort(), 90000)
    try {
      const cached = this.state.cache.find(item => item.repository.fullName.toLowerCase() === repo.toLowerCase() && this.now() - item.fetchedAt < 6 * 3600000)
      if (cached) {
        await this.authorize(run, owner, requestedOwnerEpoch)
        return structuredClone({ ...cached, cached: true })
      }
      const result = await this.perform(repo, run)
      await this.authorize(run, owner, requestedOwnerEpoch)
      const previousState = structuredClone(this.state)
      this.state.cache = [result, ...this.state.cache.filter(item => item.repository.fullName.toLowerCase() !== repo.toLowerCase())].slice(0, 12)
      this.state.snapshots[repo.toLowerCase()] = result.snapshots
      const keys = Object.keys(this.state.snapshots)
      for (const key of keys.slice(0, Math.max(0, keys.length - 50))) delete this.state.snapshots[key]
      try {
        await this.persist()
      }
      catch {
        this.state = previousState
        throw new Error('无法保存分析结果，请检查本机存储')
      }
      await this.authorize(run, owner, requestedOwnerEpoch)
      return structuredClone(result)
    }
    finally {
      clearTimeout(timer)
      if (this.active.get(owner) === run)
        this.active.delete(owner)
    }
  }

  private async perform(repo: string, run: ActiveRun): Promise<RepoLensResult> {
    const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`
    const repository = projectRepository(await this.request(path, run))
    const warnings: string[] = []
    const optional = async <T>(label: string, operation: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await operation()
      }
      catch (error) {
        await this.authorize(run)
        warnings.push(`${label}：${error instanceof Error ? error.message : '数据暂不可用'}`)
        return fallback
      }
    }
    const readme = await optional('README', async () => String(await this.request(`${path}/readme`, run, true)), '')
    const releases = await optional('发布记录', async () => {
      const value = await this.request(`${path}/releases?per_page=1`, run)
      if (!Array.isArray(value))
        throw new Error('GitHub 发布数据格式无效')
      return value
    }, null)
    const release = Array.isArray(releases) && isRecord(releases[0]) ? releases[0] : null
    const latestRelease = release
      ? {
          name: typeof release.name === 'string' ? release.name.slice(0, 200) : typeof release.tag_name === 'string' ? release.tag_name.slice(0, 200) : '未命名版本',
          publishedAt: typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)) ? release.published_at : null,
        }
      : null
    const queries = buildQueries(repository, readme)
    const candidates: Repository[] = []
    const seen = new Set([repository.fullName.toLowerCase()])
    const outcomeLists: Repository[][] = []
    for (const query of queries) {
      const data = await optional('相似项目搜索', async () => {
        const value = await this.request(`/search/repositories?${new URLSearchParams({ q: query, sort: 'stars', order: 'desc', per_page: '12' })}`, run)
        if (!isRecord(value) || !Array.isArray(value.items))
          throw new Error('GitHub 搜索数据格式无效')
        if (value.incomplete_results === true)
          warnings.push('相似项目搜索：GitHub 返回了不完整的候选集合')
        return value
      }, null)
      const list: Repository[] = []
      if (isRecord(data) && Array.isArray(data.items)) {
        for (const item of data.items.slice(0, 12)) {
          if (!isRecord(item) || item.private === true || item.archived === true || item.fork === true)
            continue
          try {
            list.push(projectRepository(item))
          }
          catch { /* Ignore malformed external candidates. */ }
        }
      }
      outcomeLists.push(list)
    }
    for (let index = 0; index < 12 && candidates.length < 12; index++) {
      for (const list of outcomeLists) {
        const item = list[index]
        if (!item || seen.has(item.fullName.toLowerCase()))
          continue
        seen.add(item.fullName.toLowerCase())
        candidates.push(item)
        if (candidates.length >= 12)
          break
      }
    }
    const bundles: Array<{ repository: Repository, readme: string }> = []
    // Two bounded workers keep anonymous GitHub request bursts small.
    const pending = [...candidates]
    await Promise.all([0, 1].map(async () => {
      while (pending.length) {
        const item = pending.shift()!
        const candidatePath = `/repos/${item.fullName.split('/').map(encodeURIComponent).join('/')}/readme`
        const text = await optional(`${item.fullName} README`, async () => String(await this.request(candidatePath, run, true)), '')
        bundles.push({ repository: item, readme: text })
      }
    }))
    const since = new Date(this.now() - 90 * 86400000).toISOString().slice(0, 10)
    const metrics: Record<string, number> = {}
    for (const [key, qualifier] of [
      ['issuesCreated', `is:issue created:>=${since}`],
      ['issuesClosed', `is:issue closed:>=${since}`],
      ['pullsCreated', `is:pr created:>=${since}`],
      ['pullsMerged', `is:pr is:merged merged:>=${since}`],
    ]) {
      const count = await optional('90 天维护活动', () => this.request(`/search/issues?${new URLSearchParams({ q: `repo:${repository.fullName} ${qualifier}`, per_page: '1' })}`, run), null)
      if (isRecord(count) && typeof count.total_count === 'number' && Number.isFinite(count.total_count))
        metrics[key] = Math.max(0, count.total_count)
      else if (count !== null)
        warnings.push('90 天维护活动：GitHub 数据格式无效')
    }
    const activity = Object.keys(metrics).length === 4
      ? {
          issuesCreated: metrics.issuesCreated,
          issuesClosed: metrics.issuesClosed,
          pullsCreated: metrics.pullsCreated,
          pullsMerged: metrics.pullsMerged,
        }
      : null
    const fetchedAt = this.now()
    const day = new Date(fetchedAt).toISOString().slice(0, 10)
    const snapshots = [...(this.state.snapshots[repo.toLowerCase()] ?? []).filter(item => item.day !== day), { day, stars: repository.stars }].sort((a, b) => a.day.localeCompare(b.day)).slice(-90)
    const result: Omit<RepoLensResult, 'report'> = {
      repository,
      latestRelease,
      activity,
      health: health(repository, latestRelease, activity, fetchedAt),
      similar: rankCandidates(repository, readme, bundles, fetchedAt),
      snapshots,
      queries,
      warnings: [...new Set(warnings)].slice(0, 24),
      fetchedAt,
      cached: false,
    }
    return { ...result, report: markdownReport(result) }
  }

  async clear() {
    await this.ready
    this.invalidate()
    const previous = structuredClone(this.state)
    this.state.cache = []
    this.state.snapshots = {}
    try {
      await this.persist()
    }
    catch {
      this.state = previous
      throw new Error('无法清空 RepoLens 本机数据，请重试')
    }
  }
}
