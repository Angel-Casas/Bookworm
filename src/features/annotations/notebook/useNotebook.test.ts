/* eslint-disable @typescript-eslint/unbound-method --
   The spies on repo methods are vi.fn() and don't use `this`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotebook } from './useNotebook';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type {
  BookmarksRepository,
  HighlightsRepository,
  NotesRepository,
} from '@/storage';

function fakeBookmarksRepo(initial: Bookmark[] = []): BookmarksRepository {
  const store = new Map<string, Bookmark>(initial.map((b) => [b.id, b]));
  return {
    add: vi.fn((b: Bookmark): Promise<void> => {
      store.set(b.id, b);
      return Promise.resolve();
    }),
    patch: vi.fn(() => Promise.resolve()),
    delete: vi.fn((id: ReturnType<typeof BookmarkId>): Promise<void> => {
      store.delete(id);
      return Promise.resolve();
    }),
    listByBook: vi.fn(
      (bookId: ReturnType<typeof BookId>): Promise<readonly Bookmark[]> =>
        Promise.resolve([...store.values()].filter((b) => b.bookId === bookId)),
    ),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

function fakeHighlightsRepo(initial: Highlight[] = []): HighlightsRepository {
  const store = new Map<string, Highlight>(initial.map((h) => [h.id, h]));
  return {
    add: vi.fn((h: Highlight): Promise<void> => {
      store.set(h.id, h);
      return Promise.resolve();
    }),
    patch: vi.fn(
      (
        id: ReturnType<typeof HighlightId>,
        partial: Partial<Highlight>,
      ): Promise<void> => {
        const existing = store.get(id);
        if (!existing) return Promise.resolve();
        store.set(id, { ...existing, ...partial });
        return Promise.resolve();
      },
    ),
    delete: vi.fn((id: ReturnType<typeof HighlightId>): Promise<void> => {
      store.delete(id);
      return Promise.resolve();
    }),
    listByBook: vi.fn(
      (bookId: ReturnType<typeof BookId>): Promise<readonly Highlight[]> =>
        Promise.resolve([...store.values()].filter((h) => h.bookId === bookId)),
    ),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

function fakeNotesRepo(initial: Note[] = []): NotesRepository {
  const store = new Map<string, Note>(initial.map((n) => [n.id, n]));
  return {
    upsert: vi.fn((n: Note): Promise<void> => {
      store.set(n.id, n);
      return Promise.resolve();
    }),
    delete: vi.fn((id: ReturnType<typeof NoteId>): Promise<void> => {
      store.delete(id);
      return Promise.resolve();
    }),
    listByBook: vi.fn(
      (bookId: ReturnType<typeof BookId>): Promise<readonly Note[]> =>
        Promise.resolve([...store.values()].filter((n) => n.bookId === bookId)),
    ),
    getByHighlight: vi.fn((hid: ReturnType<typeof HighlightId>): Promise<Note | null> => {
      const n = [...store.values()].find(
        (x) => x.anchorRef.kind === 'highlight' && x.anchorRef.highlightId === hid,
      );
      return Promise.resolve(n ?? null);
    }),
    deleteByHighlight: vi.fn((hid: ReturnType<typeof HighlightId>): Promise<void> => {
      for (const [id, n] of store) {
        if (n.anchorRef.kind === 'highlight' && n.anchorRef.highlightId === hid) {
          store.delete(id);
          break;
        }
      }
      return Promise.resolve();
    }),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

function makeBookmark(opts: { id: string; page: number; snippet?: string }): Bookmark {
  return {
    id: BookmarkId(opts.id),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page: opts.page },
    snippet: opts.snippet ?? null,
    sectionTitle: null,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
}

function makeHighlight(opts: {
  id: string;
  page: number;
  selectedText?: string;
}): Highlight {
  return {
    id: HighlightId(opts.id),
    bookId: BookId('b1'),
    anchor: {
      kind: 'pdf',
      page: opts.page,
      rects: [{ x: 50, y: 50, width: 100, height: 12 }],
    },
    selectedText: opts.selectedText ?? '',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
}

function makeNote(opts: { id: string; highlightId: string; content: string }): Note {
  return {
    id: NoteId(opts.id),
    bookId: BookId('b1'),
    anchorRef: { kind: 'highlight', highlightId: HighlightId(opts.highlightId) },
    content: opts.content,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('useNotebook', () => {
  it('initial load aggregates bookmarks + highlights + notes in book order', async () => {
    const bookmarksRepo = fakeBookmarksRepo([makeBookmark({ id: 'b-1', page: 2 })]);
    const highlightsRepo = fakeHighlightsRepo([
      makeHighlight({ id: 'h-1', page: 1 }),
      makeHighlight({ id: 'h-2', page: 3 }),
    ]);
    const notesRepo = fakeNotesRepo([
      makeNote({ id: 'n-1', highlightId: 'h-2', content: 'thought' }),
    ]);
    const { result } = renderHook(() =>
      useNotebook({ bookId: BookId('b1'), bookmarksRepo, highlightsRepo, notesRepo }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(3);
    });
    const ids = result.current.entries.map((e) => {
      if (e.kind === 'bookmark') return e.bookmark.id;
      if (e.kind === 'highlight') return e.highlight.id;
      return e.savedAnswer.id;
    });
    expect(ids).toEqual(['h-1', 'b-1', 'h-2']);
    const noted = result.current.entries[2];
    expect(noted?.kind === 'highlight' && noted.note?.content).toBe('thought');
    expect(result.current.totalCount).toBe(3);
  });

  it('setQuery filters entries live', async () => {
    const bookmarksRepo = fakeBookmarksRepo([
      makeBookmark({ id: 'b-1', page: 1, snippet: 'apple' }),
    ]);
    const highlightsRepo = fakeHighlightsRepo([
      makeHighlight({ id: 'h-1', page: 2, selectedText: 'banana' }),
    ]);
    const notesRepo = fakeNotesRepo();
    const { result } = renderHook(() =>
      useNotebook({ bookId: BookId('b1'), bookmarksRepo, highlightsRepo, notesRepo }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    act(() => {
      result.current.setQuery('apple');
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.kind).toBe('bookmark');
  });

  it('setFilter("notes") shows only highlights with a note', async () => {
    const bookmarksRepo = fakeBookmarksRepo([makeBookmark({ id: 'b-1', page: 1 })]);
    const highlightsRepo = fakeHighlightsRepo([
      makeHighlight({ id: 'h-1', page: 2 }),
      makeHighlight({ id: 'h-2', page: 3 }),
    ]);
    const notesRepo = fakeNotesRepo([
      makeNote({ id: 'n-1', highlightId: 'h-2', content: 'x' }),
    ]);
    const { result } = renderHook(() =>
      useNotebook({ bookId: BookId('b1'), bookmarksRepo, highlightsRepo, notesRepo }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(3);
    });
    act(() => {
      result.current.setFilter('notes');
    });
    expect(result.current.entries).toHaveLength(1);
    const e = result.current.entries[0];
    expect(e?.kind === 'highlight' && e.highlight.id).toBe('h-2');
  });

  it('removeBookmark optimistic + rollback on repo failure', async () => {
    const target = makeBookmark({ id: 'b-1', page: 1 });
    const bookmarksRepo = fakeBookmarksRepo([target]);
    (bookmarksRepo.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo,
        highlightsRepo: fakeHighlightsRepo(),
        notesRepo: fakeNotesRepo(),
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await result.current.removeBookmark(target);
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
  });

  it('removeHighlight cascades the note (both repos called) + rollback on failure', async () => {
    const target = makeHighlight({ id: 'h-1', page: 1 });
    const note = makeNote({ id: 'n-1', highlightId: 'h-1', content: 'x' });
    const highlightsRepo = fakeHighlightsRepo([target]);
    const notesRepo = fakeNotesRepo([note]);
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo: fakeBookmarksRepo(),
        highlightsRepo,
        notesRepo,
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await result.current.removeHighlight(target);
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(0);
    });
    expect(highlightsRepo.delete).toHaveBeenCalledWith('h-1');
    expect(notesRepo.deleteByHighlight).toHaveBeenCalledWith('h-1');
  });

  it('changeColor optimistic + rollback on patch failure', async () => {
    const target = makeHighlight({ id: 'h-1', page: 1 });
    const highlightsRepo = fakeHighlightsRepo([target]);
    (highlightsRepo.patch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo: fakeBookmarksRepo(),
        highlightsRepo,
        notesRepo: fakeNotesRepo(),
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await result.current.changeColor(target, 'green');
    await waitFor(() => {
      const e = result.current.entries[0];
      expect(e?.kind === 'highlight' && e.highlight.color).toBe('yellow');
    });
  });

  it('saveNote upserts; saveNote("") deletes via deleteByHighlight', async () => {
    const target = makeHighlight({ id: 'h-1', page: 1 });
    const highlightsRepo = fakeHighlightsRepo([target]);
    const notesRepo = fakeNotesRepo();
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo: fakeBookmarksRepo(),
        highlightsRepo,
        notesRepo,
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await result.current.saveNote(target, 'first thought');
    await waitFor(() => {
      const e = result.current.entries[0];
      expect(e?.kind === 'highlight' && e.note?.content).toBe('first thought');
    });
    await result.current.saveNote(target, '');
    await waitFor(() => {
      const e = result.current.entries[0];
      expect(e?.kind === 'highlight' && e.note).toBeNull();
    });
    expect(notesRepo.deleteByHighlight).toHaveBeenCalled();
  });

  it('bookId change re-fetches', async () => {
    const bookmarksRepo = fakeBookmarksRepo();
    const highlightsRepo = fakeHighlightsRepo();
    const notesRepo = fakeNotesRepo();
    const { rerender } = renderHook(
      ({ id }: { id: ReturnType<typeof BookId> }) =>
        useNotebook({ bookId: id, bookmarksRepo, highlightsRepo, notesRepo }),
      { initialProps: { id: BookId('b1') } },
    );
    await waitFor(() => {
      expect(bookmarksRepo.listByBook).toHaveBeenCalledWith('b1');
    });
    rerender({ id: BookId('b2') });
    await waitFor(() => {
      expect(bookmarksRepo.listByBook).toHaveBeenCalledWith('b2');
    });
  });
});
