# Implementation Roadmap

## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (2026-05-03)
- Phase 2 — complete (2026-05-03)
- Phase 3 — complete (2026-05-04)
- Phase 4.1 — complete (2026-05-04)
- Phase 4.2 — complete (2026-05-04)
- Phase 4.3 — complete (2026-05-05)
- Phase 4.4 — complete (2026-05-06)
- Phase 5.1 — complete (2026-05-06)
- Phase 5.2 — complete (2026-05-06)
- Phase 5.3 — complete (2026-05-07)
- Phase 5.4 — complete (2026-05-07)
- Phase 5.5 — complete (2026-05-08)
- Phase 6 audit — complete (2026-05-09)
- Phase 6.5 — complete (2026-05-09)
- Phase 6.4 — complete (2026-05-09)
- Phase 6.2 — complete (2026-05-09)
- Phase 6.3 — complete (2026-05-09)

## Roadmap principles
- Ship a narrow, polished v1
- Build risk-first, not feature-first
- Establish domain model before visual polish
- Keep the AI system grounded and inspectable
- Protect code quality from day one

## Phase 0 — Foundation and decisions
### Goal
Establish the project skeleton, architecture rules, and domain model before feature implementation.

### Deliverables
- repository initialized
- docs folder present and approved
- TypeScript strict configuration
- lint/format/test tooling
- basic app shell
- storage abstraction decided
- domain types defined
- folder/module boundaries established

### Acceptance criteria
- project runs locally
- quality tools run in one command
- domain entities compile cleanly
- no unresolved architecture questions block Phase 1

### Suggested file boundaries
- `src/app/`
- `src/domain/`
- `src/storage/`
- `src/features/library/`
- `src/features/reader/`
- `src/features/annotations/`
- `src/features/ai/`
- `src/shared/`

---

## Phase 1 — Library and import core
### Goal
Let the user import books and see them in a polished local library.

### Tasks
#### Task 1.1 — Import pipeline skeleton
- define import flow state machine
- validate supported formats
- create import queue model
- create normalized import result contract

**Acceptance criteria**
- user can choose files
- unsupported files fail gracefully
- import status is visible
- imported metadata persists after reload

**Files/modules**
- `features/library/import/`
- `storage/books/`
- `domain/import/`

#### Task 1.2 — Bookshelf UI
- implement library layout
- cover cards
- sorting/filtering
- empty state
- loading state

**Acceptance criteria**
- library feels polished at desktop and mobile sizes
- books show cover/title/author/progress
- empty state is intentional and attractive

**Files/modules**
- `features/library/ui/`
- `design-system/components/`

#### Task 1.3 — Persistence baseline
- persist books
- persist covers
- persist import metadata
- persist library preferences

**Acceptance criteria**
- reload restores library fully
- data shape supports migrations

**Files/modules**
- `storage/db/`
- `storage/repositories/`
- `domain/migrations/`

---

## Phase 2 — Reading core
### Goal
Deliver a genuinely good reading experience before AI complexity increases.

### Tasks
#### Task 2.1 — EPUB reader adapter
- integrate renderer via adapter layer
- TOC navigation
- location persistence
- theme controls

**Acceptance criteria**
- open EPUB
- navigate TOC
- restore last location
- adjust typography

**Files/modules**
- `features/reader/epub/`
- `features/reader/shared/`

#### Task 2.2 — PDF reader adapter
- render pages
- support text selection
- support page navigation
- restore last location

**Acceptance criteria**
- open PDF
- navigate page-to-page
- select text
- restore last location

**Files/modules**
- `features/reader/pdf/`
- `features/reader/shared/`

#### Task 2.3 — Reader workspace layout
- desktop three-pane layout
- mobile sheet layout
- focus mode

**Acceptance criteria**
- reader remains center stage
- panel layout is responsive and stable
- mobile layout feels intentional, not compressed desktop UI

**Files/modules**
- `features/reader/layout/`
- `features/shell/`

---

## Phase 3 — Annotations
### Goal
Add the first durable thinking layer: bookmarks, highlights, notes.

### Tasks
#### Task 3.1 — Bookmarks
**Acceptance criteria**
- create/delete bookmark
- jump to bookmark
- bookmark persists

