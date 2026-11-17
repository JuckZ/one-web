# OneWeb privacy and data inventory

> Updated: 2026-11-17. This file is the engineering source of truth for extension manifests,
> Firefox data-collection permissions, store disclosures and the public privacy policy. Any new
> context, remote capability, controller or telemetry sink must update this inventory in the same
> change.

## Product boundary

Network Management stores only the user's WebRTC policy, three page-blocking preferences and
explicit protection intent in `oneweb.network-management.v1`. Optional `privacy` access changes
the WebRTC IP policy. Chromium uses a regular-profile-only override. Firefox uses its native
regular setting, which also applies to private windows; the management view explains this before
applying it. This does not grant the extension permission to run in private windows. Optional HTTP/HTTPS host access enables fixed page
scripts that hide RTC/media objects without reading page content or sending network requests.
Disabling protection releases OneWeb's own policy override and scripts; existing documents need
a reload to regain their native objects. The explicit leak-test button opens an external website,
which receives an ordinary browser visit; OneWeb sends no additional diagnostic payload.
Clash secrets retain their existing transient, trusted-background-only lifecycle.

OneWeb is a packaged browser extension and module host. Packaged built-ins may process data locally.
Remote-frame modules run at an explicit user-reviewed HTTPS origin and receive only the context
fields and capabilities approved for that module. The remote frame has no direct browser API access.

OneWeb does not include advertising, cross-product tracking or product analytics. Data is sent only
to provide a user-enabled module or controller operation. “Required” in Firefox's installation
prompt describes the data classes the product must be allowed to transmit when those features are
used; it does not mean OneWeb continuously uploads browsing data.

## Firefox manifest declaration

OneWeb declares these required data types:

