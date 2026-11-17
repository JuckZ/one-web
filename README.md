# OneWeb

OneWeb is a modular browser companion that brings search, organization, browser utilities and
smart analysis into one side workspace. The private root package and browser-facing identities use
the OneWeb name; RepoLens is one module rather than the host identity.

RepoLens is a packaged OneWeb application. It analyzes public GitHub repositories directly from
the native side panel or workspace tab; no independent RepoLens service is required. User-installed
remote modules continue to run through the sandboxed remote-frame host.

Brand sources, alternate concepts and design history are archived in
[`docs/brand/README.md`](docs/brand/README.md).

The architecture for user-installed modules is documented in
[`docs/module-platform-architecture.md`](docs/module-platform-architecture.md).
The feature decomposition sequence is tracked in
[`docs/module-decomposition-roadmap.md`](docs/module-decomposition-roadmap.md).
The manifest/store privacy source of truth is
[`docs/privacy-data-inventory.md`](docs/privacy-data-inventory.md).

## 扩展与油猴脚本

OneWeb 同一仓库维护浏览器扩展和独立页面工具脚本。Page Toolbox 提供密码查看、网页自由编辑、
解除选择/复制限制、元素间距测量、夜间阅读减光、已加载隐藏内容查看和选文搜索，共七项默认关闭的工具。

```sh
pnpm build:userscript   # artifacts/build/userscript/one-web.user.js
pnpm verify:userscript  # 构建并测试实际发货脚本
pnpm build:all          # Chromium、Firefox、userscript 三种产物
```

安装、逐站启用、七项工具、更新、回退与卸载见 [油猴用户指南](docs/userscript-guide.md)。
维护者使用 [统一发布流程](docs/releases/README.md)；`pnpm release:rehearse` 本地构建和校验三种目标，
正式版本由精确标签/源码 CI 与完整资产验证后发布到 GitHub Releases。当前尚未创建首个公开 Release，
可按指南安装本地候选文件。脚本与扩展分别保存设置，脚本无需本地服务或 LLM API。

范围、旧功能处置和验收见 [迁移规格](docs/specs/userscript-distribution.md) 与
[架构决策](docs/adr/0025-oneweb-userscript-distribution.md)。

## Unified workspace

**工具 → 新建智能工具** supports **网页标准工具** (page/selection prompt templates) and
**小应用** (editable or AI-generated interactive HTML in an isolated runtime). Search, filter,
enable/disable, edit, confirm deletion, and import/export JSON from the same application list.
Imports are disabled until reviewed. Page tools and AI generation use the model configured in
Settings and run only after an explicit action. HTML apps cannot access the page, extension APIs,
network or persistent storage; their interactive state lasts until closed.

Open **RepoLens** from the list, enter a public repository or use the detected GitHub repository,
then choose **分析项目**. Grant GitHub API access when asked. An optional personal read-only Token
in its connection settings improves rate limits; it stays in session storage unless remembered.
Repository overview, similar projects, maintenance metrics, local snapshots and Markdown reports
work without `repolens-starter` or localhost. See [application spec](docs/specs/smart-apps.md).

OneWeb opens a shared workspace in the native side panel or a full extension tab. The navigation
contains **助手、阅读、翻译、写作、工具**, with **历史、收藏、设置** below. It remembers the
selected destination, tool favorites and recent tools. A removed or unavailable destination falls
back to the assistant with an explanation.

1. Open **设置** or **模型设置**, enter a chat-completions compatible base URL, one model per line
   and your API key, then choose **授权并保存**. HTTPS and loopback HTTP are accepted. Saving
   configuration does not send a model request. A first-time setup preserves the pending draft.
2. Choose a model and send a message. Enter sends; Shift+Enter inserts a newline; IME composition
   stays local. **停止生成** keeps partial output. A failed or cancelled answer requires an
   explicit **重试**; errors do not automatically issue another paid request.
3. In **阅读** or **写作**, use **附加当前页** / **附加选文** and authorize the exact website.
   The attachment shows its frozen source and truncation state. Switching tabs does not replace
   that text; page operations expire after navigation, permission revocation or ten minutes.
   Import UTF-8 `.txt`, `.md`, `.srt` or `.vtt` files up to 64 KiB for reading and follow-up.
