import type BrowserApi from 'webextension-polyfill'

type ExtensionApi = typeof BrowserApi

const extensionGlobals = globalThis as typeof globalThis & {
  browser?: ExtensionApi
  chrome?: ExtensionApi
}

const extensionApi = extensionGlobals.browser ?? extensionGlobals.chrome

if (!extensionApi?.runtime?.id)
  throw new Error('OneWeb must run inside a supported browser extension context')

export const storage = extensionApi.storage
export default extensionApi
