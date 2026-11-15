# Magpie 开发资产 → OneWeb 采用地图

这份包提供可核对的上游原文和采用建议。**原文已归档，工具和提示词已按 OneWeb 适配。** 实际安装、CI 接入和验证结果见包内 README 与采用记录；本页中的初始核对记录描述安装前状态。

## 来源、版本与许可

- 项目：[yetone/magpie](https://github.com/yetone/magpie)，官网：[usemagpie.ai](https://usemagpie.ai)。这是模型网关与 Library 管理器。
- 全部归档原文取自固定提交 `aa358555ff3c5e27e7e82eacd4c4977762a2eb6d`，通过 `git show <sha>:<path>` 读取，保留目录和文件字节；没有从目标项目提取私密材料。
- 上游根目录的项目说明确为 [`README.md`](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/README.md)，许可确为 [`LICENSE`](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/LICENSE)，文本为 MIT，版权 `Copyright (c) 2026 yetone`。
- [包内完整 LICENSE](licenses/magpie-MIT.txt) 与 [逐文件 manifest.json](magpie-sources.json) 一起提供。manifest 含固定 SHA、原文件路径、GitHub/raw URL、字节数、文件模式和 SHA-256。共归档 12 个上游文件，约 174 KiB；未复制测试树、依赖、二进制、账户配置或凭据。
- 复制或实质改编上游内容时，随该内容保留完整 MIT 版权与许可文本，可放到 OneWeb 的 `docs/agent-development/licenses/magpie-MIT.txt`，并在改编文档标注上游路径和固定 SHA。MIT 允许采用与改编，不意味着上游方案适合当前项目。

这是精选原文档案，不是可执行的完整 Magpie checkout。原文里的部分相对链接指向未打包文件，可通过 manifest 的上游链接回查。归档中的 `AGENTS.md`、`CLAUDE.md` 和 `LESSONS.md` 描述上游项目，不作为 OneWeb 的生效指令。

## 对 OneWeb 的只读核对

读取时 OneWeb 的 HEAD 为 `ef29526f8b6733c7eec53876d600364e48086eaa`，但工作树含既有未提交内容，**不能用该 HEAD 复原本次观察到的全部文件**。以下只描述当前可读文件，未证明这些检查已执行或远程 CI 已通过：

- 根 `AGENTS.md` 已规定浏览器关联、插件体验收益、插件/外部承载边界与完整任务验收；这些产品判断应保留为最高项目入口。
- `package.json` 是 TypeScript/Vue/Vite/pnpm 项目，已定义 `typecheck`、`lint`、`test:coverage`、`verify:chromium`、`verify:firefox`、`verify:identity` 和 `verify:module-sdk` 等脚本。实际命令以这个文件为准，避免在新文档再次维护一份易过期脚本表。
- 已有 `docs/architecture.md`、`docs/module-platform-architecture.md`、`docs/specs/`、`docs/adr/`、`docs/checkpoints/`、`docs/releases/`。优先添加索引与更新规则，避免再写一套互相矛盾的架构真相。
- `.github/workflows/ci.yml` 已跑 Node/pnpm、类型检查、lint、coverage、Chromium 扩展 E2E 与 Firefox 验证；Playwright 当前配置 `workers: 1`、CI 禁止 flaky 通过。
- `.github/workflows/deploy.yml` 已在构建中跑类型、lint、unit 和 Firefox 门禁，`publish` 依赖 `build`，并仅在 `deploy` 分支走商店发布。Chromium E2E 在独立 CI 工作流，deploy 本身当前没有该步骤；后续若修改发布链，应把必要检查绑定到同一源码 SHA 和实际分发产物，而不是照搬 Magpie 的“发 tag 后另行等待”机制。
- 最近的 `docs/checkpoints/video-dubbing-release-validation.md` 与 `docs/releases/video-dubbing-rc-20261112.md` 已区分自动化通过、真实云服务未验收、人工听感待签收，并记录候选产物哈希。它们是很好的现成证据格式，不应被“模型说完成”取代。

## 逐项采用清单

分类含义：**直接 copy** 指可以原样保留的来源/许可档案；**adapt** 指采用结构或机制，改写为 OneWeb 的事实后才启用；**仅参考** 指不把原文件接到 OneWeb 执行入口。所有目标路径均相对 `/home/juck/Projects/one-web`。下表保留了上游采用理由；已实现的接入集中在 `docs/agent-development/`、`scripts/agent-factory/` 与 `.agent-factory*.json`。

| 上游文件与作用                                                                                                                                                                                               | 分类                           | OneWeb 已有对应                                                                                                              | 实际建议路径与采用方式                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LICENSE](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/LICENSE)：MIT 复制、改编与分发条件。                                                                                | **直接 copy**                  | 根 `LICENSE` 是 OneWeb 自己的许可，不能用它代替上游版权。                                                                    | `docs/agent-development/licenses/magpie-MIT.txt`：未来确实采用内容时原样保留；不覆盖 OneWeb 根许可。原文在包内 `upstream/magpie/LICENSE`。                                                                                                        |
| [README.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/README.md)：项目身份、产品范围、文档入口。                                                                        | **直接 copy，仅来源档案**      | 根 `README.md` 已解释 OneWeb 产品、模块与浏览器用法。                                                                        | 保留在包内 `upstream/magpie/README.md` 即可；若未来记录来源，用 `docs/agent-development/asset-map.md` 链回固定版本。无需移植 Magpie 的产品清单。                                                                                                  |
| [AGENTS.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/AGENTS.md)：任务开始时读设计、标准、贡献与教训的入口；包含大量上游供应商迁移事实。                                | **adapt**                      | 根 `AGENTS.md` 已有清晰产品边界，但此次读到的版本没有工程文档路由。                                                          | 在现有 `AGENTS.md` 后增补简短条件指针：改子系统先看拥有者文档；改代码读标准/教训；审社区贡献读审查规则。保留现有选型规则；不复制上游厂商表、插件迁移状态或本机路径。                                                                              |
| [CLAUDE.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/CLAUDE.md)：两行转引，复用已有知识。                                                                              | **adapt**                      | 此次文件检索未发现根 `CLAUDE.md`；已有根 `AGENTS.md`。                                                                       | 可选新增 `CLAUDE.md`，只指向 `AGENTS.md` 及 OneWeb 自己的教训文件。只有在实际采用的 agent 支持该引用语法时使用 `@` 转引，不复制整套规则。                                                                                                         |
| [LESSONS.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/LESSONS.md)：把规则、错误原因、提交/issue 证据和重复日期留给后续会话。                                           | **adapt**                      | `docs/checkpoints/`、`docs/adr/` 已保留实施与验证历史；未找到同名教训入口。                                                  | `docs/agent-development/LESSONS.md`：从 OneWeb 的新条目开始，链接现有 checkpoint/ADR/修复证据。可采纳重复错误升级为规范的办法；历史不能当作 OneWeb 已发生的事故，重复次数不能凭空继承。                                                           |
| [docs/code-standards.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/docs/code-standards.md)：全路径与旁支检查、旧代码会失败、隔离验证、SHA绑定审查、发布完整性。         | **adapt**                      | `package.json`、现有 CI、SDD/ADR/checkpoint 已提供多数检查与验收依据。                                                       | `docs/agent-development/workflow.md`：保留目标/证据/未运行项的格式，命令转引 package scripts。平台矩阵用 Chromium/Firefox及实际目标；Go 的 `gofmt`、`vet`、`-race`、GTK/WebKit、17个assets与上游 UI 审美规则全部重写。                            |
| [docs/subsystems/README.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/docs/subsystems/README.md)：索引、职责/状态/接口文档、同PR更新、前后语义审查。                    | **adapt**                      | `docs/architecture.md`、`docs/module-platform-architecture.md`、`docs/specs/`、`docs/adr/`。                                 | `docs/agent-development/subsystems.md`：先只做 OneWeb 现有文档的目录，按 workspace/assistant、模块平台、页面工具、视频配音、网络管理等真实拥有者指路。每项指到源码与既有规格；职责确实缺失再补单页。                                              |
| [docs/contributors.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/docs/contributors.md)：执行贡献代码前检查额外影响，保护工作环境，明确归属与维护者决策。                | **adapt**                      | 模块平台、隐私清单与规格已经定义权限/外部能力边界；此次未发现独立贡献审查页。                                                | `docs/agent-development/review.md`：围绕扩展权限、外连、远程代码、商店发布、依赖/安装脚本、用户数据流建立目标项目规则；保留作者归属。**上游个人名单、黑名单、厂商去留、合作话术与自动关闭策略不采用。**                                           |
| [build/race-shards.sh](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/build/race-shards.sh)：枚举 `go test -c` 二进制的测试名，动态分块、多进程跑 Go race suite。            | **仅参考**                     | Vitest 已有自己的 worker/pool；Playwright 当前显式单 worker，扩展测试还会共享profile/端口/原生媒体资源。                     | 不安装为 OneWeb 测试脚本。若观察到资源争用，先写 `docs/agent-development/workflow.md` 定义端口、临时profile、音频与产物所有者；需要程序时用 Node/Vitest/Playwright 的原生机制重做。Go `-test.list`/`-test.run` 和 race detector 无法直接用于 TS。 |
| [.github/workflows/test.yml](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/.github/workflows/test.yml)：矩阵检查、超时、race分片、Windows原生专项与失败可观察性。           | **adapt**                      | `.github/workflows/ci.yml` 已执行 TypeScript 与实际扩展门禁。                                                                | 审阅并适配现有 `.github/workflows/ci.yml`，保留现有脚本、冻结lockfile与浏览器安装方法。优先验证每个必要检查确实运行、跳过项可见、失败保留证据；Go runner、Bun插件测试和GTK依赖不移植。                                                            |
| [.github/workflows/release.yml](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/.github/workflows/release.yml)：tag向独立仓库dispatch并镜像发布，含限额重试与notes失败提示。  | **仅参考架构**                 | `.github/workflows/deploy.yml` 已有构建artifact、发布依赖和商店凭据引用。                                                    | 审阅既有 `.github/workflows/deploy.yml` 的必要检查与产物SHA绑定；不新建同名release.yml，不接 `yetone/magpie-releases`，不申请上游PAT/签名secrets。参考“部分失败显式记录、重试有上限、产物齐全再宣布”；发布仍按 OneWeb 原有授权边界执行。          |
| [.github/ui-preview/README.md](https://github.com/yetone/magpie/blob/aa358555ff3c5e27e7e82eacd4c4977762a2eb6d/.github/ui-preview/README.md)：构建PR真实应用，给模型diff与页面，规划交互，再截图/录屏回填PR。 | **adapt，先文档与本地fixture** | `playwright.config.ts` 已保留失败trace，CI上传 `artifacts/test-results/chromium/`；`e2e/` 与发布checkpoint已有真实扩展验证。 | 可选新增 `docs/agent-development/review.md`，先使用 OneWeb 生产扩展和测试自有站点生成确定的截图/录屏证据，作为现有E2E附件。必要时再设计 `.github/workflows/ui-preview.yml`；本包仅含上游README，**不是可运行预览工具**。                          |

## 采用顺序与限制

1. **先补索引，保留项目真相。** 根 `AGENTS.md` 继续决定产品边界；子系统索引指到现有规格、ADR与checkpoint。先明确文件拥有者和真实运行路径，再抽取通用标准。
2. **新教训只记新证据。** 条目至少含触发条件、实际失败、修复commit/issue、复现步骤和以后可执行的检查。把原始验证日志放在 OneWeb 已有证据体系中，文档保留稳定链接；不把整个上游事故集灌进 agent 上下文。
3. **检查接现有脚本与同一SHA。** 复用 OneWeb 的 type/lint/unit/两浏览器链路；若将来强化发布，应验证成功检查对应的源码和artifact就是将发布的那一份。Magpie 在没有源码Test成功时仍能发版的缺口不应一并复制。
4. **UI证据先不用付费模型。** 上游完整方案需要真实 DeepSeek key，会构建并运行贡献者PR代码，还需要配套脚本与发布权限。不要从本包README直接启动。若未来采用模型规划，需要为账户、执行环境、成本和PR写权限单独设计；截图里没有key不等于贡献者代码无法读取环境变量。
5. **资源调度先量后改。** 独立worktree解决代码/index互扰，独立临时浏览器profile/端口解决测试互扰，资源锁处理昂贵共享验证。它们不应通过清理别的会话目录来实现；本次先在隔离副本验证，接入时保留 OneWeb 既有工作与其他会话。

最有价值的可迁移部分是：**短入口指路、子系统单一事实来源、修复有行为证据、未验证范围写清、复盘有可追溯条目、发布条件写成实际依赖。** 原文作为参考留档，生效规则以 OneWeb 的产品边界、代码与实测结果重新建立。
