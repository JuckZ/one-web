# Video Dubbing 实施检查点

日期：2026-11-12。状态：**首版核心实现、本地验收与构建交付完成**。

## 当前进展

用户要求参考 YouTube Dubbing 的实现，把核心功能迁移到 OneWeb，并采用 SDD/TDD。
本轮已确认目标仓库、构建与测试体系、模块接入方式、权限和生命周期约束。

规格：[video-dubbing.md](../specs/video-dubbing.md)。
用户回复“开始实现”，整体确认规格中的 T1 字幕/会话、T2 控制器/服务、
T3 用户界面、T4 真实扩展 E2E。

## 工作树保护

基线分支 `codex/phase-9a-openlist-contract`，
HEAD `ef29526f8b6733c7eec53876d600364e48086eaa`。
已有 Cookie Manager 和其他阶段的 staged/unstaged 修改；保留所有原修改。
没有 checkout、reset、clean、stage、commit、发布、远程修改或 SDK vendor 同步。

规格准备阶段只新增以下两个文档；随后按下方记录引入实现与测试：

- `docs/specs/video-dubbing.md`
- `docs/checkpoints/video-dubbing-implementation.md`

## 已观察到的基线

| 命令                                  | 实际结果                         | 意义                         |
| ------------------------------------- | -------------------------------- | ---------------------------- |
| `pnpm typecheck`                      | exit 0                           | 现有源码类型通过             |
| `pnpm exec vitest run --reporter=dot` | 91 files、721/721 passed，10.55s | 现有测试通过，不证明配音功能 |

实现前基线如上。新增配音 red/green 见下方实际记录。

## 确认后的实施接线

新代码应集中在：

```text
src/modules/builtin/video-dubbing/
  contracts.ts
  subtitles.ts
  session.ts
  controller.ts
  protocol.ts
  provider.ts
  manifest.ts
  __tests__/
src/videoDubbingContent/
  index.ts
  media.ts
  youtube.ts
  overlay.ts
src/sidebar/
  video-dubbing-view.ts
  video-dubbing.css
  __tests__/video-dubbing-view.test.ts
vite.config.video-dubbing.ts
e2e/video-dubbing.spec.ts
```

路径是计划，不要求为凑齐目录而预建空实现。随纵向切片实际引入。
宿主接线限定在 registry、后台路由/生命周期、侧栏挂载及独立构建入口；
不把配音塞进 GitHub 静态 content script，不扩大 Page Toolbox 的 MAIN/网络能力。

开始时以 T1 的第一条用户行为写 failing test，观察 red 后再创建最少生产实现。
每个后续切片记录：VD 编号、测试 seam、独立预期、red 命令与实际失败、green 命令与结果。
最终另记录：全仓测试、两种浏览器实际验收、未配置真实云服务造成的验收边界、
隐私/权限变化以及是否存在未完成的 VD 项。

## 2026-11-12 实际 red → green

每一行先单独写行为测试并运行，再写实现、运行同一测试；没有先批量实现后补测。

| Seam / 文件                              | 实际 red                          | 同命令 green |
| ---------------------------------------- | --------------------------------- | ------------ |
| T1 `subtitles.test.ts` 两条 SRT          | import `../subtitles` 缺失        | 1 passed     |
| T1 WebVTT / 无效输入                     | 无法解析 WEBVTT 头                | 2 passed     |
| T1 `session.test.ts` 中间位置启动        | import `../session` 缺失          | 1 passed     |
| T1 用户暂停优先                          | `session.pause is not a function` | 2 passed     |
| T1 seek / 旧结果 / 恢复音量              | `session.seek is not a function`  | 3 passed     |
| T1 过长音频串行等待                      | `session.tick is not a function`  | 4 passed     |
| T2 `provider.test.ts` 实际 HTTP fixture  | import `../provider` 缺失         | 1 passed     |
| T2 ID / 429 / redirect / 4 MiB           | 缺 ID 抛出非受控 TypeError        | 2 passed     |
| T2 `controller.test.ts` 受信任配置       | import `../controller` 缺失       | 1 passed     |
| T2 端口身份 / 撤权                       | `acceptPort is not a function`    | 2 passed     |
| T2 绑定字幕启动 / 无效导入原子性         | 仍为 bound、没有 start            | 3 passed     |
| T3 `video-dubbing-view.test.ts` 配置保存 | view import 缺失                  | 1 passed     |
| T3 站点、轨道和启动错误反馈              | 无字幕轨道控件                    | 2 passed     |
| T3 `player.test.ts` 双语 / 断线恢复      | player import 缺失                | 1 passed     |

