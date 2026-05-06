import { describe, it, expect } from 'vitest';
import { PdfReaderAdapter } from './PdfReaderAdapter';
import { DEFAULT_READER_PREFERENCES } from '@/domain/reader';

// pdfjs-dist's worker setup fails in Vitest under happy-dom (the `?url`
// dynamic import doesn't resolve to a fetchable path; the fake-worker
// fallback also can't load pdf.worker.mjs). Open()-path tests that need
// real pdfjs are covered by E2E in Milestone 4 against a real Chromium
// where the production-built worker loads correctly.

describe('PdfReaderAdapter (lifecycle)', () => {
  it('destroy is idempotent on a never-opened adapter', () => {
    const adapter = new PdfReaderAdapter();
    expect(() => {
      adapter.destroy();
      adapter.destroy();
    }).not.toThrow();
  });

  it('throws on getCurrentAnchor before open', () => {
    const adapter = new PdfReaderAdapter();
    expect(() => adapter.getCurrentAnchor()).toThrow(/not opened/);
    adapter.destroy();
  });

  it('rejects goToAnchor before open', async () => {
    const adapter = new PdfReaderAdapter();
    await expect(adapter.goToAnchor({ kind: 'pdf', page: 1 })).rejects.toThrow(/not opened/);
    adapter.destroy();
  });

  it('rejects open on a non-PDF blob (synchronous error path)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    const garbage = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/pdf' });
    // The error message varies by pdfjs version (could be "Setting up fake
    // worker failed" or "InvalidPDFException"); we only assert that it rejects.
    await expect(
      adapter.open(garbage, { preferences: DEFAULT_READER_PREFERENCES }),
    ).rejects.toBeDefined();
    adapter.destroy();
    host.remove();
  });
});

describe('PdfReaderAdapter.getSectionTitleAt fallback', () => {
  it('returns "Page N" when there is no TOC', () => {
    const adapter = new PdfReaderAdapter();
    expect(adapter.getSectionTitleAt({ kind: 'pdf', page: 7 })).toBe('Page 7');
    expect(adapter.getSectionTitleAt({ kind: 'epub-cfi', cfi: 'x' })).toBeNull();
  });
});

describe('PdfReaderAdapter.getPassageContextAt', () => {
  it('returns {text: ""} for an EPUB anchor', async () => {
    const adapter = new PdfReaderAdapter();
    const result = await adapter.getPassageContextAt({
      kind: 'epub-cfi',
      cfi: 'epubcfi(/6/4)',
    });
    expect(result.text).toBe('');
    expect(result.windowBefore).toBeUndefined();
    adapter.destroy();
  });

  it('returns {text: ""} when not opened', async () => {
    const adapter = new PdfReaderAdapter();
    const result = await adapter.getPassageContextAt({
      kind: 'pdf',
      page: 1,
      rects: [{ x: 0, y: 0, width: 10, height: 10 }],
    });
    expect(result.text).toBe('');
    adapter.destroy();
  });

  // Real-fixture extraction is exercised in the E2E suite (see
  // chat-passage-mode-desktop.spec.ts in Phase 4.4 Task 16).
  // Pure indexing/windowing logic is covered by pdfPassageWindows.test.ts —
  // including the documented first-match-wins limitation when the selection
  // text appears multiple times on the page.
});
