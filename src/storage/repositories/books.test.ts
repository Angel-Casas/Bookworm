import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createBookRepository } from './books';
import { BookId, IsoTimestamp, type Book } from '@/domain';

const sampleBook = (overrides: Partial<Book> = {}): Book => ({
  id: BookId(crypto.randomUUID()),
  title: 'Quiet Things',
  author: 'L. Onuma',
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: 'books/test/source.epub',
    originalName: 'quiet-things.epub',
    byteSize: 1024,
    mimeType: 'application/epub+zip',
    checksum: 'a'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp(new Date().toISOString()),
  updatedAt: IsoTimestamp(new Date().toISOString()),
  ...overrides,
});

describe('BookRepository', () => {
  let db: BookwormDB;

  beforeEach(async () => {
    db = await openBookwormDB(`bookworm-test-${crypto.randomUUID()}`);
  });

  it('round-trips a book via put/getById', async () => {
    const repo = createBookRepository(db);
    const book = sampleBook();
    await repo.put(book);
    const got = await repo.getById(book.id);
    expect(got?.title).toBe('Quiet Things');
  });

  it('finds a book by checksum', async () => {
    const repo = createBookRepository(db);
    const base = sampleBook();
    const book: Book = { ...base, source: { ...base.source, checksum: 'b'.repeat(64) } };
    await repo.put(book);
    const found = await repo.findByChecksum('b'.repeat(64));
    expect(found?.id).toBe(book.id);
    const missing = await repo.findByChecksum('c'.repeat(64));
    expect(missing).toBeUndefined();
  });

  it('lists all books', async () => {
    const repo = createBookRepository(db);
    const a = sampleBook({ title: 'A' });
    const b = sampleBook({
      title: 'B',
      source: { ...sampleBook().source, checksum: 'd'.repeat(64) },
    });
    await repo.put(a);
    await repo.put(b);
    const all = await repo.getAll();
    expect(all.length).toBe(2);
  });

  it('deletes a book', async () => {
    const repo = createBookRepository(db);
    const book = sampleBook();
    await repo.put(book);
    await repo.delete(book.id);
    expect(await repo.getById(book.id)).toBeUndefined();
  });
});
