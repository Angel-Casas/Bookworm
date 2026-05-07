import { IsoTimestamp, type Book, type BookId } from '@/domain';
import type {
  BookChunksRepository,
  BookEmbeddingsRepository,
  BookRepository,
} from '@/storage';
import type { ChunkExtractor } from './extractor';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { EMBEDDING_MODEL_VERSION } from './embeddings/EMBEDDING_MODEL';
import type { EmbedClient } from './embeddings/types';
import { runIndexing, type PipelineDeps } from './pipeline';

export type IndexingQueueDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
  readonly embedClient: EmbedClient;
  // Threaded through to the pipeline so each setStatus update fires a
  // notification callback. App.tsx wires this to libraryStore.upsertBook,
  // giving the library card live updates without requiring a page reload.
  readonly onBookStatusChange?: (book: Book) => void;
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
    await this.deps.embeddingsRepo.deleteByBook(bookId);
    await this.markPending(bookId);
    this.enqueue(bookId);
  }

  async onAppOpen(): Promise<void> {
    const staleChunkBooks = await this.deps.chunksRepo.countStaleVersions(CHUNKER_VERSION);
    const cascaded = new Set<BookId>();
    for (const id of staleChunkBooks) {
      await this.deps.chunksRepo.deleteByBook(id);
      // Cascade: stale chunks invalidate their embeddings (chunkId no longer matches).
      await this.deps.embeddingsRepo.deleteByBook(id);
      cascaded.add(id);
      await this.markPending(id);
    }

    const staleEmbedBooks = await this.deps.embeddingsRepo.countStaleVersions(
      EMBEDDING_MODEL_VERSION,
    );
    for (const id of staleEmbedBooks) {
      if (cascaded.has(id)) continue;
      await this.deps.embeddingsRepo.deleteByBook(id);
      await this.markPending(id);
    }

    const all = await this.deps.booksRepo.getAll();
    for (const book of all) {
      const k = book.indexingStatus.kind;
      if (k === 'pending' || k === 'chunking' || k === 'embedding') this.enqueue(book.id);
    }
  }

  private async markPending(id: BookId): Promise<void> {
    const book = await this.deps.booksRepo.getById(id);
    if (book === undefined) return;
    const updated: Book = {
      ...book,
      indexingStatus: { kind: 'pending' },
      updatedAt: IsoTimestamp(new Date().toISOString()),
    };
    await this.deps.booksRepo.put(updated);
    this.deps.onBookStatusChange?.(updated);
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
            embeddingsRepo: this.deps.embeddingsRepo,
            epubExtractor: this.deps.epubExtractor,
            pdfExtractor: this.deps.pdfExtractor,
            embedClient: this.deps.embedClient,
            ...(this.deps.onBookStatusChange !== undefined && {
              onBookStatusChange: this.deps.onBookStatusChange,
            }),
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
