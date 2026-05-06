import { BookId, ChunkId, type BookEmbedding } from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_EMBEDDINGS_STORE } from '../db/schema';

export type BookEmbeddingsRepository = {
  upsertMany(records: readonly BookEmbedding[]): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly BookEmbedding[]>;
  deleteByBook(bookId: BookId): Promise<void>;
  countByBook(bookId: BookId): Promise<number>;
  hasEmbeddingFor(chunkId: ChunkId): Promise<boolean>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
  deleteOrphans(validChunkIds: ReadonlySet<ChunkId>): Promise<number>;
};

function normalizeEmbedding(record: unknown): BookEmbedding | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<BookEmbedding> & Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  if (!(r.vector instanceof Float32Array)) return null;
  if (r.vector.length === 0) return null;
  if (typeof r.chunkerVersion !== 'number' || !Number.isInteger(r.chunkerVersion)) return null;
  if (typeof r.embeddingModelVersion !== 'number' || !Number.isInteger(r.embeddingModelVersion)) {
    return null;
  }
  if (typeof r.embeddedAt !== 'string') return null;
  return {
    id: ChunkId(r.id),
    bookId: BookId(r.bookId),
    vector: r.vector,
    chunkerVersion: r.chunkerVersion,
    embeddingModelVersion: r.embeddingModelVersion,
    embeddedAt: r.embeddedAt,
  };
}

export function createBookEmbeddingsRepository(db: BookwormDB): BookEmbeddingsRepository {
  return {
    async upsertMany(records) {
      if (records.length === 0) return;
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readwrite');
      for (const r of records) {
        await tx.store.put(r);
      }
      await tx.done;
    },
    async listByBook(bookId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      return records
        .map(normalizeEmbedding)
        .filter((e): e is BookEmbedding => e !== null);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async countByBook(bookId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      return index.count(bookId);
    },
    async hasEmbeddingFor(chunkId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const key = await tx.store.getKey(chunkId);
      return key !== undefined;
    },
    async countStaleVersions(currentVersion) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const stale = new Set<BookId>();
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const e = normalizeEmbedding(cursor.value);
        if (e !== null && e.embeddingModelVersion < currentVersion) {
          stale.add(e.bookId);
        }
        cursor = await cursor.continue();
      }
      return [...stale];
    },
    async deleteOrphans(validChunkIds) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readwrite');
      let removed = 0;
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const e = normalizeEmbedding(cursor.value);
        if (e === null || !validChunkIds.has(e.id)) {
          await tx.store.delete(cursor.primaryKey);
          removed += 1;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      return removed;
    },
  };
}
