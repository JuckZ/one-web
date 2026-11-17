import type { PageToolId } from '../modules/builtin/page-toolbox/tool-catalog'
import { PAGE_TOOL_CATALOG, PAGE_TOOL_IDS } from '../modules/builtin/page-toolbox/tool-catalog'

export const USERSCRIPT_CONTROL_ATTRIBUTE = 'data-oneweb-userscript-control'

const titles: Readonly<Record<string, string>> = {
  'password-visibility': '密码可见性',
  'free-page-edit': '网页自由编辑',
  'selection-copy-release': '解除选择与复制限制',
  'element-spacing': '元素间距',
  'night-reading': '阅读遮光',
  'hidden-content': '显示已加载隐藏内容',
  'selection-search': '选文搜索',
}

export function userscriptToolTitle(toolId: PageToolId) {
  return titles[toolId] ?? PAGE_TOOL_CATALOG[toolId].descriptor.title
}

const css = `
:host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646;font:14px/1.5 system-ui,sans-serif;color:#172033;color-scheme:light dark}
button,input{font:inherit;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #a599ff;outline-offset:3px}
.launcher{width:44px;height:44px;padding:0;border:1px solid #7c6df2;border-radius:14px;background:#6557dc;color:#fff;font-weight:800;box-shadow:0 10px 24px #12122b3d}
.panel{position:absolute;right:0;bottom:54px;box-sizing:border-box;width:min(320px,calc(100vw - 36px));max-height:calc(100dvh - 100px);overflow:auto;padding:16px;border:1px solid #d8d5f7;border-radius:16px;background:#fff;box-shadow:0 16px 40px #12122b3d}
.panel[hidden]{display:none}h2{margin:0;font-size:16px}p{margin:6px 0;font-size:12px}.tools{display:grid;gap:10px;margin:14px 0}label{display:flex;gap:10px;align-items:center}input{accent-color:#6557dc}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions button{padding:6px 9px;border:1px solid #d8d5f7;border-radius:8px;background:transparent}.status{min-height:18px;color:#667085}.status[data-error=true]{color:#b42318}
@media(prefers-color-scheme:dark){:host{color:#f4f3ff}.panel{background:#171529;border-color:#403b66}.actions button{border-color:#655e86}.status{color:#c8c4df}.status[data-error=true]{color:#ffb4ab}}
`

interface ControlActions {
  toggle: (_toolId: PageToolId, _enabled: boolean) => void
  disable: () => void
  forget: () => void
}

/** Page-local convenience only; the manager owns persistence and site approval. */
export class UserscriptControl {
  readonly host: HTMLElement
  private readonly inputs = new Map<PageToolId, HTMLInputElement>()
  private readonly launcher: HTMLButtonElement
  private readonly panel: HTMLElement
  private readonly status: HTMLElement
  private readonly listeners: Array<() => void> = []
  private readonly parent: Node
  private readonly ownershipObserver: MutationObserver
  private owned = true
  private disposed = false

  constructor(document: Document, actions: ControlActions) {
    this.host = document.createElement('div')
    this.host.setAttribute(USERSCRIPT_CONTROL_ATTRIBUTE, '')
    this.host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646'
    const shadow = this.host.attachShadow({ mode: 'closed', delegatesFocus: true })
    const style = document.createElement('style')
    style.textContent = css
    this.launcher = document.createElement('button')
    this.launcher.type = 'button'
    this.launcher.className = 'launcher'
    this.launcher.textContent = 'O'
    this.launcher.setAttribute('aria-label', '打开 OneWeb 当前站点工具')
    this.launcher.setAttribute('aria-expanded', 'false')
    this.launcher.setAttribute('aria-controls', 'oneweb-userscript-panel')
    this.panel = document.createElement('section')
    this.panel.id = 'oneweb-userscript-panel'
    this.panel.className = 'panel'
    this.panel.hidden = true
    this.panel.setAttribute('aria-label', 'OneWeb 当前站点工具')
    const title = document.createElement('h2')
    title.textContent = 'OneWeb'
    const note = document.createElement('p')
    note.textContent = '油猴版 · 仅当前已启用站点。设置保存在脚本管理器中。'
    const tools = document.createElement('div')
    tools.className = 'tools'
    for (const toolId of PAGE_TOOL_IDS) {
      const label = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'checkbox'
      const text = document.createElement('span')
      text.textContent = userscriptToolTitle(toolId)
      label.append(input, text)
      tools.append(label)
      this.inputs.set(toolId, input)
      this.listen(input, 'change', () => actions.toggle(toolId, input.checked))
    }
    const buttons = document.createElement('div')
    buttons.className = 'actions'
    for (const [text, action] of [['停用此站点', actions.disable], ['忘记此站点', actions.forget]] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = text
      this.listen(button, 'click', action)
      buttons.append(button)
    }
    this.status = document.createElement('p')
    this.status.className = 'status'
    this.status.setAttribute('role', 'status')
    this.panel.append(title, note, tools, buttons, this.status)
    shadow.append(style, this.launcher, this.panel)
    this.listen(this.launcher, 'click', () => this.setOpen(this.panel.hidden))
    this.listen(shadow, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') {
        this.setOpen(false)
        this.launcher.focus()
      }
    })
    this.parent = document.documentElement
    this.parent.appendChild(this.host)
    this.ownershipObserver = new document.defaultView!.MutationObserver(() => {
      this.owned = false
    })
    this.ownershipObserver.observe(this.host, { attributes: true, childList: true })
  }

  open() {
    if (this.disposed)
      return
    this.setOpen(true)
    this.inputs.values().next().value?.focus()
  }

  update(enabled: readonly PageToolId[], pending: boolean, message = '') {
    for (const [toolId, input] of this.inputs) {
      input.checked = enabled.includes(toolId)
      input.disabled = pending
    }
    this.status.textContent = pending ? '正在保存…' : message || '可从油猴菜单停用或忘记此站点。'
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    if (this.ownershipObserver.takeRecords().length)
      this.owned = false
    this.ownershipObserver.disconnect()
    for (const remove of this.listeners.reverse()) remove()
    if (this.owned && this.host.parentNode === this.parent)
      this.host.remove()
  }

  private setOpen(open: boolean) {
    this.panel.hidden = !open
    this.launcher.setAttribute('aria-expanded', String(open))
  }

  private listen(target: EventTarget, event: string, listener: EventListener) {
    target.addEventListener(event, listener)
    this.listeners.push(() => target.removeEventListener(event, listener))
  }
}
