/** Core domain types. This module must stay dependency-free. */

export type BookFormat = 'pdf' | 'epub'

export interface BookMeta {
  id: string
  title: string
  author: string | null
  format: BookFormat
  fileName: string
  fileSize: number
  addedAt: number
  lastOpenedAt: number | null
  /** Small cover image extracted at import time, if any. */
  coverBlob: Blob | null
  /**
   * Extractor version that last attempted this book's cover (older values —
   * including the boolean from v1 — are retried by the backfill).
   */
  coverChecked?: boolean | number
  /** Last reading position: an EPUB CFI string, or a PDF page number as string. */
  position?: string | null
  /** How far through, 0 to 1. Absent until the book has been opened and its
   *  pages counted; written by the reader alongside the position. */
  progress?: number | null
  /** When the reader marked this book finished (null/absent = not finished). */
  finishedAt?: number | null
  /** Per-book model override; null/absent = use the global setting. */
  modelId?: string | null
}

export interface ImportedBook {
  meta: BookMeta
  blob: Blob
}

/**
 * A mark left in a book. Notes are answers the reader chose to keep: a good
 * answer is worth as much as a highlight, and a chat that scrolls away is the
 * wrong place to store one.
 */
export type AnnotationType = 'bookmark' | 'highlight' | 'note'

export interface Annotation {
  id: string
  bookId: string
  type: AnnotationType
  /** Reading position: an EPUB CFI or a PDF page number as string. */
  position: string
  /** Display label, e.g. "Page 12" or "Section 3". */
  label: string
  /** Highlighted passage, or a kept answer (null for bookmarks). */
  text: string | null
  /** Pastel wash hex for highlights (null/absent for bookmarks). */
  color?: string | null
  createdAt: number
}
