import { isRecord } from '~/modules/builtin/assistant/contracts'
import browser from '~/platform/browser'
import { PAGE_CHANNEL, PageContentRuntime } from './runtime'

const globals = globalThis as typeof globalThis & { __onewebPageCleanup?: () => void }
globals.__onewebPageCleanup?.()
const runtime = new PageContentRuntime(document, { sendMessage: message => browser.runtime.sendMessage(message) })

function onMessage(message: unknown, sender: { id?: string }) {
  if (sender.id !== browser.runtime.id || !isRecord(message) || message.channel !== PAGE_CHANNEL
    || !['ping', 'capture', 'selection', 'apply', 'quote-capture', 'quote-locate', 'video-snapshot', 'video-cues', 'video-seek', 'capture-viewport', 'capture-ui', 'page-images', 'image-rectangle', 'translation-blocks', 'translation-apply', 'translation-restore', 'translation-watch', 'translation-state', 'translation-stop', 'translation-display', 'surface-enable', 'surface-disable', 'quick-ask-open', 'page-links', 'dispose'].includes(message.command as string)) {
    return undefined
  }
  return runtime.handle(message as { command: string }).then((value) => {
    if (message.command === 'dispose')
      cleanup()
    return { ok: true, value }
  }, error => ({
    ok: false,
    error: error instanceof Error ? error.message : '页面操作失败',
  }))
}
function cleanup() {
  runtime.dispose()
  browser.runtime.onMessage.removeListener(onMessage)
  window.removeEventListener('pagehide', cleanup)
}
globals.__onewebPageCleanup = cleanup
browser.runtime.onMessage.addListener(onMessage)
window.addEventListener('pagehide', cleanup, { once: true })
