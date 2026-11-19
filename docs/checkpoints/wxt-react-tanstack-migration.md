# 最新主线 WXT、React 与 TanStack 迁移检查点

日期：2026-11-19。任务：`wxt-tanstack-latest`，repair round 1。

用户原话：“请为我做迁移（WXT和tanstack），无需考虑历史兼容，因为整个应用从未有人使用过，中途无需询问我”“拉取最新代码，重新根据最新代码情况来做架构迁移”。规格为 [ISA](../../ISA.md)，架构决策为 [ADR-0027](../adr/0027-wxt-react-tanstack-workspace.md)。

## 基线与改动归属

工作目录为 `C:/Users/ajuck/Projects/one-web`，Windows 11 Pro 10.0.26300，Git Bash，Node 24.18.0、pnpm 9.12.2。`main` 从 `055ea2544d71eb1c76fb4d55899ed6bfe7b28b5d` 快进 21 个提交至 `34ce32b057da492c8f8e4addc0856d632c1eb4ca`。本轮没有提交或推送。

拉取前的 dirty/untracked 成果已逐字备份至 `.git/migration-snapshots/2026-11-19T05-42-49-592Z`，manifest 记录 SHA-256、原 HEAD、路径与删除状态；另保存 binary patch 和原 index。160 个存在文件共 6,321,120 bytes，58 个删除路径；恢复前已核对校验和。旧本地整理器未覆盖最新 OneWeb。退役演示和手写构建的可逆移存位于 `.git/migration-retired`。

## 最终职责

- WXT 管理双浏览器 MV3 入口、Manifest 合成和固定注入资源。后台同步注册监听器，入口被 Node 发现时不访问 DOM/browser API。
- React 管理工作台导航与智能应用列表；既有 controller、有限协议和独立 DOM view 通过稳定 outlet 接入，继续拥有权限和生命周期。
- TanStack Router 使用 hash history；显式 hash 优先，`moduleId` 在初始化前消费并移除。设置返回本页面实际进入设置前的目标；冷启动 settings 返回助手。
- Query 只读取模块 registry，关闭查询重试、聚焦重取和 mutation 重试；不自动执行模型请求、权限申请、Cookie/网络/网页写入。
- Table 执行搜索、类型过滤和中文名称排序；稳定行 ID，过滤后超过 50 行使用 Virtual。受控 sorting/filter 数组稳定，无分页列表禁用分页自动重置。
- 独立 userscript 继续使用 Vite IIFE，module-sdk 继续使用独立 tsc 与消费者包验证。移除 Vue/Element Plus/UnoCSS 演示及手写扩展多入口；没有重写全部业务层或引入 SSR。

固定资源包括 `sidebar.html`、`sandbox.html`、`sandbox-runtime.js`、`assistant.js`、`page-toolbox.js`、`video-dubbing.js`、`background.js`、`content-scripts/github.js` 和三个 network 脚本。Chromium 使用 `side_panel` 与 service worker，Firefox 使用 `sidebar_action` 与后台 scripts。

## 行为修复与失败证据

首次独立评审 `.git/agent-factory/tasks/wxt-tanstack-latest.done-20261119T094239Z/review-0.md` 为 changes-required。原源码冻结 `0e2b5cfe201e7aadecc9b2c0f880110c8df2d7966e9a19247b0d5653f05b455f` 不覆盖后续修复。

