// The browser serializes this function for isolated, top-frame execution. Keep it self-contained.
export function readPageReference(capture: boolean, expected?: { href: string, documentId: string }, page: Document = document) {
  const globals = globalThis as typeof globalThis & { __onewebReferenceDocument?: string }
  globals.__onewebReferenceDocument ??= Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
  const identity = { href: page.URL, documentId: globals.__onewebReferenceDocument }
  if (!capture || (expected && (expected.href !== identity.href || expected.documentId !== identity.documentId)))
    return identity
  const encoder = new TextEncoder()
  const bytesOf = (value: string) => encoder.encode(value).byteLength
  const excluded = (element: Element) => {
    if (element.matches('script,style,noscript,template,input,textarea,select,button,nav,header,footer,[contenteditable],[data-oneweb-assistant],[data-oneweb-translation],[hidden],[aria-hidden="true"]'))
      return true
    const style = page.defaultView?.getComputedStyle(element)
    return style?.display === 'none' || style?.visibility === 'hidden' || style?.contentVisibility === 'hidden'
  }
  const summary = (element: Element) => [...element.children].find(child => child.tagName === 'SUMMARY')
  const preferred = [...page.querySelectorAll('main,article,[role="main"]')].find((element) => {
    let current: Element | null = element
    while (current) {
      const parent: Element | null = current.parentElement
      if (excluded(current) || (parent?.matches('details:not([open])') && summary(parent) !== current))
        return false
      current = parent
    }
    return true
  })
  const root = preferred ?? page.body
  const pieces: string[] = []
  let elements = 0
  let bytes = 0
  let truncated = false
  const append = (value: string) => {
    if (bytes >= 65536) {
      truncated = true
      return
    }
    const available = 65536 - bytes
    if (bytesOf(value) > available) {
      let result = ''
      for (const character of value) {
        const length = bytesOf(character)
        if (bytes + length > 65536)
          break
        result += character
        bytes += length
      }
      pieces.push(result)
      truncated = true
    }
    else {
      pieces.push(value)
      bytes += bytesOf(value)
    }
  }
  const visit = (node: Node) => {
    if (truncated)
      return
    if (node.nodeType === 3) {
      append((node.textContent ?? '').replace(/\s+/g, ' '))
      return
    }
    if (node.nodeType !== 1)
      return
    const element = node as Element
    if (++elements > 3000) {
      truncated = true
      return
    }
    if (excluded(element))
      return
    const block = /^(?:P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|BLOCKQUOTE|BR|TR|SUMMARY)$/.test(element.tagName)
    if (block)
      append('\n')
    if (element.matches('details:not([open])')) {
      const label = summary(element)
      if (label)
        visit(label)
    }
    else {
      for (const child of element.childNodes)
        visit(child)
    }
    if (block)
      append('\n')
  }
  visit(root)
  const text = pieces.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n').trim()
  if (!text)
    throw new Error('此页面没有可读取的正文')
  return { ...identity, text, truncated, method: preferred ? 'article' : 'visible-text' }
}
