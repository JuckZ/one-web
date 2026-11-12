# Cookie Manager：规格驱动迁移方案

日期：2026-11-12。状态：**已实现，Chromium / Firefox 验收通过**。

SDD 在此指 Specification-Driven Development：先把需求、数据、操作结果和验收条件写清楚，
再通过 TDD 的逐条 red → green 循环实现。不能把只有文档或只有通过的旧测试表述为迁移完成。

## 目标与实现依据

用户能在 OneWeb 中完成 Cookie Editor 的日常核心操作，从而无需额外安装该扩展。
参考对象和实现审计见 [cookie-editor-reference.md](../research/cookie-editor-reference.md)。
目标是本仓库，不改 RepoLens 服务端、SDK vendor 或历史 `one-tampermonkey` 项目。

首版围绕查看、搜索、创建、编辑、删除，以及用于手动备份和恢复的 JSON 导入导出。
参考插件的功能清单只是调研证据，不自动构成实现要求。按用户的范围纠正，
不实现第三方历史备份兼容、旧格式解密器或历史数据迁移，也不预建相关适配层和扩展点。

新增打包内置模块 `dev.oneweb.cookie-manager`，入口 `cookie-manager`，默认关闭，
从现有模块管理界面进入。Cookie API 仅由受信任后台使用。远程模块的 SDK、能力目录和
context 字段不增加 Cookie 权限。

当前基线为分支 `codex/phase-9a-openlist-contract`、提交
`dbbf7a51fd4eaeb1548b9f74f95b5ae2873a014f` 加现有未提交工作。保留原改动，
不把之前阶段文档中的“尚未授权”当成本次用户请求的替代；本次实施不涉及发布或仓库整理。

## 功能规格

| 编号  | 用户操作                   | 预期结果                                                                                                       |
| ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| CM-01 | 启用模块并打开管理界面     | 展示授权状态；未授权时不读取 Cookie；拒绝授权可以重试                                                          |
| CM-02 | 管理当前站点               | 由后台解析活动 HTTP(S) 标签页，仅展示相应授权范围；不接受页面提供的权限范围                                    |
| CM-03 | 管理所有网站               | 明确申请 HTTP/HTTPS 全站 Cookie 访问；显示所有可访问 store，按域名分组并显示数量                               |
| CM-04 | 搜索、筛选、选择、刷新     | 按域名和名称筛选，支持单选、域名选择、当前可见结果全选；值默认隐藏                                             |
| CM-05 | 查看、创建、编辑 Cookie    | 处理 name/value/domain/path/过期/session/SameSite/Secure/HttpOnly/hostOnly/store/partition；成功后刷新真实结果 |
| CM-06 | 单项或批量删除             | 先展示明确目标与数量，确认后逐项执行；不影响未选项或其他 store/partition 的同名项                              |
| CM-07 | 复制值                     | 明确点击后复制当前 Cookie 的 value，并报告结果；首版不增加多种请求头或属性字符串格式                           |
| CM-08 | 导出 JSON                  | 仅导出所选 Cookie，包含恢复所需的属性；下载前提示文件含明文 Cookie 数据                                        |
| CM-09 | 导入 JSON                  | 读取本功能导出的 Cookie JSON 数组，校验并预览后选择导入；不自动识别第三方备份格式                              |
| CM-10 | 拒绝、失败、部分成功       | 给出稳定错误及逐项结果；后台失败不能让界面先显示成功；不会自动重试写入                                         |
| CM-11 | 切换范围、撤销、停用或重启 | 清除旧选择、明文值和待确认操作，旧请求不再有执行权；不自动读取所有站点                                         |

导入预览展示域名、名称、路径、目标 store、分区和新增/覆盖数量。文件不能静默申请全站权限，
也不能把文件中的 storeId 默认为本机 `"0"`。用户必须选择实际可访问的目标 store。
编辑现有 Cookie 时保留名称、domain、path、store 和分区身份，允许修改 value、过期和
可修改的属性。创建时可填写身份字段；如需更换身份，通过新建和明确删除完成，
首版不增加自动移动/替换流程。批量写入逐项报告结果，不能宣称原子更新。

不属于首版：自动清理规则、Cookie 自动刷新/锁定、多账号容器编排、缓存/历史记录清理、
网络请求拦截、自动登录、云同步、密码加密备份、推广页面、网络遥测或任意代码执行。

## 身份、权限和生命周期

Cookie 选择必须保留浏览器返回的原始身份：

```text
storeId + raw domain + path + name
  + full partitionKey when present
  + firstPartyDomain when present
```

保留 Chrome 的 `topLevelSite` 与 `hasCrossSiteAncestor`，以及 Firefox 的
`firstPartyDomain`。缺失字段与显式字段不能随意合并。`hostOnly`、secure、session 等
属性必须保留并正确映射到 API；界面展示用的 Unicode 域名不能改写操作身份。

