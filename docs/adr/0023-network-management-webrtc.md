# ADR-0023：WebRTC 防护与 Clash 组成网络管理

- 日期：2026-11-14
- 状态：已实现，Chromium 和 Firefox 定向验收通过

## 问题

WebRTC Control 提供浏览器 IP policy 与页面 WebRTC 对象屏蔽，Clash Control 提供本地
controller 的连接、状态及审查后节点切换。用户需要在一个网络管理入口完成这两种浏览器任务。

## 决策

保留已安装的 `dev.oneweb.clash-control` / `clash-control` 身份，更新 seed 展示元数据为
“网络管理”；复用 Registry 现有 seed 更新语义，不添加数据迁移框架。
新的独立 WebRTC 控制器和视图与原 Clash 控制器组合，Clash 协议、secret 和写权限保持原有约束。

WebRTC 采用固定 status/apply/disable runtime 接口，仅受信任打包页可调用。
`privacy` 为可选权限，在直接用户动作中申请。页面屏蔽另需明确 HTTP/HTTPS 全站权限。
首次安装不自动申请或覆盖隐私设置；首次启用也不因启动 Clash 自动开启 WebRTC 防护。

只操作 `webRTCIPHandlingPolicy`，Chromium 使用 `regular_only` scope；关闭时
调用 clear 释放自己的覆盖。读回 policy 与 levelOfControl，不能用意图或相同值冒充控制成功。
其他扩展、企业策略或不支持的浏览器能力产生可见诊断。

用户明确要求 Firefox 同样支持。Firefox 160 的实现只接受 `regular` scope，因此在有限的
Firefox 系统适配器内将控制器操作映射为该原生范围。其 IP 策略也适用于隐私窗口，界面在
应用前显示范围说明并关联至策略选择和应用按钮。页面屏蔽仍受浏览器的扩展隐私窗口许可约束，
不自动启用隐私窗口权限。控制器、runtime 协议和 Chromium 语义保持原有契约。

三组固定页面脚本分别独立打包，以 MAIN、document_start、allFrames 和
matchOriginAsFallback 注册；不创建任意脚本接口、不依赖页面 script 标签或往返后台后再执行。
脚本不读取站点内容、不发请求、无 runtime 桥，只修改规格固定的属性。
偏好切换对新文档生效，界面提示刷新；不声称可还原已修改的 JavaScript realm。

操作采用立即失效 generation 加串行浏览器变更。停用/撤权取消旧操作，晚到结果不能重新开启。
只有成功读回及成功注册后保存启用意图；失败清理自己的覆盖和脚本。
重启检查持久设置、模块状态与权限后恢复已明确启用的 WebRTC 防护；Clash 仍不自动连接。
共享 host 权限不由 WebRTC 删除，活动页面防护向内置 origin 占用协调器注册探针。

## 验证

用户已确认规格的 T1 后台及 runtime、T2 DOM 用户动作、T3 隔离 profile 真实扩展接口。
逐切片保存 red/green 证据；真实页面验证启动首段脚本、iframe、刷新恢复及实际 privacy 状态。
保留既有 Clash 的真实连接与隔离回归。源码审计未发现附带许可，依据行为规格独立重写。
