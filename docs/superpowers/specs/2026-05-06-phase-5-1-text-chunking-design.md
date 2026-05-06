# Phase 5.1 — Text normalization and chunking

**Status:** approved 2026-05-06
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 5 → Task 5.1
**Predecessors:** Phase 1 library import (introduces `Book` record + `IndexingStatus` field), Phase 4.3 chat panel (the IDB v6 schema; `useReaderHost.onRemoveBook` cascade pattern), Phase 4.4 passage mode (introduces the validating-reads `isValidContextRef` pattern + the pure-helper-extracted-for-testability discipline used in `pdfPassageWindows.ts`).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` (chunks are the basis for retrieval mode #4, chapter mode #2's "top chunks", embeddings strategy #§Local embedding policy, "avoid re-embedding unchanged chunks"), `docs/02-system-architecture.md` (functional core / imperative shell split, additive IDB migrations), `docs/06-quality-strategy.md` (file/function thresholds, error-state requirements, accessibility floor).

---

## 1. Goal & scope

Generate deterministic `BookSection` and `TextChunk` records for every imported book (EPUB + PDF) on a background pipeline that runs at import time, with idempotent resumption on app open. Provide an inspectable UI surface so the user can verify what got chunked. Lay the foundation for Phase 5.2 retrieval (which will add embeddings on top of these chunks) and Phase 5.4 chapter-mode (which will aggregate chunks by `sectionId`).

**In scope (v1, this phase):**
- Per-book chunking pipeline with the canonical state machine `pending → chunking{progressPercent} → ready` (or `→ failed{reason}`).
- Pipeline runs on the **main thread with explicit yielding** between sections via `await new Promise(r => setTimeout(r, 0))`. No Web Worker yet — promotion is a pure refactor when profiling justifies it.
- Section detection: **TOC entries are sections 1:1**. EPUB: each spine entry = one section; section title resolved from `Book.toc` (fallback "Section N"). PDF: each TOC entry's page-range = one section. Books without TOC: one synthetic section with id `'__whole_book__'` covering the whole book.
- Chunking algorithm: paragraph-bounded, packed up to **~400 tokens** (`Math.ceil(chars/4)` heuristic); never splits a paragraph; sentence-boundary fallback only when a single paragraph alone exceeds the cap; mid-sentence cap fallback only when a single sentence alone exceeds the cap (extremely rare; documented limitation).
- EPUB extraction: foliate-js's parser used **headlessly** (no DOM mount). Foliate's CFI utility produces `LocationAnchor` strings for chunk start positions. Fallback to JSZip + DOMParser + foliate's CFI module if the headless API turns out impractical at implementation time.
- PDF extraction: `pdfjs-dist`'s `getTextContent()` per page → line grouping by y-position (±2px jitter) → paragraph reconstruction by line-spacing gaps (gap > 1.5× median line height) and indent shifts (>5% page width) → boilerplate filter (page-number regex, > 50%-of-pages running header/footer detection on books ≥ 4 pages) → de-hyphenation of word-wraps.
- **Idempotent resume**: chunks persist per-section atomically. The pipeline's outer loop checks `chunksRepo.hasChunksFor(bookId, sectionId)` before chunking each section and short-circuits when chunks exist. App open scans for non-terminal status and dispatches the indexer; partial books resume at the next un-chunked section.
- **Chunker versioning**: a `CHUNKER_VERSION = 1` constant; `TextChunk` extended with a `chunkerVersion: number` field. On app open, the resume scan additionally drops chunks where `chunkerVersion < CHUNKER_VERSION` and marks affected books `pending` — eager resume re-indexes them automatically. Future chunker changes are a one-line bump.
- New IDB store `book_chunks` (schema v7, additive migration) with `by-book` and compound `by-book-section` indexes.
- Inspector UI: library-card affordance shows `IndexingStatus` (`pending`/`chunking{n}`/`ready`/`failed{reason}`); once `ready`, an "Index inspector" link opens a modal listing chunks with section title + ~80-char preview + token estimate. Click a row → expand to full normalized text. Modal has a "Rebuild index" button.
- Cascade integration: `useReaderHost.onRemoveBook` extends with `bookChunksRepo.deleteByBook(bookId)`. Cancel-during-removal: `useIndexing.cancel(bookId)` is called at the top of the cascade so the pipeline aborts cleanly before the book record is gone.

**Out of scope (v1, deferred — see §14 for destinations):**
- Embeddings / vector storage (Phase 5.2).
- Retrieval, ranking, chunk scoring (Phase 5.2).
- Suggested prompts derived from chunks (Phase 5.3).
- Chapter-mode prompt assembly using chunks (Phase 5.4).
- Full-book attach mode (Phase 5+).
- Concept graphs, glossaries, family trees, structured outputs (Phase 5+).
- A 5th right-rail tab for the inspector — kept as a low-traffic library surface in 5.1.
- Web Worker promotion of the chunker — pure refactor when profiling shows main-thread jank.
- Manual rebuild outside the inspector (e.g. command palette).
- Per-chunk timestamps (`createdAt`) — chunks are derived data, not user-authored.
- OCR for image-only PDFs (Phase 6+ — separate pipeline).
- Multi-column PDF column detection (best-effort in v1; chunks may interleave columns).
- Cross-tab BroadcastChannel coordination (deferred until real-use shows races).
- Concurrent indexing across multiple books (sequential queue is fine for v1).
- Staggered rebuild on chunker-version bump (bounded work; revisit if storm friction emerges).

---

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Pipeline timing | **On import, background** | Reading isn't blocked. `IndexingStatus.chunking{progressPercent}` was already pre-designed for this exact UX. Phase 5.2 features that gate on `ready` (retrieval, chapter mode) get the chunks they need without adding latency to the user's first AI question. |
| Chunk granularity | **Paragraph-bounded, ~400-token cap** | Each chunk is a self-contained semantic unit. Parent `sectionId` lets Phase 5.4 chapter-mode scope cleanly. Retrieval ranking in Phase 5.2 handles the variable size fine. The 400-token cap matches a typical 1k-token retrieval budget for 3-4 chunks per query. Sentence-fallback covers the rare paragraph-overflow case. |
| Section detection | **TOC entries 1:1 + synthetic single section as fallback** | Deterministic (a hard acceptance criterion). Aligns with existing `getSectionTitleAt` semantics. The synthetic `__whole_book__` fallback keeps the contract uniform — `chunk.sectionId` always points somewhere. |
| Pipeline scheduling | **Main thread with `setTimeout(0)` yield between sections** | Chunking work is light (~100-200 chunks per typical book × few-ms each). Avoids worker boilerplate where it isn't needed yet. Phase 5.2's embedding pipeline is where the real CPU goes — that's where a worker pays for itself. |
| Interruption handling | **Idempotent resume by section** | Chunks persist per-section atomically. The pipeline naturally short-circuits already-done sections via `hasChunksFor`. No extra resume state needed (information already in IDB). Resumption is a pure no-op when nothing's missing. |
| Resumption trigger | **Eager on app open** | Phase 5.2's gated-on-`ready` features rarely have to wait for a fresh chunking pass on first AI use. The single-flight queue prevents overwhelm if many books are partially-indexed. |
| Token estimation | **`Math.ceil(chars / 4)` heuristic** | Free, deterministic, zero deps. Off by ~20% on weird text but the cap is fuzzy anyway. Phase 5.2 retrieval-budget assembly will calibrate against actual usage telemetry from completion responses. tiktoken / gpt-tokenizer rejected because NanoGPT proxies many providers (Claude, Gemini, etc.) — picking one tokenizer is already a guess. |
| Inspectability surface | **Library-card affordance → modal inspector** | Satisfies the "chunk previews are inspectable" acceptance criterion. Lives in the existing low-traffic library surface; doesn't crowd the right-rail (already 4 tabs as of 4.4). Phase 5.2 will additionally show retrieved chunks inline in `PrivacyPreview` — distinct per-message provenance from this per-book inspector. |
| Versioning policy | **Chunker version constant + auto-rebuild on stale** | One field (`chunkerVersion`) + one start-up scan; cheap forward-compat for every future chunker change. Phase 5.1 is the chunker's birth — the right place to introduce the abstraction. |
| EPUB extraction strategy | **Foliate-js headless parse** with JSZip+DOMParser fallback | Same parser the reader uses → chunk paragraph boundaries match what the user sees. Already a dep; no new lib. The fallback is documented and concrete if the headless API turns out impractical. |
| PDF extraction quality | **Best-effort reconstruction with heuristic boilerplate filter** | Major use case (academic readers, technical books). Chunk quality determines retrieval quality in 5.2. Heuristics are well-known, bounded, fully unit-tested. Multi-column "best-effort" is documented. |
| Concurrency limits | **Sequential, one book at a time** | Avoids saturating the main thread on multi-import. Reading still works during indexing. Phase 5.2's embedding pipeline is where parallelism may matter. |
| Cancellation on book removal | **`useIndexing.cancel(bookId)` at top of `onRemoveBook` cascade** | Pipeline aborts before catch can write `failed` to a deleted book. No orphaned status; no leaked chunks. |
| Cross-tab coordination | **None — IDB transactions serialize per-store** | Two tabs running indexing on the same book is rare; the second writer wins per section; both arrive at the same final state. BroadcastChannel deferred until real-use shows races. |

---

## 3. Architecture

```
┌──────────────────────────────── core pipeline ────────────────────────────────┐
│                                                                               │
│  Book { indexingStatus: pending }                                             │
│        │                                                                      │
│        ▼                                                                      │
│  FormatExtractor (dispatch by book.format)                                    │
│  ├─ EpubChunkExtractor   (foliate-js headless: book.spine → walk XHTML)       │
│  └─ PdfChunkExtractor    (pdfjs-dist getTextContent + line/para heuristics)   │
│        │                                                                      │
│        ▼                                                                      │
│  AsyncIterable<{ paragraphText, locationAnchor }>                             │
│        │                                                                      │
│        ▼                                                                      │
│  paragraphsToChunks  (pure helper)                                            │
│    - normalizeChunkText (collapse ws, strip control chars)                    │
│    - pack contiguous same-section paragraphs up to ~400 tokens                │
│    - never split a paragraph; sentence-fallback only on overflow              │
│    - tokenEstimate via Math.ceil(chars / 4)                                   │
│        │                                                                      │
│        ▼                                                                      │
│  TextChunk[] (one slice per section)                                          │
│        │                                                                      │
│        ▼                                                                      │
│  BookChunksRepository.upsertMany    (atomic per-section in IDB)               │
│        │                                                                      │
│        ▼                                                                      │
│  IndexingStatusUpdater                                                        │
│    - chunking{progressPercent} after each section                             │
│    - ready when last section completes                                        │
│    - failed{reason} on terminal error                                         │
│        │                                                                      │
│        ▼                                                                      │
│  await yieldToBrowser (setTimeout 0) before next section                      │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────── React app surface ────────────────────────────────┐
│                                                                               │
│  useIndexing hook (new)                                                       │
│   - on app open: scans books for chunks with chunkerVersion < CURRENT         │
│     → drops stale, marks book pending                                         │
│   - on app open: scans books with status ∈ {pending, chunking}                │
│   - subscribes to book imports → enqueues new pending books                   │
│   - drives a single-book-at-a-time queue                                      │
│                                                                               │
│  BookCardIndexingStatus (new, embedded in existing library card)              │
│   - chunking → small inline progress (% from indexingStatus)                  │
│   - ready    → subtle "Indexed" affordance + "Index inspector" link           │
│   - failed   → "Couldn't index" + Retry                                       │
│                                                                               │
│  IndexInspectorModal (new)                                                    │
│   - opens from the library card link                                          │
│   - lists chunks via bookChunksRepo.listByBook                                │
│   - row: "N of M  ·  <section title>  ·  ~<tokens> tk  <preview>"             │
│   - row click → expand to full normalized text                                │
│   - "Rebuild index" button → drops chunks, marks pending, queue retriggers    │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

