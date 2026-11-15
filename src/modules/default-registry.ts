import browser from '~/platform/browser'
import { createBookmarkDoctorSeed } from './builtin/bookmark-doctor/manifest'
import { createBrowserJournalSeed } from './builtin/browser-journal/manifest'
import { createClashControlSeed } from './builtin/clash-control/manifest'
import { createCookieManagerSeed } from './builtin/cookie-manager/manifest'
import { createPageToolboxSeed } from './builtin/page-toolbox/manifest'
import { createSendToOpenListSeed } from './builtin/send-to-openlist/manifest'
import { createVideoDubbingSeed } from './builtin/video-dubbing/manifest'
import { ModuleRegistry } from './registry'
import { createRepoLensSeed } from './seeds/repolens'

export const defaultModuleRegistry = new ModuleRegistry({
  storage: browser.storage.local,
  seeds: [
    createRepoLensSeed(),
    createBookmarkDoctorSeed(),
    createClashControlSeed(),
    createBrowserJournalSeed(),
    createPageToolboxSeed(),
    createSendToOpenListSeed(),
    createCookieManagerSeed(),
    createVideoDubbingSeed(),
  ],
})

export async function initializeDefaultModuleRegistry() {
  return defaultModuleRegistry.list()
}
