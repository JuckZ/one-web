import { describe, expect, it } from 'vitest'
import { importSubtitles, normalizeCues } from '../subtitles'

describe('subtitle import (T1)', () => {
  it('imports two SRT cues with stable source mapping and millisecond timing', () => {
    expect(
      importSubtitles('1\n00:00:01,250 --> 00:00:03,000\nHello world\n\n2\n00:00:04,000 --> 00:00:05,500\nSecond line'),
    ).toEqual([
      { id: 'cue-1', startMs: 1250, endMs: 3000, sourceText: 'Hello world', sourceCueIds: ['1'] },
      { id: 'cue-2', startMs: 4000, endMs: 5500, sourceText: 'Second line', sourceCueIds: ['2'] },
    ])
  })
})

it('accepts WebVTT markup as text, normalizes ordering and rejects malformed or oversized input', () => {
  expect(importSubtitles('WEBVTT\n\n00:02.000 --> 00:03.500 align:start\n<b>你好</b> &amp; world')[0]).toMatchObject({
    startMs: 2000,
    endMs: 3500,
    sourceText: '你好 & world',
  })
  for (const text of [
    'bad',
    '1\n00:00:05,000 --> 00:00:01,000\nx',
    '1\n00:99:00,000 --> 01:40:00,000\nx',
    'x'.repeat(2097153),
  ])
    expect(() => importSubtitles(text)).toThrow()
  const cue = { id: 'a', startMs: 0, endMs: 1000, sourceText: 'hello', sourceCueIds: ['a'] }
  expect(() => normalizeCues([cue, cue])).toThrow()
  expect(() => normalizeCues([{ ...cue, endMs: Infinity }])).toThrow()
  expect(() => normalizeCues([{ ...cue, sourceText: ' ' }])).toThrow()
})
