# OneWeb Architecture Roadmap

RepoLens is now a packaged builtin, alongside a separate library of page prompt tools and isolated
HTML mini apps ([ADR-0024](adr/0024-smart-apps-and-packaged-repolens.md)). The module model, trust boundaries, manifest format and evolution
plan are specified in [`module-platform-architecture.md`](module-platform-architecture.md).

## Unified workspace and assistant

网络管理复用 `dev.oneweb.clash-control` 的既有记录与入口，由原 Clash connector 和
`src/modules/builtin/network-management/` 的 WebRTC 控制器组合。两者共享模块启停，
独立处理 localhost 凭据与浏览器隐私设置。WebRTC 的固定 runtime 接口只对受信任打包页开放，
采用可选 privacy 权限、浏览器实际策略读回及固定 MAIN/document_start 脚本；
不向远程模块增加能力。决策见 [ADR-0023](adr/0023-network-management-webrtc.md)。

`src/workspace/workspace.ts` owns destination selection, tool search, favorites and recent tools.
`src/sidebar/main.ts` mounts a shared `AssistantView`, a selected builtin tool or a remote
`ModuleFrameHost` into its stable outlet. The default is Assistant; an explicit `moduleId` query
still opens a particular tool. Settings contains provider/preferences and module lifecycle
management. Daily builtin views are mounted only at their selected tool entry, with disposal
guards preventing old asynchronous refreshes from rendering after navigation.

`src/modules/builtin/assistant/` owns compatible provider configuration, keys, request ownership,
stream parsing, local history, prompts and bounded text/subtitle import. Its finite
`oneweb.assistant.v1` protocol accepts only trusted packaged pages. Public configuration responses
contain `keyConfigured`, never the key. Session storage is the default credential adapter;
explicit opt-in uses local storage. Storage access is restricted to trusted extension contexts
where the browser supports that setting. Remote modules do not receive assistant capabilities.

Starts and configuration changes are serialized. Each conversation has one active answer and the
host permits at most two simultaneous model requests, including translation batches. Captured
answer references, owner epochs, abort signals and explicit terminal states prevent old output
from overwriting later work. The fixed adapter sends only `chat/completions`, omits cookies,
rejects redirects, caps requests/responses at 256 KiB/2 MiB and uses a 90-second timeout.
Its SSE reader handles split UTF-8, comments, multiline events and CRLF/LF. Incomplete streams,
invalid payloads and empty responses remain failures. A failed pre-request history write rolls
back the request without contacting the provider.

`src/workspace/page-context.ts` derives the real active web page and binds captures to owner,
tab, native document, source URL and a ten-minute lifetime. Full-tab workspaces may use the last
ordinary web tab as a source. A caller cannot supply a tab, frame, arbitrary URL or script.
`page-injection.ts` shares document-targeted sessions for the fixed
`dist/assistantContent/index.global.js` artifact. The isolated runtime extracts visible article
text, freezes editor selections and inserts owned translation nodes without rewriting original
HTML. Explicit writeback rechecks the original node, text and selection. Each answer records
the attachment token used to generate it, so changing attachments cannot redirect an old answer.

`src/workspace/page-actions.ts` owns site preferences, visit hiding, finite page actions and
one-use workspace handoffs. The content-facing `oneweb.page-action.v1` protocol derives identity
from the browser sender and cannot read keys, configuration or history. Its Shadow DOM surface
requires trusted user clicks for selection actions. Global/site/visit hiding remain distinct.
Navigation, permission revocation and disposal cancel page work and clean owned UI/listeners;
stopped translation jobs recheck cancellation immediately before applying a batch.

The workspace lifecycle port cancels its owner's generation and restores page translations on
disconnect. Worker restart marks unfinished saved answers as interrupted. History disabled
follow-ups fork temporary conversations and are never backfilled when saving resumes. Persisted
file attachments can be reused after restart; live page/editor tokens must be recaptured.
Assistant history and prompts use `oneweb.assistant.v1`, credentials use
`oneweb.assistant.secret.v1`, navigation uses `oneweb.workspace.v1`, and page preferences use
`oneweb.page-assistant.v1`. These do not replace other modules' stores.

