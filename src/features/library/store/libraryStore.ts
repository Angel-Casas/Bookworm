import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Book, BookId, SortKey } from '@/domain';
import { DEFAULT_SORT } from '@/domain';
import { compareBooks } from './sort';
import { matchesQuery } from '@/shared/text/normalize';

export type BootStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly reason: string };

export type LibraryState = {
  readonly books: readonly Book[];
  readonly sort: SortKey;
  readonly search: string;
  readonly bootStatus: BootStatus;

  setBooks(books: readonly Book[]): void;
  upsertBook(book: Book): void;
  removeBook(id: BookId): void;
  setSort(key: SortKey): void;
  setSearch(query: string): void;
  setBootStatus(status: BootStatus): void;

  visibleBooks(): readonly Book[];
};

export type LibraryStore = StoreApi<LibraryState>;

export function createLibraryStore(): LibraryStore {
  return createStore<LibraryState>((set, get) => ({
    books: [],
    sort: DEFAULT_SORT,
    search: '',
    bootStatus: { kind: 'idle' },

    setBooks(books) {
      set({ books });
    },
    upsertBook(book) {
      set((s) => ({
        books: s.books.some((b) => b.id === book.id)
          ? s.books.map((b) => (b.id === book.id ? book : b))
          : [...s.books, book],
      }));
    },
    removeBook(id) {
      set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
    },
    setSort(key) {
      set({ sort: key });
    },
    setSearch(query) {
      set({ search: query });
    },
    setBootStatus(bootStatus) {
      set({ bootStatus });
    },
    visibleBooks() {
      const { books, sort, search } = get();
      const sorted = [...books].sort(compareBooks(sort));
      if (!search.trim()) return sorted;
      return sorted.filter((b) => matchesQuery(search, [b.title, b.author]));
    },
  }));
}
