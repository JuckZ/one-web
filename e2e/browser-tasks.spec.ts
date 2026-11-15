import type { CDPSession } from '@playwright/test'
/* eslint no-template-curly-in-string: off -- Browser prompt templates use literal placeholders. */
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createServer } from 'node:http'
import { test as base, expect } from './fixtures'

const test = base.extend<{ screenshotAccess: boolean, tasksFixture: { origin: string, requests: Array<Record<string, unknown>> } }>({
  screenshotAccess: [false, { option: true }],
  // eslint-disable-next-line no-empty-pattern
  tasksFixture: async ({}, use) => {
    const requests: Array<Record<string, unknown>> = []
    const server = createServer(async (request, response) => {
      if (request.url === '/v1/chat/completions') {
        let text = ''
        for await (const chunk of request) text += chunk
        const body = JSON.parse(text)
        requests.push(body)
        let content = 'Browser task answer'
        if (Array.isArray(body.messages.at(-1)?.content)) {
          content = JSON.stringify({ text: 'Captured pixels text', translation: '截图文字', answer: 'A colored browser image' })
        }
        else if (body.messages[0]?.content.includes('Preserve every ID exactly once')) {
          const blocks = JSON.parse(body.messages.at(-1).content).blocks
          content = JSON.stringify({ translations: blocks.map((block: { id: string, text: string }) => ({ id: block.id, text: `译文 ${block.text}` })) })
        }
        else if (JSON.stringify(body).includes('Known video words')) {
          content = 'Video answer [cue-1]'
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }] }))
        return
      }
      if (request.url === '/movie.webm') {
        const bytes = fs.readFileSync('e2e/assets/dubbing.webm')
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
        if (range) {
          const start = Number(range[1])
          const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
          response.writeHead(206, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }).end(bytes.subarray(start, end + 1))
        }
        else {
          response.writeHead(200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' }).end(bytes)
        }
        return
      }
      if (request.url === '/captions.vtt') {
        response.writeHead(200, { 'Content-Type': 'text/vtt' }).end('WEBVTT\n\n1\n00:00:05.000 --> 00:00:08.000\nKnown video words\n')
        return
      }
      if (request.url === '/image.svg') {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#b52c28"/><text x="12" y="55" fill="#fff" font-size="20">IMAGE</text></svg>')
        return
      }
      const video = request.url === '/video' ? '<video controls preload="auto" src="/movie.webm" width="320" height="180"><track default kind="subtitles" label="English" srclang="en" src="/captions.vtt"></video>' : ''
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>Browser tasks</title><main><p>First known article paragraph.</p><p>Second known article paragraph.</p><a href="/target">Target article</a></main><textarea aria-label="Comment">Original comment</textarea><div contenteditable="true" role="textbox" aria-label="Editable reply">Original editable</div><img alt="Test picture" src="/image.svg" style="display:block;width:160px;height:100px">${video}`)
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
  // Only disposable screenshot profiles pregrant capture permission; shipped manifest keeps activeTab.
  extraHostOrigins: async ({ tasksFixture, screenshotAccess }, use) => {
    await use([`${tasksFixture.origin}/*`, ...(screenshotAccess ? ['<all_urls>'] : [])])
  },
})

async function openTaskPage(context: import('@playwright/test').BrowserContext, extensionId: string, origin: string, path = '/article') {
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/dist/sidebar/index.html`)
  await panel.locator('[data-destination="settings"]').click()
  await panel.getByRole('textbox', { name: '服务地址', exact: true }).fill(`${origin}/v1/`)
  await panel.getByRole('textbox', { name: '模型（每行一个）', exact: true }).fill('fixture-model')
  await panel.getByLabel('API key', { exact: true }).fill('synthetic-key')
  await panel.getByTestId('assistant-save-provider').click()
  const site = await context.newPage()
  await site.goto(`${origin}${path}`)
  await panel.evaluate(() => (document.querySelector('[data-destination="settings"]') as HTMLButtonElement).click())
  await expect(panel.getByTestId('assistant-enable-site')).toBeVisible()
  await panel.getByTestId('assistant-enable-site').evaluate((button: HTMLButtonElement) => button.click())
  await expect(site.locator('[data-oneweb-assistant]')).toBeVisible()
  return { panel, site }
}

async function stopExtensionWorker(session: CDPSession, extensionId: string) {
  interface Version { versionId: string, scriptURL: string, runningStatus: string }
  const versions = new Map<string, Version>()
  let stoppingVersion: string | undefined
  let stopped = false
  const changed = (event: { versions: Version[] }) => {
    for (const version of event.versions) {
      versions.set(version.versionId, version)
      if (version.versionId === stoppingVersion && version.runningStatus === 'stopped')
        stopped = true
    }
  }
  session.on('ServiceWorker.workerVersionUpdated', changed)
  try {
    await session.send('ServiceWorker.enable')
    const running = () => [...versions.values()].find(version =>
      version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && version.runningStatus === 'running')
    await expect.poll(() => running()?.versionId).toBeTruthy()
    stoppingVersion = running()!.versionId
    await session.send('ServiceWorker.stopWorker', { versionId: stoppingVersion })
    await expect.poll(() => stopped).toBe(true)
  }
  finally {
    session.off('ServiceWorker.workerVersionUpdated', changed)
    await session.send('ServiceWorker.disable')
  }
}

test('page toolbox creates and runs a scoped action and preserves favorite, recent and toolbar settings', async ({ context, extensionId, tasksFixture }) => {
  const { site } = await openTaskPage(context, extensionId, tasksFixture.origin)
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await expect(site.getByRole('button', { name: '网页智能工具箱', exact: true })).toBeVisible({ timeout: 4000 })
  await site.getByRole('button', { name: '网页智能工具箱', exact: true }).click()
  const tools = site.getByRole('dialog', { name: '网页智能工具箱', exact: true })
  await tools.getByLabel('动作名称', { exact: true }).fill('提取论点')
  await tools.getByLabel('动作模板', { exact: true }).fill('初稿：${text}')
  await tools.getByLabel('动作范围', { exact: true }).selectOption('page')
  await tools.getByRole('button', { name: '保存动作', exact: true }).click()
  await tools.getByRole('button', { name: '编辑动作 提取论点', exact: true }).click()
  await tools.getByLabel('动作模板', { exact: true }).fill('列出这页的论点：${text}')
  await tools.getByRole('button', { name: '保存动作', exact: true }).click()
  await tools.getByRole('searchbox', { name: '搜索网页工具', exact: true }).fill('论点')
  await tools.getByRole('button', { name: '收藏 提取论点', exact: true }).click()
  await tools.getByRole('button', { name: '执行 提取论点', exact: true }).click()
  await expect(site.getByRole('status', { name: '选文结果', exact: true })).toContainText('Browser task answer')
  expect(JSON.stringify(tasksFixture.requests)).toContain('列出这页的论点')
  expect(JSON.stringify(tasksFixture.requests)).toContain('First known article paragraph')
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: '网页智能工具箱', exact: true }).click()
  await tools.getByLabel('工具条展示', { exact: true }).selectOption('shortcut')
  await site.reload()
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: '网页智能工具箱', exact: true }).click()
  await expect(tools.getByLabel('工具条展示', { exact: true })).toHaveValue('shortcut')
  await tools.getByRole('searchbox', { name: '搜索网页工具', exact: true }).fill('论点')
  await expect(tools.getByRole('button', { name: '取消收藏 提取论点', exact: true })).toBeVisible()
  await expect(tools).toContainText('最近使用')
})

test('local clippings preserve a quote and editable note, revisit after reload and expose ambiguous text', async ({ context, extensionId, tasksFixture }) => {
  const { site } = await openTaskPage(context, extensionId, tasksFixture.origin)
  await site.locator('main > p').first().selectText()
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: '本机剪藏', exact: true }).click()
  const panel = site.getByRole('dialog', { name: '本机剪藏', exact: true })
  await panel.getByLabel('新剪藏笔记', { exact: true }).fill('A local note')
  await panel.getByRole('button', { name: '保存当前选文', exact: true }).click()
  await expect(panel.locator('blockquote')).toHaveText('First known article paragraph.')
  await panel.getByLabel('笔记 Browser tasks', { exact: true }).fill('Edited local note')
  await panel.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('笔记已保存')
  await site.reload()
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: '本机剪藏', exact: true }).click()
  await expect(panel.getByLabel('笔记 Browser tasks', { exact: true })).toHaveValue('Edited local note')
  await panel.getByRole('button', { name: '回到原文', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('已定位并高亮')
  expect(await site.evaluate(() => document.getSelection()?.toString())).toBe('First known article paragraph.')
  await site.locator('main').evaluate((main) => {
    main.after(main.cloneNode(true))
  })
  await panel.getByRole('button', { name: '回到原文', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('无法唯一定位')
  await panel.getByRole('button', { name: '删除剪藏', exact: true }).click()
  await expect(panel.locator('blockquote')).toHaveCount(0)
})

test('current video reads native captions and seeks a cited time without starting dubbing', async ({ context, extensionId, tasksFixture }) => {
  const { site } = await openTaskPage(context, extensionId, tasksFixture.origin, '/video')
  await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.duration)).toBeGreaterThan(10)
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: '当前视频阅读', exact: true }).click()
  const panel = site.getByRole('dialog', { name: '当前视频阅读', exact: true })
  await panel.getByRole('button', { name: '读取字幕', exact: true }).click()
  await expect(panel.getByRole('button', { name: '00:05 Known video words', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '总结当前视频', exact: true }).click()
  await expect(panel.getByRole('status', { name: '视频回答', exact: true })).toContainText('Video answer')
  await panel.getByRole('button', { name: '00:05 ↗', exact: true }).click()
  await expect.poll(() => site.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(5)
  expect(JSON.stringify(tasksFixture.requests)).toContain('Known video words')
  await expect(site.locator('[data-oneweb-dubbing]')).toHaveCount(0)
})

test.describe('visible image capture', () => {
  test.use({ screenshotAccess: true })
  test('previews real cropped pixels before sending multimodal OCR, translation and image questions', async ({ context, extensionId, tasksFixture }, testInfo) => {
    const { site, panel: workspace } = await openTaskPage(context, extensionId, tasksFixture.origin)
    await workspace.locator('[data-destination="settings"]').evaluate((button: HTMLButtonElement) => button.click())
    await workspace.getByLabel('识图服务地址', { exact: true }).fill(`${tasksFixture.origin}/v1/`)
    await workspace.getByLabel('识图模型', { exact: true }).fill('vision-fixture')
    await workspace.getByLabel('识图 API key', { exact: true }).fill('vision-key')
    await workspace.getByTestId('vision-save-provider').click()
    await expect(workspace.getByTestId('assistant-status')).toContainText('识图服务已保存')
    await site.bringToFront()
    await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
    await site.getByRole('button', { name: '截图与图片识别', exact: true }).click()
    const panel = site.getByRole('dialog', { name: '截图与图片识别', exact: true })
    await panel.getByRole('button', { name: '选择当前页图片', exact: true }).click()
    await panel.getByRole('button', { name: '识别图片 Test picture', exact: true }).click()
    await expect(panel.getByRole('img', { name: '所选图像预览', exact: true })).toBeVisible()
    expect(tasksFixture.requests).toHaveLength(0)
    await expect(panel.getByRole('status')).toContainText('160 × 100')
    expect(await panel.getByRole('img', { name: '所选图像预览', exact: true }).evaluate(async (image: HTMLImageElement) => {
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      return Array.from(context.getImageData(4, 4, 1, 1).data)
    })).toEqual([181, 44, 40, 255])
    await site.screenshot({ path: testInfo.outputPath('vision-preview.png') })
    await panel.getByRole('button', { name: '确认发送图像', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('Captured pixels text')
    const parts = (tasksFixture.requests[0].messages as Array<{ content: Array<{ type: string, image_url?: { url: string } }> }>).at(-1)!.content
    const image = parts.find(part => part.type === 'image_url')!.image_url!.url
    const bytes = Buffer.from(image.split(',')[1], 'base64')
    expect(bytes.readUInt32BE(16)).toBe(160)
    expect(bytes.readUInt32BE(20)).toBe(100)
    await panel.getByLabel('图像任务', { exact: true }).selectOption('translate')
    await panel.getByRole('button', { name: '确认发送图像', exact: true }).click()
    await expect.poll(() => tasksFixture.requests.length).toBe(2)
    await expect(panel.getByRole('status')).toContainText('截图文字')
    await panel.getByLabel('图像任务', { exact: true }).selectOption('ask')
    await panel.getByLabel('图片问题', { exact: true }).fill('What color?')
    await panel.getByRole('button', { name: '确认发送图像', exact: true }).click()
    await expect.poll(() => tasksFixture.requests.length).toBe(3)
    await expect(panel.getByRole('status')).toContainText('A colored browser image')
    await panel.getByRole('button', { name: '取消并清除图像', exact: true }).click()
    await expect(panel.getByRole('img', { name: '所选图像预览', exact: true })).toBeHidden()
    await panel.getByRole('button', { name: '拖选截图区域', exact: true }).click()
    await site.mouse.move(12, 12)
    await site.mouse.down()
    await site.mouse.move(112, 62)
    await site.mouse.up()
    await expect(panel.getByRole('status')).toContainText('100 × 50')
  })
})

test('capture permission failure gives a visible toolbar activation instruction without sending pixels', async ({ context, extensionId, tasksFixture }) => {
  const { site } = await openTaskPage(context, extensionId, tasksFixture.origin)
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: '截图与图片识别', exact: true }).click()
  const panel = site.getByRole('dialog', { name: '截图与图片识别', exact: true })
  await panel.getByRole('button', { name: '选择当前页图片', exact: true }).click()
  await panel.getByRole('button', { name: '识别图片 Test picture', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('请先从浏览器工具栏激活 OneWeb')
  await expect(panel.getByRole('img', { name: '所选图像预览', exact: true })).toBeHidden()
  expect(tasksFixture.requests).toHaveLength(0)
})

test('editor assistant drafts at a caret and previews replies before explicit native and contenteditable writes', async ({ context, extensionId, tasksFixture }) => {
  const { site } = await openTaskPage(context, extensionId, tasksFixture.origin)
  const editor = site.getByRole('textbox', { name: 'Comment', exact: true })
  await editor.focus()
  await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(8, 8))
  await expect(site.getByRole('button', { name: '在输入框撰写', exact: true })).toBeVisible({ timeout: 4000 })
  await site.getByRole('button', { name: '在输入框撰写', exact: true }).click()
  const writing = site.getByRole('dialog', { name: '输入框写作', exact: true })
  await writing.getByLabel('撰写或回复要求', { exact: true }).fill('写一句问候')
  await writing.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(site.getByRole('status', { name: '选文结果', exact: true })).toContainText('Browser task answer')
  await expect(editor).toHaveValue('Original comment')
  await site.getByRole('button', { name: '插入到光标处', exact: true }).click()
  await expect(editor).toHaveValue('OriginalBrowser task answer comment')
  const editable = site.getByRole('textbox', { name: 'Editable reply', exact: true })
  await editable.selectText()
  await site.getByRole('button', { name: '更多选文操作', exact: true }).click()
  await site.getByRole('button', { name: '在输入框回复', exact: true }).click()
  await writing.getByLabel('撰写或回复要求', { exact: true }).fill('根据网页礼貌回复')
  await writing.getByLabel('附加当前页面作为回复上下文', { exact: true }).check()
  await writing.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(site.getByRole('button', { name: '替换原选文', exact: true })).toBeVisible()
  await expect(editable).toHaveText('Original editable')
  await site.getByRole('button', { name: '替换原选文', exact: true }).click()
  await expect(editable).toHaveText('Browser task answer')
  expect(tasksFixture.requests).toHaveLength(2)
  expect(JSON.stringify(tasksFixture.requests[1])).toContain('First known article paragraph')
})

test('site translation handles live paragraphs, display preferences, stop, restore and the next visit', async ({ context, extensionId, tasksFixture }) => {
  const { site } = await openTaskPage(context, extensionId, tasksFixture.origin)
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: '网页翻译', exact: true }).click()
  const panel = site.getByRole('dialog', { name: '网页翻译', exact: true })
  await panel.getByLabel('此站点自动翻译', { exact: true }).check()
  await panel.getByLabel('译文显示', { exact: true }).selectOption('translation')
  await panel.getByLabel('译文字号', { exact: true }).selectOption('19')
  await panel.getByRole('button', { name: '开始网页翻译', exact: true }).click()
  await expect(site.locator('span[data-oneweb-translation]')).toHaveCount(2)
  await expect(site.locator('main > p').first()).toBeHidden()
  await site.locator('main').evaluate((main) => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Dynamic paragraph.'
    main.append(paragraph)
  })
  await expect(site.locator('span[data-oneweb-translation]')).toHaveCount(3)
  const devtools = await context.newCDPSession(site)
  await stopExtensionWorker(devtools, extensionId)
  await site.locator('main').evaluate((main) => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'After background restart.'
    main.append(paragraph)
  })
  await expect(site.locator('span[data-oneweb-translation]')).toHaveCount(4)
  expect(tasksFixture.requests).toHaveLength(3)
  await panel.getByRole('button', { name: '停止网页翻译', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('已停止')
  const count = tasksFixture.requests.length
  await stopExtensionWorker(devtools, extensionId)
  await site.locator('main').evaluate((main) => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'After stop paragraph.'
    main.append(paragraph)
  })
  await panel.getByRole('button', { name: '恢复网页原文', exact: true }).click()
  await expect(site.locator('[data-oneweb-translation]')).toHaveCount(0)
  await expect(site.locator('main')).toContainText('After stop paragraph.')
  expect(tasksFixture.requests).toHaveLength(count)
  await site.reload()
  await expect(site.locator('span[data-oneweb-translation]')).toHaveCount(2)
  await devtools.detach()
})

test('Quick Ask accepts keyboard questions, explicit context, follow-ups and page link search', async ({ context, extensionId, tasksFixture }) => {
  const { site } = await openTaskPage(context, extensionId, tasksFixture.origin)
  await site.getByRole('button', { name: '打开 OneWeb', exact: true }).click()
  await site.getByRole('button', { name: 'Quick Ask', exact: true }).click()
  const panel = site.getByRole('dialog', { name: 'Quick Ask', exact: true })
  await panel.getByLabel('提问内容', { exact: true }).fill('你好')
  await panel.getByLabel('提问内容', { exact: true }).press('Enter')
  await expect(panel.getByRole('status')).toContainText('Browser task answer')
  expect(JSON.stringify(tasksFixture.requests[0])).not.toContain('First known article')
  await panel.getByLabel('本轮附加上下文', { exact: true }).selectOption('page')
  await panel.getByLabel('提问内容', { exact: true }).fill('根据本页继续解释')
  await panel.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect.poll(() => tasksFixture.requests.length).toBe(2)
  expect(JSON.stringify(tasksFixture.requests[1])).toContain('First known article')
  expect(JSON.stringify(tasksFixture.requests[1])).toContain('你好')
  await panel.getByLabel('查找网页或输入网址', { exact: true }).fill('Target')
  await panel.getByRole('button', { name: '查找当前页链接', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Target article', exact: true })).toBeVisible()
  await panel.getByLabel('提问内容', { exact: true }).press('Escape')
  await expect(panel).toBeHidden()
})
