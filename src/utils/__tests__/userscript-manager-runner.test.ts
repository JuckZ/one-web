// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { userscriptMetadata } from '../../../scripts/userscript-metadata'

it('exits, removes its profile and writes a failed report when browser setup and close both fail', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oneweb-manager-failure-'))
  try {
    const metadata = userscriptMetadata('0.1.0')
    await writeFile(path.join(directory, 'fixture.user.js'), `${metadata}(function() {})();`)
    await writeFile(path.join(directory, 'fixture.meta.js'), metadata)
    await mkdir(path.join(directory, 'manager'))
    await writeFile(path.join(directory, 'manager/manifest.json'), JSON.stringify({ version: 'test-system-boundary' }))
    // This replaces only the browser system boundary for failure cleanup; it is not GM/UI acceptance.
    const preload = path.join(directory, 'preload.cjs')
    await writeFile(preload, `const Module = require('node:module');
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === '@playwright/test') return { chromium: { launchPersistentContext: async () => ({
    browser() { throw new Error('Synthetic browser setup failure'); },
    async close() { throw new Error('Synthetic browser close failure'); }
  }) }, expect: {} };
  return load.call(this, name, ...args);
};`)
    const output = path.join(directory, 'output')
    const script = fileURLToPath(new URL('../../../scripts/test-userscript-manager.cjs', import.meta.url))
    const result = spawnSync(process.execPath, ['--require', preload, script, path.join(directory, 'fixture.user.js'), path.join(directory, 'fixture.meta.js')], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, ONEWEB_TAMPERMONKEY_PATH: path.join(directory, 'manager'), ONEWEB_MANAGER_OUTPUT_DIR: output },
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Manager QA cleanup failed')
    const report = JSON.parse(await readFile(path.join(output, 'manager-report.json'), 'utf8'))
    expect(report.result).toBe('failed')
    expect(report.failure).toContain('Synthetic browser setup failure')
    expect(report.cleanupErrors).toEqual(['browser close: Synthetic browser close failure'])
    expect(report.profileRemoved).toBe(true)
    expect((await readdir(output)).filter(name => name.startsWith('profile-'))).toEqual([])
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
