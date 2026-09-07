/**
 * Reader page counting.
 *
 * A PDF has real pages. An EPUB has none — it is a stream of text that
 * re-flows to whatever pane it is shown in — so a page count has to be
 * invented: the text is divided into fixed-size character spans, and the span
 * the reader is currently inside is called the page. That number is stable
 * across type size and window width (which is the point: a counter that
 * changed when you resized would be useless), but it is a rough measure of
 * progress, not a promise about any printed edition.
 */
import { formatPercent, type Locale } from '@/lib/format'

/**
 * Characters per synthetic EPUB page. epub.js's own default (150) yields
 * thousands of "pages" for a novel. 1500 characters is about 260 words, which
 * puts a 72k-word book near 270 pages — roughly what its paperback would run
 * to, so the number means something to a reader. Cached pagination records
 * this value, so changing it invalidates old caches rather than silently
 * mixing two scales.
 */
export const LOCATION_CHARS = 1500

export interface PageCount {
  /** 1-based page the reader is on. */
  current: number
  /** Total pages in the book; 0 while unknown. */
  total: number
}

/**
 * Turn a 0-based location index into a 1-based page, clamped into the book.
 * epub.js returns -1 before its locations are generated and can report an
 * index one past the end on the final page.
 */
export function pageFromLocation(index: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return 0
  if (index < 0) return 1
  return Math.min(Math.trunc(index) + 1, Math.trunc(total))
}

/** "12 / 340" — bare numbers, no words; empty when the count isn't known. */
export function formatPageCount(count: PageCount | null): string {
  if (!count || count.total <= 0 || count.current <= 0) return ''
  return `${count.current} / ${count.total}`
}

/**
 * How far through the book the reader is, 0 to 1.
 *
 * Derived from the same synthetic pages the counter shows, so the bar on the
 * shelf and the numbers in the reader can never disagree. Returns null when
 * the count is not known yet — a bar sitting at 0% is a claim about the
 * reader ("you have read none of this"), and an unknown is not that claim.
 */
export function readingProgress(count: PageCount | null): number | null {
  if (!count || count.total <= 0 || count.current <= 0) return null
  return Math.min(1, Math.max(0, count.current / count.total))
}

/**
 * "18%" — whole percents, in the reader's own numerals, and never a rounded 0%
 * or 100%: a reader who has started deserves better than "0%", and one who has
 * a page left is not done. The rule lives in lib/format now, with the rest of
 * the numbers.
 */
export function formatProgress(fraction: number | null | undefined, locale: Locale = 'en'): string {
  return formatPercent(fraction, locale)
}