| 触发与原行为                                                                        | 修复与验证边界                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 工具列表搜索/排序后 Table 重算与 pagination reset 循环，真实页面无法输入            | 稳定受控数组并关闭未使用的分页重置；有数据的列表与大量数据交互进入生产浏览器回归                                               |
| `moduleId` 留在 query，刷新覆盖后续 hash                                            | 一次性消费并移除，显式 hash 优先；保留真实旧 red → 新 green 记录                                                               |
| settings 局部返回只重绘内容，URL/nav 仍停在 settings；冷启动又误用持久化旧目标      | 宿主负责返回导航；区分本页真实导航与初始化恢复；草稿/附件、route/h1/nav、真冷启动有单测、E2E 和独立界面验收                    |
| pack/start 强制覆盖调用者目录；直接导入的 jszip 未声明；Windows SDK spawn pnpm 失败 | 消费 `ONEWEB_EXTENSION_DIR`；恢复直接依赖；使用 cross-spawn，保留消费者与可重现包检查                                          |
| Chromium 夹具直接改 profile 设置，未形成实际权限                                    | 仅临时扩展副本 bootstrap 为 required，浏览器原生授权后恢复正式 manifest；真实 contains/getAll/getManifest 读回，不扩大生产权限 |
| registry refresh 的 runner 保持测试过早断言；模块删除后又读 detached iframe         | 等待真实刷新完成；被动捕获此前实际成功的 SDK 请求，删除后确认 SESSION_DESTROYED，同时断言清理和 peer 不变                      |
| GitHub 内容脚本失效后 observer 未释放                                               | WXT `onInvalidated` 绑定初始化返回的 cleanup，保留销毁单测                                                                     |
| Firefox 严格 linter 报 React DOM vendor 中两项 innerHTML 警告                       | 完整扫描，精确绑定纯 vendor chunk、10 个上游源文件 digest、chunk digest 和两个诊断位置/字段/计数；其他诊断仍 fatal             |
| 完整 Chromium 旧轮为 85/86；编辑器 reply 的显式替换按钮点击期间消失                 | 保留 trace；新增公开结果/选区事件单测，旧实现 contenteditable/textarea 均失败，快照修复后均通过；新完整浏览器结果另列          |

最后一项在本轮修改前 `surface.ts` 相对最新 main 无 diff，不能归为已证实的 WXT/React 引入。旧 trace 与延迟 `selectionchange` 路径相符，确定性单测证实重复相同选区会隐藏预览；trace 本身未逐事件证明唯一根因。修复仅在结果可见且节点、起止位置和原文均相同时忽略重复事件；真正选区/原文变化仍刷新。后台写回原文/选区校验及可信显式点击保持有效。

red：`.git/migration-selection-preview-red.log`，2 failed；green：`.git/migration-selection-preview-green.log`，2 passed。单独编辑器 E2E 在旧产物上通过属于时序诊断，不能代替新完整 suite。无效的 page.clock 诊断没有复现，相关临时代码已移除。没有 force click、evaluate click、固定 sleep 或放宽断言。

## 实际检查

以下命令均在上述工作目录执行，模型请求仅使用本机合成 HTTP/SSE fixture。

| 检查                       | 真实结果与证据                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 最新核心检查               | `EXTENSION=chromium ONEWEB_EXTENSION_DIR=artifacts/test/chromium-r1-final2 REPOLENS_ORIGIN=http://127.0.0.1:14747 REPOLENS_REQUIRE_HTTPS=false pnpm verify`，exit 0；`.git/migration-core-final-r1d.log`                                                                                                           |
| 类型、lint、单测、覆盖率   | 133 文件 / 995 测试通过；0 lint errors / 24 warnings；statements/lines 83.82%、branches 77.67%、functions 88.13%；阈值未降低                                                                                                                                                                                       |
| SDK                        | `pnpm verify:module-sdk`，exit 0，20 packed files 可重现；`.git/migration-sdk-r1.log`。后续生产改动不涉及 SDK                                                                                                                                                                                                      |
| userscript                 | `pnpm verify:userscript`，exit 0，6 E2E 通过；`.git/migration-userscript-final.log`。最新选区修复位于 assistantContent，不在 userscript 的 PageToolboxDomRuntime 依赖路径                                                                                                                                          |
| 发布辅助测试               | `pnpm test:release`，20 Vitest + 12 Python mock 通过；`.git/migration-release-r1.log`；日志中的 Published 为 mock 输出，未发布                                                                                                                                                                                     |
| 选区修复前完整 Chromium    | 85 passed / 1 failed，retries 0；`.git/migration-chromium-final-r1.log`；失败 trace 保存在 `artifacts/test-results/chromium-final/`                                                                                                                                                                                |
| 最新完整 Chromium          | 最终完整 strict 复验 86 passed（6.8m），retries 0 / workers 1，exit 0；`.git/migration-chromium-final-r1e.log`，`artifacts/test-results/chromium-r1-final3/`，加载 `artifacts/test/chromium-r1-final2`。先前 85/86 失败记录保留；viewport 前置只调整测试准备，生产产物未变                                         |
| 最新完整 Firefox           | `EXTENSION=firefox ONEWEB_EXTENSION_DIR=artifacts/test/firefox-r1-final2 EXTENSION_PATH=artifacts/test/firefox-r1-final2 pnpm exec run-s build manifest:validate test:e2e:firefox`，exit 0；`.git/migration-firefox-final-r1d.log`；assistant 4/4、smart apps 2/2、packaged builtin 5/5，以及真实配音/网络门禁通过 |
| 最新产物独立 UI            | pass；`artifacts/acceptance/migration-review-1-final2/acceptance-result.json`；1440/360/420px，冷 settings 返回助手、Reading 草稿/附件恢复、24次导航、列表交互与键盘通过；13张截图全部回读；19/19文件初末一致，aggregate `fc68df8d31102a997d86d7a7811209fb32406dc02acacee2753f4b0242c7d512`                        |
| 默认分发构建与最终 ZIP/XPI | `pnpm build:chromium && pnpm build:firefox && pnpm pack:zip && pnpm pack:xpi` 及 `.git/migration-verify-archive.mjs` 均 exit 0；ZIP 19/19、XPI 22/22 文件集合及字节与生产目录完全一致；`.git/migration-production-final-r1d.log`、`.git/migration-pack-final-r1d.log`                                              |
| round 1 独立源码复评       | needs-input；R0-1至R0-5全部关闭，未确认新源码阻断项；独立6文件36测试、UI19文件及ZIP19/XPI22逐字核对通过；正式factory/attest及committed-HEAD Review.ts仍缺；见归档review-1.md                                                                                                                                       |

