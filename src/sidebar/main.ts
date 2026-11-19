import type { Runtime } from 'webextension-polyfill'
import { storageModuleCapabilityCatalog } from '@oneweb/module-sdk'
import { SmartAppsClient } from '~/apps/protocol'
import { ASSISTANT_PORT } from '~/modules/builtin/assistant/contracts'
import { AssistantClient } from '~/modules/builtin/assistant/protocol'
import { BookmarkDoctorClient } from '~/modules/builtin/bookmark-doctor'
import { BrowserJournalClient } from '~/modules/builtin/browser-journal'
import { ClashControlClient } from '~/modules/builtin/clash-control'
import { CookieManagerClient } from '~/modules/builtin/cookie-manager/protocol'
import { NetworkManagementClient } from '~/modules/builtin/network-management/protocol'
import { PageToolboxClient } from '~/modules/builtin/page-toolbox'
import { RepoLensClient } from '~/modules/builtin/repolens/protocol'
import { SendToOpenListClient } from '~/modules/builtin/send-to-openlist'
import { DubbingClient } from '~/modules/builtin/video-dubbing/protocol'
import { type ContextSnapshot, createDefaultContextBroker } from '~/modules/context-broker'
import {
  type ContextSnapshotMessage,
  type ContextSubscriberReadyMessage,
  isContextRuntimeMessage,
} from '~/modules/context-protocol'
import { ModuleFrameHost } from '~/modules/frame-host'
import { ModuleManagementClient } from '~/modules/management-client'
import { StorageModuleClient } from '~/modules/storage-module-client'
import type { InstalledModuleRecord } from '~/modules/types'
import browser from '~/platform/browser'
import { resolveRepoLensInitFields } from '~/repolens/authorization'
import { createAssistantWorkspaceTransport } from '~/workspace/assistant-connection'
import { PageActionClient } from '~/workspace/page-actions'
import { PageContextClient } from '~/workspace/page-context'
import { TabSourceClient } from '~/workspace/tab-sources'
import { WorkspaceController, type WorkspaceSnapshot, WorkspaceView } from '~/workspace/workspace'
import { type AssistantMode, AssistantView } from './assistant-view'
import { ModuleManagementView } from './module-management-view'
import { RepoLensView } from './repolens-view'
import { SmartAppsView } from './smart-apps-view'
import './video-dubbing.css'
import './sidebar.css'
import './cookie-manager.css'
import './workspace.css'
import './network-management.css'
import './smart-apps.css'

const frame = document.querySelector<HTMLIFrameElement>('[data-testid="oneweb-module-frame"]')!
const bridgeState = document.querySelector<HTMLElement>('.bridge-state')!
const contextLabel = document.querySelector<HTMLElement>('[data-testid="current-context"]')!
const moduleName = document.querySelector<HTMLElement>('[data-testid="module-name"]')!
const moduleMark = document.querySelector<HTMLElement>('.brand-mark')!
const shell = document.querySelector<HTMLElement>('[data-testid="oneweb-side-panel"]')!
const moduleSurface = document.querySelector<HTMLElement>('[data-testid="module-surface"]')!
const managerSurface = document.querySelector<HTMLElement>('[data-testid="module-manager"]')!
const manageButton = document.querySelector<HTMLButtonElement>('[data-testid="manage-modules"]')!
const closeManagerButton = document.querySelector<HTMLButtonElement>('[data-testid="close-module-manager"]')!
const unavailable = document.querySelector<HTMLElement>('[data-testid="module-unavailable"]')!
const unavailableTitle = unavailable.querySelector<HTMLElement>('[data-unavailable-title]')!
const unavailableDescription = unavailable.querySelector<HTMLElement>('[data-unavailable-description]')!
const openManagerButton = unavailable.querySelector<HTMLButtonElement>('[data-open-module-manager]')!
const extensionOrigin = new URL(browser.runtime.getURL('/')).origin
const entryUrl = new URL(globalThis.location.href)
const requestedModuleId = entryUrl.hash.length > 1 ? null : entryUrl.searchParams.get('moduleId')
// The query is a one-shot browser action. Consume it before hash history starts,
// so later navigation/reload cannot reopen the original tool.
if (entryUrl.searchParams.has('moduleId')) {
  entryUrl.searchParams.delete('moduleId')
  history.replaceState(history.state, '', entryUrl.href)
}
const contextBroker = createDefaultContextBroker()
const managementClient = new ModuleManagementClient({
  sendMessage: message => browser.runtime.sendMessage(message),
  permissions: browser.permissions,
})
const browserJournalClient = new BrowserJournalClient({
  sendMessage: message => browser.runtime.sendMessage(message),
})
const cookieManagerClient = new CookieManagerClient({
  sendMessage: message => browser.runtime.sendMessage(message),
})
const bookmarkDoctorClient = new BookmarkDoctorClient({
  sendMessage: message => browser.runtime.sendMessage(message),
  permissions: browser.permissions,
})
const clashControlClient = new ClashControlClient(
  { sendMessage: message => browser.runtime.sendMessage(message) },
  browser.permissions,
)
const networkManagementClient = new NetworkManagementClient({
  sendMessage: message => browser.runtime.sendMessage(message),
})
const pageToolboxClient = new PageToolboxClient(
  { sendMessage: message => browser.runtime.sendMessage(message) },
  browser.permissions,
)
const sendToOpenListClient = new SendToOpenListClient(
  { sendMessage: message => browser.runtime.sendMessage(message) },
  browser.permissions,
)
const storageModuleClient = new StorageModuleClient({
  sendMessage: message => browser.runtime.sendMessage(message),
})
const contextRequest: ContextSubscriberReadyMessage = {
  channel: 'oneweb.context',
  version: 1,
  type: 'CONTEXT_SUBSCRIBER_READY',
}