4. In **翻译**, choose **翻译当前网页** to insert bilingual paragraphs beside the original
   supported text. **停止翻译** cancels remaining work; **恢复原文** removes only OneWeb's
   translations, preserving page edits. The in-page **网页翻译** panel adds opt-in site automatic
   translation, bounded dynamic paragraphs, translation-only display, font size and styles.
   Cross-origin frames are not read.
5. In **设置 → 网页助手**, enable the current authorized site. Selected text offers translation,
   explanation, summary and rewriting in a Shadow DOM toolbar. Editable selections offer tone
   and length actions, including compose/reply at an empty caret. Results are previews;
   **插入到光标处** / **替换原选文** recheck the original editor and
   selection before writing plain text. The menu offers visit-only hiding, site hiding and a
   global off switch; settings can restore hidden sites.
6. Open **工具** to search, favorite and directly use RepoLens, Page Toolbox, Cookie Manager,
   Bookmark Doctor, Browser Journal, Clash Control, Send to OpenList and Video Dubbing.
   Enable a disabled tool at its own entry. **设置** retains installation, permissions, updates
   and removal controls.

The toolbar icon opens the workspace. Suggested shortcuts are **Alt+Shift+O** for the workspace
and **Alt+Shift+K** for Quick Ask. The browser can reserve shortcuts; adjust conflicts in its
extension-shortcut settings. Context menus offer selection questions, translation, explanation
and page summary. Full-tab mode can use the most recently active ordinary web tab as its source.

The in-page **打开 OneWeb** menu contains these complete browser tasks:

- **网页智能工具箱** searches scoped page/selection/editor actions, favorites and recent actions.
  Create, edit or delete lightweight text templates and configure toolbar visibility/order.
  Workspace prompts appear as actions; **Alt+Shift+T** reveals the toolbar in shortcut mode.
- **Quick Ask** opens a keyboard input panel with explicit none/page/selection context for each
  turn, follow-up questions, current-page link search, URL opening and explicit Google search.
- **网页翻译** saves preferences for the exact authorized site. It translates dynamic text at
  most once per source revision, up to 512 paragraphs / 512 KiB and eight paragraphs per request.
  Stop disconnects observation and cancels remaining work; restore preserves the website's edits.
- **当前视频阅读** reads available YouTube/Bilibili captions or loaded native HTML5 text tracks,
  accepts SRT/VTT import, summarizes and answers with clickable cue times. It checks the actual
  tab, document, video/part and source before seeking and does not start Video Dubbing. Settings
  offers separate discovery and exact subtitle-origin authorization.
- **本机剪藏** saves a quote, complete source URL and editable notes locally. Revisit locates and
  selects the original text, with explicit changed, missing and ambiguous states. Limits are
  500 entries, 64 KiB per entry and 4 MiB total.
- **截图与图片识别** previews actual visible-tab pixels from a dragged rectangle or a fully visible
  image, then explicitly sends them for OCR, translation or questions. In **设置**, separately
  configure an image-capable compatible provider. Captures expire after three minutes and are
  capped at 8 MiB / 4096 × 4096; they are not stored in history. Activate OneWeb from the browser
  toolbar before capturing if the browser requires its temporary `activeTab` grant.

Keys stay in background-owned session storage by default. **记住服务密钥** opts into local
persistence; this is not an encrypted credential vault. History stores messages and explicitly
attached text locally by default. In settings, disable future history, or explicitly confirm
clearing all local conversations and favorites. Continuing a saved conversation with history
disabled forks a temporary conversation; re-enabling does not backfill those private turns.
Custom prompt templates support only `${text}` and `${language}` and can be edited, reordered
and deleted.

The assistant uses the configured provider's fixed `chat/completions` route. Native provider
protocols, cloud research platforms, image/video generation, agents, PDF workflows and automatic
video transcription are outside this delivery. Native textarea/input
and plain contenteditable editing are covered; arbitrary rich-text editors need separate adapters.
New workspace behavior is verified against the Chromium production extension and local HTTP/SSE
fixtures; Firefox UI and paid-model quality require separate validation.

