# Phase 3.4 — Annotation Notebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-book annotation notebook — a dedicated full-screen view (new `AppView` kind: `'notebook'`) listing every bookmark, highlight, and highlight-with-note for the open book in book order, with live substring search, single-select type filter chips, and full inline CRUD reusing the existing `NoteEditor` and `HighlightsPanel` row patterns. Click a row's content area → notebook closes, reader opens at the projected anchor. Bundle a small monochrome SVG icon module and replace the 📝 emoji in `HighlightToolbar` and `HighlightsPanel`.

**Architecture:** New `AppView` kind plumbed through `useAppView` (with a `pendingAnchor` ref consumed once on the next reader mount via a wrapped `loadBookForReader`). New `NotebookView` page composed of `NotebookChrome` + `NotebookSearchBar` + `NotebookList` + `NotebookEmptyState`. New `useNotebook(bookId)` hook composes the three existing repos directly (no engine, no re-use of `useBookmarks`/`useHighlights`/`useNotes` since those bind to the reader engine). Pure helpers `compareNotebookEntries` / `matchesFilter` / `matchesQuery` are tested independently. `src/shared/icons/` ships three SVG components used by chrome + toolbar + panel.

**Tech Stack:** TypeScript strict, React 19, Zustand, idb, Vitest + happy-dom (unit), Playwright (E2E).

**Reference:** Spec at `docs/superpowers/specs/2026-05-04-phase-3-4-notebook-design.md`.

---

## Task ordering

Plumbing first (types, storage union expansion, view helpers, hook composition). Then non-UI rename + cascade extension. Then pure helpers (sort/filter/search). Then `useNotebook`. Then icons + emoji replacement (so the icon module is available to all UI consumers). Then UI components leaf-up. Then routing wiring. Then E2E. Then docs + PR.

---

### Task 1: Domain types — `NotebookEntry`, `NotebookFilter`

**Files:**
- Create: `src/features/annotations/notebook/types.ts`
- Create: `src/features/annotations/notebook/types.test.ts`

> **Strategy:** UI-layer view-model. Not persisted. Pure types + a narrow runtime test that exercises both branches of the discriminated union.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/annotations/notebook/types.test.ts
import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type {
  NotebookEntry,
  NotebookFilter,
} from '@/features/annotations/notebook/types';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';

