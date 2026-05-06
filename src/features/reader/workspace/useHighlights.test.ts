/* eslint-disable @typescript-eslint/unbound-method --
   The spies on HighlightsRepository methods are vi.fn() and don't use `this`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useHighlights } from './useHighlights';
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type { Highlight, HighlightAnchor } from '@/domain/annotations/types';
import type { HighlightsRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';

function fakeRepo(initial: Highlight[] = []): HighlightsRepository {
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
    deleteByBook: vi.fn((bookId: ReturnType<typeof BookId>): Promise<void> => {
      for (const [id, h] of store) if (h.bookId === bookId) store.delete(id);
      return Promise.resolve();
    }),
  };
}

const ANCHOR: HighlightAnchor = {
  kind: 'epub-cfi',
  cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)',
};

function fakeReaderState(
  overrides: Partial<ReaderViewExposedState> = {},
): ReaderViewExposedState {
  return {
    toc: null,
    currentEntryId: undefined,
    prefs: null,
    goToAnchor: () => undefined,
    applyPreferences: () => undefined,
    getCurrentAnchor: () => ({ kind: 'epub-cfi', cfi: 'x' }),
    getSnippetAt: () => Promise.resolve(null),
    getSectionTitleAt: () => 'Chapter 1',
    getPassageContextAt: () => Promise.resolve({ text: '' }),
    loadHighlights: () => undefined,
    addHighlight: vi.fn(() => undefined),
    removeHighlight: vi.fn(() => undefined),
    onSelectionChange: () => () => undefined,
    onHighlightTap: () => () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('useHighlights', () => {
  it('initial load fetches by bookId', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b1');
    });
    expect(result.current.list).toEqual([]);
  });

  it('add inserts optimistic highlight, calls readerState.addHighlight, persists', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.add(ANCHOR, 'hello world', 'green');
    });

    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0]?.color).toBe('green');
    expect(result.current.list[0]?.sectionTitle).toBe('Chapter 1');
    expect(readerState.addHighlight).toHaveBeenCalled();
    expect(repo.add).toHaveBeenCalled();
  });

  it('add still persists when readerState is null (engine overlay is null-safe)', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.add(ANCHOR, 'x', 'yellow');
    });
    expect(result.current.list).toHaveLength(1);
    expect(repo.add).toHaveBeenCalled();
    // sectionTitle defaults to null when readerState can't supply one
    expect(result.current.list[0]?.sectionTitle).toBeNull();
  });

  it('add rolls back optimistic + clears overlay when repo.add throws', async () => {
    const repo = fakeRepo();
    repo.add = vi.fn(() => Promise.reject(new Error('boom')));
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.add(ANCHOR, 'x', 'yellow');
    });
    expect(result.current.list).toHaveLength(0);
    expect(readerState.removeHighlight).toHaveBeenCalled();
  });

  it('changeColor patches optimistically + re-renders + persists', async () => {
    const initial: Highlight = {
      id: HighlightId('h1'),
      bookId: BookId('b1'),
      anchor: ANCHOR,
      selectedText: 'x',
      sectionTitle: 'Chapter 1',
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(result.current.list).toHaveLength(1);
    });
    await act(async () => {
      await result.current.changeColor(initial, 'green');
    });
    expect(result.current.list[0]?.color).toBe('green');
    expect(readerState.addHighlight).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h1', color: 'green' }),
    );
    expect(repo.patch).toHaveBeenCalledWith('h1', { color: 'green' });
  });

  it('remove is optimistic + clears overlay + persists', async () => {
    const initial: Highlight = {
      id: HighlightId('h1'),
      bookId: BookId('b1'),
      anchor: ANCHOR,
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(result.current.list).toHaveLength(1);
    });
    await act(async () => {
      await result.current.remove(initial);
    });
    expect(result.current.list).toHaveLength(0);
    expect(readerState.removeHighlight).toHaveBeenCalledWith('h1');
    expect(repo.delete).toHaveBeenCalledWith('h1');
  });

  it('switching bookId reloads', async () => {
    const repo = fakeRepo();
    const { rerender } = renderHook(
      ({ id }: { id: ReturnType<typeof BookId> }) =>
        useHighlights({ bookId: id, repo, readerState: null }),
      { initialProps: { id: BookId('b1') } },
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b1');
    });
    rerender({ id: BookId('b2') });
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b2');
    });
  });

  it('add resolves to the constructed highlight', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });

    let returned: Highlight | undefined;
    await act(async () => {
      returned = await result.current.add(ANCHOR, 'hello', 'yellow');
    });
    expect(returned?.color).toBe('yellow');
    expect(returned?.selectedText).toBe('hello');
    expect(returned?.bookId).toBe('b1');
  });

  it('onAfterRemove fires after successful remove', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState();
    const onAfterRemove = vi.fn();
    const initial: Highlight = {
      id: HighlightId('h-1'),
      bookId: BookId('b1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    await repo.add(initial);
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState, onAfterRemove }),
    );
    await waitFor(() => {
      expect(result.current.list).toHaveLength(1);
    });

    await act(async () => {
      await result.current.remove(initial);
    });
    expect(onAfterRemove).toHaveBeenCalledWith(initial);
  });

  it('onAfterRemove is not called on failed remove', async () => {
    const repo = fakeRepo();
    (repo.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const readerState = fakeReaderState();
    const onAfterRemove = vi.fn();
    const initial: Highlight = {
      id: HighlightId('h-2'),
      bookId: BookId('b1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    await repo.add(initial);
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState, onAfterRemove }),
    );
    await waitFor(() => {
      expect(result.current.list).toHaveLength(1);
    });
    await act(async () => {
      await result.current.remove(initial);
    });
    expect(onAfterRemove).not.toHaveBeenCalled();
  });
});
