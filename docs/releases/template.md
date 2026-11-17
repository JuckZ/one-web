OneWeb 提供浏览器扩展与独立的页面工具脚本，同一仓库维护。

本版用户脚本包含七项默认关闭的页面工具：密码查看、网页自由编辑、解除选择/复制限制、元素间距测量、夜间阅读减光、已加载隐藏内容和选文搜索。按网站启用，设置保存在脚本管理器中。

- [安装油猴脚本](https://github.com/JuckZ/one-web/releases/latest/download/one-web.user.js)：先安装Tampermonkey，再确认安装OneWeb；到目标网页的油猴菜单启用当前站点及具体工具。
- [完整使用、更新与卸载说明](https://github.com/JuckZ/one-web/blob/main/docs/userscript-guide.md)
- Chromium ZIP需解压后通过开发者模式加载。Firefox XPI未签名，仅供临时安装测试，不能作为普通Firefox正式安装包。
- `.meta.js`用于检查更新；`SHA256SUMS`用于下载完整性校验；源码commit与版本见`release-manifest.json`。

脚本不提供扩展的原生侧栏、RepoLens或浏览器特权模块，不调用LLM API。新版本安装后刷新已打开网页；更新保留同一OneWeb脚本的站点设置。旧OneMonkey状态不会自动导入，请先停用旧脚本。
