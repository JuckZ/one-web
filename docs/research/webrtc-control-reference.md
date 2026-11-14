# WebRTC Control 源码调研与迁移参考

调研日期：2026-11-14。

## 来源与范围

参考扩展为 **WebRTC Control 0.3.5**，Chrome 扩展 ID 为 `fjkmabmdepjfammlpliljpnbhleegehm`，采用 Manifest V3。

- 用户提供的管理页：`chrome://extensions/?id=fjkmabmdepjfammlpliljpnbhleegehm`。
- 本机已安装源码：`/home/juck/.config/google-chrome/Default/Extensions/fjkmabmdepjfammlpliljpnbhleegehm/0.3.5_0`。
- manifest 声明的官网：<https://mybrowseraddon.com/webrtc-control.html>。
- 泄漏检测入口：<https://webbrowsertools.com/test-webrtc-leak/>。
- 调研仅阅读安装包代码，未读取用户配置、个人存储或凭据。

该扩展提供浏览器 WebRTC 暴露控制，没有 Clash 控制、代理规则、订阅、流量日志或通用网络拦截能力。迁移目标是在 OneWeb 的网络管理入口中，与已有 Clash 能力并列承载 WebRTC 保护。

## 浏览器场景与承载边界

使用场景是用户通过 Clash 访问网页时，在同一面板查看连接状态、选择代理节点，并控制网页 WebRTC 所暴露的网络和媒体能力。WebRTC IP 策略依赖 `chrome.privacy`，页面对象屏蔽依赖页面主执行环境；二者均由浏览器插件承载具有明确收益。

OneWeb 负责浏览器端控制、状态反馈和诊断入口。Clash/Mihomo 核心继续负责实际代理与规则执行。WebRTC 保护不代替 Clash，也不把本地代理运行状态当作 WebRTC 保护已生效的证据。

## 源码结构与证据

| 文件                                                     | 职责与关键位置                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest.json`                                          | `privacy`、`storage`、`contextMenus` 权限；内容脚本覆盖 `*://*/*`，`all_frames: true`，`document_start`；声明页面脚本为 web accessible resources |
| `background.js`                                          | 依次载入 config、Chrome adapter、runtime、common                                                                                                 |
| `lib/config.js:12`                                       | 持久化字段与默认值                                                                                                                               |
| `lib/common.js:24`                                       | 工具栏点击切换保护，策略为 `default` 时强制关闭                                                                                                  |
| `lib/common.js:41`                                       | 更新 action 图标、标题和浏览器 IP 策略                                                                                                           |
| `lib/common.js:71`                                       | 选择 `default` 关闭保护，选择其他策略启用保护                                                                                                    |
| `lib/chrome.js`                                          | Chrome API adapter、local storage 缓存与消息分发                                                                                                 |
| `data/content_script/inject.js:32`                       | 仅在保护开启时，按三个布尔偏好向页面插入脚本                                                                                                     |
| `data/content_script/page_context/support_detection.js`  | 覆盖 WebRTC 支持检测相关对象                                                                                                                     |
| `data/content_script/page_context/media_devices.js`      | 覆盖 `navigator.mediaDevices`                                                                                                                    |
| `data/content_script/page_context/additional_objects.js` | 覆盖额外 RTC 对象                                                                                                                                |
| `data/options/options.html`、`options.js`                | 三个复选框、四项 IP 策略、检测与支持按钮                                                                                                         |
| `lib/runtime.js`                                         | 通用消息路由，以及欢迎页、支持、卸载 URL 行为                                                                                                    |

## 功能映射

| 参考功能           | 原扩展行为                                                                                                                       | OneWeb 迁移要求                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 保护总开关         | action 点击切换 `enabled/disabled`；关闭后将 IP policy 设置成 `default`                                                          | 在网络管理面板提供 WebRTC 总开关，区分用户偏好与浏览器实际生效状态       |
| IP handling policy | 四个枚举：`default`、`default_public_and_private_interfaces`、`default_public_interface_only`、`disable_non_proxied_udp`         | 保留四个可选策略，显示实际策略和控制冲突；释放控制时使用浏览器的清除接口 |
| 阻止支持检测       | 将 `RTCPeerConnection`、`MediaStreamTrack`、`RTCSessionDescription`、`navigator.getUserMedia` 及 moz/webkit 变体置为 `undefined` | 独立高级选项，说明会影响网页通话；在新文档的主执行环境中生效             |
| 阻止媒体设备       | 将实例上的 `navigator.mediaDevices` 覆盖成 `null`，并覆盖原型属性                                                                | 独立高级选项，默认关闭；稳妥处理属性描述符，单项失败不影响其他项         |
| 阻止其他 RTC 对象  | 将 `RTCDataChannel`、`RTCIceCandidate`、`RTCConfiguration` 置为 `undefined`                                                      | 独立高级选项，默认关闭                                                   |
| 泄漏检测           | 选项页按钮及 action 右键菜单打开检测网站                                                                                         | 提供显式网络诊断入口，打开新标签页                                       |
| 状态反馈           | action 图标与 `WebRTC leak protection is ON/OFF` 标题                                                                            | 合并到网络管理面板，不独占 OneWeb 整体 action                            |
| 持久化与恢复       | `chrome.storage.local`；启动/安装时恢复设置                                                                                      | 使用网络管理模块命名空间；恢复时不覆盖已有 Clash 配置                    |

## 默认值与状态语义

以下是参考代码声明的默认值，不是本机用户设置。

