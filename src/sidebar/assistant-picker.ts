import type { AssistantPrompt } from '~/modules/builtin/assistant/contracts'
import type { TabChoice } from '~/workspace/tab-sources'

type PickerMode = 'tabs' | 'prompts'
interface PickerOptions {
  listTabs?: () => Promise<TabChoice[]>
  addTab: (_choice: TabChoice, _signal: AbortSignal) => Promise<void>
  prompts: AssistantPrompt[]
  choosePrompt: (_id: string) => void
  changeDraft: (_draft: string) => void
  report: (_text: string) => void
}

export function createAssistantPicker(input: HTMLTextAreaElement, options: PickerOptions) {
  const panel = document.createElement('section')
  panel.className = 'assistant-picker'
  panel.hidden = true
  const controls = document.createElement('div')
  controls.className = 'assistant-composer-actions'
  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'workspace-search'
  const list = document.createElement('div')
  list.className = 'assistant-picker-list'
  panel.append(search, list)
  const buttons = new Map<PickerMode, HTMLButtonElement>()
  let mode: PickerMode | undefined
  let query = ''
  let choices: TabChoice[] | undefined
  let version = 0
  let selecting = false
  let pendingTab: AbortController | undefined
  let draftVersion = 0
  let marker: { start: number, end: number, value: string } | undefined

  function close(focus = false) {
    pendingTab?.abort()
    version++
    mode = undefined
    marker = undefined
    choices = undefined
    panel.hidden = true
    list.replaceChildren()
    for (const button of buttons.values()) button.setAttribute('aria-expanded', 'false')
    if (focus)
      input.focus()
  }

  function renderList() {
    list.replaceChildren()
    const needle = query.toLocaleLowerCase().trim()
    const items = (mode === 'tabs' ? choices ?? [] : options.prompts)
      .filter(item => `${item.title}${'url' in item ? ` ${item.url}` : ''}`.toLocaleLowerCase().includes(needle))
    for (const item of items) {
      const button = document.createElement('button')
      button.className = 'assistant-picker-option'
      button.type = 'button'
      button.textContent = item.title
      if ('url' in item) {
        const label = document.createElement('small')
        label.textContent = item.url
        button.append(label)
      }
      button.addEventListener('click', () => {
        if (selecting)
          return
        const selectedAt = version
        const selectedMarker = marker
        const selectedDraft = draftVersion
        selecting = true
        button.disabled = true
        void (async () => {
          if ('url' in item) {
            pendingTab = new AbortController()
            await options.addTab(item, pendingTab.signal)
            if (pendingTab.signal.aborted)
              return
            pendingTab = undefined
          }
          else {
            options.choosePrompt(item.id)
          }
          if (!panel.isConnected || selectedAt !== version)
            return
          if (selectedMarker && selectedDraft === draftVersion && input.value.slice(selectedMarker.start, selectedMarker.end) === selectedMarker.value) {
            input.setRangeText('', selectedMarker.start, selectedMarker.end, 'end')
            options.changeDraft(input.value)
          }
          close(true)
        })().catch((error) => {
          if (panel.isConnected && selectedAt === version && !pendingTab?.signal.aborted)
            options.report(error instanceof Error ? error.message : '无法选择此项')
        }).finally(() => {
          pendingTab = undefined
          selecting = false
          button.disabled = false
        })
      })
      list.append(button)
    }
    if (!items.length) {
      const status = document.createElement('p')
      status.setAttribute('role', 'status')
      status.textContent = mode === 'tabs' && choices === undefined ? '正在读取标签页列表…' : '没有匹配项'
      list.append(status)
    }
  }

  function open(next: PickerMode, typed: typeof marker, value = '') {
    if (next === 'tabs' && !options.listTabs)
      return
    const changed = next !== mode
    mode = next
    marker = typed
    query = value
    search.value = value
    search.setAttribute('aria-label', next === 'tabs' ? '搜索打开的标签页' : '搜索提示词')
    panel.setAttribute('aria-label', next === 'tabs' ? '选择标签页' : '选择提示词')
    panel.hidden = false
    for (const [name, button] of buttons) button.setAttribute('aria-expanded', String(name === mode))
    if (changed) {
      choices = undefined
      const opened = ++version
      if (next === 'tabs') {
        void options.listTabs!().then((items) => {
          if (version === opened && panel.isConnected) {
            choices = items
            renderList()
          }
        }).catch((error) => {
          if (version === opened && panel.isConnected) {
            choices = []
            renderList()
            options.report(error instanceof Error ? error.message : '无法读取标签页列表')
          }
        })
      }
    }
    renderList()
  }

  const definitions: Array<[PickerMode, string]> = [['prompts', '/ 提示词']]
  if (options.listTabs)
    definitions.unshift(['tabs', '＋ 添加标签页'])
  for (const [name, label] of definitions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button'
    button.textContent = label
    button.setAttribute('aria-expanded', 'false')
    button.addEventListener('click', () => {
      if (name === mode) {
        close(true)
      }
      else {
        open(name, undefined)
        search.focus()
      }
    })
    buttons.set(name, button)
    controls.append(button)
  }
  search.addEventListener('input', () => {
    query = search.value
    renderList()
  })
  function key(event: KeyboardEvent) {
    if (panel.hidden || event.isComposing || event.keyCode === 229)
      return false
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return true
    }
    const rows = [...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (event.key === 'ArrowDown' || (event.key === 'ArrowUp' && (event.target === search || list.contains(event.target as Node)))) {
      event.preventDefault()
      const index = rows.indexOf(document.activeElement as HTMLButtonElement)
      const target = event.key === 'ArrowDown' ? rows[index + 1] ?? rows[0] : rows[index - 1] ?? rows.at(-1)
      target?.focus()
      return true
    }
    if (event.key === 'Enter' && !event.shiftKey && (event.target === input || event.target === search)) {
      if (event.target === input && !rows.length && !selecting && (mode !== 'tabs' || choices !== undefined))
        return false
      event.preventDefault()
      rows[0]?.click()
      return true
    }
    return false
  }
  panel.addEventListener('keydown', key)
  input.addEventListener('input', (event) => {
    if ((event as InputEvent).isComposing)
      return
    draftVersion++
    const end = input.selectionEnd
    const match = /(?:^|\s)([@/][^\s@/]{0,80})$/u.exec(input.value.slice(0, end))
    const value = match?.[1]
    if (value && end === input.selectionStart) {
      open(value[0] === '@' ? 'tabs' : 'prompts', { start: end - value.length, end, value }, value.slice(1))
    }
    else if (marker) {
      close()
    }
  })
  return { panel, controls, key }
}
