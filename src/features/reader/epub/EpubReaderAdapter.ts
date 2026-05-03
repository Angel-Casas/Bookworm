import 'foliate-js/view.js'; // side-effect: registers <foliate-view>

import type { LocationAnchor, TocEntry } from '@/domain';
import { SectionId } from '@/domain';
import type {
  BookReader,
  LocationChangeListener,
  ReaderInitOptions,
  ReaderPreferences,
} from '@/domain/reader';

const FONT_SIZE_PX: Readonly<Record<0 | 1 | 2 | 3 | 4, number>> = {
  0: 14,
  1: 16,
  2: 18,
  3: 20,
  4: 24,
};

const LINE_HEIGHT: Readonly<Record<0 | 1 | 2, number>> = {
  0: 1.35,
  1: 1.55,
  2: 1.85,
};

const MARGIN_PX: Readonly<Record<0 | 1 | 2, number>> = {
  0: 16,
  1: 48,
  2: 96,
};

const FONT_FAMILY_CSS: Readonly<Record<string, string>> = {
  'system-serif': 'Georgia, "Iowan Old Style", "Source Serif Pro", serif',
  'system-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  georgia: 'Georgia, serif',
  iowan: '"Iowan Old Style", Georgia, serif',
  inter: 'Inter, system-ui, sans-serif',
};

const FALLBACK_FONT = 'Georgia, serif';

function buildReaderCss(prefs: ReaderPreferences): string {
  const t = prefs.typography;
  const fontFamily = FONT_FAMILY_CSS[t.fontFamily] ?? FALLBACK_FONT;
  return `
    html, body {
      font-family: ${fontFamily} !important;
      font-size: ${String(FONT_SIZE_PX[t.fontSizeStep])}px !important;
      line-height: ${String(LINE_HEIGHT[t.lineHeightStep])} !important;
    }
    body {
      padding: 0 ${String(MARGIN_PX[t.marginStep])}px !important;
    }
  `.trim();
}

// foliate-js's Paginator + inner View classes both create ResizeObservers
// without ever calling .disconnect() on destroy — only .unobserve(target),
// which leaves callbacks queued. Once the iframe is removed those callbacks
// fire against a null contentDocument and throw `TypeError: Cannot read
// properties of null (reading 'createTreeWalker')` infinitely.
//
// We can't fix foliate-js, but we CAN intercept all ResizeObserver creations
// during the adapter's lifetime and force-disconnect them at destroy(). This
// is bounded: the patch is installed only between open() and destroy(), and
// only for this adapter instance.

const OriginalResizeObserver = typeof window !== 'undefined' ? window.ResizeObserver : undefined;

export class EpubReaderAdapter implements BookReader {
  private view: FoliateViewElement | null = null;
  private host: HTMLElement | null = null;
  private listeners = new Set<LocationChangeListener>();
  private destroyed = false;
  private currentCfi = '';
  private currentSnippet: string | null = null;
  private currentSectionIndex = -1;
  private currentTocEntries: readonly TocEntry[] = [];
  private trackedObservers = new Set<ResizeObserver>();
  private resizeObserverPatched = false;

  constructor(host?: HTMLElement) {
    if (host) this.host = host;
  }

