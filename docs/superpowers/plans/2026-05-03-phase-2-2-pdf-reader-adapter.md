# Phase 2.2 — PDF Reader Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a PDF reading experience by implementing `PdfReaderAdapter` against the same `BookReader` contract from Phase 2.1, plus the small set of UI tweaks needed to make the reader format-aware.

**Architecture:** A new `PdfReaderAdapter` (sole consumer of `pdfjs-dist` for rendering) implements `BookReader`. Internally splits work across `PdfPageView` (canvas + text layer for one page) and `PdfNavStrip` (DOM-only Next/Prev + page indicator). The reader-shell, machine, and persistence layer from 2.1 are reused. Storage migration is forward-compatible — `readerPreferences` validator softens to fill missing `modeByFormat.pdf` with a default; no IDB schema bump.

**Tech Stack:** React 19 + TypeScript strict + Vite, `pdfjs-dist@5.7.284` (already installed), Zustand (existing), XState v5 (existing), `idb` (existing), Vitest + happy-dom (existing), Playwright.

See `docs/superpowers/specs/2026-05-03-phase-2-2-pdf-reader-adapter-design.md` for the full design rationale.

---

## Milestones

1. **Foundation** — types delta, validator soften, multi-page PDF fixture
2. **PDF adapter core** — `PdfPageView`, `PdfNavStrip`, `PdfReaderAdapter` (lifecycle, TOC, paginated, scroll, preferences)
3. **UI integration** — format-aware `TypographyPanel`, `ReaderView` and `App.tsx` wiring
4. **End-to-end + docs** — four E2E specs, doc updates, final verification

## File structure

### New files

```
src/features/reader/pdf/
  PdfReaderAdapter.ts         # Wraps pdfjs-dist; implements BookReader
  PdfReaderAdapter.test.ts    # Lifecycle + TOC against fixtures
  PdfPageView.ts              # Canvas + text-layer for one page
  PdfNavStrip.ts              # DOM-only Prev/Next + page indicator widget
  pdf-notes.md                # pdfjs-dist API mapping (mirrors foliate-notes.md)
src/features/reader/
  pdf-page.css                # Page + text-layer styling
test-fixtures/
  multipage.pdf               # 5-page generated PDF
scripts/fixtures/
  build-multipage-pdf.ts      # Build script for the 5-page fixture
e2e/
  reader-pdf-open.spec.ts
  reader-pdf-restore.spec.ts
  reader-pdf-mode.spec.ts
  reader-pdf-zoom.spec.ts
```

### Modified files

```
src/domain/reader/types.ts                          # modeByFormat extends with pdf; default = 'paginated'
src/storage/repositories/readerPreferences.ts       # soften validator for forward-compat
src/storage/repositories/readerPreferences.test.ts  # new test for v2.1 record loads cleanly
src/features/reader/TypographyPanel.tsx             # bookFormat prop; format-aware controls
src/features/reader/TypographyPanel.test.tsx        # format-aware behavior tests
src/features/reader/ReaderView.tsx                  # bookFormat prop; passes it through
src/app/App.tsx                                     # createAdapter switches on book.format
docs/02-system-architecture.md                      # Decision history entry for 2.2
docs/04-implementation-roadmap.md                   # Mark Phase 2.2 complete
```

## Common commands

```bash
# Single test file
pnpm vitest run path/to/file.test.ts

# Full quality gate
pnpm check

# Playwright E2E (run pnpm build first if source has changed)
pnpm build && pnpm test:e2e

# Single E2E spec
pnpm exec playwright test e2e/reader-pdf-open.spec.ts

# Generate multi-page PDF fixture
pnpm tsx scripts/fixtures/build-multipage-pdf.ts

# Dev server (StrictMode enabled, useful for spotting double-mount issues)
pnpm dev
```

---

## Milestone 1 — Foundation

### Task 1: Extend `ReaderPreferences.modeByFormat` with `pdf`

**Files:**
- Modify: `src/domain/reader/types.ts`

- [ ] **Step 1: Edit the type and default**

Replace the existing `ReaderPreferences` type and `DEFAULT_READER_PREFERENCES` constant with:

```ts
export type ReaderPreferences = {
  readonly typography: ReaderTypography;
  readonly theme: ReaderTheme;
  readonly modeByFormat: { readonly epub: ReaderMode; readonly pdf: ReaderMode };
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  typography: {
    fontFamily: 'system-serif',
    fontSizeStep: 2,
    lineHeightStep: 1,
    marginStep: 1,
  },
  theme: 'light',
  modeByFormat: { epub: 'paginated', pdf: 'paginated' },
};
```

- [ ] **Step 2: Type-check**

```bash
pnpm type-check
```

Expected: TypeScript flags downstream consumers that destructure `modeByFormat` and don't include the new `pdf` key. The repos and components handle this in subsequent tasks; for now we should see errors only in `readerPreferences.ts` (Task 2 fixes it) and possibly `TypographyPanel.tsx` (Task 11 fixes it).

If errors appear elsewhere, pause and look — we may have missed a consumer.

- [ ] **Step 3: Commit**

```bash
git add src/domain/reader/types.ts
git commit -m "feat(reader): extend ReaderPreferences.modeByFormat with pdf

Default modeByFormat.pdf = 'paginated' (mobile-first, matches epub).
Validator + TypographyPanel updates land in subsequent commits."
```

---

### Task 2: Soften `readerPreferences` validator for forward-compat

**Files:**
- Modify: `src/storage/repositories/readerPreferences.ts`
- Modify: `src/storage/repositories/readerPreferences.test.ts`

- [ ] **Step 1: Write the failing test (v2.1 record loads cleanly)**

Append to `src/storage/repositories/readerPreferences.test.ts`:

```ts
  it('loads a v2.1 record (missing modeByFormat.pdf) and synthesizes default', async () => {
    const repo = createReaderPreferencesRepository(db);
    // Inject a record in the v2.1 shape — modeByFormat only has epub
    await db.put('reader_preferences', {
      key: 'global',
      value: {
        typography: DEFAULT_READER_PREFERENCES.typography,
        theme: 'dark',
        modeByFormat: { epub: 'scroll' },
      } as never,
    });
    const loaded = await repo.get();
    expect(loaded.theme).toBe('dark'); // user theme survives
    expect(loaded.modeByFormat.epub).toBe('scroll'); // user epub mode survives
    expect(loaded.modeByFormat.pdf).toBe('paginated'); // pdf default synthesized
  });
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/storage/repositories/readerPreferences.test.ts
```

Expected: FAIL — the strict validator rejects the v2.1 shape and returns `DEFAULT_READER_PREFERENCES` (so `loaded.theme` would be `'light'`, not `'dark'`).

- [ ] **Step 3: Soften the validator + add a normalize step**

Replace the `isValid` function and the `get()` method body in `src/storage/repositories/readerPreferences.ts`:

```ts
type LoosePreferences = {
  typography?: Partial<ReaderTypography>;
  theme?: ReaderTheme;
  modeByFormat?: { epub?: ReaderMode; pdf?: ReaderMode };
};

function normalize(value: unknown): ReaderPreferences | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as LoosePreferences;
  // Required fields with strict validation
  if (!v.theme || !VALID_THEMES.has(v.theme)) return null;
  if (!v.typography) return null;
  const t = v.typography;
  if (!t.fontFamily || !VALID_FONTS.has(t.fontFamily)) return null;
  if (!Number.isInteger(t.fontSizeStep) || (t.fontSizeStep ?? -1) < 0 || (t.fontSizeStep ?? 99) > 4) {
    return null;
  }
  if (!Number.isInteger(t.lineHeightStep) || (t.lineHeightStep ?? -1) < 0 || (t.lineHeightStep ?? 99) > 2) {
    return null;
  }
  if (!Number.isInteger(t.marginStep) || (t.marginStep ?? -1) < 0 || (t.marginStep ?? 99) > 2) {
    return null;
  }
  // Mode: at least one slot must be valid; missing slots get defaults.
  if (!v.modeByFormat) return null;
  const epub = VALID_MODES.has(v.modeByFormat.epub as ReaderMode)
    ? (v.modeByFormat.epub as ReaderMode)
    : DEFAULT_READER_PREFERENCES.modeByFormat.epub;
  const pdf = VALID_MODES.has(v.modeByFormat.pdf as ReaderMode)
    ? (v.modeByFormat.pdf as ReaderMode)
    : DEFAULT_READER_PREFERENCES.modeByFormat.pdf;
  return {
    typography: {
      fontFamily: t.fontFamily,
      fontSizeStep: t.fontSizeStep as 0 | 1 | 2 | 3 | 4,
      lineHeightStep: t.lineHeightStep as 0 | 1 | 2,
      marginStep: t.marginStep as 0 | 1 | 2,
    },
    theme: v.theme,
    modeByFormat: { epub, pdf },
  };
}
```

Replace `get()` to use `normalize` and write back the normalized record so future reads short-circuit:

```ts
    async get() {
      const rec = await db.get(READER_PREFERENCES_STORE, 'global');
      if (!rec) return DEFAULT_READER_PREFERENCES;
      const normalized = normalize(rec.value);
      if (!normalized) {
        console.warn('[readerPreferences] dropping unrecognizable record');
        await db.delete(READER_PREFERENCES_STORE, 'global');
        return DEFAULT_READER_PREFERENCES;
      }
      // If normalize had to fill in defaults, persist the upgraded shape so
      // later reads don't repeat the work.
      if (JSON.stringify(normalized) !== JSON.stringify(rec.value)) {
        await db.put(READER_PREFERENCES_STORE, { key: 'global', value: normalized });
      }
      return normalized;
    },
```

Delete the now-unused `isValid` helper.

- [ ] **Step 4: Run all readerPreferences tests → pass**

```bash
pnpm vitest run src/storage/repositories/readerPreferences.test.ts
```

Expected: PASS for the original 3 tests + the new 1.

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/storage/repositories/readerPreferences.ts src/storage/repositories/readerPreferences.test.ts
git commit -m "feat(storage): forward-compat readerPreferences for Phase 2.2

normalize() fills missing modeByFormat.pdf with the default rather
than rejecting the whole record. Existing user theme/typography
preferences from Phase 2.1 survive the v2.2 deploy. Normalized
records are written back so future reads are cheap."
```

---

### Task 3: Build the multi-page PDF fixture

**Files:**
- Create: `scripts/fixtures/build-multipage-pdf.ts`
- Create: `test-fixtures/multipage.pdf` (output of the script)

- [ ] **Step 1: Write the build script**

Create `scripts/fixtures/build-multipage-pdf.ts`. This mirrors `build-text-pdf.ts` but produces a 5-page PDF, each page showing a different label (Page 1 of 5, etc.).

```ts
// Produces a minimal valid 5-page PDF, each page with a distinct heading.
// Run with: pnpm tsx scripts/fixtures/build-multipage-pdf.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_COUNT = 5;

function pdfString(s: string): string {
  return `(${s.replace(/[\\()]/g, (ch) => `\\${ch}`)})`;
}