`cookies.getAll` 每次只读取一个 store；列出可访问 store 后分别查询，包括分区与未分区数据。
不启用原本未获准的隐身权限。不支持或无法无损表达的浏览器专有分区属性要标记并阻止相应写入，
不能丢字段后声称导入成功。

manifest 只新增可选 `cookies` 权限，复用现有 HTTP/HTTPS optional host 声明。
首次授权由管理 UI 的直接用户操作发起，后台每次操作复核模块、权限、范围及生命周期。
拒绝权限时不给扩展默认新增全站访问。

当前站点授权使用明确的 hostname 及所需 scheme；浏览器 host 权限不能作为严格端口隔离边界。
Cookie host/domain 语义与 Page Toolbox 的 exact-origin 语义不同，不把两者混为一谈。
全站模式必须有显式用户选择；只有部分 host 授权时文案必须显示“已授权范围”，不能显示“全部”。

Cookie Manager 停用清除自己的瞬态权力，不删除浏览器 Cookie。权限是扩展级共享资源：
不因停用模块就撤销其他模块仍使用的 host grant，也不直接套用当前只比较字符串相等的
`BuiltinExactOriginUsageCoordinator` 处理全站/子域覆盖关系。实现向该协调器注册活动管理范围
的占用探针，由 Cookie Manager 自己比较 scheme、hostname 与全站模式；结束管理后释放占用。
撤销界面必须说明实际范围；
共享授权保留时只撤销本模块的访问权，并如实报告浏览器权限仍被共享。

后台枚举产生不透明 snapshot ID 和条目 ID。修改、删除、导出使用最新 snapshot 中的条目，
不把 UI 传来的任意 URL、store、domain 或浏览器方法当成删除权限。每次修改前重新核对
Cookie 当前状态；网站已更新值或其他编辑器已更改数据时返回 `stale-cookie`，先刷新再操作。
这只是冲突检测，浏览器 API 不提供 Cookie CAS，不能保证检测和写入之间绝无网站竞争。

`cookies.remove` 按 URL/name 自动选择同名 Cookie，并不接受精确 path/domain 主键。
必须核对 API 即将选择的对象是否等于已审查目标；无法确定时返回
`ambiguous-cookie-target`，不能删除其他记录后再尝试恢复。写入序列在控制器内统一串行，
批量操作逐项报告结果；中途撤权/停用使后续项取消，已发出写入的结果可能为未知。

## 数据与导入导出契约

所有 Cookie 值仅存在于后台/受信任管理页的瞬态内存及用户明确下载的文件。
不写 sync/local storage、Registry、context bridge、日志、错误文本、诊断或远程 iframe。
界面关闭/停用时释放引用和撤销 Blob URL；JavaScript 不承诺物理内存安全擦除。
UI 使用文本节点和表单值；列表默认隐藏 value，只有明确查看、复制或导出才暴露。

固定边界：文件 8 MiB、单条规范化记录 16 KiB、最多 10,000 条导入/枚举记录，
单次写入/删除确认最多 200 项。超过限额要显式返回错误或标注截断，不默默省略后执行“全选”。
这些是 OneWeb 资源限制，Cookie 可否被浏览器接受仍由浏览器判断。

导入器从 allowlist 生成新的 Cookie 对象。拒绝未知危险字段、无效枚举、非法 domain/path、
非有限 expirationDate、重复身份、超限数据和不支持的文件结构；不把导入对象直接转发给浏览器。
禁止用文件中的 `url` 当导航/网络目的地。session 对应不传 expirationDate，host-only
对应不传 domain；`SameSite=None` 与 Secure、Cookie 名称前缀等约束必须在预览前验证。

首版文件为本功能明确支持的 Cookie JSON 数组，字段由当前 Cookie 数据模型确定。
不增加加密外壳、格式探测、版本分派或迁移机制。验证导入导出正确性与数据保真：
合成 Cookie 导出再导入后，值、身份、属性保持一致；用明确的预期记录核验导出内容，
并测试非法 JSON、缺少必要字段及超限输入在预览阶段拒绝、零写入。

稳定错误至少覆盖 `module-disabled`、`permission-required`、`permission-denied`、
`invalid-input`、`limit-exceeded`、`unsupported-format`、
`store-unavailable`、`unsupported-partition`、`stale-cookie`、`ambiguous-cookie-target`、
`lifecycle-cancelled`、`browser-operation-failed`、`outcome-unknown`。
结果不包含原始浏览器异常或 Cookie 值；写入失败不能自动重试。

## 已授权的公开测试边界

用户在本规格及测试边界提出后明确要求开始实施。测试不针对私有方法，也不 mock 自有内部协作者。
允许替换的系统边界是浏览器 API、时间/熵，以及浏览器 fixture 服务。

