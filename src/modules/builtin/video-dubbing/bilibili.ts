import type { DubbingCue, PlayerInfo } from './contracts'
import { isRecord, SUBTITLE_LIMIT } from './contracts'
import { normalizeCues } from './subtitles'

/** Fixed MAIN reader: project only video identity, part IDs and title, never whole page state. */
export function readBilibiliPlayer() {
  const state = (window as unknown as { __INITIAL_STATE__?: {
    videoData?: { bvid?: unknown, aid?: unknown, title?: unknown, pages?: unknown }
  } }).__INITIAL_STATE__
  const data = state?.videoData
  const videos = [...document.querySelectorAll<HTMLVideoElement>('#bilibili-player video, .bpx-player-container video, .bilibili-player video')]
    .filter(video => !video.hidden && getComputedStyle(video).display !== 'none' && getComputedStyle(video).visibility !== 'hidden')
  return data
    ? {
        hasVideo: videos.length === 1 && videos[0].duration !== Infinity,
        bvid: typeof data.bvid === 'string' ? data.bvid.slice(0, 32) : '',
        aid: typeof data.aid === 'number' && Number.isSafeInteger(data.aid) ? data.aid : 0,
        title: typeof data.title === 'string' ? data.title.slice(0, 256) : '',
        pages: Array.isArray(data.pages)
          ? data.pages.slice(0, 10000).map(page => ({
            page: typeof page?.page === 'number' && Number.isSafeInteger(page.page) ? page.page : 0,
            cid: typeof page?.cid === 'number' && Number.isSafeInteger(page.cid) ? page.cid : 0,
          }))
          : [],
      }
    : null
}

export function bilibiliPlayerInfo(value: unknown, videoId: string, documentId: string): PlayerInfo {
  const [, id, part] = videoId.split(':')
  if (!isRecord(value) || (id.startsWith('BV') ? value.bvid !== id : String(value.aid) !== id.slice(2)))
    throw new Error('Bilibili 播放器尚未就绪或视频已切换，请刷新后读取')
  if (value.hasVideo !== true)
    throw new Error('未找到唯一的 Bilibili 顶层 HTML5 视频；请等待点播播放器加载，特殊播放器暂不支持')
  const page = Array.isArray(value.pages) ? value.pages.find(page => isRecord(page) && page.page === Number(part)) : null
  if (!isRecord(page) || !Number.isSafeInteger(page.cid) || Number(page.cid) <= 0)
    throw new Error('无法确认 Bilibili 当前分 P，请刷新后读取')
  return {
    videoId,
    documentId,
    title: typeof value.title === 'string' ? value.title.slice(0, 256) : id,
    contentId: String(page.cid),
    tracks: [],
  }
}

export function bilibiliSubtitleUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192)
    return null
  let url: URL
  try {
    url = new URL(value.startsWith('//') ? `https:${value}` : value)
  }
  catch { return null }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !/^(?:aisubtitle|subtitle|i[0-2])\.hdslb\.com$/.test(url.hostname)
    || !/^\/bfs\/(?:ai_subtitle|subtitle)\/[\w./-]+\.json$/.test(url.pathname)) {
    return null
  }
  return url.href
}

async function platformJson(url: string, credentials: RequestCredentials, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials, redirect: 'error' })
  if (!response.ok)
    throw new Error(`Bilibili 字幕读取失败 HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('Bilibili 字幕为空，请导入 SRT / VTT')
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done)
      break
    size += value.length
    if (size > SUBTITLE_LIMIT) {
      await reader.cancel()
      throw new Error('平台字幕响应超过 2 MiB')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  catch { throw new Error('Bilibili 未返回有效字幕，请启用原生字幕后重读或导入 SRT / VTT') }
}

export async function discoverBilibiliCaptions(info: PlayerInfo): Promise<PlayerInfo> {
  const [, id] = info.videoId.split(':')
  const url = new URL('https://api.bilibili.com/x/player/wbi/v2')
  url.searchParams.set(id.startsWith('BV') ? 'bvid' : 'aid', id.startsWith('BV') ? id : id.slice(2))
  url.searchParams.set('cid', info.contentId!)
  try {
    const response = await platformJson(url.href, 'include', AbortSignal.timeout(20000))
    if (!isRecord(response) || response.code !== 0 || !isRecord(response.data))
      throw new Error('Bilibili 字幕接口不可用，请在网站登录并启用字幕后重读，或导入 SRT / VTT')
    const data = response.data
    if (data.cid !== undefined && String(data.cid) !== info.contentId)
      throw new Error('Bilibili 分 P 已切换，请重新读取')
    const list = isRecord(data.subtitle) && Array.isArray(data.subtitle.subtitles) ? data.subtitle.subtitles : []
    const ids = new Set<string>()
    for (const track of list.slice(0, 100)) {
      if (!isRecord(track) || typeof track.lan !== 'string' || !/^[\w-]{1,32}$/.test(track.lan))
        continue
      const trackUrl = bilibiliSubtitleUrl(track.subtitle_url)
      const id = typeof track.id_str === 'string' ? track.id_str : String(track.id)
      if (!trackUrl || !/^\d{1,32}$/.test(id) || ids.has(id))
        continue
      ids.add(id)
      info.tracks.push({
        id: `bili-${id}`,
        language: track.lan,
        url: trackUrl,
        label: (typeof track.lan_doc === 'string' ? track.lan_doc : track.lan).slice(0, 128),
      })
    }
    if (!info.tracks.length) {
      info.captionNotice = data.need_login_subtitle
        ? '字幕需要网站登录，请登录 Bilibili 并启用字幕后重读，或导入 SRT / VTT'
        : '此分 P 暂无可读取字幕，可在网站开启字幕后重读，或导入 SRT / VTT'
    }
  }
  catch (error) {
    info.captionNotice = error instanceof Error ? error.message : '字幕读取失败，可导入 SRT / VTT'
  }
  return info
}

export async function loadBilibiliCues(trackUrl: string, signal: AbortSignal): Promise<DubbingCue[]> {
  const url = bilibiliSubtitleUrl(trackUrl)
  if (!url)
    throw new Error('Bilibili 字幕源无效')
  const data = await platformJson(url, 'omit', signal)
  if (!isRecord(data) || !Array.isArray(data.body))
    throw new Error('Bilibili 字幕格式不可用')
  return normalizeCues(data.body.map((cue, index) => {
    if (!isRecord(cue) || typeof cue.from !== 'number' || typeof cue.to !== 'number' || typeof cue.content !== 'string')
      throw new Error('Bilibili 字幕条目无效')
    const id = `bili-${index + 1}`
    return { id, startMs: Math.round(cue.from * 1000), endMs: Math.round(cue.to * 1000), sourceText: cue.content, sourceCueIds: [id] }
  }))
}
