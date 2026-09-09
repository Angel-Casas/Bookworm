/** Pure ordering logic for the library shelf. */
import type { BookMeta } from '@/lib/types'

export type LibrarySort = 'reading' | 'finished' | 'added' | 'format'

export interface LibrarySortOption {
  id: LibrarySort
  /** Catalogue key for the label — the words live in src/i18n, so this file
   *  stays pure and says only what the orderings ARE. */
  labelKey: `sort.${LibrarySort}`
}

export const LIBRARY_SORT_OPTIONS: readonly LibrarySortOption[] = [
  { id: 'reading', labelKey: 'sort.reading' },
  { id: 'finished', labelKey: 'sort.finished' },
  { id: 'added', labelKey: 'sort.added' },
  { id: 'format', labelKey: 'sort.format' },
] as const

export const DEFAULT_LIBRARY_SORT: LibrarySort = 'added'

export function isLibrarySort(value: unknown): value is LibrarySort {
  return LIBRARY_SORT_OPTIONS.some((option) => option.id === value)
}

/** Newest-first comparator over a nullable timestamp; absent sinks to the end. */
function byRecency(a: number | null | undefined, b: number | null | undefined): number {
  return (b ?? 0) - (a ?? 0)
}

/**
 * Everything the reader is in the middle of, most recently opened first.
 *
 * A book has to have been OPENED to qualify — importing a shelf full of books
 * should not put one of them under "Continue reading", because the reader has
 * not started it. Finished books are skipped: the shelf below is where you go
 * to re-read something you have closed for good.
 *
 * Being open is what counts as progress here, not a percentage. A book whose
 * pages have not been counted yet has `progress: null` and would fail any test
 * on the number, which would drop the very book the reader opened five minutes
 * ago — the one they are most likely to want back.
 */
export function booksInProgress(books: readonly BookMeta[]): BookMeta[] {
  return books
    .filter((book) => book.finishedAt == null && book.lastOpenedAt != null)
    .sort((a, b) => byRecency(a.lastOpenedAt, b.lastOpenedAt))
}

/**
 * The book to offer picking up again: the first of those. Null on a shelf
 * nobody has read.
 */
export function bookToContinue(books: readonly BookMeta[]): BookMeta | null {
  return booksInProgress(books)[0] ?? null
}

/**
 * Returns a NEW array ordered per `sort`:
 * - reading:  most recently opened first; never-opened books last (by added date).
 * - finished: finished books first (latest finish first), the rest below, each
 *   half falling back to recently-opened order.
 * - added:    newest additions first.
 * - format:   grouped by format (alphabetical), titles A–Z inside each group.
 */
export function sortBooks(books: readonly BookMeta[], sort: LibrarySort): BookMeta[] {
  const copy = [...books]
  switch (sort) {
    case 'reading':
      return copy.sort(
        (a, b) => byRecency(a.lastOpenedAt, b.lastOpenedAt) || byRecency(a.addedAt, b.addedAt),
      )
    case 'finished':
      return copy.sort((a, b) => {
        const aDone = a.finishedAt != null ? 1 : 0
        const bDone = b.finishedAt != null ? 1 : 0
        if (aDone !== bDone) return bDone - aDone
        return (
          byRecency(a.finishedAt, b.finishedAt) ||
          byRecency(a.lastOpenedAt, b.lastOpenedAt) ||
          byRecency(a.addedAt, b.addedAt)
        )
      })
    case 'format':
      return copy.sort(
        (a, b) =>
          a.format.localeCompare(b.format) ||
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      )
    case 'added':
      return copy.sort((a, b) => byRecency(a.addedAt, b.addedAt))
  }
}
