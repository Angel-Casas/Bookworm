/* eslint-disable @typescript-eslint/unbound-method --
   The spies on BookmarksRepository methods are vi.fn() and don't use `this`;
   passing them to expect() is the standard pattern. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBookmarks } from './useBookmarks';
import { BookId, BookmarkId, IsoTimestamp, type LocationAnchor } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import type { BookmarksRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';

function fakeRepo(initial: Bookmark[] = []): BookmarksRepository {
  const store = new Map<string, Bookmark>(initial.map((b) => [b.id, b]));
  return {
    add: vi.fn((b: Bookmark): Promise<void> => {
      store.set(b.id, b);
      return Promise.resolve();
    }),
    patch: vi.fn(
      (id: ReturnType<typeof BookmarkId>, partial: Partial<Bookmark>): Promise<void> => {
        const existing = store.get(id);
        if (!existing) return Promise.resolve();
        store.set(id, { ...existing, ...partial });
        return Promise.resolve();
      },
    ),
    delete: vi.fn((id: ReturnType<typeof BookmarkId>): Promise<void> => {
      store.delete(id);
      return Promise.resolve();
    }),
    listByBook: vi.fn(
      (bookId: ReturnType<typeof BookId>): Promise<readonly Bookmark[]> =>
        Promise.resolve(
          [...store.values()]
            .filter((b) => b.bookId === bookId)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        ),
    ),
    deleteByBook: vi.fn((bookId: ReturnType<typeof BookId>): Promise<void> => {
      for (const [id, b] of store) if (b.bookId === bookId) store.delete(id);
      return Promise.resolve();
    }),
  };
}

const ANCHOR: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' };

function fakeReaderState(
  overrides: Partial<ReaderViewExposedState> = {},
): ReaderViewExposedState {
  return {
    toc: null,
    currentEntryId: undefined,
    prefs: null,
    goToAnchor: () => undefined,
    applyPreferences: () => undefined,
    getCurrentAnchor: () => ANCHOR,
    getSnippetAt: () => Promise.resolve('a fresh snippet'),
    getSectionTitleAt: () => 'Chapter 4',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('useBookmarks', () => {
  it('initial load fetches by bookId', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b1');
    });
    expect(result.current.list).toEqual([]);
  });

  it('add inserts an optimistic bookmark with snippet:null then patches with extracted snippet', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.add();
    });

    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0]?.sectionTitle).toBe('Chapter 4');

    await waitFor(() => {
      expect(result.current.list[0]?.snippet).toBe('a fresh snippet');
    });
    expect(repo.add).toHaveBeenCalled();
    expect(repo.patch).toHaveBeenCalledWith(
      result.current.list[0]?.id,
      expect.objectContaining({ snippet: 'a fresh snippet' }),
    );
  });

  it('add no-ops when readerState is null', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.add();
    });
    expect(result.current.list).toHaveLength(0);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('add no-ops when getCurrentAnchor returns null', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState({ getCurrentAnchor: () => null });
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.add();
    });
    expect(result.current.list).toHaveLength(0);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('add rolls back the optimistic insert when repo.add throws', async () => {
    const repo = fakeRepo();
    repo.add = vi.fn(() => Promise.reject(new Error('IDB explode')));
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.add();
    });
    expect(result.current.list).toHaveLength(0);
  });

  it('remove is optimistic and rolls back on failure', async () => {
    const initial: Bookmark = {
      id: BookmarkId('keep'),
      bookId: BookId('b1'),
      anchor: ANCHOR,
      snippet: null,
      sectionTitle: 'Chapter 1',
      createdAt: IsoTimestamp('2026-05-03T11:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    repo.delete = vi.fn(() => Promise.reject(new Error('delete failed')));
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState: fakeReaderState() }),
    );
    await waitFor(() => {
      expect(result.current.list).toHaveLength(1);
    });
    await act(async () => {
      await result.current.remove(initial);
    });
    expect(result.current.list).toHaveLength(1);
  });

  it('switching bookId reloads the list', async () => {
    const repo = fakeRepo();
    const { result, rerender } = renderHook(
      ({ id }: { id: ReturnType<typeof BookId> }) =>
        useBookmarks({ bookId: id, repo, readerState: null }),
      { initialProps: { id: BookId('b1') } },
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b1');
    });
    rerender({ id: BookId('b2') });
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b2');
    });
    void result;
  });
});
