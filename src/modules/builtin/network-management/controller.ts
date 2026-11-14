import type { InstalledModuleRecord } from '../../types'
import type { NetworkResult, NetworkSettings } from './contracts'
import { CLASH_CONTROL_MODULE_ID } from '../clash-control/contracts'
import {
  DEFAULT_NETWORK_SETTINGS,
  hasNetworkPageOptions,
  isNetworkSettings,
  isRecord,
  isWebRtcPolicy,
  NETWORK_HOST_PERMISSIONS,
  NETWORK_SCRIPT_IDS,
  NETWORK_SETTINGS_STORAGE_KEY,
} from './contracts'

export interface NetworkControllerOptions {
  registry: { get: (_moduleId: string) => Promise<unknown> }
  storage: {
    get: (_key: string) => Promise<Record<string, unknown>>
    set: (_items: Record<string, unknown>) => Promise<void>
  }
  permissions: { contains: (_details: { permissions?: string[], origins?: string[] }) => Promise<boolean> }
  privacy?: {
    get: (_details: Record<string, never>) => Promise<{ value: unknown, levelOfControl: string }>
    set: (_details: { value: string, scope: 'regular_only' }) => Promise<void>
    clear: (_details: { scope: 'regular_only' }) => Promise<void>
  }
  scripting?: {
    getRegisteredContentScripts: (_filter: { ids: string[] }) => Promise<NetworkRegisteredScript[]>
    registerContentScripts: (_scripts: NetworkRegisteredScript[]) => Promise<void>
    unregisterContentScripts: (_filter: { ids: string[] }) => Promise<void>
  }
}
export interface NetworkRegisteredScript {
  id: string
  js?: string[]
  matches?: string[]
  world?: 'MAIN' | 'ISOLATED'
  runAt?: 'document_start' | 'document_end' | 'document_idle'
  allFrames?: boolean
  persistAcrossSessions?: boolean
  matchOriginAsFallback?: boolean
}

