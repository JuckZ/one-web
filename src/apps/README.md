# Smart application library

This package contains user-owned app definitions, a trusted background management protocol and a rendering-only sandbox. A matching URL never grants permission to read or modify that site.

## Integration

Create exactly one background `SmartAppsController({ storage: browser.storage.local })` and route messages through `handleSmartAppsMessage(controller, message, sender, browser.runtime.id, browser.runtime.getURL('/'))`. The handler accepts only trusted extension management senders and a finite command schema. UI code uses `new SmartAppsClient({ sendMessage: message => browser.runtime.sendMessage(message) })`.

Both the controller and client expose:

- `list(): Promise<SmartApp[]>`
- `create(input: SmartAppInput): Promise<SmartApp>`
- `update(id: string, input: SmartAppInput): Promise<SmartApp>`
- `setEnabled(id: string, enabled: boolean): Promise<SmartApp>`
- `remove(id: string): Promise<void>`
- `exportApps(ids?: string[]): Promise<string>`
- `importApps(json: string): Promise<SmartApp[]>`

`SmartAppInput` is `{kind:'web-tool', name, description?, matches?, enabled?, prompt}` or `{kind:'mini-app', name, description?, matches?, enabled?, html}`. Matches default to HTTP(S), enablement defaults to true. `update` keeps the original kind, ID, creation time and current enablement when omitted. Imports validate the entire file before writing, assign fresh IDs and disable imported applications for review. The versioned local state is bounded to 50 apps and 2 MiB. A single app HTML is bounded to 256 KiB. Web tool prompts are plain text with only `${text}`, `${title}` and `${url}` substitutions. Expanded content is bounded before allocation and source URLs omit query/hash.

## Mini app sandbox

Add `sandbox.pages: ['sandbox.html']` and, on Chromium, `content_security_policy.sandbox: MINI_APP_SANDBOX_CSP` to the manifest. Firefox uses its default declared sandbox policy; the nested document still enforces the complete closed app CSP. Include `'self'` in the extension page `frame-src` policy. WXT bundles `src/entrypoints/sandbox-runtime.ts` as the classic `sandbox-runtime.js` script and copies `public/sandbox.html`. Opaque Firefox documents reject extension ES module imports, so the copied page deliberately loads a classic script. WXT owns development rebuilds as well.

Use `const runner = new MiniAppRunner()` then `await runner.mount(root, { html, sandboxUrl: browser.runtime.getURL('/sandbox.html'), title })`. Call `runner.dispose()` on navigation, disable, removal or view teardown. The caller must recheck the latest app enablement before running and destroy the runner when enablement changes.

A packaged opaque loader receives HTML only after a source/nonce handshake. Supported Chromium additionally pins the browser's opaque `Origin`; Firefox falls back to window identity and nonce. Untrusted HTML runs only inside a second `allow-scripts` sandbox with a pre-applied CSP denying external resources, connections, child frames, workers, objects, form submission and base URLs. WebRTC peer networking is disabled before app code because CSP connection coverage alone is insufficient. The runner never processes commands from app content and never transfers browser APIs, storage, secrets or current-page data. Mini app state is ephemeral; browser storage is unavailable inside the opaque frame. Generated JavaScript can consume CPU, so disposal remains the escape hatch; this is not an OS process/resource sandbox.
