import { describe, it, expect } from 'vitest';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import {
  MAX_EXCERPTS,
  MAX_EXCERPT_CHARS,
  compareExcerptOrder,
  stableAnchorHash,
  trayReduce,
  type AttachedExcerpt,
  type AttachedMultiExcerpt,
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

const baseTs = IsoTimestamp('2026-05-08T00:00:00.000Z');
const mkExcerpt = (cfi: string, id?: string): AttachedExcerpt => {
  const useId = id ?? `h:${cfi}`;
  return {
    id: useId,
    sourceKind: 'highlight',
    highlightId: HighlightId(useId),
    anchor: { kind: 'epub-cfi', cfi },
    sectionTitle: 'Ch',
    text: 't',
    addedAt: baseTs,
  };
};

describe('compareExcerptOrder', () => {
  it('orders excerpts by their anchor (EPUB)', () => {
    const a = mkExcerpt('epubcfi(/6/4!/4/2)');
    const b = mkExcerpt('epubcfi(/6/4!/4/4)');
    expect(compareExcerptOrder(a, b)).toBeLessThan(0);
    expect(compareExcerptOrder(b, a)).toBeGreaterThan(0);
  });
});

describe('trayReduce', () => {
  it('add: empty tray → tray with 1 excerpt, ok', () => {
    const r = trayReduce(null, { type: 'add', excerpt: mkExcerpt('epubcfi(/6/4!/4/2)') });
    expect(r.result).toBe('ok');
    expect(r.tray?.excerpts.length).toBe(1);
  });
  it('add: dedupe by id', () => {
    const e = mkExcerpt('epubcfi(/6/4!/4/2)');
    const r1 = trayReduce(null, { type: 'add', excerpt: e });
    const r2 = trayReduce(r1.tray, { type: 'add', excerpt: e });
    expect(r2.result).toBe('duplicate');
    expect(r2.tray?.excerpts.length).toBe(1);
  });
  it('add: hard-cap at MAX_EXCERPTS', () => {
    let tray: AttachedMultiExcerpt | null = null;
    for (let i = 0; i < MAX_EXCERPTS; i++) {
      tray = trayReduce(tray, {
        type: 'add',
        excerpt: mkExcerpt(`epubcfi(/6/4!/4/${String(i)})`),
      }).tray;
    }
    const overflow = trayReduce(tray, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/99)'),
    });
    expect(overflow.result).toBe('full');
    expect(overflow.tray?.excerpts.length).toBe(MAX_EXCERPTS);
  });
  it('add: auto-sorts by reading position', () => {
    const r1 = trayReduce(null, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/4)'),
    });
    const r2 = trayReduce(r1.tray, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/2)'),
    });
    expect(r2.tray?.excerpts.map((e) => e.id)).toEqual([
      'h:epubcfi(/6/4!/4/2)',
      'h:epubcfi(/6/4!/4/4)',
    ]);
  });
  it('remove: removing non-last keeps tray non-null', () => {
    const r1 = trayReduce(null, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/2)'),
    });
    const r2 = trayReduce(r1.tray, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/4)'),
    });
    const r3 = trayReduce(r2.tray, {
      type: 'remove',
      id: 'h:epubcfi(/6/4!/4/2)',
    });
    expect(r3.result).toBe('ok');
    expect(r3.tray?.excerpts.length).toBe(1);
  });
  it('remove: removing last collapses tray to null with cleared result', () => {
    const r1 = trayReduce(null, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/2)'),
    });
    const r2 = trayReduce(r1.tray, { type: 'remove', id: 'h:epubcfi(/6/4!/4/2)' });
    expect(r2.result).toBe('cleared');
    expect(r2.tray).toBeNull();
  });
  it('remove: missing id is a no-op (ok)', () => {
    const r1 = trayReduce(null, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/2)'),
    });
    const r2 = trayReduce(r1.tray, { type: 'remove', id: 'nope' });
    expect(r2.result).toBe('ok');
    expect(r2.tray?.excerpts.length).toBe(1);
  });
  it('clear: collapses to null', () => {
    const r1 = trayReduce(null, {
      type: 'add',
      excerpt: mkExcerpt('epubcfi(/6/4!/4/2)'),
    });
    const r2 = trayReduce(r1.tray, { type: 'clear' });
    expect(r2.result).toBe('cleared');
    expect(r2.tray).toBeNull();
  });
  it('clear on null tray is idempotent', () => {
    const r = trayReduce(null, { type: 'clear' });
    expect(r.result).toBe('cleared');
    expect(r.tray).toBeNull();
  });
});
