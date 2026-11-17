export const REPOLENS_MODULE_ID = 'dev.juck.repolens'
export const REPOLENS_ENTRY_ID = 'repolens'
export const REPOLENS_CHANNEL = 'oneweb.repolens.v1'
export const REPOLENS_ORIGIN = 'https://api.github.com/*'
export const REPOLENS_STORAGE_KEY = 'oneweb.module-state.v1:dev.juck.repolens'
export const REPOLENS_SECRET_KEY = 'oneweb.repolens.secret.v1'

export interface RepoLensStorage {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_items: Record<string, unknown>) => Promise<void>
}

export interface Repository {
  name: string
  fullName: string
  description: string
  topics: string[]
  language: string | null
  license: string | null
  stars: number
  forks: number
  issues: number
  pushedAt: string | null
  archived: boolean
}

export interface RepoLensSnapshot { day: string, stars: number }
export interface RepoLensResult {
  repository: Repository
  latestRelease: { name: string, publishedAt: string | null } | null
  activity: { issuesCreated: number, issuesClosed: number, pullsCreated: number, pullsMerged: number } | null
  health: { maintenance: number, adoption: number }
  similar: Array<{ repository: Repository, score: number, reasons: string[] }>
  snapshots: RepoLensSnapshot[]
  queries: string[]
  warnings: string[]
  fetchedAt: number
  cached: boolean
  report: string
}

export interface RepoLensConfiguration { keyConfigured: boolean, remember: boolean }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export function normalizeRepository(input: unknown) {
  if (typeof input !== 'string' || input.length > 2048)
    throw new Error('请输入 GitHub 仓库名称，例如 vuejs/core')
  let value = input.trim()
  if (/^https?:/i.test(value)) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password)
      throw new Error('仅支持公开 GitHub 仓库')
    value = url.pathname.split('/').filter(Boolean).slice(0, 2).join('/')
  }
  if (!/^[a-z0-9][a-z0-9-]{0,38}\/[\w.-]{1,100}$/i.test(value) || value.split('/')[1] === '.' || value.split('/')[1] === '..')
    throw new Error('仓库名称无效，请填写 owner/repo')
  return value
}

export function projectRepository(value: unknown): Repository {
  if (!isRecord(value) || value.private === true || typeof value.full_name !== 'string')
    throw new Error('仅支持公开 GitHub 仓库')
  const fullName = normalizeRepository(value.full_name)
  const count = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0
  return {
    fullName,
    name: fullName.split('/')[1],
    description: typeof value.description === 'string' ? value.description.slice(0, 2000) : '',
    topics: Array.isArray(value.topics) ? value.topics.filter((topic): topic is string => typeof topic === 'string' && /^[a-z0-9-]{1,50}$/i.test(topic)).slice(0, 20) : [],
    language: typeof value.language === 'string' ? value.language.slice(0, 80) : null,
    license: isRecord(value.license) && typeof value.license.spdx_id === 'string' ? value.license.spdx_id.slice(0, 80) : null,
    stars: count(value.stargazers_count),
    forks: count(value.forks_count),
    issues: count(value.open_issues_count),
    pushedAt: typeof value.pushed_at === 'string' && Number.isFinite(Date.parse(value.pushed_at)) ? value.pushed_at : null,
    archived: value.archived === true,
  }
}
