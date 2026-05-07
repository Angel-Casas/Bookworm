import { describe, expect, it } from 'vitest';
import { resolveCurrentChapter } from './resolveCurrentChapter';
import { BookId, ChunkId, SectionId, type TextChunk, type TocEntry } from '@/domain';

function chunk(sectionPath: string, sectionTitle: string, idx = 0): TextChunk {
  return {
    id: ChunkId(`chunk-b1-${sectionPath}-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId('spine:' + sectionPath),
    sectionTitle,
    text: 'lorem',
    normalizedText: 'lorem',
    tokenEstimate: 10,
    locationAnchor: { kind: 'epub-cfi', cfi: '/' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

const tocEntry = (href: string, title: string): TocEntry => ({
  id: SectionId(href),
  title,
  anchor: { kind: 'epub-cfi', cfi: href },
  depth: 0,
});

describe('resolveCurrentChapter', () => {
  it('returns null when currentEntryId is undefined', () => {
    const result = resolveCurrentChapter(undefined, [], []);
    expect(result).toBeNull();
  });

  it('returns null when chunks list is empty', () => {
    const result = resolveCurrentChapter('OEBPS/foo.html', [], [tocEntry('OEBPS/foo.html', 'Ch 1')]);
    expect(result).toBeNull();
  });

  it('strips URI fragment before matching', () => {
    const chunks = [chunk('OEBPS/foo.html', 'Ch 1')];
    const toc = [tocEntry('OEBPS/foo.html', 'Ch 1')];
    const result = resolveCurrentChapter('OEBPS/foo.html#section-2', chunks, toc);
    expect(result).not.toBeNull();
    expect(result?.sectionId).toBe('spine:OEBPS/foo.html');
    expect(result?.sectionTitle).toBe('Ch 1');
    expect(result?.chunks).toHaveLength(1);
  });

  it('matches href without fragment', () => {
    const chunks = [chunk('OEBPS/foo.html', 'Ch 1', 0), chunk('OEBPS/foo.html', 'Ch 1', 1)];
    const toc = [tocEntry('OEBPS/foo.html', 'Ch 1')];
    const result = resolveCurrentChapter('OEBPS/foo.html', chunks, toc);
    expect(result?.chunks).toHaveLength(2);
  });

  it('returns null when href has no matching chunks', () => {
    const chunks = [chunk('OEBPS/foo.html', 'Ch 1')];
    const toc = [tocEntry('OEBPS/bar.html', 'Ch 2')];
    const result = resolveCurrentChapter('OEBPS/bar.html', chunks, toc);
    expect(result).toBeNull();
  });

  it('falls back to chunk.sectionTitle when TOC entry not found', () => {
    const chunks = [chunk('OEBPS/orphan.html', 'Orphan Section')];
    const result = resolveCurrentChapter('OEBPS/orphan.html', chunks, []);
    expect(result?.sectionTitle).toBe('Orphan Section');
  });

  it('multi-chapter spine: both TOC hrefs resolve to the same chunk set', () => {
    const chunks = [chunk('OEBPS/multi.html', 'Combined chapter file')];
    const toc = [
      tocEntry('OEBPS/multi.html#ch7', 'Chapter VII'),
      tocEntry('OEBPS/multi.html#ch8', 'Chapter VIII'),
    ];
    const r7 = resolveCurrentChapter('OEBPS/multi.html#ch7', chunks, toc);
    const r8 = resolveCurrentChapter('OEBPS/multi.html#ch8', chunks, toc);
    expect(r7?.chunks).toHaveLength(1);
    expect(r8?.chunks).toHaveLength(1);
    expect(r7?.sectionId).toBe(r8?.sectionId);
    expect(r7?.sectionTitle).toBe('Chapter VII');
    expect(r8?.sectionTitle).toBe('Chapter VIII');
  });
});
