# Video Dubbing 候选版本与发布准备检查点

日期：2026-11-12。状态：**固定候选全套自动化门禁通过，本地安装包与材料已完成；真实云端与人工验收仍有外部依赖**。

用户要求 RC-01～RC-05 全部推进，规格见
[候选版本验收](../specs/video-dubbing.md#候选版本验收与本地发布准备2026-11-12)。

| 任务                           | 当前状态                                    | 实际结果 / 剩余依赖                                                                                            |
| ------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| RC-01 真实云服务               | 外部依赖；未执行收费调用                    | 未找到可访问的 OneWeb 配音服务配置；需要已授权地址、key、模型、voice、额度；latency、usage、账单及音质尚无结论 |
| RC-02 Bilibili 登录字幕        | 实页字幕与分 P 元数据通过；真实云配音待配置 | 实际生产适配器发现 12 轨、下载解析 50 条英文字幕；真实分 P 的 CID 不同；会话清理另由生产扩展 fixture 验证      |
| RC-03 同版本全回归             | 完成                                        | 固定 358 个源码输入；805 unit、Chromium 50/50（retries=0）、Firefox 4/4；双浏览器产物及 SDK 哈希固定           |
| RC-04 操作/故障/长时间/Firefox | 自动化完成；人工项目待签收                  | 429、解码/后发音频错误重试、停止取消、实际 60 秒超时、三小时时间轴、Firefox 音频；人耳与连续三小时未验收       |
| RC-05 本地安装包与材料         | 完成                                        | ZIP / 未签名 XPI 与固定产物逐字节一致；完整性、权限、身份和内容检查通过；安装/隐私材料已写入                   |

## 固定候选

- 候选：`one-web-0.1.0-video-dubbing-rc.20261112`；manifest 数字版本 `0.1.0`。
- 分支 `codex/phase-9a-openlist-contract`，HEAD
  `ef29526f8b6733c7eec53876d600364e48086eaa`。包含保留的未提交工作树，不能只用 HEAD 复原。
- 358 个源码输入清单 SHA-256：
  `2bc40853f801b1965bb6f4dc6d94c173d4999d787109c282d20a9e8b165089d7`。
- 清单包含 src、scripts、E2E/素材、SDK 源码配置、静态资源、构建/测试配置和 workflows；
  排除生成目录与文档。逐文件清单 `source.sha256`，归档 `source-inputs.tar.gz`。
- 本轮证据：`artifacts/video-dubbing/rc-20261112/`。固定 `chromium/`、`firefox/`、
  `sdk/` 与各自哈希清单，不依赖随后可变的根 `extension/`。

## 真实 Bilibili 与外部依赖

复用既有 Chrome 157 的 Playwright CLI extension 会话，没有读取/导出网站 cookie。
OneWeb 的 `bilibili.ts` 本地打包后直接在实页执行，使用实际投影、发现与字幕解析函数。

- `BV1GJ411x7h7` / P1 / CID `137649199`：登录态有效，12 轨，
  `need_login_subtitle=false`。选择 `en-US`，CDN `aisubtitle.hdslb.com`，
  实际解析 50 条，范围 18,788～196,076 ms。
- 本次元数据发现约 75 ms、下载与解析约 60 ms，是单次客户端观察，
  不代表翻译/TTS 延迟或平台 SLA。
- 规范字幕内容只在页面内存中参与 SHA-256：
  `9df2ecf4141bd36d5af7f4b8a7be43f0d5818651092e190b53de20f02dc7d9d8`。
  未保存正文、歌词、签名 URL 或账号数据。
- `BV1bK411W797` 共 23 P：实页 P1 CID `191557669`、P2 CID `191559297`；
  各自投影与固定接口请求匹配，两个 P 均无轨道。
- 生产扩展 fixture 另验证 Bilibili 平台字幕、暂停、seek、全屏、切 P、重读、
  旧导入失效及 API/CDN 撤权。实页元数据检查不能替代完整安装扩展后的真实云配音。

未找到可访问的 OneWeb 已配置服务。`chrome://extensions` 自动化导航断开 relay，
普通页面连接正常；原生窗口接口返回空列表，当前进程无显示会话。
未改查其他扩展或其他 profile 的密钥。完整实测需要在用户 Chrome 加载此候选，
在 OneWeb 配置已授权的翻译/TTS 地址、key、模型、声音与额度。
未知费用不当作零费用；本轮没有真实收费请求。

已关闭自己开的 Bilibili 页、detach `oneweb-release-live`、结束 `oneweb-release-ui`，
保留用户其他标签页、Chrome 及登录态。

## TDD、故障与长时间验证

沿用用户已确认的 T1～T4。实际发现：`audio.play()` 已成功后发生异步音频错误，
原会话会在 cue 末端停留在 buffering。T1 新测试先得到
**expected error / received buffering**，再增加公开媒体错误状态读取与会话处理，
同一测试通过。T4 用真实 audio 元素加载失败验证接线与显式重试，未 mock 播放。

新增生产包验证：

- HTTP 429 只发送一次失败翻译，无自动付费重试；显式重试恢复。
- 音频真实解码失败丢弃对应语音；重试复用翻译，只重做失败语音。
- 停止取消：服务端观察到待响应翻译被中断，迟到响应不启动语音或恢复播放器。
- 实际 60 秒 HTTP 超时：中断请求，不自动重试、不合成语音。
- 三小时 T1 加速时间轴：180 cue，按 4 MiB/clip 验证窗口预算释放，
  五次前后跳转保持正确 cue/offset；这是预算逻辑测试，不是实际进程内存上限测量。
- 三小时自制 WebM：12 次跳转至 0、1 h、2 h、2 h 59 min 附近，原生媒体时间推进；
  四条字幕各翻译/合成一次，重复跳转复用缓存；停用后无残留 audio 元素。
  固定候选的 JSON reporter 补测保存 12 个 renderer heap 读数，范围
  5,746,815～12,586,657 bytes，不据此声称无泄漏或所有浏览器峰值上限。

长素材最初过稀，测试还误套用了 YouTube 自适应源切换行为；
素材/脚本失败日志保留在 `preflight/`，没有将它们写成生产缺陷。
最终自制素材每秒一帧、每十秒一个关键帧，服务支持 Range；
等待公开 generation 更新与原生 seek 完成后再断言，避免读取上次状态。
来源和生成命令见 `e2e/assets/README.md`。

Firefox 门禁修正 Workspace 迁移后的入口与异步渲染等待；
基线在预期导航完成后捕获，仍比较所有无关权限、Registry 和存储，没有放宽隔离断言。
新增配音门禁使用独立临时 profile、精确本机源授权、真实 WebDriver 点击、自制 WAV，
验证原生解码/时间推进、pause/resume、seek/rate、音量、停止/撤权和后续零请求。
固定候选实际观察到翻译 2 次、语音 2 次，四项宿主/配音门禁全部通过。

本机进程未继承桌面音频环境，首次错误日志保留。
复测连接临时独立 PipeWire/PulseAudio 静音输出，结束后移除，没有改默认设备。
CI 已增加同类准备步骤，但未执行远程 CI。
自动化媒体管线通过不能证明人耳听感、物理扬声器输出、真实供应商音质或三小时连续播放。

## 最终门禁

| 检查                    | 当前候选结果                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| 全仓 typecheck / lint   | 通过                                                                 |
| `pnpm test:coverage`    | 105 files / 805 tests 通过                                           |
| 全仓覆盖率              | statements/lines 81.74%，branches 77.02%，functions 88.74%；门槛通过 |
| Chromium 构建、身份扫描 | 通过                                                                 |
| 全套 Chromium E2E       | 50/50 通过；固定扩展 + SDK，retries=0，耗时约 4.2 min                |
| Firefox 构建、身份扫描  | 通过                                                                 |
| Firefox manifest        | 0 errors / 0 notices / 0 warnings                                    |
| Firefox 四项真实门禁    | 4/4 通过，含真实原生音频                                             |
| 源码哈希复核            | 构建、全回归与收尾均未改变                                           |
| ZIP / XPI               | 各 14 files，与验收产物逐字节一致；完整性、版本、权限及内容检查通过  |

三小时时间轴在同一源码和同一固定 Chromium/SDK 上追加一次 1/1 通过的补测，
专门用 JSON reporter 保存成功附件；未修改源码。输出为
`checks/chromium-long-measurement-report.json`、`checks/three-hour-seek-metrics.json`，
不能把这一次补测当成另一轮全仓回归。

## 本地包与复现

候选目录 `packages/`：

| 包                                                             | 大小          | SHA-256                                                            |
| -------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| `one-web-0.1.0-video-dubbing-rc.20261112-chromium.zip`         | 264,141 bytes | `10e8ccb9650a2ea24dceac4fd3ea05be4c69b7c3e9675267f7459f531c7e2a92` |
| `one-web-0.1.0-video-dubbing-rc.20261112-firefox-unsigned.xpi` | 263,942 bytes | `d2f24fd879ab9a39447265464f334a864425d5a04648063d85124d11cf13d010` |

包使用 `web-ext build` 从各自经过测试的固定目录生成，逐文件比对、ZIP CRC、
manifest 根路径、身份、权限、媒体入口、生产 CSP、开发/密钥标记检查通过。
没有签名；Chromium ZIP 用解压加载，Firefox XPI 用临时/开发安装。
详见 [安装、平台范围、权限及依赖](../releases/video-dubbing-rc-20261112.md)。
`SHA256SUMS` 同时列出源码归档、输入清单、双浏览器和 SDK 的树清单及包。

主要命令：

```sh
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm build
# 将 extension 和 SDK dist 固定到候选 chromium/、sdk/ 后：
EXTENSION_PATH="$PWD/artifacts/video-dubbing/rc-20261112/chromium" \
MODULE_SDK_DIST_PATH="$PWD/artifacts/video-dubbing/rc-20261112/sdk" \
pnpm exec playwright test --retries=0 \
  --output=artifacts/video-dubbing/rc-20261112/chromium-e2e
pnpm build:firefox
pnpm verify:identity
pnpm manifest:validate
# 将 Firefox 产物固定，并准备本机临时静音输出后：
EXTENSION_PATH="$PWD/artifacts/video-dubbing/rc-20261112/firefox" \
pnpm test:e2e:firefox
python3 artifacts/video-dubbing/rc-20261112/capture-source.py verify
```

Linux Firefox 音频门禁需有效音频服务环境；本机实际使用
`XDG_RUNTIME_DIR`、`PULSE_SERVER` 和专用 `PULSE_SINK`，结束后移除专用 sink。
这只是隔离测试环境设置，不改变产品媒体实现。CI 的准备命令见 workflow。

历史 779/803 unit、38/44 E2E 是其他快照；本表使用整合候选。
805 项包含 Assistant/Workspace 等现有功能，不能全算作配音新增。
命令输出、红绿日志、平台统计和依赖见候选目录 `checks/`、`preflight/`。
保留全部未提交改动，没有改动历史项目、RepoLens 后端或 SDK 源码，没有提交或发布。
