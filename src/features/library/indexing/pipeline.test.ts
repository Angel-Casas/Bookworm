import { describe, it, expect, vi } from 'vitest';
import { runIndexing, batchByTokenBudget } from './pipeline';
import {
  BookId,
  ChunkId,
  IsoTimestamp,
  SectionId,
  type Book,
  type BookEmbedding,
  type TextChunk,
} from '@/domain';
import type { EmbedClient } from './embeddings/types';

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
        text: 'Hello world this is content',
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

function makeStubChunksRepo(seedChunks: TextChunk[] = []) {
  const stored: Record<string, TextChunk[]> = {};
  const allChunks: TextChunk[] = [...seedChunks];
  for (const c of seedChunks) {
    stored[c.sectionId] = stored[c.sectionId] ?? [];
    stored[c.sectionId]!.push(c);
  }
  return {
    upsertMany: vi.fn((chunks: readonly TextChunk[]) => {
      for (const c of chunks) {
        stored[c.sectionId] = stored[c.sectionId] ?? [];
        stored[c.sectionId]!.push(c);
        allChunks.push(c);
      }
      return Promise.resolve();
    }),
    hasChunksFor: vi.fn((_bookId: BookId, sectionId: SectionId) =>
      Promise.resolve((stored[sectionId]?.length ?? 0) > 0),
    ),
    deleteByBook: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(allChunks.length)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    listByBook: vi.fn(() => Promise.resolve([...allChunks])),
    listBySection: vi.fn(() => Promise.resolve([])),
    deleteBySection: vi.fn(() => Promise.resolve()),
  };
}

function makeStubEmbeddingsRepo() {
  const records = new Map<string, BookEmbedding>();
  return {
    upsertMany: vi.fn((recs: readonly BookEmbedding[]) => {
      for (const r of recs) records.set(r.id, r);
      return Promise.resolve();
    }),
    listByBook: vi.fn((bookId: BookId) =>
      Promise.resolve(
        [...records.values()].filter((r) => r.bookId === bookId),
      ),
    ),
    deleteByBook: vi.fn((bookId: BookId) => {
      for (const [k, v] of records) if (v.bookId === bookId) records.delete(k);
      return Promise.resolve();
    }),
    countByBook: vi.fn((bookId: BookId) =>
      Promise.resolve([...records.values()].filter((r) => r.bookId === bookId).length),
    ),
    hasEmbeddingFor: vi.fn((chunkId: ChunkId) => Promise.resolve(records.has(chunkId))),
    countStaleVersions: vi.fn(() => Promise.resolve([] as BookId[])),
    deleteOrphans: vi.fn(() => Promise.resolve(0)),
  };
}

function makeStubEmbedClient(behavior?: {
  throwOnCall?: number;
  throwError?: Error;
}): EmbedClient {
  let calls = 0;
  return {
    embed: vi.fn((req: { modelId: string; inputs: readonly string[] }) => {
      calls += 1;
      if (behavior?.throwOnCall === calls) {
        return Promise.reject(behavior.throwError ?? new Error('embed boom'));
      }
      const vectors = req.inputs.map(() => {
        const v = new Float32Array(1536);
        for (let k = 0; k < 1536; k += 1) v[k] = (k % 7) / 7;
        return v;
      });
      return Promise.resolve({ vectors, usage: { prompt: req.inputs.length * 5 } });
    }),
  };
}

describe('runIndexing — chunking stage', () => {
  it('happy path: writes pending → chunking{...} → embedding{...} → ready and persists chunks per section', async () => {
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
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor: extractor,
      pdfExtractor: {} as never,
      embedClient: makeStubEmbedClient(),
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
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor: extractor,
      pdfExtractor: {} as never,
      embedClient: makeStubEmbedClient(),
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
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor: extractor,
      pdfExtractor: {} as never,
      embedClient: makeStubEmbedClient(),
    });

    expect(booksRepo.current().indexingStatus).toEqual({
      kind: 'failed',
      reason: 'no-text-found',
    });
  });

  it('writes failed{no-text-extracted} when sections exist but every section yields zero paragraphs', async () => {
    // Regression: the EPUB chunker can silently yield zero paragraphs across
    // every section (e.g., XHTML lowercase tagName mismatch with the
    // PARAGRAPH_TAGS set, or a structurally weird EPUB). Before this guard,
    // the pipeline marked the book 'ready' anyway because runEmbeddingStage
    // early-returns 'ok' on empty allChunks. Result: indexingStatus 'ready'
    // with zero chunks → chat panel permanently stuck on 'still preparing'.
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    // Sections exist (so the sections-empty path doesn't fire), but the
    // extractor yields nothing for any of them.
    const emptyExtractor = {
      listSections: vi.fn(() =>
        Promise.resolve([
          {
            id: SectionId('s1'),
            title: 'Ch 1',
            range: { kind: 'epub' as const, spineIndex: 0 },
          },
          {
            id: SectionId('s2'),
            title: 'Ch 2',
            range: { kind: 'epub' as const, spineIndex: 1 },
          },
        ]),
      ),
      // eslint-disable-next-line require-yield
      streamParagraphs: vi.fn(async function* () {
        await Promise.resolve();
      }),
    };
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo,
      chunksRepo,
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor: emptyExtractor,
      pdfExtractor: {} as never,
      embedClient: makeStubEmbedClient(),
    });

    expect(booksRepo.current().indexingStatus).toEqual({
      kind: 'failed',
      reason: 'no-text-extracted',
    });
    expect(chunksRepo.upsertMany).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.anything()]),
    );
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
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor: extractor,
      pdfExtractor: {} as never,
      embedClient: makeStubEmbedClient(),
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
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor: extractor,
      pdfExtractor: {} as never,
      embedClient: makeStubEmbedClient(),
    });

    expect(booksRepo.current().indexingStatus.kind).not.toBe('failed');
  });
});

