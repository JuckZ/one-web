import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { expect, test } from './fixtures'

test.use({ cookieManagerAccess: true })

test('Cookie Manager performs reviewed CRUD and JSON round trips in the packaged 420px panel', async ({ context, extensionId }) => {
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 1000 })
  await panel.goto(`chrome-extension://${extensionId}/sidebar.html?moduleId=dev.oneweb.cookie-manager`)
  const card = panel.locator('[data-module-id="dev.oneweb.cookie-manager"][data-testid="module-card"]')
  await expect(card).toBeVisible({ timeout: 3000 })
  await expect(card.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  await card.getByTestId('module-toggle').click()
  const workspace = card.getByTestId('cookie-manager')
  await expect(workspace).toBeVisible()
  const before = await panel.evaluate(async () => {
    const state = await chrome.storage.local.get(null)
    await chrome.cookies.set({ url: 'https://cookie.example/', name: 'session', value: 'synthetic-http-only', httpOnly: true, secure: true, sameSite: 'lax' })
    await chrome.cookies.set({ url: 'https://cookie.example/', name: 'peer', value: 'untouched', secure: true, sameSite: 'lax' })
    return state
  })
  await workspace.getByTestId('cookie-all').click()
  await workspace.getByTestId('cookie-authorize').click()
  const search = workspace.getByRole('searchbox')
  await expect(search).toBeVisible()
  await search.fill('cookie.example')
  await expect(workspace.locator('[data-cookie-row]')).toHaveCount(2)
  await workspace.getByTestId('cookie-create').click()
  await workspace.getByTestId('cookie-name').fill('created-in-panel')
  await workspace.getByTestId('cookie-domain').fill('cookie.example')
  await workspace.getByTestId('cookie-path').fill('/created')
  await workspace.getByTestId('cookie-value').fill('synthetic-created-value')
  await workspace.getByTestId('cookie-session').uncheck()
  await workspace.getByTestId('cookie-save').click()
  await expect(workspace.getByTestId('cookie-status')).toContainText('Cookie 已保存')
  expect(await panel.evaluate(() => chrome.cookies.get({ url: 'https://cookie.example/created', name: 'created-in-panel' })))
    .toMatchObject({ value: 'synthetic-created-value', session: false, path: '/created', hostOnly: true })
  const row = workspace.locator('[data-cookie-row]').filter({ hasText: 'session' })
  await expect(row).not.toContainText('synthetic-http-only')
  await row.getByTestId('cookie-edit').click()
  await expect(workspace.getByTestId('cookie-value')).toHaveValue('synthetic-http-only')
  await expect(workspace.getByTestId('cookie-name')).toBeDisabled()
  await workspace.getByTestId('cookie-value').fill('edited-in-panel')
  await workspace.getByTestId('cookie-save').click()
  await expect(workspace.getByTestId('cookie-status')).toContainText('Cookie 已保存')
  expect(await panel.evaluate(async () => (await chrome.cookies.get({ url: 'https://cookie.example/', name: 'session' }))?.value))
    .toBe('edited-in-panel')
  await row.locator('[data-cookie-select]').check()
  await workspace.getByTestId('cookie-export').click()
  const downloadPromise = panel.waitForEvent('download')
  await workspace.getByTestId('cookie-export-confirm').click()
  const download = await downloadPromise
  const exported = await fs.readFile((await download.path())!, 'utf8')
  const records = JSON.parse(exported)
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ name: 'session', value: 'edited-in-panel', httpOnly: true, session: true })
  await row.locator('[data-cookie-select]').check()
  await workspace.getByTestId('cookie-delete').click()
  await expect(workspace.getByTestId('cookie-delete-confirm')).toBeVisible()
  expect(await panel.evaluate(async () => (await chrome.cookies.get({ url: 'https://cookie.example/', name: 'session' }))?.value))
    .toBe('edited-in-panel')
  await workspace.getByTestId('cookie-delete-confirm').click()
  await expect(workspace.getByTestId('cookie-status')).toContainText('成功 1 项')
  expect(await panel.evaluate(() => chrome.cookies.get({ url: 'https://cookie.example/', name: 'session' }))).toBeNull()
  await workspace.getByTestId('cookie-import-store').selectOption(records[0].storeId)
  await workspace.getByTestId('cookie-import-file').setInputFiles({
    name: 'cookies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported),
  })
  await expect(workspace.locator('[data-cookie-preview]')).toHaveCount(1)
  expect(await panel.evaluate(() => chrome.cookies.get({ url: 'https://cookie.example/', name: 'session' }))).toBeNull()
  await workspace.locator('[data-cookie-preview-select]').check()
  await workspace.getByTestId('cookie-import-confirm').click()
  await expect(workspace.locator('[data-cookie-preview]')).toHaveCount(0)
  expect(await panel.evaluate(async () => (await chrome.cookies.get({ url: 'https://cookie.example/', name: 'session' }))?.value))
    .toBe('edited-in-panel')
  expect(await panel.evaluate(async () => (await chrome.cookies.get({ url: 'https://cookie.example/', name: 'peer' }))?.value))
    .toBe('untouched')
  expect(await panel.evaluate(() => chrome.storage.local.get(null))).toEqual(before)
  expect(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await panel.screenshot({ path: 'test-results/cookie-manager-chromium.png', fullPage: true })
  expect(await panel.evaluate(() => chrome.permissions.remove({ permissions: ['cookies'] }))).toBe(true)
  await expect(workspace.locator('[data-cookie-row]')).toHaveCount(0)
  await expect(workspace.getByTestId('cookie-value')).toHaveCount(0)
})