The approved requirements, public test seams and implementation evidence are in the
[workspace SDD](docs/specs/monica-workspace.md) and
[implementation checkpoint](docs/checkpoints/monica-workspace-implementation.md). The seven browser
tasks have their own [SDD](docs/specs/browser-tasks-p0-p1.md) and
[validation checkpoint](docs/checkpoints/browser-tasks-p0-p1.md).

## Extension development

### Real Magpie LLM acceptance

Normal unit and browser suites use deterministic HTTP/SSE fixtures. Real-model acceptance is
separate and opt-in, excluded from ordinary Playwright discovery and CI:

```bash
ONEWEB_LIVE_LLM=1 pnpm test:live-llm
# Repeat against the existing production test build:
ONEWEB_LIVE_LLM=1 pnpm test:live-llm --no-build
```

This builds `artifacts/test/live-chromium` and opens a disposable Chromium profile. The suite reads
the effective provider/model from local Codex `config.toml`, including profile overrides. Magpie
must support `/chat/completions`; the Windows gateway has been validated against this endpoint
even when Codex itself uses Responses. Python3.11+ reads TOML. Override the path with
`ONEWEB_LIVE_CODEX_CONFIG`, or choose a model with `ONEWEB_LIVE_LLM_MODEL`. No key is passed on the
command line.

A temporary loopback relay forwards real requests and response streams without substituting model
output. It keeps the actual key in Node memory, gives the browser a synthetic alias, rejects
redirects, and limits the endpoint/model/payload. It preserves the extension's URL security rules
and does not persist user settings. Tests send only synthetic random facts and an app-generation
request, checking grounded page/selection output, generated HTML interaction, keyboard use,
sandbox isolation, persistence and disable behavior. They never compare a canned answer or retry
a failed generation automatically.

Trace, video and screenshots are off. The JSON report at
`artifacts/test-results/live-magpie/report.json` contains results and metadata attachments
(model, status, bytes, duration), not request headers or gateway credentials. Use fixture suites for
throttling/cancellation/error/byte-boundary regression rather than forcing real paid failures.
The command fails if its browser subprocess is terminated by signal. Network, quota and model
compliance failures remain live failures independently of deterministic regressions.

### 同时开发与测试

完整源码统一位于本仓库；页面助手、视频配音、网络管理和既有工具使用同一套模块注册与构建。
在仓库根目录运行：

```bash
pnpm dev:test          # 开发服务、扩展构建 watch 与单测 watch 同时运行
pnpm verify:chromium   # 可在另一终端运行：生产构建 + 完整 Chromium E2E
pnpm verify:firefox    # 独立 Firefox 生产构建、manifest 校验与临时安装验证
```

Chromium 开发时加载 `artifacts/dev/chromium/`，页面服务为 `http://localhost:3303/`。
只需要开发构建时使用 `pnpm dev`；Firefox 使用 `pnpm dev-firefox`，加载
`artifacts/dev/firefox/`，页面服务端口为 3304。内容脚本和后台变更会重新打包，浏览器中需重新加载扩展；
页面视图使用 Vite 开发服务。

| 用途         | Chromium                                            | Firefox                                           |
| ------------ | --------------------------------------------------- | ------------------------------------------------- |
| 开发 watch   | `artifacts/dev/chromium/`                           | `artifacts/dev/firefox/`                          |
| 具名生产构建 | `pnpm build:chromium` → `artifacts/build/chromium/` | `pnpm build:firefox` → `artifacts/build/firefox/` |
| 浏览器门禁   | `pnpm verify:chromium` → `artifacts/test/chromium/` | `pnpm verify:firefox` → `artifacts/test/firefox/` |

默认 `pnpm build` 仍写入 `extension/`；`pnpm build:all` 顺序生成 Chromium、Firefox 和 userscript 三种生产构建。
不同用途的输出互不清理，旧 ZIP/XPI/CRX 保留。同一输出目录只运行一个构建者；
`pnpm test:watch`、`pnpm typecheck` 和浏览器测试可在开发期间独立执行。
Chromium 门禁的 trace 与截图位于 `artifacts/test-results/chromium/`。
浏览器门禁不依赖失败重试。Linux Firefox 媒体测试会创建并清理测试专用的虚拟音频输出；
已配置 `PULSE_SINK` 时使用指定输出。缺少音频服务时，可通过 `PULSE_SERVER` / `PULSE_SINK`
指定测试端点，测试不会更改默认音频设备。
Chromium 远程模块协议验收使用独立本机 fixture 端口 14747；RepoLens 内置应用不依赖这个服务。已有验收包时，可传入对应目录定向执行 E2E：

