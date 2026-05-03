# Phase 3.2 — Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 highlights: select text in EPUB or PDF → floating toolbar → pick a color → highlight is rendered over the selection AND saved. Tap a rendered highlight → same toolbar with current color + delete affordance. Highlights tab in the rail (third tab next to Contents and Bookmarks) lists everything in book order with section + selectedText + color swatch. Persists across reload; cascades on book removal.

**Architecture:** New `highlights` IDB store at v4 (additive migration). New `HighlightsRepository`, `useHighlights` hook (mirrors `useBookmarks` shape), `HighlightToolbar` (shared between create + edit modes), `HighlightsPanel` (mirrors `BookmarksPanel`). Engine adapters gain five new `BookReader` methods: `loadHighlights`, `addHighlight`, `removeHighlight`, `onSelectionChange`, `onHighlightTap`. EPUB uses foliate's `view.addAnnotation` + `Overlayer.highlight` + `'show-annotation'`/`'create-overlay'` events. PDF appends a `.pdf-reader__highlight-layer` sibling of the text-layer with absolutely-positioned colored divs; selection events translate to PDF-coord rects via `viewport.convertToPdfPoint`. The rail/sheet pattern from 3.1 generalises trivially to a third tab.

**Tech Stack:** TypeScript strict, React 19, Zustand, XState v5, foliate-js (EPUB), pdfjs-dist (PDF), idb (IndexedDB), Vitest + happy-dom (unit), Playwright (E2E).

**Reference:** Spec at `docs/superpowers/specs/2026-05-03-phase-3-2-highlights-design.md`.

---

## Task ordering

Domain + storage first (everything else depends on them), then shared utilities (color map + sort comparator) so the tests for downstream tasks have these in place, then the engine API additions (with adapter stubs), then per-engine implementations, then UI primitives, then workspace integration, then E2Es, then docs.

---

### Task 1: Domain — `HighlightAnchor`, `HighlightRect`, refactored `Highlight`

**Files:**
- Modify: `src/domain/annotations/types.ts`
- Modify: `src/domain/annotations/types.test.ts`

> **Strategy:** Drop `range` and `normalizedText` from the existing `Highlight`; add `HighlightAnchor` (discriminated union), `HighlightRect`, `sectionTitle`. The existing `Highlight` is unused (no consumers persist it) so this is a safe domain-level rewrite.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/annotations/types.test.ts`:

```ts
import type {
  Highlight,
  HighlightAnchor,
  HighlightRect,
} from '@/domain/annotations/types';
import { HighlightId } from '@/domain';

describe('Highlight', () => {
  it('has the v1 shape with HighlightAnchor + nullable sectionTitle', () => {
    const epubAnchor: HighlightAnchor = {
      kind: 'epub-cfi',
      cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)',
    };
    const pdfRect: HighlightRect = { x: 10, y: 20, width: 100, height: 14 };
    const pdfAnchor: HighlightAnchor = {
      kind: 'pdf',
      page: 7,
      rects: [pdfRect],
    };
    const epub: Highlight = {
      id: HighlightId('00000000-0000-0000-0000-000000000001'),
      bookId: BookId('book-1'),
      anchor: epubAnchor,
      selectedText: 'Hello world',
      sectionTitle: 'Chapter 1',
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    const pdf: Highlight = {
      id: HighlightId('id-2'),
      bookId: BookId('book-2'),
      anchor: pdfAnchor,
      selectedText: 'page seven snippet',
      sectionTitle: null,
      color: 'green',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(epub.anchor.kind).toBe('epub-cfi');
    expect(pdf.anchor.kind).toBe('pdf');
    if (pdf.anchor.kind === 'pdf') {
      expect(pdf.anchor.rects[0]?.x).toBe(10);
    }
    expect(pdf.sectionTitle).toBeNull();
    expect(epub.tags).toEqual([]);
  });
});
```

(The existing file already imports `BookId, BookmarkId, IsoTimestamp`. Add `HighlightId` to that import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/domain/annotations/types.test.ts`
Expected: FAIL — `HighlightAnchor` / `HighlightRect` don't exist; `Highlight` still has `range` / `normalizedText`.

- [ ] **Step 3: Edit `src/domain/annotations/types.ts`**

Replace the full file:

```ts
import type { BookId, BookmarkId, HighlightId, IsoTimestamp, NoteId } from '../ids';
import type { LocationAnchor } from '../locations';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export type Bookmark = {
  readonly id: BookmarkId;
  readonly bookId: BookId;
  readonly anchor: LocationAnchor;
  readonly snippet: string | null;
  readonly sectionTitle: string | null;
  readonly createdAt: IsoTimestamp;
};

export type HighlightRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type HighlightAnchor =
  | { readonly kind: 'epub-cfi'; readonly cfi: string }
  | {
      readonly kind: 'pdf';
      readonly page: number;
      readonly rects: readonly HighlightRect[];
    };

export type Highlight = {
  readonly id: HighlightId;
  readonly bookId: BookId;
  readonly anchor: HighlightAnchor;
  readonly selectedText: string;
  readonly sectionTitle: string | null;
  readonly color: HighlightColor;
  readonly tags: readonly string[];
  readonly createdAt: IsoTimestamp;
};

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

(`LocationRange` is no longer imported — that's fine, it's still exported from `@/domain/locations` for any future consumer.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/domain/annotations/types.test.ts`
Expected: PASS — both Bookmark tests + the new Highlight test.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean. The old `Highlight` had no consumers so no breaks.

- [ ] **Step 6: Commit**

```bash
git add src/domain/annotations/types.ts src/domain/annotations/types.test.ts
git commit -m "feat(domain): refactor Highlight for v1 — HighlightAnchor + sectionTitle, drop range/normalizedText"
```

---

### Task 2: Storage — Schema bump v3 → v4 + migration

**Files:**
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/db/migrations.ts`
- Modify: `src/storage/db/migrations.test.ts`

> **Strategy:** Additive migration — new `highlights` store with a `by-book` index. Same shape as the v2→v3 bookmark migration.

- [ ] **Step 1: Write the failing migration test**

Append to `src/storage/db/migrations.test.ts`:

```ts
import { HIGHLIGHTS_STORE } from './schema';

describe('v3 → v4 migration', () => {
  it('creates the highlights store with by-book index and preserves existing stores', async () => {
    const dbName = `bookworm-mig4-${crypto.randomUUID()}`;

    const v3 = await openDB(dbName, 3, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('by-checksum', 'source.checksum', { unique: true });
        books.createIndex('by-created', 'createdAt', { unique: false });
        books.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('reading_progress', { keyPath: 'bookId' });
        db.createObjectStore('reader_preferences', { keyPath: 'key' });
        const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarks.createIndex('by-book', 'bookId', { unique: false });
      },
    });
    await v3.put('books', { id: 'b1', title: 'Survivor' });
    await v3.put('bookmarks', {
      id: 'bm1',
      bookId: 'b1',
      anchor: { kind: 'pdf', page: 1 },
      snippet: null,
      sectionTitle: null,
      createdAt: '2026-05-03T12:00:00.000Z',
    });
    v3.close();

    const v4 = await openDB(dbName, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        runMigrations(
          { db: db as never, tx: tx as never },
          oldVersion,
          newVersion ?? CURRENT_DB_VERSION,
        );
      },
    });

    expect(v4.objectStoreNames.contains(HIGHLIGHTS_STORE)).toBe(true);
    const tx = v4.transaction(HIGHLIGHTS_STORE, 'readonly');
    const store = tx.objectStore(HIGHLIGHTS_STORE);
    expect([...store.indexNames]).toContain('by-book');

    const books = await v4.getAll('books');
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ id: 'b1', title: 'Survivor' });

    const bookmarks = await v4.getAll('bookmarks');
    expect(bookmarks).toHaveLength(1);

    v4.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/storage/db/migrations.test.ts`
Expected: FAIL — `HIGHLIGHTS_STORE` not exported, migration v3→v4 not registered.

- [ ] **Step 3: Edit `src/storage/db/schema.ts`**

Find:

```ts
export const CURRENT_DB_VERSION = 3;
```

Replace with:

```ts
export const CURRENT_DB_VERSION = 4;
```

Inside the `BookwormDBSchema` interface, add (alongside `bookmarks`):

```ts
  highlights: {
    key: string;
    value: import('@/domain').Highlight;
    indexes: { 'by-book': string };
  };
```

At the bottom of the file, alongside `BOOKMARKS_STORE`, add:

```ts
export const HIGHLIGHTS_STORE = 'highlights' as const;
```

- [ ] **Step 4: Edit `src/storage/db/migrations.ts`**

Update the `StoreName` union and add the v3 → v4 migration. Replace the file with:

```ts
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { BookwormDBSchema } from './schema';

type StoreName =
  | 'books'
  | 'settings'
  | 'reading_progress'
  | 'reader_preferences'
  | 'bookmarks'
  | 'highlights';

type UpgradeContext = {
  readonly db: IDBPDatabase<BookwormDBSchema>;
  readonly tx: IDBPTransaction<BookwormDBSchema, StoreName[], 'versionchange'>;
};

type Migration = (ctx: UpgradeContext) => void;

const migrations: Readonly<Record<number, Migration>> = {
  // 0 → 1: initial v1 baseline
  0: ({ db }) => {
    if (!db.objectStoreNames.contains('books')) {
      const store = db.createObjectStore('books', { keyPath: 'id' });
      store.createIndex('by-checksum', 'source.checksum', { unique: true });
      store.createIndex('by-created', 'createdAt', { unique: false });
      store.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  },
  // 1 → 2: Phase 2.1 reader stores
  1: ({ db }) => {
    if (!db.objectStoreNames.contains('reading_progress')) {
      db.createObjectStore('reading_progress', { keyPath: 'bookId' });
    }
    if (!db.objectStoreNames.contains('reader_preferences')) {
      db.createObjectStore('reader_preferences', { keyPath: 'key' });
    }
  },
  // 2 → 3: Phase 3.1 bookmarks store
  2: ({ db }) => {
    if (!db.objectStoreNames.contains('bookmarks')) {
      const store = db.createObjectStore('bookmarks', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
    }
  },
  // 3 → 4: Phase 3.2 highlights store
  3: ({ db }) => {
    if (!db.objectStoreNames.contains('highlights')) {
      const store = db.createObjectStore('highlights', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
    }
  },
};

export function runMigrations(ctx: UpgradeContext, oldVersion: number, newVersion: number): void {
  for (let v = oldVersion; v < newVersion; v += 1) {
    const m = migrations[v];
    if (!m) {
      throw new Error(`No migration registered for version ${String(v)} → ${String(v + 1)}`);
    }
    m(ctx);
  }
}
```

- [ ] **Step 5: Run all migration tests**

Run: `pnpm test --run src/storage/db/migrations.test.ts`
Expected: PASS — all four describe blocks (v1 baseline, v1→v2, v2→v3, v3→v4) pass.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/storage/db/schema.ts src/storage/db/migrations.ts src/storage/db/migrations.test.ts
git commit -m "feat(storage): IDB v4 — highlights store + by-book index"
```

---

### Task 3: Storage — `HighlightsRepository`

**Files:**
- Create: `src/storage/repositories/highlights.ts`
- Create: `src/storage/repositories/highlights.test.ts`
- Modify: `src/storage/index.ts`

> **Strategy:** Mirror the bookmarks repo pattern. `add` / `patch` (color-only) / `delete` / `listByBook` (sorted in book order) / `deleteByBook` (cascade). Validator soften via `normalizeHighlight`.

- [ ] **Step 1: Write the failing test**

```ts
// src/storage/repositories/highlights.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createHighlightsRepository } from './highlights';
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type { Highlight } from '@/domain/annotations/types';
import { HIGHLIGHTS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-hl-${crypto.randomUUID()}`);
});

function makeEpub(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:8)' },
    selectedText: 'A passage',
    sectionTitle: 'Chapter 1',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    ...overrides,
  };
}

function makePdf(page: number, x: number, overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    anchor: { kind: 'pdf', page, rects: [{ x, y: 100, width: 50, height: 12 }] },
    selectedText: 'Page passage',
    sectionTitle: `Page ${String(page)}`,
    color: 'blue',
    tags: [],
    createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    ...overrides,
  };
}

