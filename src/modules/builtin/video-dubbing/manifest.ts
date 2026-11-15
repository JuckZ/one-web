import type { SeededModuleDefinition } from '../../types'
import { VIDEO_DUBBING_ENTRY_ID, VIDEO_DUBBING_MODULE_ID } from './contracts'

export function createVideoDubbingSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: VIDEO_DUBBING_MODULE_ID,
      name: 'Video Dubbing',
      version: '0.1.0',
      description: '用自己的翻译和语音服务，为 YouTube、Bilibili 和可导入字幕的 HTML5 视频生成同步配音与双语字幕。',
      icon_path: '/assets/icon-128.png',
      entry_id: VIDEO_DUBBING_ENTRY_ID,
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: [],
      activation: 'manual',
      min_host_version: '0.0.1',
    },
    enabled: false,
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
  }
}
