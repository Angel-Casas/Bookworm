# Phase 3.1 — Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a v1 bookmark feature: tap ★ to save current location, see/jump/delete from a Bookmarks tab in the rail (desktop) or the existing ☰ sheet (mobile), with section title + ~80-char snippet on each row. Persists across reload; cascades on book removal.

**Architecture:** New `bookmarks` IDB store at v3 (additive migration). New `BookmarksRepository`, `useBookmarks` hook, and `BookmarksPanel` component compose into the existing reader workspace. Engine adapters gain two best-effort extractor methods (`getSnippetAt` async, `getSectionTitleAt` sync) plus a `getCurrentAnchor` passthrough on `ReaderViewExposedState`. The `DesktopRail` is generalized to accept a tabs descriptor so it can host both `TocPanel` and `BookmarksPanel`.

**Tech Stack:** TypeScript strict, React 19, Zustand, XState v5, foliate-js (EPUB), pdfjs-dist (PDF), idb (IndexedDB), Vitest + happy-dom (unit), Playwright (E2E).

**Reference:** Spec at `docs/superpowers/specs/2026-05-03-phase-3-1-bookmarks-design.md`.

---

## Task ordering

Storage and domain types first (they're prerequisites for everything else), then engine extractors, then UI primitives, then composition into the workspace, then E2Es, then docs.

---

### Task 1: Domain — `Bookmark` type

**Files:**
- Modify: `src/domain/annotations/types.ts`
- Create: `src/domain/annotations/types.test.ts`

> **Strategy:** Tighten the existing `Bookmark` type to match the design (drop `note?`, add nullable `snippet` and `sectionTitle`). The existing `Highlight` / `Note` / `NoteAnchorRef` types are untouched — they're for Tasks 3.2/3.3.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/annotations/types.test.ts
import { describe, it, expect } from 'vitest';
import { BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';

describe('Bookmark', () => {
  it('has the v1 shape with nullable snippet and sectionTitle', () => {
    const b: Bookmark = {
      id: BookmarkId('00000000-0000-0000-0000-000000000001'),
      bookId: BookId('book-1'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
      snippet: null,
      sectionTitle: null,
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(b.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(b.snippet).toBeNull();
    expect(b.sectionTitle).toBeNull();
  });

  it('accepts a populated bookmark with snippet + section title', () => {
    const b: Bookmark = {
      id: BookmarkId('id-2'),
      bookId: BookId('book-2'),
      anchor: { kind: 'pdf', page: 7 },
      snippet: 'It is a truth universally acknowledged…',
      sectionTitle: 'Page 7',
      createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    };
    expect(b.snippet).toContain('truth');
    expect(b.sectionTitle).toBe('Page 7');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/domain/annotations/types.test.ts`
Expected: FAIL — `Bookmark` still has `note?` instead of `snippet`/`sectionTitle`.

- [ ] **Step 3: Edit the Bookmark type**

In `src/domain/annotations/types.ts`, replace the existing `Bookmark` definition (keep `Highlight`, `HighlightColor`, `Note`, `NoteAnchorRef` exactly as-is):

```ts
export type Bookmark = {
  readonly id: BookmarkId;
  readonly bookId: BookId;
  readonly anchor: LocationAnchor;
  readonly snippet: string | null;
  readonly sectionTitle: string | null;
  readonly createdAt: IsoTimestamp;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/domain/annotations/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify nothing else broke**

Run: `pnpm type-check`
Expected: clean. (`Bookmark` is not yet consumed elsewhere — Phase 3.1 is its first consumer.)

- [ ] **Step 6: Commit**

```bash
git add src/domain/annotations/types.ts src/domain/annotations/types.test.ts
git commit -m "feat(domain): tighten Bookmark type for v1 (snippet + sectionTitle)"
```

---

### Task 2: Storage — Schema bump v2 → v3 + migration

**Files:**
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/db/migrations.ts`
- Modify: `src/storage/db/migrations.test.ts`

> **Strategy:** Additive migration — new `bookmarks` store with a `by-book` index. No data transformation. Existing stores untouched.

- [ ] **Step 1: Write the failing migration test**

Append to `src/storage/db/migrations.test.ts`:

```ts
import { BOOKMARKS_STORE } from './schema';

describe('v2 → v3 migration', () => {
  it('creates the bookmarks store with by-book index and preserves existing books', async () => {
    const dbName = `bookworm-mig3-${crypto.randomUUID()}`;

    // Open at v2 with a book and a reading_progress record.
    const v2 = await openDB(dbName, 2, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('by-checksum', 'source.checksum', { unique: true });
        books.createIndex('by-created', 'createdAt', { unique: false });
        books.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('reading_progress', { keyPath: 'bookId' });
        db.createObjectStore('reader_preferences', { keyPath: 'key' });
      },
    });
    await v2.put('books', { id: 'b1', title: 'Survivor' });
    await v2.put('reading_progress', { bookId: 'b1', anchor: { kind: 'pdf', page: 3 }, updatedAt: 1 });
    v2.close();

    // Reopen at v3.
    const v3 = await openDB(dbName, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        runMigrations(
          { db: db as never, tx: tx as never },
          oldVersion,
          newVersion ?? CURRENT_DB_VERSION,
        );
      },
    });

    expect(v3.objectStoreNames.contains(BOOKMARKS_STORE)).toBe(true);
    const tx = v3.transaction(BOOKMARKS_STORE, 'readonly');
    const store = tx.objectStore(BOOKMARKS_STORE);
    expect([...store.indexNames]).toContain('by-book');

    const books = await v3.getAll('books');
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ id: 'b1', title: 'Survivor' });

    const progress = await v3.getAll('reading_progress');
    expect(progress).toHaveLength(1);

    v3.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/storage/db/migrations.test.ts`
Expected: FAIL — `BOOKMARKS_STORE` is not exported and migration v2→v3 not registered.

- [ ] **Step 3: Edit `src/storage/db/schema.ts`**

Bump version, add the new store to the schema, add the const export. Replace the file's contents below the existing imports up to `CURRENT_DB_VERSION` and append the new constant:

Find:

```ts
export const CURRENT_DB_VERSION = 2;
```

Replace with:

```ts
export const CURRENT_DB_VERSION = 3;
```

Inside the `BookwormDBSchema` interface, add:

```ts
  bookmarks: {
    key: string;
    value: import('@/domain').Bookmark;
    indexes: { 'by-book': string };
  };
```

At the bottom of the file (next to the other store name constants), add:

```ts
export const BOOKMARKS_STORE = 'bookmarks' as const;
```

Also extend the `StoreName` union in `src/storage/db/migrations.ts` (next step) — but first add the schema additions above so the type compiles.

- [ ] **Step 4: Edit `src/storage/db/migrations.ts`**

Update the `StoreName` union and add the v2 → v3 migration. The full file becomes:

```ts
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { BookwormDBSchema } from './schema';

type StoreName =
  | 'books'
  | 'settings'
  | 'reading_progress'
  | 'reader_preferences'
  | 'bookmarks';

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
Expected: PASS — all three describe blocks (v1 baseline, v1→v2, v2→v3) pass.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: clean. The schema's reference to `import('@/domain').Bookmark` resolves because Task 1 already added that type.

- [ ] **Step 7: Commit**

```bash
git add src/storage/db/schema.ts src/storage/db/migrations.ts src/storage/db/migrations.test.ts
git commit -m "feat(storage): IDB v3 — bookmarks store + by-book index"
```

---

### Task 3: Storage — `BookmarksRepository`

**Files:**
- Create: `src/storage/repositories/bookmarks.ts`
- Create: `src/storage/repositories/bookmarks.test.ts`
- Modify: `src/storage/index.ts`

> **Strategy:** Mirror the existing `readingProgress` repo pattern: validating reads via `normalizeBookmark`, soft-drop corrupt records. Add `add`, `patch`, `delete`, `listByBook` (newest-first), `deleteByBook`. The `patch` method is needed for the optimistic-then-snippet flow (Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// src/storage/repositories/bookmarks.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createBookmarksRepository } from './bookmarks';
import { BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import { BOOKMARKS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-bm-${crypto.randomUUID()}`);
});

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: BookmarkId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
    snippet: null,
    sectionTitle: null,
    createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z'),
    ...overrides,
  };
}

describe('BookmarksRepository', () => {
  it('add → listByBook returns the bookmark', async () => {
    const repo = createBookmarksRepository(db);
    const b = makeBookmark();
    await repo.add(b);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(b.id);
  });

  it('listByBook returns newest-first', async () => {
    const repo = createBookmarksRepository(db);
    await repo.add(makeBookmark({ createdAt: IsoTimestamp('2026-05-03T12:00:00.000Z') }));
    await repo.add(makeBookmark({ createdAt: IsoTimestamp('2026-05-03T13:00:00.000Z') }));
    await repo.add(makeBookmark({ createdAt: IsoTimestamp('2026-05-03T11:00:00.000Z') }));
    const list = await repo.listByBook(BookId('book-1'));
    expect(list.map((b) => b.createdAt)).toEqual([
      '2026-05-03T13:00:00.000Z',
      '2026-05-03T12:00:00.000Z',
      '2026-05-03T11:00:00.000Z',
    ]);
  });

  it('listByBook filters by bookId', async () => {
    const repo = createBookmarksRepository(db);
    await repo.add(makeBookmark({ bookId: BookId('book-1') }));
    await repo.add(makeBookmark({ bookId: BookId('book-2') }));
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.bookId).toBe('book-1');
  });

  it('delete removes a bookmark by id', async () => {
    const repo = createBookmarksRepository(db);
    const b = makeBookmark();
    await repo.add(b);
    await repo.delete(b.id);
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(0);
  });

  it('patch merges fields and persists', async () => {
    const repo = createBookmarksRepository(db);
    const b = makeBookmark({ snippet: null });
    await repo.add(b);
    await repo.patch(b.id, { snippet: 'patched text' });
    const list = await repo.listByBook(BookId('book-1'));
    expect(list[0]?.snippet).toBe('patched text');
    expect(list[0]?.id).toBe(b.id);
  });

  it('patch on missing id is a no-op', async () => {
    const repo = createBookmarksRepository(db);
    await expect(repo.patch(BookmarkId('nope'), { snippet: 'x' })).resolves.toBeUndefined();
  });

  it('deleteByBook removes only that book’s bookmarks', async () => {
    const repo = createBookmarksRepository(db);
    await repo.add(makeBookmark({ bookId: BookId('book-1') }));
    await repo.add(makeBookmark({ bookId: BookId('book-1') }));
    await repo.add(makeBookmark({ bookId: BookId('book-2') }));
    await repo.deleteByBook(BookId('book-1'));
    expect(await repo.listByBook(BookId('book-1'))).toHaveLength(0);
    expect(await repo.listByBook(BookId('book-2'))).toHaveLength(1);
  });

  it('listByBook drops corrupt records (missing anchor)', async () => {
    const repo = createBookmarksRepository(db);
    // Write a record directly that lacks anchor.kind
    await db.put(BOOKMARKS_STORE, {
      id: 'bad' as never,
      bookId: 'book-1' as never,
      anchor: { kind: 'no-such-kind' } as never,
      snippet: null,
      sectionTitle: null,
      createdAt: '2026-05-03T12:00:00.000Z' as never,
    });
    await repo.add(makeBookmark());
    const list = await repo.listByBook(BookId('book-1'));
    expect(list).toHaveLength(1); // bad record dropped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/storage/repositories/bookmarks.test.ts`
Expected: FAIL — `createBookmarksRepository` doesn't exist.

- [ ] **Step 3: Implement the repository**

```ts
// src/storage/repositories/bookmarks.ts
import { BookId, BookmarkId, IsoTimestamp, type LocationAnchor } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import type { BookwormDB } from '../db/open';
import { BOOKMARKS_STORE } from '../db/schema';

export type BookmarksRepository = {
  add(bookmark: Bookmark): Promise<void>;
  patch(id: BookmarkId, partial: Partial<Pick<Bookmark, 'snippet' | 'sectionTitle'>>): Promise<void>;
  delete(id: BookmarkId): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly Bookmark[]>;
  deleteByBook(bookId: BookId): Promise<void>;
};

function isValidAnchor(value: unknown): value is LocationAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'epub-cfi') {
    return typeof (value as { cfi?: unknown }).cfi === 'string';
  }
  if (v.kind === 'pdf') {
    return typeof (value as { page?: unknown }).page === 'number';
  }
  return false;
}

function normalizeBookmark(record: unknown): Bookmark | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Bookmark>;
  if (typeof r.id !== 'string' || typeof r.bookId !== 'string') return null;
  if (!isValidAnchor(r.anchor)) return null;
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

export function createBookmarksRepository(db: BookwormDB): BookmarksRepository {
  return {
    async add(bookmark) {
      await db.put(BOOKMARKS_STORE, bookmark);
    },
    async patch(id, partial) {
      const existing = await db.get(BOOKMARKS_STORE, id);
      if (!existing) return;
      const next: Bookmark = { ...existing, ...partial };
      await db.put(BOOKMARKS_STORE, next);
    },
    async delete(id) {
      await db.delete(BOOKMARKS_STORE, id);
    },
    async listByBook(bookId) {
      const tx = db.transaction(BOOKMARKS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      const valid = records
        .map(normalizeBookmark)
        .filter((b): b is Bookmark => b !== null);
      // Newest-first
      return valid.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOKMARKS_STORE, 'readwrite');
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

Append to `src/storage/index.ts`:

```ts
export {
  createBookmarksRepository,
  type BookmarksRepository,
} from './repositories/bookmarks';
```

- [ ] **Step 5: Run repository tests**

Run: `pnpm test --run src/storage/repositories/bookmarks.test.ts`
Expected: PASS — all 8 tests.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/storage/repositories/bookmarks.ts src/storage/repositories/bookmarks.test.ts src/storage/index.ts
git commit -m "feat(storage): BookmarksRepository with validating reads + cascade delete"
```

---

### Task 4: Wiring — add `bookmarksRepo` to `Wiring`

**Files:**
- Modify: `src/features/library/wiring.ts`

> **Strategy:** Just plumbing. The repo has no dependencies beyond `db`, mirrors how `readingProgressRepo` is wired.

- [ ] **Step 1: Edit `src/features/library/wiring.ts`**

Update the import block to add `BookmarksRepository` + `createBookmarksRepository`:

Find:

```ts
import {
  type BookwormDB,
  createBookRepository,
  createOpfsAdapter,
  createSettingsRepository,
  createReadingProgressRepository,
  createReaderPreferencesRepository,
  type OpfsAdapter,
  type BookRepository,
  type SettingsRepository,
  type ReadingProgressRepository,
  type ReaderPreferencesRepository,
} from '@/storage';
```

Replace with:

```ts
import {
  type BookwormDB,
  createBookRepository,
  createOpfsAdapter,
  createSettingsRepository,
  createReadingProgressRepository,
  createReaderPreferencesRepository,
  createBookmarksRepository,
  type OpfsAdapter,
  type BookRepository,
  type SettingsRepository,
  type ReadingProgressRepository,
  type ReaderPreferencesRepository,
  type BookmarksRepository,
} from '@/storage';
```

In the `Wiring` type, add the field:

Find:

```ts
  readonly readerPreferencesRepo: ReaderPreferencesRepository;
  readonly importDeps: Omit<ImportInput, 'file'>;
```

Replace with:

```ts
  readonly readerPreferencesRepo: ReaderPreferencesRepository;
  readonly bookmarksRepo: BookmarksRepository;
  readonly importDeps: Omit<ImportInput, 'file'>;
```

In `createWiring`, construct it:

Find:

```ts
  const readerPreferencesRepo = createReaderPreferencesRepository(db);
```

Add directly below:

```ts
  const bookmarksRepo = createBookmarksRepository(db);
```

In the return object, add `bookmarksRepo` next to the other repos:

Find:

```ts
    readingProgressRepo,
    readerPreferencesRepo,
    importDeps,
```

Replace with:

```ts
    readingProgressRepo,
    readerPreferencesRepo,
    bookmarksRepo,
    importDeps,
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 3: Run unit suite to confirm no regressions**

Run: `pnpm test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/library/wiring.ts
git commit -m "feat(wiring): expose bookmarksRepo on Wiring"
```

---

### Task 5: Reader — `BookReader` + `ReaderViewExposedState` extractor methods

**Files:**
- Modify: `src/domain/reader/types.ts`
- Modify: `src/features/reader/ReaderView.tsx`

> **Strategy:** Add three new members to the contract. `getCurrentAnchor` becomes a passthrough on the exposed state (returns `null` when adapter not ready). `getSnippetAt` is async, `getSectionTitleAt` is sync — both best-effort. ReaderView stub-implements all three by passing to the adapter (real adapter implementations come in Tasks 6 + 7).

- [ ] **Step 1: Update `BookReader` interface**

In `src/domain/reader/types.ts`, find:

```ts
export interface BookReader {
  open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }>;
  goToAnchor(anchor: LocationAnchor): Promise<void>;
  getCurrentAnchor(): LocationAnchor;
  applyPreferences(prefs: ReaderPreferences): void;
  onLocationChange(listener: LocationChangeListener): () => void;
  destroy(): void;
}
```

Replace with:

```ts
export interface BookReader {
  open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }>;
  goToAnchor(anchor: LocationAnchor): Promise<void>;
  getCurrentAnchor(): LocationAnchor;
  applyPreferences(prefs: ReaderPreferences): void;
  onLocationChange(listener: LocationChangeListener): () => void;
  // Best-effort extractors used by Bookmarks (and later Highlights).
  // Both return null on failure (image-only PDF page, unresolvable CFI, etc.).
  getSnippetAt(anchor: LocationAnchor): Promise<string | null>;
  getSectionTitleAt(anchor: LocationAnchor): string | null;
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
  // Returns null when the adapter isn't ready or the anchor can't be resolved.
  readonly getCurrentAnchor: () => LocationAnchor | null;
  readonly getSnippetAt: (anchor: LocationAnchor) => Promise<string | null>;
  readonly getSectionTitleAt: (anchor: LocationAnchor) => string | null;
};
```

- [ ] **Step 3: Implement the passthroughs in `ReaderView`**

Inside the `ReaderView` component, find the `goToAnchor` `useCallback` block:

```tsx
  const goToAnchor = useCallback((anchor: LocationAnchor) => {
    void adapterRef.current?.goToAnchor(anchor);
    ...
  }, []);
```

Add three more `useCallback` blocks immediately after it:

```tsx
  const getCurrentAnchor = useCallback((): LocationAnchor | null => {
    if (!adapterRef.current) return null;
    try {
      return adapterRef.current.getCurrentAnchor();
    } catch {
      return null;
    }
  }, []);

  const getSnippetAt = useCallback(
    (anchor: LocationAnchor): Promise<string | null> => {
      if (!adapterRef.current) return Promise.resolve(null);
      return adapterRef.current.getSnippetAt(anchor).catch(() => null);
    },
    [],
  );

  const getSectionTitleAt = useCallback(
    (anchor: LocationAnchor): string | null => {
      if (!adapterRef.current) return null;
      try {
        return adapterRef.current.getSectionTitleAt(anchor);
      } catch {
        return null;
      }
    },
    [],
  );
```

Then update the `onStateChange` payload effect — find:

```tsx
    onStateChange({
      toc: state.context.toc,
      currentEntryId,
      prefs,
      goToAnchor,
      applyPreferences,
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
    });
```

And update its dependency array:

Find:

```tsx
  }, [onStateChange, state.context.toc, prefs, currentEntryId, goToAnchor, applyPreferences]);
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
  ]);
```

- [ ] **Step 4: Type-check (will fail; expected)**

Run: `pnpm type-check`
Expected: FAIL — `EpubReaderAdapter` and `PdfReaderAdapter` don't yet implement the new methods. That's fine — Tasks 6 and 7 add them. To unblock the build temporarily, add stubs:

In `src/features/reader/epub/EpubReaderAdapter.ts`, find `destroy(): void {` and add immediately above it:

```ts
  getSnippetAt(_anchor: LocationAnchor): Promise<string | null> {
    return Promise.resolve(null);
  }

  getSectionTitleAt(_anchor: LocationAnchor): string | null {
    return null;
  }
```

In `src/features/reader/pdf/PdfReaderAdapter.ts`, find `destroy(): void {` and add immediately above it:

```ts
  getSnippetAt(_anchor: LocationAnchor): Promise<string | null> {
    return Promise.resolve(null);
  }

  getSectionTitleAt(_anchor: LocationAnchor): string | null {
    return null;
  }
```

- [ ] **Step 5: Type-check passes**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Run unit suite**

Run: `pnpm test`
Expected: all tests pass (the stubs return null which is the contract).

- [ ] **Step 7: Commit**

```bash
git add src/domain/reader/types.ts src/features/reader/ReaderView.tsx src/features/reader/epub/EpubReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.ts
git commit -m "feat(reader): add getSnippetAt + getSectionTitleAt to BookReader contract (stubs)"
```

---

### Task 6: EPUB extractors — cache visible-range text + section index

**Files:**
- Modify: `src/features/reader/epub/EpubReaderAdapter.ts`

> **Strategy:** foliate-js's `'relocate'` event already fires with `{ range, index }` describing the visible content. Cache the first 80 chars of `range.toString()` and the section index on each relocate. The extractor methods then check whether the requested `anchor` matches the cached CFI — if yes, return the cached values; if no, return null. (Bookmarks always extract at the current location, so the cache hit rate is effectively 100%.)

- [ ] **Step 1: Add cache fields**

In `src/features/reader/epub/EpubReaderAdapter.ts`, find the existing private fields (look for the `private` declarations at the top of the class):

```ts
  private currentCfi: string | null = null;
```

Add directly below:

```ts
  private currentSnippet: string | null = null;
  private currentSectionIndex: number = -1;
  private currentTocEntries: readonly TocEntry[] = [];
```

- [ ] **Step 2: Update the relocate handler to populate the cache**

Look for the relocate listener inside `open()` — it currently sets `this.currentCfi` and emits a location change. Find this block:

```ts
    view.addEventListener('relocate', (e: CustomEvent) => {
      const cfi = e.detail.cfi;
      if (typeof cfi !== 'string' || cfi.length === 0) return;
      this.currentCfi = cfi;
      const anchor: LocationAnchor = { kind: 'epub-cfi', cfi };
```

(The exact line will vary slightly. Use `grep -n "addEventListener\('relocate'" src/features/reader/epub/EpubReaderAdapter.ts` to locate it.)

Just after `this.currentCfi = cfi;`, add:

```ts
      // Cache snippet + section index for getSnippetAt / getSectionTitleAt.
      const detail = e.detail as { range?: Range; index?: number };
      if (typeof detail.index === 'number') this.currentSectionIndex = detail.index;
      if (detail.range && typeof detail.range.toString === 'function') {
        const text = detail.range.toString().replace(/\s+/g, ' ').trim();
        this.currentSnippet = text.length > 0 ? text.slice(0, 80) : null;
      } else {
        this.currentSnippet = null;
      }
```

- [ ] **Step 3: Cache the TOC at open time**

Find the `return { toc: this.extractToc(...) }` line at the end of `open()`. Replace with:

```ts
    const toc = this.extractToc(view.book?.toc ?? []);
    this.currentTocEntries = toc;
    return { toc };
```

- [ ] **Step 4: Implement the extractors**

Replace the stub `getSnippetAt` and `getSectionTitleAt` (added in Task 5) with:

```ts
  getSnippetAt(anchor: LocationAnchor): Promise<string | null> {
    if (anchor.kind !== 'epub-cfi') return Promise.resolve(null);
    if (anchor.cfi === this.currentCfi) return Promise.resolve(this.currentSnippet);
    // Non-current anchors: best-effort — we don't navigate to extract text.
    return Promise.resolve(null);
  }

  getSectionTitleAt(anchor: LocationAnchor): string | null {
    if (anchor.kind !== 'epub-cfi') return null;
    if (this.currentSectionIndex < 0) return null;
    // Walk the TOC entries to find one whose anchor's CFI starts with the
    // current section's spine prefix. The TOC entries store href-based CFIs
    // like "section-2.xhtml" — we can't compare them directly, so fall back
    // to a simpler heuristic: pick the entry whose order matches the
    // currentSectionIndex when entries are filtered to depth 0.
    const topLevel = this.currentTocEntries.filter((e) => e.depth === 0);
    return topLevel[this.currentSectionIndex]?.title ?? null;
  }
```

> Note: this depth-0-by-index heuristic is good enough for the v1 — it correctly resolves chapter titles for typical EPUBs. A more robust resolver would walk `view.book.sections` and compare paths; we can revisit if real-world books mismatch.

- [ ] **Step 5: Reset cache in `destroy`**

In `destroy()`, immediately before `this.destroyed = true;`, the destructor already wipes refs. Add cache resets after the existing `listeners.clear()` call:

```ts
    this.currentSnippet = null;
    this.currentSectionIndex = -1;
    this.currentTocEntries = [];
```

- [ ] **Step 6: Build + sanity smoke**

Run: `pnpm build`
Expected: clean build.

(No new unit test for this task — foliate-js requires a real EPUB blob. The extractor logic is exercised end-to-end by the bookmarks-add-list-jump E2E in Task 16.)

- [ ] **Step 7: Commit**

```bash
git add src/features/reader/epub/EpubReaderAdapter.ts
git commit -m "feat(reader/epub): cache visible snippet + section index for bookmark extractors"
```

---

### Task 7: PDF extractors — page text + TOC walk

**Files:**
- Modify: `src/features/reader/pdf/PdfReaderAdapter.ts`

> **Strategy:** PDF anchors are page-based, so `getSnippetAt` is a per-call `getPage(N).getTextContent()`. Slice to ~80 chars near `anchor.offset` if present (we don't currently set offset, but be ready). `getSectionTitleAt` walks the TOC by page; falls back to `"Page N"`.

- [ ] **Step 1: Cache TOC at open time**

In `src/features/reader/pdf/PdfReaderAdapter.ts`, add a private field next to the others:

```ts
  private currentTocEntries: readonly TocEntry[] = [];
```

Find the end of `open()` — it currently calls `await this.extractToc()` and returns `{ toc }`. Replace:

```ts
    const toc = await this.extractToc();

    return { toc };
```

With:

```ts
    const toc = await this.extractToc();
    this.currentTocEntries = toc;
    return { toc };
```

- [ ] **Step 2: Implement the extractors**

Replace the stub `getSnippetAt` / `getSectionTitleAt` (added in Task 5) with:

```ts
  async getSnippetAt(anchor: LocationAnchor): Promise<string | null> {
    if (anchor.kind !== 'pdf') return null;
    if (!this.pdfDoc) return null;
    if (anchor.page < 1 || anchor.page > this.pageCount) return null;
    try {
      const page = await this.pdfDoc.getPage(anchor.page);
      const textContent = await page.getTextContent();
      const items = textContent.items as { str?: string }[];
      const joined = items
        .map((i) => i.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (joined.length === 0) return null;
      return joined.slice(0, 80);
    } catch {
      return null;
    }
  }

  getSectionTitleAt(anchor: LocationAnchor): string | null {
    if (anchor.kind !== 'pdf') return null;
    // Find the deepest TOC entry whose page is ≤ anchor.page.
    let best: TocEntry | null = null;
    for (const entry of this.currentTocEntries) {
      if (entry.anchor.kind !== 'pdf') continue;
      if (entry.anchor.page <= anchor.page) {
        if (!best || (best.anchor.kind === 'pdf' && entry.anchor.page > best.anchor.page)) {
          best = entry;
        }
      }
    }
    if (best) return best.title;
    return `Page ${String(anchor.page)}`;
  }
```

- [ ] **Step 3: Reset cache in `destroy`**

In `destroy()`, after `this.scrollPlaceholders = [];`, add:

```ts
    this.currentTocEntries = [];
```

- [ ] **Step 4: Type-check + build**

Run: `pnpm type-check && pnpm build`
Expected: clean.

- [ ] **Step 5: Sanity test the snippet extractor inline**

Add a tiny unit test that exercises only the section-title fallback (no PDF blob needed):

Append to `src/features/reader/pdf/PdfReaderAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PdfReaderAdapter } from './PdfReaderAdapter';

describe('PdfReaderAdapter.getSectionTitleAt fallback', () => {
  it('returns "Page N" when there is no TOC', () => {
    const root = document.createElement('div');
    const adapter = new PdfReaderAdapter(root);
    // currentTocEntries is empty by default; no need to open a real PDF.
    expect(adapter.getSectionTitleAt({ kind: 'pdf', page: 7 })).toBe('Page 7');
    expect(adapter.getSectionTitleAt({ kind: 'epub-cfi', cfi: 'x' })).toBeNull();
  });
});
```

Run: `pnpm test --run src/features/reader/pdf/PdfReaderAdapter.test.ts`
Expected: PASS (existing tests + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.test.ts
git commit -m "feat(reader/pdf): page text snippet + TOC-walk section title for bookmarks"
```

---

### Task 8: Shared — `relativeTime` helper

**Files:**
- Create: `src/shared/text/relativeTime.ts`
- Create: `src/shared/text/relativeTime.test.ts`

> **Strategy:** Pure function, no deps. Used by `BookmarksPanel`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/text/relativeTime.test.ts
import { describe, it, expect } from 'vitest';
import { IsoTimestamp } from '@/domain';
import { relativeTime } from './relativeTime';

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function ts(offsetMs: number): import('@/domain').IsoTimestamp {
  return IsoTimestamp(new Date(NOW - offsetMs).toISOString());
}

describe('relativeTime', () => {
  it('"just now" for <60s', () => {
    expect(relativeTime(ts(0), NOW)).toBe('just now');
    expect(relativeTime(ts(59_000), NOW)).toBe('just now');
  });

  it('"Nm ago" for <1h', () => {
    expect(relativeTime(ts(60_000), NOW)).toBe('1m ago');
    expect(relativeTime(ts(45 * 60_000), NOW)).toBe('45m ago');
  });

  it('"Nh ago" for <24h', () => {
    expect(relativeTime(ts(60 * 60_000), NOW)).toBe('1h ago');
    expect(relativeTime(ts(23 * 60 * 60_000), NOW)).toBe('23h ago');
  });

  it('"yesterday" for 24-48h', () => {
    expect(relativeTime(ts(24 * 60 * 60_000), NOW)).toBe('yesterday');
    expect(relativeTime(ts(47 * 60 * 60_000), NOW)).toBe('yesterday');
  });

  it('"Nd ago" for 2-7d', () => {
    expect(relativeTime(ts(2 * 24 * 60 * 60_000), NOW)).toBe('2d ago');
    expect(relativeTime(ts(6 * 24 * 60 * 60_000), NOW)).toBe('6d ago');
  });

  it('absolute date for ≥7d', () => {
    expect(relativeTime(ts(8 * 24 * 60 * 60_000), NOW)).toMatch(/Apr|2026/);
  });

  it('handles future timestamps as "just now"', () => {
    expect(relativeTime(ts(-1000), NOW)).toBe('just now');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/shared/text/relativeTime.test.ts`
Expected: FAIL — `relativeTime` doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/shared/text/relativeTime.ts
import type { IsoTimestamp } from '@/domain';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeTime(timestamp: IsoTimestamp, nowMs: number = Date.now()): string {
  const then = new Date(timestamp).getTime();
  const diff = nowMs - then;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${String(Math.floor(diff / MIN))}m ago`;
  if (diff < DAY) return `${String(Math.floor(diff / HOUR))}h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < WEEK) return `${String(Math.floor(diff / DAY))}d ago`;
  // ≥7d: short month + day, year if not current
  const date = new Date(then);
  const now = new Date(nowMs);
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test --run src/shared/text/relativeTime.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/text/relativeTime.ts src/shared/text/relativeTime.test.ts
git commit -m "feat(shared): relativeTime helper for bookmark + future annotation timestamps"
```

---

### Task 9: `BookmarksPanel` component

**Files:**
- Create: `src/features/reader/BookmarksPanel.tsx`
- Create: `src/features/reader/bookmarks-panel.css`
- Create: `src/features/reader/BookmarksPanel.test.tsx`

> **Strategy:** Pure presentation. Mirrors `TocPanel` shape. Empty state when list is empty. Row layout: section title + relative time on top line, snippet on second line (hidden if null), delete `[×]` on the right.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/reader/BookmarksPanel.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BookmarksPanel } from './BookmarksPanel';
import { BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';

afterEach(cleanup);

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function bm(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: BookmarkId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' },
    snippet: 'A short bookmarked passage of text.',
    sectionTitle: 'Chapter 1',
    createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    ...overrides,
  };
}

describe('BookmarksPanel', () => {
  it('renders rows with section title, relative time, and snippet', () => {
    render(
      <BookmarksPanel
        bookmarks={[bm({ sectionTitle: 'Chapter 1', snippet: 'Hello world' })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('Hello world')).toBeDefined();
    expect(screen.getByText('just now')).toBeDefined();
  });

  it('shows empty state when no bookmarks', () => {
    render(
      <BookmarksPanel bookmarks={[]} onSelect={() => undefined} onDelete={() => undefined} />,
    );
    expect(screen.getByText(/No bookmarks yet/i)).toBeDefined();
  });

  it('hides the snippet line when snippet is null', () => {
    const { container } = render(
      <BookmarksPanel
        bookmarks={[bm({ snippet: null })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(container.querySelector('.bookmarks-panel__snippet')).toBeNull();
  });

  it('renders "—" when sectionTitle is null', () => {
    render(
      <BookmarksPanel
        bookmarks={[bm({ sectionTitle: null })]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText('—')).toBeDefined();
  });

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn();
    const target = bm();
    render(
      <BookmarksPanel
        bookmarks={[target]}
        onSelect={onSelect}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chapter 1/i }));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it('calls onDelete when [×] is clicked, not onSelect', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const target = bm();
    render(
      <BookmarksPanel
        bookmarks={[target]}
        onSelect={onSelect}
        onDelete={onDelete}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove bookmark/i));
    expect(onDelete).toHaveBeenCalledWith(target);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders bookmarks in the order provided (caller sorts)', () => {
    const a = bm({ sectionTitle: 'Alpha' });
    const b = bm({ sectionTitle: 'Beta' });
    const c = bm({ sectionTitle: 'Gamma' });
    render(
      <BookmarksPanel
        bookmarks={[c, a, b]}
        onSelect={() => undefined}
        onDelete={() => undefined}
        nowMs={NOW}
      />,
    );
    const titles = Array.from(document.querySelectorAll('.bookmarks-panel__section')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Gamma', 'Alpha', 'Beta']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/BookmarksPanel.test.tsx`
Expected: FAIL — `BookmarksPanel` doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/reader/BookmarksPanel.tsx
import type { Bookmark } from '@/domain/annotations/types';
import { relativeTime } from '@/shared/text/relativeTime';
import './bookmarks-panel.css';

type Props = {
  readonly bookmarks: readonly Bookmark[];
  readonly onSelect: (b: Bookmark) => void;
  readonly onDelete: (b: Bookmark) => void;
  readonly nowMs?: number;
};

export function BookmarksPanel({ bookmarks, onSelect, onDelete, nowMs }: Props) {
  if (bookmarks.length === 0) {
    return (
      <aside className="bookmarks-panel bookmarks-panel--empty" aria-label="Bookmarks">
        <p className="bookmarks-panel__empty-icon" aria-hidden="true">
          ★
        </p>
        <p className="bookmarks-panel__empty-title">No bookmarks yet</p>
        <p className="bookmarks-panel__empty-hint">Tap ★ in the toolbar to mark a spot.</p>
      </aside>
    );
  }
  return (
    <aside className="bookmarks-panel" aria-label="Bookmarks">
      <ul className="bookmarks-panel__list">
        {bookmarks.map((b) => (
          <li key={b.id} className="bookmarks-panel__item">
            <button
              type="button"
              className="bookmarks-panel__row"
              aria-label={b.sectionTitle ?? '—'}
              onClick={() => {
                onSelect(b);
              }}
            >
              <span className="bookmarks-panel__top">
                <span className="bookmarks-panel__star" aria-hidden="true">
                  ★
                </span>
                <span className="bookmarks-panel__section">{b.sectionTitle ?? '—'}</span>
                <span className="bookmarks-panel__time">{relativeTime(b.createdAt, nowMs)}</span>
              </span>
              {b.snippet !== null ? (
                <span className="bookmarks-panel__snippet">{b.snippet}</span>
              ) : null}
            </button>
            <button
              type="button"
              className="bookmarks-panel__delete"
              aria-label="Remove bookmark"
              onClick={() => {
                onDelete(b);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 4: Add the CSS**

```css
/* src/features/reader/bookmarks-panel.css */
.bookmarks-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
}

.bookmarks-panel__list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.bookmarks-panel__item {
  position: relative;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--color-border-subtle);
}

.bookmarks-panel__row {
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

.bookmarks-panel__row:hover {
  background: var(--color-surface-hover, var(--color-surface));
}

.bookmarks-panel__top {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.bookmarks-panel__star {
  color: var(--color-accent, #b8884c);
  font-size: var(--text-sm);
  flex: 0 0 auto;
}

.bookmarks-panel__section {
  font-weight: 600;
  font-size: var(--text-sm);
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmarks-panel__time {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  flex: 0 0 auto;
}

.bookmarks-panel__snippet {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmarks-panel__delete {
  flex: 0 0 auto;
  width: 32px;
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.bookmarks-panel__item:hover .bookmarks-panel__delete,
.bookmarks-panel__delete:focus-visible {
  opacity: 1;
}

@media (hover: none) {
  /* Touch devices: always show delete affordance. */
  .bookmarks-panel__delete {
    opacity: 1;
  }
}

.bookmarks-panel--empty {
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-muted);
}

.bookmarks-panel__empty-icon {
  font-size: 32px;
  margin: 0 0 var(--space-3);
  color: var(--color-accent, #b8884c);
}

.bookmarks-panel__empty-title {
  font-weight: 600;
  margin: 0 0 var(--space-1);
  color: var(--color-text);
}

.bookmarks-panel__empty-hint {
  margin: 0;
  font-size: var(--text-sm);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test --run src/features/reader/BookmarksPanel.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/BookmarksPanel.tsx src/features/reader/bookmarks-panel.css src/features/reader/BookmarksPanel.test.tsx
git commit -m "feat(reader): BookmarksPanel — section + snippet + relative time + delete"
```

---

### Task 10: `useBookmarks` hook

**Files:**
- Create: `src/features/reader/workspace/useBookmarks.ts`
- Create: `src/features/reader/workspace/useBookmarks.test.ts`

> **Strategy:** Owns the in-memory list. Initial load via `repo.listByBook`. `add` is optimistic (snippet:null) then patches with the async snippet result. `remove` is optimistic and rolls back on failure. Re-keys on `bookId` change.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/reader/workspace/useBookmarks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBookmarks } from './useBookmarks';
import { BookId, BookmarkId, IsoTimestamp, type LocationAnchor } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import type { BookmarksRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';

function fakeRepo(initial: Bookmark[] = []): BookmarksRepository {
  let store = new Map<string, Bookmark>(initial.map((b) => [b.id, b]));
  return {
    add: vi.fn(async (b) => {
      store.set(b.id, b);
    }),
    patch: vi.fn(async (id, partial) => {
      const existing = store.get(id);
      if (!existing) return;
      store.set(id, { ...existing, ...partial });
    }),
    delete: vi.fn(async (id) => {
      store.delete(id);
    }),
    listByBook: vi.fn(async (bookId) =>
      [...store.values()]
        .filter((b) => b.bookId === bookId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    ),
    deleteByBook: vi.fn(async (bookId) => {
      for (const [id, b] of store) if (b.bookId === bookId) store.delete(id);
    }),
  };
}

const ANCHOR: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16)' };

function fakeReaderState(overrides: Partial<ReaderViewExposedState> = {}): ReaderViewExposedState {
  return {
    toc: null,
    currentEntryId: undefined,
    prefs: null,
    goToAnchor: () => undefined,
    applyPreferences: () => undefined,
    getCurrentAnchor: () => ANCHOR,
    getSnippetAt: () => Promise.resolve('a fresh snippet'),
    getSectionTitleAt: () => 'Chapter 4',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('useBookmarks', () => {
  it('initial load fetches by bookId', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledWith('b1');
    });
    expect(result.current.list).toEqual([]);
  });

  it('add inserts an optimistic bookmark with snippet:null then patches with extracted snippet', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalled());

    await act(async () => {
      await result.current.add();
    });

    // Initial optimistic insert
    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0]?.sectionTitle).toBe('Chapter 4');

    // After snippet resolves
    await waitFor(() => {
      expect(result.current.list[0]?.snippet).toBe('a fresh snippet');
    });
    expect(repo.add).toHaveBeenCalled();
    expect(repo.patch).toHaveBeenCalledWith(
      result.current.list[0]?.id,
      expect.objectContaining({ snippet: 'a fresh snippet' }),
    );
  });

  it('add no-ops when readerState is null', async () => {
    const repo = fakeRepo();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState: null }),
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalled());
    await act(async () => {
      await result.current.add();
    });
    expect(result.current.list).toHaveLength(0);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('add no-ops when getCurrentAnchor returns null', async () => {
    const repo = fakeRepo();
    const readerState = fakeReaderState({ getCurrentAnchor: () => null });
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalled());
    await act(async () => {
      await result.current.add();
    });
    expect(result.current.list).toHaveLength(0);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('add rolls back the optimistic insert when repo.add throws', async () => {
    const repo = fakeRepo();
    repo.add = vi.fn(() => Promise.reject(new Error('IDB explode')));
    const readerState = fakeReaderState();
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState }),
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalled());
    await act(async () => {
      await result.current.add();
    });
    expect(result.current.list).toHaveLength(0);
  });

  it('remove is optimistic and rolls back on failure', async () => {
    const initial: Bookmark = {
      id: BookmarkId('keep'),
      bookId: BookId('b1'),
      anchor: ANCHOR,
      snippet: null,
      sectionTitle: 'Chapter 1',
      createdAt: IsoTimestamp('2026-05-03T11:00:00.000Z'),
    };
    const repo = fakeRepo([initial]);
    repo.delete = vi.fn(() => Promise.reject(new Error('delete failed')));
    const { result } = renderHook(() =>
      useBookmarks({ bookId: BookId('b1'), repo, readerState: fakeReaderState() }),
    );
    await waitFor(() => expect(result.current.list).toHaveLength(1));
    await act(async () => {
      await result.current.remove(initial);
    });
    // Rolled back
    expect(result.current.list).toHaveLength(1);
  });

  it('switching bookId reloads the list', async () => {
    const repo = fakeRepo();
    const { result, rerender } = renderHook(
      ({ id }: { id: ReturnType<typeof BookId> }) =>
        useBookmarks({ bookId: id, repo, readerState: null }),
      { initialProps: { id: BookId('b1') } },
    );
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalledWith('b1'));
    rerender({ id: BookId('b2') });
    await waitFor(() => expect(repo.listByBook).toHaveBeenCalledWith('b2'));
    void result;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/workspace/useBookmarks.test.ts`
Expected: FAIL — `useBookmarks` doesn't exist.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/reader/workspace/useBookmarks.ts
import { useCallback, useEffect, useState } from 'react';
import { BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import type { BookmarksRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';

export type UseBookmarksHandle = {
  readonly list: readonly Bookmark[];
  readonly add: () => Promise<void>;
  readonly remove: (b: Bookmark) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly repo: BookmarksRepository;
  readonly readerState: ReaderViewExposedState | null;
};

function sortNewestFirst(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export function useBookmarks({ bookId, repo, readerState }: Options): UseBookmarksHandle {
  const [list, setList] = useState<readonly Bookmark[]>([]);

  // Re-load whenever bookId changes.
  useEffect(() => {
    let cancelled = false;
    void repo.listByBook(bookId).then((records) => {
      if (!cancelled) setList(sortNewestFirst(records));
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, repo]);

  const add = useCallback(async (): Promise<void> => {
    if (!readerState) return;
    const anchor = readerState.getCurrentAnchor();
    if (!anchor) return;
    const sectionTitle = readerState.getSectionTitleAt(anchor);
    const optimistic: Bookmark = {
      id: BookmarkId(crypto.randomUUID()),
      bookId,
      anchor,
      snippet: null,
      sectionTitle,
      createdAt: IsoTimestamp(new Date().toISOString()),
    };
    setList((prev) => sortNewestFirst([optimistic, ...prev]));
    try {
      await repo.add(optimistic);
    } catch (err) {
      console.warn('[bookmarks] add failed; rolling back', err);
      setList((prev) => prev.filter((b) => b.id !== optimistic.id));
      return;
    }
    // Async snippet patch
    void readerState.getSnippetAt(anchor).then(async (snippet) => {
      if (snippet === null) return;
      setList((prev) => prev.map((b) => (b.id === optimistic.id ? { ...b, snippet } : b)));
      try {
        await repo.patch(optimistic.id, { snippet });
      } catch (err) {
        console.warn('[bookmarks] snippet patch failed', err);
      }
    });
  }, [bookId, repo, readerState]);

  const remove = useCallback(
    async (b: Bookmark): Promise<void> => {
      setList((prev) => prev.filter((x) => x.id !== b.id));
      try {
        await repo.delete(b.id);
      } catch (err) {
        console.warn('[bookmarks] delete failed; restoring', err);
        setList((prev) => sortNewestFirst([...prev, b]));
      }
    },
    [repo],
  );

  return { list, add, remove };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test --run src/features/reader/workspace/useBookmarks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/workspace/useBookmarks.ts src/features/reader/workspace/useBookmarks.test.ts
git commit -m "feat(reader): useBookmarks hook — optimistic add + async snippet patch + reload on book change"
```

---

### Task 11: `ReaderChrome` adds `★` button + pulse

**Files:**
- Modify: `src/features/reader/ReaderChrome.tsx`
- Modify: `src/features/reader/reader-chrome.css`
- Modify: `src/features/reader/ReaderChrome.test.tsx`

> **Strategy:** Always-add semantics, so the button has no toggled state. Calls `onAddBookmark` on click and applies a `.reader-chrome__bookmark--pulse` class for 250ms (cleared via `setTimeout`). Always visible on both viewports.

- [ ] **Step 1: Write the failing test**

Append to `src/features/reader/ReaderChrome.test.tsx`:

```tsx
import { fireEvent, act } from '@testing-library/react';

describe('ReaderChrome bookmark button', () => {
  it('renders ★ on both viewports and calls onAddBookmark', () => {
    const onAddBookmark = vi.fn();
    render(
      <ReaderChrome
        title="Test"
        onBack={() => undefined}
        onOpenToc={() => undefined}
        onOpenTypography={() => undefined}
        onToggleFocus={() => undefined}
        onAddBookmark={onAddBookmark}
      />,
    );
    fireEvent.click(screen.getByLabelText(/add bookmark/i));
    expect(onAddBookmark).toHaveBeenCalledOnce();
  });

  it('applies pulse class for ~250ms after a click', async () => {
    vi.useFakeTimers();
    try {
      const onAddBookmark = vi.fn();
      render(
        <ReaderChrome
          title="Test"
          onBack={() => undefined}
          onOpenToc={() => undefined}
          onOpenTypography={() => undefined}
          onToggleFocus={() => undefined}
          onAddBookmark={onAddBookmark}
        />,
      );
      const btn = screen.getByLabelText(/add bookmark/i);
      fireEvent.click(btn);
      expect(btn.className).toMatch(/--pulse/);
      act(() => {
        vi.advanceTimersByTime(260);
      });
      expect(btn.className).not.toMatch(/--pulse/);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

(Add a `vi` import to the existing `ReaderChrome.test.tsx` if it isn't already imported: `import { describe, it, expect, vi, ... } from 'vitest';`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/reader/ReaderChrome.test.tsx`
Expected: FAIL — `onAddBookmark` prop not handled.

- [ ] **Step 3: Add the prop + button + pulse**

In `src/features/reader/ReaderChrome.tsx`, replace the file with:

```tsx
import { useState } from 'react';
import './reader-chrome.css';

type Props = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly onOpenToc: () => void;
  readonly onOpenTypography: () => void;
  readonly onToggleFocus: () => void;
  readonly onAddBookmark: () => void;
  readonly showTocButton?: boolean;
  readonly showFocusToggle?: boolean;
  readonly focusMode?: 'normal' | 'focus';
};

export function ReaderChrome({
  title,
  subtitle,
  onBack,
  onOpenToc,
  onOpenTypography,
  onToggleFocus,
  onAddBookmark,
  showTocButton = true,
  showFocusToggle = false,
  focusMode = 'normal',
}: Props) {
  const [pulsing, setPulsing] = useState(false);
  const handleAddBookmark = (): void => {
    onAddBookmark();
    setPulsing(true);
    window.setTimeout(() => {
      setPulsing(false);
    }, 250);
  };
  return (
    <header className="reader-chrome">
      <button
        type="button"
        className="reader-chrome__back"
        onClick={onBack}
        aria-label="Back to library"
      >
        ← Library
      </button>
      <div className="reader-chrome__title" aria-live="polite">
        <span className="reader-chrome__title-main">{title}</span>
        {subtitle ? <span className="reader-chrome__title-sub"> — {subtitle}</span> : null}
      </div>
      <div className="reader-chrome__actions">
        {showFocusToggle ? (
          <button
            type="button"
            onClick={onToggleFocus}
            aria-label="Toggle focus mode"
            aria-pressed={focusMode === 'focus'}
            title={focusMode === 'focus' ? 'Exit focus mode (F)' : 'Enter focus mode (F)'}
          >
            {focusMode === 'focus' ? '⊞' : '⊟'}
          </button>
        ) : null}
        <button type="button" onClick={onOpenTypography} aria-label="Reader preferences">
          ⚙
        </button>
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
          <button type="button" onClick={onOpenToc} aria-label="Table of contents">
            ☰
          </button>
        ) : null}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Add pulse keyframe to the CSS**

Append to `src/features/reader/reader-chrome.css`:

```css
@keyframes reader-chrome-bookmark-pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

.reader-chrome__bookmark--pulse {
  animation: reader-chrome-bookmark-pulse 250ms var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .reader-chrome__bookmark--pulse {
    animation: none;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test --run src/features/reader/ReaderChrome.test.tsx`
Expected: PASS — existing tests + 2 new ones.

- [ ] **Step 6: Type-check**

Run: `pnpm type-check`
Expected: FAIL — `ReaderWorkspace` doesn't yet pass `onAddBookmark`. Will be fixed in Task 12. Add a temporary stub in `ReaderWorkspace.tsx`:

Find the `<ReaderChrome ... />` usage and add:

```tsx
          onAddBookmark={() => undefined}
```

(This will be replaced with the real wiring in Task 12 — committed separately.)

- [ ] **Step 7: Type-check passes**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/features/reader/ReaderChrome.tsx src/features/reader/reader-chrome.css src/features/reader/ReaderChrome.test.tsx src/features/reader/workspace/ReaderWorkspace.tsx
git commit -m "feat(reader): ReaderChrome ★ button + 250ms pulse animation"
```

---

### Task 12: Generalize `DesktopRail` + wire bookmarks into `ReaderWorkspace`

**Files:**
- Modify: `src/features/reader/workspace/DesktopRail.tsx`
- Modify: `src/features/reader/workspace/desktop-rail.css`
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx`
- Modify: `src/app/useReaderHost.ts`

> **Strategy:** This is the biggest single edit. Refactor `DesktopRail` to take a `tabs` descriptor, then in `ReaderWorkspace` build the two tabs (Contents + Bookmarks), wire the chrome's `onAddBookmark` to `bookmarks.add`, and route the same tab pattern into the mobile sheet via a small inline tab-header component.

- [ ] **Step 1: Refactor `DesktopRail`**

Replace the entire contents of `src/features/reader/workspace/DesktopRail.tsx`:

```tsx
import type { ReactNode } from 'react';
import './desktop-rail.css';

export type RailTab = {
  readonly key: string;
  readonly label: string;
  readonly badge?: number;
  readonly content: ReactNode;
};

type Props = {
  readonly tabs: readonly RailTab[];
  readonly activeKey: string;
  readonly onTabChange: (key: string) => void;
};

export function DesktopRail({ tabs, activeKey, onTabChange }: Props) {
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  return (
    <aside className="desktop-rail">
      <div className="desktop-rail__tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === active?.key}
            className={
              tab.key === active?.key
                ? 'desktop-rail__tab desktop-rail__tab--active'
                : 'desktop-rail__tab'
            }
            onClick={() => {
              onTabChange(tab.key);
            }}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 ? (
              <span className="desktop-rail__badge">{tab.badge}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="desktop-rail__panel">{active?.content}</div>
    </aside>
  );
}
```

- [ ] **Step 2: Add tab styles to `desktop-rail.css`**

Append to `src/features/reader/workspace/desktop-rail.css`:

```css
.desktop-rail {
  display: flex;
  flex-direction: column;
}

.desktop-rail__tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-subtle);
  flex: 0 0 auto;
}

.desktop-rail__tab {
  flex: 1 1 0;
  padding: var(--space-3) var(--space-2);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
}

.desktop-rail__tab:hover {
  color: var(--color-text);
}

.desktop-rail__tab--active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent, #b8884c);
  font-weight: 600;
}

.desktop-rail__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-accent, #b8884c);
  color: var(--color-bg);
  font-size: var(--text-xs);
  line-height: 1;
}

.desktop-rail__panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
```

- [ ] **Step 3: Add a small inline `RailTabHeader` for the mobile sheet**

Inside `src/features/reader/workspace/ReaderWorkspace.tsx`, add this component above the main `ReaderWorkspace` function (so the mobile sheet can re-use the same tab pattern):

```tsx
type SheetTab = { key: string; label: string; badge?: number };

function SheetTabHeader({
  tabs,
  activeKey,
  onTabChange,
}: {
  readonly tabs: readonly SheetTab[];
  readonly activeKey: string;
  readonly onTabChange: (key: string) => void;
}) {
  return (
    <div className="reader-workspace__sheet-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === activeKey}
          className={
            tab.key === activeKey
              ? 'reader-workspace__sheet-tab reader-workspace__sheet-tab--active'
              : 'reader-workspace__sheet-tab'
          }
          onClick={() => {
            onTabChange(tab.key);
          }}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 ? (
            <span className="reader-workspace__sheet-badge">{tab.badge}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
```

Append to `src/features/reader/workspace/workspace.css`:

```css
.reader-workspace__sheet-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-subtle);
  padding: 0 var(--space-3);
  flex: 0 0 auto;
}

.reader-workspace__sheet-tab {
  flex: 1 1 0;
  padding: var(--space-3) var(--space-2);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
}

.reader-workspace__sheet-tab--active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent, #b8884c);
  font-weight: 600;
}

.reader-workspace__sheet-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-accent, #b8884c);
  color: var(--color-bg);
  font-size: var(--text-xs);
  line-height: 1;
}
```

- [ ] **Step 4: Wire `useBookmarks` into the workspace**

In `src/features/reader/workspace/ReaderWorkspace.tsx`, update the imports at the top (add `useMemo`, `BookId`, `BookmarksRepository`, `BookmarksPanel`, `useBookmarks`):

Find the imports block and replace the existing imports with:

```tsx
import { useCallback, useMemo, useState } from 'react';
import { BookId, type BookFormat, type LocationAnchor } from '@/domain';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import type { BookmarksRepository } from '@/storage';
import { ReaderChrome } from '@/features/reader/ReaderChrome';
import { ReaderView, type ReaderViewExposedState } from '@/features/reader/ReaderView';
import { TocPanel } from '@/features/reader/TocPanel';
import { TypographyPanel } from '@/features/reader/TypographyPanel';
import { BookmarksPanel } from '@/features/reader/BookmarksPanel';
import { DesktopRail, type RailTab } from './DesktopRail';
import { MobileSheet } from './MobileSheet';
import { useFocusMode } from './useFocusMode';
import { useViewport } from './useViewport';
import { useBookmarks } from './useBookmarks';
import './workspace.css';
```

In the `Props` type, add `bookmarksRepo`:

Find:

```tsx
  readonly onFirstTimeHintShown: () => void;
};
```

Replace with:

```tsx
  readonly onFirstTimeHintShown: () => void;
  readonly bookmarksRepo: BookmarksRepository;
};
```

Inside the component, after the existing `useState` blocks, add the bookmarks hook + tab state:

Find:

```tsx
  const [activeSheet, setActiveSheet] = useState<'toc' | 'typography' | null>(null);
  const [readerState, setReaderState] = useState<ReaderViewExposedState | null>(null);
```

Add directly below:

```tsx
  const [activeRailTab, setActiveRailTab] = useState<'contents' | 'bookmarks'>('contents');
  const bookmarks = useBookmarks({
    bookId: BookId(props.bookId),
    repo: props.bookmarksRepo,
    readerState,
  });
```

Build the rail tabs as a memo so the `DesktopRail` re-renders on any meaningful change:

Find:

```tsx
  const isDesktop = viewport === 'desktop';
  const railToc =
    isDesktop && focus.mode === 'normal' ? (readerState?.toc ?? null) : null;
```

Replace with:

```tsx
  const isDesktop = viewport === 'desktop';

  const tocPanelContent = readerState?.toc ? (
    <TocPanel
      toc={readerState.toc}
      {...(readerState.currentEntryId !== undefined && {
        currentEntryId: readerState.currentEntryId,
      })}
      onSelect={(entry) => {
        readerState.goToAnchor(entry.anchor);
      }}
    />
  ) : (
    <aside className="toc-panel toc-panel--empty">
      <p>Loading…</p>
    </aside>
  );

  const bookmarksPanelContent = (
    <BookmarksPanel
      bookmarks={bookmarks.list}
      onSelect={(b) => {
        readerState?.goToAnchor(b.anchor);
      }}
      onDelete={(b) => {
        void bookmarks.remove(b);
      }}
    />
  );

  const railTabs = useMemo<readonly RailTab[]>(
    () => [
      { key: 'contents', label: 'Contents', content: tocPanelContent },
      {
        key: 'bookmarks',
        label: 'Bookmarks',
        badge: bookmarks.list.length,
        content: bookmarksPanelContent,
      },
    ],
    [tocPanelContent, bookmarksPanelContent, bookmarks.list.length],
  );

  const showRail = isDesktop && focus.mode === 'normal';

  const sheetTabs: readonly SheetTab[] = [
    { key: 'contents', label: 'Contents' },
    { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
  ];

  const handleAddBookmark = useCallback((): void => {
    void bookmarks.add();
  }, [bookmarks]);
```

Replace the existing `<ReaderChrome ... />` usage so `onAddBookmark` is wired:

Find the existing chrome block:

```tsx
      {focus.shouldRenderChrome ? (
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
          showTocButton={!isDesktop}
          showFocusToggle={isDesktop}
          focusMode={focus.mode}
          onAddBookmark={() => undefined}
        />
      ) : null}
```

Replace with:

```tsx
      {focus.shouldRenderChrome ? (
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
      ) : null}
```

Replace the body block (rail + reader-host):

Find:

```tsx
        {railToc && readerState ? (
          <DesktopRail
            toc={railToc}
            {...(readerState.currentEntryId !== undefined && {
              currentEntryId: readerState.currentEntryId,
            })}
            onSelect={(entry) => {
              readerState.goToAnchor(entry.anchor);
            }}
          />
        ) : null}
```

Replace with:

```tsx
        {showRail ? (
          <DesktopRail
            tabs={railTabs}
            activeKey={activeRailTab}
            onTabChange={(key) => {
              setActiveRailTab(key as 'contents' | 'bookmarks');
            }}
          />
        ) : null}
```

Replace the existing TOC sheet block with a tabbed sheet:

Find:

```tsx
      {!isDesktop && activeSheet === 'toc' && readerState?.toc ? (
        <MobileSheet
          onDismiss={() => {
            setActiveSheet(null);
          }}
        >
          <TocPanel
            toc={readerState.toc}
            {...(readerState.currentEntryId !== undefined && {
              currentEntryId: readerState.currentEntryId,
            })}
            onSelect={(entry) => {
              readerState.goToAnchor(entry.anchor);
              setActiveSheet(null);
            }}
          />
        </MobileSheet>
      ) : null}
```

Replace with:

```tsx
      {!isDesktop && activeSheet === 'toc' ? (
        <MobileSheet
          onDismiss={() => {
            setActiveSheet(null);
          }}
        >
          <SheetTabHeader
            tabs={sheetTabs}
            activeKey={activeRailTab}
            onTabChange={(key) => {
              setActiveRailTab(key as 'contents' | 'bookmarks');
            }}
          />
          {activeRailTab === 'contents' && readerState?.toc ? (
            <TocPanel
              toc={readerState.toc}
              {...(readerState.currentEntryId !== undefined && {
                currentEntryId: readerState.currentEntryId,
              })}
              onSelect={(entry) => {
                readerState.goToAnchor(entry.anchor);
                setActiveSheet(null);
              }}
            />
          ) : null}
          {activeRailTab === 'bookmarks' ? (
            <BookmarksPanel
              bookmarks={bookmarks.list}
              onSelect={(b) => {
                readerState?.goToAnchor(b.anchor);
                setActiveSheet(null);
              }}
              onDelete={(b) => {
                void bookmarks.remove(b);
              }}
            />
          ) : null}
        </MobileSheet>
      ) : null}
```

The typography sheet block stays as-is.

- [ ] **Step 5: Pass `bookmarksRepo` from `useReaderHost` through `App.tsx`**

In `src/app/useReaderHost.ts`, find the `ReaderHostHandle` type and add a field:

Find:

```ts
  findBook: (bookId: string) => Book | undefined;
};
```

Replace with:

```ts
  findBook: (bookId: string) => Book | undefined;
  bookmarksRepo: BookmarksRepository;
};
```

Add to imports at the top of `useReaderHost.ts`:

```ts
import type { BookmarksRepository } from '@/storage';
```

In the return statement at the bottom, add `bookmarksRepo: wiring.bookmarksRepo` to the returned object:

Find:

```ts
    findBook,
  };
}
```

Replace with:

```ts
    findBook,
    bookmarksRepo: wiring.bookmarksRepo,
  };
}
```

In `src/app/App.tsx`, find the `<ReaderWorkspace ... />` JSX block and add the new prop right next to the others:

Find:

```tsx
          onFirstTimeHintShown={reader.onFirstTimeHintShown}
        />
```

Replace with:

```tsx
          onFirstTimeHintShown={reader.onFirstTimeHintShown}
          bookmarksRepo={reader.bookmarksRepo}
        />
```

- [ ] **Step 6: Type-check + lint**

Run: `pnpm type-check && pnpm lint`
Expected: clean. (If lint flags `as 'contents' | 'bookmarks'` — that's intentional since the tab key arrives as a generic `string`. Should pass without warnings under the current rule set.)

- [ ] **Step 7: Run unit suite**

Run: `pnpm test`
Expected: all tests pass — including the existing `ReaderWorkspace.test.tsx` smoke tests (which only check chrome visibility).

The existing workspace test does `render(<ReaderWorkspace {...baseProps} />)` — `baseProps` doesn't include `bookmarksRepo`. Add a fake to `baseProps` in `src/features/reader/workspace/ReaderWorkspace.test.tsx`:

Find:

```ts
const baseProps = {
  bookId: 'b1',
  bookTitle: 'Test',
  bookFormat: 'epub' as const,
  onBack: () => undefined,
  loadBookForReader: () =>
    Promise.reject(new Error('test stub: loader not invoked in render-only checks')),
  createAdapter: () => {
    throw new Error('test stub: createAdapter not invoked in render-only checks');
  },
  onAnchorChange: () => undefined,
  onPreferencesChange: () => undefined,
  initialFocusMode: 'normal' as const,
  hasShownFirstTimeHint: true,
  onFocusModeChange: () => Promise.resolve(),
  onFirstTimeHintShown: () => undefined,
};
```

Replace with:

```ts
const fakeBookmarksRepo = {
  add: () => Promise.resolve(),
  patch: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  listByBook: () => Promise.resolve([]),
  deleteByBook: () => Promise.resolve(),
};

const baseProps = {
  bookId: 'b1',
  bookTitle: 'Test',
  bookFormat: 'epub' as const,
  onBack: () => undefined,
  loadBookForReader: () =>
    Promise.reject(new Error('test stub: loader not invoked in render-only checks')),
  createAdapter: () => {
    throw new Error('test stub: createAdapter not invoked in render-only checks');
  },
  onAnchorChange: () => undefined,
  onPreferencesChange: () => undefined,
  initialFocusMode: 'normal' as const,
  hasShownFirstTimeHint: true,
  onFocusModeChange: () => Promise.resolve(),
  onFirstTimeHintShown: () => undefined,
  bookmarksRepo: fakeBookmarksRepo,
};
```

Re-run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/reader/workspace/DesktopRail.tsx src/features/reader/workspace/desktop-rail.css src/features/reader/workspace/ReaderWorkspace.tsx src/features/reader/workspace/workspace.css src/features/reader/workspace/ReaderWorkspace.test.tsx src/app/useReaderHost.ts src/app/App.tsx
git commit -m "feat(reader): generalise rail to tabs, wire BookmarksPanel into workspace"
```

---

### Task 13: Cascade book removal to bookmarks

**Files:**
- Modify: `src/app/useReaderHost.ts`

> **Strategy:** When a book is removed via `onRemoveBook`, also delete its bookmarks.

- [ ] **Step 1: Update `onRemoveBook`**

Find the `onRemoveBook` block in `src/app/useReaderHost.ts`:

```ts
  const onRemoveBook = useCallback(
    (book: Book): void => {
      void (async () => {
        libraryStore.getState().removeBook(book.id);
        try {
          await wiring.bookRepo.delete(book.id);
          await wiring.opfs.removeRecursive(`books/${book.id}`);
          await wiring.readingProgressRepo.delete(book.id);
        } catch (err) {
          console.warn('Remove failed:', err);
        }
        if (view.kind === 'reader' && view.bookId === book.id) {
          onBookRemovedWhileInReader?.();
        }
      })();
    },
    [wiring, libraryStore, view, onBookRemovedWhileInReader],
  );
```

Replace with:

```ts
  const onRemoveBook = useCallback(
    (book: Book): void => {
      void (async () => {
        libraryStore.getState().removeBook(book.id);
        try {
          await wiring.bookRepo.delete(book.id);
          await wiring.opfs.removeRecursive(`books/${book.id}`);
          await wiring.readingProgressRepo.delete(book.id);
          await wiring.bookmarksRepo.deleteByBook(BookId(book.id));
        } catch (err) {
          console.warn('Remove failed:', err);
        }
        if (view.kind === 'reader' && view.bookId === book.id) {
          onBookRemovedWhileInReader?.();
        }
      })();
    },
    [wiring, libraryStore, view, onBookRemovedWhileInReader],
  );
```

- [ ] **Step 2: Type-check + run unit suite**

Run: `pnpm type-check && pnpm test`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/useReaderHost.ts
git commit -m "feat(app): cascade bookmarksRepo.deleteByBook on book removal"
```

---

### Task 14: E2E — `bookmarks-add-list-jump`

**Files:**
- Create: `e2e/bookmarks-add-list-jump.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/bookmarks-add-list-jump.spec.ts
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

test('add a bookmark, see it in the rail Bookmarks tab, jump to it, and survive reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Allow the reader to settle (foliate-js needs a moment to fire its first relocate)
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /add bookmark/i }).click();

  // Switch the rail to the Bookmarks tab
  await page.getByRole('tab', { name: /bookmarks/i }).click();

  // Bookmarks list shows one entry
  const rows = page.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(1);

  // Section title is non-empty (or "—" — both acceptable for v1)
  await expect(rows.first().locator('.bookmarks-panel__section')).toBeVisible();

  // Snippet patches in within ~1.5s
  await expect(rows.first().locator('.bookmarks-panel__snippet')).toBeVisible({ timeout: 1500 });

  // Click the row → reader navigates (chrome stays visible)
  await rows.first().getByRole('button').first().click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();

  // Reload — bookmark persists
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /bookmarks/i }).click();
  await expect(rows).toHaveCount(1);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/bookmarks-add-list-jump.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/bookmarks-add-list-jump.spec.ts
git commit -m "test(e2e): bookmarks add → list → jump → persist across reload"
```

---

### Task 15: E2E — `bookmarks-delete`

**Files:**
- Create: `e2e/bookmarks-delete.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/bookmarks-delete.spec.ts
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

test('delete a bookmark and confirm it stays gone after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(500);

  // Add 2 bookmarks (allow each save to settle)
  const addBtn = page.getByRole('button', { name: /add bookmark/i });
  await addBtn.click();
  await page.waitForTimeout(300);
  await addBtn.click();
  await page.waitForTimeout(300);

  await page.getByRole('tab', { name: /bookmarks/i }).click();
  const rows = page.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(2);

  // Hover the first row to reveal the delete button, then click it
  await rows.first().hover();
  await rows.first().getByRole('button', { name: /remove bookmark/i }).click();

  await expect(rows).toHaveCount(1);

  // Reload — still only one
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /bookmarks/i }).click();
  await expect(rows).toHaveCount(1);
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/bookmarks-delete.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/bookmarks-delete.spec.ts
git commit -m "test(e2e): delete bookmark + persist deletion across reload"
```

---

### Task 16: E2E — `bookmarks-pdf`

**Files:**
- Create: `e2e/bookmarks-pdf.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/bookmarks-pdf.spec.ts
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

test('PDF bookmark shows page-based section title and snippet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open multipage test pdf/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Navigate to page 3 via the rail TOC, then bookmark
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible();
  await tocEntries.nth(2).click();
  await expect(page.locator('.pdf-reader__nav-strip')).toContainText(/Page 3 of 5/);

  await page.getByRole('button', { name: /add bookmark/i }).click();

  await page.getByRole('tab', { name: /bookmarks/i }).click();
  const rows = page.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(1);
  // Section title shown (TOC entry name OR "Page 3" — accept either)
  await expect(rows.first().locator('.bookmarks-panel__section')).not.toBeEmpty();
  // Multipage fixture has a text layer → snippet should appear
  await expect(rows.first().locator('.bookmarks-panel__snippet')).toBeVisible({ timeout: 1500 });
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/bookmarks-pdf.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/bookmarks-pdf.spec.ts
git commit -m "test(e2e): bookmark a PDF page and verify section title + snippet"
```

---

### Task 17: E2E — `bookmarks-mobile`

**Files:**
- Create: `e2e/bookmarks-mobile.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/bookmarks-mobile.spec.ts
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

test('mobile: ★ adds; ☰ opens tabbed sheet; tap bookmark dismisses + navigates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /add bookmark/i }).click();

  // Open the sheet via ☰
  await page.getByRole('button', { name: /table of contents/i }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  // Switch to Bookmarks tab inside the sheet
  await sheet.getByRole('tab', { name: /bookmarks/i }).click();
  const rows = sheet.locator('aside.bookmarks-panel li.bookmarks-panel__item');
  await expect(rows).toHaveCount(1);

  // Tap the row → sheet dismisses + reader still mounted
  await rows.first().getByRole('button').first().click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/bookmarks-mobile.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/bookmarks-mobile.spec.ts
git commit -m "test(e2e): mobile bookmark add + tabbed sheet jump + dismiss"
```

---

### Task 18: E2E — `bookmarks-cascade-on-remove`

**Files:**
- Create: `e2e/bookmarks-cascade-on-remove.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/bookmarks-cascade-on-remove.spec.ts
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

test('removing a book deletes its bookmarks (re-import shows empty list)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  // Open + add a bookmark + return to library
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /add bookmark/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /back to library/i }).click();

  // Remove the book from the library
  const card = page
    .locator('article.book-card', { hasText: /pride and prejudice/i })
    .first();
  await card.hover();
  await card.getByRole('button', { name: /remove/i }).click();
  await expect(page.getByText(/pride and prejudice/i)).toHaveCount(0);

  // Re-import the same file
  await importFixture(page);
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });

  // Bookmarks tab should be empty (cascade worked — fresh book, fresh list)
  await page.getByRole('tab', { name: /bookmarks/i }).click();
  await expect(page.getByText(/No bookmarks yet/i)).toBeVisible();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/bookmarks-cascade-on-remove.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/bookmarks-cascade-on-remove.spec.ts
git commit -m "test(e2e): book removal cascades to bookmarks (empty after re-import)"
```

---

### Task 19: Doc updates — architecture decision history + roadmap status

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Architecture decision entry**

In `docs/02-system-architecture.md`, find the line `## Decision history` and add a new entry just below it (newest-first ordering):

```markdown
### 2026-05-03 — Phase 3.1 bookmarks

- New `bookmarks` IndexedDB store at v3 (additive migration; existing
  v2 records untouched). `BookmarksRepository` mirrors the
  `readingProgress` validating-reads pattern: corrupt records are
  silently dropped, soft-validated by a `normalizeBookmark` helper.
- `Bookmark` shape: `{ id, bookId, anchor, snippet, sectionTitle, createdAt }`
  with `snippet` and `sectionTitle` nullable for graceful degradation
  (image-only PDFs, EPUBs without TOC). The `note?` field that used
  to live on `Bookmark` was dropped — Task 3.3 will introduce notes
  as their own type.
- `BookReader` contract grows two best-effort extractor methods:
  `getSnippetAt(anchor): Promise<string | null>` and
  `getSectionTitleAt(anchor): string | null`. EPUB caches the
  visible-range snippet on every foliate-js `relocate` event; PDF
  pulls page text on demand via `getTextContent`. `ReaderViewExposedState`
  also gains a `getCurrentAnchor()` passthrough so workspace hooks
  never need a direct adapter reference.
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
```

- [ ] **Step 2: Roadmap status**

In `docs/04-implementation-roadmap.md`, find:

```markdown
- Phase 2 — complete (2026-05-03)
```

Add directly below:

```markdown
- Phase 3 — in progress (Task 3.1 complete 2026-05-03; 3.2/3.3/3.4 pending)
```

- [ ] **Step 3: Verify nothing else broke**

Run: `pnpm test && pnpm lint && pnpm type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: Phase 3.1 architecture decision + roadmap status"
```

---

### Task 20: Final verification

**Files:** none

- [ ] **Step 1: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Unit tests**

Run: `pnpm test`
Expected: all pass. New tests added: `Bookmark` types (2), v2→v3 migration (1), `BookmarksRepository` (8), `relativeTime` (7), `BookmarksPanel` (7), `useBookmarks` (7), `ReaderChrome` bookmark (2), `PdfReaderAdapter.getSectionTitleAt` (1) — ~35 new tests.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 5: E2E**

Run: `pnpm exec playwright test`
Expected: all pass (existing 21 + 5 new bookmark specs = 26).

- [ ] **Step 6: Manual smoke**

Run: `pnpm dev`

In the browser at `http://localhost:5173`:
1. Open an EPUB. Tap ★ → see brief pulse. Switch rail to Bookmarks → see entry with section title and snippet (snippet may take ~1s to appear).
2. Click the row → reader navigates. Reload → bookmark still there.
3. Hover the row → delete `[×]` appears. Click it → row removed. Reload → still gone.
4. Resize to 600px → rail disappears, ☰ button appears, ★ button still there.
5. Tap ★ → adds. Tap ☰ → tabbed sheet shows Contents/Bookmarks tabs. Tap Bookmarks → see list. Tap row → sheet closes + navigates.
6. Open a PDF → tap ★ → bookmarks panel shows page-based section title.
7. Back to library → remove a book that has bookmarks → re-import the same file → Bookmarks tab is empty.

If anything's visibly broken, debug per `superpowers:systematic-debugging` (per memory: stop after 2 failed fixes, instrument first; check user-environment amplifiers).

---

### Task 21: Open PR

**Files:** none

- [ ] **Step 1: Push branch**

```bash
git push -u origin phase-3-1-bookmarks
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "Phase 3.1: Bookmarks" --body "$(cat <<'EOF'
## Summary
- New \`bookmarks\` IDB store (v3 additive migration). \`BookmarksRepository\` with validating reads + cascade delete.
- Tap ★ in the chrome to save current location. \`useBookmarks\` hook owns optimistic add (snippet:null first, patches with extracted snippet) and rollback on failure.
- \`BookmarksPanel\` lives in the desktop rail (new tabbed pattern: Contents | Bookmarks ★N) and in the mobile sheet (same tabs inside the existing ☰).
- Engine adapters gain \`getSnippetAt\` (async) + \`getSectionTitleAt\` (sync) — best-effort, return \`null\` on failure (image-only PDF, unresolvable CFI).
- Removing a book cascades to its bookmarks.

## Test plan
- [x] Type-check + lint + build clean
- [x] ~35 new unit tests pass; total ~160 unit tests
- [x] 5 new E2E specs pass: \`bookmarks-add-list-jump\`, \`bookmarks-delete\`, \`bookmarks-pdf\`, \`bookmarks-mobile\`, \`bookmarks-cascade-on-remove\`
- [x] Manual smoke: add/list/jump/delete on EPUB + PDF, mobile sheet, focus mode, cascade-on-remove

## Design + plan
- Spec: \`docs/superpowers/specs/2026-05-03-phase-3-1-bookmarks-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-03-phase-3-1-bookmarks.md\`
- Architecture entry: \`docs/02-system-architecture.md\` (Phase 3.1 decision)
- Roadmap: Phase 3 in progress, Task 3.1 complete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: returns the PR URL.

---

## Self-review checklist

The plan covers each spec section:

- §1 Goal & scope → Tasks 1, 9, 10, 11, 12, 14–18 cover create/list/jump/delete/persist/cascade.
- §2 Decisions → reflected in implementation choices (always-add semantics, no notes, tabbed rail, ★ in chrome).
- §3 Architecture → matches the file map.
- §4 Domain & storage → Tasks 1, 2, 3, 4.
- §5 Reader engine extractors → Tasks 5, 6, 7.
- §6 UI surface → Tasks 9, 11, 12.
- §7 Data flow & error handling → Task 10 (`useBookmarks`), Task 12 (workspace wiring), Task 13 (cascade).
- §8 Testing — every test row appears in a corresponding task. ✓
- §9 File map — all files listed have a task that creates/modifies them. ✓

Type consistency:
- `Bookmark` shape (Task 1) matches consumers (Tasks 3, 9, 10, 11). ✓
- `BookmarksRepository` interface (Task 3) matches all callers (Tasks 4, 10, 12, 13). ✓
- `BookReader` additions (Task 5) match adapter implementations (Tasks 6, 7) and `ReaderViewExposedState` (Task 5). ✓
- `useBookmarks` options match the workspace's wiring (Task 12). ✓