let moduleHost: ModuleFrameHost | null = null
let currentSnapshot: ContextSnapshot | null = null
let activeRecord: InstalledModuleRecord | null = null
let managementView: ModuleManagementView | null = null
let renderedDestination: WorkspaceSnapshot['destination'] | '' = ''
let previousDestination: WorkspaceSnapshot['destination'] = 'assistant'
let workspaceInitialized = false
const workspaceRoot = document.querySelector<HTMLElement>('[data-testid="workspace"]')!
const workspace = new WorkspaceController({ storage: browser.storage.local, listModules: () => managementClient.list() })
const workspaceView = new WorkspaceView(workspaceRoot, workspace)
const assistantSurface = document.createElement('section')
let reportAssistantDisconnect: (() => void) | undefined
const assistantPort = createAssistantWorkspaceTransport(
  () => browser.runtime.connect({ name: ASSISTANT_PORT }),
  () => reportAssistantDisconnect?.(),
)
const pageContextClient = new PageContextClient(assistantPort)
const pageActionClient = new PageActionClient({ sendMessage: message => browser.runtime.sendMessage(message) })
const assistantView = new AssistantView(assistantSurface, {
  client: new AssistantClient(assistantPort),
  permissions: browser.permissions,
  onConversationOpen: () => workspace.open('assistant'),
  onDraftReturn: closeModuleManager,
  pageContext: pageContextClient,
  tabSources: new TabSourceClient(assistantPort),
  pageActions: pageActionClient,
})
reportAssistantDisconnect = () => assistantView.connectionLost()
const appsSurface = document.createElement('section')
const smartAppsView = new SmartAppsView(appsSurface, {
  client: new SmartAppsClient({ sendMessage: message => browser.runtime.sendMessage(message) }),
  assistant: new AssistantClient(assistantPort),
  page: pageContextClient,
  permissions: browser.permissions,
  sandboxUrl: browser.runtime.getURL('/sandbox.html'),
  openModule: id => workspace.open(`module:${id}`),
  setModuleEnabled: async (id, enabled) => {
    const result = await managementClient.setEnabled(id, enabled)
    if (!result.ok)
      throw new Error('无法更新模块状态')
  },
  settings: () => workspace.open('settings'),
})
workspaceView.setToolsRenderer((outlet, state) => {
  if (outlet.contains(appsSurface)) {
    smartAppsView.updateModules(state.modules)
    return
  }
  outlet.replaceChildren(appsSurface)
  void smartAppsView.open(state.modules)
})
let repoLensView: RepoLensView | null = null
moduleSurface.remove()
managerSurface.remove()

