# Phase 3.4 — Annotation notebook design

**Status:** approved 2026-05-04
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 3 → Task 3.4
**Predecessors:** Phase 3.1 bookmarks, Phase 3.2 highlights, Phase 3.3 notes (per-book repos with `listByBook`, `BookmarksPanel` / `HighlightsPanel` row patterns, `NoteEditor` component, anchor projections from `HighlightAnchor` to `LocationAnchor`)

## 1. Goal & scope

Add the per-book **annotation notebook** — a dedicated full-screen view that lists every bookmark, highlight, and note for the open book in book order, with live search and type filtering. The notebook is the place users go to *review and refine* their thinking on a book, distinct from the in-flow reading panels.

**In scope (v1, this phase):**
- New `AppView` kind: `'notebook'` with `bookId`. Persists across reload like `'library'` and `'reader'`.
- Reader chrome gains a "Notebook" entry (SVG icon + text label) that opens the notebook for the currently-open book.
- Notebook chrome: back button (returns to reader), book title.
- Notebook content: search input + single-select type filter chips + flat row list ordered by anchor.
- Rows render with a small uppercase eyebrow type tag ("BOOKMARK" / "HIGHLIGHT" / "NOTE"), section title, relative time, content (snippet for bookmark/highlight; for highlights with notes, the snippet on top + note text inline below).
- Full CRUD inline: delete bookmarks/highlights, change highlight color, edit notes via the existing `NoteEditor`. Click on the row's content area → notebook closes, reader opens at the anchor.
- Empty states: no annotations yet (intentional copy + visual), no search matches (different copy).
- Mobile + desktop layouts, both full-screen.
- A new `src/shared/icons/` module: small monochrome SVG icons (notebook, note/edit pencil, back-arrow). Replaces the existing 📝 emoji in `HighlightToolbar` and `HighlightsPanel`.

