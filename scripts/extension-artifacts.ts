import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import fs from 'fs-extra'
import { checkFirefoxLintReport } from './firefox-vendor-policy'
import { extensionRoot, r } from './utils'

async function main() {
  const command = process.argv[2]
  if (command === 'clean') {
    const relative = path.relative(r(), extensionRoot)
    if (!/^artifacts[/\\](?:dev|build|test)[/\\](?:chromium|firefox)$/.test(relative.replaceAll('\\', '/')))
      throw new Error('Extension cleanup requires an artifacts/{dev,build,test}/{chromium,firefox} output directory')
    await fs.remove(extensionRoot)
    return
  }
  const root = ['pack-xpi', 'run-firefox', 'lint'].includes(command) && !process.env.ONEWEB_EXTENSION_DIR
    ? r('artifacts/build/firefox')
    : extensionRoot
  const manifest = await fs.readJson(path.join(root, 'manifest.json'))
  let entry = r('node_modules/web-ext/bin/web-ext.js')
  let args: string[]
  if (command === 'lint') {
    // Scan every file and rule; do not inherit user config or ignore patterns.
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (key.startsWith('WEB_EXT_'))
        delete env[key]
    }
    const result = spawnSync(process.execPath, [entry, 'lint', '--source-dir', root, '--warnings-as-errors', '--output=json', '--no-config-discovery'], {
      cwd: r(),
      encoding: 'utf8',
      env,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (result.stdout)
      process.stdout.write(result.stdout)
    if (result.stderr)
      process.stderr.write(result.stderr)
    if (result.error)
      throw result.error
    if (result.signal || (result.status !== 0 && result.status !== 1))
      throw new Error(`Firefox linter did not finish normally: ${result.signal || result.status}`)
    const accepted = checkFirefoxLintReport(root, JSON.parse(result.stdout))
    if (result.status !== (accepted ? 1 : 0))
      throw new Error('Firefox linter status disagrees with its complete diagnostic report')
    process.stdout.write(`Firefox project vendor policy: ${accepted} pinned React DOM warnings accepted; all other diagnostics remain fatal. This is a project policy, not Mozilla approval.\n`)
    return
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
