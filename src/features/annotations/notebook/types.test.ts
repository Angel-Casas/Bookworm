import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type {
  NotebookEntry,
  NotebookFilter,
} from '@/features/annotations/notebook/types';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';

describe('NotebookEntry', () => {
  const bookmark: Bookmark = {
    id: BookmarkId('b-1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'pdf', page: 3 },
    snippet: null,
    sectionTitle: null,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
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

  it('narrows the discriminated union on kind', () => {
    const entries: readonly NotebookEntry[] = [
      { kind: 'bookmark', bookmark },
      { kind: 'highlight', highlight, note },
      { kind: 'highlight', highlight, note: null },
    ];
    const bookmarkIds = entries
      .filter((e) => e.kind === 'bookmark')
      .map((e) => e.bookmark.id);
    const noteContents = entries
      .filter((e) => e.kind === 'highlight')
      .map((e) => e.note?.content ?? null);
    expect(bookmarkIds).toEqual(['b-1']);
    expect(noteContents).toEqual(['thought', null]);
  });

  it('NotebookFilter compiles for all four values', () => {
    const filters: NotebookFilter[] = ['all', 'bookmarks', 'highlights', 'notes'];
    expect(filters).toHaveLength(4);
  });
});