function buildPdf(): Uint8Array {
  const objects: string[] = [];
  const offsets: number[] = [];

  const push = (body: string): number => {
    const id = objects.length + 1;
    objects.push(`${String(id)} 0 obj\n${body}\nendobj\n`);
    return id;
  };

  // Single shared font
  const fId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // Build each page's content stream + page object, then a Pages tree.
  const pageIds: number[] = [];
  // Reserve the parent Pages id so each page can reference it.
  // We push pages with parent ref pointing at a slot we'll fill at the end.
  // Strategy: push a placeholder Pages object, then pages, then patch via re-push.
  // Simpler: compute parentId = next id after all page content + page objects.
  const contentIds: number[] = [];
  for (let i = 1; i <= PAGE_COUNT; i += 1) {
    const stream = `BT /F1 36 Tf 72 720 Td (Page ${String(i)} of ${String(PAGE_COUNT)}) Tj ET`;
    const cId = push(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
    contentIds.push(cId);
  }
  // Parent Pages object id will be (objects.length + 1 + PAGE_COUNT). Reserve it.
  const parentId = objects.length + 1 + PAGE_COUNT;
  for (let i = 0; i < PAGE_COUNT; i += 1) {
    const cId = contentIds[i]!;
    const pId = push(
      `<< /Type /Page /Parent ${String(parentId)} 0 R /MediaBox [0 0 612 792] /Contents ${String(cId)} 0 R /Resources << /Font << /F1 ${String(fId)} 0 R >> >> >>`,
    );
    pageIds.push(pId);
  }
  const psId = push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(PAGE_COUNT)} >>`,
  );
  if (psId !== parentId) {
    throw new Error(`Multipage PDF: parentId reservation mismatch (${String(psId)} vs ${String(parentId)})`);
  }
  const catId = push(`<< /Type /Catalog /Pages ${String(psId)} 0 R >>`);
  const infoId = push(
    `<< /Title ${pdfString('Multipage Test PDF')} /Author ${pdfString('Bookworm Test Suite')} >>`,
  );

  const header = '%PDF-1.4\n%âãÏÓ\n';
  let body = header;
  for (let i = 0; i < objects.length; i += 1) {
    offsets[i] = body.length;
    body += objects[i] ?? '';
  }
  const xrefOffset = body.length;
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${String(objects.length + 1)} /Root ${String(catId)} 0 R /Info ${String(infoId)} 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
}

const out = resolve(process.cwd(), 'test-fixtures/multipage.pdf');
writeFileSync(out, buildPdf());
console.log(`Wrote ${out}`);
```

- [ ] **Step 2: Generate the fixture**

```bash
pnpm tsx scripts/fixtures/build-multipage-pdf.ts
```

Expected: prints `Wrote /Users/.../test-fixtures/multipage.pdf`. File is small (~1-2 KB).

- [ ] **Step 3: Sanity-check the PDF parses**

Verify the existing PDF parser can read it:

```bash
pnpm vitest run src/features/library/import/parsers/pdf.test.ts
```

Expected: existing test still passes (we haven't modified anything yet). The new fixture will be exercised in later tasks.

- [ ] **Step 4: Commit**

```bash
git add scripts/fixtures/build-multipage-pdf.ts test-fixtures/multipage.pdf
git commit -m "test(fixtures): 5-page PDF for Phase 2.2 e2e specs

build-multipage-pdf.ts mirrors build-text-pdf.ts. Each page shows
'Page N of 5' so e2e specs can assert page-changes via visible text."
```

---

## Milestone 2 — PDF adapter core

### Task 4: `PdfPageView` — canvas + text layer for one page

**Files:**
- Create: `src/features/reader/pdf/PdfPageView.ts`
- Create: `src/features/reader/pdf/pdf-page.css`
- Create: `src/features/reader/pdf/pdf-notes.md`

> **Discovery first:** before implementing, read `pdfjs-dist`'s `TextLayer` exports (we found it's available as a top-level export from `pdfjs-dist/build/pdf.mjs`). Document the methods we'll use in `pdf-notes.md` — same pattern as `foliate-notes.md`.

- [ ] **Step 1: Write `pdf-notes.md`**

Create `src/features/reader/pdf/pdf-notes.md`:

```markdown
# pdfjs-dist notes (Phase 2.2)

Pinned version: **5.7.284** (already in tree from Phase 1)

We import `pdfjs-dist` only from `PdfReaderAdapter.ts` and `PdfPageView.ts`
for rendering. Phase 1's metadata parser
(`features/library/import/parsers/pdf.ts`) is a separate consumer kept
isolated by purpose.

## Worker setup

The dedicated PDF.js worker is configured by Phase 1 in
`src/features/library/import/parsers/pdf-pdfjs.ts`:

```ts
pdfjsLib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
```

This setting is module-global; once Phase 1 imports the parser the worker
is configured for any subsequent pdfjs use including ours. PdfReaderAdapter
imports the same `pdfjs` re-export from `parsers/pdf-pdfjs.ts` so we don't
duplicate the worker config.

## Mapping BookReader methods → pdfjs APIs

| BookReader method        | pdfjs API used                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| open(blob, opts)         | `pdfjsLib.getDocument({ data: bytes }).promise` → `PDFDocumentProxy`          |
| getCurrentAnchor()       | tracked internally (no pdfjs API needed)                                      |
| goToAnchor(anchor)       | `pdfDoc.getPage(anchor.page)` → render via PdfPageView                        |
| applyPreferences(prefs)  | re-render mounted PdfPageViews at new scale; toggle CSS class for theme/mode  |
| onLocationChange(fn)     | fires from internal page-change tracking (paginated) or IntersectionObserver  |
| destroy()                | cancel RenderTasks → disconnect IntersectionObserver → pdfDoc.destroy()       |

## Page rendering (PdfPageView)

```ts
const page = await pdfDoc.getPage(n);                                     // PDFPageProxy
const viewport = page.getViewport({ scale });                             // PageViewport
const renderTask = page.render({ canvasContext, viewport });              // RenderTask
await renderTask.promise;
const textContent = await page.getTextContent();
const textLayer = new TextLayer({ textContentSource: textContent, container, viewport });
await textLayer.render();
```

`renderTask.cancel()` aborts an in-flight canvas render. We always cancel
before destroying or re-rendering at a new scale.

## Things pdfjs does NOT do for us

- **Persistence** — we own that (readingProgressRepo).
- **Page navigation UI** — we render PdfNavStrip ourselves.
- **TOC fallback** — pdf.js gives us the outline as-is; we synthesize per-page
  entries when missing (PdfReaderAdapter.extractToc).

## Known caveats

- Render task cancellation isn't fully synchronous: `cancel()` triggers a
  `RenderingCancelledException` in the next tick. Always check `if (this.destroyed) return`
  in render-resolved callbacks.
- `getTextContent()` can return a large object for content-heavy pages.
  We render the text layer once per page and don't refresh on scroll.
```

- [ ] **Step 2: Write the failing test**

Create `src/features/reader/pdf/PdfPageView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PdfPageView } from './PdfPageView';
import { pdfjs } from '@/features/library/import/parsers/pdf-pdfjs';

const FIXTURE = resolve(__dirname, '../../../../test-fixtures/multipage.pdf');

describe('PdfPageView', () => {
  it('mounts canvas + text layer into the host on render', async () => {
    const bytes = readFileSync(FIXTURE);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await doc.getPage(1);
    const host = document.createElement('div');
    document.body.appendChild(host);

    const view = new PdfPageView({ page, scale: 1, host });
    await view.render();

    expect(host.querySelector('canvas')).not.toBeNull();
    expect(host.querySelector('.pdf-reader__text-layer')).not.toBeNull();

    view.destroy();
    expect(host.children.length).toBe(0);

    await doc.destroy();
    host.remove();
  });

  it('destroy is idempotent', async () => {
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
});
```

- [ ] **Step 3: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/pdf/PdfPageView.test.ts
```

Expected: FAIL — `PdfPageView` doesn't exist.

(Note: the test may also fail because pdfjs's worker setup needs to run first. The `pdf-pdfjs` import has a side-effect that loads the worker URL. If that import fails, see Step 4 — we may need to skip worker config under happy-dom.)

- [ ] **Step 4: Implement `PdfPageView.ts`**

```ts
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import './pdf-page.css';

type Options = {
  readonly page: PDFPageProxy;
  readonly scale: number;
  readonly host: HTMLElement;
};

export class PdfPageView {
  private destroyed = false;
  private renderTask: RenderTask | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private textLayerEl: HTMLDivElement | null = null;

  constructor(private readonly opts: Options) {}

  async render(): Promise<void> {
    if (this.destroyed) return;
    const { page, scale, host } = this.opts;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const viewport = page.getViewport({ scale: scale * dpr });

    // Canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-reader__canvas';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${String(Math.floor(viewport.width / dpr))}px`;
    canvas.style.height = `${String(Math.floor(viewport.height / dpr))}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('PdfPageView: 2d context unavailable');
    host.appendChild(canvas);
    this.canvas = canvas;

    this.renderTask = page.render({ canvasContext: ctx, viewport });
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

    // Text layer (overlay)
    const textLayerEl = document.createElement('div');
    textLayerEl.className = 'pdf-reader__text-layer';
    textLayerEl.style.width = `${String(Math.floor(viewport.width / dpr))}px`;
    textLayerEl.style.height = `${String(Math.floor(viewport.height / dpr))}px`;
    host.appendChild(textLayerEl);
    this.textLayerEl = textLayerEl;

    try {
      const textContent = await page.getTextContent();
      if (this.destroyed) return;
      // Use scale-only viewport (no DPR) for text layer positioning.
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
      // Continue without text layer — page is still readable
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
      // Free GPU memory by zeroing dimensions before removing.
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.canvas.remove();
      this.canvas = null;
    }
    if (this.textLayerEl) {
      this.textLayerEl.remove();
      this.textLayerEl = null;
    }
  }
}
```

Create `src/features/reader/pdf/pdf-page.css`:

```css
.pdf-reader__canvas {
  display: block;
}

.pdf-reader__text-layer {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  overflow: hidden;
  opacity: 0.25;
  line-height: 1;
  user-select: text;
  pointer-events: auto;
}

.pdf-reader__text-layer > span {
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0 0;
  color: transparent;
}

.pdf-reader__text-layer ::selection {
  background: rgba(0, 100, 255, 0.25);
}
```

- [ ] **Step 5: Run test → pass**

```bash
pnpm vitest run src/features/reader/pdf/PdfPageView.test.ts
```

Expected: PASS (2 tests). If the `TextLayer` constructor or `getTextContent` API surface differs in your `pdfjs-dist` version, adjust per `pdf-notes.md` — the public types are exported from the package's main entry.

- [ ] **Step 6: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/reader/pdf/PdfPageView.ts src/features/reader/pdf/PdfPageView.test.ts src/features/reader/pdf/pdf-page.css src/features/reader/pdf/pdf-notes.md
git commit -m "feat(reader): PdfPageView — canvas + text layer for one PDF page

Internal helper used by PdfReaderAdapter to mount a single page (with
text layer for native browser selection) into a host element. Idempotent
destroy releases GPU memory by zeroing canvas dimensions before removal."
```

---

### Task 5: `PdfNavStrip` — Prev / Next / page indicator widget

**Files:**
- Create: `src/features/reader/pdf/PdfNavStrip.ts`
- Create: `src/features/reader/pdf/PdfNavStrip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/pdf/PdfNavStrip.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PdfNavStrip } from './PdfNavStrip';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PdfNavStrip', () => {
  it('renders Prev / indicator / Next in paginated mode', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 1,
      onPrev: () => undefined,
      onNext: () => undefined,
    });
    strip.render();
    expect(host.textContent).toContain('Page 1 of 5');
    expect(host.querySelector('button[data-action="prev"]')).not.toBeNull();
    expect(host.querySelector('button[data-action="next"]')).not.toBeNull();
  });

  it('renders only the indicator in scroll mode', () => {
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'scroll',
      pageCount: 5,
      currentPage: 3,
      onPrev: () => undefined,
      onNext: () => undefined,
    });
    strip.render();
    expect(host.textContent).toContain('Page 3 of 5');
    expect(host.querySelector('button[data-action="prev"]')).toBeNull();
    expect(host.querySelector('button[data-action="next"]')).toBeNull();
  });

  it('disables Prev on page 1 and Next on last page', () => {
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 1,
      onPrev: () => undefined,
      onNext: () => undefined,
    });
    strip.render();
    expect((host.querySelector('button[data-action="prev"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('button[data-action="next"]') as HTMLButtonElement).disabled).toBe(false);
    strip.update({ currentPage: 5 });
    expect((host.querySelector('button[data-action="prev"]') as HTMLButtonElement).disabled).toBe(false);
    expect((host.querySelector('button[data-action="next"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('fires callbacks on click', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 3,
      onPrev,
      onNext,
    });
    strip.render();
    (host.querySelector('button[data-action="prev"]') as HTMLButtonElement).click();
    (host.querySelector('button[data-action="next"]') as HTMLButtonElement).click();
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('destroy removes its DOM and stops responding to clicks', () => {
    const onPrev = vi.fn();
    const host = document.createElement('div');
    const strip = new PdfNavStrip({
      host,
      mode: 'paginated',
      pageCount: 5,
      currentPage: 3,
      onPrev,
      onNext: () => undefined,
    });
    strip.render();
    strip.destroy();
    expect(host.querySelector('button[data-action="prev"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/pdf/PdfNavStrip.test.ts
```

Expected: FAIL — `PdfNavStrip` doesn't exist.

- [ ] **Step 3: Implement `PdfNavStrip.ts`**

```ts
import type { ReaderMode } from '@/domain/reader';

type Options = {
  readonly host: HTMLElement;
  readonly mode: ReaderMode;
  readonly pageCount: number;
  readonly currentPage: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
};

export class PdfNavStrip {
  private root: HTMLDivElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private indicator: HTMLSpanElement | null = null;
  private mode: ReaderMode;
  private pageCount: number;
  private currentPage: number;

  constructor(private readonly opts: Options) {
    this.mode = opts.mode;
    this.pageCount = opts.pageCount;
    this.currentPage = opts.currentPage;
  }

  render(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.className = 'pdf-reader__nav-strip';

    if (this.mode === 'paginated') {
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.dataset.action = 'prev';
      prev.textContent = '← Prev';
      prev.addEventListener('click', this.opts.onPrev);
      this.prevBtn = prev;
      root.appendChild(prev);
    }

    const indicator = document.createElement('span');
    indicator.className = 'pdf-reader__nav-strip__indicator';
    this.indicator = indicator;
    root.appendChild(indicator);

    if (this.mode === 'paginated') {
      const next = document.createElement('button');
      next.type = 'button';
      next.dataset.action = 'next';
      next.textContent = 'Next →';
      next.addEventListener('click', this.opts.onNext);
      this.nextBtn = next;
      root.appendChild(next);
    }

    this.opts.host.appendChild(root);
    this.root = root;
    this.refresh();
  }

  update(patch: Partial<{ mode: ReaderMode; pageCount: number; currentPage: number }>): void {
    if (patch.mode !== undefined) this.mode = patch.mode;
    if (patch.pageCount !== undefined) this.pageCount = patch.pageCount;
    if (patch.currentPage !== undefined) this.currentPage = patch.currentPage;
    // If mode changed, re-render the buttons; otherwise just refresh state.
    if (patch.mode !== undefined && this.root) {
      this.destroy();
      this.render();
      return;
    }
    this.refresh();
  }

  destroy(): void {
    if (!this.root) return;
    if (this.prevBtn) this.prevBtn.removeEventListener('click', this.opts.onPrev);
    if (this.nextBtn) this.nextBtn.removeEventListener('click', this.opts.onNext);
    this.root.remove();
    this.root = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.indicator = null;
  }

  private refresh(): void {
    if (this.indicator) {
      this.indicator.textContent = `Page ${String(this.currentPage)} of ${String(this.pageCount)}`;
    }
    if (this.prevBtn) this.prevBtn.disabled = this.currentPage <= 1;
    if (this.nextBtn) this.nextBtn.disabled = this.currentPage >= this.pageCount;
  }
}
```

Add CSS for the strip — append to `src/features/reader/pdf/pdf-page.css`:

```css
.pdf-reader__nav-strip {
  position: absolute;
  inset-block-end: var(--space-6);
  inset-inline-start: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-6);
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  font-size: var(--text-sm);
  color: var(--color-text);
  z-index: 4;
}

.pdf-reader__nav-strip button {
  background: transparent;
  border: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out);
}

.pdf-reader__nav-strip button:hover:not(:disabled) {
  background: var(--color-panel);
}

.pdf-reader__nav-strip button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pdf-reader__nav-strip__indicator {
  color: var(--color-text-muted);
  white-space: nowrap;
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/pdf/PdfNavStrip.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/pdf/PdfNavStrip.ts src/features/reader/pdf/PdfNavStrip.test.ts src/features/reader/pdf/pdf-page.css
git commit -m "feat(reader): PdfNavStrip — Prev/Next + page indicator floating widget

DOM-only widget rendered inside the adapter's host. Hides Prev/Next
in scroll mode (only indicator). Disables Prev on page 1, Next on
last page. Update method handles mid-life mode/page changes."
```

---

### Task 6: `PdfReaderAdapter` — lifecycle skeleton + TOC extraction

**Files:**
- Create: `src/features/reader/pdf/PdfReaderAdapter.ts`
- Create: `src/features/reader/pdf/PdfReaderAdapter.test.ts`

> **Strategy:** this task lands the lifecycle skeleton (open / destroy / TOC). Paginated rendering, scroll mode, and applyPreferences land in T7-T9.

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/pdf/PdfReaderAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PdfReaderAdapter } from './PdfReaderAdapter';
import { DEFAULT_READER_PREFERENCES } from '@/domain/reader';

const MULTIPAGE = resolve(__dirname, '../../../../test-fixtures/multipage.pdf');
const SINGLEPAGE = resolve(__dirname, '../../../../test-fixtures/text-friendly.pdf');

function loadFixture(path: string): Blob {
  const bytes = readFileSync(path);
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

describe('PdfReaderAdapter (lifecycle + TOC)', () => {
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
    await expect(
      adapter.goToAnchor({ kind: 'pdf', page: 1 }),
    ).rejects.toThrow(/not opened/);
    adapter.destroy();
  });

  it('rejects open on a non-PDF blob', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    const garbage = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/pdf' });
    await expect(
      adapter.open(garbage, { preferences: DEFAULT_READER_PREFERENCES }),
    ).rejects.toBeDefined();
    adapter.destroy();
    host.remove();
  });

  it('open() resolves with a TOC fallback for the multipage fixture (no outline)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      const { toc } = await adapter.open(loadFixture(MULTIPAGE), {
        preferences: DEFAULT_READER_PREFERENCES,
      });
      // Multipage fixture has no outline → fallback should generate per-page entries
      expect(toc.length).toBeGreaterThan(0);
      expect(toc.length).toBeLessThanOrEqual(5);
      for (const entry of toc) {
        expect(entry.anchor.kind).toBe('pdf');
        expect(entry.title).toMatch(/Page \d+/);
      }
    } finally {
      adapter.destroy();
      host.remove();
    }
  });

  it('open() handles single-page fixture cleanly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      const { toc } = await adapter.open(loadFixture(SINGLEPAGE), {
        preferences: DEFAULT_READER_PREFERENCES,
      });
      expect(toc).toHaveLength(1);
      expect(toc[0]?.anchor).toEqual({ kind: 'pdf', page: 1 });
    } finally {
      adapter.destroy();
      host.remove();
    }
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: FAIL — `PdfReaderAdapter` doesn't exist.

- [ ] **Step 3: Implement `PdfReaderAdapter.ts` (lifecycle + TOC only)**

```ts
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjs } from '@/features/library/import/parsers/pdf-pdfjs';
import type { LocationAnchor, TocEntry } from '@/domain';
import { SectionId } from '@/domain';
import type {
  BookReader,
  LocationChangeListener,
  ReaderInitOptions,
  ReaderPreferences,
} from '@/domain/reader';

export class PdfReaderAdapter implements BookReader {
  private pdfDoc: PDFDocumentProxy | null = null;
  private host: HTMLElement | null = null;
  private root: HTMLDivElement | null = null;
  private listeners = new Set<LocationChangeListener>();
  private destroyed = false;
  private currentPage = 1;
  private pageCount = 0;

  constructor(host?: HTMLElement) {
    if (host) this.host = host;
  }

  async open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }> {
    if (this.destroyed) throw new Error('PdfReaderAdapter: open() after destroy()');
    if (this.pdfDoc) throw new Error('PdfReaderAdapter: open() called twice');

    // StrictMode-safety: clear any stale pdf-reader root left by a previous mount
    if (this.host) {
      for (const child of Array.from(this.host.children)) {
        if (child.classList?.contains('pdf-reader')) child.remove();
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    this.pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;
    this.pageCount = this.pdfDoc.numPages;

    // Mount root DOM skeleton
    if (this.host) {
      const root = document.createElement('div');
      root.className = 'pdf-reader';
      this.host.appendChild(root);
      this.root = root;
    }

    // Apply initial position
    if (options.initialAnchor?.kind === 'pdf') {
      this.currentPage = Math.max(1, Math.min(this.pageCount, options.initialAnchor.page));
    } else {
      this.currentPage = 1;
    }

    return { toc: await this.extractToc() };
  }

  goToAnchor(anchor: LocationAnchor): Promise<void> {
    if (!this.pdfDoc) return Promise.reject(new Error('PdfReaderAdapter: not opened'));
    if (anchor.kind !== 'pdf') {
      return Promise.reject(new Error(`PdfReaderAdapter: cannot navigate to ${anchor.kind}`));
    }
    this.currentPage = Math.max(1, Math.min(this.pageCount, anchor.page));
    this.fireLocationChange();
    return Promise.resolve();
  }

  getCurrentAnchor(): LocationAnchor {
    if (!this.pdfDoc) throw new Error('PdfReaderAdapter: not opened');
    return { kind: 'pdf', page: this.currentPage };
  }

  applyPreferences(_prefs: ReaderPreferences): void {
    // Implemented in Task 9
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
          const dest = typeof item.dest === 'string'
            ? await this.pdfDoc.getDestination(item.dest)
            : item.dest;
          if (dest && dest[0]) {
            pageIndex = await this.pdfDoc.getPageIndex(dest[0]);
          }
        }
      } catch {
        /* unresolvable destination — skip the page-link but keep the entry */
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

interface OutlineNode {
  readonly title: string;
  readonly dest: string | unknown[] | null;
  readonly items?: readonly OutlineNode[];
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: PASS (6 tests).

If `pdfjs.getDocument` fails in happy-dom (because the worker doesn't load), there's a known fallback: pass `disableWorker: true` in the test env. If you hit that, conditionally set `disableWorker: true` when `typeof process !== 'undefined' && process.env.NODE_ENV === 'test'` — adjust `pdf-pdfjs.ts` or pass the flag from the adapter test setup.

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.test.ts
git commit -m "feat(reader): PdfReaderAdapter — lifecycle + TOC extraction with fallback

Implements BookReader contract for the open/destroy/getCurrentAnchor/
goToAnchor/onLocationChange surface. extractToc walks the PDF outline
when present; falls back to per-page entries (≤50 pages) or every-Nth
entries (>50 pages, capped at ~30). Render-related behavior
(applyPreferences, page rendering, scroll mode) lands in T7-T9."
```

---

### Task 7: `PdfReaderAdapter` — paginated mode rendering

**Files:**
- Modify: `src/features/reader/pdf/PdfReaderAdapter.ts`
- Modify: `src/features/reader/pdf/PdfReaderAdapter.test.ts`

- [ ] **Step 1: Add tests for paginated rendering**

Append to `src/features/reader/pdf/PdfReaderAdapter.test.ts`:

```ts
describe('PdfReaderAdapter (paginated mode)', () => {
  it('mounts one page in the host after open in paginated mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      await adapter.open(loadFixture(MULTIPAGE), {
        preferences: { ...DEFAULT_READER_PREFERENCES, modeByFormat: { epub: 'paginated', pdf: 'paginated' } },
      });
      // After open + applyPreferences in paginated mode, exactly one .pdf-reader__page exists
      const pages = host.querySelectorAll('.pdf-reader__page');
      expect(pages.length).toBe(1);
      expect(pages[0]?.getAttribute('data-page-index')).toBe('0'); // 0-indexed in DOM, 1-based in anchor
    } finally {
      adapter.destroy();
      host.remove();
    }
  });

  it('goToAnchor advances current page in paginated mode and fires onLocationChange', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    const changes: number[] = [];
    adapter.onLocationChange((a) => {
      if (a.kind === 'pdf') changes.push(a.page);
    });
    try {
      await adapter.open(loadFixture(MULTIPAGE), { preferences: DEFAULT_READER_PREFERENCES });
      await adapter.goToAnchor({ kind: 'pdf', page: 3 });
      expect(adapter.getCurrentAnchor()).toEqual({ kind: 'pdf', page: 3 });
      expect(changes).toContain(3);
      // Mounted page reflects new index
      const page = host.querySelector('.pdf-reader__page');
      expect(page?.getAttribute('data-page-index')).toBe('2');
    } finally {
      adapter.destroy();
      host.remove();
    }
  });

  it('mounts NavStrip with Prev/Next in paginated mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      await adapter.open(loadFixture(MULTIPAGE), { preferences: DEFAULT_READER_PREFERENCES });
      expect(host.querySelector('.pdf-reader__nav-strip button[data-action="next"]')).not.toBeNull();
      expect(host.textContent).toMatch(/Page 1 of 5/);
    } finally {
      adapter.destroy();
      host.remove();
    }
  });
});
```

- [ ] **Step 2: Run tests → expect fail**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: FAIL — paginated mode rendering not yet implemented.

- [ ] **Step 3: Add paginated-mode wiring + applyPreferences mode dispatch**

Edit `src/features/reader/pdf/PdfReaderAdapter.ts`. Add imports at top:

```ts
import { PdfPageView } from './PdfPageView';
import { PdfNavStrip } from './PdfNavStrip';
import type { ReaderMode } from '@/domain/reader';
```

Add new instance fields (inside the class, near the existing private fields):

```ts
  private pagesContainer: HTMLDivElement | null = null;
  private navStrip: PdfNavStrip | null = null;
  private currentMode: ReaderMode = 'paginated';
  private currentScale = 1;
  // Paginated mode: a single mounted PdfPageView keyed by page index (1-based)
  private mountedPaginatedView: PdfPageView | null = null;
```

Replace `applyPreferences` with the real implementation (mode dispatch + scale; scroll mode comes in T8):

```ts
  applyPreferences(prefs: ReaderPreferences): void {
    if (!this.pdfDoc || !this.root) return;
    const mode = prefs.modeByFormat.pdf;
    const scale = SCALE_BY_STEP[prefs.typography.fontSizeStep];
    const modeChanged = mode !== this.currentMode;
    const scaleChanged = scale !== this.currentScale;
    this.currentMode = mode;
    this.currentScale = scale;
    this.applyTheme(prefs);
    if (modeChanged || !this.pagesContainer) {
      this.buildLayoutForMode();
    }
    if (mode === 'paginated' && (modeChanged || scaleChanged)) {
      void this.mountPaginatedPage(this.currentPage);
    }
    this.refreshNavStrip();
  }
```

Add helper methods to the class:

```ts
  private buildLayoutForMode(): void {
    if (!this.root) return;
    // Tear down whatever was mounted previously
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
        if (this.currentPage > 1) void this.goToAnchor({ kind: 'pdf', page: this.currentPage - 1 });
      },
      onNext: () => {
        if (this.currentPage < this.pageCount) void this.goToAnchor({ kind: 'pdf', page: this.currentPage + 1 });
      },
    });
    this.navStrip.render();

    if (this.currentMode === 'scroll') {
      this.buildScrollPlaceholders(); // implemented in T8
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
    // CSS handles the actual filter — see pdf-page.css additions
  }

  private buildScrollPlaceholders(): void {
    // implemented in T8
  }
```

Update `goToAnchor` to also re-mount in paginated mode:

```ts
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
```

Update `destroy` to also tear down nav strip + paginated view:

```ts
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
```

Update `open` to call `applyPreferences` (which builds the layout) at the end:

Right before `return { toc: await this.extractToc() };`, add:

```ts
    this.applyPreferences(options.preferences);
```

Add the scale table just below the imports (top-level constants):

```ts
const SCALE_BY_STEP: Readonly<Record<0 | 1 | 2 | 3 | 4, number>> = {
  0: 0.75,
  1: 0.9,
  2: 1.0,
  3: 1.25,
  4: 1.5,
};
```

Add CSS for theme + pages container — append to `src/features/reader/pdf/pdf-page.css`:

```css
.pdf-reader {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.pdf-reader__pages {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-6);
  overflow-y: auto;
  background: var(--color-bg);
}

.pdf-reader__pages--paginated {
  justify-content: center;
}

.pdf-reader__page {
  position: relative;
  margin-block-end: var(--space-6);
  background: white;
  box-shadow: var(--shadow-md);
}

.pdf-reader[data-theme='dark'] .pdf-reader__pages {
  filter: invert(1) hue-rotate(180deg);
}
```

- [ ] **Step 4: Run tests → pass**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: PASS (9 tests now: 6 original + 3 new).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.test.ts src/features/reader/pdf/pdf-page.css
git commit -m "feat(reader): PdfReaderAdapter — paginated mode rendering

applyPreferences now dispatches on mode (paginated vs scroll). Paginated
path mounts a single PdfPageView per page. Scroll-mode placeholder build
left as a stub for T8. Nav strip wired to onPrev/onNext callbacks that
just call goToAnchor."
```

---

### Task 8: `PdfReaderAdapter` — scroll mode + virtualization

**Files:**
- Modify: `src/features/reader/pdf/PdfReaderAdapter.ts`
- Modify: `src/features/reader/pdf/PdfReaderAdapter.test.ts`

- [ ] **Step 1: Add tests for scroll mode**

Append to `src/features/reader/pdf/PdfReaderAdapter.test.ts`:

```ts
describe('PdfReaderAdapter (scroll mode)', () => {
  it('builds N placeholder pages in scroll mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      await adapter.open(loadFixture(MULTIPAGE), {
        preferences: { ...DEFAULT_READER_PREFERENCES, modeByFormat: { epub: 'paginated', pdf: 'scroll' } },
      });
      const pages = host.querySelectorAll('.pdf-reader__page');
      expect(pages.length).toBe(5);
      pages.forEach((p, i) => {
        expect(p.getAttribute('data-page-index')).toBe(String(i));
      });
    } finally {
      adapter.destroy();
      host.remove();
    }
  });

  it('switches between scroll and paginated cleanly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      await adapter.open(loadFixture(MULTIPAGE), { preferences: DEFAULT_READER_PREFERENCES });
      expect(host.querySelectorAll('.pdf-reader__page').length).toBe(1); // paginated by default
      adapter.applyPreferences({
        ...DEFAULT_READER_PREFERENCES,
        modeByFormat: { epub: 'paginated', pdf: 'scroll' },
      });
      expect(host.querySelectorAll('.pdf-reader__page').length).toBe(5);
      adapter.applyPreferences({
        ...DEFAULT_READER_PREFERENCES,
        modeByFormat: { epub: 'paginated', pdf: 'paginated' },
      });
      expect(host.querySelectorAll('.pdf-reader__page').length).toBe(1);
    } finally {
      adapter.destroy();
      host.remove();
    }
  });
});
```

- [ ] **Step 2: Run tests → expect fail**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: FAIL — `buildScrollPlaceholders` is still a stub.

- [ ] **Step 3: Implement scroll-mode placeholder layout + virtualization**

Edit `src/features/reader/pdf/PdfReaderAdapter.ts`. Add a new instance field for scroll mode:

```ts
  // Scroll mode: array of placeholders by page index (0-based); rendered views by page index
  private scrollPlaceholders: HTMLDivElement[] = [];
  private scrollViews = new Map<number, PdfPageView>(); // 1-based page → view
  private scrollIntersectionObserver: IntersectionObserver | null = null;
  private readonly scrollWindowSize = 2; // pages above + below visible
```

Replace the `buildScrollPlaceholders` stub:

```ts
  private buildScrollPlaceholders(): void {
    if (!this.pdfDoc || !this.pagesContainer) return;
    this.scrollPlaceholders = [];
    // Get viewport for first page to size all placeholders (good enough — most PDFs have uniform sizes)
    void this.pdfDoc.getPage(1).then((firstPage) => {
      if (this.destroyed || this.currentMode !== 'scroll') return;
      const viewport = firstPage.getViewport({ scale: this.currentScale });
      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);
      for (let i = 0; i < this.pageCount; i += 1) {
        const slot = document.createElement('div');
        slot.className = 'pdf-reader__page';
        slot.dataset.pageIndex = String(i);
        slot.style.width = `${String(cssWidth)}px`;
        slot.style.height = `${String(cssHeight)}px`;
        this.pagesContainer?.appendChild(slot);
        this.scrollPlaceholders[i] = slot;
      }
      this.installScrollObserver();
      // Scroll the requested initial page into view
      this.scrollPlaceholders[this.currentPage - 1]?.scrollIntoView({ block: 'start' });
    });
  }

  private installScrollObserver(): void {
    if (!this.pagesContainer) return;
    this.scrollIntersectionObserver?.disconnect();
    this.scrollIntersectionObserver = new IntersectionObserver(
      (entries) => {
        if (this.destroyed) return;
        // Track the page with the largest intersection
        let best: { index: number; ratio: number } | null = null;
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.pageIndex ?? -1);
          if (idx < 0) continue;
          if (e.isIntersecting && (best === null || e.intersectionRatio > best.ratio)) {
            best = { index: idx, ratio: e.intersectionRatio };
          }
        }
        if (best !== null) {
          const newPage = best.index + 1;
          if (newPage !== this.currentPage) {
            this.currentPage = newPage;
            this.fireLocationChange();
            this.refreshNavStrip();
          }
          this.renderScrollWindow(newPage);
        }
      },
      { root: this.pagesContainer, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const slot of this.scrollPlaceholders) {
      this.scrollIntersectionObserver.observe(slot);
    }
  }

  private renderScrollWindow(centerPage: number): void {
    if (!this.pdfDoc) return;
    const lo = Math.max(1, centerPage - this.scrollWindowSize);
    const hi = Math.min(this.pageCount, centerPage + this.scrollWindowSize);

    // Clear pages outside the window
    for (const [page, view] of this.scrollViews) {
      if (page < lo || page > hi) {
        view.destroy();
        this.scrollViews.delete(page);
      }
    }
    // Render pages inside the window that aren't already rendered
    for (let p = lo; p <= hi; p += 1) {
      if (this.scrollViews.has(p)) continue;
      const slot = this.scrollPlaceholders[p - 1];
      if (!slot) continue;
      void this.pdfDoc.getPage(p).then(async (page) => {
        if (this.destroyed || this.currentMode !== 'scroll' || this.scrollViews.has(p)) return;
        // Drop any old PdfPageView in this slot
        slot.replaceChildren();
        const view = new PdfPageView({ page, scale: this.currentScale, host: slot });
        this.scrollViews.set(p, view);
        await view.render();
      });
    }
  }
```

Update `buildLayoutForMode` to clean up scroll-mode state when switching away:

```ts
  private buildLayoutForMode(): void {
    if (!this.root) return;
    // Tear down ALL previously-mounted state
    if (this.mountedPaginatedView) {
      this.mountedPaginatedView.destroy();
      this.mountedPaginatedView = null;
    }
    for (const view of this.scrollViews.values()) view.destroy();
    this.scrollViews.clear();
    this.scrollPlaceholders = [];
    this.scrollIntersectionObserver?.disconnect();
    this.scrollIntersectionObserver = null;
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
        if (this.currentPage > 1) void this.goToAnchor({ kind: 'pdf', page: this.currentPage - 1 });
      },
      onNext: () => {
        if (this.currentPage < this.pageCount) void this.goToAnchor({ kind: 'pdf', page: this.currentPage + 1 });
      },
    });
    this.navStrip.render();

    if (this.currentMode === 'scroll') {
      this.buildScrollPlaceholders();
    }
  }
```

Update `goToAnchor` for scroll mode (scrollIntoView instead of mounting a single page):

```ts
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
    // scroll mode
    this.scrollPlaceholders[target - 1]?.scrollIntoView({ block: 'start' });
    return Promise.resolve();
  }
```

Update `destroy` to clean scroll state:

```ts
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.scrollIntersectionObserver?.disconnect();
    this.scrollIntersectionObserver = null;
    for (const view of this.scrollViews.values()) view.destroy();
    this.scrollViews.clear();
    this.scrollPlaceholders = [];
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
```

- [ ] **Step 4: Run tests → pass**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: PASS (11 tests now: 9 + 2 new). The scroll placeholder count test relies on the `buildScrollPlaceholders` async path completing — if happy-dom doesn't fire the awaited `getPage(1).then(...)` synchronously, the test may need an `await new Promise(r => setTimeout(r, 50))` between `open()` and the `querySelectorAll`. Add it if needed.

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.test.ts
git commit -m "feat(reader): PdfReaderAdapter — scroll mode with virtualized rendering

All N pages get sized placeholders (correct scrollbar). IntersectionObserver
drives a render window of ±2 pages around visible. Pages leaving the window
have their PdfPageView destroyed (canvas dimensions zeroed → GPU memory
released). Mode switch tears down all per-mode state cleanly."
```

---

### Task 9: `PdfReaderAdapter` — applyPreferences re-render + theme

**Files:**
- Modify: `src/features/reader/pdf/PdfReaderAdapter.ts`
- Modify: `src/features/reader/pdf/PdfReaderAdapter.test.ts`

> The `applyPreferences` method dispatches mode + theme correctly already, but a scale change in scroll mode doesn't re-render the existing pages with the new scale. This task closes that gap.

- [ ] **Step 1: Add tests for zoom + theme re-render**

Append to `src/features/reader/pdf/PdfReaderAdapter.test.ts`:

```ts
describe('PdfReaderAdapter (preferences)', () => {
  it('changing fontSizeStep re-renders mounted paginated page', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      await adapter.open(loadFixture(MULTIPAGE), { preferences: DEFAULT_READER_PREFERENCES });
      const canvasBefore = host.querySelector('canvas') as HTMLCanvasElement;
      const widthBefore = canvasBefore?.width ?? 0;
      adapter.applyPreferences({
        ...DEFAULT_READER_PREFERENCES,
        typography: { ...DEFAULT_READER_PREFERENCES.typography, fontSizeStep: 4 },
      });
      // Allow the async re-render to complete
      await new Promise((r) => setTimeout(r, 50));
      const canvasAfter = host.querySelector('canvas') as HTMLCanvasElement;
      expect(canvasAfter?.width ?? 0).toBeGreaterThan(widthBefore);
    } finally {
      adapter.destroy();
      host.remove();
    }
  });

  it('theme dark sets data-theme on root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new PdfReaderAdapter(host);
    try {
      await adapter.open(loadFixture(MULTIPAGE), { preferences: DEFAULT_READER_PREFERENCES });
      adapter.applyPreferences({ ...DEFAULT_READER_PREFERENCES, theme: 'dark' });
      expect(host.querySelector('.pdf-reader')?.getAttribute('data-theme')).toBe('dark');
    } finally {
      adapter.destroy();
      host.remove();
    }
  });
});
```

- [ ] **Step 2: Run tests → expect fail (zoom test)**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: theme test PASSES (already implemented in T7), zoom test FAILS (no re-render on scale change in paginated mode without mode change).

- [ ] **Step 3: Update `applyPreferences` to handle scale-only changes in both modes**

Replace `applyPreferences` in `src/features/reader/pdf/PdfReaderAdapter.ts`:

```ts
  applyPreferences(prefs: ReaderPreferences): void {
    if (!this.pdfDoc || !this.root) return;
    const mode = prefs.modeByFormat.pdf;
    const scale = SCALE_BY_STEP[prefs.typography.fontSizeStep];
    const modeChanged = mode !== this.currentMode;
    const scaleChanged = scale !== this.currentScale;
    this.currentMode = mode;
    this.currentScale = scale;
    this.applyTheme(prefs);
    if (modeChanged || !this.pagesContainer) {
      this.buildLayoutForMode();
      // buildLayoutForMode kicks off paginated/scroll mounting for current page
      if (mode === 'paginated') {
        void this.mountPaginatedPage(this.currentPage);
      }
    } else if (scaleChanged) {
      // Re-render at new scale without rebuilding layout
      if (mode === 'paginated') {
        void this.mountPaginatedPage(this.currentPage);
      } else {
        // Scroll mode: re-size placeholders + re-render window
        this.resizeScrollPlaceholders();
        for (const view of this.scrollViews.values()) view.destroy();
        this.scrollViews.clear();
        this.renderScrollWindow(this.currentPage);
      }
    }
    this.refreshNavStrip();
  }

  private resizeScrollPlaceholders(): void {
    if (!this.pdfDoc) return;
    void this.pdfDoc.getPage(1).then((firstPage) => {
      if (this.destroyed || this.currentMode !== 'scroll') return;
      const viewport = firstPage.getViewport({ scale: this.currentScale });
      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);
      for (const slot of this.scrollPlaceholders) {
        slot.style.width = `${String(cssWidth)}px`;
        slot.style.height = `${String(cssHeight)}px`;
      }
    });
  }
