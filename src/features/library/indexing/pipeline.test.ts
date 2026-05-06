import { describe, it, expect, vi } from 'vitest';
import { runIndexing } from './pipeline';
import { BookId, IsoTimestamp, SectionId, type Book } from '@/domain';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: BookId('b1'),
    title: 'Test',
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
    indexingStatus: { kind: 'pending' },
    aiProfileStatus: { kind: 'pending' },
    createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    ...overrides,
  };
}

function makeStubExtractor(sections: { id: string; title: string }[]) {
  return {
    listSections: vi.fn(() =>
      Promise.resolve(
        sections.map((s) => ({
          id: SectionId(s.id),
          title: s.title,
          range: { kind: 'epub' as const, spineIndex: 0 },
        })),
      ),
    ),
    streamParagraphs: vi.fn(async function* () {
      await Promise.resolve();
      yield {
        text: 'Hello',
        locationAnchor: { kind: 'epub-cfi' as const, cfi: '/abc' },
      };
    }),
  };
}

function makeStubBookRepo(book: Book) {
  let current = book;
  return {
    getById: vi.fn(() => Promise.resolve(current)),
    put: vi.fn((b: Book) => {
      current = b;
      return Promise.resolve();
    }),
    current: () => current,
    getAll: vi.fn(() => Promise.resolve([current])),
    findByChecksum: vi.fn(() => Promise.resolve(undefined)),
    delete: vi.fn(() => Promise.resolve()),
  };
}

function makeStubChunksRepo() {
  const stored: Record<string, unknown[]> = {};
  return {
    upsertMany: vi.fn((chunks: readonly unknown[]) => {
      for (const c of chunks) {
        const k = (c as { sectionId: string }).sectionId;
        stored[k] = stored[k] ?? [];
        stored[k].push(c);
      }
      return Promise.resolve();
    }),
    hasChunksFor: vi.fn((_bookId: BookId, sectionId: SectionId) => {
      return Promise.resolve((stored[sectionId]?.length ?? 0) > 0);
    }),
    deleteByBook: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(0)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    listByBook: vi.fn(() => Promise.resolve([])),
    listBySection: vi.fn(() => Promise.resolve([])),
    deleteBySection: vi.fn(() => Promise.resolve()),
  };
}

describe('runIndexing', () => {
  it('happy path: writes pending → chunking{...} → ready and persists chunks per section', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor([
      { id: 's1', title: 'Chapter 1' },
      { id: 's2', title: 'Chapter 2' },
    ]);
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    expect(chunksRepo.upsertMany).toHaveBeenCalledTimes(2);
    expect(booksRepo.current().indexingStatus).toEqual({ kind: 'ready' });
  });

  it('idempotent resume: skips sections that already have chunks', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    chunksRepo.hasChunksFor = vi.fn((_bookId: BookId, sectionId: SectionId) => {
      return Promise.resolve(sectionId === SectionId('s1'));
    });
    const extractor = makeStubExtractor([
      { id: 's1', title: 'Chapter 1' },
      { id: 's2', title: 'Chapter 2' },
    ]);
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    expect(chunksRepo.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('writes failed{no-text-found} when listSections returns empty', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor([]);
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    expect(booksRepo.current().indexingStatus).toEqual({
      kind: 'failed',
      reason: 'no-text-found',
    });
  });

  it('writes failed{...} on extractor error with classified reason', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = {
      listSections: vi.fn(() => Promise.reject(new Error('Invalid EPUB'))),
      streamParagraphs: vi.fn(),
    };
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    expect(booksRepo.current().indexingStatus).toEqual({
      kind: 'failed',
      reason: 'extract-failed',
    });
  });

  it('does not write failed when aborted mid-flight (signal aborted)', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor([
      { id: 's1', title: 'Chapter 1' },
      { id: 's2', title: 'Chapter 2' },
    ]);
    const ctrl = new AbortController();
    ctrl.abort();

    await runIndexing(book, ctrl.signal, {
      booksRepo,
      chunksRepo,
      epubExtractor: extractor,
      pdfExtractor: {} as never,
    });

    expect(booksRepo.current().indexingStatus.kind).not.toBe('failed');
  });
});
