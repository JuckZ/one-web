import { configureChromiumActionEntry, ONEWEB_FALLBACK_PAGE } from '../browser-action-entry'

function createHarness(sidePanel?: {
  setPanelBehavior: ReturnType<typeof vi.fn>
}) {
  let clickListener: (() => void) | undefined
  const tabs = { create: vi.fn(async () => undefined) }
  const runtime = {
    getURL: vi.fn((path: string) => `chrome-extension://abcdefghijklmnopabcdefghijklmnop${path}`),
  }
  const action = {
    onClicked: {
      addListener: vi.fn((listener: () => void) => {
        clickListener = listener
      }),
    },
  }
  return {
    action,
    click: () => clickListener?.(),
    options: { action, runtime, sidePanel, tabs },
    runtime,
    tabs,
  }
}

describe('chromium browser action entry', () => {
  it('opens the native side panel when the API is available', () => {
    const setPanelBehavior = vi.fn(async () => undefined)
    const harness = createHarness({ setPanelBehavior })

    expect(configureChromiumActionEntry(harness.options)).toBe('side-panel')
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    expect(harness.options.action.onClicked.addListener).not.toHaveBeenCalled()
  })

  it('opens the packaged workspace in a tab when sidePanel is unavailable', async () => {
    const harness = createHarness()

    expect(configureChromiumActionEntry(harness.options)).toBe('tab-fallback')
    harness.click()
    await Promise.resolve()

    expect(harness.runtime.getURL).toHaveBeenCalledWith(ONEWEB_FALLBACK_PAGE)
    expect(harness.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidebar.html',
    })
  })

  it('installs the tab fallback if sidePanel initialization is rejected', async () => {
    const harness = createHarness({
      setPanelBehavior: vi.fn(async () => Promise.reject(new Error('unsupported'))),
    })

    configureChromiumActionEntry(harness.options)
    await vi.waitFor(() => {
      expect(harness.options.action.onClicked.addListener).toHaveBeenCalledOnce()
    })
    harness.click()

    expect(harness.tabs.create).toHaveBeenCalledTimes(1)
  })
})
