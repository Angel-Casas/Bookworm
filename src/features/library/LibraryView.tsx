import type { Book, SortKey } from '@/domain';
import type { LibraryStore } from './store/libraryStore';
import type { CoverCache } from './store/coverCache';
import type { ImportStore } from './import/importStore';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryWorkspace } from './LibraryWorkspace';

type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly hasBooks: boolean;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onRemoveBook: (book: Book) => void;
};

export function LibraryView(props: Props) {
  if (!props.hasBooks) return <LibraryEmptyState onFilesPicked={props.onFilesPicked} />;
  return (
    <LibraryWorkspace
      libraryStore={props.libraryStore}
      importStore={props.importStore}
      coverCache={props.coverCache}
      onPersistSort={props.onPersistSort}
      onFilesPicked={props.onFilesPicked}
      onRemoveBook={props.onRemoveBook}
    />
  );
}
