import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import { matchesQuery } from './notebookSearch';
import type { NotebookEntry } from './types';

function bookmark(opts: {
  snippet?: string | null;
  sectionTitle?: string | null;
}): NotebookEntry {
  return {
    kind: 'bookmark',
    bookmark: {
      id: BookmarkId('b-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'pdf', page: 1 },
      snippet: opts.snippet ?? null,
      sectionTitle: opts.sectionTitle ?? null,
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    },
  };
}

function highlight(opts: {
  selectedText?: string;
  sectionTitle?: string | null;
  noteContent?: string;
}): NotebookEntry {
  return {
    kind: 'highlight',
    highlight: {
      id: HighlightId('h-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'epub-cfi', cfi: 'x' },
      selectedText: opts.selectedText ?? '',
      sectionTitle: opts.sectionTitle ?? null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    },
    note:
      opts.noteContent !== undefined
        ? {
            id: NoteId('n-1'),
            bookId: BookId('book-1'),
            anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
            content: opts.noteContent,
            createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
            updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
          }
        : null,
  };
}

describe('matchesQuery', () => {
  it('empty query matches every entry', () => {
    expect(matchesQuery(bookmark({}), '')).toBe(true);
    expect(matchesQuery(highlight({}), '   ')).toBe(true);
  });

  it('bookmark snippet match (case-insensitive)', () => {
    expect(matchesQuery(bookmark({ snippet: 'Bingley represents' }), 'BINGLEY')).toBe(true);
    expect(matchesQuery(bookmark({ snippet: 'Bingley represents' }), 'darcy')).toBe(false);
  });

  it('bookmark with null snippet falls back to sectionTitle', () => {
    expect(
      matchesQuery(bookmark({ snippet: null, sectionTitle: 'Chapter 4' }), 'chapter'),
    ).toBe(true);
    expect(matchesQuery(bookmark({ snippet: null, sectionTitle: null }), 'chapter')).toBe(false);
  });

  it('highlight matches selectedText, sectionTitle, and note content', () => {
    expect(matchesQuery(highlight({ selectedText: 'a passage' }), 'PASSAGE')).toBe(true);
    expect(matchesQuery(highlight({ sectionTitle: 'Chapter 4' }), 'chapter')).toBe(true);
    expect(matchesQuery(highlight({ noteContent: 'gentry analysis' }), 'GENTRY')).toBe(true);
  });

  it('highlight without a note searches snippet+sectionTitle only', () => {
    const e = highlight({ selectedText: 'a passage', sectionTitle: 'Chapter 4' });
    expect(matchesQuery(e, 'thought')).toBe(false);
  });

  it('regex special characters are treated as literal text', () => {
    const e = bookmark({ snippet: 'price was $5.99 (final)' });
    expect(matchesQuery(e, '$5.99')).toBe(true);
    expect(matchesQuery(e, '(final)')).toBe(true);
    expect(matchesQuery(e, '.*')).toBe(false);
  });
});
