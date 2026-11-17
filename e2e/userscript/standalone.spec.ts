import type { CDPSession, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const artifact = fileURLToPath(new URL('../../artifacts/build/userscript/one-web.user.js', import.meta.url))
const host = '[data-oneweb-userscript-control]'
const approval = (origin: string) => `oneweb.userscript.v1:${origin}:approved`
const tool = (origin: string, id: string) => `oneweb.userscript.v1:${origin}:tool:${id}`
const html = '<!doctype html><html><head><title>Fixture</title></head><body><input id="password" type="password" value="synthetic-private"><p id="copy">Fixture text</p><iframe srcdoc="<input type=password>"></iframe></body></html>'

interface InstalledScript {
  session: CDPSession
  contextId: number
}

async function evaluate<Value>(script: InstalledScript, expression: string): Promise<Value> {
  const result = await script.session.send('Runtime.evaluate', {
    contextId: script.contextId,
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as Value
}

/** The only replacement is the manager boundary; the DOM behavior is the shipped IIFE. */
async function install(page: Page, values: Record<string, unknown> = {}, frameId?: string): Promise<InstalledScript> {
  const source = await readFile(artifact, 'utf8')
  const session = await page.context().newCDPSession(page)
  const frame = frameId ?? (await session.send('Page.getFrameTree')).frameTree.frame.id
  const { executionContextId: contextId } = await session.send('Page.createIsolatedWorld', {
    frameId: frame,
    worldName: 'oneweb-userscript-manager-boundary',
  })
  const script = { session, contextId }
  const manager = `(() => {
    const values = new Map(Object.entries(${JSON.stringify(values)}));
    const menus = new Map();
    const listeners = new Map();
    let sequence = 0;
    globalThis.__gmBoundary = { values, menus, listeners, failWrites: false };
    globalThis.GM_getValue = (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback;
    globalThis.GM_setValue = (key, value) => {
      if (globalThis.__gmBoundary.failWrites) throw new Error('Synthetic manager failure');
      values.set(key, structuredClone(value));
    };
    globalThis.GM_deleteValue = key => { values.delete(key); };
    globalThis.GM_registerMenuCommand = (title, action) => {
      const id = ++sequence;
      menus.set(id, { title, action });
      return id;
    };
    globalThis.GM_unregisterMenuCommand = id => { menus.delete(id); };
    globalThis.GM_addValueChangeListener = (key, callback) => {
      const id = ++sequence;
      listeners.set(id, { key, callback });
      return id;
    };
    globalThis.GM_removeValueChangeListener = id => { listeners.delete(id); };
  })();`
  await evaluate(script, `${manager}\n${source}`)
  return script
}

async function menu(script: InstalledScript, label: string) {
  await expect.poll(() => evaluate<string[]>(script, '[...__gmBoundary.menus.values()].map(menu => menu.title)'))
    .toContain(label)
  await evaluate(script, `(() => {
    const menu = [...__gmBoundary.menus.values()].find(menu => menu.title === ${JSON.stringify(label)});
    menu.action();
  })()`)
}

async function snapshot(script: InstalledScript) {
  return evaluate<Record<string, unknown>>(script, 'Object.fromEntries(__gmBoundary.values)')
}

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\/[^/]+\.example\//, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': 'default-src \'none\'; frame-src \'self\' about:; style-src \'unsafe-inline\'; script-src \'none\'' },
    body: html,
  }))
})

