import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_HEX,
  HIGHLIGHT_COLORS,
  highlightWash,
  locateInSegments,
} from '../highlight'

describe('highlight palette', () => {
  it('offers five distinct pastel colors with valid hex values', () => {
    expect(HIGHLIGHT_COLORS).toHaveLength(5)
    const hexes = HIGHLIGHT_COLORS.map((color) => color.hex)
    expect(new Set(hexes).size).toBe(5)
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    expect(hexes).toContain(DEFAULT_HIGHLIGHT_HEX)
  })
})

describe('highlightWash', () => {
  it('converts hex to an rgba wash', () => {
    expect(highlightWash('#f2dd88', 0.5)).toBe('rgba(242, 221, 136, 0.5)')
    expect(highlightWash('#000000', 1)).toBe('rgba(0, 0, 0, 1)')
  })

  it('falls back to butter for malformed input', () => {
    expect(highlightWash('gold', 0.4)).toBe('rgba(242, 221, 136, 0.4)')
  })
})

describe('locateInSegments', () => {
  it('finds a needle inside a single segment', () => {
    expect(locateInSegments(['once upon a time', 'a worm lived'], 'upon a')).toEqual({
      firstSegment: 0,
      lastSegment: 0,
    })
  })

  it('finds a needle spanning several segments', () => {
    expect(locateInSegments(['once upon', ' a time a ', 'worm lived'], 'a time a worm')).toEqual({
      firstSegment: 1,
      lastSegment: 2,
    })
  })

  it('ignores whitespace differences between selection and layer text', () => {
    expect(locateInSegments(['the  quick', 'brown', ' fox'], 'quick brown fox')).toEqual({
      firstSegment: 0,
      lastSegment: 2,
    })
  })

  it('returns null when the text is absent or empty', () => {
    expect(locateInSegments(['abc', 'def'], 'xyz')).toBeNull()
    expect(locateInSegments(['abc'], '   ')).toBeNull()
  })
})
