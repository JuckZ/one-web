# Firefox 网络隐私适配器：公开接口回归

日期：2026-11-14。用户要求 Firefox 也支持，沿用已确认的 T1 controller/runtime 测试接口。

## 范围与实现

Chromium 继续通过原生 callback API 操作 `regular_only`。
Firefox 通过 `platform/browser` 读取原生 Promise API，在固定适配器内将本功能的
set/clear 请求映射到其唯一支持的 `regular` scope。接口不新增任意 scope、URL、方法或属性。
Firefox 策略会同时影响普通与隐私窗口；该差异由管理界面在应用前说明。
页面脚本的窗口访问仍取决于扩展实际获得的浏览器权限。

新增 `createFirefoxNetworkPrivacy(setting)` 仅接受原生 setting 系统接口；
`getNetworkPrivacy()` 按构建目标接入该适配器。默认/关闭调用 clear，释放自己的覆盖并恢复
浏览器继承的偏好，不通过 set(default) 继续占有设置。

## 实际 red → green

命令：

```sh
pnpm exec vitest run src/background/__tests__/network-privacy.test.ts --reporter=dot
```

第一条 tracer test 通过真实 `NetworkManagementClient`、受信任 runtime handler 和
`NetworkManagementController` 发起 Firefox 应用，原生 Firefox fake 严格拒绝
`regular_only`。首次执行因尚无 `network-privacy-adapter.ts` 无法解析模块而 red；
新增最小 Promise 适配器后，同一测试 1/1 green。

- red 日志：`/tmp/oneweb-firefox-adapter-red.log`
- 首条 green 日志：`/tmp/oneweb-firefox-adapter-green.log`

随后逐条加入已实现行为的公开回归并实际运行，每条均首跑通过，未伪造额外 red：

1. `default` 释放覆盖并返回独立已知的继承策略 `default_public_interface_only`。
2. 关闭防护释放 Firefox 覆盖以及三组已选的页面脚本。
3. 重建 controller 后，仍启用且获权的意图恢复为 `default_public_and_private_interfaces`。
4. 原生 set 失败只返回稳定的 `browser-operation-failed`，不泄露原始异常或报告成功。
5. 其他扩展持有控制权时返回 `control-conflict`，实际继承值保持不变。

该文件最终 6/6 通过，日志 `/tmp/oneweb-firefox-adapter-final-tests.log`。
测试只替换浏览器 setting、permissions、storage、scripting 等系统接口，
不 mock 自有 controller、client 或 handler，不直接测试私有方法。

真实 Firefox 的策略读回、页面首脚本和 iframe、撤权、重启及 Clash 合并流程由 T3 单独验证；
本文件的系统 fake 不替代浏览器语义证明。