旧独立 UI 的 `artifacts/acceptance/migration-review-1-final/acceptance-result.json` 为 pass，1440/360/420px、13 张截图全部回读、19 个产物文件首尾一致；它绑定旧 `artifacts/test/chromium`，不能冒充最新选区修复的产物验收。历史 fail/followup 目录均保留。

最新 UI 中 28 个静态请求均为 200，无外部请求；0 console errors，1 条 about:blank sandbox warning。桌面助手相对参考仅原生 textarea 缩放柄 8×8 区域内 20 pixels 不同，420px 工具页逐像素一致；360px 无对应参考，单独验证布局与交互。验收仅覆盖列明 sidebar 场景，不替代业务 E2E。

第二次 Chromium 全套保留在 `artifacts/test-results/chromium-r1-final2/`。失败用例在助手注入后调用 `setViewportSize`，约 17ms 后开始选择 textarea；源码的 viewport handler 按 PS-03 清除待展示计时器并隐藏工具栏。此相邻时序与失败一致，但 trace 没有记录每个原生 resize/selection 事件，未证明唯一根因。该排序用例改为复用已有 helper，在页面导航和助手注入前固定同一 480×720 viewport，完整排序/拖动/显式写回断言保留；PS-03 的运行时 resize/scroll 隐藏验证保持独立。没有修改生产源码或增加固定等待。

最终默认分发包：`extension.zip`（19 files）SHA-256 `c79733fadf51a1aca4e6f5a9733330be8f237928aac41dbe6c78b3c41e6afddf`，`extension.xpi`（22 files）SHA-256 `f05a03f2bf6824a6e92d83cece22174bd2bafad27253005ad9c592af04561a61`。完整路径集合和逐文件字节校验回执为 `.git/migration-zip-final-bytes.json`、`.git/migration-xpi-final-bytes.json`。默认分发 RepoLens 为 4747；Chromium 测试构建为 14747，两者分别记录，不声称构建字节相同。

Firefox 的项目 vendor 策略接受确切锁定字节中的两条 warning，不是原始 linter 零告警，也不是 Mozilla 或商店批准。Vite 大于 500KB 的 chunk warning 与 React lint warnings 如实保留，没有关闭规则制造通过。

## 未覆盖与正式回执

- Not run: factory check/attest 成功回执 — `python -X utf8 -B scripts/agent-factory/factory.py check --config .agent-factory.ci.json` 在 suite 前 exit 2：`suite locking requires POSIX fcntl.flock; Windows is unsupported`；`.git/migration-factory-windows.log`。普通命令日志不冒充 attest。
- Not run: LifeOS `Review.ts` committed-HEAD 正式回执 — 当前源码未提交，用户没有提交授权；dirty 独立复评不等于正式回执，不使用豁免参数。
- Not run: 真实模型质量、付费服务、登录平台和主观音质 — 本轮未授权；合成 fixture 不能证明这些范围。
- Not run: macOS/Linux、Chrome 原生 sidepanel 外壳、系统中文 IME 与所有线上富文本框架 — 本轮 Windows 真实扩展 tab、原生 textarea/contenteditable 与现有双浏览器 gate 不覆盖这些范围。
- Not run: 商店签名/安装发布、commit、push、merge、deploy、对外消息 — 本轮未执行。

