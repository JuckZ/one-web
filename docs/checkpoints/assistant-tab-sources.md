# 助手跨标签页问答 · 2026-11-19

对应 [ISA F11](../../ISA.md#f11--在侧栏问多个已打开的网页)。基线 `2e9f5a89878e4aac3e541d4ab92faf0effd1b27a`；本轮是未提交工作树，不复用 F10 迁移的验收签名。

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
- 改动保留在未提交的工作树，未推送或发布。正式的 committed-HEAD 评审未执行。`factory check` 在 Windows 缺少 `fcntl.flock`，退出 2，未取得 attest。日志在 `artifacts/assistant-f11-factory.log`。