| Firefox type             | OneWeb data                                                                                                                                              | When transmitted                                                                                                                      | Recipient/purpose                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authenticationInfo`     | User-entered controller token/secret and translation/TTS API keys; short-lived RepoLens authorization material; browser-managed platform session cookies | Only while connecting to or authenticating a user-selected service, or explicitly reading platform subtitles                          | Exact approved controller, RepoLens or translation/TTS origin; website cookies only to the matching fixed platform endpoint                                  |
| `browsingActivity`       | Exact current URL/domain, GitHub `owner/repo`, page type, navigation identity and selected video BV/AV/CID                                               | Only for an enabled module with reviewed context grants, an explicit Send to OpenList action, or explicit platform subtitle discovery | Exact installed remote-module origin, selected OpenList endpoint or validated platform metadata/subtitle endpoint; provide the requested page/video behavior |
| `websiteContent`         | Page title/description/image, selected text, link/media URL, user-selected video subtitles                                                               | Only after the matching context grant or explicit capture/submit action                                                               | Exact installed module/controller or selected translation/TTS service origin; perform the user-requested feature                                             |
| `personalCommunications` | User-entered assistant messages and explicitly selected or imported communication text                                                                   | Only when the user sends a chat, writing, reading, selection or translation request                                                   | Exact user-configured model service; produce the requested answer or translation                                                                             |
| `searchTerms`            | Up to 200 characters of explicitly selected non-input page text                                                                                          | Only after the user clicks a fixed npm or GitHub search link                                                                          | The chosen npm/GitHub search page; no referrer, automatic search or persistent query history                                                                 |

The assistant also uses `authenticationInfo` for its provider key and `websiteContent` for
explicitly attached page text, selections and imported subtitles. Saved source URLs have query
and fragment removed. The browser still processes the full URL transiently to validate document
identity. Enabling the page toolbar alone does not send page contents to a model.

OneWeb does **not** declare:

- `technicalAndInteraction`: there is no product telemetry, analytics or remote crash reporting.
- `bookmarksInfo`: Bookmark Doctor reads and edits bookmarks only inside the packaged extension;
  remote modules cannot request its privileged bookmark capabilities.
- Location, health, financial or identifying information: OneWeb does not implement
  dedicated collection of those categories. Assistant text is user-directed free text; users can
  choose to include sensitive information in a request to their provider.

Firefox `strict_min_version` is 142 so every supported desktop or Android installation has the
built-in data-consent schema. Firefox Android remains an exploratory product target until its UI
entry and consent flow pass real-device tests. The new workspace/assistant has Chromium production
test evidence; Firefox manifest generation is tested separately and does not establish equivalent
Firefox UI, shortcut, consent or editing behavior.

## Data-flow inventory

| Flow                         | Source                                                                          | Local storage                                                                                                                                                   | External transfer                                                                                    | Retention/control                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RepoLens builtin             | GitHub repository context or explicit public repository input                   | `oneweb.repolens.v1`: 12 cached analyses (6h freshness), up to 50 repositories × 90 analysis-date Star snapshots; Token in session unless explicitly remembered | Fixed public-repository GET requests to `https://api.github.com`, optional user PAT                  | Explicit analysis and origin permission; stop/disable/revoke cancels; clear deletes caches/snapshots; blank Token save removes credential               |
| Smart page tools             | User template plus explicitly captured page or selection                        | `oneweb.smart-apps.v1` holds app definitions; results/source use existing Assistant history preference                                                          | Rendered text and explicitly attached source to existing configured model provider                   | No automatic capture; explicit run, existing exact-origin permissions; app disable/delete closes local run; Assistant history deletion remains separate |
| HTML mini apps               | User-authored/imported or explicitly AI-generated HTML                          | Same bounded app library; interaction state only in sandbox memory                                                                                              | AI generation sends the entered app idea to configured model; running HTML has no network capability | Explicit preview/save/run; closing/disabling removes iframe; imports disabled until reviewed; export includes app definitions only                      |
| User-installed remote module | Context broker                                                                  | Manifest, grants and module-owned state                                                                                                                         | Only approved context fields to the exact manifest origin                                            | User can disable/uninstall module and revoke its origin permission                                                                                      |
| Send to OpenList             | Explicit page/link/media action                                                 | Exact-origin profile and token in extension storage                                                                                                             | Candidate URL/content and token to the chosen endpoint                                               | User can disconnect/delete profile and revoke origin permission; service retention is user-controlled                                                   |
| Clash Control                | Explicit configured controller                                                  | Exact-origin profile and secret in extension storage                                                                                                            | Authentication and requested controller commands                                                     | User can disconnect profile and revoke exact-origin permission                                                                                          |
| Browser Journal              | Active tab after explicit start                                                 | Local bounded session/archive                                                                                                                                   | None                                                                                                 | User stops session and deletes local archive                                                                                                            |
| Bookmark Doctor              | Browser bookmarks                                                               | Local scan/repair state                                                                                                                                         | None                                                                                                 | User-triggered only; browser/extension storage controls deletion                                                                                        |
| Page Toolbox                 | Current page after explicit action                                              | Local module state                                                                                                                                              | Only fixed npm/GitHub search links after a user click; no referrer                                   | Exact-origin permission, preview and explicit action gates                                                                                              |
| Video Dubbing                | Explicitly selected video subtitles or imported SRT/VTT                         | Module-specific local service configuration and keys; transient subtitle/audio cache                                                                            | Bounded subtitle text and authentication to selected translation/TTS services after explicit start   | Stop, disable or revoke to end sessions; delete configuration to remove keys; provider controls remote retention                                        |
| Assistant                    | User messages and explicitly captured page/selection or imported text/subtitles | Local messages, attachment snapshots, favorites and prompts by default; provider key in session storage unless explicitly remembered locally                    | Bounded messages/reference text and authentication to the exact configured model origin              | Disable future history, delete a conversation or explicitly clear all history/favorites; provider controls remote retention                             |
| Workspace and page assistant | Navigation, chosen tool, enabled sites and explicit selection actions           | Local destination, tool favorites/recents and site/global preferences; visit hiding and handoff tokens in memory                                                | No transfer solely for navigation or displaying the toolbar                                          | Tool navigation leaves business data intact; hidden sites/global switch can be restored in settings                                                     |

## Assistant and explicit page context

## Smart applications and RepoLens migration

### Opt-in real LLM acceptance tooling

