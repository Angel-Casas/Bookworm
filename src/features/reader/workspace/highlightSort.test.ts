import { describe, it, expect } from 'vitest';
import { compareHighlightsInBookOrder } from './highlightSort';
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type { Highlight } from '@/domain/annotations/types';

function pdf(
  page: number,
  x: number,
  y: number,
  createdAt = '2026-05-03T12:00:00.000Z',
): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page, rects: [{ x, y, width: 10, height: 10 }] },
    selectedText: 't',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(createdAt),
  };
}

function epub(cfi: string, createdAt = '2026-05-03T12:00:00.000Z'): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi },
    selectedText: 't',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(createdAt),
  };
}

describe('compareHighlightsInBookOrder', () => {
  it('PDF: page asc, then y asc, then x asc', () => {
    const list = [pdf(2, 100, 100), pdf(1, 100, 200), pdf(1, 50, 100), pdf(1, 200, 100)];
    list.sort(compareHighlightsInBookOrder);
    const summary = list.map((h) =>
      h.anchor.kind === 'pdf'
        ? `${String(h.anchor.page)}:${String(h.anchor.rects[0]?.y)}:${String(h.anchor.rects[0]?.x)}`
        : 'x',
    );
    expect(summary).toEqual(['1:100:50', '1:100:200', '1:200:100', '2:100:100']);
  });

  it('EPUB: CFI lex order', () => {
    const list = [
      epub('epubcfi(/6/4!/4)'),
      epub('epubcfi(/6/2!/4)'),
      epub('epubcfi(/6/6!/4)'),
    ];
    list.sort(compareHighlightsInBookOrder);
    const cfis = list.map((h) => (h.anchor.kind === 'epub-cfi' ? h.anchor.cfi : 'x'));
    expect(cfis).toEqual([
      'epubcfi(/6/2!/4)',
      'epubcfi(/6/4!/4)',
      'epubcfi(/6/6!/4)',
    ]);
  });

  it('mixed kinds fall back to createdAt', () => {
    const list = [
      epub('epubcfi(/6/2!/4)', '2026-05-03T13:00:00.000Z'),
      pdf(1, 0, 0, '2026-05-03T12:00:00.000Z'),
    ];
    list.sort(compareHighlightsInBookOrder);
    expect(list[0]?.anchor.kind).toBe('pdf');
  });
});
