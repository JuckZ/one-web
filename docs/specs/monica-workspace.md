# OneWeb 统一工作区与 Monica 核心交互迁移规格

日期：2026-11-12（Asia/Shanghai）。
状态：**批准范围已实现；最终验证结果和已知限制见实施检查点**。

用户要求：参考本机 Monica 的实现，将核心功能及交互迁入 OneWeb，
同时允许重构现有功能交互，不需要兼容旧交互或旧数据结构，采用 SDD 与 TDD。
参考证据、版本、静态分析与真实浏览器观察的限制见
[Monica 参考实现核查](../research/monica-reference.md)。

## 1. 要交付的结果

OneWeb 打开后成为可以直接使用的侧边工作区：
用户能聊天、带当前页面或选文提问、总结、翻译、改写；
已有浏览器工具有自己的功能页面。安装、启停、来源和权限在设置中管理。
同一个工作区可以在原生侧栏和完整标签页中使用。

“核心迁移”包含以下完整文本工作流：

1. 配置自己的模型服务，选择模型并完成可停止的流式聊天。
2. 主动附加当前网页、选文或导入文本，再总结与继续追问。
3. 在网页选文旁翻译、解释、总结、改写；在可编辑区域预览并显式插入/替换。
4. 主动启动网页双语翻译、停止并恢复原文。
5. 使用内置及自定义提示词，查看本机对话历史并收藏结果。
6. 从统一导航直接进入现有各个工具，管理功能不再承载全部日常操作。

Monica 的完整商业产品还包括联网搜索、生成式图片/视频、云知识库、
多步骤 agent 等。它们纳入能力清单，但本规格首个可执行交付不声称提供这些服务。
每项需要实际 provider、返回契约和独立验收后才能标为可用。
PDF/OCR、跨站编辑器全面兼容、自动网页翻译及自动执行网页任务亦分别验收，
不能通过可见入口或普通聊天响应代替。
用户于 2026-11-12 回复“开始实现”，确认按本规格推进。

## 2. 使用方式

### 工作区

宽侧栏与完整标签页采用固定主导航：**助手、阅读、翻译、写作、工具**。
底部提供历史、收藏和设置。窄侧栏将导航折为图标与可访问名称，
不让输入区、正文或按钮产生横向滚动。

```text
┌──────────────────────────────────────────────┐
│ OneWeb   当前页面标题       新对话  打开标签页 │
├──────┬───────────────────────────────────────┤
│ 助手 │ 对话 / 阅读 / 翻译 / 写作内容           │
│ 阅读 │                                       │
│ 翻译 │ 当前任务状态、结果与继续追问           │
│ 写作 │                                       │
│ 工具 │ [来源：当前网页 / 选文 / 导入文本] [移除]│
│      │ [模型选择]                            │
│ 历史 │ [输入框，Enter 发送 / Shift+Enter 换行] │
│ 收藏 │ [附加当前页] [提示词]     [发送 / 停止] │
│ 设置 │                                       │
└──────┴───────────────────────────────────────┘
```

当前页面指示和已附加的内容分别展示。切换 tab 可以更新页面指示，
但不能替换已有消息和附件。页面内容只在明确附加、总结、翻译等动作后采集。
新对话默认无附件；普通聊天不要求任意网页读取权限。

首次无模型配置时，保留工作区与本地工具入口；
发送区给出“配置模型服务”，配置完成返回原草稿。
错误、取消与部分结果有稳定状态，不把失败显示成“已完成”。

### 网页入口

工具栏图标打开原生侧栏。快捷键提供打开工作区与 Quick Ask 两项；
建议值实施时检查浏览器接受与冲突结果，不抢占 Monica 的 Ctrl+M / Ctrl+J。
Chromium 生产包实际注册 **Alt+Shift+O** 打开工作区、
**Alt+Shift+K** 打开 Quick Ask；初选 Alt+Shift+A 未获分配，已据浏览器结果调整。
用户环境可能存在不同冲突，设置中提示到浏览器扩展快捷键页调整。
上下文菜单提供选文提问、翻译、解释与总结当前页。

网页悬浮入口仅在用户启用并授权的站点注入，位于独立 Shadow DOM。
菜单区分本次访问隐藏、此站点隐藏、全局关闭；
站点隐藏与全局关闭可在设置中恢复。
阅读选文显示翻译、解释、总结、改写和继续问；
输入框选文显示改写、语气、长度及翻译。
按 Escape、取消选区、导航、停用或撤权应收起工具条。

