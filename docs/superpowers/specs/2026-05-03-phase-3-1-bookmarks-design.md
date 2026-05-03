# Phase 3.1 — Bookmarks design

**Status:** approved 2026-05-03
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 3 → Task 3.1
**Predecessors:** Phase 2.3 reader workspace (rail + sheet patterns, `ReaderViewExposedState`, hook composition in `useReaderHost`)

## 1. Goal & scope

Add the first durable thinking layer: bookmarks. A bookmark is a saved location in a book that the user can return to later.

**In scope (v1, this phase):**
- Tap ★ in the reader chrome to save the current location as a bookmark.
- View bookmarks for the open book in a rail tab (desktop) or tabbed sheet (mobile).
- Each bookmark shows its section title (chapter for EPUB, page for PDF), a short snippet of text from that location, and a relative timestamp ("just now", "2h ago").
- Click/tap a bookmark to jump to its anchor.
- Delete a bookmark from the list.
- All bookmarks persist across reload and survive book deletion correctly (cascade removal).

**Out of scope (deferred to later phases):**
- Notes attached to bookmarks → Task 3.3 (a bookmark+note is just a poor man's note; do notes properly there).
- Highlights & color tags → Task 3.2.
- Cross-book bookmark search/index → not needed in v1; bookmarks are scoped to the open book.
- Reordering / manual sort → newest-first is the only order in v1.
- Sync / export → outside annotation feature scope entirely.

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Note on bookmark | **None in v1** | Bookmarks are pure location-marks. Notes need their own surface (length limits, edit affordance) which we'll do properly in Task 3.3. |
| Toggle semantics | **Always-add** | Per-page toggle forces a "what counts as the same location" decision that's a swamp for EPUBs in scroll mode (CFIs are positions, not pages). Always-add gives a clean mental model. |
| Surface (desktop) | **Tabbed rail (Contents / Bookmarks)** | Rail is the "navigate this book" surface; bookmarks are a navigation aid. Sharing the slot is natural. Stacked sections (B) felt cluttered; popover (C) wasted the rail. |
| Surface (mobile) | **Tabbed sheet via existing ☰ button** | Same tab switcher as desktop, single button keeps the chrome uncluttered. ★ in chrome **adds** a bookmark; it does not open the panel. |
| List item content | **Chapter + ~80-char snippet + relative time** | A bookmark without a snippet is mostly a worse TOC entry. Snippet extraction is also groundwork for highlights (Task 3.2). |
| Snippet failure | **Graceful: snippet:null for image-only PDFs and other extraction failures** | List shows section title only when snippet is unavailable. |

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ ReaderWorkspace                                                   │
│  ├─ useFocusMode (existing)                                       │
│  ├─ useViewport (existing)                                        │
│  ├─ useBookmarks(bookId) — NEW                                    │
│  │   { list, add, remove }  ←─ owns repo IO + extractor calls     │
│  └─ readerState: ReaderViewExposedState                           │
│      { ..., getSnippetAt, getSectionTitleAt }                     │
│                                                                    │
│  ReaderChrome                                                      │
│   └─ ★ onClick → useBookmarks.add()                               │
│                                                                    │
│  Rail (desktop) / MobileSheet (mobile)                             │
│   └─ activeRailTab: 'contents' | 'bookmarks'                      │
│       ├─ TocPanel (existing)                                      │
│       └─ BookmarksPanel — NEW                                     │
│           { bookmarks, onSelect, onDelete }                       │
└──────────────────────────────────────────────────────────────────┘

Storage:
  bookmarks (IDB v3) ←─ BookmarksRepository ←─ useBookmarks
```

The split keeps each unit single-purpose:
- `BookmarksRepository` — pure storage I/O + record validation. No engine knowledge.
- `useBookmarks` — composes repo with the engine extractors (anchor, snippet, section). Owns the in-memory list. Format-agnostic.
- `BookmarksPanel` — pure presentation. No engine, no repo, no hooks beyond hover state.
- `ReaderChrome` — gains one prop (`onAddBookmark`); knows nothing about how the bookmark is captured.
- `EpubReaderAdapter` / `PdfReaderAdapter` — gain two methods on the `BookReader` contract. Format-specific extraction lives here.

## 4. Domain & storage

### 4.1 Domain type

Edit existing `src/domain/annotations/types.ts`:

```ts
export type Bookmark = {
  readonly id: BookmarkId;
  readonly bookId: BookId;
  readonly anchor: LocationAnchor;
  readonly snippet: string | null;       // ~80 chars at the bookmark; null if extraction failed
  readonly sectionTitle: string | null;  // e.g., "Chapter 4" — best-effort from TOC
  readonly createdAt: IsoTimestamp;
};
```

Drop the existing `note?: string` field — Task 3.3 will introduce notes as their own type.

The other types in this file (`Highlight`, `HighlightColor`, `Note`, `NoteAnchorRef`) are untouched in this phase — they're carried forward to Tasks 3.2 and 3.3.

### 4.2 IndexedDB schema

Bump `CURRENT_DB_VERSION` from 2 → 3. Add a new store:

```ts
// src/storage/db/schema.ts
export interface BookwormDBSchema extends DBSchema {
  // ...existing stores...
  bookmarks: {
    key: string;                          // BookmarkId (stringified)
    value: Bookmark;
    indexes: { 'by-book': string };       // BookId — for listByBook
  };
}

export const BOOKMARKS_STORE = 'bookmarks' as const;
```

### 4.3 Migration

Add to `src/storage/db/migrations.ts`:

```ts
// 2 → 3: Phase 3.1 bookmarks store
2: ({ db }) => {
  if (!db.objectStoreNames.contains('bookmarks')) {
    const store = db.createObjectStore('bookmarks', { keyPath: 'id' });
    store.createIndex('by-book', 'bookId', { unique: false });
  }
},
```

Migration is idempotent (`if (!db.objectStoreNames.contains(...))`) so re-running on already-v3 DBs is safe.

### 4.4 Repository

`src/storage/repositories/bookmarks.ts`:

```ts
export interface BookmarksRepository {
  add(bookmark: Bookmark): Promise<void>;
  patch(id: BookmarkId, partial: Partial<Bookmark>): Promise<void>;
  delete(id: BookmarkId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Bookmark[]>;
  deleteByBook(bookId: BookId): Promise<void>;     // cascade on book removal
}

export function createBookmarksRepository(db: BookwormDB): BookmarksRepository;
```

`patch` is needed for the optimistic-then-snippet flow (see §6). `deleteByBook` is wired into the existing book-removal flow in `useReaderHost.onRemoveBook`.

### 4.5 Validator

Parallel to `readerPreferences` validator soften:

```ts
function isValidAnchor(a: unknown): a is LocationAnchor {
  // discriminated-union check; same shape rules used in readingProgress repo
}

function normalizeBookmark(record: unknown): Bookmark | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Partial<Bookmark>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!r.anchor || !isValidAnchor(r.anchor)) return null;
  if (typeof r.createdAt !== 'string') return null;
  return {
    id: BookmarkId(r.id),
    bookId: BookId(r.bookId),
    anchor: r.anchor,
    snippet: typeof r.snippet === 'string' ? r.snippet : null,
    sectionTitle: typeof r.sectionTitle === 'string' ? r.sectionTitle : null,
    createdAt: IsoTimestamp(r.createdAt),
  };
}
```

`listByBook` filters out `null` from `normalizeBookmark` — corrupt records are silently dropped (logged in dev).

### 4.6 Wiring

Extend `Wiring` (`src/features/library/wiring.ts`) with `bookmarksRepo: BookmarksRepository`. Add to `useReaderHost.onRemoveBook` so deleting a book cascades to its bookmarks.

## 5. Reader engine: snippet & section extraction

### 5.1 `BookReader` interface — two new methods

```ts
// src/domain/reader/types.ts
export interface BookReader {
  // ...existing methods...
  getSnippetAt(anchor: LocationAnchor): Promise<string | null>;
  getSectionTitleAt(anchor: LocationAnchor): string | null;
}
```

Both are best-effort — return `null` (or `null` resolved) on any failure. Callers must handle `null`.

### 5.2 EPUB implementation

In `EpubReaderAdapter`:

- **`getSnippetAt`** — use foliate-js to resolve the CFI to a DOM range, then `range.toString().trim().slice(0, 80)`. If foliate throws or the range is empty, return `null`.
- **`getSectionTitleAt`** — walk the TOC entries, find the entry whose anchor's CFI section matches the anchor's CFI section (foliate exposes the section index via the CFI). Return `entry.label`, or `null` if no match.

No new dependencies — foliate already exposes CFI→range and section resolution.

### 5.3 PDF implementation

In `PdfReaderAdapter`:

- **`getSnippetAt`** — `await pdf.getPage(anchor.page).getTextContent()`, join `items[*].str` with `' '`, slice to 80 chars near `anchor.offset` if available, else from start. If `items.length === 0` (image-only page), return `null`.
- **`getSectionTitleAt`** — walk the TOC by `anchor.page`. Return matching `entry.label`. If no TOC, return `"Page ${anchor.page}"` so the user always sees something.

### 5.4 Workspace surface

`ReaderViewExposedState` gains the two extractors AND a `getCurrentAnchor` passthrough so the workspace never needs a direct adapter reference:

```ts
export type ReaderViewExposedState = {
  // ...existing fields...
  getCurrentAnchor: () => LocationAnchor | null;          // NEW — null if engine not ready
  getSnippetAt: (anchor: LocationAnchor) => Promise<string | null>;
  getSectionTitleAt: (anchor: LocationAnchor) => string | null;
};
```

`ReaderView` exposes all three by passing through to the adapter (`adapterRef.current?.getSnippetAt(anchor) ?? Promise.resolve(null)`). The `getCurrentAnchor` passthrough returns `null` when `adapterRef.current === null`, so callers can guard cleanly.

## 6. UI surface

### 6.1 `ReaderChrome` — star button

Add a single new icon at the right of the action group. Always visible on both viewports (always-add semantics — no need for state).

```
desktop: ←Library | Title | ⊟ ⚙ ★
mobile:  ←Library | Title | ⚙ ★ ☰
```

Props addition:

```ts
type Props = {
  // ...existing props...
  onAddBookmark: () => void;
};
```

After `onAddBookmark` resolves, the button briefly applies a `.reader-chrome__bookmark--pulse` class for 250ms (CSS keyframe scale 1 → 1.2 → 1) so the user sees confirmation. Implementation: local state in chrome, set on click, cleared via `setTimeout`.

`prefers-reduced-motion`: pulse animation disabled.

### 6.2 `BookmarksPanel`

`src/features/reader/BookmarksPanel.tsx` — pure presentation, parallel to `TocPanel`:

```ts
type Props = {
  readonly bookmarks: readonly Bookmark[];   // already sorted newest-first
  readonly onSelect: (b: Bookmark) => void;
  readonly onDelete: (b: Bookmark) => void;
};
```

**Row layout:**
```
┌─────────────────────────────────────────────┐
│ ★ Chapter 4 · 2h ago                  [×]   │
│ "...the marriage of Mr. Bingley to..."       │
└─────────────────────────────────────────────┘
```

- Top line: ★ + section title (or "—" if `null`) + relative time (small, muted)
- Second line: snippet truncated to one line via `text-overflow: ellipsis`. Hidden entirely if `snippet === null`.
- Delete `[×]`: always visible on mobile (touch); hover-revealed on desktop (matches `BookCard` remove pattern).
- Click anywhere on the row except `[×]` calls `onSelect`.

**Empty state:**

```
        ★
   No bookmarks yet
   Tap ★ in the toolbar to mark a spot.
