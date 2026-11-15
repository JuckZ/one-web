/* eslint no-template-curly-in-string: off -- Browser prompt templates use literal placeholders. */
import { PageToolsController } from '../page-tools'

function deferred() {
  let resolve!: () => void
  let reject!: (_error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

it('does not publish or persist a failed language through a concurrent dock save (review R1)', async () => {
  const values: Record<string, unknown> = {}
  const started = deferred()
  const firstWrite = deferred()
  let calls = 0
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => {
      if (++calls === 1) {
        started.resolve()
        await firstWrite.promise
      }
      Object.assign(values, structuredClone(entries))
    },
  }
  const tools = new PageToolsController(storage)
  const language = tools.configureToolbar({ mode: 'automatic', order: [], disabled: [], language: 'ja' }).catch(error => error.message)
  await started.promise
  const dock = tools.configureDock({ pinned: true })
  const pending = await tools.snapshot()
  firstWrite.reject(new Error('fixture failed language'))
  expect(await language).toBe('fixture failed language')
  expect(await dock).toEqual({ pinned: true })
  expect(pending.toolbar.language).toBe('zh-CN')
  expect((await tools.snapshot()).toolbar.language).toBe('zh-CN')
  const reloaded = await new PageToolsController(storage).snapshot()
  expect(reloaded.toolbar.language).toBe('zh-CN')
  expect(reloaded.dock).toEqual({ pinned: true })
})

it('returns the confirmed language while a later same-field save is pending and then fails (review R1)', async () => {
  const values: Record<string, unknown> = {}
  const firstStarted = deferred()
  const secondStarted = deferred()
  const firstWrite = deferred()
  const secondWrite = deferred()
  let calls = 0
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => {
      if (++calls === 1) {
        firstStarted.resolve()
        await firstWrite.promise
      }
      else {
        secondStarted.resolve()
        await secondWrite.promise
      }
      Object.assign(values, structuredClone(entries))
    },
  }
  const tools = new PageToolsController(storage)
  const first = tools.configureToolbar({ mode: 'automatic', order: [], disabled: [], language: 'ja' })
  await firstStarted.promise
  const second = tools.configureToolbar({ mode: 'automatic', order: [], disabled: [], language: 'en' }).catch(error => error.message)
  firstWrite.resolve()
  const confirmed = await first
  await secondStarted.promise
  const pending = await tools.snapshot()
  secondWrite.reject(new Error('fixture second write failed'))
  expect(await second).toBe('fixture second write failed')
  expect(confirmed.language).toBe('ja')
  expect(pending.toolbar.language).toBe('ja')
  expect((await tools.snapshot()).toolbar.language).toBe('ja')
  expect((await new PageToolsController(storage).snapshot()).toolbar.language).toBe('ja')
})

it('offers complete reading-selection actions with distinct grammar and question instructions (PC-01)', async () => {
  const tools = new PageToolsController({ get: async () => ({}), set: async () => {} })
  const actions = (await tools.snapshot()).actions.filter(action => action.scope === 'selection')
  expect(actions.map(action => action.id)).toEqual(expect.arrayContaining([
    'summarize',
    'translate',
    'explain',
    'grammar',
    'rewrite',
    'shorter',
    'longer',
    'formal',
    'answer',
  ]))
  expect(await tools.resolve('grammar')).toMatchObject({ scope: 'selection', template: expect.stringContaining('语法') })
  expect(await tools.resolve('answer')).toMatchObject({ scope: 'selection', template: expect.stringContaining('问题') })
})

it('persists selected toolbar pins and language without losing them when older settings are saved (PC-02, PC-03)', async () => {
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)) },
  }
  const tools = new PageToolsController(storage)
  const settings = { mode: 'automatic', order: ['grammar', 'summarize', 'translate'], disabled: [], pinned: ['grammar', 'summarize'], language: 'en' }
  await tools.configureToolbar(settings)
  const restored = new PageToolsController(storage)
  expect((await restored.snapshot()).toolbar).toMatchObject({ pinned: ['grammar', 'summarize'], language: 'en' })
  await restored.configureToolbar({ mode: 'shortcut', order: settings.order, disabled: ['formal'] })
  expect((await restored.snapshot()).toolbar).toMatchObject({ pinned: ['grammar', 'summarize'], language: 'en', mode: 'shortcut' })
  await expect(restored.configureToolbar({ ...settings, pinned: ['grammar', 'summarize', 'translate', 'rewrite', 'answer'] })).rejects.toThrow('四')
  await expect(restored.configureToolbar({ ...settings, language: '${invalid}' })).rejects.toThrow('语言')
  expect((await restored.snapshot()).toolbar).toMatchObject({ pinned: ['grammar', 'summarize'], language: 'en', mode: 'shortcut' })
})

it('restores the fixed page dock and retains the confirmed preference when a later save fails (PC-06)', async () => {
  const values: Record<string, unknown> = {}
  let fail = false
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => {
      if (fail)
        throw new Error('fixture storage failure')
      Object.assign(values, structuredClone(entries))
    },
  }
  const tools = new PageToolsController(storage)
  await tools.configureDock({ pinned: true })
  const restored = new PageToolsController(storage)
  expect((await restored.snapshot()).dock).toEqual({ pinned: true })
  await expect(restored.configureDock({ pinned: 'yes' })).rejects.toThrow('工具栏')
  fail = true
  await expect(restored.configureDock({ pinned: false })).rejects.toThrow('storage')
  expect((await restored.snapshot()).dock).toEqual({ pinned: true })
})

it('searches page tools, retains favorites and recent actions and restores a bounded text action', async () => {
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)) },
  }
  const tools = new PageToolsController(storage)
  const action = await tools.saveAction({ title: '找出论点', template: '从 ${text} 找出论点，用 ${language} 回答', scope: 'page' })
  await tools.favorite(action.id, true)
  await tools.used(action.id)
  await tools.configureToolbar({ mode: 'shortcut', order: [action.id, 'explain'], disabled: ['translate'] })
  const restored = new PageToolsController(storage)
  const snapshot = await restored.snapshot('论点')
  expect(snapshot.actions).toEqual([expect.objectContaining({ id: action.id, title: '找出论点', scope: 'page', favorite: true, recent: true })])
  expect(snapshot.toolbar).toMatchObject({ mode: 'shortcut', order: [action.id, 'explain'], disabled: ['translate'] })
  expect((await restored.resolve(action.id)).template).toBe('从 ${text} 找出论点，用 ${language} 回答')
  await expect(restored.saveAction({ title: '执行', template: '${globalThis}', scope: 'page' })).rejects.toThrow('变量')
  await restored.deleteAction(action.id)
  expect((await restored.snapshot('论点')).actions).toEqual([])
})
