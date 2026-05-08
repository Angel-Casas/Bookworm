import type { Highlight } from '@/domain/annotations/types';
import { compareAnchorsInBookOrder } from '@/domain/annotations/anchorOrder';

export { compareAnchorsInBookOrder };

export function compareHighlightsInBookOrder(a: Highlight, b: Highlight): number {
  const cmp = compareAnchorsInBookOrder(a.anchor, b.anchor);
  if (cmp !== 0) return cmp;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