```json
{
  "state": "enabled",
  "webrtc": "disable_non_proxied_udp",
  "inject": true,
  "devices": false,
  "additional": false
}
```

- 选择 `default` 会将总保护关闭。
- 选择其余三个 IP 策略会启用总保护。
- 总保护关闭时，三个高级偏好不执行，但偏好值保留。
- 支持检测、媒体设备、额外对象是三个独立类别，不隐含联动。
- 页面对象覆盖不能可靠恢复已运行文档中的原始对象。修改高级设置后，应明确提示刷新页面；以新建/刷新文档作为可观察的生效条件。
- 网络管理模块的启停、WebRTC 保护启停和 Clash 核心运行状态是不同状态，应分别表达。

## 外部接口与原数据流

原选项页发送 `{path: "options-to-background", method, data}`，其中 method 为 `load`、`inject`、`webrtc`、`devices`、`additional`、`test`、`support` 或 `donation`。页面内容脚本发送 `{path: "page-to-background", method: "load"}`；后台按 tab/frame 返回 `{path: "background-to-page", method: "storage", data: {state, inject, devices, additional}}`。

IP 策略通过 `chrome.privacy.network.webRTCIPHandlingPolicy.set/get` 实现。原扩展还尝试写入已废弃的 `webRTCMultipleRoutesEnabled`。迁移不保留这条旧兼容分支，也不复刻原扩展的内部消息协议；OneWeb 应沿用自己的模块与后台消息接口，并验证来源及输入。

## 可观察验收示例

以下示例可作为 SDD 场景及 TDD 的独立预期值；测试应跨越实际公开接口，不依赖脚本内部函数结构。

1. 开启保护并选择 `disable_non_proxied_udp`，读取实际浏览器策略得到该值；关闭保护后释放 OneWeb 的控制，而不继续占用 ChromeSetting。
2. 选择 `default` 后保护关闭；随后选择 `default_public_interface_only`，保护开启并应用该策略。
3. 总保护关闭、三个高级偏好均为 true 时，新文档中的 WebRTC、媒体设备和额外 RTC 对象保持原生行为。
4. 仅启用支持检测屏蔽时，新文档的 `RTCPeerConnection` 为 `undefined`，`navigator.mediaDevices` 与 `RTCIceCandidate` 不受该选项影响。
5. 仅启用媒体设备屏蔽时，新文档无法通过 `navigator.mediaDevices` 使用媒体设备；其余两个类别由各自选项决定。
6. 仅启用额外对象屏蔽时，新文档的 `RTCIceCandidate` 为 `undefined`，`RTCPeerConnection` 保持原生可用。
7. 页面保护覆盖顶层文档与子 frame。修改设置后不声称恢复已有文档的被覆盖对象；刷新后按新设置生效。
8. 浏览器或后台 worker 重启后，恢复模块偏好并重新同步实际策略。
9. 其他扩展或浏览器策略拥有控制权时，面板显示控制冲突，不能把已保存偏好显示成已生效保护。
10. 修改 WebRTC 选项不会改变已有 Clash endpoint、secret、代理组和节点选择。

## 风险与改进

| 原实现问题                                                    | 迁移要求                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 关闭时调用 `.set({value: "default"})`，继续占有 ChromeSetting | 使用 `.clear()` 释放 OneWeb 的控制，并读取实际结果                                                           |
| 不检查 `levelOfControl`，图标开启不代表实际生效               | 向面板返回实际策略、控制权与错误，冲突可见                                                                   |
| 内容脚本与后台异步往返后再插入资源脚本                        | 避免早期页面脚本竞速及页面 CSP 对 DOM 脚本插入的限制；优先按配置注册 `MAIN` world、`document_start` 页面脚本 |
| 对象覆盖不可逆且没有说明刷新要求                              | 明确新文档生效及刷新提示，不承诺原地恢复                                                                     |
| `mediaDevices` 实例与原型处理不一致，部分属性赋值可能抛错     | 按属性描述符稳妥处理，隔离单项异常                                                                           |
| 消息缺少 sender 校验和入参验证                                | 校验模块消息来源、policy 枚举和布尔字段                                                                      |
| storage changed handler 空白，不传播设置变更                  | 明确配置更新与页面生效时机；保持后台状态和面板一致                                                           |
| 内容脚本先发 load 再注册接收器                                | 不沿用这种存在响应竞速的握手                                                                                 |
| 已废弃的 Chrome 48 多路由开关                                 | 不迁移                                                                                                       |

WebRTC 对象屏蔽会影响语音、视频、屏幕共享及部分实时协作页面。高级选项的说明应帮助用户选择，不将 IP policy 控制与禁用整个 WebRTC 能力混为同一个保证。

## 许可与不迁移项

安装包内未发现 LICENSE、作者版权声明或公开源码仓库地址。应按本调研的行为规格独立重写实现，不复制原代码、图标或品牌素材。官网地址可作为来源说明；本次未推断任何未声明的开源许可证。

以下行为不纳入网络管理迁移：

- 安装/升级欢迎页、更新节流字段 `lastupdate`。
- 原品牌支持页、捐赠按钮、卸载 URL 跟踪。
- 复用原扩展内部消息协议、缓存层、图片及整体 action 所有权。
- 已废弃的 `webRTCMultipleRoutesEnabled` 兼容路径。
- 原扩展不存在的 Clash 订阅、代理、流量日志等能力；这些继续由 OneWeb 已有 Clash 模块及代理核心负责。
