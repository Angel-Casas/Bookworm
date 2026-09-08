/**
 * The night page's judgement about a publisher's colours.
 *
 * The bug these guard against was not a wrong colour, it was a wrong MECHANISM:
 * `color: inherit` passing a black down a tree. So what is tested here is the
 * decision itself — is this readable on coal — rather than any particular
 * result of it.
 */
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  flatten,
  isPaperish,
  luminance,
  needsNightInk,
  parseColor,
  MIN_CONTRAST,
  NIGHT_BG,
  NIGHT_INK,
} from '../nightPage'

describe('parseColor', () => {
  it('reads what getComputedStyle actually returns', () => {
    expect(parseColor('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseColor('rgba(255, 255, 255, 0.5)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 })
    // The modern space-separated syntax, which some engines return.
    expect(parseColor('rgb(18 19 26 / 0.4)')).toEqual({ r: 18, g: 19, b: 26, a: 0.4 })
  })

  it('reads hex, since this module writes its own colours that way', () => {
    expect(parseColor('#16171a')).toEqual({ r: 22, g: 23, b: 26, a: 1 })
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })

  it('calls transparent what it is: no ink at all', () => {
    expect(parseColor('transparent')?.a).toBe(0)
  })

  it('returns null rather than a guess', () => {
    // A named colour, a gradient, a variable — anything it cannot be sure of
    // leaves the element alone. Guessing is how you repaint something fine.
    expect(parseColor('rebeccapurple')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor('#12345')).toBeNull()
    expect(parseColor('linear-gradient(red, blue)')).toBeNull()
  })
})

describe('contrast', () => {
  it('agrees with the WCAG anchors', () => {
    const black = parseColor('#000000')!
    const white = parseColor('#ffffff')!
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
  })

  it('is the same either way round', () => {
    const one = parseColor('#16171a')!
    const two = parseColor('#e2ddd2')!
    expect(contrastRatio(one, two)).toBeCloseTo(contrastRatio(two, one), 10)
  })

  it('puts luminance in the right order', () => {
    expect(luminance(parseColor('#000')!)).toBeLessThan(luminance(parseColor('#888')!))
    expect(luminance(parseColor('#888')!)).toBeLessThan(luminance(parseColor('#fff')!))
  })
})

describe('flatten', () => {
  it('lays a half-transparent white over coal and lands between them', () => {
    const result = flatten(parseColor('rgba(255,255,255,0.5)')!, parseColor(NIGHT_BG)!)
    expect(result.a).toBe(1)
    expect(result.r).toBeCloseTo(138.5, 1)
  })
})

describe('needsNightInk', () => {
  it('replaces the black a paper stylesheet asks for', () => {
    // The whole bug, in one line: this is the table of contents.
    expect(needsNightInk('rgb(0, 0, 0)')).toBe(true)
  })

  it('leaves the night page’s own ink alone', () => {
    expect(needsNightInk(NIGHT_INK)).toBe(false)
  })

  it('leaves a colour that can be read on coal', () => {
    // A publisher's warm red heading: dark-ish, but legible here, and theirs.
    expect(needsNightInk('rgb(224, 122, 95)')).toBe(false)
  })

  it('does not paint ink where the book meant none', () => {
    expect(needsNightInk('transparent')).toBe(false)
    expect(needsNightInk('rgba(0, 0, 0, 0)')).toBe(false)
  })

  it('leaves alone what it cannot read', () => {
    expect(needsNightInk('rebeccapurple')).toBe(false)
  })

  it('measures against the ground actually behind the text', () => {
    // Black on a pale panel the book drew itself is readable and stays; the
    // same black on the night page is not.
    expect(needsNightInk('rgb(0,0,0)', 'rgb(245,241,232)')).toBe(false)
    expect(needsNightInk('rgb(0,0,0)', NIGHT_BG)).toBe(true)
  })

  it('sits exactly where MIN_CONTRAST says it does', () => {
    const ground = parseColor(NIGHT_BG)!
    const dim = parseColor('rgb(90, 90, 90)')!
    const ratio = contrastRatio(dim, ground)
    expect(needsNightInk('rgb(90, 90, 90)')).toBe(ratio < MIN_CONTRAST)
  })
})

describe('isPaperish', () => {
  it('knows a page-white panel from a coloured one', () => {
    expect(isPaperish('rgb(255, 255, 255)')).toBe(true)
    expect(isPaperish('rgb(250, 248, 240)')).toBe(true)
    expect(isPaperish('rgb(60, 20, 20)')).toBe(false)
  })

  it('says nothing about a background that is not there', () => {
    expect(isPaperish('transparent')).toBe(false)
    expect(isPaperish('rgba(255,255,255,0)')).toBe(false)
  })
})
