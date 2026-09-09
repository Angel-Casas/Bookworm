import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIBRARY_SORT,
  LIBRARY_SORT_OPTIONS,
  bookToContinue,
  booksInProgress,
  isLibrarySort,
  sortBooks,
} from '../librarySort'
import type { BookMeta } from '../types'

function book(partial: Partial<BookMeta> & { id: string }): BookMeta {
  return {
    title: partial.id,
    author: null,
    format: 'epub',
    fileName: `${partial.id}.epub`,
    fileSize: 1000,
    addedAt: 0,
    lastOpenedAt: null,
    coverBlob: null,
    ...partial,
  }
}

const ids = (books: BookMeta[]) => books.map((b) => b.id)

describe('librarySort options', () => {
  it('exposes the four sorts, default included', () => {
    expect(LIBRARY_SORT_OPTIONS.map((o) => o.id)).toEqual([
      'reading',
      'finished',
      'added',
      'format',
    ])
    expect(isLibrarySort(DEFAULT_LIBRARY_SORT)).toBe(true)
    expect(isLibrarySort('alphabetical')).toBe(false)
  })
})

describe('sortBooks', () => {
  const shelf = [
    book({ id: 'a', addedAt: 1, lastOpenedAt: 50, format: 'pdf', title: 'Zed' }),
    book({ id: 'b', addedAt: 2, lastOpenedAt: null, finishedAt: 90, title: 'alpha' }),
    book({ id: 'c', addedAt: 3, lastOpenedAt: 70, finishedAt: 80, title: 'Beta' }),
    book({ id: 'd', addedAt: 4, lastOpenedAt: 60, title: 'gamma' }),
  ]

  it('reading: recently opened first, never-opened last', () => {
    expect(ids(sortBooks(shelf, 'reading'))).toEqual(['c', 'd', 'a', 'b'])
  })

  it('finished: finished books first by finish date, rest by recency', () => {
    expect(ids(sortBooks(shelf, 'finished'))).toEqual(['b', 'c', 'd', 'a'])
  })

  it('added: newest first', () => {
    expect(ids(sortBooks(shelf, 'added'))).toEqual(['d', 'c', 'b', 'a'])
  })

  it('format: grouped by format, titles A-Z case-insensitively inside', () => {
    expect(ids(sortBooks(shelf, 'format'))).toEqual(['b', 'c', 'd', 'a'])
  })

  it('does not mutate the input array', () => {
    const before = ids([...shelf])
    sortBooks(shelf, 'reading')
    expect(ids([...shelf])).toEqual(before)
  })
})

describe('bookToContinue', () => {
  it('is the most recently opened unfinished book', () => {
    const picked = bookToContinue([
      book({ id: 'a', lastOpenedAt: 100 }),
      book({ id: 'b', lastOpenedAt: 300 }),
      book({ id: 'c', lastOpenedAt: 200 }),
    ])
    expect(picked?.id).toBe('b')
  })

  it('skips books already finished', () => {
    const picked = bookToContinue([
      book({ id: 'done', lastOpenedAt: 300, finishedAt: 350 }),
      book({ id: 'reading', lastOpenedAt: 200 }),
    ])
    expect(picked?.id).toBe('reading')
  })

  it('offers nothing when no book has been opened', () => {
    // A freshly imported shelf has nothing to continue.
    expect(bookToContinue([book({ id: 'a' }), book({ id: 'b' })])).toBeNull()
    expect(bookToContinue([])).toBeNull()
  })
})

describe('booksInProgress', () => {
  it('is every unfinished book that has been opened, latest first', () => {
    const reading = booksInProgress([
      book({ id: 'a', lastOpenedAt: 100 }),
      book({ id: 'unopened' }),
      book({ id: 'b', lastOpenedAt: 300 }),
      book({ id: 'done', lastOpenedAt: 400, finishedAt: 450 }),
      book({ id: 'c', lastOpenedAt: 200 }),
    ])
    expect(ids(reading)).toEqual(['b', 'c', 'a'])
  })

  it('keeps a book whose pages have not been counted yet', () => {
    // Progress is null until the reader has counted the pages. Judging by the
    // number would drop the book opened five minutes ago — the likeliest one
    // to be wanted back.
    const reading = booksInProgress([book({ id: 'fresh', lastOpenedAt: 10, progress: null })])
    expect(ids(reading)).toEqual(['fresh'])
  })

  it('agrees with bookToContinue about which one is first', () => {
    const shelf = [
      book({ id: 'a', lastOpenedAt: 100 }),
      book({ id: 'b', lastOpenedAt: 300 }),
      book({ id: 'c', lastOpenedAt: 200 }),
    ]
    expect(booksInProgress(shelf)[0]?.id).toBe(bookToContinue(shelf)?.id)
  })

  it('leaves the shelf it was given alone', () => {
    const shelf = [book({ id: 'a', lastOpenedAt: 100 }), book({ id: 'b', lastOpenedAt: 300 })]
    booksInProgress(shelf)
    expect(ids(shelf)).toEqual(['a', 'b'])
  })

  it('is empty for a shelf nobody has read', () => {
    expect(booksInProgress([book({ id: 'a' })])).toEqual([])
    expect(booksInProgress([])).toEqual([])
  })
})
