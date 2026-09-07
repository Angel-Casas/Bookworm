/**
 * Searching the whole shelf, not one book.
 *
 * A reader remembers a sentence, not which book it was in. Until now Bookworm
 * could only answer that question one book at a time, from inside the book —
 * which is exactly the thing you cannot do when you do not know which book.
 *
 * There are two kinds of answer here, and they cost very different amounts:
 *
 *   what the shelf already knows — titles, authors, and everything the reader
 *   marked — is in memory and answers on every keystroke; and
 *
 *   what is inside the books has to be read out of the files, which takes
 *   seconds per book. That one is asked for, not assumed.
 *
 * This file is the first kind plus the shaping for both. The reading of files
 * lives in the store.
 */
import { makeExcerpt } from '@/lib/search'
import type { SearchMatch } from '@/lib/search'
import type { Annotation, AnnotationType, BookFormat } from '@/lib/types'

export const MIN_SHELF_QUERY = 2
export const MAX_SHELF_HITS = 60

export interface ShelfBook {
  id: string
  title: string
  author: string | null
  format: BookFormat
}

export type ShelfHitKind = 'book' | 'mark' | 'passage'

export interface ShelfHit {
  /** Stable key for a list that grows while a deep search runs. */
  id: string
  kind: ShelfHitKind
  bookId: string
  bookTitle: string
  /** For a mark, which kind it is — the list shows the same tags the marks
   *  panel does. */
  markType?: AnnotationType
  /** The line above the excerpt: a place, a mark's label, an author. */
  where: string
  excerpt: string
  matchStart: number
  matchEnd: number
  /** Where to open the book. Null means "wherever the reader left off". */
  position: string | null
}

/** The needle, or null when there is not enough of one to search for. */
export function shelfNeedle(query: string): string | null {
  const needle = query.trim().toLowerCase()
  return needle.length >= MIN_SHELF_QUERY ? needle : null
}

function hitFrom(
  kind: ShelfHitKind,
  id: string,
  book: ShelfBook,
  where: string,
  text: string,
  at: number,
  needleLength: number,
  position: string | null,
  markType?: AnnotationType,
): ShelfHit {
  return {
    id,
    kind,
    bookId: book.id,
    bookTitle: book.title,
    ...(markType ? { markType } : {}),
    where,
    position,
    ...makeExcerpt(text, at, needleLength),
  }
}

/**
 * Everything the shelf can answer without opening a file: the books
 * themselves, and every bookmark, highlight and kept answer in them.
 *
 * Books come first because a reader typing a title wants the book, not the
 * seventeen times its title appears in their own notes.
 */
export function searchShelfMeta(
  books: readonly ShelfBook[],
  annotations: readonly Annotation[],
  query: string,
): ShelfHit[] {
  const needle = shelfNeedle(query)
  if (needle === null) return []
  const byId = new Map(books.map((book) => [book.id, book]))
  const bookHits: ShelfHit[] = []
  const markHits: ShelfHit[] = []

  for (const book of books) {
    const inTitle = book.title.toLowerCase().indexOf(needle)
    if (inTitle !== -1) {
      bookHits.push(
        hitFrom(
          'book',
          `book:${book.id}`,
          book,
          book.author ?? '',
          book.title,
          inTitle,
          needle.length,
          null,
        ),
      )
      continue
    }
    const inAuthor = (book.author ?? '').toLowerCase().indexOf(needle)
    if (inAuthor !== -1) {
      bookHits.push(
        hitFrom(
          'book',
          `book:${book.id}`,
          book,
          book.title,
          book.author ?? '',
          inAuthor,
          needle.length,
          null,
        ),
      )
    }
  }

  for (const mark of annotations) {
    const book = byId.get(mark.bookId)
    // A mark whose book has been removed is not a place anyone can go.
    if (!book) continue
    // The text first: it is what the reader actually wrote or saved. A
    // highlight's label is only its own opening words, so matching there
    // would report the same passage twice.
    const text = mark.text ?? ''
    const inText = text.toLowerCase().indexOf(needle)
    if (inText !== -1) {
      markHits.push(
        hitFrom(
          'mark',
          `mark:${mark.id}`,
          book,
          mark.label,
          text,
          inText,
          needle.length,
          mark.position,
          mark.type,
        ),
      )
      continue
    }
    const inLabel = mark.label.toLowerCase().indexOf(needle)
    if (inLabel !== -1) {
      markHits.push(
        hitFrom(
          'mark',
          `mark:${mark.id}`,
          book,
          book.title,
          mark.label,
          inLabel,
          needle.length,
          mark.position,
          mark.type,
        ),
      )
    }
  }

  return [...bookHits, ...markHits].slice(0, MAX_SHELF_HITS)
}

/** Turn one book's in-text matches into shelf hits. */
export function passageHits(book: ShelfBook, matches: readonly SearchMatch[]): ShelfHit[] {
  return matches.map((match, index) => ({
    id: `text:${book.id}:${match.sectionIndex}:${index}`,
    kind: 'passage' as const,
    bookId: book.id,
    bookTitle: book.title,
    where: match.sectionLabel,
    excerpt: match.excerpt,
    matchStart: match.matchStart,
    matchEnd: match.matchEnd,
    position: match.position,
  }))
}

/** The excerpt split into before / match / after, so a component can mark the
 *  middle without building HTML by hand. */
export function splitExcerpt(hit: ShelfHit): [string, string, string] {
  return [
    hit.excerpt.slice(0, hit.matchStart),
    hit.excerpt.slice(hit.matchStart, hit.matchEnd),
    hit.excerpt.slice(hit.matchEnd),
  ]
}
