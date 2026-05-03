import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjs } from '@/features/library/import/parsers/pdf-pdfjs';
import type { LocationAnchor, TocEntry } from '@/domain';
import { SectionId } from '@/domain';
import type {
  BookReader,
  LocationChangeListener,
  ReaderInitOptions,
  ReaderMode,
  ReaderPreferences,
} from '@/domain/reader';
import { PdfPageView } from './PdfPageView';
import { PdfNavStrip } from './PdfNavStrip';

interface OutlineNode {
  readonly title: string;
  readonly dest: string | unknown[] | null;
  readonly items?: readonly OutlineNode[];
}

/* eslint-disable @typescript-eslint/no-unnecessary-condition --
   `this.destroyed` is mutated asynchronously by destroy() while async work
   (getPage, render) is in flight; the guards are intentional. */

const SCALE_BY_STEP: Readonly<Record<0 | 1 | 2 | 3 | 4, number>> = {
  0: 0.75,
  1: 0.9,
  2: 1.0,
  3: 1.25,
  4: 1.5,
};

export class PdfReaderAdapter implements BookReader {
  private pdfDoc: PDFDocumentProxy | null = null;
  private host: HTMLElement | null = null;
  private root: HTMLDivElement | null = null;
  private pagesContainer: HTMLDivElement | null = null;
  private navStrip: PdfNavStrip | null = null;
  private mountedPaginatedView: PdfPageView | null = null;
  private listeners = new Set<LocationChangeListener>();
  private destroyed = false;
  private currentPage = 1;
  private pageCount = 0;
  private currentMode: ReaderMode = 'paginated';
  private currentScale = 1;

  constructor(host?: HTMLElement) {
    if (host) this.host = host;
  }