The [workspace SDD](specs/monica-workspace.md) defines MW-01–MW-22 and the approved T1–T4 public
test seams. The [checkpoint](checkpoints/monica-workspace-implementation.md) maps them to actual
tests and records the limits of Chromium/local-provider verification.

## Browser tasks P0–P1

`page-tools.ts` owns scoped action metadata, lightweight templates, favorites, recents and toolbar
preferences. Only custom actions have a page-editable template interface; workspace prompts
expose metadata and resolve privately for execution. Module actions use existing packaged tool
entries. `page-actions.ts` authenticates the browser sender against the active tab, same origin,
native document and permission. A stale same-origin SPA sender URL is accepted only with the
matching native document, while source URLs come from the actual tab.

Editor snapshots include a native caret or ordinary contenteditable Range. The page surface
preserves that target across its own writing form, and insertion/replacement remain separate
explicit operations with unchanged original-text/live-selection checks. Compose/reply retry
retains the exact previously approved instruction and context.

Dynamic translation uses a document-owned MutationObserver with a 300 ms debounce. The background
serializes incremental scans and fixed eight-block model batches. Block IDs deduplicate unchanged
sources; changed sources discard only their own prior translation. A document may contribute at
most 512 blocks / 512 KiB. Stop, navigation and revocation disconnect the observer and abort pending
work; hitting a limit stops observation and reports truncation. Translation-only mode uses an
owned stylesheet/attribute and never overwrites website class/style or restores old page HTML.
Automatic translation is explicit exact-site consent; a stop suppresses automatic restart for
that document visit.

`BrowserTasksSurface` contains nearby task dialogs using the finite page protocol. Quick Ask owns
a separate conversation and a locally frozen optional selection. Each turn explicitly selects
none/page/selection context; the provider receives no page body by default. Link lookup reads
bounded real anchors; opening validates HTTP(S), and search uses a fixed Google URL.

`VideoReadingController` uses the public fixed discovery readers, subtitle loaders and parser,
not VideoDubbingController connections, caches or player injection. Its immutable public source
binds owner, tab, native document, platform, video/part, media source and track for ten minutes.
Native loaded text tracks and explicit imports share normalized cues. Model inputs are capped at
54 KiB of timestamped transcript plus the question, with visible truncation. Seek accepts an
existing cue ID and rechecks source identity and permissions. Settings requests discovery origins
first, displays the actual validated caption origins, then requests those separately.

`ClippingController` serializes local writes and enforces 500 entries / 4 MiB total / 64 KiB each.
`PageQuoteAnchors` indexes bounded visible text and uses exact quote, prefix/suffix and source
offsets. It never silently picks among duplicate matches. Locating scrolls to and selects the
range without wrapping or replacing the site's DOM. Revisit opens the saved full HTTP(S) URL,
waits for page completion and reports a found/missing/changed/ambiguous state.

`VisionController` independently owns configuration, credentials, captures and image requests.
It uses the actual active visible tab, not the workspace fallback page. A finite runtime command
reports viewport and selected image rectangles; the background validates them before native
capture, hides owned UI, decodes real PNG pixels with ImageBitmap, crops with OffscreenCanvas,
and rechecks tab/document/viewport before returning a transient preview. At most four captures
may exist, up to 8 MiB / 4096² pixels each, with a three-minute token lifetime. Owner epochs discard
captures cancelled while the browser API is pending.

Vision sends actual text/image_url content to a fixed compatible chat/completions endpoint,
with redirect rejection, omitted cookies, a 90-second timeout, at most two active requests and
a 2 MiB response bound. It validates the task's JSON text/translation/answer field and renders
plain text. Page callers cannot read or change provider configuration/credentials. No capture
or image answer enters assistant history. Tab change, navigation, revocation and explicit
discard invalidate authority and cancel work. Provider-origin ownership participates in shared
permission cleanup.

The [browser task SDD](specs/browser-tasks-p0-p1.md) and
[checkpoint](checkpoints/browser-tasks-p0-p1.md) record the approved T1–T4 seams and production
fixture evidence separately from live platform/model and Firefox validation.

## Current RepoLens implementation

