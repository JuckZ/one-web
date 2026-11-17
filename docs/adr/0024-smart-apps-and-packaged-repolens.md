# ADR-0024: Two application forms and packaged RepoLens

- Status: Accepted for local implementation
- Date: 2026-11-16

The user requested Monica-style page prompt tools and interactive mini apps, script-manager-style management, and consolidation of RepoLens into OneWeb. Maintaining an independently hosted RepoLens service is unnecessary for the selected public-repository analysis workflow.

Keep the existing remote-module platform. Add a separate bounded library of user app definitions under `oneweb.smart-apps.v1`; user HTML must never become trusted builtin code or gain the generic remote-module capabilities. Page tools reuse the existing trusted Assistant and page-capture protocols with explicit user actions. HTML mini apps run only in a manifest-declared opaque sandbox, inside another `allow-scripts` frame with a restrictive CSP. Its one-way render protocol validates window/source, nonce and payload; it grants no extension RPC. Network, child frames, workers, external scripts, forms, top navigation and WebRTC are unavailable. Generated HTML remains editable data and is previewed explicitly before saving.

Migrate the seeded `dev.juck.repolens` record to a packaged builtin, retaining its enabled preference. Its finite background controller requests only fixed GitHub API public-repository GET endpoints, with optional origin permission and user-owned credentials. Credentials stay background-owned, session by default. Local cache, snapshots and reports are independent of the legacy service. This intentionally drops server-only production infrastructure and optional non-core data sources, recorded in the spec. Existing user-installed remote modules continue through the unchanged host/SDK trust boundary.

Consequences: one source repository, build and release for RepoLens; user apps can be shared as JSON and independently enabled but update with explicit editing/import. Builtins still update with the extension. No runtime user-script injection or GM compatibility is implied. Sandboxing does not promise unlimited CPU/memory isolation, browser bug containment or persistence for HTML app state.

The rendering loader is a single packaged classic IIFE on both browsers. Firefox's opaque sandbox
cannot import extension ES modules. Chromium uses the explicit manifest sandbox CSP; Firefox uses
its declared sandbox default and the same closed nested-document CSP. Neither variant relaxes the
privileged extension execution policy. Real Chromium and Firefox counter/authority/network probes
are required whenever this build boundary changes.

See [spec](../specs/smart-apps.md), [inventory](../privacy-data-inventory.md) and [checkpoint](../checkpoints/smart-apps-repolens.md). Earlier RepoLens remote-runtime ADRs remain historical evidence for the independent project and the remote SDK conformance fixture.
