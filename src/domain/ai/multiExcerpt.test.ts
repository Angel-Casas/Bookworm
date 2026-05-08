import { describe, it, expect } from 'vitest';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import {
  MAX_EXCERPTS,
  MAX_EXCERPT_CHARS,
  stableAnchorHash,
  type AttachedExcerpt,
} from './multiExcerpt';

describe('multiExcerpt — constants', () => {
  it('caps tray at 6 excerpts', () => {
    expect(MAX_EXCERPTS).toBe(6);
  });
  it('caps per-excerpt text at 4000 chars', () => {
    expect(MAX_EXCERPT_CHARS).toBe(4000);
  });
});

describe('stableAnchorHash', () => {
  it('returns identical hash for the same EPUB CFI anchor', () => {
    const a = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' });
    const b = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' });
    expect(a).toBe(b);
  });
  it('returns different hashes for different CFI anchors', () => {
    const a = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' });
    const b = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/4)' });
    expect(a).not.toBe(b);
  });
  it('returns identical hash for the same PDF anchor', () => {
    const a = stableAnchorHash({
      kind: 'pdf',
      page: 12,
      rects: [{ x: 1, y: 2, width: 100, height: 10 }],
    });
    const b = stableAnchorHash({
      kind: 'pdf',
      page: 12,
      rects: [{ x: 1, y: 2, width: 100, height: 10 }],
    });
    expect(a).toBe(b);
  });
  it('returns different hashes for different PDF pages', () => {
    const base = { x: 0, y: 0, width: 100, height: 10 };
    const a = stableAnchorHash({ kind: 'pdf', page: 1, rects: [base] });
    const b = stableAnchorHash({ kind: 'pdf', page: 2, rects: [base] });
    expect(a).not.toBe(b);
  });
});

describe('AttachedExcerpt — shape', () => {
  it('compiles with required fields', () => {
    const e: AttachedExcerpt = {
      id: 'h:abc',
      sourceKind: 'highlight',
      highlightId: HighlightId('abc'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' },
      sectionTitle: 'Chapter II',
      text: 'He had been waiting…',
      addedAt: IsoTimestamp('2026-05-08T00:00:00.000Z'),
    };
    expect(e.id).toBe('h:abc');
  });
});
