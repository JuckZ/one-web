import type { PlayerInfo } from './contracts'
import type { DubbingPlatform } from './sites'
import { isRecord } from './contracts'

/** Fixed MAIN reader for import-only playback on other sites. */
export function readHtml5Player() {
  const videos = [...document.querySelectorAll('video')].filter(video =>
    !video.hidden && getComputedStyle(video).display !== 'none' && getComputedStyle(video).visibility !== 'hidden',
  )
  return {
    url: location.href.slice(0, 4096),
    title: document.title.slice(0, 256),
    count: videos.length,
    live: videos[0]?.duration === Infinity,
    hasSource: !!(videos[0]?.currentSrc || videos[0]?.src || videos[0]?.querySelector('source[src]')),
  }
}

export function html5PlayerInfo(value: unknown, videoId: string, documentId: string): PlayerInfo {
  if (!isRecord(value) || `html5:${value.url}` !== videoId)
    throw new Error('网页已切换，请重新读取')
  if (value.count !== 1)
    throw new Error('需要唯一的顶层 HTML5 视频；请关闭其他视频，跨域 iframe 暂不支持')
  if (value.live === true || value.hasSource !== true)
    throw new Error('视频尚未就绪或当前为直播，请等待点播视频加载后重读')
  return {
    videoId,
    documentId,
    tracks: [],
    title: typeof value.title === 'string' ? value.title.slice(0, 256) : 'HTML5 视频',
    captionNotice: '通用网页模式：请导入当前视频的 SRT / VTT 字幕',
  }
}

export function findDubbingVideo(platform: DubbingPlatform): HTMLVideoElement | null {
  const selector = platform === 'youtube'
    ? '#movie_player video'
    : platform === 'bilibili' ? '#bilibili-player video, .bpx-player-container video, .bilibili-player video' : 'video'
  const videos = [...document.querySelectorAll<HTMLVideoElement>(selector)].filter(video =>
    !video.hidden && getComputedStyle(video).display !== 'none' && getComputedStyle(video).visibility !== 'hidden',
  )
  return videos.length === 1 ? videos[0] : null
}
