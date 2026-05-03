# Phase 3.2 — Highlights design

**Status:** approved 2026-05-03
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 3 → Task 3.2
**Predecessors:** Phase 2.3 reader workspace, Phase 3.1 bookmarks (rail-tabs pattern, sheet-tabs pattern, optimistic-then-persist hook pattern, cascade-on-remove pattern)

## 1. Goal & scope

Add color-coded highlights drawn over selected text in EPUB and PDF books. The user selects text, picks a color, and the highlight is rendered on the page and listed in a new Highlights tab in the rail (or sheet on mobile). Highlights persist across reload and survive book deletion correctly.

**In scope (v1, this phase):**
- Select text in the reader → floating toolbar appears with 4 color choices.
- Tap a color → highlight is rendered over the selection AND saved.
- Tap a rendered highlight → toolbar reappears with the current color pre-selected + a delete affordance.
- Highlights tab in the rail (third tab next to Contents and Bookmarks) lists all highlights for the open book in **book order** with section title + selected-text snippet + color swatch + relative time.
- Click a list row → reader navigates to the highlight.
- Delete from list (× on row) or via the in-reader edit toolbar.
- Color change via the in-reader edit toolbar OR a color-pip menu on the list row.
- Mobile: same tabbed sheet UX (Contents / Bookmarks / Highlights).
- All highlights persist; book removal cascades.

**Out of scope (deferred to later phases):**
- Tags on highlights → field stays as `readonly string[]` in the type for forward-compat but is always `[]` (no UI). A tag editor (or merge with notes) is its own feature.
- Notes attached to highlights → Task 3.3 (the `NoteAnchorRef` type already references `HighlightId`).
- Custom colors (only the 4 in `HighlightColor`).
- Highlight overlap UX (multiple highlights covering the same text) — first one wins on tap; we revisit if it surfaces in practice.
- Drag/resize highlights post-creation.
- Cross-book highlight search/index — scoped to the open book.
- Annotation export.

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Tags in v1 | **Always `[]`, no UI** | Same scoping argument as bookmark notes in 3.1 — small ad-hoc tag UI in 3.2 produces a feature we'd redo properly later. Field stays for schema continuity. |
| Selection trigger | **Floating color toolbar above selection** | iOS / Kindle pattern. One tap = action+color in a single gesture. A chrome button means a second tap to change color and adds chrome that's only relevant during selection. A context menu inherits browser chrome that doesn't fit the reader. |
| PDF persistence shape | **Visual rects (`{page, rects}`) + `selectedText`** | PDF is fundamentally visual. Storing PDF-coord rects is what PDFs *mean*; reconstructing them from a selection is straightforward via `viewport.convertToPdfPoint`. Text-layer offsets are brittle across pdfjs upgrades; text fingerprints are slow and fail on duplicates. We store `selectedText` separately for the list panel + later AI grounding. |
| Tap-on-highlight | **Inline action popover (color change + delete)** | Same component as the creation toolbar with a different prop set. A no-op model (visual-only) means mistakes are friction-rich. A "scroll the rail to the row" model is heavyweight, especially on mobile. |
| Highlight list sort | **Book order** (CFI-lex for EPUB, `(page, rects[0].y, rects[0].x)` for PDF) | Reading sequentially through highlights is the natural mental model. Createdat order makes sense for log-style entries (bookmarks); highlights are about content, so content order wins. |

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ ReaderWorkspace                                                     │
│  ├─ useFocusMode (existing)                                         │
│  ├─ useViewport (existing)                                          │
│  ├─ useBookmarks (existing)                                         │
│  ├─ useHighlights(bookId)  — NEW                                    │
│  │   { list, add, changeColor, remove }                             │
│  ├─ readerState: ReaderViewExposedState                             │
│  │   { ..., loadHighlights, addHighlight, removeHighlight,         │
│  │     onSelectionChange, onHighlightTap }                         │
│  ├─ activeRailTab: 'contents' | 'bookmarks' | 'highlights'         │
│  └─ activeToolbar: { kind: 'create'|'edit', ... } | null            │
│                                                                      │
│  ReaderChrome (unchanged for highlights)                             │
│                                                                      │
│  Rail (desktop) / MobileSheet (mobile)                               │
│   ├─ TocPanel (existing)                                            │
│   ├─ BookmarksPanel (existing)                                      │
│   └─ HighlightsPanel — NEW                                          │
│                                                                      │
│  HighlightToolbar (single instance) — NEW                            │
│   ├─ mode='create' on selection                                     │
│   └─ mode='edit' on tap-existing                                    │
└────────────────────────────────────────────────────────────────────┘

Storage:
  highlights (IDB v4) ←─ HighlightsRepository ←─ useHighlights

