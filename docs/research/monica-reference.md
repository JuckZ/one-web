# Monica 参考实现核查

日期：2026-11-12（Asia/Shanghai）。
目标：研究用户指定的已安装扩展，形成 OneWeb 的功能与交互迁移依据。
本文记录证据及推断，不代表迁移已经实现。

## 参考对象与证据范围

用户入口：
`chrome://extensions/?id=ofpnmcalabcbjgholdjcjblkibolbppb`。

实际安装目录：

```text
/home/juck/.config/google-chrome/Default/Extensions/
  ofpnmcalabcbjgholdjcjblkibolbppb/9.0.24_0/
```

`manifest.json` 与 `_locales/zh_CN/messages.json` 确认其为
Monica 9.0.24。这是本机版本，未将其称作当前商店最新版。

| 本机文件         |   字节数 | SHA-256                                                            |
| ---------------- | -------: | ------------------------------------------------------------------ |
| `manifest.json`  |     2350 | `104554a65fc2ce6040c3c002aa879bd7ea26dd0aeb839751c70aac65150cce77` |
| `background.js`  | 11556603 | `1d91a5a58ec4b86994665c4e9681f04ca196d8b41ea537e8aeaa19e42abb242c` |
| `content.js`     | 28579287 | `9dfbf4cf33f1ed2a9e355c246d8c420c05e1e95f53d3d74cda59d1fcd7c6fc69` |
| `content.css`    |  2538676 | `9b59d8000f775955d2ef118e052ea39f0dfab94558dc9119cf0f1811555b252c` |
| `monicaPopup.js` |  3951617 | `a48e2598527da596bc4b6ac60e70a09f997cabfe0efc3dd06a7f0bc85a0f4483` |

安装包是经过压缩的发布产物。下文以固定字符串定位、入口文件和对应行为分支为依据，
不把依赖库中偶然出现的符号当作产品功能，也不推测其未公开的服务器实现。
OneWeb 应独立实现行为与交互，不直接移入 Monica 的发布 bundle、品牌资源或私有服务协议。

## 浏览器与桌面核查结果

按用户偏好使用 Playwright CLI extension 模式：

```sh
playwright-cli -s=monica-study attach --extension=chrome
playwright-cli -s=monica-study tab-list
playwright-cli -s=monica-study snapshot
```

连接页显示 `playwright-cli connected`，但会话只暴露该连接页。
新建目标 `chrome://extensions/` 页面返回
`Protocol error (Page.navigate): Detached while handling command`。
随后普通 HTTPS 页面的新建、导航与 `context.pages()` 核查也没有建立有效目标绑定，
最终出现 `Cannot read properties of undefined (reading 'url')`。
因此没有把失败直接归因于 `chrome://` 页面限制；会话与目标标签页绑定本身存在异常。
没有切换到 Codex 内置浏览器。

随后按桌面偏好检查已注册的 cua-driver MCP 与官方 CLI：

- MCP 可以列举进程，但本次没有取得可操作的 Chrome 窗口。
- CLI 版本为 0.38.0；`doctor --json` 报告没有 `DISPLAY` / `WAYLAND_DISPLAY`、
  AT-SPI bus 不可达。
- CLI 窗口查询另报告默认 socket 上没有运行的 daemon。没有启动或重配共享服务。

研究结束后执行 `playwright-cli -s=monica-study detach`，结果为 detached；
只结束自己的 cua-driver `monica-reference` 会话。没有关闭用户 Chrome 或其他标签页。
本文不包含真实 Monica 侧栏点击、登录状态、服务可用性、实际模型响应或视觉还原的验收结论。

## 已核实的实现方式

### 多入口共用前端

Manifest 定义四类入口：

- `monicaPopup.html`：工具栏弹出页，独立加载 `monicaPopup.js`。
- `sidePanel.html`：Chrome 原生侧栏。
- `chatTab.html`：完整标签页工作区。
- `monicaOptions.html`：设置页。

后三者均加载 `content.js` / `content.css`，根节点为 `#root`。
Bundle 的路由解析同时区分网页、完整聊天标签页和侧栏；可见的功能标识包括
`chat`、`search`、`write`、`translate`、`memo`、`reading`、`toolkit`、`image`、
`video`、`audio` 等。可以确认共用前端与入口区分，不能据此推定每个功能均离线可用。

