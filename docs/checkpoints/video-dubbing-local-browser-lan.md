# 本机 Chrome 与 Windows 局域网服务验收

日期：2026-11-13。状态：**LAN 配置已按 SDD/TDD 实现，固定候选全门禁通过，
跨设备真实翻译/TTS CLI 批次已通过；本机原 Chrome 已完成真实 Bilibili
英文字幕 → 中文翻译/TTS → 页面配音、暂停/继续/停止与换片清理观察，
保存了 180.4 秒媒体时间轴。完整长播、端到端批次时延及人工听评仍未验收。**

本轮承接用户“在本机进行浏览器插件测试”“现有未跑通或未验收的内容继续推进”，
并优先执行“尽量使用局域网 IP，不必建 SSH 通道”的最新要求。
先前 Windows 同机短链路、首次授权等待修复与历史限制保留在
[前轮检查点](video-dubbing-workstation-integration.md)。
下文区分 CLI、已安装原 Chrome 的短链路，以及仍未完成的验收项目。

## 地址、范围与运行状态

| 项目                | 本轮实际值                                            |
| ------------------- | ----------------------------------------------------- |
| Linux 本机          | `192.168.31.48/24`                                    |
| Windows workstation | `192.168.31.163/24`，以太网                           |
| 翻译                | `http://192.168.31.163:8765/v1/`                      |
| TTS                 | `http://192.168.31.163:8766/v1/`                      |
| 模型上游            | Windows `127.0.0.1:8767`，不向局域网公开              |
| API 传输            | 直接 LAN HTTP，无 API SSH 隧道                        |
| 文件传输            | 复用已有受信任通道，仅传文件                          |
| 服务生命周期        | 本轮共享实例保持运行，等待后续浏览器测试；未改防火墙  |
| 浏览器 Origin       | `chrome-extension://aeaejcbfmojncackbecilmapcadhbpff` |

服务只绑定具体 LAN IP，按客户端 IP、精确 Host、非空 Bearer 与准确 Origin
控制访问。无 Origin 的独立 CLI 探针已获准；未放宽浏览器 CORS。
探针配置保存在本轮 `private/providers-probe.json`，
浏览器配置已原子发布到 `private/providers.json`，目录 700、文件 600。
本机原 Chrome 插件页面已显示服务已配置，两个 key 输入框清空，
翻译/TTS 地址、模型及声音与本轮配置一致。报告不包含凭据。

## 插件增量与固定候选

[LC-01～LC-06 规格](../specs/video-dubbing.md)记录配置、真实接口、平台短链路、
整批耗时、真实换片/分 P、连续墙钟播放和听音验收。
公开测试边界沿用已确认的 T1～T4，服务生命周期使用真实 HTTP/进程/文件边界。

`src/modules/builtin/video-dubbing/config.ts` 只增加私有 IPv4 HTTP 配置能力。
真实 client/controller 测试先复现 LAN 地址被拒绝的 red，再最小修复为 green；
公网/越界/伪装域名/URL 凭据/查询/片段拒绝，
新地址空 key 不继承旧 key，未授权精确源不能保存，非法输入保留旧配置。
未扩大视频网站/CDN规则或 manifest。

候选 [rc-20261113-lan](../../artifacts/video-dubbing/rc-20261113-lan/README.md)
从上一固定源码隔离构建，只带入配置与 controller 测试两个文件，
排除主工作区并行修改。已通过：

- typecheck、lint、808 单元测试 / 105 文件及覆盖率门禁。
- Chromium 生产构建、身份校验及 50/50 E2E，零重试。
- Firefox 构建、身份/manifest 校验及 4/4 真实媒体门禁。
- Firefox 使用本轮临时 null sink，结束后已移除；不代表物理音频输出。
- 358 个源码文件、源码归档、两个包各 14 文件逐项哈希/内容一致。

源码清单 SHA-256：
`b8770db954edaaf658486de396749923becc31777b4df532b24d005ffb55d5c8`。
Chromium ZIP SHA-256：
`02ea112f4a52d9b2047914aff1d9ba78dd9e739e6de9826df94834d797344d5f`。
候选的 `preflight/`、`verification.json`、`package-audit.json` 与
`SHA256SUMS` 保留实际门禁和构建来源。