The current RepoLens tool uses its packaged view and finite background controller, described in
[the application spec](specs/smart-apps.md). It requests public GitHub APIs directly after an explicit
analysis action and optional permission grant. The legacy remote seeded record upgrades by ID to
the builtin. There is no runtime dependency on the independent RepoLens server.

The following bridge flow describes the retained remote-platform conformance fixture and legacy
independent RepoLens integration:

1. `src/modules/providers/github-repository-observer.ts` observes GitHub History API, Turbo and
   PJAX navigation with a short debounce. It emits a provider update or an explicit removal when a
   SPA route stops being a repository.
2. `src/background/main.ts` delegates source validation, normalization, per-tab state and dedupe to
   `ContextBroker`, then sends a generic active-tab snapshot to the panel. A URL-only
   `tabs.onUpdated` fallback covers Firefox MV3 event-page suspension during full navigation.
3. When the user opens RepoLens, `src/sidebar/main.ts` selects its record and delegates the iframe to
   `ModuleFrameHost`. The host verifies the initial window message, transfers a nonce-protected
   `MessageChannel`, and sends only the intersection of provider output, manifest
   `context_fields`, and installed field grants. The iframe is sandboxed and cannot use extension
   APIs.
4. RepoLens `/embed` shows a cached summary first. Deep analysis happens after dwell time or when
   the user presses the button.

Chromium artifacts use `side_panel`; Firefox artifacts remove that key and add `sidebar_action`.
The build defines `__FIREFOX__` so Chromium-only APIs are removed from the Firefox bundle rather
than merely guarded at runtime. Firefox packages must pass `web-ext lint --warnings-as-errors`.

## Packaged Cookie Manager

`src/modules/builtin/cookie-manager/` owns the native cookie boundary, in-memory session authority,
strict plain-JSON codec and finite runtime protocol. Only trusted packaged management pages can
use it; no Cookie capability is added to remote modules. The seed is disabled and the manifest
declares `cookies` as optional. Permission requests originate directly in a user click handler.

`src/sidebar/cookie-manager-view.ts` contains the independent management UI; the existing module
manager only mounts it and forwards lifecycle events. The controller enumerates each accessible
Store and preserves raw domain/path/name/hostOnly and complete partition identities. Writes are
serialized, recheck permissions and compare current browser state against the reviewed snapshot.
Deletion also verifies the exact target selected by the native URL/name API before removing it.
Browser APIs offer no atomic compare-and-swap, so website changes between verification and mutation
remain possible.

Snapshot/preparation authority is limited to eight sessions and ten minutes. Disable, revocation,
close or expiry cancels pending authority. Cookie values never persist to extension storage and
leave the extension only through explicit clipboard or plaintext JSON download actions. Active
scope overlap is registered with the existing shared-origin coordinator. The behavior and public
test boundaries are specified in [Cookie Manager SDD](specs/cookie-manager.md).

## Packaged Video Dubbing

`src/modules/builtin/video-dubbing/` owns bounded subtitle import, the media-time session,
trusted management and player protocols, local service configuration and fixed compatible
translation/TTS requests. Its builtin seed is disabled. `src/sidebar/video-dubbing-view.ts`
is mounted independently at its tool entry; no remote-module capability is introduced.

The background classifies the active tab as YouTube, Bilibili or an import-only HTML5 page and injects the fixed
`dist/videoDubbing/index.global.js` artifact only after explicit site authorization. A fixed
MAIN reader returns bounded player identity and caption metadata. The isolated player can
observe native same-video timedtext resource URLs via PerformanceObserver, allowing native CC
requests to refresh a matching track without network monkey-patching or a webRequest grant.
An empty YouTube subtitle response permits one bound `refresh-captions` message to the isolated
player, which refreshes its native CC button even if CC was already enabled. The background waits
at most six seconds for a matching origin/video/language/kind request and retries its original
encoded URL once. Stop, seek, navigation, disconnect and permission loss cancel that wait.
Website metadata and resource URLs are validated again in the background. Player work is
bound to tab, native document identity where available, video, host session and generation.
Firefox falls back to a live port/URL binding when its scripting API lacks native document IDs.
Chrome may report the initial document URL after a SPA navigation: when a native document ID is
available, reconnection checks that ID, sender origin and the tab's current video identity together.

