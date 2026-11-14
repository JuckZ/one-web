# 网络管理实施检查点

日期：2026-11-14。保留工作树既有变更，目标仓库 OneWeb。
用户已明确确认规格中的 T1/T2/T3 公开测试接口。

## T3 真实 Chromium red → green

- Red：`pnpm exec playwright test e2e/network-management.spec.ts --retries=0 --timeout=15000 --reporter=line`
  实际执行 1 个测试，失败于不存在“网络管理”标题；旧构建尚未合并入口。
- 对应实现：复用已有 Clash seed 身份，增加 WebRTC 控制器/视图接线、可选 privacy 权限及 MAIN 启动脚本。
- Green：同一用户流程最终通过，且补充验证 CSP 页面首段脚本、HTTP iframe 与 srcdoc iframe。
  用 `ChromeSetting` 的真实 callback 接口包装 Promise，并在页面导航前等待后台完整成功，
  不把 policy 已写入误当成脚本注册已完成。

- 媒体设备切片：新增 `media device blocking` 场景后，缺少 `devices.js` 导致防护无法生效（red）；
  独立实现固定媒体属性脚本并接入构建后，同一场景 green，PeerConnection 与 ICE 保持可用。
- 额外对象切片：新增 `extra RTC objects` 场景后，缺少 `additional.js` 导致应用失败（red）；
  实现并打包固定对象屏蔽脚本后，同一场景 green，媒体设备与 PeerConnection 保持可用。
- 最终定向命令：`pnpm exec playwright test e2e/network-management.spec.ts --retries=0 --timeout=25000 --reporter=line`，
  5/5 通过。覆盖 worker 恢复但 Clash 零自动请求、撤销 privacy 后注销页面脚本、Clash 断开保留
  WebRTC 防护、统一模块停用释放两者、无凭据持久化及无其他模块记录改动。

真实 Chromium profile 由测试创建并清理，权限只在临时 profile 中预授予。
权限请求的直接用户动作及拒绝路径由 T2 真实 client/controller 集成验证。
用户 Chrome 只用于只读连接检查，内部扩展页面导航被 Chrome 拒绝，已 detach 自建会话；
源码由安装目录读取，未读取用户配置或改动用户已安装的参考扩展。

## 完整门禁与既有问题

- 生产 Chromium 构建、预发布身份检查、全仓 typecheck、本次涉及文件的 lint、`git diff --check` 通过。
- 首轮全仓 Vitest：863 项中 862 通过，唯一失败为既有
  `src/workspace/__tests__/dynamic-translation.test.ts` 的增量段落断言。
  单独运行同样复现：512 段只应用前 8 段译文，运行时合理返回未翻译的 504 段，测试却要求空数组。
  本次未修改该测试或翻译运行时；不能把这项失败表述为网络管理回归通过。
- 全仓 lint 报告 1,017 个既有错误，集中于 `.playwright-cli/` 旧快照、
  `docs/specs/video-dubbing.md`、`src/workspace/page-context.ts` 与上述翻译测试。
  本次涉及文件的定向 lint 无错误；未批量格式化这些无关文件。
- 最终本功能单测：`pnpm exec vitest run src/modules/builtin/network-management/__tests__ src/sidebar/__tests__/network-management-view.test.ts --reporter=dot`，
  35/35 通过（含最终新增的两个关闭失败恢复场景）。
- 完整 Chromium E2E：`EXTENSION_PATH=/tmp/oneweb-network-chromium.KXf7vS/extension pnpm exec playwright test --retries=0 --reporter=line`，
  66 场景中 64 通过。初次暴露旧 manifest allowlist 未包含新增可选 privacy，已同步该断言并定向复跑；
  另一项既有失败为 `e2e/browser-tasks.spec.ts:278` 在未 enable CDP ServiceWorker domain 时执行
  `ServiceWorker.stopAllWorkers`，浏览器拒绝 `ServiceWorker domain not enabled`。
  本次未修改该翻译测试。Clash 的完整权限/secret 隔离与竞态恢复场景均通过。