function makeChunk(idx: number): TextChunk {
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Ch 1',
    text: `chunk ${String(idx)}`,
    normalizedText: `chunk ${String(idx)}`,
    tokenEstimate: 3,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('runIndexing — embedding stage (Phase 5.2)', () => {
  it('writes embedding records and reaches ready', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo([makeChunk(0), makeChunk(1)]);
    chunksRepo.hasChunksFor = vi.fn(() => Promise.resolve(true));
    const embeddingsRepo = makeStubEmbeddingsRepo();
    const embedClient = makeStubEmbedClient();

    await runIndexing(book, new AbortController().signal, {
      booksRepo,
      chunksRepo,
      embeddingsRepo,
      epubExtractor: makeStubExtractor([{ id: 's1', title: 'Ch 1' }]),
      pdfExtractor: {} as never,
      embedClient,
    });

    expect(booksRepo.current().indexingStatus).toEqual({ kind: 'ready' });
    expect(embeddingsRepo.upsertMany).toHaveBeenCalled();
    expect(await embeddingsRepo.countByBook(BookId('b1'))).toBe(2);
  });

  it('skips chunks that already have embeddings (per-chunk idempotent resume)', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo([makeChunk(0), makeChunk(1)]);
    chunksRepo.hasChunksFor = vi.fn(() => Promise.resolve(true));
    const embeddingsRepo = makeStubEmbeddingsRepo();
    embeddingsRepo.hasEmbeddingFor = vi.fn((id: ChunkId) =>
      Promise.resolve(id === ChunkId('chunk-b1-s1-0')),
    );
    const embedClient = makeStubEmbedClient();

    await runIndexing(book, new AbortController().signal, {
      booksRepo,
      chunksRepo,
      embeddingsRepo,
      epubExtractor: makeStubExtractor([{ id: 's1', title: 'Ch 1' }]),
      pdfExtractor: {} as never,
      embedClient,
    });

    // Only one chunk needs embedding → embed called with 1 input.
    const embedCalls = (embedClient.embed as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(embedCalls).toHaveLength(1);
    expect((embedCalls[0]?.[0] as { inputs: unknown[] }).inputs).toHaveLength(1);
  });

  it('writes failed{embedding-failed} when embedClient throws non-rate-limit', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo([makeChunk(0)]);
    chunksRepo.hasChunksFor = vi.fn(() => Promise.resolve(true));
    const embedClient = makeStubEmbedClient({
      throwOnCall: 1,
      throwError: Object.assign(new Error('embed: invalid-key'), {
        failure: { reason: 'invalid-key', status: 401 },
      }),
    });

    await runIndexing(book, new AbortController().signal, {
      booksRepo,
      chunksRepo,
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor: makeStubExtractor([{ id: 's1', title: 'Ch 1' }]),
      pdfExtractor: {} as never,
      embedClient,
    });

    expect(booksRepo.current().indexingStatus).toEqual({
      kind: 'failed',
      reason: 'embedding-failed',
    });
  });
});

describe('batchByTokenBudget', () => {
  // Regression: NanoGPT/OpenAI's text-embedding-3-small caps at 8191 tokens
  // per request (sum of all input array items). With our prior fixed-count
  // batch of 32 chunks × 400 tokens, requests blew the limit at ~9500
  // server-counted tokens. The token-aware batcher must keep batches under
  // a safe budget below 8191.
  it('packs items up to but not over the token budget', () => {
    const items = [
      { tokenEstimate: 400 },
      { tokenEstimate: 400 },
      { tokenEstimate: 400 },
      { tokenEstimate: 400 },
    ];
    const batches = batchByTokenBudget(items, 1000);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2); // 800 ≤ 1000
    expect(batches[1]).toHaveLength(2); // remainder
  });

  it('respects the max-count cap even when token budget allows more', () => {
    const items = Array.from({ length: 50 }, () => ({ tokenEstimate: 10 }));
    const batches = batchByTokenBudget(items, 10_000, 32);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(32);
    expect(batches[1]).toHaveLength(18);
  });

  it('emits a single-item batch when one item alone exceeds the budget', () => {
    const items = [
      { tokenEstimate: 100 },
      { tokenEstimate: 5000 }, // alone exceeds budget
      { tokenEstimate: 100 },
    ];
    const batches = batchByTokenBudget(items, 1000);
    expect(batches).toHaveLength(3);
    expect(batches[0]?.[0]?.tokenEstimate).toBe(100);
    expect(batches[1]?.[0]?.tokenEstimate).toBe(5000);
    expect(batches[2]?.[0]?.tokenEstimate).toBe(100);
  });

  it('returns empty array for empty input', () => {
    expect(batchByTokenBudget([])).toEqual([]);
  });

  it('regression: 32 chunks × 400 tokens stays under 8191 (defaults)', () => {
    const items = Array.from({ length: 32 }, () => ({ tokenEstimate: 400 }));
    const batches = batchByTokenBudget(items);
    for (const batch of batches) {
      const total = batch.reduce((sum, c) => sum + c.tokenEstimate, 0);
      expect(total).toBeLessThanOrEqual(8191);
    }
  });
});