结果在小面板中就近预览，允许复制、停止、重试和转到工作区继续问。
选区不会因为点击工具条失效；发出请求前冻结文本与来源。
输入法组合期间 Enter 不发送。

### 现有工具

工具页显示已安装工具，支持名称搜索、收藏及可用状态。
点击工具直接进入独立功能视图；未启用时在该入口启用，
需要站点或浏览器权限时继续走原控制器流程。

需要直接进入的功能：RepoLens、Page Toolbox、Cookie Manager、
Bookmark Doctor、Browser Journal、Clash Control、Send to OpenList、Video Dubbing。
新增或安装的 remote module 同样从模块记录导出入口，不写死成 RepoLens。

设置中的模块页保留安装、启停、移除、更新、权限与来源；
不再同时渲染所有模块的日常表单和任务结果。
从设置返回应恢复此前的工作区位置与草稿。

## 3. 可验收要求

| 编号  | 用户可见行为与独立预期                                                        | 测试 seam      |
| ----- | ----------------------------------------------------------------------------- | -------------- |
| MW-01 | 无配置可浏览工作区和使用本地工具；发送时明确进入配置并保留草稿                | T3、T4         |
| MW-02 | 保存合法服务配置后可以切换配置中声明的模型；读回配置不包含 key                | T1、T3、T4     |
| MW-03 | 发一条消息只产生一次模型请求；流式输出、完成和取消状态准确                    | T1、T3、T4     |
| MW-04 | 停止、重复请求、关闭视图和旧请求晚到不会覆盖新结果；重试为显式操作            | T1、T3、T4     |
| MW-05 | 附加当前页面后能看到来源和截断状态；继续提问使用同一份附件                    | T2、T3、T4     |
| MW-06 | tab 切换、同 tab 导航及撤权使旧页面操作失效；普通聊天记录仍可阅读             | T1、T2、T4     |
| MW-07 | 选中文本后触发翻译/解释/总结/改写，模型收到确定的选文和 action                | T1、T2、T4     |
| MW-08 | 写作结果先预览；点击替换才改变原选区；文本已变化时拒绝覆盖                    | T2、T3、T4     |
| MW-09 | 网页双语翻译保留原文；停止或恢复只删除本次译文，页面自身新内容被保留          | T1、T2、T4     |
| MW-10 | 自定义 prompt 可以新增、排序、编辑、删除；模板只替换允许变量                  | T1、T3         |
| MW-11 | 历史可搜索、打开、删除；收藏可从结果添加和取消；清空后读回为空                | T1、T3、T4     |
| MW-12 | 各现有工具可直接打开；remote module 正常桥接，builtin 不再显示未接入          | T3、T4         |
| MW-13 | 工具搜索、收藏与最近使用不改变模块的启用、授权或业务数据                      | T1、T3、T4     |
| MW-14 | 模块管理完成安装/启停/移除/更新；不再自动挂载全部功能视图                     | T3、T4         |
| MW-15 | 网页悬浮入口、上下文菜单、Quick Ask 与侧栏传递同一份意图和文本                | T2、T3、T4     |
| MW-16 | 本次/站点/全局隐藏作用域准确；撤权清理 root、监听器和正在处理的页面操作       | T2、T4         |
| MW-17 | 360px 侧栏、完整标签页、键盘与中文输入法均可完成发送/停止/导航                | T3、T4         |
| MW-18 | 页面文本、模型结果及模块名称均按文本或受限格式显示，恶意 HTML 不执行          | T1、T2、T3、T4 |
| MW-19 | 请求超时、429、无效 SSE、空响应、断流及 storage 失败均可见且不伪造成功        | T1、T3、T4     |
| MW-20 | 导入 `.txt` / `.md` / `.srt` / `.vtt` 能阅读/总结；无效或超限输入不覆盖旧附件 | T1、T2、T3     |
| MW-21 | Video Dubbing 的已存在能力可从工具页使用；视频阅读首版支持显式导入字幕        | T2、T3、T4     |
| MW-22 | 重开工作区恢复选定位置；失效或已删除模块回退到可用入口并说明原因              | T1、T3、T4     |

原生 YouTube 当前轨道到阅读附件的接入，需在现有字幕能力上形成一个公开、只读、
有来源身份的导出接口后单独验证；不通过访问配音控制器的私有状态实现。
未取得该证据时只标示“导入字幕总结”，不标示“自动读取所有视频”。

## 4. 公开 Interface 与所有权

### Workspace

`WorkspaceController` 对调用者暴露少量操作：
`open(destination)`、`snapshot()`、`subscribe(listener)`、`dispose()`。
`destination` 是固定工作区位置或现有模块 ID；
浏览器提供的 tab ID、origin 和授权不由导航字符串决定。

