# Phase 2.1 — EPUB Reader Adapter (Design)

**Date:** 2026-05-03
**Phase:** 2 — Reading core, Task 2.1
**Branch:** `phase-2-reading-core`
**Status:** approved (pending implementation plan)

---

## 1. Purpose

Deliver the first end-to-end reading experience for Bookworm by integrating an EPUB rendering engine (`foliate-js`) behind a clean adapter, exposing it through a minimal reader shell that opens books from the existing bookshelf.

## 2. Scope

In scope (Task 2.1 acceptance criteria from `docs/04-implementation-roadmap.md`):

- Open an EPUB file from the local library
- Navigate the table of contents
- Restore the last reading location after reload
- Adjust typography (font family, size, line height, side margins, theme, scroll vs paginated mode)

Explicitly out of scope:

- Three-pane workspace layout (deferred to Task 2.3)
- PDF rendering (deferred to Task 2.2; types/contract already accommodate it)
- Selection events, highlights, notes, bookmarks (Phase 3)
- AI passage mode integration (Phase 4)

## 3. Decisions locked in (from brainstorm)

| # | Decision | Choice | Reason |
|---|---|---|---|
| Q1 | Scope of 2.1 deliverable | **Adapter + minimal reader shell** | End-to-end testable from the user's POV; satisfies acceptance; throwaway shell is small and intentional |
| Q2 | Location anchor format | **Native per format, discriminated union** | Matches CLAUDE.md "discriminated unions" principle; preserves CFI precision; no lossy translation |
| Q3 | Reader API thickness | **Just-in-time minimal `BookReader` interface** | YAGNI; honest API with no `NotYetImplementedError` methods; Phase 3/4 extend explicitly |
| Q4 | Reader entry mechanic | **In-place view swap, no router** | Matches existing `App.tsx` pattern; ~30 lines; 2.3 can swap for a real router without breaking the adapter |
| Q5 | Typography scope | **Reading-essentials + polish** | Premium reading feel without speculative knobs; same persistence pattern as a minimal version |

## 4. Architecture

### 4.1 Module layout

```
src/
├─ domain/reader/
│   ├─ types.ts            # LocationAnchor, BookReader, TocEntry, ReaderPreferences, ReaderTheme
│   └─ index.ts            # public re-exports
├─ features/reader/
│   ├─ epub/
│   │   ├─ EpubReaderAdapter.ts       # wraps foliate-js, implements BookReader
│   │   └─ EpubReaderAdapter.test.ts  # against small-pride-and-prejudice.epub
│   ├─ ReaderView.tsx                  # orchestrator: mounts adapter + chrome + panels
│   ├─ ReaderChrome.tsx                # top bar: back, title, settings opener
│   ├─ TocPanel.tsx                    # TOC list; click → goToAnchor
│   ├─ TypographyPanel.tsx             # font/size/line-height/margins/theme/mode controls
│   ├─ readerMachine.ts                # XState machine for reader load lifecycle
│   ├─ readerMachine.test.ts
│   └─ *.css                           # one stylesheet per component (matches Phase 1 pattern)
└─ storage/repositories/
    ├─ readingProgress.ts              # per-book LocationAnchor (last position)
    ├─ readingProgress.test.ts
    ├─ readerPreferences.ts            # global prefs (typography + theme)
    └─ readerPreferences.test.ts
```

### 4.2 Boundary intent

- **Domain (`domain/reader/`)** holds only types and the `BookReader` interface. No imports from `features/` or third-party libs. PDF adapter (Phase 2.2) will satisfy the same `BookReader` contract.
- **Adapter (`features/reader/epub/`)** is the *only* place `foliate-js` is imported. If we ever swap engines, this is the single replacement point.
- **UI (`features/reader/`)** consumes the `BookReader` interface. It has no knowledge of EPUB CFIs or `foliate-js`.
- **App-level navigation** lives in `App.tsx` — extends the existing pattern: `view: { name: 'library' } | { name: 'reader', bookId: string }`. View is persisted to settings repo so reload restores.

### 4.3 Deliberate exception to the design system

`docs/05-design-system.md` says *"scroll or pagination — user choice is persisted per format (EPUB/PDF)"*. Q5 picked a single shared preferences shape — but pagination mechanics differ fundamentally between EPUB (reflowable) and PDF (already-paginated source). So the **mode toggle is per-format from day one**, while typography stays shared:

```ts
ReaderPreferences = {
  typography: { ... },                    // shared across formats
  theme: 'light' | 'dark' | 'sepia',      // shared
  modeByFormat: { epub: 'scroll' | 'paginated' };  // pdf added in 2.2
}
```