`ONEWEB_LIVE_LLM=1 pnpm test:live-llm` is developer tooling excluded from ordinary tests and the
extension package. It reads effective Codex provider configuration locally. A temporary loopback
relay retains the actual Magpie key in Node memory and forwards only the configured model's text
chat to the fixed endpoint, without browser cookies or redirects. The disposable browser receives
a synthetic alias. Only synthetic randomized page/selection facts and a counter request leave the
machine. Real model responses stream without fixture substitution. No user page/profile is read.
The relay has payload limits, timeout, abort cleanup and status-only upstream errors.

Trace/screenshots/video are disabled. The JSON report records outcomes and model/status/timing/byte
metadata, never actual tokens or upstream headers; prompt/response bodies are not metadata.
Assertion failures can include synthetic facts or generated code. The isolated profile is deleted
at teardown and the relay closes its sockets. Gateway/provider retention remains service-defined.
No production telemetry, permission or model protocol setting is added.

The current RepoLens seed is a packaged builtin, not a remote service integration. No legacy
`.env`, server credentials or data are automatically imported. Public GitHub data is filtered to
exclude private repositories before caching/reporting. The background sends a PAT only to fixed
GitHub API GET routes, omits cookies and referrers, rejects redirects, limits response sizes and
uses request/overall timeouts. Its public configuration exposes only key presence. GitHub origin
permission is optional and requested from an explicit Analyze action. The former localhost host
grant is absent from production; the remote SDK fixture grants its own test origin in isolation.

Smart-app definitions are restricted to 50 entries/2 MiB, mini-app HTML to 256 KiB and prompt
templates to 16 KiB. CRUD/import/export protocols accept only trusted packaged management pages.
Templates have a finite variable set and outputs are text. Imported apps receive fresh IDs and
are disabled. Export does not include service keys, history or RepoLens caches.

Mini-app source executes only in the packaged manifest sandbox and a nested opaque iframe.
The render-only handshake accepts the expected window plus nonce and bounded payload; there is
no storage/network/capability RPC. CSP rejects external scripts/resources, network endpoints,
child frames, workers, object, form submission and base changes. Sandbox attributes omit
same-origin, popup, top navigation, downloads and browser privileges. The early bootstrap disables
WebRTC peer networking. HTML may still consume CPU/memory; no process resource guarantee is made.
App interaction state is not persisted. Removing an app does not remove model-generated content
already saved under the user's existing Assistant history preference.

## Assistant data retention

The assistant accepts a user-configured HTTPS or loopback HTTP chat-completions service. Its
background controller alone attaches the provider credential to the fixed `chat/completions`
endpoint. Requests omit browser cookies and reject redirects. Saving configuration requests
exact-origin permission without sending a model request. Provider responses are displayed as
text, not executable HTML. The content page and remote modules cannot read provider configuration,
history, prompts or credentials through their protocols.

Non-secret configuration, history preference, prompts and saved conversations live under
`oneweb.assistant.v1`. Conversations include user/model messages, model/intent, favorite flags
and explicitly attached text with source metadata. History is bounded to 100 conversations,
64 messages per conversation and 8 MiB overall; reaching a limit reports an error without
automatically deleting favorites. Imports are explicit UTF-8 TXT/MD/SRT/VTT up to 64 KiB.
Reopening an imported conversation reuses its saved text snapshot.

`oneweb.assistant.secret.v1` holds the key in `storage.session` by default. Selecting
**记住服务密钥** persists it in `storage.local`; these stores are not encrypted credential vaults.
Saving with remembrance disabled moves the key to session storage and removes the local copy.
The browser ends session storage with its session; removing the extension or clearing its
extension storage removes retained local data. Reads sent to the UI expose only `keyConfigured`.
The background restricts storage access to trusted extension contexts where supported.
Assistant and Video Dubbing credentials remain independent.

Users can disable future history, delete individual conversations or explicitly confirm clearing
all history and favorites. With saving disabled, continuing a previously saved conversation forks
an in-memory conversation; later turns do not modify the saved original and are not backfilled
when saving resumes. Deletion clears OneWeb's copy, not records already received by the provider.
Provider retention, training settings and billing are controlled by that chosen service.

