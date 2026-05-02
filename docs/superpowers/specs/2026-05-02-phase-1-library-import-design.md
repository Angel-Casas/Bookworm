# Phase 1 Design — Library + Import Core

- **Spec date:** 2026-05-02
- **Status:** Draft, awaiting user sign-off
- **Roadmap reference:** `docs/04-implementation-roadmap.md` Phase 1 (tasks 1.1, 1.2, 1.3)
- **Spec owner:** assistant + user (via brainstorming)

## Goal

Ship a polished, local-first library that a user can populate by dropping or picking EPUB/PDF files and that survives reloads. No reading, no annotations, no AI. The bookshelf is the first end-to-end product moment that proves the local-first promise.

## Locked decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Import scope | **Thin** — copy file to OPFS + extract title, author, cover, format, page-or-chapter count. No sections, no chunks, no TOC. |
| Import UX | Persistent drop affordance everywhere (empty state and bookshelf) + a small `+ Import` button in the bookshelf chrome. |
| Multi-file behaviour | Sequential queue with visible per-file progress. Failed imports stay in a persistent error tray until the user dismisses them. |
| Bookshelf direction | Floating cards on paper. Cover-less books render a cross-hatch placeholder with the title set in italic. |
| Sort / filter | Sort (recently opened, recently added, title, author) + free-text search by title or author. No format/unread filters in v1. |
| Duplicate handling | SHA-256 content checksum. Duplicates surface as a friendly "already in your library" tray entry with a "View existing" link; no second import. |

## Architecture overview

Phase 1 work spans three folders aligned with `docs/02-system-architecture.md`:

- `src/storage/` — imperative persistence shell. New: `adapters/idb.ts` (typed wrapper over `idb`), `adapters/opfs.ts` (read/write helpers, blob copy), `repositories/books.ts`, `repositories/settings.ts`, `migrations.ts`.
- `src/features/library/` — bookshelf UI, library state store (Zustand), search/sort selectors, the `LibraryEmptyState` evolved from Phase 0.
- `src/features/library/import/` — the import pipeline: per-file XState machine, dedicated worker, queue orchestrator hook, tray UI, drop overlay.

### New dependencies (3, all small)

- `idb` — Mozilla's IndexedDB promise wrapper. ~3 KB.
- `fflate` — tiny zip reader for EPUB metadata. ~9 KB. Avoids pulling in `foliate-js` until Phase 2 needs it for rendering.
- `pdfjs-dist` — locked in `02-system-architecture.md`; Phase 1 begins using it for PDF metadata + page-1 thumbnail.

### Worker boundary

A single dedicated worker handles parsing for one file at a time:

1. Compute SHA-256 over the bytes (WebCrypto)
2. Detect format via magic bytes (`%PDF-` or `PK\x03\x04` + EPUB OPF probe)
3. Extract format-specific metadata + cover bytes
4. Reply with a typed `ParseResponse`

The main thread owns the queue, the dedup query (read-only IndexedDB lookup against the checksum index), and all writes (OPFS file copy, IndexedDB book record). Failed imports leave no on-disk trace.

### State stores

- `libraryStore` (Zustand) — books loaded at boot, sort key (persisted), search query (ephemeral), derived `visibleBooks` selector, cover URL cache.
- `importStore` (Zustand) — queue with per-file status, error tray persistence within the session.

### State machines (XState v5)

One per-file `importMachine` actor per task, composed inside the import store's queue.

## Data model + persistence

### Domain type changes

Extending types already shipped in Phase 0:

```ts
// src/domain/import/types.ts
export type SourceRef = {
  readonly kind: SourceKind;
  readonly opfsPath: string;
  readonly originalName: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly checksum: string;          // NEW — SHA-256 hex
};

// src/domain/book/types.ts
export type Book = {
  // ... all Phase 0 fields ...
  readonly lastOpenedAt?: IsoTimestamp;   // NEW — undefined = never opened
};
```

Phase 1 always writes `importStatus: { kind: 'ready' }`, `indexingStatus: { kind: 'pending' }`, `aiProfileStatus: { kind: 'pending' }`, `toc: []`. Later phases populate these.

### IndexedDB schema (v1)

| Store | keyPath | Indexes |
|---|---|---|
| `books` | `id` | `by-checksum` (unique) on `source.checksum`; `by-created` on `createdAt`; `by-last-opened` on `lastOpenedAt` (sparse) |
| `settings` | `key` | none |