```

Centered in the panel. Same visual language as `LibraryEmptyState`.

**Sort:** newest-first by `createdAt`. No UI toggle in v1.

**Relative time helper:** `src/shared/text/relativeTime.ts` (new). Pure function, takes an `IsoTimestamp` and returns `"just now"`, `"5m ago"`, `"2h ago"`, `"yesterday"`, `"3d ago"`, or a date for >7d. Tested.

### 6.3 `ReaderWorkspace` — tab switcher + new hook

**State additions** (inside `ReaderWorkspace`):
```ts
const [activeRailTab, setActiveRailTab] = useState<'contents' | 'bookmarks'>('contents');
const bookmarks = useBookmarks({
  bookId: BookId(props.bookId),
  repo: props.bookmarksRepo,
  readerState,                                  // null until first onStateChange fires
});
```

Workspace gains one new prop: `bookmarksRepo: BookmarksRepository`, plumbed through from `useReaderHost` which receives `wiring.bookmarksRepo`. No new direct reference to the adapter — `useBookmarks` reads everything it needs (`getCurrentAnchor`, `getSnippetAt`, `getSectionTitleAt`) off `readerState`.

**Rail header gains a tab switcher** (desktop):
```
┌─────────────────────────┐
│ Contents | Bookmarks ★3 │  ← tab switcher
├─────────────────────────┤
│ <active panel>          │
└─────────────────────────┘
```

The badge `★3` only shows when `bookmarks.list.length > 0`. Tab clicks toggle `activeRailTab`.

**Mobile sheet** uses the same tab switcher inside the sheet — opening ☰ shows whichever tab was last active.

**Wiring:**
- `<ReaderChrome onAddBookmark={bookmarks.add} ... />`
- `<BookmarksPanel bookmarks={bookmarks.list} onSelect={(b) => readerState.goToAnchor(b.anchor)} onDelete={bookmarks.remove} />`

On mobile, `onSelect` also closes the sheet (mirrors current TOC behavior).

### 6.4 `useBookmarks` hook

`src/features/reader/workspace/useBookmarks.ts`:

```ts
export type UseBookmarksHandle = {
  readonly list: readonly Bookmark[];
  readonly add: () => Promise<void>;       // captures current anchor + extractors
  readonly remove: (b: Bookmark) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly repo: BookmarksRepository;
  readonly readerState: ReaderViewExposedState | null;
};

