export {}

declare module 'webextension-polyfill' {
  namespace Manifest {
    interface WebExtensionManifest {
      // FIXME for chrome now
      side_panel?: {
        default_path: string
      }
    }
  }
}
