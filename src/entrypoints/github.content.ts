import { defineContentScript } from 'wxt/utils/define-content-script'
import { initializeGitHubContext } from '~/contentScripts'

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  allFrames: false,
  main(ctx) {
    ctx.onInvalidated(initializeGitHubContext())
  },
})
