import 'foliate-js/view.js'; // side-effect: registers <foliate-view>
import { Overlayer } from './foliate-overlayer';

import type { LocationAnchor, TocEntry } from '@/domain';
import { SectionId } from '@/domain';
import type {
  BookReader,
  LocationChangeListener,
  ReaderInitOptions,
  ReaderPreferences,
  SelectionInfo,
  SelectionListener,
  HighlightTapListener,
} from '@/domain/reader';
import type { HighlightId } from '@/domain';
import type { Highlight } from '@/domain/annotations/types';
import { COLOR_HEX } from '../highlightColors';

const highlightDrawer = Overlayer.highlight;

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
  private currentTocItemLabel: string | null = null;
  private currentTocEntries: readonly TocEntry[] = [];
  private trackedObservers = new Set<ResizeObserver>();
  private resizeObserverPatched = false;
  // Highlights (Phase 3.2).
  private highlightsById = new Map<string, Highlight>();
  private highlightCfiById = new Map<string, string>();
  private highlightIdByCfi = new Map<string, string>();
  private selectionListeners = new Set<SelectionListener>();
  private highlightTapListeners = new Set<HighlightTapListener>();
  private selectionDebounceTimer: number | undefined;

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
      // foliate-js's relocate detail surfaces the visible range and a
      // `tocItem` for the current chapter. Cache both for the bookmark
      // extractors. When the visible range is empty (e.g. the cursor is
      // parked on a whitespace boundary like a cover page), fall back to
      // the section's body text so bookmarks still get a useful snippet.
      const d = e.detail as {
        tocItem?: { label?: string };
        section?: { current?: number };
        range?: Range;
      };
      this.currentTocItemLabel = d.tocItem?.label ?? null;
      if (typeof d.section?.current === 'number') {
        this.currentSectionIndex = d.section.current;
      }
      const visibleText = (d.range?.toString() ?? '').replace(/\s+/g, ' ').trim();
      if (visibleText.length > 0) {
        this.currentSnippet = visibleText.slice(0, 80);
      } else {
        this.currentSnippet = this.extractSectionFallbackSnippet();
      }
      const anchor: LocationAnchor = { kind: 'epub-cfi', cfi };
      for (const fn of this.listeners) fn(anchor);
    });

    // Highlight render: foliate emits 'draw-annotation' when an annotation
    // becomes drawable in a loaded section. Pass the annotation's color to
    // the Overlayer.highlight static drawer.
    view.addEventListener('draw-annotation', (e: Event) => {
      const detail = (
        e as CustomEvent<{
          draw: (fn: unknown, opts?: unknown) => void;
          annotation: { value: string; color?: string };
        }>
      ).detail;
      const color = detail.annotation.color ?? COLOR_HEX.yellow;
      detail.draw(highlightDrawer, { color });
    });

    // Highlight tap: foliate emits 'show-annotation' when the user clicks an
    // existing annotation. Map CFI → id and notify subscribers.
    view.addEventListener('show-annotation', (e: Event) => {
      const detail = (e as CustomEvent<{ value: string; range?: Range }>).detail;
      const id = this.highlightIdByCfi.get(detail.value);
      if (!id) return;
      const r = detail.range?.getBoundingClientRect();
      const screenPos = r
        ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        : { x: 0, y: 0 };
      for (const fn of this.highlightTapListeners) fn(id as never, screenPos);
    });

    // Section overlay creation: per-section ready signal. Re-add highlights
    // for this section AND attach a selectionchange listener to its document.
    view.addEventListener('create-overlay', (e: Event) => {
      const detail = (e as CustomEvent<{ index: number }>).detail;
      this.onSectionCreated(detail.index, view);
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
    // Prefer the foliate-supplied tocItem label (resolved per-href, so it
    // works even when section-by-index would be wrong for sub-section TOCs).
    if (this.currentTocItemLabel) return this.currentTocItemLabel;
    if (this.currentSectionIndex < 0) return null;
    const topLevel = this.currentTocEntries.filter((e) => e.depth === 0);
    return topLevel[this.currentSectionIndex]?.title ?? null;
  }

  loadHighlights(highlights: readonly Highlight[]): void {
    if (!this.view) {
      // Cache for when the view becomes ready; foliate's create-overlay will
      // re-add per-section. We still want addAnnotation calls so the maps are
      // populated for tap-id resolution.
      for (const h of highlights) {
        if (h.anchor.kind !== 'epub-cfi') continue;
        this.highlightsById.set(h.id, h);
        this.highlightCfiById.set(h.id, h.anchor.cfi);
        this.highlightIdByCfi.set(h.anchor.cfi, h.id);
      }
      return;
    }
    for (const h of highlights) this.addHighlight(h);
  }

  addHighlight(highlight: Highlight): void {
    if (highlight.anchor.kind !== 'epub-cfi') return;
    // Upsert: if already present, remove first so color change re-renders.
    const existingCfi = this.highlightCfiById.get(highlight.id);
    if (existingCfi && this.view) {
      void this.view.deleteAnnotation({ value: existingCfi });
      this.highlightIdByCfi.delete(existingCfi);
    }
    this.highlightsById.set(highlight.id, highlight);
    this.highlightCfiById.set(highlight.id, highlight.anchor.cfi);
    this.highlightIdByCfi.set(highlight.anchor.cfi, highlight.id);
    if (this.view) {
      void this.view.addAnnotation({
        value: highlight.anchor.cfi,
        color: COLOR_HEX[highlight.color],
      });
    }
  }

  removeHighlight(id: HighlightId): void {
    const cfi = this.highlightCfiById.get(id);
    if (!cfi) return;
    if (this.view) void this.view.deleteAnnotation({ value: cfi });
    this.highlightsById.delete(id);
    this.highlightCfiById.delete(id);
    this.highlightIdByCfi.delete(cfi);
  }

  onSelectionChange(listener: SelectionListener): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  onHighlightTap(listener: HighlightTapListener): () => void {
    this.highlightTapListeners.add(listener);
    return () => {
      this.highlightTapListeners.delete(listener);
    };
  }

  private onSectionCreated(sectionIndex: number, view: FoliateViewElement): void {
    // 1. Re-add highlights for this section. addAnnotation no-ops for
    //    highlights whose section overlayer doesn't exist yet, so calling for
    //    all known highlights here is safe — only this section's will draw.
    for (const h of this.highlightsById.values()) {
      if (h.anchor.kind !== 'epub-cfi') continue;
      void view.addAnnotation({ value: h.anchor.cfi, color: COLOR_HEX[h.color] });
    }

    // 2. Attach selectionchange listener to this section's document.
    const renderer = view.renderer as
      | (HTMLElement & {
          getContents?: () => readonly { doc?: Document; index?: number }[];
        })
      | undefined;
    const contents = renderer?.getContents?.();
    const doc = contents?.find((c) => c.index === sectionIndex)?.doc;
    if (!doc) return;
    doc.addEventListener('selectionchange', () => {
      this.handleSelectionChange(view, sectionIndex, doc);
    });
  }

  private handleSelectionChange(
    view: FoliateViewElement,
    sectionIndex: number,
    doc: Document,
  ): void {
    if (this.selectionDebounceTimer !== undefined) {
      window.clearTimeout(this.selectionDebounceTimer);
    }
    this.selectionDebounceTimer = window.setTimeout(() => {
      this.selectionDebounceTimer = undefined;
      const sel = doc.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || sel.rangeCount === 0 || text.length === 0) {
        for (const fn of this.selectionListeners) fn(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const cfi = view.getCFI(sectionIndex, range);
      const r = range.getBoundingClientRect();
      // Translate iframe-relative coords to viewport. The iframe is the
      // ancestor of `doc` — use frameElement's bounding rect.
      const frame = doc.defaultView?.frameElement;
      const offset = frame?.getBoundingClientRect();
      const screenRect = {
        x: r.left + (offset?.left ?? 0),
        y: r.top + (offset?.top ?? 0),
        width: r.width,
        height: r.height,
      };
      const info: SelectionInfo = {
        anchor: { kind: 'epub-cfi', cfi },
        selectedText: text,
        screenRect,
      };
      for (const fn of this.selectionListeners) fn(info);
    }, 100);
  }

  // Pull text from the currently rendered section's body when the visible
  // range is collapsed/whitespace (e.g. cover page, chapter break).
  private extractSectionFallbackSnippet(): string | null {
    if (!this.view) return null;
    try {
      const renderer = this.view.renderer as
        | (HTMLElement & { getContents?: () => readonly { doc?: Document }[] })
        | undefined;
      const contents = renderer?.getContents?.();
      const doc = contents?.[0]?.doc;
      if (!doc) return null;
      const raw = doc.body.textContent;
      if (!raw) return null;
      const text = raw.replace(/\s+/g, ' ').trim();
      return text.length > 0 ? text.slice(0, 80) : null;
    } catch {
      return null;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.currentSnippet = null;
    this.currentSectionIndex = -1;
    this.currentTocItemLabel = null;
    this.currentTocEntries = [];
    this.highlightsById.clear();
    this.highlightCfiById.clear();
    this.highlightIdByCfi.clear();
    this.selectionListeners.clear();
    this.highlightTapListeners.clear();
    if (this.selectionDebounceTimer !== undefined) {
      window.clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = undefined;
    }

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
