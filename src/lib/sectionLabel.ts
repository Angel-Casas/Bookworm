/**
 * What to call a section of a book.
 *
 * "Section 7" is a true statement and a useless one: it is the label on a
 * bookmark, on a citation the reader is meant to press, and on the context
 * line under a question. A chapter's own title is almost always sitting in its
 * first heading — and when it isn't, the number is still there to fall back on.
 */

/** Longest a label may run before it stops being a label. */
const MAX_LABEL = 48

/** Titles that carry no information beyond what the number already gives. */
const GENERIC = /^(chapter|section|part|page)\s*[\divxlcdm]*[.:]?$|^[\divxlcdm]+[.:]?$|^(contents|cover|title(\s+page)?|copyright|colophon|dedication|epigraph|index)$/i

function tidy(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Pick a label for a section from the headings found in it.
 *
 * `index` is 0-based; the fallback numbers from 1, matching how the rest of
 * the app counts. A title that merely repeats "Chapter 3" is treated as no
 * title at all, since the fallback says that better.
 */
export function sectionLabel(headings: readonly string[], index: number): string {
  const fallback = `Section ${index + 1}`
  for (const heading of headings) {
    const title = tidy(heading)
    if (title.length === 0 || title.length > MAX_LABEL) continue
    if (GENERIC.test(title)) continue
    // A heading like "Chapter 4: The Lamp" keeps both halves; it reads as a
    // place and sorts as one.
    return title
  }
  return fallback
}