`WorkspaceView` 负责可访问 DOM、键盘导航、草稿和焦点恢复，
不读取模块私有 storage，也不直接执行 Cookie/书签/代理/下载操作。
所有功能页通过统一 mount / dispose 契约注册，
原 builtin client/controller 和 remote `ModuleFrameHost` 保持为实际执行入口。
同一功能视图只维护一个所有者。

### Assistant

`AssistantClient` 是受信任扩展页面的公开 Interface：

```text
configureProvider(input)
readConfiguration()
start({ conversationId, intent, text, attachmentToken?, modelId, promptId? })
cancel(requestId)
subscribe(listener)
listConversations(query)
openConversation(id)
deleteConversation(id)
clearConversations()
setFavorite(messageId, favorite)
```

这表示行为契约而非要求提前生成这些方法的空实现。
实现可将历史/提示词收敛为各自的深 module，但不得向 caller 暴露内部队列或 storage key。

后台拥有 key、provider 请求、取消、会话归档及请求 generation。
同一对话最多一个正在生成的回答，宿主同时最多两个模型请求。
Port 断开、工作区 dispose、配置更换或相关授权撤销取消所属请求。
后台重启后未完成请求显示中断，由用户重试；
不能假定长 Port 一定能让 MV3 worker 永远存活。

模型请求状态为：

```text
idle → preparing → streaming → completed
                    ├──────→ cancelled
                    └──────→ failed
```

终态不可被晚到 chunk 改回进行中。请求身份包含不可预测 ID、
所属会话和 generation；取消只影响其所有者。
页面附件触发的操作绑定 capture 身份；页面导航后旧的页面操作不得回写。

### Page Context

`PageContextClient` 对受信任工作区提供 `captureCurrentPage()`、
`readSelection()` 与显式 `applyWritingResult(token, text)`；
返回的是短期附件/选区 token 和可展示摘要，不能让 caller 提交任意 tab/frame/origin。
用户手势授权由受信任 UI 发起，后台重新派生并检查实际活动 tab。

固定 content artifact 在 isolated world 中采集与渲染。
按实际 tab、frame、document 身份绑定；导航后失效。
网页仅能请求有限意图，不能指定 provider、key、任意 URL、脚本、CSS 或 storage key。
内容脚本不是受信任管理页面；不能调用配置与历史管理操作。

正文优先选择 `main` / `article` 的可见内容，排除隐藏内容、脚本、样式、
输入值、密码字段、扩展 UI 与非正文导航。没有正文时提供受限的可见文本 fallback，
返回提取方式与截断标志。网页文本作为模型资料，不作为宿主执行指令。

初始资源上限（明确报错或标示截断，不静默丢弃）：

- 页面文本最多 64 KiB UTF-8，最多遍历 3000 个候选元素。
- 选文最多 16 KiB UTF-8；标题最多 512 个 Unicode code point；URL 最多 2048 字节。
- 单个模型请求最多 256 KiB；响应流最多 2 MiB。
- 一个对话最多 64 条消息；本机历史最多 100 个对话、总计 8 MiB。
- 本机历史达到上限后提示删除/清理，不自动删除用户收藏。
- 页面附件与编辑 token 最多保留十分钟，撤权、导航或 dispose 提前清理。

### Provider

首个 adapter 支持用户配置的 chat-completions 兼容服务：
固定 POST `chat/completions`，base URL 与 model 在设置中填写，
接收 `text/event-stream` 或兼容 JSON 结果。
不提供任意 headers、任意 endpoint 或执行表达式的设置。
HTTPS 与 loopback HTTP 的 URL 校验沿用本仓库已有服务配置规则。
native Claude/Gemini 协议和联网检索不是这个 adapter 隐含提供的能力。

SSE 实现必须处理网络 chunk 与 SSE event 分界不一致、
跨 chunk 的 UTF-8、LF/CRLF、注释和多个 `data:` 行。
显式完成标记或经过校验的 JSON 才能产生 completed；
断流、错误 event 和超限不能当作正常完成。
HTTP 错误不会自动改为第二次收费请求。重定向不携带 key 跳转。
超时、取消与部分输出均有公开结果。

服务 origin 权限在用户配置时明确请求；网页读取权限分别申请。
key 只在后台保管，管理页读回配置只见 `keyConfigured`。
默认会话级保存凭据；用户明确选择“记住服务密钥”才持久化，
并限制可读取的扩展上下文。不得把配音模块现有 key 隐式复制进新配置。
保存不自动向模型发送探测消息；测试连接为单独用户动作。

