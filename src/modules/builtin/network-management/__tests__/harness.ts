import type { NetworkControllerOptions, NetworkRegisteredScript } from '../controller'
import { ModuleRegistry } from '../../../registry'
import { createClashControlSeed } from '../../clash-control/manifest'
import { NetworkManagementController } from '../controller'
import { handleNetworkManagementMessage, NetworkManagementClient } from '../protocol'

export function createNetworkHarness(options: { privacyPermission?: boolean, hostPermission?: boolean, moduleEnabled?: boolean } = {}) {
  const data: Record<string, unknown> = {}
  const storage = {
    get: vi.fn(async (_key: string) => structuredClone(data)),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)) }),
  }
  const seed = createClashControlSeed()
  seed.enabled = options.moduleEnabled ?? true
  const registry = new ModuleRegistry({ storage, seeds: [seed] })
  const registrations = new Map<string, NetworkRegisteredScript>()
  const system = {
    privacyPermission: options.privacyPermission ?? false,
    hostPermission: options.hostPermission ?? false,
    allowPermission: true,
    actualPolicy: 'default',
    levelOfControl: 'controllable_by_this_extension',
    registrations,
    permissions: {
      contains: vi.fn(async (details: { permissions?: string[], origins?: string[] }) => (
        (!details.permissions?.includes('privacy') || system.privacyPermission)
        && (!details.origins?.length || system.hostPermission)
      )),
      request: vi.fn(async (details: { permissions?: string[], origins?: string[] }) => {
        if (!system.allowPermission)
          return false
        if (details.permissions?.includes('privacy'))
          system.privacyPermission = true
        if (details.origins?.length)
          system.hostPermission = true
        return true
      }),
    },
    privacy: {
      get: vi.fn(async (_details: Record<string, never>) => ({ value: system.actualPolicy, levelOfControl: system.levelOfControl })),
      set: vi.fn(async (details: { value: string, scope: 'regular_only' }) => {
        system.actualPolicy = details.value
        system.levelOfControl = 'controlled_by_this_extension'
      }),
      clear: vi.fn(async (_details: { scope: 'regular_only' }) => {
        system.actualPolicy = 'default'
        system.levelOfControl = 'controllable_by_this_extension'
      }),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => [...registrations.values()].filter(script => ids.includes(script.id)).map(script => structuredClone(script))),
      registerContentScripts: vi.fn(async (scripts: NetworkRegisteredScript[]) => {
        scripts.forEach(script => registrations.set(script.id, structuredClone(script)))
      }),
      unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => { ids.forEach(id => registrations.delete(id)) }),
    },
  }
  const controllerOptions: NetworkControllerOptions = { registry, storage, permissions: system.permissions, privacy: system.privacy, scripting: system.scripting }
  const controller = new NetworkManagementController(controllerOptions)
  const sender = { id: 'network-test', url: 'chrome-extension://network-test/sidebar.html' }
  const transport = { sendMessage: vi.fn(async (message: unknown): Promise<unknown> => handleNetworkManagementMessage(controller, message, sender, 'network-test', 'chrome-extension://network-test/')) }
  const client = new NetworkManagementClient(transport)
  return { client, controller, system, registry, storage, data, transport, controllerOptions, sender }
}
