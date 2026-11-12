import type { CookieImportPreview, CookieMutation, CookiePreparation, CookieResult, CookieScope, CookieSnapshot, ManagedCookie } from '~/modules/builtin/cookie-manager/contracts'
import { COOKIE_BATCH_LIMIT, COOKIE_FILE_LIMIT } from '~/modules/builtin/cookie-manager/contracts'
import type { CookieManagerClient } from '~/modules/builtin/cookie-manager/protocol'

export interface CookieManagerViewOptions {
  client: CookieManagerClient
  permissions: { request: (_details: { permissions: Array<'cookies'>, origins: string[] }) => Promise<boolean> }
  clipboard?: { writeText: (_text: string) => Promise<void> }
  firefox?: boolean
  download?: (_text: string, _filename: string) => void
}

export function cookieError(reason: string) {
  const messages: Record<string, string> = {
    'module-disabled': '请先启用 Cookie Manager。',
    'permission-required': '访问权限已失效，请重新选择范围并授权。',
    'permission-denied': '未获得访问权限，可以重试授权。',
    'invalid-site': '当前标签页不是可管理的 HTTP(S) 网站。',
    'invalid-input': 'Cookie 字段或文件内容无效，请检查。',
    'limit-exceeded': '数据超过限制：文件 8 MiB、单项 16 KiB、批量操作 200 项。',
    'unsupported-format': '请选择本功能导出的 Cookie JSON 数组。',
    'unsupported-partition': '当前浏览器无法完整处理这个分区，操作已停止。',
    'store-unavailable': '所选 Cookie Store 已不可访问，请刷新。',
    'stale-cookie': 'Cookie 已被网站或其他编辑器更新，请刷新后重试。',
    'ambiguous-cookie-target': '浏览器无法唯一定位所选 Cookie，已阻止删除。',
    'lifecycle-cancelled': '管理会话已失效，请重新选择范围并读取。',
    'browser-operation-failed': '浏览器未完成操作，请刷新检查。',
    'outcome-unknown': '操作期间权限或会话发生变化，结果未知。请手动刷新，避免重复操作。',
    'transport-error': '后台暂时不可用，请重新读取。',
    'invalid-response': '后台响应无效，请重新读取。',
  }
  return messages[reason] || '操作未完成，请刷新检查。'
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag)
  if (text !== undefined)
    result.textContent = text
  return result
}

function describeCookie(cookie: ManagedCookie) {
  return `${cookie.domain} · ${cookie.name || '(空名称)'} · ${cookie.path} · Store ${cookie.storeId}${
    cookie.partitionKey ? ` · 分区 ${cookie.partitionKey.topLevelSite} · 跨站祖先 ${String(cookie.partitionKey.hasCrossSiteAncestor ?? '未提供')}` : ' · 未分区'
  }${cookie.firstPartyDomain === undefined ? '' : ` · First-party domain ${cookie.firstPartyDomain || '(空)'}`
  }${cookie.hostOnly ? ' · Host-only' : ' · Domain'}`
}

export class CookieManagerView {
  private snapshot: CookieSnapshot | null = null
  private preparation: CookiePreparation | null = null
  private readonly selected = new Set<string>()
  private search = ''
  private store = ''
  private message = '选择管理范围后，才会申请权限并读取 Cookie。'
  private busy = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private expiresAt = 0
  private deletion: string[] | null = null
  private editor: { cookie: ManagedCookie, entryId?: string } | null = null
  private exportIds: string[] | null = null
  private importStore = ''
  private preview: CookieImportPreview | null = null
  private readonly importSelected = new Set<string>()
  private readonly objectUrls = new Set<string>()
  private readonly list = node('div')
  private results: string[] = []

  constructor(readonly root: HTMLElement, private readonly _options: CookieManagerViewOptions) {
    root.classList.add('cookie-manager')
    root.dataset.testid = 'cookie-manager'
    document.addEventListener('visibilitychange', this.visibilityChanged)
    this.render()
  }