迁移含义：OneWeb 的原生侧栏与完整标签页应共用同一个工作区，而不是维护两套业务状态。
日常功能有稳定入口，安装、启停、来源与权限放在设置。

### 原生侧栏与网页内入口

后台可定位到 `openSidePanel` / `closeSidePanel` 消息处理，
使用 `sidePanel.setOptions()`、`sidePanel.open()`；
`chromeSidePanelEnabled` 设置驱动 `setPanelBehavior({ openPanelOnActionClick })`。
侧栏前端以名为 `sidePanel` 的 runtime Port 连接后台，后台通过断开事件更新可见状态。
打开侧栏失败的分支会调整侧栏相关配置。

Manifest 中 `_execute_action` 建议快捷键为 Ctrl+M / Command+M，
另有打开完整聊天标签页的 command。

迁移含义：工作区提供图标、快捷键、上下文菜单和网页入口；
打开侧栏必须保持在浏览器允许的用户手势链路内。
窗口、tab、页面导航、Port 与请求都有明确所有权，失败时显示可操作反馈。
不要在失败时悄悄改掉用户持久设置。

### Shadow DOM 中的网页 UI

应用初始化分支能定位到：

- `monica-content-root`、`monica-main-window-root`、
  `monica-float-shortcut-btn` 等固定根节点标识；
- 创建独立 root、`attachShadow({ mode: "open" })`；
- 把打包 `content.css` 的样式文本挂到 shadow root，再创建 React root；
- 已有 root 的处理与 content update 事件。

这比在整个 bundle 里搜索 `attachShadow` 更能证明产品 UI 的隔离方式。
迁移使用独立的 OneWeb Shadow DOM，避免宿主网页的 CSS 和我们的 UI 相互干扰。
OneWeb 已有 Page Toolbox 的页面控件实现，应沿用其生命周期经验，
同时分别管理工具箱与 AI 入口的 root、监听器和卸载责任。

### 选文、就地操作与写作

产品文案与对应控制器可定位到：

- 阅读与输入框内写作两类选文工具；
- 自动展示或按快捷键展示；
- 翻译、解释及可配置 action / prompt；
- 结果面板的继续追问、重新生成、停止、重试、复制；
- 写作面板的语气、长度、格式，以及用户点击后的 insert / replace。

设置中包含按网站禁用和全局禁用的表达，网页入口也有本次访问隐藏与全局隐藏的选择。
这些构成迁移的交互依据；实际定位、弹出位置、动画和特定网站编辑器兼容性仍待真实 UI 验证。

迁移含义：选文后操作就近出现，携带明确文本和页面来源；
只有用户点击 action 才调用模型。
编辑器回写需保持原选区身份并检查文本是否已经变化，
普通阅读选区只提供复制与继续问，不假定可以替换网页正文。

### 页面阅读与上下文

侧栏初始化读取选文；注册 active tab 切换与更新监听，
并触发当前 tab 的阅读更新。Bundle 中有网页总结、视频总结、
PDF 阅读及后续问答的产品分支与文案。

迁移含义：工作区展示当前页面与“已附加的内容”，二者分别管理。
页面切换不能悄悄把既有对话的附件换成另一个页面。
捕获当前页面是一个受控、可取消、有大小限制的操作。

### 网页翻译与设置

可定位到双语翻译开关、仅显示译文、目标语言、样式、
自动翻译网站列表、禁用网站列表等设置。
选文工具与网页入口也有独立的站点级开关。

迁移先实现用户主动启动、可恢复原文的双语网页翻译；
动态页面增量翻译与自动翻译站点是后续独立验收项。
不能只增加一个“翻译”按钮就宣称已经迁移整页翻译。

### 云端能力

发布包可见 Monica 的 HTTPS / WebSocket 服务配置、用户与请求相关模块。
这说明某些功能依赖其服务体系；静态包不能证明其服务器检索、
代理执行、额度、多模型路由或生成式媒体算法。

