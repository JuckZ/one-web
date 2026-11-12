# Cookie Editor 实现审计

日期：2026-11-12。对象：扩展 `iphcomljdfghbkdcfndaijbokpgddeno`。

本次审计基于用户机器已经安装的 **Mixesoft / Hotcleaner Cookie Editor 2.2.0.0**，
不是对商店“最新版本”的判断。迁移目标为本仓库 OneWeb；`one-tampermonkey` 是历史项目，
不作为实现目标。

## 证据与复核

读取位置为 Chrome profile 下的
`Extensions/iphcomljdfghbkdcfndaijbokpgddeno/2.2.0.0_0/`。没有读取 Chrome Cookies
数据库、导出真实 Cookie、修改网站登录态或卸载目标扩展。

| 文件                   | SHA-256                                                            | 用途                             |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `manifest.json`        | `8779dd825935eac198740add160692cee2822cc147fdfe1697af5850d5db1c59` | 权限、入口、版本、嵌入策略       |
| `esw129.js`            | `4f59c1e77de62ac166782b77353707d7bd21137faf8aa6e0e6217e170a974f1c` | 后台消息、枚举、写入、删除       |
| `fjs129/eeditor129.js` | `1b71ac97570d0bac45d16f6ee3ad17e34bb38b96eb9d6e877a2ba805349759b4` | 编辑表单、分组、选择、备份编解码 |
| `emanager129.html`     | `948d9fd9191d65e5ee295db31662672dae6759a1c21dbbf0e24c2a3f6b4401b2` | 管理页面及扩展 iframe            |

Playwright CLI 通过 extension 模式成功附着 Chrome，但内置扩展管理页面导航报告
`Target page, context or browser has been closed`；复查时附着会话仍存在，只能看到连接页。
随后对已知的扩展管理入口导航报告 `Page.navigate: Not allowed`。因此本报告是
**静态安装包审计**，没有把它表述为 UI 实测。会话使用 detach 结束，保留用户 Chrome。

源码文件和 `fimg129/copyright.txt` 声明 All Rights Reserved。OneWeb 只借鉴功能、
公开浏览器 API 和可观察数据格式，独立编写代码，不复制目标插件代码、样式或图片，
也不把安装包提交到仓库。

## 实现路径

1. MV3 service worker `esw129.js` 持有 `cookies`、`contextMenus`、`storage`，
   并静态申请 `<all_urls>`。
2. 工具栏或页面菜单打开管理界面。管理外壳可能使用扩展自带页面，也可能根据语言和
   星期跳到 Hotcleaner 网页；实际编辑器是扩展页面 `eeditor129.html` 中的 Shadow DOM。
   编辑器作为顶层页面打开时会跳转到 Hotcleaner 的管理网页。
3. 编辑器通过 JSON 字符串消息请求后台。后台检查 `sender.id`，使用数值操作码
   `3` 枚举、`5` 写入、`8` 兼容删除。不是 `document.cookie`，因此能够处理 HttpOnly。
4. 枚举调用 `chrome.cookies.getAll({ partitionKey: {} })`，界面按域名分组、按名字排序，
   支持域名筛选、全选、域名选择、刷新、展开和折叠。
5. 表单包括 domain、path、name、value、storeId、partition topLevelSite、过期 UTC 时间、
   SameSite、session、hostOnly、httpOnly、secure。
6. 写入时构造 URL；host-only Cookie 不传 `domain`，session Cookie 不传 expirationDate；
   删除只读字段后调用 `cookies.set`。复制功能生成带属性的 Cookie 字符串。
7. 常用删除路径通过 `cookies.set` 把 expirationDate 设为 `1`。较旧 Chromium 的
   partitioned Cookie 走 `cookies.remove`，并尝试恢复可能被影响的同名 Cookie。
8. 导入先展示待选 Cookie，用户选择后点 Set 才写入；导出要求密码并仅导出已选项。

## 备份格式

目标插件的导出外壳是 JSON：`url`、`version: 2`、`data`。`data` 是 Base64 编码的
12 字节 IV 与 AES-GCM 密文/128 位认证标签的拼接。明文为 Cookie 对象数组。

