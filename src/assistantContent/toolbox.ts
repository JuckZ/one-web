/* eslint no-template-curly-in-string: off -- Browser prompt templates use literal placeholders. */
import type { PageActionClient } from '~/workspace/page-actions'
import type { PageTool, PageToolsSnapshot } from '~/workspace/page-tools'

export class PageToolboxSurface {
  readonly root: HTMLElement
  private snapshot: PageToolsSnapshot | null = null
  private query = ''
  private filter = 'all'
  private editingId: string | undefined
  private generation = 0

  constructor(private readonly _document: Document, private readonly _client: PageActionClient, private readonly _options: {
    run: (_id: string) => Promise<void>
    changed: () => Promise<void>
    error: (_error: unknown) => void
  }) {
    this.root = this.node('section', '', 'result task-toolbox')
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', '网页智能工具箱')
    this.root.hidden = true
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const node = this._document.createElement(tag)
    node.textContent = text
    node.className = className
    return node
  }

  private button(text: string, action: () => void | Promise<void>, label = text) {
    const button = this.node('button', text)
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', (event) => {
      if (event.isTrusted)
        void Promise.resolve().then(action).catch(this._options.error)
    })
    return button
  }

  private field(label: string, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    const wrapper = this.node('label', label)
    input.setAttribute('aria-label', label)
    wrapper.append(input)
    return wrapper
  }

  private select(options: string[][]) {
    const input = this.node('select')
    for (const [value, label] of options) {
      const option = this.node('option', label)
      option.value = value
      input.append(option)
    }
    return input
  }

  async show(create = false) {
    const generation = ++this.generation
    const snapshot = await this._client.request<PageToolsSnapshot>('tools')
    if (generation !== this.generation)
      return
    this.snapshot = snapshot
    this.root.hidden = false
    this.render()
    if (create)
      this.root.querySelector<HTMLInputElement>('[aria-label="动作名称"]')?.focus()
  }

  hide() {
    this.generation++
    this.root.hidden = true
  }

  private render() {
    const snapshot = this.snapshot!
    this.root.replaceChildren()
    this.root.append(this.node('strong', '网页智能工具箱'), this.button('关闭工具箱', () => {
      this.hide()
    }))
    const search = this.node('input')
    search.type = 'search'
    search.placeholder = '搜索页面、选文和站点工具'
    search.value = this.query
    search.setAttribute('aria-label', '搜索网页工具')
    const filter = this.select([['all', '全部工具'], ['favorites', '收藏'], ['recent', '最近使用']])
    filter.value = this.filter
    filter.setAttribute('aria-label', '工具筛选')
    const list = this.node('div', '', 'task-tools-list')
    const title = this.node('input')
    const template = this.node('textarea')
    template.rows = 3
    template.placeholder = '支持 ${text} 和 ${language}，不执行脚本'
    const scope = this.select([['page', '当前网页'], ['selection', '选文'], ['editor', '输入框']])
    const populate = () => {
      list.replaceChildren()
      for (const tool of snapshot.actions.filter(tool => tool.title.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())
        && (this.filter === 'all' || (this.filter === 'favorites' ? tool.favorite : tool.recent)))) {
        const row = this.node('div', '', 'task-tool-row')
        row.append(
          this.button(tool.title, async () => {
            this.hide()
            await this._options.run(tool.id)
          }, `执行 ${tool.title}`),
          this.button(tool.favorite ? '★' : '☆', async () => {
            await this._client.request('tool-favorite', { id: tool.id, favorite: !tool.favorite })
            await this.show()
          }, `${tool.favorite ? '取消收藏' : '收藏'} ${tool.title}`),
          this.node('small', `${{ page: '当前网页', selection: '选文', editor: '输入框', site: '站点工具' }[tool.scope]}${tool.recent ? ' · 最近使用' : ''}`),
        )
        if (tool.custom) {
          row.append(this.button('编辑', async () => {
            const action = await this._client.request<PageTool>('tool-edit', { id: tool.id })
            this.editingId = action.id
            title.value = action.title
            template.value = action.template ?? ''
            scope.value = action.scope
            title.focus()
          }, `编辑动作 ${tool.title}`))
          row.append(this.button('删除', async () => {
            await this._client.request('tool-delete', { id: tool.id })
            if (this.editingId === tool.id)
              this.editingId = undefined
            await this.show()
            await this._options.changed()
          }, `删除动作 ${tool.title}`))
        }
        list.append(row)
      }
      if (!list.childElementCount)
        list.append(this.node('p', '没有匹配的工具'))
    }
    search.addEventListener('input', () => {
      this.query = search.value
      populate()
    })
    filter.addEventListener('change', () => {
      this.filter = filter.value
      populate()
    })
    populate()
    this.root.append(search, filter, list, this.node('h3', '轻量自定义动作'))
    this.root.append(this.field('动作名称', title), this.field('动作范围', scope), this.field('动作模板', template))
    this.root.append(this.button('保存动作', async () => {
      await this._client.request<PageTool>('tool-save', { action: { id: this.editingId, title: title.value, template: template.value, scope: scope.value } })
      this.editingId = undefined
      await this.show()
      await this._options.changed()
    }))
    this.root.append(this.node('h3', '选文工具条'))
    const mode = this.select([['automatic', '选中时自动展示'], ['shortcut', '快捷键展示（Alt+Shift+T）'], ['off', '关闭选文工具条']])
    mode.value = snapshot.toolbar.mode
    mode.addEventListener('change', () => {
      snapshot.toolbar.mode = mode.value as typeof snapshot.toolbar.mode
      void this.saveToolbar().catch(this._options.error)
    })
    this.root.append(this.field('工具条展示', mode))
    const ordered = [...snapshot.actions].filter(tool => !tool.moduleId && tool.scope !== 'page').sort((a, b) => {
      const rank = (id: string) => snapshot.toolbar.order.includes(id) ? snapshot.toolbar.order.indexOf(id) : 1000
      return rank(a.id) - rank(b.id)
    })
    for (const [index, tool] of ordered.entries()) {
      const row = this.node('div', '', 'task-tool-row')
      const enabled = this.node('input')
      enabled.type = 'checkbox'
      enabled.checked = !snapshot.toolbar.disabled.includes(tool.id)
      enabled.setAttribute('aria-label', `显示动作 ${tool.title}`)
      enabled.addEventListener('change', () => {
        snapshot.toolbar.disabled = snapshot.toolbar.disabled.filter(id => id !== tool.id)
        if (!enabled.checked)
          snapshot.toolbar.disabled.push(tool.id)
        void this.saveToolbar().catch(this._options.error)
      })
      row.append(enabled, this.node('span', tool.title))
      for (const [offset, label] of [[-1, '上移'], [1, '下移']] as const) {
        const move = this.button(label, async () => {
          const ids = ordered.map(tool => tool.id)
          ;
          [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]
          snapshot.toolbar.order = ids
          await this.saveToolbar()
          this.render()
        }, `${label}动作 ${tool.title}`)
        move.disabled = index + offset < 0 || index + offset >= ordered.length
        row.append(move)
      }
      this.root.append(row)
    }
    this.root.append(this.node('small', '工作区自定义提示词可直接加入工具条；在工作区设置中编辑模板。'))
  }

  private async saveToolbar() {
    await this._client.request('toolbar-save', { settings: this.snapshot!.toolbar })
    await this._options.changed()
  }
}