## 真实跨设备 CLI 批次

[本机请求结果](../../artifacts/video-dubbing/local-browser-20261113/evidence/windows-provider-probe.json)
由 Linux 进程无代理直连 Windows LAN IP，
使用三条自编英文字幕，经 Qwen 翻译为中文后串行 SAPI 合成。
两路健康检查均 200；错误 Bearer、Origin、Host 均按预期拒绝。

| 阶段           | 实测耗时 / 产物                             |
| -------------- | ------------------------------------------- |
| 三条翻译       | 1.626835 秒，全部原 cue ID 唯一保留         |
| TTS 1          | 1.324948 秒，52,288 bytes，3.178458 秒音频  |
| TTS 2          | 1.294573 秒，52,288 bytes，约 3.1686 秒音频 |
| TTS 3          | 1.288382 秒，44,347 bytes，约 2.6736 秒音频 |
| 批次含 FFprobe | 5.655218 秒，所有业务请求 HTTP 200          |

主会话独立全量解码三条 MP3，PCM 均有限且非静音，
文件与 Windows 回传包逐字节相同。
这些是 CLI 请求与解码证据，**不是安装后浏览器的整批墙钟时延、
人耳听感或物理扬声器验收**。

## Windows 新增服务回归

远端继续复用原 one-ComfyUI 对话和已安装资源，没有重新下载模型。
已回传的
[CLI 阶段归档](../../artifacts/video-dubbing/local-browser-20261113/oneweb-lan-cli-verified-20261113.zip)
为 398,393 bytes，SHA-256：
`d8b18ae5f8ee3f6974a82b05f15ee0410e766a989cb5ba95f1b859bdc1cfb614`。
主会话独立核验 71 项白名单、路径、大小及哈希，16 个 Python 文件 AST 通过，
未发现本轮已知凭据材料，见
[独立复核](../../artifacts/video-dubbing/local-browser-20261113/cli-verified-review.json)。
这不等于在 Linux 重跑了 Windows SAPI。

- 原 10 项真实 HTTP 服务回归通过，新增 4 项通过。
- 2000 字符英文从 422 的 red 修复为完整可解码 MP3，
  156.744 秒、2,509,471 bytes；2001 字符仍拒绝。
- 观察到 SAPI 正在写 PCM 后，鉴权 `/shutdown` 返回 202，
  活动请求 503，服务自行以退出码 0 结束，约 0.469 秒完成清理。
- 真实 FFmpeg 转码期间的正常停机也通过。
  两项均在独立实例验证，没有用外部 kill 冒充正常停机。
- 翻译计算取消的初始失败证据保留：原透传观察层约 0.406 秒记录取消并关闭
  上游 HTTP，2 秒后真实模型槽位仍忙；约 5.687 秒后的空闲属于自然完成。
  后续独立实例按 red/green 启用内部 SSE 聚合，记录到约 0.093 秒释放真实
  模型槽位及模型 cancel task 日志，完整 JSON 契约和真实截断 502 也通过。
  该修复已启用于当前入口，模型 PID 41892 未重启。详见
  [流式取消证据](../../artifacts/video-dubbing/local-browser-20261113/windows-streaming-cancellation.zh-CN.md)。
  这不等于已验收当前浏览器真实换片时的取消行为。

## 本机原 Chrome 当前进度

Playwright CLI 使用 extension 模式复用原 Chrome。
导航到 `chrome://extensions/` 导致调试目标脱离；一度只余 connect 页。
之后直接导航到普通 Bilibili 页面恢复受控，未更换 profile 或内置浏览器。
此前只读媒体采样时该 CLI 会话已关闭，返回“browser is not open”，
当时没有拿到可用采样；本轮随后通过原生 DevTools 读取公开媒体元素，
没有注入配音引擎内部状态。本轮结束检查没有自有 Playwright 附着会话。
没有关闭用户 Chrome、标签页或登录态。本轮不再次通过 Playwright
导航到受保护扩展管理页。

此前原生 cua-driver 在 Wayland 上只能取得 Chrome 占位元数据，
后台树没有可操作控件；应用启动交接超时，前台截图也未证实本机 Chrome
可靠激活。未确认的点击或启动返回不计为成功。用户在使用远程工作窗口，
因此交由用户完成一次明确的扩展加载。