- 最终 Chromium 产物复核：`pnpm exec playwright test e2e/network-management.spec.ts --retries=0 --reporter=line`，
  5/5 通过；`pnpm exec playwright test e2e/basic.spec.ts -g 'built artifact exposes|Clash Control passes|Clash Control rejects' --retries=0 --reporter=line`，
  3/3 通过，包括更新后的可选 privacy 权限 allowlist、Clash 完整隔离与竞态恢复。
  结合完整回归，66 个场景已有 65 个通过，剩余为上述既有翻译测试的 CDP 调用问题。
- 完整 Firefox 脚本先在既有配音场景失败：环境音频后端 cubeb 初始化失败，未到达新场景；
  改用显式场景选择验证网络功能，不把旧场景未运行表述为通过。
- Firefox 支持补充：用户明确要求 Firefox 也支持后，专用 Promise 适配器使用其原生 `regular`
  scope，界面明确 IP 策略也适用于隐私窗口，页面访问仍受扩展实际窗口许可限制。
  首条真实测试在旧构建上因“不支持”而 red，接入适配器后同一流程 green。
  `FIREFOX_SCENARIO=network pnpm test:e2e:firefox` 已实际验证四种策略、普通/隐私读回、
  三组独立 MAIN 首脚本屏蔽、HTTP/srcdoc iframe、关闭恢复、重载、撤权、模块停用及其他模块隔离。
  同一 Firefox 场景还通过了认证的 Clash 准备/连接/刷新/断开，并确认 WebRTC 继续生效及 secret 不入 storage。
  详细证据见 `network-management-firefox.md` 与 `network-management-firefox-adapter.md`。

## Firefox 补充后的门禁与产物

- 网络相关公开接口回归：42/42（原后台 24、UI 12、Firefox 原生适配器 6）。
- Firefox 生产构建、身份检查、manifest lint 通过（0 errors / 0 notices / 0 warnings）。
- Firefox 测试包：`artifacts/oneweb-firefox-network-management.xpi`，使用当前通过验证的生产产物打包。
- Chromium 同源生产构建与身份检查通过。`pnpm exec playwright test e2e/basic.spec.ts e2e/network-management.spec.ts -g 'built artifact exposes|Clash Control passes|Clash Control rejects|network management protects|media device blocking|extra RTC objects|worker restart restores|Clash disconnect preserves' --retries=0 --reporter=line`，
  8/8 通过，日志 `/tmp/oneweb-firefox-support-chromium-e2e.log`。
- Chromium 测试包：`artifacts/oneweb-chromium-network-management.zip`。
- Firefox XPI 为未签名测试包，可在 `about:debugging` 临时加载。
- 本次适配器、界面、脚本工具测试、类型检查、涉及文件的 lint 及 diff 检查通过；
  前述全仓既有翻译断言、CDP 与无关 lint 问题仍单独记录，不表述为全仓通过。

最终构建已恢复为 Chromium 生产产物，位于 `extension/`，包括三个固定 `dist/network/*.js` 文件。
未提交、发布或覆盖用户 Chrome 内已安装扩展。

T1/T2 逐条开发证据分别见 `network-management-backend.md` 和 `network-management-ui.md`。

## 2026-11-15：独立提交快照验证

为仅提交本次网络管理和 Firefox 支持，从 `ef29526` 提取了独立快照：保留现有模块管理入口，
仅添加网络功能的后台/界面/权限/构建接线；工作区、Assistant、配音、开发流程和产物目录改造仍留在原工作树。
不引入 npm 依赖或 lockfile 变更。共享文档仅提取网络相关段落。

在该快照按现有 lockfile 安装依赖后，实际通过：

- `pnpm typecheck`、`pnpm lint`、`pnpm test --reporter=dot`：92 个文件、750/750 单测。
- Chromium 生产构建和身份检查；网络/Clash/权限共 8 个浏览器场景均通过。
  初次重载测试发现锁定的 Playwright 1.46 不提供 persistent-context browser 对象，
  改为公开 `context.newCDPSession(panel)` 后同一重载场景复跑通过，其他 7 个场景已通过。
- Firefox 生产构建；`FIREFOX_SCENARIO=network pnpm test:e2e:firefox` 通过完整 WebRTC/Clash 网络流程。

Chromium 用例使用 `EXTENSION_PATH=$PWD/extension` 指向本快照构建；
Firefox 同样使用本快照的生产产物和独立临时 profile。所有实现与浏览器测试均未依赖未提交的工作区或配音代码。
