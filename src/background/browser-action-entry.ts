export interface BrowserActionEntryOptions {
  action: {
    onClicked: {
      addListener: (_listener: () => void) => void
    }
  }
  runtime: {
    getURL: (_path: string) => string
  }
  sidePanel?: {
    setPanelBehavior: (_options: { openPanelOnActionClick: boolean }) => Promise<void>
  }
  tabs: {
    create: (_options: { url: string }) => Promise<unknown>
  }
}

export const ONEWEB_FALLBACK_PAGE = '/sidebar.html'

export function configureChromiumActionEntry(options: BrowserActionEntryOptions) {
  let fallbackInstalled = false

  const installTabFallback = () => {
    if (fallbackInstalled)
      return
    fallbackInstalled = true
    options.action.onClicked.addListener(() => {
      void options.tabs.create({ url: options.runtime.getURL(ONEWEB_FALLBACK_PAGE) })
    })
  }

  if (!options.sidePanel?.setPanelBehavior) {
    installTabFallback()
    return 'tab-fallback' as const
  }

  void options.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(installTabFallback)
  return 'side-panel' as const
}
