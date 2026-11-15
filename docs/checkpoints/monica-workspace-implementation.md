# Monica 工作区迁移检查点

日期：2026-11-12（Asia/Shanghai）。
状态：**批准范围已实现；Chromium 最终门禁全部通过**。

## 本次任务

用户指定已安装扩展 `ofpnmcalabcbjgholdjcjblkibolbppb`，
要求学习其实现方式，将核心功能和交互迁入我们的浏览器插件，
允许重构现有功能交互、不考虑兼容，使用 SDD 与 TDD。

已确定参考为本机 Monica 9.0.24，目标仓库是
`/home/juck/Projects/one-web`，而非当前 cwd 的 RepoLens 服务或油猴项目。

交付的研究与规格：

- [参考研究](../research/monica-reference.md)：本地证据、文件哈希、
  官方资料交叉核对、浏览器连接故障和未验证范围。
- [迁移 SDD](../specs/monica-workspace.md)：核心交付、交互、MW-01～MW-22、
  公开 Interface、资源限制、T1～T4 seam、纵向切片和交付门禁。

## 工作树

观察到的分支：`codex/phase-9a-openlist-contract`。
HEAD：`ef29526f8b6733c7eec53876d600364e48086eaa`。

开始时已有大量 tracked/untracked 修改，包含 Video Dubbing、
构建与依赖、sidebar、background 和文档；RepoLens 兄弟仓库亦有原有修改。
没有 checkout、reset、clean、stage、commit、发布、SDK vendor 同步，
没有清除现有模块数据。

研究阶段只新增本检查点、参考研究和规格。用户确认后增加的助手、页面、
工作区与接线代码见后文；配音原有能力不计作本次新实现。

## 实际验证

| 操作                                          | 实际结果                                                            | 可证明范围                                  |
| --------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| 读取本机扩展 manifest、入口和 bundle          | 版本、入口、Shadow DOM、侧栏/Port、选文、阅读、翻译、配置分支已定位 | 发布包静态结构，不证明真实界面和云端可用    |
| 获取 Monica 四篇官方使用指南                  | HTTPS 200                                                           | 公开交互描述与静态发现相符                  |
| 获取 Chrome Side Panel / Content Scripts 文档 | HTTPS 200                                                           | 用户手势、作用域、isolated world 与注入约束 |
| Playwright CLI extension attach               | 连接页 connected；目标绑定失败                                      | 未成功验收 Monica UI                        |
| cua-driver 检查                               | MCP 未取得窗口；CLI 无显示环境、AT-SPI 不可达，默认 daemon 不在运行 | 桌面路径尚不可用，未启动或重配服务          |
| `pnpm typecheck`                              | exit 0                                                              | 现有源码类型通过                            |
| `pnpm exec vitest run --reporter=dot`         | 97 files、741/741 passed，11.34s、exit 0                            | 现有测试基线通过，不证明迁移                |
| `playwright-cli -s=monica-study detach`       | detached                                                            | 只解除本次附着，用户 Chrome 保留            |
| cua-driver `end_session(monica-reference)`    | active false                                                        | 只结束本次会话                              |

## 用户确认与实施

用户于 2026-11-12 回复“开始实现”，整体确认 SDD、
T1 Assistant、T2 Page Context、T3 Workspace DOM、T4 生产扩展 E2E。
从此开始实施，前述“本轮主动编辑范围”指确认前的研究轮次。

三份新文档的相对链接、MW-01～MW-22 唯一编号、四组 seam 和行尾空白已检查。
Markdown 采用仓库的 ESLint / Prettier 格式校验；首次检查发现表格对齐与一个
伪代码围栏标记问题，已限定在这三份文件内修正并重新校验。

从“用户可直接打开一个既有 builtin 工具”的 T3 行为开始；
一次只打通一个纵向切片，保存实际 red/green 命令和结果。
不得将本次草案文档或通过的旧测试描述成已完成迁移。

## 实施中的 red / green 证据

以下均在确认后的工作树中实际运行；源码与测试使用公开 Interface，
不读取 controller 私有字段。HTTP、浏览器身份与存储是外部边界。

