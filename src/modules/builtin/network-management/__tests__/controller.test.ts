import { DEFAULT_NETWORK_SETTINGS } from '../contracts'
import { NetworkManagementController } from '../controller'
import { createNetworkHarness } from './harness'

describe('network management through its trusted runtime client', () => {
  it('starts with disabled defaults and reads no privileged setting before permission', async () => {
    const { client, system } = createNetworkHarness()
    await expect(client.status()).resolves.toEqual({
      ok: true,
      value: {
        settings: { enabled: false, policy: 'disable_non_proxied_udp', blockSupport: true, blockDevices: false, blockAdditional: false },
        actualPolicy: null,
        levelOfControl: null,
        privacyPermission: false,
        hostPermission: false,
        scriptsActive: false,
        protected: false,
      },
    })
    expect(system.privacy.get).not.toHaveBeenCalled()
    expect(system.privacy.set).not.toHaveBeenCalled()
    expect(system.registrations.size).toBe(0)
  })

  it('applies an explicit native policy without requiring website access when page options are off', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true })
    const settings = { ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false, policy: 'default_public_interface_only' as const }
    await expect(client.apply(settings)).resolves.toEqual({
      ok: true,
      value: { settings, actualPolicy: 'default_public_interface_only', levelOfControl: 'controlled_by_this_extension', privacyPermission: true, hostPermission: false, scriptsActive: false, protected: true },
    })
    expect(system.privacy.set).toHaveBeenCalledWith({ value: 'default_public_interface_only', scope: 'regular_only' })
    expect(system.registrations.size).toBe(0)
    await expect(client.status()).resolves.toMatchObject({ ok: true, value: { settings, protected: true } })
  })

  it.each([
    { privacyPermission: false, moduleEnabled: true, level: 'controllable_by_this_extension', reason: 'permission-required' },
    { privacyPermission: true, moduleEnabled: false, level: 'controllable_by_this_extension', reason: 'module-disabled' },
    { privacyPermission: true, moduleEnabled: true, level: 'controlled_by_other_extensions', reason: 'control-conflict' },
    { privacyPermission: true, moduleEnabled: true, level: 'not_controllable', reason: 'control-conflict' },
  ])('rejects apply without authority: $reason / $level', async ({ privacyPermission, moduleEnabled, level, reason }) => {
    const { client, system } = createNetworkHarness({ privacyPermission, moduleEnabled })
    system.levelOfControl = level
    await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false })).resolves.toEqual({ ok: false, reason })
    expect(system.privacy.set).not.toHaveBeenCalled()
    expect(system.registrations.size).toBe(0)
  })

  it('requires full website permission before applying page options and registers only selected fixed MAIN scripts', async () => {
    const { client, controller, system } = createNetworkHarness({ privacyPermission: true })
    const settings = { ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockDevices: true, blockAdditional: true }
    await expect(client.apply(settings)).resolves.toEqual({ ok: false, reason: 'host-permission-required' })
    expect(system.privacy.set).not.toHaveBeenCalled()
    system.hostPermission = true
    await expect(client.apply(settings)).resolves.toMatchObject({ ok: true, value: { settings, scriptsActive: true, protected: true } })
    expect([...system.registrations.values()]).toEqual([
      { id: 'oneweb-network-support', js: ['dist/network/support.js'], world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true, matches: ['http://*/*', 'https://*/*'] },
      { id: 'oneweb-network-devices', js: ['dist/network/devices.js'], world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true, matches: ['http://*/*', 'https://*/*'] },
      { id: 'oneweb-network-additional', js: ['dist/network/additional.js'], world: 'MAIN', runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true, matches: ['http://*/*', 'https://*/*'] },
    ])
    expect(controller.usesOriginPattern('https://example.com/*')).toBe(true)
    expect(controller.usesOriginPattern('file:///*')).toBe(false)
    await expect(client.apply({ ...settings, blockSupport: false, blockAdditional: false })).resolves.toMatchObject({ ok: true, value: { scriptsActive: true } })
    expect([...system.registrations.keys()]).toEqual(['oneweb-network-devices'])
  })

  it.each(['disable', 'default-policy'] as const)('releases its own overrides and fixed scripts on %s without deleting shared grants', async (action) => {
    const { client, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    system.registrations.set('unrelated-module', { id: 'unrelated-module', js: ['other.js'] })
    const result = action === 'disable'
      ? await client.disable()
      : await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, policy: 'default' })
    expect(result).toMatchObject({ ok: true, value: { settings: { enabled: false, ...(action === 'default-policy' ? { policy: 'default' } : {}) }, actualPolicy: 'default', protected: false, scriptsActive: false, privacyPermission: true, hostPermission: true } })
    expect(system.privacy.clear).toHaveBeenCalledWith({ scope: 'regular_only' })
    expect([...system.registrations.keys()]).toEqual(['unrelated-module'])
    expect(system.privacy.set.mock.calls.map(([details]) => details.value)).not.toContain('default')
  })

  it('cancels a late privacy apply before it can register scripts or persist an enabled intent', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    let release!: () => void
    let entered!: () => void
    const enteredSet = new Promise<void>((resolve) => {
      entered = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const nativeSet = system.privacy.set.getMockImplementation()!
    system.privacy.set.mockImplementationOnce(async (details) => {
      entered()
      await blocked
      await nativeSet(details)
    })
    const applying = client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    await enteredSet
    const disabling = client.disable()
    release()
    await expect(applying).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    await expect(disabling).resolves.toMatchObject({ ok: true, value: { settings: { enabled: false }, actualPolicy: 'default', protected: false, scriptsActive: false } })
    expect(system.scripting.registerContentScripts).not.toHaveBeenCalled()
  })

  it('restores only a persisted, still authorized intent at worker startup and cleans it when its module is disabled', async () => {
    const { client, system, registry, controllerOptions } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    system.registrations.clear()
    system.actualPolicy = 'default'
    system.levelOfControl = 'controllable_by_this_extension'
    const restarted = new NetworkManagementController(controllerOptions)
    await expect(restarted.startup()).resolves.toMatchObject({ ok: true, value: { protected: true, scriptsActive: true } })
    const disabled = await registry.setEnabled('dev.oneweb.clash-control', false)
    if (!disabled.ok)
      throw new Error('fixture module missing')
    await restarted.handleInstalledRecordChanged(disabled.record)
    await expect(restarted.status()).resolves.toMatchObject({ ok: true, value: { settings: { enabled: false }, protected: false, scriptsActive: false } })
    expect(system.registrations.size).toBe(0)
  })

  it('checks real browser outcomes, tolerates native descriptor ordering and does not claim success after a rejected registration', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    const originalRead = system.scripting.getRegisteredContentScripts.getMockImplementation()!
    system.scripting.getRegisteredContentScripts.mockImplementation(async filter => (await originalRead(filter)).map(script => ({ js: script.js, id: script.id, matches: script.matches, runAt: script.runAt, world: script.world, allFrames: script.allFrames, persistAcrossSessions: script.persistAcrossSessions, matchOriginAsFallback: script.matchOriginAsFallback })))
    await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })).resolves.toMatchObject({ ok: true, value: { scriptsActive: true, protected: true } })
    system.scripting.registerContentScripts.mockRejectedValueOnce(new Error('native error must not reach the caller'))
    await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockDevices: true })).resolves.toEqual({ ok: false, reason: 'browser-operation-failed' })
    await expect(client.status()).resolves.toMatchObject({ ok: true, value: { settings: { enabled: false }, actualPolicy: 'default', scriptsActive: false, protected: false } })
    expect(system.registrations.size).toBe(0)
  })

  it('does not persist protection if a native setting write fails to take control', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true })
    system.privacy.set.mockImplementationOnce(async () => {})
    await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false })).resolves.toEqual({ ok: false, reason: 'control-conflict' })
    await expect(client.status()).resolves.toMatchObject({ ok: true, value: { settings: { enabled: false }, protected: false } })
  })

  it('applies and disables when the browser refuses unregistering nonexistent script IDs', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    const nativeUnregister = system.scripting.unregisterContentScripts.getMockImplementation()!
    system.scripting.unregisterContentScripts.mockImplementation(async (filter) => {
      if (filter.ids.some(id => !system.registrations.has(id)))
        throw new Error('Nonexistent script ID')
      await nativeUnregister(filter)
    })
    await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })).resolves.toMatchObject({ ok: true, value: { protected: true } })
    await expect(client.disable()).resolves.toMatchObject({ ok: true, value: { actualPolicy: 'default', scriptsActive: false } })
    await expect(client.disable()).resolves.toMatchObject({ ok: true, value: { protected: false } })
  })

  it('clears the native privacy setting even when unregistering a script fails', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    system.scripting.unregisterContentScripts.mockRejectedValueOnce(new Error('Native unregister failure'))
    await expect(client.disable()).resolves.toEqual({ ok: false, reason: 'browser-operation-failed' })
    expect(system.actualPolicy).toBe('default')
    await expect(client.status()).resolves.toMatchObject({ ok: true, value: { settings: { enabled: false }, protected: false, scriptsActive: true } })
    await expect(client.disable()).resolves.toMatchObject({ ok: true, value: { scriptsActive: false } })
  })

  it('reads persisted options on the first status call of a fresh worker', async () => {
    const { client, controllerOptions } = createNetworkHarness({ privacyPermission: true })
    await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false, policy: 'default_public_and_private_interfaces' })
    const freshWorker = new NetworkManagementController(controllerOptions)
    await expect(freshWorker.status()).resolves.toMatchObject({ ok: true, value: { settings: { enabled: true, blockSupport: false, policy: 'default_public_and_private_interfaces' } } })
  })

  it('does not return a late successful final readback after the user has disabled protection', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true })
    let release!: () => void
    let entered!: () => void
    const enteredRead = new Promise<void>((resolve) => {
      entered = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const nativeRead = system.privacy.get.getMockImplementation()!
    let reads = 0
    system.privacy.get.mockImplementation(async (details) => {
      if (++reads === 3) {
        entered()
        await blocked
      }
      return nativeRead(details)
    })
    const applying = client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false })
    await enteredRead
    const disabling = client.disable()
    release()
    await expect(applying).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    await expect(disabling).resolves.toMatchObject({ ok: true, value: { protected: false } })
  })

  it('cleans page protection on host revocation and refuses restoring an unauthorized persisted intent', async () => {
    const { client, controller, controllerOptions, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    system.hostPermission = false
    await controller.handlePermissionsRemoved({ origins: ['https://*/*'] })
    await expect(client.status()).resolves.toMatchObject({ ok: true, value: { settings: { enabled: false }, actualPolicy: 'default', scriptsActive: false, protected: false } })
    system.hostPermission = true
    await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    system.privacyPermission = false
    const restarted = new NetworkManagementController(controllerOptions)
    await expect(restarted.startup()).resolves.toEqual({ ok: false, reason: 'permission-required' })
    expect(system.registrations.size).toBe(0)
    await expect(restarted.status()).resolves.toMatchObject({ ok: true, value: { settings: { enabled: false }, actualPolicy: null, protected: false } })
  })

  it('reports residual registered scripts after incomplete host revocation and failed cleanup', async () => {
    const { client, controller, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    await client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    system.hostPermission = false
    system.scripting.unregisterContentScripts.mockRejectedValueOnce(new Error('Native unregister failure'))
    await controller.handlePermissionsRemoved({ origins: ['https://*/*'] })
    await expect(client.status()).resolves.toMatchObject({ ok: true, value: { hostPermission: false, scriptsActive: true, protected: false } })
    expect(controller.usesOriginPattern('http://example.com/*')).toBe(true)
  })

  it('holds shared host grants throughout registration and its pending readback', async () => {
    const { client, controller, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    let release!: () => void
    let entered!: () => void
    const enteredRead = new Promise<void>((resolve) => {
      entered = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const nativeRead = system.privacy.get.getMockImplementation()!
    let reads = 0
    system.privacy.get.mockImplementation(async (details) => {
      if (++reads === 2) {
        entered()
        await blocked
      }
      return nativeRead(details)
    })
    const applying = client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })
    await enteredRead
    const heldDuringReadback = controller.usesOriginPattern('https://example.com/*')
    release()
    expect(heldDuringReadback).toBe(true)
    await expect(applying).resolves.toMatchObject({ ok: true, value: { protected: true } })
  })
})