Costs one extra field now; prevents a forced migration when 2.2 ships.

## 5. Domain types

```ts
// src/domain/reader/types.ts

// ----- Location anchors (Q2: native per format) -----

export type EpubCfiAnchor = {
  kind: 'epub-cfi';
  cfi: string;                    // foliate-js native CFI
  sectionId?: string;             // optional, for fast cross-format queries later
};

export type PdfPageAnchor = {     // declared now, implemented in 2.2
  kind: 'pdf-page';
  page: number;                   // 1-based
  offset?: number;                // char offset within the page
  sectionId?: string;
};

export type LocationAnchor = EpubCfiAnchor | PdfPageAnchor;

// ----- Table of contents -----

export type TocEntry = {
  id: string;                     // stable id (e.g. href or generated)
  label: string;
  anchor: LocationAnchor;
  depth: number;                  // 0 = top-level, for indentation
  children?: TocEntry[];          // nested TOC supported but flat-rendered for v1 chrome
};

// ----- Reader preferences (Q5: typography polish + per-format mode) -----

export type ReaderFontFamily =
  | 'system-serif' | 'system-sans'
  | 'georgia' | 'iowan' | 'inter';

export type ReaderTheme = 'light' | 'dark' | 'sepia';
export type ReaderMode = 'scroll' | 'paginated';

export type ReaderTypography = {
  fontFamily: ReaderFontFamily;
  fontSizeStep: 0 | 1 | 2 | 3 | 4;       // 5 steps (Small → XLarge); maps to px in adapter
  lineHeightStep: 0 | 1 | 2;             // tight / normal / loose
  marginStep: 0 | 1 | 2;                 // narrow / normal / wide
};

export type ReaderPreferences = {
  typography: ReaderTypography;          // shared across formats
  theme: ReaderTheme;                    // shared across formats
  modeByFormat: { epub: ReaderMode };    // pdf added in 2.2
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  typography: { fontFamily: 'system-serif', fontSizeStep: 2, lineHeightStep: 1, marginStep: 1 },
  theme: 'light',
  modeByFormat: { epub: 'paginated' },   // mobile-first default per design system
};

// ----- BookReader contract (Q3: minimal) -----

export type ReaderInitOptions = {
  preferences: ReaderPreferences;
  initialAnchor?: LocationAnchor;        // restore last position if present
};

export type LocationChangeListener = (anchor: LocationAnchor) => void;

export interface BookReader {
  open(file: Blob, options: ReaderInitOptions): Promise<{ toc: TocEntry[] }>;
  goToAnchor(anchor: LocationAnchor): Promise<void>;
  getCurrentAnchor(): LocationAnchor;
  applyPreferences(prefs: ReaderPreferences): void;   // theme + typography + mode
  onLocationChange(listener: LocationChangeListener): () => void;  // returns unsubscribe
  destroy(): void;
}

// ----- Errors (typed for exhaustive handling in UI) -----

export type ReaderError =
  | { kind: 'blob-missing'; bookId: string }
  | { kind: 'parse-failed'; reason: string }
  | { kind: 'unsupported-format'; format: string }
  | { kind: 'engine-crashed'; cause: unknown };
```

### 5.1 Two contract choices flagged

1. **`open()` returns `{ toc }`** instead of having a separate `getToc()`. TOC is derivable only after open, so bundling them avoids a "you must call open first" trap. PDF adapter follows the same shape.
2. **`onLocationChange` listener pattern** instead of polling `getCurrentAnchor()`. The adapter is the single source of truth for "where am I"; UI subscribes. Necessary for debounced position-save without a UI-driven interval.

Both are minimum viable, not speculative.

## 6. Components

| Component | Responsibility | Owns |
|---|---|---|
| `App.tsx` | Top-level view router | `view` state; persists view to settings |
| `LibraryView` (existing) | Bookshelf | Wires `onOpen(bookId)` upward to `App` |
| `ReaderView` | Orchestrator | `readerMachine` instance; mounts adapter, chrome, panels; subscribes to location changes; debounce-saves progress |
| `EpubReaderAdapter` | Engine boundary | Only file with `import 'foliate-js'`; implements `BookReader` |
| `ReaderChrome` | Top bar UI | Back button, book title, opens panels (TOC, typography). Pure UI. |
| `TocPanel` | TOC navigator | Renders flat-with-indent TOC; click → `goToAnchor` |
| `TypographyPanel` | Preferences UI | Renders controls; emits `onChange(prefs)` upward |

All UI components are thin and pure. Side effects live in `ReaderView` and the adapter.