function setBridgeLabel(value: string, ready = false) {
  bridgeState.textContent = value
  bridgeState.dataset.ready = String(ready)
}

function updateModuleIdentity(record: InstalledModuleRecord) {
  moduleName.textContent = record.manifest.name
  moduleMark.textContent = record.manifest.name.slice(0, 1).toUpperCase()
  document.title = `OneWeb · ${record.manifest.name}`
}

function destroyModuleFrame() {
  moduleHost?.destroy()
  moduleHost = null
  frame.removeAttribute('src')
  frame.hidden = true
}

function showModuleUnavailable(record: InstalledModuleRecord | null, message: string) {
  destroyModuleFrame()
  activeRecord = record
  if (record) {
    updateModuleIdentity(record)
    contextLabel.textContent = record.enabled ? '模块当前不可用' : '模块已停用'
    unavailableTitle.textContent = `${record.manifest.name}${record.enabled ? ' 不可用' : ' 已停用'}`
  }
  else {
    moduleName.textContent = 'OneWeb'
    moduleMark.textContent = 'O'
    contextLabel.textContent = '尚无可用模块'
    unavailableTitle.textContent = '模块不可用'
  }
  unavailableDescription.textContent = message
  unavailable.hidden = false
  setBridgeLabel(record?.enabled ? '模块不可用' : '模块已停用')
}

function activateModule(record: InstalledModuleRecord) {
  if (!record.enabled) {
    showModuleUnavailable(record, '你可以在模块管理中重新启用它。')
    return
  }
  if (record.manifest.runtime !== 'remote-frame') {
    showModuleUnavailable(record, '该模块的运行入口尚未接入当前侧边栏。')
    return
  }

  destroyModuleFrame()
  activeRecord = record
  unavailable.hidden = true
  frame.hidden = false
  updateModuleIdentity(record)
  setBridgeLabel('正在建立安全桥接…')
  moduleHost = new ModuleFrameHost({
    frame,
    record,
    extensionOrigin,
    resolveInitFields: selected => resolveRepoLensInitFields(selected, extensionOrigin),
    onReady: () => setBridgeLabel('安全桥接已连接', true),
    onContextAccepted: message => setBridgeLabel(`已同步 ${message.contextLabel || '当前上下文'}`, true),
    onStatus: (message) => {
      setBridgeLabel(message.label || `${record.manifest.name} · ${message.state || '运行中'}`, true)
    },
    ...(record.manifest.capabilities.includes('storage.module')
      ? {
          capabilityRpc: {
            catalog: storageModuleCapabilityCatalog,
            openSession: binding => storageModuleClient.open(binding),
            createHandlers: binding => storageModuleClient.createHandlers(binding),
            closeSession: async (binding) => {
              await storageModuleClient.close(binding)
            },
          },
        }
      : {}),
  })
  moduleHost.start()
  sendCurrentContext()
  void requestCurrentContext()
}

function sendCurrentContext() {
  if (!moduleHost || !currentSnapshot)
    return
  moduleHost.updateContext(currentSnapshot)
}

function acceptContextSnapshot(message: ContextSnapshotMessage) {
  const snapshot = contextBroker.normalizeSnapshot(message.tabId, message.contexts)
  if (!snapshot)
    return
  snapshot.revision = message.revision
  currentSnapshot = snapshot
  const repository = snapshot.contexts['github.repository']
  repoLensView?.updateContext(typeof repository?.repo === 'string' ? repository.repo : null)
  if (moduleHost)
    contextLabel.textContent = typeof repository?.repo === 'string' ? repository.repo : '等待页面上下文'
  sendCurrentContext()
}

async function requestCurrentContext() {
  const response = await browser.runtime.sendMessage(contextRequest).catch(() => null)
  if (isContextRuntimeMessage(response) && response.type === 'CONTEXT_SNAPSHOT')
    acceptContextSnapshot(response)
}

function handleRuntimeMessage(message: unknown, sender: Runtime.MessageSender) {
  if (!sender.tab && isContextRuntimeMessage(message) && message.type === 'CONTEXT_SNAPSHOT')
    acceptContextSnapshot(message)
  return undefined
}

browser.runtime.onMessage.addListener(handleRuntimeMessage)

