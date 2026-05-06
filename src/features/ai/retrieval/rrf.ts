import type { ChunkId } from '@/domain';
import type { ScoredChunk } from './bm25';

const RRF_DEFAULT_K = 60;

export function reciprocalRankFusion(
  rankings: readonly (readonly ScoredChunk[])[],
  k: number = RRF_DEFAULT_K,
): readonly ScoredChunk[] {
  const fused = new Map<ChunkId, number>();
  for (const list of rankings) {
    for (let rank = 0; rank < list.length; rank += 1) {
      const item = list[rank];
      if (item === undefined) continue;
      const contribution = 1 / (k + rank + 1);
      fused.set(item.chunkId, (fused.get(item.chunkId) ?? 0) + contribution);
    }
  }
  return [...fused.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score);
}
