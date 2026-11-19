import type BrowserApi from 'webextension-polyfill'

type ExtensionApi = typeof BrowserApi

// WXT imports entrypoint modules in Node while discovering their metadata.
// Resolve APIs only when main() runs, keeping discovery free of browser effects.
function api(): ExtensionApi {
  const globals = globalThis as typeof globalThis & { browser?: ExtensionApi, chrome?: ExtensionApi }
  const extension = globals.browser ?? globals.chrome
  if (!extension?.runtime?.id)
    throw new Error('OneWeb must run inside a supported browser extension context')
  return extension
}

const browser = new Proxy({} as ExtensionApi, {
  get: (_target, key) => Reflect.get(api(), key),
})
export const storage = new Proxy({} as ExtensionApi['storage'], {
  get: (_target, key) => Reflect.get(api().storage, key),
})
export default browser
