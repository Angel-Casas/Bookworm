/**
 * A book's contents, flattened for a menu.
 *
 * epub.js hands back a nested navigation tree with hrefs written however the
 * publisher wrote them — "chapter2.xhtml", "./Text/ch02.xhtml#part3",
 * "OEBPS/ch02.xhtml". Two jobs live here, both pure: turn the tree into a flat
 * list that remembers how deep each entry was, and decide which entry the
 * reader is currently inside, given the href epub.js reports for the page.
 */

export interface TocEntry {
  label: string
  href: string
  /** 0 for a top-level chapter, 1 for a section within it, and so on. */
  depth: number
}

interface RawNavItem {
  label?: unknown
  href?: unknown
  subitems?: unknown
}

/** How deep the menu will indent before it stops distinguishing levels. */
export const TOC_MAX_DEPTH = 3

/**
 * The nested navigation as one list. Entries without a usable label or href
 * are skipped, but their children are not — a publisher's empty grouping node
 * should not take its chapters with it.
 */
export function flattenToc(items: readonly unknown[], depth = 0): TocEntry[] {
  const entries: TocEntry[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as RawNavItem
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const href = typeof item.href === 'string' ? item.href.trim() : ''
    if (label.length > 0 && href.length > 0) {
      entries.push({ label, href, depth: Math.min(depth, TOC_MAX_DEPTH) })
    }
    if (Array.isArray(item.subitems) && item.subitems.length > 0) {
      // Children of a skipped node keep their own depth rather than jumping a
      // level: the tree's shape is the publisher's, not ours to flatten away.
      entries.push(...flattenToc(item.subitems, depth + 1))
    }
  }
  return entries
}

/** The file part of an href, without "./", a leading slash, or a fragment. */
export function tocPath(href: string): string {
  const withoutHash = href.split('#')[0] ?? ''
  return withoutHash.replace(/^\.?\//, '').toLowerCase()
}

/**
 * Which entry the reader is inside, as an index into the flat list.
 *
 * epub.js reports the section's href, which usually carries no fragment even
 * when the contents entry does. So: an exact match wins; failing that, the
 * FIRST entry in the same file, which is the chapter that file opens with.
 * Returns -1 when nothing matches, which is honest — some pages (a cover, a
 * copyright page) are in no chapter at all.
 */
export function currentTocIndex(entries: readonly TocEntry[], href: string | null): number {
  if (!href) return -1
  const exact = entries.findIndex((entry) => entry.href === href)
  if (exact !== -1) return exact
  const path = tocPath(href)
  if (path.length === 0) return -1
  return entries.findIndex((entry) => tocPath(entry.href) === path)
}