```

- [ ] **Step 4: Run tests → pass**

```bash
pnpm vitest run src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: PASS (13 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.test.ts
git commit -m "feat(reader): PdfReaderAdapter — re-render on scale change

A pure scale change (no mode change) now re-renders the visible page
in paginated mode and re-sizes placeholders + re-renders the window
in scroll mode. Theme via data-theme on root + CSS invert filter for
dark mode."
```

---

## Milestone 3 — UI integration

### Task 10: `TypographyPanel` becomes format-aware

**Files:**
- Modify: `src/features/reader/TypographyPanel.tsx`
- Modify: `src/features/reader/TypographyPanel.test.tsx`

- [ ] **Step 1: Add tests for format-aware behavior**

Append to `src/features/reader/TypographyPanel.test.tsx` (after the existing tests):

```ts
describe('TypographyPanel — format-aware', () => {
  it('hides fontFamily / lineHeight / margins when bookFormat is pdf', () => {
    const onChange = vi.fn();
    render(
      <TypographyPanel
        preferences={DEFAULT_READER_PREFERENCES}
        bookFormat="pdf"
        onChange={onChange}
      />,
    );
    expect(screen.queryByText(/font$/i)).toBeNull();
    expect(screen.queryByText(/line height/i)).toBeNull();
    expect(screen.queryByText(/margins/i)).toBeNull();
    // Size, theme, mode controls remain
    expect(screen.getByText(/size|zoom/i)).toBeDefined();
    expect(screen.getByText(/theme/i)).toBeDefined();
  });

  it('relabels Size as Zoom for PDF', () => {
    const onChange = vi.fn();
    render(
      <TypographyPanel
        preferences={DEFAULT_READER_PREFERENCES}
        bookFormat="pdf"
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Zoom')).toBeDefined();
    expect(screen.queryByText('Size')).toBeNull();
  });

  it('mode change for PDF writes to modeByFormat.pdf only', () => {
    const onChange = vi.fn();
    render(
      <TypographyPanel
        preferences={DEFAULT_READER_PREFERENCES}
        bookFormat="pdf"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /scroll/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      modeByFormat: { epub: 'paginated', pdf: 'scroll' },
    });
  });

  it('keeps original behavior when bookFormat is epub', () => {
    const onChange = vi.fn();
    render(
      <TypographyPanel
        preferences={DEFAULT_READER_PREFERENCES}
        bookFormat="epub"
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/font/i)).toBeDefined(); // fontFamily label visible
    expect(screen.getByText('Size')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/TypographyPanel.test.tsx
```

Expected: FAIL — `bookFormat` prop doesn't exist.

- [ ] **Step 3: Add `bookFormat` prop + conditional rendering**

Edit `src/features/reader/TypographyPanel.tsx`. Update the `Props` type and the render to be format-aware. Add `import type { BookFormat } from '@/domain';` at the top.

Replace `Props`:

```ts
type Props = {
  readonly preferences: ReaderPreferences;
  readonly bookFormat: BookFormat;
  readonly onChange: (prefs: ReaderPreferences) => void;
};
```

Update destructuring:

```ts
export function TypographyPanel({ preferences, bookFormat, onChange }: Props) {
```

Wrap the fontFamily, lineHeight, margins blocks with `{bookFormat === 'epub' ? (...) : null}`. Relabel the size group dynamically:

For the Font row:

```tsx
{bookFormat === 'epub' ? (
  <label className="typography-panel__row">
    <span>Font</span>
    {/* existing select unchanged */}
  </label>
) : null}
```

For the Size row, change the label text:

```tsx
<div className="typography-panel__row">
  <span>{bookFormat === 'pdf' ? 'Zoom' : 'Size'}</span>
  {/* existing buttons unchanged */}
</div>
```

For Line height:

```tsx
{bookFormat === 'epub' ? (
  <div className="typography-panel__row" role="group" aria-label="Line height">
    {/* existing */}
  </div>
) : null}
```

For Margins:

```tsx
{bookFormat === 'epub' ? (
  <div className="typography-panel__row" role="group" aria-label="Margins">
    {/* existing */}
  </div>
) : null}
```

For the mode radios — change the onChange to write to the correct format slot:

```tsx
<fieldset className="typography-panel__row">
  <legend>Reading mode</legend>
  {MODES.map((mode) => (
    <label key={mode}>
      <input
        type="radio"
        name="reader-mode"
        checked={preferences.modeByFormat[bookFormat] === mode}
        onChange={() => {
          onChange({
            ...preferences,
            modeByFormat: { ...preferences.modeByFormat, [bookFormat]: mode },
          });
        }}
      />
      <span style={{ textTransform: 'capitalize' }}>{mode}</span>
    </label>
  ))}
</fieldset>
```

- [ ] **Step 4: Run all TypographyPanel tests → pass**

```bash
pnpm vitest run src/features/reader/TypographyPanel.test.tsx
```

The original tests will fail because they don't pass `bookFormat`. Update them to pass `bookFormat="epub"`:

In every existing test, wherever `<TypographyPanel preferences={...} onChange={...}/>` appears, add `bookFormat="epub"`:

```tsx
render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} bookFormat="epub" onChange={onChange} />);
```

Re-run:

```bash
pnpm vitest run src/features/reader/TypographyPanel.test.tsx
```

Expected: PASS (10 tests: 6 original updated + 4 new).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: errors flagged in `ReaderView.tsx` (callsite needs `bookFormat`) — fixed in Task 11.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/TypographyPanel.tsx src/features/reader/TypographyPanel.test.tsx
git commit -m "feat(reader): TypographyPanel becomes format-aware

bookFormat prop hides fontFamily / lineHeight / margins for PDFs and
relabels Size → Zoom. Mode radio writes to modeByFormat[bookFormat]
so EPUB and PDF preferences track independently. Existing tests updated
to pass bookFormat='epub'."
```

---

### Task 11: `ReaderView` — pass `bookFormat` through

**Files:**
- Modify: `src/features/reader/ReaderView.tsx`

- [ ] **Step 1: Add `bookFormat` prop and thread it through**

Edit `src/features/reader/ReaderView.tsx`. Add to imports:

```ts
import type { BookFormat } from '@/domain';
```

Add to `ReaderViewProps`:

```ts
type ReaderViewProps = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookSubtitle?: string;
  readonly bookFormat: BookFormat;            // NEW
  readonly onBack: () => void;
  readonly loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  readonly createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;  // signature gains format
  readonly onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  readonly onPreferencesChange: (prefs: ReaderPreferences) => void;
};
```

Destructure `bookFormat` in the function signature.

Update the `machine` `useMemo` to pass `bookFormat`:

```ts
const machine = useMemo(
  () =>
    makeReaderMachine({
      loadBookForReader,
      createAdapter: () => {
        if (!mountRef.current) {
          throw new Error('ReaderView: mount node not ready');
        }
        const adapter = createAdapter(mountRef.current, bookFormat);
        adapterRef.current = adapter;
        return adapter;
      },
    }),
  [loadBookForReader, createAdapter, bookFormat],
);
```

Update the `<TypographyPanel>` render to pass `bookFormat`:

```tsx
{typoOpen && prefs ? (
  <div className="reader-view__sheet reader-view__sheet--typography">
    <TypographyPanel preferences={prefs} bookFormat={bookFormat} onChange={handlePrefChange} />
  </div>
) : null}
```

- [ ] **Step 2: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: errors flagged only in `App.tsx` (now needs to pass `bookFormat` and updated `createAdapter` signature) — fixed in Task 12.

- [ ] **Step 3: Commit**

```bash
git add src/features/reader/ReaderView.tsx
git commit -m "feat(reader): ReaderView accepts bookFormat prop

Propagates bookFormat to the adapter factory and to TypographyPanel.
createAdapter signature gains a format parameter. App.tsx wires both
in the next commit."
```

---

### Task 12: `App.tsx` — `createAdapter` switches on `book.format`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Edit App.tsx**

In `src/app/App.tsx`:

Add the import:

```ts
import { PdfReaderAdapter } from '@/features/reader/pdf/PdfReaderAdapter';
import type { BookFormat } from '@/domain';
```

Update the `createAdapter` callback signature to accept format and switch:

```ts
const createAdapter = useCallback(
  (mountInto: HTMLElement, format: BookFormat): BookReader => {
    if (format === 'pdf') return new PdfReaderAdapter(mountInto);
    return new EpubReaderAdapter(mountInto);
  },
  [],
);
```

Update the `<ReaderView>` render to pass `bookFormat`:

```tsx
return (
  <div className="app">
    <ReaderView
      key={view.bookId}
      bookId={view.bookId}
      bookTitle={book.title}
      bookFormat={book.format}                                      // NEW
      {...(book.author !== undefined && { bookSubtitle: book.author })}
      onBack={handleBack}
      loadBookForReader={loadBookForReader}
      createAdapter={createAdapter}
      onAnchorChange={onAnchorChange}
      onPreferencesChange={onPreferencesChange}
    />
  </div>
);
```

- [ ] **Step 2: Full quality gate**

```bash
pnpm check
```

Expected: type-check + lint + all unit tests pass.

- [ ] **Step 3: Manual smoke**

```bash
pnpm dev
```

In the browser:
1. Import `test-fixtures/multipage.pdf` (drag-drop or file picker)
2. Click the imported card → reader opens, page 1 visible
3. Click Next → page 2 visible
4. Open ⚙ panel → toggle to "scroll" mode → all 5 pages visible, scroll works
5. Toggle dark theme → page colors invert
6. Reload → land back on the same page

If anything is broken, debug per the project's debugging discipline (see `.claude` memory).

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): createAdapter switches on book.format

PdfReaderAdapter is constructed for PDFs; EpubReaderAdapter for EPUBs.
Same BookReader contract; same minimal reader shell. ReaderView gets
bookFormat through props."
```

---

## Milestone 4 — End-to-end + docs

### Task 13: E2E `reader-pdf-open`

**Files:**
- Create: `e2e/reader-pdf-open.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PDF_FIXTURE = resolve(process.cwd(), 'test-fixtures/multipage.pdf');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PDF_FIXTURE);
  await expect(page.getByText(/multipage test pdf/i).first()).toBeVisible({ timeout: 15_000 });
}

test('opens an imported PDF and navigates the TOC', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // NavStrip indicator shows page 1 of 5
  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 1 of 5/);

  // Open TOC, click page 3
  await page.getByRole('button', { name: /table of contents/i }).click();
  const tocPanel = page.locator('aside.toc-panel');
  await expect(tocPanel).toBeVisible();
  const tocEntries = tocPanel.locator('button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible();
  // Fixture has no outline; fallback gives 5 per-page entries
  expect(await tocEntries.count()).toBe(5);
  await tocEntries.nth(2).click();

  // NavStrip should now show page 3
  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 3 of 5/);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-pdf-open.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-pdf-open.spec.ts
git commit -m "test(e2e): open PDF, navigate via TOC fallback"
```

---

### Task 14: E2E `reader-pdf-restore`

**Files:**
- Create: `e2e/reader-pdf-restore.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PDF_FIXTURE = resolve(process.cwd(), 'test-fixtures/multipage.pdf');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PDF_FIXTURE);
  await expect(page.getByText(/multipage test pdf/i).first()).toBeVisible({ timeout: 15_000 });
}

