import { byteLength } from '~/modules/builtin/assistant/contracts'
import { validQuote } from '~/workspace/clippings'

export class PageQuoteAnchors {
  private highlighted: Range | undefined
  constructor(private readonly _document: Document) {}

  private index() {
    const nodes: Array<{ node: Text, start: number, end: number }> = []
    let text = ''
    const walker = this._document.createTreeWalker(this._document.body, NodeFilter.SHOW_TEXT)
    let visited = 0
    while (walker.nextNode()) {
      if (++visited > 10000 || text.length > 1048576)
        throw new Error('页面过大，无法可靠定位选文')
      const node = walker.currentNode as Text
      if (node.parentElement?.closest('script,style,noscript,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"],[data-oneweb-assistant],[data-oneweb-translation]'))
        continue
      let visible = true
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = this._document.defaultView?.getComputedStyle(parent)
        if ((style?.display === 'none' && !parent.hasAttribute('data-oneweb-original')) || style?.visibility === 'hidden') {
          visible = false
          break
        }
      }
      if (!visible)
        continue
      const start = text.length
      text += node.data
      nodes.push({ node, start, end: text.length })
    }
    return { nodes, text }
  }

  capture() {
    const selection = this._document.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed)
      throw new Error('请先选择要剪藏的网页原文')
    const range = selection.getRangeAt(0)
    const { nodes, text } = this.index()
    const startRange = range.cloneRange()
    startRange.collapse(true)
    const endRange = range.cloneRange()
    endRange.collapse(false)
    const offset = (point: Range) => {
      for (const item of nodes) {
        const nodeRange = this._document.createRange()
        nodeRange.selectNodeContents(item.node)
        if (point.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0)
          return item.start
        if (point.compareBoundaryPoints(Range.START_TO_END, nodeRange) <= 0)
          return item.start + (point.startContainer === item.node ? point.startOffset : 0)
      }
      return text.length
    }
    const start = offset(startRange)
    const end = offset(endRange)
    const exact = text.slice(start, end)
    if (!exact.trim() || byteLength(exact) > 16384)
      throw new Error('请选择不超过 16 KiB 的网页原文')
    return { exact, start, prefix: text.slice(Math.max(0, start - 48), start), suffix: text.slice(end, end + 48) }
  }

  locate(value: unknown) {
    if (!validQuote(value))
      throw new Error('文字锚点无效')
    const { text, nodes } = this.index()
    const matches: number[] = []
    for (let offset = 0; offset <= text.length;) {
      const index = text.indexOf(value.exact, offset)
      if (index < 0)
        break
      matches.push(index)
      if (matches.length > 500)
        return { status: 'ambiguous', message: '原文重复过多，无法唯一定位' }
      offset = index + 1
    }
    if (!matches.length) {
      const changed = !!value.prefix && !!value.suffix && text.includes(value.prefix) && text.includes(value.suffix)
      return { status: changed ? 'changed' : 'missing', message: changed ? '此处文字已被网站修改，请核对原文' : '未找到原文，页面可能已更新或内容尚未加载' }
    }
    const contextual = matches.filter(index => (!value.prefix || text.slice(Math.max(0, index - value.prefix.length), index) === value.prefix)
      && (!value.suffix || text.slice(index + value.exact.length, index + value.exact.length + value.suffix.length) === value.suffix))
    const candidates = contextual.length ? contextual : matches
    if (candidates.length !== 1)
      return { status: 'ambiguous', message: '找到多处相同原文，无法唯一定位' }
    const start = candidates[0]
    const end = start + value.exact.length
    const first = nodes.find(item => item.start <= start && item.end > start)
    const last = nodes.find(item => item.start < end && item.end >= end)
    if (!first || !last)
      return { status: 'missing', message: '原文位置已变化，请重新加载后定位' }
    const range = this._document.createRange()
    range.setStart(first.node, start - first.start)
    range.setEnd(last.node, end - last.start)
    first.node.parentElement?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    const selection = this._document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    this.highlighted = range
    return { status: 'found', message: '已定位并高亮原文' }
  }

  dispose() {
    const selection = this._document.getSelection()
    if (this.highlighted && selection?.rangeCount && selection.getRangeAt(0) === this.highlighted)
      selection.removeAllRanges()
    this.highlighted = undefined
  }
}
