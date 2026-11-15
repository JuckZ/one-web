import { CookieManagerController } from '~/modules/builtin/cookie-manager/controller'
import { createCookieManagerSeed } from '~/modules/builtin/cookie-manager/manifest'
import { CookieManagerClient, handleCookieManagerMessage } from '~/modules/builtin/cookie-manager/protocol'
import { ModuleManagementClient } from '~/modules/management-client'
import { ModuleManager } from '~/modules/manager'
import { ModuleRegistry } from '~/modules/registry'
import { createRepoLensSeed } from '~/modules/seeds/repolens'
import markup from '~/sidebar/index.html?raw'
import { ModuleManagementView } from '~/sidebar/module-management-view'

async function toolFixture() {
  const values: Record<string, unknown> = {}
  const registry = new ModuleRegistry({
    storage: {
      get: async key => ({ [key]: structuredClone(values[key]) }),
      set: async (entries) => { Object.assign(values, structuredClone(entries)) },
    },
    seeds: [createRepoLensSeed(), { ...createCookieManagerSeed(), enabled: true }],
  })
  const manager = new ModuleManager(registry)
  const client = new ModuleManagementClient({ sendMessage: message => manager.handle(message) })
  const cookies = new CookieManagerController({
    registry,
    permissions: { contains: async () => true },
    tabs: { query: async () => [], get: async () => ({}) },
    cookies: {
      getAllCookieStores: async () => [{ id: '0' }],
      getAll: async () => [],
      get: async () => null,
      set: async () => null,
      remove: async () => null,
    },
  })
  document.body.innerHTML = markup
  const root = document.querySelector<HTMLElement>('[data-testid="module-manager"]')!
  const view = new ModuleManagementView({
    root,
    client,
    cookieManager: {
      client: new CookieManagerClient({
        sendMessage: async message => handleCookieManagerMessage(
          cookies,
          message,
          { id: 'test', url: 'chrome-extension://test/dist/sidebar/index.html' },
          'test',
          'chrome-extension://test/',
        ),
      }),
      permissions: { request: async () => true },
    },
  })
  return { root, view }
}

it('opens Cookie Manager as a standalone tool without mounting other tools or management details', async () => {
  const { root, view } = await toolFixture()
  await view.openTool('dev.oneweb.cookie-manager')
  const content = root.querySelector('[data-module-list]')!
  expect(content.querySelector('[data-testid="cookie-manager"]')).not.toBeNull()
  expect(content.textContent).not.toContain('RepoLens')
  expect(content.querySelector('[data-testid="module-details"]')).toBeNull()
  content.querySelector<HTMLButtonElement>('[data-testid="cookie-all"]')!.click()
  await vi.waitFor(() => expect(content.querySelector('[data-testid="cookie-authorize"]')).not.toBeNull())
  view.dispose()
})

it('keeps everyday tool controls out of module settings and disposes the previous tool', async () => {
  const { root, view } = await toolFixture()
  await view.openTool('dev.oneweb.cookie-manager')
  await view.openSettings()
  expect(root.querySelector('[data-testid="cookie-manager"]')).toBeNull()
  expect(root.querySelectorAll('[data-testid="module-details"]')).toHaveLength(2)
  expect(root.querySelector('[data-testid="module-manager-status"]')!.textContent).toContain('2')
  await view.openTool('missing-tool')
  expect(root.querySelector('[data-module-list]')!.textContent).toContain('工具已不存在')
  view.dispose()
})