test('ships one offline, finite-grant userscript with no extension or legacy repository dependency', async () => {
  const source = await readFile(artifact, 'utf8')
  expect(source.startsWith('// ==UserScript==\n')).toBe(true)
  const meta = await readFile(new URL('../../artifacts/build/userscript/one-web.meta.js', import.meta.url), 'utf8')
  expect(source.slice(0, source.indexOf('// ==/UserScript==') + '// ==/UserScript==\n'.length)).toBe(meta)
  expect(meta.trimEnd().endsWith('// ==/UserScript==')).toBe(true)
  expect(source).toContain('MIT License')
  expect(source).toContain('// @name         OneWeb')
  expect(source).toContain('// @downloadURL  https://github.com/JuckZ/one-web/releases/latest/download/one-web.user.js')
  expect(source).toContain('// @updateURL    https://github.com/JuckZ/one-web/releases/latest/download/one-web.meta.js')
  expect(source).toContain('// @sandbox      DOM')
  expect(source).toContain('// @noframes')
  expect(source).toContain('// @run-at       document-idle')
  expect(source).toContain('// @match        http://*/*')
  expect(source).toContain('// @match        https://*/*')
  expect([...source.matchAll(/^\/\/ @grant\s+(\S+)/gm)].map(match => match[1]).sort()).toEqual([
    'GM_addValueChangeListener',
    'GM_deleteValue',
    'GM_getValue',
    'GM_registerMenuCommand',
    'GM_removeValueChangeListener',
    'GM_setValue',
    'GM_unregisterMenuCommand',
  ].sort())
  expect(source).not.toMatch(/\b(?:chrome|browser)\.(?:runtime|storage|tabs|scripting|permissions)\b/)
  expect(source).not.toMatch(/\b(?:eval|fetch)\s*\(|new Function\b|^import\s|^export\s|\/\/ @(?:require|connect|resource)\b/m)
  expect(source).not.toContain('one-tampermonkey')
})

test('runs the shipped script in a real isolated world, persists per origin and restores owned DOM', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('https://alpha.example/page?private=discarded')
  let script = await install(page)
  await expect(page.locator(host)).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
  await menu(script, 'OneWeb · 启用当前站点工具（默认全部关闭）')
  await expect(page.locator(host)).toHaveCount(1)
  expect(await page.locator(host).evaluate(element => element.shadowRoot)).toBeNull()
  await expect(page.locator(host)).toHaveCSS('font-family', /system-ui/)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator(host)).toHaveCSS('color', 'rgb(244, 243, 255)')
  await page.emulateMedia({ colorScheme: 'light' })
  await menu(script, 'OneWeb · ○ 网页自由编辑')
  await expect(page.locator('body')).toHaveAttribute('contenteditable', 'true')
  await menu(script, 'OneWeb · ○ 密码可见性')
  await page.locator('#password').dblclick()
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  await page.evaluate(() => {
    document.body.addEventListener('copy', event => event.preventDefault())
  })
  expect(await page.locator('#copy').evaluate(element => !element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true })))).toBe(true)
  await menu(script, 'OneWeb · ○ 解除选择与复制限制')
  expect(await page.locator('#copy').evaluate(element => !element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true })))).toBe(false)
  const stored = await snapshot(script)
  expect(stored[approval('https://alpha.example')]).toBe(true)
  expect(stored[tool('https://alpha.example', 'free-page-edit')]).toBe(true)
  expect(JSON.stringify(stored)).not.toMatch(/synthetic-private|private=discarded/)
  expect(await page.evaluate('typeof GM_getValue')).toBe('undefined')
  expect(await page.evaluate('typeof __gmBoundary')).toBe('undefined')

  await page.reload()
  script = await install(page, stored)
  await expect(page.locator('body')).toHaveAttribute('contenteditable', 'true')
  await expect(page.locator(host)).toHaveCount(1)
  await page.locator('#password').dblclick()
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  await menu(script, 'OneWeb · 停用当前站点工具')
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
  await expect(page.locator('#password')).toHaveAttribute('type', 'password')
  await expect(page.locator(host)).toHaveCount(0)
  expect((await snapshot(script))[tool('https://alpha.example', 'free-page-edit')]).toBe(true)

  await page.goto('https://beta.example/page')
  script = await install(page, stored)
  await expect(page.locator(host)).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
  expect(requests.every(url => url.startsWith('https://alpha.example/') || url.startsWith('https://beta.example/'))).toBe(true)
})

