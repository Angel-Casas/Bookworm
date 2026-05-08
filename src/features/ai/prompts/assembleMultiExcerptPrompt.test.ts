import { describe, it, expect } from 'vitest';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';
import {
  assembleMultiExcerptPrompt,
  MULTI_EXCERPT_TOTAL_BUDGET,
  PER_EXCERPT_SOFT_CAP_TOKENS,
  PER_EXCERPT_FLOOR_TOKENS,
} from './assembleMultiExcerptPrompt';

const ts = IsoTimestamp('2026-05-08T00:00:00.000Z');
const mk = (i: number, sectionTitle: string, text: string): AttachedExcerpt => ({
  id: `h:${String(i)}`,
  sourceKind: 'highlight',
  highlightId: HighlightId(`h${String(i)}`),
  anchor: { kind: 'epub-cfi', cfi: `epubcfi(/6/4!/4/${String(i)})` },
  sectionTitle,
  text,
  addedAt: ts,
});

describe('assembleMultiExcerptPrompt', () => {
  it('exports the documented budget constants', () => {
    expect(MULTI_EXCERPT_TOTAL_BUDGET).toBe(5000);
    expect(PER_EXCERPT_SOFT_CAP_TOKENS).toBe(800);
    expect(PER_EXCERPT_FLOOR_TOKENS).toBe(200);
  });

  it('returns [system, user] pair', () => {
    const out = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', 'first'), mk(4, 'Ch II', 'second')],
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.role).toBe('system');
    expect(out[1]?.role).toBe('user');
  });

  it('system message names the book and includes grounding rules', () => {
    const [sys] = assembleMultiExcerptPrompt({
      book: { title: 'A Book', author: 'Jane' },
      excerpts: [mk(2, 'Ch I', 'first')],
    });
    expect(sys?.content).toContain('A Book');
    expect(sys?.content).toContain('Jane');
    expect(sys?.content.toLowerCase()).toContain('excerpt');
  });

  it('user message labels excerpts by 1-based index and section title in input order', () => {
    const [, user] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', 'AAA'), mk(4, 'Ch II', 'BBB')],
    });
    expect(user?.content).toContain('Excerpt 1 — Ch I');
    expect(user?.content).toContain('Excerpt 2 — Ch II');
    const aIdx = user?.content.indexOf('AAA') ?? -1;
    const bIdx = user?.content.indexOf('BBB') ?? -1;
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('truncates an over-soft-cap excerpt and appends the marker', () => {
    const longText = 'x'.repeat(PER_EXCERPT_SOFT_CAP_TOKENS * 4 + 2000);
    const [, user] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', longText)],
    });
    expect(user?.content).toContain('(truncated for AI)');
    expect((user?.content.length ?? 0)).toBeLessThan(longText.length);
  });

  it('proportionally trims excerpts when the bundle exceeds total budget', () => {
    const overDense = 'z'.repeat(PER_EXCERPT_SOFT_CAP_TOKENS * 4 + 4000);
    const overExcerpts = Array.from({ length: 6 }, (_, i) =>
      mk(i * 2, `Ch ${String(i)}`, overDense),
    );
    const [, user] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: overExcerpts,
    });
    const totalChars = user?.content.length ?? 0;
    // After trimming, total user-message tokens should sit close to budget
    // (with some structural framing on top).
    expect(totalChars / 4).toBeLessThan(MULTI_EXCERPT_TOTAL_BUDGET + 1000);
    // Each excerpt label still present.
    for (let i = 1; i <= 6; i++) {
      expect(user?.content).toContain(`Excerpt ${String(i)} — Ch ${String(i - 1)}`);
    }
  });

  it('handles author-less book gracefully', () => {
    const [sys] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', 'first')],
    });
    expect(sys?.content).not.toMatch(/by\s+undefined/i);
  });

  it('PDF section titles flow through verbatim', () => {
    const [, user] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Page 12', 'pdf text')],
    });
    expect(user?.content).toContain('Excerpt 1 — Page 12');
  });
});