  async open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }> {
    if (this.destroyed) throw new Error('EpubReaderAdapter: open() after destroy()');
    if (this.view) throw new Error('EpubReaderAdapter: open() called twice');

    // StrictMode-safety: a previous adapter mounted to the same host (and torn
    // down by React's effect-cleanup double-invoke) may have left a stale
    // <foliate-view> behind. Drop any leftovers before mounting our own.
    if (this.host) {
      for (const child of Array.from(this.host.children)) {
        if (child.tagName.toLowerCase() === 'foliate-view') child.remove();
      }
    }

    this.installResizeObserverPatch();

    const view = document.createElement('foliate-view');
    if (this.host) {
      this.host.appendChild(view);
    }
    this.view = view;

    view.addEventListener('relocate', (e) => {
      const cfi = e.detail.cfi;
      if (typeof cfi !== 'string' || cfi.length === 0) return;
      this.currentCfi = cfi;
      // Cache snippet + section index for getSnippetAt / getSectionTitleAt.
      const detail = e.detail as { range?: Range; index?: number };
      if (typeof detail.index === 'number') this.currentSectionIndex = detail.index;
      if (detail.range && typeof detail.range.toString === 'function') {
        const text = detail.range.toString().replace(/\s+/g, ' ').trim();
        this.currentSnippet = text.length > 0 ? text.slice(0, 80) : null;
      } else {
        this.currentSnippet = null;
      }
      const anchor: LocationAnchor = { kind: 'epub-cfi', cfi };
      for (const fn of this.listeners) fn(anchor);
    });

    await view.open(file);

    // init() positions the view at the saved location, or text start.
    const initOpts: { lastLocation?: string; showTextStart?: boolean } = {};
    if (options.initialAnchor?.kind === 'epub-cfi') {
      initOpts.lastLocation = options.initialAnchor.cfi;
    } else {
      initOpts.showTextStart = true;
    }
    try {
      await view.init(initOpts);
    } catch (err) {
      // Saved location may not resolve (book changed externally, malformed CFI).
      // Fall back to first section.
      console.warn('[reader] view.init failed; falling back to text start', err);
      try {
        await view.init({ showTextStart: true });
      } catch (fallbackErr) {
        console.warn('[reader] fallback init also failed', fallbackErr);
      }
    }

    // Apply preferences after init so renderer.setStyles has a renderer to act on.
    this.applyPreferences(options.preferences);

    const toc = this.extractToc(view.book?.toc ?? []);
    this.currentTocEntries = toc;
    return { toc };
  }

  goToAnchor(anchor: LocationAnchor): Promise<void> {
    if (!this.view) return Promise.reject(new Error('EpubReaderAdapter: not opened'));
    if (anchor.kind !== 'epub-cfi') {
      return Promise.reject(new Error(`EpubReaderAdapter: cannot navigate to ${anchor.kind}`));
    }
    return this.view.goTo(anchor.cfi);
  }

  getCurrentAnchor(): LocationAnchor {
    if (!this.view) throw new Error('EpubReaderAdapter: not opened');
    const cfi = this.view.lastLocation?.cfi ?? this.currentCfi;
    return { kind: 'epub-cfi', cfi };
  }

  applyPreferences(prefs: ReaderPreferences): void {
    if (!this.view) return;
    const renderer = this.view.renderer;
    if (renderer) {
      renderer.setStyles?.(buildReaderCss(prefs));
      renderer.setAttribute(
        'flow',
        prefs.modeByFormat.epub === 'paginated' ? 'paginated' : 'scrolled',
      );
    }
    // App-level data-theme + data-reader-theme are owned by ReaderView; the
    // adapter only writes inside its own renderer.
  }

  onLocationChange(listener: LocationChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnippetAt(anchor: LocationAnchor): Promise<string | null> {
    if (anchor.kind !== 'epub-cfi') return Promise.resolve(null);
    if (anchor.cfi === this.currentCfi) return Promise.resolve(this.currentSnippet);
    // Non-current anchors: best-effort — we don't navigate to extract text.
    return Promise.resolve(null);
  }

  getSectionTitleAt(anchor: LocationAnchor): string | null {
    if (anchor.kind !== 'epub-cfi') return null;
    if (this.currentSectionIndex < 0) return null;
    // Walk top-level TOC entries by index. This matches typical EPUB structure
    // where each section maps to a chapter; books with sub-section TOCs may be
    // less precise but still resolve to the chapter the section lives under.
    const topLevel = this.currentTocEntries.filter((e) => e.depth === 0);
    return topLevel[this.currentSectionIndex]?.title ?? null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.currentSnippet = null;
    this.currentSectionIndex = -1;
    this.currentTocEntries = [];

    // Disconnect tracked observers BEFORE foliate-js teardown. foliate-js's
    // own destroy chain mutates layout (removing the iframe from the shadow
    // root), which fires the ResizeObserver callbacks synchronously before
    // foliate-js's internal `#view = null` guard kicks in. Disconnecting
    // first prevents the callbacks from firing at all.
    for (const obs of this.trackedObservers) {
      try {
        obs.disconnect();
      } catch {
        /* observer may already be GC'd; safe to ignore */
      }
    }
    this.trackedObservers.clear();
    this.uninstallResizeObserverPatch();

    try {
      this.view?.close();
    } catch (err) {
      console.warn('[reader] destroy: view.close threw', err);
    }
    try {
      this.view?.remove();
    } catch (err) {
      console.warn('[reader] destroy: view.remove threw', err);
    }
    this.view = null;
  }

  // ----- ResizeObserver tracking patch -----

  private installResizeObserverPatch(): void {
    if (this.resizeObserverPatched) return;
    if (!OriginalResizeObserver) return;
    this.resizeObserverPatched = true;
    const tracked = this.trackedObservers;
    class TrackedResizeObserver extends OriginalResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        tracked.add(this);
      }
    }
    window.ResizeObserver = TrackedResizeObserver;
  }

  private uninstallResizeObserverPatch(): void {
    if (!this.resizeObserverPatched) return;
    this.resizeObserverPatched = false;
    if (OriginalResizeObserver) {
      window.ResizeObserver = OriginalResizeObserver;
    }
  }

  // ----- internals -----

  private extractToc(raw: readonly FoliateBookTocItem[]): TocEntry[] {
    const out: TocEntry[] = [];
    this.walkToc(raw, 0, out);
    return out;
  }

  private walkToc(items: readonly FoliateBookTocItem[], depth: number, out: TocEntry[]): void {
    for (const item of items) {
      const href = item.href;
      out.push({
        id: SectionId(href || `toc-${String(out.length)}`),
        title: item.label,
        depth,
        anchor: { kind: 'epub-cfi', cfi: href },
      });
      if (item.subitems && item.subitems.length > 0) {
        this.walkToc(item.subitems, depth + 1, out);
      }
    }
  }
}
