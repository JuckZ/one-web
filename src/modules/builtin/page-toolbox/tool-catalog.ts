import type {
  PageToolCatalogV1,
  PageToolDescriptorV1,
  PageToolJsonValue,
  PageToolSettingsSchemaDefinitionV1,
} from './contracts'
import {
  PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
  PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
} from './contracts'
import { createPageToolCatalog } from './validation'

export const PAGE_TOOL_IDS = [
  'password-visibility',
  'free-page-edit',
  'selection-copy-release',
  'element-spacing',
  'night-reading',
  'hidden-content',
  'selection-search',
] as const

export type PageToolId = typeof PAGE_TOOL_IDS[number]

export interface PasswordVisibilitySettingsV1 {
  readonly gesture: 'double-click' | 'triple-click'
}

export interface FreePageEditSettingsV1 {
  readonly mode: 'rich-text' | 'plain-text'
}

export interface SelectionCopyReleaseSettingsV1 {
  readonly selection: boolean
  readonly copy: boolean
  readonly contextMenu: boolean
}

export interface NightReadingSettingsV1 {
  readonly strength: 'gentle' | 'medium' | 'strong'
}

const defaultSettings: Readonly<Record<PageToolId, PageToolJsonValue>> = Object.freeze({
  'password-visibility': Object.freeze({ gesture: 'double-click' }),
  'free-page-edit': Object.freeze({ mode: 'rich-text' }),
  'selection-copy-release': Object.freeze({ selection: true, copy: true, contextMenu: true }),
  'element-spacing': Object.freeze({}),
  'night-reading': Object.freeze({ strength: 'gentle' }),
  'hidden-content': Object.freeze({}),
  'selection-search': Object.freeze({}),
})

function exactObject(value: PageToolJsonValue, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const record = value as Readonly<Record<string, PageToolJsonValue>>
  const actual = Object.keys(record)
  return actual.length === keys.length && actual.every(key => keys.includes(key)) ? record : null
}

function passwordSettings(value: PageToolJsonValue): boolean {
  const record = exactObject(value, ['gesture'])
  return record?.gesture === 'double-click' || record?.gesture === 'triple-click'
}

function editSettings(value: PageToolJsonValue): boolean {
  const record = exactObject(value, ['mode'])
  return record?.mode === 'rich-text' || record?.mode === 'plain-text'
}

function releaseSettings(value: PageToolJsonValue): boolean {
  const record = exactObject(value, ['selection', 'copy', 'contextMenu'])
  return Boolean(record
    && typeof record.selection === 'boolean'
    && typeof record.copy === 'boolean'
    && typeof record.contextMenu === 'boolean')
}

function emptySettings(value: PageToolJsonValue): boolean {
  return Boolean(exactObject(value, []))
}

function nightSettings(value: PageToolJsonValue): boolean {
  const record = exactObject(value, ['strength'])
  return record?.strength === 'gentle' || record?.strength === 'medium' || record?.strength === 'strong'
}

function additionalDescriptor(id: PageToolId, title: string, description: string, domAccess: PageToolDescriptorV1['domAccess']): PageToolDescriptorV1 {
  return {
    schemaVersion: PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
    id,
    title,
    description,
    siteScope: 'user-approved-exact-http-origin',
    requiredSiteGrant: 'exact-origin',
    runAt: 'document-idle',
    frames: 'top',
    defaultEnabled: false,
    domAccess,
    requiresMainWorld: false,
    settingsSchemaId: `page-toolbox.${id}`,
    settingsSchemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
  }
}

const descriptors: readonly PageToolDescriptorV1[] = [
  {
    schemaVersion: PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
    id: 'password-visibility',
    title: 'Password visibility',
    description: 'Toggle qualified password fields without reading their values',
    siteScope: 'user-approved-exact-http-origin',
    requiredSiteGrant: 'exact-origin',
    runAt: 'document-idle',
    frames: 'top',
    defaultEnabled: false,
    domAccess: ['read', 'attributes', 'listeners'],
    requiresMainWorld: false,
    settingsSchemaId: 'page-toolbox.password-visibility',
    settingsSchemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
  },
  {
    schemaVersion: PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
    id: 'free-page-edit',
    title: 'Free page edit',
    description: 'Temporarily make the current page body explicitly editable',
    siteScope: 'user-approved-exact-http-origin',
    requiredSiteGrant: 'exact-origin',
    runAt: 'document-idle',
    frames: 'top',
    defaultEnabled: false,
    domAccess: ['attributes', 'observers'],
    requiresMainWorld: false,
    settingsSchemaId: 'page-toolbox.free-page-edit',
    settingsSchemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
  },
  {
    schemaVersion: PAGE_TOOL_DESCRIPTOR_SCHEMA_VERSION,
    id: 'selection-copy-release',
    title: 'Selection and copy release',
    description: 'Release only explicitly selected selection, copy and context-menu blockers',
    siteScope: 'user-approved-exact-http-origin',
    requiredSiteGrant: 'exact-origin',
    runAt: 'document-idle',
    frames: 'top',
    defaultEnabled: false,
    domAccess: ['styles', 'listeners', 'owned-nodes'],
    requiresMainWorld: false,
    settingsSchemaId: 'page-toolbox.selection-copy-release',
    settingsSchemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
  },
  additionalDescriptor('element-spacing', 'Element spacing', 'Measure two explicitly chosen loaded elements using a local overlay', ['read', 'listeners', 'observers', 'owned-nodes']),
  additionalDescriptor('night-reading', 'Reading dimmer', 'Apply a reversible non-intercepting dimmer without changing the site theme', ['observers', 'owned-nodes']),
  additionalDescriptor('hidden-content', 'Loaded hidden content', 'Temporarily reveal a bounded set of existing visual elements', ['read', 'attributes', 'observers']),
  additionalDescriptor('selection-search', 'Selection search', 'Prepare bounded selected text for explicit npm or GitHub link activation', ['read', 'listeners', 'observers', 'owned-nodes']),
]

const schemas: readonly PageToolSettingsSchemaDefinitionV1[] = [
  {
    toolId: 'password-visibility',
    schemaId: 'page-toolbox.password-visibility',
    schemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
    validate: passwordSettings,
  },
  {
    toolId: 'free-page-edit',
    schemaId: 'page-toolbox.free-page-edit',
    schemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
    validate: editSettings,
  },
  {
    toolId: 'selection-copy-release',
    schemaId: 'page-toolbox.selection-copy-release',
    schemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
    validate: releaseSettings,
  },
  ...(['element-spacing', 'hidden-content', 'selection-search'] as const).map(toolId => ({
    toolId,
    schemaId: `page-toolbox.${toolId}`,
    schemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
    validate: emptySettings,
  })),
  {
    toolId: 'night-reading',
    schemaId: 'page-toolbox.night-reading',
    schemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
    validate: nightSettings,
  },
]

const catalog = createPageToolCatalog(descriptors, schemas)
if (!catalog.ok)
  throw new TypeError(`Invalid packaged Page Toolbox catalog: ${catalog.code}:${catalog.path}`)

export const PAGE_TOOL_CATALOG: PageToolCatalogV1 = catalog.value

export function isPageToolId(value: unknown): value is PageToolId {
  return typeof value === 'string' && (PAGE_TOOL_IDS as readonly string[]).includes(value)
}

export function getDefaultPageToolSettings(toolId: PageToolId): PageToolJsonValue {
  return structuredClone(defaultSettings[toolId])
}
