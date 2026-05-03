# Phase 2.2 — PDF Reader Adapter (Design)

**Date:** 2026-05-03
**Phase:** 2 — Reading core, Task 2.2
**Branch:** `phase-2-2-pdf-reader-adapter`
**Status:** approved (pending implementation plan)

---

## 1. Purpose

Add a PDF reading experience by implementing a `PdfReaderAdapter` that satisfies the same `BookReader` contract as the EPUB adapter shipped in Phase 2.1. The reader shell, machine, repositories, and persistence layer are already in place; this work is the engine integration plus a small set of format-aware UI tweaks.

## 2. Scope

In scope (Task 2.2 acceptance criteria from `docs/04-implementation-roadmap.md`):

- Render PDF pages from a local file
- Page-to-page navigation (paginated and continuous-scroll modes)
- Text selection inside the rendered page
- Restore last reading location after reload

Explicitly out of scope:

- Reader workspace layout redesign (Task 2.3)
- PDF inline search (Phase 5 with retrieval)
- Page thumbnails sidebar
- Touch swipe / edge-tap pagination affordances (buttons + keyboard cover v1)
- Per-PDF "disable dark mode" toggle (deferred to Phase 6 polish)

## 3. Decisions locked in (from brainstorm)

| # | Decision | Choice | Reason |
|---|---|---|---|
| Q1 | v1 PDF reader scope | **Reading-essentials** — text selection layer + generated TOC fallback | Selection is an expected reading affordance and Phase 3's hard prerequisite for highlights; TOC fallback prevents the "useless empty panel" UX on outline-less PDFs (academic papers etc.) |
| Q2 | PDF preferences shape | **Same storage shape, format-aware `TypographyPanel`** | Minimal storage delta; clean UX (no inert controls); `modeByFormat` extends to include `pdf` |
| Q3 | PDF navigation UI | **Adapter-rendered floating nav strip** | Mobile-friendly; visible affordance; chrome stays format-agnostic for 2.3 to redesign once |

## 4. Architecture

### 4.1 Module layout

```
src/
├─ domain/reader/
│   └─ types.ts                       # MODIFIED: ReaderPreferences.modeByFormat extends with `pdf`
├─ features/reader/
│   ├─ pdf/
│   │   ├─ PdfReaderAdapter.ts        # NEW: wraps pdfjs-dist, implements BookReader (sole pdfjs renderer)
│   │   ├─ PdfReaderAdapter.test.ts
│   │   ├─ PdfPageView.ts             # NEW: internal helper — mounts canvas + text layer for one page
│   │   ├─ PdfNavStrip.ts             # NEW: tiny DOM-only widget rendered into adapter's host
│   │   ├─ pdf-page.css               # NEW: page + text-layer styling
│   │   └─ pdf-notes.md               # NEW: pdfjs-dist API mapping (mirrors foliate-notes.md)
│   ├─ epub/                          # unchanged from 2.1
│   ├─ TypographyPanel.tsx            # MODIFIED: bookFormat prop; hides irrelevant controls
│   ├─ TypographyPanel.test.tsx       # MODIFIED: new tests for format-aware behavior
│   └─ ReaderView.tsx                 # MODIFIED: bookFormat prop; passes it down
└─ app/
    └─ App.tsx                        # MODIFIED: createAdapter switches on book.format
```

### 4.2 Boundary intent

- **`PdfReaderAdapter`** is the only file that imports `pdfjs-dist` for rendering. The Phase 1 import-pipeline parser (`features/library/import/parsers/pdf.ts`) also imports it for metadata extraction; these are separate, format-isolated consumers.
- **`PdfPageView`** is a small internal helper inside the PDF adapter — handles canvas + text-layer for one page. Not a public component. Created/destroyed by the adapter as the user navigates.
- **`PdfNavStrip`** is a DOM-only widget the adapter renders into its host (no React). Fires callbacks on Next/Prev. Lives only inside the adapter's mount node.
- **`ReaderView`** changes are minimal: gets `bookFormat` prop, passes it to `TypographyPanel` and to `createAdapter`.
- **`App.tsx`** `createAdapter` callback now switches on `book.format` — about a five-line change.

