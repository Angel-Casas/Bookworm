# System Architecture

## Architecture summary
We will build a frontend-only, local-first PWA with a functional core and an imperative shell.

### Functional core
Pure, testable logic:
- book normalization
- chunking
- prompt assembly
- token estimation
- retrieval ranking
- annotation transformations
- selectors
- reducers
- state transitions
- migrations

### Imperative shell
Side-effect boundaries:
- file picking
- file parsing adapters
- storage reads/writes
- service worker
- network calls to NanoGPT
- streaming response handling
- reader engine integration
- animations
- install/persistence prompts

## Top-level module map
- `app/`
- `library/`
- `reader/`
- `annotations/`
- `ai/`
- `search/`
- `storage/`
- `settings/`
- `design-system/`
- `pwa/`
- `test-fixtures/`

## Technical stack
*Locked 2026-05-02. See Decision history for changes.*

### Core
- React
- TypeScript (strict)
- Vite

### Styling
- vanilla CSS + CSS variables
- typed design tokens in `tokens.ts`
- no CSS-in-JS, no utility-class framework

### State
- App state separated into:
  - persisted domain state
  - transient UI state
  - async request state
- Zustand for slice stores
- XState for explicit flow machines: import, indexing, chat-request, reader-load, persistence/migration

### Storage
- IndexedDB for structured records, indexes, annotations, chat history, settings, and small blobs
- OPFS for original imported files and large derived assets (extracted text, cached covers, etc.)
- Embeddings stored as `Float32Array` records in IndexedDB; cosine similarity search runs in a Web Worker

### Reader engines
- EPUB: `foliate-js` (wrapped behind an adapter)
- PDF: `pdf.js` (wrapped behind an adapter)
- Adapters expose only the domain-shaped API; library specifics never leak into domain modules

### PWA tooling
- `vite-plugin-pwa` (Workbox) for service-worker generation and offline shell

### Hosting
- GitHub Pages (static)

### Testing
- Vitest for unit tests
- React Testing Library for component tests
- Playwright for end-to-end tests
- versioned golden fixture library (small/large EPUB, text-friendly PDF, complex-layout PDF, malformed file, weird TOC file)

## Local-first storage strategy
### Store locally
- book metadata
- covers
- extracted text
- chapter structure / TOC
- chunks
- bookmarks
- highlights
- notes
- AI prompt suggestions
- AI threads
- local embeddings
- settings
- optional saved API key

### Recommended storage split
#### IndexedDB
Use for:
- metadata
- normalized entities
- annotations
- chat history
- settings
- smaller blobs
- indexes

#### OPFS
Use for:
- original files
- derived assets
- large extracted text artifacts
- large cached resources

## Import strategy
### Primary flow
- User imports one or more files manually
- App copies needed data into local storage
- App extracts metadata and cover where possible
- App generates normalized sections/chunks
- App generates searchable text representation

### Enhanced desktop flow
- Optional "Link folder (beta)" path on supported browsers
- This is convenience only, never the only import path

## Reader architecture
### Desktop
Three-pane workspace:
1. left rail: TOC / bookmarks / highlights
2. center: book reader
3. right rail: AI / notes / inspector

### Mobile
Single-focus reader with slide-up panels:
- reading surface first
- bottom sheets / segmented panels for:
  - contents
  - notes
  - chat

## Domain entities
### Book
- id
- title
- subtitle
- author
- format
- description
- coverRef
- toc
- progress
- sourceKind
- sourceRef
- importStatus
- indexingStatus
- aiProfileStatus
- createdAt
- updatedAt

### BookSection
- id
- bookId
- title
- order
- locationStart
- locationEnd
- previewText

### TextChunk
- id
- bookId
- sectionId
- text
- normalizedText
- tokenEstimate
- locationAnchor
- checksum

### Bookmark
- id
- bookId
- locationAnchor
- note
- createdAt

### Highlight
- id
- bookId
- locationAnchor
- selectedText
- normalizedText
- color
- tags
- createdAt

### Note
- id
- bookId
- anchorRef
- content
- createdAt
- updatedAt

### ChatThread
- id
- bookId
- title
- modelId
- mode
- createdAt
- updatedAt

### ChatMessage
- id
- threadId
- role
- content
- contextRefs
- usage
- createdAt

### PromptSuggestionSet
- id
- bookId
- version
- prompts
- createdAt

### AIProfile
- id
- bookId
- summaryShort
- summaryLong
- themes
- entities
- concepts
- genreGuess
- difficulty
- createdAt

## State boundaries
### Persisted
- library
- reading progress
- notes
- highlights
- AI threads
- model preferences
- prompt suggestions