`sites.ts` owns URL/video identity, including Bilibili BV/AV and part number. Its fixed MAIN reader
projects only video metadata and bounded part/CID data. The background requests Bilibili's fixed
`https://api.bilibili.com/x/player/wbi/v2` endpoint after explicit exact-origin authorization.
Validated subtitle URLs are limited to known HTTPS `hdslb.com` subtitle hosts and `/bfs/subtitle/`
or `/bfs/ai_subtitle/` JSON paths. A direct start action requests the chosen CDN grant; subtitle
fetches omit website credentials. API/login failures keep an explicit import fallback. Generic
pages project only URL/title and video availability and never supply arbitrary subtitle URLs.
Both discovery responses and subtitle bodies are bounded to 2 MiB with a 20-second timeout and
redirect rejection.

Only the background holds service keys and performs service HTTP calls. The page requests
existing cue IDs, never arbitrary URLs or headers. The isolated content script owns actual
video events, a pitch-preserving audio element, object URLs and the bilingual overlay.
A first sentence is prepared independently, then batches of at most three cues fill a
30-second window. Player audio caches are capped at 20 MiB; a recent-result retry cache in
the background is capped at 12 MiB and six cue records. Successful results survive an
explicit failed-item retry, while stop, configuration changes and disconnect release them.
An active cue failure retains the engine-owned video pause instead of releasing it. Explicit
resume retries the current media position; stopping dubbing releases that pause when appropriate.

No service worker owns media. Port loss stops the player, aborts work and restores original
volume/mute while retaining user speed changes. Navigation and native document replacement
invalidate the session; new video content requires another explicit start. Site permission
revocation also checks all platform API/CDN origins currently owned by the session. Non-YouTube
media-source replacement stops playback; rebinding clears the previously imported subtitle.
Site permission cleanup consults the existing shared-origin coordinator so another builtin's overlapping
grant remains available. See [Video Dubbing SDD](specs/video-dubbing.md).

## Target stack

- **Manifest V3 first**, with Firefox compatibility isolated behind manifest generation branches.
- **Vue 3 + Vite + TypeScript** for extension pages, background/service worker, content scripts, and DevTools surfaces.
- **Strict TypeScript** with bundler module resolution, isolated modules, modern ES targets, and incremental type checking.
- **Vitest + Vue Test Utils + V8 coverage** for unit/component tests.
- **Playwright extension E2E** for Chromium smoke tests against the built `extension/` directory.
- **GitHub Actions quality gates** for install, typecheck, lint, coverage, build, artifact upload, and optional store publishing.

## Architecture principles

1. Keep privileged extension logic in background modules and expose narrow message contracts to pages/content scripts.
2. Treat manifest permissions as product surface area: prefer optional permissions and explicit user activation for sensitive APIs.
3. Keep content scripts idempotent so repeated injection cannot mount duplicated UI or listeners.
4. Keep build configs DRY by sharing Vite defaults and using small entry-specific configs only for output shape.
5. Run typecheck, lint, coverage, and build in CI before producing extension artifacts.

Clash Control follows the same trust split. Phase 4A selected a packaged builtin connector through
[`ADR-0001`](adr/0001-clash-control-packaged-builtin.md): the trusted background alone can attach a
one-shot secret to fixed read-only localhost endpoints, while remote frames retain only the generic
field-filtered context bridge.

## Upgrade backlog

- Split `src/background/main.ts` into menu, commands, debugger, DNR, side panel, and messaging modules.
- Convert broad host permissions into optional host permissions where product flows allow it.
- Add contract tests for message payloads and storage migrations.
- Raise coverage thresholds as critical background/content logic gains tests.

## Standalone userscript target

Page Toolbox's seven finite DOM tools are shared by the extension and a separate locally bundled
userscript IIFE. `src/userscript/` supplies only GM storage/menu, explicit per-origin settings and
document lifecycle. It does not emulate extension APIs or reuse background RPC. Manager installation
grants and OneWeb's application-level site switch are separate. Browser-privileged tools remain
extension-only. See [ADR-0025](adr/0025-oneweb-userscript-distribution.md).
