import type { BookId } from '@/domain';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import type { EmbedClient } from '@/features/library/indexing/embeddings/types';
import { CURRENT_EMBEDDING_MODEL_ID } from '@/features/library/indexing/embeddings/EMBEDDING_MODEL';
import { l2Normalize } from '@/features/library/indexing/embeddings/normalize';
import type { EmbedFailure } from '@/features/ai/chat/nanogptEmbeddings';
import { bm25Rank } from './bm25';
import { cosineRank } from './cosine';
import { reciprocalRankFusion } from './rrf';
import { assembleEvidenceBundle, type EvidenceBundle } from './evidenceBundle';

export type RetrievalDeps = {
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly embedClient: EmbedClient;
};

export type RetrievalResult =
  | { readonly kind: 'ok'; readonly bundle: EvidenceBundle }
  | { readonly kind: 'no-embeddings' }
  | { readonly kind: 'embed-failed'; readonly reason: EmbedFailure['reason'] }
  | { readonly kind: 'no-results' };

const BUDGET_TOKENS = 3000;
const MIN_CHUNKS = 3;
const MAX_CHUNKS = 12;

export async function runRetrieval(input: {
  readonly bookId: BookId;
  readonly question: string;
  readonly deps: RetrievalDeps;
  readonly signal?: AbortSignal;
}): Promise<RetrievalResult> {
  const { bookId, question, deps, signal } = input;
  const [chunks, embeddings] = await Promise.all([
    deps.chunksRepo.listByBook(bookId),
    deps.embeddingsRepo.listByBook(bookId),
  ]);

  if (embeddings.length === 0) return { kind: 'no-embeddings' };

  let queryVector: Float32Array;
  try {
    const result = await deps.embedClient.embed({
      modelId: CURRENT_EMBEDDING_MODEL_ID,
      inputs: [question],
      ...(signal !== undefined ? { signal } : {}),
    });
    const first = result.vectors[0];
    if (first === undefined) return { kind: 'embed-failed', reason: 'malformed-response' };
    queryVector = l2Normalize(first);
  } catch (err) {
    const failure = (err as { failure?: { reason?: EmbedFailure['reason'] } }).failure;
    return { kind: 'embed-failed', reason: failure?.reason ?? 'network' };
  }

  const [bm25, cosine] = await Promise.all([
    Promise.resolve(bm25Rank(question, chunks)),
    Promise.resolve(cosineRank(queryVector, embeddings)),
  ]);
  const fused = reciprocalRankFusion([bm25, cosine]);
  if (fused.length === 0) return { kind: 'no-results' };

  const bundle = assembleEvidenceBundle(
    fused.map((s) => s.chunkId),
    chunks,
    { budgetTokens: BUDGET_TOKENS, minChunks: MIN_CHUNKS, maxChunks: MAX_CHUNKS },
  );
  if (bundle.includedChunkIds.length === 0) return { kind: 'no-results' };
  return { kind: 'ok', bundle };
}
