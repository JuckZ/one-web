# 统一开发与测试整合检查点

日期：2026-11-14～15。实现和浏览器自动验收已完成；本机核心证据以本轮最终 factory run 为准。
规格：[统一开发与测试](../specs/integrated-development-testing.md)。

## 整合结果

统一源码位于 `/home/juck/Projects/one-web` 当前工作区。对比时 factory worktree 没有主目录缺失
的文件，482 个文件逐字节一致；主目录还包含较新的 Firefox / 网络适配。选择主目录保留新版
实现，未把旧副本覆盖回去。网页任务、视频配音、网络管理、既有模块和开发脚手架共同构建。
本轮开始 HEAD 为 `ef29526`；期间网络管理提交 `7b5c9d9` 进入同一分支，本轮保留并验证了它与
其他未提交功能的组合，没有替其他任务提交、清理或发布文件。

构建目录通过 `scripts/utils.ts` 的 `extensionRoot` / `e()` 统一传递到全部 Vite entry、manifest、
资源复制、身份校验和浏览器验证。`pnpm dev:test` 同时启动开发构建、Vite 与单测 watch；
Chromium / Firefox 的开发、具名生产构建和浏览器门禁使用各自目录。清理只删除当前目标的
生成 dist / manifest；保留源码 assets、其他目标和既有归档。默认 `pnpm build` 仍生成 `extension/`。
Firefox 的启动、lint、XPI 打包与部署打包入口同步选择相应目标。

Chromium 生产验收专用 RepoLens origin 为 `http://127.0.0.1:14747`，测试从已构建 manifest
读取该 origin，包含 RPC host / iframe 校验和种子来源。开发服务的 4747 端口可以同时占用。
`verify:chromium` 明确禁用失败重试，不用本机自动重试掩盖时序问题。

## 失败与修复证据

- 原翻译限额测试再次扫描返回 504 个已采集段落，违反普通增量去重。新增显式 `recoverPending`
  仅供后台重建恢复使用，普通扫描继续返回新正文；保留原来的空增量断言。补强恢复用例，
  覆盖已采集但尚未翻译的段落以及已停止访问不自动重启。
- 原 E2E 调用未启用的 `ServiceWorker.stopAllWorkers`。实际探测表明启用后也不会关闭目标扩展
  worker；改为按 extension URL 找到唯一 service_worker target，关闭后检查原 target 消失。
  同一生产流程证明 worker 恢复后不重复原段落，并保留停止状态。
- 端口占用验收找出两处 RPC 用例仍写死 4747，已改为产物 origin，保留全部权限、隔离和取消断言。
- 最后字幕窗口恰好等于媒体时长时，短字幕超时暂停可能抢在原生 ended 前发生。测试现在先固定
  起点，再明确让字幕窗口超出媒体结尾，以单独验证自然结束路径。补充首段音频从头播放、
  原生 video ended 早于 audio ended 的断言；完整语音、暂停/恢复、不重播视频和清理断言保留。
  修正后的用例连续 5 次、零重试通过。
- Firefox 首轮媒体门禁因 Codex 进程没有运行目录 / 可用音频端点而失败。测试自动发现 Linux
  本机 Pulse 兼容 socket，为该进程创建专用 null sink，并在 finally 卸载；显式 PULSE_SINK 保留。
  复验真实 WAV 解码与时钟推进通过，最终未遗留测试音频模块。

## 本轮实际验证

| 验证              | 结果与范围                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 开发与测试并行    | `pnpm dev:test` 中单测 watch 完成 116 files / 872 tests，同时另一路生产构建成功；开发服务 HTTP 200，开发 HTML 使用 HMR，生产 HTML 无 HMR |
| 同包集成          | 两浏览器目标均具备 Assistant、Video Dubbing、Page Toolbox、网络脚本、后台、侧栏和真实 PNG icons                                          |
| Chromium 严格整套 | `pnpm verify:chromium`：66/66，零重试；4747 在整段验收中保持占用，开发 watcher 同时运行                                                  |
| Firefox 整套      | `pnpm verify:firefox`：构建与身份校验、web-ext 零 errors/warnings；真实临时安装 5/5，包括配音实际解码/播放及网络管理                     |
| SDK               | `pnpm verify:module-sdk`：可复现的 20 个打包文件与消费者验证通过                                                                         |
| 核心检查          | 初轮统一 factory CI 配置的工具回归、typecheck、lint、872 unit / 覆盖率通过；最终源码绑定 evidence 见本机 result                          |

源码和配置完成后以 `.agent-factory.ci.json` 再生成最终 core evidence 并执行 attest；精确路径、
命令退出码、HEAD、最终结果和清理记录保存在 Git common-dir 的
`agent-factory/tasks/integrate-browser-dev-test*` 下。完整浏览器日志、原始失败 trace 和目录隔离
JSON 同处该本机记录；Chromium 正式门禁附件位于 `artifacts/test-results/chromium/`。

## 验证边界

本轮验证同一源码组合及隔离开发 / 自动测试，不代表收费模型质量、所有真实网站或物理音质。
此前 Windows / 真实网站证据仍由原检查点单独限定。本轮未委派子代理，也未把实现者自查称为
独立评审；独立评审尚未运行，不标记 factory 的 `ready-local` 评审状态。

使用的开发命令与加载目录见 [README](../../README.md#同时开发与测试)。本轮参考了
Chrome Extensions 的 worker / 消息生命周期规范及 writing-for-agents 的文档入口规则；
Modern Web Guidance 对 DOM 增量观察的两次检索没有匹配指南，没有引入无关 UI 模式。
