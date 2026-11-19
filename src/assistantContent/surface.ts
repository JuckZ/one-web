import type { AssistantMessage } from '~/modules/builtin/assistant/contracts'
import { PageActionClient } from '~/workspace/page-actions'
import type { PageToolsSnapshot } from '~/workspace/page-tools'
import { BrowserTasksSurface } from './browser-tasks'
import { pageOutputLanguages, SelectionActionsSurface, selectionActionStyles } from './selection-actions'
import { surfaceIcon } from './surface-icons'
import { PageToolboxSurface } from './toolbox'

export class PageAssistantSurface {
  private readonly host: HTMLElement
  private readonly toolbar: HTMLElement
  private readonly result: HTMLElement
  private readonly output: HTMLElement
  private readonly menu: HTMLElement
  private readonly launcher: HTMLButtonElement
  private readonly pageOptions: HTMLElement
  private readonly readingOptions: HTMLElement
  private readonly readingSettings: HTMLElement
  private readingGeneration = 0
  private readonly pinDockButton: HTMLButtonElement
  private savingDock = false
  private readonly toolbarOverflow: HTMLElement
  private readonly overflowButton: HTMLButtonElement
  private readonly continueButton: HTMLButtonElement
  private readonly closeButton: HTMLButtonElement
  private readonly selectionPicker: SelectionActionsSurface
  private readonly toolbarActions = new Map<string, HTMLButtonElement>()
  private selectionActions: string[][] = []
  private selectionDismissed = false
  private readonly popovers = new Map<HTMLElement, HTMLButtonElement>()
  private readonly client: PageActionClient
  private readonly applyButton: HTMLButtonElement
  private readonly insertButton: HTMLButtonElement
  private readonly writing: HTMLElement
  private timer: ReturnType<typeof setTimeout> | undefined
  private selectionTimer: ReturnType<typeof setTimeout> | undefined
  private active = false
  private selectionGeneration = 0
  private cancellation: Promise<void> = Promise.resolve()
  private starting: ReturnType<PageActionClient['start']> | undefined
  private disposed = false
  private answer = ''
  private lastAction = 'translate'
  private readonly toolbox: PageToolboxSurface
  private tools: PageToolsSnapshot | null = null
  private forceToolbar = false
  private editor: HTMLElement | null = null
  private editorRange: Range | null = null
  private editorText = ''
  private selectionSnapshot?: readonly [Node | null, number | null, Node | null, number | null, string]
  private readonly tasks: BrowserTasksSurface