Functional-core / imperative-shell split per `06-quality-strategy.md`:

- **Pure (testable without I/O):** `paragraphsToChunks`, `normalizeChunkText`, `tokenEstimate`, `sha256` (existing crypto), `groupItemsIntoLines`, `groupLinesIntoParagraphs`, `dehyphenateWordWraps`, `detectRunningHeadersFooters`, `isPageNumberOnly`, `classifyError` (error → reason mapping), the section-skip-on-resume predicate.
- **Side-effectful:** the two `*ChunkExtractor`s (DOM/worker calls into foliate-js / pdfjs), `BookChunksRepository` (IDB), `IndexingPipeline` (orchestrator), `IndexingQueue` (in-memory state), `useIndexing` hook.

**Concurrency:**
- One book at a time across the queue. Reading isn't blocked. Multi-import puts books in queue; UX degrades gracefully (later books wait).
- Within a book, sections process serially (already implied by `await yield()` between them).
- Resumption is naturally serialized through the same queue.

---

## 4. Domain & storage

### 4.1 `TextChunk` extension

Existing type at `src/domain/book/types.ts:55-64` already has `id`, `bookId`, `sectionId`, `text`, `normalizedText`, `tokenEstimate`, `locationAnchor`, `checksum`. Two new fields:

```ts
export type TextChunk = {
  readonly id: ChunkId;
  readonly bookId: BookId;
  readonly sectionId: SectionId;
  readonly sectionTitle: string;       // NEW — denormalized from TOC for inspector display
  readonly text: string;               // raw paragraph(s) joined
  readonly normalizedText: string;     // collapsed whitespace, control chars stripped
  readonly tokenEstimate: number;      // Math.ceil(normalizedText.length / 4)
  readonly locationAnchor: LocationAnchor;  // start of the chunk's first paragraph
  readonly checksum: string;           // SHA-256 of normalizedText (existing field, finally used)
  readonly chunkerVersion: number;     // NEW — bumped on chunker changes; stale rows auto-rebuild
};
```

