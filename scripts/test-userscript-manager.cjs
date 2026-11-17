const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
/* global chrome */
const process = require('node:process')
const { chromium, expect } = require('@playwright/test')

const digest = value => createHash('sha256').update(value).digest('hex');
(async () => {
  const root = path.resolve(__dirname, '..')
  const base = path.resolve(process.env.ONEWEB_MANAGER_OUTPUT_DIR || path.join(root, 'artifacts/test-results/userscript-manager'))
  const manager = process.env.ONEWEB_TAMPERMONKEY_PATH
  if (!manager)
    throw new Error('Set ONEWEB_TAMPERMONKEY_PATH to unpacked Tampermonkey extension package files (not a browser profile).')
  const managerManifest = JSON.parse(await fs.readFile(path.join(manager, 'manifest.json'), 'utf8'))
  await fs.mkdir(base, { recursive: true })
  const userPath = path.resolve(process.argv[2] || path.join(root, 'artifacts/build/userscript/one-web.user.js'))
  const metaPath = path.resolve(process.argv[3] || path.join(root, 'artifacts/build/userscript/one-web.meta.js'))
  const label = 'manager'
  const originalUser = await fs.readFile(userPath, 'utf8')
  const originalMeta = await fs.readFile(metaPath, 'utf8')
  const match = originalUser.match(/^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==\r?\n?/m)
  if (!match || match.index !== 0)
    throw new Error('Missing production metadata block')
  const originalHeader = match[0]
  const runtime = originalUser.slice(originalHeader.length)
  if (originalMeta !== originalHeader)
    throw new Error('Production .meta.js differs from script metadata header')
  function field(header, name) {
    const re = new RegExp(`^// @${name}\\s+(.+)$`, 'gm')
    const matches = [...header.matchAll(re)]
    if (matches.length !== 1)
      throw new Error(`Expected one ${name}`)
    return matches[0][1].trim()
  }
  const releaseVersion = field(originalHeader, 'version')
  const baselineVersion = '0.0.9'
  if (releaseVersion === baselineVersion)
    throw new Error('Baseline must differ from release')
  const sourceFields = Object.fromEntries(['name', 'namespace', 'version', 'updateURL', 'downloadURL'].map(name => [name, field(originalHeader, name)]))
  if (sourceFields.name !== 'OneWeb' || sourceFields.namespace !== 'https://github.com/JuckZ/one-web')
    throw new Error('Unexpected production identity')
  for (const name of ['updateURL', 'downloadURL']) {
    if (sourceFields[name] !== (`https://github.com/JuckZ/one-web/releases/latest/download/one-web.${name === 'updateURL' ? 'meta' : 'user'}.js`))
      throw new Error('Production metadata must use intended GitHub releases endpoint')
  }
  const grants = originalHeader.split('\n').filter(line => /^\/\/ @grant\s+/.test(line))
  let origin
  let phase = 'baseline'
  const requests = []
  function replace(header, name, value) {
    return header.replace(new RegExp(`^(// @${name}\\s+).+$`, 'm'), (_line, prefix) => prefix + value)
  }
  function fixtureHeader(version) {
    let header = replace(originalHeader, 'version', version)
    header = replace(header, 'updateURL', `${origin}/one-web.meta.js`)
    return replace(header, 'downloadURL', `${origin}/one-web.user.js`)
  }
  function fixtureUser(version) {
    return fixtureHeader(version) + runtime
  }
  const report = { sourceUserPath: userPath, sourceMetaPath: metaPath, sourceUserSha256: digest(originalUser), sourceMetaSha256: digest(originalMeta), runtimeSha256: digest(runtime), productionFields: sourceFields, productionGrants: grants, baselineVersion, releaseVersion, assertions: [], requests, managerVersion: managerManifest.version, startedAt: new Date().toISOString(), limits: ['Only metadata version/updateURL/downloadURL are substituted in test copies; production runtime bytes, name, namespace and grants remain unchanged.', 'Local HTTP is the deterministic network boundary. This does not prove a published GitHub release exists or that its public URLs are reachable.', 'The baseline uses current runtime bytes with a synthetic older metadata version, not a historical release binary.', 'No user Chrome profile, installed scripts, GitHub action or release is modified.'] }
  const checked = (name) => {
    report.assertions.push(name)
    console.log('PASS', name)
  }
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>OneWeb release fixture</title></head><body><h1>Release fixture</h1><p>Only synthetic content</p></body></html>'
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0]
    const version = phase === 'baseline' ? baselineVersion : releaseVersion
    const downloadable = route === '/one-web.meta.js' || route === '/one-web.user.js'
    const status = phase === 'offline' && downloadable ? 503 : 200
    requests.push({ index: requests.length, url: req.url, route, phase, version, status })
    res.statusCode = status
    res.setHeader('Cache-Control', 'no-store')
    if (downloadable) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.end(status === 503 ? 'Synthetic release endpoint unavailable' : route.endsWith('.meta.js') ? fixtureHeader(version) : fixtureUser(version))
    }
    else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(html)
    }
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  report.fixtureOrigin = origin
  report.metadataSubstitutions = { baseline: { version: { from: sourceFields.version, to: baselineVersion }, updateURL: { from: sourceFields.updateURL, to: `${origin}/one-web.meta.js` }, downloadURL: { from: sourceFields.downloadURL, to: `${origin}/one-web.user.js` } }, release: { updateURL: { from: sourceFields.updateURL, to: `${origin}/one-web.meta.js` }, downloadURL: { from: sourceFields.downloadURL, to: `${origin}/one-web.user.js` } } }
  report.baselineFixtureSha256 = digest(fixtureUser(baselineVersion))
  report.releaseFixtureSha256 = digest(fixtureUser(releaseVersion))
  for (const version of [baselineVersion, releaseVersion]) {
    if (fixtureUser(version).slice(fixtureHeader(version).length) !== runtime)
      throw new Error('Runtime body changed')
    if (fixtureHeader(version).split('\n').filter(line => /^\/\/ @grant\s+/.test(line)).join('\n') !== grants.join('\n'))
      throw new Error('Grants changed')
  }
  checked('Fixture copies preserve exact production runtime, identity and finite grants')
  const profile = await fs.mkdtemp(path.join(base, 'profile-'))
  report.disposableProfile = profile
  let context
  let operationError
  const cleanupErrors = []
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${manager}`, `--load-extension=${manager}`, '--no-sandbox'] })
    report.browserVersion = context.browser().version()
    await context.route('https://**/*', route => route.fulfill({ contentType: route.request().resourceType() === 'script' ? 'application/javascript' : 'text/html', body: route.request().resourceType() === 'script' ? '' : '<!doctype html><title>Isolated manager test</title>' }))
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 })
    const id = new URL(sw.url()).hostname
    const admin = await context.newPage()
    await admin.goto(`chrome://extensions/?id=${id}`)
    await admin.getByRole('button', { name: /^Allow User Scripts/ }).click()
    await admin.goto(`chrome-extension://${id}/options.html`)
    await admin.getByText('Installed Userscripts', { exact: true }).waitFor()
    const installer = await context.newPage()
    await installer.goto(`${origin}/one-web.user.js`).catch(() => {})
    await expect.poll(() => context.pages().some(page => page.url().includes('/ask.html'))).toBe(true)
    const ask = context.pages().find(page => page.url().includes('/ask.html'))
    await ask.getByRole('button', { name: 'Install', exact: true }).click()
    checked('Actual Tampermonkey installs baseline script through normal Install UI')
    const fixture = await context.newPage()
    await fixture.goto(`${origin}/fixture`)
    await fixture.waitForLoadState('networkidle')
    await expect(fixture.locator('[data-oneweb-userscript-control]')).toHaveCount(0)
    await expect(fixture.locator('body')).not.toHaveAttribute('contenteditable')
    checked('Initial installation leaves origin and all tools disabled')
    async function menu(title) {
      const tab = await sw.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), fixture.url())
      const popup = await context.newPage()
      await fixture.bringToFront()
      await popup.goto(`chrome-extension://${id}/action.html#${tab.id}`)
      try {
        await popup.getByText(title.replace(/^OneWeb /, ''), { exact: true }).click({ timeout: 15000 })
      }
      finally {
        if (!popup.isClosed())
          await popup.close()
      }
    }
    await menu('OneWeb · 启用当前站点工具（默认全部关闭）')
    await expect(fixture.locator('[data-oneweb-userscript-control]')).toHaveCount(1)
    await menu('OneWeb · ○ 网页自由编辑')
    await expect(fixture.locator('body')).toHaveAttribute('contenteditable', 'true')
    await fixture.reload()
    await expect(fixture.locator('body')).toHaveAttribute('contenteditable', 'true')
    checked('Actual GM origin approval and tool choice persist before upgrade')
    const other = await context.newPage()
    await other.goto(`${origin.replace('127.0.0.1', 'localhost')}/other`)
    await other.waitForLoadState('networkidle')
    await expect(other.locator('[data-oneweb-userscript-control]')).toHaveCount(0)
    checked('Second origin starts and stays unapproved before upgrade')
    await admin.bringToFront()
    await admin.getByText('Installed Userscripts', { exact: true }).click()
    await admin.getByText('OneWeb', { exact: true }).waitFor()
    await admin.getByText(baselineVersion, { exact: true }).waitFor()
    phase = 'release'
    const updateStart = requests.length
    await admin.getByTitle('Check for updates', { exact: true }).click()
    await expect.poll(() => requests.slice(updateStart).some(r => r.route === '/one-web.meta.js' && r.status === 200)).toBe(true)
    await expect.poll(() => requests.slice(updateStart).some(r => r.route === '/one-web.user.js' && r.status === 200)).toBe(true)
    const releaseRequests = requests.slice(updateStart).filter(r => r.phase === 'release' && r.route.endsWith('.js'))
    expect(releaseRequests[0].route).toBe('/one-web.meta.js')
    expect(releaseRequests.findIndex(r => r.route === '/one-web.user.js')).toBeGreaterThan(0)
    checked('Genuine manager update check requests metadata before downloading release script')
    await admin.getByText(releaseVersion, { exact: true }).waitFor({ timeout: 15000 })
    await expect(admin.getByText(baselineVersion, { exact: true })).toHaveCount(0)
    await admin.screenshot({ path: path.join(base, `${label}-upgraded-dashboard.png`) })
    checked('Manager dashboard confirms version upgrade without duplicate old entry')
    await fixture.reload()
    await expect(fixture.locator('[data-oneweb-userscript-control]')).toHaveCount(1)
    await expect(fixture.locator('body')).toHaveAttribute('contenteditable', 'true')
    checked('Reload after upgrade preserves exact-origin approval and selected tool')
    await other.reload()
    await expect(other.locator('[data-oneweb-userscript-control]')).toHaveCount(0)
    await expect(other.locator('body')).not.toHaveAttribute('contenteditable')
    checked('Upgrade does not auto-enable another origin')
    phase = 'offline'
    const failStart = requests.length
    await admin.bringToFront()
    await admin.getByTitle('Check for updates', { exact: true }).click()
    await expect.poll(() => requests.slice(failStart).some(r => r.route === '/one-web.meta.js' && r.status === 503)).toBe(true)
    await expect.poll(() => requests.slice(failStart).some(r => r.route === '/one-web.user.js' && r.status === 503)).toBe(true)
    await fixture.reload()
    await expect(fixture.locator('[data-oneweb-userscript-control]')).toHaveCount(1)
    await expect(fixture.locator('body')).toHaveAttribute('contenteditable', 'true')
    await expect(admin.getByText(releaseVersion, { exact: true })).toBeVisible()
    checked('Unavailable metadata and fallback download do not corrupt installed version or persisted site/tool settings')
    await admin.screenshot({ path: path.join(base, `${label}-offline-dashboard.png`) })
    await menu('OneWeb · 停用当前站点工具')
    await expect(fixture.locator('[data-oneweb-userscript-control]')).toHaveCount(0)
    await expect(fixture.locator('body')).not.toHaveAttribute('contenteditable')
    checked('Updated script retains working immediate site disable')
    report.result = 'passed'
  }
  catch (error) {
    report.result = 'failed'
    report.failure = error.stack
    operationError = error
  }
  finally {
    // Cleanup steps are independent: a broken browser transport must not leave a server/profile.
    try {
      if (context)
        await context.close()
    }
    catch (error) {
      cleanupErrors.push(`browser close: ${error.message}`)
    }
    try {
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    catch (error) {
      cleanupErrors.push(`server close: ${error.message}`)
      server.unref()
    }
    try {
      await fs.rm(profile, { recursive: true, force: true })
      report.profileRemoved = true
    }
    catch (error) {
      cleanupErrors.push(`profile removal: ${error.message}`)
    }
    report.finishedAt = new Date().toISOString()
    if (cleanupErrors.length) {
      report.cleanupErrors = cleanupErrors
      report.result = 'failed'
    }
    await fs.writeFile(path.join(base, `${label}-report.json`), JSON.stringify(report, null, 2))
  }
  if (cleanupErrors.length)
    throw new Error(`Manager QA cleanup failed: ${cleanupErrors.join('; ')}`)
  if (operationError)
    throw operationError
})().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
