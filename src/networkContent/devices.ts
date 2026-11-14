// Fixed MAIN-world override; it reads no device information or page content.
;(() => {
  for (const target of [navigator, Object.getPrototypeOf(navigator)]) {
    try {
      Object.defineProperty(target, 'mediaDevices', { value: null, configurable: true, writable: false })
    }
    catch {
      // Attempt each property independently when a browser locks one descriptor.
    }
  }
})()
