import { spawnSync } from 'node:child_process'
import process from 'node:process'

// Windows' python3 can be a Store alias. Use the native command for each OS;
// PYTHON allows CI and virtual environments to select an explicit interpreter.
const command = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const result = spawnSync(command, ['-X', 'utf8', '-B', '-m', 'unittest', 'discover', '-s', 'scripts/tests', '-v'], {
  stdio: 'inherit',
})
if (result.error)
  throw result.error
process.exitCode = result.status ?? 1
