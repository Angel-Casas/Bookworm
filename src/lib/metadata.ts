/**
 * Pure metadata helpers. No side effects: every function's output is fully
 * determined by its inputs.
 */
import type { BookFormat } from './types'

const EXTENSION_TO_FORMAT: Readonly<Record<string, BookFormat>> = {
  pdf: 'pdf',
  epub: 'epub',
}

const MIME_TO_FORMAT: Readonly<Record<string, BookFormat>> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
}

/** Infer the book format from a file's name and MIME type, or null if unsupported. */
export function inferFormat(fileName: string, mimeType: string): BookFormat | null {
  const byMime = MIME_TO_FORMAT[mimeType.toLowerCase()]
  if (byMime) return byMime
  const extension = fileName.toLowerCase().split('.').pop() ?? ''
  return EXTENSION_TO_FORMAT[extension] ?? null
}

/** Derive a human-readable title from a file name (fallback when a book has no metadata title). */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  const spaced = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return spaced.length > 0 ? spaced : fileName
}

/** Normalize a raw metadata author value into a display string or null. */
export function normalizeAuthor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Normalize a raw metadata title, falling back to the file name. */
export function normalizeTitle(raw: unknown, fileName: string): string {
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  return titleFromFileName(fileName)
}

/** Format a byte count for display, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB'] as const
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}
