# Windows workstation 本地配音验证资源

日期：2026-11-12。状态：**Windows 资源盘点与真实短测完成，44 项证据校验通过；
尚未接入已安装扩展的真实网站链路**。

以下结论记录资源调查时的快照。2026-11-13 的本地服务实现、
授权等待修复与真实 Bilibili 验收进度见
[后续集成检查点](video-dubbing-workstation-integration.md)。

本记录承接用户要求：在 Windows Codex Desktop 的 `one-ComfyUI` 项目中新开对话，
查找已安装工作流与模型，协助 OneWeb 视频配音后续验收。
这里只补充本地资源的验证证据，不改变固定候选 `rc-20261112` 的验收结论。

## 调查位置与证据

- Windows 项目：`C:\Users\ajuck\Projects\one-ComfyUI`。
- 新对话：**盘点并验证 OneWeb 本地配音资源**。
- 对话 ID：`01a1d04a-7afa-76d0-947a-c6d381a562a6`。
- 执行主机：`remote-control:env_e_6a2604f42cfc8328823eeb30d5c2b527`（workstation）。
- 远程产物目录：
  `C:\Users\ajuck\Projects\one-ComfyUI\labs\oneweb-dubbing-validation-20261112\`。
- 此记录依据远程对话的实际命令结果与已完成的最终报告。
  原始报告、清单和精选样音已随 2026-11-13 的最终脱敏包回传；
  [本机报告副本](../../artifacts/video-dubbing/workstation-20261113/permission-wait-final/labs/oneweb-dubbing-validation-20261112/REPORT.zh-CN.md)
  与 [inventory.json](../../artifacts/video-dubbing/workstation-20261113/permission-wait-final/labs/oneweb-dubbing-validation-20261112/inventory.json)
  可直接读取。文中的 Windows 绝对路径仍指来源主机，不是 Linux 路径。

通过已打开的 WORKSTATION 远程桌面，在 Windows Codex Desktop 的项目入口新建对话；
已核对新对话 cwd，而非在 Linux 同名目录中执行。调查使用原有工作目录，
不创建 worktree，不提交或推送现有工作。

最终盘点包含 **79 个模型相关文件、623 个工作流 JSON 路径**。
工作流统计包含重复副本和 Note 证据，不能解释为 623 项可直接运行的能力。
本轮没有下载模型、安装依赖或留下常驻服务。

远程目录内主要交付物：

| 文件或目录                                                                                                      | 内容                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `SPEC.zh-CN.md`                                                                                                 | 盘点与短测的范围、约束及验收规格           |
| `REPORT.zh-CN.md`                                                                                               | 中文调查报告、资源路径和协议判断           |
| `inventory.json`                                                                                                | 机器可读模型、工作流与运行资源清单         |
| `results.json`                                                                                                  | 汇总试验数据                               |
| `tts-results.json`、`sapi-results.json`、`asr-results.json`、`whisper-results.json`、`translation-results.json` | 各项真实调用结果                           |
| `audio/`、`whisper/`                                                                                            | 本轮短样音、ASR 字幕和时间戳               |
| `README.md`、`REPRODUCE.ps1`                                                                                    | 复现与证据复核入口                         |
| `verification.json`、`artifact-manifest.json`                                                                   | 44 项证据校验结果、文件大小与 SHA-256 清单 |

## 已核实的能力

| 资源                       | 本轮证据                                                                                | 对插件验证的用途                               | 当前限制                                            |
| -------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| Qwen3.5-4B 翻译            | 真实 HTTP 调用四次，每次三条字幕；1.29–1.49 秒；返回符合要求的 JSON 字符串和唯一 cue ID | 验证真实本地翻译与插件翻译协议                 | 临时服务已退出；尚未从已安装扩展调用                |
| Qwen3-TTS 0.6B CustomVoice | 中文 Vivian、英文 Ryan 均完成首次和热调用；单句约 23.7–26.0 秒                          | 生成真实神经语音样本，辅助解码、同步与内容验证 | 使用已安装 CPU 运行时；缺少插件兼容的语音 HTTP 路由 |
| Qwen3-ASR 0.6B             | 回读两段本轮生成的中英文 TTS，忽略标点后的字符／词编辑距离均为 0                        | 辅助检查音频内容是否完整、是否使用正确文本     | 不是人工听感验收，也没有据此证明字幕时间对齐        |
| Windows SAPI               | 中英文首次合成 0.19–0.52 秒，热调用约 0.02 秒；生成真实 WAV                             | 优先用于接口联调的离线音源                     | 尚需语音 HTTP 适配层；没有浏览器全链路验证          |
| Whisper.cpp Q5             | 两段 SAPI 样音实际回读成功，保存 SRT/VTT 和分段时间戳；含加载耗时分别 18.47、21.11 秒   | 辅助 ASR 交叉检查和时间戳验证                  | 尚未验证真实平台整段字幕对齐                        |
| ComfyUI 工作流与节点       | 未发现运行中的 ComfyUI/语音服务；主 ComfyUI 未安装 TTS/ASR 自定义节点                   | 可复用既有外部运行环境                         | 不能声称已有即用型 ComfyUI 配音工作流               |

首次中文 Qwen TTS 的实测样本为 24 kHz、PCM_16 WAV，时长 5.12 秒，
245,804 bytes，推理 26.04 秒。这是短句单次观测，不代表任意字幕的吞吐或上限。
Qwen ASR 的两段回读结果仅支持有限样本的内容一致性检查。

已核对的本地模型与运行时路径：

- Qwen TTS 模型：`D:\AI-Models\audio\qwen3-tts-0.6b-customvoice\`；
  运行时：`D:\AI-Runtimes\venvs\qwen-tts\Scripts\python.exe`。
- Qwen ASR 模型：`D:\AI-Models\audio\qwen3-asr-0.6b\`；
  运行时：`D:\AI-Runtimes\venvs\qwen-asr\Scripts\python.exe`。
- 翻译服务运行时：
  `D:\Qwen3.8-Flash-Next\llama.cpp-b10909-rocm\llama-server.exe`。
  可执行文件所在目录的名称不能用于判断本轮加载的模型；
  本轮实际测试模型为 Qwen3.5-4B，完整模型文件位置见远程清单和中文报告。
- 翻译/音频检测复用的已有 Python 环境：
  `C:\Users\ajuck\Projects\voice-pro\installer_files\local-env\Scripts\python.exe`。

音频检测覆盖八段真实 WAV，均可解码、非静音，未检出满幅采样点；
四段转码 MP3 均小于 100 KB。文件检测没有覆盖主观自然度、物理音频输出，
也不能单独证明所有情况下没有听感失真。

## 与 OneWeb 的协议约束

实际依据：

- [provider.ts](../../src/modules/builtin/video-dubbing/provider.ts)。
- [config.ts](../../src/modules/builtin/video-dubbing/config.ts)。

翻译和语音各自配置 `baseUrl`、`key`、`model`，语音另有 `voice`。
base URL 规范化为末尾 `/` 后，分别请求相对路径：

| 能力 | 请求                                                                                                        | 必须满足的响应                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 翻译 | `POST chat/completions`，`response_format: {"type":"json_object"}`，用户消息内为 `{"cues":[{"id","text"}]}` | `choices[0].message.content` 是 JSON 字符串，内含 `cues`；每个输入 ID 恰好一次，包含非空 `translatedText` |
| 语音 | `POST audio/speech`，`{"model","voice","input","response_format":"mp3","speed":1}`                          | 二进制音频，非 JSON 文件地址；支持的音频 MIME，非空且每条不超过 4 MiB                                     |

当前配置只允许 HTTPS，或主机名为 `localhost` / `127.0.0.1` 的 HTTP。
不能直接填写 Windows 私网 IP 的裸 HTTP，也不能把两台机器的
`127.0.0.1` 视为同一台主机。跨设备访问需另行核实已有可信连接或本地端口转发条件，
不开放公网、不改防火墙。

翻译服务实测兼容所需的输出形状；同一个 llama-server 的
`/v1/audio/speech` 实测为 HTTP 404。语音需要薄适配层，或另一个已兼容的服务。
ComfyUI 工作流排队与文件结果接口本身不等同于上述协议。

## 延迟预算与后续规格

`DubbingProvider.prepare()` 每批最多三条字幕。翻译与逐条串行 TTS
共享同一个 60 秒 AbortSignal；该预算包含等待所有响应的时间。
以本次 Qwen CPU 单句合成范围估算，三条类似短句仅合成就约需 71–78 秒，
尚未加入翻译与启动开销。这是由单句数据推算的风险，不是实测三条批次结果。

因此，后续优先以 **Qwen3.5-4B 翻译 + SAPI 语音适配层**完成真实接口联调，
以 Qwen TTS、Qwen ASR 和 Whisper 补充神经语音样本、内容及时间戳检查。
当前证据不足以认定神经 TTS 满足固定候选的交互延迟。后续需要在规格中分别定义：

1. 固定候选的接口与生命周期验收：真实翻译、真实音频、正确 cue、播放控制和清理。
2. 神经语音的质量与吞吐验证：冷启动、模型常驻、逐句时延与完整三条批次。
3. 浏览器完整链路：安装固定 Chromium 产物，读取真实 Bilibili 字幕，
   使用显式授权的本地配置并取得可观察结果。

若实施适配层，先补规格与失败测试，覆盖固定请求/响应、合法 MIME、大小限制、
超时、取消、串行/并发与停止后无迟到音频，再做最小实现。
新增服务属于外部能力，插件继续负责页面字幕、播放与就地交互。

## 不变的验收缺口

本地模型推理不能替代以下验收：

- 已安装扩展到真实 Bilibili 字幕、真实翻译/TTS 的完整浏览器链路。
- 人工听感、物理扬声器输出、原生权限弹窗和连续三小时播放。
- 真实云端供应商的 usage、计费、延迟和音质。

固定候选与原验收证据见
[候选版本检查点](video-dubbing-release-validation.md)。
本轮没有修改生产代码、重新构建候选或将模型试运行计作浏览器 E2E。