The library list is held in memory after a one-shot `getAll(books)` at boot, so sort and search run as in-memory selectors. The only index exercised on the hot path is `by-checksum` (dedup). Other indexes exist for future query-style needs.

The `settings` store holds key/value records. Phase 1 writes `{ key: 'librarySort', value: SortKey }` and `{ key: 'storagePersistResult', value: 'granted' | 'denied' }`.

### OPFS layout

```
books/
  <bookId>/
    source.epub | source.pdf
    cover.png | cover.jpg | cover.svg     (only if extracted)
```

Each book gets its own subdirectory keyed by UUID. Deletion is one `removeEntry({ recursive: true })` call.

### Cover loading

`Book.coverRef` is `{ kind: 'opfs', path: 'books/<id>/cover.<ext>' }` or `{ kind: 'none' }`. When a `BookCard` mounts, it asks `libraryStore.getCoverUrl(bookId)`: cached Object URL is returned instantly; otherwise the store reads the OPFS blob, creates the URL, caches it, and returns. URLs are revoked when a book is removed and on `pagehide`.

### Quota

On the first successful import, call `navigator.storage.persist()` once. Persist the boolean result to `settings`. If denied, surface a one-time gentle inline note in the import tray — non-blocking.

### Migrations

This spec ships the v1 baseline. The runner is `idb.openDB('bookworm', CURRENT_SCHEMA_VERSION, { upgrade(db, oldVersion, newVersion, tx) { ... } })` with explicit per-version cases registered in `storage/migrations.ts`. Phase 3 will add a v1→v2 migration for annotation stores.

### Repository pattern

```ts
// storage/repositories/books.ts
export type BookRepository = {
  getAll(): Promise<readonly Book[]>;
  getById(id: BookId): Promise<Book | undefined>;
  findByChecksum(checksum: string): Promise<Book | undefined>;
  put(book: Book): Promise<void>;
  delete(id: BookId): Promise<void>;
};

export function createBookRepository(db: BookwormDB): BookRepository { ... }
```

The repository is a pure factory returning an adapter object. UI never imports `idb` directly. Tests inject the in-memory variants.

## Import pipeline

### Per-file state machine

```
reading → hashing → dedupCheck ─┬─→ duplicate (final)
                                └─→ parsing → persisting → done (final)
                                                    │
              any stage's onError ─────────────────┴──→ failed (final)
```

Each state invokes a `fromPromise` actor:

| State | Actor | What it does |
|---|---|---|
| `reading` | `readBytes` | `file.arrayBuffer()` on main thread |
| `hashing` | `hashBytes` | `crypto.subtle.digest('SHA-256', bytes)` |
| `dedupCheck` | `findByChecksum` | `bookRepo.findByChecksum(hex)` — main thread, IDB read |
| `parsing` | `parseInWorker` | postMessage to worker; transfers the `ArrayBuffer` |
| `persisting` | `persistBook` | OPFS file + cover writes; IDB book record |

Every machine resolves to a typed final output:
```ts
| { kind: 'success'; book: Book }
| { kind: 'duplicate'; existingBookId: BookId }
| { kind: 'failure'; reason: string; fileName: string }
```

### Worker contract

```ts
type ParseRequest = {
  bytes: ArrayBuffer;       // transferred, not copied
  mimeType: string;
  originalName: string;
};

type ParseResponse =
  | { kind: 'ok'; metadata: ParsedMetadata }
  | { kind: 'error'; reason: string };

type ParsedMetadata = {
  format: BookFormat;
  title: string;            // falls back to filename without extension
  author?: string;
  pageOrChapterCount?: number;
  cover?: { bytes: ArrayBuffer; mimeType: string };
};
```

The worker uses **fflate** to read the EPUB zip → parse `META-INF/container.xml` → parse the OPF for `<dc:title>`, `<dc:creator>`, and the cover-image manifest item. For PDF it uses **pdf.js** to read the `/Info` dict and renders page 1 to a thumbnail canvas, encoded as PNG. **The worker performs no network I/O and accepts no inputs other than the parse request.**

### Queue orchestrator

`importStore` runs a sequential processor:

