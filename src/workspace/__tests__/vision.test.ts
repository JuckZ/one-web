import { VisionController } from '../vision'

it('captures the visible source and uses an independent multimodal HTTP contract with redacted session credentials', async () => {
  const local: Record<string, unknown> = {}
  const session: Record<string, unknown> = {}
  const store = (data: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
    set: async (value: Record<string, unknown>) => {
      Object.assign(data, structuredClone(value))
    },
  })
  const sent: Array<Record<string, unknown>> = []
  const pixels = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII='
  const options = {
    storage: store(local),
    secrets: store(session),
    permissions: { contains: async () => true },
    tabs: {
      query: async () => [{ id: 1, windowId: 9, url: 'https://example.org/image' }],
      captureVisibleTab: async (windowId: number) => {
        expect(windowId).toBe(9)
        return pixels
      },
    },
    injection: { connect: async () => ({ documentId: 'native-image', request: async () => ({ width: 100, height: 60, dpr: 1, scrollX: 0, scrollY: 0, visible: true }) }) },
    images: { crop: async () => ({ dataUrl: pixels, width: 40, height: 20 }) },
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' })
      const body = JSON.parse(init!.body as string)
      sent.push(body)
      expect(body.messages.at(-1).content).toContainEqual({ type: 'image_url', image_url: { url: pixels } })
      return new Response('{"choices":[{"message":{"content":"{\\"text\\":\\"真实图片文字\\",\\"translation\\":\\"Image text\\",\\"answer\\":\\"A sample\\"}"}}]}', { headers: { 'Content-Type': 'application/json' } })
    },
  }
  const controller = new VisionController(options)
  const config = await controller.configure({ baseUrl: 'https://vision.example/v1/', model: 'vision-model', key: 'vision-secret', remember: false })
  expect(config).toEqual({ baseUrl: 'https://vision.example/v1/', model: 'vision-model', remember: false, keyConfigured: true })
  expect(JSON.stringify(local)).not.toContain('vision-secret')
  const preview = await controller.capture('page', { kind: 'region', rect: { x: 10, y: 10, width: 40, height: 20 } })
  expect(preview).toMatchObject({ width: 40, height: 20, preview: pixels })
  await controller.start('page', { token: preview.token, task: 'ocr', language: 'en', question: '' })
  await vi.waitFor(() => expect(controller.poll('page')).toMatchObject({ status: 'completed', result: { text: '真实图片文字' } }))
  expect(sent).toHaveLength(1)
  expect(JSON.stringify(local)).not.toContain('data:image')
  await expect(controller.capture('page', { kind: 'region', rect: { x: 95, y: 0, width: 20, height: 20 } })).rejects.toThrow('可见区域')
  await expect(controller.start('other-owner', { token: preview.token, task: 'ocr', language: 'en', question: '' })).rejects.toThrow('图像')
  controller.invalidate(1)
  await expect(controller.start('page', { token: preview.token, task: 'ocr', language: 'en', question: '' })).rejects.toThrow('图像')
  expect(await new VisionController(options).readConfiguration()).toMatchObject({ keyConfigured: true })
})

it('discards a capture cancelled during browser pixel collection even when the original page is visible again', async () => {
  const storage = { get: async () => ({}), set: async () => {} }
  let release: (_value: string) => void = () => {}
  let collecting = false
  const controller = new VisionController({
    storage,
    secrets: storage,
    permissions: { contains: async () => true },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, url: 'https://example.org/' }],
      captureVisibleTab: async () => {
        collecting = true
        return new Promise<string>((resolve) => {
          release = resolve
        })
      },
    },
    injection: { connect: async () => ({ documentId: 'doc', request: async () => ({ width: 100, height: 100, dpr: 1, scrollX: 0, scrollY: 0, visible: true }) }) },
    images: { crop: async () => ({ dataUrl: 'data:image/png;base64,cGl4ZWxz', width: 10, height: 10 }) },
  })
  const pending = controller.capture('page', { kind: 'region', rect: { x: 0, y: 0, width: 10, height: 10 } })
  const rejected = expect(pending).rejects.toThrow('取消')
  await vi.waitFor(() => expect(collecting).toBe(true))
  controller.invalidate(1)
  release('pixels')
  await rejected
})

it('shows invalid model responses and permission failures, and cancels an in-flight image request without retrying', async () => {
  const data: Record<string, unknown> = {}
  const storage = { get: async (key: string) => ({ [key]: data[key] }), set: async (items: Record<string, unknown>) => {
    Object.assign(data, items)
  } }
  let grant = true
  let mode = 'invalid'
  let aborted = 0
  let calls = 0
  let documentId = 'doc'
  const controller = new VisionController({
    storage,
    secrets: storage,
    permissions: { contains: async () => grant },
    tabs: { query: async () => [{ id: 1, windowId: 1, url: 'https://example.org/' }], captureVisibleTab: async () => 'pixels' },
    injection: { connect: async () => ({ documentId, request: async () => ({ width: 100, height: 100, dpr: 1, scrollX: 0, scrollY: 0, visible: true }) }) },
    images: { crop: async () => ({ dataUrl: 'data:image/png;base64,cGl4ZWxz', width: 10, height: 10 }) },
    fetch: async (_url, init) => {
      calls++
      if (mode === 'hold') {
        await new Promise<void>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => {
            aborted++
            reject(new DOMException('Stopped', 'AbortError'))
          }, { once: true })
        })
      }
      return new Response('{"choices":[{"message":{"content":"not an image JSON result"}}]}', { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const preview = await controller.capture('page', { kind: 'region', rect: { x: 0, y: 0, width: 10, height: 10 } })
  await expect(controller.start('page', { token: preview.token, task: 'ocr', language: 'en', question: '' })).rejects.toThrow('独立的识图模型')
  await controller.configure({ baseUrl: 'https://vision.example/v1/', model: 'vision', key: 'key', remember: false })
  const fresh = await controller.capture('page', { kind: 'region', rect: { x: 0, y: 0, width: 10, height: 10 } })
  const input = { token: fresh.token, task: 'ocr', language: 'en', question: '' }
  await controller.start('page', input)
  await vi.waitFor(() => expect(controller.poll('page')).toMatchObject({ status: 'failed', error: expect.stringContaining('JSON') }))
  mode = 'hold'
  await controller.start('page', input)
  await vi.waitFor(() => expect(calls).toBe(2))
  controller.cancel('page')
  await vi.waitFor(() => expect(aborted).toBe(1))
  expect(controller.poll('page')).toEqual({ status: 'cancelled' })
  expect(calls).toBe(2)
  documentId = 'next-doc'
  await expect(controller.start('page', input)).rejects.toThrow('来源')
  grant = false
  await expect(controller.capture('page', { kind: 'region', rect: { x: 0, y: 0, width: 10, height: 10 } })).rejects.toThrow('授权')
})
