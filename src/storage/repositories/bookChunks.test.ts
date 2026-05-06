import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createBookChunksRepository } from './bookChunks';
import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';
import { BOOK_CHUNKS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-chunks-${crypto.randomUUID()}`);
});

function makeChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  return {
    id: ChunkId(crypto.randomUUID()),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Chapter 1',
    text: 'hello world',
    normalizedText: 'hello world',
    tokenEstimate: 3,
    locationAnchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
    checksum: 'abc',
    chunkerVersion: 1,
    ...overrides,
  };
}

describe('BookChunksRepository', () => {
  it('upsertMany → listByBook round-trips', async () => {
    const repo = createBookChunksRepository(db);
    const c1 = makeChunk({ id: ChunkId('c1') });
    const c2 = makeChunk({ id: ChunkId('c2') });
    await repo.upsertMany([c1, c2]);
    const list = await repo.listByBook(BookId('b1'));
    expect(list.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('listBySection filters by both bookId and sectionId', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), sectionId: SectionId('s1') }),
      makeChunk({ id: ChunkId('c2'), sectionId: SectionId('s2') }),
    ]);
    const s1 = await repo.listBySection(BookId('b1'), SectionId('s1'));
    expect(s1).toHaveLength(1);
    expect(s1[0]!.id).toBe(ChunkId('c1'));
  });

  it('hasChunksFor returns true when chunks exist for the section', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([makeChunk({ sectionId: SectionId('s1') })]);
    expect(await repo.hasChunksFor(BookId('b1'), SectionId('s1'))).toBe(true);
    expect(await repo.hasChunksFor(BookId('b1'), SectionId('absent'))).toBe(false);
  });

  it('countByBook counts chunks per book', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), bookId: BookId('b1') }),
      makeChunk({ id: ChunkId('c2'), bookId: BookId('b1') }),
      makeChunk({ id: ChunkId('c3'), bookId: BookId('b2') }),
    ]);
    expect(await repo.countByBook(BookId('b1'))).toBe(2);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('countStaleVersions returns book IDs with chunks at versions below current', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), bookId: BookId('b1'), chunkerVersion: 1 }),
      makeChunk({ id: ChunkId('c2'), bookId: BookId('b2'), chunkerVersion: 2 }),
    ]);
    const stale = await repo.countStaleVersions(2);
    expect(stale).toEqual([BookId('b1')]);
    const noneStale = await repo.countStaleVersions(1);
    expect(noneStale).toEqual([]);
  });

  it('deleteByBook removes only matching chunks', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), bookId: BookId('b1') }),
      makeChunk({ id: ChunkId('c2'), bookId: BookId('b2') }),
    ]);
    await repo.deleteByBook(BookId('b1'));
    expect(await repo.countByBook(BookId('b1'))).toBe(0);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('deleteBySection removes only the matching section', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), sectionId: SectionId('s1') }),
      makeChunk({ id: ChunkId('c2'), sectionId: SectionId('s2') }),
    ]);
    await repo.deleteBySection(BookId('b1'), SectionId('s1'));
    expect(await repo.countByBook(BookId('b1'))).toBe(1);
    const remaining = await repo.listByBook(BookId('b1'));
    expect(remaining[0]!.sectionId).toBe(SectionId('s2'));
  });

  it('filters malformed chunk records on read but keeps the rest', async () => {
    const repo = createBookChunksRepository(db);
    const good = makeChunk({ id: ChunkId('good') });
    await repo.upsertMany([good]);
    await db.put(BOOK_CHUNKS_STORE, {
      id: 'bad',
      bookId: 'b1',
      sectionId: 's1',
      // missing other required fields
    } as never);
    const list = await repo.listByBook(BookId('b1'));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(ChunkId('good'));
  });
});