**Out of scope (deferred):**
- Cross-book / global notebook (a different design problem; v1 stays per-book per the roadmap).
- Library-card-menu entry to the notebook (reader-chrome entry only in v1).
- Multi-select type filter chips.
- Sort toggle (book order is the only sort).
- Color filter for highlights.
- Tags / tag filter.
- Notebook export (markdown, etc.).
- Pagination / virtual scrolling — even a heavily-annotated book has hundreds of items, well within DOM limits.
- Inline color filter, tag editing, or AI summary — those are their own features.

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Scope | **Per-book** (cross-book deferred) | Roadmap text says "for a book"; existing repos already have `listByBook`; cross-book has its own design questions (sort, filter-by-book, scale). |
| Surface | **Standalone view** (new `AppView` kind: `'notebook'`) | Review/study is a different mode from in-flow reading. Full-screen lets us dedicate space to search/filter without bloating the rail or competing with the per-type tabs that 3.1/3.2 just shipped. |
| Entry point | **Reader chrome only** (text + SVG icon "Notebook" button) | Most discoverable; in-context. Library-menu entry adds an alt route + back-state to remember; defer until users ask. |
| Back-navigation | Notebook → reader. Click row → reader at anchor (notebook unmounts). | Matches the entry path; no navigation stack needed. |
| Icon style | **Monochrome SVG line icons** in a new `src/shared/icons/` module; emoji `📝` removed from `HighlightToolbar` and `HighlightsPanel` as part of this phase | Emojis fight the calm/premium aesthetic and look "low grade" against the rest of the typography. SVG is the convention in professional reading apps (Apple Books, Kobo). |
| Layout | **Flat list, ordered by anchor in book order** (bookmarks woven in by their `LocationAnchor`) | Reads as a walkthrough of the book's annotated trail. Sectioning by type splits "passage" from "thinking" across attention. Sectioning by chapter adds TOC dependency PDFs would degrade. |
| Row content | **Text type tag** ("BOOKMARK" / "HIGHLIGHT" / "NOTE") on top line + section title + relative time, content below; for highlights with notes, the snippet on top + note text inline (matches `HighlightsPanel`) | Type is one of the most-scanned things; a small uppercase eyebrow label reads as editorial typography. Icons-only would be more compact but less clear. |
| Edit capability | **Full CRUD inline** (delete bookmarks/highlights, change highlight color, edit notes via `NoteEditor`) | The notebook is "review and refine"; sending users back to the reader to fix a note is unnecessary friction. Components already exist from 3.1/3.2/3.3. |
| Search | **Live, debounced ~150ms, case-insensitive substring** across snippet + section title + note content | Matches what users type-think. Searching across all text fields means users don't have to think about which field. Live updating is calmer than submit-on-Enter. |
| Type filter | **Single-select chips** [All / Bookmarks / Highlights / Notes]. "Notes" = highlights with a note attached | "All" is the default. Multi-select is a power feature with no clear active state when several are on; defer. |
| Sort | **Book order only**, no UI toggle | Design intent is "walk the book"; chronological sort splits the mental model and adds a control we don't need. |

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ App.tsx                                                             │
│  view.kind === 'library'  → <LibraryView ... />     (existing)      │
│  view.kind === 'reader'   → <ReaderWorkspace ... /> (existing)      │
│  view.kind === 'notebook' → <NotebookView ... />    NEW             │
│                                                                      │
│ NotebookView                                                         │
│  ├─ NotebookChrome — back button, book title, "Notebook" label      │
│  ├─ NotebookSearchBar — search input + filter chips                  │
│  ├─ NotebookList                                                    │
│  │   └─ NotebookRow (one per entry; renders bookmark or highlight)  │
│  │       └─ NoteEditor (when a row's note is in edit mode)          │
│  └─ NotebookEmptyState (no entries / no matches)                    │
│                                                                      │
│  useNotebook(bookId) — composes the three repos + state             │
│   { entries, query/setQuery, filter/setFilter,                      │
│     removeBookmark, removeHighlight, changeColor, saveNote }        │
│                                                                      │
│  Storage:                                                            │
│   bookmarksRepo + highlightsRepo + notesRepo (all existing)          │
│   No new stores. No new repos.                                       │
└────────────────────────────────────────────────────────────────────┘

Shared:
  src/shared/icons/             — NEW directory
    icon.css                    — shared sizing + stroke vars
    NotebookIcon.tsx, NoteIcon.tsx, ArrowLeftIcon.tsx, …
  Each icon is a small React component returning a monochrome SVG.
  Sized 16px default, 1.5px stroke, currentColor — inherits text color.
```

**Single-purpose units:**
- `NotebookView` — top-level page component; owns layout. Pure presentation; reads from `useNotebook`.
- `useNotebook` — composes `bookmarksRepo` + `highlightsRepo` + `notesRepo`; owns query string + filter state; exposes filtered/sorted `NotebookEntry[]` + edit callbacks.
- `NotebookEntry` — discriminated union representing one row.
- `NotebookRow` — pure presentation; renders one entry. Reuses `NoteEditor` for inline note editing.
- `NotebookSearchBar` — pure presentation; controlled by parent.
- `NotebookEmptyState` — pure presentation; takes a `reason: 'no-entries' | 'no-matches'`.
- `useNotebook` does **not** require `readerState`. The existing `useHighlights` etc. are already null-safe for `readerState`, but here we don't compose those hooks at all — `useNotebook` writes directly to the repos. Avoids importing engine concerns into the notebook surface.
- Icons are individual React components (one file per icon), not a name-dispatched `<Icon name="…" />`. Tree-shakable; clearer call sites.

**Routing additions:**
- `AppView` extended with `{ kind: 'notebook'; bookId: string }`.
- `app/view.ts` gains `notebookView(bookId)`.
- `useAppView` (the existing nav hook) gains `goNotebook(bookId)` and `goReaderAt(bookId, anchor)`. The latter is "click a row → return to reader at anchor".
- `useReaderHost` is unchanged in book-loading paths; the notebook doesn't load the book blob — it only reads annotation repos.

**Cascade chain on book removal (extends existing):**
```
useReaderHost.onRemoveBook(bookId)
  ├─ bookmarks/highlights/notes deleteByBook  (existing)
  └─ if current view is reader(bookId) OR notebook(bookId)
       → onBookRemovedFromActiveView?.()  (renamed from
         onBookRemovedWhileInReader)
```

**Comparator for unified ordering:**
```
                                      key for sort
NotebookEntry { kind: 'bookmark',   anchor: LocationAnchor }      → anchorKey(LocationAnchor)
NotebookEntry { kind: 'highlight',  anchor: HighlightAnchor }     → anchorKey(HighlightAnchor)

For epub-cfi: lex CFI string.
For pdf: tuple (page, rect[0].y ?? 0, rect[0].x ?? 0).
Mixed kinds in one book shouldn't happen (a book is one format), so the
fallback is stable comparison by createdAt.
```

A new pure helper `compareNotebookEntries` lives in `src/features/annotations/notebook/notebookSort.ts`. The 3.2 `compareHighlightsInBookOrder` covers highlight-vs-highlight; the new helper extends it to handle bookmarks too.

## 4. Domain, types & storage

### 4.1 Domain types — no new domain entities

The notebook is a UI-layer aggregation. No new domain types in `src/domain/`. We add a small view-model union local to the feature:

```ts
// src/features/annotations/notebook/types.ts
export type NotebookEntry =
  | {
      readonly kind: 'bookmark';
      readonly bookmark: Bookmark;
    }
  | {
      readonly kind: 'highlight';
      readonly highlight: Highlight;
      readonly note: Note | null;
    };

export type NotebookFilter = 'all' | 'bookmarks' | 'highlights' | 'notes';
```

`NotebookEntry` is a presentation contract for the row component, not a persisted shape — it's never serialized.

### 4.2 `AppView` extended with `'notebook'`

`src/storage/db/schema.ts`:

```ts
export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string }
  | { readonly kind: 'notebook'; readonly bookId: string };  // NEW
