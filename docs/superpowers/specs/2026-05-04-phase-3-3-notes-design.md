# Phase 3.3 — Notes design

**Status:** approved 2026-05-04
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 3 → Task 3.3
**Predecessors:** Phase 3.1 bookmarks, Phase 3.2 highlights (rail-tabs pattern, sheet-tabs pattern, optimistic-then-persist hook pattern, cascade-on-remove pattern, anchored toolbar pattern, `BookReader` interface, `ReaderViewExposedState`)

## 1. Goal & scope

Add the second thinking layer: **plain-text notes attached to highlights**. Users can annotate any highlighted passage with a short marginal note, edit/delete it later, and jump from note to passage. Notes are visually integrated into the existing Highlights tab (no new tab) and live alongside the highlight they annotate.

**In scope (v1, this phase):**
- `HighlightToolbar` gains a "Note" button (📝) in both create-mode and edit-mode.
- Tapping 📝 in create-mode auto-creates a yellow highlight and opens an inline `NoteEditor` anchored to the selection.
- Tapping 📝 in edit-mode opens the editor pre-filled with the existing note (if any) for that highlight.
- `NoteEditor` is a compact textarea component (plain text, soft 2000-char cap, autosave-on-blur, Esc-cancels, Esc-discard hint shown once per session).
- `HighlightsPanel` rows show the note inline below the highlight snippet (truncated to one line). Tapping the note line replaces it with the editor inline.
- Empty save deletes the Note record; the highlight stays.
- Deleting the highlight cascades the note.
- Notes persist across reload; book removal cascades.

**Out of scope (deferred to later phases):**
- Location-anchored notes (`NoteAnchorRef.kind === 'location'`) — type variant stays, no UI.
- Markdown rendering — plain text only.
- Tags on notes — not introduced.
- Cross-book or unified annotation notebook — deferred to Phase 3.4.
- Edit timestamps shown in UI — `updatedAt` persists on the record but the row only shows the highlight's `createdAt` (consistent with 3.2). 3.4 may surface it.
- "Save AI output as notes" (PRD line 119) — Phase 4+; the Note type is already generic enough to accept it later without schema change.
- Multiple notes per highlight — v1 enforces one-note-per-highlight via a unique index.

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Note anchoring | **Highlight-only** (`NoteAnchorRef.kind === 'highlight'`) | Reuses 3.2's anchor system; no new selection-only path. Matches industry pattern (Apple Books, Kindle). |
| Location-pinned notes in v1 | **Deferred** | Type variant kept for forward-compat. Tighter v1 polish budget; PRD's "selection or location" reading is split between 3.3 and 3.4/later. |
| Note from selection | **Auto-create yellow highlight + open editor** | One-tap "highlight + note" UX. Default color: yellow (matches industry default; no special "note color"). |
| Surface in rail/sheet | **Inline within Highlights tab** (no 4th tab) | Honors the data coupling (note IS on a highlight). Avoids tab inflation. 3.4 builds the cross-cutting notebook. |
| Editor surface | **Anchored-to-target inline editor**, one component used in two parents (toolbar + panel row) | Mirrors HighlightToolbar's positioning pattern. Minimal context shift; no rail auto-open; no modal/drawer chrome. |
| Reader overlay indicator | **None** — a noted highlight looks identical to a plain highlight | "Reading experience comes first." Discovery happens in the panel, not in-prose. |
| Panel row indicator | **Note text inline below snippet** (one truncated line) | The text *is* the indicator. No icon needed; row stays uncluttered. |
| Format | **Plain text** (`white-space: pre-wrap`) | No parser, no XSS surface, no rendered-vs-edit toggle. Markdown is a future polish. |
| Length | **Soft cap 2000 chars** (counter visible above 1600) | Generous for marginalia, no punishing hard block. |
| Save behavior | **Autosave on blur; Esc cancels** | Matches Apple Notes / Bear / Notion. Esc-discard hint shown once per session. |
| Empty save | **Empty content → delete Note record; highlight stays** | Clearing text is the deletion path; the highlight has standalone value. |
| Highlight delete cascade | **Cascade-deletes attached note** | Consistent with 3.2's `deleteByBook` cascade pattern; orphan notes have no anchor in v1. |

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ ReaderWorkspace                                                      │
│  ├─ useFocusMode (existing)                                          │
│  ├─ useViewport (existing)                                           │
│  ├─ useBookmarks (existing)                                          │
│  ├─ useHighlights (existing)                                         │
│  ├─ useNotes(bookId) — NEW                                           │
│  │   { byHighlightId, save, clear }                                  │
│  ├─ readerState: ReaderViewExposedState (no new methods)             │
│  ├─ activeToolbar: { kind: 'create' | 'edit' } | null  (existing)    │
│  └─ activeNoteEditor: { highlightId, anchorRect } | null  — NEW      │
│                                                                       │
│  Rail (desktop) / MobileSheet (mobile)                                │
│   └─ HighlightsPanel — UPDATED                                       │
│       takes notesByHighlightId; renders inline note line per row;    │
│       owns local "row N in edit mode" state for inline editor        │
│                                                                       │
│  HighlightToolbar — UPDATED                                           │
│   gains "Note" button (📝) and onNote callback                       │
│                                                                       │
│  NoteEditor — NEW                                                     │
│   pure textarea component: plain text, soft cap, Esc cancels,        │
│   blur autosaves. Used by ReaderWorkspace (anchored to selection/    │
│   highlight) and HighlightsPanel (inline within row).                │
└─────────────────────────────────────────────────────────────────────┘

