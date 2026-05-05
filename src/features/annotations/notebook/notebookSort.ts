import type { NotebookEntry } from './types';

type SortKey =
  | { readonly kind: 'epub-cfi'; readonly cfi: string }
  | { readonly kind: 'pdf'; readonly page: number; readonly y: number; readonly x: number }
  | { readonly kind: 'time-only' };

function getEntryAnchorKey(entry: NotebookEntry): SortKey {
  if (entry.kind === 'bookmark') {
    const a = entry.bookmark.anchor;
    if (a.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: a.cfi };
    return { kind: 'pdf', page: a.page, y: 0, x: 0 };
  }
  if (entry.kind === 'highlight') {
    const a = entry.highlight.anchor;
    if (a.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: a.cfi };
    const r = a.rects[0];
    return { kind: 'pdf', page: a.page, y: r?.y ?? 0, x: r?.x ?? 0 };
  }
  // savedAnswer has no book-position anchor in 4.3
  return { kind: 'time-only' };
}

function getEntryCreatedAt(entry: NotebookEntry): string {
  switch (entry.kind) {
    case 'bookmark':
      return entry.bookmark.createdAt;
    case 'highlight':
      return entry.highlight.createdAt;
    case 'savedAnswer':
      return entry.savedAnswer.createdAt;
  }
}

export function compareNotebookEntries(a: NotebookEntry, b: NotebookEntry): number {
  const ka = getEntryAnchorKey(a);
  const kb = getEntryAnchorKey(b);
  if (ka.kind === 'pdf' && kb.kind === 'pdf') {
    if (ka.page !== kb.page) return ka.page - kb.page;
    if (ka.y !== kb.y) return ka.y - kb.y;
    if (ka.x !== kb.x) return ka.x - kb.x;
    return 0;
  }
  if (ka.kind === 'epub-cfi' && kb.kind === 'epub-cfi') {
    return ka.cfi < kb.cfi ? -1 : ka.cfi > kb.cfi ? 1 : 0;
  }
  // Mixed kinds (book-positioned entries vs. saved AI answers, or mixed
  // PDF/EPUB books) fall back to createdAt for stable, deterministic output.
  const ta = getEntryCreatedAt(a);
  const tb = getEntryCreatedAt(b);
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}
