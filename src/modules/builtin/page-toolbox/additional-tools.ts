import type { PageToolAuthorityV1, PageToolJsonValue, PageToolRuntimeBindingV1 } from './contracts'
import type { PageToolResourceAdapter, PageToolResourceEntry } from './resource-ledger'
import type { NightReadingSettingsV1, PageToolId } from './tool-catalog'
import { PageToolResourceLedger } from './resource-ledger'
import { createPageToolAuthority } from './validation'

export interface AdditionalPageTool {
  readonly resourceCount: number
  update: (_settings: PageToolJsonValue) => void
  dispose: () => void
}

interface NodeHandle {
  readonly kind: 'node'
  readonly element: HTMLElement
  readonly parent: Node
  readonly token: string
  readonly observer: MutationObserver
  owned: boolean
  expectedStyle: string | null
}
interface AttributeHandle {
  readonly kind: 'attribute'
  readonly element: HTMLElement
  readonly name: string
  readonly token: string
  readonly expected: string | null
  readonly observer: MutationObserver
  owned: boolean
}
interface ListenerHandle {
  readonly kind: 'listener'
  readonly target: EventTarget
  readonly type: string
  readonly listener: EventListener
  readonly capture: boolean
}
interface ObserverHandle { readonly kind: 'observer', readonly observer: MutationObserver }
interface AnimationHandle { readonly kind: 'animation', readonly window: Window, id: number | null, active: boolean }
interface AnimationLoop { start: () => void, stop: () => void }
type ResourceHandle = NodeHandle | AttributeHandle | ListenerHandle | ObserverHandle | AnimationHandle
type Entry = PageToolResourceEntry<ResourceHandle, string | null>
type WithoutId<Value> = Value extends unknown ? Omit<Value, 'id'> : never
type Registration = WithoutId<Entry>
const nodeOwners = new WeakMap<Element, string>()
const attributeOwners = new WeakMap<Element, Map<string, AttributeHandle>>()
const priorByHandle = new WeakMap<AttributeHandle, { present: boolean, value: string | null }>()
const WIDGET_ATTRIBUTE = 'data-oneweb-page-toolbox-widget'

class ResourceAdapter implements PageToolResourceAdapter<ResourceHandle, string | null> {
  isOwned(entry: Extract<Entry, { kind: 'owned-node' | 'owned-style' | 'dom-prior-value' }>) {
    const handle = entry.handle
    if (handle.kind === 'node') {
      return handle.owned && nodeOwners.get(handle.element) === handle.token
        && handle.element.parentNode === handle.parent
        && handle.element.getAttribute('style') === handle.expectedStyle
        && handle.observer.takeRecords().length === 0
    }
    return handle.kind === 'attribute' && handle.owned
      && attributeOwners.get(handle.element)?.get(handle.name) === handle
      && handle.element.getAttribute(handle.name) === handle.expected
      && handle.observer.takeRecords().length === 0
  }

  release(entry: Exclude<Entry, { kind: 'dom-prior-value' }>) {
    const handle = entry.handle
    if (handle.kind === 'listener') {
      handle.target.removeEventListener(handle.type, handle.listener, handle.capture)
    }
    else if (handle.kind === 'observer') {
      handle.observer.disconnect()
    }
    else if (handle.kind === 'animation') {
      handle.active = false
      if (handle.id !== null)
        handle.window.cancelAnimationFrame(handle.id)
      handle.id = null
    }
    else if (handle.kind === 'node') {
      nodeOwners.delete(handle.element)
      handle.element.remove()
    }
  }

  restore(entry: Extract<Entry, { kind: 'dom-prior-value' }>) {
    const handle = entry.handle
    if (handle.kind !== 'attribute')
      throw new TypeError('Invalid page tool attribute resource')
    if (entry.prior.present)
      handle.element.setAttribute(handle.name, entry.prior.value ?? '')
    else
      handle.element.removeAttribute(handle.name)
    handle.observer.takeRecords()
    handle.owned = false
    if (attributeOwners.get(handle.element)?.get(handle.name) === handle)
      attributeOwners.get(handle.element)?.delete(handle.name)
  }
}

class Resources {
  readonly document: Document
  readonly binding: PageToolRuntimeBindingV1
  private readonly ledger: PageToolResourceLedger<ResourceHandle, string | null>
  private readonly authority: PageToolAuthorityV1
  private sequence = 0