### 本机数据

历史保存状态在设置中明确展示，默认保存本机聊天消息与显式附加的文本；
不采集未附加页面。支持关闭历史保存、单条删除及清空。
来源 URL 清除 query / hash，保留来源类型和提取时间；
不把账户 key、Cookie、浏览器权限、站点表单值写入历史。
关闭保存后，新对话只保留当前运行所需的内存态。

提示词是纯文本模板，只允许 `${text}`、`${language}` 等声明变量，
有长度上限；不执行 JavaScript，不支持模板任意取对象属性。
来源和模型输出按文本或严格受限 Markdown 渲染。

## 5. 页面翻译与写作的可恢复行为

网页翻译固定处理受支持的正文块，首版不自动翻译跨域 iframe、
输入控件、代码块或 Shadow DOM 内部内容。
保留每个块的来源身份与原文摘要，按有界批次请求翻译。
返回结果逐块校验 ID，不依赖模型输出顺序。
译文以独立节点就近插入，原文不被 `innerHTML` 重写。

“停止”取消未完成批次；“恢复原文”删除本次翻译拥有的节点。
页面自身移除或改写的块不得被恢复流程覆盖。
SPA 导航、撤权、关闭及重复启动要满足单实例与资源清理。
动态增量翻译作为后续独立条目，首版不无限监听所有 DOM 变化。

写作 token 绑定具体可编辑节点、原文本、选区、页面 document 与有效期。
模型生成不会触发表单提交。
用户点击插入/替换时重新校验节点与文本，冲突时保留结果供复制。
测试覆盖原生 textarea/input 和普通 contenteditable；
富文本框架不能仅凭原生编辑器通过而宣称兼容。

## 6. T1～T4 公开测试 seam：已确认

用户于 2026-11-12 以“开始实现”整体确认以下四组公开 Interface。
本次确认独立于 Video Dubbing；按 TDD skill 从公开行为进行逐条 red → green。

| Seam                     | 测试调用的公开 Interface                                                                                                                                 | 可以发现什么                                                                   | 单独不能证明什么                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| T1：Assistant 与本机数据 | 真实 `AssistantClient` / controller、配置、会话、提示词与历史操作；外部 HTTP / storage / clock 使用系统 adapter                                          | 固定请求、SSE、取消与晚到结果、错误、prompt、历史/收藏、key 隔离、跨会话所有权 | 真实模型质量、用户服务额度、浏览器原生权限和注入                |
| T2：页面上下文与就地动作 | 真实 `PageContextClient` / controller + 固定 content runtime 的采集、选文、翻译和写作 Interface；普通 DOM 使用真实 jsdom，浏览器身份和权限为系统 adapter | 正文/选文、限额、token、导航失效、页面文本隔离、编辑冲突、原文恢复与清理       | 真实选区布局、原生侧栏手势、各网站富文本与页面性能              |
| T3：用户可见工作区       | 真实导航/工作区/功能页的 DOM 操作，组合真实 client/controller；只替换外部浏览器、HTTP、storage、文件和时钟                                               | 首次配置、草稿、导航、工具入口、历史、错误、键盘与中文输入法、不执行 HTML      | 真正 Chrome 权限弹窗、扩展包接线、跨 origin iframe 和浏览器布局 |
| T4：生产扩展 E2E         | 独立临时 profile 的生产包 + 本地 HTTP/SSE、页面/字幕 fixture；不使用用户 profile                                                                         | 原生入口、注入、选文、provider 传输、导航/撤权/关闭、侧栏/标签页、现有模块回归 | 未配置的付费云服务质量、所有网页及 Firefox 支持                 |

T1 的 HTTP fixture 实际接收请求并流式发送拆分的 SSE 数据；
检查真实请求内容与返回状态，不 mock 自己的 parser、controller 或 reducer。
T2/T3 不通过私有字段、内部函数调用次数或 storage 旁路判断成功；
通过公开快照、界面与重新读回的公开结果验证。
T4 与复用用户 Chrome 的参考研究分开：测试创建隔离 profile，不改用户安装和登录状态。
Firefox 如需宣称同等支持，必须另有构建、manifest 与真实浏览器证据。

## 7. 按规格进行的 TDD 纵向切片

确认后逐项执行：一条可观察行为测试 → 实际运行看到预期 red →
最小实现 → 同一测试 green → 记录证据，再选下一条。
不先批量写完测试，不先铺空目录或给新类做占位实现。

