import type { SeededModuleDefinition } from '../../types'
import {
  CLASH_CONTROL_CAPABILITY,
  CLASH_CONTROL_ENTRY_ID,
  CLASH_CONTROL_MODULE_ID,
} from './contracts'

export function createClashControlSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: CLASH_CONTROL_MODULE_ID,
      name: '网络管理',
      version: '0.1.0',
      description: 'WebRTC 隐私防护与本地 Clash 连接、状态及节点切换',
      icon_path: '/assets/icon-128.png',
      entry_id: CLASH_CONTROL_ENTRY_ID,
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: [CLASH_CONTROL_CAPABILITY],
      activation: 'manual',
      min_host_version: '0.0.1',
    },
    enabled: false,
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
  }
}