1. New file(s) drop in → push entries to `queue` with status `waiting`
2. If no machine is currently running, pop the next `waiting` entry and spawn an `importMachine` actor
3. On the machine's terminal output, update the entry's status (`done` / `duplicate` / `failed`) and pop the next waiting entry
4. Successful entries fade out of the tray after 2 seconds; duplicates linger 4 seconds with a "View existing" link that scrolls + briefly highlights the matched card; failures stay until the user dismisses or clears

### Drop overlay

Always mounted at the app root. Activates on the first `dragenter` whose `dataTransfer.types` includes `'Files'`. Same paper background, dimmed; brass-dotted rectangle (~80% viewport); serif copy *"Drop to add to your library"* with *"Files stay on this device."* below in subtle italic. A `dragenter`/`dragleave` counter handles nested-element flicker. Filename extension is checked on `drop` (case-insensitive `.epub` or `.pdf`); non-matching files become transient tray entries: *"`<name>` — only EPUB and PDF for now."*

### Error taxonomy

Failure reasons surfaced verbatim in the tray:

- *"Couldn't read this file."* — File API rejected
- *"Not a supported format."* — magic-bytes check failed
- *"This EPUB is missing its core file (`content.opf`)."* / *"This PDF couldn't be opened."* — format-specific parse fails
- *"Browser ran out of storage."* — OPFS / IDB `QuotaExceededError`. Suggest "Free up space or install Bookworm as a PWA"
- *"Unknown error — `<actual message>`."* — last resort; never silent

### Privacy invariant

From `File` → worker (transferred ArrayBuffer) → OPFS write, the bytes never leave the worker except as the OPFS write. No fetch, no XHR, no analytics, no logging of file content. The error tray captures filename + reason, never bytes.

## Bookshelf UI

### Component tree

```
<App>
  <CapabilityGate>
    <LibraryView>
      {hasBooks
        ? <LibraryWorkspace>
            <LibraryChrome>
              <LibrarySearchField/>
              <LibrarySortDropdown/>
              <ImportButton/>
            </LibraryChrome>
            <ImportTray/>              {/* mounted only while queue has activity */}
            <Bookshelf>
              {visibleBooks.map(b => <BookCard key={b.id} book={b}/>)}
            </Bookshelf>
          </LibraryWorkspace>
        : <LibraryEmptyState/>         {/* evolved from Phase 0 */}
      }
      <DropOverlay/>                   {/* always mounted */}
    </LibraryView>
  </CapabilityGate>
</App>
```

### Empty state evolution

The Phase 0 composition stays — mark, wordmark, tagline, hairline rule, privacy line — with one addition between the rule and the privacy line: a single italic serif text-button **"Import a book to begin."** that opens the native file picker. The drop overlay also activates here on drag.

### `BookCard`

Presentational, simple:

- 2:3 aspect cover with `--shadow-md` and `--radius-sm`
- Title in `--font-serif` at `--text-base`, max 2 lines with ellipsis
- Author in italic `--color-text-muted` at `--text-sm`, 1 line ellipsis
- Top-right `⋯` overflow icon, hidden until card hover (desktop) / always visible (touch). Click opens a 1-item popover: **"Remove from library"**
- Cover area is intentionally **not** clickable in Phase 1. No hover lift, no pointer cursor. Phase 2 adds the cover→reader interaction.
- Cover lazy-loads via `libraryStore.getCoverUrl(bookId)`
- Cover-less books render the cross-hatch placeholder with the title in italic centered

### `LibraryChrome`

Three layout zones on desktop:

- **Left** — small Bookworm wordmark in serif
- **Center** — search field, borderless, with a subtle `⌕` icon, expanding underline on focus, ~280px
- **Right** — sort dropdown ("Recently opened ⌄") and `+ Import` button

Sort options: *Recently opened*, *Recently added*, *Title (A→Z)*, *Author (A→Z)*. Selection persists to `settings`. Search is in-memory: substring match on title and author, case-insensitive, normalized for diacritics. The empty-result state ("No books match '<query>'.") is only shown when the search query is non-empty and the filtered list is empty.

### `ImportTray`

Slides down from the top of the bookshelf area when there's any activity:

- Header: *"Importing N books"* during run; *"Couldn't import 2 books"* / *"All N imported"* at end
- One row per file with status: spinner (waiting), progress arc (parsing), check (done), checksum-match icon (duplicate), warning icon (failed)
- Failed rows show the reason on a second line and a `Remove` button
- Successful rows fade out 2s after success; duplicates linger 4s with a *"View existing"* link; failures stay until dismissed
- Footer "Clear" link appears once everything is terminal; clicking it removes all remaining terminal entries (typically just the failures users have already read) and collapses the tray

