/** Pure helpers for reading positions (EPUB CFI strings / PDF page numbers). */

/** Parse a stored PDF position into a page number, or null when absent/invalid. */
export function parsePdfPosition(position: string | null | undefined): number | null {
  if (typeof position !== 'string') return null
  const page = Number.parseInt(position, 10)
  return Number.isInteger(page) && page >= 1 ? page : null
}

/** Clamp a 1-based page number into [1, pageCount]. */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || pageCount < 1) return 1
  return Math.min(Math.max(Math.trunc(page), 1), pageCount)
}

/** Whether a stored position looks like an EPUB CFI. */
export function isEpubCfi(position: string | null | undefined): boolean {
  return typeof position === 'string' && position.startsWith('epubcfi(')
}
