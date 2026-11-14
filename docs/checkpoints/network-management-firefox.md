# 网络管理 Firefox 功能验收

日期：2026-11-14。浏览器：Firefox 160.0。状态：实际 WebRTC 防护与 Clash 联合流程通过。

## 原生范围与实现约定

用户明确要求 Firefox 也支持网络管理。Firefox 原生 privacy 实现只接受 `regular`，
因此适配器将模块的固定范围请求转换为 Firefox 的原生 `regular`；Chromium 继续使用
`regular_only`。Firefox 的策略会同时作用于普通窗口和隐私窗口，界面在应用前明确说明；
页面屏蔽只在浏览器允许 OneWeb 运行的窗口生效，不自动开启扩展的隐私窗口访问。

真实原生 `get({incognito:true})` 对三种保护策略均读回同一策略值；不要求它返回
`controlled_by_this_extension`，因为 Firefox 对该查询原生返回 `not_controllable`。
此验证没有打开用户隐私窗口，也没有授予扩展隐私窗口访问。

## 实际 red → green

公开接口沿用用户已经确认的 T3。使用 `scripts/verify-firefox-page-toolbox.ts` 的
web-ext 临时 profile、真实生产 sidebar、RDP 扩展发现及 Marionette WebDriver 点击；
不连接或修改用户现有 Firefox。

第一条纵向切片先改为要求真实应用成功，仍使用之前明确返回不支持的 Firefox 产物：

```sh
FIREFOX_SCENARIO=network pnpm test:e2e:firefox
```

实际 red：

```text
Firefox must apply WebRTC protection; received: 当前浏览器不支持所需的 WebRTC 隐私或页面保护能力。
```

日志：`/tmp/oneweb-firefox-support-e2e-red.log`。

适配器按 Firefox 原生范围实现，并重新构建后，同一 policy-only 切片 green：
验证真实 policy、控制权、公开 `protected:true`，以及关闭后恢复浏览器原值；
只授予 privacy，没有页面 host 权限或脚本注册。
日志：`/tmp/oneweb-firefox-support-e2e-policy-green.log`。

随后逐步增加实际覆盖，每一步先完成上一行为的验证，未一次预写全部场景：

| 切片                    | 原生结果与行为                                                                                                                                 | 日志                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 四种 policy             | 三种保护策略的普通/隐私读回值正确；default 释放本扩展覆盖，公开状态不再宣称保护                                                                | `/tmp/oneweb-firefox-support-e2e-policies.log`；最终补充 private readback |
| 支持检测屏蔽            | nonce/CSP 页面首个解析脚本已观察到 PeerConnection/MediaStreamTrack/SessionDescription 不可用；HTTP 与 srcdoc iframe 同样生效                   | `/tmp/oneweb-firefox-support-e2e-support.log`                             |
| 独立设备与额外 RTC 屏蔽 | devices 保留 PeerConnection/ICE，additional 保留 PeerConnection/media；顶层、HTTP、srcdoc 三个文档均在首段脚本中核验；关闭后新文档恢复原生对象 | `/tmp/oneweb-firefox-support-e2e-independent.log`                         |
| 重载与生命周期          | AddonManager 真实重载后新建管理页与站点文档，防护恢复；撤 privacy 注销脚本并恢复策略；统一模块停用释放覆盖/脚本并保留共享 host 权限            | `/tmp/oneweb-firefox-support-e2e-lifecycle.log`                           |
| Clash 联合流程          | WebRTC 生效期间真实 prepare/connect/refresh/disconnect；认证服务确认固定请求；断开 Clash 后 WebRTC 仍生效，secret 不持久化，其他模块记录不变   | `/tmp/oneweb-firefox-support-e2e-final.log`                               |

页面 fixture 把第一段解析脚本观察到的固定 RTC 状态写入 `data-network`，通过 DOM 读取。
这避免 Marionette 的 Xray 读到浏览器原生对象而掩盖页面 MAIN world 的实际变化。
Fixture 只托管在临时测试用 `http://127.0.0.1`；没有公网诊断请求。

重载时 Firefox 会丢弃扩展自己创建的旧管理标签页。测试先切回普通合成站点，再打开新的
受信任管理页，并等待 shell 初始化后验证恢复；未用已被丢弃的旧上下文假定重载成功。

## 最终结果

最终定向命令：

```sh
FIREFOX_SCENARIO=network pnpm test:e2e:firefox
```

实际退出码 0：

```text
Firefox network: four policies in normal/private readback, three independent MAIN first-script blockers across top/HTTP/srcdoc frames, restart restoration, revocation/module-disable cleanup, peer isolation, authenticated Clash prepare/connect/refresh/disconnect {"version":2,"configs":2,"proxies":1,"unauthorized":0}
Firefox network management targeted gate: 1/1 passed
```

Clash 合成服务只接受带测试凭据的三个固定 GET 端点。没有自动 Clash 请求；手动连接与刷新
合计 `GET /version` 两次、`GET /configs` 两次、`GET /proxies` 一次，未授权请求为零。
WebRTC、Clash 与模块停用过程中其他 module Registry 记录保持完全一致。

可选 privacy 与 HTTP/HTTPS host 权限只在 web-ext 的临时 profile 中预授予，以避免
自动操作原生权限弹窗。直接用户动作、权限拒绝及窗口范围提示由 T2 集成测试验证。

此前完整 Firefox 门禁在既有 Video Dubbing 场景遇到本环境 cubeb 音频后端不可用，
没有运行到网络场景。`FIREFOX_SCENARIO=network` 只选择本次网络流程，默认完整流程仍保留。
本次证明网络管理功能通过，不把既有完整配音/媒体门禁表述为通过。