Storage:
  notes (IDB v5) ←─ NotesRepository ←─ useNotes

Engine:
  No changes. Notes are pure metadata over highlights;
  EpubReaderAdapter / PdfReaderAdapter / BookReader interface untouched.
```

**Single-purpose units:**
- `NotesRepository` — pure storage + record validation; no engine knowledge.
- `useNotes` — composes the repo; owns an in-memory `Map<HighlightId, Note>`; format-agnostic; cascades when its parent highlight is removed (via the existing `useHighlights.remove` flow).
- `HighlightsPanel` — pure presentation; takes both `highlights` and `notesByHighlightId`; owns ephemeral "which row is in inline-edit mode" state.
- `NoteEditor` — pure presentation; takes `initialContent` + `onSave(content)` + `onCancel`; owns local textarea state + Esc handler. Reusable in two parents.
- `HighlightToolbar` — gains one prop (`onNote?: () => void`) and one button.
- `ReaderWorkspace` — gains `activeNoteEditor` state to render the anchored editor when triggered from the toolbar.

**Why no engine API additions:** Notes don't render in the reader (no overlay indicator). The engine's `addHighlight`/`removeHighlight`/`onHighlightTap` already covers everything notes need from the reader surface. Adapters stay clean.

**Cascade chain on book removal:**
```
useReaderHost.onRemoveBook(bookId)
  ├─ booksRepo.delete(bookId)         (existing)
  ├─ bookmarksRepo.deleteByBook(...)  (existing)
  ├─ highlightsRepo.deleteByBook(...) (existing)
  └─ notesRepo.deleteByBook(...)      NEW
```

**Cascade chain on highlight removal:**
```
useHighlights.remove(highlight)
  ├─ list.remove + readerState.removeHighlight (existing)
  ├─ repo.delete (existing)
  └─ notesRepo.deleteByHighlight(highlightId)  NEW
       + useNotes hook reacts: byHighlightId.delete(highlightId)
```

## 4. Domain & storage

### 4.1 Domain types — no changes

`Note` and `NoteAnchorRef` already exist in `src/domain/annotations/types.ts` (carried forward unchanged from the original Phase 0 model). v1 only constructs `NoteAnchorRef` with `kind: 'highlight'`; the `'location'` variant is type-level forward-compat.

```ts
export type NoteAnchorRef =
  | { readonly kind: 'highlight'; readonly highlightId: HighlightId }
  | { readonly kind: 'location'; readonly anchor: LocationAnchor };

export type Note = {
  readonly id: NoteId;
  readonly bookId: BookId;
  readonly anchorRef: NoteAnchorRef;
  readonly content: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
};
```

### 4.2 IndexedDB schema

Bump `CURRENT_DB_VERSION` from 4 → 5. Add a new store:

```ts
// src/storage/db/schema.ts
export interface BookwormDBSchema extends DBSchema {
  // ...existing stores...
  notes: {
    key: string;                            // NoteId
    value: Note;
    indexes: {
      'by-book': string;                    // BookId
      'by-highlight': string;               // HighlightId — for cascade on highlight delete
    };
  };
}