命令：`pnpm exec vitest run <上述文件相对 src 的路径>`。
最近组合运行：4 files / 11 tests passed；随后独立管理视图 2 passed、播放器 DOM 1 passed。
HTTP fixture 使用真实本机服务，未使用用户 API key 或调用收费服务。

## 后续 red → green 与浏览器证据

- 自动播放被阻止：T1 首次观察为 error 且丢失已加载音频，改为 paused/autoplay；
  用户点击继续可恢复。随后补测发现媒体状态轮询会自行重试播放，修正为等待明确用户动作。
- 重叠短字幕：首次观察嵌套短 cue 被跳过，修正为顺序朗读；远于 30 秒的字幕不提前请求。
- 首句延迟：首次观察等待未来语音时当前句也不能开始，修正为首句独立准备与后台预缓冲。
- 重试：真实 HTTP fixture 首次观察翻译请求两次、已成功语音重复，修正为有界最近结果缓存。
  随后补测单条重试与解码失败失效：保留译文，丢弃失败音频，显式重试重新合成该条。
- 字幕窗口：首次观察语音提前结束即清空文字，修正为保留至该视频字幕窗口结束。
- 真实 YouTube 空正文反馈促成 native CC resource URL 更新切片：T2 首次仍返回旧 URL，
  修正为只接收绑定 video/origin/lang/kind 的既有轨道；外站 URL 被拒绝。
- T3 补测 stop 后迟到 advanced：首次从 idle 回到 paused/media-buffering，
  修正为 generation 单调、停止后清除 pending seek 并拒绝旧命令。
- T4 首次真实生产包运行：新模块卡片不存在（预期 red）。接入 registry、侧栏、后台和独立产物后通过。
  随后加强 seek 到 8.5 秒 / 第三 cue 的断言，发现本地媒体 fixture 缺少 HTTP Range，
  修正 fixture 为真实 206 / Content-Range 响应后通过；没有用 mock 媒体替代播放。
- 原生权限请求在宽范围预授权 fixture 仍等待弹窗：改为测试 profile 精确源预授权后通过，
  未绕过生产 UI 的 permissions.request。

生产扩展 E2E（`pnpm exec playwright test e2e/video-dubbing.spec.ts --retries=0`）已观察到五项通过：

1. 真实媒体播放、暂停、8.5 秒 seek、第三区间字幕、用户倍速和停用恢复。
2. 播放器容器全屏、SPA 导航、后台 service-worker target 关闭后的端口断线清理。
3. 两个标签页会话独立、暂停互不传播、站点撤权同时停止匹配会话。
4. 原生 CC 请求 URL 更新后读取字幕，无 webRequest 或页面 fetch/XHR hook。
5. 真实 UTF-8 文件导入、无效替换保留旧字幕、重新启动与停止。

媒体 fixture `e2e/assets/dubbing.webm` 由本次用 ffmpeg 生成纯色画面和正弦音，
语音 fixture 为测试代码生成的 WAV。没有复制参考扩展资源或调用第三方付费服务。

## 真实站点与当前限制

2026-11-12 通过 Playwright CLI extension 模式附着 Chrome，
在本次打开的 YouTube `aircAruvnKk` 页面读取：video ID 匹配、非直播、存在 video、31 条轨道。
英文人工字幕直接请求实际返回 HTTP 200、0 bytes，不能视为线上字幕下载成功。
随后原标签页不再出现在附着会话中，停止该页检查并仅 detach 本次会话；未切换到内置浏览器。
原生 CC 更新与导入回退有生产包 fixture 证据；真实云服务、音质、所有 YouTube A/B 页面和
Firefox 配音媒体行为尚未验收。平台结构或字幕防护变化仍可能要求使用导入回退。

## 最终门禁记录

首次整套 Chromium 回归实际为 34/35：第二个标签页缺少 overlay。
随后 T3 新增可见忙状态断言，实际 red 为 aria-busy 缺失；实现按钮禁用与 aria-busy，
浏览器动作在界面空闲后再执行并等待完成。T2 另发现无关标签页导航会取消当前读取，
实际 red 为“操作已失效”；改为每标签页 epoch 与配置 revision 分开判断，5 项控制器测试通过。
这两项修正后重新构建并重跑最终门禁，实际结果如下：

