import type {
  CookieImportPreview,
  CookieMutation,
  CookiePreparation,
  CookieResult,
  CookieScope,
  CookieSnapshot,
  ManagedCookie,
} from './contracts'
import type { CookieManagerController } from './controller'
import { isTrustedModuleManagementSender } from '../../management-protocol'
import { COOKIE_BATCH_LIMIT, COOKIE_FILE_LIMIT, COOKIE_LIMIT } from './contracts'
import { isRecord, normalizeCookie } from './model'

const CHANNEL = 'oneweb.cookie-manager'
const VERSION = 1

interface CommandFields {
  prepare: { scope: CookieScope }
  open: { token: string }
  refresh: { snapshotId: string }
  save: { snapshotId: string, cookie: ManagedCookie, entryId?: string }
  delete: { snapshotId: string, entryIds: string[] }
  export: { snapshotId: string, entryIds: string[] }
  preview: { snapshotId: string, text: string, storeId: string }
  import: { snapshotId: string, previewId: string, entryIds: string[] }
  close: { snapshotId: string }
}

interface CommandValues {
  prepare: CookiePreparation
  open: CookieSnapshot
  refresh: CookieSnapshot
  save: null
  delete: CookieMutation[]
  export: string
  preview: CookieImportPreview
  import: CookieMutation[]
  close: null
}

type Command = keyof CommandFields
type CookieRequest = {
  [K in Command]: { channel: typeof CHANNEL, version: typeof VERSION, type: K } & CommandFields[K]
}[Command]

const ERROR_CODES = new Set([
  'module-disabled',
  'permission-required',
  'permission-denied',
  'invalid-input',
  'limit-exceeded',
  'unsupported-format',
  'store-unavailable',
  'unsupported-partition',
  'stale-cookie',
  'ambiguous-cookie-target',
  'lifecycle-cancelled',
  'browser-operation-failed',
  'outcome-unknown',
  'invalid-site',
  'transport-error',
  'invalid-response',
])

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function ids(value: unknown, limit = COOKIE_BATCH_LIMIT): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= limit
    && value.every(id) && new Set(value).size === value.length
}

function isRequest(value: unknown): value is CookieRequest {
  if (!isRecord(value) || value.channel !== CHANNEL || value.version !== VERSION)
    return false
  const fields: Record<Command, string[]> = {
    prepare: ['scope'],
    open: ['token'],
    refresh: ['snapshotId'],
    save: ['snapshotId', 'cookie', ...(value.entryId === undefined ? [] : ['entryId'])],
    delete: ['snapshotId', 'entryIds'],
    export: ['snapshotId', 'entryIds'],
    preview: ['snapshotId', 'text', 'storeId'],
    import: ['snapshotId', 'previewId', 'entryIds'],
    close: ['snapshotId'],
  }
  if (typeof value.type !== 'string' || !Object.hasOwn(fields, value.type))
    return false
  const keys = ['channel', 'version', 'type', ...fields[value.type as Command]]
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)))
    return false
  switch (value.type) {
    case 'prepare': return value.scope === 'all' || value.scope === 'current'
    case 'open': return id(value.token)
    case 'refresh':
    case 'close': return id(value.snapshotId)
    case 'save': return id(value.snapshotId) && isRecord(value.cookie)
      && JSON.stringify(value.cookie).length <= COOKIE_FILE_LIMIT
      && (value.entryId === undefined || id(value.entryId))
    case 'delete':
    case 'export': return id(value.snapshotId) && ids(value.entryIds, value.type === 'export' ? COOKIE_LIMIT : COOKIE_BATCH_LIMIT)
    case 'preview': return id(value.snapshotId) && id(value.storeId)
      && typeof value.text === 'string' && value.text.length <= COOKIE_FILE_LIMIT
    case 'import': return id(value.snapshotId) && id(value.previewId) && ids(value.entryIds)
    default: return false
  }
}

async function dispatch(controller: CookieManagerController, request: CookieRequest): Promise<CookieResult<unknown>> {
  switch (request.type) {
    case 'prepare': return controller.prepare(request.scope)
    case 'open': return controller.open(request.token)
    case 'refresh': return controller.refresh(request.snapshotId)
    case 'save': return controller.save(request.snapshotId, request.cookie, request.entryId)
    case 'delete': return controller.delete(request.snapshotId, request.entryIds)
    case 'export': return controller.export(request.snapshotId, request.entryIds)
    case 'preview': return controller.preview(request.snapshotId, request.text, request.storeId)
    case 'import': return controller.import(request.snapshotId, request.previewId, request.entryIds)
    case 'close': return controller.close(request.snapshotId)
  }
}

