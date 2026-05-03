import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createBookmarksRepository } from './bookmarks';
import { BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import { BOOKMARKS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-bm-${crypto.randomUUID()}`);
});

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: BookmarkId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
    snippet: null,
    sectionTitle: null,
    createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    ...overrides,
  };
}

describe('BookmarksRepository', () => {
  it('add → listByBook returns the bookmark', async () => {
    const repo = createBookmarksRepository(db);
    const b = makeBookmark();
    await repo.add(b);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(b.id);
  });

  it('listByBook returns newest-first', async () => {
    const repo = createBookmarksRepository(db);
    await repo.add(makeBookmark({ createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z') }));
    await repo.add(makeBookmark({ createdAt: IsoTimestamp('2026-05-03T13:00:00.000Z') }));
    await repo.add(makeBookmark({ createdAt: IsoTimestamp('2026-05-03T11:00:00.000Z') }));
    const list = await repo.listByBook(BookId('book-1'));
    expect(list.map((b) => b.createdAt)).toEqual([
      '2026-05-03T13:00:00.000Z',
      '2026-05-03T12:00:00.000Z',
      '2026-05-03T11:00:00.000Z',
    ]);
  });

  it('listByBook filters by bookId', async () => {
    const repo = createBookmarksRepository(db);
    await repo.add(makeBookmark({ bookId: BookId('book-1') }));
    await repo.add(makeBookmark({ bookId: BookId('book-2') }));
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.bookId).toBe('book-1');
  });

  it('delete removes a bookmark by id', async () => {
    const repo = createBookmarksRepository(db);
    const b = makeBookmark();
    await repo.add(b);
    await repo.delete(b.id);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(0);
  });

  it('patch merges fields and persists', async () => {
    const repo = createBookmarksRepository(db);
    const b = makeBookmark({ snippet: null });
    await repo.add(b);
    await repo.patch(b.id, { snippet: 'patched text' });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list[0]?.snippet).toBe('patched text');
    expect(list[0]?.id).toBe(b.id);
  });

  it('patch on missing id is a no-op', async () => {
    const repo = createBookmarksRepository(db);
    await expect(repo.patch(BookmarkId('nope'), { snippet: 'x' })).resolves.toBeUndefined();
  });

  it('deleteByBook removes only that book’s bookmarks', async () => {
    const repo = createBookmarksRepository(db);
    await repo.add(makeBookmark({ bookId: BookId('book-1') }));
    await repo.add(makeBookmark({ bookId: BookId('book-1') }));
    await repo.add(makeBookmark({ bookId: BookId('book-2') }));
    await repo.deleteByBook(BookId('book-1'));
    expect(await repo.listByBook(BookId('book-1'))).toHaveLength(0);
    expect(await repo.listByBook(BookId('book-2'))).toHaveLength(1);
  });

  it('listByBook drops corrupt records (missing anchor)', async () => {
    const repo = createBookmarksRepository(db);
    await db.put(BOOKMARKS_STORE, {
      id: 'bad' as never,
      bookId: 'book-1' as never,
      anchor: { kind: 'no-such-kind' } as never,
      snippet: null,
      sectionTitle: null,
      createdAt: '2026-05-03T12:00:00.000Z' as never,
    });
    await repo.add(makeBookmark());
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
  });
});
