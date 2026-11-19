import { bilibiliPlayerInfo, discoverBilibiliCaptions, readBilibiliPlayer } from './bilibili'
import { html5PlayerInfo, readHtml5Player } from './html5'
import { dubbingSite } from './sites'
import { playerInfo, readYouTubePlayer } from './youtube'

export interface DubbingScripting {
  executeScript: (_details: {
    target: { tabId: number, frameIds: number[] }
    files?: string[]
    world?: 'MAIN'
    func?: () => unknown
  }) => Promise<Array<{ result?: unknown, documentId?: string, frameId: number }>>
}
export function createDubbingInjection(
  scripting: DubbingScripting,
  tabs: { get: (_id: number) => Promise<{ url?: string }> },
) {
  return {
    async discover(tabId: number) {
      const tab = await tabs.get(tabId)
      const site = dubbingSite(tab.url ?? '')
      if (!site)
        throw new Error('不支持当前视频页')
      const [result] = await scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: 'MAIN',
        func: site.platform === 'bilibili' ? readBilibiliPlayer : site.platform === 'html5' ? readHtml5Player : readYouTubePlayer,
      })
      if (site.platform === 'bilibili')
        return discoverBilibiliCaptions(bilibiliPlayerInfo(result?.result, site.videoId, result?.documentId ?? ''))
      return site.platform === 'html5'
        ? html5PlayerInfo(result?.result, site.videoId, result?.documentId ?? '')
        : playerInfo(result?.result, site.videoId, result?.documentId ?? '')
    },
    async inject(tabId: number) {
      await scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['/video-dubbing.js'] })
    },
  }
}
