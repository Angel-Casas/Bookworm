# Implementation Roadmap

## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (2026-05-03)
- Phase 2 — complete (2026-05-03)

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

#### Task 4.4 — Passage mode
- send selected passage as context
- show context chips
- show provenance

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
#### Task 5.1 — Text normalization and chunking
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

#### Task 5.4 — Chapter mode and multi-excerpt mode
**Acceptance criteria**
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