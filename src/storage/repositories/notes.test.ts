import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createNotesRepository } from './notes';
import { BookId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { Note } from '@/domain/annotations/types';
import { NOTES_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-notes-${crypto.randomUUID()}`);
});

function makeNote(overrides: Partial<Note> = {}): Note {
  const id = NoteId(crypto.randomUUID());
  return {
    id,
    bookId: BookId('book-1'),
    anchorRef: { kind: 'highlight', highlightId: HighlightId(`h-${id}`) },
    content: 'A thought.',
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    ...overrides,
  };
}

describe('NotesRepository', () => {
  it('upsert → listByBook returns the note', async () => {
    const repo = createNotesRepository(db);
    const n = makeNote();
    await repo.upsert(n);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(n.id);
  });

  it('upsert replaces by id (same record id, new content)', async () => {
    const repo = createNotesRepository(db);
    const n = makeNote({ content: 'first' });
    await repo.upsert(n);
    await repo.upsert({
      ...n,
      content: 'second',
      updatedAt: IsoTimestamp('2026-05-04T13:00:00.000Z'),
    });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.content).toBe('second');
  });

  it('listByBook filters by bookId', async () => {
    const repo = createNotesRepository(db);
    await repo.upsert(makeNote({ bookId: BookId('book-1') }));
    await repo.upsert(makeNote({ bookId: BookId('book-2') }));
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.bookId).toBe('book-1');
  });

  it('getByHighlight returns the note (or null)', async () => {
    const repo = createNotesRepository(db);
    const target = HighlightId('h-target');
    const n = makeNote({ anchorRef: { kind: 'highlight', highlightId: target } });
    await repo.upsert(n);
    const found = await repo.getByHighlight(target);
    expect(found?.id).toBe(n.id);
    const missing = await repo.getByHighlight(HighlightId('h-missing'));
    expect(missing).toBeNull();
  });

  it('delete removes by id', async () => {
    const repo = createNotesRepository(db);
    const n = makeNote();
    await repo.upsert(n);
    await repo.delete(n.id);
    expect(await repo.listByBook(BookId('book-1'))).toHaveLength(0);
  });

  it('deleteByHighlight removes the indexed record', async () => {
    const repo = createNotesRepository(db);
    const target = HighlightId('h-target');
    await repo.upsert(makeNote({ anchorRef: { kind: 'highlight', highlightId: target } }));
    await repo.upsert(makeNote()); // unrelated
    await repo.deleteByHighlight(target);
    const remaining = await repo.listByBook(BookId('book-1'));
    expect(remaining).toHaveLength(1);
    expect(
      remaining[0]?.anchorRef.kind === 'highlight' && remaining[0].anchorRef.highlightId,
    ).not.toBe(target);
  });

  it('deleteByBook removes only that book’s notes', async () => {
    const repo = createNotesRepository(db);
    await repo.upsert(makeNote({ bookId: BookId('book-1') }));
    await repo.upsert(makeNote({ bookId: BookId('book-1') }));
    await repo.upsert(makeNote({ bookId: BookId('book-2') }));
    await repo.deleteByBook(BookId('book-1'));
    expect(await repo.listByBook(BookId('book-1'))).toHaveLength(0);
    expect(await repo.listByBook(BookId('book-2'))).toHaveLength(1);
  });

  it('unique-index enforces one note per highlight', async () => {
    const repo = createNotesRepository(db);
    const target = HighlightId('h-target');
    await repo.upsert(makeNote({ anchorRef: { kind: 'highlight', highlightId: target } }));
    // Second note for the same highlight with a different id should throw.
    await expect(
      repo.upsert(
        makeNote({
          id: NoteId('n-second'),
          anchorRef: { kind: 'highlight', highlightId: target },
        }),
      ),
    ).rejects.toThrow();
  });

  it('listByBook drops corrupt records (missing content)', async () => {
    const repo = createNotesRepository(db);
    await db.put(NOTES_STORE, {
      id: 'bad' as never,
      bookId: 'book-1' as never,
      anchorRef: { kind: 'highlight', highlightId: 'h' },
      // no content
      createdAt: '2026-05-04T12:00:00.000Z' as never,
      updatedAt: '2026-05-04T12:00:00.000Z' as never,
    } as never);
    await repo.upsert(makeNote());
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
  });

  it('listByBook drops corrupt records (bad anchorRef.kind)', async () => {
    const repo = createNotesRepository(db);
    await db.put(NOTES_STORE, {
      id: 'bad2' as never,
      bookId: 'book-1' as never,
      anchorRef: { kind: 'mystery' } as never,
      content: 'x',
      createdAt: '2026-05-04T12:00:00.000Z' as never,
      updatedAt: '2026-05-04T12:00:00.000Z' as never,
    });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(0);
  });
});
