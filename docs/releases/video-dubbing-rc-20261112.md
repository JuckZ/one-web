# OneWeb 多平台视频配音本地候选

日期：2026-11-12。候选：`one-web-0.1.0-video-dubbing-rc.20261112`。
manifest 版本为 `0.1.0`。包与最终回归状态见
[验收检查点](../checkpoints/video-dubbing-release-validation.md)。

## 安装

候选根目录：`artifacts/video-dubbing/rc-20261112/`。

- Chromium：解压 `packages/one-web-0.1.0-video-dubbing-rc.20261112-chromium.zip`，
  或使用固定的 `chromium/`。打开 `chrome://extensions`，启用开发者模式，
  “加载已解压的扩展程序”，选择含 `manifest.json` 的目录。声明最低 Chromium 148。
- Firefox：打开 `about:debugging#/runtime/this-firefox`，“临时载入附加组件”，
  选择固定 `firefox/manifest.json` 或
  `packages/one-web-0.1.0-video-dubbing-rc.20261112-firefox-unsigned.xpi`。
  未签名包用于开发/临时安装，临时安装在重启后消失。声明最低 Firefox 142，
  本轮原生媒体实测 Firefox 160。
- 原有 RepoLens 独立网页服务不包含在包内；此构建固定源为 `http://127.0.0.1:4747`。
  Video Dubbing 使用自己的服务配置。

最终包、源码及产物哈希清单保存在候选目录。没有商店上传、签名、自动更新或公开发布。

| 包                 | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| Chromium ZIP       | `10e8ccb9650a2ea24dceac4fd3ea05be4c69b7c3e9675267f7459f531c7e2a92` |
| Firefox 未签名 XPI | `d2f24fd879ab9a39447265464f334a864425d5a04648063d85124d11cf13d010` |

同一源码快照通过 typecheck、lint、805 unit/coverage、Chromium 50/50（无重试）、
Firefox 4/4，含原生配音媒体；两浏览器构建与 manifest/身份检查通过。
完整性检查确认每个包均为 14 个验收文件，内容逐字节一致。

## 配置与操作

1. 打开 OneWeb 侧栏 → **工具 → Video Dubbing**，启用模块。
2. 填翻译地址、模型、API key，以及语音地址、模型、API key、voice。
   翻译使用固定 `chat/completions`，模型需支持 JSON-object；
   语音使用固定 `audio/speech`。接受 HTTPS 或显式配置的本机 HTTP。
3. 核对服务精确源，授权并保存。key 只在本机配置界面输入，管理响应仅显示是否已配置。
4. 在支持的视频页点击 **授权站点并读取视频**，选轨道或导入 UTF-8 SRT/VTT，
   设目标语言并启动。Bilibili 元数据 API、所选字幕 CDN 分别申请精确源授权。
5. 视频内继续/暂停/停止、切换字幕；侧栏独立调原声与配音音量。
   自动播放受限时点击视频内“继续播放”；换视频、切 P、停用或撤权清理旧会话。

## 平台范围

| 平台                        | 字幕                           | 范围                                                |
| --------------------------- | ------------------------------ | --------------------------------------------------- |
| YouTube                     | 点播字幕 / 原生 CC 更新 / 导入 | 桌面 `/watch`；空正文时开启 CC 重试或导入           |
| Bilibili                    | 平台字幕 / 导入                | 桌面 BV/AV、分 P 独立绑定；需要时使用网站现有登录态 |
| 其他 HTTPS / 本机 HTTP 页面 | 导入 SRT/VTT                   | 单一顶层 HTML5 点播 video；不自动抓取未知平台字幕   |

不含 ASR、录制、声音克隆、直播、Shorts/embed、番剧专用适配、跨域 iframe、
DRM 绕过或媒体导出。多个可见 video 提示歧义。容器全屏可显示字幕；
浏览器原生纯视频全屏可能隐藏 HTML 覆盖层。

## 权限与隐私

| 权限 / 数据                  | 用途与边界                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `activeTab` / `tabs`         | 用户指定当前页、视频身份与标签/导航生命周期；现有工具也使用                             |
| `scripting`                  | 注入随包固定读取器、播放器；不执行页面提供的任意脚本                                    |
| `storage`                    | 本机配置和 key；不持久化字幕、配音历史                                                  |
| `contextMenus`               | OneWeb 现有右键操作                                                                     |
| `sidePanel`                  | Chromium 侧栏；Firefox 用 `sidebar_action`                                              |
| 固定源                       | 现有 GitHub 与本机 RepoLens                                                             |
| 可选 HTTPS / HTTP 主机权限   | 用户按精确源授权站点、API、CDN、自有服务；配音不请求全网通配授权                        |
| 可选 `cookies` / `bookmarks` | 现有 Cookie Manager / Bookmark Doctor；配音不申请 cookies 权限或读取 cookie 值          |
| 平台登录态                   | 浏览器可为固定 Bilibili 元数据请求附带凭据；不提取、保存或交给翻译/TTS                  |
| 字幕 / 音频                  | 启动后仅发送有限字幕到选定服务；原声/视频不录制或上传；音频缓存只在内存                 |
| key                          | 各模块独立本地 extension storage，非加密保险库；不进入网页、MAIN reader、远程模块或日志 |

取消不能撤销已发生的云端计费，远端保留由供应商决定。完整清单见
[隐私数据清单](../privacy-data-inventory.md)。

## 尚需外部验收

真实登录 Bilibili 字幕发现、下载及分 P 身份已验证。
真实云配音、供应商 latency/usage/账单、人耳音质、物理音频输出、原生权限弹窗
和三小时连续播放尚未签收。自动化使用自制媒体、本机服务和 Firefox 临时静音输出，
三小时测试采用加速跳转。需要在用户 Chrome 加载此候选，并在 OneWeb 配置已授权
翻译/TTS 服务后，才能继续完整真实配音与人工听感验收。