```bash
EXTENSION_PATH=artifacts/test/chromium pnpm test:e2e e2e/browser-tasks.spec.ts --retries=0
```

Build Chromium and load `extension/` as an unpacked extension:

```bash
cd /path/to/one-web
pnpm build
```

RepoLens is bundled into this build. No local Node service, deployment origin or extension/server
pairing is required. Release CI no longer requires a `REPOLENS_ORIGIN` repository variable.
That legacy build option remains available for remote-platform conformance fixtures; it does not
grant a production host permission or configure the packaged RepoLens application.

Build, lint and package Firefox separately:

```bash
pnpm build:firefox
pnpm manifest:validate
pnpm pack:xpi
```

Firefox support starts at version 142 so the built-in data-consent UI is always available across
desktop and future Android targets. The
manifest declares the authentication, browsing-activity and website-content classes used by
explicit remote modules/controllers; OneWeb does not ship product telemetry. Chrome support starts
at 148 and uses the native `browser` namespace. A small platform adapter falls back to modern
`chrome` for compatible Chromium hosts without bundling the archived Mozilla polyfill.

Firefox uses the stable add-on ID `one-web@juckz.local`.
The packaged XPI is `extension.xpi` and the unpacked build is in `artifacts/build/firefox/`.

## Video Dubbing

Open OneWeb → **工具 → Video Dubbing** and enable it (disabled by default). Enter your own
translation and speech base URLs, model names, API keys and voice, then explicitly authorize
and save those service origins. The compatible adapter uses fixed `chat/completions` and
`audio/speech` routes; the translation model must support JSON-object output.

On a desktop YouTube `/watch` or Bilibili `/video/BV…` / `/video/av…` video, choose
**授权站点并读取视频**, select a subtitle track or import a UTF-8 SRT/VTT file, set the target
language (for example `zh-CN`) and start. Bilibili authorization includes its exact metadata API
origin; starting a platform track separately requests its validated subtitle CDN origin.
If YouTube returns an empty caption body, OneWeb refreshes the current player's native CC once
and retries the matching track. CC stays enabled. If the selected language is not active in
native CC, select it there and retry, or import subtitles.
If Bilibili subtitles require login, log in on the website and reread, or import subtitles.
Each Bilibili part is bound separately; switching parts stops the old session.

Other HTTPS pages (or explicitly selected localhost HTTP pages) support subtitle import for
a single top-level HTML5 video. Unknown platform captions are not scraped. Pages with multiple
visible videos, cross-origin iframe players, live video or nonstandard players need a dedicated
adapter and currently show an explicit limitation. Replacing the video element/media source stops
the session; rereading the player clears the old import. Container fullscreen is supported;
browser-native video-only fullscreen may hide HTML overlays.

The player displays bilingual text and offers pause/resume/stop; the panel controls original
and dubbed volume. Seeking cancels old work, and disabling, revoking site/service permission,
changing videos or losing the background port stops playback and restores the original media.
Translation or speech errors pause the video at the failed position until an explicit retry,
so waiting for a service does not silently skip the remaining dialogue.

Keys remain in module-specific local extension storage until explicitly deleted. Subtitles and
audio stay in session memory, and subtitle text is sent only to the configured services after
start. Cloud calls already sent may still be billed after cancellation. No ASR, recording,
voice cloning, live/Shorts/embed or media export is included. Production-extension tests cover
real generated media in Chromium and headless Firefox, including decoding, advancing audio time,
pause/resume, seek/rate, stop and revocation. Firefox automation needs an available audio output;
CI uses an isolated virtual sink. This does not establish human listening or paid-provider quality.
See [SDD](docs/specs/video-dubbing.md) and the
[implementation evidence](docs/checkpoints/video-dubbing-implementation.md).
Multi-platform scope and evidence are recorded in the
[Bilibili/HTML5 checkpoint](docs/checkpoints/video-dubbing-multiplatform.md).
The current integrated candidate, local packages and remaining cloud/manual acceptance are tracked
in the [release validation checkpoint](docs/checkpoints/video-dubbing-release-validation.md).
The specified YouTube video and native CC recovery are tracked in the
[YouTube browser checkpoint](docs/checkpoints/video-dubbing-youtube.md).

