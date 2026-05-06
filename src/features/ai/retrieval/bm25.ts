import type { ChunkId, TextChunk } from '@/domain';
import { tokenizeForBM25 } from './tokenize';

export type BM25Params = { readonly k1: number; readonly b: number };
export const BM25_DEFAULT: BM25Params = { k1: 1.2, b: 0.75 };

export type ScoredChunk = { readonly chunkId: ChunkId; readonly score: number };

export function bm25Rank(
  query: string,
  chunks: readonly TextChunk[],
  params: BM25Params = BM25_DEFAULT,
  topN = 30,
): readonly ScoredChunk[] {
  if (chunks.length === 0) return [];
  const queryTerms = tokenizeForBM25(query);
  if (queryTerms.length === 0) return [];

  const N = chunks.length;
  const tokenized = chunks.map((c) => tokenizeForBM25(c.normalizedText));
  const lengths = tokenized.map((t) => t.length);
  const avgLen = lengths.reduce((s, n) => s + n, 0) / N;

  const df = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    let count = 0;
    for (const toks of tokenized) {
      if (toks.includes(term)) count += 1;
    }
    df.set(term, count);
  }

  const { k1, b } = params;
  const scored: ScoredChunk[] = [];
  for (let i = 0; i < N; i += 1) {
    const toks = tokenized[i];
    const len = lengths[i];
    const chunk = chunks[i];
    if (toks === undefined || len === undefined || chunk === undefined) continue;
    let score = 0;
    for (const term of queryTerms) {
      const dfT = df.get(term) ?? 0;
      if (dfT === 0) continue;
      let tf = 0;
      for (const t of toks) if (t === term) tf += 1;
      if (tf === 0) continue;
      const idf = Math.log((N - dfT + 0.5) / (dfT + 0.5) + 1);
      const denom = tf + k1 * (1 - b + b * (len / (avgLen || 1)));
      score += idf * ((tf * (k1 + 1)) / denom);
    }
    if (score > 0) scored.push({ chunkId: chunk.id, score });
  }

  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, topN);
}