function openModuleManager() {
  void workspace.open('settings')
}

function closeModuleManager() {
  return workspace.open(previousDestination === 'settings' ? 'assistant' : previousDestination)
}

function createManagementView() {
  return new ModuleManagementView({
    root: managerSurface,
    client: managementClient,
    browserJournal: browserJournalClient,
    bookmarkDoctor: bookmarkDoctorClient,
    clashControl: clashControlClient,
    networkManagement: {
      client: networkManagementClient,
      permissions: browser.permissions,
      firefox: __FIREFOX__,
      openTest: () => browser.tabs.create({ url: 'https://webbrowsertools.com/test-webrtc-leak/' }),
    },
    pageToolbox: pageToolboxClient,
    sendToOpenList: sendToOpenListClient,
    videoDubbing: { client: new DubbingClient({ sendMessage: message => browser.runtime.sendMessage(message) }), permissions: browser.permissions },
    cookieManager: {
      client: cookieManagerClient,
      permissions: browser.permissions,
      firefox: __FIREFOX__,
    },
    onRecordChanged: (record) => {
      if (workspace.snapshot().destination === `module:${record.manifest.id}`)
        renderedDestination = ''
      void workspace.initialize().then(() => {
        if (record.manifest.id === activeRecord?.manifest.id && record.manifest.runtime === 'remote-frame')
          activateModule(record)
      })
    },
    onRecordRemoved: () => { void workspace.initialize() },
    onRecordInstalled: () => { void workspace.initialize() },
  })
}

async function renderDestination(state: WorkspaceSnapshot) {
  if (state.destination === renderedDestination)
    return
  if (workspaceInitialized && state.destination === 'settings' && renderedDestination)
    previousDestination = renderedDestination
  renderedDestination = state.destination
  if (state.destination !== 'tools')
    smartAppsView.dispose()
  repoLensView?.dispose()
  repoLensView = null
  destroyModuleFrame()
  activeRecord = null
  managementView?.dispose()
  managementView = null
  moduleSurface.hidden = true
  managerSurface.hidden = true
  assistantSurface.hidden = true
  manageButton.setAttribute('aria-expanded', String(state.destination === 'settings'))
  shell.dataset.view = state.destination.startsWith('module:') ? 'module' : 'workspace'
  moduleName.textContent = 'OneWeb'
  moduleMark.textContent = '✳'
  document.title = 'OneWeb · 你的浏览器工作区'
  setBridgeLabel('本机工作区', true)
  if (state.destination === 'tools')
    return
  workspaceView.outlet.replaceChildren()
  if (state.destination.startsWith('module:')) {
    const record = state.modules.find(candidate => `module:${candidate.manifest.id}` === state.destination)
    if (!record)
      return
    updateModuleIdentity(record)
    if (!record.enabled && (record.manifest.runtime === 'remote-frame' || record.manifest.id === 'dev.juck.repolens')) {
      workspaceView.outlet.append(moduleSurface)
      moduleSurface.hidden = false
      showModuleUnavailable(record, '你可以在应用列表或模块管理中重新启用它。')
    }
    else if (record.manifest.runtime === 'builtin' && record.manifest.id === 'dev.juck.repolens') {
      const surface = document.createElement('section')
      workspaceView.outlet.append(surface)
      repoLensView = new RepoLensView(surface, {
        client: new RepoLensClient({ sendMessage: message => browser.runtime.sendMessage(message) }),
        permissions: browser.permissions,
      })
      await repoLensView.open()
      const repository = currentSnapshot?.contexts['github.repository']
      repoLensView?.updateContext(typeof repository?.repo === 'string' ? repository.repo : null)
      setBridgeLabel('本机应用', true)
    }
    else if (record.manifest.runtime === 'remote-frame') {
      workspaceView.outlet.append(moduleSurface)
      moduleSurface.hidden = false
      activateModule(record)
    }
    else {
      workspaceView.outlet.append(managerSurface)
      managerSurface.hidden = false
      managerSurface.dataset.surface = 'tool'
      managerSurface.querySelector<HTMLElement>('.manager-heading')!.hidden = true
      managementView = createManagementView()
      await managementView.openTool(record.manifest.id)
    }
    return
  }
  workspaceView.outlet.append(assistantSurface)
  assistantSurface.hidden = false
  await assistantView.open(state.destination as AssistantMode)
  if (state.destination === 'settings' && workspace.snapshot().destination === 'settings') {
    workspaceView.outlet.append(managerSurface)
    managerSurface.hidden = false
    managerSurface.dataset.surface = 'settings'
    managerSurface.querySelector<HTMLElement>('.manager-heading')!.hidden = false
    managementView = createManagementView()
    await managementView.openSettings()
  }
}
workspace.subscribe((state) => {
  void renderDestination(state)
})

