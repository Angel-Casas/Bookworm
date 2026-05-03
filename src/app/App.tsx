import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { openBookwormDB } from '@/storage';
import { createLibraryStore, type LibraryStore } from '@/features/library/store/libraryStore';
import { createCoverCache, type CoverCache } from '@/features/library/store/coverCache';
import { createImportStore, type ImportStore } from '@/features/library/import/importStore';
import { createWiring, type Wiring } from '@/features/library/wiring';
import { loadLibrary } from '@/features/library/boot/loadLibrary';
import { sweepOrphans } from '@/features/library/orphan-sweep';
import { LibraryView } from '@/features/library/LibraryView';
import { LibraryBootError } from '@/features/library/LibraryBootError';
import { DropOverlay } from '@/features/library/DropOverlay';
import { ReaderView } from '@/features/reader/ReaderView';
import { EpubReaderAdapter } from '@/features/reader/epub/EpubReaderAdapter';
import { LIBRARY_VIEW, readerView, type AppView } from '@/app/view';
import { BookId, type Book, type LocationAnchor, type SortKey } from '@/domain';
import type { ReaderPreferences } from '@/domain/reader';
import './app.css';

type ReadyBoot = {
  readonly kind: 'ready';
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly initialView: AppView;
};

type BootState =
  | { readonly kind: 'loading' }
  | ReadyBoot
  | { readonly kind: 'error'; readonly reason: string };

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fn(...args);
    }, ms);
  }) as T;
}

function useHasBooks(libraryStore: LibraryStore): boolean {
  return useSyncExternalStore(
    (cb) => libraryStore.subscribe(cb),
    () => libraryStore.getState().books.length > 0,
    () => libraryStore.getState().books.length > 0,
  );
}

function useHasImportActivity(importStore: ImportStore): boolean {
  return useSyncExternalStore(
    (cb) => importStore.subscribe(cb),
    () => importStore.getState().entries.length > 0,
    () => importStore.getState().entries.length > 0,
  );
}

function findBook(libraryStore: LibraryStore, bookId: string): Book | undefined {
  return libraryStore.getState().books.find((b) => b.id === bookId);
}

