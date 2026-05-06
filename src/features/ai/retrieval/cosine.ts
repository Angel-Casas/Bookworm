import type { BookEmbedding } from '@/domain';
import type { ScoredChunk } from './bm25';

export function cosineRank(
  queryVector: Float32Array,
  embeddings: readonly BookEmbedding[],
  topN = 30,
): readonly ScoredChunk[] {
  if (embeddings.length === 0) return [];
  const dim = queryVector.length;
  const scored: ScoredChunk[] = [];
  for (const e of embeddings) {
    if (e.vector.length !== dim) continue;
    let dot = 0;
    for (let i = 0; i < dim; i += 1) {
      const q = queryVector[i] ?? 0;
      const v = e.vector[i] ?? 0;
      dot += q * v;
    }
    if (dot > 0) scored.push({ chunkId: e.id, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
