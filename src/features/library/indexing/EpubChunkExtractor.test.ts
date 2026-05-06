import { describe, it, expect } from 'vitest';
import { EpubChunkExtractor } from './EpubChunkExtractor';
import type { Book } from '@/domain';
import { BookId, IsoTimestamp } from '@/domain';

function fakePdfBook(): Book {
  return {
    id: BookId('b1'),
    title: 'X',
    format: 'pdf',
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

describe('EpubChunkExtractor (lifecycle)', () => {
  it('throws when listSections is called on a non-EPUB book', async () => {
    const extractor = new EpubChunkExtractor();
    await expect(extractor.listSections(fakePdfBook())).rejects.toThrow(/cannot list sections/);
  });

  it('throws when resolveBlob is not configured', async () => {
    const extractor = new EpubChunkExtractor();
    const epubBook: Book = { ...fakePdfBook(), format: 'epub' };
    await expect(extractor.listSections(epubBook)).rejects.toThrow(/no blob resolver/);
  });

  // Real-fixture extraction is exercised in E2E (Task 15) where Playwright runs
  // against real Chromium and foliate-js's vendor zip loader works correctly.
  // happy-dom can't reliably load the dynamic vendor/zip.js + WebWorker setup.
});
