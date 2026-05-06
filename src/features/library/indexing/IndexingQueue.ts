import { IsoTimestamp, type BookId } from '@/domain';
import type { BookRepository, BookChunksRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { runIndexing, type PipelineDeps } from './pipeline';

export type IndexingQueueDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
};

export class IndexingQueue {
  private inFlightBookId: BookId | null = null;
  private pending = new Set<BookId>();
  private aborts = new Map<BookId, AbortController>();

  constructor(private readonly deps: IndexingQueueDeps) {}

  enqueue(bookId: BookId): void {
    if (bookId === this.inFlightBookId) return;
    this.pending.add(bookId);
    void this.drain();
  }

  cancel(bookId: BookId): void {
    this.pending.delete(bookId);
    this.aborts.get(bookId)?.abort();
  }

  async rebuild(bookId: BookId): Promise<void> {
    this.cancel(bookId);
    await this.deps.chunksRepo.deleteByBook(bookId);
    const book = await this.deps.booksRepo.getById(bookId);
    if (book !== undefined) {
      await this.deps.booksRepo.put({
        ...book,
        indexingStatus: { kind: 'pending' },
        updatedAt: IsoTimestamp(new Date().toISOString()),
      });
    }
    this.enqueue(bookId);
  }

  async onAppOpen(): Promise<void> {
    const staleBookIds = await this.deps.chunksRepo.countStaleVersions(CHUNKER_VERSION);
    for (const id of staleBookIds) {
      await this.deps.chunksRepo.deleteByBook(id);
      const book = await this.deps.booksRepo.getById(id);
      if (book !== undefined) {
        await this.deps.booksRepo.put({
          ...book,
          indexingStatus: { kind: 'pending' },
          updatedAt: IsoTimestamp(new Date().toISOString()),
        });
      }
    }
    const all = await this.deps.booksRepo.getAll();
    for (const book of all) {
      const k = book.indexingStatus.kind;
      if (k === 'pending' || k === 'chunking') this.enqueue(book.id);
    }
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0 && this.inFlightBookId === null) {
      const next = this.pending.values().next().value;
      if (next === undefined) break;
      this.pending.delete(next);
      this.inFlightBookId = next;

      const ctrl = new AbortController();
      this.aborts.set(next, ctrl);

      try {
        const book = await this.deps.booksRepo.getById(next);
        if (book !== undefined) {
          const pipelineDeps: PipelineDeps = {
            booksRepo: this.deps.booksRepo,
            chunksRepo: this.deps.chunksRepo,
            epubExtractor: this.deps.epubExtractor,
            pdfExtractor: this.deps.pdfExtractor,
          };
          await runIndexing(book, ctrl.signal, pipelineDeps);
        }
      } finally {
        this.aborts.delete(next);
        this.inFlightBookId = null;
      }
    }
  }
}
