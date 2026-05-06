import { describe, it, expect, vi } from 'vitest';
import { IndexingQueue } from './IndexingQueue';
import { BookId, IsoTimestamp, type Book } from '@/domain';

function fakeBook(id: string, indexingStatus: Book['indexingStatus'] = { kind: 'pending' }): Book {
  return {
    id: BookId(id),
    title: id,
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: 'p',
      originalName: 'p',
      byteSize: 0,
      mimeType: 'x',
      checksum: 'x',
    },
    importStatus: { kind: 'ready' },
    indexingStatus,
    aiProfileStatus: { kind: 'pending' },
    createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

function makeStubBookRepo(books: Map<string, Book>) {
  return {
    getById: vi.fn((id: BookId) => Promise.resolve(books.get(id))),
    put: vi.fn((b: Book) => {
      books.set(b.id, b);
      return Promise.resolve();
    }),
    getAll: vi.fn(() => Promise.resolve([...books.values()])),
    findByChecksum: vi.fn(() => Promise.resolve(undefined)),
    delete: vi.fn(() => Promise.resolve()),
  };
}

function makeStubChunksRepo() {
  return {
    upsertMany: vi.fn(() => Promise.resolve()),
    hasChunksFor: vi.fn(() => Promise.resolve(false)),
    deleteByBook: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(0)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    listByBook: vi.fn(() => Promise.resolve([])),
    listBySection: vi.fn(() => Promise.resolve([])),
    deleteBySection: vi.fn(() => Promise.resolve()),
  };
}

function makeStubExtractor() {
  return {
    listSections: vi.fn(() => Promise.resolve([])),
    // eslint-disable-next-line require-yield
    streamParagraphs: vi.fn(async function* (): AsyncGenerator<never> {
      await Promise.resolve();
      return;
    }),
  };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

describe('IndexingQueue', () => {
  it('enqueue → drain runs the pipeline once for the queued book', async () => {
    const books = new Map<string, Book>([['b1', fakeBook('b1')]]);
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    queue.enqueue(BookId('b1'));
    await settle();
    expect(extractor.listSections).toHaveBeenCalledTimes(1);
  });

  it('single-flight: re-enqueueing the same book while in-flight is a no-op', async () => {
    const books = new Map<string, Book>([['b1', fakeBook('b1')]]);
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    queue.enqueue(BookId('b1'));
    queue.enqueue(BookId('b1'));
    queue.enqueue(BookId('b1'));
    await settle();
    expect(extractor.listSections).toHaveBeenCalledTimes(1);
  });

  it('cancel during in-flight aborts cleanly (no failed status written)', async () => {
    const books = new Map<string, Book>([['b1', fakeBook('b1')]]);
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    let resolveSections: (sections: never[]) => void = () => undefined;
    const extractor = {
      listSections: vi.fn(
        () =>
          new Promise<never[]>((resolve) => {
            resolveSections = resolve;
          }),
      ),
      // eslint-disable-next-line require-yield
      streamParagraphs: vi.fn(async function* (): AsyncGenerator<never> {
        await Promise.resolve();
        return;
      }),
    };
    const queue = new IndexingQueue({
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    queue.enqueue(BookId('b1'));
    await new Promise((r) => setTimeout(r, 10));
    queue.cancel(BookId('b1'));
    resolveSections([]);
    await settle();
    const final = books.get('b1')!.indexingStatus.kind;
    expect(final).not.toBe('failed');
  });

  it('rebuild deletes existing chunks, marks pending, and re-enqueues', async () => {
    const books = new Map<string, Book>([['b1', fakeBook('b1', { kind: 'ready' })]]);
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    await queue.rebuild(BookId('b1'));
    await settle();
    expect(chunksRepo.deleteByBook).toHaveBeenCalledWith(BookId('b1'));
    expect(extractor.listSections).toHaveBeenCalledTimes(1);
  });

  it('onAppOpen drops stale-version chunks and resumes non-terminal books', async () => {
    const books = new Map<string, Book>([
      ['b1', fakeBook('b1', { kind: 'chunking', progressPercent: 50 })],
      ['b2', fakeBook('b2', { kind: 'pending' })],
      ['b3', fakeBook('b3', { kind: 'ready' })], // will be stale-versioned + re-pendinged
    ]);
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    chunksRepo.countStaleVersions = vi.fn(() => Promise.resolve([BookId('b3')]));
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    await queue.onAppOpen();
    await settle();
    expect(extractor.listSections).toHaveBeenCalledTimes(3);
  });
});
