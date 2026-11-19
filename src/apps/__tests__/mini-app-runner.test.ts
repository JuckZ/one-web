import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniAppRunner } from '../mini-app-runner'
import { MINI_APP_RUNNER_CHANNEL } from '../sandbox-policy'

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

function deliver(frame: HTMLIFrameElement, type: string, source: MessageEventSource | null = frame.contentWindow, nonce?: string) {
  window.dispatchEvent(new MessageEvent('message', { source, origin: 'null', data: {
    channel: MINI_APP_RUNNER_CHANNEL,
    token: nonce ?? new URL(frame.src).hash.slice(1),
    type,
  } }))
}

describe('mini application sandbox runner', () => {
  it('binds a packaged opaque frame by source and nonce before delivering HTML', async () => {
    const runner = new MiniAppRunner()
    const root = document.createElement('section')
    document.body.append(root)
    let ready = false
    const mounted = runner.mount(root, { title: '交互阅读', sandboxUrl: 'chrome-extension://oneweb/sandbox.html', html: '<script>throw 1</script><p id="app-private">data</p>' })
    void mounted.then(() => {
      ready = true
    })
    const frame = root.querySelector('iframe')!
    expect(frame.title).toBe('交互阅读')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(document.querySelector('#app-private')).toBeNull()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    deliver(frame, 'ready', window)
    deliver(frame, 'ready', frame.contentWindow, 'forged-token')
    deliver(frame, 'loaded')
    await Promise.resolve()
    expect(ready).toBe(false)
    expect(post).not.toHaveBeenCalled()
    deliver(frame, 'ready')
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'render', html: expect.stringContaining('app-private') }), '*')
    deliver(frame, 'loaded')
    await mounted
    expect(ready).toBe(true)
    runner.dispose()
    expect(root.children).toHaveLength(0)
  })

  it('rejects remote running pages and destroys a pending preview on close', async () => {
    const runner = new MiniAppRunner()
    const root = document.createElement('section')
    await expect(runner.mount(root, { html: '<p>x</p>', sandboxUrl: 'https://example.test/sandbox.html' })).rejects.toThrow('打包')
    expect(root.children).toHaveLength(0)
    const mounted = runner.mount(root, { html: '<p>x</p>', sandboxUrl: 'moz-extension://oneweb/sandbox.html' })
    const rejected = expect(mounted).rejects.toThrow('关闭')
    runner.dispose()
    await rejected
    expect(root.children).toHaveLength(0)
  })

  it('fails closed when the sandbox never completes its handshake', async () => {
    vi.useFakeTimers()
    const runner = new MiniAppRunner()
    const root = document.createElement('section')
    const mounted = runner.mount(root, { html: '<p>x</p>', sandboxUrl: 'chrome-extension://oneweb/sandbox.html' })
    const rejected = expect(mounted).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(8000)
    await rejected
    expect(root.children).toHaveLength(0)
  })
})
