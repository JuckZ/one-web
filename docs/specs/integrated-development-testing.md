# 统一开发与测试规格

原整合日期：2026-11-14～15。用户要求：将现有代码融合，支持同时开发与测试。
2026-11-19 随 [WXT / React / TanStack 迁移](../adr/0027-wxt-react-tanstack-workspace.md)
更新当前构建约定；原整合基线和历史 checkpoint 仍只证明原版本。

## 原整合基线

使用 `/home/juck/Projects/one-web` 主 checkout 作为完整源码。逐文件 SHA-256 对比表明 factory
worktree 没有主目录缺失的文件；主目录包含其全部开发脚手架和更新的网络 / Firefox 实现。
保留主目录现有未提交修改和旧发布包，保持其他仓库的服务边界。

## 可观察验收

- 同一份源码同时注册工作区 / 页面任务、视频配音、网络管理与既有工具，不替换新实现为旧副本。
- `pnpm dev` / `pnpm dev-firefox` 各自产生独立开发扩展；`pnpm dev:test` 同时运行开发构建与单测 watch。
- `pnpm build` 默认产生 `artifacts/build/chromium/`，具名生产构建为 `artifacts/build/<browser>/`，
  开发和浏览器门禁分别为 `artifacts/dev/<browser>/`、`artifacts/test/<browser>/`。
  WXT 入口、manifest、资源、身份检查和真实浏览器检查统一使用 `ONEWEB_EXTENSION_DIR` 指定的目标。
- WXT 重建和 `pnpm clear` 只清理选定目标目录；保留其他目标、源码资源和已有 ZIP/XPI/CRX。
  独立 SDK 保留原构建步骤，`pnpm build:all` 串行生成 Chromium、Firefox 和 userscript；同一目标只运行一个构建者。
- Chromium 验收的远程模块 fixture 使用独立本机端口 14747，避免占用 WXT 开发服务的 3303/3304；
  所有相关测试读取对应产物中的实际 origin，内置 RepoLens 不依赖该服务。
- 开发 watcher 运行时可完成生产测试构建，不把 HMR 页面当作生产证据。两个浏览器构建不会互相覆盖。
- 扩展入口采用 `sidebar.html`、`sandbox.html`、`background.js`、`content-scripts/github.js` 和
  固定 `assistant.js`、`page-toolbox.js`、`video-dubbing.js`、`network-*.js`；沙箱 classic loader 为
  `sandbox-runtime.js`。注入器、sender 校验、打包检查和浏览器测试必须同步，不能沿用旧 `dist/*` 路径。
- 修复待验翻译恢复：普通增量只返回新正文；worker 恢复可显式找回未完成段落；不重复处理已翻译正文，保留停止状态。
- worker 重启测试必须实际停止扩展后台并观察重新启动，用真实浏览器结果证明翻译继续，不以发出 CDP 命令代替成功。

## Chromium 隔离授权夹具

生产扩展仍把 `bookmarks`、`cookies`、`privacy` 与 HTTP(S) host 声明为可选权限。
无头浏览器不能确认浏览器工具栏上的可选权限提示；`e2e/fixtures.ts` 只在一次性临时 profile 中
复制生产扩展，把该场景所需权限临时设为必需并启动一次，让 Chromium 自行记录有效授权。
关闭引导实例后在同一路径恢复原始 manifest，再正式启动；真实 `permissions.contains/getAll`、
扩展 ID 与 manifest 四组权限字段均须读回匹配，否则夹具立即失败。

夹具不改写 `Preferences` / `Secure Preferences`，不修改生产构建或日常 profile。
除像素管线替代 toolbar `activeTab` 的既有临时副本特例外，正式运行使用原始 manifest；
测试中仍显式撤销可选权限并验证会话清理。预先授权仅是隔离测试准备，不替代产品中的用户手势、
拒绝、撤权和 owner 复核测试。临时副本、实例与本机 fixture 都由所属测试清理。

## 验证接口

沿用既有 T1–T4：控制器 / 固定 runtime 的公开行为测试、生产扩展 E2E；构建目录隔离通过真实
package 命令验证。复现原失败后修复，不放宽既有限额和重复翻译断言。
最终执行 typecheck、lint、完整单测 / 覆盖率、Chromium 生产 E2E 与可用 Firefox gate，
记录真实日志和未运行的平台范围。构建和测试不接管用户浏览器，也不提交、推送或发布。
