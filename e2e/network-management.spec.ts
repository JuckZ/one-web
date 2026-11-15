import { expect, test } from './fixtures'

test.use({ networkManagementAccess: true })

test('network management protects new page and iframe WebRTC, then releases browser control', async ({ context, extensionId }) => {
  await context.route('https://network.example/**', route => route.fulfill({
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': 'script-src \'nonce-fixture\'; frame-src \'self\'' },
    body: `<!doctype html><script nonce="fixture">window.initialRtc = typeof RTCPeerConnection</script><main>Network fixture</main>${
      route.request().url().endsWith('/frame') ? '' : '<iframe src="/frame"></iframe><iframe srcdoc="&lt;script nonce=&quot;fixture&quot;&gt;window.initialRtc=typeof RTCPeerConnection&lt;/script&gt;"></iframe>'
    }`,
  }))
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 420, height: 1000 })
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html?moduleId=dev.oneweb.clash-control`)
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]')
  await expect(card.getByRole('heading', { name: '网络管理', exact: true })).toBeVisible({ timeout: 3000 })
  await card.getByTestId('module-toggle').click()
  const privacy = card.getByTestId('network-management')
  await expect(privacy).toBeVisible()
  await expect(card.getByTestId('clash-controller-url')).toBeVisible()
  await privacy.getByTestId('network-apply').click()
  await expect(privacy.getByTestId('network-status')).toContainText('WebRTC 防护已生效')
  await expect.poll(() => panel.evaluate(() => new Promise<string>(resolve => chrome.privacy.network.webRTCIPHandlingPolicy.get({}, value => resolve(value.value))))).toBe('disable_non_proxied_udp')
  const site = await context.newPage()
  await site.goto('https://network.example/page')
  expect(await site.evaluate(() => (window as unknown as { initialRtc: string }).initialRtc)).toBe('undefined')
  await expect.poll(async () => site.frames().length).toBe(3)
  expect(await site.frames()[1]!.evaluate(() => (window as unknown as { initialRtc: string }).initialRtc)).toBe('undefined')
  expect(await site.frames()[2]!.evaluate(() => (window as unknown as { initialRtc: string }).initialRtc)).toBe('undefined')
  await privacy.getByTestId('network-disable').click()
  await expect(privacy.getByTestId('network-message')).toContainText('防护已关闭')
  await expect.poll(() => panel.evaluate(() => new Promise<string>(resolve => chrome.privacy.network.webRTCIPHandlingPolicy.get({}, value => resolve(value.levelOfControl))))).toBe('controllable_by_this_extension')
  await site.reload()
  expect(await site.evaluate(() => (window as unknown as { initialRtc: string }).initialRtc)).toBe('function')
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await panel.screenshot({ path: 'test-results/network-management-420px.png' })
})

test('media device blocking is independent of peer connections and ICE objects', async ({ context, extensionId }) => {
  await context.route('https://network.example/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><script>window.initialNetwork = [typeof RTCPeerConnection, navigator.mediaDevices === null, typeof RTCIceCandidate]</script>',
  }))
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html?moduleId=dev.oneweb.clash-control`)
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]')
  await card.getByTestId('module-toggle').click()
  const privacy = card.getByTestId('network-management')
  await privacy.getByTestId('network-block-support').uncheck()
  await privacy.getByTestId('network-block-devices').check()
  await privacy.getByTestId('network-apply').click()
  await expect(privacy.getByTestId('network-status')).toContainText('WebRTC 防护已生效')
  const site = await context.newPage()
  await site.goto('https://network.example/media')
  expect(await site.evaluate(() => (window as unknown as { initialNetwork: unknown }).initialNetwork)).toEqual(['function', true, 'function'])
})

