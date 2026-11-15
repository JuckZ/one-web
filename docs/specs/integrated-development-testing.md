# 统一开发与测试规格

日期：2026-11-14～15。用户要求：将现有代码融合，支持同时开发与测试。

## 整合基线

使用 `/home/juck/Projects/one-web` 主 checkout 作为完整源码。逐文件 SHA-256 对比表明 factory
worktree 没有主目录缺失的文件；主目录包含其全部开发脚手架和更新的网络 / Firefox 实现。
保留主目录现有未提交修改和旧发布包，保持其他仓库的服务边界。

## 可观察验收

- 同一份源码同时注册工作区 / 页面任务、视频配音、网络管理与既有工具，不替换新实现为旧副本。
- `pnpm dev` / `pnpm dev-firefox` 各自产生独立开发扩展；`pnpm dev:test` 同时运行开发构建与单测 watch。
- `pnpm build` 仍产生默认 `extension/`；具名 Chromium / Firefox build 与 verify 使用独立目录。
  所有 Vite entry、manifest、资源复制、身份检查和真实浏览器检查都读取同一目标目录。
- 清理只触及当前目标的 dist 和生成 manifest；保留其他目标、源码资源和已有 ZIP/XPI/CRX。
- Chromium 验收的 RepoLens fixture 使用独立本机端口，避免占用开发服务的 4747；所有相关测试读取对应产物中的实际 origin。
- 开发 watcher 运行时可完成生产测试构建，不把 HMR 页面当作生产证据。两个浏览器构建不会互相覆盖。
- 修复待验翻译恢复：普通增量只返回新正文；worker 恢复可显式找回未完成段落；不重复处理已翻译正文，保留停止状态。
- worker 重启测试必须实际停止扩展后台并观察重新启动，用真实浏览器结果证明翻译继续，不以发出 CDP 命令代替成功。

## 验证接口

沿用既有 T1–T4：控制器 / 固定 runtime 的公开行为测试、生产扩展 E2E；构建目录隔离通过真实
package 命令验证。复现原失败后修复，不放宽既有限额和重复翻译断言。
最终执行 typecheck、lint、完整单测 / 覆盖率、Chromium 生产 E2E 与可用 Firefox gate，
记录真实日志和未运行的平台范围。构建和测试不接管用户浏览器，也不提交、推送或发布。
