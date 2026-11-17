import { ModuleRegistry } from '../../../registry'
import { createRepoLensSeed } from '../../../seeds/repolens'
import { createRepoLensBuiltinSeed } from '../manifest'

it('reconciles the existing remote seeded record into a builtin while preserving disabled state and narrowed grants', async () => {
  const values: Record<string, unknown> = {}
  const storage = {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)) },
  }
  const oldRegistry = new ModuleRegistry({ storage, seeds: [createRepoLensSeed('http://127.0.0.1:4747')] })
  const [old] = await oldRegistry.list()
  expect(old.manifest.runtime).toBe('remote-frame')
  await oldRegistry.setEnabled('dev.juck.repolens', false)
  const nativeRegistry = new ModuleRegistry({ storage, seeds: [createRepoLensBuiltinSeed()] })
  const [record] = await nativeRegistry.list()
  expect(record).toMatchObject({
    enabled: false,
    source: 'seeded',
    manifest: { id: 'dev.juck.repolens', runtime: 'builtin', entry_id: 'repolens', capabilities: [] },
    grantedCapabilities: [],
    grantedContexts: ['github.repository'],
    grantedContextFields: { 'github.repository': ['repo', 'url', 'pageType'] },
  })
  expect(record.manifest).not.toHaveProperty('entry_url')
  expect(record.manifest).not.toHaveProperty('icon_url')
  expect(record).not.toHaveProperty('sourceUrl')
  expect(record.installedAt).toBe(old.installedAt)
  expect((await nativeRegistry.list())[0]).toEqual(record)
})