test('PDF reading position persists across reload', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Click Next twice → page 3
  await page.locator('button[data-action="next"]').click();
  await page.locator('button[data-action="next"]').click();
  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 3 of 5/);

  // Allow debounced save (500ms)
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 3 of 5/);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-pdf-restore.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-pdf-restore.spec.ts
git commit -m "test(e2e): PDF position restored across reload"
```

---

### Task 15: E2E `reader-pdf-mode`

**Files:**
- Create: `e2e/reader-pdf-mode.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PDF_FIXTURE = resolve(process.cwd(), 'test-fixtures/multipage.pdf');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PDF_FIXTURE);
  await expect(page.getByText(/multipage test pdf/i).first()).toBeVisible({ timeout: 15_000 });
}

test('PDF mode toggle (paginated ↔ scroll) renders both modes and persists', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Default = paginated; one .pdf-reader__page in DOM
  await expect(page.locator('.pdf-reader__page')).toHaveCount(1);

  // Open prefs and switch to scroll mode
  await page.getByRole('button', { name: /reader preferences/i }).click();
  await page.getByRole('radio', { name: /scroll/i }).click();

  // 5 placeholders now exist
  await expect(page.locator('.pdf-reader__page')).toHaveCount(5);

  // Reload — scroll mode persists
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.pdf-reader__page')).toHaveCount(5);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-pdf-mode.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-pdf-mode.spec.ts
git commit -m "test(e2e): PDF mode toggle renders both modes; persists across reload"
```

---

### Task 16: E2E `reader-pdf-zoom`

**Files:**
- Create: `e2e/reader-pdf-zoom.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PDF_FIXTURE = resolve(process.cwd(), 'test-fixtures/multipage.pdf');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PDF_FIXTURE);
  await expect(page.getByText(/multipage test pdf/i).first()).toBeVisible({ timeout: 15_000 });
}

