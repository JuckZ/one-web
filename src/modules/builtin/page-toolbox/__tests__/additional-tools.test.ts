import type { PageToolboxRuntimeBindingV1, PageToolJsonValue, PageToolPlanV1 } from '..'
import { PAGE_TOOL_CATALOG, PageToolboxDomRuntime, validatePageToolSettingsValue } from '..'

const binding: PageToolboxRuntimeBindingV1 = {
  moduleId: 'dev.oneweb.page-toolbox',
  exactOrigin: 'https://alpha.example',
  tabId: 7,
  frameId: 0,
  navigationId: 'document:1',
  generation: 1,
}
function plan(toolId: string, settings: PageToolJsonValue = {}): PageToolPlanV1 {
  return { toolId, settings }
}
function widget(document: Document, id: string) {
  return document.querySelector<HTMLElement>(`[data-oneweb-page-toolbox-widget="${id}"]`)
}
function roots() {
  const captured = new Map<Element, ShadowRoot>()
  const original = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = original.call(this, init)
    captured.set(this, root)
    return root
  })
  return captured
}
function select(text: Element) {
  const range = text.ownerDocument.createRange()
  range.selectNodeContents(text)
  const selection = text.ownerDocument.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  text.ownerDocument.dispatchEvent(new Event('selectionchange'))
}

