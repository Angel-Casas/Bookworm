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

// foliate-js's paginator leaks ResizeObservers after destroy: its inner View
// class observes iframe.contentDocument.body but only `unobserve()`s — never
// `disconnect()`s — and once the iframe is removed the observer fires render
// callbacks against a null document. We suppress those known-shape errors for
// a short window starting at destroy().
const FOLIATE_TEARDOWN_MARKERS = [
  "Cannot read properties of null (reading 'createTreeWalker')",
  'paginator',
];

function isFoliateTeardownError(reason: unknown): boolean {
  const message =
    reason instanceof Error
      ? `${reason.message} ${reason.stack ?? ''}`
      : typeof reason === 'string'
        ? reason
        : '';
  return FOLIATE_TEARDOWN_MARKERS.every((m) => message.toLowerCase().includes(m.toLowerCase()));
}

export class EpubReaderAdapter implements BookReader {
  private view: FoliateViewElement | null = null;
  private host: HTMLElement | null = null;
  private listeners = new Set<LocationChangeListener>();
  private destroyed = false;
  private currentCfi = '';

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

    const view = document.createElement('foliate-view');
    if (this.host) {
      this.host.appendChild(view);
    }
    this.view = view;

    view.addEventListener('relocate', (e) => {
      const cfi = e.detail.cfi;
      if (typeof cfi !== 'string' || cfi.length === 0) return;
      this.currentCfi = cfi;
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

    return { toc: this.extractToc(view.book?.toc ?? []) };
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();

    // Install a temporary error swallower for foliate-js's leaked
    // ResizeObserver callbacks (see FOLIATE_TEARDOWN_MARKERS above). The
    // observers fire on the next animation frames after we close the view.
    const onUnhandled = (e: PromiseRejectionEvent): void => {
      if (isFoliateTeardownError(e.reason)) e.preventDefault();
    };
    const onError = (e: ErrorEvent): void => {
      if (isFoliateTeardownError(e.error ?? e.message)) e.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    window.addEventListener('error', onError);

    try {
      this.view?.close();
    } catch (err) {
      console.warn('[reader] destroy: close threw', err);
    }
    try {
      this.view?.remove();
    } catch (err) {
      console.warn('[reader] destroy: remove threw', err);
    }
    this.view = null;

    // Two animation frames is enough for any pending ResizeObserver callbacks
    // to drain. Then we remove the swallowers so real future errors surface.
    window.setTimeout(() => {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('error', onError);
    }, 1000);
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
