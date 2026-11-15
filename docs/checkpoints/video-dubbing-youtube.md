# YouTube 指定视频与真实浏览器验收

日期：2026-11-13。用户指定视频：
`https://www.youtube.com/watch?v=SOwUWPtXQ9I`。
复用本机原 Chrome、已加载 OneWeb、现有登录状态和 Windows 局域网翻译/TTS。
沿用用户已确认的 SDD/TDD T1～T4 边界。

## 实现与 SDD/TDD

既有 YouTube adapter 已识别桌面 `/watch` 点播。本轮验证并修复三个实际缺陷：

1. 初始 timedtext 返回 HTTP 200 / 空正文，原生 CC 已开启也无法直接启动。
   现在仅在空正文时刷新当前播放器的原生 CC 一次，等待最多六秒，
   仅接受当前视频/源/语言/kind 匹配的已知轨道请求，保留签名 URL 原始编码后重试。
   停止、seek、导航、断连和撤权取消等待；无匹配请求时给出选择原生语言或导入提示。
2. 失败后重试成功仍残留旧错误。现在成功读取字幕后替换反馈，
   实际准备、播放或后续错误继续由播放器状态呈现。
3. 首轮真实采样发现服务错误分支释放了引擎暂停，视频在等待重试期间继续前进。
   现在失败时保持视频与语音暂停，显式继续仍处理当前媒体位置；
   停止配音可以按原规则释放引擎暂停。

先更新 [SDD](../specs/video-dubbing.md) 的 YT-01～YT-05，再逐条 red/green。
无页面 fetch/XHR 修改，无 webRequest 权限，无平台 token 生成；
服务密钥仍仅保存在本机扩展配置和原 private 文件中。

| 边界                  | 失败证据                                                              | 修复与回归                                                              |
| --------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| T4 原生 CC            | `01-native-cc-red.log`：旧生产包无法启动已开启 CC 的空字幕场景        | `03-native-cc-green.log`；最终 `25-hold-focused-e2e-green.log`          |
| T3 用户反馈           | `04-feedback-red.log`：成功重试仍显示旧错误                           | `05-feedback-green.log`                                                 |
| T2 端口/HTTP/生命周期 | 同视频、语言、kind、原始编码、停止/seek/导航/撤权与有界超时           | `06-recovery-regression.log`，最终全量 unit                             |
| T1 错误位置           | `18-error-position-unit-red.log`：错误分支恢复播放并丢失 error reason | `20-error-position-unit-green.log`                                      |
| T4 错误位置           | `19-error-position-e2e-red.log`：HTTP 429 后视频未暂停                | `25-hold-focused-e2e-green.log`：暂停且真实媒体时间不前进，显式重试成功 |

上述日志均位于
`artifacts/video-dubbing/youtube-browser-20261113/evidence/`。

## 最终固定候选与安装

最终候选：
[`rc-20261113-youtube-hold`](../../artifacts/video-dubbing/rc-20261113-youtube-hold/README.md)。
从已冻结 LAN 快照开始，累计只合入九个相关源码/测试文件；
主工作区其他并行未提交修改未进入候选。

最终同一冻结源码通过：

| 检查                           | 结果                                                     |
| ------------------------------ | -------------------------------------------------------- |
| typecheck / lint               | 通过                                                     |
| unit / coverage 门禁           | 815/815，106 个文件                                      |
| Chromium 生产构建 / 身份       | 通过                                                     |
| Chromium 全量 E2E              | 51/51，零重试                                            |
| Firefox 构建 / 身份 / manifest | 通过；0 errors / warnings / notices                      |
| Firefox 生产包门禁             | 4/4，含真实音频解码、时间推进和控制                      |
| 源码与包核对                   | 359 项源码在门禁后未变；归档一致；双包各 14 项逐字节匹配 |

Firefox 的临时 null sink 只供该门禁进程使用，测试后已移除，用户默认输出未变。
该结果不代替人耳听评或原 Chrome 的物理输出验收。

原 Chrome 扩展 ID：`aeaejcbfmojncackbecilmapcadhbpff`。
原加载目录保留：

```text
/home/juck/Projects/one-web/artifacts/video-dubbing/rc-20261113-lan/chromium
```

此目录是已更新并原生重载的解压安装副本，当前逐字节匹配最终候选 `chromium/`；
manifest 未变，保留配置、授权和 Windows 准确 Origin。
原 LAN 文件和第一轮 YouTube 文件分别完整备份，
原始包、源码归档和清单保留。历史 LAN 的 `chromium.sha256`
应对 `installed-lan-backup/` 校验，不能对已更新的安装目录校验。
两次安装更新记录为 `installed-overlay.json` 和 `installed-hold-overlay.json`。
未 commit、push、上传商店或公开发布。

