import { describe, it, expect } from 'vitest';
import { PdfPageView } from './PdfPageView';

// PdfPageView's render path needs pdfjs.getDocument (which races with the
// async worker URL setup in happy-dom) and canvas 2D context (not implemented
// by happy-dom). Both are exercised by E2E in M4 against a real Chromium.
// These unit tests only cover what's safely testable without pdfjs/canvas.

describe('PdfPageView', () => {
  it('constructs without side effects', () => {
    const host = document.createElement('div');
    const fakePage = {
      // Cast through unknown; render() is never called in these tests.
      getViewport: () => ({ width: 100, height: 100 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
      getTextContent: () => Promise.resolve({ items: [] }),
    } as unknown as ConstructorParameters<typeof PdfPageView>[0]['page'];
    expect(() => new PdfPageView({ page: fakePage, scale: 1, host })).not.toThrow();
    expect(host.children.length).toBe(0);
  });

  it('destroy is idempotent on a never-rendered view', () => {
    const host = document.createElement('div');
    const fakePage = {
      getViewport: () => ({ width: 100, height: 100 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
      getTextContent: () => Promise.resolve({ items: [] }),
    } as unknown as ConstructorParameters<typeof PdfPageView>[0]['page'];
    const view = new PdfPageView({ page: fakePage, scale: 1, host });
    expect(() => {
      view.destroy();
      view.destroy();
    }).not.toThrow();
  });
});