function ReadyApp({ boot }: { readonly boot: ReadyBoot }) {
  const { wiring, libraryStore, importStore, coverCache, initialView } = boot;
  const hasBooks = useHasBooks(libraryStore);
  const hasImportActivity = useHasImportActivity(importStore);
  const showWorkspace = hasBooks || hasImportActivity;

  // View state — initialized from settings, persisted on every change.
  // If the persisted view referenced a now-deleted book, fall back to library.
  const [view, setViewState] = useState<AppView>(() => {
    if (initialView.kind === 'reader' && !findBook(libraryStore, initialView.bookId)) {
      return LIBRARY_VIEW;
    }
    return initialView;
  });

  const setView = useCallback(
    (next: AppView) => {
      setViewState(next);
      void wiring.settingsRepo.setView(next);
    },
    [wiring],
  );

  useEffect(() => {
    const onHide = (): void => {
      coverCache.forgetAll();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
    };
  }, [coverCache]);

  const onFilesPicked = (files: readonly File[]): void => {
    for (const file of files) importStore.getState().enqueue(file);
    void wiring.persistFirstQuotaRequest();
  };

  const onPersistSort = useMemo(
    () =>
      debounce((key: SortKey) => {
        void wiring.settingsRepo.setLibrarySort(key);
      }, 200),
    [wiring],
  );

  const handleRemove = async (book: Book): Promise<void> => {
    libraryStore.getState().removeBook(book.id);
    coverCache.forget(book.id);
    try {
      await wiring.bookRepo.delete(book.id);
      await wiring.opfs.removeRecursive(`books/${book.id}`);
      await wiring.readingProgressRepo.delete(book.id);
      // If we removed the book that's currently in the reader, fall back.
      if (view.kind === 'reader' && view.bookId === book.id) {
        setView(LIBRARY_VIEW);
      }
    } catch (err) {
      console.warn('Remove failed:', err);
    }
  };

  const handleOpenBook = useCallback(
    (book: Book): void => {
      setView(readerView(book.id));
    },
    [setView],
  );

  const handleBack = useCallback(() => {
    setView(LIBRARY_VIEW);
  }, [setView]);

  // Reader callbacks — stable identities so ReaderView's useMemo doesn't churn
  const loadBookForReader = useCallback(
    async (
      bookId: string,
    ): Promise<{ blob: Blob; preferences: ReaderPreferences; initialAnchor?: LocationAnchor }> => {
      const book = await wiring.bookRepo.getById(BookId(bookId));
      if (book?.source.kind !== 'imported-file') {
        throw new Error(`Book ${bookId} is missing or has no source`);
      }
      const blob = await wiring.opfs.readFile(book.source.opfsPath);
      if (!blob) {
        throw new Error(`Book ${bookId} blob missing from OPFS`);
      }
      const preferences = await wiring.readerPreferencesRepo.get();
      const initialAnchor = await wiring.readingProgressRepo.get(bookId);
      return initialAnchor ? { blob, preferences, initialAnchor } : { blob, preferences };
    },
    [wiring],
  );

  const createAdapter = useCallback((mountInto: HTMLElement) => {
    return new EpubReaderAdapter(mountInto);
  }, []);

  const onAnchorChange = useCallback(
    (bookId: string, anchor: LocationAnchor) => {
      void wiring.readingProgressRepo.put(bookId, anchor);
    },
    [wiring],
  );

  const onPreferencesChange = useCallback(
    (prefs: ReaderPreferences) => {
      void wiring.readerPreferencesRepo.put(prefs);
    },
    [wiring],
  );

  if (view.kind === 'reader') {
    const book = findBook(libraryStore, view.bookId);
    if (!book) {
      // Book vanished while in reader (e.g. removed in another tab); back out.
      setView(LIBRARY_VIEW);
      return null;
    }
    return (
      <div className="app">
        <ReaderView
          key={view.bookId}
          bookId={view.bookId}
          bookTitle={book.title}
          {...(book.author !== undefined && { bookSubtitle: book.author })}
          onBack={handleBack}
          loadBookForReader={loadBookForReader}
          createAdapter={createAdapter}
          onAnchorChange={onAnchorChange}
          onPreferencesChange={onPreferencesChange}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <LibraryView
        libraryStore={libraryStore}
        importStore={importStore}
        coverCache={coverCache}
        hasBooks={showWorkspace}
        onFilesPicked={onFilesPicked}
        onPersistSort={onPersistSort}
        onRemoveBook={(book) => {
          void handleRemove(book);
        }}
        onOpenBook={handleOpenBook}
      />
      <DropOverlay onFilesDropped={onFilesPicked} />
    </div>
  );
}

export function App() {
  const [boot, setBoot] = useState<BootState>({ kind: 'loading' });
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    void (async () => {
      try {
        const db = await openBookwormDB();
        if (!activeRef.current) return;
        const wiring = createWiring(db);
        const libraryStore = createLibraryStore();
        const coverCache = createCoverCache(wiring.opfs);
        const importStore = createImportStore(wiring.importDeps);

        importStore.subscribe((s) => {
          for (const e of s.entries) {
            if (e.status.kind === 'done') {
              libraryStore.getState().upsertBook(e.status.book);
            }
          }
        });

        await loadLibrary({ store: libraryStore, openDB: () => Promise.resolve(db) });
        void sweepOrphans(wiring.opfs, wiring.bookRepo, wiring.readingProgressRepo).catch(() => {
          /* best effort */
        });
        const persistedView = await wiring.settingsRepo.getView();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (!activeRef.current) return;
        setBoot({
          kind: 'ready',
          wiring,
          libraryStore,
          importStore,
          coverCache,
          initialView: persistedView ?? LIBRARY_VIEW,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        if (activeRef.current) setBoot({ kind: 'error', reason });
      }
    })();
    return () => {
      activeRef.current = false;
    };
  }, []);

  if (boot.kind === 'loading') {
    return (
      <main className="app app--loading">
        <p className="app__loading">Reaching for your library…</p>
      </main>
    );
  }
  if (boot.kind === 'error') {
    return <LibraryBootError reason={boot.reason} />;
  }
  return <ReadyApp boot={boot} />;
}