export function useBookmarks(opts: Options): UseBookmarksHandle;
```

**Initial load:** `repo.listByBook(bookId)` on mount, set list state.

**Add flow:**
1. Guard: if `readerState == null`, return early (button is disabled in this state via the workspace).
2. Capture: `anchor = readerState.getCurrentAnchor()`. If `anchor == null` (engine not ready), return early. Then `sectionTitle = readerState.getSectionTitleAt(anchor)`.
3. Build optimistic record with `snippet: null`, `id: BookmarkId(crypto.randomUUID())`, `createdAt: IsoTimestamp(new Date().toISOString())`.
4. Insert at the head of `list` (newest-first).
5. `repo.add(bookmark)` — if it throws, remove from list. For v1 the failure surface is `console.warn` only (a transient-toast utility is its own polish task, not in scope here).
6. Async: `readerState.getSnippetAt(anchor).then(snippet => ...)`. On resolve (snippet may be `null`), patch the in-memory list and `repo.patch(id, { snippet })`. On reject, leave snippet as `null`.

**Remove flow:**
1. Optimistic remove from list.
2. `repo.delete(id)` — if it throws, restore (push back, then re-sort), log error.

**Re-keying:** When `bookId` changes, the hook re-runs and reloads the list for the new book.

## 7. Data flow & error handling

### 7.1 Add flow (sequence)

```
User taps ★
  └─ onAddBookmark()
      └─ useBookmarks.add()
          ├─ readerState.getCurrentAnchor()                   [sync, may be null]
          ├─ readerState.getSectionTitleAt(anchor)            [sync]
          ├─ list.unshift({ ...bookmark, snippet: null })     [optimistic]
          ├─ chrome plays pulse animation                     [250ms]
          ├─ repo.add(bookmark)                               [async]
          │   └─ on error: list.remove(bookmark); console.warn
          └─ readerState.getSnippetAt(anchor).then(snippet =>
              ├─ list.patch(id, { snippet })
              └─ repo.patch(id, { snippet })
            )
