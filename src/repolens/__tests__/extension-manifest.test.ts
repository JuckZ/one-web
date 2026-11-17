import { getManifest } from '../../manifest'

describe('browser-target extension manifests', () => {
  it('generates a Chromium MV3 service worker and side panel', async () => {
    const manifest = await getManifest({
      target: 'chromium',
      development: false,
      repolensOrigin: 'https://repolens.example.com',
    })

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.minimum_chrome_version).toBe('148')
    expect(manifest.background).toEqual({
      service_worker: './dist/background/index.mjs',
      type: 'module',
    })
    expect(manifest.side_panel).toEqual({ default_path: 'dist/sidebar/index.html' })
    expect(manifest.sidebar_action).toBeUndefined()
    expect(manifest.permissions).toContain('sidePanel')
    expect(manifest.host_permissions).toEqual(['https://github.com/*'])
    expect(manifest.optional_host_permissions).toContain('https://*/*')
    expect(manifest.sandbox).toEqual({ pages: ['dist/apps/sandbox.html'] })
    expect(manifest.content_security_policy).toMatchObject({
      sandbox: expect.stringContaining('connect-src \'none\''),
      extension_pages: expect.stringContaining('frame-src \'self\''),
    })
    expect(JSON.stringify(manifest)).not.toContain('https://repolens.example.com')
  })

  it('generates a Firefox MV3 background and native sidebar', async () => {
    const manifest = await getManifest({
      target: 'firefox',
      development: false,
      repolensOrigin: 'https://repolens.example.com',
    })

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.minimum_chrome_version).toBeUndefined()
    expect(manifest.background).toEqual({
      scripts: ['./dist/background/index.mjs'],
      type: 'module',
    })
    expect(manifest.side_panel).toBeUndefined()
    expect(manifest.sidebar_action).toEqual({
      default_panel: 'dist/sidebar/index.html',
      default_title: 'OneWeb',
      default_icon: './assets/icon-128.png',
    })
    expect(manifest.permissions).not.toContain('sidePanel')
    expect(manifest.sandbox).toEqual({ pages: ['dist/apps/sandbox.html'] })
    expect((manifest.content_security_policy as { sandbox?: string }).sandbox).toBeUndefined()
    expect(manifest.browser_specific_settings?.gecko?.id).toBe('one-web@juckz.local')
    expect(manifest.browser_specific_settings?.gecko?.strict_min_version).toBe('142.0')
    expect(manifest.browser_specific_settings?.gecko).toMatchObject({
      data_collection_permissions: {
        required: ['authenticationInfo', 'browsingActivity', 'websiteContent', 'personalCommunications', 'searchTerms'],
      },
    })
  })
})