### 6.1 Reader chrome layout for v2.1 (provisional, replaced in 2.3)

```
┌──────────────────────────────────────────────────────┐
│  ← Library    Pride and Prejudice — J. Austen   ⚙ ☰  │  ← ReaderChrome
├──────────────────────────────────────────────────────┤
│                                                       │
│   <reader content rendered by foliate-js>             │  ← Adapter mount
│                                                       │
└──────────────────────────────────────────────────────┘
   ⚙ opens TypographyPanel as a sheet/popover
   ☰ opens TocPanel as a sheet/drawer
```

Deliberately understated — 2.3 designs the proper three-pane workspace; 2.1 chrome stays simple so the throwaway is small.

## 7. Data flow (open → read → close → reload)

```
1. User clicks BookCard
       ↓
   LibraryView.onOpen(bookId) → App.dispatch({ type: 'open-book', bookId })
       ↓
   App: view = { name: 'reader', bookId }; settingsRepo.put('view', view)
       ↓
2. ReaderView mounts (key={bookId})
       ↓
   readerMachine: idle → loadingBlob
       ↓
   booksRepo.getById(bookId) → opfs.readAt(book.sourceRef)   ← Phase 1 already wires this
       ↓
   readerPreferencesRepo.get()          ← from IndexedDB
       ↓
   readingProgressRepo.get(bookId)      ← from IndexedDB (may be undefined)
       ↓
   readerMachine: loadingBlob → opening
       ↓
   adapter = new EpubReaderAdapter(); adapter.open(blob, { preferences, initialAnchor })
       ↓
   readerMachine: opening → ready { adapter, toc, currentAnchor }
       ↓
3. adapter.onLocationChange(anchor => debounced(500ms): readingProgressRepo.put(bookId, anchor))
       ↓
4. User changes prefs in TypographyPanel
       ↓
   ReaderView: adapter.applyPreferences(newPrefs); readerPreferencesRepo.put(newPrefs)
       ↓
5. User clicks ← Library
       ↓
   ReaderView unmount → adapter.destroy() (also flushes final position synchronously)
       ↓
   App: view = { name: 'library' }; settingsRepo.put('view', view)
       ↓
6. (Reload at any point) → App reads settingsRepo.get('view'). If 'reader', mount ReaderView with saved bookId. Flow re-runs from step 2; initialAnchor restores position.
```

### 7.1 Three implementation choices baked in

1. **`key={bookId}` on ReaderView.** Forces clean remount (and `destroy`) if the user switches books. Keeps the orchestrator lifecycle dead simple — no manual "did the bookId change?" reconciliation.
2. **Debounced save on location change (500 ms).** Plus a synchronous final flush in `destroy()` and a `pagehide`/`visibilitychange === 'hidden'` flush. Catches tab close on mobile too.
3. **Preferences applied via single `applyPreferences(prefs)` call**, not five granular setters. The adapter diffs internally if it cares. Makes the UI ↔ adapter contract uniform and easy to test.

## 8. State machine

XState (per stack lock). Genuinely small — five states, five events:

```
States:
  idle
  loadingBlob       ── reads blob from OPFS + prefs + savedAnchor in parallel
  opening           ── adapter.open(blob, { preferences, initialAnchor })
  ready             ── steady state; user reads, navigates, changes prefs
  error             ── terminal until user backs out

Events:
  OPEN(bookId)        idle → loadingBlob
  LOAD_OK             loadingBlob → opening   (with blob, prefs, anchor)
  OPEN_OK             opening → ready         (with adapter, toc, currentAnchor)
  FAIL(ReaderError)   loadingBlob | opening → error
  CLOSE               any → idle              (also fires adapter.destroy())

Side-effect actors (XState invoke):
  loadBookForReader  : runs in loadingBlob
  openWithAdapter    : runs in opening
```

Once `ready`, **TOC clicks, preference changes, and location-change events do NOT transition states** — they're side effects on the adapter inside the ready state. The state predicate (`is.ready`) directly drives the UI.

Tests cover: each transition; each error path; that `CLOSE` always destroys the adapter (no leak).

## 9. Persistence

### 9.1 IndexedDB schema (v1 → v2)

Phase 1 schema (v1) had: `books`, `covers`, `settings`. Phase 2.1 adds two stores:

```ts
// src/storage/db/schema.ts (additions)

export const READING_PROGRESS_STORE = 'reading_progress';
// key: bookId
// value: { bookId: string; anchor: LocationAnchor; updatedAt: number }

export const READER_PREFERENCES_STORE = 'reader_preferences';
// key-value store; we store a single record under key 'global'
// value: ReaderPreferences
```

