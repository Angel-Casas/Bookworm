import { BookId, BookmarkId, IsoTimestamp, type LocationAnchor } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import type { BookwormDB } from '../db/open';
import { BOOKMARKS_STORE } from '../db/schema';

export type BookmarksRepository = {
  add(bookmark: Bookmark): Promise<void>;
  patch(
    id: BookmarkId,
    partial: Partial<Pick<Bookmark, 'snippet' | 'sectionTitle'>>,
  ): Promise<void>;
  delete(id: BookmarkId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Bookmark[]>;
  deleteByBook(bookId: BookId): Promise<void>;
};

function isValidAnchor(value: unknown): value is LocationAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'epub-cfi') {
    return typeof (value as { cfi?: unknown }).cfi === 'string';
  }
  if (v.kind === 'pdf') {
    return typeof (value as { page?: unknown }).page === 'number';
  }
  return false;
}

function normalizeBookmark(record: unknown): Bookmark | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Bookmark>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!isValidAnchor(r.anchor)) return null;
  if (typeof r.createdAt !== 'string') return null;
  return {
    id: BookmarkId(r.id),
    bookId: BookId(r.bookId),
    anchor: r.anchor,
    snippet: typeof r.snippet === 'string' ? r.snippet : null,
    sectionTitle: typeof r.sectionTitle === 'string' ? r.sectionTitle : null,
    createdAt: IsoTimestamp(r.createdAt),
  };
}

export function createBookmarksRepository(db: BookwormDB): BookmarksRepository {
  return {
    async add(bookmark) {
      await db.put(BOOKMARKS_STORE, bookmark);
    },
    async patch(id, partial) {
      const existing = await db.get(BOOKMARKS_STORE, id);
      if (!existing) return;
      const next: Bookmark = { ...existing, ...partial };
      await db.put(BOOKMARKS_STORE, next);
    },
    async delete(id) {
      await db.delete(BOOKMARKS_STORE, id);
    },
    async listByBook(bookId) {
      const tx = db.transaction(BOOKMARKS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      const valid = records
        .map(normalizeBookmark)
        .filter((b): b is Bookmark => b !== null);
      return valid.sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOKMARKS_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}
