import { describe, expect, it } from 'vitest';
import { sampleChunksForProfile } from './sampleChunksForProfile';
import { BookId, ChunkId, SectionId, type TextChunk } from '@/domain';

function chunk(sectionId: string, idx: number, tokens: number): TextChunk {
  return {
    id: ChunkId(`chunk-b1-${sectionId}-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId(sectionId),
    sectionTitle: `Ch ${sectionId}`,
    text: `chunk ${sectionId}-${String(idx)}`,
    normalizedText: `chunk ${sectionId}-${String(idx)}`,
    tokenEstimate: tokens,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('sampleChunksForProfile', () => {
  it('returns empty for zero sections', () => {
    expect(sampleChunksForProfile([], { budgetTokens: 3000 })).toEqual([]);
  });

  it('takes the first chunk of each section under budget', () => {
    const sections = [
      { sectionId: SectionId('s1'), chunks: [chunk('s1', 0, 100), chunk('s1', 1, 100)] },
      { sectionId: SectionId('s2'), chunks: [chunk('s2', 0, 100)] },
    ];
    const result = sampleChunksForProfile(sections, { budgetTokens: 1000 });
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(ChunkId('chunk-b1-s1-0'));
    expect(result[1]?.id).toBe(ChunkId('chunk-b1-s2-0'));
  });

  it('honors the token budget, stopping greedily', () => {
    const sections = Array.from({ length: 10 }, (_, i) => ({
      sectionId: SectionId(`s${String(i)}`),
      chunks: [chunk(`s${String(i)}`, 0, 400)],
    }));
    const result = sampleChunksForProfile(sections, { budgetTokens: 1000 });
    // 400 + 400 = 800 fits; 800 + 400 = 1200 overflows → stop after 2.
    expect(result).toHaveLength(2);
  });

  it('strides across sections to spread coverage', () => {
    const sections = Array.from({ length: 20 }, (_, i) => ({
      sectionId: SectionId(`s${String(i)}`),
      chunks: [chunk(`s${String(i)}`, 0, 400)],
    }));
    // budget=3000 → desiredSamples = floor(3000/400) = 7 → stride=ceil(20/7)=3
    // → take s0, s3, s6, s9, s12, s15, s18 → 7 sections, 7 * 400 = 2800 tokens
    const result = sampleChunksForProfile(sections, { budgetTokens: 3000 });
    expect(result.map((c) => c.sectionId)).toEqual([
      SectionId('s0'),
      SectionId('s3'),
      SectionId('s6'),
      SectionId('s9'),
      SectionId('s12'),
      SectionId('s15'),
      SectionId('s18'),
    ]);
  });

  it('is deterministic — same input yields same output', () => {
    const sections = [
      { sectionId: SectionId('s1'), chunks: [chunk('s1', 0, 100)] },
      { sectionId: SectionId('s2'), chunks: [chunk('s2', 0, 100)] },
    ];
    const a = sampleChunksForProfile(sections, { budgetTokens: 500 });
    const b = sampleChunksForProfile(sections, { budgetTokens: 500 });
    expect(a).toEqual(b);
  });

  it('handles single section with multiple chunks (samplesPerSection default = 1)', () => {
    const sections = [
      {
        sectionId: SectionId('s1'),
        chunks: [chunk('s1', 0, 100), chunk('s1', 1, 100), chunk('s1', 2, 100)],
      },
    ];
    const result = sampleChunksForProfile(sections, { budgetTokens: 1000 });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(ChunkId('chunk-b1-s1-0'));
  });
});