### 4.3 Type delta

```ts
// src/domain/reader/types.ts
export type ReaderPreferences = {
  readonly typography: ReaderTypography;
  readonly theme: ReaderTheme;
  readonly modeByFormat: { readonly epub: ReaderMode; readonly pdf: ReaderMode };  // ← +pdf
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  typography: { ... },
  theme: 'light',
  modeByFormat: { epub: 'paginated', pdf: 'paginated' },                            // ← +pdf default
};
```

### 4.4 Migration (forward-compatible, no schema bump)

`readerPreferencesRepo` validator currently rejects records that don't match the strict shape. After Phase 2.2 deploys, stored records from 2.1 are missing `modeByFormat.pdf`.

**Approach:** soften the validator to fill missing optional/extended fields with defaults. If `modeByFormat.pdf` is missing, synthesize `'paginated'`. If `modeByFormat.epub` is present, keep it. Existing user theme/font preferences survive the upgrade.

No IndexedDB schema bump (no new stores or indexes; only the value shape grew with an optional-on-load field).

### 4.5 Mode semantics for PDF

| Mode | Behavior |
|---|---|
| `paginated` | Only the current page is in the DOM. NavStrip Next/Prev buttons + keyboard arrows / space / page-up/down advance. |
| `scroll` | All page slots exist as empty placeholders sized to each page's viewport (preserves correct scrollbar). `IntersectionObserver` renders pages entering visibility (visible + 1 above + 1 below) and clears canvases of pages leaving (max 5 concurrent rendered = bounded memory). NavStrip just shows the current page indicator. |

### 4.6 Theme behavior for PDF

| Theme | Behavior |
|---|---|
| `light` | No filter — PDFs render at their native colors. |
| `sepia` | No filter — pure invert distorts sepia tone; PDFs stay native. |
| `dark` | `filter: invert(1) hue-rotate(180deg)` applied to `.pdf-reader__pages` only. Standard PDF-reader trick — works for text PDFs, distorts photos. Documented caveat. |

## 5. PdfReaderAdapter implementation

### 5.1 Adapter's mount-node DOM structure

```
<div class="pdf-reader">
  <div class="pdf-reader__pages">
    <div class="pdf-reader__page" data-page-index="N">
      <canvas/>                              ← rendered page
      <div class="pdf-reader__text-layer"/>  ← invisible text overlay for selection
    </div>
    <!-- in scroll mode: one .pdf-reader__page per page (placeholders for non-rendered) -->
    <!-- in paginated mode: only the current page exists -->
  </div>
  <div class="pdf-reader__nav-strip">         ← PdfNavStrip
    ← Prev | Page 3 of 42 | Next →
  </div>
</div>
```

### 5.2 Page rendering pipeline (per page)

