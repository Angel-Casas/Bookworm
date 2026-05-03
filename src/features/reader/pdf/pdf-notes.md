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
