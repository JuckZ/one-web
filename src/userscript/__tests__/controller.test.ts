import type { UserscriptManager } from '../gm'
import { USERSCRIPT_CONTROL_ATTRIBUTE } from '../control'
import { userscriptApprovalKey, UserscriptController, userscriptToolKey } from '../controller'

function manager() {
  const values = new Map<string, unknown>()
  const menus = new Map<number, { title: string, action: () => void }>()
  const listeners = new Map<number, { key: string, callback: (_remote: boolean) => void }>()
  let nextId = 0
  const api: UserscriptManager = {
    get: vi.fn((key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback),
    set: vi.fn((key, value) => { values.set(key, structuredClone(value)) }),
    delete: vi.fn((key) => { values.delete(key) }),
    menu: vi.fn((title, action) => {
      const id = ++nextId
      menus.set(id, { title, action })
      return id
    }),
    removeMenu: vi.fn((id) => { menus.delete(Number(id)) }),
    listen: vi.fn((key, callback) => {
      const id = ++nextId
      listeners.set(id, { key, callback })
      return id
    }),
    unlisten: vi.fn((id) => { listeners.delete(id) }),
  }
  return {
    api,
    values,
    menus,
    listeners,
    remote(key: string, value: unknown) {
      values.set(key, value)
      for (const listener of listeners.values()) {
        if (listener.key === key)
          listener.callback(true)
      }
    },
  }
}

function deferred<Value>() {
  let resolve!: (_value: Value) => void
  const promise = new Promise<Value>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const controls: UserscriptController[] = []
function setup() {
  const gm = manager()
  const controller = new UserscriptController(document, gm.api)
  controls.push(controller)
  return { gm, controller, origin: window.location.origin }
}

describe('standalone userscript manager boundary', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body><input type="password" value="private-value"></body>'
  })
  afterEach(() => {
    for (const controller of controls.splice(0)) controller.dispose()
  })

  it('keeps every site and tool off until a manager action explicitly approves it', async () => {
    const { gm, controller, origin } = setup()
    expect(await controller.start()).toBe(true)
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    expect(await controller.toggle('free-page-edit', true)).toBe(false)
    expect(gm.api.set).not.toHaveBeenCalled()
    expect([...gm.menus.values()].some(menu => menu.title.includes('启用当前站点'))).toBe(true)
    expect(await controller.approve()).toBe(true)
    expect(gm.values.get(userscriptApprovalKey(origin))).toBe(true)
    expect(document.querySelectorAll(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toHaveLength(1)
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    expect(await controller.toggle('free-page-edit', true)).toBe(true)
    expect(document.body.getAttribute('contenteditable')).toBe('true')
    expect(gm.values.get(userscriptToolKey(origin, 'free-page-edit'))).toBe(true)
    expect(JSON.stringify([...gm.values])).not.toContain('private-value')
  })

  it('restores owned password/edit mutations and removes controls immediately on disable', async () => {
    const { gm, controller, origin } = setup()
    document.body.setAttribute('contenteditable', 'false')
    await controller.start()
    await controller.approve()
    await controller.toggle('password-visibility', true)
    await controller.toggle('free-page-edit', true)
    const input = document.querySelector('input')!
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    expect(input.type).toBe('text')
    const disabled = controller.disable()
    expect(input.type).toBe('password')
    expect(document.body.getAttribute('contenteditable')).toBe('false')
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
    expect(await disabled).toBe(true)
    expect(gm.values.get(userscriptApprovalKey(origin))).toBe(false)
    expect(gm.values.get(userscriptToolKey(origin, 'free-page-edit'))).toBe(true)
    expect(await controller.approve()).toBe(true)
    expect(document.body.getAttribute('contenteditable')).toBe('true')
  })

  it('fails closed on a failed persistence write and needs a fresh explicit approval to recover', async () => {
    const { gm, controller } = setup()
    await controller.start()
    await controller.approve()
    await controller.toggle('free-page-edit', true)
    vi.mocked(gm.api.set).mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    expect(await controller.toggle('password-visibility', true)).toBe(false)
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
    await controller.refresh()
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
    expect([...gm.menus.values()].some(menu => menu.title.includes('无法保存'))).toBe(true)
    expect(await controller.approve()).toBe(true)
    expect(document.body.getAttribute('contenteditable')).toBe('true')
  })

  it('rechecks remote approval and does not let a pending read write after teardown', async () => {
    const { gm, controller } = setup()
    await controller.start()
    await controller.approve()
    const read = deferred<unknown>()
    vi.mocked(gm.api.get).mockImplementationOnce(() => read.promise)
    const writesBefore = vi.mocked(gm.api.set).mock.calls.length
    const toggling = controller.toggle('free-page-edit', true)
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
    read.resolve(true)
    expect(await toggling).toBe(false)
    expect(gm.api.set).toHaveBeenCalledTimes(writesBefore)
    expect(gm.listeners.size).toBe(0)
    expect(gm.menus.size).toBe(0)
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
  })

  it('lets explicit disable interrupt an already-dispatched write without reapplying late tools', async () => {
    const { gm, controller, origin } = setup()
    await controller.start()
    await controller.approve()
    const write = deferred<void>()
    vi.mocked(gm.api.set).mockImplementationOnce((key, value) => {
      gm.values.set(key, value)
      return write.promise
    })
    const toggling = controller.toggle('free-page-edit', true)
    await vi.waitFor(() => expect(gm.values.get(userscriptToolKey(origin, 'free-page-edit'))).toBe(true))
    const disabling = controller.disable()
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    write.resolve()
    expect(await disabling).toBe(true)
    expect(await toggling).toBe(false)
    expect(gm.values.get(userscriptApprovalKey(origin))).toBe(false)
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
  })

  it.each(['disable', 'forget'] as const)('serializes a dispatched approval before %s, so reload cannot resurrect it', async (action) => {
    const { gm, controller, origin } = setup()
    await controller.start()
    const write = deferred<void>()
    vi.mocked(gm.api.set).mockImplementationOnce(async (key, value) => {
      await write.promise
      gm.values.set(key, value)
    })
    const approving = controller.approve()
    await vi.waitFor(() => expect(gm.api.set).toHaveBeenCalledOnce())
    const revoking = controller[action]()
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
    write.resolve()
    expect(await approving).toBe(false)
    expect(await revoking).toBe(true)
    expect(gm.values.get(userscriptApprovalKey(origin))).not.toBe(true)
    controller.dispose()
    const reloaded = new UserscriptController(document, gm.api)
    controls.push(reloaded)
    expect(await reloaded.start()).toBe(true)
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
  })

  it('completes an already-dispatched tool write before forget deletes that key', async () => {
    const { gm, controller, origin } = setup()
    await controller.start()
    await controller.approve()
    const write = deferred<void>()
    vi.mocked(gm.api.set).mockImplementationOnce(async (key, value) => {
      await write.promise
      gm.values.set(key, value)
    })
    const toggling = controller.toggle('free-page-edit', true)
    await vi.waitFor(() => expect(gm.api.set).toHaveBeenCalledTimes(2))
    const forgetting = controller.forget()
    write.resolve()
    expect(await toggling).toBe(false)
    expect(await forgetting).toBe(true)
    expect(gm.values.has(userscriptToolKey(origin, 'free-page-edit'))).toBe(false)
    expect(gm.values.has(userscriptApprovalKey(origin))).toBe(false)
  })

  it.each([
    ['disable', false],
    ['forget', false],
    ['disable', true],
    ['forget', true],
  ] as const)('finishes queued %s after pagehide (persisted=%s) without restoring approval on reload', async (action, persisted) => {
    const { gm, controller, origin } = setup()
    gm.values.set(userscriptToolKey(origin, 'free-page-edit'), true)
    await controller.start()
    const write = deferred<void>()
    vi.mocked(gm.api.set).mockImplementationOnce(async (key, value) => {
      await write.promise
      gm.values.set(key, value)
    })
    const approving = controller.approve()
    await vi.waitFor(() => expect(gm.api.set).toHaveBeenCalledOnce())
    const revoking = controller[action]()
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted }))
    write.resolve()
    await Promise.all([approving, revoking])
    controller.dispose()
    const reloaded = new UserscriptController(document, gm.api)
    controls.push(reloaded)
    await reloaded.start()
    expect(gm.values.get(userscriptApprovalKey(origin))).not.toBe(true)
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    if (action === 'forget')
      expect(gm.values.has(userscriptToolKey(origin, 'free-page-edit'))).toBe(false)
  })

  it('drains on remote revocation and ignores malformed booleans rather than importing legacy defaults', async () => {
    const { gm, controller, origin } = setup()
    gm.values.set(`${window.location.host}:freeEdit`, true)
    gm.values.set(userscriptApprovalKey(origin), 'true')
    gm.values.set(userscriptToolKey(origin, 'free-page-edit'), { enabled: true })
    await controller.start()
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
    await controller.approve()
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    await controller.toggle('free-page-edit', true)
    gm.remote(userscriptApprovalKey(origin), false)
    await vi.waitFor(() => expect(document.body.hasAttribute('contenteditable')).toBe(false))
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
  })

  it('suspends BFCache resources and reloads manager state when restored', async () => {
    const { gm, controller, origin } = setup()
    await controller.start()
    await controller.approve()
    await controller.toggle('free-page-edit', true)
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    expect(gm.listeners.size).toBe(0)
    expect(gm.menus.size).toBe(0)
    gm.values.set(userscriptApprovalKey(origin), false)
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await vi.waitFor(() => expect(gm.listeners.size).toBeGreaterThan(0))
    await vi.waitFor(() => expect(gm.menus.size).toBeGreaterThan(0))
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    expect(document.querySelector(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)).toBeNull()
    await controller.approve()
    expect(document.body.getAttribute('contenteditable')).toBe('true')
  })

  it.each(['disable', 'forget'] as const)('persists %s even if manager menu registration fails', async (action) => {
    const { gm, controller, origin } = setup()
    await controller.start()
    await controller.approve()
    await controller.toggle('free-page-edit', true)
    vi.mocked(gm.api.menu).mockImplementation(() => {
      throw new Error('Menu unavailable')
    })
    await controller[action]()
    expect(gm.values.get(userscriptApprovalKey(origin))).not.toBe(true)
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    if (action === 'forget')
      expect(gm.values.has(userscriptToolKey(origin, 'free-page-edit'))).toBe(false)
  })

  it('removes handlers but preserves a control repurposed by the page', async () => {
    const { controller } = setup()
    await controller.start()
    await controller.approve()
    const host = document.querySelector<HTMLElement>(`[${USERSCRIPT_CONTROL_ATTRIBUTE}]`)!
    const pageContent = document.createElement('p')
    pageContent.textContent = 'Page-owned content'
    host.append(pageContent)
    host.setAttribute('data-page-owned', 'true')
    document.body.append(host)
    await controller.disable()
    expect(pageContent.isConnected).toBe(true)
    expect(host.parentNode).toBe(document.body)
    expect(host.getAttribute('data-page-owned')).toBe('true')
  })

  it('forgets only this origin and never overwrites page-owned values during cleanup', async () => {
    const { gm, controller, origin } = setup()
    const peerKey = userscriptApprovalKey('https://peer.example')
    gm.values.set(peerKey, true)
    await controller.start()
    await controller.approve()
    await controller.toggle('free-page-edit', true)
    document.body.setAttribute('contenteditable', 'page-owned')
    await Promise.resolve()
    expect(await controller.forget()).toBe(true)
    expect(document.body.getAttribute('contenteditable')).toBe('page-owned')
    expect(gm.values.has(userscriptApprovalKey(origin))).toBe(false)
    expect(gm.values.has(userscriptToolKey(origin, 'free-page-edit'))).toBe(false)
    expect(gm.values.get(peerKey)).toBe(true)
    expect([...gm.values]).toHaveLength(1)
  })

  it('rejects child documents even when invoked outside a manager metadata filter', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    expect(() => new UserscriptController(frame.contentDocument!, manager().api)).toThrow('top-level HTTP(S)')
  })

  it('does not allow startup after manager revocation subscriptions fail', async () => {
    const { gm, controller, origin } = setup()
    gm.values.set(userscriptApprovalKey(origin), true)
    gm.values.set(userscriptToolKey(origin, 'free-page-edit'), true)
    vi.mocked(gm.api.listen).mockImplementationOnce(() => {
      throw new Error('manager listener unavailable')
    })
    expect(await controller.start()).toBe(false)
    expect(await controller.approve()).toBe(false)
    expect(document.body.hasAttribute('contenteditable')).toBe(false)
    expect(gm.menus.size).toBe(0)
    expect(gm.listeners.size).toBe(0)
  })
})
