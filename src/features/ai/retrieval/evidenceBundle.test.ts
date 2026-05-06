import { describe, expect, it } from 'vitest';
import { assembleEvidenceBundle, buildEvidenceBundleForPreview } from './evidenceBundle';
import { BookId, ChunkId, SectionId, type TextChunk } from '@/domain';

function chunk(
  bookId: string,
  sectionId: string,
  idx: number,
  sectionTitle: string,
  text: string,
  tokens: number,
): TextChunk {
  return {
    id: ChunkId(`chunk-${bookId}-${sectionId}-${String(idx)}`),
    bookId: BookId(bookId),
    sectionId: SectionId(sectionId),
    sectionTitle,
    text,
    normalizedText: text,
    tokenEstimate: tokens,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('assembleEvidenceBundle', () => {
  it('happy path: includes top chunks within budget', () => {
    const chunks = [
      chunk('b1', 's1', 0, 'Ch 1', 'one', 100),
      chunk('b1', 's1', 1, 'Ch 1', 'two', 100),
      chunk('b1', 's2', 0, 'Ch 2', 'three', 100),
    ];
    const ranked = chunks.map((c) => c.id);
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 250,
      minChunks: 1,
      maxChunks: 12,
    });
    expect(bundle.includedChunkIds).toHaveLength(2);
    expect(bundle.totalTokens).toBe(200);
  });

  it('honors minChunks even past budget', () => {
    const chunks = [
      chunk('b1', 's1', 0, 'Ch 1', 'one', 1000),
      chunk('b1', 's1', 1, 'Ch 1', 'two', 1000),
      chunk('b1', 's1', 2, 'Ch 1', 'three', 1000),
    ];
    const bundle = assembleEvidenceBundle(
      chunks.map((c) => c.id),
      chunks,
      { budgetTokens: 100, minChunks: 3, maxChunks: 12 },
    );
    expect(bundle.includedChunkIds).toHaveLength(3);
  });

  it('honors maxChunks ceiling', () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      chunk('b1', 's1', i, 'Ch 1', `c${String(i)}`, 10),
    );
    const bundle = assembleEvidenceBundle(
      chunks.map((c) => c.id),
      chunks,
      { budgetTokens: 100000, minChunks: 1, maxChunks: 5 },
    );
    expect(bundle.includedChunkIds).toHaveLength(5);
  });

  it('regroups by section preserving first-appearance order', () => {
    const chunks = [
      chunk('b1', 's2', 0, 'Ch 2', 'two-zero', 50),
      chunk('b1', 's1', 1, 'Ch 1', 'one-one', 50),
      chunk('b1', 's2', 1, 'Ch 2', 'two-one', 50),
      chunk('b1', 's1', 0, 'Ch 1', 'one-zero', 50),
    ];
    const ranked = [chunks[0]!.id, chunks[1]!.id, chunks[2]!.id, chunks[3]!.id];
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    expect(bundle.sectionGroups[0]?.sectionId).toBe(SectionId('s2'));
    expect(bundle.sectionGroups[1]?.sectionId).toBe(SectionId('s1'));
    expect(bundle.sectionGroups[0]?.chunks.map((c) => c.chunk.id)).toEqual([
      ChunkId('chunk-b1-s2-0'),
      ChunkId('chunk-b1-s2-1'),
    ]);
    expect(bundle.sectionGroups[1]?.chunks.map((c) => c.chunk.id)).toEqual([
      ChunkId('chunk-b1-s1-0'),
      ChunkId('chunk-b1-s1-1'),
    ]);
  });

  it('citation tags are 1-indexed in RRF order via includedChunkIds', () => {
    const chunks = [
      chunk('b1', 's1', 0, 'Ch 1', 'a', 50),
      chunk('b1', 's2', 0, 'Ch 2', 'b', 50),
    ];
    const ranked = [chunks[1]!.id, chunks[0]!.id];
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    expect(bundle.includedChunkIds[0]).toBe(ChunkId('chunk-b1-s2-0'));
    expect(bundle.includedChunkIds[1]).toBe(ChunkId('chunk-b1-s1-0'));
    const flat = bundle.sectionGroups.flatMap((g) =>
      g.chunks.map((c) => ({ id: c.chunk.id, tag: c.citationTag })),
    );
    expect(flat.find((f) => f.id === ChunkId('chunk-b1-s2-0'))?.tag).toBe(1);
    expect(flat.find((f) => f.id === ChunkId('chunk-b1-s1-0'))?.tag).toBe(2);
  });

  it('skips chunkIds with no matching TextChunk', () => {
    const chunks = [chunk('b1', 's1', 0, 'Ch 1', 'a', 50)];
    const ranked = [ChunkId('chunk-b1-s9-99'), chunks[0]!.id];
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    expect(bundle.includedChunkIds).toEqual([chunks[0]!.id]);
  });
});

describe('buildEvidenceBundleForPreview', () => {
  it('renders citation tags + section headers in stable order', () => {
    const chunks = [chunk('b1', 's1', 0, 'Ch 1', 'alpha', 50)];
    const bundle = assembleEvidenceBundle([chunks[0]!.id], chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    const preview = buildEvidenceBundleForPreview(bundle);
    expect(preview).toContain('### Ch 1');
    expect(preview).toContain('[1]');
    expect(preview).toContain('alpha');
  });
});