`sectionTitle` is denormalized for display because the inspector renders without opening the reader (so we can't call the live `getSectionTitleAt`); the book is immutable post-import so staleness isn't a concern.

### 4.2 Section concept — implicit, no IDB store

`BookSection` (already typed at `src/domain/book/types.ts:45-53`) is **not persisted** in 5.1. The section model derives from existing data:

- **EPUB:** each spine entry is a section. `sectionId = SectionId('spine:' + spineEntry.href)` — the href is already a stable identifier within the EPUB; no hashing needed. `sectionTitle` resolved from `Book.toc` by matching href; spine entries with no matching TOC entry get a fallback like `"Section ${n}"`.
- **PDF:** each TOC entry's page-range (page → next-entry's-page) is a section. `sectionId = SectionId('pdf:' + startPage + ':' + slugify(title))` — `slugify` lowercases, replaces non-alphanumeric runs with `-`, and trims. Combined with `startPage`, this is deterministic and collision-resistant within a single book. Books without TOC get a single synthetic section with `id = SectionId('__whole_book__')` and `title = book.title`.

Phase 5.4 chapter mode will retrieve via the `[bookId, sectionId]` compound index — that's the only place section identity is load-bearing, and it works without persisted `BookSection` records.

### 4.3 New IDB store: `book_chunks` (schema v7)

```ts
// src/storage/db/schema.ts
export const BOOK_CHUNKS_STORE = 'book_chunks';

interface BookwormDBSchema_v7 extends BookwormDBSchema_v6 {
  book_chunks: {
    key: ChunkId;
    value: TextChunk;
    indexes: {
      'by-book': BookId;
      'by-book-section': [BookId, SectionId];
    };
  };
}
```

Migration v6 → v7 is **additive** — creates `book_chunks` store with the two indexes. No existing data touched. Forward-compatible normalizer (matching the 4.3/4.4 pattern): malformed chunk records (bad anchor shape, non-numeric tokenEstimate, missing chunkerVersion, etc.) are filtered on read; the surrounding chunks for the same book survive — partial index is more useful than no index.

### 4.4 `IndexingStatus` — no type change

Already typed at `src/domain/indexing/types.ts:1-6`:

```ts
export type IndexingStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'chunking'; readonly progressPercent: number }
  | { readonly kind: 'embedding'; readonly progressPercent: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };
```

Phase 5.1 uses `pending → chunking{n} → ready`. The `embedding` state is reserved for 5.2. The `failed.reason` carries one of: `'extract-failed'`, `'no-text-found'`, `'persist-failed'`, `'unknown'` — strings, not a typed union, to keep the existing type stable across phases.

### 4.5 Cascade on book removal

`useReaderHost.onRemoveBook` already cascades `messages-by-thread → threads-by-book → saved-answers-by-book` (per 4.3). Extends with two lines:

```ts
indexing.cancel(bookId);                     // §6.2 — abort in-flight pipeline
await bookChunksRepo.deleteByBook(bookId);   // delete chunks
```

