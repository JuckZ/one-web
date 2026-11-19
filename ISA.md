---
project: one-web
name: Latest OneWeb WXT and TanStack Migration
task: "拉取最新代码，重新根据最新代码情况来做架构迁移"
phase: climbing
progress: 4/4
started: 2026-11-19T05:42:00Z
updated: 2026-11-19
---

## Ideal State

### L3 · One sentence

最新 OneWeb 的统一工作台使用 WXT、React 和 TanStack，保留浏览器任务、内置模块、远程模块隔离与独立 userscript 的完整行为。

### L2 · Summary

- WXT 管理 Chromium/Firefox Manifest V3、后台、GitHub 内容脚本及固定的按需注入资源。
- React 管理工作台导航和列表；TanStack Router 提供 hash 路由，Query 管理只读数据与失效，Table/Virtual 支撑工具列表。
- 复用现有 TypeScript controller、有限协议和 mount/dispose 视图，保留权限撤销、导航、断线和迟到结果的处理。
- userscript 和 module-sdk 独立构建，既有最小权限和沙箱策略继续接受自动化验证。
- 清除未纳入最新生产构建的 Vue 演示页及手写扩展构建，不迁回旧本地整理器覆盖主线。

### L1 · Full articulation

以 origin/main 的 34ce32b057da492c8f8e4addc0856d632c1eb4ca 为基线，迁移其统一工作台、Assistant、RepoLens、模块平台、Cookie Manager、Browser Journal、Bookmark Doctor、网络管理、Page Toolbox、OpenList、视频配音和智能应用。入口采用 WXT 标准产物路径，并同步信任校验、固定注入器、测试和打包脚本。现有内置视图通过明确的生命周期适配，业务 controller 和能力协议保持边界。读取缓存不得自动发起模型请求、授权或浏览器写操作。桌面与窄屏均以真实浏览器验收。

## Problem

手写 Vite 多入口、开发 stub、隐式 Vue/browser 导入和路径契约需要人工同步，随着模块增加易产生构建与权限边界漂移。

## Vision

单扩展承载明确的浏览器任务；新增模块不复制构建脚本，数据读取与用户动作有清楚边界，打包产物及测试使用同一入口契约。

## Features

### F10 · 基于最新主线重新迁移

- [x] ISC-35: 以最新 origin/main 为基线，保留统一工作台、模块平台、OpenList、Cookie、网络管理、视频配音和 userscript 的既有功能与权限边界。
- [x] ISC-36: WXT 接管 Chromium/Firefox 扩展入口及资源，固定注入和沙箱引用均可解析，生产扩展不依赖手写 Vite 多入口构建。
- [x] ISC-37: React 与 TanStack Router/Query/Table/Virtual 实际承载导航、只读模块数据和工具列表，直接链接、刷新和历史导航有效；浏览器写操作不由查询重取执行。
- [x] ISC-38: 最新主线类型、lint、单测、双浏览器扩展构建、SDK、userscript 和相关浏览器回归通过；记录独立桌面和窄屏验收及实际未覆盖项。

## Test Strategy

| Criterion | Kind   | Evidence                   | Expected | Probe                                                                                        | Assay tier |
| --------- | ------ | -------------------------- | -------- | -------------------------------------------------------------------------------------------- | ---------- |
| ISC-35    | bash   | 最新基线与业务回归         | exit 0   | git merge-base --is-ancestor 34ce32b HEAD && pnpm test                                       | literal    |
| ISC-36    | bash   | WXT 双浏览器及资源         | exit 0   | pnpm build:chromium && pnpm build:firefox && pnpm pack:zip                                   | literal    |
| ISC-37    | bash   | 路由、读取、列表与显式动作 | exit 0   | pnpm typecheck && pnpm test:e2e:strict                                                       | literal    |
| ISC-38    | manual | 自动检查与真实界面验收     | pass     | pnpm verify；pnpm verify:module-sdk；pnpm verify:userscript；desktop/narrow browser captures | literal    |

## Decisions

