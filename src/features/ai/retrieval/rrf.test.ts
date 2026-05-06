import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './rrf';
import { ChunkId } from '@/domain';

const cid = (n: number): ChunkId => ChunkId(`chunk-b1-s1-${String(n)}`);

describe('reciprocalRankFusion', () => {
  it('combines two rankings with default k=60', () => {
    const a = [
      { chunkId: cid(1), score: 10 },
      { chunkId: cid(2), score: 5 },
    ];
    const b = [
      { chunkId: cid(2), score: 8 },
      { chunkId: cid(3), score: 2 },
    ];
    const fused = reciprocalRankFusion([a, b]);
    expect(fused[0]?.chunkId).toBe(cid(2));
    expect(fused.map((s) => s.chunkId)).toEqual([cid(2), cid(1), cid(3)]);
  });

  it('one empty list preserves the other', () => {
    const a = [{ chunkId: cid(1), score: 10 }];
    const fused = reciprocalRankFusion([a, []]);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.chunkId).toBe(cid(1));
  });

  it('both empty → empty', () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it('respects custom k', () => {
    const a = [{ chunkId: cid(1), score: 10 }];
    const k60 = reciprocalRankFusion([a], 60)[0]?.score ?? 0;
    const k1 = reciprocalRankFusion([a], 1)[0]?.score ?? 0;
    expect(k1).toBeGreaterThan(k60);
  });
});
