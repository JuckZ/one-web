import type { PageToolboxRuntimeBindingV1, PageToolPlanV1 } from '../modules/builtin/page-toolbox/contracts'
import type { PageToolId } from '../modules/builtin/page-toolbox/tool-catalog'
import type { UserscriptManager, UserscriptMenuId } from './gm'
import { PageToolboxDomRuntime } from '../modules/builtin/page-toolbox/dom-runtime'
import { getDefaultPageToolSettings, isPageToolId, PAGE_TOOL_IDS } from '../modules/builtin/page-toolbox/tool-catalog'
import { normalizePageToolExactOrigin } from '../modules/builtin/page-toolbox/validation'
import { UserscriptControl, userscriptToolTitle } from './control'

const prefix = 'oneweb.userscript.v1:'
export function userscriptApprovalKey(origin: string) {
  return `${prefix}${origin}:approved`
}
export function userscriptToolKey(origin: string, toolId: PageToolId) {
  return `${prefix}${origin}:tool:${toolId}`
}

/** GM is a separate host: it never impersonates an extension permission or lifecycle port. */
export class UserscriptController {
  readonly origin: string
  private readonly window: Window
  private readonly manager: UserscriptManager
  private runtime: PageToolboxDomRuntime | null = null
  private control: UserscriptControl | null = null
  private readonly menus: UserscriptMenuId[] = []
  private readonly listeners: number[] = []
  private epoch = 0
  private loadSequence = 0
  private generation = 0
  private running = false
  private suspended = false
  private destroyed = false
  private approved = false
  private pending = false
  private blocked = false
  private error = ''
  private enabled: PageToolId[] = []
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly document: Document, manager: UserscriptManager) {
    const window = document.defaultView
    const origin = normalizePageToolExactOrigin(window?.location.origin)
    if (!window || window.top !== window || !origin)
      throw new TypeError('OneWeb userscript requires a top-level HTTP(S) document')
    this.window = window
    this.manager = manager
    this.origin = origin
  }

  async start() {
    if (this.running || this.destroyed)
      return false
    this.running = true
    this.suspended = false
    this.epoch++
    this.window.addEventListener('pagehide', this.onPageHide)
    this.window.addEventListener('pageshow', this.onPageShow)
    try {
      for (const key of this.keys()) {
        this.listeners.push(this.manager.listen(key, (remote) => {
          if (remote && this.running)
            void this.refresh()
        }))
      }
      return await this.refresh()
    }
    catch {
      // No tool may run without a working remote-revocation subscription.
      this.dispose()
      return false
    }
  }

  async refresh() {
    const epoch = this.epoch
    const sequence = ++this.loadSequence
    if (!this.running || this.destroyed)
      return false
    try {
      const values = await Promise.all(this.keys().map(key => this.manager.get(key, false)))
      if (!this.current(epoch) || sequence !== this.loadSequence)
        return false
      this.approved = values[0] === true && !this.blocked
      this.enabled = PAGE_TOOL_IDS.filter((_toolId, index) => values[index + 1] === true)
      if (!this.approved) {
        this.drain()
      }
      else {
        this.applyTools()
      }
      this.renderMenus()
      return true
    }
    catch {
      if (this.current(epoch) && sequence === this.loadSequence)
        this.failClosed('无法读取脚本设置，已停止当前页面工具。')
      return false
    }
  }

  async approve() {
    return this.write(async () => {
      await this.manager.set(userscriptApprovalKey(this.origin), true)
    }, false, () => {
      this.blocked = false
      this.error = ''
    })
  }

  async toggle(toolId: PageToolId, enabled: boolean) {
    if (!isPageToolId(toolId) || typeof enabled !== 'boolean' || !this.approved || this.blocked)
      return false
    return this.write(async (current) => {
      if (await this.manager.get(userscriptApprovalKey(this.origin), false) !== true)
        throw new Error('Site approval changed')
      if (!current())
        return
      await this.manager.set(userscriptToolKey(this.origin, toolId), enabled)
    })
  }

  async disable() {
    if (!this.running || this.destroyed)
      return false
    this.stopLocally()
    return this.write(async () => {
      await this.manager.set(userscriptApprovalKey(this.origin), false)
    }, true, () => { this.error = '' })
  }

  async forget() {
    if (!this.running || this.destroyed)
      return false
    this.stopLocally()
    return this.write(async (current) => {
      // Revoke first, so partial deletion never leaves a site enabled.
      await this.manager.set(userscriptApprovalKey(this.origin), false)
      for (const key of this.keys().slice(1)) {
        if (!current())
          return
        await this.manager.delete(key)
      }
      if (!current())
        return
      await this.manager.delete(userscriptApprovalKey(this.origin))
    }, true, () => {
      this.enabled = []
      this.error = ''
    })
  }

  open() { this.control?.open() }

  dispose() {
    if (this.destroyed)
      return
    this.destroyed = true
    this.suspend()
    this.window.removeEventListener('pagehide', this.onPageHide)
    this.window.removeEventListener('pageshow', this.onPageShow)
  }

  private async write(operation: (_current: () => boolean) => Promise<void>, interrupt = false, onSaved?: () => void) {
    if (!this.running || this.destroyed || (this.pending && !interrupt))
      return false
    const epoch = this.epoch
    this.pending = true
    this.control?.update(this.enabled, true)
    // A dispatched manager write cannot be aborted. Queue revocation/deletion after it,
    // while stopLocally already drains the DOM and invalidates its completion.
    const previousWrite = this.writes
    let release!: () => void
    this.writes = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await previousWrite
      if (!interrupt && !this.current(epoch))
        return false
      // Explicit revocation is a durable setting change, even after the initiating UI exits.
      // Only publishing DOM/UI state remains bound to the document epoch.
      await operation(() => interrupt || this.current(epoch))
      if (!this.current(epoch))
        return false
      onSaved?.()
      this.pending = false
      return await this.refresh()
    }
    catch {
      if (this.current(epoch))
        this.failClosed('无法保存脚本设置，已停止当前页面工具。请在油猴菜单中重新启用。')
      return false
    }
    finally {
      release()
      if (this.current(epoch)) {
        this.pending = false
        this.control?.update(this.enabled, false)
      }
    }
  }

  private applyTools() {
    const plans: PageToolPlanV1[] = this.enabled.map(toolId => ({ toolId, settings: getDefaultPageToolSettings(toolId) }))
    if (!this.runtime) {
      const binding: PageToolboxRuntimeBindingV1 = {
        moduleId: 'dev.oneweb.page-toolbox',
        exactOrigin: this.origin,
        tabId: 0,
        frameId: 0,
        navigationId: `userscript:${Array.from(this.window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`,
        generation: ++this.generation,
      }
      this.runtime = new PageToolboxDomRuntime(this.document, binding, plans)
    }
    else if (!this.runtime.reconcile(plans)) {
      throw new Error('Unable to reconcile packaged tools')
    }
    if (this.runtime.activeToolIds.join('|') !== [...this.enabled].sort().join('|'))
      throw new Error('A packaged tool could not start')
    this.control ??= new UserscriptControl(this.document, {
      toggle: (toolId, enabled) => { void this.toggle(toolId, enabled) },
      disable: () => { void this.disable() },
      forget: () => { void this.forget() },
    })
    this.control.update(this.enabled, this.pending)
  }

  private renderMenus() {
    this.clearMenus()
    const add = (title: string, action: () => void) => this.menus.push(this.manager.menu(`OneWeb · ${title}`, action))
    if (this.error)
      add(this.error, () => {})
    if (this.approved) {
      add('打开当前站点工具', () => this.open())
      for (const toolId of PAGE_TOOL_IDS) {
        const enabled = this.enabled.includes(toolId)
        add(`${enabled ? '✓' : '○'} ${userscriptToolTitle(toolId)}`, () => {
          void this.toggle(toolId, !enabled)
        })
      }
      add('停用当前站点工具', () => {
        void this.disable()
      })
    }
    else {
      add('启用当前站点工具（默认全部关闭）', () => {
        void this.approve()
      })
    }
    add('忘记当前站点设置', () => {
      void this.forget()
    })
  }

  private stopLocally() {
    this.epoch++
    this.loadSequence++
    this.pending = false
    this.approved = false
    this.blocked = true
    this.drain()
    try {
      this.renderMenus()
    }
    catch {
      this.clearMenus()
    }
  }

  private failClosed(message: string) {
    this.epoch++
    this.loadSequence++
    this.approved = false
    this.pending = false
    this.blocked = true
    this.error = message
    this.drain()
    try {
      this.renderMenus()
    }
    catch {
      this.clearMenus()
    }
  }

  private drain() {
    this.control?.dispose()
    this.control = null
    this.runtime?.dispose('disabled')
    this.runtime = null
  }

  private suspend() {
    this.running = false
    this.epoch++
    this.loadSequence++
    this.pending = false
    this.drain()
    this.clearMenus()
    for (const id of this.listeners.splice(0)) {
      try {
        this.manager.unlisten(id)
      }
      catch { /* A manager failure must not keep page tools alive. */ }
    }
  }

  private clearMenus() {
    for (const id of this.menus.splice(0)) {
      try {
        this.manager.removeMenu(id)
      }
      catch { /* Old callbacks still check the current lifecycle. */ }
    }
  }

  private current(epoch: number) { return this.running && !this.destroyed && this.epoch === epoch }
  private keys() { return [userscriptApprovalKey(this.origin), ...PAGE_TOOL_IDS.map(toolId => userscriptToolKey(this.origin, toolId))] }

  private readonly onPageHide = (event: PageTransitionEvent) => {
    this.suspended = event.persisted
    this.suspend()
    if (!event.persisted)
      this.dispose()
  }

  private readonly onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && this.suspended && !this.destroyed)
      void this.start()
  }
}
