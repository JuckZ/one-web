import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import fs from 'fs-extra'

async function main() {
  if (process.env.ONEWEB_LIVE_LLM !== '1') {
    process.stderr.write('真实 LLM 测试默认关闭。确认使用当前 Codex 的 Magpie 网关后运行：ONEWEB_LIVE_LLM=1 pnpm test:live-llm\n')
    process.exitCode = 1
    return
  }
  const args = process.argv.slice(2)
  if (args.some(argument => argument !== '--no-build'))
    throw new Error('只支持 --no-build；模型与网关来自 Codex 配置')
  const output = 'artifacts/test/live-chromium'
  const environment = { ...process.env, EXTENSION: 'chromium', NODE_ENV: 'production', ONEWEB_EXTENSION_DIR: output, EXTENSION_PATH: path.resolve(output) }
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  if (!args.includes('--no-build')) {
    const built = spawnSync(pnpm, ['run', 'build'], { stdio: 'inherit', env: environment })
    if (built.error || built.status !== 0) {
      process.exitCode = built.status || 1
      return
    }
  }
  const manifest = await fs.readJson(path.join(output, 'manifest.json'))
  if (manifest.manifest_version !== 3 || !manifest.background?.service_worker || !manifest.sandbox?.pages?.includes('sandbox.html'))
    throw new Error('需要当前生产 Chromium 构建；请去掉 --no-build 重新构建')
  const tested = spawnSync(pnpm, ['exec', 'playwright', 'test', '--config', 'playwright.live.config.ts', '--retries=0'], { stdio: 'inherit', env: environment })
  process.exitCode = tested.status === 0 ? 0 : (tested.status ?? 1)
}

void main().catch(() => {
  // Never print exception objects from credential-reading or network code.
  process.stderr.write('真实 LLM 测试启动失败，请检查配置、生产构建和测试报告。\n')
  process.exitCode = 1
})
