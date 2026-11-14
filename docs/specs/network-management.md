# 网络管理：WebRTC Control 迁移与 Clash 合并规格

日期：2026-11-14。状态：已实现，Chromium 和 Firefox 定向验收通过。

## 目标与来源

在 OneWeb 同一个“网络管理”模块内管理浏览器 WebRTC 隐私及既有 Clash 连接、状态和节点选择。
SDD 指 Specification-Driven Development：本规格、参考审计、架构决策与验收证据先于实现；
实现按用户行为逐条执行失败测试 → 最小实现 → 测试通过。

参考为本机 WebRTC Control 0.3.5，扩展 ID `fjkmabmdepjfammlpliljpnbhleegehm`。
读取安装包中的 manifest、配置、后台、选项页与三个页面脚本来识别行为，独立实现，
不复制品牌、图标、推广页面或来源代码，不读取或迁移用户个人设置。

目标仓库为 `/home/juck/Projects/one-web`。保留当前未提交工作。
功能直接依赖浏览器 privacy API 及页面主世界，因此由打包内置模块承载，远程模块不获得新能力。
保留 `dev.oneweb.clash-control` / `clash-control` 身份以延续已安装记录，展示名称统一为“网络管理”。
既有 Clash 的 secret、精确 loopback origin、审查后单次节点切换和隔离约束继续适用。

## 用户行为与验收

| 编号  | 行为                          | 可观察结果                                                                                                                                                                     |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NM-01 | 从工具或设置打开网络管理      | 一个模块内同时看到 WebRTC 防护和 Clash；不存在两个独立开关模块                                                                                                                 |
| NM-02 | 首次启用 WebRTC 防护          | 用户点击后申请可选 privacy 权限；拒绝不生效、不显示成功；默认不自动改变浏览器设置                                                                                              |
| NM-03 | 选择 IP 处理策略              | 支持 default、default_public_and_private_interfaces、default_public_interface_only、disable_non_proxied_udp 四个原生值；default 释放覆盖并关闭总保护；显示浏览器实际值与控制权 |
| NM-04 | 开启/关闭 WebRTC 防护         | 开启应用所选策略；关闭清除本扩展的 privacy 覆盖，恢复浏览器/其他管理方的设置；界面区分所选策略和实际控制状态                                                                   |
| NM-05 | 隐藏 WebRTC 支持检测          | 阻止页面访问 RTCPeerConnection、MediaStreamTrack、RTCSessionDescription 及旧前缀别名、旧 getUserMedia；默认勾选但首次仍需明确应用                                              |
| NM-06 | 阻止媒体设备                  | 独立选项，默认关闭；新页面中阻止 navigator.mediaDevices 访问；界面说明会影响摄像头、麦克风及网页通话                                                                           |
| NM-07 | 阻止额外 RTC 对象             | 独立选项，默认关闭；新页面中隐藏 RTCIceCandidate、RTCDataChannel、RTCConfiguration                                                                                             |
| NM-08 | 应用页面选项                  | 有页面选项才申请 HTTP/HTTPS 全站权限；注册 MAIN world、document_start、all_frames 脚本，适用于新文档；已打开页面需刷新，关闭也需刷新恢复                                       |
| NM-09 | 浏览器设置由其他扩展/策略控制 | 显示实际控制冲突，不把选项存储成功当成防护生效；不自动接管或反复重试                                                                                                           |
| NM-10 | 停用模块、撤权、后台重启      | 停用/privacy 撤权取消页面注册并清除自己的覆盖；持久化不含 secret 的 WebRTC 选项，重启仅恢复仍启用且仍获权的防护；Clash 不自动连接                                              |
| NM-11 | 打开 WebRTC 泄漏检测          | 仅明确点击打开固定外部检测页面；说明是外部站点，不自动发送诊断、IP 或当前页面数据                                                                                              |
| NM-12 | 保留 Clash 任务               | 原有准备连接、精确授权、手动状态刷新、审查节点切换、断开及错误流程仍可在同一模块完成                                                                                           |

