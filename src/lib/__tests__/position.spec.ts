import { describe, expect, it } from 'vitest'
import { clampPage, isEpubCfi, parsePdfPosition } from '../position'

describe('parsePdfPosition', () => {
  it('parses valid page numbers', () => {
    expect(parsePdfPosition('7')).toBe(7)
    expect(parsePdfPosition('1')).toBe(1)
  })
  it('rejects invalid values', () => {
    expect(parsePdfPosition(null)).toBeNull()
    expect(parsePdfPosition(undefined)).toBeNull()
    expect(parsePdfPosition('0')).toBeNull()
    expect(parsePdfPosition('-3')).toBeNull()
    expect(parsePdfPosition('epubcfi(/6/4)')).toBeNull()
    expect(parsePdfPosition('')).toBeNull()
  })
})

describe('clampPage', () => {
  it('clamps into range and truncates', () => {
    expect(clampPage(5, 10)).toBe(5)
    expect(clampPage(0, 10)).toBe(1)
    expect(clampPage(99, 10)).toBe(10)
    expect(clampPage(3.7, 10)).toBe(3)
  })
  it('degrades safely on nonsense input', () => {
    expect(clampPage(Number.NaN, 10)).toBe(1)
    expect(clampPage(5, 0)).toBe(1)
  })
})

describe('isEpubCfi', () => {
  it('detects CFI strings only', () => {
    expect(isEpubCfi('epubcfi(/6/4[chap01]!/4/2/2)')).toBe(true)
    expect(isEpubCfi('12')).toBe(false)
    expect(isEpubCfi(null)).toBe(false)
  })
})