用户随后已在本机 Chrome 的 `chrome://extensions/` 加载：

```text
/home/juck/Projects/one-web/artifacts/video-dubbing/rc-20261113-lan/chromium
```

已从 Chrome Default Preferences 的扩展注册元数据只读取得实际 ID
`aeaejcbfmojncackbecilmapcadhbpff`，加载目录与固定候选的 14 个文件哈希一致，
没有修改浏览器 profile。见
[已加载候选核对](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-installed-extension.json)。
准确 Origin 已启用，服务保持运行。2026-11-13 03:35 UTC 的本机直接 LAN 健康
请求返回两路 200，响应中的允许 Origin 均为该准确扩展源，见
[当前健康检查](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-origin-current-health.json)。

当前 Playwright CLI extension 可导航到真实 Bilibili 普通网页，
但跨扩展导航返回 `Page.navigate: Not allowed`；会话也出现再次关闭，
不能把浏览器控制通道故障计为插件配音失败。没有切换内置浏览器或其他 profile。
官方 cua-driver 的 MCP 未列出 Chrome，原生应用接口可定位实际 KWin
Chrome 窗口，但后台无障碍树为空；窗口截图及输入会短暂将 Chrome 置前，
不能宣称全程后台操作。

原生窗口中已确认插件显示“服务已配置”，并在实际
`https://www.bilibili.com/video/BV1GJ411x7h7/` 打开 OneWeb 侧栏。
页面读回 BV `BV1GJ411x7h7`、aid `80433022`、第 1 P CID `137649199`。
点击“授权站点并读取视频”后，Chrome 原生弹窗准确请求
`api.bilibili.com` 与 `www.bilibili.com` 的访问权限，用户已确认。
后续 `aisubtitle.hdslb.com` 的精确字幕源权限也已确认。
没有自动操作权限弹窗，也没有绕过授权注入内部会话。

## 原 Chrome 的真实平台短链路

实际发现 12 条平台轨道，选择 `English(US)` → `zh-CN`，
使用局域网翻译模型 `local-translator`、语音 `windows-sapi` / `huihui`。
点击开始时原视频已经暂停，插件保持 `paused (user)`；
点击继续后进入 `playing`，真实页面显示原文和中文译文。
暂停、继续和停止均从实际侧栏执行。原声音量在测试会话中设为 0，
没有更改系统默认音频设备或设备音量。
[真实页面截图](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-bilibili-dubbing-desktop.png)
来自官方驱动的完整桌面捕获，不标作经过身份认证的单窗口截图。

通过原生 DevTools 每 100 ms 采样公开 `HTMLMediaElement` 的
`currentTime` / `paused` 和可见浮层的状态文字，不读取私有配音会话、
不替换网络、音频或时钟。测试起点显式 seek 到 10 秒，此后按墙钟连续采样，
不能将这次 seek 计为已播放时长。导出的 JSON 不含字幕正文或签名 URL。
原始采样与独立计算分别保存在
[1800 个样本](../../artifacts/video-dubbing/local-browser-20261113/evidence/oneweb-active-dubbing-media-20261113.json)
和[媒体汇总](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-browser-playback-summary.json)。

| 项目                          | 观测值                                    |
| ----------------------------- | ----------------------------------------- |
| 采样起点                      | 2026-11-13 03:49:31.954 UTC               |
| 墙钟区间                      | 180.4 秒，1800 样本，最大相邻间隔 0.32 秒 |
| 媒体进度                      | 10 → 165.676 秒，推进 155.676 秒          |
| `paused (user)`               | 约 17.0 秒                                |
| `playing`                     | 约 155.28 秒                              |
| `buffering (dubbing-overrun)` | 约 8.12 秒，共 23 段                      |

`dubbing-overrun` 表示语音超出字幕时间窗，当前策略会暂停原视频等待语音；
不能将这 8.12 秒隐藏为“流畅无停顿”，也不能当成 HTTP 请求耗时。
目前没有直接采到配音音频时钟，因此不签收音画漂移数值。
首批/后续批次从浏览器动作到可播放的完整耗时也尚未单独计量，
不能用服务端请求耗时或旧 CLI 5.66 秒替代。