  private button(label: string, testId: string, action: () => void, disabled = false) {
    const button = node('button', label)
    button.type = 'button'
    button.className = 'secondary-button'
    button.dataset.testid = testId
    button.disabled = this.busy || disabled
    button.addEventListener('click', action)
    return button
  }

  private async perform<T>(work: () => Promise<CookieResult<T>>, accept: (_value: T) => void) {
    if (this.busy)
      return
    const generation = this.generation
    this.busy = true
    this.render()
    try {
      const result = await work()
      if (generation !== this.generation) {
        if (result.ok && result.value && typeof result.value === 'object') {
          const value = result.value
          if ('token' in value && typeof value.token === 'string')
            void this._options.client.close(value.token)
          const snapshot = 'snapshot' in value ? value.snapshot : value
          if (snapshot && typeof snapshot === 'object' && 'stores' in snapshot
            && 'id' in snapshot && typeof snapshot.id === 'string') {
            void this._options.client.close(snapshot.id)
          }
        }
        return
      }
      if (result.ok) {
        accept(result.value)
      }
      else {
        this.message = cookieError(result.reason)
        if (['permission-required', 'lifecycle-cancelled', 'module-disabled', 'transport-error', 'invalid-response'].includes(result.reason))
          this.reset(this.message)
      }
    }
    catch {
      if (generation === this.generation)
        this.message = '操作未完成，请重新读取。'
    }
    finally {
      if (generation === this.generation) {
        this.busy = false
        this.render()
      }
    }
  }

  private choose(scope: CookieScope) {
    this.reset()
    const expiresAt = Date.now() + 10 * 60_000
    void this.perform(() => this._options.client.prepare(scope), (preparation) => {
      this.preparation = preparation
      this.expiresAt = expiresAt
      this.message = preparation.hostname
        ? `将管理 ${preparation.hostname}，请确认访问权限。`
        : '将申请所有 HTTP/HTTPS 网站的 Cookie 访问权限。'
    })
  }

  private authorize() {
    const preparation = this.preparation
    if (!preparation)
      return
    // Called directly from the click handler, before any asynchronous work.
    const permission = this._options.permissions.request({ permissions: ['cookies'], origins: preparation.origins })
    void this.perform(async () => {
      if (!await permission)
        return { ok: false, reason: 'permission-denied' }
      return this._options.client.open(preparation.token)
    }, snapshot => this.adopt(snapshot))
  }

