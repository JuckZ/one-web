import { PageContentRuntime } from '~/assistantContent/runtime'
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { createDubbingInjection } from '~/modules/builtin/video-dubbing/injection'
import { PageContextController } from '../page-context'
import { VideoReadingController } from '../video-reading'

it('reads current-video captions independently, answers with time cues and rejects seeking after a source or document switch', async () => {
  document.body.innerHTML = '<video src="https://example.org/movie.mp4"></video>'
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'duration', { configurable: true, value: 60 })
  let href = 'https://example.org/watch'
  let nativeDocument = 'native-doc'
  const data: Record<string, unknown> = {}
  const storage = { get: async (key: string) => ({ [key]: data[key] }), set: async (value: Record<string, unknown>) => {
    Object.assign(data, value)
  } }
  const runtime = new PageContentRuntime(document)
  const permissions = { contains: async () => true }
  const page = new PageContextController({
    tabs: { query: async () => [{ id: 1, url: href }] },
    permissions,
    injection: { connect: async () => ({ documentId: nativeDocument, request: message => runtime.handle(message) }) },
  })
  const assistant = new AssistantController({
    storage,
    secrets: storage,
    permissions,
    fetch: async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      expect(JSON.stringify(body)).toContain('Known video words')
      expect(JSON.stringify(body)).toContain('00:05')
      return new Response('{"choices":[{"message":{"content":"重点在 [cue-1]"}}]}', { headers: { 'Content-Type': 'application/json' } })
    },
  })
  await assistant.configureProvider({ baseUrl: 'https://model.example/v1/', models: ['fixture'], key: 'fixture', remember: false })
  const discovery = createDubbingInjection({
    executeScript: async (details) => {
      expect(details.files).toBeUndefined()
      return [{ frameId: 0, documentId: nativeDocument, result: { url: href, title: 'Video', count: 1, live: false, hasSource: true } }]
    },
  }, { get: async () => ({ url: href }) })
  const controller = new VideoReadingController({ page, permissions, discovery, assistant, injection: { connect: async () => ({ documentId: nativeDocument, request: message => runtime.handle(message) }) } })
  const source = await controller.open('reader')
  const loaded = await controller.load('reader', source.token, 'import', '1\n00:00:05,000 --> 00:00:08,000\nKnown video words\n')
  expect(loaded).toMatchObject({ videoId: 'html5:https://example.org/watch', trackId: 'import', documentId: 'native-doc' })
  await controller.ask('reader', source.token, '总结')
  await vi.waitFor(async () => expect(await controller.poll('reader')).toMatchObject({ status: 'completed', text: '重点在 [cue-1]' }))
  await controller.seek('reader', source.token, 'cue-1')
  expect(video.currentTime).toBe(5)
  video.src = 'https://example.org/other.mp4'
  await expect(controller.seek('reader', source.token, 'cue-1')).rejects.toThrow('视频')
  video.src = 'https://example.org/movie.mp4'
  nativeDocument = 'next-doc'
  await expect(controller.seek('reader', source.token, 'cue-1')).rejects.toThrow('来源')
  href = 'https://example.org/next'
  await expect(controller.ask('reader', source.token, '继续')).rejects.toThrow('来源')
  runtime.dispose()
})
