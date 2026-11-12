import type { SeededModuleDefinition } from '../../types'
import { COOKIE_MANAGER_ENTRY_ID, COOKIE_MANAGER_MODULE_ID } from './contracts'

export function createCookieManagerSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: COOKIE_MANAGER_MODULE_ID,
      name: 'Cookie Manager',
      version: '0.1.0',
      description: '本地查看、编辑和管理 Cookie，支持 JSON 导入导出。',
      icon_path: '/assets/icon-128.png',
      entry_id: COOKIE_MANAGER_ENTRY_ID,
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