describe('additional packaged page tools', () => {
  const runtimes: PageToolboxDomRuntime[] = []
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>'
  })
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose('disabled')
    vi.restoreAllMocks()
  })
  function run(plans: PageToolPlanV1[], targetDocument = document, targetBinding = binding) {
    const runtime = new PageToolboxDomRuntime(targetDocument, targetBinding, plans)
    runtimes.push(runtime)
    return runtime
  }

  it('admits only the fixed settings for the four tools', () => {
    for (const id of ['element-spacing', 'hidden-content', 'selection-search']) {
      expect(validatePageToolSettingsValue(id, {}, PAGE_TOOL_CATALOG).ok).toBe(true)
      expect(validatePageToolSettingsValue(id, { selector: 'body' }, PAGE_TOOL_CATALOG).ok).toBe(false)
    }
    expect(validatePageToolSettingsValue('night-reading', { strength: 'gentle' }, PAGE_TOOL_CATALOG).ok).toBe(true)
    expect(validatePageToolSettingsValue('night-reading', { strength: 0.9 }, PAGE_TOOL_CATALOG).ok).toBe(false)
  })

  it('uses a non-intercepting owned dimmer, updates finite strength and removes it on disable', () => {
    const runtime = run([plan('night-reading', { strength: 'gentle' })])
    const overlay = widget(document, 'night-reading')!
    expect(overlay).not.toBeNull()
    expect(overlay.style.pointerEvents).toBe('none')
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
    const previous = overlay.style.backgroundColor
    expect(runtime.reconcile([plan('night-reading', { strength: 'strong' })])).toBe(true)
    expect(overlay.style.backgroundColor).not.toBe(previous)
    expect(document.body.getAttribute('style')).toBeNull()
    runtime.reconcile([])
    expect(widget(document, 'night-reading')).toBeNull()
    expect(runtime.resourceCount).toBe(0)
  })

  it('does not delete a dimmer subsequently repurposed by the page', async () => {
    const runtime = run([plan('night-reading', { strength: 'gentle' })])
    const overlay = widget(document, 'night-reading')!
    overlay.style.backgroundColor = 'red'
    await Promise.resolve()
    runtime.dispose('navigation')
    expect(overlay.isConnected).toBe(true)
    expect(overlay.style.backgroundColor).toBe('red')
  })

  it.each(['night-reading', 'element-spacing', 'selection-search'])('preserves page-owned content appended to a %s widget while draining tool resources', (toolId) => {
    const runtime = run([plan(toolId, toolId === 'night-reading' ? { strength: 'gentle' } : {})])
    const overlay = widget(document, toolId)!
    const pageContent = document.createElement('p')
    pageContent.textContent = 'Page-owned addition'
    overlay.append(pageContent)
    runtime.dispose('disabled')
    expect(pageContent.isConnected).toBe(true)
    expect(overlay.isConnected).toBe(true)
    expect(runtime.resourceCount).toBe(0)
  })

  it('preserves a page-modified overlay after a synchronous settings update fails', () => {
    const runtime = run([plan('night-reading', { strength: 'gentle' })])
    const overlay = widget(document, 'night-reading')!
    overlay.setAttribute('aria-label', 'page now owns this node')
    runtime.reconcile([plan('night-reading', { strength: 'medium' })])
    runtime.dispose('disabled')
    expect(overlay.isConnected).toBe(true)
    expect(overlay.getAttribute('aria-label')).toBe('page now owns this node')
    expect(runtime.resourceCount).toBe(0)
  })

  it('reveals only existing visual DOM and restores exact prior attributes and styles', () => {
    document.body.innerHTML = '<p id="hidden" hidden style="color:red">available text</p><div id="css" style="display:none!important">already loaded</div><input type="hidden" value="private"><!-- <p>never injected</p> -->'
    const hidden = document.querySelector<HTMLElement>('#hidden')!
    const css = document.querySelector<HTMLElement>('#css')!
    const runtime = run([plan('hidden-content')])
    expect(hidden.hasAttribute('hidden')).toBe(false)
    expect(css.style.display).not.toBe('none')
    expect(document.querySelector('input')!.type).toBe('hidden')
    expect(document.body.textContent).not.toContain('never injected')
    runtime.dispose('origin-revoked')
    expect(hidden.hasAttribute('hidden')).toBe(true)
    expect(hidden.getAttribute('style')).toBe('color:red')
    expect(css.getAttribute('style')).toBe('display:none!important')
    expect(runtime.resourceCount).toBe(0)
  })

  it('preserves later page mutations instead of restoring stale hidden-content state', async () => {
    document.body.innerHTML = '<p hidden style="display:none">text</p>'
    const paragraph = document.querySelector('p')!
    const runtime = run([plan('hidden-content')])
    paragraph.setAttribute('hidden', 'until-found')
    paragraph.style.cssText = 'color:green'
    await Promise.resolve()
    runtime.dispose('disabled')
    expect(paragraph.getAttribute('hidden')).toBe('until-found')
    expect(paragraph.style.color).toBe('green')
    expect(paragraph.style.display).toBe('')
  })

  it('bounds hidden-content work, ignores frames and never runs commented markup', () => {
    document.body.innerHTML = `${'<p hidden>loaded</p>'.repeat(100)}<iframe></iframe>`
    const frame = document.querySelector('iframe')!
    frame.contentDocument!.body.innerHTML = '<p hidden>frame content</p>'
    run([plan('hidden-content')])
    expect(document.body.querySelectorAll('p:not([hidden])')).toHaveLength(80)
    expect(frame.contentDocument!.querySelector('p')!.hidden).toBe(true)
  })

  it('keeps credentials, editors and accessibility-only hidden flags unchanged', () => {
    document.body.innerHTML = '<div hidden id="credentials"><input type="password" value="local-only"></div><div contenteditable="true"><span hidden id="editor">draft</span></div><p aria-hidden="true" id="a11y">already visible</p><script hidden>void 0</script>'
    const field = document.querySelector('input')!
    const value = vi.spyOn(field, 'value', 'get')
    run([plan('hidden-content')])
    expect(document.querySelector<HTMLElement>('#credentials')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#editor')!.hidden).toBe(true)
    expect(document.querySelector('#a11y')!.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('script')!.hasAttribute('hidden')).toBe(true)
    expect(value).not.toHaveBeenCalled()
  })

  it('does not reveal descendants inside excluded form or interactive containers', () => {
    document.body.innerHTML = '<form><p hidden id="form-note">form-only text</p></form><button><span hidden id="button-note">button-only text</span></button><div><p hidden id="visual">visual text</p></div>'
    run([plan('hidden-content')])
    expect(document.querySelector<HTMLElement>('#form-note')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#button-note')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#visual')!.hidden).toBe(false)
  })

  it('keeps hidden wrappers containing a form or button subtree hidden', () => {
    document.body.innerHTML = '<div hidden id="form-wrapper"><form><p>Form-only text</p></form></div><div hidden id="button-wrapper"><button>Button-only text</button></div>'
    run([plan('hidden-content')])
    expect(document.querySelector<HTMLElement>('#form-wrapper')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#button-wrapper')!.hidden).toBe(true)
  })

  it('selects two boxes only on the explicit measurement gesture and updates after viewport changes', () => {
    const captured = roots()
    document.body.innerHTML = '<div id="first">first</div><div id="second">second</div>'
    const first = document.querySelector<HTMLElement>('#first')!
    const second = document.querySelector<HTMLElement>('#second')!
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 } as DOMRect)
    const secondBox = vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ left: 140, top: 90, right: 220, bottom: 130, width: 80, height: 40 } as DOMRect)
    const runtime = run([plan('element-spacing')])
    const host = widget(document, 'element-spacing')!
    const root = captured.get(host)!
    expect(host.shadowRoot).toBeNull()
    first.click()
    expect(root.textContent).not.toContain('水平间距：30')
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true, cancelable: true }))
    second.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true, cancelable: true }))
    expect(root.textContent).toContain('水平间距：30 px')
    expect(root.textContent).toContain('垂直间距：20 px')
    expect(root.textContent).toContain('100 × 50')
    secondBox.mockReturnValue({ left: 150, top: 100, right: 230, bottom: 140, width: 80, height: 40 } as DOMRect)
    document.dispatchEvent(new Event('scroll'))
    expect(root.textContent).toContain('水平间距：40 px')
    runtime.dispose('disabled')
    expect(host.isConnected).toBe(false)
    expect(runtime.resourceCount).toBe(0)
    expect(first.getAttribute('style')).toBeNull()
  })

  it('supports keyboard measurement and Escape cleanup without swallowing ordinary keys', () => {
    const captured = roots()
    document.body.innerHTML = '<button id="first">first</button><button id="second">second</button>'
    run([plan('element-spacing')])
    const root = captured.get(widget(document, 'element-spacing')!)!
    const first = document.querySelector<HTMLButtonElement>('#first')!
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', altKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(root.textContent).toContain('第一个元素：BUTTON')
    const ordinary = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    first.dispatchEvent(ordinary)
    expect(ordinary.defaultPrevented).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(root.textContent).not.toContain('第一个元素：BUTTON')
  })

  it('does not measure its own closed controls when a page dispatches the selection gesture', () => {
    const captured = roots()
    const ownControl = document.createElement('div')
    ownControl.setAttribute('data-oneweb-userscript-control', '')
    document.body.append(ownControl)
    run([plan('element-spacing')])
    const host = widget(document, 'element-spacing')!
    ownControl.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true, cancelable: true }))
    host.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true, cancelable: true }))
    expect(captured.get(host)!.textContent).toContain('尚未选择元素。')
  })

  it('keeps search text transient and requires native fixed-destination links without fetching', () => {
    const captured = roots()
    const fetch = vi.spyOn(globalThis, 'fetch')
    const open = vi.spyOn(window, 'open')
    document.body.innerHTML = '<p>alpha &amp; beta / 搜索</p>'
    const runtime = run([plan('selection-search')])
    const host = widget(document, 'selection-search')!
    const root = captured.get(host)!
    expect(root.querySelectorAll('a[href]')).toHaveLength(0)
    select(document.querySelector('p')!)
    const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
    expect(anchors).toHaveLength(2)
    expect(anchors.map(a => new URL(a.href).host)).toEqual(['www.npmjs.com', 'github.com'])
    expect(anchors.map(a => new URL(a.href).searchParams.get('q'))).toEqual(['alpha & beta / 搜索', 'alpha & beta / 搜索'])
    for (const anchor of anchors) {
      expect(anchor.target).toBe('_blank')
      expect(anchor.rel).toContain('noreferrer')
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    runtime.dispose('navigation')
    expect(host.isConnected).toBe(false)
    expect(root.querySelectorAll('a[href]')).toHaveLength(0)
  })

  it('bounds search text and drops collapsed selections without persisting page data', () => {
    const captured = roots()
    document.body.innerHTML = `<p>${'x'.repeat(450)}</p>`
    run([plan('selection-search')])
    const root = captured.get(widget(document, 'selection-search')!)!
    select(document.querySelector('p')!)
    const anchor = root.querySelector<HTMLAnchorElement>('a[href]')!
    expect(new URL(anchor.href).searchParams.get('q')).toHaveLength(200)
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    expect(root.querySelectorAll('a[href]')).toHaveLength(0)
  })

  it('leaves a second document and peer tools unchanged while rejecting arbitrary plans', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const peerDocument = frame.contentDocument!
    peerDocument.body.innerHTML = '<p hidden>private peer DOM</p>'
    const peer = run([plan('free-page-edit', { mode: 'plain-text' })], peerDocument, { ...binding, exactOrigin: 'https://beta.example', tabId: 8 })
    const runtime = run([plan('hidden-content'), plan('night-reading', { strength: 'gentle' })])
    expect(runtime.reconcile([plan('element-spacing', { selector: '*' })])).toBe(false)
    expect(peerDocument.querySelector('p')!.hidden).toBe(true)
    expect(peerDocument.body.getAttribute('contenteditable')).toBe('plaintext-only')
    runtime.dispose('disabled')
    expect(peer.activeToolIds).toEqual(['free-page-edit'])
    expect(peerDocument.body.getAttribute('contenteditable')).toBe('plaintext-only')
  })
})