test('extra RTC objects can be hidden while peer connections and media devices stay available', async ({ context, extensionId }) => {
  await context.route('https://network.example/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><script>window.initialNetwork = [typeof RTCPeerConnection, typeof navigator.mediaDevices, typeof RTCIceCandidate, typeof RTCDataChannel]</script>',
  }))
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html?moduleId=dev.oneweb.clash-control`)
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]')
  await card.getByTestId('module-toggle').click()
  const privacy = card.getByTestId('network-management')
  await privacy.getByTestId('network-block-support').uncheck()
  await privacy.getByTestId('network-block-additional').check()
  await privacy.getByTestId('network-apply').click()
  await expect(privacy.getByTestId('network-status')).toContainText('WebRTC 防护已生效')
  const site = await context.newPage()
  await site.goto('https://network.example/extra')
  expect(await site.evaluate(() => (window as unknown as { initialNetwork: unknown }).initialNetwork)).toEqual(['function', 'object', 'undefined', 'undefined'])
})

test('worker restart restores only WebRTC protection and privacy revocation releases its page scripts', async ({ context, extensionId, clashControllerFixture }) => {
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html?moduleId=dev.oneweb.clash-control`)
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]')
  await card.getByTestId('module-toggle').click()
  const peerRecords = await panel.evaluate(async () => {
    const state = (await chrome.storage.local.get('oneweb.modules.v1'))['oneweb.modules.v1']
    return JSON.stringify(state.filter((record: { manifest: { id: string } }) => record.manifest.id !== 'dev.oneweb.clash-control'))
  })
  await card.getByTestId('network-apply').click()
  await expect(card.getByTestId('network-status')).toContainText('WebRTC 防护已生效')
  const cdp = await context.browser()!.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const worker = targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))!
    await cdp.send('Target.closeTarget', { targetId: worker.targetId })
  }
  finally { await cdp.detach() }
  await panel.evaluate(() => new Promise<void>(resolve => chrome.privacy.network.webRTCIPHandlingPolicy.clear({ scope: 'regular_only' }, resolve)))
  await panel.reload()
  await expect(card.getByTestId('network-status')).toContainText('WebRTC 防护已生效')
  expect(clashControllerFixture.requests).toEqual({ version: 0, configs: 0, proxies: 0, unauthorized: 0 })
  await panel.evaluate(() => chrome.permissions.remove({ permissions: ['privacy'] }))
  await expect.poll(() => panel.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith('oneweb-network-')).length)).toBe(0)
  await card.getByTestId('network-refresh').click()
  await expect(card.getByTestId('network-status')).toContainText('隐私权限未授权')
  expect(await panel.evaluate(async () => {
    const state = (await chrome.storage.local.get('oneweb.modules.v1'))['oneweb.modules.v1']
    return JSON.stringify(state.filter((record: { manifest: { id: string } }) => record.manifest.id !== 'dev.oneweb.clash-control'))
  })).toBe(peerRecords)
})

test('Clash disconnect preserves active WebRTC protection and the shared module toggle releases both', async ({ context, extensionId, clashControllerFixture }) => {
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html?moduleId=dev.oneweb.clash-control`)
  const card = panel.locator('[data-testid="module-card"][data-module-id="dev.oneweb.clash-control"]')
  await card.getByTestId('module-toggle').click()
  await card.getByTestId('clash-controller-url').fill(clashControllerFixture.origin)
  await card.getByTestId('clash-prepare').click()
  panel.once('dialog', dialog => dialog.accept(clashControllerFixture.secret))
  await card.getByTestId('clash-connect').click()
  await expect(card.getByTestId('clash-control-status')).toContainText('Clash.Meta')
  await card.getByTestId('network-apply').click()
  await expect(card.getByTestId('network-status')).toContainText('WebRTC 防护已生效')
  await card.getByTestId('clash-refresh').click()
  await expect(card.getByTestId('clash-proxy-groups')).toBeVisible()
  await card.getByTestId('clash-disconnect').click()
  await expect(card.getByTestId('clash-controller-url')).toBeVisible()
  await card.getByTestId('network-refresh').click()
  await expect(card.getByTestId('network-status')).toContainText('WebRTC 防护已生效')
  expect(await panel.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)))).not.toContain(clashControllerFixture.secret)
  await card.getByTestId('module-toggle').click()
  await expect(card.getByTestId('module-toggle')).toHaveAttribute('aria-checked', 'false')
  expect(await panel.evaluate(() => new Promise<string>(resolve => chrome.privacy.network.webRTCIPHandlingPolicy.get({}, value => resolve(value.levelOfControl))))).toBe('controllable_by_this_extension')
  expect(await panel.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith('oneweb-network-')))).toHaveLength(0)
})
