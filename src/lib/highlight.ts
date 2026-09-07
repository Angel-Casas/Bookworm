/** Pure helpers for text highlights: the pastel palette and color math. */

/** Catalogue keys for the ink names. Spelled out rather than built from the
 *  ids so they are literal strings the message catalogue can be checked
 *  against — and so this file still names no words of its own. */
export type InkNameKey = 'ink.butter' | 'ink.mint' | 'ink.sky' | 'ink.rose' | 'ink.lavender'

export interface HighlightColor {
  id: string
  nameKey: InkNameKey
  hex: string
}

const BUTTER: HighlightColor = { id: 'butter', nameKey: 'ink.butter', hex: '#f2dd88' }

/** Soft pastels that stay legible over white book pages. */
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  BUTTER,
  { id: 'mint', nameKey: 'ink.mint', hex: '#bfe3c0' },
  { id: 'sky', nameKey: 'ink.sky', hex: '#b8d8f0' },
  { id: 'rose', nameKey: 'ink.rose', hex: '#f2c4cd' },
  { id: 'lavender', nameKey: 'ink.lavender', hex: '#d7c8ee' },
] as const

export const DEFAULT_HIGHLIGHT_HEX = BUTTER.hex

/** #rrggbb → rgba() wash for painting over book text. */
export function highlightWash(hex: string, alpha = 0.5): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return `rgba(242, 221, 136, ${alpha})`
  const value = parseInt(match[1] ?? '', 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface SegmentRange {
  firstSegment: number
  lastSegment: number
}

/**
 * Locate `needle` inside an ordered list of text segments (e.g. the spans of
 * a PDF text layer), ignoring all whitespace differences. Returns the index
 * range of segments the match touches, or null.
 */
export function locateInSegments(segments: readonly string[], needle: string): SegmentRange | null {
  const squash = (value: string) => value.replace(/\s+/g, '')
  const target = squash(needle)
  if (target.length === 0) return null

  let joined = ''
  const bounds: { start: number; end: number }[] = []
  for (const segment of segments) {
    const start = joined.length
    joined += squash(segment)
    bounds.push({ start, end: joined.length })
  }
  const index = joined.indexOf(target)
  if (index === -1) return null
  const endIndex = index + target.length

  let firstSegment = -1
  let lastSegment = -1
  bounds.forEach((bound, segmentIndex) => {
    if (bound.end > index && bound.start < endIndex) {
      if (firstSegment === -1) firstSegment = segmentIndex
      lastSegment = segmentIndex
    }
  })
  return firstSegment === -1 ? null : { firstSegment, lastSegment }
}
