# ADR-0027: WXT、React 与 TanStack 工作台

- 状态：接受，用于本地实现；验证结果按最终源码另行记录
- 日期：2026-11-19
- 基线：`34ce32b057da492c8f8e4addc0856d632c1eb4ca`

## 背景

用户要求“拉取最新代码，重新根据最新代码情况来做架构迁移”，此前已指定 WXT 和 TanStack，
允许不考虑历史兼容。本轮以最新主线的统一工作台为基础，覆盖 Assistant、RepoLens、模块平台、
Cookie Manager、Browser Journal、Bookmark Doctor、网络管理、Page Toolbox、OpenList、
视频配音和智能应用，保留独立 userscript 与 module-sdk。

主线业务大多已经采用 TypeScript controller、有限协议和独立 DOM view。
手写 Vite 扩展多入口需要同时维护 manifest、注入脚本、页面路径与开发替身；
遗留 Vue、Element Plus、UnoCSS 演示入口不属于当前生产工作流。
迁移的目标是统一扩展构建和工作台 UI 的职责，让现有安全边界继续成为业务行为的事实来源。

## 决策

### 1. WXT 统一扩展入口与产物

使用 WXT 和 `@wxt-dev/module-react`，两个目标均为 Manifest V3。`src/manifest.ts` 保留产品元数据、
权限和 CSP；WXT 从 `src/entrypoints/` 发现后台、GitHub 内容脚本、工作台页面和固定 unlisted scripts。
关闭隐式 imports 与开发时自动启动浏览器，使用现有隔离测试和手动加载流程。

采用 WXT 的入口路径，不保留旧 `dist/*` 或 `sidebar/index.html` 的兼容副本：

| 产物                                                                | 用途                                              |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| `background.js`                                                     | Chromium module service worker / Firefox 后台脚本 |
| `content-scripts/github.js`                                         | GitHub 顶层页面仓库身份观察                       |
| `sidebar.html`                                                      | 原生 side panel / sidebar 与完整标签页工作台      |
| `sandbox.html`、`sandbox-runtime.js`                                | manifest sandbox 和 classic HTML 小应用加载器     |
| `assistant.js`                                                      | 授权后的页面上下文、选文和浏览器任务 runtime      |
| `page-toolbox.js`                                                   | 授权后的固定页面工具 runtime                      |
| `video-dubbing.js`                                                  | 授权后的隔离播放器 runtime                        |
| `network-support.js`、`network-devices.js`、`network-additional.js` | 明确启用的 WebRTC 页面防护                        |

unlisted 仅表示打包方式，不表示自动注入或授权。固定注入器、打包页 sender 校验、沙箱 URL 验证、
manifest 与测试必须同步使用新路径。网络脚本维持 MAIN、`document_start`、`allFrames`、
`matchOriginAsFallback` 和 `persistAcrossSessions` 的注册语义。

`pnpm build` 串行执行 SDK 构建、WXT 扩展构建和身份校验。默认扩展目录为
`artifacts/build/chromium/`；Firefox 生产目录为 `artifacts/build/firefox/`。
开发与门禁分别使用 `artifacts/dev/<browser>/` 和 `artifacts/test/<browser>/`。
`ONEWEB_EXTENSION_DIR` 同时约束 WXT 输出及检查、打包工具的输入，同一目录只运行一个构建者。
删除手写 Vite 扩展多入口与未使用的 Vue 演示，不移除独立 userscript 的 Vite 构建。

### 2. React 负责导航和列表，宿主维持业务生命周期

`WorkspaceView` 在独立 React root 内渲染导航，通过 `useSyncExternalStore` 读取
`WorkspaceController` 快照。TanStack Router 使用 hash history，支持目标定位、刷新与历史导航；
根路径恢复保存的位置，目标合法性和模块存在性由控制器检查。
`moduleId` 与一次性 `handoff` 查询仍由宿主处理；显式 hash 优先于 `moduleId`，后者在初始化 Router 前从 URL 消费并移除。
设置的“返回草稿”由宿主导航，恢复本页面实际进入设置前的位置、草稿与附件；冷启动直接进入设置时默认返回助手，
初始化期间读取到的持久化旧位置不作为本页面的返回目标。这里不引入 TanStack Start、SSR 或服务端路由。

`WorkspaceView` 创建稳定 outlet，`src/sidebar/main.ts` 继续拥有业务视图的 mount/dispose、
Assistant 生命周期 port 和远程 frame 会话。React 不对该 outlet 的业务 DOM 做重复渲染。
现有 Assistant、RepoLens、Cookie、视频和设置视图通过适配接入。

选择渐进 React 宿主的原因是这些 controller 和 protocol 已经承载权限复核、owner、tab/document、
模块/视频身份、epoch、取消与迟到结果丢弃等规则。重新实现全部业务层会扩大功能与隔离回归范围，
也不会增加本轮导航和列表所需的能力。保留适配是当前架构选择，不是为未使用过的旧应用添加兼容层。

### 3. Query 只读取 registry，写操作保持显式

每个 `WorkspaceController` 拥有自己的 Query client，当前仅用
`fetchQuery`、`['workspace', 'modules']` 和 `staleTime: 0` 读取已安装模块列表。
初始化、模块管理回调与 registry 存储事件显式重新读取；registry 的持久化所有权仍在后台。
查询设置 `retry: false`、`refetchOnWindowFocus: false`，mutation 默认 `retry: false`，
工作台销毁时清空 client。