OneWeb 的模型调用应使用用户自己配置的兼容服务；
图像/视频生成、云知识库、联网检索、多步骤代理需要各自的明确 provider，
不能复用 Monica 私有会话，也不能用普通聊天回答冒充联网检索结果。

## 官方资料交叉核对

以下页面于 2026-11-12 通过直接 HTTPS 获取成功。
它们用于核对公开行为与浏览器约束，不代表已完成真实 UI 验收。
一次试探的 `/help/Features/Chat/Chat` 返回 404，未用于结论。

| 官方来源                                                                                                           | 核对结果                                                                                         |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [Monica Smart Toolbar](https://monica.im/help/Beginners_Guide/smart_tool)                                          | 选文/图片工具、动作与提示词定制、自动与快捷键展示两种方式                                        |
| [Monica Web Summary](https://monica.im/help/Beginners_Guide/web_summary)                                           | 主动读取当前页面、总结与围绕页面继续问答                                                         |
| [Monica Web Translate](https://monica.im/help/Beginners_Guide/web_translate)                                       | 网页或选文翻译，译文与原文就近呈现                                                               |
| [Monica Quick Ask](https://monica.im/help/Beginners_Guide/quick_ask)                                               | 快捷呼出、键盘切换提问/搜索/打开网站等模式；不作为 OneWeb 已支持联网搜索的证据                   |
| [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)                          | action 点击行为、`sidePanel.open()` 的用户手势与 tab/window 作用域                               |
| [Chrome Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)            | isolated world 与静态/动态/程序注入方式                                                          |
| [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) | personalCommunications 包含 chat messages；助手新增该类别，websiteContent 用于主动附加的网页内容 |

## OneWeb 实现前接入位置

目标仓库：`/home/juck/Projects/one-web`。
当前 shell 所在的 `repolens-starter` 是 RepoLens 服务与集成样例；
`one-tampermonkey` 是用户脚本项目，均不是本次扩展宿主的修改目标。

| 当前实现                                 | 观察                                                           | 迁移方向                                           |
| ---------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `src/sidebar/main.ts`                    | 默认选择 RepoLens；builtin 在主模块 surface 显示“入口尚未接入” | 引入统一工作区路由，builtin 有直接使用入口         |
| `src/sidebar/module-management-view.ts`  | 日常操作、配置、权限与安装集中在同一列表；约 3000 行           | 逐个提取独立功能视图，管理页保留模块生命周期       |
| `src/background/browser-action-entry.ts` | 已有原生侧栏优先与标签页 fallback                              | 扩展为统一入口协调，保留具体失败反馈               |
| `src/modules/builtin/page-toolbox/`      | 已有站点授权、Shadow 控件和资源清理                            | 复用约束与模式，不借用其任意页面执行权限           |
| `src/modules/frame-host.ts`              | 已有 sandbox iframe 与桥接授权                                 | RepoLens 等 remote module 通过现有 host 装入工作区 |
| `src/modules/builtin/video-dubbing/`     | 工作树已有字幕与兼容翻译/TTS 实现                              | 保留现有工作，未来通过公开字幕来源接口接入视频阅读 |
| `src/modules/builtin/*`                  | Cookie、书签、浏览记录、Clash、OpenList 等已有控制器           | 优化入口和视图，继续使用其真实控制器               |

现有 ADR 中阶段性的“暂不加入某 UI”描述不自动成为本轮禁令；
本轮允许用户明确要求的交互重构。
远程模块隔离、权限身份与原有业务语义仍需纳入具体迁移验收。

## 当前结论与尚缺证据

足够明确的迁移重点：统一工作区、原生侧栏/标签页共用入口、选文就近动作、
页面附件、文本 AI、可恢复网页翻译，以及已有工具从管理页中独立出来。

仍缺真实 Monica UI 的视觉与交互点击记录及其云端功能可用性，静态参考不能替代这些证据。
用户确认后 OneWeb 已完成批准范围内实现；red/green、生产构建和浏览器验收
记录见[实施检查点](../checkpoints/monica-workspace-implementation.md)。
实现规格见 [Monica 迁移 SDD](../specs/monica-workspace.md)。
