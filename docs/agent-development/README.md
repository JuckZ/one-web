# OneWeb 代理开发入口

工程工具借鉴 Magpie 的短入口、可验证交付和复盘机制，按 OneWeb 现有 WXT/React/TypeScript/Vitest 链路适配。产品选择仍由根 `AGENTS.md` 决定。

## 运行一次开发任务

在当前 OneWeb 的 Codex / Claude Code 中，把 [实现提示词](prompts/implement.md) 的任务目标填好并执行；接着使用 [独立评审提示词](prompts/review.md)，需要时用 [复盘提示词](prompts/retrospect.md)。入口本身不会启动常驻任务。`/loop` 可重复调用同一个明确任务，任务终态和累计三轮修复上限保存在 Git common-dir 中。

当前项目有未提交功能时，新的 worktree 只带所选提交；先确认需要的功能和工程脚手架已进入该提交，再从它建立独立任务。

## 可直接运行的入口

```sh
python3 scripts/agent-factory/factory.py doctor --config .agent-factory.json
python3 scripts/agent-factory/factory.py check --config .agent-factory.json
```

检查完成后，把输出的绝对 evidence 路径传给：

```sh
python3 scripts/agent-factory/factory.py attest --evidence /path/from/check/evidence.json
```

- `.agent-factory.json`：工具自身回归、TypeScript、lint、Vitest。
- `.agent-factory.ci.json`：同上，Vitest 使用现有 coverage 门槛；供 CI 使用。
- `.agent-factory.chromium.json`：现有 Chromium 生产构建与扩展 E2E。
- `.agent-factory.firefox.json`：现有 Firefox 构建、identity、manifest 与真实扩展检查。

浏览器检查按任务所需运行，分别使用 `artifacts/test/chromium/` 和 `artifacts/test/firefox/`；同一目标目录只运行一个构建者，共享 SDK 构建通过 wrapper 串行执行。构建生成了受版本管理的文件时，核对并固定生成结果后重新验证；源码状态变化不会保留旧“通过”。

需要 Python 3.9+ 和 Git。Linux/macOS 使用上面的 `python3` 命令，Windows 直接在 PowerShell 或 Git Bash 中使用本机 Python：

```powershell
python scripts/agent-factory/factory.py doctor --config .agent-factory.json
python scripts/agent-factory/factory.py check --config .agent-factory.json
python scripts/agent-factory/factory.py check --config .agent-factory.chromium.json
python scripts/agent-factory/factory.py check --config .agent-factory.firefox.json
python scripts/agent-factory/factory.py attest --evidence "C:/实际路径/evidence.json"
```

对每个检查分别回验其实际返回的路径。Windows 使用启动 Factory 的 Python 执行配置里的 `python3`，并支持 `pnpm.cmd` 等参数受限的批处理入口。命令和相对 `PATH` 项以仓库根为基准，命令行回执使用 UTF-8。需要任意参数的自定义检查可直接使用 `.exe`。开发使用 `pnpm dev:test`，双浏览器的端口、开发产物和验收目录见 [统一开发与测试](../../README.md#同时开发与测试)。运行浏览器门禁前，用 `pnpm exec playwright install chromium firefox` 安装测试浏览器。已有系统 Firefox 时，也可将 `FIREFOX_BINARY` 设置为其可执行文件的绝对路径。

## 验证记录证明什么

日志与 JSON 保存在 `git rev-parse --path-format=absolute --git-common-dir` 下的 `agent-factory/runs/`，避免污染源树。记录绑定 HEAD、index、tracked 与非忽略 untracked 内容、配置摘要及每项命令结果。失败或输入改变时返回非零。同一操作系统上的多个 worktree 使用同一个全套检查锁。Windows 和 WSL 共同访问一个 Git common-dir 时，锁的互操作性未验证，请分开使用。

记录为本地未签名证据，防止误用旧结果；不抵御有权限篡改记录的人，也不覆盖 ignored 文件、工具链、环境变量、真实外部服务和检查间修改后复原。测试命令在普通进程中执行，不是权限沙箱。

## CI 和发布

CI 的原有类型、lint、coverage 三步改为通过 wrapper 运行，并上传完整日志；原有两浏览器检查保留。`main` 与 `deploy` 的 CI 运行保留执行机会，PR 更新仍可取消过时检查。

商店 publish 在原有 build 成功后，额外查询当前 repository、精确 SHA 的最新 CI run：只有直接源码的 push / workflow_dispatch 检查 completed/success 才继续；PR 合并树的成功不能授权源提交发布，failed/cancelled/skipped/错误 SHA 均拒绝。`deploy` 分支加入 CI trigger。商店凭据只存在原有 publish 步骤，CI 查询使用只读 actions 权限。

这层 gate 已写进本地工作流，提交并推送这些改动后才在 GitHub 生效。本地 JSON 证据不能代替 GitHub 分支保护，也不会自动更改仓库规则、推送分支或发布商店。当前 gate 证明对应源码 CI 通过；它没有给最终 ZIP/XPI 增加密码学 provenance。

## 来源

[采用地图](asset-map.md) 给出 Magpie 固定提交和逐项适配理由。实质改编保留 [MIT 原文](licenses/magpie-MIT.txt)。Magpie 的供应商表、个人名单、UI 偏好和历史错误没有作为 OneWeb 事实导入。