#### Task 3.2 — Highlights
**Acceptance criteria**
- create highlight from selection
- color support
- highlight persists
- highlights list works

#### Task 3.3 — Notes
**Acceptance criteria**
- attach note to selection or location
- edit/delete note
- jump from note to passage

#### Task 3.4 — Annotation notebook
**Acceptance criteria**
- list all notes/highlights/bookmarks for a book
- search/filter basic annotations
- notebook is useful on mobile and desktop

**Files/modules**
- `features/annotations/`
- `domain/annotations/`
- `storage/annotations/`

---

## Phase 4 — AI foundation
### Goal
Introduce AI carefully, starting with transparent, bounded workflows.

### Tasks
#### Task 4.1 — API key settings
- session-only key mode
- remember-on-device mode
- clear privacy copy

**Acceptance criteria**
- key entry UX is clear
- key can be removed easily
- no accidental persistence

#### Task 4.2 — Model catalog
- fetch available models
- store local model snapshot
- expose simple selection UI

**Acceptance criteria**
- user can choose a model
- unavailable/failing model states are handled

#### Task 4.3 — Chat panel
- threaded conversation per book
- streaming response UI
- answer save-as-note action

**Acceptance criteria**
- stream works
- thread persists
- errors are recoverable

#### Task 4.4 — Passage mode (complete 2026-05-06)
- send selected passage as context
- show context chips
- show provenance

**Shipped:**
- `ContextRef.passage` carries a required `anchor: HighlightAnchor`
  plus optional section + before/after windows; storage validators
  enforce shape and drop malformed passage refs without dropping the
  surrounding message.
- `BookReader.getPassageContextAt(anchor)` extracts ~400-char windows.
  EPUB caches the live `Range` from `handleSelectionChange` and uses
  boundary ranges. PDF string-matches the selection against
  `getTextContent()` page text via the pure `extractPassageWindows`
  helper; first-match-wins is documented + tested as a known v1
  limitation (anchor and jump-back are unaffected).
- `assemblePassageChatPrompt` emits a single combined system message
  (open prompt + addendum, separated by `\n\n`) for cross-upstream
  parity, followed by history and a passage-block-prefixed user
  message. History soft-cap drops 40 → 30 pairs in passage threads.
- `useChatSend.attachedPassage`: routes through passage assembly when
  set; writes `mode: 'passage'` on both user + assistant messages but
  the passage `contextRef` only on the assistant — the asymmetry is
  locked by an explicit test to prevent silent re-bloating.
- `HighlightToolbar` gains an "Ask AI" action gated by api-key state
  + selectedModelId. `ReaderWorkspace` materializes the selection as
  a chip, auto-expands the right rail (desktop) or auto-switches the
  mobile sheet to a new "Chat" 4th tab, and queues composer focus.
- `PassageChip` (new): sticky chip above composer; `MessageBubble`
  source footer (.find()-based predicate for forward compat with
  multi-source modes) navigates the reader to the saved anchor;
  `PrivacyPreview` renders the byte-equal passage block via a shared
  `buildPassageBlockForPreview` helper, locked by a snapshot-equiv-
  alence test against `assemblePassageChatPrompt`.
- `NotebookRow` exposes "Jump to passage" on saved-answer rows when
  their snapshotted contextRefs include a passage anchor.

**Deferred:**
- Multi-passage / chapter-mode / retrieval-mode (Phase 5)
- E2E coverage of streaming send + source-footer + jump-back (needs
  SSE mock harness for `/api/v1/chat/completions`); skip-tagged in
  the new specs with TODO references to the unit tests that already
  lock the underlying logic.
- PDF y-coordinate biasing for window extraction when selection text
  appears multiple times on a page (`TODO(passage-y-bias)` marker in
  `pdfPassageWindows.ts`).

**Acceptance criteria**
- user can ask about selected text
- request is transparent
- response links back to source

**Files/modules**
- `features/ai/chat/`
- `features/ai/settings/`
- `features/ai/context-builder/`
- `domain/ai/`

---

## Phase 5 — Retrieval and prompt intelligence
### Goal
Make "ask the book" genuinely useful.

### Tasks
#### Task 5.1 — Text normalization and chunking (complete 2026-05-06)

