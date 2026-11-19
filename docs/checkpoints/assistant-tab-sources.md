# 助手跨标签页问答 · 2026-11-19

对应 [ISA F11](../../ISA.md#f11--在侧栏问多个已打开的网页)。基线 `2e9f5a89878e4aac3e541d4ab92faf0effd1b27a`；首次验收在未提交工作树完成，其记录独立于 F10 迁移。

## 从什么变成什么

- 现有助手的单页、选文和导入入口保留。新增 `@` 或「＋ 添加标签页」从打开的普通网页中选最多十个来源；每项可返回原页或移除，重选会替换旧项。`/` 使用现有提示词库；总结和比较按钮只填草稿。
- 逐站授权后才读所选顶层文档。每页正文 12 KiB、合计 120 KiB，带编号送到既有模型接口；后台临时快照不写入历史。正文读取排除隐藏、收起和编辑区域，标题与去掉查询串、片段的 URL 用于显示来源。
- 每个助手连接都有独立身份，同地址的工作区互不清理。切换标签页不更换来源，导航及重载会使旧来源失效；撤权中止依赖该来源的活动请求。断开时释放临时状态，用户再次操作时重连且不重放请求。

## 核心检查与浏览器证据

所有命令在 `C:/Users/ajuck/Projects/one-web`、Windows 11 上执行；页面正文与模型服务都是本地合成 fixture。

- 第三轮 `pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。lint 为 0 错误、24 条既有警告，单测通过 135 个文件、1,008 项。日志在 `artifacts/assistant-f11-r3-{typecheck,lint,unit}.log`。
- 第三轮 Chromium 和 Firefox 生产构建及标识检查通过。Firefox 生产清单验证及全部浏览器 gate 通过。助手 5/5，覆盖本地 HTTP 请求中的跨页正文、选文写回、翻译和撤权中止。日志在 `artifacts/assistant-f11-r3-firefox{,-build,-manifest}.log`。
- 第三轮 Chromium 完整回归通过 87/87，`pnpm test:e2e:strict` 使用 `--retries=0`。日志在 `artifacts/assistant-f11-r3-chromium.log`。
- 第三轮 Chromium 工作台回归通过 20/20，`--retries=0`，日志在 `artifacts/assistant-f11-r3-workspace.log`。跨页专项也单独通过，覆盖键盘选提示词、选择和返回来源、只发送所选网页、同 URL 重载拒发、重新选择、工作区隔离、移除及新对话清空。日志在 `artifacts/assistant-f11-r3-visual.log`。
- Chromium 与 Firefox 生产包的 `permissions`、`host_permissions`、`optional_permissions`、`optional_host_permissions` 与迁移基线一致，证据见 `artifacts/assistant-f11-r3-manifest-permissions.json`。构建和测试使用 `build` 与 Chromium 的 `test:e2e:strict` 入口，Firefox 专用的 `manifest:validate` 无法检查 Chrome 的 service worker 清单。
- 基线缺少快捷选项的 trace 在 `artifacts/test-results/assistant-tab-sources-red/`。重复 Enter、收起正文及两种撤权时序的失败记录在 `artifacts/assistant-tab-sources-review-red.log`、`artifacts/assistant-f11-revocation-red.log` 和 `artifacts/assistant-f11-batch-revocation-red.log`。独立第三轮源码复评通过，22 项定向回归通过。源码与两份生产目录的 SHA-256 在 `artifacts/assistant-f11-r3-sha256.json`。

## 界面验收

独立验收在隔离 Chromium 通过跨页和当前页问答，核对了 360 px 与 1440 px 截图。最后一轮只修改后台权限复检，重新在该产物上通过跨页专项并回读截图。窄屏展开选择器时会遮住一部分欢迎文案，搜索、选择和发送可操作。

- [360 px 标签页选择器](../../artifacts/test-results/assistant-f11-r3-visual/workspace-compares-explici-dc1cc-losed-after-a-source-reload/tab-picker-360.png)
- [1440 px 双来源回答](../../artifacts/test-results/assistant-f11-r3-visual/workspace-compares-explici-dc1cc-losed-after-a-source-reload/tab-answer-1440.png)

## 未覆盖

- 浏览器使用隔离的测试配置，覆盖扩展工作区，Chrome 原生侧栏容器和首次权限弹窗未验收。
- 测试使用合成正文和本地模型替身。商业模型回答质量和多模型切换未验收。
- 本轮范围为 OneWeb 现有助手。Chrome 私有顶栏按钮、Gemini Live、Google 账号联动和通用自动浏览未实现。
- 首次验收时，`factory check` 在 Windows 缺少 `fcntl.flock`，退出 2，未取得 attest。日志在 `artifacts/assistant-f11-factory.log`。

## 提交与正式评审

跨页助手已提交为 `9d7c62e87c75b7884a8698e1d05a949d0a97861b`。`Review.ts` 在干净工作树对相对于 `2e9f5a89878e4aac3e541d4ab92faf0effd1b27a` 的 23 个文件完成静态评审，结果为 `pass`，无 findings。评审器的本地复跑受执行策略限制，测试由上面的本地验收覆盖。评审与散列核验见 [回执](../../artifacts/reviews/assistant-tab-sources/receipt.json)。提交保留在本地。

## 原生入口与后续能力实验

- Windows 上用 Chromium 149 的新隔离配置加载已核对 SHA-256 的 19 个生产文件。Playwright 在浏览器级调用 `Extensions.triggerAction`，读回原生 `SIDE_PANEL`，面板同时显示两个不同 loopback 来源。两站在选择前均未授权。选择 `localhost` 后，浏览器的可访问性树记录 OneWeb 首次申请该站点权限。后台窗口点击无法确认弹窗已处理，来源数仍为 0。首授允许和拒绝的完整交互未验证。 [侧栏上下文](../../artifacts/assistant-platform-probe/final-panel-readback.log) · [原生弹窗树](../../artifacts/assistant-platform-probe/final-prompt-tree.json)
- 在隔离 Chromium 的实际扩展页面探测端侧听写，`SpeechRecognition.available({processLocally: true})` 对 `zh-CN` 和 `en-US` 都返回 `downloadable`。先下载语言包，再以合成语音测试听写到草稿和显式发送。此次未下载、录音或转写。Playwright 缺少自己的 Firefox 二进制，Firefox 听写未验证。 [浏览器证据](../../artifacts/assistant-platform-probe/speech-chromium.log) · [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)
- Chrome 公开扩展入口可用工具栏 `action`、侧栏和快捷键。Ask Gemini 的浏览器私有顶栏位置不在公开 API 中。Firefox 原生侧栏由 manifest 声明，现有 `open-workspace` 快捷键打开完整工作区标签页。 [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) · [Firefox Sidebar](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)
- `gemini-3.8-live` 通过独立 WebSocket 会话处理 PCM16LE 音频，原生输入 16 kHz，输出 24 kHz。现有文本助手使用 `chat/completions`。浏览器直连 Live 需要后端签发短期令牌。该协议可用本地服务替身验证建连、打断和关闭，真实服务与音频行为尚未实测。 [Live 音频协议](https://aistudio.google.com/docs/live-api/capabilities) · [短期令牌](https://aistudio.google.com/docs/live-api/ephemeral-tokens)
- Google Connected Apps 的权限随 Gemini Apps 使用。OneWeb 若支持 Drive 导入，应单独授权用户选定文件并预览后附加。网页自动化沿用固定任务，用户选择来源或选区，并确认写回。账号联动和通用 Auto browse 本轮处于研究阶段。 [Connected Apps](https://support.google.com/gemini/answer/15229592) · [Drive OAuth 范围](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
