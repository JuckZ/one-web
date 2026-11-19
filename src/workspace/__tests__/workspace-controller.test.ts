import { createCookieManagerSeed } from '~/modules/builtin/cookie-manager/manifest'
import { ModuleRegistry } from '~/modules/registry'
import { WorkspaceController } from '../workspace'

function storage() {
  const values: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)) },
  }
}

it('refreshes a registry change arriving during an earlier module read', async () => {
  const store = storage()
  const records = await new ModuleRegistry({ storage: store, seeds: [createCookieManagerSeed()] }).list()
  let finishFirst!: (_records: typeof records) => void
  const firstRead = new Promise<typeof records>((resolve) => {
    finishFirst = resolve
  })
  const listModules = vi.fn().mockImplementationOnce(() => firstRead).mockResolvedValue([])
  const controller = new WorkspaceController({ storage: store, listModules })
  const first = controller.initialize()
  await vi.waitFor(() => expect(listModules).toHaveBeenCalledTimes(1))
  const changed = controller.initialize()
  finishFirst(records)
  await Promise.all([first, changed])
  expect(listModules).toHaveBeenCalledTimes(2)
  expect(controller.snapshot().modules).toEqual([])
  controller.dispose()
})

it('reports a failed read and allows a later explicit refresh', async () => {
  const listModules = vi.fn().mockRejectedValueOnce(new Error('registry unavailable')).mockResolvedValue([])
  const controller = new WorkspaceController({ storage: storage(), listModules })
  await expect(controller.initialize()).rejects.toThrow('registry unavailable')
  expect(listModules).toHaveBeenCalledTimes(1)
  await expect(controller.initialize()).resolves.toBeUndefined()
  expect(listModules).toHaveBeenCalledTimes(2)
  controller.dispose()
})

it('does not publish a module read after its workspace has been disposed', async () => {
  const store = storage()
  let finish!: (_records: []) => void
  const pending = new Promise<[]>((resolve) => {
    finish = resolve
  })
  const listModules = vi.fn(() => pending)
  const controller = new WorkspaceController({ storage: store, listModules })
  const listener = vi.fn()
  controller.subscribe(listener)
  const initialization = controller.initialize()
  await vi.waitFor(() => expect(listModules).toHaveBeenCalledTimes(1))
  controller.dispose()
  finish([])
  await expect(initialization).resolves.toBeUndefined()
  expect(listener).not.toHaveBeenCalled()
})
