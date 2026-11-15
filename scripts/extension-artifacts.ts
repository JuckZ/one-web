import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import fs from 'fs-extra'
import { e, extensionRoot, r } from './utils'

async function main() {
  const command = process.argv[2]
  if (command === 'clean') {
    const relative = path.relative(r(), extensionRoot)
    if (relative !== 'extension' && !relative.startsWith(`artifacts${path.sep}`))
      throw new Error('Extension cleanup requires extension/ or an artifacts/ output directory')
    await fs.remove(e('dist'))
    await fs.remove(e('manifest.json'))
    return
  }
  const root = ['pack-xpi', 'run-firefox', 'lint'].includes(command) && !process.env.ONEWEB_EXTENSION_DIR
    ? r('artifacts/build/firefox')
    : extensionRoot
  const manifest = await fs.readJson(path.join(root, 'manifest.json'))
  let entry = r('node_modules/web-ext/bin/web-ext.js')
  let args: string[]
  if (command === 'lint') {
    args = ['lint', '--source-dir', root, '--warnings-as-errors']
  }
  else if (command === 'run-firefox' || command === 'run-chromium') {
    args = ['run', '--source-dir', root, '--target', command === 'run-firefox' ? 'firefox-desktop' : 'chromium']
  }
  else if (command === 'pack-zip' || command === 'pack-xpi') {
    if (command === 'pack-xpi' && (!Array.isArray(manifest.background?.scripts) || manifest.side_panel))
      throw new Error('XPI packaging requires a Firefox build; run pnpm build:firefox first')
    args = ['build', '--source-dir', root, '--artifacts-dir', r(), '--filename', command === 'pack-xpi' ? 'extension.xpi' : 'extension.zip', '--overwrite-dest']
  }
  else if (command === 'pack-crx') {
    const pkg = await fs.readJson(r('node_modules/crx/package.json'))
    entry = r('node_modules/crx', typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.crx)
    args = ['pack', root, '-o', r('extension.crx')]
  }
  else {
    throw new Error('Expected clean, lint, run-firefox, run-chromium, pack-zip, pack-xpi or pack-crx')
  }
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: r(), stdio: 'inherit', env: process.env })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    process.exitCode = result.status ?? 1
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
