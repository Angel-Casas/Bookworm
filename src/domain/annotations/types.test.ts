import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type {
  Bookmark,
  Highlight,
  HighlightAnchor,
  HighlightRect,
  Note,
  NoteAnchorRef,
} from '@/domain/annotations/types';

describe('Bookmark', () => {
  it('has the v1 shape with nullable snippet and sectionTitle', () => {
    const b: Bookmark = {
      id: BookmarkId('00000000-0000-0000-0000-000000000001'),
      bookId: BookId('book-1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
      snippet: null,
      sectionTitle: null,
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(b.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(b.snippet).toBeNull();
    expect(b.sectionTitle).toBeNull();
  });

  it('accepts a populated bookmark with snippet + section title', () => {
    const b: Bookmark = {
      id: BookmarkId('id-2'),
      bookId: BookId('book-2'),
      anchor: { kind: 'pdf', page: 7 },
      snippet: 'It is a truth universally acknowledged…',
      sectionTitle: 'Page 7',
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(b.snippet).toContain('truth');
    expect(b.sectionTitle).toBe('Page 7');
  });
});

describe('Highlight', () => {
  it('has the v1 shape with HighlightAnchor + nullable sectionTitle', () => {
    const epubAnchor: HighlightAnchor = {
      kind: 'epub-cfi',
      cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)',
    };
    const pdfRect: HighlightRect = { x: 10, y: 20, width: 100, height: 14 };
    const pdfAnchor: HighlightAnchor = {
      kind: 'pdf',
      page: 7,
      rects: [pdfRect],
    };
    const epub: Highlight = {
      id: HighlightId('00000000-0000-0000-0000-000000000001'),
      bookId: BookId('book-1'),
      anchor: epubAnchor,
      selectedText: 'Hello world',
      sectionTitle: 'Chapter 1',
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    const pdf: Highlight = {
      id: HighlightId('id-2'),
      bookId: BookId('book-2'),
      anchor: pdfAnchor,
      selectedText: 'page seven snippet',
      sectionTitle: null,
      color: 'green',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(epub.anchor.kind).toBe('epub-cfi');
    expect(pdf.anchor.kind).toBe('pdf');
    if (pdf.anchor.kind === 'pdf') {
      expect(pdf.anchor.rects[0]?.x).toBe(10);
    }
    expect(pdf.sectionTitle).toBeNull();
    expect(epub.tags).toEqual([]);
  });
});

describe('Note', () => {
  it('NoteId brand round-trips a string', () => {
    const id = NoteId('00000000-0000-0000-0000-000000000001');
    expect(typeof id).toBe('string');
    expect(id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('narrows NoteAnchorRef on kind', () => {
    const refs: readonly NoteAnchorRef[] = [
      { kind: 'highlight', highlightId: HighlightId('h-1') },
      { kind: 'location', anchor: { kind: 'pdf', page: 3 } },
    ];
    const highlightIds = refs
      .filter((r) => r.kind === 'highlight')
      .map((r) => r.highlightId);
    const locationKinds = refs
      .filter((r) => r.kind === 'location')
      .map((r) => r.anchor.kind);
    expect(highlightIds).toEqual(['h-1']);
    expect(locationKinds).toEqual(['pdf']);
  });

  it('Note has v1 shape with createdAt + updatedAt', () => {
    const n: Note = {
      id: NoteId('n-1'),
      bookId: BookId('book-1'),
      anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
      content: 'a thought',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:30:00.000Z'),
    };
    expect(n.content).toBe('a thought');
    expect(n.updatedAt).not.toBe(n.createdAt);
  });
});
