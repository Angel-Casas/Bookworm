import type { HighlightAnchor } from '@/domain/annotations/types';
import type { HighlightId, IsoTimestamp } from '@/domain/ids';

export const MAX_EXCERPTS = 6;
export const MAX_EXCERPT_CHARS = 4000;

export type ExcerptSourceKind = 'highlight' | 'selection';

export type AttachedExcerpt = {
  readonly id: string;
  readonly sourceKind: ExcerptSourceKind;
  readonly highlightId?: HighlightId;
  readonly anchor: HighlightAnchor;
  readonly sectionTitle: string;
  readonly text: string;
  readonly addedAt: IsoTimestamp;
};

export type AttachedMultiExcerpt = {
  readonly excerpts: readonly AttachedExcerpt[];
};

// Canonicalize a HighlightAnchor into a stable string for selection-kind
// excerpt id derivation. Two distinct selections with identical canonical
// anchors collide silently; acceptable for v1.
export function stableAnchorHash(anchor: HighlightAnchor): string {
  if (anchor.kind === 'epub-cfi') {
    return `cfi:${anchor.cfi}`;
  }
  const r = anchor.rects[0];
  const rectKey = r
    ? `${String(r.x)}:${String(r.y)}:${String(r.width)}:${String(r.height)}`
    : 'norects';
  return `pdf:${String(anchor.page)}:${rectKey}`;
}