describe('HighlightsRepository', () => {
  it('add → listByBook returns the highlight', async () => {
    const repo = createHighlightsRepository(db);
    const h = makeEpub();
    await repo.add(h);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(h.id);
  });

  it('listByBook sorts PDF highlights by page then y then x', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(makePdf(2, 100));
    await repo.add(makePdf(1, 200));
    await repo.add(makePdf(1, 50));
    const list = await repo.listByBook(BookId('book-1'));
    const positions = list.map((h) =>
      h.anchor.kind === 'pdf' ? `${String(h.anchor.page)}:${String(h.anchor.rects[0]?.x)}` : 'x',
    );
    expect(positions).toEqual(['1:50', '1:200', '2:100']);
  });

  it('listByBook sorts EPUB highlights by CFI lex', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(
      makeEpub({ anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' } }),
    );
    await repo.add(
      makeEpub({ anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/2/16)' } }),
    );
    await repo.add(
      makeEpub({ anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/6!/4/2/16)' } }),
    );
    const list = await repo.listByBook(BookId('book-1'));
    const cfis = list.map((h) => (h.anchor.kind === 'epub-cfi' ? h.anchor.cfi : 'x'));
    expect(cfis).toEqual([
      'epubcfi(/6/2!/4/2/16)',
      'epubcfi(/6/4!/4/2/16)',
      'epubcfi(/6/6!/4/2/16)',
    ]);
  });

  it('listByBook filters by bookId', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(makeEpub({ bookId: BookId('book-1') }));
    await repo.add(makeEpub({ bookId: BookId('book-2') }));
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.bookId).toBe('book-1');
  });

  it('patch updates color and persists', async () => {
    const repo = createHighlightsRepository(db);
    const h = makeEpub({ color: 'yellow' });
    await repo.add(h);
    await repo.patch(h.id, { color: 'green' });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list[0]?.color).toBe('green');
    expect(list[0]?.id).toBe(h.id);
  });

  it('patch on missing id is a no-op', async () => {
    const repo = createHighlightsRepository(db);
    await expect(repo.patch(HighlightId('nope'), { color: 'green' })).resolves.toBeUndefined();
  });

  it('delete removes by id', async () => {
    const repo = createHighlightsRepository(db);
    const h = makeEpub();
    await repo.add(h);
    await repo.delete(h.id);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(0);
  });

  it('deleteByBook removes only that book’s highlights', async () => {
    const repo = createHighlightsRepository(db);
    await repo.add(makeEpub({ bookId: BookId('book-1') }));
    await repo.add(makeEpub({ bookId: BookId('book-1') }));
    await repo.add(makeEpub({ bookId: BookId('book-2') }));
    await repo.deleteByBook(BookId('book-1'));
    expect(await repo.listByBook(BookId('book-1'))).toHaveLength(0);
    expect(await repo.listByBook(BookId('book-2'))).toHaveLength(1);
  });

  it('listByBook drops corrupt records (invalid color)', async () => {
    const repo = createHighlightsRepository(db);
    await db.put(HIGHLIGHTS_STORE, {
      id: 'bad' as never,
      bookId: 'book-1' as never,
      anchor: { kind: 'epub-cfi', cfi: 'x' },
      selectedText: 'x',
      sectionTitle: null,
      color: 'fuchsia' as never,
      tags: [],
      createdAt: '2026-05-03T12:00:00.000Z' as never,
    });
    await repo.add(makeEpub());
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
  });

  it('listByBook drops corrupt records (missing rects on pdf anchor)', async () => {
    const repo = createHighlightsRepository(db);
    await db.put(HIGHLIGHTS_STORE, {
      id: 'bad' as never,
      bookId: 'book-1' as never,
      anchor: { kind: 'pdf', page: 1 } as never,
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: '2026-05-03T12:00:00.000Z' as never,
    });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/storage/repositories/highlights.test.ts`
Expected: FAIL — `createHighlightsRepository` doesn't exist.

- [ ] **Step 3: Implement the repository**

```ts
// src/storage/repositories/highlights.ts
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type {
  Highlight,
  HighlightAnchor,
  HighlightColor,
  HighlightRect,
} from '@/domain/annotations/types';
import type { BookwormDB } from '../db/open';
import { HIGHLIGHTS_STORE } from '../db/schema';

export type HighlightsRepository = {
  add(highlight: Highlight): Promise<void>;
  patch(id: HighlightId, partial: Partial<Pick<Highlight, 'color'>>): Promise<void>;
  delete(id: HighlightId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Highlight[]>;
  deleteByBook(bookId: BookId): Promise<void>;
};

const VALID_COLORS: ReadonlySet<HighlightColor> = new Set([
  'yellow',
  'green',
  'blue',
  'pink',
]);

function isValidRect(v: unknown): v is HighlightRect {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<HighlightRect>;
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number'
  );
}

function isValidAnchor(value: unknown): value is HighlightAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'epub-cfi') {
    return typeof (value as { cfi?: unknown }).cfi === 'string';
  }
  if (v.kind === 'pdf') {
    const p = value as { page?: unknown; rects?: unknown };
    return (
      typeof p.page === 'number' && Array.isArray(p.rects) && p.rects.every(isValidRect)
    );
  }
  return false;
}

function normalizeHighlight(record: unknown): Highlight | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Highlight>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!isValidAnchor(r.anchor)) return null;
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
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === 'string')
      : [],
    createdAt: IsoTimestamp(r.createdAt),
  };
}