test('uses keyboard-accessible controls and fails closed on manager errors, remote revoke and BFCache restore', async ({ page }) => {
  await page.goto('https://alpha.example/page')
  const script = await install(page, { [approval('https://alpha.example')]: true })
  await expect(page.locator(host)).toHaveCount(1)
  await menu(script, 'OneWeb · 打开当前站点工具')
  // The root stays closed. Native keyboard events operate its actual focused checkbox.
  await page.keyboard.press('Space')
  await page.locator('#password').dblclick()
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  await evaluate(script, '__gmBoundary.failWrites = true')
  await menu(script, 'OneWeb · ○ 网页自由编辑')
  await expect(page.locator(host)).toHaveCount(0)
  await expect(page.locator('#password')).toHaveAttribute('type', 'password')
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
  await evaluate(script, '__gmBoundary.failWrites = false')
  await menu(script, 'OneWeb · 启用当前站点工具（默认全部关闭）')
  await expect(page.locator(host)).toHaveCount(1)
  await menu(script, 'OneWeb · ○ 网页自由编辑')
  await expect(page.locator('body')).toHaveAttribute('contenteditable', 'true')
  await evaluate(script, `(() => {
    const key = ${JSON.stringify(approval('https://alpha.example'))};
    __gmBoundary.values.set(key, false);
    for (const listener of __gmBoundary.listeners.values())
      if (listener.key === key) listener.callback(key, true, false, true);
  })()`)
  await expect(page.locator(host)).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
  await menu(script, 'OneWeb · 启用当前站点工具（默认全部关闭）')
  await expect(page.locator('body')).toHaveAttribute('contenteditable', 'true')
  await evaluate(script, 'window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))')
  await expect(page.locator(host)).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
  expect(await evaluate(script, '__gmBoundary.listeners.size')).toBe(0)
  await evaluate(script, 'window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))')
  await expect(page.locator(host)).toHaveCount(1)
  await expect(page.locator('body')).toHaveAttribute('contenteditable', 'true')
  await menu(script, 'OneWeb · 忘记当前站点设置')
  await expect(page.locator(host)).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
  expect(await snapshot(script)).toEqual({})
})

test('does not start in child frames even if a manager incorrectly injects it there', async ({ page }) => {
  await page.goto('https://alpha.example/page')
  const session = await page.context().newCDPSession(page)
  const frameTree = await session.send('Page.getFrameTree')
  const child = frameTree.frameTree.childFrames?.[0]
  expect(child).toBeDefined()
  const script = await install(page, { [approval('https://alpha.example')]: true }, child!.frame.id)
  expect(await evaluate(script, '__gmBoundary.menus.size')).toBe(0)
  expect(await evaluate(script, '__gmBoundary.listeners.size')).toBe(0)
  expect(await evaluate(script, 'document.querySelector("[data-oneweb-userscript-control]")')).toBeNull()
})

test('starts on ordinary insecure HTTP and ignores duplicate entry execution', async ({ page }) => {
  await page.goto('http://plain.example/page')
  expect(await page.evaluate('window.isSecureContext')).toBe(false)
  const script = await install(page, {
    [approval('http://plain.example')]: true,
    [tool('http://plain.example', 'free-page-edit')]: true,
  })
  await expect(page.locator(host)).toHaveCount(1)
  await expect(page.locator('body')).toHaveAttribute('contenteditable', 'true')
  const menusBefore = await evaluate<number>(script, '__gmBoundary.menus.size')
  const source = await readFile(artifact, 'utf8')
  await evaluate(script, source)
  expect(await evaluate(script, '__gmBoundary.menus.size')).toBe(menusBefore)
  await expect(page.locator(host)).toHaveCount(1)
  await menu(script, 'OneWeb · 停用当前站点工具')
  await expect(page.locator(host)).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('contenteditable')
})

