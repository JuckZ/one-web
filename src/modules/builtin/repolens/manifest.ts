import type { SeededModuleDefinition } from '../../types'
import { REPOLENS_ENTRY_ID, REPOLENS_MODULE_ID } from './contracts'

export function createRepoLensBuiltinSeed(): SeededModuleDefinition {
  return {
    manifest: {
      manifest_version: 1,
      runtime: 'builtin',
      id: REPOLENS_MODULE_ID,
      entry_id: REPOLENS_ENTRY_ID,
      name: 'RepoLens',
      version: '0.3.0',
      description: '当前 GitHub 项目的概况、维护活动、相似项目与本机分析报告',
      icon_path: '/assets/icon-128.png',
      matches: ['https://github.com/*/*'],
      contexts: ['github.repository'],
      context_fields: { 'github.repository': ['repo', 'url', 'pageType'] },
      capabilities: [],
      activation: 'manual',
      min_host_version: '0.0.1',
    },
    grantedContexts: ['github.repository'],
    grantedContextFields: { 'github.repository': ['repo', 'url', 'pageType'] },
    grantedCapabilities: [],
  }
}