```

The settings `view` record persists the active view across reload. The validator `isValidView` (in `src/storage/repositories/settings.ts`) gains a third branch that accepts `'notebook'` with a non-empty `bookId`. Old DBs with only `'library'` or `'reader'` records still narrow correctly — additive change, no migration needed.

### 4.3 `app/view.ts` — new helper

```ts
export function notebookView(bookId: string): AppView {
  return { kind: 'notebook', bookId };
}
```

### 4.4 Storage — no new stores

The notebook reads from existing repos:
- `bookmarksRepo.listByBook(bookId)` → `Bookmark[]`
- `highlightsRepo.listByBook(bookId)` → `Highlight[]`
- `notesRepo.listByBook(bookId)` → `Note[]`

No new IDB stores. No migration. `CURRENT_DB_VERSION` stays at 5.

### 4.5 Validator changes

`isValidView` in `src/storage/repositories/settings.ts` extends to:

```ts
function isValidView(v: unknown): v is AppView {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as { kind?: unknown; bookId?: unknown };
  if (x.kind === 'library') return true;
  if ((x.kind === 'reader' || x.kind === 'notebook')
      && typeof x.bookId === 'string' && x.bookId.length > 0) {
    return true;
  }
  return false;
}
```

The reader and notebook branches share the same shape; collapsing them with a single shape check is a small clarity win.

## 5. UI surface

### 5.1 Icons module

`src/shared/icons/` — new directory. Each file exports one icon component.

```css
/* src/shared/icons/icon.css */
.icon {
  display: inline-block;
  flex: 0 0 auto;
  vertical-align: -2px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

```ts
// src/shared/icons/NotebookIcon.tsx
import './icon.css';
type Props = { readonly size?: number; readonly className?: string };
export function NotebookIcon({ size = 16, className }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size} height={size} viewBox="0 0 16 16"
      role="img" aria-hidden="true" focusable="false"
    >
      <path d="M3 2.5h7a2 2 0 0 1 2 2v9a.5.5 0 0 1-.5.5H3a1.5 1.5 0 0 1 0-3h8" />
      <path d="M5 5h5M5 7.5h5" />
    </svg>
  );
}
```

`NoteIcon.tsx` (small "note/edit" — pencil-on-paper outline) and `ArrowLeftIcon.tsx` follow the same shape. Module also includes barrel export `index.ts`.

**Why hand-authored, not a library:** ~3 icons, ~30 LoC each, no external dep, full control over stroke weight and visual rhythm. Adding `lucide-react` or similar would cost ~50KB of bundle for icons we won't use 99% of.

### 5.2 `NotebookView`

`src/features/annotations/notebook/NotebookView.tsx`:

```ts
type Props = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
  readonly notesRepo: NotesRepository;
  readonly onBack: () => void;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
};
```

**Layout (desktop):**
```
┌─────────────────────────────────────────────────────────┐
│ ← Reader      Notebook · Pride and Prejudice            │  ← chrome
├─────────────────────────────────────────────────────────┤
│ [search input ……………………………………………………………]                    │
│ All · Bookmarks · Highlights · Notes                    │  ← chip bar
├─────────────────────────────────────────────────────────┤
│ ▌ HIGHLIGHT · Chapter 4 · 2h ago    [pips] [📝] [×]     │
│   "the marriage of Mr. Bingley to..."                    │
│   ─ Bingley represents the new gentry — wealth without  │
│                                                          │
│   BOOKMARK · Chapter 5 · yesterday              [×]     │
│   "It is a truth universally acknowledged..."            │
│                                                          │
│   HIGHLIGHT · Chapter 7 · 3d ago    [pips] [📝] [×]     │
│   "Mr. Darcy soon drew the attention..."                 │
└─────────────────────────────────────────────────────────┘
```

(In the rendered UI, the 📝 in the diagram above is `<NoteIcon />`, not the emoji.)

The list area is constrained to ~720px max-width on wide viewports, centered, for readable line lengths. Mobile is full-width.

**Composition:**
```tsx
const notebook = useNotebook({
  bookId: BookId(props.bookId),
  bookmarksRepo: props.bookmarksRepo,
  highlightsRepo: props.highlightsRepo,
  notesRepo: props.notesRepo,
});

return (
  <div className="notebook-view">
    <NotebookChrome bookTitle={props.bookTitle} onBack={props.onBack} />
    <NotebookSearchBar
      query={notebook.query}
      onQueryChange={notebook.setQuery}
      filter={notebook.filter}
      onFilterChange={notebook.setFilter}
    />
    {notebook.entries.length === 0 ? (
      <NotebookEmptyState
        reason={notebook.totalCount === 0 ? 'no-entries' : 'no-matches'}
      />
    ) : (
      <NotebookList
        entries={notebook.entries}
        onJumpToAnchor={props.onJumpToAnchor}
        onRemoveBookmark={notebook.removeBookmark}
        onRemoveHighlight={notebook.removeHighlight}
        onChangeColor={notebook.changeColor}
        onSaveNote={notebook.saveNote}
      />
    )}
  </div>
);
```

`totalCount` is `bookmarks.length + highlights.length` (pre-filter), exposed by the hook so the view can distinguish "you haven't annotated yet" from "no matches for this filter/search".

### 5.3 `NotebookChrome`

Compact header bar mirroring `ReaderChrome`'s visual rhythm. One file: `NotebookChrome.tsx` + `notebook-chrome.css`. Renders:
- Back button: `<ArrowLeftIcon /> Reader` — clicks `onBack`.
- Title: "Notebook · {bookTitle}". Mobile truncates the book title.

No focus-mode toggle, no typography button — those are reader concerns. Calm and minimal.

### 5.4 `NotebookSearchBar`

```ts
type Props = {
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly filter: NotebookFilter;
  readonly onFilterChange: (f: NotebookFilter) => void;
};
```

- Search input: `<input type="search">` with placeholder "Search annotations". ⌘K / Ctrl+K focuses it from anywhere on the page.
- Filter chips: a row of 4 buttons, single-select. Active chip styled with `aria-pressed="true"`. Keyboard arrow-key navigation between chips.
- Sticky on scroll on mobile (search-bar pinned at the top of the viewport while the list scrolls); flows with the page on desktop.

Debounce: the search input updates `notebook.query` with a 150ms trailing debounce. Filter chip click is immediate.

### 5.5 `NotebookList` + `NotebookRow`

`NotebookList` is a thin wrapper rendering rows:
```tsx
<ul className="notebook-list">
  {entries.map((entry) => (
    <NotebookRow
      key={entry.kind === 'bookmark' ? entry.bookmark.id : entry.highlight.id}
      entry={entry}
      onJumpToAnchor={onJumpToAnchor}
      ...
    />
  ))}
</ul>
```

`NotebookRow` renders:
- Top line: small uppercase eyebrow type tag + section title + relative time. Tracking-wide, muted color.
- For bookmarks: `<BookmarkRow>` sub-component — snippet (or section title fallback if `snippet === null`), single delete button on the right.
- For highlights: `<HighlightRow>` sub-component — colored bar on the left, snippet, color pips + note button (`<NoteIcon />`) + delete button. Inline note line below snippet when `entry.note !== null`. Inline `NoteEditor` when row is in note-edit mode (local `editingNoteFor` state, mirroring `HighlightsPanel`).

`NotebookRow` is purely presentation; all callbacks come from `NotebookView`. The bookmark and highlight sub-rows share styling via a common `.notebook-row` class with type-specific modifiers.

**Click semantics:**
- Click on the row's main content area (snippet + section title) → calls `onJumpToAnchor(entry.bookmark.anchor)` for bookmarks, or projects `HighlightAnchor` to `LocationAnchor` for highlights and calls `onJumpToAnchor`.
- Click on action buttons (color pip, ×, note button) → modifies in place; stays in notebook.
- Click on the inline note line → enters note-edit mode for that row.

### 5.6 `NotebookEmptyState`

```ts
type Props = { readonly reason: 'no-entries' | 'no-matches' };
```

- `'no-entries'`: muted icon + "No annotations yet" + hint copy ("Open this book and tap a bookmark, highlight, or note to start.").
- `'no-matches'`: muted icon + "No matches" + "Try a different search or filter."

Centered in the panel, same visual language as `LibraryEmptyState`.

### 5.7 `useNotebook` hook

`src/features/annotations/notebook/useNotebook.ts`:

```ts
export type UseNotebookHandle = {
  readonly entries: readonly NotebookEntry[];   // filtered + sorted
  readonly totalCount: number;                  // pre-filter (bookmarks + highlights)
  readonly query: string;
  readonly setQuery: (q: string) => void;
  readonly filter: NotebookFilter;
  readonly setFilter: (f: NotebookFilter) => void;
  readonly removeBookmark: (b: Bookmark) => Promise<void>;
  readonly removeHighlight: (h: Highlight) => Promise<void>;
  readonly changeColor: (h: Highlight, color: HighlightColor) => Promise<void>;
  readonly saveNote: (h: Highlight, content: string) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
  readonly notesRepo: NotesRepository;
};

export function useNotebook(opts: Options): UseNotebookHandle;
```

**Implementation outline:**
1. Three local lists: `bookmarks`, `highlights`, `notesByHighlightId`. Loaded on mount via the three repos' `listByBook(bookId)`.
2. `query: string` and `filter: NotebookFilter` are local state with `useState`.
3. `entries` is derived (memoized): unify bookmarks + highlights into a `NotebookEntry[]`, attach notes from the map, apply filter, apply search, sort by `compareNotebookEntries`.
4. Edit operations: optimistic local update + repo write + rollback on error. Same pattern as `useBookmarks`/`useHighlights`/`useNotes`. We do **not** compose those hooks — they expect a `readerState`-aware lifecycle that doesn't fit here. Instead, `useNotebook` writes to the repos directly. (Slight duplication of the rollback shape, but the alternative is making `useHighlights` etc. truly engine-optional which is a bigger refactor than this feature warrants.)
5. Re-key on `bookId` change.

**Search/filter helpers** are pure functions, separately tested:
- `matchesFilter(entry, filter)` — `notebookFilter.ts`
- `matchesQuery(entry, query)` — `notebookSearch.ts`; lowercase substring across snippet/sectionTitle/note content
- `compareNotebookEntries(a, b)` — `notebookSort.ts`

### 5.8 `ReaderChrome` — Notebook button

`ReaderChrome` gains a "Notebook" entry in the right action group. Both viewports show it (it's the entry point to the notebook).

```
desktop: ←Library | Title | ⊟ ⚙ ★ [Notebook]
mobile:  ←Library | Title | ⚙ ★ [Notebook] ☰
```

Where `[Notebook]` renders `<NotebookIcon />` next to the text label "Notebook". Click → `onOpenNotebook()` prop, plumbed through `App.tsx` to `useAppView.goNotebook(bookId)`.

The existing 📝 emoji in `HighlightToolbar` and `HighlightsPanel` is replaced with `<NoteIcon />` from the new module. No visual layout changes; just swap the glyph.

### 5.9 `App.tsx` — third branch

```tsx
if (view.current.kind === 'notebook') {
  const book = reader.findBook(view.current.bookId);
  if (!book) return null;
  return (
    <div className="app">
      <NotebookView
        key={view.current.bookId}
        bookId={view.current.bookId}
        bookTitle={book.title}
        bookmarksRepo={reader.bookmarksRepo}
        highlightsRepo={reader.highlightsRepo}
        notesRepo={reader.notesRepo}
        onBack={() => view.goReader(book.id)}
        onJumpToAnchor={(anchor) => view.goReaderAt(book.id, anchor)}
      />
    </div>
  );
}
```

`view.goReader` and `view.goReaderAt` are new helpers on `useAppView`:
- `goReader(bookId)`: same as today's library → reader transition; just sets the view.
- `goReaderAt(bookId, anchor)`: sets the view AND queues an anchor for the reader to navigate to once it mounts. Mechanics: stash the anchor in a `pendingAnchor` ref, consumed by `ReaderWorkspace` on mount and cleared.

### 5.10 `useReaderHost` — minimal additions

- Rename `onBookRemovedWhileInReader` → `onBookRemovedFromActiveView` (clarifies the callback semantics now that two views can be active for a bookId).
- Cascade also fires when `view.kind === 'notebook'` for the removed book.
- No book-loading work in the notebook path — the notebook only reads annotation repos, which `useReaderHost` already exposes.

## 6. Data flow & error handling

### 6.1 Initial render

```
view changes to { kind: 'notebook', bookId } (via reader chrome's "Notebook" button)
  └─ App.tsx renders <NotebookView bookId={...} ... />
      └─ NotebookView mounts useNotebook({ bookId, ...repos })
          └─ Effect on mount:
             ├─ bookmarksRepo.listByBook(bookId)   →  setBookmarks(...)
             ├─ highlightsRepo.listByBook(bookId)  →  setHighlights(...)
             └─ notesRepo.listByBook(bookId)       →  setNotesByHighlightId(map)

          All three load in parallel; order doesn't matter — entries are
          a useMemo over all three. The list paints whatever's loaded so
          far; usually all three resolve in a single render.

          totalCount = bookmarks.length + highlights.length
          (notes are folded into highlight entries, not a separate count)
```

### 6.2 Search & filter (derived state)

```
User types in search input
  └─ NotebookSearchBar's local debounced state updates
      └─ onQueryChange(q) → notebook.setQuery(q)
          └─ entries memo recomputes:
             1. unified = [...bookmarks.map(toEntry), ...highlights.map(toEntry)]
             2. for highlight entries, attach note from notesByHighlightId
             3. filtered = unified.filter(e => matchesFilter(e, filter)
                                            && matchesQuery(e, query))
             4. sorted = filtered.sort(compareNotebookEntries)

User clicks a chip
  └─ onFilterChange('highlights') → notebook.setFilter(...)
      └─ entries memo recomputes (instant; no debounce on filter)
```

### 6.3 Click row → jump to passage

```
User clicks row content area (snippet/section title)
  └─ NotebookRow.onJumpToAnchor(locationAnchor)
      └─ NotebookView.props.onJumpToAnchor(locationAnchor)
          └─ App.tsx wraps as: () => view.goReaderAt(bookId, anchor)
              └─ view.goReaderAt:
                  1. set pendingAnchor ref to anchor
                  2. setView({ kind: 'reader', bookId })
              └─ NotebookView unmounts; ReaderWorkspace mounts
                  └─ ReaderWorkspace effect: if pendingAnchor present,
                     queue readerState.goToAnchor(pendingAnchor) and clear
```

For `kind: 'highlight'` entries, the row projects `HighlightAnchor` to `LocationAnchor` first (CFI passes through; PDF drops rects, keeps page). Same projection used in `HighlightsPanel`.

### 6.4 Edit operations (optimistic, with rollback)

```
User clicks × on a bookmark row
  └─ NotebookRow.onRemoveBookmark(b)
      └─ notebook.removeBookmark(b)
          ├─ bookmarks.filter(...) → setBookmarks([without b])      [optimistic]
          └─ bookmarksRepo.delete(b.id)                              [async]
              └─ on error: setBookmarks([...prev, b]); console.warn

User clicks × on a highlight row
  └─ notebook.removeHighlight(h)
      ├─ highlights.filter(...) → setHighlights(...)                [optimistic]
      ├─ notesByHighlightId.delete(h.id) → setNotesByHighlightId(...)[cascade]
      └─ Promise.all([
           highlightsRepo.delete(h.id),
           notesRepo.deleteByHighlight(h.id),
         ])
          └─ on error: restore both maps; console.warn

User picks a different color pip
  └─ notebook.changeColor(h, color)
      ├─ highlights.map(...) → setHighlights with new color         [optimistic]
      └─ highlightsRepo.patch(h.id, { color })
          └─ on error: revert; console.warn

User saves a note (via inline NoteEditor)
  └─ NotebookRow.onSaveNote(h, content)
      └─ notebook.saveNote(h, content)
          ├─ trim; if empty → clearNote(h) (calls deleteByHighlight)
          ├─ build/replace note record (new id if creating, reuse if existing)
          ├─ setNotesByHighlightId(...)                              [optimistic]
          └─ notesRepo.upsert(record)
              └─ on error: revert; console.warn
```

The optimistic-then-persist pattern with rollback mirrors the existing per-type hooks. Each operation is independent — a bookmark delete failure doesn't affect highlight state, and vice versa.

### 6.5 Cascade on book removal

```
User removes the open book from the library
  └─ useReaderHost.onRemoveBook(book)
      ├─ bookRepo + opfs + readingProgress + bookmarks/highlights/notes
      │   .delete                                                     (existing)
      └─ if currentView.kind in {'reader','notebook'} && currentView.bookId === book.id:
            → onBookRemovedFromActiveView?.()
```

### 6.6 Error surfaces

| Failure | Handling |
|---|---|
| Any of the three `listByBook` calls throws on load | The hook continues with whatever resolved; the failed list stays empty + `console.warn`. List partial; user can retry by going back and re-entering. |
| `bookmarksRepo.delete` / `highlightsRepo.delete` / `notesRepo.deleteByHighlight` throws | Restore optimistic state; `console.warn`. |
| `highlightsRepo.patch` (color change) throws | Revert color; `console.warn`. |
| `notesRepo.upsert` throws | Revert note map; `console.warn`. |
| Click row → reader, but anchor unresolvable in the engine | Reader's existing error overlay handles it; notebook is already gone from view. Consistent with how clicking an unresolvable bookmark works today. |
| `pendingAnchor` is set but the user navigates back to library before the reader mounts | The ref is read-and-cleared on reader mount; if reader never mounts, the ref persists harmlessly until the next reader mount, at which point it would jump unexpectedly. **Mitigation**: clear `pendingAnchor` whenever `setView` is called with a non-reader target. |
| Validator drops a corrupt record from `listByBook` | User sees one fewer entry; no crash. (Same as existing repos.) |
| Search input value is the empty string | `matchesQuery` short-circuits true; entries pass through unfiltered. |
| `query` contains regex special characters | `matchesQuery` does a literal substring match (`String.prototype.includes` after `toLowerCase`); no regex parsing, no escaping concerns. |
| Filter `'notes'` selected when no highlights have notes | Empty list; `NotebookEmptyState` renders with `reason='no-matches'`. |

### 6.7 State invariants

- `useNotebook.entries` is the only source of truth for what the list renders. It's a `useMemo` derived from `(bookmarks, highlights, notesByHighlightId, query, filter)`.
- The query string is the *raw* user input; trimming/lowercasing happens inside `matchesQuery`. (Keeps the input controlled with the user's exact string.)
- Filter is single-select: state can only be one of `'all' | 'bookmarks' | 'highlights' | 'notes'`.
- `pendingAnchor` is a one-shot: read once on the next reader mount, then cleared. Guarded by view-target on `setView`.
- The notebook never holds a reader engine reference. Edit operations bypass the engine entirely; the next time the user enters the reader, `loadHighlights` re-renders the (now mutated) list.
- The `useNotebook` hook is keyed by `bookId`. Switching books (which doesn't happen in v1 since notebook is opened from one reader) re-fetches.
- Inline note edit state lives inside `NotebookRow` (one row at a time can be in edit mode; matches `HighlightsPanel`'s pattern).

## 7. Testing

### 7.1 Unit tests (Vitest + happy-dom)

| File | Scope |
|---|---|
| `src/storage/repositories/settings.test.ts` (extend) | `isValidView` accepts `{kind:'notebook', bookId:'…'}`; rejects `{kind:'notebook'}` (missing bookId), `{kind:'notebook', bookId:''}` (empty), and `{kind:'notebook', bookId: 123}` (wrong type). Existing `'library'` and `'reader'` cases unchanged. |
| `src/app/view.test.ts` (new) | `notebookView('b1')` returns `{kind:'notebook', bookId:'b1'}`; type narrowing exhaustive over the three kinds. |
| `src/features/annotations/notebook/notebookSort.test.ts` (new) | `compareNotebookEntries`: bookmarks and highlights interleave by their anchor; PDF same-page sorts by y then x; EPUB sorts CFI-lex; mixed-anchor-kind fallback to `createdAt`. |
| `src/features/annotations/notebook/notebookFilter.test.ts` (new) | `matchesFilter('all', any) === true`; `matchesFilter('bookmarks', bookmark) === true`; `matchesFilter('notes', highlight)` → true iff `entry.note !== null`; `matchesFilter('highlights', highlight) === true`. |
| `src/features/annotations/notebook/notebookSearch.test.ts` (new) | `matchesQuery`: empty query returns true; substring match across snippet, sectionTitle, note content; case-insensitive; bookmark with null snippet falls back to sectionTitle only; highlight with null note searches snippet+sectionTitle only; literal regex characters (`.`, `*`, `(`, `)`) treated as text. |
| `src/features/annotations/notebook/useNotebook.test.ts` (new) | Initial load fetches all three repos; `entries` reflects union sorted in book order; `setQuery` filters live; `setFilter('notes')` shows only highlights with notes; `removeBookmark` optimistic + rollback on repo failure; `removeHighlight` cascades the note (both repos called) + rollback; `changeColor` patches optimistic + rollback; `saveNote` upserts (creating new id when none exists, reusing id when one does); `saveNote('')` calls `deleteByHighlight`; `bookId` change re-fetches. |
| `src/features/annotations/notebook/NotebookView.test.tsx` (new) | Mounts with chrome + search bar + list; renders empty state when no annotations (reason='no-entries'); renders empty state when filter excludes everything (reason='no-matches'); type filter chips toggle correctly; row click on snippet calls `onJumpToAnchor` with the projected `LocationAnchor`; row click on action button does NOT call `onJumpToAnchor`; back button calls `onBack`. |
| `src/features/annotations/notebook/NotebookRow.test.tsx` (new) | Bookmark row renders type tag "BOOKMARK", section title, snippet, single delete button; highlight row renders type tag "HIGHLIGHT", color bar, color pips, note button, delete; highlight row with note renders inline note line; click note line enters edit mode (renders NoteEditor); empty save calls onSaveNote with '' (delete path); ARIA roles correct. |
| `src/features/annotations/notebook/NotebookSearchBar.test.tsx` (new) | Search input is debounced ~150ms (use vi.useFakeTimers); chips render single-select with aria-pressed; clicking a chip calls onFilterChange; arrow-key navigation between chips; ⌘K / Ctrl+K focuses the search input. |
| `src/features/annotations/notebook/NotebookEmptyState.test.tsx` (new) | `reason='no-entries'` renders the welcome copy; `reason='no-matches'` renders the no-matches copy. |
| `src/shared/icons/icons.test.tsx` (new) | Each icon renders an `<svg>` with the `icon` class, the requested size, `aria-hidden="true"`, `focusable="false"`. Snapshot of the path `d` attributes (small fixed size; no churn risk). |
| `src/features/reader/ReaderChrome.test.tsx` (extend) | "Notebook" button visible on both viewports; calls `onOpenNotebook`. |
| `src/app/useReaderHost.test.ts` (extend) | `onRemoveBook` while view is `notebook(bookId)` for the removed book triggers the (renamed) `onBookRemovedFromActiveView` callback. |
| `src/app/useAppView.test.ts` (extend) | `goNotebook(bookId)` sets view to `{kind:'notebook', bookId}`; `goReaderAt(bookId, anchor)` sets view + queues `pendingAnchor`; subsequent `setView` to a non-reader target clears `pendingAnchor`. |

### 7.2 E2E tests (Playwright)

| File | Coverage |
|---|---|
| `e2e/notebook-open-from-reader.spec.ts` | Open EPUB → create 1 bookmark + 1 highlight + 1 note → click Notebook button in reader chrome → notebook page renders with 2 rows (the highlight and the bookmark, with the note inline) → reload → notebook view persists (settings restore). |
| `e2e/notebook-search-filter.spec.ts` | Open notebook with mixed annotations → type a substring matching only the note's content → only that highlight row visible → clear search → all visible → click "Bookmarks" chip → only bookmark rows → click "Notes" chip → only highlight-with-note rows → click "All" → all visible. |
| `e2e/notebook-jump-back-to-reader.spec.ts` | Open notebook → click on a highlight row's content → reader opens at that anchor (verify the highlight is visible in the reader after navigation). |
| `e2e/notebook-edit-inline.spec.ts` | Open notebook → click note button on a highlight row → editor opens inline → type a note → click outside → row updates with note text. Click delete (×) on a bookmark → row removed; reload → still removed. |
| `e2e/notebook-empty-states.spec.ts` | Open a freshly-imported book's notebook (no annotations) → "no annotations yet" copy visible. Then add one annotation, return to notebook, type a query that matches nothing → "no matches" copy visible. |
| `e2e/notebook-cascade-on-book-remove.spec.ts` | While viewing notebook → return to library (via reader → back to library) → remove the book → re-import → new book's notebook is empty. |
| `e2e/notebook-icons.spec.ts` | New chrome button has the SVG (assert `<svg class="icon">` present, no emoji glyph in the textContent); existing 📝 emoji is gone from the highlight toolbar (replaced with `<svg>`); existing 📝 in the highlights panel row also replaced. |

### 7.3 Skipped intentionally

- Cross-book notebook UX — out of scope (v1 stays per-book).
- Library-card-menu entry — out of scope; reader-chrome entry only.
- Multi-select chips — out of scope.
- Sort toggle (book order vs newest) — out of scope; book order only.
- Tag/color filtering — out of scope.
- Notebook export (markdown/CSV/PDF) — out of scope.
- Performance tests with thousands of annotations — premature; happy-path measurements during manual smoke.
- Concurrent multi-tab edits — same single-tab assumption as the rest of the app.
- Pending-anchor edge case where reader never mounts — covered by the unit test that exercises `pendingAnchor` clearing on non-reader `setView`.

### 7.4 Test fixtures

Existing `test-fixtures/small-pride-and-prejudice.epub` and `test-fixtures/multipage.pdf` cover EPUB + PDF paths. The notebook tests open one of these, perform the same selection-and-annotation steps as the 3.2/3.3 specs, then exercise the notebook surface.

## 8. File map

**New files:**
- `src/shared/icons/icon.css`
- `src/shared/icons/NotebookIcon.tsx`
- `src/shared/icons/NoteIcon.tsx`
- `src/shared/icons/ArrowLeftIcon.tsx`
- `src/shared/icons/index.ts` — barrel export
- `src/shared/icons/icons.test.tsx`
- `src/features/annotations/notebook/NotebookView.tsx`
- `src/features/annotations/notebook/NotebookView.test.tsx`
- `src/features/annotations/notebook/notebook-view.css`
- `src/features/annotations/notebook/NotebookChrome.tsx`
- `src/features/annotations/notebook/notebook-chrome.css`
- `src/features/annotations/notebook/NotebookSearchBar.tsx`
- `src/features/annotations/notebook/NotebookSearchBar.test.tsx`
- `src/features/annotations/notebook/notebook-search-bar.css`
- `src/features/annotations/notebook/NotebookList.tsx`
- `src/features/annotations/notebook/NotebookRow.tsx`
- `src/features/annotations/notebook/NotebookRow.test.tsx`
- `src/features/annotations/notebook/notebook-row.css`
- `src/features/annotations/notebook/NotebookEmptyState.tsx`
- `src/features/annotations/notebook/NotebookEmptyState.test.tsx`
- `src/features/annotations/notebook/notebook-empty-state.css`
- `src/features/annotations/notebook/useNotebook.ts`
- `src/features/annotations/notebook/useNotebook.test.ts`
- `src/features/annotations/notebook/notebookSort.ts`
- `src/features/annotations/notebook/notebookSort.test.ts`
- `src/features/annotations/notebook/notebookFilter.ts`
- `src/features/annotations/notebook/notebookFilter.test.ts`
- `src/features/annotations/notebook/notebookSearch.ts`
- `src/features/annotations/notebook/notebookSearch.test.ts`
- `src/features/annotations/notebook/types.ts` — `NotebookEntry`, `NotebookFilter`
- `src/app/view.test.ts` — new tests for `notebookView` helper + AppView narrowing
- 7 E2E specs under `e2e/`

**Modified files:**
- `src/storage/db/schema.ts` — extend `AppView` union with `'notebook'`
- `src/storage/repositories/settings.ts` — `isValidView` accepts `'notebook'` shape
- `src/storage/repositories/settings.test.ts` — extend
- `src/app/view.ts` — add `notebookView(bookId)` helper
- `src/app/useAppView.ts` — add `goNotebook(bookId)`, `goReaderAt(bookId, anchor)` + `pendingAnchor` ref + clear-on-non-reader-setView guard
- `src/app/useAppView.test.ts` — extend
- `src/app/useReaderHost.ts` — rename `onBookRemovedWhileInReader` to `onBookRemovedFromActiveView`; cascade also fires when view is `notebook(bookId)` for the removed book
- `src/app/useReaderHost.test.ts` — extend
- `src/app/App.tsx` — third branch for `view.kind === 'notebook'`; rename callback to `onBookRemovedFromActiveView`; consume `pendingAnchor` and pass to `ReaderWorkspace`
- `src/features/reader/ReaderChrome.tsx` — add Notebook button (SVG icon + label) + `onOpenNotebook` prop
- `src/features/reader/reader-chrome.css` — Notebook button styles
- `src/features/reader/ReaderChrome.test.tsx` — extend
- `src/features/reader/HighlightToolbar.tsx` — replace 📝 emoji with `<NoteIcon />`
- `src/features/reader/HighlightsPanel.tsx` — replace 📝 emoji with `<NoteIcon />`
- `src/features/reader/workspace/ReaderWorkspace.tsx` — accept and consume `pendingAnchor` on mount; expose `onOpenNotebook` to chrome via `useReaderHost`

## 9. Migration & compatibility

- `AppView` union extended additively. Existing persisted records (`'library'` or `'reader'` kinds) narrow correctly under the new union — no DB migration. `CURRENT_DB_VERSION` stays at 5.
- `isValidView` change is a forward-compat softening: a future `'notebook'` record persisted in v5 is now read correctly. Older app builds reading a notebook record would reject it via the existing `isValidView` and fall back to library — acceptable degradation.
- Renaming `onBookRemovedWhileInReader` → `onBookRemovedFromActiveView` is a non-public API change (internal hook). Done in one commit; all call sites updated.
- No domain-type changes. No repo-interface changes. Existing call sites of `bookmarksRepo.listByBook` etc. unchanged.
- Emoji-to-SVG swap in `HighlightToolbar` and `HighlightsPanel` is a pure presentation change — no data, no contracts touched. Existing E2E specs that asserted on the 📝 character will need updating; the new `notebook-icons.spec.ts` covers the SVG presence. Plan-level note: search the repo for any test or selector that targets `📝` literally and update to the SVG-based selector.

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| `pendingAnchor` ref persists across view changes if not cleared, causing a stale jump on the next reader mount | Clear `pendingAnchor` in `useAppView.setView` whenever the new view is not `'reader'`. Unit test exercises this. |
| Renaming `onBookRemovedWhileInReader` could miss a call site | Fully type-checked rename; `pnpm type-check` catches misses. Done as a discrete commit before the notebook work, so the diff is small and reviewable. |
| Search across `selectedText` of long highlights could be slow | Substring match on a few hundred items is sub-millisecond. We don't pre-process or index. If a single book ever has thousands of highlights, we revisit. |
| `compareNotebookEntries` returns 0 too often when bookmarks share an EPUB CFI prefix with a highlight | The comparator falls back to `createdAt` for ambiguous cases. Sorted output is deterministic but not necessarily intuitive in pathological cases. Documented; acceptable for v1. |
| User has no annotations on a book and clicks Notebook in the chrome | Empty state with `reason='no-entries'` renders cleanly. The chrome button doesn't grey out — the "review" page is still useful as a launchpad even when empty (consistent affordance). |
| User edits a note inline in the notebook, then jumps to that highlight via row-click | `onJumpToAnchor` runs after the note's blur (the click handler runs after blur). Save fires first; reader navigates with the saved state. |
| Mobile keyboard occludes the search bar when the user types | The search bar is sticky; on mobile the `visualViewport` resize is handled by browser native scrolling. Acceptable. |
| Closed shadow DOM (foliate) prevents text-selection inside the notebook from reaching outside listeners (relevant for the inline `NoteEditor`) | The notebook is not in an iframe — `NoteEditor`'s outside-click logic is fully effective here. (This is actually simpler than the reader case from 3.3.) |
| Library-menu entry deferred — users may discover the notebook later than expected | Reader-chrome entry is highly discoverable in practice (right next to typography/focus). If user feedback says "I want this from the library too", we add it without changing the data layer. |

**Open questions to resolve in implementation plan (not blocking):**
- Final SVG geometry for the three icons. The shapes in §5.1 are illustrative; implementation will iterate to match the Bookworm visual language.
- Whether `NotebookList` virtualizes rendering for very large lists. Lean: no; deferred until measured.
- Whether the search bar autofocuses on view mount. Lean: yes on desktop, no on mobile (avoids the soft keyboard popping up unexpectedly).

## 11. Acceptance criteria

A working build of this PR satisfies:

1. ✅ Reader chrome shows a "Notebook" button (SVG icon + text label). Clicking it opens the notebook for the currently-open book.
2. ✅ Notebook view shows every bookmark, highlight, and highlight-with-note for the open book in book order, with type tags ("BOOKMARK" / "HIGHLIGHT" / "NOTE") on the row's eyebrow line.
3. ✅ Search input filters live (~150ms debounce) across snippet, section title, and note content. Substring, case-insensitive.
4. ✅ Filter chips (single-select) [All / Bookmarks / Highlights / Notes] correctly narrow the list. Default "All".
5. ✅ Empty states: "no annotations yet" when nothing exists; "no matches" when filter/search excludes everything.
6. ✅ Click on a row's content area → notebook closes, reader opens at that anchor.
7. ✅ Inline edits in the notebook (delete bookmark, change highlight color, edit note via `NoteEditor`, delete highlight) persist and update the list optimistically with rollback on failure.
8. ✅ Deleting a highlight cascades the note (mirrors 3.3 behavior).
9. ✅ Reload preserves the notebook view (`view` setting persisted with `kind:'notebook'`).
10. ✅ Removing the book while the notebook is the active view navigates back to library.
11. ✅ Mobile (390×844): full-screen layout; search bar sticky on scroll; chip bar wraps if needed; rows readable without horizontal scroll.
12. ✅ All emoji icons in `HighlightToolbar` and `HighlightsPanel` are replaced with SVG components from `src/shared/icons/`. No literal `📝` glyph remains in the rendered DOM.
13. ✅ Type-check, lint, build all clean.
14. ✅ All existing tests pass; new unit + E2E tests pass.
