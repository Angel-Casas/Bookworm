import type { Highlight } from '@/domain/annotations/types';

export function compareHighlightsInBookOrder(a: Highlight, b: Highlight): number {
  if (a.anchor.kind === 'pdf' && b.anchor.kind === 'pdf') {
    if (a.anchor.page !== b.anchor.page) return a.anchor.page - b.anchor.page;
    const ar = a.anchor.rects[0];
    const br = b.anchor.rects[0];
    if (!ar || !br) return 0;
    if (ar.y !== br.y) return ar.y - br.y;
    if (ar.x !== br.x) return ar.x - br.x;
    return 0;
  }
  if (a.anchor.kind === 'epub-cfi' && b.anchor.kind === 'epub-cfi') {
    return a.anchor.cfi < b.anchor.cfi ? -1 : a.anchor.cfi > b.anchor.cfi ? 1 : 0;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
