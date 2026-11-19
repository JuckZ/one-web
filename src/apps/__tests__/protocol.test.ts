import { describe, expect, it } from 'vitest'
import { SmartAppsController } from '../controller'
import { SMART_APPS_CHANNEL } from '../model'
import { handleSmartAppsMessage, SmartAppsClient } from '../protocol'

function setup() {
  const data: Record<string, unknown> = {}
  const controller = new SmartAppsController({ storage: {
    async get(key) { return structuredClone({ [key]: data[key] }) },
    async set(items) { Object.assign(data, structuredClone(items)) },
  } })
  const sender = { id: 'oneweb', url: 'chrome-extension://oneweb/sidebar.html' }
  const client = new SmartAppsClient({ async sendMessage(message) {
    return handleSmartAppsMessage(controller, message, sender, 'oneweb', 'chrome-extension://oneweb/')
  } })
  return { client, controller, sender }
}

describe('trusted smart apps transport', () => {
  it('runs persisted create/edit/toggle/export/import/delete through the real client and handler', async () => {
    const { client } = setup()
    const app = await client.create({ kind: 'mini-app', name: '阅读计数', html: '<button>计数</button>' })
    await client.update(app.id, { kind: 'mini-app', name: '更新名称', html: '<button>更新</button>' })
    await client.setEnabled(app.id, false)
    expect(await client.list()).toMatchObject([{ name: '更新名称', enabled: false }])
    const imported = await client.importApps(await client.exportApps())
    expect(imported[0]).toMatchObject({ name: '更新名称', enabled: false })
    await client.remove(app.id)
    expect(await client.list()).toHaveLength(1)
    await expect(client.update(app.id, { kind: 'mini-app', name: '旧', html: 'x' })).rejects.toThrow('不存在')
  })

  it('rejects webpage, different extension, opaque and malformed messages without mutation', async () => {
    const { controller, sender } = setup()
    const message = { channel: SMART_APPS_CHANNEL, command: 'create', data: { input: { kind: 'mini-app', name: 'x', html: 'x' } } }
    for (const untrusted of [
      { id: 'oneweb', url: 'https://github.com/vuejs/core' },
      { id: 'another', url: sender.url },
      { id: 'oneweb', url: 'chrome-extension://oneweb.evil.test/sidebar.html' },
      { id: 'oneweb', url: 'null' },
    ]) {
      expect(handleSmartAppsMessage(controller, message, untrusted, 'oneweb', 'chrome-extension://oneweb/')).toBeUndefined()
    }
    expect(handleSmartAppsMessage(controller, { ...message, command: 'fetch' }, sender, 'oneweb', 'chrome-extension://oneweb/')).toBeUndefined()
    const denied = await handleSmartAppsMessage(controller, { ...message, data: { ...message.data, storageKey: 'secrets' } }, sender, 'oneweb', 'chrome-extension://oneweb/')
    expect(denied).toMatchObject({ ok: false })
    expect(await controller.list()).toEqual([])
  })
})
