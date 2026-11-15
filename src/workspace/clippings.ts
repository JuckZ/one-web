import type { AssistantStorage } from '~/modules/builtin/assistant/contracts'
import { byteLength, isRecord } from '~/modules/builtin/assistant/contracts'

export interface QuoteAnchor { exact: string, prefix: string, suffix: string, start: number }
export interface Clipping { id: string, title: string, url: string, anchor: QuoteAnchor, note: string, savedAt: number }
export interface QuoteLocation { status: 'found' | 'missing' | 'ambiguous' | 'changed', message: string }
const KEY = 'oneweb.clippings.v1'

export function validQuote(value: unknown): value is QuoteAnchor {
  return isRecord(value) && typeof value.exact === 'string' && !!value.exact.trim() && byteLength(value.exact) <= 16384
    && typeof value.prefix === 'string' && value.prefix.length <= 64 && typeof value.suffix === 'string' && value.suffix.length <= 64
    && Number.isSafeInteger(value.start) && Number(value.start) >= 0
}

export class ClippingController {
  private entries: Clipping[] = []
  private readonly ready: Promise<void>
  private writes: Promise<unknown> = Promise.resolve()

  constructor(private readonly _storage: AssistantStorage) {
    this.ready = this.load()
  }

  private async load() {
    const value = (await this._storage.get(KEY))[KEY]
    if (Array.isArray(value) && value.length <= 500 && byteLength(JSON.stringify(value)) <= 4194304) {
      this.entries = value.filter((item): item is Clipping => isRecord(item) && typeof item.id === 'string'
        && typeof item.title === 'string' && typeof item.note === 'string' && typeof item.savedAt === 'number'
        && this.validUrl(item.url) && validQuote(item.anchor) && byteLength(JSON.stringify(item)) <= 65536)
    }
  }

  private validUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 4096)
      return false
    try {
      const url = new URL(value)
      return /^https?:$/.test(url.protocol) && !url.username && !url.password
    }
    catch { return false }
  }

  private async change(update: () => Clipping[]) {
    await this.ready
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = update()
      if (next.length > 500 || next.some(item => byteLength(JSON.stringify(item)) > 65536) || byteLength(JSON.stringify(next)) > 4194304)
        throw new Error('剪藏大小或数量超过限额，请删除部分内容')
      await this._storage.set({ [KEY]: next })
      this.entries = next
    })
    this.writes = operation
    await operation
  }

  async list() {
    await this.ready
    await this.writes.catch(() => {})
    return structuredClone(this.entries)
  }

  async save(value: unknown) {
    if (!isRecord(value) || !validQuote(value.anchor) || !this.validUrl(value.url) || typeof value.title !== 'string'
      || value.title.length > 512 || typeof value.note !== 'string') {
      throw new Error('剪藏来源、选文或笔记无效')
    }
    const entry: Clipping = { id: crypto.randomUUID(), anchor: structuredClone(value.anchor), title: value.title, url: value.url, note: value.note, savedAt: Date.now() }
    await this.change(() => [entry, ...this.entries])
    return structuredClone(entry)
  }

  async get(id: string) {
    const entry = (await this.list()).find(item => item.id === id)
    if (!entry)
      throw new Error('剪藏已删除')
    return entry
  }

  async note(id: string, note: string) {
    if (typeof note !== 'string')
      throw new Error('笔记无效')
    await this.get(id)
    await this.change(() => this.entries.map(item => item.id === id ? { ...item, note } : item))
    return null
  }

  async delete(id: string) {
    await this.change(() => this.entries.filter(item => item.id !== id))
    return null
  }
}
