import { IsoTimestamp, type Book, type BookId } from '@/domain';
import type { IndexingStatus } from '@/domain/indexing/types';
import type { BookRepository, BookChunksRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { paragraphsToChunks } from './paragraphsToChunks';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { classifyError } from './classifyError';

export type PipelineDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
};

export const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

async function setStatus(
  bookId: BookId,
  status: IndexingStatus,
  booksRepo: BookRepository,
): Promise<void> {
  const book = await booksRepo.getById(bookId);
  if (book === undefined) return;
  await booksRepo.put({
    ...book,
    indexingStatus: status,
    updatedAt: IsoTimestamp(new Date().toISOString()),
  });
}

export async function runIndexing(
  book: Book,
  signal: AbortSignal,
  deps: PipelineDeps,
): Promise<void> {
  const extractor = book.format === 'epub' ? deps.epubExtractor : deps.pdfExtractor;
  try {
    await setStatus(book.id, { kind: 'chunking', progressPercent: 0 }, deps.booksRepo);

    const sections = await extractor.listSections(book);
    if (sections.length === 0) {
      if (signal.aborted) return;
      await setStatus(
        book.id,
        { kind: 'failed', reason: 'no-text-found' },
        deps.booksRepo,
      );
      return;
    }

    let processedCount = 0;
    for (const section of sections) {
      if (signal.aborted) return;

      const alreadyDone = await deps.chunksRepo.hasChunksFor(book.id, section.id);
      if (!alreadyDone) {
        const paragraphs = extractor.streamParagraphs(book, section);
        const drafts = await paragraphsToChunks({
          paragraphs,
          bookId: book.id,
          sectionId: section.id,
          sectionTitle: section.title,
          chunkerVersion: CHUNKER_VERSION,
        });
        // Signal may have been aborted while we were extracting + chunking.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (signal.aborted) return;
        await deps.chunksRepo.upsertMany(drafts);
      }

      processedCount += 1;
      const progressPercent = Math.round((processedCount / sections.length) * 100);
      await setStatus(
        book.id,
        { kind: 'chunking', progressPercent },
        deps.booksRepo,
      );
      await yieldToBrowser();
    }

    if (signal.aborted) return;
    await setStatus(book.id, { kind: 'ready' }, deps.booksRepo);
  } catch (err) {
    if (signal.aborted) return;
    console.warn('[indexing]', err);
    await setStatus(
      book.id,
      { kind: 'failed', reason: classifyError(err) },
      deps.booksRepo,
    );
  }
}
