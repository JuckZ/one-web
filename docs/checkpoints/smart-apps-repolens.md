# 智能工具两种形式与 RepoLens 内置迁移

日期：2026-11-16，Linux CachyOS。Base：`ee6405d21e0f7d9913ab052fb7da548c3ed88821`。

## 实现

按用户提供截图实现两种创建类型：网页标准工具和交互小应用。统一工具页提供搜索、分类、逐项启停、编辑、删除确认、导入导出与既有模块入口。图片中的文字作为参考内容，不作为任务外授权。

- 网页工具：纯文本模板、HTTP(S) 适用规则、显式当前页/选文采集、既有模型服务、字面量结果、停止/关闭/导航失效。展开后超过既有模型的64KiB输入边界会明确提示缩短内容或使用选文，未发送模型请求。
- 用户 HTML 小应用：编辑或显式 AI 生成、预览后保存、两层 opaque sandbox、有界 render-only 握手。无 extension API、页面、外部网络、持久存储或用户脚本注入能力；交互态随关闭清空。Firefox 采用单文件 classic loader，避免 opaque-origin ES module 加载限制；不放宽扩展页脚本 CSP。
- RepoLens：`dev.juck.repolens` 更新为打包 builtin，保留启停状态；概况、发布/活动、TF-IDF相似项目、本机缓存/分析时Star快照和报告复制/下载。固定GitHub API GET，可选Token后台会话保留，显式记住才本机保存。无独立服务、旧`.env`、SDK分发或数据库依赖。
- 远程模块：保留现有宿主/SDK及所有授权隔离；协议测试改为真实安装的单独参考模块。生产不再预授予本机RepoLens origin，release CI不再要求远程RepoLens配置。

相关规格：[smart-apps](../specs/smart-apps.md)；决策：[ADR-0024](../adr/0024-smart-apps-and-packaged-repolens.md)；数据流：[privacy inventory](../privacy-data-inventory.md)。独立`repolens-starter`源码和既有未提交修改均未改动。

## 公开行为与证据

| 层          | 公开行为                                                                                                                      | 实现/检查                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| T1          | 有界定义、并发保存、启停持久化、导入分配ID且停用、字面量模板、数据隔离                                                        | `src/apps/__tests__/`实际controller/client/protocol；`src/modules/builtin/repolens/__tests__/`固定HTTP/storage系统边界 |
| T2          | 源正文/选文提取、导航失效、禁止表达式/恶意URL、取消与迟到输出                                                                 | 既有PageContext/Assistant回归；新应用模板和视图公开行为测试                                                            |
| T3          | 双类型创建/编辑/删除确认、明确大小错误、重复打开/关闭时取消、旧seed迁移、管理刷新不覆盖操作结果                               | `src/sidebar/__tests__/smart-apps-view.test.ts`、`repolens-view.test.ts`、module management与migration测试             |
| T4 Chromium | 实际生产扩展、真实本地HTTP/SSE模型、网页/选文；AI HTML计数器与父页面/网络/API隔离；原生RepoLens的GitHubHTTP层拦截、缓存与报告 | `e2e/smart-apps.spec.ts`、`repolens.spec.ts`及完整既有suite                                                            |
| T4 Firefox  | 临时安装生产包、严格manifest lint、网页工具及nested-frame交互与网络/API隔离                                                   | `scripts/firefox-smart-apps-scenario.ts`加入既有Firefox gate；不使用用户profile                                        |

本轮实际迭代保留于 Git common-dir `agent-factory/tasks/smart-apps-repolens…/`，含task、review、result；每次factory运行包含精确源码快照、命令和日志。**最终门禁与attest路径以该任务的`result.md`为准**，而不是把中间失败覆盖为通过。

已观察的迭代证据：核心门禁123文件909单测通过；新增生产用例3/3通过；第二轮定向生产复验4/4通过；一次完整Chromium回归79/80，唯一失败是模块移除反馈被权限刷新覆盖，已用`preserveFeedback`及公开回归修复。Firefox初次发现custom sandbox CSP review warning和ES module加载限制，之后实际classic loader counter/API/parent/network实验通过且严格lint为0错误0警告。正式门禁继续验证相同修复与持久回归。

独立评审分工：未参与UI/接线的代理审该范围，另一位未参与app库实现的代理审app库与sandbox。前轮输入上限和取消归属问题已修复并增加公开回归；最终复评及平台结果存同一任务记录。

## 限制

本机fixture验证协议、界面和生命周期，不证明真实模型生成质量、GitHub可用额度或所有站点兼容。没有调用用户真实模型/Token，也没有发布、提交、推送或修改浏览器现有安装。Firefox版本/平台以真实gate日志为准；Windows/macOS和移动端未验收。HTML小应用不提供跨次持久交互数据、网络、复杂通用工作台或GM API。RepoLens不包含旧服务的商业搜索、额外安全/历史来源、每日离线采集或多人后台设施。