WebRTC API 隐藏会影响网页音视频与 P2P；IP policy 本身不等于禁用全部 WebRTC。
不声称本模块证明系统代理生效或完全无 IP 泄漏。
Firefox 160 使用原生 `regular` 范围支持相同的四种策略和三组页面选项。
Firefox 的 WebRTC IP 策略同时作用于普通及隐私窗口，应用前在策略和按钮处提供可访问的范围说明；
页面屏蔽只在扩展获准运行的窗口生效，不自动授予隐私窗口访问权。
不加入代理自动切换、Clash 新写操作、DNS 改写、遥测、自动打开测试或推广/捐赠页面。

## 权限、数据与实现接口

Manifest 只新增可选 `privacy`，复用可选 HTTP/HTTPS host 权限及 scripting。
Chromium 使用 `regular_only` scope；Firefox 的专用系统适配器映射为其原生 `regular`，
界面说明隐私窗口影响。两者均不擅自开启扩展隐私窗口访问。
页面脚本只修改固定 RTC 属性，不读取页面内容、无外网请求、不暴露 runtime 桥。
设置使用独立版本化 local key；存储所选策略、三个开关和防护启用意图。
后台公开固定 `status` / `apply` / `disable` 操作，不允许 caller 指定浏览器方法、脚本、URL 或属性名。
消息只接受受信任打包管理页；非法、远程、网页消息无写入。
异步写入串行化，停用/撤权使尚未完成的应用失效；失败返回稳定错误并核验实际浏览器状态。

实现集中在 `src/modules/builtin/network-management/` 与独立 sidebar 视图。
保留 Clash 内部协议和生命周期，将新的 WebRTC 控制器接到同一记录的启停钩子。
共享 host 权限不因关闭此功能而删除；只注销本功能自己命名的脚本并 clear 自己的 privacy 值。

## 用户已确认的公开测试接口

| 接口                                                                    | 证明什么                                                                                             | 单独不能证明什么                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| T1：网络管理 controller + 受信任 runtime client 的 status/apply/disable | 四种策略、三组选项、权限/控制冲突、持久化、停用/撤权/重启和非法消息拒绝；只替换浏览器 API 等系统边界 | 真实 Chrome 对 privacy 和注入的执行语义    |
| T2：网络管理的公开 DOM 用户动作                                         | 授权、应用、真实状态/失败反馈、刷新提示、与 Clash 同卡片及原有节点审查流程                           | 真实页面主世界属性是否改变                 |
| T3：隔离测试 profile 内的真实扩展及合成 HTTP(S) 页面                    | privacy 实际值、启动前脚本、iframe、关闭后刷新恢复、权限撤销、重启和 Clash 回归                      | 用户所有网站兼容性及真实公网是否完全无泄漏 |

用户于本次会话明确确认以上三个接口。每个切片先保存真实 red/green 证据。
最终运行相关测试、全量 unit、typecheck、lint、生产构建和相应 Chromium E2E；Firefox 能力与限制单独记录。

## 实施结果

T1 后台 24 项、T2 界面 12 项、Firefox 适配器 6 项合计 42/42 通过；
T3 Chromium 网络管理 5/5 通过。Firefox 160 定向门禁通过真实四策略读回、普通/隐私范围、
三组独立选项、首脚本及 HTTP/srcdoc iframe、关闭恢复、重载、撤权、统一停用、模块隔离，
以及带认证的 Clash 准备/连接/刷新/断开流程，取代前期的“不支持”诊断场景。
类型检查、生产构建、预发布身份检查及本次涉及文件的 lint 通过。
全仓门禁中独立于本功能的既有失败与精确命令见
[实施检查点](../checkpoints/network-management-implementation.md)，
不以相关测试通过替代全仓通过。
