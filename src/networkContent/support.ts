// Runs in the page's MAIN world before its first script. No extension bridge.
;(() => {
  const hide = (target: object, name: string) => {
    if (!(name in target))
      return
    try {
      Object.defineProperty(target, name, { value: undefined, configurable: true, writable: false })
    }
    catch {
      // One non-configurable property must not prevent the other overrides.
    }
  }
  for (const prefix of ['', 'moz', 'webkit']) {
    for (const name of ['RTCPeerConnection', 'MediaStreamTrack', 'RTCSessionDescription'])
      hide(window, `${prefix}${name}`)
    hide(navigator, prefix ? `${prefix}GetUserMedia` : 'getUserMedia')
  }
})()
