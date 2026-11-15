import { createCookieManagerSeed } from '~/modules/builtin/cookie-manager/manifest'
import { ModuleRegistry } from '~/modules/registry'
import { WorkspaceController, WorkspaceView } from '../workspace'

it('navigates to a builtin from searchable tools, preserves favorites and falls back when that module disappears', async () => {
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)) },
  }
  const registry = new ModuleRegistry({ storage, seeds: [createCookieManagerSeed()] })
  let records = await registry.list()
  const controller = new WorkspaceController({ storage, listModules: async () => records })
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  const view = new WorkspaceView(root, controller)
  await view.initialize()
  root.querySelector<HTMLButtonElement>('[data-destination="tools"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[aria-label="搜索工具"]')).not.toBeNull())
  root.querySelector<HTMLButtonElement>('[aria-label="收藏 Cookie Manager"]')!.click()
  await vi.waitFor(() => expect(root.querySelector('[aria-label="取消收藏 Cookie Manager"]')).not.toBeNull())
  root.querySelector<HTMLButtonElement>('[data-open-module="dev.oneweb.cookie-manager"]')!.click()
  await vi.waitFor(() => expect(controller.snapshot().destination).toBe('module:dev.oneweb.cookie-manager'))
  const restored = new WorkspaceController({ storage, listModules: async () => records })
  await restored.initialize()
  expect(restored.snapshot()).toMatchObject({ destination: 'module:dev.oneweb.cookie-manager', favorites: ['dev.oneweb.cookie-manager'] })
  records = []
  await restored.initialize()
  expect(restored.snapshot()).toMatchObject({ destination: 'assistant', note: expect.stringContaining('已不存在') })
  view.dispose()
})
