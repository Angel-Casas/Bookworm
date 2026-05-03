import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookId, type Book, type BookFormat, type LocationAnchor, type SortKey } from '@/domain';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import type { Wiring } from '@/features/library/wiring';
import { EpubReaderAdapter } from '@/features/reader/epub/EpubReaderAdapter';
import { PdfReaderAdapter } from '@/features/reader/pdf/PdfReaderAdapter';
import type { AppView } from '@/app/view';

export type ReaderHostHandle = {
  loadBookForReader: (
    bookId: string,
  ) => Promise<{ blob: Blob; preferences: ReaderPreferences; initialAnchor?: LocationAnchor }>;
  createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
  onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  onPreferencesChange: (prefs: ReaderPreferences) => void;
  initialFocusMode: FocusMode;
  hasShownFirstTimeHint: boolean;
  onFocusModeChange: (mode: FocusMode) => Promise<void>;
  onFirstTimeHintShown: () => void;
  onFilesPicked: (files: readonly File[]) => void;
  onPersistSort: (key: SortKey) => void;
  onRemoveBook: (book: Book) => void;
  findBook: (bookId: string) => Book | undefined;
};

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fn(...args);
    }, ms);
  }) as T;
}

type UseReaderHostOptions = {
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly view: AppView;
  readonly onBookRemovedWhileInReader?: () => void;
};

export function useReaderHost({
  wiring,
  libraryStore,
  view,
  onBookRemovedWhileInReader,
}: UseReaderHostOptions): ReaderHostHandle {
  const [initialFocusMode, setInitialFocusMode] = useState<FocusMode>('normal');
  const [hasShownFirstTimeHint, setHasShownFirstTimeHint] = useState(false);

  useEffect(() => {
    void wiring.readerPreferencesRepo.get().then((p) => {
      setInitialFocusMode(p.focusMode);
    });
    void wiring.settingsRepo.getFocusModeHintShown().then((shown) => {
      setHasShownFirstTimeHint(shown);
    });
  }, [wiring]);

  const loadBookForReader = useCallback(
    async (
      bookId: string,
    ): Promise<{
      blob: Blob;
      preferences: ReaderPreferences;
      initialAnchor?: LocationAnchor;
    }> => {
      const book = await wiring.bookRepo.getById(BookId(bookId));
      if (book?.source.kind !== 'imported-file') {
        throw new Error(`Book ${bookId} is missing or has no source`);
      }
      const blob = await wiring.opfs.readFile(book.source.opfsPath);
      if (!blob) throw new Error(`Book ${bookId} blob missing from OPFS`);
      const preferences = await wiring.readerPreferencesRepo.get();
      const initialAnchor = await wiring.readingProgressRepo.get(bookId);
      return initialAnchor ? { blob, preferences, initialAnchor } : { blob, preferences };
    },
    [wiring],
  );

  const createAdapter = useCallback(
    (mountInto: HTMLElement, format: BookFormat): BookReader => {
      if (format === 'pdf') return new PdfReaderAdapter(mountInto);
      return new EpubReaderAdapter(mountInto);
    },
    [],
  );

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

  const onFocusModeChange = useCallback(
    async (mode: FocusMode) => {
      const current = await wiring.readerPreferencesRepo.get();
      await wiring.readerPreferencesRepo.put({ ...current, focusMode: mode });
    },
    [wiring],
  );

  const onFirstTimeHintShown = useCallback(() => {
    setHasShownFirstTimeHint(true);
    void wiring.settingsRepo.setFocusModeHintShown(true);
  }, [wiring]);

  const onFilesPicked = useCallback(
    (files: readonly File[]): void => {
      void wiring.persistFirstQuotaRequest();
      // Forward files via custom DOM event so this hook stays decoupled from
      // importStore (which is App-level state, not part of `wiring`). App.tsx
      // listens for this event and enqueues each file into importStore.
      window.dispatchEvent(new CustomEvent('bookworm:files-picked', { detail: files }));
    },
    [wiring],
  );

  const onPersistSort = useMemo(
    () =>
      debounce((key: SortKey) => {
        void wiring.settingsRepo.setLibrarySort(key);
      }, 200),
    [wiring],
  );

  const onRemoveBook = useCallback(
    (book: Book): void => {
      void (async () => {
        libraryStore.getState().removeBook(book.id);
        try {
          await wiring.bookRepo.delete(book.id);
          await wiring.opfs.removeRecursive(`books/${book.id}`);
          await wiring.readingProgressRepo.delete(book.id);
        } catch (err) {
          console.warn('Remove failed:', err);
        }
        if (view.kind === 'reader' && view.bookId === book.id) {
          onBookRemovedWhileInReader?.();
        }
      })();
    },
    [wiring, libraryStore, view, onBookRemovedWhileInReader],
  );

  const findBook = useCallback(
    (bookId: string): Book | undefined =>
      libraryStore.getState().books.find((b) => b.id === bookId),
    [libraryStore],
  );

  return {
    loadBookForReader,
    createAdapter,
    onAnchorChange,
    onPreferencesChange,
    initialFocusMode,
    hasShownFirstTimeHint,
    onFocusModeChange,
    onFirstTimeHintShown,
    onFilesPicked,
    onPersistSort,
    onRemoveBook,
    findBook,
  };
}
