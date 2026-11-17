import { byteLength, MAX_MINI_APP_BYTES } from './model'
import { MINI_APP_DOCUMENT_CSP, MINI_APP_RUNNER_CHANNEL } from './sandbox-policy'

// ICE/STUN is not covered by connect-src consistently, so disable peer networking before app code.
const networkBootstrap = '<script>for (const name of ["RTCPeerConnection","webkitRTCPeerConnection"]) { try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }); } catch {} }<\/script>'
const token = location.hash.slice(1)
let rendered = false
if (parent !== window && /^[\w-]{20,100}$/.test(token)) {
  window.addEventListener('message', (event) => {
    if (rendered || event.source !== parent || !event.data || typeof event.data !== 'object'
      || event.data.channel !== MINI_APP_RUNNER_CHANNEL || event.data.token !== token
      || event.data.type !== 'render' || typeof event.data.html !== 'string'
      || !event.data.html.trim() || byteLength(event.data.html) > MAX_MINI_APP_BYTES) {
      return
    }
    rendered = true
    const frame = document.createElement('iframe')
    frame.title = '交互式小应用'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('allow', 'camera \'none\'; microphone \'none\'; geolocation \'none\'; clipboard-read \'none\'; clipboard-write \'none\'')
    frame.referrerPolicy = 'no-referrer'
    frame.addEventListener('load', () => {
      parent.postMessage({ channel: MINI_APP_RUNNER_CHANNEL, token, type: 'loaded' }, '*')
    }, { once: true })
    // CSP is parsed before app content and remains enforced even if the app removes the meta node.
    // Untrusted markup is intentionally executable only in this nested opaque sandbox.
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${MINI_APP_DOCUMENT_CSP}"><meta name="referrer" content="no-referrer">${networkBootstrap}${event.data.html}`
    document.body.replaceChildren(frame)
  })
  parent.postMessage({ channel: MINI_APP_RUNNER_CHANNEL, token, type: 'ready' }, '*')
}
