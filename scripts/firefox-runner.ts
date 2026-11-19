import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { firefox } from '@playwright/test'

export function resolveFirefoxBinary(
  env: { FIREFOX_BINARY?: string } = process.env,
  executablePath: () => string = () => firefox.executablePath(),
  exists: (_path: string) => boolean = existsSync,
) {
  if (env.FIREFOX_BINARY)
    return env.FIREFOX_BINARY
  const binary = executablePath()
  if (!exists(binary))
    throw new Error(`Playwright Firefox is not installed at ${binary}; run pnpm exec playwright install firefox or set FIREFOX_BINARY`)
  return binary
}

function killWindowsTree(pid: number) {
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error)
    throw result.error
  // 128 means the owned process already exited; never kill by image name.
  if (result.status !== 0 && result.status !== 128)
    throw new Error(`Unable to terminate Firefox test process tree ${pid}: ${result.stderr || result.stdout}`)
}

export async function terminateProcessGroup(
  pid: number | undefined,
  kill: (_pid: number, _signal: NodeJS.Signals) => void = process.kill,
  wait: (_milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  platform: NodeJS.Platform = process.platform,
  killTree: (_pid: number) => void = killWindowsTree,
): Promise<Array<NodeJS.Signals | 'taskkill'>> {
  if (!Number.isSafeInteger(pid) || !pid || pid < 1)
    return []
  if (platform === 'win32') {
    killTree(pid)
    return ['taskkill']
  }
  const signals: NodeJS.Signals[] = []
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      kill(-pid, signal)
      signals.push(signal)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH')
        break
      throw error
    }
    if (signal === 'SIGTERM')
      await wait(750)
  }
  return signals
}