## Cookie Manager

Open OneWeb → **工具 → Cookie Manager** and enable it (disabled by default). Choose the current
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

## 网络管理

原 Clash Control 入口现统一为“网络管理”，保留已安装模块身份、Clash 连接与审查后节点切换。
WebRTC 防护提供四种 IP 处理策略，以及隐藏支持检测、阻止媒体设备和隐藏额外 RTC 对象三个选项。
首次应用时明确申请可选 `privacy` 权限；页面选项另需 HTTP/HTTPS 全站访问。
界面显示实际浏览器策略与控制权，关闭后释放本扩展覆盖。页面屏蔽对新文档生效，切换后需刷新；
它会影响网页通话和音视频，不证明系统代理已生效或完全没有 IP 泄漏。
泄漏检测按钮只在点击后打开外部检测站点。
WebRTC 防护支持 Chromium 和 Firefox。Firefox 的 IP 策略也作用于隐私窗口，界面会在应用前说明；
页面屏蔽仅作用于允许 OneWeb 运行的窗口。
详见[规格](docs/specs/network-management.md)及[源码审计](docs/research/webrtc-control-reference.md)。

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm verify:chromium
pnpm verify:firefox
EXTENSION_PATH="$PWD/extension" PW_BROWSER_CHANNEL=msedge PLAYWRIGHT_HTML_OPEN=never pnpm test:e2e
```

The browser tests load the production extension in disposable profiles. Workspace tests exercise
configuration, safe streaming, history, explicit page/selection capture, editor preview/apply,
bilingual recovery, site hiding, permission revocation and owner disconnect against local fixtures.
They also save screenshots and traces in the selected test output directory.
Remote-module conformance tests install a separate reference module, exercise GitHub SPA navigation,
verify the private iframe handshake, reject forged origins and preserve isolation. Native RepoLens
tests intercept only fixed GitHub HTTP requests at the real worker network boundary and verify
analysis, cache, report export and partial results without a localhost service. Application tests
exercise explicit page/selection tools and an actual generated HTML sandbox. Firefox additionally uses a `tabs.onUpdated` URL fallback so MV3 event-page suspension
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
  ├─ RepoLens builtin → finite trusted background → fixed public GitHub API
  ├─ page prompt tool → explicit capture + existing configured Assistant provider
  ├─ HTML mini app → opaque sandbox loader → closed nested HTML sandbox
  └─ remote module → approved field intersection + private MessageChannel
```

- No iframe or report UI is injected into GitHub's DOM.
- The passive GitHub context observer sends repository identity and URL only. The assistant's
  separately injected runtime reads page text or selected editor text after explicit user actions
  and exact-site authorization; only an explicit model request sends it to the chosen provider.
- The manifest grants only `activeTab`, `scripting`, `storage`, `tabs`, and Chromium `sidePanel`,
  plus `contextMenus` and the exact GitHub page host permission. GitHub API analysis, Assistant, Page Toolbox and
  Video Dubbing injections use fixed packaged entries and explicit exact-origin authorization.
- `cookies` is optional and requested only through Cookie Manager's explicit authorization action.
- `privacy` is optional and requested only through Network Management's explicit WebRTC action.
- The remote-module handshake checks exact `event.origin`, `event.source`, module ID and protocol
  version; later messages use the transferred port and still require the module ID and nonce.
- RepoLens uses only public GitHub APIs and an optional user-owned read-only Token held in the
  background, session-only unless explicitly remembered. Assistant provider keys follow the same
  existing user choice. No credentials enter a remote-module or HTML-app bridge. The HTML loader
  is bundled as a classic script so the opaque Firefox sandbox can load it; nested CSP denies app
  network and browser authority on both browsers.

Implementation details and remaining deployment considerations are documented in
[`docs/architecture.md`](docs/architecture.md).
