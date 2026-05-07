import type { Highlight, HighlightId, Note } from '@/domain';

export type FilteredAnnotations = {
  readonly highlights: readonly Highlight[];
  readonly notes: readonly Note[];
};

/**
 * Filters highlights+notes to those that belong to the given chapter title.
 *
 * Match heuristic for highlights: case-sensitive equality on
 * `Highlight.sectionTitle` (captured at creation via
 * `readerState.getSectionTitleAt(...)` — so it should align with TOC
 * entry titles by construction).
 *
 * Match heuristic for notes: include only highlight-anchored notes whose
 * `anchorRef.highlightId` is in the filtered highlights set. Location-
 * anchored notes are out of scope for v1 (would need anchor-to-section
 * resolution we don't have without parsing CFIs).
 */
export function filterAnnotationsForChapter(
  allHighlights: readonly Highlight[],
  allNotes: readonly Note[],
  chapterTitle: string,
): FilteredAnnotations {
  const highlights = allHighlights.filter((h) => h.sectionTitle === chapterTitle);
  const matchedIds = new Set<HighlightId>(highlights.map((h) => h.id));
  const notes = allNotes.filter(
    (n) => n.anchorRef.kind === 'highlight' && matchedIds.has(n.anchorRef.highlightId),
  );
  return { highlights, notes };
}