智能应用定义仍经 `SmartAppsClient` 读取。模型生成、授权申请、模块启停、页面写回、Cookie 写入、
网络设置与其他有后果的操作不放入 query function，也不因路由加载、聚焦或读取刷新自动执行。
凭据、临时授权和页面操作令牌不进入通用 Query 缓存。本文不把后续可能扩展的查询或失效机制写成现有功能。

### 4. Table 与 Virtual 服务应用列表

`SmartAppsView` 保留工具栏、对话框、导入、生成流程及 `MiniAppRunner`；
独立 React 列表 root 合并内置/远程模块与用户应用，采用 `module:` / `app:` 稳定行 ID。
TanStack Table 执行名称/描述搜索、类型过滤和名称正逆序排序。
过滤排序后的行数超过 50 才启用 TanStack Virtual，小列表直接渲染可访问列表。

只更新列表 props 不重新打开运行器，不取消正在执行的生成或替换对话框。
启动应用和 dispose 显式 unmount 列表；dispose 后可再次 open。
虚拟化数量阈值属于当前实现，不能替代实际窄屏、键盘和大量数据验收。

### 5. 平台与分发边界继续独立

Chromium 保留 `side_panel`，Firefox 保留 `sidebar_action` 与后台脚本，最低声明版本分别为 148 和 142。
两个目标保留 GitHub 必需 host 权限，以及可选 `bookmarks`、`cookies`、`privacy` 和 HTTP(S) host 权限。
敏感动作仍在明确用户操作中申请授权，并由后台复核 origin、owner 和生命周期。

远程模块继续运行在受审查的 iframe，通过 origin/source、module ID、nonce、schema、quota 和字段交集
验证的有限 bridge 通信；不获得 React 宿主、browser API 或通用脚本/fetch 代理。
HTML 小应用继续使用 opaque sandbox、classic 单包加载器和闭合的嵌套文档 CSP。
Chromium 设置 manifest sandbox CSP，Firefox 保留其沙箱默认策略及相同嵌套隔离，不放宽特权页 CSP。

`packages/module-sdk/` 保留独立 TypeScript 包构建与契约验证。
userscript 保留独立 Vite IIFE、GM 适配和 `artifacts/build/userscript/` 产物；
只复用有限页面 DOM 工具，不模拟后台协议或获得扩展 API。
模型服务密钥、Cookie、Clash/OpenList 等凭据继续留在各自 controller 的既有存储边界。
统一 GitHub Releases 的三目标资产约定继续按 [ADR-0026](0026-unified-stable-release.md) 执行。

### 6. Firefox 完整扫描与 React vendor 诊断

Firefox 生产构建把锁定版本的 React、React DOM 和 scheduler 单独输出为纯 vendor chunk；
CommonJS helper 保持独立，第一方模块不能混入 vendor。构建校验固定的上游源文件 SHA-256，
生成绑定源文件、chunk 文件名和 chunk SHA-256 的 `oneweb-react-vendor-policy.json`。

`pnpm manifest:validate` 仍对完整扩展执行 `web-ext lint --warnings-as-errors`，不继承
`WEB_EXT_*` 或外部配置，也不跳过文件或规则。项目策略仅接受已校验 vendor 字节中两个
React DOM `innerHTML` 赋值对应的精确诊断；其他规则、位置、重复、计数、错误或 notice 均失败。
依赖或构建字节变化需要重新核对，不能沿用一个文件级别的豁免。

这是项目对锁定上游代码的接受策略，不代表原始 linter 零告警、Mozilla 审核或商店批准。

## 后续新增功能边界

- 先按根 `AGENTS.md` 判断浏览器依赖与插件体验收益，完整定义采集、执行、查看、显式写回或返回来源。
  通用创作、知识库、跨应用编排和完整聊天平台由外部产品承载。
- 新导航、列表和纯展示优先用 React；新浏览器能力进入有类型的有限 controller/protocol。
  新 context、存储、外传 origin、权限或凭据同时更新隐私清单。
- 新扩展入口使用 WXT，不恢复手写扩展多入口配置。改动产物路径时同时修改固定注入、sender allowlist、
  沙箱验证、打包检查与真实浏览器测试，不依赖历史路径兼容副本。
- 未来将某个 DOM view 改为 React 时，按该视图完整生命周期迁移并单独验收；
  不把取消、撤权、worker restart 或迟到结果清理改成普通组件渲染副作用。
- 扩展 Query 用途前确认读取无副作用、数据可缓存且有明确清理范围；
  任何模型请求、授权和浏览器写入仍需要独立显式动作及错误处理。

## 验证边界

本 ADR 记录当前代码的决策，不声明迁移门禁已通过。最终验收需要绑定实际源码，覆盖类型、lint、
单测、两个浏览器的生产入口与固定资源、SDK、userscript，以及导航/历史、列表、权限撤销和沙箱回归。
生产构建、确定性 fixture、真实站点、收费服务与主观媒体质量分别记录证据；缺失项明确标为未运行。
历史 checkpoint 保留原版本，不批量重写成新架构通过记录。