### Ephemeral
- current selection
- current context builder draft
- streaming output
- panel visibility
- hover/focus UI
- in-progress forms

## Reliability rules
- All schema changes must use explicit migrations
- All external parser output must be normalized
- All file imports must be resumable or safely restartable
- All AI requests must be replay-safe at the UI level
- Every destructive action must be reversible or confirmed

## Performance principles
- do not block the main thread with heavy parsing when avoidable
- chunk and index incrementally
- lazily compute derived views
- virtualize long lists
- avoid rerender cascades in the reader
- precompute lightweight previews
- keep animation GPU-friendly and minimal

## Privacy architecture
- books are local by default
- AI requests are user-triggered
- app shows selected context before send
- API key storage is opt-in
- session-only mode is the default (key kept in memory only)
- "remember on this device" mode encrypts the key with a user passphrase via WebCrypto (PBKDF2 → AES-GCM); the passphrase is never persisted, and the user must re-enter it to unlock the key after each cold start

## PWA architecture
- installable shell
- offline-capable app shell
- local library available offline
- graceful degradation if some browser APIs are unavailable

## Architecture constraints
- no backend in v1
- no server-side search
- no server-side vector database
- no hard dependency on folder access APIs
- no hidden synchronization

## Browser support floor
Modern, OPFS-capable browsers only:
- Chromium 86+
- Safari 15.2+
- Firefox 111+

No fallback path for older browsers in v1. May be revisited later.

## Decision history
### 2026-05-04 — Phase 3.3 notes

- New `notes` IndexedDB store at v5 (additive migration). `NotesRepository`
  mirrors the `bookmarks`/`highlights` validating-reads pattern. Two indexes:
  `by-book` (panel load) and `by-highlight` (unique; cascade lookup +
  one-note-per-highlight invariant enforced at the storage layer via the
  unique constraint). Repo `upsert` uses `put` so writes are create-or-replace
  by primary id, which keeps the unique constraint stable across edits.
- Domain types `Note` and `NoteAnchorRef` (pre-existing) are now consumed for
  the first time. v1 only writes `NoteAnchorRef.kind === 'highlight'`; the
  `'location'` variant remains for forward-compat (location-anchored notes
  deferred — will likely surface in 3.4 or later).
- Note-from-selection auto-creates a yellow highlight under the hood and
  opens an inline `NoteEditor` anchored to the selection. This makes "add
  note to passage" a one-tap gesture and keeps the data model at one anchor
  shape for v1.
- `NoteEditor` is a pure presentational component: plain text (no markdown,
  no XSS surface), soft 2000-char cap (counter visible above 1600, red
  above 2000, no hard block), autosave-on-blur, Esc cancels. Used in two
  parents: an anchored overlay rendered by `ReaderWorkspace`, and an inline
  expansion within each `HighlightsPanel` row.
- `HighlightsPanel` rows show notes inline below the highlight snippet —
  no overlay indicator on the rendered highlight in the reader, no
  4th tab. The note text *is* the indicator. Reader surface stays clean.
- Empty save deletes the note record; the highlight survives. This makes
  "clear text + blur" the deletion path and removes the need for a separate
  delete-note button. Highlight removal cascades the note via a new
  `useHighlights.onAfterRemove` callback that the workspace wires to
  `useNotes.clear`.
- Settings: new `noteEditorHintShown` boolean key, mirroring
  `focusModeHintShown`. The "Esc to discard" hint shows once per fresh
  install and persists on first dismissal.
- Cascade: `useReaderHost.onRemoveBook` adds `notesRepo.deleteByBook`
  after the highlights cascade.
- `useHighlights.add` widened from `Promise<void>` to `Promise<Highlight>`
  so the workspace can chain `.then((h) => setActiveNoteEditor(...))` for
  the one-tap note-from-selection path without re-deriving the highlight
  id from the in-memory list.
- No engine adapter changes. Notes are pure metadata over highlights;
  EpubReaderAdapter / PdfReaderAdapter / `BookReader` interface untouched.

### 2026-05-03 — Phase 3.2 highlights

- New `highlights` IndexedDB store at v4 (additive migration). `HighlightsRepository`
  mirrors the bookmark validating-reads pattern, with a stricter validator
  (drops records with bad `HighlightAnchor` shape or invalid `HighlightColor`).
- Refactored the previously-unused `Highlight` domain type: dropped
  `range: LocationRange` and `normalizedText`; added `HighlightAnchor`
  (discriminated union: `epub-cfi` with a CFI string that itself encodes a
  range, or `pdf` with `{page, rects: HighlightRect[]}` in PDF coordinate
  space) plus `sectionTitle: string | null`. Tags field stays as
  `readonly string[]` for forward-compat but is always `[]` in v1 (no tag UI).
