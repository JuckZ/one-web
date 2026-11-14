import { DEFAULT_NETWORK_SETTINGS } from '../contracts'
import { handleNetworkManagementMessage, NetworkManagementClient } from '../protocol'
import { createNetworkHarness } from './harness'

describe('network management runtime boundary', () => {
  it('rejects remote, content and malformed messages without browser mutations', async () => {
    const { controller, system, sender } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    const request = { channel: 'oneweb.network-management', version: 1, type: 'apply', settings: { ...DEFAULT_NETWORK_SETTINGS, enabled: true } }
    const rejected = [
      { message: request, sender: { id: 'network-test', url: 'https://remote.example/module' } },
      { message: request, sender: { id: 'other-extension', url: sender.url } },
      { message: { ...request, version: 2 }, sender },
      { message: { ...request, method: 'executeScript', files: ['other.js'] }, sender },
      { message: { ...request, settings: { ...request.settings, policy: 'arbitrary-policy' } }, sender },
      { message: { ...request, settings: { ...request.settings, secret: 'fixture' } }, sender },
      { message: { ...request, type: 'fetch', url: 'http://localhost:9090' }, sender },
      { message: { ...request, type: { toString: 'invalid' } }, sender },
    ]
    for (const input of rejected)
      expect(handleNetworkManagementMessage(controller, input.message, input.sender, 'network-test', 'chrome-extension://network-test/')).toBeUndefined()
    expect(system.privacy.get).not.toHaveBeenCalled()
    expect(system.privacy.set).not.toHaveBeenCalled()
    expect(system.registrations.size).toBe(0)
  })

  it('accepts each supported non-default native policy through the real trusted client', async () => {
    const { client } = createNetworkHarness({ privacyPermission: true })
    for (const policy of ['default_public_and_private_interfaces', 'default_public_interface_only', 'disable_non_proxied_udp'] as const) {
      await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true, blockSupport: false, policy })).resolves.toMatchObject({ ok: true, value: { actualPolicy: policy, protected: true } })
    }
  })

  it('reports messaging failures and rejects malformed browser-state responses', async () => {
    const unavailable = new NetworkManagementClient({ sendMessage: async () => {
      throw new Error('private browser details')
    } })
    await expect(unavailable.status()).resolves.toEqual({ ok: false, reason: 'transport-error' })
    const { client, transport } = createNetworkHarness()
    transport.sendMessage.mockResolvedValueOnce({ channel: 'oneweb.network-management', version: 1, type: 'status', result: { ok: true, value: { settings: DEFAULT_NETWORK_SETTINGS, actualPolicy: 'invalid', levelOfControl: null, privacyPermission: false, hostPermission: false, scriptsActive: false, protected: false } } })
    await expect(client.status()).resolves.toEqual({ ok: false, reason: 'invalid-response' })
  })

  it('refuses a browser that ignores MAIN world registration instead of claiming isolated-world protection', async () => {
    const { client, system } = createNetworkHarness({ privacyPermission: true, hostPermission: true })
    const nativeRegister = system.scripting.registerContentScripts.getMockImplementation()!
    system.scripting.registerContentScripts.mockImplementation(async scripts => nativeRegister(scripts.map(script => ({ ...script, world: 'ISOLATED' }))))
    await expect(client.apply({ ...DEFAULT_NETWORK_SETTINGS, enabled: true })).resolves.toEqual({ ok: false, reason: 'unsupported' })
    await expect(client.status()).resolves.toMatchObject({ ok: true, value: { actualPolicy: 'default', scriptsActive: false, protected: false, settings: { enabled: false } } })
  })
})
