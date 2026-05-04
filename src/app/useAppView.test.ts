import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppView } from './useAppView';
import { LIBRARY_VIEW, readerView } from '@/app/view';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import type { SettingsRepository } from '@/storage';
import type { Book } from '@/domain';
import { BookId, IsoTimestamp } from '@/domain';

function fakeLibraryStore(books: Book[]): LibraryStore {
  return {
    getState: () => ({
      books,
      visibleBooks: () => books,
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

function fakeSettingsRepo(): SettingsRepository & { setView: ReturnType<typeof vi.fn> } {
  const setView = vi.fn(() => Promise.resolve());
  return {
    getLibrarySort: () => Promise.resolve(undefined),
    setLibrarySort: () => Promise.resolve(),
    getStoragePersistResult: () => Promise.resolve(undefined),
    setStoragePersistResult: () => Promise.resolve(),
    getView: () => Promise.resolve(undefined),
    setView,
    getFocusModeHintShown: () => Promise.resolve(false),
    setFocusModeHintShown: () => Promise.resolve(),
    getApiKeyBlob: () => Promise.resolve(undefined),
    putApiKeyBlob: () => Promise.resolve(),
    deleteApiKeyBlob: () => Promise.resolve(),
  };
}

const sampleBook = (id: string): Book => ({
  id: BookId(id),
  title: id,
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: `books/${id}/source.epub`,
    originalName: `${id}.epub`,
    byteSize: 1,
    mimeType: 'application/epub+zip',
    checksum: 'a'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp(new Date().toISOString()),
  updatedAt: IsoTimestamp(new Date().toISOString()),
});

describe('useAppView', () => {
  it('initializes with the provided view', () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: readerView('book-1') }),
    );
    expect(result.current.current).toEqual({ kind: 'reader', bookId: 'book-1' });
  });

  it('falls back to library when initial reader view references a deleted book', () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: readerView('ghost') }),
    );
    expect(result.current.current).toEqual(LIBRARY_VIEW);
  });

  it('goReader sets view + persists', async () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
    );
    act(() => {
      result.current.goReader(sampleBook('book-1'));
    });
    expect(result.current.current).toEqual({ kind: 'reader', bookId: 'book-1' });
    await Promise.resolve();
    expect(settingsRepo.setView).toHaveBeenCalledWith({ kind: 'reader', bookId: 'book-1' });
  });

  it('goLibrary sets view + persists', async () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: readerView('book-1') }),
    );
    act(() => {
      result.current.goLibrary();
    });
    expect(result.current.current).toEqual(LIBRARY_VIEW);
    await Promise.resolve();
    expect(settingsRepo.setView).toHaveBeenCalledWith(LIBRARY_VIEW);
  });

  describe('notebook + pendingAnchor', () => {
    it('goNotebook sets view to notebook(bookId)', () => {
      const settingsRepo = fakeSettingsRepo();
      const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
      const { result } = renderHook(() =>
        useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
      );
      act(() => {
        result.current.goNotebook('book-1');
      });
      expect(result.current.current).toEqual({ kind: 'notebook', bookId: 'book-1' });
    });

    it('goReaderAt sets view to reader + queues pendingAnchor (one-shot)', () => {
      const settingsRepo = fakeSettingsRepo();
      const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
      const { result } = renderHook(() =>
        useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
      );
      const anchor = { kind: 'pdf' as const, page: 3 };
      act(() => {
        result.current.goReaderAt('book-1', anchor);
      });
      expect(result.current.current).toEqual({ kind: 'reader', bookId: 'book-1' });
      expect(result.current.consumePendingAnchor()).toEqual(anchor);
      expect(result.current.consumePendingAnchor()).toBeUndefined();
    });

    it('non-reader setView clears pendingAnchor', () => {
      const settingsRepo = fakeSettingsRepo();
      const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
      const { result } = renderHook(() =>
        useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
      );
      act(() => {
        result.current.goReaderAt('book-1', { kind: 'pdf', page: 3 });
      });
      act(() => {
        result.current.goLibrary();
      });
      expect(result.current.consumePendingAnchor()).toBeUndefined();
    });
  });

  describe('settings', () => {
    it('goSettings sets view to {kind:"settings"}', () => {
      const settingsRepo = fakeSettingsRepo();
      const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
      const { result } = renderHook(() =>
        useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
      );
      act(() => {
        result.current.goSettings();
      });
      expect(result.current.current).toEqual({ kind: 'settings' });
    });
  });
});
