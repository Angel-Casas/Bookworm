/* eslint-disable @typescript-eslint/unbound-method --
   The spies on Wiring's repo methods are vi.fn() and don't use `this`;
   passing them to expect() is the standard pattern. */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReaderHost } from './useReaderHost';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import type { Wiring } from '@/features/library/wiring';
import { DEFAULT_READER_PREFERENCES } from '@/domain/reader';
import { LIBRARY_VIEW } from '@/app/view';

function fakeLibraryStore(): LibraryStore {
  return {
    getState: () => ({
      books: [],
      visibleBooks: () => [],
      sort: 'recently-opened',
      search: '',
      setSearch: () => undefined,
      setSort: () => undefined,
      upsertBook: () => undefined,
      removeBook: () => undefined,
      replaceAll: () => undefined,
    }),
    subscribe: () => () => undefined,
  } as unknown as LibraryStore;
}

function fakeWiring(): Wiring {
  return {
    db: {} as never,
    bookRepo: {
      getById: vi.fn(() => Promise.resolve(undefined)),
      getAll: vi.fn(() => Promise.resolve([])),
      findByChecksum: vi.fn(() => Promise.resolve(undefined)),
      put: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    },
    settingsRepo: {
      setLibrarySort: vi.fn(() => Promise.resolve()),
      getLibrarySort: () => Promise.resolve(undefined),
      setView: vi.fn(() => Promise.resolve()),
      getView: () => Promise.resolve(undefined),
      getStoragePersistResult: () => Promise.resolve(undefined),
      setStoragePersistResult: () => Promise.resolve(),
      getFocusModeHintShown: vi.fn(() => Promise.resolve(false)),
      setFocusModeHintShown: vi.fn(() => Promise.resolve()),
    },
    opfs: {
      readFile: vi.fn(() => Promise.resolve(undefined)),
      writeFile: vi.fn(() => Promise.resolve()),
      removeRecursive: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => Promise.resolve([])),
    },
    readingProgressRepo: {
      get: vi.fn(() => Promise.resolve(undefined)),
      put: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listKeys: vi.fn(() => Promise.resolve([])),
    },
    readerPreferencesRepo: {
      get: vi.fn(() => Promise.resolve({ ...DEFAULT_READER_PREFERENCES })),
      put: vi.fn(() => Promise.resolve()),
    },
    bookmarksRepo: {
      add: vi.fn(() => Promise.resolve()),
      patch: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listByBook: vi.fn(() => Promise.resolve([])),
      deleteByBook: vi.fn(() => Promise.resolve()),
    },
    highlightsRepo: {
      add: vi.fn(() => Promise.resolve()),
      patch: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listByBook: vi.fn(() => Promise.resolve([])),
      deleteByBook: vi.fn(() => Promise.resolve()),
    },
    importDeps: {} as never,
    persistFirstQuotaRequest: vi.fn(() => Promise.resolve()),
  };
}

const baseOpts = {
  initialFocusMode: 'normal' as const,
  initialFocusModeHintShown: false,
};

describe('useReaderHost', () => {
  it('returns the expected callback bundle', () => {
    const { result } = renderHook(() =>
      useReaderHost({
        wiring: fakeWiring(),
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
        ...baseOpts,
      }),
    );
    expect(typeof result.current.loadBookForReader).toBe('function');
    expect(typeof result.current.createAdapter).toBe('function');
    expect(typeof result.current.onAnchorChange).toBe('function');
    expect(typeof result.current.onPreferencesChange).toBe('function');
    expect(typeof result.current.onFocusModeChange).toBe('function');
    expect(typeof result.current.onFilesPicked).toBe('function');
    expect(typeof result.current.onPersistSort).toBe('function');
    expect(typeof result.current.onRemoveBook).toBe('function');
    expect(typeof result.current.findBook).toBe('function');
  });

  it('exposes initialFocusMode passed in by caller (no async load)', () => {
    const { result } = renderHook(() =>
      useReaderHost({
        wiring: fakeWiring(),
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
        ...baseOpts,
        initialFocusMode: 'focus',
      }),
    );
    expect(result.current.initialFocusMode).toBe('focus');
  });

  it('exposes hasShownFirstTimeHint seeded from initialFocusModeHintShown', () => {
    const { result } = renderHook(() =>
      useReaderHost({
        wiring: fakeWiring(),
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
        ...baseOpts,
        initialFocusModeHintShown: true,
      }),
    );
    expect(result.current.hasShownFirstTimeHint).toBe(true);
  });

  it('onFirstTimeHintShown flips local state and writes to settings', () => {
    const wiring = fakeWiring();
    const { result } = renderHook(() =>
      useReaderHost({
        wiring,
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
        ...baseOpts,
      }),
    );
    expect(result.current.hasShownFirstTimeHint).toBe(false);
    act(() => {
      result.current.onFirstTimeHintShown();
    });
    expect(result.current.hasShownFirstTimeHint).toBe(true);
    expect(wiring.settingsRepo.setFocusModeHintShown).toHaveBeenCalledWith(true);
  });

  it('onFocusModeChange persists via readerPreferencesRepo', async () => {
    const wiring = fakeWiring();
    const { result } = renderHook(() =>
      useReaderHost({
        wiring,
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
        ...baseOpts,
      }),
    );
    await result.current.onFocusModeChange('focus');
    expect(wiring.readerPreferencesRepo.get).toHaveBeenCalled();
    expect(wiring.readerPreferencesRepo.put).toHaveBeenCalledWith(
      expect.objectContaining({ focusMode: 'focus' }),
    );
  });
});
