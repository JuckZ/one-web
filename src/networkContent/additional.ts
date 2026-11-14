// Independently selectable RTC objects, without disabling PeerConnection.
;(() => {
  for (const name of ['RTCIceCandidate', 'RTCDataChannel', 'RTCConfiguration']) {
    if (!(name in window))
      continue
    try {
      Object.defineProperty(window, name, { value: undefined, configurable: true, writable: false })
    }
    catch {
      // A locked descriptor must not prevent the remaining overrides.
    }
  }
})()
