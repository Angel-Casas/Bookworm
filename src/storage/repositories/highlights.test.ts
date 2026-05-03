import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createHighlightsRepository } from './highlights';
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type { Highlight } from '@/domain/annotations/types';
import { HIGHLIGHTS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-hl-${crypto.randomUUID()}`);
});

function makeEpub(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:8)' },
    selectedText: 'A passage',
    sectionTitle: 'Chapter 1',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    ...overrides,
  };
}

function makePdf(page: number, x: number, overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    anchor: { kind: 'pdf', page, rects: [{ x, y: 100, width: 50, height: 12 }] },
    selectedText: 'Page passage',
    sectionTitle: `Page ${String(page)}`,
    color: 'blue',
    tags: [],
    createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    ...overrides,
  };
}

describe('HighlightsRepository', () => {
  it('add → listByBook returns the highlight', async () => {
    const repo = createHighlightsRepository(db);
    const h = makeEpub();
    await repo.add(h);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(h.id);
  });

  it('listByBook sorts PDF highlights by page then y then x', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(makePdf(2, 100));
    await repo.add(makePdf(1, 200));
    await repo.add(makePdf(1, 50));
    const list = await repo.listByBook(BookId('book-1'));
    const positions = list.map((h) =>
      h.anchor.kind === 'pdf' ? `${String(h.anchor.page)}:${String(h.anchor.rects[0]?.x)}` : 'x',
    );
    expect(positions).toEqual(['1:50', '1:200', '2:100']);
  });

  it('listByBook sorts EPUB highlights by CFI lex', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(
      makeEpub({ anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' } }),
    );
    await repo.add(
      makeEpub({ anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/2/16)' } }),
    );
    await repo.add(
      makeEpub({ anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/6!/4/2/16)' } }),
    );
    const list = await repo.listByBook(BookId('book-1'));
    const cfis = list.map((h) => (h.anchor.kind === 'epub-cfi' ? h.anchor.cfi : 'x'));
    expect(cfis).toEqual([
      'epubcfi(/6/2!/4/2/16)',
      'epubcfi(/6/4!/4/2/16)',
      'epubcfi(/6/6!/4/2/16)',
    ]);
  });

  it('listByBook filters by bookId', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(makeEpub({ bookId: BookId('book-1') }));
    await repo.add(makeEpub({ bookId: BookId('book-2') }));
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.bookId).toBe('book-1');
  });

  it('patch updates color and persists', async () => {
    const repo = createHighlightsRepository(db);
    const h = makeEpub({ color: 'yellow' });
    await repo.add(h);
    await repo.patch(h.id, { color: 'green' });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list[0]?.color).toBe('green');
    expect(list[0]?.id).toBe(h.id);
  });

  it('patch on missing id is a no-op', async () => {
    const repo = createHighlightsRepository(db);
    await expect(repo.patch(HighlightId('nope'), { color: 'green' })).resolves.toBeUndefined();
  });

  it('delete removes by id', async () => {
    const repo = createHighlightsRepository(db);
    const h = makeEpub();
    await repo.add(h);
    await repo.delete(h.id);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(0);
  });

  it('deleteByBook removes only that book’s highlights', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(makeEpub({ bookId: BookId('book-1') }));
    await repo.add(makeEpub({ bookId: BookId('book-1') }));
    await repo.add(makeEpub({ bookId: BookId('book-2') }));
    await repo.deleteByBook(BookId('book-1'));
    expect(await repo.listByBook(BookId('book-1'))).toHaveLength(0);
    expect(await repo.listByBook(BookId('book-2'))).toHaveLength(1);
  });

  it('listByBook drops corrupt records (invalid color)', async () => {
    const repo = createHighlightsRepository(db);
    await db.put(HIGHLIGHTS_STORE, {
      id: 'bad' as never,
      bookId: 'book-1' as never,
      anchor: { kind: 'epub-cfi', cfi: 'x' },
      selectedText: 'x',
      sectionTitle: null,
      color: 'fuchsia' as never,
      tags: [],
      createdAt: '2026-05-03T12:00:00.000Z' as never,
    });
    await repo.add(makeEpub());
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
  });

  it('listByBook drops corrupt records (missing rects on pdf anchor)', async () => {
    const repo = createHighlightsRepository(db);
    await db.put(HIGHLIGHTS_STORE, {
      id: 'bad' as never,
      bookId: 'book-1' as never,
      anchor: { kind: 'pdf', page: 1 } as never,
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: '2026-05-03T12:00:00.000Z' as never,
    });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(0);
  });
});
