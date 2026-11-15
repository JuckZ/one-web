import type { PageCommand } from './runtime'
import type { DubbingCue } from '~/modules/builtin/video-dubbing/contracts'
import { findDubbingVideo } from '~/modules/builtin/video-dubbing/html5'

/** Fixed DOM operations; the caller supplies neither a selector nor executable code. */
export function readVideoPage(message: PageCommand) {
  const video = findDubbingVideo('html5')
  if (!video || video.duration === Infinity || !Number.isFinite(video.duration))
    throw new Error('请等待唯一的顶层点播视频加载')
  const sourceId = video.currentSrc || video.src
  if (!sourceId)
    throw new Error('视频来源不可读')
  if (message.command === 'video-snapshot') {
    return {
      sourceId,
      tracks: [...video.textTracks].slice(0, 100).map((track, index) => ({ id: `native:${index}`, label: track.label || track.language || `字幕 ${index + 1}`, language: track.language })),
    }
  }
  if (message.sourceId !== sourceId)
    throw new Error('当前视频已切换')
  if (message.command === 'video-seek') {
    const time = Number(message.timeMs) / 1000
    if (typeof message.timeMs !== 'number' || !Number.isFinite(time) || time < 0 || time > video.duration)
      throw new Error('视频时间点无效')
    video.currentTime = time
    return null
  }
  if (typeof message.trackId !== 'string' || !/^native:\d{1,2}$/.test(message.trackId))
    throw new Error('字幕轨道无效')
  const track = video.textTracks[Number(message.trackId.slice(7))]
  if (!track?.cues?.length)
    throw new Error('原生字幕尚未加载，请在播放器开启字幕或导入 SRT / VTT')
  if (track.cues.length > 5000)
    throw new Error('字幕超过 5000 条')
  return [...track.cues].map((cue, index): DubbingCue => ({
    id: `cue-${index + 1}`,
    startMs: cue.startTime * 1000,
    endMs: cue.endTime * 1000,
    sourceText: (cue as VTTCue).text,
    sourceCueIds: [cue.id || `${index + 1}`],
  }))
}