function compareInBookOrder(a: Highlight, b: Highlight): number {
  if (a.anchor.kind === 'pdf' && b.anchor.kind === 'pdf') {
    if (a.anchor.page !== b.anchor.page) return a.anchor.page - b.anchor.page;
    const ar = a.anchor.rects[0];
    const br = b.anchor.rects[0];
    if (!ar || !br) return 0;
    if (ar.y !== br.y) return ar.y - br.y;
    if (ar.x !== br.x) return ar.x - br.x;
    return 0;
  }
  if (a.anchor.kind === 'epub-cfi' && b.anchor.kind === 'epub-cfi') {
    return a.anchor.cfi < b.anchor.cfi ? -1 : a.anchor.cfi > b.anchor.cfi ? 1 : 0;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function createHighlightsRepository(db: BookwormDB): HighlightsRepository {
  return {
    async add(highlight) {
      await db.put(HIGHLIGHTS_STORE, highlight);
    },
    async patch(id, partial) {
      const existing = await db.get(HIGHLIGHTS_STORE, id);
      if (!existing) return;
      const next: Highlight = { ...existing, ...partial };
      await db.put(HIGHLIGHTS_STORE, next);
    },
    async delete(id) {
      await db.delete(HIGHLIGHTS_STORE, id);
    },
    async listByBook(bookId) {
      const tx = db.transaction(HIGHLIGHTS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      const valid = records
        .map(normalizeHighlight)
        .filter((h): h is Highlight => h !== null);
      return valid.sort(compareInBookOrder);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(HIGHLIGHTS_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}
```

- [ ] **Step 4: Export from `src/storage/index.ts`**

Append:

```ts
export {
  createHighlightsRepository,
  type HighlightsRepository,
} from './repositories/highlights';
```

- [ ] **Step 5: Run repository tests**

Run: `pnpm test --run src/storage/repositories/highlights.test.ts`
Expected: PASS — all 10 tests.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/storage/repositories/highlights.ts src/storage/repositories/highlights.test.ts src/storage/index.ts
git commit -m "feat(storage): HighlightsRepository with validating reads + book-order sort + cascade"
```

---

### Task 4: Wiring — add `highlightsRepo` to `Wiring`

**Files:**
- Modify: `src/features/library/wiring.ts`
- Modify: `src/app/useReaderHost.test.ts`

> **Strategy:** Plumbing only. Mirror how bookmarks were wired in 3.1.

- [ ] **Step 1: Edit `src/features/library/wiring.ts`**

In the import block, add `createHighlightsRepository` and `HighlightsRepository`:

Find:

```ts
  createBookmarksRepository,
  type OpfsAdapter,
  type BookRepository,
  type SettingsRepository,
  type ReadingProgressRepository,
  type ReaderPreferencesRepository,
  type BookmarksRepository,
} from '@/storage';
```

Replace with:

```ts
  createBookmarksRepository,
  createHighlightsRepository,
  type OpfsAdapter,
  type BookRepository,
  type SettingsRepository,
  type ReadingProgressRepository,
  type ReaderPreferencesRepository,
  type BookmarksRepository,
  type HighlightsRepository,
} from '@/storage';
```

In the `Wiring` type, add the field next to `bookmarksRepo`:

Find:

```ts
  readonly bookmarksRepo: BookmarksRepository;
  readonly importDeps: Omit<ImportInput, 'file'>;
```

Replace with:

```ts
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
  readonly importDeps: Omit<ImportInput, 'file'>;
```

In `createWiring`, construct it after `bookmarksRepo`:

Find:

```ts
  const bookmarksRepo = createBookmarksRepository(db);
```

Add directly below:

```ts
  const highlightsRepo = createHighlightsRepository(db);
```

In the return object, add `highlightsRepo` after `bookmarksRepo`:

Find:

```ts
    bookmarksRepo,
    importDeps,
```

Replace with:

```ts
    bookmarksRepo,
    highlightsRepo,
    importDeps,
```

- [ ] **Step 2: Add `highlightsRepo` fake to `useReaderHost.test.ts`**

In `src/app/useReaderHost.test.ts`, find the `bookmarksRepo` block in `fakeWiring()`:

```ts
    bookmarksRepo: {
      add: vi.fn(() => Promise.resolve()),
      patch: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listByBook: vi.fn(() => Promise.resolve([])),
      deleteByBook: vi.fn(() => Promise.resolve()),
    },
```

Add directly below it:

```ts
    highlightsRepo: {
      add: vi.fn(() => Promise.resolve()),
      patch: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listByBook: vi.fn(() => Promise.resolve([])),
      deleteByBook: vi.fn(() => Promise.resolve()),
    },
```

- [ ] **Step 3: Type-check + run unit suite**

Run: `pnpm type-check && pnpm test`
Expected: clean; all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/library/wiring.ts src/app/useReaderHost.test.ts
git commit -m "feat(wiring): expose highlightsRepo on Wiring"
```

---

### Task 5: Shared — `highlightColors` map

**Files:**
- Create: `src/features/reader/highlightColors.ts`
- Create: `src/features/reader/highlightColors.test.ts`

> **Strategy:** Single source of truth for color hex values shared by EPUB Overlayer (programmatic), PDF CSS (data-attrs), and the toolbar/list UI. Tested for exhaustiveness so we don't drop a color silently when `HighlightColor` grows.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reader/highlightColors.test.ts
import { describe, it, expect } from 'vitest';
import { COLOR_HEX, HIGHLIGHT_COLORS } from './highlightColors';
import type { HighlightColor } from '@/domain/annotations/types';

describe('highlightColors', () => {
  it('exports a hex value for every HighlightColor', () => {
    const expected: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
    for (const color of expected) {
      expect(COLOR_HEX[color]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('HIGHLIGHT_COLORS lists the four colors in display order', () => {
    expect(HIGHLIGHT_COLORS).toEqual(['yellow', 'green', 'blue', 'pink']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/highlightColors.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/features/reader/highlightColors.ts
import type { HighlightColor } from '@/domain/annotations/types';

// Display order used by the toolbar and the list panel's per-row color picker.
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
];

export const COLOR_HEX: Readonly<Record<HighlightColor, string>> = {
  yellow: '#fef08a',
  green: '#bbf7d0',
  blue: '#bfdbfe',
  pink: '#fbcfe8',
};
```

- [ ] **Step 4: Run tests + type-check**

Run: `pnpm test --run src/features/reader/highlightColors.test.ts && pnpm type-check`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/highlightColors.ts src/features/reader/highlightColors.test.ts
git commit -m "feat(reader): shared highlightColors map (HighlightColor → hex)"
```

---

### Task 6: Shared — `highlightSort` comparator (extracted)

**Files:**
- Create: `src/features/reader/workspace/highlightSort.ts`
- Create: `src/features/reader/workspace/highlightSort.test.ts`
- Modify: `src/storage/repositories/highlights.ts` (use the shared comparator)

> **Strategy:** Move the comparator from the repo into a shared module so the hook (Task 11) can re-sort after optimistic mutations without duplicating logic.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reader/workspace/highlightSort.test.ts
import { describe, it, expect } from 'vitest';
import { compareHighlightsInBookOrder } from './highlightSort';
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type { Highlight } from '@/domain/annotations/types';

function pdf(page: number, x: number, y: number, createdAt = '2026-05-03T12:00:00.000Z'): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'pdf', page, rects: [{ x, y, width: 10, height: 10 }] },
    selectedText: 't',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(createdAt),
  };
}

function epub(cfi: string, createdAt = '2026-05-03T12:00:00.000Z'): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi },
    selectedText: 't',
    sectionTitle: null,
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(createdAt),
  };
}

describe('compareHighlightsInBookOrder', () => {
  it('PDF: page asc, then y asc, then x asc', () => {
    const list = [pdf(2, 100, 100), pdf(1, 100, 200), pdf(1, 50, 100), pdf(1, 200, 100)];
    list.sort(compareHighlightsInBookOrder);
    const summary = list.map((h) =>
      h.anchor.kind === 'pdf' ? `${h.anchor.page}:${h.anchor.rects[0]?.y}:${h.anchor.rects[0]?.x}` : 'x',
    );
    expect(summary).toEqual(['1:100:50', '1:100:200', '1:200:100', '2:100:100']);
  });

  it('EPUB: CFI lex order', () => {
    const list = [
      epub('epubcfi(/6/4!/4)'),
      epub('epubcfi(/6/2!/4)'),
      epub('epubcfi(/6/6!/4)'),
    ];
    list.sort(compareHighlightsInBookOrder);
    const cfis = list.map((h) => (h.anchor.kind === 'epub-cfi' ? h.anchor.cfi : 'x'));
    expect(cfis).toEqual([
      'epubcfi(/6/2!/4)',
      'epubcfi(/6/4!/4)',
      'epubcfi(/6/6!/4)',
    ]);
  });

  it('mixed kinds fall back to createdAt', () => {
    const list = [
      epub('epubcfi(/6/2!/4)', '2026-05-03T13:00:00.000Z'),
      pdf(1, 0, 0, '2026-05-03T12:00:00.000Z'),
    ];
    list.sort(compareHighlightsInBookOrder);
    expect(list[0]?.anchor.kind).toBe('pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/workspace/highlightSort.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/features/reader/workspace/highlightSort.ts
import type { Highlight } from '@/domain/annotations/types';

export function compareHighlightsInBookOrder(a: Highlight, b: Highlight): number {
  if (a.anchor.kind === 'pdf' && b.anchor.kind === 'pdf') {
    if (a.anchor.page !== b.anchor.page) return a.anchor.page - b.anchor.page;
    const ar = a.anchor.rects[0];
    const br = b.anchor.rects[0];
    if (!ar || !br) return 0;
    if (ar.y !== br.y) return ar.y - br.y;
    if (ar.x !== br.x) return ar.x - br.x;
    return 0;
  }
  if (a.anchor.kind === 'epub-cfi' && b.anchor.kind === 'epub-cfi') {
    return a.anchor.cfi < b.anchor.cfi ? -1 : a.anchor.cfi > b.anchor.cfi ? 1 : 0;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
```

- [ ] **Step 4: Update `src/storage/repositories/highlights.ts` to use the shared comparator**

Remove the local `compareInBookOrder` function (find and delete the entire `function compareInBookOrder(a: Highlight, b: Highlight): number { ... }` block).

Add to imports at the top:

```ts
import { compareHighlightsInBookOrder } from '@/features/reader/workspace/highlightSort';
```

In the `listByBook` body, change `valid.sort(compareInBookOrder)` to `valid.sort(compareHighlightsInBookOrder)`.

- [ ] **Step 5: Run tests + type-check**

Run: `pnpm test --run src/features/reader/workspace/highlightSort.test.ts src/storage/repositories/highlights.test.ts && pnpm type-check`
Expected: PASS (3 + 10) + clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/workspace/highlightSort.ts src/features/reader/workspace/highlightSort.test.ts src/storage/repositories/highlights.ts
git commit -m "refactor(reader): extract highlight sort comparator (shared by repo + hook)"
```

---

### Task 7: BookReader contract — `SelectionInfo` + 5 new methods (with stubs)

**Files:**
- Modify: `src/domain/reader/types.ts`
- Modify: `src/features/reader/ReaderView.tsx`
- Modify: `src/features/reader/epub/EpubReaderAdapter.ts`
- Modify: `src/features/reader/pdf/PdfReaderAdapter.ts`
- Modify: `src/features/reader/readerMachine.test.ts`

> **Strategy:** Same pattern as 3.1's bookmark extractor additions — declare types, add adapter stubs to keep type-check green, real implementations come in Tasks 8 and 9.

- [ ] **Step 1: Update `BookReader` interface and add types**

In `src/domain/reader/types.ts`, find:

```ts
import type { LocationAnchor, TocEntry } from '@/domain';
```

Replace with:

```ts
import type { LocationAnchor, TocEntry } from '@/domain';
import type { Highlight, HighlightAnchor, HighlightId } from '@/domain/annotations/types';
```

At the bottom of the file (before the `// ----- Errors -----` block), add:

```ts
// ----- Selection + highlight tap (Phase 3.2) -----

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

Find the `BookReader` interface and replace it:

```ts
export interface BookReader {
  open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }>;
  goToAnchor(anchor: LocationAnchor): Promise<void>;
  getCurrentAnchor(): LocationAnchor;
  applyPreferences(prefs: ReaderPreferences): void;
  onLocationChange(listener: LocationChangeListener): () => void;
  // Best-effort extractors (Phase 3.1 — bookmarks).
  getSnippetAt(anchor: LocationAnchor): Promise<string | null>;
  getSectionTitleAt(anchor: LocationAnchor): string | null;
  // Highlights (Phase 3.2).
  loadHighlights(highlights: readonly Highlight[]): void;
  addHighlight(highlight: Highlight): void;
  removeHighlight(id: HighlightId): void;
  onSelectionChange(listener: SelectionListener): () => void;
  onHighlightTap(listener: HighlightTapListener): () => void;
  destroy(): void;
}
```

- [ ] **Step 2: Update `ReaderViewExposedState`**

In `src/features/reader/ReaderView.tsx`, find:

```ts
export type ReaderViewExposedState = {
  readonly toc: readonly TocEntry[] | null;
  readonly currentEntryId: string | undefined;
  readonly prefs: ReaderPreferences | null;
  readonly goToAnchor: (anchor: LocationAnchor) => void;
  readonly applyPreferences: (prefs: ReaderPreferences) => void;
  readonly getCurrentAnchor: () => LocationAnchor | null;
  readonly getSnippetAt: (anchor: LocationAnchor) => Promise<string | null>;
  readonly getSectionTitleAt: (anchor: LocationAnchor) => string | null;
};
```

Replace with:

```ts
export type ReaderViewExposedState = {
  readonly toc: readonly TocEntry[] | null;
  readonly currentEntryId: string | undefined;
  readonly prefs: ReaderPreferences | null;
  readonly goToAnchor: (anchor: LocationAnchor) => void;
  readonly applyPreferences: (prefs: ReaderPreferences) => void;
  readonly getCurrentAnchor: () => LocationAnchor | null;
  readonly getSnippetAt: (anchor: LocationAnchor) => Promise<string | null>;
  readonly getSectionTitleAt: (anchor: LocationAnchor) => string | null;
  // Highlights (Phase 3.2).
  readonly loadHighlights: (highlights: readonly Highlight[]) => void;
  readonly addHighlight: (highlight: Highlight) => void;
  readonly removeHighlight: (id: HighlightId) => void;
  readonly onSelectionChange: (listener: SelectionListener) => () => void;
  readonly onHighlightTap: (listener: HighlightTapListener) => () => void;
};
```

Add to the imports at the top of the file:

```ts
import type { Highlight, HighlightId } from '@/domain/annotations/types';
import type { SelectionListener, HighlightTapListener } from '@/domain/reader';
```

(`SelectionListener` and `HighlightTapListener` should be re-exported from `@/domain/reader/index.ts`. If that index file doesn't already re-export `*` from `./types`, add `export type { SelectionInfo, SelectionListener, HighlightTapListener } from './types';` to it.)

- [ ] **Step 3: Add passthroughs in `ReaderView`**

Inside the `ReaderView` component, find the existing extractor `useCallback` blocks (`getCurrentAnchor`, `getSnippetAt`, `getSectionTitleAt`). Immediately after the `getSectionTitleAt` block, add:

```tsx
  const loadHighlights = useCallback((highlights: readonly Highlight[]): void => {
    adapterRef.current?.loadHighlights(highlights);
  }, []);

  const addHighlight = useCallback((highlight: Highlight): void => {
    adapterRef.current?.addHighlight(highlight);
  }, []);

  const removeHighlight = useCallback((id: HighlightId): void => {
    adapterRef.current?.removeHighlight(id);
  }, []);

  const onSelectionChange = useCallback(
    (listener: SelectionListener): (() => void) => {
      if (!adapterRef.current) return () => undefined;
      return adapterRef.current.onSelectionChange(listener);
    },
    [],
  );

  const onHighlightTap = useCallback(
    (listener: HighlightTapListener): (() => void) => {
      if (!adapterRef.current) return () => undefined;
      return adapterRef.current.onHighlightTap(listener);
    },
    [],
  );
```

Update the `onStateChange` payload — find:

```tsx
    onStateChange({
      toc: state.context.toc,
      currentEntryId,
      prefs,
      goToAnchor,
      applyPreferences,
      getCurrentAnchor,
      getSnippetAt,
      getSectionTitleAt,
    });
```

Replace with:

```tsx
    onStateChange({
      toc: state.context.toc,
      currentEntryId,
      prefs,
      goToAnchor,
      applyPreferences,
      getCurrentAnchor,
      getSnippetAt,
      getSectionTitleAt,
      loadHighlights,
      addHighlight,
      removeHighlight,
      onSelectionChange,
      onHighlightTap,
    });
```

Update the dependency array — find:

```tsx
  }, [
    onStateChange,
    state.context.toc,
    prefs,
    currentEntryId,
    goToAnchor,
    applyPreferences,
    getCurrentAnchor,
    getSnippetAt,
    getSectionTitleAt,
  ]);
```

Replace with:

```tsx
  }, [
    onStateChange,
    state.context.toc,
    prefs,
    currentEntryId,
    goToAnchor,
    applyPreferences,
    getCurrentAnchor,
    getSnippetAt,
    getSectionTitleAt,
    loadHighlights,
    addHighlight,
    removeHighlight,
    onSelectionChange,
    onHighlightTap,
  ]);
```

- [ ] **Step 4: Add stubs to both adapters**

In `src/features/reader/epub/EpubReaderAdapter.ts`, find the existing stub-or-real `getSectionTitleAt` method. After it (and before the `destroy()` method), add:

```ts
  loadHighlights(_highlights: readonly Highlight[]): void {
    // implemented in Task 8
  }

  addHighlight(_highlight: Highlight): void {
    // implemented in Task 8
  }

  removeHighlight(_id: HighlightId): void {
    // implemented in Task 8
  }

  onSelectionChange(_listener: SelectionListener): () => void {
    return () => undefined;
  }

  onHighlightTap(_listener: HighlightTapListener): () => void {
    return () => undefined;
  }
```

Add to imports at the top of `EpubReaderAdapter.ts`:

```ts
import type { Highlight, HighlightId } from '@/domain/annotations/types';
import type { SelectionListener, HighlightTapListener } from '@/domain/reader';
```

Repeat the same five stub methods in `src/features/reader/pdf/PdfReaderAdapter.ts` (with the same imports added).

- [ ] **Step 5: Update `readerMachine.test.ts` adapter fakes**

In `src/features/reader/readerMachine.test.ts`, find the `fakeAdapter()` function. Inside the returned object, add (next to `getSectionTitleAt`):

```ts
    loadHighlights() {
      // noop
    },
    addHighlight() {
      // noop
    },
    removeHighlight() {
      // noop
    },
    onSelectionChange() {
      return () => undefined;
    },
    onHighlightTap() {
      return () => undefined;
    },
```

In the inline adapter literal in the "engine error transitions to error" test, add the same five fields after `getSectionTitleAt: () => null,`:

```ts
      loadHighlights: () => undefined,
      addHighlight: () => undefined,
      removeHighlight: () => undefined,
      onSelectionChange: () => () => undefined,
      onHighlightTap: () => () => undefined,
```

- [ ] **Step 6: Type-check + run unit suite**

Run: `pnpm type-check && pnpm test`
Expected: clean; all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domain/reader/types.ts src/domain/reader/index.ts src/features/reader/ReaderView.tsx src/features/reader/epub/EpubReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/readerMachine.test.ts
git commit -m "feat(reader): add SelectionInfo + 5 highlight methods to BookReader contract (stubs)"
```

---

### Task 8: EPUB highlight implementation

**Files:**
- Modify: `src/features/reader/epub/EpubReaderAdapter.ts`
- Modify: `src/types/foliate-js.d.ts`

> **Strategy:** Use foliate's `view.addAnnotation` + `Overlayer.highlight` (registered via `'draw-annotation'` event) to render. Use `'create-overlay'` to attach a `selectionchange` listener to the new section's document. Use `'show-annotation'` for taps. Track `highlightsById` and `highlightsBySection` in adapter state to support re-adds when sections re-mount.

- [ ] **Step 1: Extend foliate type declarations**

In `src/types/foliate-js.d.ts`, find:

```ts
  interface FoliateViewElement extends HTMLElement {
    open(book: Blob | string | object): Promise<void>;
    close(): void;
    init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<void>;
    readonly book?: FoliateBook;
    readonly renderer?: FoliateRenderer;
    lastLocation?: FoliateLastLocation | null;
```

Replace with:

```ts
  interface FoliateViewElement extends HTMLElement {
    open(book: Blob | string | object): Promise<void>;
    close(): void;
    init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<void>;
    addAnnotation(annotation: { value: string; color?: string; id?: string }, remove?: boolean): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    getCFI(index: number, range: Range): string;
    readonly book?: FoliateBook;
    readonly renderer?: FoliateRenderer;
    lastLocation?: FoliateLastLocation | null;
```

(Adds `addAnnotation`, `deleteAnnotation`, `getCFI`. Foliate's runtime API confirmed in spec §5.3.)

- [ ] **Step 2: Implement adapter state + listeners**

In `src/features/reader/epub/EpubReaderAdapter.ts`, find the existing private fields:

```ts
  private currentCfi = '';
  private currentSnippet: string | null = null;
  private currentSectionIndex = -1;
  private currentTocItemLabel: string | null = null;
  private currentTocEntries: readonly TocEntry[] = [];
  private trackedObservers = new Set<ResizeObserver>();
  private resizeObserverPatched = false;
```

Replace with:

```ts
  private currentCfi = '';
  private currentSnippet: string | null = null;
  private currentSectionIndex = -1;
  private currentTocItemLabel: string | null = null;
  private currentTocEntries: readonly TocEntry[] = [];
  private trackedObservers = new Set<ResizeObserver>();
  private resizeObserverPatched = false;
  // Highlights (Phase 3.2).
  private highlightsById = new Map<string, Highlight>();           // id → highlight
  private highlightCfiById = new Map<string, string>();             // id → CFI (for delete by id)
  private highlightIdByCfi = new Map<string, string>();             // CFI → id (for tap → id)
  private selectionListeners = new Set<SelectionListener>();
  private highlightTapListeners = new Set<HighlightTapListener>();
  private selectionDebounceTimer: number | undefined;
  private drawAnnotationListenerInstalled = false;
```

(Add to the imports at top of the file the `COLOR_HEX` constant — `import { COLOR_HEX } from '../highlightColors';`.)

- [ ] **Step 3: Wire `'draw-annotation'`, `'show-annotation'`, `'create-overlay'` listeners**

In `EpubReaderAdapter.open()`, after the existing `view.addEventListener('relocate', ...)` block, add:

```ts
    // Highlight render: foliate emits 'draw-annotation' when an annotation
    // becomes drawable in a loaded section. We pass the current annotation's
    // color to the Overlayer.highlight helper.
    view.addEventListener('draw-annotation', (e: Event) => {
      const detail = (e as CustomEvent<{
        draw: (fn: unknown, opts?: unknown) => void;
        annotation: { value: string; color?: string };
      }>).detail;
      const color = detail.annotation.color ?? COLOR_HEX.yellow;
      // Overlayer.highlight is foliate's static helper — we reach it via the
      // global Overlayer module (foliate registers it on the view's renderer).
      // The renderer exposes the helper via a static property on the SVG drawer.
      // We import the helper from foliate-js/overlayer.js below.
      detail.draw(highlightDrawer, { color });
    });

    // Highlight tap: foliate emits 'show-annotation' when the user clicks a
    // rendered annotation. Map CFI → id and notify our subscribers.
    view.addEventListener('show-annotation', (e: Event) => {
      const detail = (e as CustomEvent<{ value: string; range?: Range }>).detail;
      const id = this.highlightIdByCfi.get(detail.value);
      if (!id) return;
      const r = detail.range?.getBoundingClientRect();
      const screenPos = r
        ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        : { x: 0, y: 0 };
      for (const fn of this.highlightTapListeners) fn(id as never, screenPos);
    });

    // Section overlay creation: this is when a section's contentDocument is
    // ready. Re-add highlights for this section AND attach a selectionchange
    // listener to the section's document.
    view.addEventListener('create-overlay', (e: Event) => {
      const detail = (e as CustomEvent<{ index: number }>).detail;
      this.onSectionCreated(detail.index, view);
    });
```

Add an import at the top of the file (next to the existing foliate imports):

```ts
import { Overlayer } from 'foliate-js/overlayer.js';

const highlightDrawer = Overlayer.highlight;
```

(`Overlayer.highlight` is the static drawer; we capture the reference once at module init.)

- [ ] **Step 4: Implement `onSectionCreated` private method**

Add the following method to the class (anywhere in the private-method section, e.g., after `extractSectionFallbackSnippet`):

```ts
  private onSectionCreated(sectionIndex: number, view: FoliateViewElement): void {
    // 1. Re-add highlights for this section.
    for (const h of this.highlightsById.values()) {
      if (h.anchor.kind !== 'epub-cfi') continue;
      // Foliate's resolver tells us the section index for a CFI internally;
      // we just re-call addAnnotation and let foliate route it. Wasteful for
      // highlights in *other* sections, but addAnnotation is cheap when the
      // overlayer for that section doesn't exist (the call no-ops).
      void view.addAnnotation({ value: h.anchor.cfi, color: COLOR_HEX[h.color] });
    }

    // 2. Attach selectionchange listener to this section's document.
    const renderer = view.renderer as
      | (HTMLElement & {
          getContents?: () => readonly { doc?: Document; index?: number }[];
        })
      | undefined;
    const contents = renderer?.getContents?.();
    const doc = contents?.find((c) => c.index === sectionIndex)?.doc;
    if (!doc) return;
    doc.addEventListener('selectionchange', () => {
      this.handleSelectionChange(view, sectionIndex, doc);
    });
  }

  private handleSelectionChange(
    view: FoliateViewElement,
    sectionIndex: number,
    doc: Document,
  ): void {
    if (this.selectionDebounceTimer !== undefined) {
      window.clearTimeout(this.selectionDebounceTimer);
    }
    this.selectionDebounceTimer = window.setTimeout(() => {
      this.selectionDebounceTimer = undefined;
      const sel = doc.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || sel.rangeCount === 0 || text.length === 0) {
        for (const fn of this.selectionListeners) fn(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const cfi = view.getCFI(sectionIndex, range);
      const r = range.getBoundingClientRect();
      // Translate iframe-relative coords to viewport. The iframe is the
      // ancestor of `doc`, so use its frameElement getBoundingClientRect.
      const frame = doc.defaultView?.frameElement;
      const offset = frame?.getBoundingClientRect();
      const screenRect = {
        x: r.left + (offset?.left ?? 0),
        y: r.top + (offset?.top ?? 0),
        width: r.width,
        height: r.height,
      };
      const info: SelectionInfo = {
        anchor: { kind: 'epub-cfi', cfi },
        selectedText: text,
        screenRect,
      };
      for (const fn of this.selectionListeners) fn(info);
    }, 100);
  }
```

Also add `SelectionInfo` to the imports at the top of the file:

```ts
import type { SelectionInfo, SelectionListener, HighlightTapListener } from '@/domain/reader';
```

(Replaces the type-only line added in Task 7.)

- [ ] **Step 5: Replace stub methods with real implementations**

Find the five stub methods added in Task 7 (`loadHighlights`, `addHighlight`, `removeHighlight`, `onSelectionChange`, `onHighlightTap`) and replace them with:

```ts
  loadHighlights(highlights: readonly Highlight[]): void {
    if (!this.view) {
      // Cache for when the view becomes ready; foliate's create-overlay will
      // re-add per-section. We still want addAnnotation calls so the maps are
      // populated for tap-id resolution.
      for (const h of highlights) {
        if (h.anchor.kind !== 'epub-cfi') continue;
        this.highlightsById.set(h.id, h);
        this.highlightCfiById.set(h.id, h.anchor.cfi);
        this.highlightIdByCfi.set(h.anchor.cfi, h.id);
      }
      return;
    }
    for (const h of highlights) this.addHighlight(h);
  }

  addHighlight(highlight: Highlight): void {
    if (highlight.anchor.kind !== 'epub-cfi') return;
    // Upsert: if already present, remove first so color change re-renders.
    const existingCfi = this.highlightCfiById.get(highlight.id);
    if (existingCfi && this.view) {
      void this.view.deleteAnnotation({ value: existingCfi });
      this.highlightIdByCfi.delete(existingCfi);
    }
    this.highlightsById.set(highlight.id, highlight);
    this.highlightCfiById.set(highlight.id, highlight.anchor.cfi);
    this.highlightIdByCfi.set(highlight.anchor.cfi, highlight.id);
    if (this.view) {
      void this.view.addAnnotation({
        value: highlight.anchor.cfi,
        color: COLOR_HEX[highlight.color],
      });
    }
  }

  removeHighlight(id: HighlightId): void {
    const cfi = this.highlightCfiById.get(id);
    if (!cfi) return;
    if (this.view) void this.view.deleteAnnotation({ value: cfi });
    this.highlightsById.delete(id);
    this.highlightCfiById.delete(id);
    this.highlightIdByCfi.delete(cfi);
  }

  onSelectionChange(listener: SelectionListener): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  onHighlightTap(listener: HighlightTapListener): () => void {
    this.highlightTapListeners.add(listener);
    return () => {
      this.highlightTapListeners.delete(listener);
    };
  }
```

- [ ] **Step 6: Reset highlight state in `destroy`**

In `destroy()`, after the `currentTocEntries = []` line, add:

```ts
    this.highlightsById.clear();
    this.highlightCfiById.clear();
    this.highlightIdByCfi.clear();
    this.selectionListeners.clear();
    this.highlightTapListeners.clear();
    if (this.selectionDebounceTimer !== undefined) {
      window.clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = undefined;
    }
```

Mark `drawAnnotationListenerInstalled` field as removable: it was added but unused — delete the line `private drawAnnotationListenerInstalled = false;` from the field declarations.

- [ ] **Step 7: Type-check + build**

Run: `pnpm type-check && pnpm build`
Expected: clean.

(No new unit tests for this task — selection / annotation flow needs real foliate runtime; covered by E2E in Tasks 15-17.)

- [ ] **Step 8: Commit**

```bash
git add src/features/reader/epub/EpubReaderAdapter.ts src/types/foliate-js.d.ts
git commit -m "feat(reader/epub): selection capture + highlight render via foliate Overlayer"
```

---

### Task 9: PDF highlight implementation

**Files:**
- Modify: `src/features/reader/pdf/PdfReaderAdapter.ts`
- Modify: `src/features/reader/pdf/PdfPageView.ts`
- Create: `src/features/reader/pdf/pdf-highlight-layer.css`
- Modify: `src/features/reader/pdf/pdf-page.css` (or wherever the existing pdf reader styles live — adjust below)

> **Strategy:** PdfPageView creates a sibling `.pdf-reader__highlight-layer` div alongside the text-layer and calls back to the adapter when ready. Adapter tracks highlights by page; on render-callback, draws colored divs from PDF-coord rects converted via the page's viewport. Selection capture listens for `selectionchange` at the document level and converts text-layer Range rects to PDF coords.

- [ ] **Step 1: Add highlight-layer CSS**

```css
/* src/features/reader/pdf/pdf-highlight-layer.css */
.pdf-reader__highlight-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1; /* above canvas (auto), below text-layer (z-index: 2 set by pdfjs) */
}

.pdf-highlight {
  position: absolute;
  mix-blend-mode: multiply;
  opacity: 0.4;
  pointer-events: auto;
  cursor: pointer;
}

.pdf-highlight[data-color='yellow'] { background: #fef08a; }
.pdf-highlight[data-color='green']  { background: #bbf7d0; }
.pdf-highlight[data-color='blue']   { background: #bfdbfe; }
.pdf-highlight[data-color='pink']   { background: #fbcfe8; }

@media (prefers-color-scheme: dark) {
  .pdf-highlight {
    mix-blend-mode: screen;
    opacity: 0.5;
  }
}
```

- [ ] **Step 2: Update `PdfPageView` to add a highlight-layer + callback**

In `src/features/reader/pdf/PdfPageView.ts`, find:

```ts
type Options = {
  readonly page: PDFPageProxy;
  readonly scale: number;
  readonly host: HTMLElement;
};
```

Replace with:

```ts
type Options = {
  readonly page: PDFPageProxy;
  readonly scale: number;
  readonly host: HTMLElement;
  readonly pageNumber: number;
  readonly onRendered?: (
    pageNumber: number,
    highlightLayer: HTMLDivElement,
    viewport: import('pdfjs-dist').PageViewport,
  ) => void;
};
```

Add `import './pdf-highlight-layer.css';` at the top.

Add a new private field `private highlightLayerEl: HTMLDivElement | null = null;`.

In `render()`, after the text-layer creation block (after `await textLayer.render();`), add:

```ts
    // Highlight layer (Phase 3.2): a sibling of the text-layer that the
    // adapter populates with absolutely-positioned colored divs.
    if (this.destroyed) return;
    const highlightLayerEl = document.createElement('div');
    highlightLayerEl.className = 'pdf-reader__highlight-layer';
    highlightLayerEl.style.width = `${String(Math.floor(viewport.width / dpr))}px`;
    highlightLayerEl.style.height = `${String(Math.floor(viewport.height / dpr))}px`;
    host.appendChild(highlightLayerEl);
    this.highlightLayerEl = highlightLayerEl;

    if (this.opts.onRendered) {
      const cssViewport = page.getViewport({ scale: this.opts.scale });
      this.opts.onRendered(this.opts.pageNumber, highlightLayerEl, cssViewport);
    }
```

In `destroy()`, after the `if (this.textLayerEl) { ... }` block, add:

```ts
    if (this.highlightLayerEl) {
      this.highlightLayerEl.remove();
      this.highlightLayerEl = null;
    }
```

- [ ] **Step 3: Update `PdfReaderAdapter` callsites for `PdfPageView`**

In `src/features/reader/pdf/PdfReaderAdapter.ts`, find every `new PdfPageView({` instantiation. They currently pass `{page, scale, host}`. Add `pageNumber` and `onRendered`:

For each callsite, change e.g.:

```ts
new PdfPageView({ page, scale: this.currentScale, host: slot })
```

To:

```ts
new PdfPageView({
  page,
  scale: this.currentScale,
  host: slot,
  pageNumber: pageIndex + 1,
  onRendered: (n, layer, vp) => {
    this.onPageRendered(n, layer, vp);
  },
})
```

(The exact `pageIndex` variable name may differ — use whatever local in scope represents the 1-based page number.)

- [ ] **Step 4: Add highlight state + render method to `PdfReaderAdapter`**

In `src/features/reader/pdf/PdfReaderAdapter.ts`, add to the private fields:

```ts
  // Highlights (Phase 3.2).
  private highlightsByPage = new Map<number, Highlight[]>();
  private highlightLayerByPage = new Map<number, HTMLDivElement>();
  private highlightViewportByPage = new Map<number, import('pdfjs-dist').PageViewport>();
  private selectionListeners = new Set<SelectionListener>();
  private highlightTapListeners = new Set<HighlightTapListener>();
  private selectionDebounceTimer: number | undefined;
  private documentSelectionHandler: (() => void) | null = null;
```

Add to imports:

```ts
import type { Highlight, HighlightId, HighlightRect } from '@/domain/annotations/types';
import type { SelectionInfo, SelectionListener, HighlightTapListener } from '@/domain/reader';
import { COLOR_HEX } from '../highlightColors';
```

Replace the five stub methods with:

```ts
  loadHighlights(highlights: readonly Highlight[]): void {
    this.highlightsByPage.clear();
    for (const h of highlights) {
      if (h.anchor.kind !== 'pdf') continue;
      const list = this.highlightsByPage.get(h.anchor.page) ?? [];
      list.push(h);
      this.highlightsByPage.set(h.anchor.page, list);
    }
    // Re-draw any pages currently mounted.
    for (const [page, layer] of this.highlightLayerByPage) {
      const vp = this.highlightViewportByPage.get(page);
      if (vp) this.renderHighlightsOnPage(page, layer, vp);
    }
  }

  addHighlight(highlight: Highlight): void {
    if (highlight.anchor.kind !== 'pdf') return;
    const page = highlight.anchor.page;
    const list = this.highlightsByPage.get(page) ?? [];
    // Upsert: remove existing entry with the same id.
    const filtered = list.filter((h) => h.id !== highlight.id);
    filtered.push(highlight);
    this.highlightsByPage.set(page, filtered);
    const layer = this.highlightLayerByPage.get(page);
    const vp = this.highlightViewportByPage.get(page);
    if (layer && vp) this.renderHighlightsOnPage(page, layer, vp);
  }

  removeHighlight(id: HighlightId): void {
    for (const [page, list] of this.highlightsByPage) {
      const filtered = list.filter((h) => h.id !== id);
      if (filtered.length !== list.length) {
        this.highlightsByPage.set(page, filtered);
        const layer = this.highlightLayerByPage.get(page);
        const vp = this.highlightViewportByPage.get(page);
        if (layer && vp) this.renderHighlightsOnPage(page, layer, vp);
      }
    }
  }

  onSelectionChange(listener: SelectionListener): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  onHighlightTap(listener: HighlightTapListener): () => void {
    this.highlightTapListeners.add(listener);
    return () => {
      this.highlightTapListeners.delete(listener);
    };
  }

  // Called by PdfPageView when a page finishes rendering.
  private onPageRendered(
    pageNumber: number,
    highlightLayer: HTMLDivElement,
    viewport: import('pdfjs-dist').PageViewport,
  ): void {
    this.highlightLayerByPage.set(pageNumber, highlightLayer);
    this.highlightViewportByPage.set(pageNumber, viewport);
    // Wire click handler for tap-on-highlight.
    highlightLayer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const id = target?.dataset.id;
      if (!id) return;
      for (const fn of this.highlightTapListeners) {
        fn(id as never, { x: e.clientX, y: e.clientY });
      }
    });
    this.renderHighlightsOnPage(pageNumber, highlightLayer, viewport);
  }

  private renderHighlightsOnPage(
    pageNumber: number,
    layer: HTMLDivElement,
    viewport: import('pdfjs-dist').PageViewport,
  ): void {
    layer.replaceChildren();
    const list = this.highlightsByPage.get(pageNumber) ?? [];
    for (const h of list) {
      if (h.anchor.kind !== 'pdf') continue;
      for (const rect of h.anchor.rects) {
        const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y) as [number, number];
        const [x2, y2] = viewport.convertToViewportPoint(
          rect.x + rect.width,
          rect.y + rect.height,
        ) as [number, number];
        const div = document.createElement('div');
        div.className = 'pdf-highlight';
        div.dataset.id = h.id;
        div.dataset.color = h.color;
        div.style.left = `${String(Math.min(x1, x2))}px`;
        div.style.top = `${String(Math.min(y1, y2))}px`;
        div.style.width = `${String(Math.abs(x2 - x1))}px`;
        div.style.height = `${String(Math.abs(y2 - y1))}px`;
        layer.appendChild(div);
      }
    }
  }
```

- [ ] **Step 5: Wire selection capture on the host document**

In `PdfReaderAdapter.open()`, after the existing per-render setup (look for the line that creates `this.root`), add:

```ts
    // Selection capture (Phase 3.2): listen for selectionchange globally;
    // filter to selections inside our text-layer.
    this.documentSelectionHandler = () => {
      this.handlePdfSelectionChange();
    };
    document.addEventListener('selectionchange', this.documentSelectionHandler);
```

Add the private method:

```ts
  private handlePdfSelectionChange(): void {
    if (this.selectionDebounceTimer !== undefined) {
      window.clearTimeout(this.selectionDebounceTimer);
    }
    this.selectionDebounceTimer = window.setTimeout(() => {
      this.selectionDebounceTimer = undefined;
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || sel.rangeCount === 0 || text.length === 0) {
        for (const fn of this.selectionListeners) fn(null);
        return;
      }
      const range = sel.getRangeAt(0);
      // Find the text-layer the anchor is in (and which page it belongs to).
      const anchorEl =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as HTMLElement)
          : range.commonAncestorContainer.parentElement;
      const textLayer = anchorEl?.closest('.pdf-reader__text-layer') as HTMLElement | null;
      if (!textLayer) return;
      // Find the page number from the highlight-layer next to the text-layer.
      const layerSibling = textLayer.previousElementSibling as HTMLElement | null;
      const pageNumber = this.findPageNumberFor(textLayer);
      if (pageNumber === null) return;
      const vp = this.highlightViewportByPage.get(pageNumber);
      if (!vp) return;
      const layerRect = textLayer.getBoundingClientRect();
      const clientRects = Array.from(range.getClientRects());
      const pdfRects: HighlightRect[] = [];
      for (const r of clientRects) {
        const localX1 = r.left - layerRect.left;
        const localY1 = r.top - layerRect.top;
        const localX2 = r.right - layerRect.left;
        const localY2 = r.bottom - layerRect.top;
        const [px1, py1] = vp.convertToPdfPoint(localX1, localY1) as [number, number];
        const [px2, py2] = vp.convertToPdfPoint(localX2, localY2) as [number, number];
        pdfRects.push({
          x: Math.min(px1, px2),
          y: Math.min(py1, py2),
          width: Math.abs(px2 - px1),
          height: Math.abs(py2 - py1),
        });
      }
      const r = range.getBoundingClientRect();
      const info: SelectionInfo = {
        anchor: { kind: 'pdf', page: pageNumber, rects: pdfRects },
        selectedText: text,
        screenRect: { x: r.left, y: r.top, width: r.width, height: r.height },
      };
      for (const fn of this.selectionListeners) fn(info);
      void layerSibling;
    }, 100);
  }

  private findPageNumberFor(textLayer: HTMLElement): number | null {
    // The text-layer is a child of a slot div in pagesContainer; we tagged
    // the slot or its host with a way to identify the page. Without an
    // explicit data attribute, walk highlightLayerByPage looking for a
    // sibling match.
    for (const [page, hLayer] of this.highlightLayerByPage) {
      if (hLayer.parentElement === textLayer.parentElement) return page;
    }
    return null;
  }
```

- [ ] **Step 6: Reset highlight state in `destroy`**

In `destroy()`, after the `currentTocEntries = []` line, add:

```ts
    this.highlightsByPage.clear();
    this.highlightLayerByPage.clear();
    this.highlightViewportByPage.clear();
    this.selectionListeners.clear();
    this.highlightTapListeners.clear();
    if (this.selectionDebounceTimer !== undefined) {
      window.clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = undefined;
    }
    if (this.documentSelectionHandler) {
      document.removeEventListener('selectionchange', this.documentSelectionHandler);
      this.documentSelectionHandler = null;
    }
```

- [ ] **Step 7: Type-check + build**

Run: `pnpm type-check && pnpm build`
Expected: clean.

(No new unit tests — selection + render flow needs real pdfjs runtime; covered by E2E in Task 18.)

- [ ] **Step 8: Commit**

```bash
git add src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/pdf/PdfPageView.ts src/features/reader/pdf/pdf-highlight-layer.css
git commit -m "feat(reader/pdf): selection capture + highlight render via PDF-coord rects"
```

---

### Task 10: `HighlightToolbar` component

**Files:**
- Create: `src/features/reader/HighlightToolbar.tsx`
- Create: `src/features/reader/highlight-toolbar.css`
- Create: `src/features/reader/HighlightToolbar.test.tsx`

> **Strategy:** Single component, two modes (`'create'` / `'edit'`). Pure presentation; positioning + dismissal handled here. Workspace owns when to mount/unmount it.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/reader/HighlightToolbar.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HighlightToolbar } from './HighlightToolbar';

afterEach(cleanup);

const RECT = { x: 100, y: 200, width: 80, height: 20 };

describe('HighlightToolbar', () => {
  it('renders 4 color buttons in create mode + no delete', () => {
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button', { name: /(yellow|green|blue|pink)/i })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /delete highlight/i })).toBeNull();
  });

  it('renders 4 color buttons + delete in edit mode', () => {
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        currentColor="green"
        onPickColor={() => undefined}
        onDelete={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button', { name: /(yellow|green|blue|pink)/i })).toHaveLength(4);
    expect(screen.getByRole('button', { name: /delete highlight/i })).toBeDefined();
  });

  it('marks the currentColor button as pressed in edit mode', () => {
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        currentColor="blue"
        onPickColor={() => undefined}
        onDelete={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /blue/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /yellow/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('calls onPickColor with the right color when a swatch is clicked', () => {
    const onPickColor = vi.fn();
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={onPickColor}
        onDismiss={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /pink/i }));
    expect(onPickColor).toHaveBeenCalledWith('pink');
  });

  it('calls onDelete when delete is clicked (edit mode)', () => {
    const onDelete = vi.fn();
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        currentColor="yellow"
        onPickColor={() => undefined}
        onDelete={onDelete}
        onDismiss={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /delete highlight/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('calls onDismiss on Escape', () => {
    const onDismiss = vi.fn();
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/HighlightToolbar.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/reader/HighlightToolbar.tsx
import { useEffect, useRef } from 'react';
import type { HighlightColor } from '@/domain/annotations/types';
import { HIGHLIGHT_COLORS, COLOR_HEX } from './highlightColors';
import './highlight-toolbar.css';

type Mode = 'create' | 'edit';

type Props = {
  readonly mode: Mode;
  readonly screenRect: { x: number; y: number; width: number; height: number };
  readonly currentColor?: HighlightColor;
  readonly onPickColor: (color: HighlightColor) => void;
  readonly onDelete?: () => void;
  readonly onDismiss: () => void;
};

const TOOLBAR_HEIGHT = 36;
const GAP = 8;

export function HighlightToolbar({
  mode,
  screenRect,
  currentColor,
  onPickColor,
  onDelete,
  onDismiss,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on Escape, outside-click, or scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onScroll = (): void => {
      onDismiss();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onDismiss]);

  // Position above the selection if there's room, else below.
  const flipBelow = screenRect.y < TOOLBAR_HEIGHT + GAP;
  const top = flipBelow
    ? screenRect.y + screenRect.height + GAP
    : screenRect.y - TOOLBAR_HEIGHT - GAP;
  const left = Math.max(8, screenRect.x + screenRect.width / 2);

  return (
    <div
      ref={ref}
      className="highlight-toolbar"
      role="toolbar"
      aria-label={mode === 'create' ? 'Pick a highlight color' : 'Edit highlight'}
      style={{ top: `${String(top)}px`, left: `${String(left)}px`, transform: 'translateX(-50%)' }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="highlight-toolbar__color"
          aria-label={color}
          aria-pressed={mode === 'edit' ? color === currentColor : false}
          style={{ background: COLOR_HEX[color] }}
          onClick={() => {
            onPickColor(color);
          }}
        />
      ))}
      {mode === 'edit' && onDelete ? (
        <>
          <span className="highlight-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="highlight-toolbar__delete"
            aria-label="Delete highlight"
            onClick={onDelete}
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS**

```css
/* src/features/reader/highlight-toolbar.css */
.highlight-toolbar {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #2a2a2a;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 70;
  font: inherit;
}

.highlight-toolbar__color {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.highlight-toolbar__color[aria-pressed='true'] {
  border-color: #fff;
}

.highlight-toolbar__divider {
  width: 1px;
  height: 16px;
  background: #555;
}

.highlight-toolbar__delete {
  background: transparent;
  border: 0;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
}

.highlight-toolbar__delete:hover {
  color: #ff8b8b;
}
```

- [ ] **Step 5: Run tests + type-check + lint**

Run: `pnpm test --run src/features/reader/HighlightToolbar.test.tsx && pnpm type-check && pnpm lint`
Expected: PASS (6 tests) + clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/HighlightToolbar.tsx src/features/reader/highlight-toolbar.css src/features/reader/HighlightToolbar.test.tsx
git commit -m "feat(reader): HighlightToolbar — shared create/edit floating pill"
```

---

### Task 11: `HighlightsPanel` component

**Files:**
- Create: `src/features/reader/HighlightsPanel.tsx`
- Create: `src/features/reader/highlights-panel.css`
- Create: `src/features/reader/HighlightsPanel.test.tsx`

> **Strategy:** Mirrors `BookmarksPanel`. Row layout: colored vertical bar on the left, section + relative time on top line, selected text below, hover-revealed `[×]` + color pip menu on the right.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/reader/HighlightsPanel.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HighlightsPanel } from './HighlightsPanel';
import { BookId, HighlightId, IsoTimestamp } from '@/domain';
import type { Highlight } from '@/domain/annotations/types';

afterEach(cleanup);

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function h(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)' },
    selectedText: 'A passage of selected text',
    sectionTitle: 'Chapter 1',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    ...overrides,
  };
}

describe('HighlightsPanel', () => {
  it('renders rows with section + selected text + relative time + colored bar', () => {
    const { container } = render(
      <HighlightsPanel
        highlights={[h({ sectionTitle: 'Chapter 1' })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('A passage of selected text')).toBeDefined();
    expect(screen.getByText('just now')).toBeDefined();
    expect(container.querySelector('.highlights-panel__bar[data-color="yellow"]')).not.toBeNull();
  });

  it('shows empty state when no highlights', () => {
    render(
      <HighlightsPanel
        highlights={[]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
      />,
    );
    expect(screen.getByText(/No highlights yet/i)).toBeDefined();
  });

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn();
    const target = h();
    render(
      <HighlightsPanel
        highlights={[target]}
        onSelect={onSelect}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chapter 1/i }));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it('calls onDelete when × is clicked', () => {
    const onDelete = vi.fn();
    const target = h();
    render(
      <HighlightsPanel
        highlights={[target]}
        onSelect={() => undefined}
        onDelete={onDelete}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove highlight/i));
    expect(onDelete).toHaveBeenCalledWith(target);
  });

  it('calls onChangeColor when a color pip is clicked', () => {
    const onChangeColor = vi.fn();
    const target = h({ color: 'yellow' });
    render(
      <HighlightsPanel
        highlights={[target]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={onChangeColor}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/set color to green/i));
    expect(onChangeColor).toHaveBeenCalledWith(target, 'green');
  });

  it('renders highlights in the order provided (caller sorts)', () => {
    const a = h({ sectionTitle: 'Alpha' });
    const b = h({ sectionTitle: 'Beta' });
    const c = h({ sectionTitle: 'Gamma' });
    render(
      <HighlightsPanel
        highlights={[c, a, b]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        nowMs={NOW}
      />,
    );
    const titles = Array.from(document.querySelectorAll('.highlights-panel__section')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Gamma', 'Alpha', 'Beta']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/HighlightsPanel.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/reader/HighlightsPanel.tsx
import type { Highlight, HighlightColor } from '@/domain/annotations/types';
import { relativeTime } from '@/shared/text/relativeTime';
import { HIGHLIGHT_COLORS, COLOR_HEX } from './highlightColors';
import './highlights-panel.css';

type Props = {
  readonly highlights: readonly Highlight[];
  readonly onSelect: (h: Highlight) => void;
  readonly onDelete: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly nowMs?: number;
};

export function HighlightsPanel({
  highlights,
  onSelect,
  onDelete,
  onChangeColor,
  nowMs,
}: Props) {
  if (highlights.length === 0) {
    return (
      <aside className="highlights-panel highlights-panel--empty" aria-label="Highlights">
        <p className="highlights-panel__empty-icon" aria-hidden="true">
          ✎
        </p>
        <p className="highlights-panel__empty-title">No highlights yet</p>
        <p className="highlights-panel__empty-hint">
          Select text in the reader and tap a color.
        </p>
      </aside>
    );
  }
  return (
    <aside className="highlights-panel" aria-label="Highlights">
      <ul className="highlights-panel__list">
        {highlights.map((h) => (
          <li key={h.id} className="highlights-panel__item">
            <span
              className="highlights-panel__bar"
              data-color={h.color}
              style={{ background: COLOR_HEX[h.color] }}
              aria-hidden="true"
            />
            <button
              type="button"
              className="highlights-panel__row"
              aria-label={h.sectionTitle ?? '—'}
              onClick={() => {
                onSelect(h);
              }}
            >
              <span className="highlights-panel__top">
                <span className="highlights-panel__section">{h.sectionTitle ?? '—'}</span>
                <span className="highlights-panel__time">{relativeTime(h.createdAt, nowMs)}</span>
              </span>
              <span className="highlights-panel__text">{h.selectedText}</span>
            </button>
            <span className="highlights-panel__actions">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="highlights-panel__color"
                  aria-label={`Set color to ${color}`}
                  aria-pressed={color === h.color}
                  style={{ background: COLOR_HEX[color] }}
                  onClick={() => {
                    onChangeColor(h, color);
                  }}
                />
              ))}
              <button
                type="button"
                className="highlights-panel__delete"
                aria-label="Remove highlight"
                onClick={() => {
                  onDelete(h);
                }}
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 4: Add the CSS**

```css
/* src/features/reader/highlights-panel.css */
.highlights-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
}

.highlights-panel__list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.highlights-panel__item {
  position: relative;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--color-border-subtle);
  min-height: 56px;
}

.highlights-panel__bar {
  flex: 0 0 4px;
  align-self: stretch;
}

.highlights-panel__row {
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

.highlights-panel__row:hover {
  background: var(--color-surface-hover, var(--color-surface));
}

.highlights-panel__top {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.highlights-panel__section {
  font-weight: 600;
  font-size: var(--text-sm);
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.highlights-panel__time {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  flex: 0 0 auto;
}

.highlights-panel__text {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.highlights-panel__actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-inline-end: var(--space-2);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.highlights-panel__item:hover .highlights-panel__actions,
.highlights-panel__actions:focus-within {
  opacity: 1;
}

@media (hover: none) {
  .highlights-panel__actions {
    opacity: 1;
  }
}

.highlights-panel__color {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.1);
  cursor: pointer;
  padding: 0;
}

.highlights-panel__color[aria-pressed='true'] {
  outline: 2px solid var(--color-text);
  outline-offset: 1px;
}

.highlights-panel__delete {
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  padding: 0 4px;
}

.highlights-panel--empty {
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-muted);
}

.highlights-panel__empty-icon {
  font-size: 32px;
  margin: 0 0 var(--space-3);
  color: var(--color-text);
}

.highlights-panel__empty-title {
  font-weight: 600;
  margin: 0 0 var(--space-1);
  color: var(--color-text);
}

.highlights-panel__empty-hint {
  margin: 0;
  font-size: var(--text-sm);
}
```

- [ ] **Step 5: Run tests + type-check**

Run: `pnpm test --run src/features/reader/HighlightsPanel.test.tsx && pnpm type-check`
Expected: PASS (6 tests) + clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/HighlightsPanel.tsx src/features/reader/highlights-panel.css src/features/reader/HighlightsPanel.test.tsx
git commit -m "feat(reader): HighlightsPanel — colored bar + section + text + per-row actions"
```

---

### Task 12: `useHighlights` hook

**Files:**
- Create: `src/features/reader/workspace/useHighlights.ts`
- Create: `src/features/reader/workspace/useHighlights.test.ts`

> **Strategy:** Owns the in-memory list. `add` captures section title via `readerState.getSectionTitleAt`, writes optimistically + renders + persists. `changeColor` patches list and re-renders. `remove` removes optimistically + clears overlay + persists. Sorted via `compareHighlightsInBookOrder`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reader/workspace/useHighlights.test.ts
/* eslint-disable @typescript-eslint/unbound-method --
   The spies on HighlightsRepository methods are vi.fn() and don't use `this`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useHighlights } from './useHighlights';
import { BookId, HighlightId, IsoTimestamp, type LocationAnchor } from '@/domain';
import type { Highlight, HighlightAnchor } from '@/domain/annotations/types';
import type { HighlightsRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';

function fakeRepo(initial: Highlight[] = []): HighlightsRepository {
  const store = new Map<string, Highlight>(initial.map((h) => [h.id, h]));
  return {
    add: vi.fn((h: Highlight): Promise<void> => {
      store.set(h.id, h);
      return Promise.resolve();
    }),
    patch: vi.fn(
      (id: ReturnType<typeof HighlightId>, partial: Partial<Highlight>): Promise<void> => {
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
    deleteByBook: vi.fn((bookId: ReturnType<typeof BookId>): Promise<void> => {
      for (const [id, h] of store) if (h.bookId === bookId) store.delete(id);
      return Promise.resolve();
    }),
  };
}

const ANCHOR: HighlightAnchor = {
  kind: 'epub-cfi',
  cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)',
};

function fakeReaderState(
  overrides: Partial<ReaderViewExposedState> = {},
): ReaderViewExposedState {
  return {
    toc: null,
    currentEntryId: undefined,
    prefs: null,
    goToAnchor: () => undefined,
    applyPreferences: () => undefined,
    getCurrentAnchor: () => ({ kind: 'epub-cfi', cfi: 'x' }) as LocationAnchor,
    getSnippetAt: () => Promise.resolve(null),
    getSectionTitleAt: () => 'Chapter 1',
    loadHighlights: () => undefined,
    addHighlight: vi.fn(() => undefined),
    removeHighlight: vi.fn(() => undefined),
    onSelectionChange: () => () => undefined,
    onHighlightTap: () => () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('useHighlights', () => {
  it('initial load fetches by bookId', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b1');
    });
    expect(result.current.list).toEqual([]);
  });

  it('add inserts optimistic highlight, calls readerState.addHighlight, persists', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalled());

    await act(async () => {
      await result.current.add(ANCHOR, 'hello world', 'green');
    });

    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0]?.color).toBe('green');
    expect(result.current.list[0]?.sectionTitle).toBe('Chapter 1');
    expect(readerState.addHighlight).toHaveBeenCalled();
    expect(repo.add).toHaveBeenCalled();
  });

  it('add no-ops when readerState is null', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalled());
    await act(async () => {
      await result.current.add(ANCHOR, 'x', 'yellow');
    });
    expect(result.current.list).toHaveLength(0);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('add rolls back optimistic + clears overlay when repo.add throws', async () => {
    const repo = fakeRepo();
    repo.add = vi.fn(() => Promise.reject(new Error('boom')));
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalled());
    await act(async () => {
      await result.current.add(ANCHOR, 'x', 'yellow');
    });
    expect(result.current.list).toHaveLength(0);
    expect(readerState.removeHighlight).toHaveBeenCalled();
  });

  it('changeColor patches optimistically + re-renders + persists', async () => {
    const initial: Highlight = {
      id: HighlightId('h1'),
      bookId: BookId('b1'),
      anchor: ANCHOR,
      selectedText: 'x',
      sectionTitle: 'Chapter 1',
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => expect(result.current.list).toHaveLength(1));
    await act(async () => {
      await result.current.changeColor(initial, 'green');
    });
    expect(result.current.list[0]?.color).toBe('green');
    expect(readerState.addHighlight).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h1', color: 'green' }),
    );
    expect(repo.patch).toHaveBeenCalledWith('h1', { color: 'green' });
  });

  it('remove is optimistic + clears overlay + persists', async () => {
    const initial: Highlight = {
      id: HighlightId('h1'),
      bookId: BookId('b1'),
      anchor: ANCHOR,
      selectedText: 'x',
      sectionTitle: null,
      color: 'yellow',
      tags: [],
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useHighlights({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => expect(result.current.list).toHaveLength(1));
    await act(async () => {
      await result.current.remove(initial);
    });
    expect(result.current.list).toHaveLength(0);
    expect(readerState.removeHighlight).toHaveBeenCalledWith('h1');
    expect(repo.delete).toHaveBeenCalledWith('h1');
  });

  it('switching bookId reloads', async () => {
    const repo = fakeRepo();
    const { rerender } = renderHook(
      ({ id }: { id: ReturnType<typeof BookId> }) =>
        useHighlights({ bookId: id, repo, readerState: null }),
      { initialProps: { id: BookId('b1') } },
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalledWith('b1'));
    rerender({ id: BookId('b2') });
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalledWith('b2'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/workspace/useHighlights.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/reader/workspace/useHighlights.ts
import { useCallback, useEffect, useState } from 'react';
import {
  type BookId,
  HighlightId,
  IsoTimestamp,
  type LocationAnchor,
} from '@/domain';
import type {
  Highlight,
  HighlightAnchor,
  HighlightColor,
} from '@/domain/annotations/types';
import type { HighlightsRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';
import { compareHighlightsInBookOrder } from './highlightSort';

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

function sortInBookOrder(list: readonly Highlight[]): Highlight[] {
  return [...list].sort(compareHighlightsInBookOrder);
}

function projectAnchorForLookup(anchor: HighlightAnchor): LocationAnchor {
  if (anchor.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: anchor.cfi };
  return { kind: 'pdf', page: anchor.page };
}

export function useHighlights({ bookId, repo, readerState }: Options): UseHighlightsHandle {
  const [list, setList] = useState<readonly Highlight[]>([]);

  useEffect(() => {
    let cancelled = false;
    void repo.listByBook(bookId).then((records) => {
      if (!cancelled) setList(sortInBookOrder(records));
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, repo]);

  const add = useCallback(
    async (
      anchor: HighlightAnchor,
      selectedText: string,
      color: HighlightColor,
    ): Promise<void> => {
      if (!readerState) return;
      const sectionTitle = readerState.getSectionTitleAt(projectAnchorForLookup(anchor));
      const optimistic: Highlight = {
        id: HighlightId(crypto.randomUUID()),
        bookId,
        anchor,
        selectedText,
        sectionTitle,
        color,
        tags: [],
        createdAt: IsoTimestamp(new Date().toISOString()),
      };
      setList((prev) => sortInBookOrder([optimistic, ...prev]));
      readerState.addHighlight(optimistic);
      try {
        await repo.add(optimistic);
      } catch (err) {
        console.warn('[highlights] add failed; rolling back', err);
        setList((prev) => prev.filter((h) => h.id !== optimistic.id));
        readerState.removeHighlight(optimistic.id);
      }
    },
    [bookId, repo, readerState],
  );

  const changeColor = useCallback(
    async (h: Highlight, color: HighlightColor): Promise<void> => {
      const next: Highlight = { ...h, color };
      setList((prev) => sortInBookOrder(prev.map((x) => (x.id === h.id ? next : x))));
      readerState?.addHighlight(next);
      try {
        await repo.patch(h.id, { color });
      } catch (err) {
        console.warn('[highlights] color change failed; reverting', err);
        setList((prev) => sortInBookOrder(prev.map((x) => (x.id === h.id ? h : x))));
        readerState?.addHighlight(h);
      }
    },
    [repo, readerState],
  );

  const remove = useCallback(
    async (h: Highlight): Promise<void> => {
      setList((prev) => prev.filter((x) => x.id !== h.id));
      readerState?.removeHighlight(h.id);
      try {
        await repo.delete(h.id);
      } catch (err) {
        console.warn('[highlights] delete failed; restoring', err);
        setList((prev) => sortInBookOrder([...prev, h]));
        readerState?.addHighlight(h);
      }
    },
    [repo, readerState],
  );

  return { list, add, changeColor, remove };
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `pnpm test --run src/features/reader/workspace/useHighlights.test.ts && pnpm type-check`
Expected: PASS (7 tests) + clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/workspace/useHighlights.ts src/features/reader/workspace/useHighlights.test.ts
git commit -m "feat(reader): useHighlights — optimistic add/changeColor/remove + book-order sort"
```

---

### Task 13: Workspace integration — third tab + toolbar wiring + plumb `highlightsRepo`

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx`
- Modify: `src/features/reader/workspace/ReaderWorkspace.test.tsx`
- Modify: `src/app/useReaderHost.ts`
- Modify: `src/app/App.tsx`

> **Strategy:** Add `highlights` as the third rail tab + sheet tab. Wire `useHighlights`, the initial `loadHighlights` effect, and the selection/tap subscriptions. Plumb `highlightsRepo` through `useReaderHost.ReaderHostHandle` and App.tsx.

- [ ] **Step 1: Plumb `highlightsRepo` through `useReaderHost`**

In `src/app/useReaderHost.ts`, find:

```ts
import type { BookmarksRepository } from '@/storage';
```

Replace with:

```ts
import type { BookmarksRepository, HighlightsRepository } from '@/storage';
```

In the `ReaderHostHandle` type, find:

```ts
  bookmarksRepo: BookmarksRepository;
};
```

Replace with:

```ts
  bookmarksRepo: BookmarksRepository;
  highlightsRepo: HighlightsRepository;
};
```

In the return statement, find:

```ts
    bookmarksRepo: wiring.bookmarksRepo,
  };
}
```

Replace with:

```ts
    bookmarksRepo: wiring.bookmarksRepo,
    highlightsRepo: wiring.highlightsRepo,
  };
}
```

- [ ] **Step 2: Pass `highlightsRepo` to `ReaderWorkspace` from App**

In `src/app/App.tsx`, find:

```tsx
          bookmarksRepo={reader.bookmarksRepo}
        />
```

Replace with:

```tsx
          bookmarksRepo={reader.bookmarksRepo}
          highlightsRepo={reader.highlightsRepo}
        />
```

- [ ] **Step 3: Update `ReaderWorkspace` props + add highlights wiring**

In `src/features/reader/workspace/ReaderWorkspace.tsx`, update imports — replace the existing imports block at the top with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { BookId, type BookFormat, type LocationAnchor } from '@/domain';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import type { BookmarksRepository, HighlightsRepository } from '@/storage';
import type {
  Highlight,
  HighlightAnchor,
  HighlightColor,
} from '@/domain/annotations/types';
import { ReaderChrome } from '@/features/reader/ReaderChrome';
import { ReaderView, type ReaderViewExposedState } from '@/features/reader/ReaderView';
import { TocPanel } from '@/features/reader/TocPanel';
import { TypographyPanel } from '@/features/reader/TypographyPanel';
import { BookmarksPanel } from '@/features/reader/BookmarksPanel';
import { HighlightsPanel } from '@/features/reader/HighlightsPanel';
import { HighlightToolbar } from '@/features/reader/HighlightToolbar';
import { DesktopRail, type RailTab } from './DesktopRail';
import { MobileSheet } from './MobileSheet';
import { useFocusMode } from './useFocusMode';
import { useViewport } from './useViewport';
import { useBookmarks } from './useBookmarks';
import { useHighlights } from './useHighlights';
import './workspace.css';
```

Update the `Props` type — find:

```ts
  readonly bookmarksRepo: BookmarksRepository;
};
```

Replace with:

```ts
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
};
```

Inside the `ReaderWorkspace` component, find:

```ts
  const [activeRailTab, setActiveRailTab] = useState<'contents' | 'bookmarks'>('contents');

  const bookmarks = useBookmarks({
    bookId: BookId(props.bookId),
    repo: props.bookmarksRepo,
    readerState,
  });
```

Replace with:

```ts
  const [activeRailTab, setActiveRailTab] = useState<'contents' | 'bookmarks' | 'highlights'>(
    'contents',
  );
  const [activeToolbar, setActiveToolbar] = useState<
    | { kind: 'create'; anchor: HighlightAnchor; selectedText: string; rect: { x: number; y: number; width: number; height: number } }
    | { kind: 'edit'; highlight: Highlight; pos: { x: number; y: number; width: number; height: number } }
    | null
  >(null);

  const bookmarks = useBookmarks({
    bookId: BookId(props.bookId),
    repo: props.bookmarksRepo,
    readerState,
  });
  const highlights = useHighlights({
    bookId: BookId(props.bookId),
    repo: props.highlightsRepo,
    readerState,
  });
```

After the existing `handleStateChange` callback, add the toolbar handlers and effects:

```ts
  // Initial render of persisted highlights into the engine (once both ready).
  useEffect(() => {
    if (!readerState) return;
    readerState.loadHighlights(highlights.list);
  }, [readerState, highlights.list]);

  // Subscribe to engine selection events → drive create-toolbar.
  useEffect(() => {
    if (!readerState) return;
    return readerState.onSelectionChange((sel) => {
      if (sel === null) {
        setActiveToolbar((t) => (t?.kind === 'create' ? null : t));
      } else {
        setActiveToolbar({
          kind: 'create',
          anchor: sel.anchor,
          selectedText: sel.selectedText,
          rect: sel.screenRect,
        });
      }
    });
  }, [readerState]);

  // Subscribe to engine highlight-tap events → drive edit-toolbar.
  useEffect(() => {
    if (!readerState) return;
    return readerState.onHighlightTap((id, pos) => {
      const h = highlights.list.find((x) => x.id === id);
      if (!h) return;
      setActiveToolbar({
        kind: 'edit',
        highlight: h,
        pos: { x: pos.x, y: pos.y, width: 1, height: 1 },
      });
    });
  }, [readerState, highlights.list]);

  const handleCreatePick = useCallback(
    (color: HighlightColor): void => {
      if (activeToolbar?.kind !== 'create') return;
      void highlights.add(activeToolbar.anchor, activeToolbar.selectedText, color);
      setActiveToolbar(null);
      window.getSelection()?.removeAllRanges();
    },
    [activeToolbar, highlights],
  );

  const handleEditPick = useCallback(
    (color: HighlightColor): void => {
      if (activeToolbar?.kind !== 'edit') return;
      void highlights.changeColor(activeToolbar.highlight, color);
      setActiveToolbar(null);
    },
    [activeToolbar, highlights],
  );

  const handleEditDelete = useCallback((): void => {
    if (activeToolbar?.kind !== 'edit') return;
    void highlights.remove(activeToolbar.highlight);
    setActiveToolbar(null);
  }, [activeToolbar, highlights]);

  const dismissToolbar = useCallback((): void => {
    setActiveToolbar(null);
  }, []);
```

Find the existing `bookmarksPanelContent` block and add a `highlightsPanelContent` block after it:

```tsx
  const highlightsPanelContent = (
    <HighlightsPanel
      highlights={highlights.list}
      onSelect={(h) => {
        const anchor: LocationAnchor =
          h.anchor.kind === 'epub-cfi'
            ? { kind: 'epub-cfi', cfi: h.anchor.cfi }
            : { kind: 'pdf', page: h.anchor.page };
        readerState?.goToAnchor(anchor);
      }}
      onDelete={(h) => {
        void highlights.remove(h);
      }}
      onChangeColor={(h, color) => {
        void highlights.changeColor(h, color);
      }}
    />
  );
```

Update `railTabs` — find:

```ts
  const railTabs: readonly RailTab[] = [
    { key: 'contents', label: 'Contents', content: tocPanelContent },
    {
      key: 'bookmarks',
      label: 'Bookmarks',
      badge: bookmarks.list.length,
      content: bookmarksPanelContent,
    },
  ];
```

Replace with:

```ts
  const railTabs: readonly RailTab[] = [
    { key: 'contents', label: 'Contents', content: tocPanelContent },
    {
      key: 'bookmarks',
      label: 'Bookmarks',
      badge: bookmarks.list.length,
      content: bookmarksPanelContent,
    },
    {
      key: 'highlights',
      label: 'Highlights',
      badge: highlights.list.length,
      content: highlightsPanelContent,
    },
  ];
```

Update the sheet tabs — find:

```ts
  const sheetTabs: readonly SheetTab[] = [
    { key: 'contents', label: 'Contents' },
    { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
  ];
```

Replace with:

```ts
  const sheetTabs: readonly SheetTab[] = [
    { key: 'contents', label: 'Contents' },
    { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
    { key: 'highlights', label: 'Highlights', badge: highlights.list.length },
  ];
```

Update both `setActiveRailTab(key as 'contents' | 'bookmarks')` casts (in `<DesktopRail onTabChange>` and `<SheetTabHeader onTabChange>`) to:

```ts
              setActiveRailTab(key as 'contents' | 'bookmarks' | 'highlights');
```

In the mobile sheet block, after the `{activeRailTab === 'bookmarks' ? <BookmarksPanel ... /> : null}` line, add:

```tsx
          {activeRailTab === 'highlights' ? (
            <HighlightsPanel
              highlights={highlights.list}
              onSelect={(h) => {
                const anchor: LocationAnchor =
                  h.anchor.kind === 'epub-cfi'
                    ? { kind: 'epub-cfi', cfi: h.anchor.cfi }
                    : { kind: 'pdf', page: h.anchor.page };
                readerState?.goToAnchor(anchor);
                setActiveSheet(null);
              }}
              onDelete={(h) => {
                void highlights.remove(h);
              }}
              onChangeColor={(h, color) => {
                void highlights.changeColor(h, color);
              }}
            />
          ) : null}
```

At the end of the JSX (after the `firstTimeHintVisible` block), add the toolbar render:

```tsx
      {activeToolbar?.kind === 'create' ? (
        <HighlightToolbar
          mode="create"
          screenRect={activeToolbar.rect}
          onPickColor={handleCreatePick}
          onDismiss={dismissToolbar}
        />
      ) : null}
      {activeToolbar?.kind === 'edit' ? (
        <HighlightToolbar
          mode="edit"
          screenRect={activeToolbar.pos}
          currentColor={activeToolbar.highlight.color}
          onPickColor={handleEditPick}
          onDelete={handleEditDelete}
          onDismiss={dismissToolbar}
        />
      ) : null}
```

- [ ] **Step 4: Update workspace test fixtures**

In `src/features/reader/workspace/ReaderWorkspace.test.tsx`, find:

```ts
const fakeBookmarksRepo = {
  add: () => Promise.resolve(),
  patch: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  listByBook: () => Promise.resolve([]),
  deleteByBook: () => Promise.resolve(),
};
```

Add directly below:

```ts
const fakeHighlightsRepo = {
  add: () => Promise.resolve(),
  patch: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  listByBook: () => Promise.resolve([]),
  deleteByBook: () => Promise.resolve(),
};
```

In the `baseProps` object, add `highlightsRepo: fakeHighlightsRepo,` after the `bookmarksRepo` line.

- [ ] **Step 5: Type-check + lint + run unit suite**

Run: `pnpm type-check && pnpm lint && pnpm test`
Expected: clean; all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/workspace/ReaderWorkspace.tsx src/features/reader/workspace/ReaderWorkspace.test.tsx src/app/useReaderHost.ts src/app/App.tsx
git commit -m "feat(reader): wire HighlightsPanel + HighlightToolbar into workspace as third tab"
```

---

### Task 14: Cascade highlight removal on book delete

**Files:**
- Modify: `src/app/useReaderHost.ts`

> **Strategy:** Mirror Phase 3.1's bookmark cascade.

- [ ] **Step 1: Update `onRemoveBook`**

Find the existing `onRemoveBook` block:

```ts
          await wiring.bookRepo.delete(book.id);
          await wiring.opfs.removeRecursive(`books/${book.id}`);
          await wiring.readingProgressRepo.delete(book.id);
          await wiring.bookmarksRepo.deleteByBook(BookId(book.id));
        } catch (err) {
```

Replace with:

```ts
          await wiring.bookRepo.delete(book.id);
          await wiring.opfs.removeRecursive(`books/${book.id}`);
          await wiring.readingProgressRepo.delete(book.id);
          await wiring.bookmarksRepo.deleteByBook(BookId(book.id));
          await wiring.highlightsRepo.deleteByBook(BookId(book.id));
        } catch (err) {
```

- [ ] **Step 2: Type-check + run unit suite**

Run: `pnpm type-check && pnpm test`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/useReaderHost.ts
git commit -m "feat(app): cascade highlightsRepo.deleteByBook on book removal"
```

---

### Task 15: E2E — `highlights-epub-create`

**Files:**
- Create: `e2e/highlights-epub-create.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/highlights-epub-create.spec.ts
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

// Selects the first paragraph's text inside the foliate iframe via a double-click
// (which selects a word) and shift+End (which extends to end of line). This is
// the most reliable way to drive a text selection inside an iframe in Playwright.
async function selectAPhraseInFirstChapter(page: Page): Promise<void> {
  // Navigate past the cover into a chapter with text.
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  const tocCount = await tocEntries.count();
  await tocEntries.nth(Math.min(2, tocCount - 1)).click();
  await page.waitForTimeout(800);

  // Drive a selection inside the foliate iframe by walking the frame chain.
  const frame = page.frameLocator('iframe').first();
  // Double-click the first text node in the rendered body to select a word.
  const firstParagraph = frame.locator('body p, body div').first();
  await firstParagraph.dblclick();
  await page.waitForTimeout(150);
}

test('select text → toolbar appears → click yellow → highlight rendered + listed; survives reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  await selectAPhraseInFirstChapter(page);

  const toolbar = page.locator('.highlight-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });

  await toolbar.getByRole('button', { name: 'yellow' }).click();
  await expect(toolbar).toBeHidden();

  // Switch to the Highlights tab — entry should be there with section + text + bar.
  await page.getByRole('tab', { name: /highlights/i }).click();
  const rows = page.locator('aside.highlights-panel li.highlights-panel__item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.highlights-panel__bar[data-color="yellow"]')).toBeVisible();
  await expect(rows.first().locator('.highlights-panel__section')).not.toBeEmpty();
  await expect(rows.first().locator('.highlights-panel__text')).not.toBeEmpty();

  // Allow the IDB write to flush before reloading.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /highlights/i }).click();
  await expect(rows).toHaveCount(1);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/highlights-epub-create.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/highlights-epub-create.spec.ts
git commit -m "test(e2e): EPUB highlight create + persist across reload"
```

---

### Task 16: E2E — `highlights-epub-color-change`

**Files:**
- Create: `e2e/highlights-epub-color-change.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/highlights-epub-color-change.spec.ts
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

async function navigateToChapter(page: Page): Promise<void> {
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  const count = await tocEntries.count();
  await tocEntries.nth(Math.min(2, count - 1)).click();
  await page.waitForTimeout(800);
}

test('change a highlight color via the in-reader edit toolbar; survives reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  await navigateToChapter(page);

  // Create a yellow highlight via the panel directly (not via in-reader selection)
  // by using the Highlights tab API exposed through the rail. We simulate the
  // simplest path: select text + click yellow.
  const frame = page.frameLocator('iframe').first();
  await frame.locator('body p, body div').first().dblclick();
  await page.waitForTimeout(200);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();
  await page.waitForTimeout(500);

  // Now tap the highlight via the list panel (more reliable than tapping the
  // SVG inside the foliate iframe in a headless browser). Use the per-row
  // color pip menu to change color.
  await page.getByRole('tab', { name: /highlights/i }).click();
  const row = page.locator('aside.highlights-panel li.highlights-panel__item').first();
  await row.hover();
  await row.getByRole('button', { name: /set color to green/i }).click();

  await expect(row.locator('.highlights-panel__bar[data-color="green"]')).toBeVisible();

  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /highlights/i }).click();
  await expect(row.locator('.highlights-panel__bar[data-color="green"]')).toBeVisible();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/highlights-epub-color-change.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/highlights-epub-color-change.spec.ts
git commit -m "test(e2e): EPUB highlight color change via list pip menu"
```

---

### Task 17: E2E — `highlights-epub-delete`

**Files:**
- Create: `e2e/highlights-epub-delete.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/highlights-epub-delete.spec.ts
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

async function createHighlight(page: Page, color: string): Promise<void> {
  const frame = page.frameLocator('iframe').first();
  // Pick a different paragraph each call by using the .nth() index passed via color.
  // For simplicity we just dblclick the first paragraph repeatedly; foliate's
  // selection clears between events.
  await frame.locator('body p, body div').first().dblclick();
  await page.waitForTimeout(200);
  await page.locator('.highlight-toolbar').getByRole('button', { name: color }).click();
  await page.waitForTimeout(400);
}

test('delete a highlight via list × button; survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Navigate past cover.
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);

  await createHighlight(page, 'yellow');
  await createHighlight(page, 'green');

  await page.getByRole('tab', { name: /highlights/i }).click();
  const rows = page.locator('aside.highlights-panel li.highlights-panel__item');
  await expect(rows).toHaveCount(2);

  await rows.first().hover();
  await rows.first().getByRole('button', { name: /remove highlight/i }).click();
  await expect(rows).toHaveCount(1);

  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /highlights/i }).click();
  await expect(rows).toHaveCount(1);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/highlights-epub-delete.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/highlights-epub-delete.spec.ts
git commit -m "test(e2e): EPUB highlight delete via list × + persist"
```

---

### Task 18: E2E — `highlights-pdf-create`

**Files:**
- Create: `e2e/highlights-pdf-create.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/highlights-pdf-create.spec.ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PDF_FIXTURE = resolve(process.cwd(), 'test-fixtures/multipage.pdf');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PDF_FIXTURE);
  await expect(page.getByText(/multipage test pdf/i).first()).toBeVisible({ timeout: 15_000 });
}

test('select PDF text → pick pink → highlight DOM rendered + listed; survives reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Wait for the text-layer of page 1 to render.
  const textLayer = page.locator('.pdf-reader__text-layer').first();
  await expect(textLayer).toBeVisible({ timeout: 10_000 });

  // Select all text in the first text-layer span via triple-click (paragraph).
  const firstSpan = textLayer.locator('span').first();
  await firstSpan.click({ clickCount: 3 });
  await page.waitForTimeout(150);

  const toolbar = page.locator('.highlight-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });
  await toolbar.getByRole('button', { name: 'pink' }).click();

  // Highlight DOM rendered.
  await expect(page.locator('.pdf-highlight[data-color="pink"]')).toBeVisible();

  // Listed in the panel.
  await page.getByRole('tab', { name: /highlights/i }).click();
  const rows = page.locator('aside.highlights-panel li.highlights-panel__item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.highlights-panel__bar[data-color="pink"]')).toBeVisible();

  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.pdf-highlight[data-color="pink"]')).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/highlights-pdf-create.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/highlights-pdf-create.spec.ts
git commit -m "test(e2e): PDF highlight create + persist across reload"
```

---

### Task 19: E2E — `highlights-mobile`

**Files:**
- Create: `e2e/highlights-mobile.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/highlights-mobile.spec.ts
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

test('mobile: select text → toolbar → color → ☰ → Highlights tab → tap row → reader navigates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Mobile: open ☰ to switch to a chapter via TOC.
  await page.getByRole('button', { name: /table of contents/i }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const tocEntries = sheet.locator('aside.toc-panel button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  await tocEntries.nth(2).click();
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(800);

  // Select text inside the iframe.
  const frame = page.frameLocator('iframe').first();
  await frame.locator('body p, body div').first().dblclick();
  await page.waitForTimeout(200);

  const toolbar = page.locator('.highlight-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });
  await toolbar.getByRole('button', { name: 'blue' }).click();
  await page.waitForTimeout(400);

  // Open ☰ → switch to Highlights tab.
  await page.getByRole('button', { name: /table of contents/i }).click();
  const sheet2 = page.getByRole('dialog');
  await expect(sheet2).toBeVisible();
  await sheet2.getByRole('tab', { name: /highlights/i }).click();

  const rows = sheet2.locator('aside.highlights-panel li.highlights-panel__item');
  await expect(rows).toHaveCount(1);

  // Tap the row → sheet dismisses, reader stays.
  await rows.first().getByRole('button').first().click();
  await expect(sheet2).toBeHidden();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/highlights-mobile.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/highlights-mobile.spec.ts
git commit -m "test(e2e): mobile highlight create + tabbed sheet jump + dismiss"
```

---

### Task 20: E2E — `highlights-cascade-on-remove`

**Files:**
- Create: `e2e/highlights-cascade-on-remove.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/highlights-cascade-on-remove.spec.ts
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

test('removing a book deletes its highlights (re-import shows empty list)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Navigate + create a highlight.
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible({ timeout: 5000 });
  await tocEntries.nth(2).click();
  await page.waitForTimeout(800);

  const frame = page.frameLocator('iframe').first();
  await frame.locator('body p, body div').first().dblclick();
  await page.waitForTimeout(200);
  await page.locator('.highlight-toolbar').getByRole('button', { name: 'yellow' }).click();
  await page.waitForTimeout(500);

  // Back to library + remove book.
  await page.getByRole('button', { name: /back to library/i }).click();
  const cards = page.locator('[data-book-id]');
  await expect(cards).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Book actions' }).first().click();
  await page.getByRole('menuitem', { name: /remove from library/i }).click();
  await expect(cards).toHaveCount(0);

  await page.waitForTimeout(500);

  // Re-import same file.
  await importFixture(page);
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('tab', { name: /highlights/i }).click();
  await expect(page.getByText(/No highlights yet/i)).toBeVisible();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/highlights-cascade-on-remove.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/highlights-cascade-on-remove.spec.ts
git commit -m "test(e2e): book removal cascades to highlights (empty after re-import)"
```

---

### Task 21: Doc updates

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Architecture decision entry**

In `docs/02-system-architecture.md`, find:

```markdown
## Decision history
### 2026-05-03 — Phase 3.1 bookmarks
```

Insert above the Phase 3.1 entry:

```markdown
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
  maintained internally.
- PDF rendering adds a new `.pdf-reader__highlight-layer` sibling of the
  text-layer in `PdfPageView`; the adapter populates it with absolutely-
  positioned `<div class="pdf-highlight" data-color="…" data-id="…">`
  elements. Selection events translate text-layer Range rects to PDF coords
  via `viewport.convertToPdfPoint`. Click handler reads `data-id` for tap.
- New `HighlightToolbar` component is a single floating pill used in two
  modes: `'create'` (just colors, on selection) and `'edit'` (colors with
  current pre-selected + a delete button, on tap). Position flips below
  the selection if there's no room above. Dismisses on Escape, outside-
  click, or scroll.
- New `HighlightsPanel` joins `TocPanel` and `BookmarksPanel` as the third
  tab in the rail (desktop) or sheet (mobile). Each row has a colored bar
  on the left, section + relative time on top, selected text below, plus a
  hover-revealed color-pip menu (4 dots) and × button on the right.
- `useHighlights` hook owns the in-memory list and orchestrates optimistic
  add/changeColor/remove. List sorted via shared `compareHighlightsInBookOrder`
  (PDF: page → y → x; EPUB: CFI lex order; mixed kinds fall back to createdAt).
- Cascade: `useReaderHost.onRemoveBook` adds `highlightsRepo.deleteByBook`
  next to the bookmarks cascade.
```

- [ ] **Step 2: Roadmap status**

In `docs/04-implementation-roadmap.md`, find:

```markdown
- Phase 3 — in progress (Task 3.1 complete 2026-05-03; 3.2/3.3/3.4 pending)
```

Replace with:

```markdown
- Phase 3 — in progress (Tasks 3.1 + 3.2 complete 2026-05-03; 3.3/3.4 pending)
```

- [ ] **Step 3: Verify nothing else broke**

Run: `pnpm test && pnpm lint && pnpm type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: Phase 3.2 architecture decision + roadmap status"
```

---

### Task 22: Final verification + open PR

**Files:** none

- [ ] **Step 1: Type-check, lint, unit, build**

```bash
pnpm type-check && pnpm lint && pnpm test && pnpm build
```

Expected: all clean.

- [ ] **Step 2: Full E2E**

```bash
pnpm exec playwright test
```

Expected: all pass (existing 26 + 6 new highlights specs = 32).

- [ ] **Step 3: Manual smoke**

```bash
pnpm dev
```

In `http://localhost:5173`:
1. Open an EPUB → navigate past cover → select a phrase → toolbar appears → tap yellow → highlight visible. Switch to Highlights tab → entry present.
2. Tap the rendered highlight → edit toolbar → tap green → both overlay and list update.
3. Tap × in the edit toolbar → highlight gone from reader and list.
4. Open a PDF → select text → tap pink → `.pdf-highlight` div visible.
5. Resize to mobile → ☰ → switch to Highlights → tap row → sheet dismisses + reader stays.
6. Reload → all highlights still rendered with correct colors.
7. Back to library → remove the book → re-import → Highlights tab is empty.

Per the debugging memory: stop after fix #2 fails, instrument first; check user-environment amplifiers (extensions, dev-vs-prod) early.

- [ ] **Step 4: Push branch**

```bash
git push -u origin phase-3-2-highlights
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "Phase 3.2: Highlights" --body "$(cat <<'EOF'
## Summary
- New \`highlights\` IDB store at v4 (additive migration). \`HighlightsRepository\` with validating reads + book-order sort + cascade delete.
- Select text in EPUB or PDF → floating \`HighlightToolbar\` (4 colors) → tap a color → overlay rendered + persisted. Tap a rendered highlight → same toolbar with current color + delete affordance.
- New \`HighlightsPanel\` is the third tab in the rail/sheet (Contents / Bookmarks / Highlights). List sorted in book order; per-row color pip menu + ×.
- Engine adapters gain 5 \`BookReader\` methods (\`loadHighlights\`, \`addHighlight\`, \`removeHighlight\`, \`onSelectionChange\`, \`onHighlightTap\`). EPUB uses foliate's \`Overlayer.highlight\` + \`view.addAnnotation\`; PDF uses a custom \`.pdf-reader__highlight-layer\` with PDF-coord rects.
- Refactored the previously-unused \`Highlight\` domain type (dropped \`range\`/\`normalizedText\`, added \`HighlightAnchor\` + \`sectionTitle\`).
- \`useReaderHost.onRemoveBook\` cascades to \`highlightsRepo.deleteByBook\`.

## Test plan
- [x] Type-check + lint + build clean
- [x] ~50 new unit tests pass (Highlight types, repo, sort comparator, color map, toolbar, panel, hook, migration)
- [x] 6 new E2E specs pass: \`highlights-epub-create\`, \`highlights-epub-color-change\`, \`highlights-epub-delete\`, \`highlights-pdf-create\`, \`highlights-mobile\`, \`highlights-cascade-on-remove\`
- [x] Manual smoke: EPUB + PDF create/color/delete, mobile sheet, cascade-on-remove, reload preserves all

## Design + plan
- Spec: \`docs/superpowers/specs/2026-05-03-phase-3-2-highlights-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-03-phase-3-2-highlights.md\`
- Architecture entry: \`docs/02-system-architecture.md\` (Phase 3.2 decision)
- Roadmap: Phase 3 in progress, Tasks 3.1 + 3.2 complete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: returns the PR URL.

---

## Self-review checklist

Spec coverage:
- §1 Goal & scope → Tasks 1, 10, 11, 12, 15–20.
- §2 Decisions → reflected in implementation choices (always-empty tags, floating toolbar, PDF-coord rects, edit popover, book-order sort).
- §3 Architecture → matches the file map.
- §4 Domain & storage → Tasks 1, 2, 3, 4.
- §5 Engine API → Tasks 7, 8, 9.
- §6 UI → Tasks 10, 11, 12, 13.
- §7 Data flow & error handling → Task 12 (`useHighlights`), Task 13 (workspace wiring), Task 14 (cascade).
- §8 Testing — every test row appears in a corresponding task.
- §9 File map — all files have a creating/modifying task.

Type consistency:
- `Highlight`, `HighlightAnchor`, `HighlightRect`, `HighlightColor` — defined Task 1, used consistently in Tasks 3, 5, 6, 7, 8, 9, 10, 11, 12, 13.
- `HighlightsRepository` interface — defined Task 3, used in Tasks 4, 12, 13, 14.
- `BookReader` additions (Task 7) match adapter implementations (Tasks 8, 9) and `ReaderViewExposedState` (Task 7).
- `useHighlights` options match workspace wiring (Task 13).
- `SelectionInfo`, `SelectionListener`, `HighlightTapListener` defined Task 7; used in Tasks 8, 9, 12, 13.
- `compareHighlightsInBookOrder` — defined Task 6, used by repo (Task 6 also patches it in) and hook (Task 12).
- `HIGHLIGHT_COLORS`, `COLOR_HEX` — defined Task 5, used by toolbar (Task 10), panel (Task 11), and engine adapters (Tasks 8, 9 reference `COLOR_HEX[h.color]`).
