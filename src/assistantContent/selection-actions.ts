import type { PageActionClient } from '~/workspace/page-actions'
import type { PageToolsSnapshot, ToolbarSettings } from '~/workspace/page-tools'
import { surfaceIcon } from './surface-icons'

export const pageOutputLanguages = [['zh-CN', '中文（简体）'], ['zh-TW', '中文（繁體）'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español']]

export const selectionActionStyles = `
  .selection-picker{width:min(360px,calc(100vw - 16px));max-width:calc(100vw - 16px);padding:10px;border-radius:16px;gap:8px;grid-template-rows:auto auto minmax(0,1fr) auto auto;overflow:hidden;margin:10px 8px}
  @supports(position-area:block-end){.page-options.selection-picker{position-area:block-end span-all;justify-self:anchor-center;max-height:calc(100% - 20px);position-try-order:most-block-size}}
  .selection-picker header{display:flex;justify-content:space-between;align-items:center;padding:2px 4px;font-weight:600}
  .selection-language{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px}
  .selection-language select{min-width:0;max-width:65%;font:inherit;background:transparent;color:inherit;border:1px solid #89879566;border-radius:7px;padding:4px}
  .selection-language option{background:#fff;color:#353542}
  @media(prefers-color-scheme:dark){.selection-language option{background:#25262c;color:#eaeaf1}}
  .selection-actions{position:relative;display:grid;gap:2px;max-height:min(50vh,440px);overflow:auto;overscroll-behavior:contain;padding:3px}
  .selection-action{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr) 24px 24px 28px;gap:3px;align-items:center;border-radius:8px;min-width:0;scroll-margin:8px}
  .selection-action:focus-within{outline:1px solid #a893e8;outline-offset:1px}
  .selection-action .selection-run{display:flex;align-items:center;gap:10px;min-width:0;padding:7px 8px;color:inherit}
  .selection-action .selection-run svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .selection-picker .icon-button{min-width:28px;min-height:28px;width:28px;padding:5px;border-radius:6px;background:transparent;color:inherit}
  .selection-picker .icon-button[aria-pressed=true]{color:#a08aff;background:#9780e31a}
  .selection-picker button:hover{background:#9780e31a}
  .selection-picker small{padding:0 4px;opacity:.7;font-size:11px}
  .selection-picker .picker-status{font-size:12px;padding:0 4px;min-height:18px;overflow-wrap:anywhere}
  .selection-picker .picker-status:empty{display:none}
  .selection-picker .reorder-handle{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}
  .selection-picker.dragging,.selection-picker.dragging *{cursor:grabbing}
  .selection-picker .is-dragging{pointer-events:none;z-index:2;scale:1.02;box-shadow:0 4px 18px #15131b55;background:Canvas}
  .selection-picker [aria-disabled=true]{opacity:.3}
  .selection-actions[data-drop]::after{content:'';position:fixed;pointer-events:none;left:var(--drop-x);top:var(--drop-y);width:var(--drop-w);height:3px;border-radius:3px;background:var(--drop-marker-color,#9c86e9);z-index:4}
  @media(forced-colors:active){.selection-actions{--drop-marker-color:Highlight}}
`

/** Owns selection action disclosure and confirmed local preferences; never owns page writes. */
export class SelectionActionsSurface {
  readonly root: HTMLElement
  private readonly list: HTMLElement & { moveBefore?: (_node: Node, _reference: Node | null) => void }
  private readonly status: HTMLElement
  private readonly language: HTMLSelectElement
  private readonly rows = new Map<string, { node: HTMLElement, pin: HTMLButtonElement, handle: HTMLButtonElement, up: HTMLButtonElement, down: HTMLButtonElement }>()
  private snapshot: PageToolsSnapshot | null = null
  private actions: string[][] = []
  private pending = Promise.resolve()
  private disposed = false
  private generation = 0
  private saving = 0
  private drag: { id: string, pointer: number, handle: HTMLButtonElement, start: number, last: number, scroll: number, target: number } | undefined
  private frame: number | undefined
  private frameTime = 0
  private announcementTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly _document: Document, private readonly _client: PageActionClient, private readonly _options: {
    run: (_id: string) => Promise<void>
    changed: (_settings: ToolbarSettings) => void
    error: (_error: unknown) => void
  }) {
    this.root = this.node('div', '', 'menu page-options toolbar-options selection-picker')
    this.root.setAttribute('role', 'group')
    this.root.setAttribute('aria-label', '更多选文操作')
    const header = this.node('header', '选文操作')
    const label = this.node('label', '翻译成', 'selection-language')
    this.language = this.node('select')
    this.language.setAttribute('aria-label', '选文翻译目标语言')
    for (const [value, name] of pageOutputLanguages) {
      const option = this.node('option', name)
      option.value = value
      this.language.append(option)
    }
    this.language.addEventListener('change', (event) => {
      if (!event.isTrusted)
        return
      const language = this.language.value
      this.save(settings => ({ ...settings, language }))
    })
    label.append(this.language)
    this.list = this.node('div', '', 'selection-actions')
    this.status = this.node('div', '', 'picker-status')
    this.status.setAttribute('role', 'status')
    this.root.append(header, label, this.list, this.node('small', '固定常用动作到工具条，最多四项。'), this.status)
    this.list.addEventListener('pointermove', this.onPointerMove)
    this.list.addEventListener('pointerup', this.onPointerUp)
    this.list.addEventListener('pointercancel', () => this.cancelDrag())
    this.list.addEventListener('lostpointercapture', (event) => {
      if (this.drag?.pointer === event.pointerId)
        this.cancelDrag()
    })
    this.list.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.drag) {
        event.preventDefault()
        event.stopPropagation()
        this.cancelDrag()
        this.status.textContent = '已取消排序'
      }
    })
    this.root.addEventListener('toggle', (event) => {
      if ((event as ToggleEvent).newState === 'closed')
        this.cancelDrag()
    })
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const node = this._document.createElement(tag)
    node.textContent = text
    node.className = className
    return node
  }

  private button(label: string, run: () => void | Promise<void>, icon?: string) {
    const button = this.node('button', icon ? '' : label)
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.title = label
    if (icon) {
      button.className = 'icon-button'
      button.append(surfaceIcon(this._document, icon))
    }
    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', (event) => {
      if (!event.isTrusted || this.disposed)
        return
      void Promise.resolve().then(run).catch((error) => {
        if (!this.disposed)
          this.status.textContent = error instanceof Error ? error.message : '操作失败'
      })
    })
    return button
  }

  get pinnedActions() {
    const pinned = this.snapshot?.toolbar.pinned ?? this.actions.slice(0, 4).map(([id]) => id)
    return this.actions.filter(([id]) => pinned.includes(id)).slice(0, 4)
  }

  configure(snapshot: PageToolsSnapshot, actions: string[][]) {
    this.cancelDrag()
    this.generation++
    this.snapshot = snapshot
    this.actions = actions.map(action => [...action])
    this.language.value = snapshot.toolbar.language ?? 'zh-CN'
    this.list.replaceChildren()
    this.rows.clear()
    this.status.textContent = ''
    for (const [id, title] of this.actions) {
      const row = this.node('div', '', 'selection-action')
      row.setAttribute('role', 'group')
      row.setAttribute('aria-label', `动作 ${title}`)
      const execute = this.button(title, async () => {
        const generation = this.generation
        await this.pending
        if (this.disposed || generation !== this.generation)
          return
        try {
          await this._options.run(id)
        }
        catch (error) { this._options.error(error) }
      })
      execute.className = 'selection-run'
      execute.prepend(surfaceIcon(this._document, id))
      const handle = this.button(`拖动排序：${title}`, () => {}, 'grip')
      handle.title = `拖动排序：${title}，或使用上移与下移按钮`
      handle.classList.add('reorder-handle')
      handle.addEventListener('pointerdown', (event) => {
        if (!event.isTrusted || event.button !== 0 || this.drag || this.saving)
          return
        event.preventDefault()
        for (const { node } of this.rows.values())
          node.getAnimations().forEach(animation => animation.finish())
        handle.focus({ preventScroll: true })
        handle.setPointerCapture(event.pointerId)
        this.drag = { id, pointer: event.pointerId, handle, start: event.clientY, last: event.clientY, scroll: this.list.scrollTop, target: this.actions.findIndex(([key]) => key === id) }
        row.classList.add('is-dragging')
        this.root.classList.add('dragging')
        this.frameTime = 0
        this.frame = this._document.defaultView!.requestAnimationFrame(this.scrollDrag)
      })
      const up = this.button(`上移动作 ${title}`, () => this.moveAction(id, this.actions.findIndex(([key]) => key === id) - 1, up), 'up')
      const down = this.button(`下移动作 ${title}`, () => this.moveAction(id, this.actions.findIndex(([key]) => key === id) + 1, down), 'down')
      const pin = this.button(`固定到工具条：${title}`, () => {
        this.save((settings) => {
          const pinned = settings.pinned ?? this.actions.slice(0, 4).map(([id]) => id)
          return { ...settings, pinned: pinned.includes(id) ? pinned.filter(value => value !== id) : [...pinned, id] }
        })
      }, 'pin')
      row.append(handle, execute, up, down, pin)
      this.rows.set(id, { node: row, pin, handle, up, down })
      this.list.append(row)
    }
    this.refreshPins()
    this.refreshMovement()
  }

  private refreshPins() {
    const pinned = this.pinnedActions.map(([id]) => id)
    for (const [id, { pin }] of this.rows)
      pin.setAttribute('aria-pressed', String(pinned.includes(id)))
  }

  private save(change: (_settings: ToolbarSettings) => ToolbarSettings, saved?: () => void, message = '已保存工具条设置', delayed = false) {
    this.saving++
    this.pending = this.pending.then(async () => {
      if (this.disposed || !this.snapshot) {
        this.saving--
        return
      }
      const settings = change(structuredClone(this.snapshot.toolbar))
      this.status.textContent = '正在保存…'
      try {
        const confirmed = await this._client.request<ToolbarSettings>('toolbar-save', { settings })
        if (this.disposed)
          return
        this.snapshot.toolbar = confirmed
        this.language.value = confirmed.language ?? 'zh-CN'
        saved?.()
        this.refreshPins()
        this._options.changed(confirmed)
        clearTimeout(this.announcementTimer)
        if (delayed) {
          this.status.textContent = ''
          this.announcementTimer = setTimeout(() => {
            if (!this.disposed)
              this.status.textContent = message
          }, 500)
        }
        else {
          this.status.textContent = message
        }
      }
      catch (error) {
        if (this.disposed)
          return
        this.language.value = this.snapshot.toolbar.language ?? 'zh-CN'
        this.status.textContent = error instanceof Error ? error.message : '设置保存失败，请重试'
      }
      finally {
        this.saving--
      }
    })
  }

  private refreshMovement() {
    this.actions.forEach(([id], index) => {
      const row = this.rows.get(id)!
      row.up.setAttribute('aria-disabled', String(index === 0))
      row.down.setAttribute('aria-disabled', String(index === this.actions.length - 1))
    })
  }

  private moveAction(id: string, target: number, focus: HTMLButtonElement) {
    if (this.disposed || this.saving || target < 0 || target >= this.actions.length)
      return
    const ids = this.actions.map(([id]) => id)
    const previous = ids.indexOf(id)
    if (previous === target)
      return
    ids.splice(previous, 1)
    ids.splice(target, 0, id)
    const title = this.actions.find(([key]) => key === id)![1]
    this.save(settings => ({
      ...settings,
      pinned: settings.pinned ?? this.pinnedActions.map(([id]) => id),
      order: [...ids, ...settings.order.filter(id => !ids.includes(id))].slice(0, 128),
    }), () => {
      const before = new Map([...this.rows].map(([id, { node }]) => [id, node.getBoundingClientRect()]))
      this.actions.sort((a, b) => ids.indexOf(a[0]) - ids.indexOf(b[0]))
      for (const key of ids) {
        const node = this.rows.get(key)!.node
        if (typeof this.list.moveBefore === 'function')
          this.list.moveBefore(node, null)
        else
          this.list.append(node)
      }
      this.refreshMovement()
      this.rows.get(id)!.node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      focus.focus({ preventScroll: true })
      if (!this._document.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const [key, { node }] of this.rows) {
          const old = before.get(key)!
          const current = node.getBoundingClientRect()
          if (old.x !== current.x || old.y !== current.y)
            node.animate([{ translate: `${old.x - current.x}px ${old.y - current.y}px` }, { translate: '0px 0px' }], { duration: 160, easing: 'ease-out' })
        }
      }
    }, `顺序已保存：${title}，第 ${target + 1} 项`, typeof this.list.moveBefore !== 'function')
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer)
      return
    this.drag.last = event.clientY
    this.updateDrop()
  }

  private updateDrop() {
    const drag = this.drag
    if (!drag)
      return
    const bounds = this.list.getBoundingClientRect()
    const position = Math.max(bounds.top, Math.min(drag.last, bounds.bottom)) - bounds.top + this.list.scrollTop - this.list.clientTop
    const others = this.actions.filter(([id]) => id !== drag.id)
    const index = others.findIndex(([id]) => {
      const node = this.rows.get(id)!.node
      return node.offsetTop + node.offsetHeight / 2 > position
    })
    drag.target = index < 0 ? others.length : index
    const moving = this.rows.get(drag.id)!.node
    moving.style.translate = `0px ${drag.last - drag.start + this.list.scrollTop - drag.scroll}px`
    if (drag.target === this.actions.findIndex(([id]) => id === drag.id)) {
      this.list.removeAttribute('data-drop')
      return
    }
    const reference = others[drag.target] ? this.rows.get(others[drag.target][0])!.node : undefined
    const previous = drag.target > 0 ? this.rows.get(others[drag.target - 1][0])!.node : undefined
    const y = reference ? reference.getBoundingClientRect().top - 2 : previous!.getBoundingClientRect().bottom + 1
    this.list.dataset.drop = 'true'
    this.list.style.setProperty('--drop-x', `${bounds.left + 3}px`)
    this.list.style.setProperty('--drop-y', `${Math.max(bounds.top, Math.min(y, bounds.bottom))}px`)
    this.list.style.setProperty('--drop-w', `${bounds.width - 6}px`)
  }

  private readonly scrollDrag = (time: number) => {
    const drag = this.drag
    if (!drag)
      return
    const bounds = this.list.getBoundingClientRect()
    const zone = Math.min(this.rows.get(drag.id)!.node.offsetHeight, bounds.height / 3)
    const elapsed = this.frameTime ? Math.min(time - this.frameTime, 40) : 0
    this.frameTime = time
    const edge = drag.last < bounds.top + zone ? drag.last - bounds.top - zone : drag.last > bounds.bottom - zone ? drag.last - bounds.bottom + zone : 0
    this.list.scrollTop += Math.max(-800, Math.min(800, edge * 12)) * elapsed / 1000
    this.updateDrop()
    this.frame = this._document.defaultView!.requestAnimationFrame(this.scrollDrag)
  }

  private readonly onPointerUp = (event: PointerEvent) => {
    const drag = this.drag
    if (!drag || event.pointerId !== drag.pointer)
      return
    this.cancelDrag()
    this.moveAction(drag.id, drag.target, drag.handle)
  }

  private cancelDrag() {
    const drag = this.drag
    this.drag = undefined
    if (this.frame !== undefined)
      this._document.defaultView!.cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.list.removeAttribute('data-drop')
    for (const property of ['--drop-x', '--drop-y', '--drop-w'])
      this.list.style.removeProperty(property)
    this.root.classList.remove('dragging')
    if (!drag)
      return
    const row = this.rows.get(drag.id)?.node
    if (row) {
      row.style.translate = ''
      row.classList.remove('is-dragging')
    }
    if (drag.handle.hasPointerCapture(drag.pointer))
      drag.handle.releasePointerCapture(drag.pointer)
  }

  dispose() {
    this.cancelDrag()
    clearTimeout(this.announcementTimer)
    this.disposed = true
    this.generation++
  }
}
