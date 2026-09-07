/** Pure in-book text search over extracted sections. */

export interface SearchableSection {
  index: number
  label: string
  text: string
  /** Where to jump for this section (EPUB href or PDF page number string). */
  position: string
}

export interface SearchMatch {
  sectionIndex: number
  sectionLabel: string
  position: string
  /** Excerpt around the match with the query in the middle. */
  excerpt: string
  /** Offsets of the matched query inside `excerpt` (for highlighting). */
  matchStart: number
  matchEnd: number
}

export const MAX_SEARCH_RESULTS = 50
const EXCERPT_RADIUS = 60

/** Case-insensitive substring search, capped at MAX_SEARCH_RESULTS matches. */
export function searchSections(sections: SearchableSection[], query: string): SearchMatch[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const results: SearchMatch[] = []

  for (const section of sections) {
    const haystack = section.text.toLowerCase()
    let fromIndex = 0
    while (results.length < MAX_SEARCH_RESULTS) {
      const at = haystack.indexOf(needle, fromIndex)
      if (at === -1) break
      results.push({
        sectionIndex: section.index,
        sectionLabel: section.label,
        position: section.position,
        ...makeExcerpt(section.text, at, needle.length),
      })
      fromIndex = at + needle.length
    }
    if (results.length >= MAX_SEARCH_RESULTS) break
  }
  return results
}

export interface ExcerptParts {
  excerpt: string
  matchStart: number
  matchEnd: number
}

/** A window of text around a match, with the match's offsets inside it.
 *  Shared with the shelf-wide search, which shows the same kind of line. */
export function makeExcerpt(text: string, at: number, matchLength: number): ExcerptParts {
  const start = Math.max(0, at - EXCERPT_RADIUS)
  const end = Math.min(text.length, at + matchLength + EXCERPT_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  const slice = text.slice(start, end)
  const leadingTrim = slice.length - slice.trimStart().length
  const trimmed = slice.trim()
  const matchStart = prefix.length + (at - start - leadingTrim)
  return {
    excerpt: `${prefix}${trimmed}${suffix}`,
    matchStart,
    matchEnd: matchStart + matchLength,
  }
}
