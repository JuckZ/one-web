# OneWeb

OneWeb is a modular browser companion that brings search, organization, browser utilities and
smart analysis into one side workspace. The private root package and browser-facing identities use
the OneWeb name; RepoLens is one module rather than the host identity.

RepoLens is one OneWeb module, not the product's overall identity. Its packaged bridge uses the
native Side Panel in Chrome and Edge and `sidebar_action` in Firefox. The module panel embeds only
the remote RepoLens `/embed` page, while all extension privileges stay in the packaged background
and content-script code.

Brand sources, alternate concepts and design history are archived in
[`docs/brand/README.md`](docs/brand/README.md).

The architecture for user-installed modules is documented in
[`docs/module-platform-architecture.md`](docs/module-platform-architecture.md).
The feature decomposition sequence is tracked in
[`docs/module-decomposition-roadmap.md`](docs/module-decomposition-roadmap.md).

## RepoLens module development

Start RepoLens first:

```bash
cd /path/to/repolens-starter
npm start
```

Build Chromium and load `artifacts/chromium/` as an unpacked extension:

```bash
cd /path/to/one-web
pnpm build
```

Add the resulting `chrome-extension://<id>` to RepoLens `EXTENSION_ORIGINS`, then restart
RepoLens. Development Chromium IDs are derived from the local unpacked-extension identity and must
not be documented as a stable product ID.

Build, lint and package Firefox separately:

```bash
pnpm build:firefox
pnpm manifest:validate
pnpm pack:xpi
```

Firefox uses the stable add-on ID `one-web@juckz.local`; its temporary local
`moz-extension://<uuid>` must also be added to RepoLens `EXTENSION_ORIGINS` for local testing.
The packaged XPI is `extension.xpi` and the unpacked files are preserved in `artifacts/firefox/`.

## Cookie Manager

Open OneWeb → manage modules → enable **Cookie Manager** (disabled by default). Choose the current
HTTP(S) site or all websites, then use **授权并读取** to grant optional Cookie/host access.
The packaged panel groups cookies by domain, filters by name/domain and Store, and supports
create/edit, copy value, reviewed deletion and selected JSON export/import. Values stay hidden
until explicitly viewed, copied or exported. Existing cookie identities stay fixed during editing.

JSON files contain plaintext cookie values. Import requires selecting a real destination Store,
previewing the records and choosing which ones to write. The format is OneWeb's own plain cookie
array; third-party encrypted backups and historical formats are outside this feature.

Cookie values stay in transient packaged-page/background memory and explicitly downloaded files.
They are never sent to RepoLens or other modules, persisted to extension storage or logged.
Closing the manager, hiding the page or disabling the module clears the session; shared browser
permissions remain available to other modules. See the
[specification](docs/specs/cookie-manager.md) and [reference audit](docs/research/cookie-editor-reference.md).

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
EXTENSION_PATH="$PWD/extension" PLAYWRIGHT_HTML_OPEN=never pnpm test:e2e
EXTENSION_PATH="$PWD/extension" PW_BROWSER_CHANNEL=msedge PLAYWRIGHT_HTML_OPEN=never pnpm test:e2e
```

The browser test loads a real extension, visits a real GitHub repository, exercises SPA route
changes and exact-duplicate navigation, opens the packaged 420px panel page, verifies the iframe
handshake, rejects a forged origin, confirms cached-summary-first behavior, and triggers a deep
analysis. Firefox additionally uses a `tabs.onUpdated` URL fallback so MV3 event-page suspension
cannot drop a full-navigation context update; SPA transitions still use the content script.

## Data and security boundaries

```text
GitHub Content Script
  github.repository provider update/removal
        ↓ oneweb.context runtime message
Background / Service Worker
  ContextBroker validates source, normalizes, stores per-tab snapshot, removes duplicates
        ↓ generic context snapshot
Packaged Side Panel / Firefox Sidebar
  intersects provider fields × manifest request × installed grants
  exact origin/source + protocol v1 + one-time session nonce
        ↓ MODULE_INIT transfers a private MessageChannel
RepoLens /embed
  sandboxed remote origin, no chrome/browser API access
```

- No iframe or report UI is injected into GitHub's DOM.
- The content script never reads or uploads page text, README content, private code, or form data.
- The manifest grants only `activeTab`, `scripting`, `storage`, `tabs`, and Chromium `sidePanel`,
  plus exact GitHub and RepoLens host permissions. `scripting` remains gated by explicit Page
  Toolbox exact-origin permission and a fixed packaged entry.
- `cookies` is optional and requested only through Cookie Manager's explicit authorization action.
- The initial RepoLens handshake checks exact `event.origin`, `event.source`, module ID and protocol
  version; later messages use the transferred port and still require the module ID and nonce.
- Production uses HTTPS, explicit extension origins, `AUTH_MODE=session`, a one-time authorization
  code and a short-lived Bearer session. The GitHub Token, search credentials and model credentials
  remain server-only.

Implementation details and remaining deployment considerations are documented in
[`docs/architecture.md`](docs/architecture.md).