### `DropOverlay`

Per the import-pipeline section.

### Loading state

App boot reads books from IndexedDB. If the read takes >200ms, the bookshelf area shows a single subtle line *"Reaching for your library..."* in italic muted serif, no spinner. Most reads are sub-50ms.

### Mobile (≤640px)

Chrome stacks vertically: wordmark + import button on row 1; search field full-width row 2; sort dropdown right-aligned row 3 (or inline with search if width allows). Grid drops to 2 columns at ≤480px, 3 columns at ≤640px. Drag-and-drop is desktop-only; the import button always opens the OS picker on mobile.

## Error handling & lifecycle edge cases

### App-boot failures

- IndexedDB `open()` rejects → render a one-screen `LibraryBootError` with the actual reason and a single "Reload" button. Never silently treat as "empty library."
- OPFS `getDirectory()` throws after the capability check passed → bookshelf renders normally; cover requests fall back to the cross-hatch placeholder.

### Concurrent imports of the same file

- In one batch: per-file machines run sequentially, so the second machine's `dedupCheck` finds the first's persisted record and resolves to `duplicate`.
- Across batches: same — sequential queue prevents the race.

### App close mid-import

A file in `persisting` that gets interrupted leaves either nothing on disk or an orphan in OPFS (file written, IDB record not). On next boot a startup sweep enumerates `books/<id>/` in OPFS, checks each `<id>` against IndexedDB, and removes orphan directories. Background pass, no UI.

### Removing a book

Two-step delete: IDB delete first, then OPFS recursive removal. If OPFS fails after IDB succeeds, the book is gone from the user's view; the orphan sweeper cleans the bytes on next boot. Console log on OPFS failure, no user alarm.

### Cover URL lifecycle

`Map<BookId, string>` of Object URLs in the library store. Revoked when a book is removed and on `pagehide` (best-effort). Repeat reads during a session reuse the cached URL.

### Sort tie-breakers

- *Recently opened* → `lastOpenedAt` desc, then `createdAt` desc, then `id` asc. Never-opened books sort to the bottom.
- *Recently added* → `createdAt` desc, then `id` asc.
- *Title (A→Z)* → `title` (locale-compare, case-insensitive), then `createdAt` desc.
- *Author (A→Z)* → `author ?? ''` (locale-compare), then `title`, then `id`.

### Search normalization

Both the query and the search corpus run through:
```ts
s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
```
Empty query returns the sorted list unfiltered.

### Settings persistence

A single `librarySort` key in the `settings` store. Writes debounced 200 ms. Boot default is *Recently opened*.

### File-size headroom

No hard limit. The import attempt runs and `QuotaExceededError` surfaces naturally as the *"Browser ran out of storage"* error.

## Testing strategy

### Unit (Vitest)

- **`importMachine`** — every transition path with `createActor`, including failure injection at each invoked actor
- **Library selectors** — sort with all four keys including tie-breakers, search across diacritic / case variants, empty-query passthrough
- **Format detection** — magic-byte sniffer against well-formed, malformed, and disguised inputs
- **EPUB metadata parser** — runs against an in-memory zip built with fflate; validates extraction and missing-OPF failure
- **PDF metadata parser** — runs against a synthetic minimal PDF; validates `/Info` and page-1 thumbnail render
- **Migration runner** — apply v1 to a fresh `fake-indexeddb` DB, assert exact schema
- **Cover URL cache** — Object URL reuse on repeat reads, single revocation on remove

### Integration (Vitest, `happy-dom` + `fake-indexeddb` + in-memory OPFS adapter)

- Drop a fixture EPUB → repository round-trip → bookshelf renders the book
- Drop the same EPUB twice → second resolves `duplicate`, no second OPFS or IDB write
- Remove a book → orphan sweeper run on next boot leaves no OPFS folders
- Drop a malformed file → tray entry with right reason, no IDB or OPFS writes

### Adapter shape

```ts
type OpfsAdapter = {
  writeFile(path: string, blob: Blob): Promise<void>;
  readFile(path: string): Promise<Blob | undefined>;
  removeRecursive(path: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
};
```

Tests inject the in-memory variant; production wires the real one. The repositories never touch `idb` or OPFS directly outside the adapters.

### E2E (Playwright)