test('PDF zoom changes canvas size and persists across reload', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  // Wait for first canvas to render
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  const widthBefore = await page.locator('canvas').first().evaluate((el) => (el as HTMLCanvasElement).width);

  // Open prefs and increase zoom (label is "Zoom" for PDF)
  await page.getByRole('button', { name: /reader preferences/i }).click();
  await page.getByRole('button', { name: /increase font size/i }).click();
  await page.getByRole('button', { name: /increase font size/i }).click();

  // Allow re-render
  await page.waitForTimeout(800);

  const widthAfter = await page.locator('canvas').first().evaluate((el) => (el as HTMLCanvasElement).width);
  expect(widthAfter).toBeGreaterThan(widthBefore);

  // Reload; zoom persists
  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });
  const widthAfterReload = await page.locator('canvas').first().evaluate((el) => (el as HTMLCanvasElement).width);
  expect(widthAfterReload).toBe(widthAfter);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-pdf-zoom.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-pdf-zoom.spec.ts
git commit -m "test(e2e): PDF zoom changes canvas size and persists"
```

---

### Task 17: Doc updates (architecture + roadmap)

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Decision history entry**

In `docs/02-system-architecture.md`, append after the Phase 2.1 entry:

```markdown
### 2026-05-03 — Phase 2.2 PDF reader adapter

