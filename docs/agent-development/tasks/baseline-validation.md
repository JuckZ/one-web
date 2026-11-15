# 第一项任务：恢复当前核心验收

这是可直接交给 [实现入口](../prompts/implement.md) 的具体任务。它没有被后台启动，也不代表已经修改相关功能。

- Task ID：`restore-core-validation`
- Owner：执行任务的实际会话标识。
- Base：执行时的实际 HEAD 与工作区快照。先核对当前已有改动归属；本观察来自 2026-11-14 23:40 左右建立的隔离副本，后续功能会话可能已经更新文件。
- 目标：当前 OneWeb 的核心检查全部通过，同时保持动态翻译已约定的用户行为。
- 允许范围：先读本次失败涉及的 3 个文件与相邻实现/测试；真正需要改动时按原任务归属协调，在自己的工作区处理。

## 已观察到的失败

`factory.py check --config .agent-factory.json` 运行完整四项：工具回归通过、typecheck 通过、lint 失败、unit-tests 失败。

- `docs/specs/video-dubbing.md`：6 个表格格式错误。
- `src/workspace/__tests__/dynamic-translation.test.ts`：4 个对象换行格式错误。
- `src/workspace/page-context.ts`：7 个大括号 / 对象换行格式错误。
- 单测：115 个文件中 114 个通过；861 个测试中 860 个通过。失败位于 `workspace/__tests__/dynamic-translation.test.ts:79`，关于 apply 后再次请求 translation-blocks 的响应。

失败计数来自该隔离快照，不作为当前工作区恒定事实。先读取当前代码和原规格，再复现；问题已经被其他任务解决时，记录当前验证结果，不重复改动。

## 执行要求

1. 读取根 AGENTS、工作流、workspace 规格与当前测试。识别失败断言在验证什么产品保证，核对实现和真实 DOM 状态。
2. 保留失败复现。格式问题按项目 formatter 修正；行为问题以规格和公开接口确定预期，不能仅改测试预期使它变绿。
3. 用核心配置复验，保存完整 evidence。按实际改动范围补相关 browser checks；未做的验证注明影响。
4. 交给未参与实现的评审者；最多累计三轮修复；最终记录 Trigger / Before / After、测试和剩余缺口。

原始失败日志保存在本机 Git common-dir 的 `agent-factory/runs/20261114T154047Z-fe89caaea14f/`；记录是失败证据，不可当作发布许可。