Chromium 最终完整复验已通过，四项 ISC 的直接验证与独立 UI 验收均有当前证据。round 1 独立源码复评已关闭首轮全部发现，未确认新增源码阻断项；终态为 needs-input，正式 factory / committed-HEAD 回执缺口如上，尚不标记 ready-local。

评审与结果记录归档至 `.git/agent-factory/tasks/wxt-tanstack-latest.done-20261119T094239Z/`。初次 round 1 覆盖 627 路径，冻结摘要 `495977a2c1f07a282fb882321a73805f9284ef04b59407e0fa2c9335cb2219d9`，清单 `.git/migration-source-state-review-1.json`；后续仅改 ISA 与本检查点评审结论及交接元数据，最终冻结清单 `.git/migration-source-state-handoff-1.json`，该增量覆盖与摘要以同一 `review-1.md` 的追加绑定为准。生产源码、测试和分发制品不再修改。

上述为首次交接时的历史状态；现有 Ubuntu CI 配置本身不代表这次已执行成功。本检查点不授权发布，也不以旧成功记录补齐新版本缺口。

## 提交与正式评审续跑

2026-11-19，用户新增授权：“提交代码并完成正式评审”。提交前再次运行 `node .git/migration-freeze.mjs verify .git/migration-source-state-handoff-1.json`，627 路径和摘要 `058ecab5798f2d4aac1a49402bfcbf26488de4aebcc6d40639f306ebde08f480` 一致；暂存区原为空。同一任务继续保留 repair-round 1，与上述归档关联。

本次仅在提交前更新 ISA 和本检查点的授权 / 评审状态；业务源码、测试与已验收制品不变。准备在提交后的 HEAD 对仓库根执行 `bun C:/Users/ajuck/.claude/LIFEOS/TOOLS/Review.ts C:/Users/ajuck/Projects/one-web --json`，默认基线为 `origin/main`；执行结果及确切 HEAD 另存于 `.git` 正式评审记录与 `artifacts/migration-handoff.md`，不使用任何豁免参数。

factory 的 Windows `fcntl.flock` 缺口仍在；`wsl.exe --list --quiet` exit 1，本机未安装可用的 WSL。没有为补齐回执修改 factory、安装系统组件或推送触发 CI。正式 Review 与 factory / attest 分别报告；本次授权不包含 push、merge、deploy、商店上传或对外消息。

### 正式评审结果

迁移提交为 `1df6f937536f63838d75374ac5f0b5fd489364b3`（`refactor: migrate extension to WXT and React TanStack workspace`）。提交钩子的 lint-staged 通过；提交后核对冻结清单的全部 627 路径，钩子未改动文件字节，工作区干净。相对上次独立验收仅 ISA 和本检查点的授权元数据改变，绑定记录为 `.git/migration-committed-binding-1.json`。

上述正式命令 exit 0：**pass**，base `34ce32b057da492c8f8e4addc0856d632c1eb4ca` → head `1df6f937536f63838d75374ac5f0b5fd489364b3`，scope `.`，dirty `false`。152 文件分为 4 批，high tier，由 `gpt-6.1-sol`（OpenAI）评审；findings 为空，无 dirty、blocker 或 round-cap 豁免。

原始输出为 `.git/migration-formal-review-1.json`；可查看副本为 `artifacts/reviews/migration-formal-review-1/review.json`、`receipt.json`、`binding.json`。逐项核对了正式磁盘记录、当前 HEAD、base、完整 diff SHA-256 `9c4c4c0929b38614e85b17a57765f6883df56af2cfc9bb3e8771e825e6ccab40`、stateFingerprint 与 Assay receipt 的 pass / evaluator / 时间；`.git/migration-formal-review-1-verification.log` exit 0。提交后的 `IsaCheck.ts acceptance` 同样 exit 0。

本节和 ISA 的评审结果是随后单独提交的文档增量，需在该最终提交上复评并另存回执；不改变生产源码、测试及既有制品。迁移提交与正式评审的授权目标已达成，factory / attest 仍是项目 `needs-input` 的唯一正式环境缺口。