- `PdfReaderAdapter` (sole pdfjs-dist consumer for rendering) implements the
  `BookReader` contract from Phase 2.1. No new dependencies — `pdfjs-dist@5.7.284`
  was already in the tree from Phase 1 metadata extraction.
- `ReaderPreferences.modeByFormat` extended with `pdf`. Forward-compatible
  validator soften — no IDB schema bump. Existing user theme/font preferences
  from Phase 2.1 survive the upgrade.
- `TypographyPanel` becomes format-aware: hides fontFamily / lineHeight /
  margins for PDFs; relabels Size → Zoom.
- `App.tsx` `createAdapter` callback dispatches on `book.format`.
- PDF reader renders canvas + transparent text-layer overlay (PDF.js's
  standard pattern for native browser text selection).
- Scroll mode virtualizes via `IntersectionObserver` (visible + 2 above + 2
  below = max 5 concurrent rendered canvases).
- Dark theme via `filter: invert(1) hue-rotate(180deg)` on the pages
  container (text-only PDFs work cleanly; image-heavy distorts — documented
  caveat in `pdf-notes.md`).
```

- [ ] **Step 2: Roadmap status**

In `docs/04-implementation-roadmap.md`, update the Status block:

```markdown
## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (2026-05-03)
- Phase 2 — in progress (Task 2.1 + 2.2 complete 2026-05-03; 2.3 pending)
```

- [ ] **Step 3: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: record Phase 2.2 decisions; mark Task 2.2 complete"
```

