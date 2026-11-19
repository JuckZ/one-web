import type { AssistantAttachment } from '~/modules/builtin/assistant/contracts'
import { byteLength, isRecord, MAX_TAB_SOURCES, TAB_SOURCE_BYTES } from '~/modules/builtin/assistant/contracts'
import { isTrustedModuleManagementSender } from '~/modules/management-protocol'

const CHANNEL = 'oneweb.tab-sources.v1'
const TTL = 600000

interface BrowserTab {
  id?: number
  windowId?: number
  url?: string
  pendingUrl?: string
  title?: string
  lastAccessed?: number
  incognito?: boolean
  discarded?: boolean
  status?: string
}

export interface TabSource {
  tabId: number
  token: string
  title: string
  url: string
  truncated: boolean
}
export type TabChoice = Omit<TabSource, 'truncated'> & { originPattern: string }
interface DocumentIdentity { href: string, documentId: string, nativeDocumentId?: string }
interface TabIdentity { tabId: number, href: string, originPattern: string }
interface Candidate { identity: TabIdentity, choice: TabChoice, expires: number }
interface Snapshot { identity: TabIdentity, attachment: AssistantAttachment, source: TabSource }
interface WorkspaceSources { choices: Map<string, Candidate>, snapshots: Map<string, Snapshot>, touched: number }
interface TabSourceOptions {
  list: () => Promise<BrowserTab[]>
  get: (_id: number) => Promise<BrowserTab | undefined>
  read: (_tabId: number, _capture: boolean, _expected?: DocumentIdentity) => Promise<unknown>
  focus: (_tabId: number, _windowId: number) => Promise<unknown>
  permissions: { contains: (_query: { origins: string[] }) => Promise<boolean> }
  now?: () => number
}

function usable(tab: BrowserTab | undefined) {
  if (!tab?.url || tab.id === undefined || tab.incognito || tab.discarded || tab.pendingUrl || tab.status === 'loading')
    return null
  const url = new URL(tab.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.hostname === 'chromewebstore.google.com' || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))
    || url.hostname === 'addons.mozilla.org') {
    return null
  }
  const identity = { tabId: tab.id, href: url.href, originPattern: `${url.origin}/*` }
  url.search = ''
  url.hash = ''
  return byteLength(url.href) <= 2048 ? { identity, url: url.href } : null
}

export class TabSourceController {
  private readonly pendingLists = new Set<Set<number>>()
  private readonly workspaces = new Map<string, WorkspaceSources>()

  constructor(private readonly _options: TabSourceOptions) {}

  async list(owner: string) {
    const now = this.now()
    for (const [key, state] of this.workspaces) {
      if (now - state.touched > TTL)
        this.workspaces.delete(key)
    }
    let state = this.workspaces.get(owner)
    if (!state) {
      if (this.workspaces.size >= 32)
        throw new Error('打开的助手工作区过多')
      state = { choices: new Map(), snapshots: new Map(), touched: now }
      this.workspaces.set(owner, state)
    }
    state.touched = now
    const invalidated = new Set<number>()
    this.pendingLists.add(invalidated)
    const tabs = await this._options.list().finally(() => this.pendingLists.delete(invalidated))
    tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    if (this.workspaces.get(owner) !== state)
      throw new Error('工作区已关闭')
    const choices = new Map<string, Candidate>()
    for (const tab of tabs) {
      const usableTab = usable(tab)
      if (!usableTab || invalidated.has(usableTab.identity.tabId))
        continue
      const { identity, url } = usableTab
      const choice = { tabId: identity.tabId, token: crypto.randomUUID(), title: Array.from(tab.title?.trim() || url).slice(0, 512).join(''), url, originPattern: identity.originPattern }
      choices.set(choice.token, { identity, choice, expires: now + TTL })
      if (choices.size >= 100)
        break
    }
    state.choices = choices
    return [...choices.values()].map(candidate => candidate.choice)
  }