The fixed isolated content runtime is injected only for an explicit authorized page operation or
an enabled authorized site toolbar. Body extraction excludes hidden elements, scripts, form control values,
password fields and OneWeb's UI. Selected native editor text is read only through an explicit
selection action. Page text is capped at 64 KiB, selection text at 16 KiB; attachment source URLs
strip query and fragment before retention. Page text remains untrusted reference material and
cannot grant extension authority.

Page/editor tokens expire after ten minutes and bind to the owner, tab, document and source.
Navigation or permission revocation invalidates live page operations while saved conversations
remain readable. Writing results require a separate click and reject changed editor text or
selection. Translation inserts separately owned nodes; stop cancels remaining batches and restore
removes owned translations without restoring old page HTML. Page selection actions cannot pass
arbitrary endpoints, headers, scripts, storage keys or provider credentials.

Navigation metadata uses `oneweb.workspace.v1`. Global/site toolbar preferences use
`oneweb.page-assistant.v1`; temporary visit hiding and one-use handoff drafts stay in memory.
Toolbar visibility alone does not initiate a provider request. Closing a workspace cancels its
in-progress answer and preserves its partial saved text. Timeout, cancellation and network
failure do not automatically retry a provider call.

## Browser tasks P0–P1

Scoped custom actions, favorites, recent action IDs and toolbar settings persist locally under
`oneweb.page-tools.v1`. They contain plain-text templates, never executable scripts.
Toolbar preferences also store up to four pinned action IDs and a selection target-language code;
changing these controls alone does not capture page content or call the model. Retrying an existing
selection request retains the language captured for that request.
The same local record stores whether the page dock stays visible. Fixed visibility does not start
model requests; page summary and page-context questions still require their own user actions.
Site preferences under `oneweb.page-assistant.v1` may include explicit automatic translation consent,
language and display settings. Enabling an assistant launcher alone does not send page text;
an opted-in automatic translation site does send bounded current/dynamic paragraphs on later
visits. Stop suppresses automatic restart for the current document, and restore removes only
owned translations/styles. At most 512 paragraphs / 512 KiB are collected per document.

Quick Ask snapshots selected text locally when opened so writing in its own input does not
change the selected source. Only the explicitly chosen context for that turn is attached to a
provider request. Questions, answers and video-reading transcript prompts use the existing
assistant history preference; with history enabled these persist locally, and users can disable
future saving or delete history through the existing controls. A fixed Google search opens only
after an explicit user action and transmits that entered search string. Current-page link lookup
does not initiate web search.

Video reading performs only fixed public player/caption discovery after exact-origin consent.
YouTube/Bilibili requests retain their existing platform cookie behavior; no website cookie is
extracted or sent to model providers. The selected transcript, cue identifiers, times, title and
explicit question may be sent to the configured text provider. Caption source URL signatures stay
in transient background memory and are not sent to the model. Generic video reading supports
loaded native text tracks or explicit SRT/VTT import, not arbitrary caption endpoint scraping.
Its source tokens expire after ten minutes and old sources cannot seek after a video/document
or permission change. It neither uploads media nor starts the dubbing module.

Clippings persist under `oneweb.clippings.v1`: selected quote, nearby textual anchors, title,
timestamp, user note and the complete HTTP(S) source URL, including its query/fragment as
explicitly saved by the user. Unlike scrubbed assistant attachment URLs, this complete local
source supports accurate revisiting and may contain site-specific identifiers. Notes are not
automatically sent to providers. Edit/delete are local operations. Limits are 500 items,
64 KiB per item and 4 MiB total; deleting removes OneWeb's stored copy.

Vision has independent `oneweb.vision.v1` configuration and
`oneweb.vision.secret.v1` session credentials. The default secret is session-only; opting into
remembering stores it locally. Public configuration returns only `keyConfigured`. Only packaged
settings can change or delete this configuration, and deleting cancels active image work. This
provider's origin is registered with the shared-origin coordinator.

