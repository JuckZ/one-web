import type { DubbingCue } from './contracts'
import { SUBTITLE_LIMIT } from './contracts'

export function normalizeCues(input: DubbingCue[]): DubbingCue[] {
  if (!Array.isArray(input) || !input.length || input.length > 5000)
    throw new Error('字幕数量须在 1–5000 之间')
  const ids = new Set<string>()
  const cues = input.map((cue) => {
    if (
      !cue
      || typeof cue.id !== 'string'
      || !cue.id
      || cue.id.length > 128
      || ids.has(cue.id)
      || !Number.isFinite(cue.startMs)
      || !Number.isFinite(cue.endMs)
      || cue.startMs < 0
      || cue.endMs <= cue.startMs
      || cue.endMs > 10800000
      || typeof cue.sourceText !== 'string'
      || !cue.sourceText.trim()
      || new TextEncoder().encode(cue.sourceText).length > 12000
      || !Array.isArray(cue.sourceCueIds)
      || !cue.sourceCueIds.length
      || !cue.sourceCueIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)
    ) {
      throw new Error('字幕内容或时间轴无效')
    }
    ids.add(cue.id)
    return { ...cue, sourceText: cue.sourceText.trim(), sourceCueIds: [...cue.sourceCueIds] }
  })
  if (new TextEncoder().encode(JSON.stringify(cues)).length > SUBTITLE_LIMIT)
    throw new Error('字幕超过 2 MiB')
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

function timestamp(value: string): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value)
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
    throw new Error('无效字幕时间码')
  return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4])
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
      const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }
      if (entities[name])
        return entities[name]
      const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : entity
    })
}

export function importSubtitles(text: string): DubbingCue[] {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > SUBTITLE_LIMIT)
    throw new Error('字幕超过 2 MiB')
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n[\t ]*\n/)
  const cues: DubbingCue[] = []
  for (const block of blocks) {
    if (/^(?:WEBVTT|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block))
      continue
    const lines = block.split('\n')
    const index = lines[0].includes('-->') ? 0 : 1
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+(?:\S.*)?)?$/.exec(lines[index] ?? '')
    if (!match)
      throw new Error('无法识别 SRT / WebVTT 字幕')
    cues.push({
      id: `cue-${cues.length + 1}`,
      startMs: timestamp(match[1]),
      endMs: timestamp(match[2]),
      sourceText: plainText(lines.slice(index + 1).join('\n')),
      sourceCueIds: [index === 1 ? lines[0] : String(cues.length + 1)],
    })
  }
  return normalizeCues(cues)
}
