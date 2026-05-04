import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, LocationAnchor } from '@/domain';
import type { SettingsRepository } from '@/storage';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import { LIBRARY_VIEW, readerView, notebookView, settingsView, type AppView } from '@/app/view';

export type AppViewHandle = {
  current: AppView;
  goLibrary: () => void;
  goReader: (book: Book) => void;
  goNotebook: (bookId: string) => void;
  goReaderAt: (bookId: string, anchor: LocationAnchor) => void;
  goSettings: () => void;
  consumePendingAnchor: () => LocationAnchor | undefined;
};

function findBook(libraryStore: LibraryStore, bookId: string): Book | undefined {
  return libraryStore.getState().books.find((b) => b.id === bookId);
}

type UseAppViewOptions = {
  readonly settingsRepo: SettingsRepository;
  readonly libraryStore: LibraryStore;
  readonly initial: AppView;
};

export function useAppView({
  settingsRepo,
  libraryStore,
  initial,
}: UseAppViewOptions): AppViewHandle {
  const [view, setViewState] = useState<AppView>(() => {
    if (
      (initial.kind === 'reader' || initial.kind === 'notebook') &&
      !findBook(libraryStore, initial.bookId)
    ) {
      return LIBRARY_VIEW;
    }
    return initial;
  });

  const pendingAnchorRef = useRef<LocationAnchor | undefined>(undefined);

  const setView = useCallback(
    (next: AppView) => {
      // pendingAnchor is a one-shot intent for the *next* reader mount.
      // Any non-reader transition invalidates it.
      if (next.kind !== 'reader') {
        pendingAnchorRef.current = undefined;
      }
      setViewState(next);
      void settingsRepo.setView(next);
    },
    [settingsRepo],
  );

  // Guard: book deleted while in reader/notebook → fall back to library.
  useEffect(() => {
    if (
      (view.kind === 'reader' || view.kind === 'notebook') &&
      !findBook(libraryStore, view.bookId)
    ) {
      setView(LIBRARY_VIEW);
    }
  }, [view, libraryStore, setView]);

  const goLibrary = useCallback(() => {
    setView(LIBRARY_VIEW);
  }, [setView]);

  const goReader = useCallback(
    (book: Book) => {
      setView(readerView(book.id));
    },
    [setView],
  );

  const goNotebook = useCallback(
    (bookId: string) => {
      setView(notebookView(bookId));
    },
    [setView],
  );

  const goReaderAt = useCallback(
    (bookId: string, anchor: LocationAnchor) => {
      pendingAnchorRef.current = anchor;
      setView(readerView(bookId));
    },
    [setView],
  );

  const goSettings = useCallback(() => {
    setView(settingsView());
  }, [setView]);

  const consumePendingAnchor = useCallback((): LocationAnchor | undefined => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = undefined;
    return anchor;
  }, []);

  return {
    current: view,
    goLibrary,
    goReader,
    goNotebook,
    goReaderAt,
    goSettings,
    consumePendingAnchor,
  };
}
