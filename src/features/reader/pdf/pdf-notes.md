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

This setting is module-global; once Phase 1 imports the parser, the worker
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
  `RenderingCancelledException` in the next tick. Always check
  `if (this.destroyed) return` in render-resolved callbacks.
- `getTextContent()` can return a large object for content-heavy pages.
  We render the text layer once per page and don't refresh on scroll.
- Dark mode via CSS `filter: invert(1) hue-rotate(180deg)` works for text
  PDFs but distorts photos in image-heavy PDFs (standard PDF-reader
  trade-off; matches Adobe Acrobat / Preview behavior).

## Follow-up: missing static resources for older PDFs

Modern PDFs render cleanly. Older PDFs (especially scanned books) trigger
console warnings from `pdf.worker.mjs` because three resource directories
that ship with `pdfjs-dist` aren't being served by our app:

| Missing resource              | Impact when missing                                        |
| ----------------------------- | ---------------------------------------------------------- |
| `standardFontDataUrl`         | Embedded fonts can't be substituted cleanly; text falls back to system fonts (legible, but kerning + ligatures may look off) |
| `cMapUrl` (+ `cMapPacked`)    | CJK / non-Latin character maps unavailable; affected glyphs may render as boxes |
| `wasmUrl`                     | JBig2 wasm decoder can't load; JBig2-compressed images (common in scanned PDFs) fail to decode → blank image areas + "Unable to decode image / Dependent image isn't ready yet" warnings |

The resources live inside the `pdfjs-dist` package:

```
node_modules/pdfjs-dist/standard_fonts/
node_modules/pdfjs-dist/cmaps/
node_modules/pdfjs-dist/wasm/
```

### Implementation outline (Phase 2.2 follow-up)

1. **Vite asset copy.** Either:
   - Use [`vite-plugin-static-copy`](https://github.com/sapphi-red/vite-plugin-static-copy) to copy
     the three directories into `dist/pdfjs/` at build time, OR
   - Add a small build script (`scripts/copy-pdfjs-assets.ts`) that runs in
     `prebuild` via package.json scripts and copies them to `public/pdfjs/`.

2. **Wire the URLs into pdfjs.** In `pdf-pdfjs.ts` (or in a small helper
   that returns these once per session), set Vite-resolved URLs:
   ```ts
   import standardFontsUrl from 'pdfjs-dist/standard_fonts/?url'; // or computed
   ```
   And pass them to every `getDocument(...)` call:
   ```ts
   pdfjs.getDocument({
     data: bytes,
     standardFontDataUrl: '/pdfjs/standard_fonts/',
     cMapUrl: '/pdfjs/cmaps/',
     cMapPacked: true,
     wasmUrl: '/pdfjs/wasm/',
   });
   ```
   Both `PdfReaderAdapter` (rendering) and `parsers/pdf.ts` (metadata
   extraction during import) should use them.

3. **Verify the fix on:**
   - A modern PDF (regression: still renders cleanly, no new warnings)
   - An older scanned PDF with JBig2 images (was: blank image areas;
     after: images decoded, no JBig2 warnings)
   - A PDF with CJK content if available (was: tofu boxes; after: proper
     glyphs)

4. **Bundle size check.** Standard fonts + cmaps + wasm together are a
   few MB. Confirm `pnpm build` output stays reasonable; consider lazy
   loading if it's a meaningful jump.

### Why deferred from initial 2.2

Phase 2.2's scope locked in option B (reading-essentials) — modern PDFs
work end-to-end. Resource bundling is a build-config concern, not a
reader-engine concern, and benefits the parser (Phase 1) just as much
as the reader. Cleaner as its own commit on the v2.2 PR or a follow-up
PR than tangled with the adapter implementation.