describe('NotebookEntry', () => {
  it('narrows on kind="bookmark"', () => {
    const bookmark: Bookmark = {
      id: BookmarkId('b-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'pdf', page: 3 },
      snippet: null,
      sectionTitle: null,
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const entry: NotebookEntry = { kind: 'bookmark', bookmark };
    if (entry.kind === 'bookmark') {
      expect(entry.bookmark.id).toBe('b-1');
    }
  });

  it('narrows on kind="highlight" with optional note', () => {
    const highlight: Highlight = {
      id: HighlightId('h-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const note: Note = {
      id: NoteId('n-1'),
      bookId: BookId('book-1'),
      anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
      content: 'thought',
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
      updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    };
    const withNote: NotebookEntry = { kind: 'highlight', highlight, note };
    const withoutNote: NotebookEntry = { kind: 'highlight', highlight, note: null };
    if (withNote.kind === 'highlight') expect(withNote.note?.content).toBe('thought');
    if (withoutNote.kind === 'highlight') expect(withoutNote.note).toBeNull();
  });

  it('NotebookFilter compiles for all four values', () => {
    const filters: NotebookFilter[] = ['all', 'bookmarks', 'highlights', 'notes'];
    expect(filters).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/types.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the types**

Create `src/features/annotations/notebook/types.ts`:

```ts
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/features/annotations/notebook/types.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/types.ts src/features/annotations/notebook/types.test.ts
git commit -m "feat(notebook): NotebookEntry + NotebookFilter view-model types"
```

---

### Task 2: Storage — `AppView` extension + `isValidView` update

**Files:**
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/repositories/settings.ts`
- Modify: `src/storage/repositories/settings.test.ts`

> **Strategy:** Additive union expansion. No DB migration. The validator collapses reader/notebook into one shape check (both have `kind` + `bookId`).

- [ ] **Step 1: Write the failing test**

Append to `src/storage/repositories/settings.test.ts`:

```ts
describe('isValidView (notebook)', () => {
  it('round-trips a notebook view', async () => {
    const db = await openBookwormDB(`bookworm-settings-${crypto.randomUUID()}`);
    const settings = createSettingsRepository(db);
    await settings.setView({ kind: 'notebook', bookId: 'b1' });
    expect(await settings.getView()).toEqual({ kind: 'notebook', bookId: 'b1' });
  });

  it('drops a notebook view with empty bookId', async () => {
    const db = await openBookwormDB(`bookworm-settings-${crypto.randomUUID()}`);
    const settings = createSettingsRepository(db);
    await db.put('settings', { key: 'view', value: { kind: 'notebook', bookId: '' } } as never);
    expect(await settings.getView()).toBeUndefined();
  });

  it('drops a notebook view with missing bookId', async () => {
    const db = await openBookwormDB(`bookworm-settings-${crypto.randomUUID()}`);
    const settings = createSettingsRepository(db);
    await db.put('settings', { key: 'view', value: { kind: 'notebook' } } as never);
    expect(await settings.getView()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/storage/repositories/settings.test.ts`
Expected: FAIL — `setView` rejects unknown kind, OR validator drops it.

- [ ] **Step 3: Edit `src/storage/db/schema.ts`**

Find:

```ts
export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string };
```

Replace with:

```ts
export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string }
  | { readonly kind: 'notebook'; readonly bookId: string };
```

- [ ] **Step 4: Edit `src/storage/repositories/settings.ts`**

Find:

```ts
function isValidView(v: unknown): v is AppView {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as { kind?: unknown; bookId?: unknown };
  if (x.kind === 'library') return true;
  if (x.kind === 'reader' && typeof x.bookId === 'string' && x.bookId.length > 0) return true;
  return false;
}
```

Replace with:

```ts
function isValidView(v: unknown): v is AppView {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as { kind?: unknown; bookId?: unknown };
  if (x.kind === 'library') return true;
  if (
    (x.kind === 'reader' || x.kind === 'notebook') &&
    typeof x.bookId === 'string' &&
    x.bookId.length > 0
  ) {
    return true;
  }
  return false;
}
```

- [ ] **Step 5: Run settings tests**

Run: `pnpm test --run src/storage/repositories/settings.test.ts`
Expected: PASS — all existing + 3 new.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: clean. Existing `AppView` consumers (App.tsx narrowing) still compile because we only branch on `'reader'` and `'library'` today.

- [ ] **Step 7: Commit**

```bash
git add src/storage/db/schema.ts src/storage/repositories/settings.ts src/storage/repositories/settings.test.ts
git commit -m "feat(storage): AppView gains 'notebook' kind; isValidView accepts notebook shape"
```

---

### Task 3: `app/view.ts` — `notebookView` helper + tests

**Files:**
- Modify: `src/app/view.ts`
- Create: `src/app/view.test.ts`

> **Strategy:** Mirror `readerView`. The new `view.test.ts` also locks the AppView narrowing (exhaustive switch over the three kinds).

- [ ] **Step 1: Write the failing test**

Create `src/app/view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LIBRARY_VIEW, readerView, notebookView, type AppView } from './view';

describe('view helpers', () => {
  it('LIBRARY_VIEW is a stable singleton-shape', () => {
    expect(LIBRARY_VIEW).toEqual({ kind: 'library' });
  });

  it('readerView builds a reader AppView', () => {
    expect(readerView('b1')).toEqual({ kind: 'reader', bookId: 'b1' });
  });

  it('notebookView builds a notebook AppView', () => {
    expect(notebookView('b1')).toEqual({ kind: 'notebook', bookId: 'b1' });
  });

  it('AppView narrowing is exhaustive', () => {
    function describe(view: AppView): string {
      switch (view.kind) {
        case 'library':
          return 'library';
        case 'reader':
          return `reader:${view.bookId}`;
        case 'notebook':
          return `notebook:${view.bookId}`;
      }
    }
    expect(describe(LIBRARY_VIEW)).toBe('library');
    expect(describe(readerView('b1'))).toBe('reader:b1');
    expect(describe(notebookView('b1'))).toBe('notebook:b1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/app/view.test.ts`
Expected: FAIL — `notebookView` not exported.

- [ ] **Step 3: Edit `src/app/view.ts`**

Append after the existing `readerView` export:

```ts
export function notebookView(bookId: string): AppView {
  return { kind: 'notebook', bookId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/app/view.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/view.ts src/app/view.test.ts
git commit -m "feat(app): notebookView helper + AppView exhaustive narrowing test"
```

---

### Task 4: `useAppView` — `goNotebook`, `goReaderAt`, `consumePendingAnchor`

**Files:**
- Modify: `src/app/useAppView.ts`
- Modify: `src/app/useAppView.test.ts`

> **Strategy:** Add three handle methods. `pendingAnchor` lives in a `useRef` (synchronous, not state — it's a one-shot consumed exactly once on the next reader mount). The setView guard auto-clears it whenever the new view is not `'reader'`.

- [ ] **Step 1: Write the failing test**

Append to `src/app/useAppView.test.ts`:

```ts
describe('useAppView — notebook + pendingAnchor', () => {
  it('goNotebook sets view to notebook(bookId)', async () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = makeLibraryStore([sampleBook('b1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
    );
    act(() => {
      result.current.goNotebook('b1');
    });
    expect(result.current.current).toEqual({ kind: 'notebook', bookId: 'b1' });
  });

  it('goReaderAt sets view to reader + queues pendingAnchor', () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = makeLibraryStore([sampleBook('b1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
    );
    const anchor = { kind: 'pdf' as const, page: 3 };
    act(() => {
      result.current.goReaderAt('b1', anchor);
    });
    expect(result.current.current).toEqual({ kind: 'reader', bookId: 'b1' });
    // Consume once
    expect(result.current.consumePendingAnchor()).toEqual(anchor);
    // Already consumed
    expect(result.current.consumePendingAnchor()).toBeUndefined();
  });

  it('non-reader setView clears pendingAnchor', () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = makeLibraryStore([sampleBook('b1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
    );
    const anchor = { kind: 'pdf' as const, page: 3 };
    act(() => {
      result.current.goReaderAt('b1', anchor);
    });
    act(() => {
      result.current.goLibrary();
    });
    expect(result.current.consumePendingAnchor()).toBeUndefined();
  });
});
```

The test file already imports `useAppView`, `LIBRARY_VIEW`, `act`, `renderHook`, `sampleBook`, `makeLibraryStore`, `fakeSettingsRepo` — verify these helpers exist near the top of the file. If `act` isn't imported, add it from `@testing-library/react`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/app/useAppView.test.ts`
Expected: FAIL — `goNotebook`, `goReaderAt`, `consumePendingAnchor` don't exist.

- [ ] **Step 3: Edit `src/app/useAppView.ts`**

Replace the entire file:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, LocationAnchor } from '@/domain';
import type { SettingsRepository } from '@/storage';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import { LIBRARY_VIEW, readerView, notebookView, type AppView } from '@/app/view';

export type AppViewHandle = {
  current: AppView;
  goLibrary: () => void;
  goReader: (book: Book) => void;
  goNotebook: (bookId: string) => void;
  goReaderAt: (bookId: string, anchor: LocationAnchor) => void;
  consumePendingAnchor: () => LocationAnchor | undefined;
};

function findBook(libraryStore: LibraryStore, bookId: string): Book | undefined {
  return libraryStore.getState().books.find((b) => b.id === bookId);
}

type UseAppViewOptions = {
  readonly settingsRepo: SettingsRepository;
  readonly libraryStore: LibraryStore;
  readonly initial: AppView;
};

export function useAppView({
  settingsRepo,
  libraryStore,
  initial,
}: UseAppViewOptions): AppViewHandle {
  const [view, setViewState] = useState<AppView>(() => {
    if (
      (initial.kind === 'reader' || initial.kind === 'notebook') &&
      !findBook(libraryStore, initial.bookId)
    ) {
      return LIBRARY_VIEW;
    }
    return initial;
  });

  const pendingAnchorRef = useRef<LocationAnchor | undefined>(undefined);

  const setView = useCallback(
    (next: AppView) => {
      // pendingAnchor is a one-shot intent for the *next* reader mount.
      // Any non-reader transition invalidates it.
      if (next.kind !== 'reader') {
        pendingAnchorRef.current = undefined;
      }
      setViewState(next);
      void settingsRepo.setView(next);
    },
    [settingsRepo],
  );

  // Guard: book deleted while in reader/notebook → fall back to library.
  useEffect(() => {
    if (
      (view.kind === 'reader' || view.kind === 'notebook') &&
      !findBook(libraryStore, view.bookId)
    ) {
      setView(LIBRARY_VIEW);
    }
  }, [view, libraryStore, setView]);

  const goLibrary = useCallback(() => {
    setView(LIBRARY_VIEW);
  }, [setView]);

  const goReader = useCallback(
    (book: Book) => {
      setView(readerView(book.id));
    },
    [setView],
  );

  const goNotebook = useCallback(
    (bookId: string) => {
      setView(notebookView(bookId));
    },
    [setView],
  );

  const goReaderAt = useCallback(
    (bookId: string, anchor: LocationAnchor) => {
      pendingAnchorRef.current = anchor;
      setView(readerView(bookId));
    },
    [setView],
  );

  const consumePendingAnchor = useCallback((): LocationAnchor | undefined => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = undefined;
    return anchor;
  }, []);

  return {
    current: view,
    goLibrary,
    goReader,
    goNotebook,
    goReaderAt,
    consumePendingAnchor,
  };
}
```

- [ ] **Step 4: Run useAppView tests**

Run: `pnpm test --run src/app/useAppView.test.ts`
Expected: PASS — all existing + 3 new.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: FAIL — `App.tsx` consumers don't yet pass through the new methods. We'll fix that in Task 19. Skip type-check here; the rename in Task 5 will land first to keep the diff bisectable.

If you want a clean type-check at this commit boundary, the alternative is to bundle Tasks 4 + 5 + 19 — decide based on review style. The plan keeps them separate for granularity.

- [ ] **Step 6: Commit**

```bash
git add src/app/useAppView.ts src/app/useAppView.test.ts
git commit -m "feat(app): useAppView — goNotebook + goReaderAt + consumePendingAnchor"
```

---

### Task 5: `useReaderHost` — rename `onBookRemovedWhileInReader`

**Files:**
- Modify: `src/app/useReaderHost.ts`
- Modify: `src/app/useReaderHost.test.ts`
- Modify: `src/app/App.tsx`

> **Strategy:** Pure rename + cascade extension. The callback now fires when the active view is `reader(bookId)` OR `notebook(bookId)`. App.tsx call site updates from the old name to the new one.

- [ ] **Step 1: Edit `src/app/useReaderHost.ts`**

Find the option name `onBookRemovedWhileInReader`:

```ts
type UseReaderHostOptions = {
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly view: AppView;
  readonly initialFocusMode: FocusMode;
  readonly initialFocusModeHintShown: boolean;
  readonly onBookRemovedWhileInReader?: () => void;
};
```

Replace with:

```ts
type UseReaderHostOptions = {
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly view: AppView;
  readonly initialFocusMode: FocusMode;
  readonly initialFocusModeHintShown: boolean;
  readonly onBookRemovedFromActiveView?: () => void;
};
```

Find the destructuring + usage:

```ts
export function useReaderHost({
  wiring,
  libraryStore,
  view,
  initialFocusMode,
  initialFocusModeHintShown,
  onBookRemovedWhileInReader,
}: UseReaderHostOptions): ReaderHostHandle {
```

Replace with:

```ts
export function useReaderHost({
  wiring,
  libraryStore,
  view,
  initialFocusMode,
  initialFocusModeHintShown,
  onBookRemovedFromActiveView,
}: UseReaderHostOptions): ReaderHostHandle {
```

Find inside `onRemoveBook`:

```ts
        if (view.kind === 'reader' && view.bookId === book.id) {
          onBookRemovedWhileInReader?.();
        }
```

Replace with:

```ts
        if (
          (view.kind === 'reader' || view.kind === 'notebook') &&
          view.bookId === book.id
        ) {
          onBookRemovedFromActiveView?.();
        }
```

- [ ] **Step 2: Edit `src/app/App.tsx`**

Find:

```ts
    onBookRemovedWhileInReader: view.goLibrary,
```

Replace with:

```ts
    onBookRemovedFromActiveView: view.goLibrary,
```

- [ ] **Step 3: Edit `src/app/useReaderHost.test.ts`**

If any existing test references `onBookRemovedWhileInReader`, rename to `onBookRemovedFromActiveView`. Add a new test:

```ts
it('fires onBookRemovedFromActiveView when removing the book the notebook view is on', async () => {
  const wiring = fakeWiring();
  const libraryStore = makeLibraryStore();
  const onBookRemovedFromActiveView = vi.fn();
  const book = sampleBook('b1');
  libraryStore.getState().upsertBook(book);

  const { result } = renderHook(() =>
    useReaderHost({
      ...baseOpts,
      wiring,
      libraryStore,
      view: { kind: 'notebook', bookId: 'b1' },
      onBookRemovedFromActiveView,
    }),
  );

  await act(async () => {
    result.current.onRemoveBook(book);
    await Promise.resolve();
  });

  expect(onBookRemovedFromActiveView).toHaveBeenCalled();
});
```

(`baseOpts`, `fakeWiring`, `makeLibraryStore`, `sampleBook` are already in the file. If `act` isn't imported, add `act` from `@testing-library/react`.)

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/app/useReaderHost.test.ts src/app/App.test.tsx 2>/dev/null; pnpm test --run src/app/useReaderHost.test.ts`
Expected: PASS — existing tests still pass with the renamed prop, new test passes.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean. Rename is fully type-checked.

- [ ] **Step 6: Commit**

```bash
git add src/app/useReaderHost.ts src/app/useReaderHost.test.ts src/app/App.tsx
git commit -m "refactor(app): rename onBookRemovedWhileInReader → onBookRemovedFromActiveView (notebook view also triggers)"
```

---

### Task 6: Pure helper — `compareNotebookEntries`

**Files:**
- Create: `src/features/annotations/notebook/notebookSort.ts`
- Create: `src/features/annotations/notebook/notebookSort.test.ts`

> **Strategy:** Build a small `getEntryAnchorKey(entry)` that normalises `LocationAnchor` (bookmark) and `HighlightAnchor` (highlight) into a unified sort key, then compare. EPUB CFIs are lex-comparable; PDF anchors compare by `(page, y, x)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/annotations/notebook/notebookSort.test.ts
import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp } from '@/domain';
import type { Bookmark, Highlight } from '@/domain/annotations/types';
import { compareNotebookEntries } from './notebookSort';
import type { NotebookEntry } from './types';

function bm(opts: { id: string; anchor: Bookmark['anchor']; createdAt?: string }): NotebookEntry {
  return {
    kind: 'bookmark',
    bookmark: {
      id: BookmarkId(opts.id),
      bookId: BookId('book-1'),
      anchor: opts.anchor,
      snippet: null,
      sectionTitle: null,
      createdAt: IsoTimestamp(opts.createdAt ?? '2026-05-04T12:00:00.000Z'),
    },
  };
}

function hl(opts: {
  id: string;
  anchor: Highlight['anchor'];
  createdAt?: string;
}): NotebookEntry {
  return {
    kind: 'highlight',
    highlight: {
      id: HighlightId(opts.id),
      bookId: BookId('book-1'),
      anchor: opts.anchor,
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp(opts.createdAt ?? '2026-05-04T12:00:00.000Z'),
    },
    note: null,
  };
}

describe('compareNotebookEntries', () => {
  it('PDF: sorts by page, then y, then x; bookmarks and highlights interleave', () => {
    const list: NotebookEntry[] = [
      hl({ id: 'h-2', anchor: { kind: 'pdf', page: 2, rects: [{ x: 50, y: 50, width: 1, height: 1 }] } }),
      bm({ id: 'b-1', anchor: { kind: 'pdf', page: 1 } }),
      hl({ id: 'h-3', anchor: { kind: 'pdf', page: 1, rects: [{ x: 200, y: 100, width: 1, height: 1 }] } }),
      hl({ id: 'h-4', anchor: { kind: 'pdf', page: 1, rects: [{ x: 50, y: 100, width: 1, height: 1 }] } }),
    ];
    list.sort(compareNotebookEntries);
    const ids = list.map((e) => (e.kind === 'bookmark' ? e.bookmark.id : e.highlight.id));
    expect(ids).toEqual(['b-1', 'h-4', 'h-3', 'h-2']);
  });

  it('EPUB: sorts by CFI lex order; bookmarks and highlights interleave', () => {
    const list: NotebookEntry[] = [
      hl({ id: 'h-2', anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' } }),
      bm({ id: 'b-1', anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/2)' } }),
      hl({ id: 'h-3', anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/6!/4/2)' } }),
    ];
    list.sort(compareNotebookEntries);
    const ids = list.map((e) => (e.kind === 'bookmark' ? e.bookmark.id : e.highlight.id));
    expect(ids).toEqual(['b-1', 'h-2', 'h-3']);
  });

  it('mixed-kind anchors fall back to createdAt', () => {
    const list: NotebookEntry[] = [
      bm({ id: 'b-1', anchor: { kind: 'pdf', page: 1 }, createdAt: '2026-05-04T13:00:00.000Z' }),
      hl({ id: 'h-1', anchor: { kind: 'epub-cfi', cfi: 'x' }, createdAt: '2026-05-04T12:00:00.000Z' }),
    ];
    list.sort(compareNotebookEntries);
    const ids = list.map((e) => (e.kind === 'bookmark' ? e.bookmark.id : e.highlight.id));
    expect(ids).toEqual(['h-1', 'b-1']);
  });

  it('PDF anchor without rects falls back to (page, 0, 0)', () => {
    const list: NotebookEntry[] = [
      hl({
        id: 'h-1',
        anchor: { kind: 'pdf', page: 2, rects: [] },
      }),
      bm({ id: 'b-1', anchor: { kind: 'pdf', page: 2 } }),
    ];
    list.sort(compareNotebookEntries);
    // Both at (2, 0, 0) — stable; preserves input order
    expect(list[0]?.kind === 'highlight' ? list[0].highlight.id : list[0]?.kind === 'bookmark' ? list[0].bookmark.id : null)
      .toBe('h-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/notebookSort.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the comparator**

Create `src/features/annotations/notebook/notebookSort.ts`:

```ts
import type { NotebookEntry } from './types';

type SortKey =
  | { readonly kind: 'epub-cfi'; readonly cfi: string }
  | { readonly kind: 'pdf'; readonly page: number; readonly y: number; readonly x: number };

function getEntryAnchorKey(entry: NotebookEntry): SortKey {
  if (entry.kind === 'bookmark') {
    const a = entry.bookmark.anchor;
    if (a.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: a.cfi };
    return { kind: 'pdf', page: a.page, y: 0, x: 0 };
  }
  const a = entry.highlight.anchor;
  if (a.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: a.cfi };
  const r = a.rects[0];
  return { kind: 'pdf', page: a.page, y: r?.y ?? 0, x: r?.x ?? 0 };
}

function getEntryCreatedAt(entry: NotebookEntry): string {
  return entry.kind === 'bookmark' ? entry.bookmark.createdAt : entry.highlight.createdAt;
}

export function compareNotebookEntries(a: NotebookEntry, b: NotebookEntry): number {
  const ka = getEntryAnchorKey(a);
  const kb = getEntryAnchorKey(b);
  if (ka.kind === 'pdf' && kb.kind === 'pdf') {
    if (ka.page !== kb.page) return ka.page - kb.page;
    if (ka.y !== kb.y) return ka.y - kb.y;
    if (ka.x !== kb.x) return ka.x - kb.x;
    return 0;
  }
  if (ka.kind === 'epub-cfi' && kb.kind === 'epub-cfi') {
    return ka.cfi < kb.cfi ? -1 : ka.cfi > kb.cfi ? 1 : 0;
  }
  // Mixed kinds in one book shouldn't happen (a book is one format), but
  // fall back to createdAt for stable, deterministic output.
  const ta = getEntryCreatedAt(a);
  const tb = getEntryCreatedAt(b);
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/annotations/notebook/notebookSort.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/notebookSort.ts src/features/annotations/notebook/notebookSort.test.ts
git commit -m "feat(notebook): compareNotebookEntries — book-order sort across bookmarks + highlights"
```

---

### Task 7: Pure helper — `matchesFilter`

**Files:**
- Create: `src/features/annotations/notebook/notebookFilter.ts`
- Create: `src/features/annotations/notebook/notebookFilter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/annotations/notebook/notebookFilter.test.ts
import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import { matchesFilter } from './notebookFilter';
import type { NotebookEntry } from './types';

const BOOKMARK: NotebookEntry = {
  kind: 'bookmark',
  bookmark: {
    id: BookmarkId('b-1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'pdf', page: 1 },
    snippet: null,
    sectionTitle: null,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  },
};

const HIGHLIGHT_NO_NOTE: NotebookEntry = {
  kind: 'highlight',
  highlight: {
    id: HighlightId('h-1'),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'x' },
    selectedText: 'x',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  },
  note: null,
};

const HIGHLIGHT_WITH_NOTE: NotebookEntry = {
  kind: 'highlight',
  highlight: HIGHLIGHT_NO_NOTE.kind === 'highlight' ? HIGHLIGHT_NO_NOTE.highlight : ({} as never),
  note: {
    id: NoteId('n-1'),
    bookId: BookId('book-1'),
    anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
    content: 'thought',
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  },
};

describe('matchesFilter', () => {
  it("'all' matches everything", () => {
    expect(matchesFilter(BOOKMARK, 'all')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'all')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'all')).toBe(true);
  });

  it("'bookmarks' matches only bookmark entries", () => {
    expect(matchesFilter(BOOKMARK, 'bookmarks')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'bookmarks')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'bookmarks')).toBe(false);
  });

  it("'highlights' matches all highlight entries (with or without note)", () => {
    expect(matchesFilter(BOOKMARK, 'highlights')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'highlights')).toBe(true);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'highlights')).toBe(true);
  });

  it("'notes' matches only highlight entries with a note attached", () => {
    expect(matchesFilter(BOOKMARK, 'notes')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_NO_NOTE, 'notes')).toBe(false);
    expect(matchesFilter(HIGHLIGHT_WITH_NOTE, 'notes')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/notebookFilter.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the filter helper**

```ts
// src/features/annotations/notebook/notebookFilter.ts
import type { NotebookEntry, NotebookFilter } from './types';

export function matchesFilter(entry: NotebookEntry, filter: NotebookFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'bookmarks':
      return entry.kind === 'bookmark';
    case 'highlights':
      return entry.kind === 'highlight';
    case 'notes':
      return entry.kind === 'highlight' && entry.note !== null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/annotations/notebook/notebookFilter.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/notebookFilter.ts src/features/annotations/notebook/notebookFilter.test.ts
git commit -m "feat(notebook): matchesFilter — type filter across NotebookEntry"
```

---

### Task 8: Pure helper — `matchesQuery`

**Files:**
- Create: `src/features/annotations/notebook/notebookSearch.ts`
- Create: `src/features/annotations/notebook/notebookSearch.test.ts`

> **Strategy:** Lowercase substring across snippet (bookmarks), section title, selected text + note content (highlights). Empty query short-circuits true. No regex parsing; literal `String.prototype.includes`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/annotations/notebook/notebookSearch.test.ts
import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import { matchesQuery } from './notebookSearch';
import type { NotebookEntry } from './types';

function bookmark(opts: {
  snippet?: string | null;
  sectionTitle?: string | null;
}): NotebookEntry {
  return {
    kind: 'bookmark',
    bookmark: {
      id: BookmarkId('b-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'pdf', page: 1 },
      snippet: opts.snippet ?? null,
      sectionTitle: opts.sectionTitle ?? null,
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    },
  };
}

function highlight(opts: {
  selectedText?: string;
  sectionTitle?: string | null;
  noteContent?: string;
}): NotebookEntry {
  return {
    kind: 'highlight',
    highlight: {
      id: HighlightId('h-1'),
      bookId: BookId('book-1'),
      anchor: { kind: 'epub-cfi', cfi: 'x' },
      selectedText: opts.selectedText ?? '',
      sectionTitle: opts.sectionTitle ?? null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    },
    note:
      opts.noteContent !== undefined
        ? {
            id: NoteId('n-1'),
            bookId: BookId('book-1'),
            anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
            content: opts.noteContent,
            createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
            updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
          }
        : null,
  };
}

describe('matchesQuery', () => {
  it('empty query matches every entry', () => {
    expect(matchesQuery(bookmark({}), '')).toBe(true);
    expect(matchesQuery(highlight({}), '   ')).toBe(true);
  });

  it('bookmark snippet match (case-insensitive)', () => {
    expect(matchesQuery(bookmark({ snippet: 'Bingley represents' }), 'BINGLEY')).toBe(true);
    expect(matchesQuery(bookmark({ snippet: 'Bingley represents' }), 'darcy')).toBe(false);
  });

  it('bookmark with null snippet falls back to sectionTitle', () => {
    expect(matchesQuery(bookmark({ snippet: null, sectionTitle: 'Chapter 4' }), 'chapter')).toBe(
      true,
    );
    expect(matchesQuery(bookmark({ snippet: null, sectionTitle: null }), 'chapter')).toBe(false);
  });

  it('highlight matches selectedText, sectionTitle, and note content', () => {
    expect(matchesQuery(highlight({ selectedText: 'a passage' }), 'PASSAGE')).toBe(true);
    expect(matchesQuery(highlight({ sectionTitle: 'Chapter 4' }), 'chapter')).toBe(true);
    expect(matchesQuery(highlight({ noteContent: 'gentry analysis' }), 'GENTRY')).toBe(true);
  });

  it('highlight without a note searches snippet+sectionTitle only', () => {
    const e = highlight({ selectedText: 'a passage', sectionTitle: 'Chapter 4' });
    expect(matchesQuery(e, 'thought')).toBe(false);
  });

  it('regex special characters are treated as literal text', () => {
    const e = bookmark({ snippet: 'price was $5.99 (final)' });
    expect(matchesQuery(e, '$5.99')).toBe(true);
    expect(matchesQuery(e, '(final)')).toBe(true);
    expect(matchesQuery(e, '.*')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/notebookSearch.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the search helper**

```ts
// src/features/annotations/notebook/notebookSearch.ts
import type { NotebookEntry } from './types';

function entryHaystack(entry: NotebookEntry): string {
  const parts: string[] = [];
  if (entry.kind === 'bookmark') {
    if (entry.bookmark.snippet) parts.push(entry.bookmark.snippet);
    if (entry.bookmark.sectionTitle) parts.push(entry.bookmark.sectionTitle);
  } else {
    parts.push(entry.highlight.selectedText);
    if (entry.highlight.sectionTitle) parts.push(entry.highlight.sectionTitle);
    if (entry.note) parts.push(entry.note.content);
  }
  return parts.join('\n').toLowerCase();
}

export function matchesQuery(entry: NotebookEntry, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return true;
  return entryHaystack(entry).includes(trimmed);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/annotations/notebook/notebookSearch.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/notebookSearch.ts src/features/annotations/notebook/notebookSearch.test.ts
git commit -m "feat(notebook): matchesQuery — case-insensitive substring across snippet/section/note"
```

---

### Task 9: `useNotebook` hook

**Files:**
- Create: `src/features/annotations/notebook/useNotebook.ts`
- Create: `src/features/annotations/notebook/useNotebook.test.ts`

> **Strategy:** Composes the three repos directly (no engine, no `useBookmarks`/`useHighlights`/`useNotes` reuse). Loads on mount. `entries` is a `useMemo` over `(bookmarks, highlights, notesByHighlightId, query, filter)`. Edit operations are optimistic with rollback, mirroring the existing per-type hook patterns.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/annotations/notebook/useNotebook.test.ts
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotebook } from './useNotebook';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type { BookmarksRepository, HighlightsRepository, NotesRepository } from '@/storage';

function fakeBookmarksRepo(initial: Bookmark[] = []): BookmarksRepository {
  const store = new Map<string, Bookmark>(initial.map((b) => [b.id, b]));
  return {
    add: vi.fn((b: Bookmark): Promise<void> => {
      store.set(b.id, b);
      return Promise.resolve();
    }),
    patch: vi.fn(() => Promise.resolve()),
    delete: vi.fn((id: ReturnType<typeof BookmarkId>): Promise<void> => {
      store.delete(id);
      return Promise.resolve();
    }),
    listByBook: vi.fn(
      (bookId: ReturnType<typeof BookId>): Promise<readonly Bookmark[]> =>
        Promise.resolve([...store.values()].filter((b) => b.bookId === bookId)),
    ),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

function fakeHighlightsRepo(initial: Highlight[] = []): HighlightsRepository {
  const store = new Map<string, Highlight>(initial.map((h) => [h.id, h]));
  return {
    add: vi.fn((h: Highlight): Promise<void> => {
      store.set(h.id, h);
      return Promise.resolve();
    }),
    patch: vi.fn(
      (
        id: ReturnType<typeof HighlightId>,
        partial: Partial<Highlight>,
      ): Promise<void> => {
        const existing = store.get(id);
        if (!existing) return Promise.resolve();
        store.set(id, { ...existing, ...partial });
        return Promise.resolve();
      },
    ),
    delete: vi.fn((id: ReturnType<typeof HighlightId>): Promise<void> => {
      store.delete(id);
      return Promise.resolve();
    }),
    listByBook: vi.fn(
      (bookId: ReturnType<typeof BookId>): Promise<readonly Highlight[]> =>
        Promise.resolve([...store.values()].filter((h) => h.bookId === bookId)),
    ),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

function fakeNotesRepo(initial: Note[] = []): NotesRepository {
  const store = new Map<string, Note>(initial.map((n) => [n.id, n]));
  return {
    upsert: vi.fn((n: Note): Promise<void> => {
      store.set(n.id, n);
      return Promise.resolve();
    }),
    delete: vi.fn((id: ReturnType<typeof NoteId>): Promise<void> => {
      store.delete(id);
      return Promise.resolve();
    }),
    listByBook: vi.fn(
      (bookId: ReturnType<typeof BookId>): Promise<readonly Note[]> =>
        Promise.resolve([...store.values()].filter((n) => n.bookId === bookId)),
    ),
    getByHighlight: vi.fn((hid: ReturnType<typeof HighlightId>): Promise<Note | null> => {
      const n = [...store.values()].find(
        (x) => x.anchorRef.kind === 'highlight' && x.anchorRef.highlightId === hid,
      );
      return Promise.resolve(n ?? null);
    }),
    deleteByHighlight: vi.fn((hid: ReturnType<typeof HighlightId>): Promise<void> => {
      for (const [id, n] of store) {
        if (n.anchorRef.kind === 'highlight' && n.anchorRef.highlightId === hid) {
          store.delete(id);
          break;
        }
      }
      return Promise.resolve();
    }),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

function makeBookmark(opts: { id: string; page: number; snippet?: string }): Bookmark {
  return {
    id: BookmarkId(opts.id),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page: opts.page },
    snippet: opts.snippet ?? null,
    sectionTitle: null,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
}

function makeHighlight(opts: {
  id: string;
  page: number;
  selectedText?: string;
}): Highlight {
  return {
    id: HighlightId(opts.id),
    bookId: BookId('b1'),
    anchor: {
      kind: 'pdf',
      page: opts.page,
      rects: [{ x: 50, y: 50, width: 100, height: 12 }],
    },
    selectedText: opts.selectedText ?? '',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
}

function makeNote(opts: { id: string; highlightId: string; content: string }): Note {
  return {
    id: NoteId(opts.id),
    bookId: BookId('b1'),
    anchorRef: { kind: 'highlight', highlightId: HighlightId(opts.highlightId) },
    content: opts.content,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('useNotebook', () => {
  it('initial load aggregates bookmarks + highlights + notes in book order', async () => {
    const bookmarksRepo = fakeBookmarksRepo([makeBookmark({ id: 'b-1', page: 2 })]);
    const highlightsRepo = fakeHighlightsRepo([
      makeHighlight({ id: 'h-1', page: 1 }),
      makeHighlight({ id: 'h-2', page: 3 }),
    ]);
    const notesRepo = fakeNotesRepo([makeNote({ id: 'n-1', highlightId: 'h-2', content: 'thought' })]);
    const { result } = renderHook(() =>
      useNotebook({ bookId: BookId('b1'), bookmarksRepo, highlightsRepo, notesRepo }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(3);
    });
    const ids = result.current.entries.map((e) =>
      e.kind === 'bookmark' ? e.bookmark.id : e.highlight.id,
    );
    expect(ids).toEqual(['h-1', 'b-1', 'h-2']);
    const noted = result.current.entries[2];
    expect(noted?.kind === 'highlight' && noted.note?.content).toBe('thought');
    expect(result.current.totalCount).toBe(3);
  });

  it('setQuery filters entries live', async () => {
    const bookmarksRepo = fakeBookmarksRepo([makeBookmark({ id: 'b-1', page: 1, snippet: 'apple' })]);
    const highlightsRepo = fakeHighlightsRepo([
      makeHighlight({ id: 'h-1', page: 2, selectedText: 'banana' }),
    ]);
    const notesRepo = fakeNotesRepo();
    const { result } = renderHook(() =>
      useNotebook({ bookId: BookId('b1'), bookmarksRepo, highlightsRepo, notesRepo }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    act(() => {
      result.current.setQuery('apple');
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.kind).toBe('bookmark');
  });

  it('setFilter("notes") shows only highlights with a note', async () => {
    const bookmarksRepo = fakeBookmarksRepo([makeBookmark({ id: 'b-1', page: 1 })]);
    const highlightsRepo = fakeHighlightsRepo([
      makeHighlight({ id: 'h-1', page: 2 }),
      makeHighlight({ id: 'h-2', page: 3 }),
    ]);
    const notesRepo = fakeNotesRepo([makeNote({ id: 'n-1', highlightId: 'h-2', content: 'x' })]);
    const { result } = renderHook(() =>
      useNotebook({ bookId: BookId('b1'), bookmarksRepo, highlightsRepo, notesRepo }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(3);
    });
    act(() => {
      result.current.setFilter('notes');
    });
    expect(result.current.entries).toHaveLength(1);
    expect(
      result.current.entries[0]?.kind === 'highlight' &&
        result.current.entries[0].highlight.id,
    ).toBe('h-2');
  });

  it('removeBookmark optimistic + rollback on repo failure', async () => {
    const target = makeBookmark({ id: 'b-1', page: 1 });
    const bookmarksRepo = fakeBookmarksRepo([target]);
    (bookmarksRepo.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo,
        highlightsRepo: fakeHighlightsRepo(),
        notesRepo: fakeNotesRepo(),
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await act(async () => {
      await result.current.removeBookmark(target);
    });
    expect(result.current.entries).toHaveLength(1);
  });

  it('removeHighlight cascades the note (both repos called) + rollback on failure', async () => {
    const target = makeHighlight({ id: 'h-1', page: 1 });
    const note = makeNote({ id: 'n-1', highlightId: 'h-1', content: 'x' });
    const highlightsRepo = fakeHighlightsRepo([target]);
    const notesRepo = fakeNotesRepo([note]);
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo: fakeBookmarksRepo(),
        highlightsRepo,
        notesRepo,
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await act(async () => {
      await result.current.removeHighlight(target);
    });
    expect(result.current.entries).toHaveLength(0);
    expect(highlightsRepo.delete).toHaveBeenCalledWith('h-1');
    expect(notesRepo.deleteByHighlight).toHaveBeenCalledWith('h-1');
  });

  it('changeColor optimistic + rollback on patch failure', async () => {
    const target = makeHighlight({ id: 'h-1', page: 1 });
    const highlightsRepo = fakeHighlightsRepo([target]);
    (highlightsRepo.patch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo: fakeBookmarksRepo(),
        highlightsRepo,
        notesRepo: fakeNotesRepo(),
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await act(async () => {
      await result.current.changeColor(target, 'green');
    });
    const e = result.current.entries[0];
    expect(e?.kind === 'highlight' && e.highlight.color).toBe('yellow');
  });

  it('saveNote upserts; saveNote("") deletes via deleteByHighlight', async () => {
    const target = makeHighlight({ id: 'h-1', page: 1 });
    const highlightsRepo = fakeHighlightsRepo([target]);
    const notesRepo = fakeNotesRepo();
    const { result } = renderHook(() =>
      useNotebook({
        bookId: BookId('b1'),
        bookmarksRepo: fakeBookmarksRepo(),
        highlightsRepo,
        notesRepo,
      }),
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    await act(async () => {
      await result.current.saveNote(target, 'first thought');
    });
    let e = result.current.entries[0];
    expect(e?.kind === 'highlight' && e.note?.content).toBe('first thought');
    await act(async () => {
      await result.current.saveNote(target, '');
    });
    e = result.current.entries[0];
    expect(e?.kind === 'highlight' && e.note).toBeNull();
    expect(notesRepo.deleteByHighlight).toHaveBeenCalled();
  });

  it('bookId change re-fetches', async () => {
    const bookmarksRepo = fakeBookmarksRepo();
    const highlightsRepo = fakeHighlightsRepo();
    const notesRepo = fakeNotesRepo();
    const { rerender } = renderHook(
      ({ id }: { id: ReturnType<typeof BookId> }) =>
        useNotebook({ bookId: id, bookmarksRepo, highlightsRepo, notesRepo }),
      { initialProps: { id: BookId('b1') } },
    );
    await waitFor(() => {
      expect(bookmarksRepo.listByBook).toHaveBeenCalledWith('b1');
    });
    rerender({ id: BookId('b2') });
    await waitFor(() => {
      expect(bookmarksRepo.listByBook).toHaveBeenCalledWith('b2');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/useNotebook.test.ts`
Expected: FAIL — `useNotebook` doesn't exist.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/annotations/notebook/useNotebook.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type BookId,
  type HighlightId,
  IsoTimestamp,
  NoteId,
} from '@/domain';
import type {
  Bookmark,
  Highlight,
  HighlightColor,
  Note,
} from '@/domain/annotations/types';
import type {
  BookmarksRepository,
  HighlightsRepository,
  NotesRepository,
} from '@/storage';
import { compareNotebookEntries } from './notebookSort';
import { matchesFilter } from './notebookFilter';
import { matchesQuery } from './notebookSearch';
import type { NotebookEntry, NotebookFilter } from './types';

export type UseNotebookHandle = {
  readonly entries: readonly NotebookEntry[];
  readonly totalCount: number;
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

function buildNotesMap(notes: readonly Note[]): Map<HighlightId, Note> {
  const map = new Map<HighlightId, Note>();
  for (const n of notes) {
    if (n.anchorRef.kind === 'highlight') {
      map.set(n.anchorRef.highlightId, n);
    }
  }
  return map;
}

export function useNotebook({
  bookId,
  bookmarksRepo,
  highlightsRepo,
  notesRepo,
}: Options): UseNotebookHandle {
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>([]);
  const [highlights, setHighlights] = useState<readonly Highlight[]>([]);
  const [notesByHighlightId, setNotesByHighlightId] = useState<ReadonlyMap<HighlightId, Note>>(
    () => new Map(),
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<NotebookFilter>('all');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      bookmarksRepo.listByBook(bookId),
      highlightsRepo.listByBook(bookId),
      notesRepo.listByBook(bookId),
    ]).then(([bms, hls, ns]) => {
      if (cancelled) return;
      setBookmarks(bms);
      setHighlights(hls);
      setNotesByHighlightId(buildNotesMap(ns));
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, bookmarksRepo, highlightsRepo, notesRepo]);

  const entries = useMemo<readonly NotebookEntry[]>(() => {
    const unified: NotebookEntry[] = [
      ...bookmarks.map((bookmark): NotebookEntry => ({ kind: 'bookmark', bookmark })),
      ...highlights.map(
        (highlight): NotebookEntry => ({
          kind: 'highlight',
          highlight,
          note: notesByHighlightId.get(highlight.id) ?? null,
        }),
      ),
    ];
    const filtered = unified.filter(
      (e) => matchesFilter(e, filter) && matchesQuery(e, query),
    );
    return filtered.sort(compareNotebookEntries);
  }, [bookmarks, highlights, notesByHighlightId, filter, query]);

  const totalCount = bookmarks.length + highlights.length;

  const removeBookmark = useCallback(
    async (b: Bookmark): Promise<void> => {
      const prev = bookmarks;
      setBookmarks((xs) => xs.filter((x) => x.id !== b.id));
      try {
        await bookmarksRepo.delete(b.id);
      } catch (err) {
        console.warn('[notebook] removeBookmark failed; restoring', err);
        setBookmarks(prev);
      }
    },
    [bookmarks, bookmarksRepo],
  );

  const removeHighlight = useCallback(
    async (h: Highlight): Promise<void> => {
      const prevHighlights = highlights;
      const prevNotes = notesByHighlightId;
      setHighlights((xs) => xs.filter((x) => x.id !== h.id));
      const nextNotes = new Map(notesByHighlightId);
      nextNotes.delete(h.id);
      setNotesByHighlightId(nextNotes);
      try {
        await Promise.all([
          highlightsRepo.delete(h.id),
          notesRepo.deleteByHighlight(h.id),
        ]);
      } catch (err) {
        console.warn('[notebook] removeHighlight failed; restoring', err);
        setHighlights(prevHighlights);
        setNotesByHighlightId(prevNotes);
      }
    },
    [highlights, notesByHighlightId, highlightsRepo, notesRepo],
  );

  const changeColor = useCallback(
    async (h: Highlight, color: HighlightColor): Promise<void> => {
      const prev = highlights;
      setHighlights((xs) => xs.map((x) => (x.id === h.id ? { ...x, color } : x)));
      try {
        await highlightsRepo.patch(h.id, { color });
      } catch (err) {
        console.warn('[notebook] changeColor failed; reverting', err);
        setHighlights(prev);
      }
    },
    [highlights, highlightsRepo],
  );

  const saveNote = useCallback(
    async (h: Highlight, content: string): Promise<void> => {
      const trimmed = content.trim();
      const existing = notesByHighlightId.get(h.id);
      if (trimmed === '') {
        if (!existing) return;
        const prev = notesByHighlightId;
        const next = new Map(notesByHighlightId);
        next.delete(h.id);
        setNotesByHighlightId(next);
        try {
          await notesRepo.deleteByHighlight(h.id);
        } catch (err) {
          console.warn('[notebook] clearNote failed; restoring', err);
          setNotesByHighlightId(prev);
        }
        return;
      }
      const now = IsoTimestamp(new Date().toISOString());
      const record: Note = existing
        ? { ...existing, content: trimmed, updatedAt: now }
        : {
            id: NoteId(crypto.randomUUID()),
            bookId: h.bookId,
            anchorRef: { kind: 'highlight', highlightId: h.id },
            content: trimmed,
            createdAt: now,
            updatedAt: now,
          };
      const prev = notesByHighlightId;
      const next = new Map(notesByHighlightId);
      next.set(h.id, record);
      setNotesByHighlightId(next);
      try {
        await notesRepo.upsert(record);
      } catch (err) {
        console.warn('[notebook] saveNote failed; rolling back', err);
        setNotesByHighlightId(prev);
      }
    },
    [notesByHighlightId, notesRepo],
  );

  return {
    entries,
    totalCount,
    query,
    setQuery,
    filter,
    setFilter,
    removeBookmark,
    removeHighlight,
    changeColor,
    saveNote,
  };
}
```

- [ ] **Step 4: Run useNotebook tests**

Run: `pnpm test --run src/features/annotations/notebook/useNotebook.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/useNotebook.ts src/features/annotations/notebook/useNotebook.test.ts
git commit -m "feat(notebook): useNotebook — composes three repos with optimistic CRUD"
```

---

### Task 10: Icons module — `src/shared/icons/`

**Files:**
- Create: `src/shared/icons/icon.css`
- Create: `src/shared/icons/NotebookIcon.tsx`
- Create: `src/shared/icons/NoteIcon.tsx`
- Create: `src/shared/icons/ArrowLeftIcon.tsx`
- Create: `src/shared/icons/index.ts`
- Create: `src/shared/icons/icons.test.tsx`

> **Strategy:** Three hand-authored monochrome SVG components, 16px default, 1.5px stroke, `currentColor`. Shared CSS provides the base `.icon` class. Barrel export simplifies imports.

- [ ] **Step 1: Write the failing test**

```tsx
// src/shared/icons/icons.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NotebookIcon, NoteIcon, ArrowLeftIcon } from './index';

afterEach(cleanup);

describe('icons', () => {
  it('NotebookIcon renders a 16px svg with .icon class and aria-hidden', () => {
    const { container } = render(<NotebookIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.classList.contains('icon')).toBe(true);
  });

  it('NoteIcon renders an svg', () => {
    const { container } = render(<NoteIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('ArrowLeftIcon renders an svg', () => {
    const { container } = render(<ArrowLeftIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('NotebookIcon accepts a custom size', () => {
    const { container } = render(<NotebookIcon size={24} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('NotebookIcon merges custom className with .icon', () => {
    const { container } = render(<NotebookIcon className="extra" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('icon')).toBe(true);
    expect(svg?.classList.contains('extra')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/shared/icons/icons.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/shared/icons/icon.css`**

```css
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

- [ ] **Step 4: Create `src/shared/icons/NotebookIcon.tsx`**

```tsx
import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function NotebookIcon({ size = 16, className }: Props) {
  const cls = className ? `icon ${className}` : 'icon';
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 2.5h7a1.5 1.5 0 0 1 1.5 1.5v9a.5.5 0 0 1-.5.5H4a1.5 1.5 0 0 1 0-3h8.5" />
      <path d="M6 5.5h4M6 8h3" />
    </svg>
  );
}
```

- [ ] **Step 5: Create `src/shared/icons/NoteIcon.tsx`**

```tsx
import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function NoteIcon({ size = 16, className }: Props) {
  const cls = className ? `icon ${className}` : 'icon';
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 3.5h7l2 2v7a.5.5 0 0 1-.5.5H3.5a.5.5 0 0 1-.5-.5v-9z" />
      <path d="M5 7.5h6M5 10h4" />
    </svg>
  );
}
```

- [ ] **Step 6: Create `src/shared/icons/ArrowLeftIcon.tsx`**

```tsx
import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function ArrowLeftIcon({ size = 16, className }: Props) {
  const cls = className ? `icon ${className}` : 'icon';
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 3l-5 5 5 5" />
    </svg>
  );
}
```

- [ ] **Step 7: Create `src/shared/icons/index.ts`**

```ts
export { NotebookIcon } from './NotebookIcon';
export { NoteIcon } from './NoteIcon';
export { ArrowLeftIcon } from './ArrowLeftIcon';
```

- [ ] **Step 8: Run icon tests**

Run: `pnpm test --run src/shared/icons/icons.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 9: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/shared/icons/
git commit -m "feat(icons): NotebookIcon + NoteIcon + ArrowLeftIcon — monochrome SVG line icons"
```

---

### Task 11: Replace 📝 emoji in `HighlightToolbar` with `<NoteIcon />`

**Files:**
- Modify: `src/features/reader/HighlightToolbar.tsx`
- Modify: `src/features/reader/HighlightToolbar.test.tsx`

> **Strategy:** Pure presentation swap — replace the `<span>📝</span>` with `<NoteIcon />`. Update existing tests that asserted on the emoji glyph (if any) to assert on `<svg>`.

- [ ] **Step 1: Edit `src/features/reader/HighlightToolbar.tsx`**

Add the import at the top:

```ts
import { NoteIcon } from '@/shared/icons';
```

Find:

```tsx
            onClick={onNote}
          >
            <span aria-hidden="true">📝</span>
          </button>
```

Replace with:

```tsx
            onClick={onNote}
          >
            <NoteIcon />
          </button>
```

- [ ] **Step 2: Update tests in `src/features/reader/HighlightToolbar.test.tsx`**

Search the file for any literal `📝`. If a test asserts the emoji is rendered as text, change it to assert an `<svg>` is present. If no such assertion exists, no change needed beyond making sure the existing button-name regex still matches (the `aria-label` is still "Add note" / "Edit note", so it should).

- [ ] **Step 3: Run tests**

Run: `pnpm test --run src/features/reader/HighlightToolbar.test.tsx`
Expected: PASS — all existing tests.

- [ ] **Step 4: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/HighlightToolbar.tsx src/features/reader/HighlightToolbar.test.tsx
git commit -m "refactor(reader): HighlightToolbar — replace 📝 emoji with NoteIcon SVG"
```

---

### Task 12: Replace 📝 emoji in `HighlightsPanel` with `<NoteIcon />`

**Files:**
- Modify: `src/features/reader/HighlightsPanel.tsx`
- Modify: `src/features/reader/HighlightsPanel.test.tsx`

- [ ] **Step 1: Edit `src/features/reader/HighlightsPanel.tsx`**

Add the import:

```ts
import { NoteIcon } from '@/shared/icons';
```

Find the note-button JSX inside the row's `__actions` span:

```tsx
                  onClick={() => {
                    setEditingNoteFor((cur) => (cur === h.id ? null : h.id));
                  }}
                >
                  <span aria-hidden="true">📝</span>
                </button>
```

Replace with:

```tsx
                  onClick={() => {
                    setEditingNoteFor((cur) => (cur === h.id ? null : h.id));
                  }}
                >
                  <NoteIcon />
                </button>
```

- [ ] **Step 2: Update tests in `src/features/reader/HighlightsPanel.test.tsx`**

Search for any literal `📝`. Update to assert `<svg>` if needed. Aria-labels (Add note / Edit note / Cancel note) remain stable.

- [ ] **Step 3: Run panel tests**

Run: `pnpm test --run src/features/reader/HighlightsPanel.test.tsx`
Expected: PASS — all existing tests.

- [ ] **Step 4: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/HighlightsPanel.tsx src/features/reader/HighlightsPanel.test.tsx
git commit -m "refactor(reader): HighlightsPanel — replace 📝 emoji with NoteIcon SVG"
```

---

### Task 13: `NotebookEmptyState` component

**Files:**
- Create: `src/features/annotations/notebook/NotebookEmptyState.tsx`
- Create: `src/features/annotations/notebook/notebook-empty-state.css`
- Create: `src/features/annotations/notebook/NotebookEmptyState.test.tsx`

> **Strategy:** Pure presentation. One prop (`reason`). Two copy variants. Same visual language as `LibraryEmptyState`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/annotations/notebook/NotebookEmptyState.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NotebookEmptyState } from './NotebookEmptyState';

afterEach(cleanup);

describe('NotebookEmptyState', () => {
  it("reason='no-entries' renders welcome copy", () => {
    render(<NotebookEmptyState reason="no-entries" />);
    expect(screen.getByText(/no annotations yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Open this book and tap/i)).toBeInTheDocument();
  });

  it("reason='no-matches' renders no-matches copy", () => {
    render(<NotebookEmptyState reason="no-matches" />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    expect(screen.getByText(/Try a different search/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/NotebookEmptyState.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/annotations/notebook/NotebookEmptyState.tsx
import './notebook-empty-state.css';

type Props = { readonly reason: 'no-entries' | 'no-matches' };

export function NotebookEmptyState({ reason }: Props) {
  if (reason === 'no-entries') {
    return (
      <aside className="notebook-empty-state">
        <p className="notebook-empty-state__title">No annotations yet</p>
        <p className="notebook-empty-state__hint">
          Open this book and tap a bookmark, highlight, or note to start.
        </p>
      </aside>
    );
  }
  return (
    <aside className="notebook-empty-state">
      <p className="notebook-empty-state__title">No matches</p>
      <p className="notebook-empty-state__hint">Try a different search or filter.</p>
    </aside>
  );
}
```

```css
/* src/features/annotations/notebook/notebook-empty-state.css */
.notebook-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-muted);
  gap: var(--space-2);
}
.notebook-empty-state__title {
  font-weight: 600;
  font-size: var(--text-lg);
  color: var(--color-text);
  margin: 0;
}
.notebook-empty-state__hint {
  margin: 0;
  font-size: var(--text-sm);
  max-width: 320px;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/annotations/notebook/NotebookEmptyState.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/NotebookEmptyState.tsx src/features/annotations/notebook/notebook-empty-state.css src/features/annotations/notebook/NotebookEmptyState.test.tsx
git commit -m "feat(notebook): NotebookEmptyState — no-entries + no-matches variants"
```

---

### Task 14: `NotebookChrome` component

**Files:**
- Create: `src/features/annotations/notebook/NotebookChrome.tsx`
- Create: `src/features/annotations/notebook/notebook-chrome.css`
- Create: `src/features/annotations/notebook/NotebookChrome.test.tsx`

> **Strategy:** Compact header. Back button (← Reader) + title ("Notebook · Book Title"). One prop bundle. Pure presentation.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/annotations/notebook/NotebookChrome.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NotebookChrome } from './NotebookChrome';

afterEach(cleanup);

describe('NotebookChrome', () => {
  it('renders the back button + title with book name', () => {
    render(<NotebookChrome bookTitle="Pride and Prejudice" onBack={() => undefined} />);
    expect(screen.getByRole('button', { name: /back to reader/i })).toBeInTheDocument();
    expect(screen.getByText(/Notebook/)).toBeInTheDocument();
    expect(screen.getByText(/Pride and Prejudice/)).toBeInTheDocument();
  });

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn();
    render(<NotebookChrome bookTitle="x" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /back to reader/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/NotebookChrome.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/annotations/notebook/NotebookChrome.tsx
import { ArrowLeftIcon } from '@/shared/icons';
import './notebook-chrome.css';

type Props = {
  readonly bookTitle: string;
  readonly onBack: () => void;
};

export function NotebookChrome({ bookTitle, onBack }: Props) {
  return (
    <header className="notebook-chrome">
      <button
        type="button"
        className="notebook-chrome__back"
        onClick={onBack}
        aria-label="Back to reader"
      >
        <ArrowLeftIcon />
        <span>Reader</span>
      </button>
      <div className="notebook-chrome__title" aria-live="polite">
        <span className="notebook-chrome__title-label">Notebook</span>
        <span className="notebook-chrome__title-sep" aria-hidden="true"> · </span>
        <span className="notebook-chrome__title-book">{bookTitle}</span>
      </div>
    </header>
  );
}
```

```css
/* src/features/annotations/notebook/notebook-chrome.css */
.notebook-chrome {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg);
}
.notebook-chrome__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
}
.notebook-chrome__back:hover {
  background: var(--color-surface-hover, var(--color-surface));
}
.notebook-chrome__title {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.notebook-chrome__title-label {
  color: var(--color-text-muted);
  font-weight: 500;
}
.notebook-chrome__title-sep {
  color: var(--color-text-subtle);
}
.notebook-chrome__title-book {
  color: var(--color-text);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/annotations/notebook/NotebookChrome.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/NotebookChrome.tsx src/features/annotations/notebook/notebook-chrome.css src/features/annotations/notebook/NotebookChrome.test.tsx
git commit -m "feat(notebook): NotebookChrome — back button + 'Notebook · Title' header"
```

---

### Task 15: `NotebookSearchBar` component

**Files:**
- Create: `src/features/annotations/notebook/NotebookSearchBar.tsx`
- Create: `src/features/annotations/notebook/notebook-search-bar.css`
- Create: `src/features/annotations/notebook/NotebookSearchBar.test.tsx`

> **Strategy:** Controlled component (parent owns query + filter state). Internal debounce on search input (~150ms). Filter chips with `aria-pressed`. ⌘K / Ctrl+K focuses the search input.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/annotations/notebook/NotebookSearchBar.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NotebookSearchBar } from './NotebookSearchBar';

afterEach(cleanup);
beforeEach(() => vi.useFakeTimers());

describe('NotebookSearchBar', () => {
  it('renders search input + 4 filter chips', () => {
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="all"
        onFilterChange={() => undefined}
      />,
    );
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bookmarks/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^highlights$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^notes$/i })).toBeInTheDocument();
  });

  it('debounces onQueryChange ~150ms', () => {
    const onQueryChange = vi.fn();
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={onQueryChange}
        filter="all"
        onFilterChange={() => undefined}
      />,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } });
    expect(onQueryChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(onQueryChange).toHaveBeenCalledWith('a');
  });

  it('filter chip click is immediate (no debounce)', () => {
    const onFilterChange = vi.fn();
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="all"
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /bookmarks/i }));
    expect(onFilterChange).toHaveBeenCalledWith('bookmarks');
  });

  it('aria-pressed reflects active filter', () => {
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="highlights"
        onFilterChange={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /^highlights$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^all$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('Cmd/Ctrl+K focuses the search input', () => {
    render(
      <NotebookSearchBar
        query=""
        onQueryChange={() => undefined}
        filter="all"
        onFilterChange={() => undefined}
      />,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/NotebookSearchBar.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/annotations/notebook/NotebookSearchBar.tsx
import { useEffect, useRef, useState } from 'react';
import type { NotebookFilter } from './types';
import './notebook-search-bar.css';

type Props = {
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly filter: NotebookFilter;
  readonly onFilterChange: (f: NotebookFilter) => void;
};

const DEBOUNCE_MS = 150;
const FILTERS: readonly { value: NotebookFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bookmarks', label: 'Bookmarks' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'notes', label: 'Notes' },
];

export function NotebookSearchBar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
}: Props) {
  const [local, setLocal] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced forward to parent.
  useEffect(() => {
    if (local === query) return;
    const id = window.setTimeout(() => {
      onQueryChange(local);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [local, query, onQueryChange]);

  // Cmd/Ctrl+K focus shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="notebook-search-bar">
      <input
        ref={inputRef}
        type="search"
        className="notebook-search-bar__input"
        placeholder="Search annotations"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
        }}
      />
      <div className="notebook-search-bar__chips" role="toolbar" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={
              f.value === filter
                ? 'notebook-search-bar__chip notebook-search-bar__chip--active'
                : 'notebook-search-bar__chip'
            }
            aria-pressed={f.value === filter}
            onClick={() => {
              onFilterChange(f.value);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

```css
/* src/features/annotations/notebook/notebook-search-bar.css */
.notebook-search-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg);
  position: sticky;
  top: 0;
  z-index: 5;
  border-bottom: 1px solid var(--color-border-subtle);
}
.notebook-search-bar__input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  outline: none;
}
.notebook-search-bar__input:focus {
  border-color: var(--color-text-muted);
}
.notebook-search-bar__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.notebook-search-bar__chip {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 4px 12px;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  cursor: pointer;
}
.notebook-search-bar__chip:hover {
  color: var(--color-text);
}
.notebook-search-bar__chip--active {
  background: var(--color-text);
  border-color: var(--color-text);
  color: var(--color-bg);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/annotations/notebook/NotebookSearchBar.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/NotebookSearchBar.tsx src/features/annotations/notebook/notebook-search-bar.css src/features/annotations/notebook/NotebookSearchBar.test.tsx
git commit -m "feat(notebook): NotebookSearchBar — debounced search input + single-select chips + ⌘K focus"
```

---

### Task 16: `NotebookRow` component

**Files:**
- Create: `src/features/annotations/notebook/NotebookRow.tsx`
- Create: `src/features/annotations/notebook/notebook-row.css`
- Create: `src/features/annotations/notebook/NotebookRow.test.tsx`

> **Strategy:** One row component that internally branches on `entry.kind`. Renders the eyebrow type tag + section + relative time + content. For highlights with notes, includes the inline note line / inline `NoteEditor`. Click on the content area calls `onJumpToAnchor` with the projected `LocationAnchor`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/annotations/notebook/NotebookRow.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NotebookRow } from './NotebookRow';
import { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { NotebookEntry } from './types';

afterEach(cleanup);

const NOW = new Date('2026-05-04T12:00:00.000Z').getTime();

function bookmarkEntry(): NotebookEntry {
  return {
    kind: 'bookmark',
    bookmark: {
      id: BookmarkId('b-1'),
      bookId: BookId('b1'),
      anchor: { kind: 'pdf', page: 3 },
      snippet: 'It is a truth universally acknowledged...',
      sectionTitle: 'Chapter 1',
      createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    },
  };
}

function highlightEntry(opts: { withNote?: boolean } = {}): NotebookEntry {
  return {
    kind: 'highlight',
    highlight: {
      id: HighlightId('h-1'),
      bookId: BookId('b1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
      selectedText: 'a passage of selected text',
      sectionTitle: 'Chapter 4',
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    },
    note: opts.withNote
      ? {
          id: NoteId('n-1'),
          bookId: BookId('b1'),
          anchorRef: { kind: 'highlight', highlightId: HighlightId('h-1') },
          content: 'a thought about Bingley',
          createdAt: IsoTimestamp(new Date(NOW).toISOString()),
          updatedAt: IsoTimestamp(new Date(NOW).toISOString()),
        }
      : null,
  };
}

function setup(entry: NotebookEntry, overrides: Partial<React.ComponentProps<typeof NotebookRow>> = {}) {
  return render(
    <NotebookRow
      entry={entry}
      nowMs={NOW}
      onJumpToAnchor={overrides.onJumpToAnchor ?? (() => undefined)}
      onRemoveBookmark={overrides.onRemoveBookmark ?? (() => undefined)}
      onRemoveHighlight={overrides.onRemoveHighlight ?? (() => undefined)}
      onChangeColor={overrides.onChangeColor ?? (() => undefined)}
      onSaveNote={overrides.onSaveNote ?? (() => undefined)}
    />,
  );
}

describe('NotebookRow — bookmark', () => {
  it('renders BOOKMARK type tag, section, snippet, single delete button', () => {
    setup(bookmarkEntry());
    expect(screen.getByText('BOOKMARK')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText(/truth universally acknowledged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set color to/i })).toBeNull();
  });

  it('clicking content calls onJumpToAnchor with the bookmark anchor', () => {
    const onJumpToAnchor = vi.fn();
    setup(bookmarkEntry(), { onJumpToAnchor });
    fireEvent.click(screen.getByRole('button', { name: /Chapter 1/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'pdf', page: 3 });
  });

  it('clicking delete calls onRemoveBookmark and does NOT jump', () => {
    const onJumpToAnchor = vi.fn();
    const onRemoveBookmark = vi.fn();
    const e = bookmarkEntry();
    setup(e, { onJumpToAnchor, onRemoveBookmark });
    fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));
    expect(onRemoveBookmark).toHaveBeenCalled();
    expect(onJumpToAnchor).not.toHaveBeenCalled();
  });
});

describe('NotebookRow — highlight', () => {
  it('renders HIGHLIGHT type tag, section, color bar, color pips, note button, delete', () => {
    const { container } = setup(highlightEntry());
    expect(screen.getByText('HIGHLIGHT')).toBeInTheDocument();
    expect(screen.getByText('Chapter 4')).toBeInTheDocument();
    expect(container.querySelector('.notebook-row__bar[data-color="yellow"]')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /set color to/i })).toHaveLength(4);
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove highlight/i })).toBeInTheDocument();
  });

  it('renders NOTE type tag and inline note text when entry has a note', () => {
    setup(highlightEntry({ withNote: true }));
    expect(screen.getByText('NOTE')).toBeInTheDocument();
    expect(screen.getByText(/thought about Bingley/)).toBeInTheDocument();
  });

  it('clicking the note button enters edit mode (NoteEditor renders)', () => {
    setup(highlightEntry());
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('saving content calls onSaveNote(highlight, content)', () => {
    const onSaveNote = vi.fn();
    const entry = highlightEntry();
    setup(entry, { onSaveNote });
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'new thought' } });
    fireEvent.blur(ta);
    expect(onSaveNote).toHaveBeenCalledWith(
      entry.kind === 'highlight' ? entry.highlight : null,
      'new thought',
    );
  });

  it('clicking content calls onJumpToAnchor with the projected LocationAnchor', () => {
    const onJumpToAnchor = vi.fn();
    setup(highlightEntry(), { onJumpToAnchor });
    fireEvent.click(screen.getByRole('button', { name: /Chapter 4/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' });
  });

  it('PDF highlight projects to {kind:"pdf", page} (drops rects)', () => {
    const onJumpToAnchor = vi.fn();
    const entry: NotebookEntry = {
      kind: 'highlight',
      highlight: {
        id: HighlightId('h-1'),
        bookId: BookId('b1'),
        anchor: { kind: 'pdf', page: 7, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
        selectedText: 'x',
        sectionTitle: 'p7',
        color: 'yellow',
        tags: [],
        createdAt: IsoTimestamp(new Date(NOW).toISOString()),
      },
      note: null,
    };
    setup(entry, { onJumpToAnchor });
    fireEvent.click(screen.getByRole('button', { name: /p7/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'pdf', page: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/NotebookRow.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/annotations/notebook/NotebookRow.tsx
import { useState } from 'react';
import type { Bookmark, Highlight, HighlightColor } from '@/domain/annotations/types';
import type { LocationAnchor } from '@/domain';
import { HIGHLIGHT_COLORS, COLOR_HEX } from '@/features/reader/highlightColors';
import { NoteEditor } from '@/features/reader/NoteEditor';
import { NoteIcon } from '@/shared/icons';
import { relativeTime } from '@/shared/text/relativeTime';
import type { NotebookEntry } from './types';
import './notebook-row.css';

type Props = {
  readonly entry: NotebookEntry;
  readonly nowMs?: number;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
  readonly onRemoveBookmark: (b: Bookmark) => void;
  readonly onRemoveHighlight: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly onSaveNote: (h: Highlight, content: string) => void;
};

function projectHighlightAnchor(h: Highlight): LocationAnchor {
  if (h.anchor.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: h.anchor.cfi };
  return { kind: 'pdf', page: h.anchor.page };
}

export function NotebookRow({
  entry,
  nowMs,
  onJumpToAnchor,
  onRemoveBookmark,
  onRemoveHighlight,
  onChangeColor,
  onSaveNote,
}: Props) {
  const [editingNote, setEditingNote] = useState(false);

  if (entry.kind === 'bookmark') {
    const b = entry.bookmark;
    return (
      <li className="notebook-row notebook-row--bookmark">
        <div className="notebook-row__main">
          <button
            type="button"
            className="notebook-row__content"
            aria-label={b.sectionTitle ?? 'Bookmark'}
            onClick={() => {
              onJumpToAnchor(b.anchor);
            }}
          >
            <span className="notebook-row__top">
              <span className="notebook-row__type">BOOKMARK</span>
              {b.sectionTitle ? (
                <span className="notebook-row__section">{b.sectionTitle}</span>
              ) : null}
              <span className="notebook-row__time">{relativeTime(b.createdAt, nowMs)}</span>
            </span>
            {b.snippet ? (
              <span className="notebook-row__text">{b.snippet}</span>
            ) : null}
          </button>
        </div>
        <span className="notebook-row__actions">
          <button
            type="button"
            className="notebook-row__delete"
            aria-label="Remove bookmark"
            onClick={() => {
              onRemoveBookmark(b);
            }}
          >
            ×
          </button>
        </span>
      </li>
    );
  }

  const h = entry.highlight;
  const note = entry.note;
  const noteLabel = editingNote ? 'Cancel note' : note ? 'Edit note' : 'Add note';

  return (
    <li className="notebook-row notebook-row--highlight">
      <span
        className="notebook-row__bar"
        data-color={h.color}
        style={{ background: COLOR_HEX[h.color] }}
        aria-hidden="true"
      />
      <div className="notebook-row__main">
        <button
          type="button"
          className="notebook-row__content"
          aria-label={h.sectionTitle ?? 'Highlight'}
          onClick={() => {
            if (editingNote) return;
            onJumpToAnchor(projectHighlightAnchor(h));
          }}
        >
          <span className="notebook-row__top">
            <span className="notebook-row__type">{note ? 'NOTE' : 'HIGHLIGHT'}</span>
            {h.sectionTitle ? (
              <span className="notebook-row__section">{h.sectionTitle}</span>
            ) : null}
            <span className="notebook-row__time">{relativeTime(h.createdAt, nowMs)}</span>
          </span>
          <span className="notebook-row__text">{h.selectedText}</span>
        </button>
        {!editingNote && note ? (
          <button
            type="button"
            className="notebook-row__note-line"
            data-testid="notebook-note-line"
            onClick={() => {
              setEditingNote(true);
            }}
          >
            {note.content}
          </button>
        ) : null}
        {editingNote ? (
          <div className="notebook-row__editor">
            <NoteEditor
              initialContent={note?.content ?? ''}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- entering edit mode is an explicit user action
              autoFocus
              onSave={(content) => {
                onSaveNote(h, content);
                setEditingNote(false);
              }}
              onCancel={() => {
                setEditingNote(false);
              }}
            />
          </div>
        ) : null}
      </div>
      <span className="notebook-row__actions">
        {!editingNote
          ? HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="notebook-row__color"
                aria-label={`Set color to ${color}`}
                aria-pressed={color === h.color}
                style={{ background: COLOR_HEX[color] }}
                onClick={() => {
                  onChangeColor(h, color);
                }}
              />
            ))
          : null}
        <button
          type="button"
          className={
            editingNote
              ? 'notebook-row__note-btn notebook-row__note-btn--active'
              : note
                ? 'notebook-row__note-btn notebook-row__note-btn--has-note'
                : 'notebook-row__note-btn'
          }
          aria-label={noteLabel}
          onClick={() => {
            setEditingNote((cur) => !cur);
          }}
        >
          <NoteIcon />
        </button>
        {!editingNote ? (
          <button
            type="button"
            className="notebook-row__delete"
            aria-label="Remove highlight"
            onClick={() => {
              onRemoveHighlight(h);
            }}
          >
            ×
          </button>
        ) : null}
      </span>
    </li>
  );
}
```

```css
/* src/features/annotations/notebook/notebook-row.css */
.notebook-row {
  position: relative;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--color-border-subtle);
  min-height: 64px;
}
.notebook-row__bar {
  flex: 0 0 4px;
  align-self: stretch;
}
.notebook-row__main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.notebook-row__content {
  flex: 1 1 auto;
  text-align: start;
  background: transparent;
  border: 0;
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text);
  font: inherit;
  min-width: 0;
}
.notebook-row__content:hover {
  background: var(--color-surface-hover, var(--color-surface));
}
.notebook-row__top {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.notebook-row__type {
  font-size: 10px;
  letter-spacing: 0.08em;
  font-weight: 600;
  color: var(--color-text-subtle);
  flex: 0 0 auto;
}
.notebook-row__section {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-muted);
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notebook-row__time {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  flex: 0 0 auto;
}
.notebook-row__text {
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notebook-row__note-line {
  display: block;
  width: auto;
  margin: 0 var(--space-4) var(--space-2);
  padding: 4px 6px 4px 10px;
  background: transparent;
  border: none;
  border-left: 2px solid var(--color-border);
  text-align: left;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.notebook-row__note-line:hover {
  color: var(--color-text);
  background: var(--color-surface-hover, var(--color-surface));
}
.notebook-row__editor {
  margin: 0 var(--space-4) var(--space-2);
}
.notebook-row__actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-inline-end: var(--space-2);
}
.notebook-row__color {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.1);
  cursor: pointer;
  padding: 0;
}
.notebook-row__color[aria-pressed='true'] {
  outline: 2px solid var(--color-text);
  outline-offset: 1px;
}
.notebook-row__note-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-muted);
}
.notebook-row__note-btn:hover {
  background: var(--color-surface-hover, var(--color-surface));
  color: var(--color-text);
}
.notebook-row__note-btn--has-note,
.notebook-row__note-btn--active {
  background: var(--color-surface-hover, var(--color-surface));
  color: var(--color-text);
  outline: 1px solid var(--color-border);
}
.notebook-row__delete {
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  padding: 0 4px;
}
```

- [ ] **Step 4: Run row tests**

Run: `pnpm test --run src/features/annotations/notebook/NotebookRow.test.tsx`
Expected: PASS — all bookmark + highlight tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/NotebookRow.tsx src/features/annotations/notebook/notebook-row.css src/features/annotations/notebook/NotebookRow.test.tsx
git commit -m "feat(notebook): NotebookRow — type-tagged unified row with inline NoteEditor"
```

---

### Task 17: `NotebookList` component

**Files:**
- Create: `src/features/annotations/notebook/NotebookList.tsx`

> **Strategy:** Thin `<ul>` wrapper that maps entries to `NotebookRow`s. No tests of its own — covered by `NotebookView.test.tsx` (next task).

- [ ] **Step 1: Create the component**

```tsx
// src/features/annotations/notebook/NotebookList.tsx
import type { Bookmark, Highlight, HighlightColor } from '@/domain/annotations/types';
import type { LocationAnchor } from '@/domain';
import { NotebookRow } from './NotebookRow';
import type { NotebookEntry } from './types';

type Props = {
  readonly entries: readonly NotebookEntry[];
  readonly nowMs?: number;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
  readonly onRemoveBookmark: (b: Bookmark) => void;
  readonly onRemoveHighlight: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly onSaveNote: (h: Highlight, content: string) => void;
};

export function NotebookList({
  entries,
  nowMs,
  onJumpToAnchor,
  onRemoveBookmark,
  onRemoveHighlight,
  onChangeColor,
  onSaveNote,
}: Props) {
  return (
    <ul className="notebook-list">
      {entries.map((entry) => (
        <NotebookRow
          key={entry.kind === 'bookmark' ? entry.bookmark.id : entry.highlight.id}
          entry={entry}
          nowMs={nowMs}
          onJumpToAnchor={onJumpToAnchor}
          onRemoveBookmark={onRemoveBookmark}
          onRemoveHighlight={onRemoveHighlight}
          onChangeColor={onChangeColor}
          onSaveNote={onSaveNote}
        />
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/annotations/notebook/NotebookList.tsx
git commit -m "feat(notebook): NotebookList — thin ul wrapper around NotebookRows"
```

---

### Task 18: `NotebookView` top-level page

**Files:**
- Create: `src/features/annotations/notebook/NotebookView.tsx`
- Create: `src/features/annotations/notebook/notebook-view.css`
- Create: `src/features/annotations/notebook/NotebookView.test.tsx`

> **Strategy:** Composes `useNotebook` + chrome + search bar + list/empty state. Routes its callbacks down. Layout: full-screen flex column on mobile, max-width centered on desktop.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/annotations/notebook/NotebookView.test.tsx
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NotebookView } from './NotebookView';
import { BookId, BookmarkId, HighlightId, IsoTimestamp } from '@/domain';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type { BookmarksRepository, HighlightsRepository, NotesRepository } from '@/storage';

afterEach(cleanup);

function fakeBookmarksRepo(initial: Bookmark[] = []): BookmarksRepository {
  return {
    add: vi.fn(() => Promise.resolve()),
    patch: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    listByBook: vi.fn(() => Promise.resolve(initial)),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}
function fakeHighlightsRepo(initial: Highlight[] = []): HighlightsRepository {
  return {
    add: vi.fn(() => Promise.resolve()),
    patch: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    listByBook: vi.fn(() => Promise.resolve(initial)),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}
function fakeNotesRepo(initial: Note[] = []): NotesRepository {
  return {
    upsert: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    listByBook: vi.fn(() => Promise.resolve(initial)),
    getByHighlight: vi.fn(() => Promise.resolve(null)),
    deleteByHighlight: vi.fn(() => Promise.resolve()),
    deleteByBook: vi.fn(() => Promise.resolve()),
  };
}

const NOW = '2026-05-04T12:00:00.000Z';
function bm(id: string, page: number, snippet: string): Bookmark {
  return {
    id: BookmarkId(id),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page },
    snippet,
    sectionTitle: null,
    createdAt: IsoTimestamp(NOW),
  };
}
function hl(id: string, page: number, selectedText: string): Highlight {
  return {
    id: HighlightId(id),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page, rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    selectedText,
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(NOW),
  };
}

function setup(opts: {
  bookmarks?: Bookmark[];
  highlights?: Highlight[];
  notes?: Note[];
  onBack?: () => void;
  onJumpToAnchor?: (anchor: import('@/domain').LocationAnchor) => void;
} = {}) {
  return render(
    <NotebookView
      bookId="b1"
      bookTitle="Test Book"
      bookmarksRepo={fakeBookmarksRepo(opts.bookmarks)}
      highlightsRepo={fakeHighlightsRepo(opts.highlights)}
      notesRepo={fakeNotesRepo(opts.notes)}
      onBack={opts.onBack ?? (() => undefined)}
      onJumpToAnchor={opts.onJumpToAnchor ?? (() => undefined)}
    />,
  );
}

describe('NotebookView', () => {
  it('renders chrome + search bar + empty state when no annotations', async () => {
    setup();
    expect(screen.getByText(/Notebook/)).toBeInTheDocument();
    expect(screen.getByText('Test Book')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/no annotations yet/i)).toBeInTheDocument();
    });
  });

  it('renders rows when annotations exist; renders no-matches when filter excludes', async () => {
    setup({
      bookmarks: [bm('b-1', 1, 'apple')],
      highlights: [hl('h-1', 2, 'banana')],
    });
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: /^notes$/i }));
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('back button calls onBack', () => {
    const onBack = vi.fn();
    setup({ onBack });
    fireEvent.click(screen.getByRole('button', { name: /back to reader/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('row content click calls onJumpToAnchor with projected LocationAnchor', async () => {
    const onJumpToAnchor = vi.fn();
    setup({ highlights: [hl('h-1', 7, 'x')], onJumpToAnchor });
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
    // The aria-label on the content button is the section title or 'Highlight' fallback
    fireEvent.click(screen.getByRole('button', { name: /^Highlight$/ }));
    expect(onJumpToAnchor).toHaveBeenCalledWith({ kind: 'pdf', page: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/annotations/notebook/NotebookView.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/annotations/notebook/NotebookView.tsx
import { BookId, type LocationAnchor } from '@/domain';
import type { BookmarksRepository, HighlightsRepository, NotesRepository } from '@/storage';
import { NotebookChrome } from './NotebookChrome';
import { NotebookSearchBar } from './NotebookSearchBar';
import { NotebookList } from './NotebookList';
import { NotebookEmptyState } from './NotebookEmptyState';
import { useNotebook } from './useNotebook';
import './notebook-view.css';

type Props = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
  readonly notesRepo: NotesRepository;
  readonly onBack: () => void;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
};

export function NotebookView(props: Props) {
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
          onRemoveBookmark={(b) => {
            void notebook.removeBookmark(b);
          }}
          onRemoveHighlight={(h) => {
            void notebook.removeHighlight(h);
          }}
          onChangeColor={(h, color) => {
            void notebook.changeColor(h, color);
          }}
          onSaveNote={(h, content) => {
            void notebook.saveNote(h, content);
          }}
        />
      )}
    </div>
  );
}
```

```css
/* src/features/annotations/notebook/notebook-view.css */
.notebook-view {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--color-bg);
}
.notebook-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  max-width: 720px;
  align-self: center;
}
@media (max-width: 720px) {
  .notebook-list {
    max-width: none;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/annotations/notebook/NotebookView.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/NotebookView.tsx src/features/annotations/notebook/notebook-view.css src/features/annotations/notebook/NotebookView.test.tsx
git commit -m "feat(notebook): NotebookView — composes chrome + search bar + list + empty state"
```

---

### Task 19: `ReaderChrome` — Notebook button

**Files:**
- Modify: `src/features/reader/ReaderChrome.tsx`
- Modify: `src/features/reader/reader-chrome.css`
- Modify: `src/features/reader/ReaderChrome.test.tsx`

> **Strategy:** New `onOpenNotebook` prop + button in the right action group. Button renders `<NotebookIcon />` + text "Notebook".

- [ ] **Step 1: Write the failing test**

Append to `src/features/reader/ReaderChrome.test.tsx`:

```tsx
describe('ReaderChrome — notebook button', () => {
  it('renders the Notebook button when onOpenNotebook is provided', () => {
    render(
      <ReaderChrome
        title="Test"
        onBack={() => undefined}
        onOpenToc={() => undefined}
        onOpenTypography={() => undefined}
        onToggleFocus={() => undefined}
        onAddBookmark={() => undefined}
        onOpenNotebook={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /open notebook/i })).toBeInTheDocument();
  });

  it('clicking notebook button calls onOpenNotebook', () => {
    const onOpenNotebook = vi.fn();
    render(
      <ReaderChrome
        title="Test"
        onBack={() => undefined}
        onOpenToc={() => undefined}
        onOpenTypography={() => undefined}
        onToggleFocus={() => undefined}
        onAddBookmark={() => undefined}
        onOpenNotebook={onOpenNotebook}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open notebook/i }));
    expect(onOpenNotebook).toHaveBeenCalled();
  });
});
```

(Verify the test file already imports `vi`, `fireEvent`, `screen`, `render`. If not, add them.)

- [ ] **Step 2: Edit `src/features/reader/ReaderChrome.tsx`**

Add the import:

```ts
import { NotebookIcon } from '@/shared/icons';
```

Update Props (add `onOpenNotebook`):

```ts
type Props = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly onOpenToc: () => void;
  readonly onOpenTypography: () => void;
  readonly onToggleFocus: () => void;
  readonly onAddBookmark: () => void;
  readonly onOpenNotebook: () => void;
  readonly showTocButton?: boolean;
  readonly showFocusToggle?: boolean;
  readonly focusMode?: 'normal' | 'focus';
};
```

Update destructuring:

```ts
export function ReaderChrome({
  title,
  subtitle,
  onBack,
  onOpenToc,
  onOpenTypography,
  onToggleFocus,
  onAddBookmark,
  onOpenNotebook,
  showTocButton = true,
  showFocusToggle = false,
  focusMode = 'normal',
}: Props) {
```

Insert the Notebook button into the action group, between the bookmark and TOC buttons. Find:

```tsx
        <button
          type="button"
          onClick={handleAddBookmark}
          aria-label="Add bookmark"
          className={
            pulsing
              ? 'reader-chrome__bookmark reader-chrome__bookmark--pulse'
              : 'reader-chrome__bookmark'
          }
          title="Bookmark this spot"
        >
          ★
        </button>
        {showTocButton ? (
```

Replace with:

```tsx
        <button
          type="button"
          onClick={handleAddBookmark}
          aria-label="Add bookmark"
          className={
            pulsing
              ? 'reader-chrome__bookmark reader-chrome__bookmark--pulse'
              : 'reader-chrome__bookmark'
          }
          title="Bookmark this spot"
        >
          ★
        </button>
        <button
          type="button"
          className="reader-chrome__notebook"
          onClick={onOpenNotebook}
          aria-label="Open notebook"
          title="Open notebook"
        >
          <NotebookIcon />
          <span className="reader-chrome__notebook-label">Notebook</span>
        </button>
        {showTocButton ? (
```

- [ ] **Step 3: Edit `src/features/reader/reader-chrome.css`**

Append:

```css
.reader-chrome__notebook {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 0;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
}
.reader-chrome__notebook:hover {
  background: var(--color-surface-hover, var(--color-surface));
}
@media (max-width: 480px) {
  .reader-chrome__notebook-label {
    display: none;
  }
}
```

- [ ] **Step 4: Run chrome tests**

Run: `pnpm test --run src/features/reader/ReaderChrome.test.tsx`
Expected: PASS — existing + 2 new tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: FAIL — `ReaderWorkspace`/`App.tsx` consumers don't yet pass `onOpenNotebook`. We fix in Task 20. Skip type-check assertion here; bundle Tasks 19 + 20 if you want a clean boundary.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/ReaderChrome.tsx src/features/reader/reader-chrome.css src/features/reader/ReaderChrome.test.tsx
git commit -m "feat(reader): ReaderChrome — Notebook button (NotebookIcon + label)"
```

---

### Task 20: Workspace + App.tsx — wire `onOpenNotebook`, `pendingAnchor`, third view branch

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx`
- Modify: `src/features/reader/workspace/ReaderWorkspace.test.tsx`
- Modify: `src/app/App.tsx`

> **Strategy:** `ReaderWorkspace` accepts `onOpenNotebook` and passes it to `ReaderChrome`. `App.tsx`:
> 1. Adds the third branch for `view.kind === 'notebook'`.
> 2. Wraps `reader.loadBookForReader` so it consumes `view.consumePendingAnchor()` and overrides `initialAnchor`.
> 3. Passes `onOpenNotebook={() => view.goNotebook(book.id)}` to `ReaderWorkspace`.

- [ ] **Step 1: Edit `src/features/reader/workspace/ReaderWorkspace.tsx`**

Add `onOpenNotebook` to `Props`. Find the existing Props and add:

```ts
  readonly onOpenNotebook: () => void;
```

Update the destructuring or props usage to include it. The simplest is `props.onOpenNotebook`. Find the `ReaderChrome` render:

```tsx
        <ReaderChrome
          title={props.bookTitle}
          {...(props.bookSubtitle !== undefined && { subtitle: props.bookSubtitle })}
          onBack={props.onBack}
          onOpenToc={() => {
            setActiveSheet('toc');
          }}
          onOpenTypography={() => {
            setActiveSheet('typography');
          }}
          onToggleFocus={() => {
            focus.toggle();
          }}
          onAddBookmark={handleAddBookmark}
          showTocButton={!isDesktop}
          showFocusToggle={isDesktop}
          focusMode={focus.mode}
        />
```

Replace with:

```tsx
        <ReaderChrome
          title={props.bookTitle}
          {...(props.bookSubtitle !== undefined && { subtitle: props.bookSubtitle })}
          onBack={props.onBack}
          onOpenToc={() => {
            setActiveSheet('toc');
          }}
          onOpenTypography={() => {
            setActiveSheet('typography');
          }}
          onToggleFocus={() => {
            focus.toggle();
          }}
          onAddBookmark={handleAddBookmark}
          onOpenNotebook={props.onOpenNotebook}
          showTocButton={!isDesktop}
          showFocusToggle={isDesktop}
          focusMode={focus.mode}
        />
```

- [ ] **Step 2: Edit `src/features/reader/workspace/ReaderWorkspace.test.tsx`**

Add `onOpenNotebook` to the test's `baseProps`:

```ts
  bookmarksRepo: fakeBookmarksRepo,
  highlightsRepo: fakeHighlightsRepo,
  notesRepo: fakeNotesRepo,
  onOpenNotebook: () => undefined,
};
```

- [ ] **Step 3: Edit `src/app/App.tsx`**

Add the import:

```ts
import { NotebookView } from '@/features/annotations/notebook/NotebookView';
```

Wrap `loadBookForReader` to consume `pendingAnchor`. Find:

```tsx
        <ReaderWorkspace
          key={view.current.bookId}
          bookId={view.current.bookId}
          bookTitle={book.title}
          bookFormat={book.format}
          {...(book.author !== undefined && { bookSubtitle: book.author })}
          onBack={view.goLibrary}
          loadBookForReader={reader.loadBookForReader}
          createAdapter={reader.createAdapter}
          onAnchorChange={reader.onAnchorChange}
          onPreferencesChange={reader.onPreferencesChange}
          initialFocusMode={reader.initialFocusMode}
          hasShownFirstTimeHint={reader.hasShownFirstTimeHint}
          onFocusModeChange={reader.onFocusModeChange}
          onFirstTimeHintShown={reader.onFirstTimeHintShown}
          bookmarksRepo={reader.bookmarksRepo}
          highlightsRepo={reader.highlightsRepo}
          notesRepo={reader.notesRepo}
        />
```

Replace with:

```tsx
        <ReaderWorkspace
          key={view.current.bookId}
          bookId={view.current.bookId}
          bookTitle={book.title}
          bookFormat={book.format}
          {...(book.author !== undefined && { bookSubtitle: book.author })}
          onBack={view.goLibrary}
          loadBookForReader={async (bookId) => {
            const result = await reader.loadBookForReader(bookId);
            const pending = view.consumePendingAnchor();
            return pending ? { ...result, initialAnchor: pending } : result;
          }}
          createAdapter={reader.createAdapter}
          onAnchorChange={reader.onAnchorChange}
          onPreferencesChange={reader.onPreferencesChange}
          initialFocusMode={reader.initialFocusMode}
          hasShownFirstTimeHint={reader.hasShownFirstTimeHint}
          onFocusModeChange={reader.onFocusModeChange}
          onFirstTimeHintShown={reader.onFirstTimeHintShown}
          bookmarksRepo={reader.bookmarksRepo}
          highlightsRepo={reader.highlightsRepo}
          notesRepo={reader.notesRepo}
          onOpenNotebook={() => {
            view.goNotebook(book.id);
          }}
        />
```

Add the third branch BEFORE the `view.current.kind === 'reader'` branch (so the order matches the AppView union — library, reader, notebook). Find:

```tsx
  if (view.current.kind === 'reader') {
```

Insert directly above:

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
          onBack={() => {
            view.goReader(book);
          }}
          onJumpToAnchor={(anchor) => {
            view.goReaderAt(book.id, anchor);
          }}
        />
      </div>
    );
  }

```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm test --run \
  src/features/reader/workspace/ReaderWorkspace.test.tsx \
  src/features/reader/ReaderChrome.test.tsx \
  src/app/useAppView.test.ts \
  src/app/useReaderHost.test.ts
```

Expected: PASS — all.

- [ ] **Step 5: Type-check + build**

Run: `pnpm type-check && pnpm build`
Expected: clean. The notebook view + chrome button are now fully wired.

- [ ] **Step 6: Manual smoke (~5 minutes)**

```bash
pnpm dev
```

In `http://localhost:5173`:
1. Open a book → reader chrome shows a "Notebook" button → click it → notebook opens.
2. Notebook header shows "Notebook · {book title}" and a back button labelled "Reader".
3. Add a bookmark/highlight/note in the reader, then re-enter the notebook → all three appear as one row each (highlight + note inline).
4. Click the search input → ⌘K from anywhere → focuses input. Type a word that appears in only one row → only that row shows.
5. Click "Bookmarks" chip → only bookmark rows. "Notes" → only highlight-with-note rows.
6. Click on a row's content area → notebook closes, reader opens at that anchor.
7. Click delete (×) on a bookmark → row removed instantly. Reload → still removed.
8. Click 📝-icon button on a highlight → editor opens inline; type + click outside → note saved + visible.
9. Reload while in notebook → notebook view persists.
10. Back to library → remove the book → re-import → notebook is empty.

If anything breaks, fix and re-test before committing.

- [ ] **Step 7: Commit**

```bash
git add src/features/reader/workspace/ReaderWorkspace.tsx src/features/reader/workspace/ReaderWorkspace.test.tsx src/app/App.tsx
git commit -m "feat(app): wire notebook view — App.tsx third branch + pendingAnchor consumption + chrome button"
```

---

### Task 21: E2E — `notebook-open-from-reader.spec.ts`

**Files:**
- Create: `e2e/notebook-open-from-reader.spec.ts`

> **Strategy:** Smoke flow: open EPUB → create one of each annotation → click Notebook → verify rows → reload preserves the notebook view.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

async function selectVisibleText(page: Page): Promise<void> {
  await page
    .locator('iframe')
    .first()
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      const win = document.defaultView!;
      const allText: Text[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 5) {
          allText.push(node as Text);
        }
        for (const child of Array.from(node.childNodes)) walk(child);
      };
      walk(body);
      const visible = allText.find((t) => {
        const r = document.createRange();
        r.selectNodeContents(t);
        const rect = r.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= win.innerWidth &&
          rect.top >= 0 &&
          rect.top <= win.innerHeight
        );
      });
      if (!visible) throw new Error('No visible text node found');
      const range = document.createRange();
      const text = visible.textContent;
      range.setStart(visible, 0);
      range.setEnd(visible, Math.min(text.length, 30));
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  await page.waitForTimeout(300);
}

test('open notebook from reader → see rows → reload persists', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Add a bookmark.
  await page.getByRole('button', { name: 'Add bookmark' }).click();

  // Add a highlight + note.
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);

  await selectVisibleText(page);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'Add note' }).click();
  await page.locator('.note-editor textarea').fill('a thought');
  await page.locator('body').click({ position: { x: 10, y: 10 } });

  // Open notebook.
  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.getByRole('button', { name: /back to reader/i })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('.notebook-row')).toHaveCount(2);
  await expect(page.locator('.notebook-row__type').filter({ hasText: 'BOOKMARK' })).toBeVisible();
  await expect(page.locator('.notebook-row__type').filter({ hasText: 'NOTE' })).toBeVisible();

  // Reload — notebook view persists.
  await page.reload();
  await expect(page.getByRole('button', { name: /back to reader/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.notebook-row')).toHaveCount(2);
});
```

- [ ] **Step 2: Run spec**

Run: `pnpm build && pnpm exec playwright test e2e/notebook-open-from-reader.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notebook-open-from-reader.spec.ts
git commit -m "test(e2e): notebook — open from reader, see rows, reload persists"
```

---

### Task 22: E2E — `notebook-search-filter.spec.ts`

**Files:**
- Create: `e2e/notebook-search-filter.spec.ts`

> **Strategy:** Open notebook with mixed annotations → exercise search + each chip.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

async function selectVisibleText(page: Page): Promise<void> {
  await page
    .locator('iframe')
    .first()
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      const win = document.defaultView!;
      const allText: Text[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 5) {
          allText.push(node as Text);
        }
        for (const child of Array.from(node.childNodes)) walk(child);
      };
      walk(body);
      const visible = allText.find((t) => {
        const r = document.createRange();
        r.selectNodeContents(t);
        const rect = r.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= win.innerWidth &&
          rect.top >= 0 &&
          rect.top <= win.innerHeight
        );
      });
      if (!visible) throw new Error('No visible text node found');
      const range = document.createRange();
      const text = visible.textContent;
      range.setStart(visible, 0);
      range.setEnd(visible, Math.min(text.length, 30));
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  await page.waitForTimeout(300);
}

test('search + filter chips narrow the notebook list', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // bookmark
  await page.getByRole('button', { name: 'Add bookmark' }).click();

  // highlight without note
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);
  await selectVisibleText(page);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();
  await page.waitForTimeout(300);

  // highlight with note (different selection — re-select)
  await selectVisibleText(page);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'Add note' }).click();
  await page.locator('.note-editor textarea').fill('Bingley analysis');
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(3);

  // Filter: Bookmarks
  await page.getByRole('button', { name: /^bookmarks$/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);
  await expect(page.locator('.notebook-row__type')).toHaveText('BOOKMARK');

  // Filter: Notes
  await page.getByRole('button', { name: /^notes$/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);
  await expect(page.locator('.notebook-row__type')).toHaveText('NOTE');

  // Filter: All + search
  await page.getByRole('button', { name: /^all$/i }).click();
  await page.getByRole('searchbox').fill('Bingley');
  await page.waitForTimeout(250);
  await expect(page.locator('.notebook-row')).toHaveCount(1);
  await expect(page.locator('.notebook-row__note-line')).toContainText('Bingley');

  // Clear search
  await page.getByRole('searchbox').fill('');
  await page.waitForTimeout(250);
  await expect(page.locator('.notebook-row')).toHaveCount(3);
});
```

- [ ] **Step 2: Run spec**

Run: `pnpm exec playwright test e2e/notebook-search-filter.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notebook-search-filter.spec.ts
git commit -m "test(e2e): notebook — search + filter chips correctly narrow list"
```

---

### Task 23: E2E — `notebook-jump-back-to-reader.spec.ts`

**Files:**
- Create: `e2e/notebook-jump-back-to-reader.spec.ts`

> **Strategy:** Open notebook → click highlight row's content → reader opens at the anchor (the highlight overlay should be visible after navigation).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

async function selectVisibleText(page: Page): Promise<void> {
  await page
    .locator('iframe')
    .first()
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      const win = document.defaultView!;
      const allText: Text[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 5) {
          allText.push(node as Text);
        }
        for (const child of Array.from(node.childNodes)) walk(child);
      };
      walk(body);
      const visible = allText.find((t) => {
        const r = document.createRange();
        r.selectNodeContents(t);
        const rect = r.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= win.innerWidth &&
          rect.top >= 0 &&
          rect.top <= win.innerHeight
        );
      });
      if (!visible) throw new Error('No visible text node found');
      const range = document.createRange();
      const text = visible.textContent;
      range.setStart(visible, 0);
      range.setEnd(visible, Math.min(text.length, 30));
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  await page.waitForTimeout(300);
}

test('clicking a notebook row jumps the reader to that anchor', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);

  await selectVisibleText(page);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();
  await page.waitForTimeout(300);

  // Navigate to a different chapter so the jump is observable.
  await tocEntries.nth(0).click();
  await page.waitForTimeout(500);

  // Open notebook.
  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);

  // Click the row content.
  await page.locator('.notebook-row__content').click();

  // Reader opened.
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 5000,
  });
});
```

- [ ] **Step 2: Run spec**

Run: `pnpm exec playwright test e2e/notebook-jump-back-to-reader.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notebook-jump-back-to-reader.spec.ts
git commit -m "test(e2e): notebook — clicking a row jumps the reader to that anchor"
```

---

### Task 24: E2E — `notebook-edit-inline.spec.ts`

**Files:**
- Create: `e2e/notebook-edit-inline.spec.ts`

> **Strategy:** Open notebook → edit a note inline + delete a bookmark → verify changes persist.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

async function selectVisibleText(page: Page): Promise<void> {
  await page
    .locator('iframe')
    .first()
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      const win = document.defaultView!;
      const allText: Text[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 5) {
          allText.push(node as Text);
        }
        for (const child of Array.from(node.childNodes)) walk(child);
      };
      walk(body);
      const visible = allText.find((t) => {
        const r = document.createRange();
        r.selectNodeContents(t);
        const rect = r.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= win.innerWidth &&
          rect.top >= 0 &&
          rect.top <= win.innerHeight
        );
      });
      if (!visible) throw new Error('No visible text node found');
      const range = document.createRange();
      const text = visible.textContent;
      range.setStart(visible, 0);
      range.setEnd(visible, Math.min(text.length, 30));
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  await page.waitForTimeout(300);
}

test('notebook supports inline note edit + bookmark delete', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // 1 bookmark + 1 plain highlight
  await page.getByRole('button', { name: 'Add bookmark' }).click();
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);
  await selectVisibleText(page);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(2);

  // Add a note inline on the highlight row.
  await page.getByRole('button', { name: /add note/i }).first().click();
  await page.locator('.note-editor textarea').fill('inline thought');
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.notebook-row__note-line')).toContainText('inline thought');

  // Delete the bookmark inline.
  await page.getByRole('button', { name: /remove bookmark/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);

  // Reload — both changes persisted.
  await page.reload();
  await expect(page.getByRole('button', { name: /back to reader/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.notebook-row')).toHaveCount(1);
  await expect(page.locator('.notebook-row__note-line')).toContainText('inline thought');
});
```

- [ ] **Step 2: Run spec**

Run: `pnpm exec playwright test e2e/notebook-edit-inline.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notebook-edit-inline.spec.ts
git commit -m "test(e2e): notebook — inline note edit + bookmark delete persist"
```

---

### Task 25: E2E — `notebook-empty-states.spec.ts`

**Files:**
- Create: `e2e/notebook-empty-states.spec.ts`

> **Strategy:** Open notebook on a fresh book (no annotations) → "no annotations yet" copy. Add one bookmark, return to notebook, search for non-matching text → "no matches" copy.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

test('notebook empty states: no-entries and no-matches', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // No annotations → "no annotations yet"
  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.getByText(/no annotations yet/i)).toBeVisible();

  // Back to reader, add a bookmark, re-enter notebook.
  await page.getByRole('button', { name: /back to reader/i }).click();
  await page.getByRole('button', { name: 'Add bookmark' }).click();
  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);

  // Search for non-matching text → "no matches"
  await page.getByRole('searchbox').fill('zzzzz-no-match');
  await page.waitForTimeout(250);
  await expect(page.getByText(/no matches/i)).toBeVisible();
});
```

- [ ] **Step 2: Run spec**

Run: `pnpm exec playwright test e2e/notebook-empty-states.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notebook-empty-states.spec.ts
git commit -m "test(e2e): notebook — no-entries + no-matches empty states"
```

---

### Task 26: E2E — `notebook-icons.spec.ts`

**Files:**
- Create: `e2e/notebook-icons.spec.ts`

> **Strategy:** Verify the new SVG icons rendered (no literal 📝 emoji in toolbar/panel/chrome).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

async function selectVisibleText(page: Page): Promise<void> {
  await page
    .locator('iframe')
    .first()
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      const win = document.defaultView!;
      const allText: Text[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 5) {
          allText.push(node as Text);
        }
        for (const child of Array.from(node.childNodes)) walk(child);
      };
      walk(body);
      const visible = allText.find((t) => {
        const r = document.createRange();
        r.selectNodeContents(t);
        const rect = r.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= win.innerWidth &&
          rect.top >= 0 &&
          rect.top <= win.innerHeight
        );
      });
      if (!visible) throw new Error('No visible text node found');
      const range = document.createRange();
      const text = visible.textContent;
      range.setStart(visible, 0);
      range.setEnd(visible, Math.min(text.length, 30));
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  await page.waitForTimeout(300);
}

test('icons: chrome notebook button + toolbar/panel note buttons render SVGs (no 📝 emoji)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Chrome notebook button has an SVG.
  const notebookBtn = page.getByRole('button', { name: /open notebook/i });
  await expect(notebookBtn.locator('svg.icon')).toHaveCount(1);
  expect((await notebookBtn.textContent()) ?? '').not.toContain('📝');
  expect((await notebookBtn.textContent()) ?? '').not.toContain('📓');

  // Selection toolbar's note button has an SVG.
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);
  await selectVisibleText(page);
  const toolbarNoteBtn = page.locator('.highlight-toolbar').getByRole('button', { name: /add note/i });
  await expect(toolbarNoteBtn.locator('svg.icon')).toHaveCount(1);
  expect((await toolbarNoteBtn.textContent()) ?? '').not.toContain('📝');

  // Create a highlight so the highlights panel row exists.
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();

  await page.getByRole('tab', { name: /highlights/i }).click();
  const panelNoteBtn = page.getByRole('button', { name: /add note/i }).first();
  await expect(panelNoteBtn.locator('svg.icon')).toHaveCount(1);
  expect((await panelNoteBtn.textContent()) ?? '').not.toContain('📝');
});
```

- [ ] **Step 2: Run spec**

Run: `pnpm exec playwright test e2e/notebook-icons.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notebook-icons.spec.ts
git commit -m "test(e2e): notebook — chrome + toolbar + panel note buttons render SVGs (no 📝)"
```

---

### Task 27: E2E — `notebook-cascade-on-book-remove.spec.ts`

**Files:**
- Create: `e2e/notebook-cascade-on-book-remove.spec.ts`

> **Strategy:** Open notebook with annotations → return to library → remove the book → re-import → notebook is empty.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

test('removing the book empties the notebook on re-import', async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: 'open' });
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Add bookmark' }).click();
  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.locator('.notebook-row')).toHaveCount(1);

  // Back to reader, then back to library.
  await page.getByRole('button', { name: /back to reader/i }).click();
  await page.getByRole('button', { name: /back to library/i }).click();

  // Remove the book.
  const cards = page.locator('[data-book-id]');
  await expect(cards).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Book actions' }).first().click();
  await page.getByRole('menuitem', { name: /remove from library/i }).click();
  await expect(cards).toHaveCount(0);

  // Re-import — fresh book, empty notebook.
  await importFixture(page);
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /open notebook/i }).click();
  await expect(page.getByText(/no annotations yet/i)).toBeVisible();
});
```

- [ ] **Step 2: Run spec**

Run: `pnpm exec playwright test e2e/notebook-cascade-on-book-remove.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notebook-cascade-on-book-remove.spec.ts
git commit -m "test(e2e): notebook — book removal empties notebook on re-import"
```

---

### Task 28: Docs — architecture decision + roadmap status

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Edit `docs/02-system-architecture.md`**

Find the existing decision history header:

```md
## Decision history
### 2026-05-04 — Phase 3.3 notes
```

Insert above the 3.3 entry:

```md
## Decision history
### 2026-05-04 — Phase 3.4 annotation notebook

- New `AppView` kind `'notebook'` (additive union expansion; no DB
  migration). `isValidView` accepts the same shape as `'reader'`. Old
  persisted records still narrow correctly.
- New per-book full-screen view at `src/features/annotations/notebook/`.
  Composes the three existing repos (`bookmarks`, `highlights`, `notes`)
  directly; does not reuse `useBookmarks`/`useHighlights`/`useNotes`
  because those bind to the reader engine. Optimistic CRUD with rollback
  mirrors the per-type hook pattern.
- Pure helpers (`compareNotebookEntries`, `matchesFilter`,
  `matchesQuery`) are independently tested and live next to the hook.
- `NotebookEntry` is a UI-layer discriminated union (`'bookmark'` |
  `'highlight'`-with-optional-note). Notes never appear as standalone
  entries; they're attached to their parent highlight per the v1 data
  model from 3.3.
- Sort: book order across types. EPUB CFIs lex-compared; PDF anchors
  ordered by `(page, y, x)`. Mixed-kind comparisons fall back to
  `createdAt`.
- `useAppView` gains `goNotebook(bookId)`, `goReaderAt(bookId, anchor)`,
  and `consumePendingAnchor()`. `pendingAnchor` is a one-shot ref read on
  the next reader mount via a wrapped `loadBookForReader`. Auto-clears
  whenever `setView` targets a non-reader view.
- `useReaderHost.onBookRemovedWhileInReader` renamed to
  `onBookRemovedFromActiveView` and now fires when the active view is
  reader OR notebook for the removed book.
- New `src/shared/icons/` module: hand-authored monochrome SVG line
  icons (`NotebookIcon`, `NoteIcon`, `ArrowLeftIcon`), 16px default,
  1.5px stroke, `currentColor`. Replaces the 📝 emoji in
  `HighlightToolbar` and `HighlightsPanel` — first step of standardizing
  on SVG icons across the chrome/toolbar surfaces. No external icon
  library; ~30 LoC per icon.

### 2026-05-04 — Phase 3.3 notes
```

- [ ] **Step 2: Edit `docs/04-implementation-roadmap.md`**

Find:

```md
- Phase 3 — in progress (Tasks 3.1 + 3.2 complete 2026-05-03; Task 3.3 complete 2026-05-04; 3.4 pending)
```

Replace with:

```md
- Phase 3 — complete (2026-05-04)
```

- [ ] **Step 3: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: Phase 3.4 architecture decision + Phase 3 complete in roadmap status"
```

---

### Task 29: Final verification + open PR

**Files:** none

- [ ] **Step 1: Type-check, lint, unit, build**

Run:

```bash
pnpm check && pnpm build
```

Expected: all clean.

- [ ] **Step 2: Full E2E**

Run:

```bash
pnpm exec playwright test
```

Expected: all pass — the 39 specs from Phase 3.3 + 7 new notebook specs = 46.

- [ ] **Step 3: Manual smoke (~10 minutes)**

```bash
pnpm dev
```

In `http://localhost:5173`:
1. Open a book → reader chrome shows "Notebook" button (SVG + label) → click → notebook opens.
2. Notebook: chrome shows "← Reader" + "Notebook · Book Title". Search bar present. Filter chips: All / Bookmarks / Highlights / Notes.
3. Empty book → "No annotations yet" copy + hint visible.
4. Add a bookmark, highlight (yellow), highlight + note → return to notebook → 3 rows. Highlight-with-note row shows "NOTE" eyebrow tag + inline note text.
5. Search: type a substring matching one row → only that row visible. Cmd/Ctrl+K from outside the search input focuses it.
6. Filter chips: each chip narrows the list correctly. Empty results → "No matches" copy.
7. Click a row's content area → notebook closes, reader opens at that anchor (highlight overlay visible).
8. Navigate to reader → click Notebook again → still works; entries refresh.
9. Inline edits: delete bookmark, edit note (inline `NoteEditor`), change highlight color → all persist on reload.
10. Reload while in notebook → notebook view restored.
11. Back to library → remove the book → re-import → notebook is empty.
12. Mobile (390×844 in DevTools): notebook layout full-screen; chip bar wraps if needed; rows readable.
13. No literal 📝 emoji visible anywhere (toolbar + panel + chrome all use SVGs).

Per the debugging memory: stop after fix #2 fails, instrument before guessing #3; check user-environment amplifiers (extensions, dev-vs-prod) early.

- [ ] **Step 4: Push branch**

```bash
git push -u origin phase-3-4-notebook
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "Phase 3.4: Annotation notebook" --body "$(cat <<'EOF'
## Summary
- New \`AppView\` kind \`'notebook'\` (additive — no DB migration). New per-book full-screen view at \`src/features/annotations/notebook/\`. Reader chrome gains a "Notebook" button (SVG + label).
- \`useNotebook(bookId)\` composes the three existing repos directly; optimistic CRUD (delete bookmark, edit note via existing \`NoteEditor\`, change highlight color, delete highlight) with rollback. Click row content → notebook closes, reader opens at the projected \`LocationAnchor\` via a one-shot \`pendingAnchor\` consumed by a wrapped \`loadBookForReader\`.
- Live debounced substring search (~150ms) across snippet, section title, and note content. Single-select chip filter \`[All / Bookmarks / Highlights / Notes]\`. Empty states: \`'no-entries'\` and \`'no-matches'\`.
- New \`src/shared/icons/\` module (\`NotebookIcon\`, \`NoteIcon\`, \`ArrowLeftIcon\`) — hand-authored monochrome SVGs. Replaces the 📝 emoji in \`HighlightToolbar\` and \`HighlightsPanel\` as the start of a consistent professional icon system.
- \`useAppView\` adds \`goNotebook\`, \`goReaderAt\`, \`consumePendingAnchor\`. \`useReaderHost.onBookRemovedWhileInReader\` renamed to \`onBookRemovedFromActiveView\` (fires for reader OR notebook view).

## Test plan
- [x] Type-check + lint + build clean
- [x] ~70 new unit tests pass (NotebookEntry types, sort/filter/search helpers, useNotebook hook, NotebookView/Row/Chrome/SearchBar/EmptyState, icons, settings validator, useAppView, useReaderHost rename)
- [x] 7 new E2E specs pass: \`notebook-open-from-reader\`, \`notebook-search-filter\`, \`notebook-jump-back-to-reader\`, \`notebook-edit-inline\`, \`notebook-empty-states\`, \`notebook-icons\`, \`notebook-cascade-on-book-remove\`
- [x] Manual smoke: chrome button → notebook → search/filter → row click jumps reader → inline edits persist → reload restores view → cascade on book removal → mobile layout

## Design + plan
- Spec: \`docs/superpowers/specs/2026-05-04-phase-3-4-notebook-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-04-phase-3-4-notebook.md\`
- Architecture entry: \`docs/02-system-architecture.md\` (Phase 3.4 decision)
- Roadmap: Phase 3 complete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: returns the PR URL.

---

## Self-review checklist

**Spec coverage:**
- §1 Goal & scope → Tasks 1–29.
- §2 Decisions → reflected in implementation choices throughout.
- §3 Architecture → matches the file map (Tasks 1, 9, 18, 20).
- §4 Domain, types & storage → Tasks 1 (types), 2 (AppView extension + validator), 3 (view helper).
- §5 UI surface → Tasks 10 (icons), 11+12 (emoji replacement), 13 (empty state), 14 (chrome), 15 (search bar), 16 (row), 17 (list), 18 (view), 19 (chrome button), 20 (App.tsx wiring).
- §6 Data flow & error handling → Task 9 (`useNotebook` rollback paths), Task 20 (workspace + App wiring), Task 5 (cascade rename + extension).
- §7 Testing — every test row appears in a corresponding task (unit) or in Tasks 21–27 (E2E).
- §8 File map — every file has a creating/modifying task.
- §9 Migration & compatibility → Task 2 (additive AppView), Task 5 (rename), Task 11+12 (emoji swap).
- §10 Risks — covered: pendingAnchor clearing (Task 4), rename (Task 5), icon replacement (Tasks 11+12+26).
- §11 Acceptance criteria — every criterion (1–14) is exercised by either a unit test or one of the 7 E2E specs.

**Type consistency:**
- `NotebookEntry`, `NotebookFilter` — defined Task 1; used in Tasks 6, 7, 8, 9, 13, 14, 15, 16, 17, 18.
- `compareNotebookEntries`, `matchesFilter`, `matchesQuery` — defined Tasks 6, 7, 8; used in Task 9.
- `UseNotebookHandle` — defined Task 9; used in Task 18.
- `useAppView` new methods (`goNotebook`, `goReaderAt`, `consumePendingAnchor`) — defined Task 4; consumed in Task 20 (App.tsx).
- `onBookRemovedFromActiveView` — renamed Task 5; consumed in Task 5 (App.tsx update part of same commit).
- `onOpenNotebook` prop — defined Task 19 (`ReaderChrome`); consumed Task 20 (`ReaderWorkspace` + App.tsx).
- Icons — defined Task 10; consumed Tasks 11, 12, 14, 19.
- `NotebookView` props — defined Task 18; consumed Task 20 (App.tsx third branch).
- `AppView` `'notebook'` variant — defined Task 2; consumed Tasks 3, 4, 5, 20.

**Placeholder scan:** no `TBD`/`TODO`/`fill in details` in the plan body. Each step has either a code block or an exact command + expected outcome. The "decide based on review style" notes in Tasks 4 and 19 are *intentional* reviewer-style choices (whether to bundle commits for clean type-check boundaries), not missing implementation — both alternatives spelled out.