  constructor(document: Document, binding: PageToolRuntimeBindingV1) {
    this.document = document
    this.binding = binding
    this.authority = createPageToolAuthority(binding)
    this.ledger = new PageToolResourceLedger(binding, new ResourceAdapter())
  }

  get size() { return this.ledger.size }

  listen(target: EventTarget, type: string, listener: EventListener, capture = false) {
    target.addEventListener(type, listener, capture)
    this.register({ kind: 'listener', handle: { kind: 'listener', target, type, listener, capture } })
  }

  observe(target: Node, callback: MutationCallback, options: MutationObserverInit) {
    const observer = new this.document.defaultView!.MutationObserver(callback)
    observer.observe(target, options)
    this.register({ kind: 'observer', handle: { kind: 'observer', observer } })
  }

  animation(callback: () => void): AnimationLoop {
    const handle: AnimationHandle = { kind: 'animation', window: this.document.defaultView!, id: null, active: false }
    const tick = () => {
      handle.id = null
      if (!handle.active)
        return
      callback()
      if (handle.active)
        handle.id = handle.window.requestAnimationFrame(tick)
    }
    this.register({ kind: 'timer', handle })
    return {
      start() {
        if (!handle.active) {
          handle.active = true
          handle.id = handle.window.requestAnimationFrame(tick)
        }
      },
      stop() {
        handle.active = false
        if (handle.id !== null)
          handle.window.cancelAnimationFrame(handle.id)
        handle.id = null
      },
    }
  }

  node(element: HTMLElement) {
    const parent = this.document.documentElement
    const token = `${this.binding.toolId}:${this.binding.generation}:${++this.sequence}`
    parent.append(element)
    nodeOwners.set(element, token)
    let handle!: NodeHandle
    const observer = new this.document.defaultView!.MutationObserver(() => {
      handle.owned = false
    })
    handle = { kind: 'node', element, parent, token, observer, owned: true, expectedStyle: element.getAttribute('style') }
    observer.observe(element, { attributes: true, childList: true })
    this.register({ kind: 'observer', handle: { kind: 'observer', observer } })
    this.register({ kind: 'owned-node', handle, ownershipToken: token })
    return handle
  }

  updateNode(handle: NodeHandle, update: () => void) {
    if (!handle.owned || nodeOwners.get(handle.element) !== handle.token || handle.element.parentNode !== handle.parent
      || handle.element.getAttribute('style') !== handle.expectedStyle || handle.observer.takeRecords().length) {
      handle.owned = false
      throw new Error('Page tool overlay was changed by the page')
    }
    update()
    handle.expectedStyle = handle.element.getAttribute('style')
    handle.observer.takeRecords()
  }

  attribute(element: HTMLElement, name: 'hidden' | 'style', value: string | null) {
    const previous = element.getAttribute(name)
    if (previous === value)
      return
    const oldOwner = attributeOwners.get(element)?.get(name)
    const prior = oldOwner?.owned && oldOwner.expected === previous ? priorByHandle.get(oldOwner) : undefined
    const token = `${this.binding.toolId}:${this.binding.generation}:${++this.sequence}`
    let handle!: AttributeHandle
    const observer = new this.document.defaultView!.MutationObserver(() => {
      handle.owned = false
    })
    handle = { kind: 'attribute', element, name, token, expected: value, observer, owned: true }
    const entryPrior = prior ?? { present: element.hasAttribute(name), value: previous }
    priorByHandle.set(handle, entryPrior)
    observer.observe(element, { attributes: true, attributeFilter: [name] })
    if (value === null)
      element.removeAttribute(name)
    else
      element.setAttribute(name, value)
    observer.takeRecords()
    const owners = attributeOwners.get(element) ?? new Map()
    owners.set(name, handle)
    attributeOwners.set(element, owners)
    this.register({ kind: 'observer', handle: { kind: 'observer', observer } })
    this.register({ kind: 'dom-prior-value', handle, ownershipToken: token, property: name, prior: entryPrior })
  }

  dispose() {
    const result = this.ledger.dispose(this.authority)
    if (!result.ok || result.report.results.some(entry => entry.outcome === 'failed'))
      throw new Error('Page tool resource cleanup failed')
  }