- `BookReader` contract grows five methods: `loadHighlights` (bulk render),
  `addHighlight` (incremental upsert; same-id replaces for color changes),
  `removeHighlight`, `onSelectionChange`, `onHighlightTap`. New
  `SelectionInfo` type carries `{anchor, selectedText, screenRect}`. The
  workspace passes everything through `ReaderViewExposedState`.
- EPUB rendering uses foliate's `view.addAnnotation` + `Overlayer.highlight`
  drawer; the adapter listens for `'create-overlay'` (per-section ready) to
  attach a debounced `selectionchange` listener and re-add highlights for
  that section, plus `'show-annotation'` for taps. CFI ↔ id maps are
  maintained internally. Foliate ships untyped JS so the Overlayer import
  goes through a typed wrapper at `src/features/reader/epub/foliate-overlayer.ts`
  (declare module doesn't kick in under `moduleResolution: bundler` when the
  resolved JS exists).
- PDF rendering adds a new `.pdf-reader__highlight-layer` sibling of the
  text-layer in `PdfPageView`; the adapter populates it with absolutely-
  positioned `<div class="pdf-highlight" data-color="…" data-id="…">`
  elements. Selection events translate text-layer Range rects to PDF coords
  via `viewport.convertToPdfPoint`. Click handler reads `data-id` for tap.
- New `HighlightToolbar` component is a single floating pill used in two
  modes: `'create'` (just colors, on selection) and `'edit'` (colors with
  current pre-selected + a delete button, on tap). Position clamps to
  viewport so off-screen selections (e.g. text hidden behind a paginated
  EPUB column transform) still render a tappable toolbar. Dismisses on
  Escape, outside-click, or scroll.
- New `HighlightsPanel` joins `TocPanel` and `BookmarksPanel` as the third
  tab in the rail (desktop) or sheet (mobile). Each row has a colored bar
  on the left, section + relative time on top, selected text below, plus a
  hover-revealed color-pip menu (4 dots) and × button on the right.
- `useHighlights` hook owns the in-memory list and orchestrates optimistic
  add/changeColor/remove. List sorted via shared `compareHighlightsInBookOrder`
  (PDF: page → y → x; EPUB: CFI lex order; mixed kinds fall back to createdAt).
- Cascade: `useReaderHost.onRemoveBook` adds `highlightsRepo.deleteByBook`
  next to the bookmarks cascade.

### 2026-05-03 — Phase 3.1 bookmarks

- New `bookmarks` IndexedDB store at v3 (additive migration; existing
  v2 records untouched). `BookmarksRepository` mirrors the
  `readingProgress` validating-reads pattern: corrupt records are
  silently dropped, soft-validated by a `normalizeBookmark` helper.
- `Bookmark` shape: `{ id, bookId, anchor, snippet, sectionTitle, createdAt }`
  with `snippet` and `sectionTitle` nullable for graceful degradation
  (image-only PDFs, EPUB cover/whitespace pages). The `note?` field
  that used to live on `Bookmark` was dropped — Task 3.3 will introduce
  notes as their own type.
- `BookReader` contract grows two best-effort extractor methods:
  `getSnippetAt(anchor): Promise<string | null>` and
  `getSectionTitleAt(anchor): string | null`. EPUB caches the visible
  range + foliate-supplied `tocItem.label` from each `relocate` event,
  with a fallback to `view.renderer.getContents()[0].doc.body.textContent`
  when the visible range is whitespace. PDF pulls page text on demand
  via `getTextContent`. `ReaderViewExposedState` also gains a
  `getCurrentAnchor()` passthrough so workspace hooks never need a
  direct adapter reference.
- `DesktopRail` generalised from `{ toc, currentEntryId, onSelect }`
  to `{ tabs, activeKey, onTabChange }`; the workspace builds two
  tabs (Contents → `TocPanel`, Bookmarks → `BookmarksPanel`). Mobile
  reuses the same tab pattern inside the existing `MobileSheet` so
  the chrome stays uncluttered (one ☰ button reveals both panels).
- Bookmark add is optimistic: `useBookmarks.add` inserts immediately
  with `snippet:null`, then patches with the resolved snippet. Repo
  failures roll back the optimistic insert. Newest-first sort by
  `createdAt`.
- Book removal cascades: `useReaderHost.onRemoveBook` calls
  `bookmarksRepo.deleteByBook` alongside the existing
  `readingProgressRepo.delete` and OPFS cleanup.