| 切片                | 实际 red                                                 | 同一公开测试的 green                                                           |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| T3 builtin 独立入口 | `openTool is not a function`；缺失模块没有解释           | `workspace/__tests__/tool-entry.test.ts`，2 passed                             |
| T1 首条模型请求     | controller 文件不存在                                    | 真实本机 HTTP 返回兼容 JSON，配置读回不含 key                                  |
| T1 SSE              | 状态停在 preparing、输出为空                             | 单字节 UTF-8、CRLF、多行 data、DONE 后 completed                               |
| T1 停止和晚到结果   | 重复生成未拒绝                                           | 保留部分文本；晚到结果不覆盖后续请求                                           |
| T1 历史与收藏       | 缺少 `setFavorite`                                       | 重启、搜索、收藏与删除                                                         |
| T1 导入与提示词     | 缺少 `importText` / `reorderPrompts`                     | SRT 导入、无效替换保留原附件；模板变量、排序、删除、关闭保存、清空             |
| T3 首次配置         | view 文件不存在；随后实际发现 jsdom 无 `AbortSignal.any` | 保留草稿、一次请求、恶意 HTML 按文本显示；后台改用显式超时取消                 |
| T3 导航             | `../workspace` 不存在                                    | `navigation.test.ts`，1 passed；搜索、收藏、位置恢复、移除回退                 |
| T2 正文附加         | `../page-context` 不存在                                 | `page-context.test.ts` 首条 passed；正文排除、来源脱敏、导航失效               |
| T2 写作             | `readSelection is not a function`                        | 同文件 2 passed；冻结 textarea 选文，显式替换，原文变化拒绝                    |
| T4 生产接线         | 旧生产包找不到 `assistant-workspace`                     | 重建后配置、流式回答、历史与独立工具可用；独立临时 profile，未接触用户 Chrome  |
| T1 存储失败         | 暴露底层磁盘错误，残留幻影请求                           | 公开客户端返回存储说明；不发 HTTP，修复存储后显式重试成功                      |
| T1 配置编辑         | 同服务空 key 被拒绝；失败保存改变在用配置                | 同服务保留 key；失败恢复原配置和凭据，读回不含 key                             |
| T1 关闭历史         | 对旧对话追问仍被写进原归档                               | 关闭时分叉临时会话，重新开启不补存，重启仅见原归档                             |
| T1 导入重开         | 重新打开的已导入文本因临时 token 丢失而不能追问          | 复用保存的文件快照，经过后台重启后仍使用同一文本                               |
| T1 并发翻译         | 等待授权时另外两条聊天占满额度后，第三条翻译仍发出       | 预留前再次检查共享额度；第三条明确拒绝且不发 HTTP                              |
| T2 正文与编辑       | 读入隐藏祖先内正文；contenteditable 选区移动仍可覆盖     | 可见祖先检查、UTF-8 上限、到期/撤权、普通 contenteditable 选区冲突均通过       |
| T2 本次隐藏         | 后台重复同步立即重显                                     | 绑定访问 document，导航后重置；站点与全局隐藏分别保存                          |
| T2 停止翻译         | 最终授权等待期间停止后，迟到批次仍完成插入               | 写入前重新检查 abort；停止后的 completed 保持 0，无迟到节点                    |
| T2 runtime 清理     | dispose 后仍接收浏览器 ping 并返回“页面已失效”           | dispose 同时移除 runtime 消息与 pagehide 订阅                                  |
| T3 错误与输入法     | 无显式重试；新对话被迟到浏览器结果还原                   | 429 后只由点击重试产生第二次请求；IME/Shift+Enter 不发送；新对话不被旧结果覆盖 |
| T3 意图转交         | “解释”草稿发给 provider 时变成普通 chat                  | 首次发送保留 explain，之后普通追问恢复 chat                                    |
| T2 重新选文转交     | 选中另一段后的“继续问”仍带入上一条结果的 First passage   | 工具条显式采集当前选文；结果面板继续使用其原来源，两者分别验证                 |
| T3 写作来源         | 更换附件后，旧回答仍显示指向新编辑区的写回入口           | 回答绑定其原 attachment token；只允许匹配来源的结果写回                        |
| T3 消息传输失败     | start 成功、open 回复丢失后再次点击发送无效              | 取消本次请求并释放 UI 状态；保留草稿，用户可显式再发                           |
| T4 窄栏回归         | OpenList 候选 URL 在 360px 网格中宽度为 0                | 固定复选框列并跨列呈现风险/标题，原操作回归通过                                |
| T4 快捷键           | 浏览器返回 Quick Ask 的 Alt+Shift+A 为空                 | 改为 Alt+Shift+K，`commands.getAll()` 证实两个建议键均实际分配                 |
| T4 键盘选文         | 输入框选文后，键盘激活 Shadow 工具条返回“请选择文本”     | 动作发起前恢复原编辑器焦点；Enter 生成预览后显式替换成功，一次 HTTP            |
| Manifest 数据声明   | Firefox manifest 测试缺少 personalCommunications         | 新增助手消息类别，保留既有三类，Chromium/Firefox manifest 测试通过             |