Order: `cancel` first (synchronous, immediate), then chunk deletion (after the cascade's existing chat-related deletions, before the book record itself).

### 4.6 Repository contract

```ts
// src/storage/repositories/bookChunks.ts
export type BookChunksRepository = {
  upsertMany(chunks: readonly TextChunk[]): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly TextChunk[]>;
  listBySection(bookId: BookId, sectionId: SectionId): Promise<readonly TextChunk[]>;
  deleteByBook(bookId: BookId): Promise<void>;
  deleteBySection(bookId: BookId, sectionId: SectionId): Promise<void>;
  countByBook(bookId: BookId): Promise<number>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
  hasChunksFor(bookId: BookId, sectionId: SectionId): Promise<boolean>;
};
```

`countStaleVersions` powers the app-open scan (§6.2). `hasChunksFor` powers the per-section idempotent-resume check (§6.1). `listBySection` is for Phase 5.4 chapter-mode — defined now to lock the contract; not used in 5.1's UI.

---

## 5. Adapter layer

### 5.1 `ChunkExtractor` contract

```ts
// src/features/library/indexing/extractor.ts
export interface ChunkExtractor {
  listSections(book: Book): Promise<readonly SectionListing[]>;
  streamParagraphs(book: Book, section: SectionListing): AsyncIterable<ExtractedParagraph>;
}

export type SectionListing = {
  readonly id: SectionId;
  readonly title: string;
  readonly range: EpubSectionRange | PdfSectionRange;
};

export type ExtractedParagraph = {
  readonly text: string;                    // raw, pre-normalization
  readonly locationAnchor: LocationAnchor;  // start of this paragraph
};

export type EpubSectionRange = {
  readonly kind: 'epub';
  readonly spineIndex: number;
};

export type PdfSectionRange = {
  readonly kind: 'pdf';
  readonly startPage: number;
  readonly endPage: number;
};
```

The pipeline (§6.1) calls these two methods; the extractor is the only place that knows about format internals.

### 5.2 `EpubChunkExtractor`

> ⚠️ **Implementation-time verification (before commit 7)** — confirm that `foliate-js/epub.js` exposes a usable headless `EPUB.load(blob)` (or equivalent) API and that `foliate-js/epubcfi.js` exports CFI utilities. If foliate's package.json doesn't expose those entry points cleanly, fall back to JSZip + DOMParser with foliate's CFI module re-exported from a small wrapper. The contract above doesn't change either way; only the implementation does.

**`listSections`:**
1. `const book = await EPUB.load(blob)` (or fallback parse).
2. For each `spine[i]`:
   - `id = SectionId('spine:' + book.spine[i].href)`.
   - `title = book.toc.find(t => hrefMatches(t.href, spine[i].href))?.label ?? \`Section ${i + 1}\``.
   - `range = { kind: 'epub', spineIndex: i }`.

**`streamParagraphs`:**
1. Load the spine item's document: `const doc = await book.spine[spineIndex].load()` (returns a `Document`).
2. Walk `doc.body` via `TreeWalker(NodeFilter.SHOW_ELEMENT)` filtered to paragraph-level tags: `{p, li, blockquote, h1, h2, h3, h4, h5, h6, pre}`. Headings are emitted as standalone single-paragraph entries — they pack with the next paragraph if it fits, otherwise become their own short chunks.
3. For each element:
   - `text = element.textContent ?? ''` (raw — `paragraphsToChunks` normalizes downstream).
   - Skip if `text.trim().length === 0`.
   - `locationAnchor = { kind: 'epub-cfi', cfi: CFI.fromRange(spineIndex, rangeStartingAt(element)) }`.
4. `yield` each one (proper async iterator → pipeline can `await yield()` between sections).

### 5.3 `PdfChunkExtractor`

**`listSections`:**
1. `const outline = await pdfDoc.getOutline()` → flatten to ordered list of `{ pageDest, title }`.
2. If `outline.length === 0`: single synthetic section `{ id: SectionId('__whole_book__'), title: book.title, range: { kind: 'pdf', startPage: 1, endPage: pdfDoc.numPages } }`.
3. Else: for each entry, `endPage = nextEntry?.startPage - 1 ?? pdfDoc.numPages`. `id = SectionId('pdf:' + startPage + ':' + slugify(title))` — matches the section-ID composition rule in §4.2.

**`streamParagraphs`** — two-pass within the section's page range:

Pass 1: collect text for boilerplate detection across all section pages.
```ts
const allPagesText: string[][] = [];
for (let p = startPage; p <= endPage; p++) {
  const page = await pdfDoc.getPage(p);
  const items = (await page.getTextContent()).items as PdfItem[];
  const lines = groupItemsIntoLines(items);
  allPagesText.push(lines.map(l => l.text));
}
const boilerplate = detectRunningHeadersFooters(allPagesText);  // Set<string>
```

Pass 2: emit paragraphs.
```ts
for (let p = startPage; p <= endPage; p++) {
  const page = await pdfDoc.getPage(p);
  const items = (await page.getTextContent()).items as PdfItem[];
  const lines = groupItemsIntoLines(items);
  const paragraphs = groupLinesIntoParagraphs(lines);
  for (const para of paragraphs) {
    if (isPageNumberOnly(para.text)) continue;
    if (boilerplate.has(para.text.trim())) continue;
    const dehyphenated = dehyphenateWordWraps(para.text);
    yield {
      text: dehyphenated,
      locationAnchor: { kind: 'pdf', page: p },
    };
  }
}
```

Memory cost ≈ size of plain text in the section (a few hundred KB even for big books).

### 5.4 PDF pure helpers

```ts
// src/features/library/indexing/pdfHelpers.ts

export function groupItemsIntoLines(items: PdfItem[]): PdfLine[];
//  Groups by y-position (transform[5]) with ±2px jitter tolerance;
//  items in the same y-bucket sorted by x then joined with ' '.

export function groupLinesIntoParagraphs(lines: PdfLine[]): PdfParagraph[];
//  Paragraph break when vertical gap to the previous line > 1.5 × the
//  section's median line height, OR when x-indent shifts > 5% of page width.

export function dehyphenateWordWraps(text: string): string;
//  "fooba-\nseline" → "fooba seline" only if a true line-break;
//  "foo-\nbar" → "foobar" if the next char is lowercase (typical word-wrap).
//  Hyphens that end a sentence/clause are preserved (next char uppercase or punct).

export function detectRunningHeadersFooters(pageTexts: readonly string[][]): Set<string>;
//  For sections of ≥ 4 pages, returns the set of line-strings that appear
//  on > 50% of pages (post-normalize). Smaller sections: returns empty set
//  (insufficient sample).

export function isPageNumberOnly(s: string): boolean;
//  /^\s*\d+\s*$/ or /^\s*[ivxlcdm]+\s*$/i (roman numerals).
```

All five are pure, deterministic, and testable in isolation — same pattern as `pdfPassageWindows.ts` from 4.4.

### 5.5 Shared chunker (`paragraphsToChunks`)

```ts
// src/features/library/indexing/paragraphsToChunks.ts

const MAX_CHUNK_TOKENS = 400;

export async function paragraphsToChunks(input: {
  paragraphs: AsyncIterable<ExtractedParagraph>;
  bookId: BookId;
  sectionId: SectionId;
  sectionTitle: string;
  chunkerVersion: number;
}): Promise<readonly TextChunk[]>;
```

Algorithm:
1. Pull paragraphs from the async iterable into a buffer.
2. **Greedy-pack**: starting from the next un-packed paragraph, accumulate paragraphs until adding the next one would exceed `MAX_CHUNK_TOKENS`. Emit the accumulated set as one chunk.
3. **Single-paragraph overflow**: if a paragraph alone exceeds `MAX_CHUNK_TOKENS`, split at sentence boundaries (`/(?<=[.!?])\s+(?=[A-Z])/`) into pieces of ≤ MAX_CHUNK_TOKENS. Each piece becomes its own chunk.
4. **Single-sentence overflow** (extremely rare): split at the cap mid-sentence. Documented limitation.
5. For each emitted chunk:
   - `text` = paragraphs joined with `'\n\n'`.
   - `normalizedText` = `normalizeChunkText(text)`.
   - `tokenEstimate` = `tokenEstimate(normalizedText)`.
   - `locationAnchor` = first paragraph's anchor.
   - `checksum` = `sha256(normalizedText)` (Web Crypto SubtleCrypto).
   - `chunkerVersion` = passed in.
   - `id` = `ChunkId('chunk-' + bookId + '-' + sectionId + '-' + chunkIndexInSection)` (stable across reruns).

### 5.6 Edge cases & documented limitations

- **Multi-column PDFs** — y-position grouping treats columns as one giant line if items share y. Documented as best-effort; chunks may be jumbled. Future polish (column-x-clustering) deferred.
- **Image-only / scanned PDFs** — `getTextContent()` returns empty items. Section yields nothing for those pages. If the whole book yields nothing, pipeline writes `failed: 'no-text-found'`. (No OCR in 5.1.)
- **EPUB with `<div>`-only paragraphs** (no `<p>`) — uncommon. The TreeWalker filter could be widened to include `<div>`s with only text content; deferring to v2 unless real fixtures show it's common.
- **Single-section runs > 200 chunks** — possible for a 300-page chapterless PDF. Acceptable.
- **Encrypted/DRM PDF** — pdfjs throws → `failed: 'extract-failed'` honestly surfaces.
- **Very short PDF (< 4 pages)** — running header/footer detection is a no-op (insufficient sample). Some boilerplate may leak through. Acceptable.

---

## 6. Pipeline implementation

### 6.1 Per-book pipeline

```ts
async function runIndexing(book: Book, signal: AbortSignal): Promise<void> {
  const extractor = book.format === 'epub' ? epubExtractor : pdfExtractor;
  try {
    await booksRepo.updateIndexingStatus(book.id, { kind: 'chunking', progressPercent: 0 });

    const sections = await extractor.listSections(book);
    if (sections.length === 0) {
      await booksRepo.updateIndexingStatus(book.id, {
        kind: 'failed',
        reason: 'no-text-found',
      });
      return;
    }

    for (let i = 0; i < sections.length; i++) {
      if (signal.aborted) return;
      const section = sections[i]!;

      const alreadyDone = await chunksRepo.hasChunksFor(book.id, section.id);
      if (!alreadyDone) {
        const paragraphs = extractor.streamParagraphs(book, section);
        const drafts = await paragraphsToChunks({
          paragraphs,
          bookId: book.id,
          sectionId: section.id,
          sectionTitle: section.title,
          chunkerVersion: CHUNKER_VERSION,
        });
        await chunksRepo.upsertMany(drafts);
      }

      const progressPercent = Math.round(((i + 1) / sections.length) * 100);
      await booksRepo.updateIndexingStatus(book.id, { kind: 'chunking', progressPercent });
      await yieldToBrowser();
    }

    await booksRepo.updateIndexingStatus(book.id, { kind: 'ready' });
  } catch (err) {
    if (signal.aborted) return;
    await booksRepo.updateIndexingStatus(book.id, {
      kind: 'failed',
      reason: classifyError(err),
    });
  }
}

const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));
```

### 6.2 Queue (concurrency = 1)

```ts
export class IndexingQueue {
  private inFlightBookId: BookId | null = null;
  private pending = new Set<BookId>();
  private aborts = new Map<BookId, AbortController>();

  constructor(
    private readonly booksRepo: BooksRepository,
    private readonly chunksRepo: BookChunksRepository,
  ) {}

  enqueue(bookId: BookId): void {
    if (bookId === this.inFlightBookId) return;
    this.pending.add(bookId);
    void this.drain();
  }

  cancel(bookId: BookId): void {
    this.pending.delete(bookId);
    this.aborts.get(bookId)?.abort();
  }

  async rebuild(bookId: BookId): Promise<void> {
    this.cancel(bookId);
    await this.chunksRepo.deleteByBook(bookId);
    await this.booksRepo.updateIndexingStatus(bookId, { kind: 'pending' });
    this.enqueue(bookId);
  }

  async onAppOpen(): Promise<void> {
    const staleBookIds = await this.chunksRepo.countStaleVersions(CHUNKER_VERSION);
    for (const id of staleBookIds) {
      await this.chunksRepo.deleteByBook(id);
      await this.booksRepo.updateIndexingStatus(id, { kind: 'pending' });
    }
    const all = await this.booksRepo.listAll();
    for (const book of all) {
      const k = book.indexingStatus.kind;
      if (k === 'pending' || k === 'chunking') this.enqueue(book.id);
    }
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0 && this.inFlightBookId === null) {
      const next = this.pending.values().next().value!;
      this.pending.delete(next);
      this.inFlightBookId = next;

      const ctrl = new AbortController();
      this.aborts.set(next, ctrl);

      try {
        const book = await this.booksRepo.getById(next);
        if (book) {
          await runIndexing(book, ctrl.signal, {
            booksRepo: this.booksRepo,
            chunksRepo: this.chunksRepo,
          });
        }
      } finally {
        this.aborts.delete(next);
        this.inFlightBookId = null;
      }
    }
  }
}
```

Note: `runIndexing` (§6.1) takes `{booksRepo, chunksRepo}` as a third parameter so the function stays testable without module-scope dependencies. The signature in §6.1 is shorthand; the full signature is:

```ts
async function runIndexing(
  book: Book,
  signal: AbortSignal,
  deps: { booksRepo: BooksRepository; chunksRepo: BookChunksRepository },
): Promise<void>
```

Single-flight per book; sequential across books.

### 6.3 App-open resume scan

`IndexingQueue.onAppOpen()` (defined in §6.2) is invoked once from `useIndexing`'s mount effect. Two passes:

1. **Stale-version cleanup**: `chunksRepo.countStaleVersions(CHUNKER_VERSION)` returns book IDs with chunks below the current version. For each, drop chunks + mark status `pending`.
2. **Resume non-terminal**: scan `booksRepo.listAll()` for books with `indexingStatus.kind ∈ {pending, chunking}` and enqueue.

The `'chunking'` re-entry case is fine: the per-section `hasChunksFor` check (§6.1) skips already-done sections, so a book that was 60% done when the tab closed picks up at section 7.

### 6.4 `useIndexing` hook

```ts
export function useIndexing({
  booksRepo,
  chunksRepo,
}: Args): UseIndexingHandle {
  const queueRef = useRef<IndexingQueue | null>(null);

  if (queueRef.current === null) {
    queueRef.current = new IndexingQueue(booksRepo, chunksRepo);
  }
  const queue = queueRef.current;

  useEffect(() => {
    void queue.onAppOpen();
  }, [queue]);

  return {
    enqueue: (id) => queue.enqueue(id),
    rebuild: (id) => queue.rebuild(id),
    cancel: (id) => queue.cancel(id),
  };
}
```

`App.tsx` calls `useIndexing(...)` once and threads `enqueue`/`rebuild`/`cancel` into the import flow, the inspector modal, and the cascade.

### 6.5 Trigger surfaces

The pipeline is dispatched at exactly four points:

1. **On import success** — `LibraryImport` calls `indexing.enqueue(bookId)` once the new `Book` record is fully persisted.
2. **On app open** — `useIndexing`'s mount effect runs the resume scan (§6.3).
3. **On manual Rebuild** — `IndexInspectorModal`'s "Rebuild index" button calls `indexing.rebuild(bookId)`.
4. **On stale-version detection** — same app-open scan; stale-version books are dropped + marked `pending` + enqueued.

No reactive book-store subscription. Imperative enqueue at known trigger sites.

### 6.6 Error classification

```ts
// src/features/library/indexing/classifyError.ts
export type FailReason =
  | 'extract-failed'
  | 'no-text-found'
  | 'persist-failed'
  | 'unknown';

export function classifyError(err: unknown): FailReason {
  // Checks err.name / err.code / instanceof against known pdfjs / foliate /
  // IDB error shapes. Falls through to 'unknown'.
}
```

Logging: each `failed` write is preceded by `console.warn('[indexing]', err)`. No telemetry.

### 6.7 What's *not* in the pipeline (deferred)

- Retry-on-failure (a `failed` book stays failed; user-driven Retry only).
- Partial-section recovery (sections are atomic).
- Cross-tab coordination via BroadcastChannel.
- Backpressure / queue size limits.

---

## 7. UI surfaces

### 7.1 `BookCardIndexingStatus`

Embedded in the existing library card after the import-status row. Reads `book.indexingStatus`:

| State | Visual | Action |
|---|---|---|
| `pending` | small dot + `"Queued for indexing"` muted text | none |
| `chunking{progressPercent}` | `<progress>` bar + `"Indexing… {n}%"` | none |
| `embedding{...}` (forward-compat label) | `"Preparing for AI…"` | none |
| `ready` | small checkmark icon + clickable `"Index inspector"` link | opens modal |
| `failed{reason}` | warning icon + `"Couldn't index"` + `Retry` link + tooltip with `reason` | retry calls `useIndexing.rebuild` |

Visual treatment: secondary, low-contrast — reading is the headline; indexing is just-there-when-you-look.

### 7.2 `IndexInspectorModal`

Opens from the `"Index inspector"` link. Reuses settings' modal pattern (focus trap, ESC dismiss, focus restoration).

```
┌─ Index inspector — Pride and Prejudice ───────────[ × ]─┐
│                                                          │
│  87 chunks · 24 sections · v1 chunker · ~18,432 tokens   │
│  Last indexed 2026-05-06 14:22                           │
│                                          [ Rebuild index ]│
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ #1 of 87  ·  Chapter 1  ·  ~412 tk                  │ │
│  │ It is a truth universally acknowledged that a sin…  │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ #2 of 87  ·  Chapter 1  ·  ~387 tk                  │ │
│  │ However little known the feelings or views of such… │ │
│  └─────────────────────────────────────────────────────┘ │
│   …                                                      │
└──────────────────────────────────────────────────────────┘
```

**Header** — derived from chunks: chunk count, distinct section count, chunker version, total tokens; last-indexed timestamp = newest chunk's write time. `Rebuild index` is right-aligned; click → confirmation prompt → `useIndexing.rebuild(bookId)` → modal closes.

**Rows** — sorted by `id` (chunk-index-within-book = section emission order = reading order). Each row: `#N of M · sectionTitle · ~Ntk` + ~80-char preview from `normalizedText`. Click toggles `expanded` state; expanded row shows full `normalizedText` in a `<pre>` block.

**Edge states:**
- Race (modal opened during chunking): `"Indexing in progress (45%)…"`; re-fetch when status flips to `ready`.
- 0 chunks but `ready` (shouldn't happen — would have written `failed: 'no-text-found'`): `"No chunks were generated."` + `Rebuild`.

### 7.3 Component layout

```
src/features/library/indexing/
  BookCardIndexingStatus.tsx (+test)
  IndexInspectorModal.tsx (+test)
  IndexInspectorChunkRow.tsx (+test)
  indexing-inspector.css
```

Only `BookCardIndexingStatus` touches existing library code.

### 7.4 Wiring

`App.tsx`:
- Calls `useIndexing(...)` once.
- Owns a single `inspectorBookId: BookId | null` state.
- Passes `onOpenInspector(bookId)` and `onRetry(bookId)` down through `LibraryChrome` to each card.
- When `inspectorBookId !== null`, mounts `<IndexInspectorModal />` with chunks fetched via `chunksRepo.listByBook(inspectorBookId)`.

Modal closes by setting `inspectorBookId = null`; rebuild goes through `useIndexing.rebuild(...)`.

### 7.5 Accessibility

- Modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the title heading; ESC dismisses; focus trap; opening element regains focus on close.
- Progress bar: `<progress max="100" value={percent} aria-label="Indexing">`.
- Failure tooltip: `Retry` button with `aria-describedby` pointing at the (visually hidden when collapsed) reason text.
- Chunk-row toggle: button with `aria-expanded`; full-text panel has `id` referenced by the button's `aria-controls`.
- Status icon-only affordances always have `aria-label` (`"Indexed"`, `"Indexing 45%"`, `"Indexing failed: extract-failed"`).

---

## 8. Cross-feature integration

- **`useReaderHost.onRemoveBook`** gains `indexing.cancel(bookId)` at the top + `await bookChunksRepo.deleteByBook(bookId)` after the existing chat-related deletions.
- **Library import flow** (`useReaderHost.handleImport` or wherever the post-import `setBooks` happens): after the new `Book` record is persisted to IDB, call `indexing.enqueue(book.id)`. The call site is the same one that already updates `lastOpenedAt` / clears the import-loading state. Concrete file location confirmed at commit 14; if the import codepath has been restructured, the call moves to wherever the post-persist completion fires.
- **`App.tsx`** instantiates `useIndexing(...)` once + owns `inspectorBookId` state + threads `onOpenInspector` / `onRetry` / `onClose` through `LibraryChrome` and `IndexInspectorModal`.
- **`LibraryChrome` / per-card component**: new `<BookCardIndexingStatus />` slot in the existing card layout.
- **No `useReaderHost` API changes** beyond the cascade extension.
- **No reader contract changes.** Chunking happens via blob loads, not via the live reader.

---

## 9. Privacy & accessibility

### 9.1 Privacy doctrine reinforcement

Chunks are derived from book content the user already imported into their local IDB. Chunking is **purely local** — nothing leaves the device. The inspector lets the user verify exactly what got chunked from their book; in Phase 5.2, when retrieved chunks are sent to the AI, `PrivacyPreview` will surface them (separate from this inspector — that's per-message provenance vs. this per-book inspection).

### 9.2 Accessibility

Per §7.5 plus:
- All new interactive elements have visible focus rings using the existing focus token. AA contrast verified against the existing palette.
- `<progress>` with `aria-label` so screen readers announce percent transitions.
- Modal inherits the existing settings-modal accessibility (focus trap, ESC, focus restoration).

---

## 10. Testing strategy

### 10.1 Unit (Vitest)

**Pure helpers:**
- `paragraphsToChunks` — packing under cap, single-paragraph overflow split, sentence-fallback for huge paragraphs, chunk-ID stability, checksum determinism.
- `normalizeChunkText`, `tokenEstimate` (char/4 math).
- PDF helpers: `groupItemsIntoLines`, `groupLinesIntoParagraphs`, `dehyphenateWordWraps`, `detectRunningHeadersFooters`, `isPageNumberOnly`.
- `classifyError` — error → reason mapping.

**Imperative shell:**
- `IndexingQueue` — single-flight per bookId; sequential across; cancel-during-flight aborts; cancel-when-not-running is no-op; rebuild flow.
- `useIndexing` — onAppOpen scans + dispatches; rebuild deletes + re-pendings + enqueues; cancel propagates.
- `runIndexing` — happy path (mocked extractor); idempotent-resume skips done sections; abort returns without writing failed; error → failed{reason}.
- `BookChunksRepository` — round-trip with `fake-indexeddb`; normalizer drops malformed chunks while preserving siblings; `countStaleVersions`; `hasChunksFor`.

**Adapter shells (lifecycle-only):**
- `EpubChunkExtractor` — listSections from spine; throws cleanly when book unloaded; happy-path against fixture EPUB if happy-dom permits, else skipped.
- `PdfChunkExtractor` — listSections from outline; whole-book synthetic when outline empty; lifecycle errors.

**Components:**
- `BookCardIndexingStatus.test.tsx` — five status kinds; click handlers; tooltip content reflects `failed.reason`.
- `IndexInspectorModal.test.tsx` — header counts derived from chunks; rebuild calls handler; ESC closes; race state shows progress.
- `IndexInspectorChunkRow.test.tsx` — preview truncation; expand toggle; ARIA.

### 10.2 Integration (Vitest + happy-dom + fake-indexeddb)

One end-to-end-ish pipeline test that runs `runIndexing` against the fixture EPUB and an in-memory `BookChunksRepository`:
- All sections processed; total chunks > 0; every chunk has a valid `LocationAnchor`.
- Status transitions: `pending → chunking{...} → ready` in the books-repo's audit trail.
- Re-running with the same fixture is a no-op (idempotent resume short-circuits).

### 10.3 E2E (Playwright)

- `library-indexing-on-import.spec.ts` — import EPUB → see status transitions in the library card → "Index inspector" link appears → modal opens with chunks.
- `library-index-inspector.spec.ts` — open inspector → row count matches expected for fixture → expand a row → see full text → click Rebuild → confirm dialog → status flips to chunking → returns to ready.
- `library-indexing-resume.spec.ts` — start indexing → reload mid-flight → on next app open, status is still chunking → resumes and completes; IDB chunk count matches a fresh single-pass index of the same fixture (idempotent resume + no duplication).

### 10.4 Quality gate

`pnpm check` clean per commit. `pnpm test:e2e` runs before the docs commit.

---

## 11. File map

### 11.1 New (~30 source + test + style + e2e files)

```
src/features/library/indexing/
  CHUNKER_VERSION.ts
  classifyError.ts (+test)
  extractor.ts                              — interface
  normalize.ts (+test)                      — normalizeChunkText, tokenEstimate
  paragraphsToChunks.ts (+test)
  pdfHelpers.ts (+test)                     — line/paragraph grouping, dehyphenation, boilerplate
  EpubChunkExtractor.ts (+test)
  PdfChunkExtractor.ts (+test)
  pipeline.ts (+test)                       — runIndexing, yieldToBrowser
  IndexingQueue.ts (+test)
  useIndexing.ts (+test)
  BookCardIndexingStatus.tsx (+test)
  IndexInspectorModal.tsx (+test)
  IndexInspectorChunkRow.tsx (+test)
  indexing-inspector.css

src/storage/repositories/
  bookChunks.ts (+test)

e2e/
  library-indexing-on-import.spec.ts
  library-index-inspector.spec.ts
  library-indexing-resume.spec.ts
```

### 11.2 Modified

```
src/domain/book/types.ts                    (extend TextChunk: sectionTitle, chunkerVersion)
src/storage/db/schema.ts                    (v6 → v7: add book_chunks store + indexes)
src/storage/db/open.ts                      (v6 → v7 migration)
src/storage/index.ts                        (export BookChunksRepository, createBookChunksRepository)
src/features/reader/workspace/useReaderHost.ts (cascade — cancel + deleteByBook)
src/features/library/import/...             (call indexing.enqueue on import success)
src/app/App.tsx                             (useIndexing instantiation; inspectorBookId state; modal mount)
src/features/library/LibraryChrome.tsx      (slot for BookCardIndexingStatus)

docs/04-implementation-roadmap.md           (status block)
docs/02-system-architecture.md              (decision-history entry)
```

---

## 12. Commit slicing (Approach 2 — sliced commits)

Each commit independently green:

1. `feat(domain): chunks — extend TextChunk with sectionTitle + chunkerVersion`
2. `feat(storage): v7 migration — add book_chunks store with by-book + by-book-section indexes`
3. `feat(storage): BookChunksRepository — upsertMany, listByBook, listBySection, count*, hasChunksFor`
4. `feat(indexing): pure helpers — normalize, tokenEstimate, paragraphsToChunks (+ chunker version constant)`
5. `feat(indexing): PDF helpers — line/paragraph grouping, dehyphenation, boilerplate filter, page-number predicate`
6. `feat(indexing): ChunkExtractor contract + classifyError`
7. `feat(indexing): EpubChunkExtractor — foliate-js headless parse with JSZip+DOMParser fallback path`
8. `feat(indexing): PdfChunkExtractor — pdfjs outline + two-pass paragraph extraction`
9. `feat(indexing): runIndexing pipeline — status transitions, idempotent resume, abort handling`
10. `feat(indexing): IndexingQueue — single-flight per book, sequential across, cancel + rebuild`
11. `feat(indexing): useIndexing hook + onAppOpen scan (stale-version + non-terminal status)`
12. `feat(library): BookCardIndexingStatus — five-state status indicator`
13. `feat(library): IndexInspectorModal + IndexInspectorChunkRow`
14. `feat(app): wire indexing.enqueue on import + cascade integration + inspector modal mount`
15. `test(e2e): indexing on import + inspector + resume`
16. `docs: Phase 5.1 — architecture decision + roadmap status complete`

~16 commits.

---

## 13. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Foliate-js's headless API isn't usable as-is | Can't read EPUBs without rendering | Q9-D fallback (JSZip + DOMParser + foliate's CFI module re-exported via small wrapper); documented as implementation-time verification before commit 7 |
| PDF heuristics produce poor chunks for unusual layouts | Phase 5.2 retrieval quality lags for those books | Pure helpers fully unit-tested; multi-column documented as best-effort; user can always Rebuild after a chunker upgrade |
| Main-thread chunking causes UI jank for huge books | Reading feels stuttery during background indexing | Yield between sections (§6.1); profile a 10MB+ EPUB; promote to Web Worker if needed (pure refactor) |
| IDB quota exceeded during chunk persistence | Pipeline fails with `persist-failed` | Honest `failed.reason`; user sees the state; quota-management is broader than this phase (Phase 6 polish) |
| User imports 100 books at once | Queue backlog hours-long | Sequential is fine for v1; reading isn't blocked. Phase 6 polish can add concurrency = 2-3 if real-use shows pain |
| Chunker version bump triggers rebuild storm | All indexed books re-index on next app open | Acceptable v1; bounded by total book count × text length; staggered rebuild deferred until storm friction emerges |
| Two tabs running indexing on the same book | Both tabs write to `book_chunks` | IDB transactions serialize per-store; observed effect is one tab "wins" each section; both arrive at the same consistent final state. BroadcastChannel coordination deferred |
| PDF with no outline AND no detectable headings | Whole book chunked as one synthetic section | Acceptable; retrieval still works without per-chapter scoping. Chapter mode in 5.4 won't have meaningful chapter scoping for those books |
| Encrypted / DRM PDF | pdfjs throws | `failed: 'extract-failed'` honestly surfaces |
| Foliate spine entry with no `<p>` tags (only `<div>`) | Section yields zero paragraphs | If section has zero, downstream effect: book has fewer chunks. If whole book yields zero, `failed: 'no-text-found'`. Future fix: widen TreeWalker filter |
| Very short PDF (< 4 pages) | Boilerplate detector is no-op (insufficient sample) | Acceptable; some headers/footers may leak through. Documented |

---

## 14. Out of scope (explicit destinations)

| Deferred | Destination phase |
|---|---|
| Embeddings / vector storage | Phase 5.2 |
| Retrieval / ranking / chunk scoring | Phase 5.2 |
| Suggested prompts derived from chunks | Phase 5.3 |
| Chapter-mode prompt assembly using chunks | Phase 5.4 |
| Full-book attach mode | Phase 5+ |
| Concept graphs, glossaries, family trees, structured outputs | Phase 5+ |
| 5th right-rail tab for inspector | Revisit only if real-use shows it's wanted while reading |
| Web Worker promotion of the chunker | Pure refactor when profiling shows main-thread jank |
| Manual rebuild outside the inspector | YAGNI |
| Per-chunk timestamps | Chunks are derived data |
| OCR for image-only PDFs | Phase 6+ — separate pipeline |
| Multi-column PDF column detection | Best-effort in v1; future polish |
| Cross-tab BroadcastChannel coordination | Deferred until real-use shows races |
| Concurrent indexing across multiple books | Sequential is fine for v1 |
| Staggered rebuild on chunker-version bump | Bounded work; revisit if storm friction emerges |
| Filtering/searching within chunks in the inspector | Phase 5.2 retrieval offers this naturally |
| Per-section browse mode in the inspector (collapsible groups) | Future polish if long-book friction emerges |
| Chunk diff between rebuilds | Diagnostic; defer |
| Token-cost preview in the inspector | NanoGPT pricing data isn't reliably structured yet |

---

## 15. Validation checklist

Before declaring Phase 5.1 complete:

- [ ] All ~16 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new indexing suite plus all prior suites.
- [ ] Manual smoke: import a fixture EPUB → wait for `ready` → open inspector → confirm chunk count + previews look readable.
- [ ] Manual smoke: import a fixture PDF → same; verify boilerplate filter dropped page numbers / running headers.
- [ ] Manual smoke: reload mid-indexing → verify resume picks up at the next un-chunked section (observable in IDB chunk count).
- [ ] Manual smoke: rebuild from inspector → confirm chunks regenerate with the same checksums (deterministic).
- [ ] Manual smoke: remove a book during indexing → pipeline cancels cleanly; no orphaned `chunking` status; no leaked chunks.
- [ ] `docs/04-implementation-roadmap.md` Status block updated: `Phase 5.1 — complete (YYYY-MM-DD)`.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard complete per `08-agent-self-improvement.md` — minimum **22/27** for this risky/core foundational task.
