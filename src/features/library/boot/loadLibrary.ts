import {
  createBookRepository,
  createSettingsRepository,
  openBookwormDB,
  type BookwormDB,
} from '@/storage';
import type { LibraryStore } from '../store/libraryStore';

export type LibraryBootDeps = {
  readonly store: LibraryStore;
  readonly openDB?: () => Promise<BookwormDB>;
};

export async function loadLibrary({
  store,
  openDB = () => openBookwormDB(),
}: LibraryBootDeps): Promise<BookwormDB> {
  store.getState().setBootStatus({ kind: 'loading' });
  try {
    const db = await openDB();
    const books = await createBookRepository(db).getAll();
    const settings = createSettingsRepository(db);
    const sort = await settings.getLibrarySort();
    store.getState().setBooks(books);
    if (sort) store.getState().setSort(sort);
    store.getState().setBootStatus({ kind: 'ready' });
    return db;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    store.getState().setBootStatus({ kind: 'error', reason });
    throw err;
  }
}
