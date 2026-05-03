import { useCallback, useEffect, useState } from 'react';
import type { Book } from '@/domain';
import type { SettingsRepository } from '@/storage';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import { LIBRARY_VIEW, readerView, type AppView } from '@/app/view';

export type AppViewHandle = {
  current: AppView;
  goLibrary: () => void;
  goReader: (book: Book) => void;
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
    if (initial.kind === 'reader' && !findBook(libraryStore, initial.bookId)) {
      return LIBRARY_VIEW;
    }
    return initial;
  });

  const setView = useCallback(
    (next: AppView) => {
      setViewState(next);
      void settingsRepo.setView(next);
    },
    [settingsRepo],
  );

  // Guard: book deleted while in reader → fall back to library.
  useEffect(() => {
    if (view.kind === 'reader' && !findBook(libraryStore, view.bookId)) {
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

  return { current: view, goLibrary, goReader };
}