  private register(entry: Registration) {
    const resource = { ...entry, id: `resource:${++this.sequence}` } as Entry
    if (!this.ledger.register(this.authority, resource).ok) {
      const adapter = new ResourceAdapter()
      if (resource.kind === 'dom-prior-value') {
        if (adapter.isOwned(resource))
          adapter.restore(resource)
      }
      else {
        adapter.release(resource)
      }
      throw new Error('Unable to register page tool resource')
    }
  }
}

const panelStyle = `
:host{all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483644;pointer-events:none;font:13px/1.5 system-ui,sans-serif;color-scheme:light dark}
.panel{box-sizing:border-box;width:min(340px,calc(100vw - 32px));padding:12px;border:1px solid #c9d0e0;border-radius:12px;background:#fff;color:#172033;box-shadow:0 8px 28px #11182733;pointer-events:auto;max-height:45vh;overflow:auto}
.panel strong,.panel p{display:block;margin:0 0 7px}.panel p{font-size:12px}.panel button,.panel a{font:inherit;line-height:1.5}.panel button{border:1px solid #8793ac;border-radius:7px;padding:4px 9px;background:#f3f5fb;color:inherit;cursor:pointer}.panel a{display:inline-block;margin-inline-end:12px;color:#264fc2;text-decoration:underline}.panel [hidden]{display:none}
.box{position:fixed;box-sizing:border-box;border:2px solid #e25338;background:#e2533810;pointer-events:none}.box.second{border-color:#3b71dc;background:#3b71dc10}
:focus-visible{outline:3px solid #7758cf;outline-offset:3px}
@media(prefers-color-scheme:dark){.panel{background:#181b26;color:#f5f6ff;border-color:#687189}.panel button{background:#272d40}.panel a{color:#b9caff}}
`

function panel(resources: Resources, toolId: PageToolId, title: string, instructions: string) {
  const document = resources.document
  const host = document.createElement('div')
  host.setAttribute(WIDGET_ATTRIBUTE, toolId)
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483644;pointer-events:none'
  if (toolId === 'element-spacing') {
    host.style.top = '16px'
    host.style.bottom = 'auto'
  }
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = panelStyle
  const section = document.createElement('section')
  section.className = 'panel'
  section.setAttribute('aria-label', title)
  const heading = document.createElement('strong')
  heading.textContent = title
  const hint = document.createElement('p')
  hint.textContent = instructions
  section.append(heading, hint)
  shadow.append(style, section)
  resources.node(host)
  return { host, shadow, section }
}

function isToolUi(element: Element) {
  return Boolean(element.closest(`[${WIDGET_ATTRIBUTE}],[data-oneweb-page-toolbox-control],[data-oneweb-userscript-control],[data-oneweb-assistant]`))
}

class Dimmer implements AdditionalPageTool {
  private readonly overlay: HTMLDivElement
  private readonly handle: NodeHandle

  constructor(private readonly resources: Resources, settings: PageToolJsonValue) {
    const overlay = resources.document.createElement('div')
    overlay.setAttribute(WIDGET_ATTRIBUTE, 'night-reading')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.setAttribute('inert', '')
    overlay.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none'
    this.overlay = overlay
    this.handle = resources.node(overlay)
    this.update(settings)
  }

  get resourceCount() { return this.resources.size }

  update(settings: PageToolJsonValue) {
    const { strength } = settings as unknown as NightReadingSettingsV1
    const opacity = { gentle: 0.12, medium: 0.24, strong: 0.36 }[strength]
    this.resources.updateNode(this.handle, () => {
      this.overlay.style.backgroundColor = `rgba(8, 12, 20, ${opacity})`
    })
  }

  dispose() { this.resources.dispose() }
}

const HIDDEN_SCAN_LIMIT = 1500
const HIDDEN_REVEAL_LIMIT = 80
const excludedHiddenTags = new Set(['HEAD', 'TITLE', 'BASE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SOURCE', 'TRACK'])