Engine:
  EpubReaderAdapter — uses foliate's view.addAnnotation + Overlayer.highlight
                      and selectionchange listener on each section's doc
  PdfReaderAdapter  — selectionchange on text-layer, custom highlight-layer DOM
                      using PDF-coord rects
```

Each unit single-purpose:
- `HighlightsRepository` — pure storage + record validation. No engine knowledge.
- `useHighlights` — composes repo with `readerState.{addHighlight, removeHighlight, getSectionTitleAt}`. Owns the in-memory list. Format-agnostic.
- `HighlightsPanel` — pure presentation.
- `HighlightToolbar` — pure presentation, positioned by parent.
- Engine adapters — selection capture + highlight render. Per-format.

## 4. Domain & storage

### 4.1 Domain types

Replace existing `Highlight` (drop `range`/`normalizedText`) and add new `HighlightAnchor`:

```ts
// src/domain/annotations/types.ts
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export type HighlightRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type HighlightAnchor =
  | { readonly kind: 'epub-cfi'; readonly cfi: string }
  | { readonly kind: 'pdf'; readonly page: number; readonly rects: readonly HighlightRect[] };

export type Highlight = {
  readonly id: HighlightId;
  readonly bookId: BookId;
  readonly anchor: HighlightAnchor;
  readonly selectedText: string;
  readonly sectionTitle: string | null;
  readonly color: HighlightColor;
  readonly tags: readonly string[];   // always [] in v1
  readonly createdAt: IsoTimestamp;
};
```

Rationale for the breaking refactor of the existing `Highlight`:
- The old `range: LocationRange` (start + end LocationAnchor) doesn't fit either format. CFIs already encode ranges; PDF rects don't fit `LocationAnchor.pdf`'s point-based shape.
- `normalizedText` had no consumer. Removed.
- `HighlightAnchor` is intentionally distinct from `LocationAnchor` (range vs point semantics). `Bookmark` continues to use `LocationAnchor`.

`Highlight` was never persisted before this phase (the type existed, but no storage or UI consumed it), so the refactor is a domain-level change without migration concerns.

### 4.2 IndexedDB schema

Bump `CURRENT_DB_VERSION` from 3 → 4. Add a new store:

```ts
// src/storage/db/schema.ts
export interface BookwormDBSchema extends DBSchema {
  // ...existing stores...
  highlights: {
    key: string;                        // HighlightId
    value: Highlight;
    indexes: { 'by-book': string };     // BookId
  };
}

export const HIGHLIGHTS_STORE = 'highlights' as const;
```

### 4.3 Migration

```ts
// src/storage/db/migrations.ts
3: ({ db }) => {
  if (!db.objectStoreNames.contains('highlights')) {
    const store = db.createObjectStore('highlights', { keyPath: 'id' });
    store.createIndex('by-book', 'bookId', { unique: false });
  }
},
```

Idempotent; existing v3 stores untouched.

### 4.4 Repository

`src/storage/repositories/highlights.ts`:

```ts
export interface HighlightsRepository {
  add(highlight: Highlight): Promise<void>;
  patch(id: HighlightId, partial: Partial<Pick<Highlight, 'color'>>): Promise<void>;
  delete(id: HighlightId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Highlight[]>;   // sorted in book order
  deleteByBook(bookId: BookId): Promise<void>;
}

export function createHighlightsRepository(db: BookwormDB): HighlightsRepository;
```

The `patch` partial is restricted to `color` (the only field user-mutable post-creation in v1).

### 4.5 Validator

```ts
function isValidHighlightAnchor(v: unknown): v is HighlightAnchor {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as { kind?: unknown };
  if (a.kind === 'epub-cfi') {
    return typeof (v as { cfi?: unknown }).cfi === 'string';
  }
  if (a.kind === 'pdf') {
    const p = v as { page?: unknown; rects?: unknown };
    return (
      typeof p.page === 'number' &&
      Array.isArray(p.rects) &&
      p.rects.every(
        (r) =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as HighlightRect).x === 'number' &&
          typeof (r as HighlightRect).y === 'number' &&
          typeof (r as HighlightRect).width === 'number' &&
          typeof (r as HighlightRect).height === 'number',
      )
    );
  }
  return false;
}

const VALID_COLORS: ReadonlySet<HighlightColor> = new Set(['yellow', 'green', 'blue', 'pink']);