Screenshot capture is explicit and uses actual current visible-tab pixels. A chosen full visible
image is captured from the page's displayed rectangle, not silently downloaded at an arbitrary
URL. Owned OneWeb UI is hidden during capture. The background validates origin permission, tab,
window, native document, viewport/device scale, scroll position and rectangle, crops locally and
shows a preview. The shipped manifest retains activeTab; a denied capture explains the browser
toolbar activation requirement and does not request all-site capture permission.

Only a separate confirmation sends the preview image, task, language and question to the exact
configured image-capable provider. The fixed image_url contract omits cookies and rejects
redirects; requests time out at 90 seconds. Image text is untrusted material, never an instruction
to execute. Captures are bounded to four transient entries, 8 MiB / 4096² pixels each, with
three-minute token validity. Navigation, permission change or explicit discard cancels work and
releases entries; expired entries are pruned on later capture. Screenshots, OCR/translation/image
answers never enter assistant history, generic module storage, remote frames or sync. Physical
memory erasure and provider-side retention are not guaranteed by releasing JavaScript references.

## Cookie Manager local data

Cookie Manager is disabled by default. Its packaged background and management page handle cookie
names, values (including HttpOnly), domains, paths, attributes, accessible Store IDs and full
partition identities. Data exists only in transient memory and explicitly copied values or
downloaded plaintext JSON files; it is never persisted to extension storage. No cookie data enters
the remote-module context/capability bridge, logs, diagnostics or network requests. The existing
Firefox `authenticationInfo` transmission declaration does not cause Cookie Manager to upload cookies.

Export warns that JSON includes plaintext credentials. Import reads a local JSON file, validates
and previews it, requires an explicit destination Store and writes only selected records. Files,
records and batches are bounded; no third-party decryptors or historical format detection exist.
Background sessions last at most ten minutes and are lost on worker restart. Old visible UI data is
cleared on the next failed session operation after a worker restart; no immediate restart notification
is claimed. Close, hide, disable, revocation or expiry clears the management session. JavaScript
reference release does not guarantee physical memory erasure. Clipboard contents and downloaded
files remain under user/browser/OS control after a management session ends.

Cookie and host permissions are optional. Browser host grants are shared between modules. Ending
Cookie management clears its own authority, preserves shared browser permissions and never deletes
browser cookies. Its active-scope probe prevents other builtin permission cleanup from releasing
an overlapping grant still in use.

## Video Dubbing

Video Dubbing is a manual, disabled-by-default packaged builtin. Explicit save persists only
its own translation/TTS base URL, model, voice and API keys under
`oneweb.video-dubbing.config.v1` in local extension storage. Keys never enter sync, Registry
state, the context bridge, remote modules, MAIN-world code, player messages or logs. Public
management responses expose only service metadata and `keyConfigured` flags. Blank key fields
retain a saved key only for the same normalized base URL; deleting configuration removes keys
and stops active sessions.

Explicit start sends bounded selected subtitle text, cue IDs, target language, model/voice and
the corresponding credential to the exact configured and authorized service origin. The fixed
adapter accepts HTTPS or user-configured localhost/127.0.0.1 HTTP and rejects credentials in
URLs, fragments, arbitrary routes and redirects. These transfers fall within the existing
`authenticationInfo` and `websiteContent` Firefox declarations. Service-side retention is
controlled by the selected provider; cancellation cannot reverse already incurred cloud costs.

Platform subtitles are fetched only from a validated YouTube timedtext URL or a validated Bilibili
subtitle CDN URL for the bound video/part. Bilibili's fixed `api.bilibili.com/x/player/wbi/v2`
metadata request sends only the selected BV/AV ID and CID after explicit API-origin authorization.
Browser-managed website session cookies may accompany this fixed platform request; the extension
does not extract, persist or send those cookies to translation/TTS providers. Starting a selected
Bilibili track requests its exact validated CDN origin; the CDN fetch omits credentials and rejects
redirects. Only known HTTPS subtitle hosts and JSON subtitle paths are accepted, not arbitrary
page-provided endpoints. API/subtitle responses are bounded to 2 MiB and a 20-second timeout.