export class NetworkManagementController {
  private settings: NetworkSettings = { ...DEFAULT_NETWORK_SETTINGS }
  private loaded: Promise<void> | null = null
  private pagesActive = false
  private pagesApplying = false
  private writeStarted = false
  private generation = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly _options: NetworkControllerOptions) {}

  private load() {
    this.loaded ??= this._options.storage.get(NETWORK_SETTINGS_STORAGE_KEY).then((stored) => {
      const raw = stored[NETWORK_SETTINGS_STORAGE_KEY]
      if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 1 && 'settings' in raw && isNetworkSettings(raw.settings))
        this.settings = { ...raw.settings }
    })
    return this.loaded
  }

  private run(operation: () => Promise<NetworkResult>) {
    const result = this.queue.then(operation).catch((): NetworkResult => ({ ok: false, reason: 'browser-operation-failed' }))
    this.queue = result.then(() => undefined)
    return result
  }

  private checkGeneration(generation: number) {
    if (generation !== this.generation)
      throw new Error('lifecycle-cancelled')
  }

  status(): Promise<NetworkResult> {
    return this.run(() => this.readStatus())
  }

  private async readStatus(requestedSettings?: NetworkSettings): Promise<NetworkResult> {
    await this.load()
    const settings = requestedSettings ?? this.settings
    const privacyPermission = await this._options.permissions.contains({ permissions: ['privacy'] })
    const actual = privacyPermission && this._options.privacy ? await this._options.privacy.get({}) : null
    const hostPermission = await this._options.permissions.contains({ origins: NETWORK_HOST_PERMISSIONS })
    const scripts = this._options.scripting ? await this._options.scripting.getRegisteredContentScripts({ ids: NETWORK_SCRIPT_IDS }) : []
    const desired = this.desiredScripts(settings)
    const scriptsMatch = scripts.length === desired.length && desired.every(script => scripts.some(candidate =>
      candidate.id === script.id && candidate.world === script.world && candidate.runAt === script.runAt
      && candidate.allFrames === true && candidate.matchOriginAsFallback === true && candidate.persistAcrossSessions === true
      && JSON.stringify(candidate.js) === JSON.stringify(script.js)
      && candidate.matches?.length === 2 && NETWORK_HOST_PERMISSIONS.every(pattern => candidate.matches?.includes(pattern)),
    ))
    const scriptsActive = scripts.length > 0
    this.pagesActive = scriptsActive
    return {
      ok: true,
      value: {
        settings: { ...settings },
        actualPolicy: isWebRtcPolicy(actual?.value) ? actual.value : null,
        levelOfControl: actual?.levelOfControl ?? null,
        privacyPermission,
        hostPermission,
        scriptsActive,
        protected: settings.enabled && settings.policy !== 'default' && actual?.value === settings.policy && actual.levelOfControl === 'controlled_by_this_extension'
          && scriptsMatch && (!hasNetworkPageOptions(settings) || hostPermission),
      },
    }
  }

  private desiredScripts(settings: NetworkSettings): NetworkRegisteredScript[] {
    const enabled = [settings.blockSupport, settings.blockDevices, settings.blockAdditional]
    return NETWORK_SCRIPT_IDS.filter((_id, index) => enabled[index]).map(id => ({
      id,
      js: [`dist/network/${id.slice('oneweb-network-'.length)}.js`],
      matches: [...NETWORK_HOST_PERMISSIONS],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    }))
  }

  usesOriginPattern(pattern: string) {
    return (this.pagesActive || this.pagesApplying) && /^https?:\/\//.test(pattern)
  }

  apply(settings: NetworkSettings): Promise<NetworkResult> {
    if (!isNetworkSettings(settings))
      return Promise.resolve({ ok: false, reason: 'invalid-input' })
    if (!settings.enabled || settings.policy === 'default')
      this.generation++
    const generation = this.generation
    const copied = { ...settings }
    return this.run(() => this.applySettings(copied, generation))
  }

  private async applySettings(settings: NetworkSettings, generation: number): Promise<NetworkResult> {
    this.writeStarted = false
    try {
      return await this.performApply(settings, generation)
    }
    catch (error) {
      if (this.writeStarted) {
        try {
          await this.stop({ ...settings, enabled: false })
        }
        catch {}
      }
      return { ok: false, reason: error instanceof Error && error.message === 'lifecycle-cancelled' ? 'lifecycle-cancelled' : 'browser-operation-failed' }
    }
    finally {
      this.pagesApplying = false
    }
  }

  private async performApply(settings: NetworkSettings, generation: number): Promise<NetworkResult> {
    this.pagesApplying = settings.enabled && settings.policy !== 'default' && hasNetworkPageOptions(settings)
    await this.load()
    this.checkGeneration(generation)
    if (!isNetworkSettings(settings))
      return { ok: false, reason: 'invalid-input' }
    if (!settings.enabled || settings.policy === 'default')
      return this.stop({ ...settings, enabled: false })
    const record = await this._options.registry.get(CLASH_CONTROL_MODULE_ID)
    this.checkGeneration(generation)
    if (!isRecord(record) || record.enabled !== true)
      return { ok: false, reason: 'module-disabled' }
    if (!await this._options.permissions.contains({ permissions: ['privacy'] }))
      return { ok: false, reason: 'permission-required' }
    if (!this._options.privacy)
      return { ok: false, reason: 'unsupported' }
    if (hasNetworkPageOptions(settings)) {
      if (!await this._options.permissions.contains({ origins: NETWORK_HOST_PERMISSIONS }))
        return { ok: false, reason: 'host-permission-required' }
      if (!this._options.scripting)
        return { ok: false, reason: 'unsupported' }
    }
    const current = await this._options.privacy.get({})
    this.checkGeneration(generation)
    if (!['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current.levelOfControl))
      return { ok: false, reason: 'control-conflict' }
    this.writeStarted = true
    await this._options.privacy.set({ value: settings.policy, scope: 'regular_only' })
    this.checkGeneration(generation)
    if (this._options.scripting) {
      this.pagesApplying = hasNetworkPageOptions(settings)
      await this.unregisterOwnScripts()
      this.checkGeneration(generation)
      const scripts = this.desiredScripts(settings)
      if (scripts.length)
        await this._options.scripting.registerContentScripts(scripts)
      this.checkGeneration(generation)
    }
    const observed = await this.readStatus(settings)
    this.checkGeneration(generation)
    if (!observed.ok || !observed.value.protected) {
      await this.stop({ ...settings, enabled: false })
      return { ok: false, reason: observed.ok && (observed.value.actualPolicy !== settings.policy || observed.value.levelOfControl !== 'controlled_by_this_extension') ? 'control-conflict' : 'unsupported' }
    }
    await this._options.storage.set({ [NETWORK_SETTINGS_STORAGE_KEY]: { version: 1, settings } })
    this.checkGeneration(generation)
    this.settings = { ...settings }
    const finalStatus = await this.readStatus()
    this.checkGeneration(generation)
    return finalStatus
  }

  disable(): Promise<NetworkResult> {
    this.generation++
    return this.run(async () => {
      await this.load()
      return this.stop({ ...this.settings, enabled: false })
    })
  }

  startup(): Promise<NetworkResult> {
    const generation = this.generation
    return this.run(async () => {
      await this.load()
      this.checkGeneration(generation)
      if (this.settings.enabled) {
        const result = await this.applySettings({ ...this.settings }, generation)
        if (result.ok)
          return result
        await this.stop({ ...this.settings, enabled: false })
        return result
      }
      return this.stop({ ...this.settings, enabled: false })
    })
  }

  handleInstalledRecordChanged(record: InstalledModuleRecord) {
    if (record.manifest.id === CLASH_CONTROL_MODULE_ID && !record.enabled)
      return this.disable()
    return Promise.resolve()
  }

  handlePermissionsRemoved(permissions: { permissions?: string[], origins?: string[] }) {
    if (!permissions.permissions?.includes('privacy') && !permissions.origins?.length)
      return Promise.resolve()
    this.generation++
    return this.run(async () => {
      await this.load()
      const privacy = await this._options.permissions.contains({ permissions: ['privacy'] })
      const hosts = !hasNetworkPageOptions(this.settings) || await this._options.permissions.contains({ origins: NETWORK_HOST_PERMISSIONS })
      return !privacy || !hosts ? this.stop({ ...this.settings, enabled: false }) : this.readStatus()
    })
  }

  private async stop(settings: NetworkSettings): Promise<NetworkResult> {
    this.pagesApplying = false
    let failed = false
    try {
      await this.unregisterOwnScripts()
      this.pagesActive = false
    }
    catch { failed = true }
    try {
      if (this._options.privacy && await this._options.permissions.contains({ permissions: ['privacy'] }))
        await this._options.privacy.clear({ scope: 'regular_only' })
    }
    catch { failed = true }
    this.settings = { ...settings }
    try {
      await this._options.storage.set({ [NETWORK_SETTINGS_STORAGE_KEY]: { version: 1, settings } })
    }
    catch { failed = true }
    if (failed)
      return { ok: false, reason: 'browser-operation-failed' }
    return this.readStatus()
  }

  private async unregisterOwnScripts() {
    if (!this._options.scripting)
      return
    const registered = await this._options.scripting.getRegisteredContentScripts({ ids: NETWORK_SCRIPT_IDS })
    const ids = registered.map(script => script.id).filter(id => NETWORK_SCRIPT_IDS.includes(id))
    if (ids.length)
      await this._options.scripting.unregisterContentScripts({ ids })
  }
}
