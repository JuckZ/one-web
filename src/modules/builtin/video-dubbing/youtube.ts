import type { DubbingCue, PlayerInfo } from './contracts'
import { isRecord } from './contracts'
import { normalizeCues } from './subtitles'

export class EmptyYouTubeCaptionsError extends Error {
  constructor() {
    super('平台未返回字幕：请在 YouTube 开启 CC 后重试，或导入 SRT / VTT')
  }
}

/** Executed as a fixed MAIN-world reader. No credentials, network or caller-supplied code. */
export function readYouTubePlayer() {
  const player = document.getElementById('movie_player') as HTMLElement & { getPlayerResponse?: () => unknown }
  const data
    = player?.getPlayerResponse?.()
    ?? (window as unknown as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse
  if (!data || typeof data !== 'object')
    return null
  const response = data as {
    videoDetails?: { videoId?: string, title?: string, isLiveContent?: boolean }
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{
          baseUrl?: string
          languageCode?: string
          kind?: string
          name?: { simpleText?: string }
        }>
      }
    }
  }
  const details = response.videoDetails
  const list = response.captions?.playerCaptionsTracklistRenderer?.captionTracks
  return {
    videoDetails: {
      videoId: details?.videoId,
      title: typeof details?.title === 'string' ? details.title.slice(0, 256) : '',
      isLiveContent: details?.isLiveContent === true,
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: Array.isArray(list)
          ? list.slice(0, 100).map(track => ({
            baseUrl: typeof track.baseUrl === 'string' ? track.baseUrl.slice(0, 8192) : '',
            languageCode: typeof track.languageCode === 'string' ? track.languageCode.slice(0, 32) : '',
            kind: track.kind === 'asr' ? 'asr' : '',
            name: {
              simpleText: typeof track.name?.simpleText === 'string' ? track.name.simpleText.slice(0, 128) : '',
            },
          }))
          : [],
      },
    },
  }
}

export function playerInfo(value: unknown, videoId: string, documentId: string): PlayerInfo {
  if (
    !isRecord(value)
    || !isRecord(value.videoDetails)
    || value.videoDetails.videoId !== videoId
    || value.videoDetails.isLiveContent === true
  ) {
    throw new Error('播放器尚未就绪、视频已切换或当前为直播')
  }
  const captions = isRecord(value.captions) ? value.captions.playerCaptionsTracklistRenderer : null
  const list = isRecord(captions) && Array.isArray(captions.captionTracks) ? captions.captionTracks : []
  const tracks: PlayerInfo['tracks'] = []
  for (const [index, track] of list.slice(0, 100).entries()) {
    if (!isRecord(track) || typeof track.baseUrl !== 'string' || typeof track.languageCode !== 'string')
      continue
    let url: URL
    try {
      url = new URL(track.baseUrl)
    }
    catch {
      continue
    }
    if (
      url.protocol !== 'https:'
      || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
      || url.pathname !== '/api/timedtext'
      || url.username
      || url.password
      || url.hash
    ) {
      continue
    }
    const name = isRecord(track.name) ? track.name : {}
    const label = typeof name.simpleText === 'string' ? name.simpleText : track.languageCode
    tracks.push({
      id: `track-${index}`,
      label: `${label.slice(0, 128)}${track.kind === 'asr' ? '（自动）' : ''}`,
      language: track.languageCode.slice(0, 32),
      url: url.href,
    })
  }
  return {
    videoId,
    documentId,
    title: typeof value.videoDetails.title === 'string' ? value.videoDetails.title.slice(0, 256) : videoId,
    tracks,
  }
}

export async function loadYouTubeCues(trackUrl: string, signal: AbortSignal): Promise<DubbingCue[]> {
  // Preserve signed query encoding; do not reserialize the whole native request URL.
  const url = /[?&]fmt=/.test(trackUrl)
    ? trackUrl.replace(/([?&])fmt=[^&#]*/g, '$1fmt=json3')
    : `${trackUrl}${trackUrl.includes('?') ? '&' : '?'}fmt=json3`
  const response = await fetch(url, { signal, credentials: 'include', redirect: 'error' })
  if (!response.ok)
    throw new Error(`字幕读取失败 HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('字幕为空，可导入 SRT / VTT')
  let total = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done)
      break
    total += value.length
    if (total > 2097152) {
      await reader.cancel()
      throw new Error('字幕超过 2 MiB')
    }
    chunks.push(value)
  }
  if (!total)
    throw new EmptyYouTubeCaptionsError()
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  let data: unknown
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  }
  catch {
    throw new Error('平台未返回字幕：请在 YouTube 开启 CC 后重试，或导入 SRT / VTT')
  }
  if (!isRecord(data) || !Array.isArray(data.events))
    throw new Error('平台字幕格式不可用')
  const cues: DubbingCue[] = []
  for (const event of data.events) {
    if (!isRecord(event) || !Array.isArray(event.segs))
      continue
    const sourceText = event.segs
      .map(seg => (isRecord(seg) && typeof seg.utf8 === 'string' ? seg.utf8 : ''))
      .join('')
      .trim()
    if (!sourceText)
      continue
    const id = `yt-${cues.length + 1}`
    cues.push({
      id,
      startMs: Number(event.tStartMs),
      endMs: Number(event.tStartMs) + Number(event.dDurationMs),
      sourceText,
      sourceCueIds: [id],
    })
  }
  return normalizeCues(cues)
}