test('shares all four new tools in the shipped script and sends a search only on explicit link activation', async ({ page, context }) => {
  const searches: string[] = []
  await context.route('https://www.npmjs.com/**', (route) => {
    searches.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: '<title>Synthetic search destination</title>' })
  })
  await page.goto('https://alpha.example/additional')
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.evaluate(() => {
    document.body.innerHTML = '<button id="a" style="position:absolute;left:420px;top:160px;width:100px;height:80px">A</button><button id="b" style="position:absolute;left:620px;top:320px;width:120px;height:60px">B</button><div id="hidden" hidden>Loaded synthetic note</div><input id="credential" type="hidden" value="not-read"><p id="query">fixture &amp; query</p>'
  })
  const script = await install(page, { [approval('https://alpha.example')]: true })
  await menu(script, 'OneWeb · ○ 显示已加载隐藏内容')
  await expect(page.locator('#hidden')).toBeVisible()
  await expect(page.locator('#credential')).toHaveAttribute('type', 'hidden')
  await menu(script, 'OneWeb · ○ 阅读遮光')
  const dimmer = page.locator('[data-oneweb-page-toolbox-widget="night-reading"]')
  await expect(dimmer).toHaveCSS('pointer-events', 'none')
  await expect(dimmer).toHaveCSS('background-color', 'rgba(8, 12, 20, 0.12)')
  await menu(script, 'OneWeb · ○ 元素间距')
  await page.locator('#a').click({ modifiers: ['Alt'] })
  await page.locator('#b').click({ modifiers: ['Alt'] })
  const accessibleText = async () => (await script.session.send('Accessibility.getFullAXTree')).nodes.map(node => node.name?.value ?? '').join('\n')
  await expect.poll(accessibleText).toContain('水平间距：100 px；垂直间距：80 px')
  await page.locator('#b').evaluate(element => element.style.left = '650px')
  await expect.poll(accessibleText).toContain('水平间距：130 px')
  await page.locator('#a').evaluate(async (element) => {
    await element.animate([{ width: '100px' }, { width: '160px' }], { duration: 30, fill: 'forwards' }).finished
  })
  await expect.poll(accessibleText).toContain('水平间距：70 px')
  await page.keyboard.press('Escape')
  await expect.poll(accessibleText).toContain('尚未选择元素。')
  await menu(script, 'OneWeb · ○ 选文搜索')
  await page.locator('#query').evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await expect.poll(accessibleText).toContain('已就绪：fixture & query')
  expect(searches).toEqual([])
  expect(JSON.stringify(await snapshot(script))).not.toContain('fixture & query')
  // CDP observes closed roots for testing; no product debug hook exposes their nodes to page code.
  const { root } = await script.session.send('DOM.getDocument', { depth: -1, pierce: true })
  interface DomNode { nodeId: number, nodeName: string, attributes?: string[], children?: DomNode[], shadowRoots?: DomNode[] }
  const findLink = (node: DomNode): DomNode | undefined => {
    if (node.nodeName === 'A' && node.attributes?.includes('https://www.npmjs.com/search?q=fixture+%26+query'))
      return node
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
      const match = findLink(child)
      if (match)
        return match
    }
  }
  const link = findLink(root)
  expect(link).toBeDefined()
  expect(link!.attributes).toContain('no-referrer')
  expect(link!.attributes).toContain('noopener noreferrer')
  const { model } = await script.session.send('DOM.getBoxModel', { nodeId: link!.nodeId })
  const popupPromise = context.waitForEvent('page')
  await page.mouse.click((model.content[0] + model.content[2]) / 2, (model.content[1] + model.content[5]) / 2)
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  expect(searches).toHaveLength(1)
  expect(new URL(searches[0]).searchParams.get('q')).toBe('fixture & query')
  await popup.close()
  await menu(script, 'OneWeb · 停用当前站点工具')
  await expect(page.locator('[data-oneweb-page-toolbox-widget]')).toHaveCount(0)
  await expect(page.locator('#hidden')).toBeHidden()
  expect(await page.locator('#credential').getAttribute('value')).toBe('not-read')
  await page.screenshot({ path: 'artifacts/test-results/userscript/seven-tools-restored.png' })
})
