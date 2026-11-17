import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import fs from 'fs-extra'
import { resolveRepoLensOrigin } from '../scripts/repolens-origin'
import { isDev, isFirefox, port, r } from '../scripts/utils'
import { MINI_APP_SANDBOX_CSP } from './apps/sandbox-policy'

interface ManifestBuildOptions {
  development?: boolean
  repolensOrigin?: string
  target?: 'chromium' | 'firefox'
}

interface FirefoxDataCollectionSettings extends Manifest.FirefoxSpecificProperties {
  data_collection_permissions: {
    required: Array<'authenticationInfo' | 'browsingActivity' | 'websiteContent' | 'personalCommunications' | 'searchTerms'>
  }
}

/**
 * Generates the browser extension's Manifest V3 configuration from package metadata and build settings.
 *
 * @returns The generated browser extension manifest
 */
export async function getManifest(options: ManifestBuildOptions = {}) {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType
  const firefox = options.target ? options.target === 'firefox' : isFirefox
  const development = options.development ?? isDev
  const repolensOrigin = options.repolensOrigin
    ? resolveRepoLensOrigin({ REPOLENS_ORIGIN: options.repolensOrigin })
    : resolveRepoLensOrigin()
  const firefoxSettings: FirefoxDataCollectionSettings = {
    id: 'one-web@juckz.local',
    strict_min_version: '142.0',
    data_collection_permissions: {
      required: ['authenticationInfo', 'browsingActivity', 'websiteContent', 'personalCommunications', 'searchTerms'],
    },
  }

  // update this file to update this manifest.json
  // can also be conditional based on your need

  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: 3,
    ...(firefox ? {} : { minimum_chrome_version: '148' }),
    name: pkg.displayName || pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author.name,
    homepage_url: pkg.homepage,
    action: {
      default_icon: './assets/icon-128.png',
    },
    side_panel: {
      default_path: './dist/sidebar/index.html',
    },
    background: firefox
      ? {
          scripts: ['./dist/background/index.mjs'],
          type: 'module',
        }
      : {
          service_worker: './dist/background/index.mjs',
          type: 'module',
        },
    icons: {
      16: './assets/icon-16.png',
      48: './assets/icon-48.png',
      128: './assets/icon-128.png',
    },
    permissions: [
      'activeTab',
      'contextMenus',
      'scripting',
      'storage',
      'tabs',
      ...(firefox ? [] : ['sidePanel']),
    ],
    optional_permissions: ['bookmarks', 'cookies', 'privacy'],
    commands: {
      'open-workspace': { suggested_key: { default: 'Alt+Shift+O' }, description: '打开 OneWeb 工作区' },
      'quick-ask': { suggested_key: { default: 'Alt+Shift+K' }, description: '打开 OneWeb Quick Ask' },
    },
    host_permissions: [
      'https://github.com/*',
    ],
    optional_host_permissions: [
      'https://*/*',
      'http://*/*',
    ],
    content_scripts: [
      {
        matches: [
          'https://github.com/*',
        ],
        js: [
          'dist/contentScripts/index.global.js',
        ],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    web_accessible_resources: [
      {
        resources: ['dist/contentScripts/style.css', 'dist/assets/*'],
        matches: ['https://github.com/*'],
      },
    ],
    content_security_policy: {
      extension_pages: development
        // this is required on dev for Vite script to load
        ? `script-src 'self' http://localhost:${port}; object-src 'self'; frame-src 'self' ${repolensOrigin} https: http://localhost:* http://127.0.0.1:*; connect-src https: http:`
        : `script-src 'self'; object-src 'self'; frame-src 'self' https: http://localhost:* http://127.0.0.1:*; connect-src https: http:`,
      // Firefox uses its declared sandbox default; the nested document enforces the closed
      // app CSP. A custom unsafe-inline sandbox policy triggers Mozilla's remote-code gate.
      ...(firefox ? {} : { sandbox: MINI_APP_SANDBOX_CSP }),
    },
    sandbox: { pages: ['dist/apps/sandbox.html'] },
    browser_specific_settings: {
      gecko: firefoxSettings,
    },
  }

  // add sidepanel
  if (firefox) {
    delete manifest.side_panel
    manifest.sidebar_action = {
      default_panel: 'dist/sidebar/index.html',
      default_title: 'OneWeb',
      default_icon: './assets/icon-128.png',
    }
  }
  else {
    // the sidebar_action does not work for chromium based
    (manifest as any).side_panel = {
      default_path: 'dist/sidebar/index.html',
    }
  }

  return manifest
}
