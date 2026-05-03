import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  openBookwormDB,
  createBookRepository,
  createReadingProgressRepository,
  createInMemoryOpfsAdapter,
} from '@/storage';
import { sweepOrphans } from './orphan-sweep';
import { BookId, IsoTimestamp, type Book } from '@/domain';

const sampleBook = (id: string, opfsPath: string, checksum: string): Book => ({
  id: BookId(id),
  title: id,
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath,
    originalName: `${id}.epub`,
    byteSize: 1,
    mimeType: 'application/epub+zip',
    checksum,
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp(new Date().toISOString()),
  updatedAt: IsoTimestamp(new Date().toISOString()),
});

describe('sweepOrphans', () => {
  it('removes reading_progress records for books no longer in the library', async () => {
    const db = await openBookwormDB(`bookworm-orphan-${crypto.randomUUID()}`);
    const bookRepo = createBookRepository(db);
    const progress = createReadingProgressRepository(db);
    const opfs = createInMemoryOpfsAdapter();

    await opfs.writeFile('books/book-a/source.epub', new Blob(['a']));
    await opfs.writeFile('books/book-b/source.epub', new Blob(['b']));
    await bookRepo.put(sampleBook('book-a', 'books/book-a/source.epub', 'a'.repeat(64)));
    await progress.put('book-a', { kind: 'epub-cfi', cfi: 'a' });
    await progress.put('book-b', { kind: 'epub-cfi', cfi: 'b' });

    await sweepOrphans(opfs, bookRepo, progress);

    expect(await progress.get('book-a')).toBeDefined();
    expect(await progress.get('book-b')).toBeUndefined();
    // Orphan OPFS dir should also be gone
    expect(await opfs.readFile('books/book-b/source.epub')).toBeUndefined();
    // Kept book's blob survives
    expect(await opfs.readFile('books/book-a/source.epub')).toBeDefined();
  });

  it('is a no-op for the optional progress repo', async () => {
    const db = await openBookwormDB(`bookworm-orphan-${crypto.randomUUID()}`);
    const bookRepo = createBookRepository(db);
    const opfs = createInMemoryOpfsAdapter();
    await opfs.writeFile('books/orphan/source.epub', new Blob(['x']));
    await sweepOrphans(opfs, bookRepo);
    expect(await opfs.readFile('books/orphan/source.epub')).toBeUndefined();
  });
});