| 门禁                  | 最终结果                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| `pnpm typecheck`      | 通过                                                                                  |
| `pnpm lint`           | 通过；清除损坏的临时 ESLint cache 后顺序重跑                                          |
| `pnpm test:coverage`  | 97 files / 742 tests 全通过，覆盖率门槛通过                                           |
| 全仓覆盖率            | statements/lines 81.2%，branches 76.98%，functions 88.82%                             |
| `pnpm build`          | Chromium 生产构建与身份检查通过，29 个生产文件                                        |
| 双标签页隔离重复验证  | 关闭 retries，8/8 通过                                                                |
| 整套 Chromium E2E     | 关闭 retries，35/35 通过，包含新增配音 5 项                                           |
| `pnpm verify:firefox` | 构建与身份检查通过；manifest 0 errors / 0 notices / 0 warnings；既有宿主门禁 3/3 通过 |

本轮在历史 721 项基线上新增 21 项单元/组合测试，分布在六个新测试文件中。
Firefox 的三项既有宿主门禁覆盖 Page Toolbox、Send to OpenList 和 Cookie Manager，
不构成新配音播放行为的验证。真实云端 API key、付费调用和主观音质也未验收。

交付与证据目录（仓库相对路径）：

- `extension/`：最终保留的 Chromium 生产包，可加载或重新加载。
- `artifacts/video-dubbing/chromium/`：整套 Chromium E2E 使用的生产包快照。
- `artifacts/video-dubbing/firefox/`：独立 Firefox 构建快照。
- `artifacts/video-dubbing/validation/`：最终门禁日志、覆盖率摘要及播放截图。

未调用收费服务，未复制参考扩展的私有服务凭据、脚本或资源，未提交、发布或部署。
原有工作树改动保留；本轮没有操作历史 `one-tampermonkey`、RepoLens 后端或 SDK vendor。

## VD 验收对应关系

| VD    | 对应公开边界与证据                                                | 范围 / 限制                                          |
| ----- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| VD-01 | T2 配置不会注入；T4 默认停用卡片与显式启用                        | 启用不执行供应商请求                                 |
| VD-02 | T2 管理 sender / frame / document / permission；T4 固定产物注入   | 原生权限弹窗未自动化                                 |
| VD-03 | T2 当前 video 的 native CC URL 更新；T4 平台字幕                  | 真实 YouTube 直接请求为空，提供 CC/导入回退          |
| VD-04 | T1 SRT/VTT 与边界；T2 无效导入不覆盖；T4 真实文件与无效替换       | 仅 UTF-8、2 MiB / 5000 条 / 3 小时                   |
| VD-05 | T2 真实 HTTP 请求、配置保密；T3 保存清空 key；T4 配置路径         | 有限兼容接口，无真实云 key 验收                      |
| VD-06 | T1 当前 cue / 首句即播 / 预缓冲；T4 真实解码和播放                | 30 秒目标窗口及缓存预算                              |
| VD-07 | T3 文本渲染；T1 文字保留窗口；T4 双语 cue                         | 手动切换显示模式                                     |
| VD-08 | T1 用户暂停优先与迟到结果；T4 实际 pause/resume                   | 自动播放被阻止需视频内点击                           |
| VD-09 | T1 seek 失效及 cue 内偏移；T3 停止后旧命令；T4 8.5 秒 / 第三 cue  | 视频时间为主时钟                                     |
| VD-10 | T1 重叠字幕 / overrun；T4 用户倍速保留                            | 配音最多 1.25 倍适配，再等待视频；未迁移复杂子句算法 |
| VD-11 | T1 原声与配音音量 / 清理；T3 有限音量命令；T4 原始媒体恢复        | 保留用户明确修改的倍速                               |
| VD-12 | T1 generation；T2 配置和同 tab 失效；T4 SPA / 重新读取            | 新视频不自动启动                                     |
| VD-13 | T2 HTTP 错误、重定向、大小、缓存重试；T1 缓冲失败                 | 不自动重发 TTS；取消不撤销云端账单                   |
| VD-14 | T2 撤权；T3 端口断开恢复；T4 停用、导航、worker 终止、两 tab 撤权 | 没有自动恢复会话                                     |
| VD-15 | 整套 Chromium 回归、既有 Firefox 宿主门禁、共享源 probe           | Firefox 宿主通过不代表新配音播放通过                 |
