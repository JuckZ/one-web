# Windows 本地翻译、SAPI 与 Bilibili 完整链路

日期：2026-11-13。状态：**本轮资源调查、服务实现和真实 Bilibili 短链路验证完成；
首次授权等待缺陷已按 TDD 修复并实测，整体发布验收仍部分完成**。

后续已按用户最新要求改为本机 Chrome + Windows 具体 LAN IP 直连，
新候选、共享服务状态与新增证据见
[本机 LAN 检查点](video-dubbing-local-browser-lan.md)。
本文中的回环监听、1200 字符和服务已停止等内容描述前轮固定快照。

## 授权与当前基线

用户在支线「确定下一步行动」
（`01a1d250-2070-7661-8b81-49387a6ea26f`）要求“安排到主会话，继续推进”。
主会话已核对支线原始用户消息，承接其 SAPI 规格、TDD、真实服务和 Bilibili
完整验收安排。公开测试边界沿用 T1～T4，增量规格见
[Windows 本地验收](../specs/video-dubbing.md#windows-本地服务与真实网站验收2026-11-13)。

此前[资源调查](video-dubbing-workstation-resources.md)已完成，44 项证据校验通过；
本轮不重复执行模型盘点。Windows 执行继续复用对话
「盘点并验证 OneWeb 本地配音资源」
（`01a1d04a-7afa-76d0-947a-c6d381a562a6`），
主机 `remote-control:env_e_6a2604f42cfc8328823eeb30d5c2b527`。

Windows 实现位置：`C:\Users\ajuck\Projects\one-ComfyUI`。
新证据位置：
`C:\Users\ajuck\Projects\one-ComfyUI\labs\oneweb-dubbing-integration-20261113\`。

## 原固定候选与保留的失败基线

- 包：
  `artifacts/video-dubbing/rc-20261112/packages/one-web-0.1.0-video-dubbing-rc.20261112-chromium.zip`。
- SHA-256：
  `10e8ccb9650a2ea24dceac4fd3ea05be4c69b7c3e9675267f7459f531c7e2a92`。
- 大小：264,141 bytes。
- 本轮重新核对：ZIP 14 个文件与固定 `chromium/` 逐字节一致，成员集合相同。
- Windows 已通过现有受信任 SSH 复制此包、复核 SHA-256 一致并独立解压。
  根 `extension/` 上次为 Firefox 构建，不用于此次 Chrome 安装。
- 原 RC 的 805 unit、Chromium 50/50 与 Firefox 4/4 是该固定快照的历史门禁，
  不作为本轮新增服务或真实网站验收结果。

## 逐项进度

| 编号  | 当前状态                         | 证据或待完成事项                                                                                                                            |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| WI-01 | 服务证据已复核                   | 源码、规格、实际 red/green 与最终 10 项真实 HTTP/生命周期测试通过日志已回传；中英音频、参数、Host/Origin/Bearer、输出限制符合本轮声明范围   |
| WI-02 | 请求生命周期通过；活动停机未验收 | 并发 429、短预算超时、SAPI 与 FFmpeg 断连清理证据已核对；要求等待 `active=0` 后关闭，不声明活动请求中的服务自身停机保证                     |
| WI-03 | 自编短句批次通过                 | 首批 5.625 秒、后续 5.297 秒，启动另计 6.5 秒；六条 MP3 为 52,288～61,066 bytes、3.169～3.733 秒，不等于真实网站整批时延                    |
| WI-04 | 新候选已安装、配置并授权         | 新 ZIP 哈希、14 个安装文件一致；仅本轮旧候选停用，原 Chrome、其他扩展、标签和登录保留                                                       |
| WI-05 | 真实短链路通过；整批时延待测     | BV/CID/分 P 独立读回；真实平台字幕、本地翻译、SAPI、原生解码和媒体时钟推进已复核；34 次翻译与 54 次 TTS HTTP 观测不能代替完整浏览器批次时延 |
| WI-06 | 基本控制通过；换片待验           | 暂停/恢复、seek 至 90 秒、1.5 倍速、停止清空音频源有原生数据；真实换片或分 P 后旧播放器销毁和迟到请求清理未验收                             |
| WI-07 | 回读与时间戳已复核               | 七段 Qwen ASR 保留一段非零编辑距离；本轮中英服务样音的 Whisper SRT/VTT/JSON 已核对，不代表人工听感或强制对齐                                |
| WI-08 | 自动回归及真实等待通过           | 新候选原生权限窗口实测等待至少 46.094 秒，47 次采样无翻译/TTS；允许后无需重新读取视频，自动继续                                             |

## 首次字幕源授权等待修复

原 RC 在真实 Bilibili 首次允许 `aisubtitle.hdslb.com` 后，
已读取的视频会话消失，启动报“请先读取当前视频，等待播放器连接”，
翻译服务未收到请求。已获授权后重新读取并立即启动，能够发出真实翻译请求、
侧栏显示 playing。这是原候选阶段的部分链路证据，不能证明原生音频播放；
新候选的原生媒体结果单列于下文。

`VideoDubbingView` 在等待原生许可时将 `busy` 设为 true，原先随之停止
全部状态联系；后台只保留内存会话，播放器在状态不变时也不发消息。
新增 WI-08 在真实 View / Client / Controller 的公开接口上，控制原生许可与
浏览器空闲生命周期两个外部边界，复现 45 秒等待后无法发送 start 的 red。
修复让等待操作期间继续已有的一秒只读联系，不应用并发界面状态，
保留配置编辑和轨道选择；许可完成后继续启动，销毁视图时清除定时器。
同一文件三项测试 green，原始日志保存在新候选 `preflight/`。

新候选：
`artifacts/video-dubbing/rc-20261113-permission-wait/`。

- 基于原 RC 的 358 文件固定源码，仅带入
  `src/sidebar/video-dubbing-view.ts` 与其回归测试两个文件。
- 源码输入清单 SHA-256：
  `653b49011f1f8d5d595b809a3a3d9cd448f71839346c143de8c9a013de20b426`。
- 新 Chromium ZIP 为 262,522 bytes，SHA-256：
  `49d5b5d7584a5aa23aef0df6b5c30da62fc93d73e47549ace55b766e7c4c8456`；
  14 个文件逐字节匹配解压目录，manifest 与原 RC 相同。
- 隔离候选通过 typecheck、lint、806 unit / 105 files 及覆盖率门禁，
  Chromium 50/50（零重试）、Firefox 4/4、双浏览器构建及身份/manifest 校验。
  Firefox 真实音频解码和时间推进使用临时静音输出，结束后已回收。
- 当前主工作区另有并行网页翻译修改；本轮完整检查为 819 tests 中
  818 通过、`dynamic-translation.test.ts` 一项失败，并有相关 lint 错误。
  已保留失败日志且不修改这些并行代码；候选从原源码归档隔离构建，
  排除的现有路径见候选 `source-fingerprint.json`。

## 已回传服务快照与审阅

本机证据目录：`artifacts/video-dubbing/workstation-20261113/`。
[服务阶段 ZIP](../../artifacts/video-dubbing/workstation-20261113/oneweb-sapi-service-stage-20261113.zip)
为 27,951 bytes，SHA-256：
`61d8e8b86bf02a0859b6505cbd69f93d7ebeab21b83b7320a0a8d921e6828a88`。
压缩包 35 项与白名单一致，未包含运行凭据配置、profile 或平台字幕。
主会话已检查归档路径、Python 语法、red/green 原始日志与最终
`13-service-final-regression.log` 的 10 项通过结果，并记录
[逐文件哈希与复核](../../artifacts/video-dubbing/workstation-20261113/service-stage-verification.json)。
这是对 Windows 实际运行证据的复核，不是 Linux 重跑 SAPI。

真实请求生命周期观测：

- 短执行预算为 0.4 秒，请求约 0.688 秒返回 504；无新增残留子进程或请求文件。
- 先观察到真实 PCM 再断连，约 0.266 秒完成 SAPI 清理；后续请求恢复成功。
- 先观察到真实 FFmpeg 再断连，约 0.203 秒完成转码进程和文件清理。
- 并发上限一，无队列，额外请求返回 429 和 `Retry-After`。

本轮服务声明 `windows-sapi` 模型、`huihui` / `zira` 音色、
MP3/WAV、最多 1200 字符且 speed 只能为 1。
OneWeb 译文允许最多 2000 字符，因此更长的 cue 超出当前服务范围，
不能根据短句成功推定其可用。服务停机部分只看到测试包装器从外部
终止整棵自有进程树，不能证明服务自身退出清理。接入说明已收窄到：
先停止插件请求并等待 `/health` 的 `active=0`，再关闭本轮自有服务。
活动请求中的服务自身停机清理没有验收，不纳入已通过保证。

## 已复核的阶段补充证据

补充包 `oneweb-dubbing-integration-evidence-20261113-partial.zip`
为 524,530 bytes，SHA-256：
`73d884f800e6a13bbe3a034883a1398db7c5c41190f2b9b729bad2b5d2bb8dc6`，
已核验并解压至本轮证据目录的 `integration-partial/`。
当前可用的[服务接入说明](../../artifacts/video-dubbing/workstation-20261113/integration-partial/voice-system/oneweb_sapi/README.zh-CN.md)
明确了实际 Python/FFmpeg 路径、私有配置及等待 `active=0` 后关闭的限制。
原生许可操作方按本轮人类授权使用 cua-driver，不能据此标记人工听感。

主会话独立解码八段自编服务样音，均包含有限、非静音 PCM；
六段批次音频 SHA-256 与 Windows 请求结果完全相同，见
[独立音频复核](../../artifacts/video-dubbing/workstation-20261113/partial-audio-verification.json)。
[Qwen ASR 逐段结果](../../artifacts/video-dubbing/workstation-20261113/integration-partial/labs/oneweb-dubbing-integration-20261113/asr-results.json)
为七段中六段归一化后编辑距离零，一段中文为 13 字单位中的一次编辑；
目前不能仅凭转写判断为合成漏字、译文问题还是 ASR 规整，人工听评未做。
本轮 Whisper 分段时间戳在最终包中补齐，详见下文，不沿用前轮样音关闭该项。

原候选的[浏览器阶段结果](../../artifacts/video-dubbing/workstation-20261113/integration-partial/labs/oneweb-dubbing-integration-20261113/browser-results.json)
准确标为 `partial_not_accepted`。原生采样虽然看到视频推进，
但配音 time 为 0、readyState 为 0，尚不足以证明 Chrome 解码和播放。
后续还出现“翻译结果结构或字幕 ID 不完整”，缺少脱敏响应结构，
具体原因未确立。seek/倍速的 Console 输入未确认执行，也未计为通过。
这些失败作为原候选阶段证据保留；新候选使用独立新权限和普通 Bilibili
标签页完成下述验收。

## 新候选最终回传与独立复核

[最终脱敏包](../../artifacts/video-dubbing/workstation-20261113/oneweb-dubbing-permission-wait-evidence-20261113-final.zip)
为 2,486,180 bytes，SHA-256：
`b1ead44e704d2e189fec6ea8dfc2f7994d271cb6950b2fc70fbd0fe86b77070b`。
138 项文件与白名单、逐文件大小及 SHA-256 全部一致，路径检查通过。
包保留原始资源调查精选文件、服务阶段失败与通过记录，以及新候选独立结果；
主会话没有覆盖任一原包，也没有在 Linux 重跑 Windows 服务或模型。

主要入口：

- [Windows 新候选报告](../../artifacts/video-dubbing/workstation-20261113/permission-wait-final/labs/oneweb-dubbing-integration-20261113/permission-wait/REPORT.zh-CN.md)。
- [机器可读结果](../../artifacts/video-dubbing/workstation-20261113/permission-wait-final/labs/oneweb-dubbing-integration-20261113/permission-wait/results.json)。
- [Linux 独立复核](../../artifacts/video-dubbing/workstation-20261113/permission-wait-final-verification.json)。
- [服务接入说明](../../artifacts/video-dubbing/workstation-20261113/permission-wait-final/voice-system/oneweb_sapi/README.zh-CN.md)
  与 [本轮复现入口](../../artifacts/video-dubbing/workstation-20261113/permission-wait-final/labs/oneweb-dubbing-integration-20261113/permission-wait/REPRODUCE.zh-CN.md)。

最终包的 15 个 Python 文件均通过 AST 检查；服务、真实 HTTP 测试与 SAPI
脚本和此前已审阅快照逐字节一致。八段服务/批次样音与此前已独立解码文件的
SHA-256 一致。Windows 的 20 项证据及保留检查不是 20 项新增产品测试。
远端补充报告一处将旧候选简称为 `rc-20261113`，其实际
`candidate-manifest.json` 指向的是上述 `rc-20261112` 原包，以包名与哈希为准。

### 原生许可与真实字幕

新候选扩展 ID 为 `gdkpelgcnnpojndiogjjghadkpbfokbd`，安装目录的 14 文件
与固定 ZIP 相同，仅停用本轮旧候选。独立读回页面 BV `BV1GJ411x7h7`、
CID `137649199`、分 P=1、视频时长 213 秒；
侧栏选择 `English(US)` → `zh-CN` → `huihui`。
没有导入字幕或注入适配器、prepare/session 结果。

首次 `aisubtitle.hdslb.com` 原生授权窗口等待实测下限为 **46.094 秒**，
47 次采样均无翻译、TTS 或请求目录新增。后台点击无效后，经新鲜桌面状态
确认的原生 Allow 点击生效；操作方为**依人类授权执行的 cua-driver 自动化**，
不是用户亲手点击。允许后没有重新读取视频，真实 `bili-6` 翻译和 SAPI
请求均返回 200，侧栏显示 `paused (user)`。该结果关闭 WI-08 的真实等待部分。

后续普通 Bilibili 自建标签完成媒体试验。Playwright extension 模式在原生操作后
多次丢失受控视频目标、只余 connect 页，原 Chrome 视频页仍在。
因此原生操作使用 cua-driver，媒体值通过原 Chrome DevTools 的公开
HTMLMediaElement getter 读取；未绕过 DOM 绑定授权、切换 profile 或注入内部会话。
未确认生效的 UIA 点击、Console 输入、推荐预览造成的第二视频均不计为通过。

### 媒体与模型观测

主会话根据保存的原生采样重新计算：

| 操作                               | 实测窗口     | 视频时钟             | 配音时钟                               | 结论                     |
| ---------------------------------- | ------------ | -------------------- | -------------------------------------- | ------------------------ |
| 普通播放                           | 0.702 秒     | 推进 0.701529 秒     | 推进 0.702166 秒，readyState=4         | 真实解码及时间推进       |
| 暂停                               | 0.712 秒     | 不变，paused=true    | 不变，paused=true                      | 暂停保持                 |
| seek 至 90 秒后恢复并设为 1.5 倍速 | 0.301 秒     | 推进 0.450830 秒     | 同一音源推进 0.435775 秒，readyState=4 | 观察窗口内倍速及恢复成功 |
| 停止及最后复核                     | 两次独立采样 | 最后暂停，倍速恢复 1 | paused=true、无 src、readyState=0      | 停止清理通过             |

样本范围不足以证明长时同步漂移，也没有据此推断内部
`URL.revokeObjectURL` 调用已被真实网站验收。真实换片或分 P 的旧播放器销毁、
在途请求失去播放权仍待验证；关闭自建测试标签组不替代该项。
所有媒体均静音，人工听感与物理声卡/扬声器输出未验收。

新阶段翻译观察入口原样透传模型请求/响应，只记录结构、cue ID、字数和耗时；
其访问规则与透传行为有两项独立 HTTP red → green 日志。
主会话已审阅透传源码，重新核对日志中 **34 次翻译响应的 ID 唯一且完整，
54 次 SAPI POST 均为 200**。翻译 HTTP 首次 0.984 秒，
范围 0.750～2.735 秒，中位 0.8595 秒；这些提供者 HTTP 时延不等于
真实浏览器首次/后续整批时延，不能混用 WI-03 自编短句的 5.625/5.297 秒结果。
上一阶段模型 ID 失败仍保留，不据本阶段成功推定任意字幕均可靠。

本轮 `http-zh.mp3` 与 `http-en.wav` 新增 Whisper 回读，
含加载分别为 20.527 秒、19.881 秒，峰值 RSS 约 808 MiB。
中文一段 0～4.940 秒；英文两段 0～2、2～4 秒。
主会话核对 SRT、VTT 与 JSON 的分段时间一致、单调且位于各自实际音频内。
它们是模型估计的分段时间戳，没有强制对齐，也没有验证与原视频逐字同步。

### 收尾与后续范围

Windows 核对 SAPI `active=0` 后回收本轮模型、观察入口和 TTS 自有进程树，
8765/8766/8767 无监听，请求目录为空。已关闭仅属于本轮的五标签组、
detach 自有 Playwright 并结束 Cua 会话；原 Chrome、其他标签和登录保留。
新候选保留安装，当前没有本轮服务常驻监听。
精确启动命令、私有凭据配置和只在空闲后停止的要求见上方复现与接入说明。

本轮没有开启跨设备转发。Windows → Linux 的回环 SSH 远程转发仅作为后续方案记录，
尚未测试；不能据 Windows 同机成功认定 Linux 浏览器可直接连接其 `127.0.0.1`。
仍需验证真实换片/分 P 清理、完整浏览器批次时延、长时连续播放及同步漂移、
人工中英听评、物理输出、活动请求中的服务停机、模型资源竞争。
神经 TTS 三条批次吞吐及真实云服务 usage/费用也保留为独立验收项。

## 证据解释

仅依据本轮真实执行更新状态。HTTP 成功、离线音频生成、
页面适配器注入或 fixture 通过均不能单独关闭 WI-05/WI-06。
人工听感、物理输出、原生权限与连续长播各自记录实际状态。
当前没有真实云端调用，云端 usage/计费缺口保留。

服务仅监听回环地址；需要跨设备传输时优先复用已有受信任通道，
不开放公网、不改防火墙。所有凭据和网站会话数据留在其预期位置，
不写入报告、聊天或调试日志。