class HiddenContent implements AdditionalPageTool {
  constructor(private readonly resources: Resources) {
    const document = resources.document
    const body = document.body
    if (!body)
      return
    const walker = document.createTreeWalker(body, 1)
    let visited = 0
    let revealed = 0
    for (let node = walker.nextNode(); node && visited < HIDDEN_SCAN_LIMIT && revealed < HIDDEN_REVEAL_LIMIT; node = walker.nextNode()) {
      visited += 1
      if (!(node instanceof document.defaultView!.HTMLElement) || excludedHiddenTags.has(node.tagName) || isToolUi(node)
        || node.closest('form,button,fieldset,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')
        || node.querySelector('form,button,fieldset,input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) {
        continue
      }
      const computed = document.defaultView!.getComputedStyle(node)
      const hidden = node.hasAttribute('hidden')
      const displayNone = computed.display === 'none'
      const invisible = computed.visibility === 'hidden' || computed.visibility === 'collapse'
      const transparent = computed.opacity === '0'
      if (!hidden && !displayNone && !invisible && !transparent)
        continue
      if (hidden)
        resources.attribute(node, 'hidden', null)
      if (displayNone || invisible || transparent) {
        const proposed = document.createElement('div')
        proposed.style.cssText = node.getAttribute('style') ?? ''
        if (displayNone)
          proposed.style.setProperty('display', 'revert', 'important')
        if (invisible)
          proposed.style.setProperty('visibility', 'visible', 'important')
        if (transparent)
          proposed.style.setProperty('opacity', '1', 'important')
        resources.attribute(node, 'style', proposed.getAttribute('style'))
      }
      revealed += 1
    }
  }

  get resourceCount() { return this.resources.size }
  update(_settings: PageToolJsonValue) {}
  dispose() { this.resources.dispose() }
}

class ElementSpacing implements AdditionalPageTool {
  private first: Element | null = null
  private second: Element | null = null
  private readonly status: HTMLParagraphElement
  private readonly boxes: readonly HTMLDivElement[]
  private readonly animation: AnimationLoop
  private geometry = ''

  constructor(private readonly resources: Resources) {
    const { section, shadow } = panel(resources, 'element-spacing', '元素间距', 'Alt + 单击两个元素；也可聚焦元素后按 Alt + Shift + M。Escape 清除测量。')
    const document = resources.document
    this.status = document.createElement('p')
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.textContent = '清除测量'
    section.append(this.status, clear)
    this.boxes = [0, 1].map((index) => {
      const box = document.createElement('div')
      box.className = index ? 'box second' : 'box'
      box.hidden = true
      box.setAttribute('aria-hidden', 'true')
      shadow.append(box)
      return box
    })
    this.animation = resources.animation(() => {
      this.render()
      if (!this.first)
        this.animation.stop()
    })
    resources.listen(clear, 'click', () => this.clear())
    resources.listen(document, 'click', this.onClick, true)
    resources.listen(document, 'keydown', this.onKeyDown, true)
    resources.listen(document, 'scroll', () => this.render(), true)
    resources.listen(document.defaultView!, 'resize', () => this.render())
    resources.observe(document.documentElement, () => this.render(), { childList: true, subtree: true, attributes: true })
    this.render()
  }

  get resourceCount() { return this.resources.size }
  update(_settings: PageToolJsonValue) {}
  dispose() {
    this.clear()
    this.resources.dispose()
  }

  private clear() {
    this.animation.stop()
    this.first = this.second = null
    this.render()
  }

  private choose(target: EventTarget | null) {
    if (!(target instanceof this.resources.document.defaultView!.Element)
      || !target.isConnected || target.ownerDocument !== this.resources.document || isToolUi(target)
      || target === this.resources.document.documentElement || target === this.resources.document.body) {
      return false
    }
    if (!this.first || this.second) {
      this.first = target
      this.second = null
    }
    else {
      this.second = target
    }
    this.render()
    this.animation.start()
    return true
  }