  async attach(token: string, owner: string): Promise<TabSource> {
    const state = this.workspaces.get(owner)
    const candidate = state?.choices.get(token)
    if (!state || !candidate || candidate.expires < this.now())
      throw new Error('标签页列表已变化，请重新打开列表选择')
    const { identity, choice } = candidate
    const isCurrent = () => this.workspaces.get(owner) === state && state.choices.get(token) === candidate && candidate.expires >= this.now()
    const existing = [...state.snapshots.values()].find(snapshot => snapshot.identity.tabId === identity.tabId && this.validAge(snapshot))
    await this.checkTab(identity, '此标签页已变化，请重新选择')
    if (!await this._options.permissions.contains({ origins: [identity.originPattern] }))
      throw new Error('请先授权此标签页的站点')
    const current = await this._options.read(identity.tabId, false)
    if (!isCurrent() || !isRecord(current) || current.href !== identity.href || typeof current.documentId !== 'string')
      throw new Error('此标签页已变化，请重新选择')
    if (existing && current.documentId === existing.attachment.documentId && state.snapshots.get(existing.source.token) === existing)
      return existing.source
    const result = await this._options.read(identity.tabId, true, {
      href: identity.href,
      documentId: current.documentId,
      nativeDocumentId: typeof current.nativeDocumentId === 'string' ? current.nativeDocumentId : undefined,
    })
    await this.checkTab(identity, '此标签页已变化，请重新选择')
    if (!await this._options.permissions.contains({ origins: [identity.originPattern] }))
      throw new Error('此标签页的站点授权已撤销')
    if (!isCurrent() || !isRecord(result) || result.href !== identity.href || result.documentId !== current.documentId) {
      throw new Error('此标签页已变化，请重新选择')
    }
    if (typeof result.text !== 'string' || !result.text.trim() || byteLength(result.text) > 65536 || typeof result.truncated !== 'boolean')
      throw new Error('无法读取此标签页的正文')
    for (const [key, snapshot] of state.snapshots) {
      if (!this.validAge(snapshot) || snapshot.identity.tabId === identity.tabId)
        state.snapshots.delete(key)
    }
    if (state.snapshots.size >= MAX_TAB_SOURCES)
      throw new Error(`一轮最多附加 ${MAX_TAB_SOURCES} 个标签页`)
    const text = limitText(result.text)
    const source = { tabId: identity.tabId, token: crypto.randomUUID(), title: choice.title, url: choice.url, truncated: result.truncated || text !== result.text }
    const attachment: AssistantAttachment = {
      ...source,
      text,
      type: 'page',
      capturedAt: this.now(),
      documentId: result.documentId,
    }
    state.touched = this.now()
    state.snapshots.set(source.token, { identity, source, attachment })
    return source
  }

  async resolve(tokens: string[], owner: string) {
    if (tokens.length > MAX_TAB_SOURCES || new Set(tokens).size !== tokens.length)
      throw new Error('所选标签页无效')
    const state = this.workspaces.get(owner)
    const snapshots = await Promise.all(tokens.map(async (token) => {
      const snapshot = state?.snapshots.get(token)
      if (!snapshot || !this.validAge(snapshot))
        throw new Error('标签页附件已失效，请移除后重新添加')
      await this.validate(snapshot)
      return snapshot
    }))
    // A grant may be revoked while another tab is still checking its document.
    const origins = [...new Set(snapshots.map(snapshot => snapshot.identity.originPattern))]
    if (origins.length && !await this._options.permissions.contains({ origins }))
      throw new Error('标签页站点授权已撤销，请移除后重新添加')
    if (this.workspaces.get(owner) !== state || snapshots.some((item, index) => state?.snapshots.get(tokens[index]) !== item || !this.validAge(item)))
      throw new Error('标签页附件已失效，请移除后重新添加')
    return snapshots.map(item => structuredClone(item.attachment))
  }

  remove(token: string, owner: string) {
    this.workspaces.get(owner)?.snapshots.delete(token)
    return null
  }

  async focus(token: string, owner: string) {
    const state = this.workspaces.get(owner)
    const snapshot = state?.snapshots.get(token)
    if (!snapshot || !this.validAge(snapshot))
      throw new Error('标签页附件已失效，请重新添加')
    const tab = await this.validate(snapshot)
    if (tab.windowId === undefined || this.workspaces.get(owner) !== state || state?.snapshots.get(token) !== snapshot)
      throw new Error('标签页已关闭或变化')
    await this._options.focus(snapshot.identity.tabId, tab.windowId)
    return null
  }

  invalidate(tabId: number) {
    for (const pending of this.pendingLists) pending.add(tabId)
    for (const state of this.workspaces.values()) {
      for (const [key, candidate] of state.choices) {
        if (candidate.identity.tabId === tabId)
          state.choices.delete(key)
      }
      for (const [key, snapshot] of state.snapshots) {
        if (snapshot.identity.tabId === tabId)
          state.snapshots.delete(key)
      }
    }
  }