1. `pdfDoc.getPage(n)` → `PDFPageProxy`
2. `page.getViewport({ scale: zoomStep × devicePixelRatio })` for retina sharpness
3. Render to canvas: `page.render({ canvasContext, viewport })` returns a `RenderTask` with `.cancel()`
4. Render text layer: `page.getTextContent()` → text divs positioned via inline styles to overlay the canvas pixel-for-pixel (PDF.js's standard text-layer trick — gives native browser selection)

### 5.3 Position tracking → `onLocationChange`

- **Paginated**: current page = the one currently mounted; fires on page change.
- **Scroll**: `IntersectionObserver` tracks each placeholder's intersection ratio; "current page" = the one with the largest visible area; fires when current changes.

In both modes:

- `getCurrentAnchor()` returns `{ kind: 'pdf', page: currentPage }` (1-indexed).
- `goToAnchor({ kind: 'pdf', page: N })` mounts page N (paginated) or `scrollIntoView`s placeholder N (scroll).

### 5.4 TOC extraction + fallback

```
1. pdfDoc.getOutline() → outline tree if present
2. If outline non-empty: walk tree → TocEntry[] with depth from nesting.
   For each item, resolve dest → page index via pdfDoc.getPageIndex(...).
3. If outline empty/missing:
   - If pageCount ≤ 50: per-page entries ("Page 1, Page 2, ..., Page N")
   - If pageCount > 50: stride = ceil(pageCount / 30); entries at p1, p1+stride, ..., capped at ~30
```

Both fallback paths produce regular `TocEntry` objects; `TocPanel` doesn't need any change to its API or rendering.

### 5.5 Theme + zoom application

| Pref | Mapping |
|---|---|
| `fontSizeStep: 0..4` | Zoom levels `[0.75, 0.9, 1.0, 1.25, 1.5]` × `devicePixelRatio`. Re-renders all currently-mounted pages on change. |
| `theme` | See 4.6 above. |
| `modeByFormat.pdf` | Switches between paginated single-page mount and scroll-all-placeholders layout. Position is preserved across mode switch. |

Other typography fields (`fontFamily`, `lineHeightStep`, `marginStep`) are silently ignored in the adapter — `TypographyPanel` already hides them when `bookFormat === 'pdf'`.

### 5.6 Memory management

- `canvas.width = 0` releases GPU memory when a page goes out of the render window.
- `pdfDoc.destroy()` in adapter `destroy()` frees the pdf.js worker resources for this document.
- `IntersectionObserver` disconnected on destroy.
- `RenderTask.cancel()` called on any in-flight render before clearing its canvas (prevents post-destroy callbacks from writing to a destroyed context).

### 5.7 BookReader method mapping

```
open(file, opts)
  - pdfjsLib.getDocument({ data: ArrayBuffer }).promise → PDFDocumentProxy
  - extract TOC (with fallback)
  - mount root DOM into host
  - applyPreferences(opts.preferences) — sets initial layout for mode/zoom/theme
  - if opts.initialAnchor.kind === 'pdf': goToAnchor → mount or scrollIntoView page N
  - return { toc }

goToAnchor({ kind: 'pdf', page })
  - paginated: render that page (destroying old one)
  - scroll: scrollIntoView the placeholder

getCurrentAnchor() → { kind: 'pdf', page: currentPage }

applyPreferences(prefs)
  - zoom = mapping fontSizeStep → scale
  - theme: toggle CSS class on root
  - mode: switch between paginated single-page mount and scroll-all-placeholders layout
  - re-render visible pages on zoom change

onLocationChange(listener) → unsubscribe

destroy()
  - cancel any in-flight RenderTasks
  - disconnect IntersectionObserver
  - clear all canvases (canvas.width = 0)
  - pdfDoc.destroy()
  - remove root DOM
```

## 6. Components glue

### 6.1 App.tsx — `createAdapter` becomes format-aware

```ts
const createAdapter = useCallback(
  (mountInto: HTMLElement, format: BookFormat): BookReader => {
    if (format === 'pdf') return new PdfReaderAdapter(mountInto);
    return new EpubReaderAdapter(mountInto);
  },
  [],
);
```

App.tsx already has `book` in scope when rendering ReaderView; passes `book.format` as `bookFormat` prop.

### 6.2 ReaderView — minimal additions

1. New prop `bookFormat: BookFormat`. App.tsx provides it from `book.format`.
2. Pass `bookFormat` to `TypographyPanel`.
3. The `createAdapter` prop signature gains a `format` parameter; `ReaderView` passes its `bookFormat` through:

```ts
const machine = useMemo(
  () => makeReaderMachine({
    loadBookForReader,
    createAdapter: () => createAdapter(mountRef.current!, bookFormat),
  }),
  [loadBookForReader, createAdapter, bookFormat],
);
```

No changes to `ReaderChrome`, `TocPanel`, or the reader machine.

### 6.3 TypographyPanel — format-aware

New `bookFormat: BookFormat` prop. Renders:

| Control | EPUB | PDF |
|---|---|---|
| Font family | shown | hidden |
| Font size / Zoom | shown (label "Size") | shown (label "Zoom") |
| Line height | shown | hidden |
| Margins | shown | hidden |
| Theme | shown | shown |
| Reading mode | shown | shown |

Mode-radio's `value` writes to the right format slot:

```ts
onChange({
  ...preferences,
  modeByFormat: { ...preferences.modeByFormat, [bookFormat]: mode },
});
```

## 7. End-to-end data flow (PDF book)

```
1. User clicks PDF book on bookshelf
       ↓
   App.tsx: setView({ kind: 'reader', bookId })
       ↓
2. ReaderView mounts (key={bookId})
       ↓
   readerMachine: idle → loadingBlob
       ↓
   booksRepo.getById(bookId) → opfs.readFile(book.source.opfsPath)
   readerPreferencesRepo.get()       ← migrated record loads cleanly
   readingProgressRepo.get(bookId)   ← may be {kind:'pdf', page: N}
       ↓
   readerMachine: loadingBlob → opening
       ↓
   adapter = createAdapter(mountNode, 'pdf') = new PdfReaderAdapter(mountNode)
   adapter.open(blob, { preferences, initialAnchor })
       ↓
   PdfReaderAdapter:
     - pdfjsLib.getDocument(arrayBuffer).promise → pdfDoc
     - getOutline() → toc (or fallback)
     - mount root DOM (.pdf-reader skeleton + nav strip)
     - applyPreferences(preferences) — sets initial mode/zoom/theme
     - if initialAnchor.kind === 'pdf': goToAnchor → mount page N
     - return { toc }
       ↓
   readerMachine: opening → ready
       ↓
3. User scrolls / clicks Next → adapter fires onLocationChange
   ReaderView debounces (500ms) → readingProgressRepo.put(bookId, { kind: 'pdf', page })
       ↓
4. User opens TypographyPanel, changes zoom or theme
   ReaderView: adapter.applyPreferences(newPrefs); readerPreferencesRepo.put(newPrefs)
       ↓
5. User clicks Back → ReaderView unmounts → adapter.destroy()
   PdfReaderAdapter.destroy():
     - cancel in-flight RenderTasks
     - disconnect IntersectionObserver
     - clear all canvases (release GPU)
     - pdfDoc.destroy() (release pdf.js worker resources)
     - remove root DOM
```

### 7.1 Three implementation choices baked in

1. **`PdfReaderAdapter` mirrors the same factory-style construction as `EpubReaderAdapter`** — constructor takes the host element. Same `destroy() → cancel renders → close → unmount` sequencing principle (lesson from Phase 2.1's debugging round).
2. **No `ResizeObserver` tracking patch needed** — `pdfjs-dist` doesn't leak observers; `pdfDoc.destroy()` is a clean public API.
3. **Belt-and-suspenders post-destroy guards** — every async render-resolved callback checks `if (this.destroyed) return` before touching DOM.

## 8. Error handling & edge cases

| Case | Handling |
|---|---|
| Book blob missing from OPFS | `readerMachine` transitions to `error` with `{ kind: 'blob-missing' }`; UI shows "back to library" (already wired in 2.1) |
| Corrupted PDF / pdfjs throws on load | Adapter wraps as `{ kind: 'parse-failed' }`; book record is **not** modified; user can back out |
| Saved page anchor exceeds current page count (e.g. PDF replaced externally) | Adapter clamps page to `[1, pageCount]`; logs warning |
| User toggles mode mid-read | Position preserved; in-flight renders cancelled; layout swap |
| User cranks zoom rapidly | Render debounce (50ms) coalesces requests; previous render task cancelled |
| User switches book while previous PDF is still rendering | `key={bookId}` on ReaderView remounts; previous adapter destroyed; cancelled renders bail via destroyed guard |

## 9. Testing strategy

### 9.1 Unit (Vitest)

| File under test | What it verifies |
|---|---|
| `readerPreferences.ts` (modified) | Existing tests still pass; new test: a 2.1-shape record (no `modeByFormat.pdf`) loads cleanly with synthesized default; corrupted record still self-heals to default |
| `domain/reader/types.ts` | Updated default has `modeByFormat: { epub: 'paginated', pdf: 'paginated' }` |
| `TypographyPanel.test.tsx` (modified) | New: `bookFormat='pdf'` hides fontFamily / lineHeight / margins; mode change writes to correct format slot; `bookFormat='epub'` is unchanged |

### 9.2 Integration (Vitest + happy-dom)

| File under test | What it verifies |
|---|---|
| `PdfReaderAdapter.test.ts` | Lifecycle: `destroy()` idempotent; `getCurrentAnchor()` before `open()` throws; `goToAnchor` before `open()` rejects; `open()` on garbage rejects. Plus: against `text-friendly.pdf`, `open()` resolves with a non-empty toc (or fallback); `pdfDoc.destroy()` is called on adapter destroy. Render-dependent assertions skipped — same rationale as EPUB adapter (happy-dom can't drive canvas rendering reliably) |

### 9.3 E2E (Playwright)

We'll add a small multi-page PDF fixture via a new script `scripts/fixtures/build-multipage-pdf.ts` (mirrors the existing `build-text-pdf.ts` pattern) producing a 5-page `test-fixtures/multipage.pdf`. Keeping it as its own script — different artifact, different purpose.

| Spec | Scenario |
|---|---|
| `e2e/reader-pdf-open.spec.ts` | Import PDF → click cover → reader opens → TOC has entries (fallback) → click TOC entry → page changes |
| `e2e/reader-pdf-restore.spec.ts` | Open PDF → navigate to page 3 → reload → land back at page 3 |
| `e2e/reader-pdf-mode.spec.ts` | Toggle scroll/paginated → both render → mode persists across reload |
| `e2e/reader-pdf-zoom.spec.ts` | Increase zoom → canvas re-renders larger → persists across reload |

### 9.4 Acceptance criteria → coverage map

| Acceptance criterion | Covered by |
|---|---|
| Open PDF | `PdfReaderAdapter.test.ts` + `e2e/reader-pdf-open.spec.ts` |
| Navigate page-to-page | `e2e/reader-pdf-open.spec.ts` (TOC click) + `e2e/reader-pdf-mode.spec.ts` (Next/Prev) |
| Select text | Manual smoke (text-layer Playwright assertions are flaky; documented as a follow-up) |
| Restore last location | `e2e/reader-pdf-restore.spec.ts` |

## 10. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `pdfjs-dist`'s text-layer API has changed across versions; pinning at `5.7.284` may not match upstream docs | Med | Wrap text-layer setup behind a small helper inside `PdfReaderAdapter`. If it breaks on upgrade, that's the only file to fix. Adapter test asserts text-layer divs exist after open. |
| Dark theme via CSS invert mangles photos in image-heavy PDFs | Accepted | Documented in `pdf-notes.md` as a known limitation; matches every other PDF reader. Phase 6 polish can revisit (e.g., per-PDF "disable dark" toggle). |
| Long scroll-mode PDFs (1000+ pages) over-allocate placeholder DOM | Low | Even 1000 empty placeholder divs are cheap (~1MB DOM). Real memory cost is rendered canvases, capped at 5 by the IntersectionObserver render window. |
| pdfjs-dist worker URL not bundled correctly under PWA service worker | Med | Phase 1 already proved the dev-time setup works; for prod, `pnpm build` includes pdf.worker.mjs in the bundle. E2E specs run against `pnpm preview` (production build) → catches breakage. |
| `IntersectionObserver` thrash on rapid scroll triggers excessive render starts/cancels | Med | Debounce render starts (50ms); always check `if (this.destroyed) return` in async render task callbacks; cancel in-flight render tasks on debounce. |
| App.tsx grew to ~280 lines in 2.1; this PR adds another ~10 | Low | Still under the 300-line hard threshold. 2.3 is the right time for the extraction. Documented. |
| Render task cancellation on destroy isn't 100% reliable in pdfjs (rendering may briefly continue after `cancel()`) | Med | Belt-and-suspenders: `if (this.destroyed) return` guards in render-resolved callbacks; `pdfDoc.destroy()` runs after canvases cleared. |

## 11. Files

### 11.1 New (~12 files)

```
src/features/reader/pdf/PdfReaderAdapter.ts
src/features/reader/pdf/PdfReaderAdapter.test.ts
src/features/reader/pdf/PdfPageView.ts
src/features/reader/pdf/PdfNavStrip.ts
src/features/reader/pdf/pdf-notes.md
src/features/reader/pdf-page.css
test-fixtures/multipage.pdf
scripts/fixtures/build-multipage-pdf.ts
e2e/reader-pdf-open.spec.ts
e2e/reader-pdf-restore.spec.ts
e2e/reader-pdf-mode.spec.ts
e2e/reader-pdf-zoom.spec.ts
```

### 11.2 Modified

```
src/domain/reader/types.ts                          — extend modeByFormat with pdf; default = 'paginated'
src/storage/repositories/readerPreferences.ts       — soften validator for forward-compat
src/storage/repositories/readerPreferences.test.ts  — new test for v2.1 record loads cleanly
src/features/reader/TypographyPanel.tsx             — bookFormat prop; format-aware controls
src/features/reader/TypographyPanel.test.tsx        — new tests for format-aware behavior
src/features/reader/ReaderView.tsx                  — bookFormat prop; passes it through
src/app/App.tsx                                     — createAdapter switches on book.format
docs/02-system-architecture.md                      — Decision history entry for 2.2
docs/04-implementation-roadmap.md                   — mark Phase 2.2 complete
```

## 12. Dependencies

**No new dependencies.** `pdfjs-dist@5.7.284` already in the tree from Phase 1 (used for metadata extraction during import). 2.2 reuses the same install for rendering. The dedicated PDF.js worker is already configured in `src/features/library/import/parsers/pdf-pdfjs.ts`; the same `GlobalWorkerOptions.workerSrc` setup serves rendering.

## 13. Explicit follow-ups (NOT in this PR)

- **Static resource bundling for pdfjs** (`standardFontDataUrl`, `cMapUrl`, `wasmUrl`).
  Modern PDFs render cleanly without these; older scanned PDFs trigger console warnings
  ("Cannot load system font", "JBig2 failed to initialize", "Unable to decode image"),
  and JBig2-compressed images render blank. Implementation outline + verification matrix
  documented in `src/features/reader/pdf/pdf-notes.md` under "Follow-up: missing static
  resources for older PDFs". Benefits both the rendering adapter and the Phase 1 metadata
  parser — natural as its own commit.
- Text-layer e2e assertion (skipped due to flakiness; revisit when Playwright text-selection helpers settle)
- Per-PDF "disable dark mode" toggle for image-heavy PDFs
- PDF inline search (deferred to Phase 5 with retrieval)
- Touch swipe / edge-tap pagination affordances (deferred — buttons + keyboard cover v1)
- Page thumbnails sidebar (deferred — out of v2.2 scope)

## 14. Validation checklist (for the implementation phase)

- [ ] `pnpm check` green
- [ ] `pnpm test:e2e` green (new specs + Phase 1 + 2.1 specs)
- [ ] `pnpm dev` — manually open `text-friendly.pdf` AND `multipage.pdf` end-to-end on desktop and mobile viewports
- [ ] Toggle paginated ↔ scroll mid-read; position preserved
- [ ] Toggle dark theme; canvas inverts cleanly
- [ ] Increase/decrease zoom; canvas re-renders sharply (devicePixelRatio honored)
- [ ] Verify text selection works (highlight a sentence, copy, paste — content preserved)
- [ ] Reload mid-read → restored at correct page
- [ ] No file > 300-line warning threshold
- [ ] No new dependency
- [ ] Roadmap status updated; architecture doc decision-history entry added