  private readonly onClick: EventListener = (raw) => {
    const event = raw as MouseEvent
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.button === 0 && this.choose(event.target)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  private readonly onKeyDown: EventListener = (raw) => {
    const event = raw as KeyboardEvent
    if (event.key === 'Escape') {
      this.clear()
    }
    else if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'm'
      && this.choose(this.resources.document.activeElement)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  private render() {
    if (!this.first?.isConnected || this.first.ownerDocument !== this.resources.document
      || (this.second && (!this.second.isConnected || this.second.ownerDocument !== this.resources.document))) {
      this.first = this.second = null
    }
    const elements = [this.first, this.second]
    const rects = elements.map(element => element?.getBoundingClientRect())
    const geometry = JSON.stringify(rects.map((rect, index) => rect
      ? [elements[index]?.tagName, rect.left, rect.top, rect.width, rect.height]
      : null))
    if (geometry === this.geometry)
      return
    this.geometry = geometry
    for (const [index, box] of this.boxes.entries()) {
      const rect = rects[index]
      box.hidden = !rect
      if (rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite))
        box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${Math.max(0, rect.width)}px;height:${Math.max(0, rect.height)}px`
    }
    const round = (value: number) => Math.round(value * 10) / 10
    const [first, second] = rects
    if (!first) {
      this.status.textContent = '尚未选择元素。'
      return
    }
    const dimensions = `第一个元素：${this.first!.tagName} ${round(first.width)} × ${round(first.height)} px`
    if (!second) {
      this.status.textContent = `${dimensions}；请选择第二个元素。`
      return
    }
    const x = Math.max(0, second.left - first.right, first.left - second.right)
    const y = Math.max(0, second.top - first.bottom, first.top - second.bottom)
    this.status.textContent = `${dimensions}；第二个元素：${this.second!.tagName} ${round(second.width)} × ${round(second.height)} px；水平间距：${round(x)} px；垂直间距：${round(y)} px${!x && !y ? '（边界接触或重叠）' : ''}`
  }
}

class SelectionSearch implements AdditionalPageTool {
  private readonly status: HTMLParagraphElement
  private readonly links: readonly HTMLAnchorElement[]

  constructor(private readonly resources: Resources) {
    const { section } = panel(resources, 'selection-search', '选文搜索', '选择页面文字，再明确点击 npm 或 GitHub 才会向该站点搜索。最多使用前 200 个字符。')
    const document = resources.document
    this.status = document.createElement('p')
    this.status.setAttribute('role', 'status')
    const read = document.createElement('button')
    read.type = 'button'
    read.textContent = '读取当前选文'
    this.links = ['npm', 'GitHub'].map((title) => {
      const link = document.createElement('a')
      link.textContent = `在 ${title} 搜索`
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.referrerPolicy = 'no-referrer'
      link.hidden = true
      return link
    })
    section.append(this.status, read, ...this.links)
    resources.listen(document, 'selectionchange', () => this.read())
    resources.listen(read, 'click', () => this.read())
    this.clear()
  }

  get resourceCount() { return this.resources.size }
  update(_settings: PageToolJsonValue) {}
  dispose() {
    this.clear()
    this.resources.dispose()
  }

  private clear() {
    for (const link of this.links) {
      link.removeAttribute('href')
      link.hidden = true
    }
    this.status.textContent = '尚无选文；不会自动发送任何内容。'
  }

  private read() {
    const document = this.resources.document
    const selection = document.getSelection()
    const element = (node: Node | null) => node?.nodeType === 1 ? node as Element : node?.parentElement
    const start = element(selection?.anchorNode ?? null)
    const end = element(selection?.focusNode ?? null)
    if (!selection || selection.isCollapsed || !start || !end || isToolUi(start) || isToolUi(end)
      || start.closest('input,textarea') || end.closest('input,textarea') || document.activeElement?.closest('input,textarea')) {
      this.clear()
      return
    }
    const query = selection.toString().trim().slice(0, 200)
    if (!query) {
      this.clear()
      return
    }
    const urls = [new URL('https://www.npmjs.com/search'), new URL('https://github.com/search')]
    for (const [index, url] of urls.entries()) {
      url.searchParams.set('q', query)
      this.links[index].href = url.href
      this.links[index].hidden = false
    }
    this.status.textContent = `已就绪：${query}`
  }
}

export function createAdditionalPageTool(
  document: Document,
  binding: PageToolRuntimeBindingV1,
  toolId: PageToolId,
  settings: PageToolJsonValue,
): AdditionalPageTool {
  const resources = new Resources(document, binding)
  try {
    if (toolId === 'night-reading')
      return new Dimmer(resources, settings)
    if (toolId === 'hidden-content')
      return new HiddenContent(resources)
    if (toolId === 'element-spacing')
      return new ElementSpacing(resources)
    if (toolId === 'selection-search')
      return new SelectionSearch(resources)
    throw new TypeError('Unknown packaged page tool')
  }
  catch (error) {
    resources.dispose()
    throw error
  }
}