### 2026-05-03 — Phase 2.3 reader workspace layout

- New `ReaderWorkspace` (`src/features/reader/workspace/`) composes the reader
  shell — chrome, desktop rail (left, TocPanel), bottom sheet (mobile, MobileSheet),
  focus mode, ReaderView. ReaderView slimmed to own only adapter lifecycle and
  exposes its state to the workspace via a new optional `onStateChange` prop.
- `App.tsx` extracted into three jobs: shell (App.tsx, ~190 lines including
  the boot promise), view routing (`useAppView`), reader hosting
  (`useReaderHost`). Boot eagerly resolves view + reader preferences +
  first-time-hint flag in parallel so the very first paint reflects persisted
  focus mode (no chrome flash on reload).
- Two-pane layout in v2.3: left rail + reader on desktop. Right rail deferred
  to Phase 3 when annotations have content for it — empty chrome is "dead
  chrome" and is explicitly prohibited by the design system.
- Typography lives in a sheet (`MobileSheet`) on **both** viewports. TOC is
  the rail on desktop, a sheet on mobile. Focus mode hides chrome AND rail
  for true immersion; top-edge hover (`HOVER_ZONE_PX=40`) reveals chrome,
  which auto-hides after `HIDE_DELAY_MS=1500` of no top-edge movement
  (timer fires regardless of where the cursor is, since the foliate-js
  iframe swallows mousemove inside the reading area).
- Focus mode + first-time-hint preferences use forward-compatible validator
  soften (no IDB schema bump).
- Decoupling: `useReaderHost.onFilesPicked` dispatches a
  `bookworm:files-picked` window event; App.tsx listens and feeds files to
  `importStore`. Keeps the hook free of app-level store knowledge.

### 2026-05-02 — Phase 0 stack lock-in
- Reader engines: foliate-js (EPUB), pdf.js (PDF)
- State management: Zustand + XState
- Styling: vanilla CSS + CSS variables + typed `tokens.ts`
- Testing: Vitest + React Testing Library + Playwright
- PWA: `vite-plugin-pwa` (Workbox)
- Hosting: GitHub Pages
- Browser floor: OPFS-capable only; no legacy fallback
- API key persistence: passphrase-encrypted via WebCrypto (PBKDF2 + AES-GCM) when "remember on device" is selected; session-only otherwise
- Embeddings: hand-rolled cosine in a Web Worker, Float32Array stored in IndexedDB
- NanoGPT integration: assumed OpenAI-compatible (`/v1/models`, `/v1/chat/completions`, `/v1/embeddings`); model catalog derived at runtime; "Fast / Balanced / Deep" presets map to live catalog entries
- Prompt caching: provider-style cache breakpoints (NanoGPT/Anthropic-compatible)

### 2026-05-02 — Phase 1 dependency additions
- `idb` for IndexedDB promise wrapping
- `fflate` for EPUB zip reading (no `foliate-js` until Phase 2)
- `pdfjs-dist` for PDF metadata + cover thumbnail (already locked in Phase 0; introduced now)

### 2026-05-03 — Phase 2.2 PDF reader adapter

- `PdfReaderAdapter` (sole `pdfjs-dist` consumer for rendering) implements the
  `BookReader` contract from Phase 2.1. No new dependencies — `pdfjs-dist@5.7.284`
  was already in the tree from Phase 1 metadata extraction; the same dedicated
  worker setup serves rendering.
- `ReaderPreferences.modeByFormat` extended with `pdf`. Forward-compatible
  validator soften (no IDB schema bump). Existing user theme/typography
  preferences from Phase 2.1 survive the v2.2 upgrade.
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

### 2026-05-03 — Phase 2.1 dependency additions and schema migration
- `foliate-js` pinned at `1.0.1` for EPUB rendering. Sole consumer:
  `src/features/reader/epub/EpubReaderAdapter.ts`. Mapping of foliate-js
  exports to our `BookReader` interface lives at
  `src/features/reader/epub/foliate-notes.md`.
- Schema bumped to v2: new `reading_progress` and `reader_preferences`
  IndexedDB stores. Existing `books` and `settings` stores untouched.
- Settings store gains a `view` key that persists library-vs-reader
  navigation across reloads (no router added — `App.tsx` extends its
  existing view-state pattern with a discriminated union).
- Reader location anchors and TOC entries reuse the Phase 1 domain
  types (`LocationAnchor` from `domain/locations.ts` with
  `kind: 'epub-cfi' | 'pdf'`, and `TocEntry` from `domain/book/types.ts`).
  No duplicate type definitions in `domain/reader/`.