## 原 Chrome 首轮真实采样

视频时长 335.201 秒，只有一条 `en` / `asr` 自动字幕轨道。
初始轨道地址未含原生 CC 的动态请求参数；未导入字幕或使用字幕下载器。

- CC 初始为开启状态。开始后记录到两次非人工 CC 按钮事件：先关闭、再开启；
  随后同视频/语言/kind 的原生字幕请求返回 10,307 编码字节，
  请求携带动态参数，单次资源耗时约 273 ms。
- 原 Chrome 中出现真实英文原文和中文译文，Windows LAN TTS 音频解码并推进。
  观测只读取公开 DOM、媒体状态和资源参数名；没有注入引擎内部会话。
- 6304 个样本，观测墙钟 631.917 秒。媒体从 0 播到 335.201 秒，
  中间执行一次实际媒体 seek：97.909 → 120 秒。
  本轮包括准备、人工暂停、错误等待和结束后的 idle，不代表连续播放 631 秒。
- 暂停期间媒体位置保持约 52.792 秒；继续后恢复。结束时原视频 `ended=true`，
  译文/原文清空，配音 audio 无 `src`、暂停、无解码错误。

首轮也是负面证据：HTTP 502 后媒体从 160.596 前进到 210.685 秒；
翻译结构/ID 错误后从 239.482 前进到 306.889 秒。
这两段错误期间视频继续前进，不能记为“失败位置重试通过”。
该发现促成最终 `youtube-hold` 修复；首轮数据明确标注为修复前的部分验收。
整片无跳转、无错误连续配音尚未验收。

首轮证据：

- `linux-youtube-dom-qa.json`：公开 DOM/媒体采样、少量字幕示例；不含签名 URL。
- `linux-youtube-acceptance.json`：汇总，明确标注旧错误分支缺陷。
- `linux-youtube-state-segments.json`：状态分段。
- `provider-health-after-502.json`：两路 LAN 健康均 200；不能据此归因 502 的具体提供者。

## 最终版本真实回归

重载 `rc-20261113-youtube-hold` 后，从同一视频 150 秒处开始定向回归，
再次使用真实英文自动字幕、Windows LAN 翻译/TTS，没有伪造平台或服务响应。

- 4630 个样本，观测墙钟 463.623 秒；这包括准备、错误等待和停止后的 idle。
- 初始 CC 仍为开启；自动关闭/开启一次后取得同一条真实轨道，
  原生字幕请求约 199 ms、10,307 编码字节。
- 模型再次返回翻译结构/字幕 ID 不完整。这次视频与音频持续暂停，
  从错误首样本到重试前末样本共 176.886 秒，媒体始终为 **178.8 秒**，
  采样漂移为 **0 秒**。
- 原生“继续播放”点击后，首次再次进入配音中仍是 **178.8 秒**，
  未跳过失败位置。点击到该状态约 2.448 秒（100 ms 采样粒度），
  仅为本次显式重试，不代替全部批次时延。
- 后续真实双语与译音继续推进；在播放器点击停止后，
  浮层回到未启动，双语文本清空，audio 无 `src`、暂停、无解码错误，
  原声音量恢复为 1、未静音、倍速为 1。随后手动暂停原视频完成测试。

最终证据为 `linux-youtube-hold-dom-qa.json`、
`linux-youtube-hold-acceptance.json`，汇总中的
`errorPositionHoldVerified=true`。该真实回归与 T1/T4 的失败→修复测试相互印证。
观测器与 DevTools 均已关闭，Playwright 自有会话已 detach；
用户浏览器、标签、登录和服务继续保留。

## 局域网与剩余限制

翻译：`http://192.168.31.163:8765/v1/`，模型 `local-translator`。
语音：`http://192.168.31.163:8766/v1/`，模型 `windows-sapi`，声音 `huihui`。
接口直接走局域网 IP，没有 SSH 接口隧道。

远程 Windows Codex host 本轮不可用，未取得与本轮浏览器请求逐项关联的服务端日志。
因此不推断 HTTP 502 的具体来源、模型取消耗时或完整浏览器批次时延。
模型仍可能返回缺失字幕 ID 或非法结构；插件拒绝该批并保留显式重试，
不会自动重复付费调用，也不会用不匹配字幕继续配音。

人工听感、精确漂移与资源趋势、三小时连续播放、真实分 P 和旧任务的在途取消
服务端关联继续单列，不能由本次 YouTube 或自动化 fixture 结果代替。
浏览器连接使用 Playwright CLI extension；其跨命令页句柄丢失后已检查会话与标签，
原生界面按 CUA 路线操作原 Chrome，未切换内置浏览器或用户 profile。
结束只 detach 自有 Playwright 会话，保留用户 Chrome、其他标签和登录。
