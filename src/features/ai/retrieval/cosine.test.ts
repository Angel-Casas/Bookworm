import { describe, expect, it } from 'vitest';
import { cosineRank } from './cosine';
import { BookId, ChunkId, IsoTimestamp, type BookEmbedding } from '@/domain';

function unit(...components: number[]): Float32Array {
  const v = new Float32Array(components);
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Float32Array(v.length);
  let i = 0;
  for (const x of v) {
    out[i] = x / norm;
    i += 1;
  }
  return out;
}

function emb(id: string, vec: Float32Array): BookEmbedding {
  return {
    id: ChunkId(id),
    bookId: BookId('b1'),
    vector: vec,
    chunkerVersion: 1,
    embeddingModelVersion: 1,
    embeddedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

describe('cosineRank', () => {
  it('returns chunks ordered by dot product (pre-normalized)', () => {
    const q = unit(1, 0);
    const embeddings = [
      emb('chunk-b1-s1-0', unit(1, 0)),
      emb('chunk-b1-s1-1', unit(1, 1)),
      emb('chunk-b1-s1-2', unit(0, 1)),
    ];
    const ranked = cosineRank(q, embeddings);
    expect(ranked[0]?.chunkId).toBe(ChunkId('chunk-b1-s1-0'));
    expect(ranked[0]?.score ?? 0).toBeCloseTo(1, 4);
    expect(ranked[1]?.chunkId).toBe(ChunkId('chunk-b1-s1-1'));
    expect(ranked[1]?.score ?? 0).toBeCloseTo(Math.cos(Math.PI / 4), 4);
  });

  it('respects topN', () => {
    const q = unit(1, 0);
    const embeddings = Array.from({ length: 10 }, (_, i) =>
      emb(`chunk-b1-s1-${String(i)}`, unit(1, i / 10)),
    );
    const ranked = cosineRank(q, embeddings, 3);
    expect(ranked).toHaveLength(3);
  });

  it('returns empty when embeddings list is empty', () => {
    expect(cosineRank(unit(1, 0), [])).toEqual([]);
  });
});