---

### Task 18: Final verification + open PR

**Files:** none

- [ ] **Step 1: Full quality gate**

```bash
pnpm check
```

Expected: type-check + lint + all unit tests green.

- [ ] **Step 2: Full E2E suite**

```bash
pnpm build && pnpm test:e2e
```

Expected: all e2e green (Phase 1 + Phase 2.1 + 4 new Phase 2.2 specs).

- [ ] **Step 3: Manual smoke pass**

```bash
pnpm dev
```

In the browser, run through the validation checklist from `docs/superpowers/specs/2026-05-03-phase-2-2-pdf-reader-adapter-design.md` Section 14:

- [ ] Open `text-friendly.pdf` AND `multipage.pdf` end-to-end (desktop + mobile viewport)
- [ ] Toggle paginated ↔ scroll mid-read; position preserved
- [ ] Toggle dark theme; canvas inverts cleanly
- [ ] Increase / decrease zoom; canvas re-renders sharply
- [ ] Verify text selection works (highlight a sentence, copy, paste — content preserved)
- [ ] Reload mid-read → restored at correct page
- [ ] Open an EPUB after a PDF — adapter switches cleanly; no leaked DOM

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin phase-2-2-pdf-reader-adapter

gh pr create --title "Phase 2.2 — PDF reader adapter" --body "$(cat <<'EOF'
## Summary
- New `PdfReaderAdapter` implementing the `BookReader` contract from 2.1
- `PdfPageView` (canvas + text-layer for one page) and `PdfNavStrip` (Prev/Next + page indicator) helpers
- `TypographyPanel` becomes format-aware (hides EPUB-only knobs for PDFs; relabels Size → Zoom)
- `App.tsx` `createAdapter` switches on `book.format`
- `ReaderPreferences.modeByFormat` extends with `pdf`; forward-compatible validator soften (no IDB schema bump; user prefs from 2.1 survive)
- New 5-page PDF fixture (`test-fixtures/multipage.pdf` via `scripts/fixtures/build-multipage-pdf.ts`)
- Four new e2e specs (open / restore / mode / zoom)

No new dependencies — `pdfjs-dist@5.7.284` was already shipped in Phase 1 for metadata extraction.

See `docs/superpowers/specs/2026-05-03-phase-2-2-pdf-reader-adapter-design.md` for design rationale.

## Test plan
- [x] `pnpm check` green
- [x] `pnpm test:e2e` green
- [ ] Manual: open both PDF fixtures (desktop + mobile)
- [ ] Manual: toggle scroll/paginated; reload restores
- [ ] Manual: change theme + zoom; persists across reload
- [ ] Manual: text selection works (highlight + copy)
- [ ] Manual: switch from EPUB to PDF — adapter swap is clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Mark this plan complete in the roadmap once the PR merges**

---

## Scope coverage check (against spec)

| Spec section | Tasks |
|---|---|
| 4.1 Module layout | T4–T9 (new files), T10–T12 (modified) |
| 4.2 Boundary intent | T6 (`PdfReaderAdapter` is sole pdfjs renderer); T11 (`ReaderView` doesn't know format internals) |
| 4.3 Type delta | T1 |
| 4.4 Migration | T2 |
| 4.5 Mode semantics | T7 (paginated), T8 (scroll), T9 (mode switch) |
| 4.6 Theme behavior | T7 (data-theme); T9 (re-tested) |
| 5.1 Mount-node DOM | T6 (root), T7 (paginated single page), T8 (scroll placeholders), T5 (nav strip) |
| 5.2 Rendering pipeline | T4 (PdfPageView) |
| 5.3 Position tracking | T7 (paginated current = mounted page); T8 (IntersectionObserver) |
| 5.4 TOC + fallback | T6 |
| 5.5 Theme + zoom | T7 (theme + initial scale), T9 (re-render on scale change) |
| 5.6 Memory management | T4 (canvas zeroing), T6 (pdfDoc.destroy), T8 (window-bounded scroll views) |
| 5.7 BookReader method mapping | T6 (skeleton), T7 (paginated), T8 (scroll), T9 (preferences) |
| 6.1 App.tsx createAdapter switch | T12 |
| 6.2 ReaderView bookFormat prop | T11 |
| 6.3 TypographyPanel format-aware | T10 |
| 7. End-to-end data flow | T13–T16 (each step verified by an e2e spec) |
| 8. Error handling | T6 (lifecycle errors), T7 (clamping), T9 (mode-switch teardown) |
| 9. Testing strategy | T2, T6–T10 (unit + integration), T13–T16 (e2e) |
| 10. Risks | T4 (text-layer wrapped), T8 (debounce/destroyed guards), T9 (cancel on re-render) |
| 11. Files | All tasks |
| 12. Dependencies (none new) | n/a |
| 14. Validation checklist | T18 |