export const NOTES_STORE = 'notes' as const;
```

Two indexes because we need both `listByBook(bookId)` (panel load) and `deleteByHighlight(highlightId)` (cascade on highlight remove). The `by-highlight` index reads the nested `anchorRef.highlightId` via dotted keyPath, which fires only when `anchorRef.kind === 'highlight'`. For records with `kind: 'location'`, the index entry is omitted, which is the behavior we want.

### 4.3 Migration

```ts
// src/storage/db/migrations.ts
4: ({ db }) => {
  if (!db.objectStoreNames.contains('notes')) {
    const store = db.createObjectStore('notes', { keyPath: 'id' });
    store.createIndex('by-book', 'bookId', { unique: false });
    store.createIndex('by-highlight', 'anchorRef.highlightId', { unique: true });
  }
},
```

`unique: true` on `by-highlight` enforces the v1 invariant that a highlight has at most one note. Idempotent; existing v4 stores untouched.

### 4.4 Repository

`src/storage/repositories/notes.ts`:

```ts
export interface NotesRepository {
  upsert(note: Note): Promise<void>;          // create or replace by id
  delete(id: NoteId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Note[]>;
  getByHighlight(highlightId: HighlightId): Promise<Note | null>;
  deleteByHighlight(highlightId: HighlightId): Promise<void>;
  deleteByBook(bookId: BookId): Promise<void>;
}

export function createNotesRepository(db: BookwormDB): NotesRepository;
```

`upsert` handles both first save (note didn't exist) and edit (replaces by `id`) — same record, `updatedAt` advances. `getByHighlight` is a convenience for cases where we only know the highlight id. Repo `upsert` uses `put` (replace by primary key), not `add`.

### 4.5 Validator

```ts
function isValidNoteAnchorRef(v: unknown): v is NoteAnchorRef {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as { kind?: unknown };
  if (a.kind === 'highlight') {
    return typeof (v as { highlightId?: unknown }).highlightId === 'string';
  }
  if (a.kind === 'location') {
    return isValidLocationAnchor((v as { anchor?: unknown }).anchor);
  }
  return false;
}

function normalizeNote(record: unknown): Note | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Note>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!isValidNoteAnchorRef(r.anchorRef)) return null;
  if (typeof r.content !== 'string') return null;
  if (typeof r.createdAt !== 'string') return null;
  if (typeof r.updatedAt !== 'string') return null;
  return {
    id: NoteId(r.id),
    bookId: BookId(r.bookId),
    anchorRef: r.anchorRef,
    content: r.content,
    createdAt: IsoTimestamp(r.createdAt),
    updatedAt: IsoTimestamp(r.updatedAt),
  };
}
```

`listByBook` filters `null`. Records with empty `content` after normalization are still returned — but the v1 lifecycle deletes empty notes on save, so corrupt empties shouldn't appear. If one does, it surfaces as an empty note line in the panel — harmless and editable.

### 4.6 Wiring

Extend `Wiring` (`src/features/library/wiring.ts`) with `notesRepo: NotesRepository`. Add to `useReaderHost.onRemoveBook` after `highlightsRepo.deleteByBook`. Pass through to `ReaderWorkspace` like the other repos.

## 5. UI surface

### 5.1 `NoteEditor` — new component

`src/features/reader/NoteEditor.tsx` — pure presentation, used in two parents:

```ts
type Props = {
  readonly initialContent: string;          // '' for first-time editing
  readonly onSave: (content: string) => void; // called on blur OR Cmd+Enter
  readonly onCancel: () => void;             // called on Esc
  readonly autoFocus?: boolean;              // true when opened from toolbar
  readonly placeholder?: string;             // default: "Add a note…"
};
```

**Layout:**
```
┌──────────────────────────────────────────────┐
│  ┌────────────────────────────────────────┐  │
│  │ [textarea — auto-grows 2–10 lines]      │  │
│  │                                         │  │
│  └────────────────────────────────────────┘  │
│                                  1820 / 2000 │  ← appears only above 1600
└──────────────────────────────────────────────┘
                                    Esc to discard  ← shown once per session
```

**Behavior:**
- Local state: `value: string`. Initialized from `initialContent`. `onChange` updates local state only.
- `onBlur` → if `value !== initialContent`, calls `onSave(value.trim())`. If `value.trim() === ''`, parent's `onSave('')` triggers the empty-deletes path. If unchanged, no-op.
- `Esc` → calls `onCancel`. (Local state discarded; parent unmounts editor.)
- `Cmd/Ctrl+Enter` → triggers blur → save (power-user shortcut).
- Plain `Enter` inserts a newline (matches textarea expectations).
- Auto-grow: minimum 2 rows, maximum 10 rows. Beyond 10, scroll within textarea.
- Soft cap (2000 chars): a `<span>` counter renders `{value.length} / 2000` only when `value.length > 1600`. Goes red above 2000. No hard block.
- "Esc to discard" hint: tracked via a `noteEditorHintShown` settings entry (parallel to the existing `focusModeHintShown` pattern). Shown below the textarea on first-ever editor open per session; dismisses on any keystroke or when the user blurs without changes.

**Critical invariant:** `NoteEditor` is presentational — no IDB, no hook composition, no positioning logic. Parents (`ReaderWorkspace`, `HighlightsPanel`) handle anchoring and lifecycle. This keeps the same component reusable across both surfaces and trivially testable.

### 5.2 `HighlightToolbar` — additions

The toolbar gains two props and one button:

```ts
type Props = {
  readonly mode: 'create' | 'edit';
  readonly screenRect: { x: number; y: number; width: number; height: number };
  readonly currentColor?: HighlightColor;
  readonly onPickColor: (color: HighlightColor) => void;
  readonly onDelete?: () => void;
  readonly onNote?: () => void;     // NEW — present in both modes
  readonly hasNote?: boolean;       // NEW — edit mode only; toggles active visual on 📝
  readonly onDismiss: () => void;
};
```

**Layout (edit mode):**
```
┌─────────────────────────────────────────┐
│ [🟡] [🟢] [🔵] [🟣]  │ [📝] │ [×]        │
└─────────────────────────────────────────┘
```

**Layout (create mode):**
```
┌─────────────────────────────────┐
│ [🟡] [🟢] [🔵] [🟣]  │ [📝]      │
└─────────────────────────────────┘
```

**Behavior:**
- 📝 button has `aria-label="Add note"` (create mode) or `"Edit note"` / `"Add note"` (edit mode, depending on `hasNote`).
- In edit mode, when `hasNote === true`, the 📝 button shows a small filled dot or ring (consistent active state with current-color indicator).
- Tapping 📝 calls `onNote()`. The toolbar does *not* dismiss itself — the workspace dismisses the toolbar AND opens the editor in one transition.

### 5.3 `HighlightsPanel` — additions

```ts
type Props = {
  readonly highlights: readonly Highlight[];
  readonly notesByHighlightId: ReadonlyMap<HighlightId, Note>;   // NEW
  readonly onSelect: (h: Highlight) => void;
  readonly onDelete: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly onSaveNote: (h: Highlight, content: string) => void;  // NEW; '' deletes
};
```

**Row layout — highlight without a note:**
```
┌───────────────────────────────────────────────────────┐
│ ▌ Chapter 4 · 2h ago         [🟡][🟢][🔵][🟣] [📝] [×] │
│   "...the marriage of Mr. Bingley to..."               │
└───────────────────────────────────────────────────────┘
```

**Row layout — highlight with a note:**
```
┌───────────────────────────────────────────────────────┐
│ ▌ Chapter 4 · 2h ago         [🟡][🟢][🔵][🟣] [📝] [×] │
│   "...the marriage of Mr. Bingley to..."               │
│ ┌─ "Bingley represents the new gentry — wealth withou…"│  ← note line
│ └────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

