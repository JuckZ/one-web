import { createNetworkHarness } from '~/modules/builtin/network-management/__tests__/harness'
import { DEFAULT_NETWORK_SETTINGS } from '~/modules/builtin/network-management/contracts'
import { NetworkManagementController } from '~/modules/builtin/network-management/controller'
import { handleNetworkManagementMessage, NetworkManagementClient } from '~/modules/builtin/network-management/protocol'
import { createFirefoxNetworkPrivacy } from '../network-privacy-adapter'

function firefoxHarness() {
  const harness = createNetworkHarness({ privacyPermission: true, hostPermission: true })
  const native = {
    inheritedPolicy: 'default_public_interface_only',
    override: null as string | null,
    levelOfControl: null as string | null,
    failSet: false,
    async get(_details: Record<string, never>) {
      return {
        value: native.override ?? native.inheritedPolicy,
        levelOfControl: native.levelOfControl ?? (native.override === null ? 'controllable_by_this_extension' : 'controlled_by_this_extension'),
      }
    },
    async set(details: { value: string, scope: 'regular' }) {
      if (details.scope !== 'regular')
        throw new Error('Firefox does not support this scope')
      if (native.failSet)
        throw new Error('private native preference error')
      native.override = details.value
    },
    async clear(details: { scope: 'regular' }) {
      if (details.scope !== 'regular')
        throw new Error('Firefox does not support this scope')
      native.override = null
    },
  }
  const controllerOptions = { ...harness.controllerOptions, privacy: createFirefoxNetworkPrivacy(native) }
  const controller = new NetworkManagementController(controllerOptions)
  const client = new NetworkManagementClient({ sendMessage: async message => handleNetworkManagementMessage(controller, message, harness.sender, 'network-test', 'chrome-extension://network-test/') })
  return { ...harness, native, controller, controllerOptions, client }
}

it('applies Firefox WebRTC protection through the trusted client using its supported native setting scope', async () => {
  const { client } = firefoxHarness()
  await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false })).resolves.toMatchObject({
    ok: true,
    value: { actualPolicy: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_this_extension', protected: true },
  })
})

it('selecting the default policy releases Firefox ownership and restores the inherited preference', async () => {
  const { client } = firefoxHarness()
  await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
  await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, policy: 'default' })).resolves.toMatchObject({
    ok: true,
    value: {
      settings: { enabled: false, policy: 'default' },
      actualPolicy: 'default_public_interface_only',
      levelOfControl: 'controllable_by_this_extension',
      scriptsActive: false,
      protected: false,
    },
  })
})

it('disabling Firefox protection releases its native override and all selected page registrations', async () => {
  const { client } = firefoxHarness()
  await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockDevices: true, blockAdditional: true })
  await expect(client.disable()).resolves.toMatchObject({
    ok: true,
    value: {
      settings: { enabled: false },
      actualPolicy: 'default_public_interface_only',
      levelOfControl: 'controllable_by_this_extension',
      scriptsActive: false,
      protected: false,
    },
  })
})

it('restores the authorized Firefox preference after background restart without changing the public settings', async () => {
  const { client, controllerOptions, native } = firefoxHarness()
  await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, policy: 'default_public_and_private_interfaces', blockSupport: false })
  native.override = null
  const restarted = new NetworkManagementController(controllerOptions)
  await expect(restarted.startup()).resolves.toMatchObject({
    ok: true,
    value: {
      settings: { enabled: true, policy: 'default_public_and_private_interfaces' },
      actualPolicy: 'default_public_and_private_interfaces',
      levelOfControl: 'controlled_by_this_extension',
      protected: true,
    },
  })
})

it('reports a failed Firefox setting operation without exposing native errors or claiming protection', async () => {
  const { client, native } = firefoxHarness()
  native.failSet = true
  await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false })).resolves.toEqual({ ok: false, reason: 'browser-operation-failed' })
  await expect(client.status()).resolves.toMatchObject({
    ok: true,
    value: { actualPolicy: 'default_public_interface_only', levelOfControl: 'controllable_by_this_extension', protected: false },
  })
})

it('preserves a Firefox setting controlled by another extension', async () => {
  const { client, native } = firefoxHarness()
  native.levelOfControl = 'controlled_by_other_extensions'
  await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false })).resolves.toEqual({ ok: false, reason: 'control-conflict' })
  await expect(client.status()).resolves.toMatchObject({
    ok: true,
    value: { actualPolicy: 'default_public_interface_only', levelOfControl: 'controlled_by_other_extensions', protected: false },
  })
})