Native CC resource URLs may contain short-lived website signatures; they remain in background
session memory and are never sent to translation/TTS services or stored in diagnostics. The
empty-response recovery refreshes only the current player's native CC button and leaves CC
enabled; it adds no network interception, platform token generation or service credentials to
the page. Only an already-known, matching track can satisfy the bounded recovery wait. The
MAIN reader projects caption metadata only; it does not return streaming URLs or whole player
responses. Imported SRT/VTT, translations and returned audio are bounded in-memory session data,
not persisted subtitle history. Source video/audio is neither captured nor uploaded.
On other explicitly authorized HTTPS/loopback pages, import-only mode retains the current page URL
and title transiently to bind a single top-level HTML5 player. It does not scrape subtitle endpoints
or enter cross-origin frames. Media replacement or rebinding clears the previous import authority.

The isolated player owns audio objects, overlay and listeners. Stop, disable, matching permission
revocation, navigation and port loss abort pending authority, release transient resources and
restore original media volume/mute. The browser may keep a shared origin grant when another
builtin uses it; stopping dubbing still revokes the module's current sessions. Explicit service
configuration deletion does not remove browser permissions that may be shared.

## Engineering rules

1. Content scripts collect only schema-declared fields; never upload DOM, form values, private code
   or page bodies implicitly.
2. A remote module receives the intersection of provider fields, manifest request and installed
   grants. Unknown fields fail closed.
3. Every network-capable feature uses an exact origin. Credentials, fragments, broad wildcards and
   non-loopback cleartext origins are rejected.
4. Tokens never enter URLs, logs, screenshots, diagnostics or module-owned generic state.
5. Revoking an exact-origin permission clears the matching authority and prevents further requests.
6. New telemetry is prohibited until it has a separate opt-in design, retention period, deletion
   path and `technicalAndInteraction` permission flow.
7. Store declarations and the public privacy policy must be reviewed against this file before each
   release candidate.

## Release evidence

For each release, record without secrets:

- effective manifest data permissions and minimum Firefox version;
- contexts/capabilities added or removed since the previous version;
- network origins present in the final package;
- tests proving permission revocation and module isolation;
- reviewer and date for this inventory.

## Userscript and expanded page tools

The standalone `OneWeb` userscript executes only in top-level HTTP(S) documents and uses the
manager's DOM sandbox with finite GM storage/menu/change-listener grants. Installation matches all
HTTP(S) sites; OneWeb's per-origin opt-in is an application setting, not an extension host permission.
GM keys `oneweb.userscript.v1:<exact-origin>:approved` and `:tool:<fixed-id>` contain booleans only.
No extension state, old OneMonkey state, page localStorage, password values, cookies or telemetry
is imported. The manager owns retention; OneWeb's Forget command deletes this origin's keys and
drains its DOM immediately. Manager-level removal/disable may require refreshing open documents.

The shared geometry inspector reads two user-selected elements' rectangles only. Hidden-content
reveal scans at most 1500 existing visual DOM nodes and changes at most80; form/credential/editor
containers, executable nodes and frames are excluded. The reading dimmer owns a pointer-transparent
overlay. Selection search retains at most200 characters in memory, excludes input/textarea selections
and sends only an explicitly clicked fixed npm/GitHub query in a new tab with no referrer. Disabling
the tool clears links and text. These flows do not invoke a model, request remote code or expose a
generic selector/action API. Extension storage/settings and GM settings are independent.

## Userscript distribution updates

The standalone OneWeb runtime makes no update requests. Its script manager reads the canonical
`https://github.com/JuckZ/one-web/releases/latest/download/one-web.meta.js` and, on a newer version,
downloads `one-web.user.js` from the same release channel, following GitHub's asset redirects.
This is manager-owned installation/update traffic, with ordinary IP/client network metadata and
manager-configured timing; it does not include page content, selections, GM settings or provider keys.
Users control automatic updates and script removal in their manager. No OneWeb telemetry or LLM call
is added. Runtime selection-search disclosure above remains separate from software distribution.