test('Cookie Manager preserves CHIPS identities and invalidates old snapshots after worker restart', async ({ context, extensionId }) => {
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/sidebar.html?moduleId=dev.oneweb.cookie-manager`)
  const card = panel.locator('[data-module-id="dev.oneweb.cookie-manager"][data-testid="module-card"]')
  await card.getByTestId('module-toggle').click()
  const workspace = card.getByTestId('cookie-manager')
  await panel.evaluate(async () => {
    for (const ancestor of [false, true]) {
      await chrome.cookies.set({
        url: 'https://partition.example/',
        name: 'partitioned',
        value: ancestor ? 'cross-site' : 'same-site',
        secure: true,
        sameSite: 'no_restriction',
        partitionKey: { topLevelSite: 'https://partition.example', hasCrossSiteAncestor: ancestor },
      } as chrome.cookies.SetDetails)
    }
  })
  await workspace.getByTestId('cookie-all').click()
  await workspace.getByTestId('cookie-authorize').click()
  await workspace.getByRole('searchbox').fill('partition.example')
  await expect(workspace.locator('[data-cookie-row]')).toHaveCount(2)
  await workspace.locator('[data-cookie-row]').filter({ hasText: '跨站祖先：false' }).locator('[data-cookie-select]').check()
  await workspace.getByTestId('cookie-delete').click()
  await workspace.getByTestId('cookie-delete-confirm').click()
  await expect(workspace.locator('[data-cookie-row]')).toHaveCount(1)
  const partitioned = await panel.evaluate(() => (chrome.cookies as unknown as {
    getAll: (_details: object) => Promise<Array<{ value: string }>>
  }).getAll({ domain: 'partition.example', partitionKey: {} }))
  expect(partitioned.map(cookie => cookie.value)).toEqual(['cross-site'])
  const old = await panel.evaluate(async () => {
    const base = { channel: 'oneweb.cookie-manager', version: 1 }
    const prepared = await chrome.runtime.sendMessage({ ...base, type: 'prepare', scope: 'all' })
    const opened = await chrome.runtime.sendMessage({ ...base, type: 'open', token: prepared.result.value.token })
    return { id: opened.result.value.id, entryIds: opened.result.value.entries.map((entry: { id: string }) => entry.id) }
  })
  const cdp = await context.browser()!.newBrowserCDPSession()
  const targets = await cdp.send('Target.getTargets')
  const worker = targets.targetInfos.find(target => target.type === 'service_worker' && target.url.includes(extensionId))
  expect(worker).toBeDefined()
  await cdp.send('Target.closeTarget', { targetId: worker!.targetId })
  await cdp.detach()
  const stale = await panel.evaluate(input => chrome.runtime.sendMessage({
    channel: 'oneweb.cookie-manager',
    version: 1,
    type: 'export',
    snapshotId: input.id,
    entryIds: input.entryIds,
  }), old)
  expect(stale.result).toEqual({ ok: false, reason: 'lifecycle-cancelled' })
  await workspace.getByTestId('cookie-refresh').click()
  await expect(workspace.locator('[data-cookie-row]')).toHaveCount(0)
  await card.getByTestId('module-toggle').click()
  await expect(card.getByTestId('cookie-manager')).toHaveCount(0)
  expect((await panel.evaluate(() => chrome.cookies.getAll({ domain: 'partition.example' }))).length).toBe(0)
  const surviving = await panel.evaluate(() => (chrome.cookies as unknown as {
    getAll: (_details: object) => Promise<Array<{ value: string }>>
  }).getAll({ domain: 'partition.example', partitionKey: {} }))
  expect(surviving.map(cookie => cookie.value)).toEqual(['cross-site'])
})
