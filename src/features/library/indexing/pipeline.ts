import {
  IsoTimestamp,
  type Book,
  type BookEmbedding,
  type BookId,
  type TextChunk,
} from '@/domain';
import type { IndexingStatus } from '@/domain/indexing/types';
import type {
  BookChunksRepository,
  BookEmbeddingsRepository,
  BookRepository,
} from '@/storage';
import type { ChunkExtractor } from './extractor';
import { paragraphsToChunks } from './paragraphsToChunks';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { classifyError } from './classifyError';
import {
  CURRENT_EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_VERSION,
} from './embeddings/EMBEDDING_MODEL';
import { l2Normalize } from './embeddings/normalize';
import { classifyEmbeddingError } from './embeddings/classifyEmbeddingError';
import type { EmbedClient, EmbedResult } from './embeddings/types';

export type PipelineDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
  readonly embedClient: EmbedClient;
  // Optional notification fired after each successful booksRepo.put on a
  // status transition. Used by App.tsx to push live updates into the React
  // libraryStore so the library card reflects pipeline progress without
  // requiring a full page reload. Best-effort: pipeline correctness does not
  // depend on the callback completing.
  readonly onBookStatusChange?: (book: Book) => void;
};

// OpenAI / NanoGPT cap text-embedding-3-small at 8191 tokens per *request*
// (sum of all input array items). Our internal tokenEstimate is conservative
// vs. the server's tokenizer (typically over-counts by ~25-30%), so target a
// budget well below the cap to leave headroom under both. Empirically a
// 32-chunk batch with our 400-token-per-chunk cap can hit 9500+ tokens by
// the server's count, blowing the 8191 limit.
const EMBED_TOKEN_BUDGET = 6500;
// Hard cap on batch count even when chunks are tiny, to keep request shapes
// predictable and avoid pathological 1000-chunk single requests.
const EMBED_MAX_BATCH_COUNT = 32;
const EMBED_RETRY_ATTEMPTS = 3;

export const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

async function setStatus(
  bookId: BookId,
  status: IndexingStatus,
  booksRepo: BookRepository,
  onChange?: (book: Book) => void,
): Promise<void> {
  const book = await booksRepo.getById(bookId);
  if (book === undefined) return;
  const updated: Book = {
    ...book,
    indexingStatus: status,
    updatedAt: IsoTimestamp(new Date().toISOString()),
  };
  await booksRepo.put(updated);
  onChange?.(updated);
}

