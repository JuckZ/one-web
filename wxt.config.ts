import { resolve } from 'node:path'
import process from 'node:process'
import { defineConfig } from 'wxt'
import { firefoxVendorPolicyPlugin } from './scripts/firefox-vendor-policy'
import { resolveRepoLensOrigin } from './scripts/repolens-origin'
import { port } from './scripts/utils'
import { getManifest } from './src/manifest'

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifestVersion: 3,
  outDir: 'artifacts/build',
  outDirTemplate: '{{browser}}',
  hooks: {
    config: {
      resolved: (wxt) => {
        const purpose = wxt.config.command === 'serve' ? 'dev' : 'build'
        // Use the resolved CLI target; bare `wxt -b firefox` has no EXTENSION env.
        wxt.config.outDir = process.env.ONEWEB_EXTENSION_DIR
          ? resolve(wxt.config.root, process.env.ONEWEB_EXTENSION_DIR)
          : resolve(wxt.config.root, 'artifacts', purpose, wxt.config.browser === 'firefox' ? 'firefox' : 'chromium')
      },
    },
    build: {
      manifestGenerated: (wxt, manifest) => {
        const csp = manifest.content_security_policy
        if (wxt.server && typeof csp === 'object' && csp.extension_pages) {
          const socket = new URL(wxt.server.origin)
          socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:'
          csp.extension_pages = csp.extension_pages.replace(/(connect-src [^;]+);/u, `$1 ${socket.origin};`)
        }
      },
    },
  },
  manifest: async ({ browser, mode }) => {
    const manifest = await getManifest({ target: browser === 'firefox' ? 'firefox' : 'chromium', development: mode === 'development' })
    // WXT discovers the background and GitHub content entrypoints.
    const { manifest_version: _version, background: _background, content_scripts: _scripts, ...userManifest } = manifest
    return userManifest
  },
  alias: {
    '@oneweb/module-sdk/capability-client': resolve('packages/module-sdk/src/capability-client.ts'),
    '@oneweb/module-sdk/capability-rpc': resolve('packages/module-sdk/src/capability-rpc.ts'),
    '@oneweb/module-sdk/runtime': resolve('packages/module-sdk/src/runtime-client.ts'),
    '@oneweb/module-sdk/storage-module': resolve('packages/module-sdk/src/storage-module.ts'),
    '@oneweb/module-sdk': resolve('packages/module-sdk/src/index.ts'),
  },
  webExt: { disabled: true },
  dev: { server: { port, strictPort: true } },
  vite: ({ browser, mode }) => ({
    // The two dev servers have different entrypoint dependency graphs.
    ...(mode === 'development' ? { cacheDir: resolve('node_modules/.vite', `oneweb-${browser}`) } : {}),
    plugins: browser === 'firefox' && mode === 'production' ? [firefoxVendorPolicyPlugin()] : [],
    define: {
      __DEV__: process.env.NODE_ENV !== 'production',
      __FIREFOX__: browser === 'firefox',
      __NAME__: JSON.stringify('one-web'),
      __REPOLENS_ORIGIN__: JSON.stringify(resolveRepoLensOrigin()),
    },
  }),
  watchOptions: { ignored: ['**/.playwright-cli/**', '**/.migration-backup/**', '**/artifacts/**'] },
})