1. **工作区骨架**：先验证用户直接进入一个现有 builtin；
   再引入导航与 mount/dispose，打通一个真实工具与一个 remote module。
2. **第一条 AI 请求**：合法配置、真实 HTTP fixture、一条消息完成；
   然后增加 SSE 拆包、停止、晚到结果和错误。
3. **页面问答**：捕获一个确定正文的页面，附加并总结；
   然后覆盖超限、切 tab、导航和撤权。
4. **选文动作**：翻译一段确定选文；再覆盖 Shadow 工具条、
   保持选区、Quick Ask 和上下文菜单传递同一意图。
5. **写作回写**：预览、显式替换与用户已修改时拒绝覆盖。
6. **网页双语翻译**：两块确定正文匹配译文；
   然后停止、恢复、页面修改和重复启动。
7. **本机组织**：历史读回/删除、收藏、提示词、模型切换及导入字幕。
8. **其余现有工具迁入**：一次迁一个独立功能视图，
   对应的业务与隔离测试继续通过后再迁下一个。
9. **最终浏览器门禁**：生产包验证完整用户流程、窄布局和真实扩展生命周期；
   同步 README、架构、隐私清单和实施检查点。

切片顺序允许依据前一轮结果调整，范围变化需先改 MW 验收要求及 seam 映射。
重构审查与 red/green 循环分别进行，不让大规模重写遮蔽单条行为的失败原因。

## 8. 预计接线范围

按实际切片引入以下代码，不提前创建空模块。2026-11-19 构建与宿主接线按
[ADR-0027](../adr/0027-wxt-react-tanstack-workspace.md) 更新，MW 验收和历史证据仍保留原范围：

```text
src/workspace/                         工作区导航、状态和 mount/dispose
src/modules/builtin/assistant/         controller、配置、provider、历史、提示词
src/assistantContent/                 正文/选文、Shadow UI、翻译与编辑
src/sidebar/assistant-view.ts         助手工作区
src/sidebar/*-view.ts                 现有各工具的独立使用视图
src/background/main.ts               有限消息路由、身份与生命周期接线
src/background/browser-action-entry.ts
src/sidebar/main.ts
src/entrypoints/sidebar.html           WXT 工作台 HTML 入口，输出 sidebar.html
src/workspace/workspace-view.tsx       React 导航与 TanStack hash 路由
src/sidebar/smart-apps-list.tsx        React + Table/Virtual 应用列表
src/sidebar/module-management-view.ts
src/manifest.ts                       身份、权限与 CSP
src/entrypoints/*.ts                   WXT 后台、GitHub 和固定 runtime 入口
public/sandbox.html                   声明式 sandbox，classic loader
wxt.config.ts                         扩展构建与 React 集成
e2e/                                  本机页面与 HTTP/SSE fixtures
```

允许直接替换旧 workspace / 新助手的数据格式，不添加历史交互兼容层。
这一授权不等于删除已有其他模块数据、未提交源码或用户浏览器配置。
当前工作树的配音、构建和集成修改需要逐项保留并融合。
不修改 RepoLens 公共 SDK 协议来传递助手凭据或任意页面执行能力。

## 9. 交付门禁与当前状态

交付时每项 MW 填写对应测试、实际结果与未验收限制：
相关单元与组合测试、全仓 unit、typecheck、lint、Chromium 生产 build、
新增 E2E 与现有关键模块回归都通过后才称作实现完成。
Firefox 的支持结论单列，不能用 Chromium 通过代替。
真实外部模型调用只在具有明确服务配置和调用授权时进行，
未配置时用真实本机 HTTP fixture 验证协议并明确质量尚未验收。

2026-11-12 已运行的**实施前基线**：

- `pnpm typecheck`：exit 0。
- `pnpm exec vitest run --reporter=dot`：97 个文件、741/741 passed，exit 0。

以上为实现前基线，不作为新功能完成证据。用户确认后已新增统一工作区、
助手 controller/provider、固定页面 runtime、选文工具条和页面翻译/编辑接线，
并按 T1～T4 完成行为测试。MW-01～MW-22 的实现与测试映射、
实际 red/green、最终门禁命令及限制见
[实施检查点](../checkpoints/monica-workspace-implementation.md)。

本次采用本机 HTTP/SSE 模型 fixture，没有调用付费模型、提交或发布。
Monica 参考来自本机 9.0.24 静态包和官方使用资料；真实 Monica UI 未成功连接，
不声称逐屏复刻。Firefox 只按明确记录的 manifest/构建证据判断，
不从 Chromium 测试推导同等 UI 支持。