// Pack chunks into batches respecting both the per-request token budget and
// the max-count cap. Single chunks exceeding the budget are sent alone (the
// server may still accept; if not, the embedding stage surfaces the failure
// with the actual error from EmbedError.serverMessage).
export function batchByTokenBudget<T extends { tokenEstimate: number }>(
  items: readonly T[],
  tokenBudget: number = EMBED_TOKEN_BUDGET,
  maxCount: number = EMBED_MAX_BATCH_COUNT,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;
  for (const item of items) {
    const t = item.tokenEstimate;
    const wouldOverflowTokens = currentTokens + t > tokenBudget;
    const wouldOverflowCount = current.length >= maxCount;
    if (current.length > 0 && (wouldOverflowTokens || wouldOverflowCount)) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(item);
    currentTokens += t;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function embedWithRetry(
  client: EmbedClient,
  req: { modelId: string; inputs: readonly string[]; signal?: AbortSignal },
): Promise<EmbedResult> {
  for (let attempt = 0; attempt < EMBED_RETRY_ATTEMPTS - 1; attempt += 1) {
    try {
      return await client.embed(req);
    } catch (err) {
      const failure = (err as { failure?: { reason?: string; retryAfterSeconds?: number } })
        .failure;
      if (failure?.reason !== 'rate-limit') throw err;
      const baseDelayMs = (failure.retryAfterSeconds ?? 1) * 1000;
      const backoffMs = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return client.embed(req);
}

export async function runIndexing(
  book: Book,
  signal: AbortSignal,
  deps: PipelineDeps,
): Promise<void> {
  const extractor = book.format === 'epub' ? deps.epubExtractor : deps.pdfExtractor;
  try {
    await setStatus(
      book.id,
      { kind: 'chunking', progressPercent: 0 },
      deps.booksRepo,
      deps.onBookStatusChange,
    );

    const sections = await extractor.listSections(book);
    if (sections.length === 0) {
      if (signal.aborted) return;
      await setStatus(
        book.id,
        { kind: 'failed', reason: 'no-text-found' },
        deps.booksRepo,
        deps.onBookStatusChange,
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
        deps.onBookStatusChange,
      );
      await yieldToBrowser();
    }

    if (signal.aborted) return;

    // The chunking loop completed but may have produced zero chunks (e.g.,
    // a book with sections but no paragraph-tag content, or an extractor
    // bug that silently yields nothing). Refuse to mark such a book 'ready'
    // — without chunks, retrieval and profile generation can never work,
    // and the chat panel would be permanently stuck on 'still preparing'.
    // 'failed' surfaces the issue and exposes a Retry affordance.
    const chunkCount = await deps.chunksRepo.countByBook(book.id);
    if (chunkCount === 0) {
      await setStatus(
        book.id,
        { kind: 'failed', reason: 'no-text-extracted' },
        deps.booksRepo,
        deps.onBookStatusChange,
      );
      return;
    }

    const outcome = await runEmbeddingStage(book, signal, deps);
    if (outcome === 'aborted' || outcome === 'failed') return;

    await setStatus(book.id, { kind: 'ready' }, deps.booksRepo, deps.onBookStatusChange);
  } catch (err) {
    if (signal.aborted) return;
    console.warn('[indexing]', err);
    await setStatus(
      book.id,
      { kind: 'failed', reason: classifyError(err) },
      deps.booksRepo,
      deps.onBookStatusChange,
    );
  }
}

type EmbeddingStageOutcome = 'ok' | 'aborted' | 'failed';

async function runEmbeddingStage(
  book: Book,
  signal: AbortSignal,
  deps: PipelineDeps,
): Promise<EmbeddingStageOutcome> {
  await setStatus(
    book.id,
    { kind: 'embedding', progressPercent: 0 },
    deps.booksRepo,
    deps.onBookStatusChange,
  );
  const allChunks = await deps.chunksRepo.listByBook(book.id);
  if (allChunks.length === 0) return 'ok';

  const toEmbed: TextChunk[] = [];
  for (const c of allChunks) {
    if (await deps.embeddingsRepo.hasEmbeddingFor(c.id)) continue;
    toEmbed.push(c);
  }

  let processed = allChunks.length - toEmbed.length;
  for (const batch of batchByTokenBudget(toEmbed)) {
    if (signal.aborted) return 'aborted';

    let result: EmbedResult;
    try {
      result = await embedWithRetry(deps.embedClient, {
        modelId: CURRENT_EMBEDDING_MODEL_ID,
        inputs: batch.map((c) => c.normalizedText),
        signal,
      });
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (signal.aborted) return 'aborted';
      console.warn('[indexing][embedding]', err);
      await setStatus(
        book.id,
        { kind: 'failed', reason: classifyEmbeddingError(err) },
        deps.booksRepo,
        deps.onBookStatusChange,
      );
      return 'failed';
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (signal.aborted) return 'aborted';

    const records: BookEmbedding[] = batch.map((chunk, i) => {
      const vec = result.vectors[i];
      if (vec === undefined) {
        throw new Error(`embed: missing vector for batch index ${String(i)}`);
      }
      return {
        id: chunk.id,
        bookId: chunk.bookId,
        vector: l2Normalize(vec),
        chunkerVersion: chunk.chunkerVersion,
        embeddingModelVersion: EMBEDDING_MODEL_VERSION,
        embeddedAt: IsoTimestamp(new Date().toISOString()),
      };
    });
    await deps.embeddingsRepo.upsertMany(records);

    processed += batch.length;
    const progressPercent = Math.round((processed / allChunks.length) * 100);
    await setStatus(
      book.id,
      { kind: 'embedding', progressPercent },
      deps.booksRepo,
      deps.onBookStatusChange,
    );
    await yieldToBrowser();
  }
  return 'ok';
}
