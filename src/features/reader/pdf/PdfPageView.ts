import type { PageViewport, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import './pdf-page.css';
import './pdf-highlight-layer.css';

type Options = {
  readonly page: PDFPageProxy;
  readonly scale: number;
  readonly host: HTMLElement;
  readonly pageNumber: number;
  readonly onRendered?: (
    pageNumber: number,
    highlightLayer: HTMLDivElement,
    viewport: PageViewport,
  ) => void;
};

/* eslint-disable @typescript-eslint/no-unnecessary-condition --
   `this.destroyed` is mutated asynchronously by destroy() while render() is
   awaiting; the guards are intentional, not redundant. */
export class PdfPageView {
  private destroyed = false;
  private renderTask: RenderTask | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private textLayerEl: HTMLDivElement | null = null;
  private highlightLayerEl: HTMLDivElement | null = null;

  constructor(private readonly opts: Options) {}

  async render(): Promise<void> {
    if (this.destroyed) return;
    const { page, scale, host } = this.opts;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const viewport = page.getViewport({ scale: scale * dpr });

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-reader__canvas';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${String(Math.floor(viewport.width / dpr))}px`;
    canvas.style.height = `${String(Math.floor(viewport.height / dpr))}px`;
    // Append before getContext so destroy() teardown can find the canvas
    // even if getContext fails (e.g. happy-dom in unit tests).
    host.appendChild(canvas);
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('PdfPageView: 2d context unavailable');

    this.renderTask = page.render({ canvas, canvasContext: ctx, viewport });
    try {
      await this.renderTask.promise;
    } catch (err) {
      // Cancellation throws RenderingCancelledException — silently swallow
      // when destroyed; rethrow for real errors.
      if (this.destroyed) return;
      throw err;
    } finally {
      this.renderTask = null;
    }
    if (this.destroyed) return;

    const textLayerEl = document.createElement('div');
    textLayerEl.className = 'pdf-reader__text-layer';
    textLayerEl.style.width = `${String(Math.floor(viewport.width / dpr))}px`;
    textLayerEl.style.height = `${String(Math.floor(viewport.height / dpr))}px`;
    host.appendChild(textLayerEl);
    this.textLayerEl = textLayerEl;

    try {
      const textContent = await page.getTextContent();
      if (this.destroyed) return;
      const cssViewport = page.getViewport({ scale });
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerEl,
        viewport: cssViewport,
      });
      await textLayer.render();
    } catch (err) {
      if (this.destroyed) return;
      console.warn('[pdf] text layer render failed', err);
    }

    // Highlight layer (Phase 3.2): a sibling of the text-layer that the
    // adapter populates with absolutely-positioned colored divs.
    if (this.destroyed) return;
    const highlightLayerEl = document.createElement('div');
    highlightLayerEl.className = 'pdf-reader__highlight-layer';
    highlightLayerEl.style.width = `${String(Math.floor(viewport.width / dpr))}px`;
    highlightLayerEl.style.height = `${String(Math.floor(viewport.height / dpr))}px`;
    host.appendChild(highlightLayerEl);
    this.highlightLayerEl = highlightLayerEl;

    if (this.opts.onRendered) {
      const cssViewport = page.getViewport({ scale });
      this.opts.onRendered(this.opts.pageNumber, highlightLayerEl, cssViewport);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch {
        /* ignore */
      }
      this.renderTask = null;
    }
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.canvas.remove();
      this.canvas = null;
    }
    if (this.textLayerEl) {
      this.textLayerEl.remove();
      this.textLayerEl = null;
    }
    if (this.highlightLayerEl) {
      this.highlightLayerEl.remove();
      this.highlightLayerEl = null;
    }
  }
}