  private adopt(snapshot: CookieSnapshot) {
    this.snapshot = snapshot
    this.preparation = null
    this.selected.clear()
    this.deletion = null
    this.editor = null
    this.exportIds = null
    this.preview = null
    this.importSelected.clear()
    this.results = []
    this.message = `已读取 ${snapshot.entries.length} 个 Cookie；值默认隐藏。`
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.reset('管理会话已到期，请重新读取。'), Math.max(0, this.expiresAt - Date.now()))
  }

  private visible() {
    const search = this.search.trim().toLowerCase()
    return (this.snapshot?.entries || []).filter(entry => (!this.store || entry.cookie.storeId === this.store)
      && (!search || `${entry.cookie.domain}\n${entry.cookie.name}`.toLowerCase().includes(search))).sort((a, b) => a.cookie.domain.localeCompare(b.cookie.domain)
        || a.cookie.name.localeCompare(b.cookie.name) || a.cookie.path.localeCompare(b.cookie.path)
        || a.cookie.storeId.localeCompare(b.cookie.storeId))
  }

  private async refreshAfter(results: CookieMutation[]) {
    if (!this.snapshot)
      return { ok: false, reason: 'lifecycle-cancelled' } as const
    const refreshed = await this._options.client.refresh(this.snapshot.id)
    return refreshed.ok ? { ok: true, value: { snapshot: refreshed.value, results } } as const : refreshed
  }

  private confirmDeletion() {
    if (!this.snapshot || !this.deletion)
      return
    const { id } = this.snapshot
    const ids = [...this.deletion]
    const labels = new Map(this.snapshot.entries.map(entry => [entry.id, describeCookie(entry.cookie)]))
    void this.perform(async () => {
      const result = await this._options.client.delete(id, ids)
      return result.ok ? this.refreshAfter(result.value) : result
    }, ({ snapshot, results }) => {
      this.adopt(snapshot)
      this.report(results, labels)
    })
  }

  private report(results: CookieMutation[], labels: Map<string, string>) {
    const success = results.filter(item => item.ok).length
    this.message = `成功 ${success} 项，未完成 ${results.length - success} 项。`
    this.results = results.map(item => `${labels.get(item.id) || '(未知目标)'}：${item.ok ? '成功' : cookieError(item.reason || 'browser-operation-failed')}`)
  }

  private render() {
    const heading = node('h3', 'Cookie 管理')
    const message = node('p', this.message)
    message.setAttribute('role', 'status')
    message.dataset.testid = 'cookie-status'
    const actions = node('div')
    actions.className = 'cookie-actions'
    actions.append(
      this.button('当前站点', 'cookie-current', () => this.choose('current')),
      this.button('所有网站', 'cookie-all', () => this.choose('all')),
    )
    this.root.replaceChildren(heading, message, actions)
    for (const text of this.results) {
      const item = node('p', text)
      item.dataset.cookieResult = ''
      this.root.append(item)
    }
    if (this.preparation) {
      const review = node('div')
      review.className = 'cookie-review'
      review.append(node('p', `授权范围：${this.preparation.origins.join('、')}`), this.button('授权并读取', 'cookie-authorize', () => this.authorize()))
      this.root.append(review)
    }
    if (!this.snapshot)
      return
    const toolbar = node('div')
    toolbar.className = 'cookie-actions'
    const search = node('input')
    search.type = 'search'
    search.placeholder = '搜索域名或名称'
    search.setAttribute('aria-label', '搜索域名或名称')
    search.value = this.search
    search.disabled = this.busy
    search.addEventListener('input', () => {
      this.search = search.value
      this.selected.clear()
      this.deletion = null
      this.exportIds = null
      this.renderList()
    })
    const store = node('select')
    store.setAttribute('aria-label', '筛选 Cookie Store')
    store.append(new Option('所有 Store', ''))
    for (const id of this.snapshot.stores)
      store.append(new Option(`Store ${id}`, id))
    store.value = this.store
    store.disabled = this.busy
    store.addEventListener('change', () => {
      this.store = store.value
      this.selected.clear()
      this.deletion = null
      this.exportIds = null
      this.render()
    })
    toolbar.append(search, store, this.button('新建 Cookie', 'cookie-create', () => {
      this.editor = {
        cookie: {
          name: '',
          value: '',
          domain: this.snapshot?.hostname || '',
          path: '/',
          storeId: this.store || this.snapshot!.stores[0] || '',
          hostOnly: true,
          secure: true,
          httpOnly: false,
          session: true,
          sameSite: 'lax',
        },
      }
      this.render()
    }, !this.snapshot.stores.length), this.button('刷新', 'cookie-refresh', () => {
      if (this.snapshot)
        void this.perform(() => this._options.client.refresh(this.snapshot!.id), value => this.adopt(value))
    }), this.button('结束管理', 'cookie-close', () => this.reset('已结束管理。浏览器的共享权限保持原状。')))
    this.root.append(node('p', this.snapshot.hostname ? `当前站点：${this.snapshot.hostname}` : '范围：所有已授权网站'), toolbar, this.list)
    this.renderList()
    this.root.append(this.renderImport())
    if (this.editor)
      this.root.append(this.renderEditor())
  }

  private renderList() {
    const entries = this.visible()
    const groups = new Map<string, typeof entries>()
    for (const entry of entries) {
      const group = groups.get(entry.cookie.domain) || []
      group.push(entry)
      groups.set(entry.cookie.domain, group)
    }
    const actions = node('div')
    actions.className = 'cookie-actions'
    actions.append(
      this.button('选择当前结果', 'cookie-select-visible', () => {
        for (const entry of entries)
          this.selected.add(entry.id)
        this.deletion = null
        this.exportIds = null
        this.renderList()
      }),
      this.button('取消选择', 'cookie-select-none', () => {
        this.selected.clear()
        this.deletion = null
        this.exportIds = null
        this.renderList()
      }),
      this.button(`删除所选（${this.selected.size}）`, 'cookie-delete', () => {
        this.deletion = [...this.selected]
        this.exportIds = null
        this.renderList()
      }, !this.selected.size || this.selected.size > COOKIE_BATCH_LIMIT),
      this.button(`导出 JSON（${this.selected.size}）`, 'cookie-export', () => {
        this.exportIds = [...this.selected]
        this.deletion = null
        this.renderList()
      }, !this.selected.size),
    )
    this.list.replaceChildren(actions)
    if (this.exportIds) {
      const review = node('div')
      review.className = 'cookie-review'
      review.append(node('p', `将导出 ${this.exportIds.length} 个 Cookie。JSON 包含明文登录凭据，请妥善保管。`), this.button('确认导出明文 JSON', 'cookie-export-confirm', () => {
        if (!this.snapshot || !this.exportIds)
          return
        void this.perform(() => this._options.client.export(this.snapshot!.id, this.exportIds!), (text) => {
          if (this._options.download) {
            this._options.download(text, 'oneweb-cookies.json')
          }
          else {
            const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
            this.objectUrls.add(url)
            const link = node('a')
            link.href = url
            link.download = 'oneweb-cookies.json'
            link.click()
            setTimeout(() => {
              URL.revokeObjectURL(url)
              this.objectUrls.delete(url)
            }, 1000)
          }
          this.exportIds = null
          this.message = 'JSON 已导出，请妥善保管文件。'
        })
      }), this.button('取消导出', 'cookie-export-cancel', () => {
        this.exportIds = null
        this.renderList()
      }))
      this.list.append(review)
    }
    if (this.deletion) {
      const review = node('div')
      review.className = 'cookie-review'
      review.append(node('p', `将删除 ${this.deletion.length} 个 Cookie。网站可能需要重新登录。`))
      for (const id of this.deletion) {
        const cookie = this.snapshot?.entries.find(entry => entry.id === id)?.cookie
        if (cookie)
          review.append(node('p', describeCookie(cookie)))
      }
      review.append(this.button('确认删除', 'cookie-delete-confirm', () => this.confirmDeletion()), this.button('取消', 'cookie-delete-cancel', () => {
        this.deletion = null
        this.exportIds = null
        this.renderList()
      }))
      this.list.append(review)
    }
    if (!entries.length)
      this.list.append(node('p', '没有符合条件的 Cookie。'))
    let domain = ''
    for (const entry of entries) {
      if (entry.cookie.domain !== domain) {
        domain = entry.cookie.domain
        const group = groups.get(domain)!
        const heading = node('h4', `${domain}（${group.length}）`)
        const actions = node('div')
        actions.className = 'cookie-actions'
        actions.append(heading, this.button('选择该域名', 'cookie-select-domain', () => {
          for (const item of group)
            this.selected.add(item.id)
          this.deletion = null
          this.exportIds = null
          this.renderList()
        }))
        this.list.append(actions)
      }
      const row = node('div')
      row.className = 'cookie-row'
      row.dataset.cookieRow = entry.id
      const label = node('label')
      const selected = node('input')
      selected.type = 'checkbox'
      selected.dataset.cookieSelect = entry.id
      selected.checked = this.selected.has(entry.id)
      selected.disabled = this.busy
      selected.addEventListener('change', () => {
        if (selected.checked)
          this.selected.add(entry.id)
        else
          this.selected.delete(entry.id)
        this.deletion = null
        this.exportIds = null
        this.renderList()
      })
      label.append(selected, document.createTextNode(entry.cookie.name || '(空名称)'))
      row.append(label, node('small', `${entry.cookie.path} · Store ${entry.cookie.storeId} · 值已隐藏`))
      if (entry.cookie.partitionKey)
        row.append(node('small', `分区：${entry.cookie.partitionKey.topLevelSite} · 跨站祖先：${String(entry.cookie.partitionKey.hasCrossSiteAncestor ?? '未提供')}`))
      const buttons = node('div')
      buttons.className = 'cookie-actions'
      buttons.append(
        this.button('查看 / 编辑', 'cookie-edit', () => {
          this.editor = { cookie: structuredClone(entry.cookie), entryId: entry.id }
          this.render()
        }),
        this.button('复制值', 'cookie-copy', () => {
          const clipboard = this._options.clipboard || navigator.clipboard
          void this.perform(async () => {
            await clipboard.writeText(entry.cookie.value)
            return { ok: true, value: null }
          }, () => {
            this.message = 'Cookie 值已复制。'
          })
        }),
      )
      row.append(buttons)
      this.list.append(row)
    }
  }

  private renderImport() {
    const section = node('section')
    section.className = 'cookie-import'
    section.append(node('h4', '导入 JSON'), node('p', '选择目标 Store 并读取文件。预览阶段不会修改 Cookie。'))
    const label = node('label', '导入目标 Store')
    const store = node('select')
    store.dataset.testid = 'cookie-import-store'
    store.append(new Option('请选择目标 Store', ''))
    for (const id of this.snapshot!.stores)
      store.append(new Option(`Store ${id}`, id))
    store.value = this.importStore
    store.disabled = this.busy
    store.addEventListener('change', () => {
      this.importStore = store.value
      this.preview = null
      this.importSelected.clear()
      this.render()
    })
    label.append(store)
    const file = node('input')
    file.type = 'file'
    file.accept = '.json,application/json'
    file.dataset.testid = 'cookie-import-file'
    file.setAttribute('aria-label', '选择 Cookie JSON 文件')
    file.disabled = this.busy || !this.importStore
    file.addEventListener('change', () => {
      const source = file.files?.[0]
      if (!source || !this.snapshot || !this.importStore)
        return
      if (source.size > COOKIE_FILE_LIMIT) {
        this.message = cookieError('limit-exceeded')
        this.render()
        return
      }
      const snapshotId = this.snapshot.id
      const storeId = this.importStore
      void this.perform(async () => this._options.client.preview(snapshotId, await source.text(), storeId), (preview) => {
        this.preview = preview
        this.importSelected.clear()
        this.message = `已预览 ${preview.entries.length} 项，其中 ${preview.entries.filter(entry => entry.replaces).length} 项将覆盖现有 Cookie。请选择导入项。`
      })
    })
    section.append(label, file)
    if (this.preview) {
      const preview = this.preview
      section.append(
        this.button('选择全部预览项', 'cookie-import-all', () => {
          for (const entry of preview.entries)
            this.importSelected.add(entry.id)
          this.render()
        }),
        this.button('取消预览', 'cookie-import-cancel', () => {
          this.preview = null
          this.importSelected.clear()
          this.render()
        }),
      )
      for (const entry of preview.entries) {
        const row = node('label')
        row.dataset.cookiePreview = entry.id
        const selected = node('input')
        selected.type = 'checkbox'
        selected.dataset.cookiePreviewSelect = entry.id
        selected.checked = this.importSelected.has(entry.id)
        selected.disabled = this.busy
        selected.addEventListener('change', () => {
          if (selected.checked)
            this.importSelected.add(entry.id)
          else
            this.importSelected.delete(entry.id)
          this.render()
        })
        row.append(selected, document.createTextNode(`${entry.replaces ? '覆盖' : '新增'} · ${describeCookie(entry.cookie)}`))
        section.append(row)
      }
      section.append(this.button(`确认导入所选（${this.importSelected.size}）`, 'cookie-import-confirm', () => {
        if (!this.snapshot)
          return
        const id = this.snapshot.id
        const ids = [...this.importSelected]
        const labels = new Map(preview.entries.map(entry => [entry.id, describeCookie(entry.cookie)]))
        void this.perform(async () => {
          const result = await this._options.client.import(id, preview.id, ids)
          return result.ok ? this.refreshAfter(result.value) : result
        }, ({ snapshot, results }) => {
          this.adopt(snapshot)
          this.report(results, labels)
        })
      }, !this.importSelected.size || this.importSelected.size > COOKIE_BATCH_LIMIT))
    }
    return section
  }

  private renderEditor() {
    const editor = this.editor!
    const cookie = editor.cookie
    const editing = Boolean(editor.entryId)
    const form = node('form')
    form.className = 'cookie-editor'
    form.append(node('h4', editing ? '编辑 Cookie' : '新建 Cookie'))
    const textField = (label: string, testId: string, value: string, update: (_value: string) => void, disabled = false) => {
      const wrapper = node('label', label)
      const input = node('input')
      input.value = value
      input.dataset.testid = testId
      input.disabled = this.busy || disabled
      input.addEventListener('input', () => update(input.value))
      wrapper.append(input)
      form.append(wrapper)
      return input
    }
    textField('名称', 'cookie-name', cookie.name, (value) => {
      cookie.name = value
    }, editing)
    textField('域名（ASCII）', 'cookie-domain', cookie.domain, (value) => {
      cookie.domain = value
    }, editing)
    textField('路径', 'cookie-path', cookie.path, (value) => {
      cookie.path = value
    }, editing)
    const storeLabel = node('label', 'Store')
    const store = node('select')
    store.dataset.testid = 'cookie-edit-store'
    for (const id of this.snapshot!.stores)
      store.append(new Option(id, id))
    store.value = cookie.storeId
    store.disabled = this.busy || editing
    store.addEventListener('change', () => {
      cookie.storeId = store.value
    })
    storeLabel.append(store)
    form.append(storeLabel)
    const valueLabel = node('label', '值（仅在此编辑器中显示）')
    const value = node('textarea')
    value.dataset.testid = 'cookie-value'
    value.value = cookie.value
    value.rows = 3
    value.disabled = this.busy
    value.spellcheck = false
    value.addEventListener('input', () => {
      cookie.value = value.value
    })
    valueLabel.append(value)
    form.append(valueLabel)
    const check = (label: string, key: 'session' | 'hostOnly' | 'secure' | 'httpOnly', disabled = false) => {
      const wrapper = node('label', label)
      const input = node('input')
      input.type = 'checkbox'
      input.dataset.testid = `cookie-${key}`
      input.checked = cookie[key]
      input.disabled = this.busy || disabled
      input.addEventListener('change', () => {
        cookie[key] = input.checked
        if (key === 'session') {
          if (input.checked)
            delete cookie.expirationDate
          else
            cookie.expirationDate ??= Math.floor(Date.now() / 1000) + 86_400
          this.render()
        }
      })
      wrapper.prepend(input)
      form.append(wrapper)
    }
    check('仅当前主机（Host-only）', 'hostOnly', editing)
    check('仅 HTTPS（Secure）', 'secure')
    check('禁止网页脚本读取（HttpOnly）', 'httpOnly')
    check('会话 Cookie（关闭浏览器后过期）', 'session')
    if (!cookie.session) {
      const expires = textField('过期时间（本地时间）', 'cookie-expires', cookie.expirationDate
        ? new Date(cookie.expirationDate * 1000 - new Date(cookie.expirationDate * 1000).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
        : '', (text) => {
        cookie.expirationDate = new Date(text).getTime() / 1000
      })
      expires.type = 'datetime-local'
      expires.required = true
    }
    const sameSiteLabel = node('label', 'SameSite')
    const sameSite = node('select')
    sameSite.dataset.testid = 'cookie-sameSite'
    for (const [text, key] of [['未指定', 'unspecified'], ['Lax', 'lax'], ['Strict', 'strict'], ['None（需要 Secure）', 'no_restriction']])
      sameSite.append(new Option(text, key))
    sameSite.value = cookie.sameSite
    sameSite.disabled = this.busy
    sameSite.addEventListener('change', () => {
      cookie.sameSite = sameSite.value as ManagedCookie['sameSite']
    })
    sameSiteLabel.append(sameSite)
    form.append(sameSiteLabel)
    textField('分区 Top-level site（留空为未分区）', 'cookie-partition', cookie.partitionKey?.topLevelSite || '', (text) => {
      if (text)
        cookie.partitionKey = { ...cookie.partitionKey, topLevelSite: text }
      else
        delete cookie.partitionKey
    }, editing)
    {
      const label = node('label', '分区跨站祖先')
      const ancestor = node('select')
      ancestor.append(new Option('未指定', ''), new Option('否', 'false'), new Option('是', 'true'))
      ancestor.value = cookie.partitionKey?.hasCrossSiteAncestor === undefined ? '' : String(cookie.partitionKey.hasCrossSiteAncestor)
      ancestor.disabled = this.busy || editing
      ancestor.addEventListener('change', () => {
        if (!cookie.partitionKey)
          return
        if (ancestor.value)
          cookie.partitionKey.hasCrossSiteAncestor = ancestor.value === 'true'
        else
          delete cookie.partitionKey.hasCrossSiteAncestor
      })
      label.append(ancestor)
      form.append(label)
    }
    if (this._options.firefox || cookie.firstPartyDomain !== undefined) {
      textField('First-party domain（Firefox）', 'cookie-first-party', cookie.firstPartyDomain || '', (text) => {
        cookie.firstPartyDomain = text
      }, editing)
    }
    form.append(node('p', '名称、域名、路径、Store 和分区构成身份；更换身份请新建后再删除旧项。'))
    const save = this.button('保存 Cookie', 'cookie-save', () => {
      if (!form.reportValidity() || !this.snapshot)
        return
      const snapshotId = this.snapshot.id
      void this.perform(async () => {
        const result = await this._options.client.save(snapshotId, cookie, editor.entryId)
        return result.ok ? this._options.client.refresh(snapshotId) : result
      }, (snapshot) => {
        this.adopt(snapshot)
        this.message = 'Cookie 已保存。'
      })
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      save.click()
    })
    form.append(save, this.button('关闭编辑器', 'cookie-edit-cancel', () => {
      this.editor = null
      this.render()
    }))
    return form
  }

  reset(message = '选择管理范围后，才会申请权限并读取 Cookie。') {
    this.generation++
    if (this.snapshot)
      void this._options.client.close(this.snapshot.id)
    if (this.preparation)
      void this._options.client.close(this.preparation.token)
    this.snapshot = null
    this.preparation = null
    this.selected.clear()
    this.deletion = null
    this.editor = null
    this.exportIds = null
    this.preview = null
    this.importSelected.clear()
    this.importStore = ''
    this.store = ''
    this.search = ''
    this.results = []
    for (const url of this.objectUrls)
      URL.revokeObjectURL(url)
    this.objectUrls.clear()
    this.busy = false
    this.message = message
    clearTimeout(this.timer)
    this.list.replaceChildren()
    this.render()
  }

  resetCurrentSite() {
    if (this.snapshot?.scope === 'current' || this.preparation?.scope === 'current')
      this.reset('活动站点已变化，请重新选择范围。')
  }

  private readonly visibilityChanged = () => {
    if (document.hidden)
      this.reset('已清除隐藏页面中的 Cookie 数据，请重新读取。')
  }

  destroy() {
    this.reset()
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    this.root.replaceChildren()
  }
}