密钥派生使用 PBKDF2-HMAC-SHA-256，UTF-8 密码作为输入，
UTF-8 `password + password` 作为 salt，迭代 `2^10 = 1024` 次，得到 32 字节密钥。
以上仅记录参考插件的实现事实，不产生 OneWeb 的实现义务。用户已明确首版不需要
第三方历史文件兼容；OneWeb 首版只实现自身明确支持的 JSON 导入导出，
不实现此解密器、历史测试向量或密码备份。

## 参考行为与首版取舍

以下按本次实际需求取舍，不将参考插件已有的全部功能列为迁移要求。

| 观察                                                | OneWeb 迁移决策                                              |
| --------------------------------------------------- | ------------------------------------------------------------ |
| 浏览器 cookies API，支持 HttpOnly                   | 后台专用 cookies 边界；页面和远程模块不能调用                |
| 所有域名管理                                        | 保留全站模式，按用户动作请求可选权限；同时提供当前站点模式   |
| Cookie 表单完整                                     | 保留常用属性；准确区分身份、内容和浏览器只读字段             |
| 分区 Cookie 支持                                    | 保留完整分区键，不能只保存 topLevelSite                      |
| storeId 可填写                                      | 改为实际可访问 Cookie Store 的选择，不能假定都是 `"0"`       |
| 筛选后的选择与批量操作                              | 保留，明确展示数量和范围，避免隐藏选择被删除                 |
| 密码备份、先预览再导入                              | 首版只做 JSON 导入导出和写入前预览，不实现密码备份或历史格式 |
| 写入前就更新 UI，后台异常只输出日志                 | 以实际结果刷新界面，按项显示成功、失败和结果未知             |
| 删除使用过期写入与同名恢复技巧                      | 不搬运兼容技巧；精确校验目标和 API 选择结果，不确定就拒绝    |
| UI 部分匹配未比较 path，分区 UI 只使用 topLevelSite | 身份包含 domain、path、name、store 和完整 partition 数据     |
| 域名显示过程修改用于操作的对象                      | 展示名称和原始 API 身份分离，保留原始 ASCII 域名及属性       |
| 自动导航、推广、捐赠、卸载反馈链接                  | 不迁移；管理入口和业务 UI 完全打包在 OneWeb 中               |

## 浏览器文档核验

2026-11-12 直接读取以下官方 API 文档，用于纠正仅参考旧插件可能引入的错误：

- [Chrome cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)：
  `cookies` 加对应 host 权限；默认只操作未分区 Cookie；`getAll` 是单 store 查询；
  `CookiePartitionKey.hasCrossSiteAncestor` 自 Chrome 130 起存在；
  同名 Cookie 的 `get` 按最长 path、再按最早创建时间选择。
- [Firefox cookies.getAll](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/getAll)：
  `partitionKey: {}` 包含分区及未分区记录；启用 first-party isolation 时需要
  `firstPartyDomain`，枚举可使用 `null`。
- [Firefox cookies.remove](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/remove)：
  同名删除会按 URL、path、创建时间选择；`storeId`、`partitionKey`、
  `firstPartyDomain` 参与目标定位；历史 Firefox 行为存在差异。

浏览器文档确认了数据模型和 API 限制，不等于已经通过本项目的浏览器验收。
迁移前的行为规格与测试边界见 [Cookie Manager SDD](../specs/cookie-manager.md)。

实施时进一步核对 Firefox 142 发布版官方 `ext-cookies.js` 和本机 Firefox 160 的相同文件，
确认两者均处理 `hasCrossSiteAncestor`；不能据较旧类型定义判定 Firefox 不支持该字段。
本机实际 API 验证还确认：未分区 Cookie 返回 `partitionKey: null`，应在浏览器读取边界
转换为模型中的缺失分区；Firefox 的 HTTP 分区 Cookie 不能套用 Chrome 的 Secure 限制。
这些行为均已纳入隔离 profile 的 Cookie Manager 门禁。
