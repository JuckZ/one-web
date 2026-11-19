import { PageAssistantSurface } from '../surface'

it.each(['contenteditable', 'textarea'])('keeps the preview for repeated %s selection events and releases it for a new selection', async (kind) => {
  vi.useFakeTimers()
  const attachShadow = Element.prototype.attachShadow
  let shadow: ShadowRoot | undefined
  const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = attachShadow.call(this, init)
    if (this instanceof HTMLElement && this.dataset.onewebAssistant)
      shadow = root
    return root
  })
  const editor = document.createElement(kind === 'textarea' ? 'textarea' : 'div')
  if (editor instanceof HTMLTextAreaElement) {
    editor.value = 'Original editable'
  }
  else {
    editor.contentEditable = 'true'
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'Original editable'
    editor.tabIndex = 0
  }
  document.body.append(editor)
  const select = (start: number, end: number) => {
    editor.focus()
    if (editor instanceof HTMLTextAreaElement) {
      editor.setSelectionRange(start, end)
      return
    }
    const range = document.createRange()
    range.setStart(editor.firstChild!, start)
    range.setEnd(editor.firstChild!, end)
    range.getBoundingClientRect = () => new DOMRect(20, 20, 100, 20)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  }
  select(0, 8)
  const surface = new PageAssistantSurface(document, {
    sendMessage: async () => ({
      channel: 'oneweb.page-action.v1',
      ok: true,
      value: {
        actions: [{ id: 'rewrite', title: '改写选文', scope: 'selection' }],
        toolbar: { mode: 'automatic', order: [], disabled: [] },
      },
    }),
  })
  try {
    await surface.refreshTools()
    surface.notice('Preview awaiting explicit writeback')
    const result = shadow!.querySelector<HTMLElement>('[aria-label="OneWeb 选文助手"]')!
    expect(result.hidden).toBe(false)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(100)
    expect(result.hidden).toBe(false)
    expect(result.textContent).toContain('Preview awaiting explicit writeback')
    select(1, 8)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(100)
    expect(result.hidden).toBe(true)
    expect(shadow!.querySelector<HTMLElement>('[aria-label="OneWeb 选文操作"]')!.hidden).toBe(false)
  }
  finally {
    surface.dispose()
    editor.remove()
    document.getSelection()?.removeAllRanges()
    spy.mockRestore()
    vi.useRealTimers()
  }
})
