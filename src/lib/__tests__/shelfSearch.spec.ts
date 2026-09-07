import { describe, expect, it } from 'vitest'
import { passageHits, searchShelfMeta, shelfNeedle, splitExcerpt } from '../shelfSearch'
import type { Annotation } from '@/lib/types'

const BOOKS = [
  { id: 'b1', title: 'Moby-Dick', author: 'Herman Melville', format: 'epub' as const },
  { id: 'b2', title: 'The Whale Watcher', author: 'A. Nonymous', format: 'pdf' as const },
]

function mark(
  partial: Partial<Annotation> & Pick<Annotation, 'id' | 'bookId' | 'type'>,
): Annotation {
  return {
    position: '1',
    label: 'Page 1',
    text: null,
    createdAt: 1,
    ...partial,
  }
}

describe('shelfNeedle', () => {
  it('waits for something worth searching for', () => {
    expect(shelfNeedle('a')).toBeNull()
    expect(shelfNeedle('  ')).toBeNull()
    expect(shelfNeedle(' Whale ')).toBe('whale')
  })
})

describe('searchShelfMeta', () => {
  const marks = [
    mark({
      id: 'm1',
      bookId: 'b1',
      type: 'highlight',
      label: 'Call me Ishmael',
      text: 'Call me Ishmael. Some years ago, never mind how long precisely.',
    }),
    mark({ id: 'm2', bookId: 'b1', type: 'bookmark', label: 'Chapter 3 — The Spouter-Inn' }),
    mark({ id: 'm3', bookId: 'gone', type: 'highlight', label: 'x', text: 'whale' }),
  ]

  it('finds a book by its title', () => {
    const hits = searchShelfMeta(BOOKS, [], 'moby')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.kind).toBe('book')
    expect(hits[0]!.bookId).toBe('b1')
    expect(hits[0]!.where).toBe('Herman Melville')
  })

  it('finds it by its author, and shows the author as the match', () => {
    const hits = searchShelfMeta(BOOKS, [], 'melville')
    expect(hits[0]!.excerpt).toContain('Herman Melville')
    expect(hits[0]!.where).toBe('Moby-Dick')
  })

  it('finds what the reader marked, with the sentence around it', () => {
    const hits = searchShelfMeta(BOOKS, marks, 'ishmael')
    const found = hits.find((hit) => hit.kind === 'mark')
    expect(found?.markType).toBe('highlight')
    expect(found?.excerpt).toContain('Call me Ishmael')
    expect(found?.position).toBe('1')
  })

  it('finds a bookmark by the place it names', () => {
    const hits = searchShelfMeta(BOOKS, marks, 'spouter')
    expect(hits[0]!.markType).toBe('bookmark')
    expect(hits[0]!.excerpt).toContain('Spouter-Inn')
  })

  it('puts books before marks — a title typed is a book wanted', () => {
    const hits = searchShelfMeta(BOOKS, marks, 'whale')
    expect(hits[0]!.kind).toBe('book')
    expect(hits[0]!.bookId).toBe('b2')
  })

  it('does not report a highlight twice for matching its own opening words', () => {
    const hits = searchShelfMeta(BOOKS, marks, 'call me')
    expect(hits.filter((hit) => hit.bookId === 'b1' && hit.kind === 'mark')).toHaveLength(1)
  })

  it('leaves out a mark whose book is gone — it is nowhere to go', () => {
    const hits = searchShelfMeta(BOOKS, marks, 'whale')
    expect(hits.some((hit) => hit.bookId === 'gone')).toBe(false)
  })

  it('says nothing for a query too short to mean anything', () => {
    expect(searchShelfMeta(BOOKS, marks, 'a')).toEqual([])
  })
})

describe('passageHits', () => {
  it('carries the section and the place to jump to', () => {
    const hits = passageHits(BOOKS[0]!, [
      {
        sectionIndex: 2,
        sectionLabel: 'Chapter 3',
        position: 'chapter3.xhtml',
        excerpt: '…the great whale swam…',
        matchStart: 11,
        matchEnd: 16,
      },
    ])
    expect(hits[0]!.kind).toBe('passage')
    expect(hits[0]!.where).toBe('Chapter 3')
    expect(hits[0]!.position).toBe('chapter3.xhtml')
    expect(hits[0]!.bookTitle).toBe('Moby-Dick')
  })
})

describe('splitExcerpt', () => {
  it('hands back the three pieces a component needs', () => {
    const [before, match, after] = splitExcerpt({
      id: 'x',
      kind: 'passage',
      bookId: 'b1',
      bookTitle: 'Moby-Dick',
      where: '',
      excerpt: 'the great whale swam',
      matchStart: 10,
      matchEnd: 15,
      position: null,
    })
    expect(before).toBe('the great ')
    expect(match).toBe('whale')
    expect(after).toBe(' swam')
  })
})
