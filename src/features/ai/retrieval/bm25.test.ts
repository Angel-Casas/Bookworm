import { describe, expect, it } from 'vitest';
import { bm25Rank } from './bm25';
import { BookId, ChunkId, SectionId, type TextChunk } from '@/domain';

function chunk(id: string, text: string): TextChunk {
  return {
    id: ChunkId(id),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Ch 1',
    text,
    normalizedText: text,
    tokenEstimate: Math.ceil(text.length / 4),
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('bm25Rank', () => {
  it('returns matching chunks ordered by score desc', () => {
    const chunks = [
      chunk('chunk-b1-s1-0', 'cats are cute small mammals'),
      chunk('chunk-b1-s1-1', 'dogs bark loudly at strangers'),
      chunk('chunk-b1-s1-2', 'the cat sat on the mat with another cat'),
    ];
    const ranked = bm25Rank('cat', chunks);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(0);
    const dogScore = ranked.find((r) => r.chunkId === ChunkId('chunk-b1-s1-1'))?.score ?? 0;
    expect(dogScore).toBe(0);
  });

  it('returns empty for query with no overlap', () => {
    const chunks = [chunk('chunk-b1-s1-0', 'hello world')];
    const ranked = bm25Rank('zebra', chunks);
    expect(ranked).toHaveLength(0);
  });

  it('respects topN', () => {
    const chunks = Array.from({ length: 50 }, (_, i) =>
      chunk(`chunk-b1-s1-${String(i)}`, `cat number ${String(i)}`),
    );
    const ranked = bm25Rank('cat', chunks, undefined, 5);
    expect(ranked).toHaveLength(5);
  });

  it('handles empty corpus', () => {
    expect(bm25Rank('cat', [])).toEqual([]);
  });

  it('penalizes longer chunks for the same tf', () => {
    const short = chunk('chunk-b1-s1-0', 'cat');
    const long = chunk('chunk-b1-s1-1', 'cat ' + 'lorem '.repeat(50));
    const ranked = bm25Rank('cat', [short, long]);
    expect(ranked[0]?.chunkId).toBe(ChunkId('chunk-b1-s1-0'));
  });
});
