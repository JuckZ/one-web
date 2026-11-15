# 浏览器任务使用的公开接口依据

核对日期：2026-11-12。用于 BT-05～BT-07 的实现约束；不是第三方平台在线验收记录。

- Chrome Tabs 官方接口：https://developer.chrome.com/docs/extensions/reference/api/tabs
  `captureVisibleTab` 采集窗口当前可见标签页；截图采集需要相应授权。实现保留 activeTab，
  调用前后校验实际 tab/window、native document、viewport/scroll，并在拒绝时说明工具栏激活要求。
  headless 截图测试对临时扩展副本单独授予 capture 权限，正式 manifest 不因此改为全站授权。
- OpenAI Images and vision 的 Chat Completions 示例：
  https://platform.openai.com/docs/guides/images-vision?api-mode=chat
  user content 是 text/image_url 的数组。实现固定 chat/completions 路由，实际发送本机裁剪的
  PNG data URL；不把纯文本请求或服务地址存在当成识图成功。模型名称和服务由用户配置，
  响应另行校验项目约定的 JSON text/translation/answer 字段。
- 视频读取复用本仓库公开固定 discovery、平台字幕读取与 SRT/VTT parser：
  `src/modules/builtin/video-dubbing/{injection,youtube,bilibili,html5,subtitles}.ts`。
  新的 VideoReadingController 只用这些公开读取接口；不复用配音私有会话或播放器注入。

上述官方页面已实际读取；视频和图像生产验证使用本机生成的 fixture，未调用收费模型或抓取用户视频。