Settings store gets one new key (no migration — settings is already KV):

```
key: 'view'
value: { name: 'library' } | { name: 'reader', bookId: string }
```

### 9.2 Migration

```ts
// src/storage/db/migrations.ts
// v1 → v2: create reading_progress + reader_preferences stores
// No data transformation needed. Existing books unaffected.
```

Migration test: open DB at v1 with seeded books + settings, apply v2 migration, assert new stores exist and books survive intact.

### 9.3 Repositories

```ts
// readingProgress.ts
export async function getReadingProgress(bookId: string): Promise<LocationAnchor | undefined>
export async function putReadingProgress(bookId: string, anchor: LocationAnchor): Promise<void>
export async function deleteReadingProgress(bookId: string): Promise<void>  // for orphan-sweep

// readerPreferences.ts
export async function getReaderPreferences(): Promise<ReaderPreferences>     // returns DEFAULT if absent
export async function putReaderPreferences(prefs: ReaderPreferences): Promise<void>
```

Both validate output against the type at the boundary. Corrupted records → log, delete, return default — never throw upward.

### 9.4 View persistence in App

`App.tsx` reads `settings.view` on mount, writes it on every transition. If the persisted view references a deleted bookId, App falls back to `{ name: 'library' }` (handled in App, not in ReaderView).

### 9.5 Orphan-sweep extension

`orphan-sweep.ts` (added in Phase 1) gets one new line: also delete the matching `reading_progress` row when a book is deleted. Test updated.

## 10. Error handling & edge cases

| Case | Handling |
|---|---|
| Book blob missing from OPFS | Adapter never starts; `readerMachine` transitions to `error` with `{ kind: 'blob-missing' }`; UI shows "back to library" |
| Corrupted EPUB / `foliate-js` throws on open | Adapter wraps as `{ kind: 'parse-failed' }`; book record is **not** modified; user can back out |
| Saved anchor doesn't resolve (e.g. EPUB updated externally) | Adapter logs warning, falls back to first section, returns success |
| Browser tab close mid-read | Debounced save + synchronous flush in `destroy()` + `pagehide`/`visibilitychange` listener |
| Multi-tab same book | Last-write-wins; not addressed in v1 |
| User clicks book whose record was deleted | App-level guard: if `bookId` not in books repo, fall back to library view |

## 11. Testing strategy

### 11.1 Unit (Vitest)

| File under test | What it verifies |
|---|---|
| `domain/reader/types.ts` | Exhaustive switch over `LocationAnchor` kinds (TypeScript `never`-narrowing test) |
| `readingProgress.ts` | Round-trip save/load; corrupted record → log + delete + undefined; per-book isolation |
| `readerPreferences.ts` | Returns `DEFAULT_READER_PREFERENCES` when absent; round-trip; corrupted → defaults |
| `migrations.test.ts` | v1 → v2 creates new stores; books + settings survive intact |
| `readerMachine.ts` | Each transition; each error path; `CLOSE` always destroys adapter |

### 11.2 Integration (Vitest + jsdom)

| File under test | What it verifies |
|---|---|
| `EpubReaderAdapter.test.ts` | Against `small-pride-and-prejudice.epub`: `open()` returns non-empty TOC; `getCurrentAnchor()` after open returns valid `epub-cfi`; `goToAnchor()` round-trips; `applyPreferences()` doesn't throw; `destroy()` is idempotent |
| `orphan-sweep.test.ts` (extended) | Removing a book also removes its `reading_progress` row |

### 11.3 E2E (Playwright)

| Spec | Scenario |
|---|---|
| `e2e/reader-open.spec.ts` | Import EPUB → click cover → reader opens, content visible, TOC shows ≥1 entry → click TOC → location changes |
| `e2e/reader-restore.spec.ts` | Open book, scroll/navigate, reload → position restored; reload from library view → still on library |
| `e2e/reader-preferences.spec.ts` | Change theme + font size → reload → preferences persist; back to library, open second book → same prefs apply |
| `e2e/reader-back-nav.spec.ts` | Open book → back to library → bookshelf intact, search/sort still work |

### 11.4 Acceptance criteria → coverage map