## 实现结果

- 统一侧栏/标签页入口，助手、阅读、翻译、写作、工具、历史、收藏、设置；
  保存位置、工具收藏与最近使用，缺失模块解释性回退。
- 配置用户自己的兼容模型服务，流式 UTF-8/SSE、停止、显式重试、
  每对话/宿主并发限制、权限撤销与关闭取消、部分答案与错误状态。
- 主动附加正文/选文，TXT/MD/SRT/VTT 导入与重开、纯文本提示词编辑/排序；
  历史搜索、删除、清空确认、收藏与关闭后临时追问。
- 授权站点的 Shadow DOM 选文助手，翻译/解释/总结/改写和语气/长度；
  预览后显式写回、原文/选区变化拒绝、转入工作区、三种隐藏范围。
- 正文块双语翻译按 ID 匹配，停止迟到结果、恢复只删除本次拥有的节点。
- 现有 builtin 独立功能入口与 remote iframe 桥接；设置保留生命周期管理，
  不再渲染所有日常工具表单。保留开始前已有配音等模块修改和业务数据。

## MW-01～MW-22 验收映射

测试组缩写均指真实公开 Interface 的组合测试：

- A：`src/modules/builtin/assistant/__tests__/assistant.test.ts`
- P：`src/workspace/__tests__/page-context.test.ts`
- S：`src/workspace/__tests__/page-actions.test.ts`
- V：`src/sidebar/__tests__/assistant-view.test.ts`
- N：`src/workspace/__tests__/navigation.test.ts`
- T：`src/workspace/__tests__/tool-entry.test.ts`
- L：`src/assistantContent/__tests__/lifecycle.test.ts`
- E：`e2e/workspace.spec.ts`
- B：现有 `e2e/basic.spec.ts`、`cookie-manager.spec.ts`、`video-dubbing.spec.ts`

| 要求  | 实现与可观察证据                                                  | 限制                                            |
| ----- | ----------------------------------------------------------------- | ----------------------------------------------- |
| MW-01 | V 首次配置保留草稿；T/E 无配置直接用工具                          | 未调用外部付费服务                              |
| MW-02 | A 配置、空 key 保留、失败回滚；V/E 配置与模型选项                 | 兼容 chat-completions 协议                      |
| MW-03 | A 真实 HTTP、SSE 拆包与一次请求；E 流式结果                       | 不以 fixture 证明模型质量                       |
| MW-04 | A 停止/晚到/所有权/并发；V 新对话与显式重试；E 关闭 Port          | worker 重启从保存快照恢复为中断                 |
| MW-05 | P 正文与脱敏来源、UTF-8 截断；V/E 附加后提问                      | 显式采集当前受支持正文                          |
| MW-06 | P 导航/到期/撤权；E 撤权保留可读历史                              | 旧页面 token 需重新采集                         |
| MW-07 | E 真实选文翻译与改写；V explain 转交                              | 各意图使用同一有限 action 映射                  |
| MW-08 | P textarea/contenteditable 冲突；V 原来源写回；E 预览/显式替换    | 富文本框架未承诺全面兼容                        |
| MW-09 | P 乱序 ID、原文/新增内容保留与迟到取消；E 翻译/恢复               | 不自动持续翻译动态内容                          |
| MW-10 | A/V 提示词 CRUD、排序及变量校验                                   | 仅 text/language 变量                           |
| MW-11 | A/V/E 历史读回、搜索、删除、收藏与清空                            | 本机数据；无云同步                              |
| MW-12 | T/E 独立 builtin；B RepoLens 和全部既有工具                       | 既有工具原始站点/平台限制仍适用                 |
| MW-13 | N 搜索/收藏/最近/恢复；B 业务数据与 remote 存储隔离               | 导航元数据独立于模块业务数据                    |
| MW-14 | T 仅管理表单；B 安装/授权/启停/移除/更新                          | 使用既有控制器授权流程                          |
| MW-15 | S/E 重新选文与结果来源分别转交；V 一次性意图；E commands 实际注册 | 原生上下文菜单及 OS 全局按键未做 GUI 端到端操作 |
| MW-16 | S 访问/站点/全局；L 消息订阅释放；E 撤权移除 root                 | 不修改用户浏览器 profile                        |
| MW-17 | E 360px/完整标签页截图、键盘激活选文/写回；V IME 与 Shift+Enter   | 原生侧栏尺寸使用同一扩展页面实现                |
| MW-18 | A/P/V/E 与 B 模型/译文/模块名称按文本显示                         | 不执行模型 HTML                                 |
| MW-19 | A 429/坏 SSE/空/断流/storage；V 重试与通信恢复                    | 90 秒超时路径已实现；未做付费服务故障注入       |
| MW-20 | A/V 字幕与 MD 导入、无效输入保留旧附件、重启复用                  | 只接受 UTF-8、64 KiB 上限                       |
| MW-21 | B 配音原有能力回归；A/V 显式字幕阅读                              | 无自动视频转写和任意轨道抓取                    |
| MW-22 | N 位置恢复与模块删除回退；E reload 仍在历史                       | 不迁移旧工作区交互格式                          |