  async invalidateRevoked() {
    const matches = new Map<number, string>()
    for (const state of this.workspaces.values()) {
      for (const { identity } of state.snapshots.values()) matches.set(identity.tabId, identity.originPattern)
    }
    const revoked = await Promise.all([...matches].map(async ([tabId, origin]) => {
      const allowed = await this._options.permissions.contains({ origins: [origin] }).catch(() => false)
      if (allowed)
        return undefined
      // A navigation may have already replaced this tab with a different origin.
      for (const state of this.workspaces.values()) {
        for (const [key, value] of state.snapshots) {
          if (value.identity.tabId === tabId && value.identity.originPattern === origin)
            state.snapshots.delete(key)
        }
      }
      return tabId
    }))
    return revoked.filter(id => id !== undefined)
  }

  clearOwner(owner: string) { this.workspaces.delete(owner) }

  private async checkTab(identity: TabIdentity, error: string) {
    const tab = await this._options.get(identity.tabId).catch(() => undefined)
    if (!tab || usable(tab)?.identity.href !== identity.href)
      throw new Error(error)
    return tab
  }

  private async validate(snapshot: Snapshot) {
    const { identity } = snapshot
    const error = `「${snapshot.source.title}」的标签页附件已失效，请移除后重新添加`
    const tab = await this.checkTab(identity, error)
    if (!await this._options.permissions.contains({ origins: [identity.originPattern] }))
      throw new Error(error)
    const result = await this._options.read(identity.tabId, false).catch(() => null)
    if (!isRecord(result) || result.href !== identity.href || result.documentId !== snapshot.attachment.documentId
      || !await this._options.permissions.contains({ origins: [identity.originPattern] })) {
      throw new Error(error)
    }
    return tab
  }

  private now() { return this._options.now?.() ?? Date.now() }
  private validAge(snapshot: Snapshot) { return this.now() - snapshot.attachment.capturedAt <= TTL }
}

function limitText(text: string) {
  if (byteLength(text) <= TAB_SOURCE_BYTES)
    return text
  let size = 0
  let end = 0
  for (const char of text) {
    size += byteLength(char)
    if (size > TAB_SOURCE_BYTES)
      break
    end += char.length
  }
  return text.slice(0, end)
}

export function handleTabSourceMessage(
  controller: TabSourceController,
  message: unknown,
  sender: { id?: string, url?: string, documentId?: string },
  extensionId: string,
  extensionBase: string,
) {
  if (!isRecord(message) || message.channel !== CHANNEL || !isTrustedModuleManagementSender(sender, extensionId, extensionBase))
    return undefined
  const command = message.command
  const token = message.token
  if (command !== 'list' && command !== 'clear'
    && (!['attach', 'remove', 'focus'].includes(command as string) || typeof token !== 'string' || token.length > 64)) {
    return undefined
  }
  const owner = sender.documentId ?? sender.url!
  const execute = async () => {
    if (command === 'list')
      return controller.list(owner)
    if (command === 'attach')
      return controller.attach(token as string, owner)
    if (command === 'focus')
      return controller.focus(token as string, owner)
    if (command === 'remove')
      return controller.remove(token as string, owner)
    controller.clearOwner(owner)
    return null
  }
  return execute().then(value => ({ channel: CHANNEL, ok: true, value }), error => ({
    channel: CHANNEL,
    ok: false,
    error: error instanceof Error ? error.message : '标签页操作失败',
  }))
}

export class TabSourceClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}
  private async request<T>(command: string, token?: string) {
    const result = await this._transport.sendMessage({ channel: CHANNEL, command, token })
    if (!isRecord(result) || result.channel !== CHANNEL)
      throw new Error('标签页连接已断开')
    if (result.ok !== true)
      throw new Error(typeof result.error === 'string' ? result.error : '标签页操作失败')
    return result.value as T
  }

  list() { return this.request<TabChoice[]>('list') }
  attach(token: string) { return this.request<TabSource>('attach', token) }
  remove(token: string) { return this.request<null>('remove', token) }
  focus(token: string) { return this.request<null>('focus', token) }
  clear() { return this.request<null>('clear') }
}
