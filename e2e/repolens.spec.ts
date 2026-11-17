import type { BrowserContext } from '@playwright/test'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { expect, test } from './fixtures'

interface PausedFetch {
  requestId: string
  request: { url: string, method: string, headers: Record<string, string> }
}

/** Intercept only the production HTTP boundary; controller, protocol and UI remain packaged code. */
async function githubNetworkFixture(context: BrowserContext, extensionId: string) {
  const browser = context.browser()
  if (!browser)
    throw new Error('Chromium browser CDP is unavailable')
  const cdp = await browser.newBrowserCDPSession()
  const { targetInfos } = await cdp.send('Target.getTargets')
  const target = targetInfos.find(item => item.type === 'service_worker' && item.url.startsWith(`chrome-extension://${extensionId}/`))
  if (!target)
    throw new Error('Extension service worker is unavailable')
  // Non-flat sessions expose worker-specific protocol messages through this browser session.
  // Playwright's public newCDPSession accepts pages/frames, not extension service workers.
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
  let sequence = 0
  const pending = new Map<number, { resolve: (_value: unknown) => void, reject: (_error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  const requests: PausedFetch['request'][] = []
  const errors: string[] = []
  let failReleases = false

  const command = (method: string, params: object = {}) => new Promise<unknown>((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Worker CDP command timed out: ${method}`))
    }, 5000)
    pending.set(id, { resolve, reject, timer })
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
      clearTimeout(timer)
      pending.delete(id)
      reject(error)
    })
  })
  const repository = (fullName: string, description = 'Repository intelligence and semantic project analysis') => ({
    full_name: fullName,
    private: false,
    description,
    topics: ['repository-analysis', 'github', 'developer-tools'],
    language: 'TypeScript',
    license: { spdx_id: 'MIT' },
    stargazers_count: fullName.endsWith('fixture') ? 320 : 240,
    forks_count: 24,
    open_issues_count: 5,
    pushed_at: new Date().toISOString(),
    archived: false,
    fork: false,
  })
  const reply = async (event: PausedFetch) => {
    requests.push(event.request)
    const url = new URL(event.request.url)
    let code = 200
    let contentType = 'application/json'
    let body: unknown
    if (url.pathname === '/repos/juck/repolens-fixture') {
      body = repository('juck/repolens-fixture', 'Repository intelligence <img data-repolens-injected src=x>')
    }
    else if (url.pathname === '/repos/juck/repolens-fixture/releases') {
      code = failReleases ? 503 : 200
      body = failReleases ? { message: 'Fixture release outage' } : [{ name: 'v1.2.3', published_at: '2026-11-15T12:00:00Z' }]
    }
    else if (url.pathname.endsWith('/readme')) {
      contentType = 'text/plain; charset=utf-8'
      body = '# RepoLens\nRepository intelligence: compare GitHub projects and discover semantic alternatives.'
    }
    else if (url.pathname === '/search/repositories') {
      body = { incomplete_results: false, items: [repository('juck/repolens-peer'), repository('juck/unrelated', 'Unrelated audio synthesizer')] }
    }
    else if (url.pathname === '/search/issues') {
      body = { total_count: url.searchParams.get('q')?.includes('merged:') ? 7 : 10 }
    }
    else {
      code = 404
      body = { message: 'Unknown fixture endpoint' }
      errors.push(`Unexpected API path: ${url.pathname}`)
    }
    await command('Fetch.fulfillRequest', {
      requestId: event.requestId,
      responseCode: code,
      responseHeaders: [{ name: 'Content-Type', value: contentType }],
      body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64'),
    })
  }
  const receive = (event: { sessionId: string, message: string }) => {
    if (event.sessionId !== sessionId)
      return
    const message = JSON.parse(event.message)
    if (typeof message.id === 'number') {
      const request = pending.get(message.id)
      if (!request)
        return
      clearTimeout(request.timer)
      pending.delete(message.id)
      if (message.error)
        request.reject(new Error(message.error.message))
      else
        request.resolve(message.result)
    }
    else if (message.method === 'Fetch.requestPaused') {
      void reply(message.params).catch(error => errors.push(String(error)))
    }
  }
  cdp.on('Target.receivedMessageFromTarget', receive)
  await command('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*', requestStage: 'Request' }] })
  return {
    requests,
    errors,
    failReleases: () => { failReleases = true },
    close: async () => {
      await command('Fetch.disable').catch(() => {})
      cdp.off('Target.receivedMessageFromTarget', receive)
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('HTTP fixture closed'))
      }
      pending.clear()
      await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {})
      await cdp.detach()
    },
  }
}

// Headless cannot accept native optional-permission prompts. The standard fixture grants this
// exact origin only inside its disposable profile; production still asks on the Analyze click.
test.use({ extraHostOrigins: ['https://api.github.com/*'] })

test('packaged RepoLens analyzes GitHub directly, caches locally and exports a source-qualified report', async ({ context, extensionId }) => {
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html?moduleId=dev.juck.repolens`)
  await expect(panel.getByTestId('repolens-workspace')).toBeVisible()
  const network = await githubNetworkFixture(context, extensionId)
  try {
    await expect(panel.getByTestId('oneweb-module-frame')).toBeHidden()
    await expect(panel.getByTestId('repolens-workspace')).toContainText('无需启动本地服务')
    await panel.getByText('GitHub 连接与本机数据', { exact: true }).click()
    await panel.getByLabel('GitHub Token（可选）', { exact: true }).fill('github-fixture-token')
    await panel.getByRole('button', { name: '保存连接设置', exact: true }).click()
    await expect(panel.getByTestId('repolens-status')).toContainText('尚未发出网络请求')
    expect(network.requests).toHaveLength(0)
    await panel.getByTestId('repolens-repository').fill('https://github.com/juck/repolens-fixture?private=secret#source')
    await panel.getByTestId('repolens-analyze').click()
    await expect(panel.getByTestId('repolens-status')).toHaveText('分析完成。', { timeout: 30000 })
    const result = panel.getByTestId('repolens-result')
    await expect(result.getByRole('link', { name: 'juck/repolens-fixture', exact: true })).toBeVisible()
    await expect(result.getByRole('link', { name: 'juck/repolens-peer', exact: true })).toBeVisible()
    await expect(result).toContainText('320 Stars')
    await expect(result).toContainText('v1.2.3')
    await expect(result).toContainText('本机 Star 快照')
    await expect(result).toContainText('<img data-repolens-injected src=x>')
    await expect(result.locator('[data-repolens-injected]')).toHaveCount(0)
    expect(network.requests.length).toBeGreaterThan(8)
    expect(network.errors).toEqual([])
    for (const request of network.requests) {
      expect(request.method).toBe('GET')
      expect(new URL(request.url).origin).toBe('https://api.github.com')
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]))
      expect(headers.authorization).toBe('Bearer github-fixture-token')
      expect(headers.cookie).toBeUndefined()
      expect(request.url).not.toContain('private=secret')
    }
    const count = network.requests.length
    await panel.getByTestId('repolens-analyze').click()
    await expect(panel.getByTestId('repolens-status')).toContainText('已读取本机缓存')
    expect(network.requests).toHaveLength(count)
    await panel.reload()
    await expect(panel.getByTestId('repolens-workspace')).toBeVisible()
    await panel.getByTestId('repolens-repository').fill('juck/repolens-fixture')
    await panel.getByTestId('repolens-analyze').click()
    await expect(panel.getByTestId('repolens-status')).toContainText('已读取本机缓存')
    expect(network.requests).toHaveLength(count)
    const downloadEvent = panel.waitForEvent('download')
    await panel.getByRole('button', { name: '下载报告', exact: true }).click()
    const download = await downloadEvent
    const report = await fs.readFile((await download.path())!, 'utf8')
    expect(download.suggestedFilename()).toBe('juck-repolens-fixture-repolens.md')
    expect(report).toContain('juck/repolens-fixture')
    expect(report).toContain('juck/repolens-peer')
    expect(report).toContain('GitHub')
    expect(report).not.toContain('github-fixture-token')
    const surfaces = await panel.evaluate(async () => ({
      html: document.documentElement.outerHTML,
      local: JSON.stringify(await chrome.storage.local.get(null)),
      frames: [...document.querySelectorAll('iframe')].map(frame => frame.src),
    }))
    expect(surfaces.html).not.toContain('github-fixture-token')
    expect(surfaces.local).not.toContain('github-fixture-token')
    expect(surfaces.frames.every(url => !url || !/^https?:/.test(url))).toBe(true)
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await panel.screenshot({ path: 'test-results/oneweb-repolens-builtin.png' })

    await panel.getByText('GitHub 连接与本机数据', { exact: true }).click()
    await panel.getByRole('button', { name: '清空分析缓存与 Star 快照', exact: true }).click()
    await expect(panel.getByTestId('repolens-status')).toContainText('已清空')
    network.failReleases()
    await panel.getByTestId('repolens-analyze').click()
    await expect(panel.getByTestId('repolens-status')).toContainText('部分来源暂不可用', { timeout: 30000 })
    await expect(panel.getByTestId('repolens-result')).toContainText('发布记录')
    await expect(panel.getByTestId('repolens-result').getByRole('link', { name: 'juck/repolens-peer', exact: true })).toBeVisible()
    expect(network.errors).toEqual([])
  }
  finally {
    await network.close()
  }
})
