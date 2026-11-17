# OneWeb 维护者发布流程

GitHub Releases 是用户脚本正式分发入口；一个 `vX.Y.Z` 稳定版本必须同时包含 Chromium、Firefox 开发测试包
和用户脚本。GitHub 的 Latest 是仓库级指针，禁止只发一种目标覆盖 Latest。商店上传仍由既有 `deploy` 分支流程
单独处理；本流程不会上传 Chrome/Edge/Firefox 商店，也不会自动签名 Firefox XPI。

当前尚无 GitHub Release；本轮只完善本地实现和验收，没有提交、推送或公开发版。
公开安装/更新地址须在首个正式发布后检查，不能把本地测试通过当成线上链接可用。

## 1. 确认发布范围与版本

只纳入已审阅且得到授权的改动，保留工作区中其他任务的改动。`package.json.version` 是唯一产品版本源，
manifest、脚本及元数据从它生成。稳定版采用三个不带前导零的数字段，各段0..65535，排除0.0.0；
例如0.1.0、0.1.1。当前仍是0.1.0，后续每次更新都提高版本，不重用已发布版本。模块/协议版本各自管理。

更新本目录 `template.md`，写明本次用户可见变化和限制，它将成为该版本的 Release 正文。
检查 [隐私清单](../privacy-data-inventory.md) 与 [用户指南](../userscript-guide.md)。首次发版时删除指南中的
“本地候选、正式链接尚未生效”状态提示，然后随已授权源码一同提交。

## 2. 本地演练与验证

要求 Node22.12+、pnpm9.12+、Python3；Linux 浏览器验收还需要 Chromium/Firefox及相应依赖。

```sh
pnpm install --frozen-lockfile
pnpm test:release
pnpm release:rehearse
pnpm release:verify artifacts/release/v0.1.0
python3 scripts/agent-factory/factory.py check --config .agent-factory.json
python3 scripts/agent-factory/factory.py check --config .agent-factory.userscript.json
```

`release:rehearse` 串行构建三个目标、打包并验证。它不调用发布 API、不创建 tag，也不要求凭据；
允许脏树但来源清单会标记 `dirty: true`，该候选不能发布。最终浏览器回归按仓库流程执行。
修改源码后重新构建，不能沿用旧脚本/扩展包。`release:prepare` 使用相同构建链，但要求干净 checkout
且 HEAD 正好是与根版本一致的 tag。直接运行底层 pack helper不能代替该入口的构建步骤。

产物位于 `artifacts/release/v<版本>/`：

| 文件                           | 用户用途                                                                    |
| ------------------------------ | --------------------------------------------------------------------------- |
| `one-web.user.js`              | Tampermonkey 安装入口，包含完整本地运行代码与 MIT 许可证。                  |
| `one-web.meta.js`              | 仅元数据头，管理器检查更新用，与安装脚本头逐字一致。                        |
| `one-web-chromium.zip`         | 解压后在开发者模式加载扩展；不是商店签名安装包。                            |
| `one-web-firefox-unsigned.xpi` | 未签名，仅 Firefox 临时安装/开发测试；普通正式安装请使用经 AMO 签名的版本。 |
| `LICENSE`                      | MIT 许可证。                                                                |
| `release-manifest.json`        | 根版本、标签、源码 commit/dirty、主资产字节数与SHA256。                     |
| `SHA256SUMS`                   | 覆盖主资产和来源清单，不自引用；校验完整性，不提供独立签名。                |

校验器检查精确资产集合、哈希、版本、脚本元数据、离线运行边界、许可证与两种扩展manifest/后台入口。
上传后还会下载 draft 资产复验。来源SHA与同SHA CI共同绑定构建链；没有将哈希清单当作第三方安全审计或签名。

## 3. 已授权后提交与触发

完成评审、源码绑定检查与本地演练后，按审阅范围提交并推送，等待同一提交的 **CI** 完整成功。
PR merge-tree 的绿灯或旧提交的成功不会替代当前提交。CI 包含Firefox完整门禁；失败必须修复，不能改用旧绿灯。
CI runner 通过明确的临时 sysctl 允许隔离HTTP默认端口fixture；生产功能不因此获得额外权限。

在已审阅提交上创建与根版本相等的标签，再推送该标签，例如：

```sh
git tag -a v0.1.0 -m 'OneWeb v0.1.0'
git push origin v0.1.0
```

标签会触发 `CI` 和 `Release OneWeb`。已有远端标签且需要重新尝试时，可使用 Actions → Release OneWeb →
Run workflow，填写该稳定标签；工作流会检出标签指向的源码。它不接受 prerelease/RC标签作为稳定发布。
不要重写已经发布的标签。`contents:write`、`actions:read` 的仓库GITHUB_TOKEN足够，不需要新增个人Token。

工作流顺序：精确标签/版本 → 同SHA最新CI成功 → 脚本生命周期 → 三端完整构建与校验 →
远端版本/标签复查 → 创建draft → 上传全部资产 → 下载复验 → 再核对源码/CI/版本 → 晋升Latest。
所有稳定标签共享一把发布锁；任何同标签已有Release（含draft）、不递增版本、网络/API错误、缺失资产、
来源不符或CI失败都会停止，不会覆盖现有安装文件。GitHub管理员手工修改Release不在自动化互斥锁控制内。

## 4. 发布后实际烟测

```sh
gh release view v0.1.0 --repo JuckZ/one-web --json url,isDraft,isPrerelease,assets
```

另从无需登录的网络下载以下固定地址，确认重定向后的文件是同一稳定版，校验SHA256：

- `https://github.com/JuckZ/one-web/releases/latest/download/one-web.user.js`
- `https://github.com/JuckZ/one-web/releases/latest/download/one-web.meta.js`

用真实Tampermonkey从正式链接首次安装，批准一个测试origin、启用一个工具；下次发布时执行管理器检查更新，
观察meta版本、脚本下载、版本变更、原GM设置保留、其他origin仍关闭，并刷新旧网页。
隔离真实管理器验收已纳入仓库，可复跑：

```sh
ONEWEB_TAMPERMONKEY_PATH=/absolute/path/to/unpacked-tampermonkey pnpm test:userscript:manager
```

该路径只指向管理器扩展包代码，不是浏览器用户profile；未提供时命令明确失败，不会悄悄跳过。
需要Playwright Chromium及英文管理器UI，输出位于`artifacts/test-results/userscript-manager/`，
创建的浏览器profile在结束时清理，不操作用户现有Chrome。管理器包不随项目分发，普通CI只运行确定性GM边界测试。
本地factory证据可用`.agent-factory.userscript-manager.json`检查。
该验收只在内存副本改版本/localhost更新URL，
不修改运行代码。该测试证明真实管理器协议路径，不能证明GitHub公网可达或未来所有版本的降级兼容。

## 5. 失败与回退

发布前失败不移动Latest。创建draft后失败会保留draft及Actions候选附件供排查，正常重试拒绝覆盖它。
维护者先检查失败原因、已上传资产和日志；确认尚未公开且得到操作授权后，可删除那个失败draft（保留tag），
再从相同tag重跑。已公开版本不删除/覆盖资产，修复后发布更高版本。

用户手动回退时先备份脚本及存储、暂停自动更新，再选择历史版本；详见用户指南。
维护者回退功能用更高补丁版本重发修复，避免把Latest指向低版本导致管理器拒绝自动降级。
GitHub下载失败不应要求用户删除当前脚本；管理器保留已安装版本，网络恢复后再检查更新。
