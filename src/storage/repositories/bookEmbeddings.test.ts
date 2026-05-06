import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createBookEmbeddingsRepository } from './bookEmbeddings';
import {
  BookId,
  ChunkId,
  IsoTimestamp,
  type BookEmbedding,
} from '@/domain';

let db: BookwormDB;

function makeEmbedding(overrides: Partial<BookEmbedding> = {}): BookEmbedding {
  const v = new Float32Array(1536);
  for (let i = 0; i < 1536; i++) v[i] = (i % 7) / 7;
  return {
    id: ChunkId('chunk-b1-s1-0'),
    bookId: BookId('b1'),
    vector: v,
    chunkerVersion: 1,
    embeddingModelVersion: 1,
    embeddedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  const name = `test-be-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  db = await openBookwormDB(name);
});

afterEach(() => {
  db.close();
});

describe('BookEmbeddingsRepository', () => {
  it('upsertMany + listByBook round-trips Float32Array vectors', async () => {
    const repo = createBookEmbeddingsRepository(db);
    const e = makeEmbedding();
    await repo.upsertMany([e]);
    const list = await repo.listByBook(BookId('b1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.vector).toBeInstanceOf(Float32Array);
    expect(list[0]?.vector.length).toBe(1536);
    expect(list[0]?.vector[0]).toBeCloseTo(e.vector[0]!);
    expect(list[0]?.vector[1535]).toBeCloseTo(e.vector[1535]!);
  });

  it('upsertMany on empty array no-ops', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([]);
    expect(await repo.countByBook(BookId('b1'))).toBe(0);
  });

  it('hasEmbeddingFor returns true for present, false for absent', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([makeEmbedding({ id: ChunkId('chunk-b1-s1-0') })]);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-0'))).toBe(true);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-99'))).toBe(false);
  });

  it('countByBook scopes per-book', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({ id: ChunkId('chunk-b1-s1-0'), bookId: BookId('b1') }),
      makeEmbedding({ id: ChunkId('chunk-b1-s1-1'), bookId: BookId('b1') }),
      makeEmbedding({ id: ChunkId('chunk-b2-s1-0'), bookId: BookId('b2') }),
    ]);
    expect(await repo.countByBook(BookId('b1'))).toBe(2);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('deleteByBook removes only that book', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({ id: ChunkId('chunk-b1-s1-0'), bookId: BookId('b1') }),
      makeEmbedding({ id: ChunkId('chunk-b2-s1-0'), bookId: BookId('b2') }),
    ]);
    await repo.deleteByBook(BookId('b1'));
    expect(await repo.countByBook(BookId('b1'))).toBe(0);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('countStaleVersions returns books with embeddingModelVersion < current', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({
        id: ChunkId('chunk-old-s1-0'),
        bookId: BookId('old'),
        embeddingModelVersion: 0,
      }),
      makeEmbedding({
        id: ChunkId('chunk-cur-s1-0'),
        bookId: BookId('cur'),
        embeddingModelVersion: 1,
      }),
    ]);
    const stale = await repo.countStaleVersions(1);
    expect(stale).toContain(BookId('old'));
    expect(stale).not.toContain(BookId('cur'));
  });

  it('deleteOrphans removes records whose id is not in the valid set', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({ id: ChunkId('chunk-b1-s1-0') }),
      makeEmbedding({ id: ChunkId('chunk-b1-s1-1') }),
      makeEmbedding({ id: ChunkId('chunk-b1-s1-2') }),
    ]);
    const valid = new Set<ChunkId>([
      ChunkId('chunk-b1-s1-0'),
      ChunkId('chunk-b1-s1-2'),
    ]);
    const removed = await repo.deleteOrphans(valid);
    expect(removed).toBe(1);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-0'))).toBe(true);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-1'))).toBe(false);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-2'))).toBe(true);
  });

  it('listByBook filters out malformed records (validating reads)', async () => {
    const repo = createBookEmbeddingsRepository(db);
    const tx = db.transaction('book_embeddings', 'readwrite');
    await tx.store.put({
      id: 'chunk-b1-s1-0',
      bookId: 'b1',
      vector: 'not-a-float32array',
      chunkerVersion: 1,
      embeddingModelVersion: 1,
      embeddedAt: '2026-05-06T00:00:00.000Z',
    } as unknown as BookEmbedding);
    await tx.done;
    const list = await repo.listByBook(BookId('b1'));
    expect(list).toHaveLength(0);
  });
});
