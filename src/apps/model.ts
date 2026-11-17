/* eslint no-template-curly-in-string: off -- User templates intentionally use literal declared placeholders. */
export const SMART_APPS_STORAGE_KEY = 'oneweb.smart-apps.v1'
export const SMART_APPS_CHANNEL = 'oneweb.smart-apps.v1'
export const MAX_MINI_APP_BYTES = 256 * 1024
export const MAX_SMART_APPS_BYTES = 2 * 1024 * 1024
export const MAX_SMART_APPS = 50

interface SmartAppBase {
  id: string
  name: string
  description: string
  enabled: boolean
  matches: string[]
  createdAt: number
  updatedAt: number
}
export interface WebToolApp extends SmartAppBase { kind: 'web-tool', prompt: string }
export interface MiniApp extends SmartAppBase { kind: 'mini-app', html: string }
export type SmartApp = WebToolApp | MiniApp
interface SmartAppInputBase { name: string, description?: string, enabled?: boolean, matches?: string[] }
export type SmartAppInput = SmartAppInputBase & ({ kind: 'web-tool', prompt: string } | { kind: 'mini-app', html: string })
export interface SmartAppsStorage {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_items: Record<string, unknown>) => Promise<void>
}
export function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function boundedText(value: unknown, limit: number, label: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    throw new Error(`请填写${label}`)
  if (byteLength(value) > limit)
    throw new Error(`${label}超过大小限制`)
  return value
}

function patternParts(pattern: string) {
  const parts = /^(https?|\*):\/\/(\*|\*\.[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?(\/[^?#\s]*)$/i.exec(pattern)
  if (!parts || (parts[3] && Number(parts[3]) > 65535))
    throw new Error('适用网址只能使用 HTTP(S) 匹配规则，例如 https://github.com/*')
  return { scheme: parts[1].toLowerCase(), host: parts[2].toLowerCase(), port: parts[3] || '', path: parts[4] }
}

export function normalizeSmartAppInput(value: unknown): SmartAppInput {
  if (!isRecord(value) || !['web-tool', 'mini-app'].includes(String(value.kind)))
    throw new Error('应用类型无效')
  const fields = ['kind', 'name', 'description', 'enabled', 'matches', value.kind === 'web-tool' ? 'prompt' : 'html']
  if (Object.keys(value).some(key => !fields.includes(key)))
    throw new Error('应用包含不支持的字段')
  const name = boundedText(value.name, 160, '名称').trim()
  const description = boundedText(value.description ?? '', 1000, '说明', true).trim()
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw new Error('启用状态无效')
  const enabled = value.enabled ?? true
  const matches = value.matches ?? ['https://*/*', 'http://*/*']
  if (!Array.isArray(matches) || !matches.length || matches.length > 20 || matches.some(item => typeof item !== 'string' || byteLength(item) > 512))
    throw new Error('适用网址规则无效（最多 20 条）')
  for (const pattern of matches) patternParts(pattern)
  const base = { name, description, enabled, matches: [...new Set(matches)] }
  if (value.kind === 'web-tool') {
    const prompt = boundedText(value.prompt, 16 * 1024, '提示词')
    const remaining = prompt.replace(/\$\{(text|title|url)\}/g, '')
    if (remaining.includes('${'))
      throw new Error('提示词变量仅支持 ${text}、${title} 和 ${url}')
    return { ...base, kind: 'web-tool', prompt }
  }
  return { ...base, kind: 'mini-app', html: boundedText(value.html, MAX_MINI_APP_BYTES, '小应用内容') }
}

export function normalizeStoredApp(value: unknown): SmartApp {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^app-[\w-]{1,100}$/.test(value.id)
    || !Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0
    || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0) {
    throw new Error('应用记录无效')
  }
  const { id, createdAt, updatedAt, ...input } = value
  const normalized = normalizeSmartAppInput(input)
  return { ...normalized, id, createdAt, updatedAt } as SmartApp
}

export function matchesApp(app: Pick<SmartApp, 'matches'>, address: string) {
  try {
    const url = new URL(address)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return false
    return app.matches.some((pattern) => {
      const parts = patternParts(pattern)
      const host = url.hostname.toLowerCase()
      const hostMatches = parts.host === '*' || parts.host === host
        || (parts.host.startsWith('*.') && (host === parts.host.slice(2) || host.endsWith(`.${parts.host.slice(2)}`)))
      const pathExpression = parts.path.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
      return (parts.scheme === '*' || `${parts.scheme}:` === url.protocol)
        && hostMatches && (!parts.port || parts.port === (url.port || (url.protocol === 'https:' ? '443' : '80')))
        && new RegExp(`^${pathExpression}$`).test(url.pathname)
    })
  }
  catch { return false }
}

export function renderWebToolPrompt(app: WebToolApp, context: { text: string, title: string, url: string }) {
  if (!app.enabled)
    throw new Error('此工具已停用')
  if (!matchesApp(app, context.url))
    throw new Error('此工具不适用于当前网址')
  boundedText(context.text, 64 * 1024, '网页或选文', true)
  boundedText(context.title, 2048, '网页标题', true)
  const source = new URL(boundedText(context.url, 2048, '来源网址'))
  source.search = ''
  source.hash = ''
  const fields = { text: context.text, title: context.title, url: source.href }
  let projectedBytes = byteLength(app.prompt)
  for (const match of app.prompt.matchAll(/\$\{(text|title|url)\}/g)) {
    const key = match[1] as keyof typeof fields
    projectedBytes += byteLength(fields[key]) - byteLength(match[0])
  }
  if (projectedBytes > 128 * 1024)
    throw new Error('工具输入超过大小限制，请缩短选文或提示词')
  return app.prompt.replace(/\$\{(text|title|url)\}/g, (_, key: keyof typeof fields) => fields[key])
}