| Acceptance criterion | Covered by |
|---|---|
| Open EPUB | `EpubReaderAdapter.test.ts` + `e2e/reader-open.spec.ts` |
| Navigate TOC | `e2e/reader-open.spec.ts` (TOC click → location change) |
| Restore last location | `readingProgress.ts` unit + `e2e/reader-restore.spec.ts` |
| Adjust typography | `readerMachine.ts` transitions + `e2e/reader-preferences.spec.ts` |

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `foliate-js` is pre-1.0; APIs may shift | Med | Pin exact version; wrap entirely in `EpubReaderAdapter`; the only file that imports it. Adapter tests with real fixture catch breaks at upgrade time. |
| CFI from a saved anchor doesn't resolve (e.g. EPUB updated) | Low for v1 | Wrap `goToAnchor` failures: log, fall back to first section. Book identity is by import (Phase 1 stable), so re-import = different book. Documented limitation. |
| Throwaway chrome conflicts with 2.3 redesign | Accepted | Q1 picked B explicitly. Chrome stays minimal — popover panels, no layout commitment. |
| `App.tsx` growth past 200-line warning threshold | Med | View dispatch already needs reorganizing in 2.3. If 2.1 pushes App past 200 lines, extract a small `viewReducer` module — pre-positioning for 2.3 without doing 2.3's job. |
| Reader background ≠ chrome background causes a "stripe" on dark mode | Med (visual) | Reuse the existing `src/design-system/tokens.ts` / `tokens.css` for background, surface, and text tokens; both `foliate-js` CSS injection and app chrome must read from the same source. Cross-checked manually in dev for each theme. |
| Debounced save loses last position on hard crash | Low | Belt-and-suspenders: debounced save + sync flush in `destroy()` + `pagehide` listener. Tested in `reader-restore.spec.ts` (close mid-scroll → reload). |
| `paginated` mode behavior depends heavily on `foliate-js` viewport assumptions | Med | Cover both modes in `e2e/reader-preferences.spec.ts`; allow user to switch back if pagination misbehaves on their device |

## 13. Files

### 13.1 New (~22 files)

```
src/domain/reader/types.ts
src/domain/reader/index.ts
src/features/reader/epub/EpubReaderAdapter.ts
src/features/reader/epub/EpubReaderAdapter.test.ts
src/features/reader/ReaderView.tsx
src/features/reader/ReaderChrome.tsx
src/features/reader/TocPanel.tsx
src/features/reader/TypographyPanel.tsx
src/features/reader/readerMachine.ts
src/features/reader/readerMachine.test.ts
src/features/reader/reader-view.css
src/features/reader/reader-chrome.css
src/features/reader/toc-panel.css
src/features/reader/typography-panel.css
src/storage/repositories/readingProgress.ts
src/storage/repositories/readingProgress.test.ts
src/storage/repositories/readerPreferences.ts
src/storage/repositories/readerPreferences.test.ts
e2e/reader-open.spec.ts
e2e/reader-restore.spec.ts
e2e/reader-preferences.spec.ts
e2e/reader-back-nav.spec.ts
```

### 13.2 Modified

```
src/app/App.tsx                       — view state + ReaderView mount
src/app/app.css                       — minor (reader view chrome integration)
src/storage/db/schema.ts              — 2 new store names + version bump to v2
src/storage/db/migrations.ts          — v1 → v2 migration
src/storage/db/migrations.test.ts     — assert v2 migration
src/storage/index.ts                  — re-exports for new repos
src/features/library/BookCard.tsx     — make card clickable → onOpen prop
src/features/library/Bookshelf.tsx    — pass onOpen prop down
src/features/library/LibraryView.tsx  — wire onOpen up to App
src/features/library/orphan-sweep.ts  — also delete reading_progress on book delete
package.json                          — add foliate-js
pnpm-lock.yaml                        — auto
docs/02-system-architecture.md        — Decision history: foliate-js introduced (2026-05-03)
docs/04-implementation-roadmap.md     — mark Phase 2.1 in progress (then complete)
```

## 14. Dependencies

- **`foliate-js`** — locked in by `docs/02-system-architecture.md` since Phase 0. First time it ships in this PR. Pin to a specific version; record version in the architecture doc.

## 15. Explicit follow-ups (NOT in this PR)

- "Weird TOC" golden EPUB fixture (per `06-quality-strategy.md` fixture list)
- Per-format preferences split when 2.2 lands (already structured for it via `modeByFormat`)
- Visual screenshot regression tests for theme rendering
- Adapter selection-event hook (Phase 3 will add when annotations need it)
- Promote `viewReducer` to a real router if 2.3 needs deep links

## 16. Validation checklist (for the implementation phase)

- [ ] `pnpm check` green
- [ ] `pnpm test:e2e` green
- [ ] `pnpm dev` — manually open the fixture EPUB end-to-end on desktop and mobile viewports
- [ ] No file > 300-line warning threshold
- [ ] No new dependency beyond `foliate-js`
- [ ] Roadmap status updated in same PR
- [ ] Architecture doc decision-history entry for `foliate-js`