export function handleCookieManagerMessage(
  controller: CookieManagerController,
  message: unknown,
  sender: { id?: string, url?: string },
  extensionId: string,
  extensionBaseUrl: string,
) {
  if (!isRequest(message) || !isTrustedModuleManagementSender(sender, extensionId, extensionBaseUrl))
    return undefined
  return dispatch(controller, message)
    .catch((): CookieResult<never> => ({ ok: false, reason: 'browser-operation-failed' }))
    .then(result => ({ channel: CHANNEL, version: VERSION, type: message.type, result }))
}

function validValue(type: Command, value: unknown) {
  if (type === 'save' || type === 'close')
    return value === null
  if (type === 'export')
    return typeof value === 'string' && value.length <= COOKIE_FILE_LIMIT
  if (type === 'delete' || type === 'import') {
    return Array.isArray(value) && value.length <= COOKIE_BATCH_LIMIT && value.every(item => isRecord(item)
      && id(item.id) && typeof item.ok === 'boolean'
      && (item.ok ? item.reason === undefined : typeof item.reason === 'string' && ERROR_CODES.has(item.reason)))
  }
  if (!isRecord(value))
    return false
  if (type === 'prepare') {
    return id(value.token) && (value.scope === 'all' || value.scope === 'current')
      && (value.hostname === null || typeof value.hostname === 'string')
      && Array.isArray(value.origins) && value.origins.length > 0 && value.origins.length <= 2
      && value.origins.every(origin => typeof origin === 'string' && /^https?:\/\/[^/]+\/\*$/.test(origin))
  }
  if (!id(value.id) || !Array.isArray(value.entries) || value.entries.length > COOKIE_LIMIT)
    return false
  if (!value.entries.every(entry => isRecord(entry) && id(entry.id) && normalizeCookie(entry.cookie)))
    return false
  if (type === 'preview')
    return value.entries.every(entry => typeof entry.replaces === 'boolean')
  return (value.scope === 'all' || value.scope === 'current')
    && (value.hostname === null || typeof value.hostname === 'string')
    && Array.isArray(value.stores) && value.stores.every(id)
}

export class CookieManagerClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}

  private async request<K extends Command>(type: K, fields: CommandFields[K]): Promise<CookieResult<CommandValues[K]>> {
    let response: unknown
    try {
      response = await this._transport.sendMessage({ channel: CHANNEL, version: VERSION, type, ...fields })
    }
    catch {
      return { ok: false, reason: 'transport-error' }
    }
    if (!isRecord(response) || response.channel !== CHANNEL || response.version !== VERSION
      || response.type !== type || !isRecord(response.result)) {
      return { ok: false, reason: 'invalid-response' }
    }
    const result = response.result
    if (result.ok === false && typeof result.reason === 'string' && ERROR_CODES.has(result.reason))
      return { ok: false, reason: result.reason }
    return result.ok === true && validValue(type, result.value)
      ? { ok: true, value: structuredClone(result.value) as CommandValues[K] }
      : { ok: false, reason: 'invalid-response' }
  }

  prepare(scope: CookieScope) { return this.request('prepare', { scope }) }
  open(token: string) { return this.request('open', { token }) }
  refresh(snapshotId: string) { return this.request('refresh', { snapshotId }) }
  save(snapshotId: string, cookie: ManagedCookie, entryId?: string) {
    return this.request('save', { snapshotId, cookie, ...(entryId ? { entryId } : {}) })
  }

  delete(snapshotId: string, entryIds: string[]) { return this.request('delete', { snapshotId, entryIds }) }
  export(snapshotId: string, entryIds: string[]) { return this.request('export', { snapshotId, entryIds }) }
  preview(snapshotId: string, text: string, storeId: string) { return this.request('preview', { snapshotId, text, storeId }) }
  import(snapshotId: string, previewId: string, entryIds: string[]) {
    return this.request('import', { snapshotId, previewId, entryIds })
  }

  close(snapshotId: string) { return this.request('close', { snapshotId }) }
}
