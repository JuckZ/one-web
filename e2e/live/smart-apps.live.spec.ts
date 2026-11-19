/* eslint no-template-curly-in-string: off -- Real user tools use literal prompt variables. */
import type { Locator, Page } from '@playwright/test'
import { randomInt, randomUUID } from 'node:crypto'
import { test as base, expect } from '../fixtures'
import { createMagpieGateway } from './magpie-gateway'

type Gateway = Awaited<ReturnType<typeof createMagpieGateway>>
interface LiveScenario {
  gateway: Gateway
  pageBatch: string
  selectionBatch: string
  appBatch: string
  pageSeats: number
  selectionSeats: number
}

const liveEnabled = process.env.ONEWEB_LIVE_LLM === '1'
const test = base.extend<{ live: LiveScenario }>({
  // No live fixture (and therefore no credential read or network call) is set up for skipped tests.
  // eslint-disable-next-line no-empty-pattern
  live: async ({}, use, testInfo) => {
    if (!liveEnabled)
      throw new Error('Set ONEWEB_LIVE_LLM=1 to explicitly enable real Windows Magpie model tests')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const pageBatch = `PAGE-${suffix}`
    const selectionBatch = `SELECT-${suffix}`
    const appBatch = `APP-${suffix}`
    const pageSeats = randomInt(21, 60)
    const selectionSeats = randomInt(61, 95)
    const articleHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Project release briefing ${suffix}</title><main>
<h1>Public project release briefing</h1>
<p id="page-facts">Project Cedar. Batch ${pageBatch}. Launch date 2026-12-04. Seats ${pageSeats}.</p>
<p id="selection-facts">Project Quartz. Batch ${selectionBatch}. Launch date 2026-12-19. Seats ${selectionSeats}.</p>
</main></html>`
    const gateway = await createMagpieGateway({ articleHtml })
    try {
      await use({ gateway, pageBatch, selectionBatch, appBatch, pageSeats, selectionSeats })
    }
    finally {
      await gateway.close()
      // Metadata only: no provider key, request payload, response content or private browser data.
      await testInfo.attach('real-model-request-metadata', {
        contentType: 'application/json',
        body: JSON.stringify({
          scenario: testInfo.title,
          model: gateway.model,
          count: gateway.stats.requests.length,
          requests: gateway.stats.requests.map(request => ({
            durationMs: request.durationMs,
            status: request.status,
            aborted: request.aborted,
            requestBytes: request.requestBytes,
            responseBytes: request.responseBytes,
          })),
        }, null, 2),
      })
    }
  },
  extraHostOrigins: async ({ live }, use) => { await use([`${live.gateway.origin}/*`]) },
})

test.skip(!liveEnabled, 'Opt-in only: requires ONEWEB_LIVE_LLM=1 and a real Windows Magpie gateway')

async function configureProvider(panel: Page, gateway: Gateway) {
  await panel.locator('[data-destination="settings"]').click()
  await panel.getByRole('textbox', { name: '服务地址', exact: true }).fill(`${gateway.origin}/v1/`)
  await panel.getByRole('textbox', { name: '模型（每行一个）', exact: true }).fill(gateway.model)
  await panel.getByLabel('API key', { exact: true }).fill(gateway.browserKey)
  await panel.getByTestId('assistant-save-provider').click()
  await panel.locator('[data-destination="tools"]').click()
  await expect(panel.getByTestId('smart-apps')).toBeVisible()
}

async function createApp(panel: Page, kind: '网页标准工具' | '小应用', name: string) {
  await panel.getByTestId('smart-app-create').click()
  const dialog = panel.getByRole('dialog', { name: '新建智能工具', exact: true })
  await dialog.getByRole('button', { name: new RegExp(kind) }).click()
  await dialog.getByRole('textbox', { name: '工具名称', exact: true }).fill(name)
  return dialog
}

function readStructuredResult(text: string): { records: unknown[], summary: string } {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const value: unknown = JSON.parse(normalized)
  expect(value).toEqual(expect.objectContaining({ records: expect.any(Array), summary: expect.any(String) }))
  return value as { records: unknown[], summary: string }
}

async function expectCompleted(panel: Page) {
  await expect(panel.locator('.smart-apps-status')).toHaveText('已完成', { timeout: 120000 })
}

async function clickBackgroundButton(panel: Page, name: string) {
  // Keep the synthetic article active so the extension captures that page, not the management tab.
  await panel.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === label)
    if (!button)
      throw new Error(`Missing application action: ${label}`)
    button.click()
  }, name)
}

test('real model grounds a page tool in changing webpage and selected facts', async ({ context, extensionId, live }) => {
  const { gateway } = live
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
  await configureProvider(panel, gateway)
  const dialog = await createApp(panel, '网页标准工具', '真实模型项目简报')
  await dialog.getByRole('textbox', { name: '提示词', exact: true }).fill(
    'Extract project release facts only from the supplied reference text. Return only one JSON object, without Markdown or prose outside the JSON. '
    + 'Its keys are records (array) and summary (one sentence). Each record must contain project (full name such as Project Cedar), batch (copy the case-sensitive identifier exactly), '
    + 'launchDate (YYYY-MM-DD), seats (integer). Include every project explicitly present in the supplied text and no other projects. Never infer omitted values. '
    + 'Source title: ${title}\nSource URL: ${url}\nReference text:\n${text}',
  )
  await dialog.getByRole('button', { name: '保存工具', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(gateway.stats.requests).toHaveLength(0)
  const site = await context.newPage()
  await site.goto(`${gateway.origin}/article?private=do-not-share#source`)
  await panel.evaluate(() => (document.querySelector('[aria-label="打开 真实模型项目简报"]') as HTMLButtonElement).click())
  await expect(panel.getByRole('button', { name: '运行当前网页', exact: true })).toBeVisible()
  expect(gateway.stats.requests).toHaveLength(0)
  await clickBackgroundButton(panel, '运行当前网页')
  await expectCompleted(panel)
  const pageAnswer = readStructuredResult(await panel.getByLabel('工具结果').textContent() ?? '')
  expect(pageAnswer.records).toHaveLength(2)
  expect(pageAnswer.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ project: 'Project Cedar', batch: live.pageBatch, launchDate: '2026-12-04', seats: live.pageSeats }),
    expect.objectContaining({ project: 'Project Quartz', batch: live.selectionBatch, launchDate: '2026-12-19', seats: live.selectionSeats }),
  ]))
  expect(pageAnswer.summary.trim().length).toBeGreaterThan(0)
  await expect(panel.getByLabel('工具结果').locator('*')).toHaveCount(0)
  expect(gateway.stats.requests).toHaveLength(1)

  await site.locator('#selection-facts').selectText()
  await clickBackgroundButton(panel, '运行选文')
  await expect.poll(() => gateway.stats.requests.length).toBe(2)
  await expectCompleted(panel)
  const selectionAnswer = readStructuredResult(await panel.getByLabel('工具结果').textContent() ?? '')
  expect(selectionAnswer.records).toEqual([
    expect.objectContaining({ project: 'Project Quartz', batch: live.selectionBatch, launchDate: '2026-12-19', seats: live.selectionSeats }),
  ])
  expect(JSON.stringify(selectionAnswer)).not.toContain(live.pageBatch)
  expect(JSON.stringify(selectionAnswer)).not.toContain('Project Cedar')
  expect(JSON.stringify(selectionAnswer)).not.toContain('private=do-not-share')
  expect(gateway.stats.requests).toHaveLength(2)
  // The provider cancels its reader after [DONE]; a transport close at that point is valid.
  // The UI completion and grounded records above prove semantic success independently.
  expect(gateway.stats.requests.every(request => request.status === 200 && request.responseBytes > 0)).toBe(true)
})

async function assertCounter(frame: Locator, expected: number) {
  await expect(frame).toHaveText(new RegExp(`^\\s*${expected}\\s*$`))
}

test('real generated mini app responds to pointer and keyboard and persists as an isolated application', async ({ context, extensionId, live }) => {
  const { gateway } = live
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 900 })
  await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
  await configureProvider(panel, gateway)
  const dialog = await createApp(panel, '小应用', '真实模型计数器')
  await dialog.getByRole('textbox', { name: '描述你想创建的应用', exact: true }).fill(
    `创建一个适用于窄侧栏的中文离线计数器，界面显示记录码 ${live.appBatch}。`
    + '使用原生 button，两个按钮的可访问名称必须分别准确为“增加一次”和“归零”。'
    + '用 <output id="count"> 显示数字，初始为 0，此 output 的文本只含数字。'
    + '点击增加一次加 1，点击归零回到 0；原生按钮必须支持 Enter 和空格键。'
    + 'HTML、CSS、JavaScript 均内联，不加载外部资源，不访问网络、父窗口、浏览器 API 或存储。',
  )
  await dialog.getByRole('button', { name: '用 AI 生成', exact: true }).click()
  const html = dialog.getByRole('textbox', { name: '应用 HTML', exact: true })
  await expect(html).not.toHaveValue('', { timeout: 120000 })
  expect((await html.inputValue()).length).toBeGreaterThan(100)
  expect(await html.inputValue()).toContain(live.appBatch)
  expect(gateway.stats.requests).toHaveLength(1)
  await dialog.getByRole('button', { name: '预览小应用', exact: true }).click()
  const preview = dialog.frameLocator('iframe.smart-app-preview').frameLocator('iframe')
  await expect(preview.locator('body')).toContainText(live.appBatch)
  await assertCounter(preview.locator('#count'), 0)
  await preview.getByRole('button', { name: '增加一次', exact: true }).click()
  await assertCounter(preview.locator('#count'), 1)
  await preview.getByRole('button', { name: '增加一次', exact: true }).press('Enter')
  await assertCounter(preview.locator('#count'), 2)
  await preview.getByRole('button', { name: '归零', exact: true }).click()
  await assertCounter(preview.locator('#count'), 0)
  expect(await preview.locator('body').evaluate(() => {
    let parentReadable = false
    try {
      parentReadable = Boolean(parent.parent.document.body)
    }
    catch { /* A correctly isolated mini app cannot read its parent document. */ }
    return { runtime: Boolean(globalThis.chrome?.runtime), storage: Boolean(globalThis.chrome?.storage), parentReadable }
  })).toEqual({ runtime: false, storage: false, parentReadable: false })
  await dialog.getByRole('button', { name: '保存工具', exact: true }).click()
  await expect(dialog).toBeHidden()
  await panel.reload()
  const row = panel.locator('[data-app-id]').filter({ has: panel.getByRole('button', { name: '打开 真实模型计数器', exact: true }) })
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await row.getByRole('button', { name: '打开 真实模型计数器', exact: true }).click()
  const app = panel.frameLocator('iframe.smart-app-preview').frameLocator('iframe')
  await expect(app.locator('body')).toContainText(live.appBatch)
  await assertCounter(app.locator('#count'), 0)
  await app.getByRole('button', { name: '增加一次', exact: true }).press('Space')
  await assertCounter(app.locator('#count'), 1)
  await panel.getByRole('button', { name: '返回应用列表', exact: true }).click()
  await row.getByRole('switch').click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await panel.reload()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await row.getByRole('button', { name: '打开 真实模型计数器', exact: true }).click()
  await expect(panel.locator('.smart-apps-status')).toContainText('请先启用此应用')
  await expect(panel.locator('iframe.smart-app-preview')).toHaveCount(0)
  expect(gateway.stats.requests).toHaveLength(1)
  expect(gateway.stats.requests.every(request => request.status === 200 && request.responseBytes > 0)).toBe(true)
})
