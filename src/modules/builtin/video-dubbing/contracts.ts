export const VIDEO_DUBBING_MODULE_ID = 'dev.oneweb.video-dubbing'
export const VIDEO_DUBBING_ENTRY_ID = 'video-dubbing'
export const DUBBING_PORT = 'oneweb.video-dubbing.player.v1'
export const SUBTITLE_LIMIT = 2 * 1024 * 1024
export interface DubbingCue {
  id: string
  startMs: number
  endMs: number
  sourceText: string
  sourceCueIds: string[]
}
export interface TranslatedCue extends DubbingCue {
  translatedText: string
}

export interface SubtitleTrack {
  id: string
  label: string
  language: string
  url: string
}
export interface PlayerInfo {
  videoId: string
  title: string
  documentId: string
  tracks: SubtitleTrack[]
  contentId?: string
  captionNotice?: string
}
export interface DubbingBinding {
  tabId: number
  documentId: string
  videoId: string
  sessionId: string
  generation: number
}
export interface PublicService {
  baseUrl: string
  model: string
  keyConfigured: boolean
}
export interface DubbingStatus {
  configuration: { translation: PublicService, speech: PublicService & { voice: string } } | null
  site: {
    tabId: number
    origin: string
    pattern: string
    videoId: string
    origins?: string[]
    platform?: import('./sites').DubbingPlatform
  } | null
  player: PlayerInfo | null
  snapshot: import('./session').DubbingSnapshot | null
}
export type DubbingCommand =
  | 'status'
  | 'save'
  | 'delete'
  | 'prepare-site'
  | 'open'
  | 'start'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'volumes'
  | 'revoke'
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