- Note line: indented from the snippet, single line, `text-overflow: ellipsis`.
- Visual treatment: subtle left border or muted color to distinguish from snippet.
- Click target: clicking the note line OR clicking the 📝 button enters inline-edit mode for that row.

**Row layout — inline edit mode:**
```
┌───────────────────────────────────────────────────────┐
│ ▌ Chapter 4 · 2h ago                                   │
│   "...the marriage of Mr. Bingley to..."               │
│ ┌─────────────────────────────────────────────────────┐│
│ │ [textarea with NoteEditor]                          ││
│ └─────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────┘
```

**Local state inside `HighlightsPanel`:**
```ts
const [editingNoteFor, setEditingNoteFor] = useState<HighlightId | null>(null);
```

When `editingNoteFor === h.id`, that row renders `<NoteEditor>` instead of the read-only note line. On `onSave(content)`, the panel calls `props.onSaveNote(h, content)` and clears `editingNoteFor`. On `onCancel`, just clears `editingNoteFor`.

The 📝 button on the row toggles `editingNoteFor` (sets to that highlight's id, or clears if already editing it).

**Color pip and × buttons hide while a row is in edit mode** — keeps the editor uncluttered.

**Empty state** unchanged from 3.2.

### 5.4 `useNotes` hook

`src/features/reader/workspace/useNotes.ts`:

```ts
export type UseNotesHandle = {
  readonly byHighlightId: ReadonlyMap<HighlightId, Note>;
  readonly save: (highlightId: HighlightId, content: string) => Promise<void>;  // '' deletes
  readonly clear: (highlightId: HighlightId) => Promise<void>;                  // alias for save('') / cascade path
};

type Options = {
  readonly bookId: BookId;
  readonly repo: NotesRepository;
};

export function useNotes(opts: Options): UseNotesHandle;
```

**Initial load:** `repo.listByBook(bookId)` on mount → build `Map<HighlightId, Note>` from results (filtering to `kind === 'highlight'` entries — defensive, even though we don't write `'location'` in v1).

**Save flow:**
1. Trim input. If empty → call `clear(highlightId)` and return.
2. Look up existing: `existing = byHighlightId.get(highlightId)`.
3. Build record:
   - If existing: `{...existing, content: trimmed, updatedAt: now}`.
   - If new: `{id: NoteId(crypto.randomUUID()), bookId, anchorRef: {kind:'highlight', highlightId}, content: trimmed, createdAt: now, updatedAt: now}`.
4. Optimistic: insert into local map.
5. `repo.upsert(record)` async — on error, revert map (restore previous or delete) + `console.warn`.

**Clear flow:**
1. Look up existing: if not in map, no-op.
2. Optimistic: remove from map.
3. `repo.deleteByHighlight(highlightId)` async — on error, restore map entry + `console.warn`.

**Cascade hook:** `useHighlights.remove` calls into a hook-provided callback (`onAfterRemove`) so deleting a highlight removes its note. The workspace wires this: `onAfterRemove: (h) => void notes.clear(h.id)`. Both in-memory map and IDB stay in sync.

**Re-key on book change:** same pattern as `useBookmarks` / `useHighlights`.

### 5.5 `ReaderWorkspace` — additions

**State:**
```ts
const notes = useNotes({ bookId, repo: props.notesRepo });

const [activeNoteEditor, setActiveNoteEditor] = useState<
  | { highlightId: HighlightId; anchorRect: { x: number; y: number; width: number; height: number } }
  | null
>(null);
```

**Toolbar wiring — create mode:**
```tsx
<HighlightToolbar
  mode="create"
  screenRect={selection.screenRect}
  onPickColor={(color) => { void highlights.add(...); setActiveToolbar(null); }}
  onNote={() => {
    void highlights.add(selection.anchor, selection.selectedText, 'yellow').then((newH) => {
      setActiveNoteEditor({ highlightId: newH.id, anchorRect: selection.screenRect });
    });
    setActiveToolbar(null);
  }}
  onDismiss={() => setActiveToolbar(null)}
/>
```

(Note: `useHighlights.add` returns `Promise<Highlight>` — slight contract bump from current void-return; documented in plan.)

**Toolbar wiring — edit mode:**
```tsx
<HighlightToolbar
  mode="edit"
  screenRect={activeToolbar.pos}
  currentColor={h.color}
  hasNote={notes.byHighlightId.has(h.id)}
  onPickColor={(color) => { void highlights.changeColor(h, color); setActiveToolbar(null); }}
  onDelete={() => { void highlights.remove(h); setActiveToolbar(null); }}
  onNote={() => {
    setActiveNoteEditor({ highlightId: h.id, anchorRect: activeToolbar.pos });
    setActiveToolbar(null);
  }}
  onDismiss={() => setActiveToolbar(null)}
/>
```

**Anchored editor render:**
```tsx
{activeNoteEditor !== null ? (
  <AnchoredOverlay rect={activeNoteEditor.anchorRect} preferredSide="below">
    <NoteEditor
      initialContent={notes.byHighlightId.get(activeNoteEditor.highlightId)?.content ?? ''}
      onSave={(content) => {
        void notes.save(activeNoteEditor.highlightId, content);
        setActiveNoteEditor(null);
      }}
      onCancel={() => setActiveNoteEditor(null)}
      autoFocus
    />
  </AnchoredOverlay>
) : null}
```

`AnchoredOverlay` is a small new positioning wrapper (or we reuse the toolbar's positioning math — likely the latter, factored into a shared `useAnchoredPosition(rect, preferredSide)` hook). Decide in the plan; both share the toolbar's clamp-to-viewport logic.

**Highlights cascade integration:**
```ts
const highlights = useHighlights({
  bookId,
  repo: props.highlightsRepo,
  readerState,
  onAfterRemove: (h) => { void notes.clear(h.id); },   // NEW callback — used to wire the cascade
});
```

This adds an `onAfterRemove` option to `useHighlights` (small surface change: optional, no breaking call sites).

**Panel wiring:**
```tsx
<HighlightsPanel
  highlights={highlights.list}
  notesByHighlightId={notes.byHighlightId}
  onSelect={...}
  onDelete={(h) => void highlights.remove(h)}
  onChangeColor={...}
  onSaveNote={(h, content) => void notes.save(h.id, content)}
/>
```

### 5.6 Workspace prop addition

```ts
type Props = {
  // ...existing
  readonly notesRepo: NotesRepository;
};
```

Plumbed through `useReaderHost` (which gets `wiring.notesRepo`) and `App.tsx`. Same pattern as `bookmarksRepo` / `highlightsRepo`.

## 6. Data flow & error handling

### 6.1 Add note from selection (one-tap path)

```
User selects text → engine fires onSelectionChange
  └─ workspace setActiveToolbar({kind:'create', selection})
      └─ <HighlightToolbar mode="create" onNote={…} />
          └─ user taps 📝
              ├─ highlights.add(anchor, selectedText, 'yellow')      [returns the new Highlight]
              │   └─ list.insertSorted + readerState.addHighlight + repo.add
              ├─ workspace clears toolbar
              └─ on add resolve:
                  setActiveNoteEditor({highlightId: newH.id, anchorRect: selection.screenRect})
                      └─ <NoteEditor autoFocus initialContent="" />
                          ├─ user types → local state only
                          ├─ user blurs (or Cmd+Enter) → onSave(content)
                          │   ├─ notes.save(highlightId, content)
                          │   │   ├─ map.set(highlightId, record)                    [optimistic]
                          │   │   └─ repo.upsert(record)                             [async]
                          │   │       └─ on error: revert map + console.warn
                          │   └─ workspace clears activeNoteEditor
                          └─ user presses Esc → onCancel
                              └─ workspace clears activeNoteEditor (no save)
                                  Highlight persists; the note never existed.
```

### 6.2 Add/edit note from existing highlight

```
User taps rendered highlight → engine fires onHighlightTap(id, pos)
  └─ workspace setActiveToolbar({kind:'edit', highlight, pos})
      └─ <HighlightToolbar mode="edit" hasNote={…} onNote={…} />
          └─ user taps 📝
              ├─ workspace clears toolbar
              └─ setActiveNoteEditor({highlightId: h.id, anchorRect: pos})
                  └─ <NoteEditor initialContent={existing?.content ?? ''} autoFocus />
                      └─ blur with empty content → notes.save('') → clear path → repo.deleteByHighlight
```

### 6.3 Edit note from panel row

```
User taps note line OR 📝 on a row in HighlightsPanel
  └─ panel setEditingNoteFor(h.id)
      └─ row renders <NoteEditor initialContent={existing.content} autoFocus />
          ├─ blur → onSave → props.onSaveNote(h, content) → notes.save → repo.upsert
          └─ Esc → onCancel → setEditingNoteFor(null)
```

### 6.4 Delete highlight that has a note (cascade)

```
User taps × in edit toolbar OR × in panel row
  └─ highlights.remove(h)
      ├─ list.remove + readerState.removeHighlight + repo.delete                (existing)
      └─ onAfterRemove(h) callback fires
          └─ notes.clear(h.id)
              ├─ map.delete(h.id)                                               [optimistic]
              └─ repo.deleteByHighlight(h.id)                                   [async]
                  └─ on error: restore map entry + console.warn
                              (highlight is already gone — orphan note in IDB
                               will be filtered on next listByBook because the
                               anchor's highlightId resolves to a non-existent
                               highlight; orphans are benign and documented.)
```

### 6.5 Initial render

```
ReaderWorkspace mounts
  ├─ useHighlights → repo.listByBook → setList(sorted)
  └─ useNotes → repo.listByBook → setMap(byHighlightId)

Both load independently in parallel.
HighlightsPanel renders rows immediately with no notes; notes appear when useNotes resolves.
On mobile/desktop indistinguishable since both repos hit IDB sub-100ms typical.
```

### 6.6 Book removal cascade

```
User removes book in library
  └─ useReaderHost.onRemoveBook(bookId)
      ├─ booksRepo.delete                  (existing)
      ├─ bookmarksRepo.deleteByBook        (existing)
      ├─ highlightsRepo.deleteByBook       (existing)
      └─ notesRepo.deleteByBook            NEW
```

### 6.7 Error surfaces

| Failure | Handling |
|---|---|
| `repo.upsert` throws on save | Revert map (restore previous content or delete entry). `console.warn`. Editor has already closed; user sees note disappear or revert on next render. |
| `repo.deleteByHighlight` throws on clear | Restore map entry. `console.warn`. User sees note re-appear. |
| `repo.deleteByHighlight` throws during highlight cascade | Highlight is already gone (the cascade fires *after* successful highlight remove). Map entry deleted optimistically; orphan note in IDB filtered on next load. `console.warn`. |
| `repo.deleteByBook` throws during book removal | Existing book-removal flow already logs and continues; notes orphan handling matches. |
| User blurs editor with content unchanged | `onSave` is not called (component compares to `initialContent`). No write. |
| User Esc with content changed | `onCancel` called; local state discarded. No write. |
| Editor open and user taps a different highlight | Selection-change → toolbar opens → workspace dismisses `activeNoteEditor`. The textarea blurs first → `onSave` fires → save completes → editor unmounts. (Single-instance state ensures only one editor exists.) |
| Editor open and the underlying highlight is deleted (impossible in v1 UI but defensively) | Save will succeed in IDB but the orphan note will be filtered on next load. Acceptable. |
| Soft cap exceeded (>2000 chars) | Counter goes red; blur still saves. Truncation never happens. |
| Corrupt note record in IDB | `normalizeNote` validator drops it from `listByBook`. |
| Unique-index violation on upsert (defensive) | Should not happen — `useNotes.save` reuses existing `id` for same highlight. If it does throw, catch + log + refetch from IDB. |

### 6.8 State invariants

- `useNotes.byHighlightId` is a Map keyed by `HighlightId`. The unique index on `by-highlight` enforces one-note-per-highlight in IDB; the hook re-reads on book change.
- The map is the source of truth for the panel.
- Editor lifecycle is single-instance per surface: at most one `activeNoteEditor` (workspace-anchored) AND one `editingNoteFor` (panel-row inline) at any time. They're independent surfaces; if both somehow open, the first to lose focus saves on blur — acceptable.
- Empty save = delete: the only way to remove a note is to clear it. There's no separate "delete note" button. (The 📝 button toggles editor open/closed; it's not a delete.)
- Highlight always survives note deletion. Note never survives highlight deletion.
- "Esc-to-discard" hint shown once per session, persisted in `settings` store under `noteEditorHintShown` after first dismissal.

## 7. Testing

### 7.1 Unit tests (Vitest + happy-dom)

| File | Scope |
|---|---|
| `src/storage/repositories/notes.test.ts` | `upsert` create + replace; `delete`; `getByHighlight` returns null when absent; `listByBook` round-trip; `deleteByHighlight` removes the indexed record; `deleteByBook` cascade; unique-index enforcement (writing a second note for the same highlightId fails); validator drops records with bad anchorRef/content/timestamps. |
| `src/storage/db/migrations.test.ts` (extend) | v4 → v5 creates `notes` store with both indexes; existing v4 stores survive; idempotent re-run; `by-highlight` index reads `anchorRef.highlightId` correctly. |
| `src/domain/annotations/types.test.ts` (extend) | `NoteId` brand round-trip; `NoteAnchorRef` discriminated-union narrowing — both `'highlight'` and `'location'` variants compile and narrow correctly. |
| `src/features/reader/NoteEditor.test.tsx` | Renders textarea with `initialContent`; `onChange` updates local state only (no `onSave` mid-typing); `onBlur` calls `onSave(trimmed)` only when content changed; `onBlur` with unchanged content is a no-op; `Esc` calls `onCancel`; `Cmd+Enter` triggers blur+save; soft-cap counter appears above 1600 chars and goes red above 2000; `autoFocus` focuses on mount; placeholder shown when empty; "Esc to discard" hint shown when `noteEditorHintShown` setting is false, hidden when true. |
| `src/features/reader/HighlightToolbar.test.tsx` (extend) | 📝 button visible in both create and edit modes; calls `onNote`; `hasNote=true` in edit mode shows active-state visual; `aria-label` matches mode + note presence. |
| `src/features/reader/HighlightsPanel.test.tsx` (extend) | Row without note renders no note line; row with note renders inline note line truncated; clicking note line enters edit mode; clicking 📝 enters edit mode; `<NoteEditor>` save calls `onSaveNote(h, content)`; cancel restores read-only line; color pip + × hidden during edit; saving empty content calls `onSaveNote(h, '')`. |
| `src/features/reader/workspace/useNotes.test.ts` | Initial load builds map keyed by highlightId, ignoring `'location'` variants; `save` for new highlight inserts optimistic record + calls `repo.upsert`; `save` for existing replaces content + bumps `updatedAt`; `save('')` triggers clear; `save` rolls back on repo failure; `clear` rolls back on repo failure; book change re-fetches map. |
| `src/features/reader/workspace/useHighlights.test.ts` (extend) | `onAfterRemove` callback fires after successful remove; not called on failed remove. |
| `src/shared/positioning/useAnchoredPosition.test.ts` (if extracted from toolbar) | Clamps to viewport edges; flips above→below when above is clipped. |

### 7.2 E2E tests (Playwright)

| File | Coverage |
|---|---|
| `e2e/notes-epub-create-from-selection.spec.ts` | Open EPUB → select a phrase → toolbar appears → click 📝 → highlight created (yellow), editor opens anchored to selection → type a note → click outside → editor closes, panel row shows the note inline below the snippet. Reload → highlight + note both still there. |
| `e2e/notes-epub-edit-existing.spec.ts` | Create a highlight (yellow) → tap it → edit toolbar shows 📝 with no active state → click 📝 → editor opens empty → type → blur → reload → row shows note. Then tap highlight again → 📝 shows active state → click → editor pre-filled with current content → modify → blur → reload → updated content. |
| `e2e/notes-epub-clear-via-empty.spec.ts` | Create highlight + note → tap note line in panel → editor opens → clear all text → blur → note line disappears, highlight stays. Reload → highlight present, no note. |
| `e2e/notes-epub-cancel-with-esc.spec.ts` | Create highlight + note → edit via panel row → modify text → press Esc → row reverts to original note text. Reload → original note unchanged. |
| `e2e/notes-pdf-create-and-cascade.spec.ts` | Open PDF → select on page 2 → 📝 → type note → save → confirm in panel. Delete the highlight via × → row gone, note gone. Reload → both still gone. |
| `e2e/notes-mobile.spec.ts` | 390×844 EPUB → select → 📝 → editor appears anchored over selection (clamped to viewport, mobile keyboard accommodated) → type → blur → ☰ → Highlights tab → row shows note. |
| `e2e/notes-cascade-on-book-remove.spec.ts` | Create highlight + note → return to library → remove book → re-import → Highlights tab empty (verifies notes cascade alongside highlights). |

### 7.3 Skipped intentionally

- Markdown rendering — out of scope.
- Location-anchored note creation/render — out of scope; tests for the type variant exist at the domain level only.
- Note timestamps in UI — `updatedAt` is persisted but not rendered in 3.3.
- Concurrent multi-tab note edits — IDB does not provide cross-tab change events without manual subscription. v1 single-tab assumption matches the rest of the app.
- Highlight overlapping behavior with notes — same first-tap-wins model from 3.2 applies.
- Editor positioning math beyond clamp + flip — covered by the toolbar's existing positioning tests if extracted; otherwise its own small unit test.
- Soft cap behavior at exactly 2000 chars (off-by-one) — counter test covers boundary.
- `'location'` variant of `NoteAnchorRef` end-to-end — type-level test only; UI is forward-compat-only.

### 7.4 Test fixtures

Existing fixtures sufficient: `test-fixtures/small-pride-and-prejudice.epub`, `test-fixtures/multipage.pdf`. Tests will reuse the navigation patterns established in 3.2 E2Es.

## 8. File map

**New files:**
- `src/storage/repositories/notes.ts`
- `src/storage/repositories/notes.test.ts`
- `src/features/reader/NoteEditor.tsx`
- `src/features/reader/note-editor.css`
- `src/features/reader/NoteEditor.test.tsx`
- `src/features/reader/workspace/useNotes.ts`
- `src/features/reader/workspace/useNotes.test.ts`
- 7 E2E specs under `e2e/`
- *(possibly)* `src/shared/positioning/useAnchoredPosition.ts` + test — if we extract the toolbar's clamp+flip math into a shared hook (decision deferred to plan; the extraction is desirable but optional for v1)

**Modified files:**
- `src/storage/db/schema.ts` — bump to v5, add `notes` store with `by-book` + `by-highlight` indexes
- `src/storage/db/migrations.ts` — add 4→5 migration
- `src/storage/db/migrations.test.ts` — extend
- `src/storage/index.ts` — export `createNotesRepository` + type
- `src/features/library/wiring.ts` — add `notesRepo`
- `src/domain/annotations/types.test.ts` — extend with `NoteId` brand + `NoteAnchorRef` narrowing tests
- `src/features/reader/HighlightToolbar.tsx` — add `onNote` + `hasNote` props + 📝 button
- `src/features/reader/highlight-toolbar.css` — 📝 button styles + active state
- `src/features/reader/HighlightToolbar.test.tsx` — extend
- `src/features/reader/HighlightsPanel.tsx` — add `notesByHighlightId` + `onSaveNote` props; render inline note line; manage `editingNoteFor` local state
- `src/features/reader/highlights-panel.css` — note line styles
- `src/features/reader/HighlightsPanel.test.tsx` — extend
- `src/features/reader/workspace/useHighlights.ts` — add optional `onAfterRemove` callback; bump `add` return type to `Promise<Highlight>` (currently `Promise<void>`)
- `src/features/reader/workspace/useHighlights.test.ts` — extend
- `src/features/reader/workspace/ReaderWorkspace.tsx` — `useNotes` wiring, `activeNoteEditor` state, anchored editor render, panel/toolbar prop additions
- `src/app/useReaderHost.ts` — `onRemoveBook` cascades to `notesRepo.deleteByBook`; expose `notesRepo` on the handle
- `src/app/App.tsx` — pass `reader.notesRepo` to `ReaderWorkspace`

## 9. Migration & compatibility

- IDB schema bump 4 → 5. Additive migration — no data transformation. Existing books, settings, reading_progress, reader_preferences, bookmarks, highlights all untouched.
- `Note` and `NoteAnchorRef` domain types are pre-existing (no breaking changes); v1 only writes the `'highlight'` variant.
- `useHighlights.add` return type change (`Promise<void>` → `Promise<Highlight>`) is a non-breaking widening for existing call sites that ignored the return; documented in plan.
- The unique index `by-highlight` enforces "one note per highlight" at the storage layer. If a future feature wants multiple notes per highlight, that's a v6 migration (drop and recreate the index as non-unique).
- Forward compatibility: `normalizeNote` validator drops unknown-shape records and the `'location'` variant is read correctly today even though it's never written.

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| Mobile soft keyboard occludes the anchored editor when opened from a low-on-screen highlight | Editor positioning uses `visualViewport` (already used by the toolbar) to clamp above the keyboard. If the highlight is below the visible viewport, scroll the highlight into view before opening the editor. |
| Autosave-on-blur conflicts with rapid clicks (e.g. user clicks another highlight while editor open) | Blur fires synchronously before the new tap registers, so the save commits. Edge case: if blur and onSelectionChange race on touch, we accept that the save may complete after the new toolbar opens. The single-instance `activeNoteEditor` ensures no two editors coexist. |
| Idb dotted keyPath `'anchorRef.highlightId'` may behave differently across browsers | All target browsers (Chromium, Safari, Firefox) support dotted keyPath per spec. Migration test verifies index reads correctly. |
| Unique index on `by-highlight` could throw if a highlight already has a note and we accidentally `upsert` with a different `id` | `useNotes.save` always reuses the existing note's `id` when one exists for that highlight. Repo `upsert` uses `put` (replace by primary key), not `add`. Defensive: catch and log if the unique constraint trips, then refetch. |
| `useHighlights.add` returning `Promise<Highlight>` is a small contract bump | Plan to update existing call sites that use it as `Promise<void>`. Type widening; no behavior change. |
| Anchored editor reusing toolbar positioning logic vs. duplicating it | Plan-time decision: extract `useAnchoredPosition(rect, preferredSide)` if the math diverges between toolbar (small pill) and editor (taller textarea). Acceptable to start with two copies and refactor if duplication becomes painful. |
| Esc-to-discard hint persistence (`noteEditorHintShown` setting) on a fresh install | Same pattern as `focusModeHintShown`; default is `false` so the hint shows once. |
| User edits a note while the underlying highlight is being deleted in another flow | v1 has no parallel UI surfaces for this. The single-instance toolbar state prevents it. Documented as a non-concern. |

**Open questions to resolve in implementation plan (not blocking spec approval):**
- Whether to extract `useAnchoredPosition` now or duplicate (lean toward extract; ~30 LOC).
- Exact mobile keyboard handling — `visualViewport.resize` listener, or just rely on `position: fixed` + scroll into view. Prototype during T1.
- 📝 icon glyph — actual SVG vs emoji. Plan-level styling decision.

## 11. Acceptance criteria

A working build of this PR satisfies:

1. ✅ Open a book, select a phrase, tap 📝 in the toolbar → yellow highlight is created and a note editor appears anchored to the selection. Typing and clicking outside saves the note.
2. ✅ Tap a highlight that has no note → 📝 button is inactive. Tap 📝 → empty editor opens. Type + blur → note saved. Tap the same highlight again → 📝 is active.
3. ✅ Tap a highlight that has a note → 📝 button is active. Tap 📝 → editor opens with current note content. Modify + blur → updated content saved.
4. ✅ Highlights tab in rail/sheet shows each highlight's note inline below the snippet, truncated to one line. Click the note line OR the row's 📝 → editor expands inline within the row.
5. ✅ Clear all text in the editor and blur → note is deleted; the highlight remains visible in the reader and listed in the panel.
6. ✅ Press Esc while editing → changes discarded; previous content preserved.
7. ✅ Delete a highlight (× in toolbar or row) → its note is also removed from IDB and from the panel.
8. ✅ Mobile (390×844): the same flows work; editor accommodates the soft keyboard.
9. ✅ Reload preserves highlights, notes, and their content on both EPUB and PDF.
10. ✅ Soft cap counter appears above 1600 chars and goes red above 2000; no truncation occurs.
11. ✅ "Esc to discard" hint appears once per session on first editor open and is not shown again.
12. ✅ Removing a book deletes its notes (verified by re-importing the same file).
13. ✅ All existing tests pass; new unit + E2E tests pass.
14. ✅ Type-check, lint, build all clean.
