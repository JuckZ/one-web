import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { r } from './utils'

const target = process.env.EXTENSION === 'firefox' ? 'firefox' : 'chrome'
const result = spawnSync(process.execPath, [r('node_modules/wxt/bin/wxt.mjs'), 'build', '-b', target, '--mv3'], {
  cwd: r(),
  stdio: 'inherit',
  env: process.env,
})
if (result.error)
  throw result.error
process.exitCode = result.status ?? 1
