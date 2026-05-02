import { useEffect, useState } from 'react';
import type { Book, SortKey } from '@/domain';
import type { LibraryStore } from './store/libraryStore';
import type { CoverCache } from './store/coverCache';
import type { ImportStore } from './import/importStore';
import { LibraryChrome } from './LibraryChrome';
import { Bookshelf } from './Bookshelf';
import { ImportTray } from './import/ImportTray';

type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onRemoveBook: (book: Book) => void;
};

export function LibraryWorkspace({
  libraryStore,
  importStore,
  coverCache,
  onPersistSort,
  onFilesPicked,
  onRemoveBook,
}: Props) {
  const [search, setSearch] = useState(libraryStore.getState().search);
  const [sort, setSort] = useState(libraryStore.getState().sort);
  const [books, setBooks] = useState(libraryStore.getState().visibleBooks());

  useEffect(() => {
    return libraryStore.subscribe((state) => {
      setSearch(state.search);
      setSort(state.sort);
      setBooks(state.visibleBooks());
    });
  }, [libraryStore]);

  const onSearchChange = (q: string): void => {
    libraryStore.getState().setSearch(q);
  };
  const onSortChange = (key: SortKey): void => {
    libraryStore.getState().setSort(key);
    onPersistSort(key);
  };
  const onViewExisting = (bookId: string): void => {
    document
      .querySelector(`[data-book-id="${CSS.escape(bookId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="library-workspace">
      <LibraryChrome
        search={search}
        onSearchChange={onSearchChange}
        sort={sort}
        onSortChange={onSortChange}
        onFilesPicked={onFilesPicked}
      />
      <ImportTray store={importStore} onViewExisting={onViewExisting} />
      <Bookshelf
        books={books}
        coverCache={coverCache}
        searchQuery={search}
        onRemove={onRemoveBook}
      />
    </div>
  );
}
