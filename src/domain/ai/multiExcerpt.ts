import type { HighlightAnchor } from '@/domain/annotations/types';
import type { HighlightId, IsoTimestamp } from '@/domain/ids';
import { compareAnchorsInBookOrder } from '@/domain/annotations/anchorOrder';

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

export function compareExcerptOrder(a: AttachedExcerpt, b: AttachedExcerpt): number {
  return compareAnchorsInBookOrder(a.anchor, b.anchor);
}

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

export type TrayAction =
  | { readonly type: 'add'; readonly excerpt: AttachedExcerpt }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'clear' };

export type TrayResult = 'ok' | 'full' | 'duplicate' | 'cleared';

export function trayReduce(
  prev: AttachedMultiExcerpt | null,
  action: TrayAction,
): { tray: AttachedMultiExcerpt | null; result: TrayResult } {
  if (action.type === 'clear') {
    return { tray: null, result: 'cleared' };
  }
  if (action.type === 'remove') {
    if (prev === null) return { tray: null, result: 'cleared' };
    const next = prev.excerpts.filter((e) => e.id !== action.id);
    if (next.length === 0) return { tray: null, result: 'cleared' };
    if (next.length === prev.excerpts.length) return { tray: prev, result: 'ok' };
    return { tray: { excerpts: next }, result: 'ok' };
  }
  // add
  const current = prev?.excerpts ?? [];
  if (current.some((e) => e.id === action.excerpt.id)) {
    return { tray: prev, result: 'duplicate' };
  }
  if (current.length >= MAX_EXCERPTS) {
    return { tray: prev, result: 'full' };
  }
  const next = [...current, action.excerpt].sort(compareExcerptOrder);
  return { tray: { excerpts: next }, result: 'ok' };
}
