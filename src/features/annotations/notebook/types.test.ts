import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type {
  NotebookEntry,
  NotebookFilter,
} from '@/features/annotations/notebook/types';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';

describe('NotebookEntry', () => {
  it('narrows on kind="bookmark"', () => {
    const bookmark: Bookmark = {
      id: BookmarkId('b-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'pdf', page: 3 },
      snippet: null,
      sectionTitle: null,
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const entry: NotebookEntry = { kind: 'bookmark', bookmark };
    if (entry.kind === 'bookmark') {
      expect(entry.bookmark.id).toBe('b-1');
    }
  });

  it('narrows on kind="highlight" with optional note', () => {
    const highlight: Highlight = {
      id: HighlightId('h-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const note: Note = {
      id: NoteId('n-1'),
      bookId: BookId('book-1'),
      anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
      content: 'thought',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const withNote: NotebookEntry = { kind: 'highlight', highlight, note };
    const withoutNote: NotebookEntry = { kind: 'highlight', highlight, note: null };
    if (withNote.kind === 'highlight') expect(withNote.note?.content).toBe('thought');
    if (withoutNote.kind === 'highlight') expect(withoutNote.note).toBeNull();
  });

  it('NotebookFilter compiles for all four values', () => {
    const filters: NotebookFilter[] = ['all', 'bookmarks', 'highlights', 'notes'];
    expect(filters).toHaveLength(4);
  });
});
