import type { LocationAnchor } from '@/domain';
import type { BookwormDB } from '../db/open';
import { READING_PROGRESS_STORE, type ReadingProgressRecord } from '../db/schema';

export type ReadingProgressRepository = {
  get(bookId: string): Promise<LocationAnchor | undefined>;
  put(bookId: string, anchor: LocationAnchor): Promise<void>;
  delete(bookId: string): Promise<void>;
  listKeys(): Promise<readonly string[]>;
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

export function createReadingProgressRepository(db: BookwormDB): ReadingProgressRepository {
  return {
    async get(bookId) {
      const rec = await db.get(READING_PROGRESS_STORE, bookId);
      if (!rec) return undefined;
      if (!isValidAnchor(rec.anchor)) {
        console.warn('[readingProgress] dropping corrupted record for', bookId);
        await db.delete(READING_PROGRESS_STORE, bookId);
        return undefined;
      }
      return rec.anchor;
    },
    async put(bookId, anchor) {
      const record: ReadingProgressRecord = { bookId, anchor, updatedAt: Date.now() };
      await db.put(READING_PROGRESS_STORE, record);
    },
    async delete(bookId) {
      await db.delete(READING_PROGRESS_STORE, bookId);
    },
    async listKeys() {
      return db.getAllKeys(READING_PROGRESS_STORE);
    },
  };
}
