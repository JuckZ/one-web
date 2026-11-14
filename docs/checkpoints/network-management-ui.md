# 网络管理 UI：T2 开发与验证记录

日期：2026-11-14。用户已确认规格中的 T1/T2/T3 测试接口后开始实现。

## 接口与测试范围

公开 DOM 接口为 `NetworkManagementView(root, options)`，提供 `refresh()` 与 `destroy()`。
构造只渲染，不自动读取；接线方在创建后显式调用 `refresh()`，避免重复读取。

测试使用真实 `NetworkManagementClient`、受信任消息处理器和 `NetworkManagementController`，
复用 `src/modules/builtin/network-management/__tests__/harness.ts`。
只替换浏览器系统接口（privacy、permissions、storage、scripting）及外部检测页打开动作，
不替换自有控制器或客户端。

## 实际 red → green 记录

每轮先单独加入一个可观察行为测试，执行相同命令：

```sh
pnpm exec vitest run sidebar/__tests__/network-management-view.test.ts
```

| 切片                                             | 首次失败证据                                           | 最小修改后的结果         |
| ------------------------------------------------ | ------------------------------------------------------ | ------------------------ |
| 安全初始化与四策略、三个默认偏好                 | 23:16:55，无法解析尚不存在的 `network-management-view` | 23:17:24，1 test passed  |
| 点击同步请求权限，拒绝不应用                     | 23:17:43，`network-apply` 不存在，点击失败             | 23:18:12，2 tests passed |
| 无页面选项仅申请 privacy，并显示实际策略及控制权 | 23:18:31，仍显示“防护未开启”，缺少真实状态呈现         | 23:18:43，3 tests passed |
| 独立页面选项与显式关闭释放控制                   | 23:19:10，`network-disable` 不存在；随后修正释放文案   | 23:19:30，4 tests passed |
| 控制冲突反馈且不误报成功                         | 23:19:41，仅显示泛化错误，没有其他扩展/策略控制提示    | 23:20:17，5 tests passed |
| 手动刷新及失败后重试                             | 23:20:33，`network-refresh` 不存在                     | 23:20:43，6 tests passed |
| 明确点击才打开外部检测页面                       | 23:21:02，缺少外部站点说明与入口                       | 23:21:15，7 tests passed |
| 成功重试清除错误状态，选择 default 释放控制      | 23:21:41，成功后反馈 `data-state` 仍为 `error`         | 23:21:55，8 tests passed |
| 销毁后不继续授权操作，也不再读后台               | 23:22:14，销毁后的 `refresh()` 额外发送一次请求        | 23:22:23，9 tests passed |

以上时间均为 Asia/Shanghai。测试通过仅证明 T2 可观察交互及真实后台接口组合，
不单独证明真实 Chrome 的权限提示、页面主执行环境注入或公网泄漏结果；这些属于 T3。

## 最终行为

- 展示 WebRTC 防护、实际 IP 策略、浏览器控制权与页面脚本状态。
- 四个原生 IP 策略与三个独立页面选项；首次不自动改动浏览器。
- 用户点击时同步调用权限申请；只有选中页面选项且策略不是 default 才申请 HTTP/HTTPS host 权限；拒绝不会调用应用接口。
- 成功与错误均采用真实后台结果；关闭调用 `disable()` 清除本插件覆盖，不申请额外权限。
- 选中 default 后以后台返回的 `enabled:false` 呈现关闭状态，避免本地假成功。
- 提示音视频与网页通话影响，以及已有页面需刷新；泄漏检测明确标识外部站点，只调用接线方提供的固定打开动作。
- 操作期间禁用交互；销毁后不会因尚未结束的权限请求继续应用，也不会更新已销毁 DOM。

## 文件范围

- `src/sidebar/network-management-view.ts`
- `src/sidebar/network-management.css`
- `src/sidebar/__tests__/network-management-view.test.ts`

网络管理与 Clash 同模块的接线、真实浏览器 T3、全量检查由主任务维护。

## 清理失败后如实呈现关闭状态

2026-11-14 23:31（Asia/Shanghai），审查发现后台已保存 `enabled:false` 意图，但
浏览器的 privacy clear 或页面脚本注销失败时，手动刷新仍会显示“防护未开启”。
在同一已确认 T2 接口新增参数化回归：通过真实界面开启，再令浏览器系统 fake 的
`privacy.clear` 或 `unregisterContentScripts` 单次拒绝，点击关闭、刷新、重试释放。
不替换自有 client/controller，不直接调用私有状态呈现方法。

- Red：`pnpm exec vitest run sidebar/__tests__/network-management-view.test.ts`，
  23:31:17 实测 9 passed / 2 failed；两项均因仍显示“WebRTC 防护未开启”而缺少“关闭尚未完成”。
- 最小实现：当关闭意图与 `controlled_by_this_extension` 或实际注册的页面脚本并存，
  优先显示“关闭尚未完成，仍有本插件控制或页面保护，请重试释放”。保留既有 `role=status`
  动态状态区，提示可读文字而不只依靠颜色；不把存储意图作为释放成功的证据。
- Green：同一命令于 23:31:37 实测 11/11 passed；再次点击释放成功后恢复“防护未开启”与“已释放”。

此窄修核对 Chrome Extensions 技能的异步错误反馈规则，并按 Modern Web Guidance
检索 `announce operation status`、读取 `accessibility`：保留动态错误的 live-region 语义
（“Announce dynamic errors via live regions”），不新增焦点跳转或重复播报区域。

## Firefox 设置范围说明

用户要求 Firefox 同样支持后，在相同 T2 接口新增应用前的范围说明回归。
通过真实 client/controller 挂载 Firefox 视图，检查可见文字同时说明普通窗口和隐私窗口，
策略选择与应用按钮均关联说明，且挂载不会申请权限或写入设置。

- Red：`pnpm exec vitest run src/sidebar/__tests__/network-management-view.test.ts --reporter=dot`，
  11 passed / 1 failed，因缺少范围说明。日志 `/tmp/oneweb-firefox-support-ui-red.log`。
- 最小实现：仅 Firefox 显示持续可见的窗口范围说明，以每实例唯一 ID 和 `aria-describedby`
  关联策略与应用按钮；宿主传入构建平台，不新增用户确认步骤或自动申请隐私窗口访问。
- Green：同一命令 12/12 通过，日志 `/tmp/oneweb-firefox-support-ui-green.log`。

Modern Web Guidance 的 `forms` 与 `accessibility` 指引共同要求将辅助说明与控件关联
（“use `aria-describedby` to link inputs with help text or error messages” /
“Link hints to inputs via `aria-describedby`”）。保留已有原生控件和状态区域，静态范围说明不增加 live region。