- 2026-11-19：用户原文“拉取最新代码，重新根据最新代码情况来做架构迁移”；此前指定 WXT 与 TanStack，React 已为选定 UI 路径，中途无需询问。
- 主线已新增21个提交。原本地未提交成果已逐字备份并校验SHA-256，位于 .git/migration-snapshots/2026-11-19T05-42-49-592Z；旧ISA与证据保存在该目录，本轮不把其通过状态当作新主线证据。
- 参考为最新主线的现有工作台；本轮保留其视觉结构与功能，不进行新视觉方案选择。
- 大多数最新业务视图已为独立DOM类；React负责导航与列表，现有controller/protocol和视图生命周期适配保留，避免扩大安全敏感业务重写范围。
- WXT采用标准入口路径；更改路径必须同时更新固定脚本注入器、沙箱URL验证、Manifest、回归测试和产物校验。
- Query仅缓存模块列表等只读状态，不缓存凭据、模型请求或用户授权；mutation默认不重试，不自动执行写入。
- 独立userscript保留Vite IIFE构建，module-sdk保留独立tsc和包校验。
- Development tier 2内联执行；用户未选择Workflow。没有发布、推送、合并或付费模型调用授权。
- 2026-11-19：用户新增授权“提交代码并完成正式评审”。续跑同一任务，保留repair-round 1及原归档记录；提交已验收迁移后执行committed-HEAD Review.ts，不使用dirty/blocker/round-cap豁免。

## Status

baseline: 34ce32b057da492c8f8e4addc0856d632c1eb4ca
acceptance: pass 2026-11-19 artifacts/acceptance/migration-review-1-final2/desktop-1440-assistant.png artifacts/acceptance/migration-review-1-final2/narrow-360-reading-settings-return.png artifacts/acceptance/migration-review-1-final2/narrow-420-tools.png — 独立真实扩展 UI，1440/360/420px，13张截图回读，19/19产物初末一致；范围与限制见 acceptance-result.json
verification: 最新核心133文件995测试、typecheck、lint（0 errors/24 warnings）、Firefox完整gate、SDK、userscript6用例及双浏览器分发包校验通过；最终完整Chromium 86/86，retries 0，日志.git/migration-chromium-final-r1e.log；提交后IsaCheck acceptance exit 0；factory在Windows不支持fcntl，未有成功attest
review: round 1源码复评关闭R0-1至R0-5，独立6文件36测试及UI与ZIP/XPI字节核对通过；repair-round: 1；正式Review.ts在迁移提交1df6f937536f63838d75374ac5f0b5fd489364b3上pass，覆盖152文件/4批，由gpt-6.1-sol评审，findings为空；无豁免
formal-review: artifacts/reviews/migration-formal-review-1/review.json及receipt.json；base 34ce32b057da492c8f8e4addc0856d632c1eb4ca，head 1df6f937536f63838d75374ac5f0b5fd489364b3，scope .，dirty false；回执与diff散列及磁盘正式记录已逐项核验
handoff: 迁移代码已提交并通过正式评审；项目总体验收仍为needs-input，仅factory check/attest缺POSIX执行环境；原评审归档.git/agent-factory/tasks/wxt-tanstack-latest.done-20261119T094239Z/保持不变；提交与正式评审续跑证据见artifacts/migration-handoff.md
next: 在支持POSIX的环境为最终版本取得factory check/attest；本次评审结果文档单独提交后复评，不改生产源码、测试或制品；没有推送授权

### Repair round 1

- 工具列表须持续可输入；稳定Table受控状态并禁用无分页列表的分页重置，覆盖筛选、排序、开关完成及registry更新。
- moduleId仅作为一次性显式工具入口；消费后清除，后续hash导航、刷新与历史保持目的地。设置中的“返回草稿”恢复此前工作区位置，页面内容、导航选中态和hash一致，保留草稿；直接打开设置时回到助手。
- pack/start消费调用者指定产物目录；恢复jszip直接依赖，修复Windows SDK命令。Chromium隔离测试由临时扩展副本引导浏览器原生授权，正式启动前恢复原始manifest；真实contains读回失败即停止，保留可选权限撤销验证，不直接改写受保护profile设置。
- 无关registry刷新完成后运行中sandbox状态仍保留；GitHub内容脚本失效时销毁observer。当前远程模块被移除时回到助手并拆除iframe；通过移除前真实成功的同一storage请求验证移除后SESSION_DESTROYED，继续检查命名空间清理、跨模块隔离和权限释放，不向已拆除frame发起读取。
- Firefox保留warnings-as-errors；vendor告警需精确解释/处理并重跑，不以构建成功替代验收。
- 编辑器预览完成后，同一选区的延迟selectionchange不得隐藏显式写回按钮；真正更换选区仍进入新选区操作。保留完整Chromium失败trace，先在旧实现复现重复事件，再验证修复与真实点击写回。
- 选文排序测试的480px viewport在页面与助手初始化前设置，避免与按规格隐藏工具栏的resize事件交错；保留PS-03专门的真实resize/scroll隐藏检查，排序、键盘、拖动、原文和显式替换断言不放宽。

## Articulation Log

- 2026-11-19：基于最新主线重述本轮标准，历史整理器ISA已完整保存在迁移快照。
