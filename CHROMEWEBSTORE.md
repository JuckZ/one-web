# Chrome Web Store Listing — OneWeb

> Last Updated: 2026-11-17. Local implementation draft; no store submission performed.

## Store Listing

**Extension Name:** OneWeb

**Short Description:** 你的浏览器伴侣：把搜索、整理、浏览器工具与智能分析集中到一个侧边工作台。

**Detailed Description:**

在浏览网页时，就地阅读、翻译、写作和整理内容。

把常用提示词保存为网页工具，基于你选择的网页或选文生成回答。用文字描述生成交互式小应用，预览后保存，并在统一列表中启停和管理。RepoLens 帮助查看当前公开 GitHub 仓库的概况、维护活动和相似项目，复制或下载分析报告。

打开 OneWeb，在设置中配置自己的模型服务。需要时授权当前站点，再明确运行工具。GitHub 项目分析可使用匿名额度，或配置自己的只读 Token。模型服务的费用和额度由所选服务提供方决定。

应用定义和分析缓存保存在本机。模型密钥和 GitHub Token 默认只保留在本次浏览器会话，用户可以明确选择记住。小应用隔离运行，不能读取网页、浏览器权限或外部网络。没有广告、跟踪或产品遥测。

**Category:** Productivity

**Single Purpose:** 在当前浏览任务中集中完成页面阅读、内容处理和浏览器工具操作。

**Primary Language:** zh-CN

## Graphics & Assets

| Asset                             | Dimensions          | Status                   | Filename                      |
| --------------------------------- | ------------------- | ------------------------ | ----------------------------- |
| Store icon                        | 128×128 PNG         | Existing packaged asset  | extension/assets/icon-128.png |
| Application chooser screenshot    | 1280×800 or 640×400 | Needs store-size capture | Pending                       |
| Page tool and mini app screenshot | 1280×800 or 640×400 | Needs store-size capture | Pending                       |
| Native RepoLens screenshot        | 1280×800 or 640×400 | Needs store-size capture | Pending                       |

## Permissions Justification

| Permission              | Type               | Justification                                                                                                                                                                             |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activeTab               | required           | User-triggered current-page actions and screenshot tasks.                                                                                                                                 |
| contextMenus            | required           | Page and selection actions from the browser context menu.                                                                                                                                 |
| scripting               | required           | Packaged page capture, translation, editing and site tools after site authorization.                                                                                                      |
| storage                 | required           | Local settings, app definitions, history, grants and analysis cache.                                                                                                                      |
| tabs                    | required           | Bind browser tasks to the current URL/tab, navigate to sources and open the workspace.                                                                                                    |
| sidePanel               | required, Chromium | Native browser workspace.                                                                                                                                                                 |
| https://github.com/*    | required host      | Detect public repository context while browsing GitHub.                                                                                                                                   |
| bookmarks               | optional           | Explicit Bookmark Doctor diagnosis and reviewed repairs.                                                                                                                                  |
| cookies                 | optional           | Explicit Cookie Manager session.                                                                                                                                                          |
| privacy                 | optional           | Explicit WebRTC privacy policy controls.                                                                                                                                                  |
| https://_/_, http://_/_ | optional hosts     | Exact origins requested only for user-selected page tools, installed remote modules, model/media/controller services, or GitHub API analysis. Declaration is an upper bound, not a grant. |

No userScripts, eval, debugger or remote-script execution permission is added. HTML app scripts run
only in a manifest sandbox with no extension APIs or network. The extension execution CSP retains
packaged scripts only; no unsafe-eval is added. Prior localhost RepoLens host permission is removed.

## Privacy & Data Use

The extension processes user data only for user-enabled browser tasks. No advertising, analytics,
data sale, credit decisions or unrelated processing. Complete flows and retention/deletion controls:
[privacy inventory](docs/privacy-data-inventory.md).

| Data type               | Processed                                       | Off-device transfer                                                                 | Purpose                                     |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| Authentication info     | User-entered service keys/PAT/controller tokens | Exact configured service/GitHub only                                                | Authorized requests                         |
| Personal communications | Explicit messages/imports/selections            | Configured model only on request                                                    | Answer, translation and writing             |
| Browsing activity       | Bound page URL, repository/video identity       | Only declared granted context or explicit operation                                 | Current browser task                        |
| Website content         | Explicit page/selection/subtitle/image input    | Selected model/media service or approved module                                     | User-selected content operation             |
| Bookmarks/cookies       | Explicit privileged builtin operations          | Not exposed to remote modules; matching subtitle platform uses browser session only | Local management/requested platform reading |

- [x] Data is not sold to third parties.
- [x] Data is not used for unrelated purposes.
- [x] Data is not used for creditworthiness or lending.

**Privacy Policy URL:** Pending hosted public policy before submission; repository inventory is the engineering source.

## Distribution and Developer

Visibility/regions: Undecided before submission.

Publisher: Juck. Contact: juckz@foxmail.com.

Homepage/support: https://github.com/JuckZ/one-web (issues for support).

## Version History

| Version | Date       | Changes                                                                                                                                               | Status      |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0.1.0   | 2026-11-16 | Two smart application forms; unified enable/manage list; packaged RepoLens without standalone service; release model connections after service errors | Local draft |

## Review Notes

This document records the current implementation, not a declaration of store readiness. Store assets,
hosted privacy policy and final policy review remain required before a user-authorized submission.
No rejection history. HTML apps have in-memory interaction state and no network/extension privileges;
their schema is not a userscript or GM API implementation.

### Page tool and distribution update (2026-11-17)

Page Toolbox now provides seven opt-in tools, adding local spacing measurements, a reversible
reading dimmer, bounded reveal of already-loaded hidden visual elements and explicit npm/GitHub
selection search. Search sends up to200 characters only when its link is clicked, without referrer;
no new Chromium API or host permission is added. Firefox additionally discloses `searchTerms`.
A separate self-contained userscript build distributes these page tools through a script manager;
it is outside the Chrome Web Store package and does not turn the extension into a script manager.
Refresh Page Toolbox screenshots before any submission. This remains local work, not a store release.
