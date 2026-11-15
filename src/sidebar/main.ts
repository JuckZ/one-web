import type { Runtime } from 'webextension-polyfill'
import { storageModuleCapabilityCatalog } from '@oneweb/module-sdk'
import { ASSISTANT_PORT } from '~/modules/builtin/assistant/contracts'
import { AssistantClient } from '~/modules/builtin/assistant/protocol'
import { BookmarkDoctorClient } from '~/modules/builtin/bookmark-doctor'
import { BrowserJournalClient } from '~/modules/builtin/browser-journal'
import { ClashControlClient } from '~/modules/builtin/clash-control'
import { CookieManagerClient } from '~/modules/builtin/cookie-manager/protocol'
import { NetworkManagementClient } from '~/modules/builtin/network-management/protocol'
import { PageToolboxClient } from '~/modules/builtin/page-toolbox'
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
import { PageActionClient } from '~/workspace/page-actions'
import { PageContextClient } from '~/workspace/page-context'
import { WorkspaceController, type WorkspaceSnapshot, WorkspaceView } from '~/workspace/workspace'
import { type AssistantMode, AssistantView } from './assistant-view'
import { ModuleManagementView } from './module-management-view'
import './video-dubbing.css'
import './sidebar.css'
import './cookie-manager.css'
import './workspace.css'
import './network-management.css'

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
const requestedModuleId = new URL(globalThis.location.href).searchParams.get('moduleId')
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
let renderedDestination = ''
let previousDestination: WorkspaceSnapshot['destination'] = 'assistant'
const workspaceRoot = document.querySelector<HTMLElement>('[data-testid="workspace"]')!
const workspace = new WorkspaceController({ storage: browser.storage.local, listModules: () => managementClient.list() })
const workspaceView = new WorkspaceView(workspaceRoot, workspace)
const assistantSurface = document.createElement('section')
const pageContextClient = new PageContextClient({ sendMessage: message => browser.runtime.sendMessage(message) })
const pageActionClient = new PageActionClient({ sendMessage: message => browser.runtime.sendMessage(message) })
const assistantView = new AssistantView(assistantSurface, {
  client: new AssistantClient({ sendMessage: message => browser.runtime.sendMessage(message) }),
  permissions: browser.permissions,
  onConversationOpen: () => workspace.open('assistant'),
  pageContext: pageContextClient,
  pageActions: pageActionClient,
})
const assistantPort = browser.runtime.connect({ name: ASSISTANT_PORT })
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
  if (workspace.snapshot().destination !== 'settings')
    previousDestination = workspace.snapshot().destination
  void workspace.open('settings')
}

function closeModuleManager() {
  void workspace.open(previousDestination === 'settings' ? 'assistant' : previousDestination)
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
  renderedDestination = state.destination
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
    if (record.manifest.runtime === 'remote-frame') {
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
    void managementView?.refresh()
})

browser.tabs.onActivated.addListener(() => {
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
    managementView?.clearCurrentCookieSession()
  if (change.url)
    void assistantView.refreshCurrentPage()
})
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes['oneweb.modules.v1'])
    return
  const records: unknown = changes['oneweb.modules.v1'].newValue
  if (Array.isArray(records) && records.some(record => record?.manifest?.id === 'dev.oneweb.cookie-manager' && !record.enabled))
    managementView?.clearCookieSession()
})

manageButton.addEventListener('click', () => workspace.snapshot().destination === 'settings' ? closeModuleManager() : openModuleManager())
closeManagerButton.addEventListener('click', closeModuleManager)
openManagerButton.addEventListener('click', openModuleManager)

async function initialize() {
  await workspaceView.initialize()
  if (requestedModuleId && requestedModuleId.length <= 128)
    await workspace.open(`module:${requestedModuleId}`)
  await requestCurrentContext()
  const handoff = new URL(globalThis.location.href).searchParams.get('handoff')
  if (handoff) {
    const draft = await pageActionClient.handoff(handoff)
    await workspace.open(draft.intent === 'translate' ? 'translation' : draft.intent === 'summarize' ? 'reading' : 'assistant')
    await assistantView.acceptDraft(draft)
    history.replaceState(null, '', browser.runtime.getURL('/dist/sidebar/index.html'))
  }
}

document.querySelector('[data-testid="new-conversation"]')?.addEventListener('click', () => {
  void assistantView.newConversation().then(() => workspace.open('assistant'))
})
document.querySelector('[data-testid="open-workspace-tab"]')?.addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/dist/sidebar/index.html') })
})
window.addEventListener('pagehide', () => {
  assistantView.dispose()
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