  async open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }> {
    if (this.destroyed) throw new Error('PdfReaderAdapter: open() after destroy()');
    if (this.pdfDoc) throw new Error('PdfReaderAdapter: open() called twice');

    // StrictMode-safety: clear any stale pdf-reader root left by a previous mount.
    if (this.host) {
      for (const child of Array.from(this.host.children)) {
        if (child.classList.contains('pdf-reader')) child.remove();
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    this.pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;
    this.pageCount = this.pdfDoc.numPages;

    if (this.host) {
      const root = document.createElement('div');
      root.className = 'pdf-reader';
      this.host.appendChild(root);
      this.root = root;
    }

    if (options.initialAnchor?.kind === 'pdf') {
      this.currentPage = Math.max(1, Math.min(this.pageCount, options.initialAnchor.page));
    } else {
      this.currentPage = 1;
    }

    const toc = await this.extractToc();
    this.applyPreferences(options.preferences);
    return { toc };
  }

  goToAnchor(anchor: LocationAnchor): Promise<void> {
    if (!this.pdfDoc) return Promise.reject(new Error('PdfReaderAdapter: not opened'));
    if (anchor.kind !== 'pdf') {
      return Promise.reject(new Error(`PdfReaderAdapter: cannot navigate to ${anchor.kind}`));
    }
    const target = Math.max(1, Math.min(this.pageCount, anchor.page));
    this.currentPage = target;
    this.fireLocationChange();
    this.refreshNavStrip();
    if (this.currentMode === 'paginated') {
      return this.mountPaginatedPage(target);
    }
    return Promise.resolve();
  }

  getCurrentAnchor(): LocationAnchor {
    if (!this.pdfDoc) throw new Error('PdfReaderAdapter: not opened');
    return { kind: 'pdf', page: this.currentPage };
  }

  applyPreferences(prefs: ReaderPreferences): void {
    if (!this.pdfDoc || !this.root) return;
    const mode = prefs.modeByFormat.pdf;
    const scale = SCALE_BY_STEP[prefs.typography.fontSizeStep];
    const modeChanged = mode !== this.currentMode;
    this.currentMode = mode;
    this.currentScale = scale;
    this.applyTheme(prefs);
    if (modeChanged || !this.pagesContainer) {
      this.buildLayoutForMode();
    }
    if (mode === 'paginated') {
      void this.mountPaginatedPage(this.currentPage);
    }
    this.refreshNavStrip();
  }

  onLocationChange(listener: LocationChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    if (this.mountedPaginatedView) {
      this.mountedPaginatedView.destroy();
      this.mountedPaginatedView = null;
    }
    if (this.navStrip) {
      this.navStrip.destroy();
      this.navStrip = null;
    }
    this.pagesContainer = null;
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    if (this.pdfDoc) {
      void this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
  }

  // ----- internals -----

  private fireLocationChange(): void {
    const anchor: LocationAnchor = { kind: 'pdf', page: this.currentPage };
    for (const fn of this.listeners) fn(anchor);
  }

  private async extractToc(): Promise<TocEntry[]> {
    if (!this.pdfDoc) return [];
    let outline: unknown = null;
    try {
      outline = await this.pdfDoc.getOutline();
    } catch {
      // No outline; fall through to fallback
    }
    if (Array.isArray(outline) && outline.length > 0) {
      const entries: TocEntry[] = [];
      await this.walkOutline(outline as readonly OutlineNode[], 0, entries);
      if (entries.length > 0) return entries;
    }
    return this.generateFallbackToc();
  }

  private async walkOutline(
    items: readonly OutlineNode[],
    depth: number,
    out: TocEntry[],
  ): Promise<void> {
    if (!this.pdfDoc) return;
    for (const item of items) {
      let pageIndex: number | null = null;
      try {
        if (item.dest != null) {
          const dest =
            typeof item.dest === 'string'
              ? await this.pdfDoc.getDestination(item.dest)
              : item.dest;
          if (dest?.[0]) {
            pageIndex = await this.pdfDoc.getPageIndex(dest[0] as never);
          }
        }
      } catch {
        /* unresolvable destination — skip the page link but keep the entry */
      }
      const page = pageIndex !== null ? pageIndex + 1 : 1;
      out.push({
        id: SectionId(`pdf-toc-${String(out.length)}`),
        title: item.title || `Section ${String(out.length + 1)}`,
        depth,
        anchor: { kind: 'pdf', page },
      });
      if (item.items && item.items.length > 0) {
        await this.walkOutline(item.items, depth + 1, out);
      }
    }
  }

  private buildLayoutForMode(): void {
    if (!this.root) return;
    if (this.mountedPaginatedView) {
      this.mountedPaginatedView.destroy();
      this.mountedPaginatedView = null;
    }
    if (this.pagesContainer) {
      this.pagesContainer.remove();
      this.pagesContainer = null;
    }
    if (this.navStrip) {
      this.navStrip.destroy();
      this.navStrip = null;
    }

    const pages = document.createElement('div');
    pages.className = `pdf-reader__pages pdf-reader__pages--${this.currentMode}`;
    this.root.appendChild(pages);
    this.pagesContainer = pages;

    this.navStrip = new PdfNavStrip({
      host: this.root,
      mode: this.currentMode,
      pageCount: this.pageCount,
      currentPage: this.currentPage,
      onPrev: () => {
        if (this.currentPage > 1) {
          void this.goToAnchor({ kind: 'pdf', page: this.currentPage - 1 });
        }
      },
      onNext: () => {
        if (this.currentPage < this.pageCount) {
          void this.goToAnchor({ kind: 'pdf', page: this.currentPage + 1 });
        }
      },
    });
    this.navStrip.render();

    if (this.currentMode === 'scroll') {
      this.buildScrollPlaceholders();
    }
  }

  private async mountPaginatedPage(pageIndex1Based: number): Promise<void> {
    if (this.destroyed || !this.pdfDoc || !this.pagesContainer) return;
    if (this.mountedPaginatedView) {
      this.mountedPaginatedView.destroy();
      this.mountedPaginatedView = null;
    }
    const slot = document.createElement('div');
    slot.className = 'pdf-reader__page';
    slot.dataset.pageIndex = String(pageIndex1Based - 1);
    this.pagesContainer.appendChild(slot);
    const page = await this.pdfDoc.getPage(pageIndex1Based);
    if (this.destroyed) return;
    const view = new PdfPageView({ page, scale: this.currentScale, host: slot });
    this.mountedPaginatedView = view;
    await view.render();
  }

  private refreshNavStrip(): void {
    this.navStrip?.update({
      mode: this.currentMode,
      pageCount: this.pageCount,
      currentPage: this.currentPage,
    });
  }

  private applyTheme(prefs: ReaderPreferences): void {
    if (!this.root) return;
    this.root.dataset.theme = prefs.theme;
  }

  private buildScrollPlaceholders(): void {
    // Implemented in T8.
  }

  private generateFallbackToc(): TocEntry[] {
    if (this.pageCount <= 50) {
      return Array.from({ length: this.pageCount }, (_, i) => ({
        id: SectionId(`pdf-page-${String(i + 1)}`),
        title: `Page ${String(i + 1)}`,
        depth: 0,
        anchor: { kind: 'pdf' as const, page: i + 1 },
      }));
    }
    const stride = Math.ceil(this.pageCount / 30);
    const entries: TocEntry[] = [];
    for (let p = 1; p <= this.pageCount; p += stride) {
      entries.push({
        id: SectionId(`pdf-page-${String(p)}`),
        title: `Page ${String(p)}`,
        depth: 0,
        anchor: { kind: 'pdf', page: p },
      });
    }
    return entries;
  }
}