| 边界                                                              | 覆盖什么                                                                                                                    | 无法单独证明什么                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| T1：`CookieManagerController` 的有限公开操作与受信任 runtime 协议 | 列举、读写删除、快照冲突、完整身份、权限、禁用/撤销/重启、部分失败、远程/页面拒绝与模块隔离                                 | 真实浏览器 Cookie 选取规则、权限弹窗和布局                |
| T2：公开 JSON 导入导出/预览接口                                   | 导入导出正确性与数据保真、所选项导出、往返、字段校验、限额和解析后零写入                                                    | 浏览器最终是否接受写入及文件选择器行为                    |
| T3：打包管理界面的用户动作                                        | 授权入口、遮蔽值、筛选选择、编辑校验、删除确认、复制、文件预览/导入与逐项结果；恶意文本只作文本展示                         | HttpOnly、CHIPS、不同 store 的浏览器实际语义              |
| T4：独立测试 profile 中的真实扩展端到端流程                       | Chromium/Firefox Cookie API、HttpOnly、partition/store、拒绝/撤权、下载导入、重启、两个站点和既有模块隔离；420px 面板可用性 | 用户所有网站的业务登录行为、尚不可达的浏览器版本/隐身环境 |

T1 的协议通过真实 client/controller 组合检验规范请求和拒绝行为，不能仅证明
`isRequest` 接受自己生成的对象。T3 在公开 DOM/用户动作边界观察行为；
T4 允许通过真实浏览器 cookies API 独立核验浏览器状态，这是端到端测试的外部系统观察点。

## 验收场景与实施顺序

1. **CM-01～04 / T1、T3、T4**：未授权零读取；启用及明确授权后枚举；两域名、同名不同
   path、不同 store 和分区 Cookie 不合并；当前站点与全站切换清除隐藏选择。
2. **CM-05～06 / T1、T3、T4**：真实 HttpOnly/session/persistent 写入可读取；
   修改和删除只影响已选身份；并发变更拒绝；批量操作的部分成功逐项报告。
3. **CM-07～09 / T2、T3、T4**：复制当前值；JSON 导出只含所选项，导入导出往返保持数据；
   文件预览不写入；明确选择目标 store 后导入；无效或超限文件零写入。
4. **CM-10～11 / T1、T3、T4**：中途撤权/停用取消后续项，后台重启不恢复旧令牌；
   不改 RepoLens、Browser Journal、Bookmark Doctor、Clash、Page Toolbox、
   OpenList 或远程模块的状态，不泄露 Cookie 到其 bridge。

每一条按“一个用户行为的失败测试 → 观察预期失败 → 最小实现 → 同一测试通过”推进；
不一次写完全部测试再实现。先完成枚举的纵向切片，再做单项编辑/删除、批量操作、
备份和完整浏览器验收。开发日志要保存真实 red/green 命令及结果，不事后推测。

代码位于 `src/modules/builtin/cookie-manager/` 及独立的 sidebar 视图/样式。
宿主只在 default registry、后台消息路由/生命周期、sidebar 入口接线。
尽量避免继续把整套新 UI 塞入现有大型 `module-management-view.ts`。
接入时同步更新隐私数据清单、架构及 README，权限说明以实际 manifest 和实现为准。

交付验证：相关 TDD 测试、全量 unit、typecheck、lint、Chromium 生产构建和真实 E2E；
Firefox 独立构建、manifest lint 与相同语义的真实浏览器验证。Cookie 浏览器测试使用
独立 profile 与合成数据；用户 Chrome 仅用于经授权的只读参考检查。不能用旧的
Page Toolbox Firefox 测试冒充 Cookie Manager Firefox 验收。

## 当前证据

2026-11-12：`pnpm typecheck` 通过；`pnpm test --reporter=dot` 为 88 个文件、
678/678 测试通过。这是新增功能前的基线，不是新功能验收。

已完成后台控制器、有限 runtime 协议、独立管理界面、可选权限与模块生命周期接线。
新增 43 个测试；全仓 91 个文件、721/721 测试通过。类型检查与 lint 通过。
Chromium 生产构建及 30/30 E2E 通过；Firefox 完整门禁 3/3，
manifest 检查为 0 errors / 0 notices / 0 warnings。
会话最多 8 个（含待授权准备），每个自准备起有效 10 分钟，不因刷新延长后台有效期。
后台或管理页重启不恢复旧快照。后台重启后旧 UI 数据在下次操作时清除；不宣称即时推送清空。
真实浏览器门禁预先在隔离测试 profile 中授予权限，没有自动操作用户的原生权限弹窗。
最终验证命令、结果和真实 red/green 证据记录于
[实施检查点](../checkpoints/cookie-manager-implementation.md)。
