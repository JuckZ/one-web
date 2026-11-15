# OneWeb 子系统入口与验收选择

按本轮触及的分支加载资料，不整库灌入上下文。本页是导航和候选命令表，规范以目标文件及当前实现为准；更新路径时核对 `rg --files`，更新命令时核对 `package.json`。

## 必读与条件入口

| 触发条件                                                            | 读取的事实源                                                                                                                                                       | 查看的实现 / 测试边界                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 所有实现与修复                                                      | 根 `AGENTS.md`；`docs/architecture.md`；相关规格和最新 `docs/checkpoints/`                                                                                         | `package.json`；本轮真实调用链。历史通过数不是本次证据。                                                                              |
| 模块安装、启停、更新、删除、remote frame、SDK、bridge、能力或上下文 | `docs/module-platform-architecture.md`；`docs/module-decomposition-roadmap.md`；对应 `docs/adr/0005`～`0010` 文件（先列目录选确切文件）                            | `src/modules/`；`packages/module-sdk/`；模块 / capability isolation tests；`e2e/basic.spec.ts`                                        |
| 工作区、Assistant、模型调用、历史、页面上下文、选文和写回           | `docs/specs/monica-workspace.md`；`docs/checkpoints/monica-workspace-implementation.md`                                                                            | `src/workspace/`；`src/modules/builtin/assistant/`；相关 sidebar / content；`e2e/workspace.spec.ts`                                   |
| 页面工具箱、Quick Ask、翻译、视频阅读、剪藏、截图识图               | `docs/specs/browser-tasks-p0-p1.md`；对应 checkpoint；Page Toolbox 另读 `docs/adr/0011`～`0019` 中相关决策                                                         | `src/workspace/`；固定 content runtime；`e2e/browser-tasks.spec.ts`；相应 `e2e/basic.spec.ts` 场景                                    |
| Cookie 管理                                                         | `docs/specs/cookie-manager.md`；`docs/checkpoints/cookie-manager-implementation.md`                                                                                | `src/modules/builtin/cookie-manager/`；独立 sidebar view；`e2e/cookie-manager.spec.ts`                                                |
| 视频配音、字幕来源、播放器、TTS、翻译服务                           | `docs/specs/video-dubbing.md`；`docs/checkpoints/video-dubbing-release-validation.md` 及本轮对应平台 / 服务 checkpoint                                             | `src/modules/builtin/video-dubbing/`；content player；`e2e/video-dubbing.spec.ts`。fixture、真实平台、云服务、主观音质各自验收。      |
| 网络管理、WebRTC、Clash                                             | `docs/specs/network-management.md`；`docs/adr/0023-network-management-webrtc.md`；相关 network-management checkpoints                                              | `src/modules/builtin/network-management/`、`clash-control/`；`e2e/network-management.spec.ts`。浏览器策略不等同系统代理或公网零泄漏。 |
| Bookmark Doctor、Browser Journal、Send to OpenList                  | `docs/module-platform-architecture.md` 相应章节；相关 ADR / phase checkpoint；OpenList 另读 `docs/adr/0022-send-to-openlist-resource-inbox.md`                     | 对应 `src/modules/builtin/`；isolation tests；`e2e/basic.spec.ts`。未知结果写入按原规格处理。                                         |
| 新 context、capability、controller、存储、外传 origin、凭据或遥测   | `docs/privacy-data-inventory.md`；相关 spec / ADR；`scripts/manifest.ts`                                                                                           | 有效 manifest、权限申请、owner、保留 / 删除、日志 / 截图、断开与撤销路径。隐私清单同次更新。                                          |
| 打包、产品身份、RC 或发布准备                                       | `docs/adr/0020-pre-release-clean-slate.md`；`0021-pre-release-convergence.md`；`docs/checkpoints/post-phase-9-release-convergence.md`；本轮最新 release checkpoint | `scripts/verify-pre-release-identity.ts`；manifest/build config；既有 CI / deploy。历史批准不授予本轮发布。                           |

