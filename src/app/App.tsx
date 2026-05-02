import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { openBookwormDB } from '@/storage';
import {
  createLibraryStore,
  type LibraryStore,
} from '@/features/library/store/libraryStore';
import { createCoverCache, type CoverCache } from '@/features/library/store/coverCache';
import { createImportStore, type ImportStore } from '@/features/library/import/importStore';
import { createWiring, type Wiring } from '@/features/library/wiring';
import { loadLibrary } from '@/features/library/boot/loadLibrary';
import { sweepOrphans } from '@/features/library/orphan-sweep';
import { LibraryView } from '@/features/library/LibraryView';
import { LibraryBootError } from '@/features/library/LibraryBootError';
import { DropOverlay } from '@/features/library/DropOverlay';
import type { Book, SortKey } from '@/domain';
import './app.css';

type ReadyBoot = {
  readonly kind: 'ready';
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
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

function ReadyApp({ boot }: { readonly boot: ReadyBoot }) {
  const { wiring, libraryStore, importStore, coverCache } = boot;
  const hasBooks = useHasBooks(libraryStore);
  const hasImportActivity = useHasImportActivity(importStore);
  const showWorkspace = hasBooks || hasImportActivity;

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
    } catch (err) {
      console.warn('Remove failed:', err);
    }
  };

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
        void sweepOrphans(wiring.opfs, wiring.bookRepo).catch(() => {
          /* best effort */
        });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (!activeRef.current) return;
        setBoot({ kind: 'ready', wiring, libraryStore, importStore, coverCache });
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
