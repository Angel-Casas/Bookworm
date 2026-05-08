import type { HighlightAnchor } from './types';

export function compareAnchorsInBookOrder(a: HighlightAnchor, b: HighlightAnchor): number {
  if (a.kind === 'pdf' && b.kind === 'pdf') {
    if (a.page !== b.page) return a.page - b.page;
    const ar = a.rects[0];
    const br = b.rects[0];
    if (!ar || !br) return 0;
    if (ar.y !== br.y) return ar.y - br.y;
    if (ar.x !== br.x) return ar.x - br.x;
    return 0;
  }
  if (a.kind === 'epub-cfi' && b.kind === 'epub-cfi') {
    return a.cfi < b.cfi ? -1 : a.cfi > b.cfi ? 1 : 0;
  }
  return 0;
}