## 每次变更要守住的边界

**模块隔离**：OneWeb host 持有 browser integration、permission、上下文和生命周期；remote module 拥有 sandbox iframe、自己的服务与认证。模块数据只按实际声明和用户 grant 的交集发送；模块身份、nonce、origin、schema 和 quota 逐层验证。沿用现行有限 capability catalog；架构文档中的计划项不自动成为已实现或已授权接口。remote code 留在 iframe，不能变成扩展页动态脚本、任意 browser API 或通用 fetch / script 代理。至少用两个模块 / origin 观察无关方不变。

**权限与隐私**：敏感操作由明确用户动作申请可选权限，后台再次核对 exact origin 与 owner。按现行 inventory 区分 session、本地持久、模块 state 和远程服务保留；秘密不穿过 generic context、remote frame、URL、诊断、截图或任务日志。共享 origin 的清理只释放本模块拥有且无人继续使用的授权。新增遥测需先有其独立用户选择、保留、删除和权限设计。

**浏览器生命周期**：为异步操作绑定实际 owner、tab、原生 document / URL、module / video identity 与 generation。按各子系统现行规格覆盖导航 / SPA、撤权、停用 / 移除、关闭 / disconnect、worker restart、取消与迟到结果。清理 owned UI、监听器、port、网络和媒体资源；某模块失败不重置其他模块或 shell。页面写回核对原文 / 选区与显式确认；真实浏览器 API 的不可原子性要保留在结论中。

## 候选验证命令

在所处分支核对脚本后选择，不把本表当成每次全部运行的要求。行为范围扩大时同步扩大验证。

| 范围                   | 当前候选命令                                                              | 证据边界                                                                    |
| ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 源码基本检查           | `pnpm typecheck`、`pnpm lint`、`pnpm test`；由 `.agent-factory.json` 执行 | lint 可能写本地 cache；测试通过只覆盖实际用例。                             |
| 定位一个已知测试文件   | `pnpm exec vitest run <真实测试路径>`                                     | 适合迭代；交付补齐所需回归。                                                |
| 覆盖率与核心完整构建   | `pnpm test:coverage`、`pnpm verify`                                       | 当前 verify 包含 typecheck / lint / coverage / build；核对脚本避免重复。    |
| SDK / 能力契约         | `pnpm verify:module-sdk`                                                  | SDK 包与消费验证不代替 host 权限 / browser E2E。                            |
| Chromium 生产扩展      | `pnpm verify:chromium`；由 `.agent-factory.chromium.json` 执行            | 生产 build + 隔离 profile E2E。                                             |
| 单个 Chromium E2E 文件 | 按 [README](../../README.md#同时开发与测试) 使用验收包与定向 E2E 命令     | 使用同一生产构建，保留 trace / screenshot；后续按范围跑完整 suite。         |
| Firefox 生产扩展       | `pnpm verify:firefox`；由 `.agent-factory.firefox.json` 执行              | build / identity / manifest / 真实临时安装 gate；媒体测试需要可用音频输出。 |
| 差异与生成文件         | `git diff --check`、`git status --short`、必要时 `git diff --cached`      | 检查新增文件、生成物与先前改动的归属；不能只看已跟踪 diff。                 |

具名构建分别写入 `artifacts/build/chromium` 和 `artifacts/build/firefox`，浏览器门禁分别写入 `artifacts/test/chromium` 和 `artifacts/test/firefox`；开发目录为 `artifacts/dev/<browser>`。`pnpm build:all` 串行更新共享 SDK；同一目标目录只允许一个构建者，开发与验收可同时运行。缺浏览器、音频、其他 OS、真实网站或付费服务时，记录 `Not run`，并指出未完成哪条验收。真实用户网页操作另按 [工作流](workflow.md) 使用 Playwright CLI extension，会话结束 detach；它与项目隔离 profile 自动测试用途不同。