browser.permissions.onRemoved.addListener((permissions) => {
  if (permissions.permissions?.includes('cookies') || permissions.origins?.length)
    managementView?.clearCookieSession()
  if (permissions.permissions?.includes('bookmarks') || permissions.origins?.length)
    void managementView?.refresh({ preserveFeedback: true })
})

browser.tabs.onActivated.addListener(() => {
  void smartAppsView.pageChanged()
  managementView?.clearCurrentCookieSession()
  void assistantView.refreshCurrentPage()
  void pageContextClient.currentPage().then((page) => {
    if (!moduleHost)
      contextLabel.textContent = page.title || '当前网页'
  }).catch(() => {
    if (!moduleHost)
      contextLabel.textContent = '你的浏览器工作区'
  })
})
browser.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url)
    void smartAppsView.pageChanged()
  if (change.url)
    managementView?.clearCurrentCookieSession()
  if (change.url)
    void assistantView.refreshCurrentPage()
})
browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local')
    return
  try {
    if (changes['oneweb.smart-apps.v1'])
      await smartAppsView.libraryChanged()
    if (!changes['oneweb.modules.v1'])
      return
    const records: unknown = changes['oneweb.modules.v1'].newValue
    if (Array.isArray(records) && records.some(record => record?.manifest?.id === 'dev.oneweb.cookie-manager' && !record.enabled))
      managementView?.clearCookieSession()
    if (repoLensView && Array.isArray(records) && records.some(record => record?.manifest?.id === 'dev.juck.repolens' && !record.enabled)) {
      repoLensView.dispose()
      repoLensView = null
      renderedDestination = ''
    }
    await workspace.initialize()
  }
  catch {
    contextLabel.textContent = '工具列表更新失败，请刷新重试。'
  }
})

manageButton.addEventListener('click', () => workspace.snapshot().destination === 'settings' ? closeModuleManager() : openModuleManager())
closeManagerButton.addEventListener('click', closeModuleManager)
openManagerButton.addEventListener('click', openModuleManager)

async function initialize() {
  await workspaceView.initialize()
  workspaceInitialized = true
  if (requestedModuleId && requestedModuleId.length <= 128
    && workspace.snapshot().modules.some(record => record.manifest.id === requestedModuleId)) {
    await workspace.open(`module:${requestedModuleId}`)
  }
  await requestCurrentContext()
  const handoff = new URL(globalThis.location.href).searchParams.get('handoff')
  if (handoff) {
    const draft = await pageActionClient.handoff(handoff)
    await workspace.open(draft.intent === 'translate' ? 'translation' : draft.intent === 'summarize' ? 'reading' : 'assistant')
    await assistantView.acceptDraft(draft)
    await workspaceView.navigate(workspace.snapshot().destination, true)
    history.replaceState(history.state, '', `${browser.runtime.getURL('/sidebar.html')}${location.hash}`)
  }
}

document.querySelector('[data-testid="new-conversation"]')?.addEventListener('click', () => {
  void assistantView.newConversation().then(() => workspace.open('assistant'))
})
document.querySelector('[data-testid="open-workspace-tab"]')?.addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/sidebar.html') })
})
window.addEventListener('pagehide', () => {
  assistantView.dispose()
  smartAppsView.dispose()
  repoLensView?.dispose()
  assistantPort.disconnect()
  managementView?.dispose()
  destroyModuleFrame()
  workspaceView.dispose()
  workspace.dispose()
  browser.runtime.onMessage.removeListener(handleRuntimeMessage)
}, { once: true })
void initialize().catch(() => {
  contextLabel.textContent = '工作区初始化失败，请刷新重试。'
})
