# Cookie Manager 实施检查点

日期：2026-11-12。目标仓库：OneWeb。基线提交：
`dbbf7a51fd4eaeb1548b9f74f95b5ae2873a014f`，保留实施前已有的未提交改动。

## 授权、规格与范围

用户在参考审计和测试边界提出后明确要求“开始实施编码工作”。
按 [功能规格](../specs/cookie-manager.md) 实现默认关闭的打包 builtin。
参考 [安装包审计](../research/cookie-editor-reference.md)，没有复制第三方源码、样式或资源。
没有新增第三方备份兼容、解密器、历史格式、迁移机制或相关预留接口。

实现覆盖当前站点/所有 HTTP(S) 网站、Store 筛选、域名分组/选择、搜索、默认隐藏值、
新建/编辑、复制值、审查后删除、明文 JSON 导出、选择目标 Store 后预览/导入。
所有 Cookie 值保持在受信任管理页与后台的瞬态内存中，用户明确导出的文件和剪贴板除外。

## SDD / TDD 证据

测试使用规格中已授权的 T1～T4 公开边界。只替换浏览器、文件下载、剪贴板及时间等系统边界；
协议测试使用真实 client/controller 组合，UI 测试通过公开 DOM 动作观察行为。
下面列出开发时实际观察到的代表性 red → green，不以事后添加断言冒充失败阶段。

| 纵向行为                     | 实际 red                                         | green 对应实现                                 |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| 授权后枚举与 Store 身份      | 控制器尚不存在，测试无法导入                     | 可选权限、逐 Store 枚举与不透明快照            |
| JSON 导入导出                | 编解码器尚不存在                                 | 严格数组格式、allowlist、限额及往返保真        |
| 管理页编辑、复制、导出和预览 | 独立视图尚不存在                                 | 真实协议接线与用户动作                         |
| 真实打包入口                 | 找不到 Cookie Manager 模块卡                     | seed、模块管理与后台路由接线                   |
| 读取中撤权                   | 预期 `permission-required`，实际返回 Cookie 列表 | 返回枚举结果前复核权力                         |
| 属性顺序不同但内容未变       | 预期保存成功，实际 `stale-cookie`                | 规范化比较内容与完整分区键                     |
| 当前子域编辑父域 Cookie      | 预期保存成功，实际浏览器失败                     | URL 使用已授权的当前 hostname                  |
| Firefox 原生未分区 Cookie    | `partitionKey: null` 导致 client 拒绝快照        | 仅原生读取边界规范化 null                      |
| 枚举单条超限                 | 预期拒绝，实际发布超限快照                       | 枚举也检查单条、总字节与条目上限               |
| 域名选择                     | 找不到分组选择按钮                               | 按域名分组、数量与分组选择                     |
| 筛选后旧导出确认             | 隐藏选择仍存在导出确认按钮                       | 搜索/Store/选择变化取消旧审查                  |
| 逐项结果                     | 找不到操作项结果文本                             | 保留被审查身份并显示每项结果                   |
| 共享 host grant              | 占用检查接口不存在                               | 活动范围的 scheme/hostname/全站覆盖探针        |
| 无效编辑字段                 | 预期 `invalid-input`，实际 `invalid-response`    | 有限协议接受有界记录，控制器返回字段错误       |
| Firefox 分区删除             | 真实 API 返回完整祖先位，被误判不支持            | 核验最低支持版源码，保留并传递完整分区键       |
| Firefox HTTP 分区枚举        | 加入真实 HTTP 分区 Cookie 后 `open` 失败         | 去除浏览器无关模型中的 Chrome 专用 Secure 约束 |

主要循环命令：

```bash
pnpm exec vitest run modules/builtin/cookie-manager/__tests__/controller.test.ts
pnpm exec vitest run modules/builtin/cookie-manager/__tests__/json.test.ts
pnpm exec vitest run sidebar/__tests__/cookie-manager-view.test.ts
pnpm exec playwright test e2e/cookie-manager.spec.ts
pnpm test:e2e:firefox
```

## 验收

实施前基线：88 个文件，678 个单元/组件测试。

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test --reporter=dot`：91 个文件，721/721 通过；Cookie 新增 43 个测试。
- `pnpm verify:firefox`：生产构建、身份检查、manifest 验证和真实 Firefox 门禁通过。
  manifest 为 0 errors / 0 notices / 0 warnings；三个 builtin 门禁 3/3。
- Chromium 生产构建和身份检查通过；最终 `pnpm test:e2e` 为 30/30 通过，
  包括新增 Cookie Manager 2/2；没有重试后通过的用例。
- `git diff --check`：通过。

Chromium 的 420px 真实管理页验证了新建持久 Cookie、HttpOnly 编辑、明文 JSON 下载、
审查后删除、文件预览零写入、所选项导入、未选项与 extension storage 隔离及撤权清空。
第二个流程使用同站 top-level site 下的 false/true 祖先位 Cookie 验证精确删除，
以及 worker 重启后旧快照失效、停用不删除剩余 Cookie。截图：
`test-results/cookie-manager-chromium.png`，已目视检查且横向溢出断言通过。

首轮全仓 E2E 暴露两处测试调整：旧 manifest 断言需要纳入新增可选 `cookies`，
CHIPS 合成数据不能把跨站顶层站点与 false 祖先位组合。修正断言和合成数据后，
先观察新增两项通过，再完整复跑 30 项。没有放宽默认权限或删除身份校验。
最终 `extension/` 中保留 Chromium 构建；Firefox 的完整构建与门禁在此之前独立通过。

Firefox 门禁使用独立临时 profile、Marionette 与真实 Cookie API，覆盖 HttpOnly、
`firefox-default` Store、完整分区、HTTP 分区、编辑、导出、删除、预览零写入、JSON 往返、
未选 Cookie 和 storage 隔离，以及权限撤销。Firefox 160 自动化访问扩展页面需要测试进程
环境变量 `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`；只修改了隔离测试进程启动配置。

## 实际边界

原生权限弹窗没有自动点击；浏览器测试在隔离 profile 内预授予测试权限，UI 直接点击处理器
仍负责产品中的权限申请。测试没有访问或更改用户真实 Cookie，也没有卸载参考扩展。

浏览器 Cookie API 没有 CAS；状态复核与写入之间仍可能发生网站竞争。删除无法唯一定位时
拒绝执行；已发送写入后生命周期变化可能返回结果未知。批量操作不承诺事务。
会话最多八个，自准备起十分钟；刷新不延长后台或 UI 的有效期。后台重启不恢复旧快照，
旧 UI 内容在下次操作失效时清除。结束管理保留共享浏览器权限。

未提交、发布或修改用户现有 Chrome 会话。当前工作树包含此前阶段改动，
整仓 diff 不能全部归因于 Cookie Manager。
