// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

it('fails the live command when the browser test process is terminated by a signal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oneweb-live-runner-'))
  try {
    const bin = path.join(directory, 'bin')
    await mkdir(bin)
    const executable = path.join(bin, 'pnpm')
    await writeFile(executable, '#!/usr/bin/env node\nprocess.kill(process.pid, "SIGTERM")\n')
    await chmod(executable, 0o700)
    const artifact = path.join(directory, 'artifacts/test/live-chromium')
    await mkdir(artifact, { recursive: true })
    await writeFile(path.join(artifact, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      background: { service_worker: 'worker.js' },
      sandbox: { pages: ['dist/apps/sandbox.html'] },
    }))
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/esno/esno.js'), path.join(root, 'scripts/test-live-llm.ts'), '--no-build'], {
      cwd: directory,
      env: { ...process.env, ONEWEB_LIVE_LLM: '1', ONEWEB_LIVE_CODEX_CONFIG: '/nonexistent/not-read.toml', PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 10000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})