function normalizeHighlight(record: unknown): Highlight | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Highlight>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!isValidHighlightAnchor(r.anchor)) return null;
  if (typeof r.selectedText !== 'string') return null;
  if (typeof r.color !== 'string' || !VALID_COLORS.has(r.color as HighlightColor)) return null;
  if (typeof r.createdAt !== 'string') return null;
  return {
    id: HighlightId(r.id),
    bookId: BookId(r.bookId),
    anchor: r.anchor,
    selectedText: r.selectedText,
    sectionTitle: typeof r.sectionTitle === 'string' ? r.sectionTitle : null,
    color: r.color,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    createdAt: IsoTimestamp(r.createdAt),
  };
}
```

`listByBook` filters out `null` from `normalizeHighlight` and sorts via the comparator in §4.6.

### 4.6 Sort order

`src/features/reader/workspace/highlightSort.ts` — pure comparator:

```ts
export function compareHighlightsInBookOrder(a: Highlight, b: Highlight): number {
  if (a.anchor.kind === 'pdf' && b.anchor.kind === 'pdf') {
    if (a.anchor.page !== b.anchor.page) return a.anchor.page - b.anchor.page;
    const ar = a.anchor.rects[0];
    const br = b.anchor.rects[0];
    if (!ar || !br) return 0;
    if (ar.y !== br.y) return ar.y - br.y;
    if (ar.x !== br.x) return ar.x - br.x;
  }
  if (a.anchor.kind === 'epub-cfi' && b.anchor.kind === 'epub-cfi') {
    // Foliate exports CFI.compare; if not exposed via our types, fall back to lex.
    return a.anchor.cfi < b.anchor.cfi ? -1 : a.anchor.cfi > b.anchor.cfi ? 1 : 0;
  }
  // Mixed kinds in the same book shouldn't happen; stable fallback by createdAt.
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
```

If foliate's `CFI.compare` is exposed via a public path we can use, the plan will swap the lex compare. Lex on raw CFI strings works for the vast majority of EPUB books because foliate generates lexicographically-sortable CFIs; documented as a v1 best-effort.

### 4.7 Wiring

Extend `Wiring` (`src/features/library/wiring.ts`) with `highlightsRepo: HighlightsRepository`. Add to `useReaderHost.onRemoveBook` so deleting a book cascades to its highlights.

## 5. Engine API: selection capture + highlight rendering

### 5.1 New types in `src/domain/reader/types.ts`

```ts
export type SelectionInfo = {
  readonly anchor: HighlightAnchor;
  readonly selectedText: string;
  readonly screenRect: { x: number; y: number; width: number; height: number };
};

export type SelectionListener = (selection: SelectionInfo | null) => void;
export type HighlightTapListener = (
  id: HighlightId,
  screenPos: { x: number; y: number },
) => void;
```

### 5.2 `BookReader` interface — five new methods

```ts
export interface BookReader {
  // ...existing methods, plus:
  loadHighlights(highlights: readonly Highlight[]): void;
  addHighlight(highlight: Highlight): void;        // upserts; same id replaces (color change path)
  removeHighlight(id: HighlightId): void;
  onSelectionChange(listener: SelectionListener): () => void;
  onHighlightTap(listener: HighlightTapListener): () => void;
}
```

Both subscription methods return an unsubscribe.

### 5.3 EPUB implementation

In `EpubReaderAdapter`:

**Selection capture:**
- foliate fires `'create-overlay'` for each section as it loads. Inside the listener, attach a `selectionchange` handler to that section's `contentDocument`.
- On change: if `selection.toString().trim()` is empty, fire `onSelectionChange(null)`. Otherwise build:
  - `cfi = view.getCFI(sectionIndex, range)`
  - `selectedText = range.toString()`
  - `screenRect` from `range.getBoundingClientRect()` translated to viewport coords (the iframe is positioned absolutely; we add the iframe's offset).
  - Fire `onSelectionChange({anchor: {kind:'epub-cfi', cfi}, selectedText, screenRect})`.

**Render:**
- `loadHighlights(list)`: store the list internally as `highlightsById: Map<HighlightId, Highlight>` and `highlightsBySectionId: Map<sectionIndex, HighlightId[]>`. Iterate and call `addAnnotation` for each highlight whose section is currently loaded.
- `addHighlight(h)`: store in maps. Call `view.addAnnotation({value: h.anchor.cfi, color: COLOR_HEX[h.color], id: h.id})`. Listen for `'draw-annotation'` (registered once at init): in the handler, call `draw(Overlayer.highlight, {color: annotation.color})`.
- `removeHighlight(id)`: look up CFI by id, call `view.deleteAnnotation({value: cfi})`. Drop from maps.

**Re-render on section navigation:**
- In `'create-overlay'`, the adapter knows the section index just rendered. Re-add highlights from `highlightsBySectionId.get(sectionIndex)`.

**Tap:**
- Listen for foliate's `'show-annotation'`. The annotation's `value` (CFI) maps to a highlight id via reverse lookup. Compute the click's screenPos from the event's range (use `range.getBoundingClientRect()` center).

### 5.4 PDF implementation

In `PdfReaderAdapter`:

**Selection capture:**
- Listen for `selectionchange` on `document`. On fire, get `window.getSelection()`. If the anchor isn't inside a `.pdf-reader__text-layer`, ignore. Else:
  - Walk up to find which `[data-page]` ancestor wraps the text layer to identify the page.
  - Convert `range.getClientRects()` to PDF coordinate rects via `page.getViewport({scale: this.currentScale}).convertToPdfPoint(x, y)`. (We store the scaled rects' inverse-mapped coords so they survive zoom changes.)
  - Build `screenRect` from `range.getBoundingClientRect()` for toolbar positioning.
  - Fire `onSelectionChange({anchor: {kind:'pdf', page, rects}, selectedText, screenRect})`.

**Render:**
- Each `PdfPageView` gains a `<div class="pdf-reader__highlight-layer">` sibling next to the text-layer (z-index between canvas and text-layer so text is still selectable through it via `pointer-events: none`).
- The adapter tracks `highlightsByPage: Map<page, Highlight[]>`. When `PdfPageView` finishes rendering a page, it calls back `adapter.onPageRendered(page, highlightLayerEl, viewport)`. The adapter walks `highlightsByPage.get(page)` and for each highlight + each rect, appends an `<div class="pdf-highlight" data-id="…" data-color="…" style="left:…;top:…;width:…;height:…">`. CSS:
  ```css
  .pdf-highlight { position: absolute; mix-blend-mode: multiply; opacity: 0.4; pointer-events: auto; }
  .pdf-highlight[data-color="yellow"] { background: #fef08a; }
  /* etc */
  ```
- `addHighlight(h)`: store + render on the visible page.
- `removeHighlight(id)`: find the matching DOM nodes by `[data-id]` and remove.

**Tap:**
- `pointer-events: auto` on `.pdf-highlight` — click handler reads `data-id`, fires `onHighlightTap` with `{x: e.clientX, y: e.clientY}`.

**Color hex map:** `COLOR_HEX: Record<HighlightColor, string>` lives in `src/features/reader/highlightColors.ts` (shared between EPUB Overlayer + PDF CSS data-attrs + the toolbar).

### 5.5 Workspace surface

`ReaderViewExposedState` gains:

```ts
type ReaderViewExposedState = {
  // ...existing fields...
  loadHighlights: (highlights: readonly Highlight[]) => void;
  addHighlight: (highlight: Highlight) => void;
  removeHighlight: (id: HighlightId) => void;
  onSelectionChange: (listener: SelectionListener) => () => void;
  onHighlightTap: (listener: HighlightTapListener) => () => void;
};
```

`ReaderView` exposes them by passing through to the adapter (with the same null-adapter guards as existing extractors).

## 6. UI surface

### 6.1 `HighlightToolbar`

`src/features/reader/HighlightToolbar.tsx` — the single-instance floating toolbar:

```ts
type Mode = 'create' | 'edit';

type Props = {
  readonly mode: Mode;
  readonly screenRect: { x: number; y: number; width: number; height: number };
  readonly currentColor?: HighlightColor;
  readonly onPickColor: (color: HighlightColor) => void;
  readonly onDelete?: () => void;
  readonly onDismiss: () => void;
};
```

**Layout:** a small dark-pill toolbar with 4 color-dot buttons + (in edit mode) a divider and a × button. Positioned absolutely at `screenRect.top - toolbarHeight - 8px`; if it would clip above viewport, flip below. Centered on `screenRect.left + screenRect.width / 2`.

**Behavior:**
- Outside-click handler (registered on `document`) calls `onDismiss`.
- Escape calls `onDismiss`.
- Window scroll calls `onDismiss` (selection often invalidates on scroll).
- In edit mode, the `currentColor` dot is visually marked (ring).

**Reduced motion:** no entry animation by default; if we add one later, gate on `prefers-reduced-motion`.

### 6.2 `HighlightsPanel`

`src/features/reader/HighlightsPanel.tsx` — pure presentation, parallel to `BookmarksPanel`:

```ts
type Props = {
  readonly highlights: readonly Highlight[];   // already in book order
  readonly onSelect: (h: Highlight) => void;
  readonly onDelete: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
};
```

**Row:**
```
┌─────────────────────────────────────────────────┐
│ ▌ Chapter 4 · 2h ago               [🟡][🟢][🔵][🟣] [×] │
│   "...the marriage of Mr. Bingley to..."        │
└─────────────────────────────────────────────────┘
```
- Left: 4px-wide colored vertical bar in the highlight's color.
- Top line: section title + relative time.
- Second line: `selectedText` truncated to one line.
- Right (hover-revealed on desktop, always-visible on touch): 4 small color dots + `×`.

**Empty state:** *"No highlights yet. Select text in the reader and tap a color."*

### 6.3 `useHighlights` hook

`src/features/reader/workspace/useHighlights.ts`:

```ts
export type UseHighlightsHandle = {
  readonly list: readonly Highlight[];
  readonly add: (
    anchor: HighlightAnchor,
    selectedText: string,
    color: HighlightColor,
  ) => Promise<void>;
  readonly changeColor: (h: Highlight, color: HighlightColor) => Promise<void>;
  readonly remove: (h: Highlight) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly repo: HighlightsRepository;
  readonly readerState: ReaderViewExposedState | null;
};

export function useHighlights(opts: Options): UseHighlightsHandle;
```

**Initial load:** `repo.listByBook(bookId)` on mount, set list state.

**Add flow:**
1. Guard: if `readerState == null`, no-op.
2. `sectionTitle = readerState.getSectionTitleAt(anchorAsLocationAnchor)` — for EPUB, pass through CFI; for PDF, project to `{kind:'pdf', page}` (drop rects).
3. Build: `{id: HighlightId(crypto.randomUUID()), bookId, anchor, selectedText, sectionTitle, color, tags: [], createdAt: IsoTimestamp(new Date().toISOString())}`.
4. Insert into list (sorted via comparator); call `readerState.addHighlight(highlight)` to render overlay.
5. `repo.add(highlight)` async — on error, remove from list + `readerState.removeHighlight` + `console.warn`.

**Change-color flow:**
1. Optimistic: patch list entry's color in place (preserve sort position).
2. Call `readerState.addHighlight({...h, color})` — adapter upserts overlay.
3. `repo.patch(h.id, {color})` async — on error, revert + re-render with old color.

**Remove flow:**
1. Optimistic: remove from list.
2. `readerState.removeHighlight(h.id)`.
3. `repo.delete(h.id)` async — on error, restore + `readerState.addHighlight(h)` + `console.warn`.

**Re-key on book change:** same pattern as `useBookmarks`.

### 6.4 `ReaderWorkspace` — additions

**State:**
```ts
const [activeRailTab, setActiveRailTab] = useState<'contents' | 'bookmarks' | 'highlights'>('contents');
const [activeToolbar, setActiveToolbar] = useState<
  | { kind: 'create'; selection: SelectionInfo }
  | { kind: 'edit'; highlight: Highlight; pos: { x: number; y: number; width: number; height: number } }
  | null
>(null);

const highlights = useHighlights({
  bookId: BookId(props.bookId),
  repo: props.highlightsRepo,
  readerState,
});
```

**Effects:**

1. Initial render — when `readerState` and `highlights.list` are both loaded, call `readerState.loadHighlights(highlights.list)`. Use `useEffect` keyed on both refs; debounce so rapid book-switch doesn't double-load.

2. Subscribe to `readerState.onSelectionChange`:
   ```ts
   useEffect(() => {
     if (!readerState) return;
     return readerState.onSelectionChange((sel) => {
       if (sel === null) {
         setActiveToolbar((t) => (t?.kind === 'create' ? null : t));
       } else {
         setActiveToolbar({ kind: 'create', selection: sel });
       }
     });
   }, [readerState]);
   ```

3. Subscribe to `readerState.onHighlightTap`:
   ```ts
   useEffect(() => {
     if (!readerState) return;
     return readerState.onHighlightTap((id, pos) => {
       const h = highlights.list.find((x) => x.id === id);
       if (!h) return;
       setActiveToolbar({ kind: 'edit', highlight: h, pos: { x: pos.x, y: pos.y, width: 1, height: 1 } });
     });
   }, [readerState, highlights.list]);
   ```

**Toolbar render:**
```tsx
{activeToolbar?.kind === 'create' ? (
  <HighlightToolbar
    mode="create"
    screenRect={activeToolbar.selection.screenRect}
    onPickColor={(color) => {
      void highlights.add(activeToolbar.selection.anchor, activeToolbar.selection.selectedText, color);
      setActiveToolbar(null);
    }}
    onDismiss={() => setActiveToolbar(null)}
  />
) : null}
{activeToolbar?.kind === 'edit' ? (
  <HighlightToolbar
    mode="edit"
    screenRect={activeToolbar.pos}
    currentColor={activeToolbar.highlight.color}
    onPickColor={(color) => {
      void highlights.changeColor(activeToolbar.highlight, color);
      setActiveToolbar(null);
    }}
    onDelete={() => {
      void highlights.remove(activeToolbar.highlight);
      setActiveToolbar(null);
    }}
    onDismiss={() => setActiveToolbar(null)}
  />
) : null}
```

**Rail tabs:** add Highlights as the third tab. `railTabs` becomes:
```ts
[
  { key: 'contents',   label: 'Contents',   content: <TocPanel ... /> },
  { key: 'bookmarks',  label: 'Bookmarks',  badge: bookmarks.list.length, content: <BookmarksPanel ... /> },
  { key: 'highlights', label: 'Highlights', badge: highlights.list.length, content: <HighlightsPanel ... /> },
]
```

Same three tabs in the mobile sheet via the existing `SheetTabHeader` pattern.

`HighlightsPanel` callbacks:
- `onSelect={(h) => readerState?.goToAnchor(h.anchor.kind === 'epub-cfi' ? h.anchor : { kind: 'pdf', page: h.anchor.page })}` — projects `HighlightAnchor` back to `LocationAnchor` for navigation.
- `onDelete={(h) => void highlights.remove(h)}`
- `onChangeColor={(h, color) => void highlights.changeColor(h, color)}`

### 6.5 Workspace prop addition

```ts
type Props = {
  // ...existing
  readonly highlightsRepo: HighlightsRepository;
};
```

Plumbed through `useReaderHost` (which gets `wiring.highlightsRepo`) and App.tsx (already passes `bookmarksRepo` the same way).

## 7. Data flow & error handling

### 7.1 Create

```
User selects text
  └─ engine fires onSelectionChange(SelectionInfo)
      └─ workspace setActiveToolbar({kind:'create', selection})
          └─ <HighlightToolbar mode="create" ... />
              └─ user taps color
                  └─ highlights.add(anchor, selectedText, color)
                      ├─ readerState.getSectionTitleAt(anchor projected)        [sync]
                      ├─ build optimistic Highlight
                      ├─ list.insertSorted(optimistic)                          [optimistic]
                      ├─ readerState.addHighlight(optimistic)                   [render overlay]
                      ├─ workspace clears toolbar + clears browser selection
                      └─ repo.add(optimistic)                                   [async]
                          └─ on error: list.remove + readerState.removeHighlight + console.warn
```

### 7.2 Edit (color change or delete)

```
User taps a rendered highlight
  └─ engine fires onHighlightTap(id, screenPos)
      └─ workspace looks up highlight, setActiveToolbar({kind:'edit', highlight, pos})
          └─ <HighlightToolbar mode="edit" currentColor=… />
              ├─ user taps color
              │   └─ highlights.changeColor(h, color)
              │       ├─ list.patch(id, {color})                                [optimistic]
              │       ├─ readerState.addHighlight({...h, color})                [re-render]
              │       └─ repo.patch(id, {color})
              │           └─ on error: revert list + re-render with old color
              └─ user taps ×
                  └─ highlights.remove(h)
                      ├─ list.remove(h)                                         [optimistic]
                      ├─ readerState.removeHighlight(id)                        [clear overlay]
                      └─ repo.delete(id)
                          └─ on error: restore list + readerState.addHighlight(h)
```

### 7.3 Initial render

```
ReaderView mounts → adapter.open → ready → onStateChange(readerState)
useHighlights effect → repo.listByBook → setList(sorted)
useEffect [readerState, list] when both ready → readerState.loadHighlights(list)
```

### 7.4 Re-render on section/page navigation

- **EPUB:** adapter listens for foliate `'create-overlay'`; re-adds highlights for that section by calling `addAnnotation` for each entry in `highlightsBySection.get(sectionIndex)`. Workspace doesn't participate.
- **PDF:** `PdfPageView.render` calls back `adapter.onPageRendered(page, highlightLayerEl, viewport)` after the text layer is mounted; adapter draws rects for `highlightsByPage.get(page)`.

### 7.5 Sort + navigation from list

- Comparator in `compareHighlightsInBookOrder` (§4.6).
- `panel.onSelect(h)` projects `HighlightAnchor` to `LocationAnchor` (for PDF, use `{kind:'pdf', page}`; CFI passes through). Then `readerState.goToAnchor(...)`.

### 7.6 Error surfaces

| Failure | Handling |
|---|---|
| `repo.add` throws | Roll back list + remove overlay. `console.warn`. |
| `repo.patch` throws (color change) | Revert list + re-render old color. |
| `repo.delete` throws | Restore list + re-render overlay. |
| Engine's `addHighlight` throws (e.g. unresolvable CFI) | Catch in adapter, log, leave the persisted record (so jumping to it triggers the existing reader-machine error overlay). |
| Selection has empty `selectedText` | Adapter filters; no `onSelectionChange` fires. |
| `selectionchange` fires repeatedly during drag | Adapter debounces 100ms — only fires after the user stops moving. |
| Tap on overlapping highlights (PDF) | Click handler picks the topmost DOM node (last appended). Acceptable for v1. |
| Book deleted with highlights present | `useReaderHost.onRemoveBook` cascades via `highlightsRepo.deleteByBook`. |
| Corrupt highlight record in IDB | `normalizeHighlight` validator drops the record. |

### 7.7 State invariants

- `useHighlights` is keyed by `bookId`. Switching books re-fetches.
- The in-memory list is the source of truth for the panel; the adapter's overlay map is the source of truth for what's rendered.
- Color changes are atomic visually: list AND overlay flip together; failure rolls both back together.
- `activeToolbar` is single-instance: opening edit dismisses any open create and vice versa.
- Selections that produce empty `selectedText` are filtered at the adapter boundary; the workspace never sees them.
- Tab state (`activeRailTab`) is local to the workspace, not persisted across reload (matches bookmarks behavior).

## 8. Testing

### 8.1 Unit tests (Vitest + happy-dom)

| File | Scope |
|---|---|
| `src/storage/repositories/highlights.test.ts` | `add` → `listByBook` round-trip; `patch` color; `delete`; `deleteByBook` cascade; `listByBook` returns book-order sorted (mock both anchor kinds); validator drops records with bad anchor/color. |
| `src/storage/db/migrations.test.ts` (extend) | v3 → v4 creates `highlights` store + `by-book` index; existing v3 stores survive; idempotent re-run. |
| `src/domain/annotations/types.test.ts` (extend) | `HighlightAnchor` discriminated-union round-trip (epub-cfi + pdf with rects); `Highlight` shape; `HighlightId` brand. |
| `src/features/reader/workspace/highlightSort.test.ts` | Pure comparator: PDF same-page sorts by y then x; different pages by page; EPUB sorts CFI-lex; mixed kinds fall back to createdAt. |
| `src/features/reader/HighlightToolbar.test.tsx` | Renders 4 color dots in `mode='create'`; renders 4 colors + delete in `mode='edit'`; pre-selects `currentColor`; `onPickColor` called with the right color; `onDelete` called only in edit mode; `onDismiss` on Escape. |
| `src/features/reader/HighlightsPanel.test.tsx` | Renders rows with section + selectedText + relative time + colored bar; empty state; calls `onSelect`; calls `onDelete`; calls `onChangeColor` from row color pip. |
| `src/features/reader/workspace/useHighlights.test.ts` | `add` writes optimistic + persists + calls `readerState.addHighlight`; rolls back on repo failure (also clears overlay); `changeColor` patches optimistic + re-renders + persists; `remove` is optimistic + clears overlay; book change re-fetches; sort preserved across mutations. |
| `src/features/reader/pdf/PdfReaderAdapter.test.ts` (extend) | `addHighlight` / `removeHighlight` on a never-opened adapter are no-ops, no throw. |

### 8.2 E2E tests (Playwright)

| File | Coverage |
|---|---|
| `e2e/highlights-epub-create.spec.ts` | Open EPUB → navigate past cover to a chapter with known text → select a known phrase → toolbar appears → click yellow → SVG overlay present, Highlights tab shows entry with section + text + yellow swatch. Reload → still rendered + listed. |
| `e2e/highlights-epub-color-change.spec.ts` | Create yellow → tap highlight → edit toolbar → click green → overlay re-renders green; list swatch is green. Reload → still green. |
| `e2e/highlights-epub-delete.spec.ts` | Create 2 → tap first, click × → overlay gone, list count drops to 1. Reload → still 1. |
| `e2e/highlights-pdf-create.spec.ts` | Open multipage PDF → select a phrase on page 1 → toolbar → click pink → `.pdf-highlight` DOM visible, list entry with page-based section title. Reload → still rendered. |
| `e2e/highlights-mobile.spec.ts` | 390×844 EPUB → select text → toolbar appears → click color → ☰ → switch to Highlights tab → see entry → tap row → sheet dismisses + reader navigates to it. |
| `e2e/highlights-cascade-on-remove.spec.ts` | Create a highlight → return to library → remove book → re-import → Highlights tab is empty. |

### 8.3 Skipped intentionally

- Engine selection event in unit tests — requires a real iframe (foliate) or text-layer (pdfjs); covered via E2E.
- Cross-section EPUB highlight rendering on navigation — implicitly covered by the create+reload test (the engine re-mounts).
- Right-rail / desktop-only tests — same surface as bookmarks; resize behavior already covered by `reader-workspace-resize.spec`.
- Bulk-add performance — premature.
- Tag UI — out of scope (Q1).
- Overlapping highlights tap behavior — out of scope; topmost wins by DOM order.

### 8.4 Test fixtures

Existing fixtures sufficient: `test-fixtures/small-pride-and-prejudice.epub`, `test-fixtures/multipage.pdf`. Tests will navigate to known TOC entries and select known phrases.

## 9. File map

**New files:**
- `src/storage/repositories/highlights.ts`
- `src/storage/repositories/highlights.test.ts`
- `src/features/reader/HighlightToolbar.tsx`
- `src/features/reader/highlight-toolbar.css`
- `src/features/reader/HighlightToolbar.test.tsx`
- `src/features/reader/HighlightsPanel.tsx`
- `src/features/reader/highlights-panel.css`
- `src/features/reader/HighlightsPanel.test.tsx`
- `src/features/reader/highlightColors.ts` — shared `COLOR_HEX` map
- `src/features/reader/workspace/useHighlights.ts`
- `src/features/reader/workspace/useHighlights.test.ts`
- `src/features/reader/workspace/highlightSort.ts`
- `src/features/reader/workspace/highlightSort.test.ts`
- `src/features/reader/pdf/pdf-highlight-layer.css` — PDF overlay styles
- 6 E2E specs under `e2e/`

**Modified files:**
- `src/domain/annotations/types.ts` — `HighlightAnchor`/`HighlightRect` types, refactored `Highlight`
- `src/domain/annotations/types.test.ts` — extend
- `src/storage/db/schema.ts` — bump to v4, add `highlights` store
- `src/storage/db/migrations.ts` — add 3→4 migration
- `src/storage/db/migrations.test.ts` — extend
- `src/storage/index.ts` — export `createHighlightsRepository` + type
- `src/features/library/wiring.ts` — add `highlightsRepo`
- `src/domain/reader/types.ts` — add `SelectionInfo`/listeners + 5 `BookReader` methods
- `src/features/reader/ReaderView.tsx` — pass new methods through `onStateChange`
- `src/features/reader/epub/EpubReaderAdapter.ts` — selection capture, render via Overlayer, tap, re-render on create-overlay
- `src/features/reader/pdf/PdfReaderAdapter.ts` — selection capture, highlight-layer DOM, tap, re-render on page-rendered
- `src/features/reader/pdf/PdfPageView.ts` — append highlight-layer sibling, callback to adapter on render
- `src/features/reader/workspace/ReaderWorkspace.tsx` — `useHighlights`, third rail tab, toolbar wiring, sheet tab
- `src/app/useReaderHost.ts` — `onRemoveBook` cascades to `highlightsRepo.deleteByBook`; expose `highlightsRepo` on the handle
- `src/app/App.tsx` — pass `reader.highlightsRepo` to `ReaderWorkspace`

## 10. Migration & compatibility

- IDB schema bump 3 → 4. Additive migration — no data transformation. Existing books, settings, reading_progress, reader_preferences, bookmarks untouched.
- The `Highlight` domain refactor (drop `range`/`normalizedText`, add `anchor`/`sectionTitle`) is a breaking change at the type level — there are no current consumers (the type existed but wasn't persisted or referenced in components), so this is safe.
- Forward compatibility: `normalizeHighlight` validator drops unknown-shape records and fills missing optional fields with defaults.

## 11. Risks & open questions

| Risk | Mitigation |
|---|---|
| foliate's `view.getCFI` may need a different sectionIndex API than the one we cached in 3.1 | The `'create-overlay'` event provides the section index directly; we'll use that as the source of truth. |
| Selection `screenRect` calculation across the foliate iframe boundary requires offset translation | Unit-test the math via a fake `getBoundingClientRect`; iframe offset is `iframe.getBoundingClientRect()`. |
| pdfjs `convertToPdfPoint` for storing PDF rects across zoom levels | Standard pdfjs pattern. We store inverse-mapped (PDF-coord) rects and re-multiply on render. |
| Selection events fire continuously during drag | Adapter debounces 100ms before firing `onSelectionChange`. |
| EPUB highlight overlay color blending in dark theme | Foliate's `Overlayer.highlight` uses `mix-blend-mode: var(--overlayer-highlight-blend-mode, normal)` and opacity `.3` by default; we'll set blend-mode appropriately per theme via a CSS custom property on the workspace. |
| Mobile selection toolbar may overlap the chrome at the top of the viewport | Toolbar flips below selection if `screenRect.top < toolbarHeight + 16`. |
| Touch text selection on iOS Safari triggers the native callout bar | We can't fully suppress the native bar without breaking accessibility; documented as v1 quirk. Our toolbar still appears on top. |

## 12. Acceptance criteria

A working build of this PR satisfies:

1. ✅ Open a book, select a phrase → toolbar appears with 4 colors → tap a color → highlight visible in the reader, listed in the Highlights tab with section + selected text + color swatch.
2. ✅ Tap a highlight in the reader → toolbar reappears with the current color pre-selected → tap a different color → overlay + list both update.
3. ✅ Tap a highlight → tap × → highlight gone from reader and list.
4. ✅ Mobile (390×844): same UX, three-tab sheet (Contents / Bookmarks / Highlights), toolbar respects viewport edges.
5. ✅ Reload preserves highlights, including their colors and positions, on both EPUB and PDF.
6. ✅ Highlights tab shows entries in book order, not creation order.
7. ✅ Removing a book deletes its highlights (verified by re-importing the same file).
8. ✅ All existing tests pass; new unit + E2E tests pass.
9. ✅ Type-check, lint, build all clean.
