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

  // Regression: the chunker's PARAGRAPH_TAGS lookup must match against the
  // canonical (uppercase) tag name regardless of how the document parser
  // reports `Element.tagName`. EPUB content documents are XHTML and tagName
  // is case-preserving for XHTML (typically lowercase in real EPUBs), while
  // jsdom's HTML parser uppercases. The chunker silently produced zero
  // chunks in real browsers before this fix because the set held only
  // uppercase entries.
  it('paragraph-tag matching is case-insensitive (XHTML lowercase tagName regression)', () => {
    const xhtml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<html xmlns="http://www.w3.org/1999/xhtml"><body>' +
      '<p>first paragraph</p>' +
      '<div>not a paragraph</div>' +
      '<h2>a heading</h2>' +
      '<li>list item</li>' +
      '<blockquote>a quote</blockquote>' +
      '</body></html>';
    const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
    const PARAGRAPH_TAGS = new Set([
      'P',
      'LI',
      'BLOCKQUOTE',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'PRE',
    ]);
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    let current: Node | null =
      walker.currentNode === doc.body ? walker.nextNode() : walker.currentNode;
    const matched: (string | null)[] = [];
    while (current !== null) {
      if (current instanceof Element && PARAGRAPH_TAGS.has(current.tagName.toUpperCase())) {
        matched.push(current.textContent);
      }
      current = walker.nextNode();
    }
    expect(matched).toEqual([
      'first paragraph',
      'a heading',
      'list item',
      'a quote',
    ]);
  });
});
