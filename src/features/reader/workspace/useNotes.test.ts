/* eslint-disable @typescript-eslint/unbound-method --
   The spies on NotesRepository methods are vi.fn() and don't use `this`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotes } from './useNotes';
import { BookId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { Note } from '@/domain/annotations/types';
import type { NotesRepository } from '@/storage';

function fakeRepo(initial: Note[] = []): NotesRepository {
  const store = new Map<string, Note>(initial.map((n) => [n.id, n]));
  return {
    upsert: vi.fn((n: Note): Promise<void> => {
      // enforce unique-by-highlight (only for kind:'highlight')
      if (n.anchorRef.kind === 'highlight') {
        const targetHighlightId = n.anchorRef.highlightId;
        const existing = [...store.values()].find(
          (x) =>
            x.id !== n.id &&
            x.anchorRef.kind === 'highlight' &&
            x.anchorRef.highlightId === targetHighlightId,
        );
        if (existing) return Promise.reject(new Error('unique constraint'));
      }
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
    deleteByBook: vi.fn((bookId: ReturnType<typeof BookId>): Promise<void> => {
      for (const [id, n] of store) if (n.bookId === bookId) store.delete(id);
      return Promise.resolve();
    }),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('useNotes', () => {
  it('initial load builds map keyed by highlightId', async () => {
    const initial: Note = {
      id: NoteId('n-1'),
      bookId: BookId('b1'),
      anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
      content: 'hello',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(result.current.byHighlightId.get(HighlightId('h-1'))?.content).toBe('hello');
    });
  });

  it('save for new highlight inserts optimistic record and persists', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.save(HighlightId('h-2'), 'a thought');
    });
    expect(result.current.byHighlightId.get(HighlightId('h-2'))?.content).toBe('a thought');
    expect(repo.upsert).toHaveBeenCalled();
  });

  it('save for existing highlight replaces content and bumps updatedAt', async () => {
    const initial: Note = {
      id: NoteId('n-1'),
      bookId: BookId('b1'),
      anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
      content: 'old',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(result.current.byHighlightId.has(HighlightId('h-1'))).toBe(true);
    });
    await act(async () => {
      await result.current.save(HighlightId('h-1'), 'new');
    });
    const updated = result.current.byHighlightId.get(HighlightId('h-1'));
    expect(updated?.content).toBe('new');
    expect(updated?.id).toBe('n-1'); // same record id reused
    expect(updated?.updatedAt).not.toBe(updated?.createdAt);
  });

  it('save with empty string routes to clear (delete)', async () => {
    const initial: Note = {
      id: NoteId('n-1'),
      bookId: BookId('b1'),
      anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
      content: 'old',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(result.current.byHighlightId.has(HighlightId('h-1'))).toBe(true);
    });
    await act(async () => {
      await result.current.save(HighlightId('h-1'), '   ');
    });
    expect(result.current.byHighlightId.has(HighlightId('h-1'))).toBe(false);
    expect(repo.deleteByHighlight).toHaveBeenCalledWith('h-1');
  });

  it('save rolls back on upsert failure', async () => {
    const repo = fakeRepo();
    (repo.upsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.save(HighlightId('h-2'), 'will-fail');
    });
    expect(result.current.byHighlightId.has(HighlightId('h-2'))).toBe(false);
  });

  it('clear rolls back on deleteByHighlight failure', async () => {
    const initial: Note = {
      id: NoteId('n-1'),
      bookId: BookId('b1'),
      anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
      content: 'old',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    (repo.deleteByHighlight as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(result.current.byHighlightId.has(HighlightId('h-1'))).toBe(true);
    });
    await act(async () => {
      await result.current.clear(HighlightId('h-1'));
    });
    // Map should be restored after rollback
    expect(result.current.byHighlightId.get(HighlightId('h-1'))?.content).toBe('old');
  });

  it('book change re-fetches', async () => {
    const repo = fakeRepo();
    const { rerender } = renderHook(
      ({ id }: { id: ReturnType<typeof BookId> }) => useNotes({ bookId: id, repo }),
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

  it('listByBook with location-anchored note is filtered out of byHighlightId', async () => {
    const locNote: Note = {
      id: NoteId('n-loc'),
      bookId: BookId('b1'),
      anchorRef: { kind: 'location', anchor: { kind: 'pdf', page: 3 } },
      content: 'from the future',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const repo = fakeRepo([locNote]);
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalled();
    });
    expect(result.current.byHighlightId.size).toBe(0);
  });
});

describe('useNotes load error handling', () => {
  function rejectingRepo(loadError: Error): NotesRepository {
    return {
      upsert: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listByBook: vi.fn(() => Promise.reject(loadError)),
      getByHighlight: vi.fn(() => Promise.resolve(null)),
      deleteByHighlight: vi.fn(() => Promise.resolve()),
      deleteByBook: vi.fn(() => Promise.resolve()),
    };
  }

  it('exposes loadError when listByBook rejects', async () => {
    const repo = rejectingRepo(new Error('db is gone'));
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(result.current.loadError).not.toBeNull();
    });
    expect(result.current.loadError?.message).toBe('db is gone');
    expect(result.current.byHighlightId.size).toBe(0);
  });

  it('retryLoad clears loadError and re-runs the load on success', async () => {
    let attempt = 0;
    const repo: NotesRepository = {
      upsert: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listByBook: vi.fn(() => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('first try'));
        return Promise.resolve([] as readonly Note[]);
      }),
      getByHighlight: vi.fn(() => Promise.resolve(null)),
      deleteByHighlight: vi.fn(() => Promise.resolve()),
      deleteByBook: vi.fn(() => Promise.resolve()),
    };
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(result.current.loadError).not.toBeNull();
    });
    act(() => {
      result.current.retryLoad();
    });
    await waitFor(() => {
      expect(result.current.loadError).toBeNull();
    });
    expect(repo.listByBook).toHaveBeenCalledTimes(2);
  });

  it('retryLoad after a second rejection still surfaces the new error', async () => {
    const repo = rejectingRepo(new Error('still broken'));
    const { result } = renderHook(() => useNotes({ bookId: BookId('b1'), repo }));
    await waitFor(() => {
      expect(result.current.loadError?.message).toBe('still broken');
    });
    act(() => {
      result.current.retryLoad();
    });
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.loadError?.message).toBe('still broken');
    });
  });
});
