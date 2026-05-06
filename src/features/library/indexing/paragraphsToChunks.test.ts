import { describe, it, expect } from 'vitest';
import { paragraphsToChunks } from './paragraphsToChunks';
import { BookId, SectionId, type LocationAnchor } from '@/domain';

const ANCHOR: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' };

async function* fromArray<T>(arr: readonly T[]): AsyncIterable<T> {
  await Promise.resolve();
  for (const item of arr) yield item;
}

const baseInput = {
  bookId: BookId('b1'),
  sectionId: SectionId('s1'),
  sectionTitle: 'Chapter 1',
  chunkerVersion: 1,
};

describe('paragraphsToChunks', () => {
  it('packs short paragraphs into a single chunk under the cap', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: 'First paragraph.', locationAnchor: ANCHOR },
        { text: 'Second paragraph.', locationAnchor: ANCHOR },
      ]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.normalizedText).toContain('First paragraph');
    expect(result[0]!.normalizedText).toContain('Second paragraph');
  });

  it('emits chunk metadata: id, bookId, sectionId, sectionTitle, chunkerVersion, anchor', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([{ text: 'Solo.', locationAnchor: ANCHOR }]),
    });
    const chunk = result[0]!;
    expect(chunk.bookId).toBe(BookId('b1'));
    expect(chunk.sectionId).toBe(SectionId('s1'));
    expect(chunk.sectionTitle).toBe('Chapter 1');
    expect(chunk.chunkerVersion).toBe(1);
    expect(chunk.locationAnchor).toEqual(ANCHOR);
    expect(chunk.id).toMatch(/^chunk-b1-s1-\d+$/);
    expect(chunk.tokenEstimate).toBeGreaterThan(0);
    expect(chunk.checksum).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('starts a new chunk when the next paragraph would exceed the 400-token cap', async () => {
    // Each paragraph is ~600 chars = ~150 tokens. 3 paragraphs = ~450 tokens > 400.
    const longText = 'word '.repeat(120).trim(); // ~600 chars
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: longText, locationAnchor: ANCHOR },
        { text: longText, locationAnchor: ANCHOR },
        { text: longText, locationAnchor: ANCHOR },
      ]),
    });
    // Two paragraphs fit in one chunk (~300 tokens); the third opens a second chunk.
    expect(result.length).toBe(2);
    expect(result[0]!.tokenEstimate).toBeLessThanOrEqual(400);
    expect(result[1]!.tokenEstimate).toBeLessThanOrEqual(400);
  });

  it('splits a single paragraph at sentence boundaries when it alone exceeds the cap', async () => {
    // ~2400 chars = ~600 tokens > 400. Multiple sentences.
    const sentence = 'This is a test sentence. ';
    const longParagraph = sentence.repeat(100).trim();
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([{ text: longParagraph, locationAnchor: ANCHOR }]),
    });
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(400);
    }
  });

  it('chunk IDs are stable across reruns of the same input (deterministic)', async () => {
    const run1 = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: 'A.', locationAnchor: ANCHOR },
        { text: 'B.', locationAnchor: ANCHOR },
      ]),
    });
    const run2 = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: 'A.', locationAnchor: ANCHOR },
        { text: 'B.', locationAnchor: ANCHOR },
      ]),
    });
    expect(run1.map((c) => c.id)).toEqual(run2.map((c) => c.id));
    expect(run1.map((c) => c.checksum)).toEqual(run2.map((c) => c.checksum));
  });

  it('returns empty array when given no paragraphs', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([]),
    });
    expect(result).toEqual([]);
  });

  it('skips whitespace-only paragraphs', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: '   ', locationAnchor: ANCHOR },
        { text: 'Real content.', locationAnchor: ANCHOR },
      ]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.normalizedText).toBe('Real content.');
  });
});
