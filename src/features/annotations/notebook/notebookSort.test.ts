import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp } from '@/domain';
import type { Bookmark, Highlight } from '@/domain/annotations/types';
import { compareNotebookEntries } from './notebookSort';
import type { NotebookEntry } from './types';

function bm(opts: { id: string; anchor: Bookmark['anchor']; createdAt?: string }): NotebookEntry {
  return {
    kind: 'bookmark',
    bookmark: {
      id: BookmarkId(opts.id),
      bookId: BookId('book-1'),
      anchor: opts.anchor,
      snippet: null,
      sectionTitle: null,
      createdAt: IsoTimestamp(opts.createdAt ?? '2026-05-04T12:00:00.000Z'),
    },
  };
}

function hl(opts: {
  id: string;
  anchor: Highlight['anchor'];
  createdAt?: string;
}): NotebookEntry {
  return {
    kind: 'highlight',
    highlight: {
      id: HighlightId(opts.id),
      bookId: BookId('book-1'),
      anchor: opts.anchor,
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp(opts.createdAt ?? '2026-05-04T12:00:00.000Z'),
    },
    note: null,
  };
}

function idOf(e: NotebookEntry): string {
  switch (e.kind) {
    case 'bookmark':
      return e.bookmark.id;
    case 'highlight':
      return e.highlight.id;
    case 'savedAnswer':
      return e.savedAnswer.id;
  }
}

describe('compareNotebookEntries', () => {
  it('PDF: sorts by page, then y, then x; bookmarks and highlights interleave', () => {
    const list: NotebookEntry[] = [
      hl({ id: 'h-2', anchor: { kind: 'pdf', page: 2, rects: [{ x: 50, y: 50, width: 1, height: 1 }] } }),
      bm({ id: 'b-1', anchor: { kind: 'pdf', page: 1 } }),
      hl({ id: 'h-3', anchor: { kind: 'pdf', page: 1, rects: [{ x: 200, y: 100, width: 1, height: 1 }] } }),
      hl({ id: 'h-4', anchor: { kind: 'pdf', page: 1, rects: [{ x: 50, y: 100, width: 1, height: 1 }] } }),
    ];
    list.sort(compareNotebookEntries);
    expect(list.map(idOf)).toEqual(['b-1', 'h-4', 'h-3', 'h-2']);
  });

  it('EPUB: sorts by CFI lex order; bookmarks and highlights interleave', () => {
    const list: NotebookEntry[] = [
      hl({ id: 'h-2', anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' } }),
      bm({ id: 'b-1', anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/2)' } }),
      hl({ id: 'h-3', anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/6!/4/2)' } }),
    ];
    list.sort(compareNotebookEntries);
    expect(list.map(idOf)).toEqual(['b-1', 'h-2', 'h-3']);
  });

  it('mixed-kind anchors fall back to createdAt', () => {
    const list: NotebookEntry[] = [
      bm({ id: 'b-1', anchor: { kind: 'pdf', page: 1 }, createdAt: '2026-05-04T13:00:00.000Z' }),
      hl({ id: 'h-1', anchor: { kind: 'epub-cfi', cfi: 'x' }, createdAt: '2026-05-04T12:00:00.000Z' }),
    ];
    list.sort(compareNotebookEntries);
    expect(list.map(idOf)).toEqual(['h-1', 'b-1']);
  });

  it('PDF anchor without rects falls back to (page, 0, 0)', () => {
    const list: NotebookEntry[] = [
      hl({ id: 'h-1', anchor: { kind: 'pdf', page: 2, rects: [] } }),
      bm({ id: 'b-1', anchor: { kind: 'pdf', page: 2 } }),
    ];
    list.sort(compareNotebookEntries);
    expect(idOf(list[0]!)).toBe('h-1');
  });
});
