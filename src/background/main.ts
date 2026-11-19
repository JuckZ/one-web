import type { Runtime } from 'webextension-polyfill'
import { SmartAppsController } from '~/apps/controller'
import { handleSmartAppsMessage } from '~/apps/protocol'
import { PAGE_CHANNEL } from '~/assistantContent/runtime'
import { ASSISTANT_PORT } from '~/modules/builtin/assistant/contracts'
import { AssistantController } from '~/modules/builtin/assistant/controller'
import { handleAssistantMessage } from '~/modules/builtin/assistant/protocol'
import {
  BookmarkDoctorController,
  BookmarkDoctorReader,
  BookmarkScanCoordinator,
  BookmarkUrlProbe,
  createBookmarkDoctorResponse,
  createBookmarkDoctorStateStore,
  createBrowserBookmarkMutationBoundary,
  createBrowserBookmarkTreeReader,
  isBookmarkDoctorRequest,
} from '~/modules/builtin/bookmark-doctor'
import {
  BrowserJournalController,
  createBrowserJournalArchiveStore,
  createBrowserJournalResponse,
  createBrowserJournalTabEventSource,
  isBrowserJournalRequest,
} from '~/modules/builtin/browser-journal'
import {
  ClashControlController,
  createClashControllerProfileStore,
  createClashControlResponse,
  isClashControlRequest,
} from '~/modules/builtin/clash-control'
import type { CookieBrowserBoundary } from '~/modules/builtin/cookie-manager/contracts'
import { COOKIE_MANAGER_MODULE_ID } from '~/modules/builtin/cookie-manager/contracts'
import { CookieManagerController } from '~/modules/builtin/cookie-manager/controller'
import { handleCookieManagerMessage } from '~/modules/builtin/cookie-manager/protocol'
import { type NetworkControllerOptions, NetworkManagementController } from '~/modules/builtin/network-management/controller'
import { handleNetworkManagementMessage } from '~/modules/builtin/network-management/protocol'
import { BuiltinExactOriginUsageCoordinator } from '~/modules/builtin/origin-usage'
import {
  createPageToolboxInjectionAdapter,
  createPageToolboxStateStore,
  isPageToolboxManagementRequest,
  PageToolboxController,
  type PageToolboxHostPort,
  type PageToolboxScriptingApi,
} from '~/modules/builtin/page-toolbox'
import { RepoLensController } from '~/modules/builtin/repolens/controller'
import { handleRepoLensMessage } from '~/modules/builtin/repolens/protocol'
import {
  createSendToOpenListProfileStore,
  createSendToOpenListResponse,
  isSendToOpenListRequest,
  SendToOpenListContextMenuController,
  type SendToOpenListContextMenuInfo,
  type SendToOpenListContextMenusBoundary,
  SendToOpenListController,
  SendToOpenListDiscoveryController,
  type SendToOpenListDiscoveryScriptingBoundary,
  type SendToOpenListDiscoveryTab,
} from '~/modules/builtin/send-to-openlist'
import { DUBBING_PORT, VIDEO_DUBBING_MODULE_ID } from '~/modules/builtin/video-dubbing/contracts'
import { VideoDubbingController } from '~/modules/builtin/video-dubbing/controller'
import type { DubbingPort } from '~/modules/builtin/video-dubbing/controller'
import { createDubbingInjection } from '~/modules/builtin/video-dubbing/injection'
import type { DubbingScripting } from '~/modules/builtin/video-dubbing/injection'
import { handleDubbingMessage } from '~/modules/builtin/video-dubbing/protocol'
import { type ContextSnapshot, createDefaultContextBroker } from '~/modules/context-broker'
import {
  createContextSnapshotMessage,
  isContextRuntimeMessage,
} from '~/modules/context-protocol'
import { defaultModuleRegistry, initializeDefaultModuleRegistry } from '~/modules/default-registry'
import { ModuleInstaller } from '~/modules/installer'
import {
  isModuleManagementRequest,
  isTrustedModuleManagementSender,
} from '~/modules/management-protocol'
import { ModuleManager } from '~/modules/manager'
import { StorageModuleAdapter } from '~/modules/storage-module-adapter'
import { StorageModuleController } from '~/modules/storage-module-controller'
import { validateStorageModuleProtocolRequest } from '~/modules/storage-module-protocol'
import browser from '~/platform/browser'
import { handlePageActionMessage, PageActionController } from '~/workspace/page-actions'
import { handlePageContextMessage, PageContextController } from '~/workspace/page-context'
import { createPageContextInjection, type PageScripting } from '~/workspace/page-injection'
import { VideoReadingController } from '~/workspace/video-reading'
import { VisionController } from '~/workspace/vision'
import { configureChromiumActionEntry } from './browser-action-entry'
import { getNetworkPrivacy } from './network-privacy'

