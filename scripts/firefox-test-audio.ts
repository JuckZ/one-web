import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import fs from 'fs-extra'

const execute = promisify(execFile)

/** Route the disposable Firefox profile to its own sink; preserve caller-selected audio. */
export async function prepareFirefoxTestAudio() {
  const env = { ...process.env }
  let cleanup = async () => {}
  if (process.platform !== 'linux')
    return { env, cleanup }
  if (!env.PULSE_SERVER && !env.XDG_RUNTIME_DIR && process.getuid) {
    const socket = `/run/user/${process.getuid()}/pulse/native`
    if (await fs.pathExists(socket))
      env.PULSE_SERVER = `unix:${socket}`
  }
  if (!env.PULSE_SINK) {
    const sink = `oneweb_firefox_test_${process.pid}`
    try {
      const { stdout } = await execute('pactl', ['load-module', 'module-null-sink', `sink_name=${sink}`], { env })
      const moduleId = stdout.trim()
      if (!/^\d+$/.test(moduleId))
        throw new Error('Audio server returned an invalid module identity')
      env.PULSE_SINK = sink
      cleanup = async () => {
        await execute('pactl', ['unload-module', moduleId], { env })
      }
      process.stdout.write('Firefox media gate: using a test-owned virtual audio output\n')
    }
    catch (error) {
      throw new Error(`Firefox media tests need an audio output; set PULSE_SERVER/PULSE_SINK or provide pactl: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { env, cleanup }
}