```

### 7.2 Delete flow

```
User taps [×]
  └─ onDelete(bookmark)
      └─ useBookmarks.remove(bookmark)
          ├─ list.remove(bookmark)                            [optimistic]
          └─ repo.delete(id)                                  [async]
              └─ on error: list.push(bookmark); list.sort()
```

### 7.3 Jump flow

```
User clicks bookmark row
  └─ onSelect(bookmark)
      └─ readerState.goToAnchor(bookmark.anchor)
      └─ if mobile: setActiveSheet(null)
```

### 7.4 Error surfaces

| Failure | Handling |
|---|---|
| `getSnippetAt` rejects | Caught in `.then` chain. Snippet stays `null`. `console.warn`. |
| `getSectionTitleAt` returns `null` | Row shows "—" in place of section title. |
| `repo.add` throws | Roll back the optimistic insert. `console.warn`. (Toast utility deferred to a future polish phase.) |
| `repo.delete` throws | Restore the deleted item. `console.warn`. |
| Adapter null at click time | ★ is disabled (greyed out). No error to surface. |
| Anchor unresolvable on jump | `goToAnchor` is already wrapped in the reader machine's error state. The bookmark stays in the list — user sees the existing reader error overlay and can use Back. |
| Book deleted with bookmarks present | `useReaderHost.onRemoveBook` extends to also call `bookmarksRepo.deleteByBook(bookId)`. |
| Corrupt bookmark record in IDB | Validator soften drops the record from `listByBook` results. User sees one fewer bookmark; no crash. |

### 7.5 State invariants

- `useBookmarks` is keyed by `bookId`. Switching books re-fetches.
- The in-memory list is the source of truth for the panel. IDB is the persistence boundary.
- The list is always sorted newest-first. `add` inserts at head; `remove` preserves order; `patch` mutates in place.
- No global bookmark store. Bookmarks for a closed book are not in memory.
- Tab state (`activeRailTab`) is local to the workspace, not persisted across reload. (We can add persistence later if it matters; v1 keeps it simple.)

## 8. Testing

### 8.1 Unit tests (Vitest + happy-dom)

| File | Scope |
|---|---|
| `src/storage/repositories/bookmarks.test.ts` | `add` → `listByBook` round-trip; `delete`; `patch`; `deleteByBook` cascade; validator drops corrupt records; `listByBook` returns newest-first by `createdAt`. |
| `src/storage/db/migrations.test.ts` (extend) | v2 → v3 creates `bookmarks` store + `by-book` index; existing v2 records survive; idempotent re-run. |
| `src/domain/annotations/types.test.ts` | `BookmarkId` brand round-trip; type stays exhaustive. |
| `src/shared/text/relativeTime.test.ts` | "just now" (<60s), "Nm ago" (<1h), "Nh ago" (<24h), "yesterday" (24-48h), "Nd ago" (<7d), full date (≥7d). Edge: exactly 60s, exactly 24h. |
| `src/features/reader/workspace/useBookmarks.test.ts` | `add` calls `getCurrentAnchor` + extractors and writes optimistic record (snippet:null), then patches; `add` rolls back on repo failure; `remove` rolls back on repo failure; `add` patches snippet on async resolve; book change re-fetches list. |
| `src/features/reader/BookmarksPanel.test.tsx` | Renders rows; empty state; calls `onSelect` on row click; calls `onDelete` on `[×]` click; sort newest-first; null snippet hidden; null sectionTitle shows "—". |
| `src/features/reader/ReaderChrome.test.tsx` (extend) | `★` button visible on both viewports; calls `onAddBookmark`; pulse class applied for 250ms after click. |

### 8.2 E2E tests (Playwright)

| File | Coverage |
|---|---|
| `e2e/bookmarks-add-list-jump.spec.ts` | Open EPUB at default desktop viewport → tap ★ → switch rail tab to Bookmarks → see entry with section title (snippet may be empty initially, must appear within 1500ms) → click entry → reader navigates. Reload → entry persists. |
| `e2e/bookmarks-delete.spec.ts` | Add 2 bookmarks → delete first → only second remains in list and badge. Reload → still gone. |
| `e2e/bookmarks-pdf.spec.ts` | Open `multipage.pdf` → bookmark page 3 → entry shows page-based section title and a non-null snippet (this fixture has a text layer). |
| `e2e/bookmarks-mobile.spec.ts` | 390×844 viewport → tap ★ to add → tap ☰ → switch to Bookmarks tab in sheet → tap entry → sheet dismisses + reader navigates. |
| `e2e/bookmarks-cascade-on-remove.spec.ts` | Open book, add 1 bookmark, navigate back to library, remove the book, re-import the same file → bookmark from the previous import does not appear (cascade worked). |

### 8.3 Skipped intentionally

- Snippet extraction in unit tests: requires a real EPUB blob and foliate-js DOM, covered via E2E.
- `useBookmarks` integration with real IDB: the repo is tested directly; the hook is tested with a fake repo (mirrors `useReaderHost` testing pattern).
- "Currently bookmarked" indicator: we chose always-add, no per-page state to test.
- Image-only PDF snippet=null path: requires sourcing a fixture; logic is covered by the unit test that exercises `getSnippetAt` returning `null`.

## 9. File map

**New files:**
- `src/storage/repositories/bookmarks.ts`
- `src/storage/repositories/bookmarks.test.ts`
- `src/features/reader/BookmarksPanel.tsx`
- `src/features/reader/bookmarks-panel.css`
- `src/features/reader/BookmarksPanel.test.tsx`
- `src/features/reader/workspace/useBookmarks.ts`
- `src/features/reader/workspace/useBookmarks.test.ts`
- `src/shared/text/relativeTime.ts`
- `src/shared/text/relativeTime.test.ts`
- 5 E2E specs under `e2e/`
- `src/domain/annotations/types.test.ts`

**Modified files:**
- `src/domain/annotations/types.ts` — drop `note?` from `Bookmark`, add `snippet`/`sectionTitle`
- `src/storage/db/schema.ts` — bump to v3, add `bookmarks` store + index
- `src/storage/db/migrations.ts` — add 2→3 migration
- `src/storage/db/migrations.test.ts` — extend with v2→v3 test
- `src/features/library/wiring.ts` — add `bookmarksRepo`
- `src/domain/reader/types.ts` — add `getSnippetAt` and `getSectionTitleAt` to `BookReader`; extend `ReaderViewExposedState`
- `src/features/reader/epub/EpubReaderAdapter.ts` — implement extractors
- `src/features/reader/pdf/PdfReaderAdapter.ts` — implement extractors
- `src/features/reader/ReaderView.tsx` — pass extractors through `onStateChange`
- `src/features/reader/ReaderChrome.tsx` — add ★ button + pulse animation
- `src/features/reader/reader-chrome.css` — pulse keyframe
- `src/features/reader/workspace/ReaderWorkspace.tsx` — tab switcher state, `useBookmarks` wiring, route panels by `activeRailTab`
- `src/features/reader/workspace/DesktopRail.tsx` — generalised: instead of taking `toc`+`onSelect` directly, takes a `tabs: { key, label, badge?, content: ReactNode }[]` plus `activeKey` and `onTabChange`. The workspace builds the tabs (Contents → `<TocPanel>`, Bookmarks → `<BookmarksPanel>`) and passes them in.
- `src/features/reader/workspace/MobileSheet.tsx` — no API change. The tabbed content renders as the sheet's `children`, identical to today.
- `src/app/useReaderHost.ts` — `onRemoveBook` cascades to `bookmarksRepo.deleteByBook`

## 10. Migration & compatibility

- IDB schema bump 2 → 3. Migration is additive (new store) — no data transformation. Existing books, settings, reading_progress, reader_preferences are untouched.
- No domain field renames — `Bookmark` is a new-in-this-phase consumer of an existing type.
- Forward compatibility: validator soften ensures records written by future versions with extra fields don't break the v3 reader.

## 11. Risks & open questions

| Risk | Mitigation |
|---|---|
| Snippet extraction in foliate-js may need a CFI→range API we haven't used | Prototype during T2 (engine extractor task). If it requires significant foliate-js spelunking, reduce snippet to "first 80 chars of section text" as a fallback. |
| Pulse animation on ★ may feel jarring with rapid bookmark spamming | Debounce or disable animation during pulse. Acceptable to defer to polish. |
| Tab switcher in the rail adds a small new pattern not used elsewhere yet | Keep it minimal — just two text buttons with active state. No new component, just a row of `<button>`s in the rail header. |
| `getCurrentAnchor` may be stale if user is mid-page-turn | Reader engine debounces location changes; getCurrentAnchor returns the last settled position. Acceptable for v1. |

## 12. Acceptance criteria

A working build of this PR satisfies:

1. ✅ Open a book, tap ★ → bookmark appears in the rail's Bookmarks tab with section title and (within ~1.5s) a snippet. Reload → still there.
2. ✅ Bookmarks tab badge shows the count when ≥1 bookmarks exist.
3. ✅ Click a bookmark → reader jumps to its anchor.
4. ✅ Delete a bookmark → it's gone from the list and from IDB. Reload confirms.
5. ✅ Mobile (390×844): ★ adds; ☰ opens a sheet with Contents/Bookmarks tabs; tap a bookmark → sheet dismisses and reader navigates.
6. ✅ Remove a book → its bookmarks are gone from IDB (verified by re-importing the same file).
7. ✅ Image-only PDF page bookmark: section title shown, snippet field hidden gracefully.
8. ✅ All existing tests pass; new unit + E2E tests pass.
9. ✅ Type-check, lint, build all clean.