## 最终门禁

| 命令                 | 实际结果                                                   | 范围                       |
| -------------------- | ---------------------------------------------------------- | -------------------------- |
| `pnpm typecheck`     | exit 0                                                     | 全仓 TypeScript            |
| `pnpm lint`          | exit 0                                                     | 全仓源码、测试和文档       |
| `pnpm test:coverage` | 105 files，803/803 passed，19.25s，exit 0                  | 包含新工作区及已有所有模块 |
| V8 coverage          | statements/lines 81.74%，branches 76.97%，functions 88.74% | 不包含生产 E2E 覆盖率      |

| 生产门禁命令                                                                  | 实际结果                          | 范围                                               |
| ----------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| `pnpm build`                                                                  | exit 0；30 个生产文件身份检查通过 | 包含固定助手 content artifact 的 Chromium 生产扩展 |
| `pnpm exec playwright test e2e/workspace.spec.ts --retries=0 --timeout=25000` | 6/6 passed，16.1s，exit 0         | 新工作区完整定向流程                               |
| `pnpm exec playwright test --retries=0 --timeout=25000 --max-failures=3`      | 44/44 passed，2.6min，exit 0      | 最终生产包；全部既有与新增 E2E，无重试             |
| `git diff --check` 与文档相对链接检查                                         | exit 0，无失效本地链接            | 工作树空白与交付文档                               |

最终全量包含 28 项基础/模块测试、2 项 Cookie Manager、8 项 Video Dubbing、
6 项 Workspace。上一轮 43/44 中的工作区失败是路由切换后测试未等待异步
渲染便查询按钮；已等待目标视图可见，定向及最终全量均无重试通过。

已查看并核对 360×900 侧栏与 1280×900 完整标签页截图：
`test-results/oneweb-workspace-360.png` 和 `test-results/oneweb-workspace-tab.png`。
360px 下工具页额外检查 document scrollWidth 不超过窗口宽度。
测试 profile 和合成服务与用户 Chrome、登录态及 Monica 安装相互独立。

## 交付边界

Monica 9.0.24 是本机静态参考，官方文档补充交互说明。Playwright CLI extension
连接未能绑定 Monica 目标，desktop fallback 不可用，因此没有真实 Monica UI 对照验收，
没有复制其专有 bundle 或调用其私有服务。

Chromium 测试使用独立临时 profile、本机 HTTP/SSE/页面 fixture 和合成 key。
本机 fixture origins 由测试 profile 预授予；原生站点授权弹窗未做 GUI 交互验收。
没有调用付费模型；模型质量、额度和服务端留存需在用户选择服务后验证。
Firefox 新助手 UI、原生菜单/OS 快捷键、跨站富文本、PDF/OCR、云搜索、
图片/视频生成、agent 和自动字幕抓取不在本次已验证结论内。
新生产扩展输出在 `/home/juck/Projects/one-web/extension`；本轮未 stage、commit 或发布。
