import { describe, it, expect, vi } from 'vitest';
import { PdfChunkExtractor } from './PdfChunkExtractor';
import type { Book } from '@/domain';
import { BookId, IsoTimestamp } from '@/domain';

function fakeEpubBook(): Book {
  return {
    id: BookId('b1'),
    title: 'X',
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: 'p',
      originalName: 'p',
      byteSize: 0,
      mimeType: 'x',
      checksum: 'x',
    },
    importStatus: { kind: 'ready' },
    indexingStatus: { kind: 'pending' },
    aiProfileStatus: { kind: 'pending' },
    createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

describe('PdfChunkExtractor (lifecycle)', () => {
  it('throws when listSections is called on a non-PDF book', async () => {
    const extractor = new PdfChunkExtractor();
    await expect(extractor.listSections(fakeEpubBook())).rejects.toThrow(/cannot list sections/);
  });

  it('throws when resolveBlob is not configured', async () => {
    const extractor = new PdfChunkExtractor();
    const pdfBook: Book = { ...fakeEpubBook(), format: 'pdf' };
    await expect(extractor.listSections(pdfBook)).rejects.toThrow(/no blob resolver/);
  });

  it('returns a synthetic single section when outline is empty', async () => {
    const extractor = new PdfChunkExtractor();
    const stubPdfDoc = {
      numPages: 5,
      getOutline: vi.fn(() => Promise.resolve(null)),
      getPage: vi.fn(),
    } as never;
    const sections = await extractor.listSectionsFromPdfDoc(stubPdfDoc, 'My Book');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe('__whole_book__');
    expect(sections[0]!.title).toBe('My Book');
    expect(sections[0]!.range.kind).toBe('pdf');
  });

  it('returns one section per outline entry with derived page ranges', async () => {
    const extractor = new PdfChunkExtractor();
    let callIndex = 0;
    const stubPdfDoc = {
      numPages: 100,
      getOutline: () =>
        Promise.resolve([
          { title: 'Chapter 1', dest: ['a'] },
          { title: 'Chapter 2', dest: ['b'] },
          { title: 'Chapter 3', dest: ['c'] },
        ]),
      getPage: vi.fn(),
      getPageIndex: () => {
        // Return 0-based page for each call (Chapter 1 → page 1, etc.)
        const result = [0, 24, 49][callIndex] ?? 0;
        callIndex++;
        return Promise.resolve(result);
      },
    } as never;
    const sections = await extractor.listSectionsFromPdfDoc(stubPdfDoc, 'Book');
    expect(sections).toHaveLength(3);
    expect(sections[0]!.range).toEqual({ kind: 'pdf', startPage: 1, endPage: 24 });
    expect(sections[1]!.range).toEqual({ kind: 'pdf', startPage: 25, endPage: 49 });
    expect(sections[2]!.range).toEqual({ kind: 'pdf', startPage: 50, endPage: 100 });
  });

  // Real extraction is exercised in E2E (Task 15) — happy-dom can't reliably
  // load pdfjs-dist's worker, and getDocument() trips on the fake-worker path.
});
