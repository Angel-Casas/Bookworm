import { describe, expect, it } from 'vitest'
import { formatPageCount, formatProgress, pageFromLocation, readingProgress } from '../pagination'

describe('pageFromLocation', () => {
  it('turns a 0-based location index into a 1-based page', () => {
    expect(pageFromLocation(0, 340)).toBe(1)
    expect(pageFromLocation(11, 340)).toBe(12)
  })

  it('treats epub.js’s pre-generation -1 as the first page', () => {
    expect(pageFromLocation(-1, 340)).toBe(1)
  })

  it('never reports past the last page', () => {
    // The final location can resolve one past the end.
    expect(pageFromLocation(340, 340)).toBe(340)
    expect(pageFromLocation(999, 340)).toBe(340)
  })

  it('reports nothing when the total is unknown', () => {
    expect(pageFromLocation(5, 0)).toBe(0)
    expect(pageFromLocation(5, Number.NaN)).toBe(0)
    expect(pageFromLocation(Number.NaN, 10)).toBe(0)
  })
})

describe('formatPageCount', () => {
  it('is bare numbers, no words', () => {
    expect(formatPageCount({ current: 12, total: 340 })).toBe('12 / 340')
  })

  it('stays silent rather than showing a half-known count', () => {
    expect(formatPageCount(null)).toBe('')
    expect(formatPageCount({ current: 3, total: 0 })).toBe('')
    expect(formatPageCount({ current: 0, total: 340 })).toBe('')
  })
})

describe('readingProgress', () => {
  it('is the page over the total', () => {
    expect(readingProgress({ current: 50, total: 200 })).toBe(0.25)
  })

  it('says nothing rather than zero when the count is unknown', () => {
    // A bar at 0% claims the reader has read none of it; an unknown is not
    // that claim, and the shelf shows the difference.
    expect(readingProgress(null)).toBeNull()
    expect(readingProgress({ current: 0, total: 0 })).toBeNull()
    expect(readingProgress({ current: 3, total: 0 })).toBeNull()
  })

  it('cannot exceed the book', () => {
    expect(readingProgress({ current: 210, total: 200 })).toBe(1)
  })
})

describe('formatProgress', () => {
  it('gives whole percents', () => {
    expect(formatProgress(0.256)).toBe('26%')
    expect(formatProgress(1)).toBe('100%')
    expect(formatProgress(0)).toBe('0%')
  })

  it('never rounds a started book down to nothing, or an unfinished one up to done', () => {
    expect(formatProgress(0.001)).toBe('1%')
    expect(formatProgress(0.999)).toBe('99%')
  })

  it('shows nothing when there is nothing to show', () => {
    expect(formatProgress(null)).toBe('')
    expect(formatProgress(undefined)).toBe('')
  })
})