  constructor(private readonly _document: Document, transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {
    this.client = new PageActionClient(transport)
    this.host = this.node('div')
    this.host.dataset.onewebAssistant = 'surface'
    const shadow = this.host.attachShadow({ mode: 'open' })
    const style = this.node('style')
    style.textContent = `
      :host{all:initial;position:fixed;inset:0;z-index:2147483630;pointer-events:none;color-scheme:light dark}
      *{box-sizing:border-box}button,section,div,p{font:13px/1.65 system-ui,sans-serif}
      button{pointer-events:auto;border:1px solid #dedee7;border-radius:9px;padding:6px 10px;background:#fff;color:#353542;cursor:pointer}
      button:hover{background:#eeecff}button:focus-visible{outline:2px solid #8c74f4;outline-offset:2px}
      [hidden]{display:none!important}.launcher.icon-button{position:fixed;right:12px;bottom:24px;min-width:42px;min-height:42px;border-radius:50%;background:#7961d9;color:#fff;box-shadow:0 4px 20px #19142633}.launcher.icon-button:hover{background:#6750c2}
      .toolbar,.result,.menu{pointer-events:auto;position:fixed;border:1px solid #dedee7;border-radius:14px;background:#fff;color:#353542;box-shadow:0 8px 32px #14141f26;padding:8px}
      .toolbar{display:flex;flex-wrap:nowrap;gap:3px;width:max-content;max-width:calc(100vw - 16px);padding:5px;border-radius:12px;background:#fff;color:#30323b;border-color:#dedee5;box-shadow:0 4px 20px #14141f26}
      .icon-button{display:inline-grid;place-items:center;min-width:32px;min-height:32px;padding:6px;border:0;border-radius:8px;background:transparent;color:inherit;line-height:1}
      .icon-button svg{display:block;width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
      .icon-button:hover{background:#eeecff}.icon-button:focus-visible{outline:2px solid #8c74f4;outline-offset:1px}
      @media(prefers-color-scheme:dark){.toolbar{background:#25262c;color:#eaeaf1;border-color:#42434c}.icon-button:hover{background:#3b354f}}
      .result{right:16px;bottom:142px;width:min(340px,calc(100vw - 32px));padding:16px;max-height:65vh;overflow:auto}
      .result strong{display:block;margin-bottom:8px;font:600 12px system-ui;letter-spacing:.03em}
      .output{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;margin-bottom:12px}
      .actions{display:flex;flex-wrap:wrap;gap:6px}
      .menu{display:flex;flex-direction:column;gap:4px;width:46px;padding:5px;border-radius:24px;max-height:calc(100vh - 96px);overflow:auto}
      .menu .icon-button{min-height:34px;min-width:34px;border-radius:50%}
      .page-options{display:grid;gap:2px;width:208px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;padding:6px}
      .page-options button{text-align:start;border:0;background:transparent;min-height:34px}
      .page-options button[aria-pressed=true]{color:#9b83e9;background:#9780e31a;box-shadow:inset 3px 0 #9b83e9}
      .page-options hr{width:100%;border:0;border-top:1px solid #dedee7;margin:4px 0}
      .page-options.reading-options{display:flex;flex-direction:row;width:max-content;gap:6px;padding:7px;border-radius:22px}
      .reading-options .icon-button{border-radius:50%;background:transparent;color:inherit}
      :host(.dock-pinned) .dock-menu{position-area:none;position-try-fallbacks:none;left:auto;right:12px;top:50%;bottom:auto;translate:0 -50%;max-height:calc(100vh - 152px)}
      :host(.dock-pinned) .result{right:72px;width:min(420px,calc(100vw - 88px))}
      [popover]{inset:auto;margin:0;position:fixed;pointer-events:auto}
      [popover]:not(:popover-open){display:none!important}
      @supports(position-area:block-start){.menu{position-area:block-start span-inline-start;position-try-fallbacks:flip-block,flip-inline}.page-options{position-area:inline-start span-block-start;position-try-fallbacks:flip-inline,flip-block}.page-options.toolbar-options{position-area:block-end span-inline-start;position-try-fallbacks:flip-block,flip-inline}}
      @media(pointer:coarse){.icon-button,.menu .icon-button{min-width:40px;min-height:40px}.menu{width:52px}.toolbar{overflow-x:auto}}
      @media(forced-colors:active){button{color:ButtonText;border:1px solid ButtonText}button:focus-visible{outline-color:Highlight}}

      .task-toolbox{width:min(420px,calc(100vw - 32px));bottom:80px;max-height:calc(100vh - 104px)}
      .task-toolbox label{display:grid;gap:4px;margin:10px 0;font:13px system-ui}
      .task-toolbox input:not([type=checkbox]),.task-toolbox select,.task-toolbox textarea{width:100%;min-width:0;font:13px/1.5 system-ui;border:1px solid #cad8cc;border-radius:7px;padding:6px;background:transparent;color:inherit}
      .task-toolbox option{background:#fff;color:#353542}
      .task-tool-row{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:8px 0}.task-tool-row small{width:100%;opacity:.7}.task-tools-list{max-height:26vh;overflow:auto}
      @media(prefers-color-scheme:dark){button,.toolbar,.result,.menu,.page-options,.task-toolbox option{background:#25262c;color:#eaeaf1;border-color:#42434c}button:hover{background:#3b354f}}
      ${selectionActionStyles}
    `
    this.toolbar = this.node('div', '', 'toolbar')
    this.toolbar.setAttribute('role', 'toolbar')
    this.toolbar.setAttribute('aria-label', 'OneWeb 选文操作')
    this.toolbar.hidden = true
    this.selectionPicker = new SelectionActionsSurface(this._document, this.client, {
      run: id => this.start(id),
      changed: (settings) => {
        if (this.disposed)
          return
        if (this.tools)
          this.tools.toolbar = settings
        this.renderSelectionToolbar()
      },
      error: error => this.showError(error),
    })
    this.toolbarOverflow = this.selectionPicker.root
    this.overflowButton = this.iconButton('更多选文操作', () => {}, 'more')
    this.bindPopover(this.toolbarOverflow, this.overflowButton)
    this.continueButton = this.iconButton('继续问', async () => {
      await this.client.request('continue', { selection: true })
    }, 'continue')
    this.closeButton = this.iconButton('关闭选文工具条', () => this.dismissSelection(), 'close')
    this.toolbar.append(this.continueButton, this.overflowButton, this.closeButton, this.toolbarOverflow)
    this.result = this.node('section', '', 'result')
    this.result.setAttribute('role', 'dialog')
    this.result.setAttribute('aria-label', 'OneWeb 选文助手')
    this.result.hidden = true
    this.output = this.node('div', '', 'output')
    this.output.setAttribute('role', 'status')
    this.output.setAttribute('aria-label', '选文结果')
    this.output.setAttribute('aria-live', 'polite')
    const actions = this.node('div', '', 'actions')
    this.applyButton = this.button('替换原选文', async () => {
      const generation = this.selectionGeneration
      await this.client.request('apply')
      if (this.disposed || generation !== this.selectionGeneration)
        return
      this.output.textContent = `${this.answer}\n\n已替换原选文`
      this.applyButton.hidden = true
      this.insertButton.hidden = true
    })
    this.applyButton.hidden = true
    this.insertButton = this.button('插入到光标处', async () => {
      const generation = this.selectionGeneration
      await this.client.request('apply', { mode: 'insert' })
      if (this.disposed || generation !== this.selectionGeneration)
        return
      this.output.textContent = `${this.answer}\n\n已插入`
      this.applyButton.hidden = true
      this.insertButton.hidden = true
    })
    this.insertButton.hidden = true
    actions.append(
      this.button('复制', async () => { await navigator.clipboard.writeText(this.answer) }),
      this.button('停止', async () => {
        const generation = this.selectionGeneration
        await this.client.request('cancel')
        await this.poll(generation)
      }),
      this.button('重试', () => this.start(this.lastAction, true)),
      this.applyButton,
      this.insertButton,
      this.button('到工作区继续问', async () => { await this.client.request('continue') }),
      this.button('关闭结果', () => {
        this.cancelSelection()
        this.result.hidden = true
        this.dismissSelection()
      }),
    )
    this.result.append(this.node('strong', 'ONEWEB · 选文助手'), this.output, actions)
    this.menu = this.node('div', '', 'menu dock-menu')
    this.menu.setAttribute('role', 'toolbar')
    this.menu.setAttribute('aria-label', 'OneWeb 网页工具')
    for (const [label, icon, run] of [
      ['Quick Ask', 'ask', () => this.tasks.quickAsk()],
      ['网页翻译', 'translate', () => this.tasks.translation()],
      ['本机剪藏', 'clip', () => this.tasks.clippings()],
      ['当前视频阅读', 'video', () => this.tasks.video()],
      ['截图与图片识别', 'vision', () => this.tasks.vision()],
      ['网页智能工具箱', 'toolbox', () => this.toolbox.show()],
    ] as const) {
      this.menu.append(this.iconButton(label, async () => {
        this.closePanels()
        await run()
      }, icon))
    }
    this.readingOptions = this.node('div', '', 'menu page-options reading-options')
    this.readingOptions.setAttribute('role', 'group')
    this.readingOptions.setAttribute('aria-label', '网页阅读操作')
    const summarize = this.iconButton('总结当前网页', async () => {
      this.closePanels()
      await this.start('summarize-page')
    }, 'summarize')
    summarize.title = '总结当前网页（Alt+Shift+S，仅此网页）'
    this.readingOptions.append(
      summarize,
      this.iconButton('询问当前网页', async () => {
        this.closePanels()
        await this.tasks.quickAsk('page')
      }, 'ask'),
      this.iconButton('阅读设置', () => this.openReadingSettings(), 'settings'),
    )
    const reading = this.iconButton('网页阅读', () => {}, 'read')
    this.menu.append(reading, this.readingOptions)
    reading.setAttribute('popovertargetaction', 'show')
    const revealReading = (event: Event) => {
      if (event.isTrusted && this.isOpen(this.menu) && !this.isOpen(this.readingOptions))
        this.readingOptions.showPopover()
    }
    reading.addEventListener('mouseenter', revealReading)
    this.pageOptions = this.node('div', '', 'menu page-options')
    this.pageOptions.setAttribute('role', 'group')
    this.pageOptions.setAttribute('aria-label', '页面助手选项')
    const dockStatus = this.node('div')
    dockStatus.setAttribute('role', 'status')
    dockStatus.setAttribute('aria-label', '工具栏设置状态')
    this.pinDockButton = this.button('固定右侧工具栏', async () => {
      if (this.savingDock)
        return
      this.savingDock = true
      dockStatus.textContent = '正在保存…'
      try {
        const dock = await this.client.request<{ pinned: boolean }>('dock-save', { settings: { pinned: !this.tools?.dock?.pinned } })
        if (this.disposed)
          return
        if (!this.tools)
          this.tools = await this.client.request<PageToolsSnapshot>('tools')
        if (this.disposed)
          return
        this.tools.dock = dock
        this.syncDock(true)
        dockStatus.textContent = '已保存工具栏设置'
      }
      catch (error) {
        if (!this.disposed)
          dockStatus.textContent = error instanceof Error ? error.message : '工具栏设置保存失败'
      }
      finally { this.savingDock = false }
    })
    this.pinDockButton.setAttribute('aria-pressed', 'false')
    this.pageOptions.append(
      this.pinDockButton,
      this.button('添加快捷动作', async () => {
        this.closePanels()
        await this.toolbox.show(true)
      }),
      this.node('hr'),
      this.button('就选文继续问', async () => {
        this.closePanels()
        await this.client.request('continue', { selection: true })
      }),
      this.node('hr'),
      this.button('本次访问隐藏', () => this.hide('visit')),
      this.button('此站点隐藏', () => this.hide('site')),
      this.button('全局关闭', () => this.hide('global')),
      dockStatus,
    )
    const options = this.iconButton('更多页面选项', () => {}, 'more')
    this.menu.append(options, this.pageOptions)
    this.launcher = this.iconButton('打开 OneWeb', () => {
      this.closePanels()
    }, 'ask')
    this.launcher.className = 'launcher icon-button'
    this.bindPopover(this.menu, this.launcher)
    this.launcher.setAttribute('popovertargetaction', 'show')
    this.bindPopover(this.pageOptions, options, true)
    this.bindPopover(this.readingOptions, reading, true)
    this.configureToolbar(this.menu, true)
    this.configureToolbar(this.toolbar)
    this.toolbox = new PageToolboxSurface(this._document, this.client, {
      run: id => this.start(id),
      changed: () => this.refreshTools(),
      error: error => this.showError(error),
    })
    this.writing = this.node('section', '', 'result task-toolbox')
    this.writing.hidden = true
    this.writing.setAttribute('role', 'dialog')
    this.writing.setAttribute('aria-label', '输入框写作')
    this.readingSettings = this.node('section', '', 'result task-toolbox')
    this.readingSettings.hidden = true
    this.readingSettings.setAttribute('role', 'dialog')
    this.readingSettings.setAttribute('aria-label', '网页阅读设置')
    this.tasks = new BrowserTasksSurface(this._document, this.client)
    shadow.append(style, this.launcher, this.menu, this.toolbar, this.result, this.toolbox.root, this.writing, this.readingSettings, this.tasks.root)
    this._document.documentElement.append(this.host)
    this._document.addEventListener('selectionchange', this.onSelection)
    this._document.addEventListener('mouseup', this.onSelection)
    this._document.addEventListener('keyup', this.onSelection)
    this._document.addEventListener('keydown', this.onKeydown)
    this._document.addEventListener('pointerdown', this.onPointerDown)
    this._document.addEventListener('scroll', this.onViewportChange, true)
    this._document.defaultView?.addEventListener('resize', this.onViewportChange)
    this._document.defaultView?.visualViewport?.addEventListener('resize', this.onViewportChange)
    this._document.defaultView?.visualViewport?.addEventListener('scroll', this.onViewportChange)
    this.showSelection()
    void this.refreshTools().catch(() => {})
  }

  async refreshTools() {
    this.tools = await this.client.request<PageToolsSnapshot>('tools')
    if (this.disposed)
      return
    this.syncDock(!!this.tools.dock?.pinned && this.toolbar.hidden && this.tasks.root.hidden && this.toolbox.root.hidden && this.readingSettings.hidden && this.writing.hidden && !this.active)
    this.showSelection()
  }

  private syncDock(reveal = false) {
    const pinned = !!this.tools?.dock?.pinned
    const opened = this.isOpen(this.menu)
    const mode = pinned ? 'manual' : 'auto'
    if (this.menu.getAttribute('popover') !== mode) {
      this.closePopover(this.readingOptions)
      this.closePopover(this.pageOptions)
      this.closePopover(this.menu)
      this.menu.setAttribute('popover', mode)
      this.menu.style.removeProperty('left')
      this.menu.style.removeProperty('top')
    }
    this.host.classList.toggle('dock-pinned', pinned)
    this.pinDockButton.setAttribute('aria-pressed', String(pinned))
    if ((reveal || opened) && !this.isOpen(this.menu) && typeof this.menu.showPopover === 'function')
      this.menu.showPopover()
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const node = this._document.createElement(tag)
    node.textContent = text
    node.className = className
    return node
  }

  private button(text: string, action: () => void | Promise<void>) {
    const button = this.node('button', text)
    button.type = 'button'
    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', (event) => {
      if (!event.isTrusted || this.disposed)
        return
      try {
        void Promise.resolve(action()).catch(error => this.showError(error))
      }
      catch (error) { this.showError(error) }
    })
    return button
  }

  private showError(error: unknown) {
    if (this.disposed)
      return
    this.result.hidden = false
    this.output.textContent = error instanceof Error ? error.message : '操作失败，请重试'
  }

  private iconButton(label: string, action: () => void | Promise<void>, icon: string) {
    const button = this.button(label, action)
    button.textContent = ''
    button.className = 'icon-button'
    button.setAttribute('aria-label', label)
    button.title = label
    button.append(surfaceIcon(this._document, icon))
    return button
  }

  private isOpen(panel: HTMLElement) {
    return typeof panel.showPopover === 'function' && panel.matches(':popover-open')
  }

  private closePopover(panel: HTMLElement) {
    if (this.isOpen(panel))
      panel.hidePopover()
  }

  private bindPopover(panel: HTMLElement, trigger: HTMLButtonElement, beside = false) {
    panel.id = `oneweb-${crypto.randomUUID()}`
    trigger.style.setProperty('anchor-name', `--${panel.id}`)
    panel.style.setProperty('position-anchor', `--${panel.id}`)
    panel.setAttribute('popover', 'auto')
    trigger.setAttribute('popovertarget', panel.id)
    trigger.setAttribute('aria-controls', panel.id)
    trigger.setAttribute('aria-expanded', 'false')
    this.popovers.set(panel, trigger)
    panel.addEventListener('toggle', () => {
      const opened = this.isOpen(panel)
      trigger.setAttribute('aria-expanded', String(opened))
      if (!opened || CSS.supports('position-area', 'block-start') || (panel === this.menu && this.tools?.dock?.pinned))
        return
      const anchor = trigger.getBoundingClientRect()
      const bounds = panel.getBoundingClientRect()
      const width = this._document.defaultView!.innerWidth
      const height = this._document.defaultView!.innerHeight
      const left = beside ? anchor.left - bounds.width - 8 : anchor.right - bounds.width
      const top = beside ? anchor.top : anchor.top - bounds.height - 8
      panel.style.left = `${Math.max(8, Math.min(left, width - bounds.width - 8))}px`
      panel.style.top = `${Math.max(8, Math.min(top, height - bounds.height - 8))}px`
    })
  }

  private toolbarButtons(bar: HTMLElement) {
    return [...bar.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.closest('[popover]') === (bar.hasAttribute('popover') ? bar : null))
  }

  private refreshTabStops(bar: HTMLElement) {
    if ('focusGroup' in HTMLElement.prototype)
      return
    this.toolbarButtons(bar).forEach((button, index) => {
      button.tabIndex = index ? -1 : 0
    })
  }

  private configureToolbar(bar: HTMLElement, vertical = false) {
    bar.setAttribute('focusgroup', vertical ? 'toolbar wrap block' : 'toolbar wrap')
    bar.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal')
    if ('focusGroup' in HTMLElement.prototype)
      return
    this.refreshTabStops(bar)
    bar.addEventListener('focusin', (event) => {
      const buttons = this.toolbarButtons(bar)
      if (buttons.includes(event.target as HTMLButtonElement))
        buttons.forEach((button) => { button.tabIndex = button === event.target ? 0 : -1 })
    })
    bar.addEventListener('keydown', (event) => {
      const buttons = this.toolbarButtons(bar)
      const current = buttons.indexOf(event.target as HTMLButtonElement)
      if (current < 0)
        return
      const rtl = getComputedStyle(bar).direction === 'rtl'
      const delta = vertical
        ? { ArrowDown: 1, ArrowUp: -1 }[event.key]
        : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key]
      const index = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : delta === undefined ? -1 : (current + delta + buttons.length) % buttons.length
      if (index >= 0) {
        event.preventDefault()
        buttons[index].focus()
      }
    })
  }

  private closePanels() {
    this.cancelSelection()
    this.readingGeneration++
    this.readingSettings.hidden = true
    this.closePopover(this.readingOptions)
    this.closePopover(this.toolbarOverflow)
    this.toolbar.hidden = true
    this.closePopover(this.pageOptions)
    if (!this.tools?.dock?.pinned)
      this.closePopover(this.menu)
    this.result.hidden = true
    this.writing.hidden = true
    this.toolbox.hide()
    this.tasks.hide()
  }

  private cancelSelection() {
    this.selectionGeneration++
    clearTimeout(this.timer)
    const cancel = this.active || this.starting
    const starting = this.starting
    this.active = false
    if (cancel) {
      this.cancellation = this.cancellation.then(async () => {
        await starting?.catch(() => {})
        if (!this.disposed)
          await this.client.request('cancel')
      }).catch(() => {})
    }
  }

  private async openReadingSettings() {
    this.closePanels()
    const generation = ++this.readingGeneration
    const status = this.node('div')
    status.setAttribute('role', 'status')
    status.textContent = '正在读取设置…'
    this.readingSettings.replaceChildren(this.node('strong', '网页阅读设置'), this.button('关闭阅读设置', () => {
      this.readingGeneration++
      this.readingSettings.hidden = true
    }), status)
    this.readingSettings.hidden = false
    try {
      const snapshot = await this.client.request<PageToolsSnapshot>('tools')
      if (this.disposed || generation !== this.readingGeneration)
        return
      const language = this.node('select')
      language.setAttribute('aria-label', '阅读输出语言')
      for (const [value, name] of pageOutputLanguages) {
        const option = this.node('option', name)
        option.value = value
        language.append(option)
      }
      language.value = snapshot.toolbar.language ?? 'zh-CN'
      const label = this.node('label', '阅读输出语言')
      label.append(language)
      this.readingSettings.insertBefore(label, status)
      this.readingSettings.append(this.node('p', '用于网页总结、翻译和选文处理。问答按问题语言作答。'), this.button('保存阅读设置', async () => {
        status.textContent = '正在保存…'
        try {
          const current = await this.client.request<PageToolsSnapshot>('tools')
          const saved = await this.client.request<PageToolsSnapshot['toolbar']>('toolbar-save', { settings: { ...current.toolbar, language: language.value } })
          if (this.disposed)
            return
          if (this.tools)
            this.tools.toolbar = saved
          if (generation === this.readingGeneration)
            status.textContent = '已保存阅读语言'
        }
        catch (error) {
          if (!this.disposed && generation === this.readingGeneration)
            status.textContent = error instanceof Error ? error.message : '保存失败，请重试'
        }
      }))
      status.textContent = ''
    }
    catch (error) {
      if (!this.disposed && generation === this.readingGeneration)
        status.textContent = error instanceof Error ? error.message : '设置读取失败'
    }
  }

  private readonly onSelection = (event: Event) => {
    if (this.active || (event instanceof KeyboardEvent && event.key === 'Escape') || this.host.contains(event.target as Node) || event.composedPath().includes(this.host))
      return
    if (event instanceof KeyboardEvent && event.isTrusted)
      this.selectionDismissed = false
    clearTimeout(this.selectionTimer)
    this.selectionTimer = setTimeout(() => this.showSelection(), 80)
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.isTrusted && !event.composedPath().includes(this.host))
      this.selectionDismissed = false
  }

  private dismissSelection() {
    clearTimeout(this.selectionTimer)
    this.selectionDismissed = true
    this.forceToolbar = false
    this.closePopover(this.toolbarOverflow)
    this.toolbar.hidden = true
    const focused = this.host.shadowRoot?.activeElement
    if (focused instanceof HTMLElement && this.toolbar.contains(focused))
      focused.blur()
    if (this.tools?.dock?.pinned && this.tasks.root.hidden && this.toolbox.root.hidden && this.writing.hidden && this.readingSettings.hidden)
      this.syncDock(true)
  }

  private renderSelectionToolbar() {
    const pinned = this.selectionPicker.pinnedActions
    for (const [id, button] of this.toolbarActions) {
      if (!pinned.some(([action]) => action === id)) {
        button.remove()
        this.toolbarActions.delete(id)
      }
    }
    for (const [id, title] of pinned) {
      let button = this.toolbarActions.get(id)
      if (!button) {
        button = this.iconButton(title, () => this.start(id), id)
        this.toolbarActions.set(id, button)
      }
      if (id === 'translate')
        button.title = `${title}（${this.tools?.toolbar.language ?? 'zh-CN'}）`
      this.toolbar.insertBefore(button, this.continueButton)
    }
    this.refreshTabStops(this.toolbar)
    if (!this.toolbar.hidden) {
      const width = this._document.defaultView?.innerWidth ?? 360
      const bounds = this.toolbar.getBoundingClientRect()
      this.toolbar.style.left = `${Math.max(8, Math.min(bounds.left, width - bounds.width - 8))}px`
    }
  }

  private readonly onViewportChange = (event: Event) => {
    if (event.composedPath().includes(this.host))
      return
    clearTimeout(this.selectionTimer)
    const focused = this.host.shadowRoot?.activeElement
    const restoreFocus = focused && [this.toolbar, this.menu].some(panel => panel.contains(focused))
    this.closePopover(this.toolbarOverflow)
    this.toolbar.hidden = true
    this.closePopover(this.pageOptions)
    this.closePopover(this.readingOptions)
    if (!this.tools?.dock?.pinned)
      this.closePopover(this.menu)
    this.forceToolbar = false
    if (restoreFocus)
      this.launcher.focus({ preventScroll: true })
  }

  private showSelection() {
    if (this.disposed || this.selectionDismissed || (this.isOpen(this.menu) && !this.tools?.dock?.pinned) || !this.tasks.root.hidden || !this.toolbox.root.hidden || !this.writing.hidden || !this.readingSettings.hidden || this.active)
      return
    const selection = this._document.getSelection()
    const active = this._document.activeElement
    if (active === this.host)
      return
    const common = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null
    const selectedElement = common?.nodeType === 1 ? common as Element : common?.parentElement
    const selectedEditor = selection && !selection.isCollapsed
      ? selectedElement?.closest<HTMLElement>('[contenteditable="true"],[contenteditable=""]')
      : null
    const input = !selectedEditor && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
    const native = input ? active as HTMLInputElement | HTMLTextAreaElement : null
    if (active instanceof HTMLInputElement && !['text', 'search', 'url', 'tel'].includes(active.type)) {
      this.toolbar.hidden = true
      return
    }
    const hasSelection = native ? native.selectionStart !== null && native.selectionEnd! > native.selectionStart : selection && !selection.isCollapsed
    const activeEditor = active instanceof HTMLElement ? active.closest<HTMLElement>('[contenteditable="true"],[contenteditable=""]') : null
    const editor = selectedEditor ?? activeEditor ?? (native || null)
    const editable = !!editor
    if ((!hasSelection && !editable) || (selection?.anchorNode && this.host.contains(selection.anchorNode))) {
      this.toolbar.hidden = true
      return
    }
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const snapshot = [
      native ?? range?.startContainer ?? null,
      native ? native.selectionStart : range?.startOffset ?? null,
      native ?? range?.endContainer ?? null,
      native ? native.selectionEnd : range?.endOffset ?? null,
      native ? native.value : editor?.textContent ?? selection?.toString() ?? '',
    ] as const
    // Restoring an editor range can deliver selectionchange after a fast answer completes.
    if (!this.result.hidden && this.selectionSnapshot?.every((value, index) => value === snapshot[index]))
      return
    this.selectionSnapshot = snapshot
    this.editor = editor
    this.editorRange = editor && !native && range ? range.cloneRange() : null
    this.editorText = editor?.textContent ?? ''
    if (this.tools?.toolbar.mode === 'off' || (this.tools?.toolbar.mode === 'shortcut' && !this.forceToolbar)) {
      this.toolbar.hidden = true
      return
    }
    let actions = editable
      ? [['rewrite', '改写选文'], ['formal', '正式语气'], ['shorter', '精简'], ['longer', '扩写'], ['translate', '翻译选文']]
      : [['translate', '翻译选文'], ['explain', '解释选文'], ['summarize', '总结选文'], ['rewrite', '改写选文']]
    if (this.tools) {
      actions = this.tools.actions.filter(tool => !tool.moduleId && (tool.scope === 'selection' || (editable && tool.scope === 'editor'))
        && (hasSelection || ['compose', 'reply'].includes(tool.id) || (tool.scope === 'editor' && tool.id.startsWith('custom:')))
        && !this.tools!.toolbar.disabled.includes(tool.id))
        .sort((a, b) => {
          const rank = (id: string) => this.tools!.toolbar.order.includes(id) ? this.tools!.toolbar.order.indexOf(id) : 1000
          return rank(a.id) - rank(b.id)
        })
        .map(tool => [tool.id, tool.title])
    }
    this.result.hidden = true
    this.selectionActions = actions
    this.selectionPicker.configure(this.tools ?? { actions: [], toolbar: { mode: 'automatic', order: [], disabled: [] } }, this.selectionActions)
    this.renderSelectionToolbar()
    const rect = native ? native.getBoundingClientRect() : selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : editor?.getBoundingClientRect()
    const width = this._document.defaultView?.innerWidth ?? 360
    this.refreshTabStops(this.toolbar)
    this.toolbar.hidden = false
    const bounds = this.toolbar.getBoundingClientRect()
    const height = this._document.defaultView?.innerHeight ?? 800
    const below = (rect?.bottom ?? 20) + 8
    const top = below + bounds.height <= height - 8 ? below : (rect?.top ?? 20) - bounds.height - 8
    let left = Math.max(8, Math.min(rect?.left ?? 8, width - bounds.width - 8))
    const placedTop = Math.max(8, Math.min(top, height - bounds.height - 8))
    if (this.tools?.dock?.pinned && this.isOpen(this.menu)) {
      const dock = this.menu.getBoundingClientRect()
      if (placedTop < dock.bottom && placedTop + bounds.height > dock.top && left + bounds.width > dock.left - 8) {
        if (dock.left - bounds.width - 8 >= 8)
          left = Math.min(left, dock.left - bounds.width - 8)
        else
          this.closePopover(this.menu)
      }
    }
    this.toolbar.style.left = `${left}px`
    this.toolbar.style.top = `${placedTop}px`
  }

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.isTrusted && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyS') {
      event.preventDefault()
      this.closePanels()
      void this.start('summarize-page').catch(error => this.showError(error))
      return
    }
    if (event.altKey && event.shiftKey && event.code === 'KeyT') {
      event.preventDefault()
      this.selectionDismissed = false
      this.forceToolbar = true
      if (this._document.activeElement === this.host) {
        if (this.editor)
          this.editor.focus({ preventScroll: true })
        else if (this.host.shadowRoot?.activeElement instanceof HTMLElement)
          this.host.shadowRoot.activeElement.blur()
      }
      this.showSelection()
    }
    if (event.key === 'Escape') {
      clearTimeout(this.selectionTimer)
      const opened = [...this.popovers].reverse().find(([panel]) => this.isOpen(panel))
      if (opened) {
        event.preventDefault()
        this.closePopover(opened[0])
        opened[1].focus()
        return
      }
      this.dismissSelection()
      this.result.hidden = true
      this.closePopover(this.menu)
      this.toolbox.hide()
      this.writing.hidden = true
      this.readingGeneration++
      this.readingSettings.hidden = true
      this.tasks.hide()
      this.forceToolbar = false
      this.cancelSelection()
    }
  }

  private showWriting(action: string) {
    this.closePopover(this.toolbarOverflow)
    this.writing.replaceChildren(this.node('strong', action === 'reply' ? '撰写回复' : '在光标处撰写'))
    const label = this.node('label', '撰写或回复要求')
    const input = this.node('textarea')
    input.rows = 4
    input.setAttribute('aria-label', '撰写或回复要求')
    label.append(input)
    const context = this.node('input')
    context.type = 'checkbox'
    context.setAttribute('aria-label', '附加当前页面作为回复上下文')
    const contextLabel = this.node('label', '附加当前页面作为回复上下文')
    contextLabel.prepend(context)
    this.writing.append(label, contextLabel, this.button('生成预览', async () => {
      if (!input.value.trim())
        throw new Error('请填写撰写或回复要求')
      this.writing.hidden = true
      await this.start(action, false, { text: input.value, context: context.checked ? 'page' : undefined })
    }), this.button('取消撰写', () => { this.writing.hidden = true }))
    this.toolbar.hidden = true
    this.writing.hidden = false
    input.focus()
  }

  private async start(action: string, retry = false, input?: { text?: string, context?: string }) {
    if (!retry && !input)
      this.showSelection()
    if (['compose', 'reply'].includes(action) && !retry && !input) {
      this.showWriting(action)
      return
    }
    if (this.active)
      return
    clearTimeout(this.selectionTimer)
    const generation = ++this.selectionGeneration
    this.active = true
    this.lastAction = action
    this.closePopover(this.toolbarOverflow)
    this.toolbar.hidden = true
    if (!this.tools?.dock?.pinned)
      this.closePopover(this.menu)
    this.result.hidden = false
    this.result.setAttribute('aria-label', action === 'summarize-page' ? 'OneWeb 网页阅读' : 'OneWeb 选文助手')
    this.result.querySelector('strong')!.textContent = action === 'summarize-page' ? 'ONEWEB · 网页总结' : 'ONEWEB · 选文助手'
    this.output.setAttribute('aria-label', action === 'summarize-page' ? '网页阅读结果' : '选文结果')
    this.output.textContent = '正在连接模型…'
    this.applyButton.hidden = true
    this.insertButton.hidden = true
    try {
      await this.cancellation
      if (this.disposed || generation !== this.selectionGeneration)
        return
      const tools = await this.client.request<PageToolsSnapshot>('tools')
      if (this.disposed || generation !== this.selectionGeneration)
        return
      const scope = tools.actions.find(tool => tool.id === action)?.scope
      if ((scope === 'selection' || scope === 'editor') && this.editor?.isConnected) {
        if (this.editorRange && (this.editor.textContent !== this.editorText || !this.editor.contains(this.editorRange.commonAncestorContainer)))
          throw new Error('编辑器原文或选区已变化，请重新选择')
        this.editor.focus({ preventScroll: true })
        if (this.editorRange) {
          const selection = this._document.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(this.editorRange.cloneRange())
        }
      }
      const starting = this.client.start(action, retry, input)
      this.starting = starting
      const result = await starting.finally(() => {
        if (this.starting === starting)
          this.starting = undefined
      })
      if (this.disposed || generation !== this.selectionGeneration)
        return
      if ((result as { opened?: boolean }).opened) {
        this.active = false
        this.output.textContent = '已在工作区打开工具'
        return
      }
      this.applyButton.dataset.editable = String(result.editable)
      await this.poll(generation)
    }
    catch (error) {
      if (!this.disposed && generation === this.selectionGeneration) {
        this.active = false
        throw error
      }
    }
  }

  private async poll(generation = this.selectionGeneration) {
    clearTimeout(this.timer)
    if (this.disposed || generation !== this.selectionGeneration)
      return
    const answer: AssistantMessage = await this.client.poll()
    if (this.disposed || generation !== this.selectionGeneration)
      return
    this.answer = answer.text
    this.output.textContent = `${answer.text}${answer.error ? `\n${answer.error}` : ''}${answer.status === 'cancelled' ? '\n已停止，保留部分回答' : ''}`
    this.active = answer.status === 'preparing' || answer.status === 'streaming'
    this.applyButton.hidden = answer.status !== 'completed' || this.applyButton.dataset.editable !== 'true'
    this.insertButton.hidden = this.applyButton.hidden
    if (this.active) {
      this.timer = setTimeout(() => {
        void this.poll(generation).catch((error) => {
          if (!this.disposed && generation === this.selectionGeneration) {
            this.active = false
            this.showError(error)
          }
        })
      }, 150)
    }
  }

  private async hide(scope: string) {
    await this.client.request('hide', { scope })
    this.dispose()
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    this.selectionGeneration++
    this.readingGeneration++
    clearTimeout(this.timer)
    clearTimeout(this.selectionTimer)
    this._document.removeEventListener('selectionchange', this.onSelection)
    this._document.removeEventListener('mouseup', this.onSelection)
    this._document.removeEventListener('keyup', this.onSelection)
    this._document.removeEventListener('keydown', this.onKeydown)
    this._document.removeEventListener('pointerdown', this.onPointerDown)
    this._document.removeEventListener('scroll', this.onViewportChange, true)
    this._document.defaultView?.removeEventListener('resize', this.onViewportChange)
    this._document.defaultView?.visualViewport?.removeEventListener('resize', this.onViewportChange)
    this._document.defaultView?.visualViewport?.removeEventListener('scroll', this.onViewportChange)
    this.tasks.dispose()
    this.toolbox.hide()
    this.selectionPicker.dispose()
    this.host.remove()
  }

  async quickAsk() {
    this.closePanels()
    await this.tasks.quickAsk()
  }

  notice(text: string) {
    this.result.hidden = false
    this.output.textContent = text
  }

  captureHidden(hidden: boolean) { this.host.style.visibility = hidden ? 'hidden' : '' }
}
