# 网页助手浮层与交互修复检查点

日期：2026-11-15。规格：[PS-01～PS-06](../specs/page-assistant-surfaces.md)。

用户重载后提供了实际 GitHub 页面截图：选文区的绿色文本按钮过大，十项长菜单与选文工具条同时展开。
本轮修复当前网页的就地任务入口；完整参考产品的其他能力继续按现有浏览器任务规格分别验收。

## 本轮实现

- 选文工具条改为单行图标，保留名称、提示、动作排序与隐藏偏好；前四项加继续问，其他动作通过更多入口执行。
- 常用网页任务改为窄图标栏：Quick Ask、网页翻译、本机剪藏、当前视频阅读、截图识图与网页工具箱；隐藏等选项按需展开。
- 原生 auto Popover 承担临时浮层、外点和逐层 Escape 关闭；工具条优先 focusgroup，未支持时才安装方向键与单一 Tab 停靠点回退。
- 工具条按实际尺寸定位并夹在视口内；底部选文时翻到上方。滚动、窗口或 visualViewport 变化清除待显示计时器并收起临时浮层，保留任务面板。
- 所有新增 document/window/visualViewport 监听器均在 dispose 中对称移除。原生 Popover 状态查询先检测 API 能力，避免不支持该选择器的 DOM 环境在初始化时抛错。
- 选文、菜单和任务面板互斥；编辑器生成前仍复核并恢复原选区，结果先预览，只有显式插入或替换才写入网页。

没有增加权限、外传来源或凭据读取。旧有视频配音、局域网服务、模块数据和授权保持原契约。

## SDD / TDD 证据

证据目录：`artifacts/page-assistant/20261115/`。已保留真实行为 red → green：

| 验收        | 旧行为失败                          | 生产包修复验证                                                    |
| ----------- | ----------------------------------- | ----------------------------------------------------------------- |
| PS-01       | 工具条宽 290px，大于 260px 验收上限 | 320px 窄屏内单行布局、底部选文翻转与五项命名动作                  |
| PS-02/03/05 | 打开入口后选文工具条仍显示          | 窄图标栏、按需选项、逐层 Escape、外点、方向键/Home/End 与焦点归还 |
| PS-04       | 编辑器工具条十个按钮直接显示        | 更多动作生成一次请求；先预览、原文不变，再显式替换所选的 world    |
| PS-03       | resize 后旧工具条仍显示             | resize/scroll 后收起，Escape 后延迟 150ms 不重开                  |

四组针对性生产 E2E：`18-viewport-green.log`，**4 passed**。
01/03 的 fixture setup 失败不计作行为 red；有效 red 是 04、06、11、16。
20/21 的完整检查另发现 JSDOM 不支持 `:popover-open`，由独立 review-0 确认为本轮回归；
修复采用原生能力检测，保留原 hiding 测试与断言，复验见 23 日志及最终门禁记录。
首次完整 Chromium 为 69/70：PS-03 在滚动后立即程序化重选相同 Range 的步骤与异步 scroll 事件竞争；
28 诊断在相同代码下三次执行出现两败一过。独立 review-1 要求修正 fixture。
该步骤改为等待浏览器 scrollend，再以真实鼠标三击重新选文；保留全部可见、隐藏及 Escape 延迟断言，没有启用重试或修改生产代码。

本轮最终完整结果、退出码、source/artifact hashes、factory evidence/attest 和独立复评统一记录在
`artifacts/page-assistant/20261115/final-validation.json`；安装备份、目标目录与浏览器重载状态记录在同目录 `installation.json`。
这些记录绑定本轮源码与构建，历史 872/66/5 的通过次数不能替代本轮验收。

## 隔离与证据边界

从 HEAD `7b5c9d9988c61ee012d85188770f93507b4f2b54` 创建任务专用 worktree，显式叠加主工作区 512 份集成输入；
主工作区已有 tracked/untracked 改动属于其他任务。仅在核对基线哈希后回填本轮拥有的路径，没有 reset、clean、stage 或 commit。

生产 E2E 使用独立临时 profile 和本机确定的 HTTP/SSE、媒体 fixture。截图直接来自实际生产扩展，未以设计稿代替实现。
Firefox 现有五项 gate 验证既有工具与真实媒体路径，不能证明新网页助手浮层的 Firefox 专项交互。

Not run：真实 GitHub/YouTube/Bilibili 登录页面及付费模型质量、任意富文本框架、Windows/macOS；
这些范围不由本轮本机 fixture 或 Linux Chromium 结果覆盖。
现有 PageAssistantSurface/工具箱部分迟到异步结果的 generation 防护仍沿用集成基线，未在此次视觉修复中全面改写。

用户 Chrome 的 Playwright extension 会话只提供其连接页，未暴露扩展管理或业务标签页；本轮已 detach 自己的会话。
此前用户已确认上轮重载；本轮安装后的重载状态以 installation 记录为准，不将文件替换表述为浏览器已完成重载。
