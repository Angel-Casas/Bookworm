import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import { matchesFilter } from './notebookFilter';
import type { NotebookEntry } from './types';

const BOOKMARK: NotebookEntry = {
  kind: 'bookmark',
  bookmark: {
    id: BookmarkId('b-1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'pdf', page: 1 },
    snippet: null,
    sectionTitle: null,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  },
};

const HIGHLIGHT_NO_NOTE: NotebookEntry = {
  kind: 'highlight',
  highlight: {
    id: HighlightId('h-1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'x' },
    selectedText: 'x',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  },
  note: null,
};

const HIGHLIGHT_WITH_NOTE: NotebookEntry = {
  kind: 'highlight',
  highlight:
    HIGHLIGHT_NO_NOTE.kind === 'highlight' ? HIGHLIGHT_NO_NOTE.highlight : ({} as never),
  note: {
    id: NoteId('n-1'),
    bookId: BookId('book-1'),
    anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
    content: 'thought',
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  },
};

describe('matchesFilter', () => {
  it("'all' matches everything", () => {
    expect(matchesFilter(BOOKMARK, 'all')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'all')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'all')).toBe(true);
  });

  it("'bookmarks' matches only bookmark entries", () => {
    expect(matchesFilter(BOOKMARK, 'bookmarks')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'bookmarks')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'bookmarks')).toBe(false);
  });

  it("'highlights' matches all highlight entries (with or without note)", () => {
    expect(matchesFilter(BOOKMARK, 'highlights')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'highlights')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'highlights')).toBe(true);
  });

  it("'notes' matches only highlight entries with a note attached", () => {
    expect(matchesFilter(BOOKMARK, 'notes')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'notes')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'notes')).toBe(true);
  });
});
