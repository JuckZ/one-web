const extension = vi.hoisted(() => {
  type Listener = (_message: unknown, _sender: { id: string }) => Promise<unknown> | undefined
  const listeners = new Set<Listener>()
  return {
    browser: {
      runtime: {
        id: 'oneweb',
        sendMessage: async () => undefined,
        onMessage: {
          addListener: (listener: Listener) => listeners.add(listener),
          removeListener: (listener: Listener) => listeners.delete(listener),
        },
      },
    },
    deliver: async (command: string) => Promise.all([...listeners].map(listener =>
      listener({ channel: 'oneweb.page-context.v1', command }, { id: 'oneweb' }))),
  }
})
vi.mock('~/platform/browser', () => ({ default: extension.browser }))

afterEach(() => window.dispatchEvent(new Event('pagehide')))

it('releases the browser message subscription when its page runtime is explicitly disposed', async () => {
  const { initializeAssistantContent } = await import('../index')
  initializeAssistantContent()
  expect(await extension.deliver('ping')).toEqual([{ ok: true, value: null }])
  expect(await extension.deliver('dispose')).toEqual([{ ok: true, value: null }])
  expect(await extension.deliver('ping')).toEqual([])
})
