# 智能工具与 RepoLens 内置迁移

日期：2026-11-16。用户授权：参考提供的 Monica 两种智能工具形式和油猴启停管理，把 RepoLens 核心功能迁入 OneWeb。

## 范围与浏览器收益

工具页统一列出网页标准工具、小应用和既有模块。网页工具基于当前页面/选文就地生成回答；小应用承载与浏览任务相关的轻量交互；RepoLens 在浏览 GitHub 时识别仓库并就地分析。通用应用市场、复杂应用工作台、任意网页注入脚本和完整 GM\_\* 兼容不是本轮功能。

## 两种形式

- **网页标准工具**：名称、说明、HTTP(S) 匹配规则、启用状态和纯文本提示词。支持 `${text}`、`${title}`、`${url}`；不运行模板表达式。用户明确运行当前页或选文后才捕获内容、调用现有 Assistant 服务。来源查询参数/hash 不进入提示词，结果按文本显示。捕获授权和模型授权分别处理；创建、打开、保存都不自动发送页面。模型设置沿用现有入口。
- **小应用**：名称、说明、匹配规则、启用状态和有界 HTML。用户可以编辑 HTML，或显式调用已配置的模型生成，预览后保存。代码只进入打包的 opaque sandbox 及其嵌套 sandbox，不进入扩展执行域。没有网络、页面、浏览器能力或持久存储接口；关闭后交互状态清空。内置 RepoLens 为打包可信模块，使用自己的有限后台接口，不能把该能力授给用户 HTML。

统一管理提供搜索、类型筛选、启停、编辑、删除确认、JSON 导出和导入。导入只接受版本化 schema，重新分配 ID 并默认停用。最多 50 个应用、2 MiB 总定义、每个小应用 HTML 256 KiB、提示词 16 KiB；超限报错而不自动删除。既有模块仍在 Registry 中管理，不把用户 HTML 注册为可信 builtin。

## RepoLens

原有 `dev.juck.repolens` seeded record 更新为 builtin，同 ID 保留用户启停选择，移除 remote entry/source。独立 `repolens-starter` 无运行或构建依赖，不读取其 `.env`、Token 或分析数据，也不删除其源码。

保留公开仓库概况、README/Topics 多查询候选、TF-IDF 重排、最近发布、90 天 Issue/PR 活动、维护/采用指标、本机分析时 Star 快照、缓存及 Markdown 复制/下载。只允许固定 `https://api.github.com` GET endpoint；可选 exact-origin 权限由分析按钮直接请求。可选 PAT 默认会话保存，明确选择后本机保存；Token 不返回 UI、不进报告/URL/其他模块。所有 API 请求标明 public-only；不允许私有仓库进入本机报告。

不迁入服务端认证、多人数据库/队列、每天离线采集、商业搜索、Ollama、OpenSSF/OSS Insight 等额外来源。缺失外部证据不得伪造安全评分。匿名限流与部分来源失败公开显示，保留已经成功的分析项。

## 生命周期与边界

可信 sidebar 消息才可管理应用或调用 RepoLens。远程 frame、网页和小应用均不能调用这些协议。页面切换、关闭、停止、应用停用/删除和权限撤销必须停止相应工作；异步完成使用 generation 检查，不能恢复已关闭的视图或覆盖新结果。后台 worker 重启可以丢弃进行中的分析，但已保存设置、缓存和定义仍可读回；不承诺后台任务持续驻留。

## 验收

1. 从工具页新建两种类型，保存、编辑、搜索、停用、刷新、导出/导入、删除确认均有可见结果。
2. 网页工具只在显式运行时采集/调用，真实 HTTP/SSE fixture 收到预期正文/选文，HTML 输出不执行，关闭/导航后的迟到结果丢弃。
3. AI 生成计数器可在生产 sandbox 中交互，扩展 API、父页面和外部网络不能访问；管理页不执行代码。窄侧栏及完整标签页可用。
4. RepoLens 原生入口在无本地服务时通过固定 GitHub API fixture 完成分析、缓存、报告与 partial；旧 seeded record 升级后保留停用状态。两种以上其他模块不受影响。
5. Typecheck、lint、全部 unit、生产构建和 Chromium E2E；Firefox 单列构建、manifest 与实际生命周期证据；真实收费模型与 GitHub 额度不由 fixture 证明。

实施与本轮证据见 `docs/checkpoints/smart-apps-repolens.md`。
