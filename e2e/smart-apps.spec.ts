import type { Page } from '@playwright/test'
/* eslint no-template-curly-in-string: off -- User-authored tool templates use literal placeholders. */
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import { test as base, expect } from './fixtures'

const counterMarkup = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>计数器</title><body>
<button id="increment" type="button">增加</button><output id="count">0</output>
<p id="runtime"></p><p id="parent-access"></p><p id="network"></p>
<script>
let count = 0;
document.querySelector('#increment').addEventListener('click', () => { document.querySelector('#count').textContent = String(++count); });
document.querySelector('#runtime').textContent = String(Boolean(globalThis.chrome && globalThis.chrome.runtime));
try { parent.parent.document.body.dataset.miniAppEscaped = 'yes'; document.querySelector('#parent-access').textContent = 'escaped'; }
catch { document.querySelector('#parent-access').textContent = 'blocked'; }
fetch('https://example.invalid/oneweb-miniapp-probe').then(() => { document.querySelector('#network').textContent = 'escaped'; }, () => { document.querySelector('#network').textContent = 'blocked'; });
</script></body></html>`

const test = base.extend<{ appFixture: { origin: string, requests: Array<Record<string, unknown>> } }>({
  // eslint-disable-next-line no-empty-pattern
  appFixture: async ({}, use) => {
    const requests: Array<Record<string, unknown>> = []
    const server = createServer(async (request, response) => {
      if (request.url === '/v1/chat/completions') {
        let body = ''
        for await (const chunk of request) body += chunk
        const payload = JSON.parse(body)
        requests.push(payload)
        const output = JSON.stringify(payload.messages).includes('Create a complete self-contained interactive HTML application')
          ? `\`\`\`html\n${counterMarkup}\n\`\`\``
          : '已提取：<b>Known article facts</b>'
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: [DONE]\n\n`)
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<!doctype html><title>应用阅读测试页</title><main><h1>Article heading</h1><p>Known article facts.</p><p>Another paragraph.</p></main>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      await use({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests })
    }
    finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  },
  extraHostOrigins: async ({ appFixture }, use) => { await use([`${appFixture.origin}/*`]) },
})

async function configureProvider(panel: Page, origin: string) {
  await panel.locator('[data-destination="settings"]').click()
  await panel.getByRole('textbox', { name: '服务地址', exact: true }).fill(`${origin}/v1/`)
  await panel.getByRole('textbox', { name: '模型（每行一个）', exact: true }).fill('fixture-model')
  await panel.getByLabel('API key', { exact: true }).fill('smart-app-fixture-key')
  await panel.getByTestId('assistant-save-provider').click()
  await panel.locator('[data-destination="tools"]').click()
  await expect(panel.getByTestId('smart-apps')).toBeVisible()
}

async function createApp(panel: Page, kind: '网页标准工具' | '小应用', name: string) {
  await panel.getByTestId('smart-app-create').click()
  const dialog = panel.getByRole('dialog', { name: '新建智能工具' })
  await expect(dialog.getByRole('heading', { name: '网页标准工具' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '小应用' })).toBeVisible()
  await panel.screenshot({ path: 'test-results/oneweb-app-chooser.png' })
  await dialog.getByRole('button', { name: new RegExp(kind) }).click()
  await dialog.getByRole('textbox', { name: '工具名称', exact: true }).fill(name)
  return dialog
}

test('page tools capture only on explicit run, render model text and persist independent enable state', async ({ context, extensionId, appFixture }) => {
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 360, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
  await configureProvider(panel, appFixture.origin)
  const dialog = await createApp(panel, '网页标准工具', '网页要点')
  await dialog.getByRole('textbox', { name: '描述', exact: true }).fill('提取当前网页或选文的要点')
  await dialog.getByRole('textbox', { name: '提示词', exact: true }).fill('提取要点：${title}\n${url}\n${text}')
  await dialog.getByRole('button', { name: '保存工具', exact: true }).click()
  await expect(dialog).toBeHidden()
  const row = panel.locator('[data-app-id]').filter({ has: panel.getByRole('button', { name: '打开 网页要点', exact: true }) })
  await expect(row.getByRole('switch', { name: '启用 网页要点' })).toHaveAttribute('aria-checked', 'true')
  expect(appFixture.requests).toHaveLength(0)

  const site = await context.newPage()
  await site.goto(`${appFixture.origin}/article?private=secret#fragment`)
  await panel.evaluate(() => (document.querySelector('[aria-label="打开 网页要点"]') as HTMLButtonElement).click())
  await expect(panel.getByRole('button', { name: '运行当前网页', exact: true })).toBeVisible()
  expect(appFixture.requests).toHaveLength(0)
  await panel.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === '运行当前网页')!
    button.click()
  })
  await expect(panel.getByRole('status')).toContainText('已完成')
  await expect(panel.getByLabel('工具结果')).toHaveText('已提取：<b>Known article facts</b>')
  await expect(panel.getByLabel('工具结果').locator('b')).toHaveCount(0)
  expect(appFixture.requests).toHaveLength(1)
  expect(JSON.stringify(appFixture.requests)).toContain('Known article facts.')
  expect(JSON.stringify(appFixture.requests)).toContain('应用阅读测试页')
  expect(JSON.stringify(appFixture.requests)).not.toContain('private=secret')
  expect(JSON.stringify(appFixture.requests)).not.toContain('#fragment')
  await site.locator('main p').first().selectText()
  await panel.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === '运行选文')!.click())
  await expect.poll(() => appFixture.requests.length).toBe(2)
  await expect(panel.getByRole('status')).toContainText('已完成')
  await panel.getByRole('button', { name: '返回应用列表', exact: true }).click()
  await row.getByRole('switch', { name: '启用 网页要点' }).click()
  await expect(row.getByRole('switch', { name: '启用 网页要点' })).toHaveAttribute('aria-checked', 'false')
  await panel.reload()
  await expect(row.getByRole('switch', { name: '启用 网页要点' })).toHaveAttribute('aria-checked', 'false')
  await row.getByRole('button', { name: '打开 网页要点', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('请先启用此应用')
  expect(appFixture.requests).toHaveLength(2)
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await panel.screenshot({ path: 'test-results/oneweb-smart-apps-360.png' })
})

test('AI mini apps run interactively in an opaque sandbox, export locally and import disabled', async ({ context, extensionId, appFixture }) => {
  let escapedNetworkRequests = 0
  await context.route('https://example.invalid/oneweb-miniapp-probe', async (route) => {
    escapedNetworkRequests++
    await route.abort()
  })
  const panel = await context.newPage()
  // Observe completion of the real async registry listener, not just storage.set.
  // The probe exists only in this disposable test page and never enters the app.
  await panel.addInitScript(() => {
    if (window.top !== window || !globalThis.chrome?.storage)
      return
    const probe = window as typeof window & { registryRefreshes?: number }
    probe.registryRefreshes = 0
    const addListener = chrome.storage.onChanged.addListener.bind(chrome.storage.onChanged)
    chrome.storage.onChanged.addListener = (listener) => {
      addListener((changes, area) => {
        const result: unknown = (listener as (..._args: unknown[]) => unknown)(changes, area)
        if (area === 'local' && changes['oneweb.modules.v1'] && result instanceof Promise) {
          void result.then(() => {
            probe.registryRefreshes!++
          })
        }
      })
    }
  })
  await panel.setViewportSize({ width: 1100, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
  await configureProvider(panel, appFixture.origin)
  const dialog = await createApp(panel, '小应用', '计数器')
  await dialog.getByRole('textbox', { name: '描述你想创建的应用', exact: true }).fill('一个可以点击增加数值的计数器')
  await dialog.getByRole('button', { name: '用 AI 生成', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '应用 HTML', exact: true })).toHaveValue(counterMarkup)
  await dialog.getByRole('button', { name: '预览小应用', exact: true }).click()
  const preview = dialog.frameLocator('iframe.smart-app-preview').frameLocator('iframe')
  await preview.getByRole('button', { name: '增加', exact: true }).click()
  await expect(preview.locator('#count')).toHaveText('1')
  await expect(preview.locator('#runtime')).toHaveText('false')
  await expect(preview.locator('#parent-access')).toHaveText('blocked')
  await expect(preview.locator('#network')).toHaveText('blocked')
  expect(escapedNetworkRequests).toBe(0)
  expect(appFixture.requests).toHaveLength(1)
  await dialog.getByRole('button', { name: '保存工具', exact: true }).click()
  await expect(dialog).toBeHidden()
  await panel.getByRole('button', { name: '打开 计数器', exact: true }).click()
  const app = panel.frameLocator('iframe.smart-app-preview').frameLocator('iframe')
  await expect(app.locator('#count')).toHaveText('0')
  await app.getByRole('button', { name: '增加', exact: true }).click()
  await app.getByRole('button', { name: '增加', exact: true }).click()
  await expect(app.locator('#count')).toHaveText('2')
  // An unrelated module registry change must not reopen tools or reset the sandbox.
  const refreshesBefore = await panel.evaluate(() => (window as typeof window & { registryRefreshes: number }).registryRefreshes)
  await panel.evaluate(async () => {
    const key = 'oneweb.modules.v1'
    const stored = await chrome.storage.local.get(key)
    const records = stored[key] as Array<{ manifest: { id: string }, enabled: boolean }>
    const record = records.find(item => item.manifest.id === 'dev.oneweb.cookie-manager')!
    record.enabled = !record.enabled
    await chrome.storage.local.set({ [key]: records })
  })
  await expect.poll(() => panel.evaluate(() => (window as typeof window & { registryRefreshes: number }).registryRefreshes)).toBeGreaterThan(refreshesBefore)
  await expect(app.locator('#count')).toHaveText('2')
  await app.getByRole('button', { name: '增加', exact: true }).click()
  await expect(app.locator('#count')).toHaveText('3')
  await expect(app.locator('#runtime')).toHaveText('false')
  await expect(app.locator('#parent-access')).toHaveText('blocked')
  await expect(app.locator('#network')).toHaveText('blocked')
  expect(await panel.evaluate(() => document.body.dataset.miniAppEscaped)).toBeUndefined()
  expect(escapedNetworkRequests).toBe(0)
  expect(await panel.evaluate(() => document.documentElement.outerHTML)).not.toContain('smart-app-fixture-key')
  await panel.screenshot({ path: 'test-results/oneweb-mini-app.png' })
  await panel.getByRole('button', { name: '返回应用列表', exact: true }).click()

  const downloadEvent = panel.waitForEvent('download')
  await panel.getByRole('button', { name: '导出应用', exact: true }).click()
  const download = await downloadEvent
  const exported = await fs.readFile((await download.path())!, 'utf8')
  expect(exported).toContain('计数器')
  expect(exported).not.toContain('smart-app-fixture-key')
  await panel.getByLabel('导入应用文件').setInputFiles({ name: 'apps.json', mimeType: 'application/json', buffer: Buffer.from(exported) })
  await expect(panel.getByRole('status')).toContainText('已导入 1 个应用')
  const rows = panel.locator('[data-app-id]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1).getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await rows.nth(1).getByRole('button', { name: '删除', exact: true }).click()
  const removeDialog = panel.getByRole('dialog', { name: '删除应用', exact: true })
  await removeDialog.getByRole('button', { name: '保留应用', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await rows.nth(1).getByRole('button', { name: '删除', exact: true }).click()
  await panel.getByRole('dialog', { name: '删除应用', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await panel.reload()
  await expect(rows).toHaveCount(1)
  await expect(rows.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
})

for (const width of [1440, 420]) {
  test(`tool list keeps filtering, sorting, toggles and virtual scrolling responsive at ${width}px`, async ({ context, extensionId, appFixture }) => {
    const panel = await context.newPage()
    await panel.setViewportSize({ width, height: 900 })
    await panel.goto(`chrome-extension://${extensionId}/sidebar.html#/tools`)
    const apps = Array.from({ length: 50 }, (_, index) => ({
      id: `app-fixture-${index}`,
      name: `测试工具 ${String(index).padStart(2, '0')}`,
      description: `列表回归 ${index}`,
      kind: index === 0 ? 'mini-app' : 'web-tool',
      ...(index === 0 ? { html: counterMarkup } : { prompt: '整理当前选文' }),
      enabled: false,
      matches: ['https://*/*'],
      createdAt: 1,
      updatedAt: 1,
    }))
    await panel.getByLabel('导入应用文件').setInputFiles({
      name: 'list-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, apps })),
    })
    await expect(panel.getByRole('status')).toContainText('已导入 50 个应用')
    const list = panel.getByRole('list', { name: '应用与工具列表' })
    await expect(list).toHaveClass(/smart-apps-list-virtual/)
    const total = Number(await list.getByRole('listitem').first().getAttribute('aria-setsize'))
    expect(total).toBeGreaterThan(50)
    expect(await list.getByRole('listitem').count()).toBeLessThan(total)
    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(panel.getByRole('button', { name: '打开 测试工具 49', exact: true })).toBeVisible()

    const search = panel.getByRole('searchbox', { name: '搜索工具' })
    for (const text of ['Page', 'Page Toolbox', '测试工具 49']) {
      await search.fill(text)
      await expect(search).toHaveValue(text)
      await expect(list.getByRole('listitem')).toHaveCount(1)
    }
    await panel.getByLabel('工具排序', { exact: true }).selectOption('name-desc')
    const enabled = panel.getByRole('switch', { name: '启用 测试工具 49', exact: true })
    await enabled.click()
    await expect(enabled).toHaveAttribute('aria-checked', 'true')
    await enabled.click()
    await expect(enabled).toHaveAttribute('aria-checked', 'false')
    await search.fill('测试工具')
    await expect(list.getByRole('listitem')).toHaveCount(50)
    await expect(list.getByRole('listitem').first()).toContainText('测试工具 49')
    await panel.getByRole('button', { name: '网页工具', exact: true }).click()
    await expect(list.getByRole('listitem')).toHaveCount(49)
    await panel.getByRole('button', { name: '小应用', exact: true }).click()
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list).toContainText('测试工具 00')
    await panel.locator('[data-destination="settings"]').click()
    await panel.locator('[data-destination="tools"]').click()
    await expect(search).toBeEditable()
    expect(appFixture.requests).toHaveLength(0)
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
