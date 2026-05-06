import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_CHUNKS_STORE } from '../db/schema';

export type BookChunksRepository = {
  upsertMany(chunks: readonly TextChunk[]): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly TextChunk[]>;
  listBySection(bookId: BookId, sectionId: SectionId): Promise<readonly TextChunk[]>;
  deleteByBook(bookId: BookId): Promise<void>;
  deleteBySection(bookId: BookId, sectionId: SectionId): Promise<void>;
  countByBook(bookId: BookId): Promise<number>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
  hasChunksFor(bookId: BookId, sectionId: SectionId): Promise<boolean>;
};

function isValidAnchor(value: unknown): value is TextChunk['locationAnchor'] {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  return v.kind === 'epub-cfi' || v.kind === 'pdf';
}

function normalizeChunk(record: unknown): TextChunk | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<TextChunk> & Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  if (typeof r.sectionId !== 'string' || r.sectionId === '') return null;
  if (typeof r.sectionTitle !== 'string') return null;
  if (typeof r.text !== 'string') return null;
  if (typeof r.normalizedText !== 'string') return null;
  if (typeof r.tokenEstimate !== 'number' || !Number.isFinite(r.tokenEstimate)) return null;
  if (!isValidAnchor(r.locationAnchor)) return null;
  if (typeof r.checksum !== 'string') return null;
  if (typeof r.chunkerVersion !== 'number' || !Number.isInteger(r.chunkerVersion)) return null;
  return {
    id: ChunkId(r.id),
    bookId: BookId(r.bookId),
    sectionId: SectionId(r.sectionId),
    sectionTitle: r.sectionTitle,
    text: r.text,
    normalizedText: r.normalizedText,
    tokenEstimate: r.tokenEstimate,
    locationAnchor: r.locationAnchor,
    checksum: r.checksum,
    chunkerVersion: r.chunkerVersion,
  };
}

export function createBookChunksRepository(db: BookwormDB): BookChunksRepository {
  return {
    async upsertMany(chunks) {
      if (chunks.length === 0) return;
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readwrite');
      for (const chunk of chunks) {
        await tx.store.put(chunk);
      }
      await tx.done;
    },
    async listByBook(bookId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      return records
        .map(normalizeChunk)
        .filter((c): c is TextChunk => c !== null);
    },
    async listBySection(bookId, sectionId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book-section');
      const records = await index.getAll([bookId, sectionId]);
      return records
        .map(normalizeChunk)
        .filter((c): c is TextChunk => c !== null);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async deleteBySection(bookId, sectionId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readwrite');
      const index = tx.store.index('by-book-section');
      let cursor = await index.openKeyCursor([bookId, sectionId]);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async countByBook(bookId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      return index.count(bookId);
    },
    async countStaleVersions(currentVersion) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const stale = new Set<BookId>();
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const c = normalizeChunk(cursor.value);
        if (c !== null && c.chunkerVersion < currentVersion) {
          stale.add(c.bookId);
        }
        cursor = await cursor.continue();
      }
      return [...stale];
    },
    async hasChunksFor(bookId, sectionId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book-section');
      const cursor = await index.openKeyCursor([bookId, sectionId]);
      return cursor !== null;
    },
  };
}