- Drop a small EPUB fixture using `page.setInputFiles()` against a hidden `<input type="file">`
- Verify the new book appears in the bookshelf, sorted to the top under *Recently added*
- Drop the same file again — verify the duplicate tray message and the "View existing" highlight
- Drop a malformed file — verify failure tray, dismiss
- Type in the search field — verify books filter and the "no matches" empty result
- Reload the page — library is restored exactly
- Remove a book via `⋯` menu — gone after reload; OPFS doesn't grow

### Golden fixtures

Committed to `test-fixtures/` with a `README.md` documenting provenance + license:

- `small-pride-and-prejudice.epub` — Project Gutenberg, public domain (the one binary fixture, with explicit attribution and source URL in the README)
- `text-friendly.pdf` — generated by `scripts/fixtures/build-pdf.ts` (reproducible)
- `malformed-missing-opf.epub` — generated; an EPUB zip without `META-INF/container.xml`
- `not-a-book.txt` — a plain text file for the unsupported-format test

### Coverage targets

- Domain logic + selectors + state machine: high (every transition exercised)
- UI components: visual confidence via E2E + a few component tests for tricky pieces (search field, ⋯ menu)
- Adapters: thin, exercised via integration tests rather than unit tests

## Out of scope

| Capability | Where it lands |
|---|---|
| Opening a book to read | Phase 2 (reader) |
| TOC extraction | Phase 2 — extracted lazily on first reader open |
| Section / chunk / normalized-text generation | Phase 5 (indexing + retrieval) |
| AI profile + prompt suggestions | Phase 5 |
| Bookmarks, highlights, notes | Phase 3 (annotations) |
| AI chat, model catalog, API key handling | Phase 4 |
| Three-pane reader workspace | Phase 2 |
| `foliate-js` integration | Phase 2 — Phase 1 only uses fflate + small OPF parser |
| Theme toggle, typography controls, accessibility audit | Phase 6 (polish) |
| PWA "update available" prompt UI | Phase 6 |
| Format filter, unread filter, "has highlights" filter | Phase 3 (after annotations exist) |
| Multi-select / bulk actions, drag-to-reorder | Phase 6 if validated; otherwise dropped |
| Linked-folder import (`Link folder (beta)`) | Deferred — Phase 1 ships the manual-import path only |
| MOBI support | Deferred / experimental per the PRD |
| OCR for scanned PDFs | Explicit non-goal in the PRD |
| Custom shelves / collections | Phase 7 deferred candidate |
| Cloud sync, export | Non-goal per architecture doc |

Phase 1 also explicitly does **not**:

- Pre-validate file size or format before letting the import attempt run
- Cache richer-than-static PDF cover thumbnails (no live re-render on theme change)
- Persist search query or scroll position across reloads — search input clears on every page load; sort persists via the `settings` store
- Implement keyboard shortcuts beyond platform defaults

## Acceptance criteria

Mapping back to the roadmap (`docs/04-implementation-roadmap.md`):

- **Task 1.1 — Import pipeline skeleton.** Users can drop or pick EPUB/PDF files. Unsupported files fail gracefully with an honest reason in the tray. Import status is visible per-file. Imported books survive reload.
- **Task 1.2 — Bookshelf UI.** Library feels polished at desktop and mobile sizes. Cards show cover/title/author. Empty state is intentional (the evolved Phase 0 composition with the import affordance). Loading and search-no-results states are present.
- **Task 1.3 — Persistence baseline.** Reload restores the library fully. Schema is v1; migration runner is registered and tested.

## Risks / open questions

- **fflate footprint and EPUB edge cases.** Some EPUB authors produce unusual zip structures (deflate64, encrypted entries). Phase 1 will accept what fflate accepts; everything else surfaces as the "not a valid EPUB" tray entry. We accept this trade-off in v1.
- **PDF.js worker cost on mobile.** PDF.js spins up its own worker thread. On low-end mobile devices this could be slow. The import is sequential and the user sees per-file progress, so latency is honest, not silent.
- **OPFS quota predictability.** Browser quota varies. We surface `QuotaExceededError` honestly but don't pre-validate. If this becomes a real source of frustration in usage, Phase 6 polish can add a "Storage" settings page.
- **Project Gutenberg fixture license.** Public domain in the U.S.; fine to commit. README documents this explicitly.

## Decision log

- **2026-05-02** — Spec drafted from brainstorming session.
