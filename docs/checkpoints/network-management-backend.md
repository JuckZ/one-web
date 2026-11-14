# 网络管理后台 TDD 记录

日期：2026-11-14。使用用户确认的 T1：真实 runtime client/controller、真实 ModuleRegistry；只替换浏览器 API 与 storage 系统边界。

循环命令：`pnpm exec vitest run src/modules/builtin/network-management/__tests__/controller.test.ts --reporter=dot`。

| 用户行为切片                                   | 实际 red                                                        | 同一命令的 green                                 |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 未授权默认状态                                 | 无法解析尚不存在的 `./harness`                                  | 1/1 通过，未读取 privacy API、未改变浏览器       |
| 无页面选项的原生策略                           | 返回 `unsupported`，预期已生效状态                              | 2/2 通过，`regular_only` 写入并展示实际控制权    |
| 权限、模块启用、其他管理方控制                 | 四项均错误返回 `ok:true`                                        | 6/6 通过，四类无权应用零写入                     |
| 页面选项的独立全站授权与固定 MAIN 脚本         | 缺少 host 权限仍 `ok:true`                                      | 7/7 通过，三组独立脚本及选项替换                 |
| 关闭/default 策略释放覆盖                      | 仍 `enabled:true`、保留脚本，default 被 set                     | 9/9 通过，clear 与注销，不移除共享权限或其他脚本 |
| 迟到 set、worker 恢复和模块停用                | 已关闭的 apply 仍成功；`startup` 不存在                         | 11/11 通过，代际失效、串行清理和仍获权恢复       |
| 实际执行结果及失败回收                         | 原生描述字段顺序导致假阴性；未取得控制仍成功                    | 13/13 通过，按字段核验、注册异常回收、写入后复核 |
| 浏览器严格注销与独立清理                       | 对不存在 ID 注销导致首次 apply 失败；注销异常阻断 privacy clear | 15/15 通过，只注销真实注册项，分别尽力清理       |
| 首次 status 读持久配置、最后一次 readback 竞态 | 默认参数在 load 前求值返回旧默认；末尾读取期间停用仍成功        | 18/18 通过，load 后选配置、末尾 await 后再验代际 |

另补充公开 runtime 边界回归：远程/页面 sender、非法版本、方法/脚本/URL/secret 额外字段、
未知策略均拒绝且零浏览器访问；三种非 default 原生策略、transport/非法响应及 MAIN 能力不支持
的可观察结果。四项在既有实现上首次即通过，没有将它们伪报为 red。

后续独立复核切片：非法对象作为 command 的 red 为 `Cannot convert object to primitive value`，
改为先验证字符串类型；部分 host 撤权且注销失败时 red 为 `scriptsActive:false`，改为按实际
注册存在报告残留，同时继续以完整 host 权限判断 protected。两项随后 green。

再复核共享 host 占用的完整应用窗口：注册完成但实际状态读取尚未完成时 red 为占用探针
返回 false；将 applying 占用保留到整个 apply finally 后 green。

最终本目录 24/24 测试通过；与公开 UI 测试合跑为 33/33。
`pnpm typecheck` 通过，`pnpm exec eslint src/modules/builtin/network-management --fix` 后目录 lint 通过。
真实浏览器与全仓门禁由主代理统一执行。

## 实现边界

`NetworkManagementClient` 的 status/apply/disable 返回明确的 `NetworkResult`；
消息处理只接受受信任扩展 origin，有限版本及精确字段。实际 WebRTC 能力使用
privacy `regular_only`，不会继承到隐身范围；MAIN 注册包括 document_start、allFrames、
matchOriginAsFallback，固定三项 ID 与构建路径，无任意属性/URL/方法桥接。

持久配置为 `oneweb.network-management.v1` 的 `{ version: 1, settings }`。
仅在原生实际策略/控制权和脚本属性核验成功后保存启用意图；worker 重启只恢复模块仍启用、
privacy 与需要的全站 host 仍获权的意图。Clash 协议、secret、自动连接行为未被引入本控制器。

停用/撤权立即提高代际；应用和清理在同一队列执行，发送后的浏览器写入不能撤回，
迟到结果会先变为取消，再按同一队列清理。注销和 clear 独立尽力执行；清理失败返回稳定错误，
status 仍如实显示残留脚本，不把本地 enabled=false 当成浏览器已恢复。共享 host 权限从不 remove。
