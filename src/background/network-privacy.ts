import type { NetworkControllerOptions } from '~/modules/builtin/network-management/controller'
import browser from '~/platform/browser'
import { createFirefoxNetworkPrivacy } from './network-privacy-adapter'

function callbackResult<T>(invoke: (_done: (_value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      if (chrome.runtime.lastError)
        reject(new Error('browser-operation-failed'))
      else
        resolve(value)
    })
  })
}

export function getNetworkPrivacy(): NetworkControllerOptions['privacy'] {
  if (__FIREFOX__)
    return createFirefoxNetworkPrivacy(browser.privacy?.network?.webRTCIPHandlingPolicy)
  const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy
  if (!setting)
    return undefined
  // ChromeSetting methods use callbacks, unlike the surrounding MV3 APIs.
  return {
    get: details => callbackResult(done => setting.get(details, done)),
    set: details => callbackResult<void>(done => setting.set(details, () => done(undefined))),
    clear: details => callbackResult<void>(done => setting.clear(details, () => done(undefined))),
  }
}