export function initializeBackground() {
  const contextBroker = createDefaultContextBroker()
  const builtinOriginUsage = new BuiltinExactOriginUsageCoordinator()
  let assistantController: AssistantController
  const assistantInjection = createPageContextInjection((browser as unknown as { scripting: PageScripting }).scripting, browser.tabs)
  const pageContextController = new PageContextController({
    tabs: browser.tabs,
    permissions: browser.permissions,
    injection: assistantInjection,
    get assistant() { return assistantController },
    fallbackPage: async () => (await browser.tabs.query({ currentWindow: true }))
      .filter(tab => /^https?:\/\//.test(tab.url ?? ''))
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0],
  })
  const sessionEntries: Record<string, unknown> = {}
  const smartAppsController = new SmartAppsController({ storage: browser.storage.local })
  const repoLensController = new RepoLensController({
    storage: browser.storage.local,
    secrets: browser.storage.session ?? {
      get: async key => ({ [key]: sessionEntries[key] }),
      set: async (values) => { Object.assign(sessionEntries, values) },
    },
    permissions: browser.permissions,
    enabled: async () => {
      const record = await defaultModuleRegistry.get('dev.juck.repolens')
      return record?.enabled === true && record.manifest.runtime === 'builtin'
    },
  })
  assistantController = new AssistantController({
    storage: browser.storage.local,
    secrets: browser.storage.session ?? {
      get: async key => ({ [key]: sessionEntries[key] }),
      set: async (values) => { Object.assign(sessionEntries, values) },
    },
    permissions: browser.permissions,
    resolveAttachment: (token, owner) => pageContextController.resolveAttachment(token, owner),
  })
  const videoReadingController = new VideoReadingController({
    page: pageContextController,
    permissions: browser.permissions,
    injection: assistantInjection,
    assistant: assistantController,
    discovery: createDubbingInjection((browser as unknown as { scripting: DubbingScripting }).scripting, browser.tabs),
  })
  const visionController = new VisionController({
    storage: browser.storage.local,
    secrets: browser.storage.session ?? {
      get: async key => ({ [key]: sessionEntries[key] }),
      set: async (values) => { Object.assign(sessionEntries, values) },
    },
    tabs: browser.tabs,
    permissions: browser.permissions,
    injection: assistantInjection,
  })
  const pageActionController = new PageActionController({
    storage: browser.storage.local,
    permissions: browser.permissions,
    injection: assistantInjection,
    pageContext: pageContextController,
    assistant: assistantController,
    openWorkspace: token => browser.tabs.create({ url: `${browser.runtime.getURL('/sidebar.html')}?handoff=${encodeURIComponent(token)}` }),
    openTool: moduleId => browser.tabs.create({ url: `${browser.runtime.getURL('/sidebar.html')}?moduleId=${encodeURIComponent(moduleId)}` }),
    openWeb: url => browser.tabs.create({ url }),
    video: videoReadingController,
    vision: visionController,
  })
  for (const area of [browser.storage.local, browser.storage.session]) {
    const trusted = area as typeof area & { setAccessLevel?: (_options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void> }
    void trusted?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  }
  builtinOriginUsage.register('assistant', pattern => assistantController.usesOriginPattern(pattern))
  builtinOriginUsage.register('vision', pattern => visionController.usesOriginPattern(pattern))
  builtinOriginUsage.register('repolens', async pattern => pattern === 'https://api.github.com/*'
    && (await defaultModuleRegistry.get('dev.juck.repolens'))?.enabled === true)
  builtinOriginUsage.register('page-assistant', async (pattern) => {
    const preferences = await pageActionController.readPreferences()
    return preferences.enabled && preferences.sites.some(site => site.enabled && `${site.origin}/*` === pattern)
  })
  const moduleInstaller = new ModuleInstaller({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    hostVersion: browser.runtime.getManifest().version,
    originInUse: originPattern => builtinOriginUsage.usedByAnother('remote-modules', originPattern),
  })
  const storageModuleAdapter = new StorageModuleAdapter({
    registry: defaultModuleRegistry,
    storage: browser.storage.local,
  })
  const storageModuleController = new StorageModuleController(storageModuleAdapter)
  const bookmarkDoctorScanner = new BookmarkScanCoordinator({
    probe: new BookmarkUrlProbe(),
  })
  const browserJournalController = new BrowserJournalController({
    registry: defaultModuleRegistry,
    events: createBrowserJournalTabEventSource(browser.tabs),
    archive: createBrowserJournalArchiveStore(browser.storage.local),
  })
  const cookieManagerController = new CookieManagerController({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    tabs: browser.tabs,
    firefox: __FIREFOX__,
    cookies: {
      getAllCookieStores: () => (browser.cookies as unknown as CookieBrowserBoundary).getAllCookieStores(),
      getAll: details => (browser.cookies as unknown as CookieBrowserBoundary).getAll(details),
      get: details => (browser.cookies as unknown as CookieBrowserBoundary).get(details),
      set: details => (browser.cookies as unknown as CookieBrowserBoundary).set(details),
      remove: details => (browser.cookies as unknown as CookieBrowserBoundary).remove(details),
    },
  })
  const bookmarkDoctorController = new BookmarkDoctorController({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    reader: new BookmarkDoctorReader({
      registry: defaultModuleRegistry,
      permissions: browser.permissions,
      bookmarks: createBrowserBookmarkTreeReader(browser.bookmarks),
    }),
    scanner: bookmarkDoctorScanner,
    repair: {
      bookmarks: createBrowserBookmarkMutationBoundary(browser.bookmarks),
      state: createBookmarkDoctorStateStore(browser.storage.local),
    },
  })
  const clashControlController = new ClashControlController({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    profileStore: createClashControllerProfileStore(browser.storage.local),
    originInUse: originPattern => builtinOriginUsage.usedByAnother('clash-control', originPattern),
  })
  const networkManagementController = new NetworkManagementController({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    storage: browser.storage.local,
    get privacy() {
      return getNetworkPrivacy()
    },
    scripting: browser.scripting as unknown as NetworkControllerOptions['scripting'],
  })
  const pageToolboxController = new PageToolboxController({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    tabs: browser.tabs,
    injection: createPageToolboxInjectionAdapter(
      (browser as unknown as { scripting: PageToolboxScriptingApi }).scripting,
    ),
    state: createPageToolboxStateStore(browser.storage.local),
    extensionId: browser.runtime.id,
    originInUse: originPattern => builtinOriginUsage.usedByAnother('page-toolbox', originPattern),
  })
  const sendToOpenListController = new SendToOpenListController({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    store: createSendToOpenListProfileStore(browser.storage.local),
    originInUse: originPattern => builtinOriginUsage.usedByAnother('send-to-openlist', originPattern),
  })
  const sendToOpenListDiscovery = new SendToOpenListDiscoveryController({
    registry: defaultModuleRegistry,
    tabs: browser.tabs,
    scripting: (browser as unknown as { scripting: SendToOpenListDiscoveryScriptingBoundary }).scripting,
  })
  const sendToOpenListContextMenus = new SendToOpenListContextMenuController(
    browser.contextMenus as unknown as SendToOpenListContextMenusBoundary,
    sendToOpenListDiscovery,
  )
  builtinOriginUsage.register('bookmark-doctor', originPattern => bookmarkDoctorController.usesOriginPattern(originPattern))
  builtinOriginUsage.register('clash-control', originPattern => clashControlController.usesOriginPattern(originPattern))
  builtinOriginUsage.register('network-management', originPattern => networkManagementController.usesOriginPattern(originPattern))
  builtinOriginUsage.register('page-toolbox', originPattern => pageToolboxController.usesOriginPattern(originPattern))
  builtinOriginUsage.register('send-to-openlist', originPattern => sendToOpenListController.usesOriginPattern(originPattern))
  builtinOriginUsage.register('cookie-manager', originPattern => cookieManagerController.usesOriginPattern(originPattern))
  bookmarkDoctorController.setOriginInUse(
    originPattern => builtinOriginUsage.usedByAnother('bookmark-doctor', originPattern),
  )
  const videoDubbingController = new VideoDubbingController({
    extensionId: browser.runtime.id,
    registry: defaultModuleRegistry,
    storage: browser.storage.local,
    tabs: browser.tabs,
    permissions: browser.permissions,
    injection: createDubbingInjection((browser as unknown as { scripting: DubbingScripting }).scripting, browser.tabs),
    originInUse: pattern => builtinOriginUsage.usedByAnother('video-dubbing', pattern),
  })
  builtinOriginUsage.register('video-dubbing', pattern => videoDubbingController.usesOriginPattern(pattern))
  const moduleManager = new ModuleManager(defaultModuleRegistry, moduleInstaller, {
    onInstalledRecordChanged: async (record) => {
      if (record.manifest.id === 'dev.juck.repolens' && !record.enabled)
        repoLensController.invalidate()
      if (record.manifest.id === VIDEO_DUBBING_MODULE_ID)
        videoDubbingController.invalidate()
      if (record.manifest.id === COOKIE_MANAGER_MODULE_ID)
        cookieManagerController.invalidate()
      await storageModuleAdapter.handleInstalledRecordChanged(record.manifest.id)
      browserJournalController.handleInstalledRecordChanged(record)
      bookmarkDoctorController.handleInstalledRecordChanged(record)
      await clashControlController.handleInstalledRecordChanged(record)
      const networkLifecycle = await networkManagementController.handleInstalledRecordChanged(record)
      if (networkLifecycle && !networkLifecycle.ok)
        throw new Error('network-cleanup-failed')
      pageToolboxController.handleInstalledRecordChanged(record)
      await sendToOpenListController.handleInstalledRecordChanged(record)
      sendToOpenListDiscovery.handleInstalledRecordChanged(record)
      await sendToOpenListContextMenus.syncRecord(record)
    },
    onInstalledRecordRemoved: record => storageModuleAdapter.removeInstalledRecord(record.manifest.id),
  })
  const extensionBaseUrl = browser.runtime.getURL('/')
  let currentWindowId: number | undefined
  void browser.windows.getCurrent().then((window) => {
    currentWindowId = window.id
  }).catch(() => {
  })

  void initializeDefaultModuleRegistry()
    .then(async () => {
      const sendRecord = await defaultModuleRegistry.get('dev.oneweb.send-to-openlist')
      await Promise.all([
        browserJournalController.startup(),
        clashControlController.startup(),
        networkManagementController.startup(),
        pageToolboxController.startup(),
        sendToOpenListController.startup(),
        sendToOpenListContextMenus.initialize(Boolean(sendRecord?.enabled)),
      ])
    })
    .catch((error) => {
      console.error('Failed to initialize the OneWeb module registry', error)
    })

  async function activeTabContext() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined)
      return null
    if (tab.url)
      contextBroker.updateFromUrl(tab.id, tab.url)
    return contextBroker.getSnapshot(tab.id)
  }

  async function broadcastContext(snapshot: ContextSnapshot) {
    await browser.runtime.sendMessage(createContextSnapshotMessage(snapshot)).catch(() => undefined)
  }

  async function updateTabContext(tabId: number, href: string | undefined) {
    if (!href)
      return
    const snapshot = contextBroker.updateFromUrl(tabId, href)
    if (snapshot)
      await broadcastContext(snapshot)
  }

  browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
    const appsResponse = handleSmartAppsMessage(smartAppsController, message, sender, browser.runtime.id, extensionBaseUrl)
    if (appsResponse)
      return appsResponse
    const repoLensResponse = handleRepoLensMessage(repoLensController, message, sender, browser.runtime.id, extensionBaseUrl)
    if (repoLensResponse)
      return repoLensResponse
    const networkResponse = handleNetworkManagementMessage(networkManagementController, message, sender, browser.runtime.id, extensionBaseUrl)
    if (networkResponse)
      return networkResponse
    const pageActionResponse = handlePageActionMessage(pageActionController, message, sender, browser.runtime.id, extensionBaseUrl)
    if (pageActionResponse)
      return pageActionResponse
    const assistantResponse = handleAssistantMessage(assistantController, message, sender, browser.runtime.id, extensionBaseUrl)
    if (assistantResponse)
      return assistantResponse
    const pageResponse = handlePageContextMessage(pageContextController, message, sender, browser.runtime.id, extensionBaseUrl)
    if (pageResponse)
      return pageResponse
    const dubbingResponse = handleDubbingMessage(videoDubbingController, message, sender, browser.runtime.id, extensionBaseUrl)
    if (dubbingResponse)
      return dubbingResponse
    const cookieResponse = handleCookieManagerMessage(
      cookieManagerController,
      message,
      sender,
      browser.runtime.id,
      extensionBaseUrl,
    )
    if (cookieResponse)
      return cookieResponse
    if (isSendToOpenListRequest(message)) {
      if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
        return undefined
      if (message.type === 'SEND_TO_OPENLIST_PREPARE') {
        return sendToOpenListController.prepare(message.profile).then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_CONNECT') {
        return sendToOpenListController.connect(message.preparation, message.token).then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_STATUS') {
        return sendToOpenListController.status().then(result => createSendToOpenListResponse(
          message.type,
          { ok: true, value: result },
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_DISCOVER_TOOLS') {
        return sendToOpenListController.discoverTools(message.destinationPath).then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_SUBMIT') {
        return sendToOpenListController.submit(
          message.candidates,
          message.destinationPath,
          message.tool,
        ).then(result => createSendToOpenListResponse(message.type, result))
      }
      if (message.type === 'SEND_TO_OPENLIST_LIST_TASKS') {
        return sendToOpenListController.listTasks(message.list).then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_PREPARE_CANCEL') {
        return sendToOpenListController.prepareCancel(message.taskId).then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_CONFIRM_CANCEL') {
        return sendToOpenListController.confirmCancel(message.token).then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_DISCOVERY_STATUS') {
        return sendToOpenListDiscovery.status().then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_CAPTURE_CURRENT_PAGE') {
        return sendToOpenListDiscovery.captureCurrentPage().then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_SCAN_CURRENT_PAGE') {
        return sendToOpenListDiscovery.scanCurrentPage().then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_CLEAR_DISCOVERY') {
        return sendToOpenListDiscovery.clear().then(result => createSendToOpenListResponse(
          message.type,
          result,
        ))
      }
      if (message.type === 'SEND_TO_OPENLIST_DELETE_PROFILE') {
        return sendToOpenListController.deleteProfile().then(result => createSendToOpenListResponse(
          message.type,
          { ok: true, value: result },
        ))
      }
      return sendToOpenListController.disconnect().then(result => createSendToOpenListResponse(
        message.type,
        { ok: true, value: result },
      ))
    }

    if (isPageToolboxManagementRequest(message)) {
      if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
        return undefined
      return pageToolboxController.handle(message)
    }

    const storageModuleRequest = validateStorageModuleProtocolRequest(message)
    if (storageModuleRequest) {
      if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
        return undefined
      return storageModuleController.handle(storageModuleRequest)
    }

    if (isBrowserJournalRequest(message)) {
      if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
        return undefined
      if (message.type === 'BROWSER_JOURNAL_START') {
        return browserJournalController.start().then(result => createBrowserJournalResponse(
          message.type,
          { operation: 'start', ...result },
        ))
      }
      if (message.type === 'BROWSER_JOURNAL_STATUS') {
        return Promise.resolve(createBrowserJournalResponse(message.type, {
          ok: true,
          operation: 'status',
          snapshot: browserJournalController.status(),
        }))
      }
      if (message.type === 'BROWSER_JOURNAL_ARCHIVE') {
        return browserJournalController.archiveState().then(result => createBrowserJournalResponse(
          message.type,
          { operation: 'archive', ...result },
        ))
      }
      if (message.type === 'BROWSER_JOURNAL_SAVE') {
        return browserJournalController.save().then(result => createBrowserJournalResponse(
          message.type,
          { operation: 'save', ...result },
        ))
      }
      if (message.type === 'BROWSER_JOURNAL_DELETE_SAVED') {
        return browserJournalController.deleteSavedSession(message.savedSessionId).then(result => createBrowserJournalResponse(
          message.type,
          { operation: 'delete-saved', ...result },
        ))
      }
      if (message.type === 'BROWSER_JOURNAL_CLEAR_SAVED') {
        return browserJournalController.clearArchive(message.confirmation).then(result => createBrowserJournalResponse(
          message.type,
          { operation: 'clear-saved', ...result },
        ))
      }
      return Promise.resolve(createBrowserJournalResponse(message.type, {
        operation: 'stop',
        ...browserJournalController.stop(),
      }))
    }

    if (isClashControlRequest(message)) {
      if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
        return undefined
      if (message.type === 'CLASH_CONTROL_PREPARE') {
        return clashControlController.prepare(message.controllerUrl).then(result => createClashControlResponse(
          message.type,
          { operation: 'prepare', ...result },
        ))
      }
      if (message.type === 'CLASH_CONTROL_CONNECT') {
        return clashControlController.connect({
          token: message.token,
          generation: message.generation,
          controllerOrigin: message.controllerOrigin,
          originPattern: message.originPattern,
          expiresAt: message.expiresAt,
        }, message.secret).then(result => createClashControlResponse(
          message.type,
          { operation: 'connect', ...result },
        ))
      }
      if (message.type === 'CLASH_CONTROL_STATUS') {
        return Promise.all([
          clashControlController.status(),
          clashControlController.readStatus(),
        ]).then(([connection, readState]) => createClashControlResponse(message.type, {
          ok: true,
          operation: 'status',
          connection,
          status: connection.phase === 'connected' ? connection.status : null,
          readState,
        }))
      }
      if (message.type === 'CLASH_CONTROL_REFRESH') {
        return clashControlController.refresh().then(result => createClashControlResponse(
          message.type,
          { operation: 'refresh', ...result },
        ))
      }
      if (message.type === 'CLASH_CONTROL_PREPARE_PROXY_SWITCH') {
        return clashControlController.prepareProxySwitch(
          message.groupName,
          message.targetNode,
        ).then(result => createClashControlResponse(
          message.type,
          { operation: 'prepare-proxy-switch', ...result },
        ))
      }
      if (message.type === 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH') {
        return clashControlController.confirmProxySwitch(message.token).then(result => createClashControlResponse(
          message.type,
          { operation: 'confirm-proxy-switch', ...result },
        ))
      }
      return clashControlController.disconnect().then(result => createClashControlResponse(
        message.type,
        { operation: 'disconnect', ...result },
      ))
    }

    if (isBookmarkDoctorRequest(message)) {
      if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
        return undefined
      if (message.type === 'BOOKMARK_DOCTOR_AUTHORIZE') {
        return bookmarkDoctorController.authorize().then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'authorize', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_PREPARE') {
        return bookmarkDoctorController.prepare().then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'prepare', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_START') {
        return bookmarkDoctorController.start(message.token).then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'start', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_STATUS') {
        return Promise.resolve(createBookmarkDoctorResponse(message.type, {
          ok: true,
          operation: 'status',
          snapshot: bookmarkDoctorController.status(),
        }))
      }
      if (message.type === 'BOOKMARK_DOCTOR_AUTHORIZE_REPAIRS') {
        return bookmarkDoctorController.authorizeRepairs().then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'authorize-repairs', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_PREPARE_REPAIR') {
        return bookmarkDoctorController.prepareRepair(message.request).then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'prepare-repair', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS') {
        return bookmarkDoctorController.confirmRepairs(message.confirmations).then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'confirm-repairs', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_WORKSPACE_STATE') {
        return bookmarkDoctorController.workspaceState().then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'workspace-state', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_UNIGNORE') {
        return bookmarkDoctorController.unignore(message.bookmarkId).then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'unignore', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_CLEAR_LOCAL_DATA') {
        return bookmarkDoctorController.clearLocalData(message.confirmation).then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'clear-local-data', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_PREPARE_RESTORE') {
        return bookmarkDoctorController.prepareRestore(message.backupToken).then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'prepare-restore', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_CONFIRM_RESTORE') {
        return bookmarkDoctorController.confirmRestore(message.confirmation).then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'confirm-restore', ...result },
        ))
      }
      if (message.type === 'BOOKMARK_DOCTOR_REVOKE') {
        return bookmarkDoctorController.revoke().then(result => createBookmarkDoctorResponse(
          message.type,
          { operation: 'revoke', ...result },
        ))
      }
      return bookmarkDoctorController.stop().then(result => createBookmarkDoctorResponse(message.type, {
        ok: true,
        operation: 'stop',
        ...result,
      }))
    }

    if (isModuleManagementRequest(message)) {
      if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
        return undefined
      return moduleManager.handle(message)
    }

    if (!isContextRuntimeMessage(message))
      return undefined

    if (message.type === 'CONTEXT_PROVIDER_UPDATE') {
      const tabId = sender.tab?.id
      if (tabId === undefined)
        return undefined
      const snapshot = contextBroker.updateFromSource(tabId, message.contextId, message.value, sender.url)
      if (!snapshot)
        return undefined
      void broadcastContext(snapshot)
      return undefined
    }

    if (message.type === 'CONTEXT_SUBSCRIBER_READY') {
      if (sender.tab)
        return undefined
      return activeTabContext().then((active) => {
        if (!active)
          return null
        return createContextSnapshotMessage(active)
      })
    }

    return undefined
  })

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === ASSISTANT_PORT) {
      if (!port.sender || !isTrustedModuleManagementSender(port.sender, browser.runtime.id, extensionBaseUrl)) {
        port.disconnect()
        return
      }
      const owner = port.sender.documentId ?? port.sender.url!
      port.onDisconnect.addListener(() => {
        repoLensController.cancelOwner(owner)
        assistantController.cancelOwner(owner)
        void pageContextController.restorePage(owner)
      })
      return
    }
    if (port.name === DUBBING_PORT) {
      void videoDubbingController.acceptPort(port as unknown as DubbingPort).catch(() => port.disconnect())
      return
    }
    pageToolboxController.acceptPort(port as unknown as PageToolboxHostPort)
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const actions: Record<string, 'chat' | 'translate' | 'explain' | 'summarize'> = {
      'oneweb-ask-selection': 'chat',
      'oneweb-translate-selection': 'translate',
      'oneweb-explain-selection': 'explain',
      'oneweb-summarize-page': 'summarize',
    }
    const intent = actions[String(info.menuItemId)]
    if (intent) {
      void (async () => {
        if (intent === 'summarize') {
          const attachment = await pageContextController.captureCurrentPage('browser-context-menu')
          await pageActionController.openDraft(attachment.text, intent)
        }
        else {
          await pageActionController.openDraft(info.selectionText ?? '', intent)
        }
      })().catch(() => browser.tabs.create({ url: browser.runtime.getURL('/sidebar.html') }))
      return
    }
    void sendToOpenListContextMenus.handleClick(
      info as unknown as SendToOpenListContextMenuInfo,
      tab as SendToOpenListDiscoveryTab | undefined,
    )
  })

  browser.tabs.onActivated.addListener(async (info) => {
    currentWindowId = info.windowId
    await pageActionController.deactivateOthers(info.tabId)
    assistantController.invalidatePage()
    videoReadingController.invalidate()
    visionController.invalidate()
    await pageContextController.invalidate()
    await pageActionController.syncActive().catch(() => {})
    const active = await activeTabContext()
    if (active)
      await broadcastContext(active)
  })

  // Firefox MV3 event pages may be suspended between messages. URL updates provide a
  // navigation-level fallback; the content script remains responsible for SPA signals.
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'loading')
      videoDubbingController.invalidate(tabId)
    if (changeInfo.url || changeInfo.status === 'loading') {
      assistantController.invalidatePage(tabId)
      void pageContextController.invalidate(tabId)
      void pageActionController.invalidateTab(tabId, true)
    }
    if (changeInfo.status === 'complete')
      void pageActionController.syncActive().catch(() => {})
    pageToolboxController.handleTabUpdated(tabId, changeInfo)
    const href = changeInfo.url || (changeInfo.status === 'complete' ? tab.url : undefined)
    if (href)
      void updateTabContext(tabId, href)
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    assistantController.invalidatePage(tabId)
    void pageContextController.invalidate(tabId)
    void pageActionController.invalidateTab(tabId, true)
    videoDubbingController.invalidate(tabId)
    contextBroker.remove(tabId)
    pageToolboxController.handleTabRemoved(tabId)
  })

  browser.permissions.onRemoved.addListener((permissions) => {
    if (permissions.origins?.length)
      repoLensController.invalidate()
    void assistantController.permissionsChanged()
    void pageActionController.permissionsChanged()
    if (permissions.origins?.length) {
      assistantController.invalidatePage()
      void pageContextController.invalidate()
      // Also release retained runtimes unknown to a freshly restarted worker.
      void browser.tabs.query({}).then(tabs => Promise.allSettled(tabs
        .filter(tab => tab.id !== undefined && /^https?:\/\//.test(tab.url ?? ''))
        .map(tab => browser.tabs.sendMessage(tab.id!, { channel: PAGE_CHANNEL, command: 'dispose' }, { frameId: 0 }))))
    }
    void videoDubbingController.permissionsChanged()
    if (permissions.permissions?.includes('cookies') || permissions.origins?.length)
      cookieManagerController.invalidate()
    browserJournalController.handlePermissionsRemoved(permissions)
    void bookmarkDoctorController.handlePermissionsRemoved(permissions)
    void clashControlController.handlePermissionsRemoved(permissions)
    void networkManagementController.handlePermissionsRemoved(permissions)
    void pageToolboxController.handlePermissionsRemoved(permissions)
    void sendToOpenListController.handlePermissionsRemoved(permissions)
  })

  if (!__FIREFOX__) {
    configureChromiumActionEntry({
      action: browser.action,
      runtime: browser.runtime,
      sidePanel: typeof chrome === 'undefined' ? undefined : chrome.sidePanel,
      tabs: browser.tabs,
    })
  }

  for (const [id, title, contexts] of [
    ['oneweb-ask-selection', '在 OneWeb 中提问', ['selection']],
    ['oneweb-translate-selection', '用 OneWeb 翻译选文', ['selection']],
    ['oneweb-explain-selection', '用 OneWeb 解释选文', ['selection']],
    ['oneweb-summarize-page', '用 OneWeb 总结当前网页', ['page']],
  ] as const) {
    void browser.contextMenus.remove(id).catch(() => {}).then(() => browser.contextMenus.create({
      id,
      title,
      contexts: [...contexts],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    }))
  }
  browser.commands.onCommand.addListener((command: string, tab?: { windowId?: number }) => {
    if (command === 'quick-ask') {
      void pageActionController.quickAsk().catch(() => pageActionController.openDraft('', 'chat'))
    }
    if (command === 'open-workspace') {
      const panel = typeof chrome !== 'undefined' ? chrome.sidePanel as unknown as { open?: (_options: { windowId: number }) => Promise<void> } : undefined
      const windowId = tab?.windowId ?? currentWindowId
      if (!__FIREFOX__ && panel?.open && windowId !== undefined) {
        void panel.open({ windowId }).catch(() => browser.tabs.create({ url: browser.runtime.getURL('/sidebar.html') }))
      }
      else {
        void browser.tabs.create({ url: browser.runtime.getURL('/sidebar.html') })
      }
    }
  })
}
