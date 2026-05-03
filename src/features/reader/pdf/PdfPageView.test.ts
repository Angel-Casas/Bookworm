import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PdfPageView } from './PdfPageView';
import { pdfjs } from '@/features/library/import/parsers/pdf-pdfjs';

const FIXTURE = resolve(__dirname, '../../../../test-fixtures/multipage.pdf');

// happy-dom doesn't implement canvas 2D context, so the full render path
// (canvas pixels, text layer positioning) is exercised by E2E. These unit
// tests cover the lifecycle + structural pieces that don't need a real canvas.

describe('PdfPageView', () => {
  it('destroy is idempotent on a never-rendered view', async () => {
    const bytes = readFileSync(FIXTURE);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await doc.getPage(1);
    const host = document.createElement('div');

    const view = new PdfPageView({ page, scale: 1, host });
    expect(() => {
      view.destroy();
      view.destroy();
    }).not.toThrow();
    await doc.destroy();
  });

  it('appends a canvas element to the host before rendering pixels', async () => {
    const bytes = readFileSync(FIXTURE);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await doc.getPage(1);
    const host = document.createElement('div');
    document.body.appendChild(host);

    const view = new PdfPageView({ page, scale: 1, host });
    // happy-dom returns null from canvas.getContext('2d'), so render() throws
    // synchronously after appending the canvas. We catch and verify structure.
    await view.render().catch(() => {
      /* expected in happy-dom — canvas pixel rendering not supported */
    });
    expect(host.querySelector('canvas')).not.toBeNull();

    view.destroy();
    expect(host.children.length).toBe(0);

    await doc.destroy();
    host.remove();
  });
});
