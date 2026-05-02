import { describe, expect, it } from 'vitest';
import { createLibraryStore } from './libraryStore';
import { BookId, IsoTimestamp, type Book, DEFAULT_SORT } from '@/domain';

const make = (over: Partial<Book> & Pick<Book, 'id' | 'title'>): Book => ({
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: '',
    originalName: '',
    byteSize: 0,
    mimeType: 'application/epub+zip',
    checksum: 'x'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp('2024-01-01T00:00:00Z'),
  updatedAt: IsoTimestamp('2024-01-01T00:00:00Z'),
  ...over,
});

describe('libraryStore', () => {
  it('starts empty with the default sort', () => {
    const store = createLibraryStore();
    const state = store.getState();
    expect(state.books).toEqual([]);
    expect(state.sort).toBe(DEFAULT_SORT);
    expect(state.search).toBe('');
  });

  it('exposes a derived visibleBooks selector', () => {
    const store = createLibraryStore();
    store.getState().setBooks([
      make({ id: BookId('a'), title: 'Quiet Things', author: 'L. Onuma' }),
      make({ id: BookId('b'), title: 'On Reading Slowly', author: 'A. Marek' }),
    ]);
    store.getState().setSearch('marek');
    const visible = store.getState().visibleBooks();
    expect(visible.map((b) => b.id)).toEqual(['b']);
  });

  it('upserts a single book', () => {
    const store = createLibraryStore();
    store.getState().upsertBook(make({ id: BookId('a'), title: 'A' }));
    expect(store.getState().books.length).toBe(1);
    store.getState().upsertBook(make({ id: BookId('a'), title: 'A revised' }));
    expect(store.getState().books[0]?.title).toBe('A revised');
  });

  it('removes a book', () => {
    const store = createLibraryStore();
    store.getState().setBooks([make({ id: BookId('a'), title: 'A' })]);
    store.getState().removeBook(BookId('a'));
    expect(store.getState().books).toEqual([]);
  });
});
