import { describe, expect, it } from 'vitest'
import { cfiWithinRange, compareCfi, sortAnnotationsByPosition } from '../annotationSort'
import type { Annotation } from '../types'

function note(partial: Partial<Annotation> & { id: string; position: string }): Annotation {
  return {
    bookId: 'b',
    type: 'bookmark',
    label: partial.id,
    text: null,
    createdAt: 0,
    ...partial,
  }
}

const ids = (items: Annotation[]) => items.map((item) => item.id)

describe('compareCfi', () => {
  it('orders by spine position', () => {
    expect(compareCfi('epubcfi(/6/2!/4/2/2:0)', 'epubcfi(/6/8!/4/2/2:0)')).toBeLessThan(0)
  })

  it('orders within a section by element path and offset', () => {
    expect(compareCfi('epubcfi(/6/8!/4/2/6:5)', 'epubcfi(/6/8!/4/2/14:0)')).toBeLessThan(0)
    expect(compareCfi('epubcfi(/6/8!/4/2/6:40)', 'epubcfi(/6/8!/4/2/6:5)')).toBeGreaterThan(0)
  })

  it('treats a missing offset as the position start', () => {
    expect(compareCfi('epubcfi(/6/8!/4/2/6)', 'epubcfi(/6/8!/4/2/6:12)')).toBeLessThan(0)
  })

  it('locates a range CFI at its start and ignores assertions', () => {
    expect(
      compareCfi('epubcfi(/6/8[chap02]!/4/2,/6:2,/6:30)', 'epubcfi(/6/8!/4/2/6:10)'),
    ).toBeLessThan(0)
    expect(compareCfi('epubcfi(/6/8[a]!/4/2/6:5)', 'epubcfi(/6/8[b]!/4/2/6:5)')).toBe(0)
  })
})

describe('cfiWithinRange', () => {
  const start = 'epubcfi(/6/2!/4/6/1:2791)'
  const end = 'epubcfi(/6/2!/4/8/1:3400)'

  it('accepts a mark inside the visible page', () => {
    expect(cfiWithinRange('epubcfi(/6/2!/4/8/1:3020)', start, end)).toBe(true)
  })

  it('accepts marks sitting exactly on either boundary', () => {
    expect(cfiWithinRange(start, start, end)).toBe(true)
    expect(cfiWithinRange(end, start, end)).toBe(true)
  })

  it('rejects marks before or after the page', () => {
    expect(cfiWithinRange('epubcfi(/6/2!/4/6/1:100)', start, end)).toBe(false)
    expect(cfiWithinRange('epubcfi(/6/2!/4/10/1:5)', start, end)).toBe(false)
  })

  it('rejects a mark in another section', () => {
    expect(cfiWithinRange('epubcfi(/6/8!/4/2/1:0)', start, end)).toBe(false)
  })

  it('still finds a mark whose exact CFI is no longer a page start', () => {
    // The layout that made this bookmark is gone; it now sits mid-page.
    expect(cfiWithinRange('epubcfi(/6/2!/4/8/1:3020)', 'epubcfi(/6/2!/4/4/1:3482)', 'epubcfi(/6/2!/4/8/1:3600)')).toBe(true)
  })
})

describe('sortAnnotationsByPosition', () => {
  it('orders pdf annotations numerically by page (not lexically)', () => {
    const items = [
      note({ id: 'p10', position: '10', createdAt: 1 }),
      note({ id: 'p2', position: '2', createdAt: 2 }),
      note({ id: 'p1', position: '1', createdAt: 3 }),
    ]
    expect(ids(sortAnnotationsByPosition(items, 'pdf'))).toEqual(['p1', 'p2', 'p10'])
  })

  it('orders epub annotations by reading position regardless of arrival', () => {
    const items = [
      note({ id: 'late', position: 'epubcfi(/6/8!/4/2/14,/1:0,/1:20)', createdAt: 1 }),
      note({ id: 'early', position: 'epubcfi(/6/2!/4/2/2:0)', createdAt: 2 }),
      note({ id: 'mid', position: 'epubcfi(/6/8!/4/2/6:5)', createdAt: 3 }),
    ]
    expect(ids(sortAnnotationsByPosition(items, 'epub'))).toEqual(['early', 'mid', 'late'])
  })

  it('breaks position ties by creation time, oldest first', () => {
    const items = [
      note({ id: 'second', position: '4', createdAt: 20 }),
      note({ id: 'first', position: '4', createdAt: 10 }),
    ]
    expect(ids(sortAnnotationsByPosition(items, 'pdf'))).toEqual(['first', 'second'])
  })

  it('does not mutate its input', () => {
    const items = [note({ id: 'b', position: '2' }), note({ id: 'a', position: '1' })]
    sortAnnotationsByPosition(items, 'pdf')
    expect(ids([...items])).toEqual(['b', 'a'])
  })
})
