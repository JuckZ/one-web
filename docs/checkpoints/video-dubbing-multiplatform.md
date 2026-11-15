# Video Dubbing 多平台实施检查点

日期：2026-11-12。目标仓库：`/home/juck/Projects/one-web`。
状态：**多平台实现与独立产物验收完成；全仓最新门禁受并行功能修改影响，见下表。**
用户要求支持 Bilibili 等视频平台，沿用已确认的 SDD/TDD 与 T1～T4 测试边界。
规格见 [多平台增量规格](../specs/video-dubbing.md#多平台增量规格2026-11-12)。

## 交付范围

- Bilibili 桌面普通 BV/AV 视频：固定 MAIN reader 提取视频身份与分 P/CID，
  后台请求固定字幕元数据接口。字幕 JSON 的秒转换为统一毫秒 cue。
- API 源由读取动作授权，所选已验证 CDN 源由启动动作单独授权；
  限制 HTTPS 主机与字幕路径、响应大小及超时，拒绝重定向，CDN 不带网站凭据。
- 分 P、视频元素、非 YouTube 媒体源变化终止旧会话。
  重新读取播放器会清除旧导入；切分 P 后可再次显式读取并启动。
- 其他 HTTPS/loopback 网页支持唯一顶层 HTML5 视频与字幕导入。
  不抓取未知站点字幕；多视频歧义、iframe、直播或特殊播放器明确报错。
- 复用原有同步引擎、双语字幕、暂停、seek、音量、全屏容器和清理机制。
  原生 video-only 全屏由浏览器接管，HTML 字幕层可能不可见。
- API 需要登录、无轨道或读取失败时，保留视频与导入回退，不伪造平台字幕成功。

## 实际 red → green

测试通过真实管理 client/controller、固定 injection 和 DOM 视图组合；
浏览器 API、网络及文件读取替身只在原有系统 seam。
命令为 `pnpm exec vitest run modules/builtin/video-dubbing/__tests__/platforms.test.ts`，
部分 green 同时运行既有控制器或视图测试。

| 切片 | 实际 red                                       | 实现后 green 行为                                           |
| ---- | ---------------------------------------------- | ----------------------------------------------------------- |
| 1    | Bilibili 打开被“请打开 YouTube 点播视频页”拒绝 | BV/AV + 分 P 身份、固定 reader 与内容连接                   |
| 2    | 平台轨道为 undefined                           | 固定 API 发现、精确 CDN 权限、真实秒时间轴                  |
| 3    | 点击读取只申请网站源                           | UI 直接动作申请网站/API，启动申请所选 CDN                   |
| 4    | 通用网页进入 YouTube reader 后失败             | 唯一顶层 HTML5 视频 + 导入                                  |
| 5    | 切分 P 后 status 仍显示旧 player               | 状态及 start 主动失效旧绑定                                 |
| 6    | discovery 途中撤 API 权限仍可注入              | 异步读取结束重新校验当前站点与权限                          |
| 7    | 无原生视频仍返回读取成功                       | 特殊/未就绪播放器明确错误                                   |
| 8    | SPA 重连没有 bound 消息；首轮 E2E 7/8          | native document ID + sender origin + 当前标签页身份联合验证 |
| 9    | 同页重新绑定仍显示“已导入 old.srt”             | 旧导入随断开/重新读取清除                                   |
| 10   | API 授权撤销后新 start 仍成功                  | 启动和请求前检查会话全部站点/API/CDN 权限                   |

追加验收包含恶意 CDN 地址、AV 入口、需要登录回退、通用网页无视频/多视频/直播、
不安全 URL 与不支持路径。它们验证已有守卫行为，未虚构逐项 red。
原始 red/green 日志保存在 `artifacts/video-dubbing/multiplatform-validation/`。

## 真实平台检查

2026-11-12 用 Playwright CLI extension 模式附着用户现有 Chrome，
仅新开自己的 `https://www.bilibili.com/video/BV1GJ411x7h7/` 标签页。
实际观察到：

- `__INITIAL_STATE__.videoData.bvid` 与 URL 一致，aid 为 `80433022`，
  分 P 1 的 CID 为 `137649199`。
- 一个原生 `VIDEO`，位于 `.bpx-player-video-wrap`，
  `#bilibili-player` 与 `.bpx-player-container` 均存在。
- 固定 `/x/player/wbi/v2` 请求 HTTP 200 / code 0 / CID 匹配，
  但 `need_login_subtitle: true`，轨道数 0。

另一次不带用户 cookie 的公开 HTTP 核查也返回上述 CID 与需要登录状态。
这证明当前页面结构及固定接口响应可识别，不能作为已取得真实平台字幕的证据。
云端翻译/TTS、真实字幕下载及主观音质未验收；测试媒体使用自制 WebM/WAV 和本机服务。
Chrome 检查后只关闭自己新开的标签页，并 detach `oneweb-bilibili-live`，
保留用户浏览器、其他标签页和登录状态。

接口和 JSON 形状另参考了上游
[yt-dlp Bilibili extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)
的 `_get_subtitles` / `json2srt`；实现独立编写，没有复制原参考扩展的脚本、资源或凭据。

## 最终验证

| 检查                                                  | 实际结果                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 配音相关 unit/组合测试                                | 7 个文件、46/46 通过，含本轮新增平台测试 25 项                                                       |
| `pnpm test:coverage`                                  | 当次工作区快照 103 files / 779 tests 全通过，覆盖率门槛通过                                          |
| 全仓覆盖率                                            | statements/lines 81.97%，branches 76.92%，functions 89.23%                                           |
| 配音源码、视图、E2E 与 fixture 的独立 TypeScript 检查 | 通过；复用根 tsconfig，独立 include 与构建缓存                                                       |
| 本轮源码、测试与文档 ESLint                           | 通过                                                                                                 |
| Chromium 构建与身份校验                               | 通过；测试使用单独固定的生产包快照                                                                   |
| 配音生产扩展 E2E                                      | 关闭 retries，8/8 通过；新增 Bilibili 两项、通用 HTML5 一项                                          |
| 既有宿主 + Cookie Manager + 配音 Chromium 回归        | 固定插件及 SDK 快照、关闭 retries，38/38 通过                                                        |
| Firefox                                               | 构建与身份检查通过；manifest 0 errors / 0 notices / 0 warnings；既有宿主 3/3 通过                    |
| `git diff --check`                                    | 通过                                                                                                 |
| 最新全仓 `pnpm typecheck`                             | 未通过：并行 Assistant 视图测试引用尚未出现在 `AssistantViewOptions` 中的 `readFile`；本轮文件无错误 |
| 最新全仓 `pnpm lint`                                  | 未通过：并行 Assistant/Workspace 等文件仍有格式与规则错误；本轮范围独立检查通过                      |

全仓检查在实施中曾通过，但最新命令观察到上述并行修改，因此不把历史通过写成当前全仓通过。
全仓 coverage 数量也包含其他并行功能的测试，不能把 779 与历史基线的差值全算成本轮新增。
未改动这些并行功能来强行消除错误。Firefox 宿主门禁不证明新增配音播放已经验收。

首次扩展回归为 37/38，失败堆栈明确为 fixture 读取共享
`packages/module-sdk/dist/runtime-client.js` 时文件不存在，而非播放器断言失败。
并行 SDK 构建会先删除该目录。本轮只为两个 fixture 服务增加可选
`MODULE_SDK_DIST_PATH`，默认路径不变，没有修改 SDK 源码；拷贝完整 SDK 产物后
用独立目录重跑，38/38 通过。复现命令：

```sh
EXTENSION_PATH="$PWD/artifacts/video-dubbing/multiplatform-chromium" \
MODULE_SDK_DIST_PATH="$PWD/artifacts/video-dubbing/multiplatform-sdk" \
pnpm exec playwright test e2e/basic.spec.ts e2e/cookie-manager.spec.ts e2e/video-dubbing.spec.ts --retries=0
```

产物（相对仓库根目录）：

- `artifacts/video-dubbing/multiplatform-chromium/`：上述回归实际加载的 Chromium 扩展，可直接加载。
- `artifacts/video-dubbing/multiplatform-firefox/`：单独保存的 Firefox 构建。
- `artifacts/video-dubbing/multiplatform-sdk/`：回归用 SDK runtime 快照。
- `artifacts/video-dubbing/multiplatform-validation/`：red/green、最终测试、范围检查、
  全仓失败日志、覆盖率摘要、检查配置与产物 SHA-256。

项目 `extension/` 是共享构建输出，其他并行构建可能继续更新它；独立快照保留本轮已验收版本。
未提交、发布或部署。保留已有工作树修改，没有操作历史 `one-tampermonkey` 或 RepoLens 后端。
