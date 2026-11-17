/* eslint no-template-curly-in-string: off -- Fixture prompt placeholders must stay literal. */
import { describe, expect, it } from 'vitest'
import { SmartAppsController } from '../controller'
import { matchesApp, renderWebToolPrompt } from '../model'

function storage() {
  const values: Record<string, unknown> = {}
  return {
    values,
    async get(key: string) { return structuredClone({ [key]: values[key] }) },
    async set(items: Record<string, unknown>) { Object.assign(values, structuredClone(items)) },
  }
}

describe('smart application library', () => {
  it('persists both forms and serializes simultaneous writes across public operations', async () => {
    const data = storage()
    let id = 0
    const apps = new SmartAppsController({ storage: data, createId: () => `app-${++id}`, now: () => 123 })
    const [tool, mini] = await Promise.all([
      apps.create({ kind: 'web-tool', name: '总结', description: '当前网页', prompt: '总结 ${text}' }),
      apps.create({ kind: 'mini-app', name: '计数器', description: '', html: '<button>+1</button>' }),
    ])
    expect(tool.kind).toBe('web-tool')
    expect(mini.kind).toBe('mini-app')
    await apps.setEnabled(tool.id, false)
    const restored = new SmartAppsController({ storage: data })
    expect((await restored.list()).map(item => [item.name, item.enabled])).toEqual([['总结', false], ['计数器', true]])
    await restored.update(mini.id, { kind: 'mini-app', name: '新计数器', description: '', html: '<button>+2</button>' })
    await restored.remove(tool.id)
    expect((await restored.list()).map(item => item.name)).toEqual(['新计数器'])
  })

  it('substitutes declared variables as data, limits matches, and strips private URL components', async () => {
    const apps = new SmartAppsController({ storage: storage() })
    const app = await apps.create({ kind: 'web-tool', name: '页面', description: '', matches: ['https://github.com/*'], prompt: '${title}\n${url}\n${text}' })
    expect(matchesApp(app, 'https://github.com/vuejs/core')).toBe(true)
    expect(matchesApp(app, 'https://github.com.evil.test/vuejs/core')).toBe(false)
    expect(matchesApp(app, 'chrome://extensions/')).toBe(false)
    if (app.kind !== 'web-tool')
      throw new Error('wrong kind')
    expect(renderWebToolPrompt(app, { title: '标题', url: 'https://github.com/vuejs/core?token=secret#private', text: '${url}<script>data</script>' })).toBe('标题\nhttps://github.com/vuejs/core\n${url}<script>data</script>')
  })

  it('rejects unknown authority fields and template expressions without changing saved apps', async () => {
    const apps = new SmartAppsController({ storage: storage() })
    await expect(apps.create({ kind: 'web-tool', name: '坏模板', description: '', prompt: '${globalThis.secret}' })).rejects.toThrow('变量')
    await expect(apps.create({ kind: 'mini-app', name: '越权', description: '', html: '<p>test</p>', capabilities: ['tabs'] } as never)).rejects.toThrow('字段')
    await expect(apps.create({ kind: 'web-tool', name: 'URL', description: '', prompt: 'x', matches: ['file:///*'] })).rejects.toThrow('网址')
    await expect(apps.create({ kind: 'mini-app', name: '太大', description: '', html: 'x'.repeat(262145) })).rejects.toThrow('大小')
    expect(await apps.list()).toEqual([])
  })

  it('bounds expansion before allocating repeated page content and preserves unrelated module storage', async () => {
    const data = storage()
    data.values['another.module'] = { secret: 'unrelated' }
    const apps = new SmartAppsController({ storage: data })
    const app = await apps.create({ kind: 'web-tool', name: '重复模板', prompt: '${text}'.repeat(2000) })
    if (app.kind !== 'web-tool')
      throw new Error('wrong kind')
    expect(() => renderWebToolPrompt(app, { text: 'x'.repeat(65536), title: '', url: 'https://example.test/' })).toThrow('大小')
    await apps.remove(app.id)
    expect(data.values['another.module']).toEqual({ secret: 'unrelated' })
  })

  it('imports atomically with fresh IDs and disabled state; malformed imports preserve existing data', async () => {
    let id = 0
    const apps = new SmartAppsController({ storage: storage(), createId: () => `app-${++id}` })
    const original = await apps.create({ kind: 'web-tool', name: '原始', description: '', prompt: 'read ${text}' })
    const exported = await apps.exportApps([original.id])
    const imported = await apps.importApps(exported)
    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({ name: '原始', enabled: false })
    expect(imported[0].id).not.toBe(original.id)
    await expect(apps.importApps('{"version":1,"apps":[{"kind":"remote-code"}]}')).rejects.toThrow()
    expect(await apps.list()).toHaveLength(2)
  })
})