Per-book chunking pipeline runs at import time on the main thread with
yielded scheduling. Format-specific extractors (`EpubChunkExtractor`
reuses foliate-js headlessly via a dynamic-imported zip loader;
`PdfChunkExtractor` uses pdfjs-dist with paragraph-reconstruction
heuristics + boilerplate filter) feed a shared pure
`paragraphsToChunks` packer (paragraph-bounded, ~400-token cap, never
splits paragraphs except in single-paragraph-overflow cases). Chunks
persist per-section atomically in `book_chunks` (IDB schema v7);
idempotent resume on app open via per-section `hasChunksFor`. Chunker
is versioned (`CHUNKER_VERSION = 1`); stale-version chunks are dropped
and rebuilt automatically. Inspector UI lives on the library card
(status indicator) + a modal listing chunks with previews and a
Rebuild button. Cascade extends `useReaderHost.onRemoveBook` with
synchronous indexing-cancel + chunk-deletion.

**Deferred:**
- Embeddings / vector storage (Phase 5.2).
- Retrieval / ranking / chunk scoring (Phase 5.2).
- Suggested prompts derived from chunks (Phase 5.3).
- Chapter-mode prompt assembly using chunks (Phase 5.4).
- Web Worker promotion of the chunker (pure refactor when profiling justifies).
- OCR for image-only PDFs (Phase 6+).
- Multi-column PDF column detection (best-effort in v1).

**Acceptance criteria**
- sections and chunks are generated reliably
- chunking rules are deterministic
- chunk previews are inspectable

#### Task 5.2 — Retrieval baseline
- keyword + semantic retrieval
- ranking
- evidence bundle assembly

**Acceptance criteria**
- broad questions retrieve relevant excerpts
- answer quality is meaningfully better than naive context stuffing

#### Task 5.3 — Suggested prompts
- generate prompt sets from book profile
- show 4–8 high-quality prompts only

**Acceptance criteria**
- prompts feel book-specific
- prompts are not generic filler

#### Task 5.4 — Chapter mode (complete 2026-05-07)

Chapter mode chip in the composer attaches the current chapter (chunks
+ highlights + notes) as context for the next chat. Snapshot semantics
mirror passage mode (Phase 4.4); send routes through a new `chapter`
branch in `useChatSend` with `assembleChapterPrompt` doing token-budget-
aware chunk sampling. Source-footer rendering reuses the Phase 5.2
`MultiSourceFooter` plumbing.

#### Task 5.5 — Multi-excerpt mode (complete 2026-05-08)

User builds an ordered set (≤ 6) of excerpts from existing highlights
(per-row `+`/`✓` toggle in HighlightsPanel) and/or fresh ad-hoc
selections (`+ Compare` button in HighlightToolbar). The set renders
as a single composer chip with an expandable preview. Send emits one
`kind: 'passage'` `ContextRef` per excerpt — reusing
`MultiSourceFooter` for `[1][2][3]` citation chips whose numbers align
with the assembled prompt's "Excerpt N" labels. Tray is workspace
state (no IDB schema changes); auto-sorts by reading position; hard
caps at 6 with proportional-trim fallback for the 5000-token bundle.

**Acceptance criteria (Task 5.4 + 5.5)**
- chapter mode works
- multi-excerpt comparison works
- source evidence stays visible

**Files/modules**
- `features/search/`
- `features/ai/retrieval/`
- `features/ai/prompts/`
- `domain/indexing/`

---

## Phase 6 — Polish and trust
### Goal
Raise the app from functional to premium.

### Tasks
#### Task 6.1 — Animation polish
#### Task 6.2 — Accessibility pass
#### Task 6.3 — Performance pass
#### Task 6.4 — Offline and resume hardening
#### Task 6.5 — Empty/error state polish

**Acceptance criteria**
- app feels coherent and refined
- keyboard navigation is viable
- performance regressions are addressed
- offline reading is dependable
- errors do not feel catastrophic

---

## Phase 7 — Deferred exploration
### Candidate tasks
- MOBI import beta
- concept maps
- family trees
- timelines
- glossary/study cards
- export notebook
- OCR feasibility spike
- optional sync design doc only

## Release criteria for v1
- import/read EPUB and PDF
- annotations stable
- AI passage mode stable
- retrieval mode useful
- state restoration reliable
- mobile experience acceptable
- quality score meets project gate