[90.54 秒 TCP 只读采样](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-browser-lan-connections.json)
共有 86 点，其中 81 点存在到 Windows 8765/8766 的连接；
可见连接全部归属原 Chrome 网络进程 PID 4894，没有其他进程业务请求。
这不是抓包，不能据此声称逐个业务请求的 Origin 已被日志记录。

设置正确的桌面 `XDG_RUNTIME_DIR=/run/user/1000` 后，
只读 PulseAudio/PipeWire 元数据可用：
Chrome 非静音、非 corked 的活动流路由到实际
`Ryzen HD Audio Controller Headphones`，设备处于 RUNNING、未静音。
见[音频路由](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-chrome-audio-route.json)。
应用流元数据不能隔离某个 Chrome 标签页，也不能证明人耳实际听到或音质合格。
没有采集其他应用的音频，没有使用 null sink 冒充物理输出。

## 真实导航、字幕回退与结束状态

Bilibili 自动下一条到 `BV1p98q6dEdz` 时，旧配音浮层消失、
侧栏轨道清空。随后 45 秒实际媒体进度为 58.461 → 103.354 秒，
449 个样本中配音浮层均为 absent，见
[换片后的公开媒体采样](../../artifacts/video-dubbing/local-browser-20261113/evidence/oneweb-browser-media-20261113.json)。
这段是换片后旧浮层持续不存在的证据，不是新视频已配音的证据。

再到 `BV1UT42167xb` 后可以重新读取视频；该片没有可读取平台字幕，
界面明确提示开启字幕后重读或导入 SRT/VTT。通过真实文件选择器导入
[三条自编字幕](../../artifacts/video-dubbing/local-browser-20261113/evidence/navigation-test.srt)，
界面显示导入 3 条，点击开始后保持用户暂停。
随后点击继续，并立即通过原生地址栏真实导航到 `BV1GJ411x7h7`，
旧导入提示清空，旧浮层消失。

04:01:11.955 UTC 的导航前探针为 speech active 0、仅有旧 CLOSE-WAIT 连接，
不能据此声称命中在途请求。04:02:18.239 UTC 的探针为 active 0、没有业务 TCP
连接，见[导航前](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-navigation-before.json)
与[导航后](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-navigation-after.json)。
是否实际取消了该次正在运行的模型请求，须与 Windows 业务日志关联，
目前仍待核对。独立服务取消通过不替代这一门禁。

04:06:00.258 UTC 显式暂停目标页后读回原生媒体 paused true、
currentTime 141.121824、旧配音浮层 false。不能仅凭这次主动暂停后的 paused 字段
签收迟到结果不会恢复播放；持续浮层观测和后台请求取消应分别核对。
结束前重新读取该目标视频，选择 `English(US)`，显式停止配音；
可见状态为 idle，视频保持暂停，服务配置保留，Windows 共享服务继续运行。
用户 Chrome、标签页和登录状态保留，DevTools 已关闭，临时采样定时器已停止。

结束时 Windows 远程 Codex 状态查询连续两次不可用，现有文件回传也未完成；
只读 SFTP 连接的 22 端口返回 Connection refused，没有创建隧道或修改 SSH 设置。
局域网服务不依赖该控制通道：04:08:25.592 UTC 的独立直连健康检查两路均为 200，
语音 active 0，见
[结束阶段健康检查](../../artifacts/video-dubbing/local-browser-20261113/evidence/linux-final-provider-health.json)。
因此 Windows 本次业务日志的逐请求归属、耗时及导航取消关联仍待回传，
不将控制通道不可用写成 API 故障。

## 尚未关闭的验收项

- LC-03：首次和后续完整浏览器批次耗时。
- LC-04：本次真实在途请求取消的服务日志关联、实际分 P 切换。
- LC-05：三小时墙钟长播、配音音频与视频的数值漂移、完整资源趋势。
- LC-06：当前页面及中英样音的人工听评、实际可听输出确认。
- Windows 组合控制器最终正常回收；在线实例为本轮测试继续保留。
- 收费云服务的 usage / 费用没有测量，本轮没有收费云调用。
