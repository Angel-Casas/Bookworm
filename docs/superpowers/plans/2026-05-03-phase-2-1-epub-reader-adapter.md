# Phase 2.1 — EPUB Reader Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first end-to-end reading experience: clicking a book on the bookshelf opens it in a minimal reader shell that renders EPUB content via `foliate-js`, supports TOC navigation, persists reading position across reloads, and exposes typography + theme + scroll/paginated controls.

**Architecture:** Functional-core / imperative-shell. A thin domain layer (`src/domain/reader/`) declares the `BookReader` interface and `LocationAnchor` discriminated union. A single adapter (`src/features/reader/epub/EpubReaderAdapter.ts`) wraps `foliate-js` — the only file that imports it. UI components in `src/features/reader/` consume only the `BookReader` interface. App-level navigation extends the existing `App.tsx` pattern with a `view` discriminated union (no router); persistence rides on the existing IndexedDB settings store. See `docs/superpowers/specs/2026-05-03-phase-2-1-epub-reader-adapter-design.md` for the full design rationale.

**Tech Stack:** React 19 + TypeScript strict + Vite, Zustand (existing), XState v5 (for `readerMachine`), `idb` (existing), `foliate-js` (new), Vitest + `fake-indexeddb` + `happy-dom` (existing test stack), Playwright.

---

## Milestones

1. **Setup** — install `foliate-js`; map its API; declare reader domain types.
2. **Persistence layer** — schema v2 migration, reading-progress repo, reader-preferences repo, app `view` extension.
3. **Adapter layer** — `EpubReaderAdapter` implementing `BookReader`.
4. **Reader machine** — XState lifecycle for the reader load.
5. **Reader UI** — `TocPanel`, `TypographyPanel`, `ReaderChrome`, `ReaderView`.
6. **App wiring** — `App.tsx` view state, `BookCard` open handler, `Wiring` extensions, orphan-sweep extension.
7. **End-to-end & docs** — four E2E specs, doc updates, final verification.

## File structure

### New files

```
src/
  domain/
    reader/
      types.ts                    # LocationAnchor, BookReader, TocEntry, ReaderPreferences, ...
      types.test-d.ts             # TS never-narrowing exhaustiveness check
      index.ts                    # Public re-exports
  features/
    reader/
      epub/
        EpubReaderAdapter.ts      # Wraps foliate-js, implements BookReader (only foliate-js importer)
        EpubReaderAdapter.test.ts # Lifecycle + TOC parsing against fixture
        foliate-notes.md          # Brief: which foliate-js APIs we use and why
      ReaderView.tsx              # Orchestrator: machine + chrome + panels + adapter mount
      ReaderChrome.tsx            # Top bar: back, title, gear (typography), toc opener
      TocPanel.tsx                # Flat-with-indent TOC list; click → goToAnchor
      TocPanel.test.tsx           # RTL: renders entries, fires onSelect
      TypographyPanel.tsx         # Font/size/line-height/margins/theme/mode controls
      TypographyPanel.test.tsx    # RTL: change handlers fire correct prefs
      readerMachine.ts            # XState v5 machine (5 states, 5 events)
      readerMachine.test.ts       # Each transition + CLOSE always destroys adapter
      reader-view.css
      reader-chrome.css
      toc-panel.css
      typography-panel.css
  storage/
    repositories/
      readingProgress.ts          # get/put/delete by bookId; corruption → log + delete
      readingProgress.test.ts
      readerPreferences.ts        # global single-record; defaults when absent
      readerPreferences.test.ts
  app/
    view.ts                       # AppView discriminated union (library | reader { bookId })
e2e/
  reader-open.spec.ts
  reader-restore.spec.ts
  reader-preferences.spec.ts
  reader-back-nav.spec.ts
```

### Modified files

```
package.json                              # Add foliate-js
pnpm-lock.yaml                            # Auto
src/storage/db/schema.ts                  # Add 2 stores; bump CURRENT_DB_VERSION to 2; extend SettingsRecord with 'view'
src/storage/db/migrations.ts              # Add migration 1 → 2 (create reading_progress + reader_preferences)
src/storage/db/migrations.test.ts         # Test v1 → v2 migration; books survive
src/storage/repositories/settings.ts      # Add getView / setView
src/storage/index.ts                      # Re-export new repo factories
src/features/library/wiring.ts            # Construct + expose readingProgressRepo, readerPreferencesRepo
src/features/library/orphan-sweep.ts      # Also delete reading_progress on book delete
src/features/library/orphan-sweep.test.ts # NEW (no test in Phase 1) — covers cleanup including reading_progress
src/features/library/BookCard.tsx         # Make card clickable → onOpen prop
src/features/library/Bookshelf.tsx        # Pass onOpen prop down
src/features/library/LibraryView.tsx      # Wire onOpenBook prop up to App
src/app/App.tsx                           # view state machine; mount ReaderView when view='reader'
src/app/app.css                           # Minor: ensure reader fills viewport
docs/02-system-architecture.md            # Decision history: foliate-js introduced 2026-05-03
docs/04-implementation-roadmap.md         # Mark Phase 2.1 in progress, then complete on close
```

## Common commands

```bash
# Run a single test file
pnpm vitest run path/to/file.test.ts

# Watch a single test file
pnpm vitest path/to/file.test.ts

# Type-check the whole project
pnpm type-check

# Lint the whole project
pnpm lint

# Full local quality gate (type-check + lint + unit tests)
pnpm check

# Playwright E2E (requires browsers installed via `pnpm test:e2e:install` once)
pnpm test:e2e

# Playwright single spec
pnpm exec playwright test e2e/reader-open.spec.ts

# Dev server
pnpm dev
```

---

## Milestone 1 — Setup

### Task 1: Install foliate-js and document the API surface we depend on

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto)
- Create: `src/features/reader/epub/foliate-notes.md`

- [ ] **Step 1: Install `foliate-js`**

```bash
pnpm add foliate-js
```

If the npm package name differs (foliate-js publishes infrequently), fall back to a pinned git tag:

```bash
pnpm add github:johnfactotum/foliate-js#<tag>
```

Record the resolved version in `foliate-notes.md` (Step 3) and in `docs/02-system-architecture.md` later in Task 21.

- [ ] **Step 2: Verify it resolves**

Run:
```bash
pnpm install
node -e "import('foliate-js').then(m => console.log(Object.keys(m).slice(0,15))).catch(e => { console.error(e); process.exit(1); })"
```

Expected: a list of named exports (will include `View`, `EPUB`, CFI helpers, etc., depending on the version).

If this errors with "module not found", the package may export entry points only via subpaths; try `import('foliate-js/view')` or check the package's `exports` field in `node_modules/foliate-js/package.json`.

- [ ] **Step 3: Write `foliate-notes.md` mapping our `BookReader` methods to foliate-js APIs**

Create `src/features/reader/epub/foliate-notes.md`. The implementer must read foliate-js's README/source briefly and fill in the mapping. Template:

```markdown
# foliate-js notes (Phase 2.1)

Pinned version: <version>

We use foliate-js solely from `EpubReaderAdapter.ts`. This document records
which foliate-js exports we depend on and why, so a future engine swap or
foliate-js upgrade is bounded.

## Mapping BookReader methods → foliate-js APIs

| BookReader method        | foliate-js API used                                    |
| ------------------------ | ------------------------------------------------------ |
| open(blob, opts)         | <e.g. `new View()` + `view.open(book)`>                |
| getCurrentAnchor()       | <e.g. `view.getLocation()` returning a CFI string>     |
| goToAnchor(anchor)       | <e.g. `view.goTo(cfi)`>                                |
| applyPreferences(prefs)  | <e.g. `view.setStyles({...})` or CSS injection>        |
| onLocationChange(fn)     | <e.g. `view.addEventListener('relocate', ...)`>         |
| destroy()                | <e.g. `view.close()` + DOM teardown>                    |

## Things foliate-js does NOT do for us
- Persistence — we own that (readingProgressRepo)
- Selection events — Phase 3 will add
- Theme tokens — we map our `ReaderTheme` → CSS via the existing tokens.css

## Known caveats
- <list anything surprising you discover, e.g. iframe sandboxing, async open quirks>
```

The point of this step is to **front-load discovery** so Task 8 doesn't get blocked. If a method we assumed exists doesn't, raise it now and adjust the BookReader interface in Task 2 accordingly.

- [ ] **Step 4: Type-check passes**

Run:
```bash
pnpm type-check
```

Expected: no errors. (foliate-js may not ship types; that's fine — declare ambient types in `src/types/foliate-js.d.ts` if needed, with only the methods we actually call.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/reader/epub/foliate-notes.md
git commit -m "chore(deps): add foliate-js for Phase 2.1 EPUB rendering

Pinned at <version>. Adapter is the only consumer; mapping documented in
src/features/reader/epub/foliate-notes.md."
```

---

### Task 2: Reader domain types

**Files:**
- Create: `src/domain/reader/types.ts`
- Create: `src/domain/reader/types.test-d.ts`
- Create: `src/domain/reader/index.ts`
- Modify: `src/domain/index.ts` (re-export)

- [ ] **Step 1: Write the type-only exhaustiveness test**

Create `src/domain/reader/types.test-d.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LocationAnchor } from './types';

// Compile-time exhaustiveness — adding a new variant without updating the
// switch will produce a TS error here.
function describeAnchor(anchor: LocationAnchor): string {
  switch (anchor.kind) {
    case 'epub-cfi':
      return `epub:${anchor.cfi}`;
    case 'pdf-page':
      return `pdf:${String(anchor.page)}`;
    default: {
      const _exhaustive: never = anchor;
      return _exhaustive;
    }
  }
}

describe('LocationAnchor', () => {
  it('round-trips through exhaustive switch', () => {
    const epub: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' };
    const pdf: LocationAnchor = { kind: 'pdf-page', page: 12 };
    expect(describeAnchor(epub)).toBe('epub:epubcfi(/6/4)');
    expect(describeAnchor(pdf)).toBe('pdf:12');
  });
});
```

- [ ] **Step 2: Run test → expect fail (no types yet)**

Run:
```bash
pnpm vitest run src/domain/reader/types.test-d.ts
```

Expected: FAIL with "cannot find module './types'".

- [ ] **Step 3: Write `src/domain/reader/types.ts`**

```ts
// ----- Location anchors (native per format, discriminated union) -----

export type EpubCfiAnchor = {
  readonly kind: 'epub-cfi';
  readonly cfi: string;
  readonly sectionId?: string;
};

export type PdfPageAnchor = {
  readonly kind: 'pdf-page';
  readonly page: number;
  readonly offset?: number;
  readonly sectionId?: string;
};

export type LocationAnchor = EpubCfiAnchor | PdfPageAnchor;

// ----- Table of contents -----

export type TocEntry = {
  readonly id: string;
  readonly label: string;
  readonly anchor: LocationAnchor;
  readonly depth: number;
  readonly children?: readonly TocEntry[];
};

// ----- Reader preferences -----

export type ReaderFontFamily =
  | 'system-serif'
  | 'system-sans'
  | 'georgia'
  | 'iowan'
  | 'inter';

export type ReaderTheme = 'light' | 'dark' | 'sepia';
export type ReaderMode = 'scroll' | 'paginated';

export type ReaderTypography = {
  readonly fontFamily: ReaderFontFamily;
  readonly fontSizeStep: 0 | 1 | 2 | 3 | 4;
  readonly lineHeightStep: 0 | 1 | 2;
  readonly marginStep: 0 | 1 | 2;
};

export type ReaderPreferences = {
  readonly typography: ReaderTypography;
  readonly theme: ReaderTheme;
  readonly modeByFormat: { readonly epub: ReaderMode };
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  typography: {
    fontFamily: 'system-serif',
    fontSizeStep: 2,
    lineHeightStep: 1,
    marginStep: 1,
  },
  theme: 'light',
  modeByFormat: { epub: 'paginated' },
};

// ----- BookReader contract (just-in-time minimal API) -----

export type ReaderInitOptions = {
  readonly preferences: ReaderPreferences;
  readonly initialAnchor?: LocationAnchor;
};

export type LocationChangeListener = (anchor: LocationAnchor) => void;

export interface BookReader {
  open(file: Blob, options: ReaderInitOptions): Promise<{ toc: readonly TocEntry[] }>;
  goToAnchor(anchor: LocationAnchor): Promise<void>;
  getCurrentAnchor(): LocationAnchor;
  applyPreferences(prefs: ReaderPreferences): void;
  onLocationChange(listener: LocationChangeListener): () => void;
  destroy(): void;
}

// ----- Errors -----

export type ReaderError =
  | { readonly kind: 'blob-missing'; readonly bookId: string }
  | { readonly kind: 'parse-failed'; readonly reason: string }
  | { readonly kind: 'unsupported-format'; readonly format: string }
  | { readonly kind: 'engine-crashed'; readonly cause: unknown };
```

- [ ] **Step 4: Write the index barrel**

Create `src/domain/reader/index.ts`:

```ts
export type {
  EpubCfiAnchor,
  PdfPageAnchor,
  LocationAnchor,
  TocEntry,
  ReaderFontFamily,
  ReaderTheme,
  ReaderMode,
  ReaderTypography,
  ReaderPreferences,
  ReaderInitOptions,
  LocationChangeListener,
  BookReader,
  ReaderError,
} from './types';

export { DEFAULT_READER_PREFERENCES } from './types';
```

- [ ] **Step 5: Re-export from `src/domain/index.ts`**

Add this line to `src/domain/index.ts` (preserve existing exports):

```ts
export * from './reader';
```

- [ ] **Step 6: Run test → pass**

Run:
```bash
pnpm vitest run src/domain/reader/types.test-d.ts
```

Expected: PASS (1 test).

- [ ] **Step 7: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/domain/reader/ src/domain/index.ts
git commit -m "feat(reader): domain types — BookReader, LocationAnchor, ReaderPreferences"
```

---

## Milestone 2 — Persistence layer

### Task 3: Schema v2 — declare new stores and bump version

**Files:**
- Modify: `src/storage/db/schema.ts`

- [ ] **Step 1: Edit `src/storage/db/schema.ts` to add stores, bump version, extend `SettingsRecord`**

Replace the file contents with:

```ts
import type { DBSchema } from 'idb';
import type { Book } from '@/domain';
import type { LocationAnchor, ReaderPreferences } from '@/domain';

export const DB_NAME = 'bookworm';
export const CURRENT_DB_VERSION = 2;

export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string };

export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' }
  | { readonly key: 'view'; readonly value: AppView };

export type ReadingProgressRecord = {
  readonly bookId: string;
  readonly anchor: LocationAnchor;
  readonly updatedAt: number;
};

export type ReaderPreferencesRecord = {
  readonly key: 'global';
  readonly value: ReaderPreferences;
};

export interface BookwormDBSchema extends DBSchema {
  books: {
    key: string;
    value: Book;
    indexes: {
      'by-checksum': string;
      'by-created': string;
      'by-last-opened': string;
    };
  };
  settings: {
    key: string;
    value: SettingsRecord;
  };
  reading_progress: {
    key: string;
    value: ReadingProgressRecord;
  };
  reader_preferences: {
    key: string;
    value: ReaderPreferencesRecord;
  };
}

export const BOOK_STORE = 'books' as const;
export const SETTINGS_STORE = 'settings' as const;
export const READING_PROGRESS_STORE = 'reading_progress' as const;
export const READER_PREFERENCES_STORE = 'reader_preferences' as const;
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm type-check
```

Expected: TypeScript will complain in `migrations.ts` (the upgrade-tx tuple no longer matches the new schema's stores) — that's exactly what we'll fix in Task 4.

If there are *other* type errors (e.g. settings.ts uses `SettingsRecord` in a way that breaks with the new variant), pause and look at them. The settings-repo additions are deliberate — see Task 7. For now, the only acceptable broken file is `migrations.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/storage/db/schema.ts
git commit -m "feat(storage): schema v2 — declare reading_progress + reader_preferences stores

Bumps CURRENT_DB_VERSION to 2. Extends SettingsRecord with the 'view' key
that App.tsx will use to persist library-vs-reader navigation. Migration
arrives in the next commit."
```

(Build is intentionally broken for one commit; the next commit fixes it.)

---

### Task 4: Migration v1 → v2 (create stores; books survive)

**Files:**
- Modify: `src/storage/db/migrations.ts`
- Modify: `src/storage/db/migrations.test.ts`

- [ ] **Step 1: Extend the existing migration test**

Open `src/storage/db/migrations.test.ts` and append a new test case alongside the existing v0→v1 test. Read the existing file first so the imports + helpers match. Then add:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { runMigrations } from './migrations';
import {
  CURRENT_DB_VERSION,
  READING_PROGRESS_STORE,
  READER_PREFERENCES_STORE,
} from './schema';

describe('schema migration v1 → v2', () => {
  it('creates reading_progress and reader_preferences and preserves books', async () => {
    // 1. Open DB at v1 with one book
    const dbName = `bookworm-mig-${String(Date.now())}`;
    const v1 = await openDB(dbName, 1, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('by-checksum', 'source.checksum', { unique: true });
        books.createIndex('by-created', 'createdAt', { unique: false });
        books.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    await v1.put('books', { id: 'b1', title: 'Test' });
    v1.close();

    // 2. Reopen at v2 — runMigrations runs the v1 → v2 step
    const v2 = await openDB(dbName, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        // @ts-expect-error -- runMigrations is typed against v2 schema; v1 tx is fine at runtime
        runMigrations({ db, tx }, oldVersion, newVersion ?? CURRENT_DB_VERSION);
      },
    });

    // 3. Assert
    expect(v2.objectStoreNames.contains(READING_PROGRESS_STORE)).toBe(true);
    expect(v2.objectStoreNames.contains(READER_PREFERENCES_STORE)).toBe(true);
    const survivors = await v2.getAll('books');
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({ id: 'b1', title: 'Test' });
    v2.close();
  });
});
```

- [ ] **Step 2: Run the new test → expect fail**

Run:
```bash
pnpm vitest run src/storage/db/migrations.test.ts
```

Expected: FAIL — `runMigrations` has no migration for v1, so it throws "No migration registered for version 1 → 2".

- [ ] **Step 3: Add the v1 → v2 migration**

Edit `src/storage/db/migrations.ts`. Replace the `migrations` constant with:

```ts
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
};
```

You may also need to update the `UpgradeContext` type's tx-stores tuple:

```ts
type UpgradeContext = {
  readonly db: IDBPDatabase<BookwormDBSchema>;
  readonly tx: IDBPTransaction<
    BookwormDBSchema,
    ('books' | 'settings' | 'reading_progress' | 'reader_preferences')[],
    'versionchange'
  >;
};
```

- [ ] **Step 4: Run the test → pass**

Run:
```bash
pnpm vitest run src/storage/db/migrations.test.ts
```

Expected: PASS for both v0→v1 and v1→v2 cases.

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/storage/db/migrations.ts src/storage/db/migrations.test.ts
git commit -m "feat(storage): migration v1 → v2 creates reader stores

Existing books pass through untouched. Test asserts both new stores
exist post-migration and v1 book records survive."
```

---

### Task 5: `readingProgress` repository

**Files:**
- Create: `src/storage/repositories/readingProgress.ts`
- Create: `src/storage/repositories/readingProgress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/repositories/readingProgress.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createReadingProgressRepository } from './readingProgress';
import type { LocationAnchor } from '@/domain';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-readprog-${String(Math.random())}`);
});

describe('readingProgressRepository', () => {
  it('round-trips an EPUB CFI anchor', async () => {
    const repo = createReadingProgressRepository(db);
    const anchor: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/14!/4/22/2/4)' };
    await repo.put('book-1', anchor);
    expect(await repo.get('book-1')).toEqual(anchor);
  });

  it('returns undefined for unknown bookId', async () => {
    const repo = createReadingProgressRepository(db);
    expect(await repo.get('nope')).toBeUndefined();
  });

  it('isolates progress per book', async () => {
    const repo = createReadingProgressRepository(db);
    const a: LocationAnchor = { kind: 'epub-cfi', cfi: 'cfi-a' };
    const b: LocationAnchor = { kind: 'epub-cfi', cfi: 'cfi-b' };
    await repo.put('book-a', a);
    await repo.put('book-b', b);
    expect(await repo.get('book-a')).toEqual(a);
    expect(await repo.get('book-b')).toEqual(b);
  });

  it('delete() removes a record', async () => {
    const repo = createReadingProgressRepository(db);
    await repo.put('book-1', { kind: 'epub-cfi', cfi: 'x' });
    await repo.delete('book-1');
    expect(await repo.get('book-1')).toBeUndefined();
  });

  it('returns undefined and self-heals when a stored record fails validation', async () => {
    const repo = createReadingProgressRepository(db);
    // Inject a corrupted record bypassing the typed API
    await db.put('reading_progress', {
      bookId: 'broken',
      anchor: { kind: 'unknown-format' } as unknown as LocationAnchor,
      updatedAt: Date.now(),
    });
    expect(await repo.get('broken')).toBeUndefined();
    // After read, the corrupted record should have been deleted
    const raw = await db.get('reading_progress', 'broken');
    expect(raw).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

Run:
```bash
pnpm vitest run src/storage/repositories/readingProgress.test.ts
```

Expected: FAIL — `readingProgress.ts` doesn't exist.

- [ ] **Step 3: Implement `readingProgress.ts`**

Create `src/storage/repositories/readingProgress.ts`:

```ts
import type { LocationAnchor } from '@/domain';
import type { BookwormDB } from '../db/open';
import { READING_PROGRESS_STORE, type ReadingProgressRecord } from '../db/schema';

export type ReadingProgressRepository = {
  get(bookId: string): Promise<LocationAnchor | undefined>;
  put(bookId: string, anchor: LocationAnchor): Promise<void>;
  delete(bookId: string): Promise<void>;
};

function isValidAnchor(value: unknown): value is LocationAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'epub-cfi') {
    return typeof (value as { cfi?: unknown }).cfi === 'string';
  }
  if (v.kind === 'pdf-page') {
    return typeof (value as { page?: unknown }).page === 'number';
  }
  return false;
}

export function createReadingProgressRepository(db: BookwormDB): ReadingProgressRepository {
  return {
    async get(bookId) {
      const rec = await db.get(READING_PROGRESS_STORE, bookId);
      if (!rec) return undefined;
      if (!isValidAnchor(rec.anchor)) {
        console.warn('[readingProgress] dropping corrupted record for', bookId);
        await db.delete(READING_PROGRESS_STORE, bookId);
        return undefined;
      }
      return rec.anchor;
    },
    async put(bookId, anchor) {
      const record: ReadingProgressRecord = { bookId, anchor, updatedAt: Date.now() };
      await db.put(READING_PROGRESS_STORE, record);
    },
    async delete(bookId) {
      await db.delete(READING_PROGRESS_STORE, bookId);
    },
  };
}
```

- [ ] **Step 4: Run test → pass**

Run:
```bash
pnpm vitest run src/storage/repositories/readingProgress.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/storage/repositories/readingProgress.ts src/storage/repositories/readingProgress.test.ts
git commit -m "feat(storage): readingProgress repository

Per-book LocationAnchor with self-healing on corrupted records.
Validates kind + shape at the boundary; logs and deletes on failure
rather than throwing upward."
```

---

### Task 6: `readerPreferences` repository

**Files:**
- Create: `src/storage/repositories/readerPreferences.ts`
- Create: `src/storage/repositories/readerPreferences.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/repositories/readerPreferences.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createReaderPreferencesRepository } from './readerPreferences';
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from '@/domain';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-prefs-${String(Math.random())}`);
});

describe('readerPreferencesRepository', () => {
  it('returns defaults when nothing has been saved', async () => {
    const repo = createReaderPreferencesRepository(db);
    expect(await repo.get()).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it('round-trips a custom preferences object', async () => {
    const repo = createReaderPreferencesRepository(db);
    const custom: ReaderPreferences = {
      ...DEFAULT_READER_PREFERENCES,
      theme: 'dark',
      typography: { ...DEFAULT_READER_PREFERENCES.typography, fontSizeStep: 4 },
    };
    await repo.put(custom);
    expect(await repo.get()).toEqual(custom);
  });

  it('returns defaults and self-heals when stored record is corrupted', async () => {
    const repo = createReaderPreferencesRepository(db);
    await db.put('reader_preferences', {
      key: 'global',
      // malformed: theme is not a valid ReaderTheme
      value: { ...DEFAULT_READER_PREFERENCES, theme: 'neon-pink' as never },
    });
    expect(await repo.get()).toEqual(DEFAULT_READER_PREFERENCES);
    const raw = await db.get('reader_preferences', 'global');
    expect(raw).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

Run:
```bash
pnpm vitest run src/storage/repositories/readerPreferences.test.ts
```

Expected: FAIL — `readerPreferences.ts` doesn't exist.

- [ ] **Step 3: Implement `readerPreferences.ts`**

Create `src/storage/repositories/readerPreferences.ts`:

```ts
import {
  DEFAULT_READER_PREFERENCES,
  type ReaderPreferences,
  type ReaderTheme,
  type ReaderMode,
  type ReaderFontFamily,
} from '@/domain';
import type { BookwormDB } from '../db/open';
import { READER_PREFERENCES_STORE, type ReaderPreferencesRecord } from '../db/schema';

export type ReaderPreferencesRepository = {
  get(): Promise<ReaderPreferences>;
  put(prefs: ReaderPreferences): Promise<void>;
};

const VALID_THEMES: ReadonlySet<ReaderTheme> = new Set(['light', 'dark', 'sepia']);
const VALID_MODES: ReadonlySet<ReaderMode> = new Set(['scroll', 'paginated']);
const VALID_FONTS: ReadonlySet<ReaderFontFamily> = new Set([
  'system-serif',
  'system-sans',
  'georgia',
  'iowan',
  'inter',
]);

function isValid(value: unknown): value is ReaderPreferences {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ReaderPreferences>;
  if (!v.theme || !VALID_THEMES.has(v.theme)) return false;
  if (!v.modeByFormat || !VALID_MODES.has(v.modeByFormat.epub)) return false;
  if (!v.typography) return false;
  const t = v.typography;
  if (!VALID_FONTS.has(t.fontFamily)) return false;
  if (!Number.isInteger(t.fontSizeStep) || t.fontSizeStep < 0 || t.fontSizeStep > 4) return false;
  if (!Number.isInteger(t.lineHeightStep) || t.lineHeightStep < 0 || t.lineHeightStep > 2) return false;
  if (!Number.isInteger(t.marginStep) || t.marginStep < 0 || t.marginStep > 2) return false;
  return true;
}

export function createReaderPreferencesRepository(db: BookwormDB): ReaderPreferencesRepository {
  return {
    async get() {
      const rec = await db.get(READER_PREFERENCES_STORE, 'global');
      if (!rec) return DEFAULT_READER_PREFERENCES;
      if (!isValid(rec.value)) {
        console.warn('[readerPreferences] dropping corrupted record');
        await db.delete(READER_PREFERENCES_STORE, 'global');
        return DEFAULT_READER_PREFERENCES;
      }
      return rec.value;
    },
    async put(prefs) {
      const record: ReaderPreferencesRecord = { key: 'global', value: prefs };
      await db.put(READER_PREFERENCES_STORE, record);
    },
  };
}
```

- [ ] **Step 4: Run test → pass**

Run:
```bash
pnpm vitest run src/storage/repositories/readerPreferences.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/storage/repositories/readerPreferences.ts src/storage/repositories/readerPreferences.test.ts
git commit -m "feat(storage): readerPreferences repository

Single global record at key 'global'. Returns DEFAULT_READER_PREFERENCES
when absent or corrupted. Validates every field at the boundary."
```

---

### Task 7: Settings repo extension for `view` + storage barrel update

**Files:**
- Modify: `src/storage/repositories/settings.ts`
- Modify: `src/storage/repositories/settings.test.ts`
- Modify: `src/storage/index.ts`
- Create: `src/app/view.ts`

- [ ] **Step 1: Create `src/app/view.ts`**

`AppView` itself is already declared in `src/storage/db/schema.ts` (Task 3) because it's the persisted shape. This module re-exports it and adds ergonomic helpers used by `App.tsx`.

```ts
import type { AppView } from '@/storage/db/schema';

export type { AppView };

export const LIBRARY_VIEW: AppView = { kind: 'library' };

export function readerView(bookId: string): AppView {
  return { kind: 'reader', bookId };
}
```

- [ ] **Step 2: Add a failing test for `getView` / `setView`**

Open `src/storage/repositories/settings.test.ts`. Add:

```ts
import { LIBRARY_VIEW, readerView } from '@/app/view';
// ...inside the existing describe block, append:

  it('round-trips library view', async () => {
    const repo = createSettingsRepository(db);
    await repo.setView(LIBRARY_VIEW);
    expect(await repo.getView()).toEqual(LIBRARY_VIEW);
  });

  it('round-trips reader view with bookId', async () => {
    const repo = createSettingsRepository(db);
    const v = readerView('book-1');
    await repo.setView(v);
    expect(await repo.getView()).toEqual(v);
  });

  it('returns undefined when no view persisted', async () => {
    const repo = createSettingsRepository(db);
    expect(await repo.getView()).toBeUndefined();
  });

  it('returns undefined for malformed persisted view (defensive)', async () => {
    const repo = createSettingsRepository(db);
    // Inject an unknown kind
    await db.put('settings', { key: 'view', value: { kind: 'lol' } as never });
    expect(await repo.getView()).toBeUndefined();
  });
```

(If your test file's `db` is set up differently, mirror the existing pattern in that file.)

- [ ] **Step 3: Run test → expect fail**

Run:
```bash
pnpm vitest run src/storage/repositories/settings.test.ts
```

Expected: FAIL — `getView` / `setView` don't exist.

- [ ] **Step 4: Implement `getView` / `setView`**

Edit `src/storage/repositories/settings.ts`. Add to the `SettingsRepository` type:

```ts
import type { AppView } from '@/app/view';
// ...
export type SettingsRepository = {
  getLibrarySort(): Promise<SortKey | undefined>;
  setLibrarySort(key: SortKey): Promise<void>;
  getStoragePersistResult(): Promise<'granted' | 'denied' | undefined>;
  setStoragePersistResult(value: 'granted' | 'denied'): Promise<void>;
  getView(): Promise<AppView | undefined>;
  setView(view: AppView): Promise<void>;
};
```

Add a validator above `createSettingsRepository`:

```ts
function isValidView(v: unknown): v is AppView {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as { kind?: unknown; bookId?: unknown };
  if (x.kind === 'library') return true;
  if (x.kind === 'reader' && typeof x.bookId === 'string' && x.bookId.length > 0) return true;
  return false;
}
```

Inside the returned object, add:

```ts
    async getView() {
      const rec = await get<Extract<SettingsRecord, { key: 'view' }>>('view');
      if (!rec) return undefined;
      return isValidView(rec.value) ? rec.value : undefined;
    },
    async setView(view) {
      await put({ key: 'view', value: view });
    },
```

- [ ] **Step 5: Update the storage barrel**

Edit `src/storage/index.ts`. Append:

```ts
export {
  createReadingProgressRepository,
  type ReadingProgressRepository,
} from './repositories/readingProgress';
export {
  createReaderPreferencesRepository,
  type ReaderPreferencesRepository,
} from './repositories/readerPreferences';
```

- [ ] **Step 6: Run tests → pass**

Run:
```bash
pnpm vitest run src/storage/repositories/settings.test.ts
```

Expected: all settings tests pass (existing + 4 new).

- [ ] **Step 7: Full quality gate**

Run:
```bash
pnpm check
```

Expected: type-check + lint + all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/storage/repositories/settings.ts src/storage/repositories/settings.test.ts src/storage/index.ts src/app/view.ts
git commit -m "feat(storage): persist app view + export reader repos

Settings repo gains getView/setView for the new 'view' key. AppView
discriminated union lives in src/app/view.ts. Reader repos exported
from storage barrel so wiring.ts can construct them."
```

---

## Milestone 3 — Adapter layer

### Task 8: `EpubReaderAdapter` — wraps foliate-js, implements `BookReader`

**Files:**
- Create: `src/features/reader/epub/EpubReaderAdapter.ts`
- Create: `src/features/reader/epub/EpubReaderAdapter.test.ts`

> **Important:** Before writing the adapter, re-read `src/features/reader/epub/foliate-notes.md` from Task 1. The exact foliate-js method names below are likely-but-not-guaranteed; substitute the real names from your discovery.

- [ ] **Step 1: Write the integration test (TOC parsing only — rendering is an E2E concern)**

Create `src/features/reader/epub/EpubReaderAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EpubReaderAdapter } from './EpubReaderAdapter';
import { DEFAULT_READER_PREFERENCES } from '@/domain';

const FIXTURE_PATH = resolve(__dirname, '../../../../test-fixtures/small-pride-and-prejudice.epub');

function loadFixtureBlob(): Blob {
  const bytes = readFileSync(FIXTURE_PATH);
  return new Blob([bytes], { type: 'application/epub+zip' });
}

describe('EpubReaderAdapter (jsdom-bounded)', () => {
  it('open() returns a non-empty TOC for the Pride and Prejudice fixture', async () => {
    const adapter = new EpubReaderAdapter();
    try {
      const { toc } = await adapter.open(loadFixtureBlob(), {
        preferences: DEFAULT_READER_PREFERENCES,
      });
      expect(toc.length).toBeGreaterThan(0);
      // Every TOC entry has a stable id and a label
      for (const entry of toc) {
        expect(entry.id).toBeTruthy();
        expect(entry.label).toBeTruthy();
        expect(entry.anchor.kind).toBe('epub-cfi');
      }
    } finally {
      adapter.destroy();
    }
  });

  it('destroy() is idempotent', () => {
    const adapter = new EpubReaderAdapter();
    expect(() => {
      adapter.destroy();
      adapter.destroy();
    }).not.toThrow();
  });

  it('open() rejects on a non-EPUB blob', async () => {
    const adapter = new EpubReaderAdapter();
    const garbage = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/epub+zip' });
    await expect(
      adapter.open(garbage, { preferences: DEFAULT_READER_PREFERENCES }),
    ).rejects.toBeDefined();
    adapter.destroy();
  });
});
```

> **Note:** `getCurrentAnchor`, `goToAnchor`, `applyPreferences`, and `onLocationChange` all depend on actual rendering, which doesn't work cleanly in jsdom. Those are exercised by the E2E suites in Milestone 7.

- [ ] **Step 2: Run test → expect fail**

Run:
```bash
pnpm vitest run src/features/reader/epub/EpubReaderAdapter.test.ts
```

Expected: FAIL — adapter file doesn't exist.

- [ ] **Step 3: Implement `EpubReaderAdapter`**

Create `src/features/reader/epub/EpubReaderAdapter.ts`. The skeleton below shows the structure; fill in the foliate-js calls per `foliate-notes.md`:

```ts
import {
  type BookReader,
  type LocationAnchor,
  type LocationChangeListener,
  type ReaderInitOptions,
  type ReaderPreferences,
  type TocEntry,
} from '@/domain';

// foliate-js types are not bundled. If the package ships them, use them.
// Otherwise declare the minimum surface you need in src/types/foliate-js.d.ts.
// eslint-disable-next-line import/no-unresolved -- adjust per actual foliate-js exports
import { View as FoliateView } from 'foliate-js';

// Fixed CSS pixel sizes for our 5 typography size steps. Adjust if your taste
// after dev-server testing in Task 22 demands a different ramp.
const FONT_SIZE_PX: Readonly<Record<0 | 1 | 2 | 3 | 4, number>> = {
  0: 14,
  1: 16,
  2: 18,
  3: 20,
  4: 24,
};

const LINE_HEIGHT: Readonly<Record<0 | 1 | 2, number>> = {
  0: 1.35,
  1: 1.55,
  2: 1.85,
};

const MARGIN_PX: Readonly<Record<0 | 1 | 2, number>> = {
  0: 16,
  1: 48,
  2: 96,
};

const FONT_FAMILY_CSS: Readonly<Record<string, string>> = {
  'system-serif': 'Georgia, "Iowan Old Style", "Source Serif Pro", serif',
  'system-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  georgia: 'Georgia, serif',
  iowan: '"Iowan Old Style", Georgia, serif',
  inter: 'Inter, system-ui, sans-serif',
};

export class EpubReaderAdapter implements BookReader {
  private view: FoliateView | null = null;
  private listeners = new Set<LocationChangeListener>();
  private destroyed = false;

  async open(file: Blob, options: ReaderInitOptions): Promise<{ toc: TocEntry[] }> {
    if (this.destroyed) throw new Error('EpubReaderAdapter: open() after destroy()');
    if (this.view) throw new Error('EpubReaderAdapter: open() called twice');

    // Per foliate-notes.md: construct the View, hand it the blob, await ready.
    this.view = new FoliateView();
    await this.view.open(file);   // ← exact API per your foliate-notes.md

    // Apply preferences before rendering settles.
    this.applyPreferences(options.preferences);

    // Restore initial position if provided.
    if (options.initialAnchor && options.initialAnchor.kind === 'epub-cfi') {
      try {
        await this.view.goTo(options.initialAnchor.cfi);
      } catch (err) {
        console.warn('[reader] initialAnchor did not resolve, falling back to start:', err);
      }
    }

    // Subscribe to relocate events; fan out to our listeners.
    this.view.addEventListener('relocate', (e: { detail?: { cfi?: string } }) => {
      const cfi = e.detail?.cfi;
      if (typeof cfi !== 'string') return;
      const anchor: LocationAnchor = { kind: 'epub-cfi', cfi };
      for (const fn of this.listeners) fn(anchor);
    });

    const toc = mapToc(this.view.book?.toc ?? []);
    return { toc };
  }

  goToAnchor(anchor: LocationAnchor): Promise<void> {
    if (!this.view) throw new Error('EpubReaderAdapter: not opened');
    if (anchor.kind !== 'epub-cfi') {
      return Promise.reject(new Error(`EpubReaderAdapter: cannot navigate to ${anchor.kind}`));
    }
    return this.view.goTo(anchor.cfi);
  }

  getCurrentAnchor(): LocationAnchor {
    if (!this.view) throw new Error('EpubReaderAdapter: not opened');
    const cfi = this.view.getLocation?.()?.cfi ?? '';
    return { kind: 'epub-cfi', cfi };
  }

  applyPreferences(prefs: ReaderPreferences): void {
    if (!this.view) return;
    const css = `
      html, body {
        background: var(--reader-background);
        color: var(--reader-text);
        font-family: ${FONT_FAMILY_CSS[prefs.typography.fontFamily]};
        font-size: ${String(FONT_SIZE_PX[prefs.typography.fontSizeStep])}px;
        line-height: ${String(LINE_HEIGHT[prefs.typography.lineHeightStep])};
      }
      body {
        padding: 0 ${String(MARGIN_PX[prefs.typography.marginStep])}px;
      }
    `;
    this.view.setStyle?.(css);
    this.view.setMode?.(prefs.modeByFormat.epub === 'paginated' ? 'paginated' : 'scrolled');
    document.documentElement.dataset.readerTheme = prefs.theme;
  }

  onLocationChange(listener: LocationChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    try {
      this.view?.close?.();
    } catch (err) {
      console.warn('[reader] destroy: close threw', err);
    }
    this.view = null;
  }
}

function mapToc(raw: readonly { href: string; label: string; subitems?: readonly unknown[] }[]): TocEntry[] {
  const out: TocEntry[] = [];
  walk(raw, 0, out);
  return out;
}

function walk(
  items: readonly { href: string; label: string; subitems?: readonly unknown[] }[],
  depth: number,
  out: TocEntry[],
): void {
  for (const item of items) {
    out.push({
      id: item.href,
      label: item.label,
      depth,
      anchor: { kind: 'epub-cfi', cfi: hrefToCfi(item.href) },
    });
    if (Array.isArray(item.subitems) && item.subitems.length > 0) {
      walk(item.subitems as never, depth + 1, out);
    }
  }
}

function hrefToCfi(href: string): string {
  // foliate-js exposes a helper to resolve href → CFI; substitute its real name
  // per foliate-notes.md. Until then, store the raw href as the cfi field —
  // goToAnchor() can fall back to view.goTo(href) since foliate-js accepts both.
  return href;
}
```

The `// ← exact API per your foliate-notes.md` markers are deliberate landing sites for the implementer — replace with the real method names. The test will tell you if you got it wrong.

- [ ] **Step 4: Run test → pass**

Run:
```bash
pnpm vitest run src/features/reader/epub/EpubReaderAdapter.test.ts
```

Expected: PASS (3 tests).

If `open()` fails because foliate-js needs a DOM element to mount: the adapter constructor should optionally accept a host element (`new EpubReaderAdapter(hostElement?)`). For the test, create a detached `document.createElement('div')` and pass it. Update the test and the constructor signature; document the change in `foliate-notes.md`.

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

Expected: no errors. The unused `LocationChangeListener` import warning, if any, can be silenced by using the type explicitly.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/epub/
git commit -m "feat(reader): EpubReaderAdapter wrapping foliate-js

Implements BookReader. Sole foliate-js importer in the codebase. TOC
extraction tested against the Pride and Prejudice fixture; render-
dependent methods (goToAnchor, applyPreferences, onLocationChange) are
covered by E2E in Milestone 7."
```

---

## Milestone 4 — Reader machine

### Task 9: `readerMachine` — XState lifecycle for opening a book

**Files:**
- Create: `src/features/reader/readerMachine.ts`
- Create: `src/features/reader/readerMachine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/readerMachine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { makeReaderMachine } from './readerMachine';
import { DEFAULT_READER_PREFERENCES } from '@/domain';
import type { BookReader, LocationAnchor } from '@/domain';

function fakeAdapter(): BookReader & { destroyed: boolean } {
  const out = {
    destroyed: false,
    async open() {
      return { toc: [{ id: 'c1', label: 'Chapter 1', depth: 0, anchor: { kind: 'epub-cfi' as const, cfi: 'a' } }] };
    },
    async goToAnchor() { /* noop */ },
    getCurrentAnchor(): LocationAnchor { return { kind: 'epub-cfi', cfi: 'a' }; },
    applyPreferences() { /* noop */ },
    onLocationChange() { return () => undefined; },
    destroy() { out.destroyed = true; },
  };
  return out;
}

describe('readerMachine', () => {
  it('idle → loadingBlob → opening → ready on the happy path', async () => {
    const adapter = fakeAdapter();
    const machine = makeReaderMachine({
      loadBookForReader: async () => ({
        blob: new Blob(['x']),
        preferences: DEFAULT_READER_PREFERENCES,
        initialAnchor: undefined,
      }),
      createAdapter: () => adapter,
    });
    const actor = createActor(machine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.send({ type: 'OPEN', bookId: 'b1' });
    // Allow async invokes to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(actor.getSnapshot().value).toBe('ready');
    expect(actor.getSnapshot().context.toc?.length).toBeGreaterThan(0);
    actor.stop();
  });

  it('transitions to error if loadBookForReader throws', async () => {
    const machine = makeReaderMachine({
      loadBookForReader: async () => { throw new Error('blob missing'); },
      createAdapter: () => fakeAdapter(),
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'OPEN', bookId: 'b1' });
    await new Promise((r) => setTimeout(r, 10));
    expect(actor.getSnapshot().value).toBe('error');
    expect(actor.getSnapshot().context.error?.kind).toBe('blob-missing');
    actor.stop();
  });

  it('CLOSE always destroys the adapter', async () => {
    const adapter = fakeAdapter();
    const machine = makeReaderMachine({
      loadBookForReader: async () => ({ blob: new Blob(['x']), preferences: DEFAULT_READER_PREFERENCES }),
      createAdapter: () => adapter,
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'OPEN', bookId: 'b1' });
    await new Promise((r) => setTimeout(r, 10));
    actor.send({ type: 'CLOSE' });
    expect(adapter.destroyed).toBe(true);
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

Run:
```bash
pnpm vitest run src/features/reader/readerMachine.test.ts
```

Expected: FAIL — `readerMachine` doesn't exist.

- [ ] **Step 3: Implement `readerMachine`**

Create `src/features/reader/readerMachine.ts`:

```ts
import { setup, assign, fromPromise } from 'xstate';
import type {
  BookReader,
  LocationAnchor,
  ReaderError,
  ReaderPreferences,
  TocEntry,
} from '@/domain';

export type ReaderMachineInput = {
  loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  createAdapter: () => BookReader;
};

type Loaded = {
  blob: Blob;
  preferences: ReaderPreferences;
  initialAnchor?: LocationAnchor;
};

type Context = {
  bookId: string | null;
  adapter: BookReader | null;
  loaded: Loaded | null;
  toc: readonly TocEntry[] | null;
  currentAnchor: LocationAnchor | null;
  error: ReaderError | null;
  preferences: ReaderPreferences | null;
};

type Events =
  | { type: 'OPEN'; bookId: string }
  | { type: 'CLOSE' };

// Factory pattern: deps are captured in closure, NOT passed via XState input.
// This avoids XState v5's awkward `self.system._input` access for callable deps.
export function makeReaderMachine(deps: ReaderMachineInput) {
  return setup({
    types: {} as { context: Context; events: Events },
    actors: {
      loadBookActor: fromPromise<Loaded, { bookId: string }>(async ({ input }) => {
        return deps.loadBookForReader(input.bookId);
      }),
      openAdapterActor: fromPromise<
        { toc: readonly TocEntry[]; currentAnchor: LocationAnchor },
        { adapter: BookReader; loaded: Loaded }
      >(async ({ input }) => {
        const { toc } = await input.adapter.open(input.loaded.blob, {
          preferences: input.loaded.preferences,
          ...(input.loaded.initialAnchor && { initialAnchor: input.loaded.initialAnchor }),
        });
        const currentAnchor = input.adapter.getCurrentAnchor();
        return { toc, currentAnchor };
      }),
    },
    actions: {
      destroyAdapter: ({ context }) => {
        context.adapter?.destroy();
      },
    },
  }).createMachine({
    id: 'reader',
    initial: 'idle',
    context: {
      bookId: null,
      adapter: null,
      loaded: null,
      toc: null,
      currentAnchor: null,
      error: null,
      preferences: null,
    },
    states: {
      idle: {
        on: {
          OPEN: {
            target: 'loadingBlob',
            actions: assign({
              bookId: ({ event }) => event.bookId,
              error: null,
              adapter: null,
              loaded: null,
              toc: null,
              currentAnchor: null,
            }),
          },
        },
      },
      loadingBlob: {
        invoke: {
          src: 'loadBookActor',
          input: ({ context }) => ({ bookId: context.bookId! }),
          onDone: {
            target: 'opening',
            actions: assign({
              loaded: ({ event }) => event.output,
              preferences: ({ event }) => event.output.preferences,
            }),
          },
          onError: {
            target: 'error',
            actions: assign({
              error: ({ context }) => ({ kind: 'blob-missing' as const, bookId: context.bookId ?? '' }),
            }),
          },
        },
        on: { CLOSE: { target: 'idle', actions: 'destroyAdapter' } },
      },
      opening: {
        entry: assign({
          adapter: () => deps.createAdapter(),
        }),
        invoke: {
          src: 'openAdapterActor',
          input: ({ context }) => ({
            adapter: context.adapter!,
            loaded: context.loaded!,
          }),
          onDone: {
            target: 'ready',
            actions: assign({
              toc: ({ event }) => event.output.toc,
              currentAnchor: ({ event }) => event.output.currentAnchor,
            }),
          },
          onError: {
            target: 'error',
            actions: [
              'destroyAdapter',
              assign({
                error: () => ({ kind: 'parse-failed' as const, reason: 'engine open failed' }),
                adapter: null,
              }),
            ],
          },
        },
        on: { CLOSE: { target: 'idle', actions: 'destroyAdapter' } },
      },
      ready: {
        on: { CLOSE: { target: 'idle', actions: 'destroyAdapter' } },
      },
      error: {
        on: {
          CLOSE: { target: 'idle', actions: 'destroyAdapter' },
          OPEN: {
            target: 'loadingBlob',
            actions: assign({ bookId: ({ event }) => event.bookId, error: null }),
          },
        },
      },
    },
  });
}
```

> **Note:** because `makeReaderMachine` is a factory, `ReaderView` should memoize its machine instance with `useMemo(() => makeReaderMachine(deps), [deps...])` keyed on the dependency identities — NOT call it inline on every render.

- [ ] **Step 4: Run test → pass**

Run:
```bash
pnpm vitest run src/features/reader/readerMachine.test.ts
```

Expected: PASS (3 tests). If you switched to the factory pattern, the test imports `makeReaderMachine` instead and passes deps to it.

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/readerMachine.ts src/features/reader/readerMachine.test.ts
git commit -m "feat(reader): XState machine for reader load lifecycle

Five states (idle/loadingBlob/opening/ready/error), five events
(OPEN/LOAD_OK/OPEN_OK/FAIL/CLOSE). CLOSE always destroys the adapter
to prevent leaks. Tested for happy path, blob-missing failure, and
adapter destruction on close."
```

---

## Milestone 5 — Reader UI

### Task 10: `TocPanel` — flat-with-indent TOC list

**Files:**
- Create: `src/features/reader/TocPanel.tsx`
- Create: `src/features/reader/TocPanel.test.tsx`
- Create: `src/features/reader/toc-panel.css`

- [ ] **Step 1: Write the failing component test**

Create `src/features/reader/TocPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TocPanel } from './TocPanel';
import type { TocEntry } from '@/domain';

const TOC: readonly TocEntry[] = [
  { id: 'c1', label: 'Chapter 1', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'a' } },
  { id: 'c1-1', label: 'Section 1.1', depth: 1, anchor: { kind: 'epub-cfi', cfi: 'b' } },
  { id: 'c2', label: 'Chapter 2', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'c' } },
];

describe('TocPanel', () => {
  it('renders all entries with proper indentation', () => {
    render(<TocPanel toc={TOC} onSelect={() => undefined} />);
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('Section 1.1')).toBeDefined();
    expect(screen.getByText('Chapter 2')).toBeDefined();
    const section = screen.getByText('Section 1.1').closest('button')!;
    expect(section.style.paddingInlineStart).not.toBe('');
  });

  it('fires onSelect with the clicked entry', () => {
    const onSelect = vi.fn();
    render(<TocPanel toc={TOC} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Chapter 2'));
    expect(onSelect).toHaveBeenCalledWith(TOC[2]);
  });

  it('shows an empty-state when toc is empty', () => {
    render(<TocPanel toc={[]} onSelect={() => undefined} />);
    expect(screen.getByText(/no chapters/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

Run:
```bash
pnpm vitest run src/features/reader/TocPanel.test.tsx
```

Expected: FAIL — TocPanel doesn't exist.

- [ ] **Step 3: Implement `TocPanel.tsx` and `toc-panel.css`**

Create `src/features/reader/TocPanel.tsx`:

```tsx
import type { TocEntry } from '@/domain';
import './toc-panel.css';

type TocPanelProps = {
  readonly toc: readonly TocEntry[];
  readonly currentAnchorId?: string;
  readonly onSelect: (entry: TocEntry) => void;
};

export function TocPanel({ toc, currentAnchorId, onSelect }: TocPanelProps) {
  if (toc.length === 0) {
    return (
      <aside className="toc-panel toc-panel--empty">
        <p>No chapters in this book.</p>
      </aside>
    );
  }
  return (
    <aside className="toc-panel" aria-label="Table of contents">
      <ul className="toc-panel__list">
        {toc.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={`toc-panel__entry${entry.id === currentAnchorId ? ' toc-panel__entry--current' : ''}`}
              style={{ paddingInlineStart: `${String(16 + entry.depth * 16)}px` }}
              onClick={() => {
                onSelect(entry);
              }}
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

Create `src/features/reader/toc-panel.css`:

```css
.toc-panel {
  background: var(--surface);
  color: var(--text);
  padding: 16px 0;
  overflow-y: auto;
  height: 100%;
}
.toc-panel__list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.toc-panel__entry {
  display: block;
  width: 100%;
  text-align: start;
  background: transparent;
  border: 0;
  padding-block: 8px;
  padding-inline-end: 16px;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.toc-panel__entry:hover { background: var(--surface-hover, rgba(0,0,0,0.04)); }
.toc-panel__entry--current { font-weight: 600; }
.toc-panel--empty { padding: 24px; color: var(--text-muted, #888); }
```

> **Token check:** `--surface`, `--text`, `--text-muted` should exist in `src/design-system/tokens.css`. Read that file first; if a token is missing, add it (don't hardcode a fallback color in the component).

- [ ] **Step 4: Run test → pass**

Run:
```bash
pnpm vitest run src/features/reader/TocPanel.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/TocPanel.tsx src/features/reader/TocPanel.test.tsx src/features/reader/toc-panel.css
git commit -m "feat(reader): TocPanel — flat list with depth-based indent"
```

---

### Task 11: `TypographyPanel` — typography + theme + mode controls

**Files:**
- Create: `src/features/reader/TypographyPanel.tsx`
- Create: `src/features/reader/TypographyPanel.test.tsx`
- Create: `src/features/reader/typography-panel.css`

- [ ] **Step 1: Write the failing component test**

Create `src/features/reader/TypographyPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TypographyPanel } from './TypographyPanel';
import { DEFAULT_READER_PREFERENCES } from '@/domain';

describe('TypographyPanel', () => {
  it('changes font family', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/font/i), { target: { value: 'inter' } });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      typography: { ...DEFAULT_READER_PREFERENCES.typography, fontFamily: 'inter' },
    });
  });

  it('changes theme', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      theme: 'dark',
    });
  });

  it('changes mode (scroll/paginated)', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /scroll/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      modeByFormat: { epub: 'scroll' },
    });
  });

  it('increments font size step on +', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /increase font size/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      typography: { ...DEFAULT_READER_PREFERENCES.typography, fontSizeStep: 3 },
    });
  });
});
```

- [ ] **Step 2: Run test → expect fail**

Run:
```bash
pnpm vitest run src/features/reader/TypographyPanel.test.tsx
```

Expected: FAIL — `TypographyPanel` doesn't exist.

- [ ] **Step 3: Implement `TypographyPanel.tsx` and `typography-panel.css`**

Create `src/features/reader/TypographyPanel.tsx`:

```tsx
import type {
  ReaderFontFamily,
  ReaderMode,
  ReaderPreferences,
  ReaderTheme,
} from '@/domain';
import './typography-panel.css';

const FONTS: readonly { value: ReaderFontFamily; label: string }[] = [
  { value: 'system-serif', label: 'System Serif' },
  { value: 'system-sans', label: 'System Sans' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'iowan', label: 'Iowan' },
  { value: 'inter', label: 'Inter' },
];

const THEMES: readonly ReaderTheme[] = ['light', 'dark', 'sepia'];
const MODES: readonly ReaderMode[] = ['paginated', 'scroll'];

type Props = {
  readonly preferences: ReaderPreferences;
  readonly onChange: (prefs: ReaderPreferences) => void;
};

export function TypographyPanel({ preferences, onChange }: Props) {
  const t = preferences.typography;
  const set = (next: ReaderPreferences) => {
    onChange(next);
  };
  return (
    <section className="typography-panel" aria-label="Reader preferences">
      <label className="typography-panel__row">
        <span>Font</span>
        <select
          value={t.fontFamily}
          onChange={(e) => {
            set({ ...preferences, typography: { ...t, fontFamily: e.target.value as ReaderFontFamily } });
          }}
        >
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </label>

      <div className="typography-panel__row">
        <span>Size</span>
        <button
          type="button"
          aria-label="Decrease font size"
          disabled={t.fontSizeStep === 0}
          onClick={() => {
            set({ ...preferences, typography: { ...t, fontSizeStep: Math.max(0, t.fontSizeStep - 1) as typeof t.fontSizeStep } });
          }}
        >−</button>
        <span aria-live="polite">{String(t.fontSizeStep + 1)} / 5</span>
        <button
          type="button"
          aria-label="Increase font size"
          disabled={t.fontSizeStep === 4}
          onClick={() => {
            set({ ...preferences, typography: { ...t, fontSizeStep: Math.min(4, t.fontSizeStep + 1) as typeof t.fontSizeStep } });
          }}
        >+</button>
      </div>

      <div className="typography-panel__row">
        <span>Line height</span>
        {(['tight', 'normal', 'loose'] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={t.lineHeightStep === i}
            onClick={() => {
              set({ ...preferences, typography: { ...t, lineHeightStep: i as 0 | 1 | 2 } });
            }}
          >{label}</button>
        ))}
      </div>

      <div className="typography-panel__row">
        <span>Margins</span>
        {(['narrow', 'normal', 'wide'] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={t.marginStep === i}
            onClick={() => {
              set({ ...preferences, typography: { ...t, marginStep: i as 0 | 1 | 2 } });
            }}
          >{label}</button>
        ))}
      </div>

      <fieldset className="typography-panel__row" aria-label="Theme">
        <legend>Theme</legend>
        {THEMES.map((theme) => (
          <label key={theme}>
            <input
              type="radio"
              name="reader-theme"
              checked={preferences.theme === theme}
              onChange={() => {
                set({ ...preferences, theme });
              }}
            />
            <span style={{ textTransform: 'capitalize' }}>{theme}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="typography-panel__row" aria-label="Mode">
        <legend>Reading mode</legend>
        {MODES.map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="reader-mode"
              checked={preferences.modeByFormat.epub === mode}
              onChange={() => {
                set({ ...preferences, modeByFormat: { epub: mode } });
              }}
            />
            <span style={{ textTransform: 'capitalize' }}>{mode}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
```

Create `src/features/reader/typography-panel.css`:

```css
.typography-panel {
  background: var(--surface);
  color: var(--text);
  padding: 16px;
  display: grid;
  gap: 12px;
  width: min(360px, 90vw);
}
.typography-panel__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.typography-panel__row > span:first-child,
.typography-panel__row > legend {
  flex: 0 0 auto;
  min-width: 88px;
  color: var(--text-muted, #666);
}
.typography-panel__row select,
.typography-panel__row button,
.typography-panel__row input {
  font: inherit;
}
.typography-panel__row button[aria-pressed='true'] { font-weight: 600; }
```

- [ ] **Step 4: Run test → pass**

Run:
```bash
pnpm vitest run src/features/reader/TypographyPanel.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/TypographyPanel.tsx src/features/reader/TypographyPanel.test.tsx src/features/reader/typography-panel.css
git commit -m "feat(reader): TypographyPanel — font, size, line-height, margins, theme, mode

Emits onChange with the full ReaderPreferences object on every edit so
the orchestrator (ReaderView) can apply + persist atomically."
```

---

### Task 12: `ReaderChrome` — top bar (back, title, panel openers)

**Files:**
- Create: `src/features/reader/ReaderChrome.tsx`
- Create: `src/features/reader/reader-chrome.css`

- [ ] **Step 1: Implement (no separate test — RTL coverage via ReaderView in Task 13 is sufficient for this thin UI shell; the e2e back-nav spec also exercises it)**

Create `src/features/reader/ReaderChrome.tsx`:

```tsx
import './reader-chrome.css';

type Props = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly onOpenToc: () => void;
  readonly onOpenTypography: () => void;
};

export function ReaderChrome({ title, subtitle, onBack, onOpenToc, onOpenTypography }: Props) {
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
        <button type="button" onClick={onOpenTypography} aria-label="Reader preferences">⚙</button>
        <button type="button" onClick={onOpenToc} aria-label="Table of contents">☰</button>
      </div>
    </header>
  );
}
```

Create `src/features/reader/reader-chrome.css`:

```css
.reader-chrome {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--surface);
  color: var(--text);
  border-block-end: 1px solid var(--border, rgba(0,0,0,0.08));
  min-height: 44px;
}
.reader-chrome__back {
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
}
.reader-chrome__back:hover { background: var(--surface-hover, rgba(0,0,0,0.04)); }
.reader-chrome__title {
  flex: 1 1 auto;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reader-chrome__title-main { font-weight: 600; }
.reader-chrome__title-sub { color: var(--text-muted, #666); }
.reader-chrome__actions {
  display: flex;
  gap: 4px;
}
.reader-chrome__actions button {
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 18px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  color: inherit;
}
.reader-chrome__actions button:hover { background: var(--surface-hover, rgba(0,0,0,0.04)); }
```

- [ ] **Step 2: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/features/reader/ReaderChrome.tsx src/features/reader/reader-chrome.css
git commit -m "feat(reader): ReaderChrome — back, title, gear/menu openers"
```

---

### Task 13: `ReaderView` — orchestrator

**Files:**
- Create: `src/features/reader/ReaderView.tsx`
- Create: `src/features/reader/reader-view.css`

> **Strategy:** ReaderView is the orchestration layer — it would be tested most fairly through E2E (Milestone 7). Skip a unit test here; let the e2e specs catch regressions.

- [ ] **Step 1: Implement `ReaderView.tsx`**

Create `src/features/reader/ReaderView.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import {
  type BookReader,
  type LocationAnchor,
  type ReaderPreferences,
  type ReaderError,
} from '@/domain';
import { makeReaderMachine } from './readerMachine';
import { ReaderChrome } from './ReaderChrome';
import { TocPanel } from './TocPanel';
import { TypographyPanel } from './TypographyPanel';
import './reader-view.css';

type ReaderViewProps = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookSubtitle?: string;
  readonly onBack: () => void;
  readonly loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  readonly createAdapter: (mountInto: HTMLElement) => BookReader;
  readonly onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  readonly onPreferencesChange: (prefs: ReaderPreferences) => void;
};

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

export function ReaderView({
  bookId,
  bookTitle,
  bookSubtitle,
  onBack,
  loadBookForReader,
  createAdapter,
  onAnchorChange,
  onPreferencesChange,
}: ReaderViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<BookReader | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [typoOpen, setTypoOpen] = useState(false);
  const [prefs, setPrefs] = useState<ReaderPreferences | null>(null);

  // Build the machine once per (bookId, callback identities). ReaderView is
  // mounted with key={bookId} from App.tsx, so a book switch remounts the
  // whole component anyway — this useMemo guards against accidental re-builds
  // from parent re-renders that don't change deps.
  const machine = useMemo(
    () =>
      makeReaderMachine({
        loadBookForReader,
        createAdapter: () => {
          if (!mountRef.current) {
            throw new Error('ReaderView: mount node not ready');
          }
          const adapter = createAdapter(mountRef.current);
          adapterRef.current = adapter;
          return adapter;
        },
      }),
    [loadBookForReader, createAdapter],
  );

  const [state, send] = useMachine(machine);

  // Kick off OPEN once the mount node is in the DOM
  useEffect(() => {
    send({ type: 'OPEN', bookId });
    return () => {
      send({ type: 'CLOSE' });
      adapterRef.current = null;
    };
  }, [bookId, send]);

  // Subscribe to location changes once ready, debounce-save, sync flush on hide
  useEffect(() => {
    if (state.value !== 'ready' || !adapterRef.current) return;
    const adapter = adapterRef.current;
    const saveDebounced = debounce((anchor: LocationAnchor) => {
      onAnchorChange(bookId, anchor);
    }, 500);
    const unsubscribe = adapter.onLocationChange((anchor) => {
      saveDebounced(anchor);
    });
    const flush = () => {
      try {
        const anchor = adapter.getCurrentAnchor();
        onAnchorChange(bookId, anchor);
      } catch (err) {
        console.warn('[reader] flush failed', err);
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [state.value, bookId, onAnchorChange]);

  // Initialize preferences from the loaded preferences
  useEffect(() => {
    if (state.context.preferences && !prefs) setPrefs(state.context.preferences);
  }, [state.context.preferences, prefs]);

  const handlePrefChange = (next: ReaderPreferences) => {
    setPrefs(next);
    adapterRef.current?.applyPreferences(next);
    onPreferencesChange(next);
  };

  return (
    <div className="reader-view" data-reader-theme={prefs?.theme ?? 'light'}>
      <ReaderChrome
        title={bookTitle}
        subtitle={bookSubtitle}
        onBack={onBack}
        onOpenToc={() => setTocOpen((v) => !v)}
        onOpenTypography={() => setTypoOpen((v) => !v)}
      />
      <div className="reader-view__body">
        <div ref={mountRef} className="reader-view__mount" aria-label="Book content" />
      </div>
      {state.value === 'loadingBlob' || state.value === 'opening' ? (
        <div className="reader-view__overlay" role="status">Opening book…</div>
      ) : null}
      {state.value === 'error' ? (
        <div className="reader-view__overlay reader-view__overlay--error" role="alert">
          <p>{describeError(state.context.error)}</p>
          <button type="button" onClick={onBack}>Back to library</button>
        </div>
      ) : null}
      {tocOpen && state.context.toc ? (
        <div className="reader-view__sheet reader-view__sheet--toc">
          <TocPanel
            toc={state.context.toc}
            onSelect={(entry) => {
              void adapterRef.current?.goToAnchor(entry.anchor);
              setTocOpen(false);
            }}
          />
        </div>
      ) : null}
      {typoOpen && prefs ? (
        <div className="reader-view__sheet reader-view__sheet--typography">
          <TypographyPanel preferences={prefs} onChange={handlePrefChange} />
        </div>
      ) : null}
    </div>
  );
}

function describeError(err: ReaderError | null): string {
  if (!err) return 'Something went wrong opening this book.';
  switch (err.kind) {
    case 'blob-missing': return 'This book is no longer in your library.';
    case 'parse-failed': return `Could not open this book: ${err.reason}`;
    case 'unsupported-format': return `Unsupported format: ${err.format}`;
    case 'engine-crashed': return 'The reader crashed. Try opening the book again.';
  }
}
```

Create `src/features/reader/reader-view.css`:

```css
.reader-view {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: var(--reader-background, #fbfaf6);
  color: var(--reader-text, #1f1d1a);
}
.reader-view[data-reader-theme='dark'] {
  --reader-background: #1a1a1a;
  --reader-text: #e8e6e1;
}
.reader-view[data-reader-theme='sepia'] {
  --reader-background: #f4ecd8;
  --reader-text: #4b3a26;
}
.reader-view__body {
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
}
.reader-view__mount { position: absolute; inset: 0; }
.reader-view__overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--surface);
  z-index: 2;
}
.reader-view__overlay--error { color: var(--danger, #b3261e); }
.reader-view__sheet {
  position: absolute;
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(0,0,0,0.16);
  z-index: 3;
}
.reader-view__sheet--toc {
  inset-block-start: 44px;
  inset-inline-end: 0;
  inline-size: min(360px, 90vw);
  block-size: calc(100dvh - 44px);
  border-inline-start: 1px solid var(--border, rgba(0,0,0,0.08));
}
.reader-view__sheet--typography {
  inset-block-start: 44px;
  inset-inline-end: 0;
}
```

> **Token check (again):** add `--reader-background`, `--reader-text`, `--surface`, `--border`, `--danger` to `src/design-system/tokens.css` if missing. Use values that match the design system's "paper / ink / walnut / smoke" palette intent rather than ad-hoc colors.

- [ ] **Step 2: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/features/reader/ReaderView.tsx src/features/reader/reader-view.css
git commit -m "feat(reader): ReaderView orchestrator

Drives the readerMachine, mounts the EpubReaderAdapter into a host node,
wires onLocationChange → debounced save (+ pagehide / visibilitychange
sync flush), and exposes TOC + typography sheets via the chrome."
```

---

## Milestone 6 — App wiring

### Task 14: `BookCard` / `Bookshelf` / `LibraryView` — `onOpen` plumbing

**Files:**
- Modify: `src/features/library/BookCard.tsx`
- Modify: `src/features/library/Bookshelf.tsx`
- Modify: `src/features/library/LibraryView.tsx`

- [ ] **Step 1: Wire `onOpen` upward through `BookCard` → `Bookshelf` → `LibraryView`**

Read each file first to preserve existing prop shapes. The intent is:

- `BookCard` gains `onOpen?: () => void`. When set, the card root becomes a clickable button (or wraps content in a button) that fires `onOpen` on click — except when the click target is inside the existing `BookCardMenu` (the ⋯ remove menu). The simplest implementation: `<button class="book-card__open" onClick={onOpen}>{cover, title, author}</button>` for the activatable region, and keep the menu rendered as a sibling so its clicks aren't swallowed.
- `Bookshelf` gains `onOpenBook?: (book: Book) => void`. Maps over books, passes `onOpen={() => onOpenBook?.(book)}` to each card.
- `LibraryView` gains `onOpenBook?: (book: Book) => void`. Pipes to `LibraryWorkspace` → `Bookshelf`.

Per CLAUDE.md "components small, focused, and composable" — this is plumbing only; don't refactor structure beyond what's needed.

- [ ] **Step 2: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

Expected: no errors. Existing tests should still pass since `onOpen` is optional everywhere.

- [ ] **Step 3: Run existing library tests**

Run:
```bash
pnpm vitest run src/features/library
```

Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/features/library/BookCard.tsx src/features/library/Bookshelf.tsx src/features/library/LibraryView.tsx
git commit -m "feat(library): plumb onOpenBook from BookCard to LibraryView

Cards become activatable: clicking outside the ⋯ menu fires onOpen.
Optional prop — existing flows untouched. App.tsx wires this in the
next commit."
```

---

### Task 15: Wire reader repos through `wiring.ts`

**Files:**
- Modify: `src/features/library/wiring.ts`

- [ ] **Step 1: Extend `Wiring`**

In `src/features/library/wiring.ts`, add to imports:

```ts
import {
  // ...existing...
  createReadingProgressRepository,
  createReaderPreferencesRepository,
  type ReadingProgressRepository,
  type ReaderPreferencesRepository,
} from '@/storage';
```

Add to the `Wiring` type:

```ts
  readonly readingProgressRepo: ReadingProgressRepository;
  readonly readerPreferencesRepo: ReaderPreferencesRepository;
```

Construct them inside `createWiring`:

```ts
  const readingProgressRepo = createReadingProgressRepository(db);
  const readerPreferencesRepo = createReaderPreferencesRepository(db);
```

Return them in the final object:

```ts
  return {
    db, bookRepo, settingsRepo, opfs, importDeps, persistFirstQuotaRequest,
    readingProgressRepo, readerPreferencesRepo,
  };
```

- [ ] **Step 2: Type-check + run wiring-adjacent tests**

Run:
```bash
pnpm type-check && pnpm vitest run src/features/library
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/library/wiring.ts
git commit -m "feat(library): expose readingProgress + readerPreferences repos via wiring"
```

---

### Task 16: `App.tsx` — view state + ReaderView mount

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/app.css`

- [ ] **Step 1: Extend `App.tsx`**

The diff is substantial; the structure to land on:

1. Add a `view: AppView` slice of state (read from `wiring.settingsRepo.getView()` during boot; default to `LIBRARY_VIEW`).
2. Render branch: `view.kind === 'reader'` → `<ReaderView ... key={view.bookId} ... />`; otherwise the existing library UI.
3. Provide `onOpenBook(book)` to `LibraryView` that:
   - Validates `book.id` is still in `wiring.bookRepo` (skip if not)
   - Calls `setView(readerView(book.id))`
   - Persists via `wiring.settingsRepo.setView(...)`
4. Provide `onBack` to `ReaderView` that sets view back to `LIBRARY_VIEW` and persists.
5. Build the `loadBookForReader(bookId)` callback that ReaderView needs:
   ```ts
   async (bookId) => {
     const book = await wiring.bookRepo.getById(BookId(bookId));
     if (!book || book.source.kind !== 'imported-file') {
       throw new Error(`Book ${bookId} is missing or has no source`);
     }
     const blob = await wiring.opfs.readAt(book.source.opfsPath); // adjust to real OPFS read API
     const preferences = await wiring.readerPreferencesRepo.get();
     const initialAnchor = await wiring.readingProgressRepo.get(bookId);
     return initialAnchor
       ? { blob, preferences, initialAnchor }
       : { blob, preferences };
   }
   ```
   (If `OpfsAdapter` doesn't have `readAt` — check `src/storage/adapters/opfs.ts` and use the actual method, e.g. `read(path)` returning a `File`/`Blob`.)
6. Build the `createAdapter(mountNode)` callback:
   ```ts
   (mountNode) => {
     const adapter = new EpubReaderAdapter(mountNode); // if your constructor takes a mount node
     return adapter;
   }
   ```
7. Wire `onAnchorChange(bookId, anchor)` → `wiring.readingProgressRepo.put(bookId, anchor)`.
8. Wire `onPreferencesChange(prefs)` → `wiring.readerPreferencesRepo.put(prefs)`.
9. Add a guard at boot: if `view.kind === 'reader'` but the bookId is no longer in the library, fall back to `LIBRARY_VIEW` and persist the correction.

In `app.css`, ensure the reader root can fill the viewport (the existing `.app` should be `display: contents` or `min-height: 100dvh` — check what's there and keep changes minimal).

- [ ] **Step 2: Type-check + lint**

Run:
```bash
pnpm type-check && pnpm lint
```

Expected: no errors. If `App.tsx` crosses the 200-line warning threshold (it's at 163 already), extract the boot effect or the reader-callback bundle into a small helper module per the spec's risk mitigation.

- [ ] **Step 3: Manual smoke test (no unit test for App)**

```bash
pnpm dev
```

Open the app, import the fixture EPUB if not already imported, click a cover. Verify:
- Reader opens, shows content (or at least a TOC)
- Back button returns to library
- Hard reload while in reader → returns to reader at the same position

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx src/app/app.css
git commit -m "feat(app): view state + ReaderView mount

App.tsx now persists the active view to settings and routes between
LibraryView and ReaderView. Click a book → reader; back → library;
reload restores. Guarded against bookId-not-found by falling back to
the library view."
```

---

### Task 17: Extend `orphan-sweep` to clean reading_progress

**Files:**
- Modify: `src/features/library/orphan-sweep.ts`
- Create: `src/features/library/orphan-sweep.test.ts`

- [ ] **Step 1: Write a failing test**

Create `src/features/library/orphan-sweep.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openBookwormDB } from '@/storage';
import {
  createBookRepository,
  createReadingProgressRepository,
  createInMemoryOpfsAdapter,
} from '@/storage';
import { sweepOrphans } from './orphan-sweep';
import { BookId } from '@/domain';

describe('sweepOrphans', () => {
  it('removes reading_progress records for books no longer in the library', async () => {
    const db = await openBookwormDB(`bookworm-orphan-${String(Math.random())}`);
    const bookRepo = createBookRepository(db);
    const progress = createReadingProgressRepository(db);
    const opfs = createInMemoryOpfsAdapter();

    // Pretend we once had two books; only one is still in the library
    await opfs.writeFile('books/book-a/source.epub', new Blob(['a']));
    await opfs.writeFile('books/book-b/source.epub', new Blob(['b']));
    await bookRepo.put({
      id: BookId('book-a'),
      title: 'Kept',
      format: 'epub',
      coverRef: { kind: 'none' },
      toc: [],
      source: {
        kind: 'imported-file',
        opfsPath: 'books/book-a/source.epub',
        originalName: 'a.epub',
        byteSize: 1,
        mimeType: 'application/epub+zip',
        checksum: 'a',
      },
      importStatus: { kind: 'ready' },
      indexingStatus: { kind: 'pending' },
      aiProfileStatus: { kind: 'pending' },
      createdAt: new Date().toISOString() as never,
      updatedAt: new Date().toISOString() as never,
    });
    await progress.put('book-a', { kind: 'epub-cfi', cfi: 'a' });
    await progress.put('book-b', { kind: 'epub-cfi', cfi: 'b' });

    await sweepOrphans(opfs, bookRepo, progress);

    expect(await progress.get('book-a')).toBeDefined();
    expect(await progress.get('book-b')).toBeUndefined();
    expect(await opfs.exists('books/book-b/source.epub')).toBe(false);
  });
});
```

(Adjust the `Book` literal if your domain types differ — read `src/domain/book/types.ts` first.)

- [ ] **Step 2: Run test → expect fail**

Run:
```bash
pnpm vitest run src/features/library/orphan-sweep.test.ts
```

Expected: FAIL — `sweepOrphans` only takes `(opfs, bookRepo)` today.

- [ ] **Step 3: Update `sweepOrphans` to also clean progress**

Edit `src/features/library/orphan-sweep.ts`:

```ts
import type { OpfsAdapter, BookRepository, ReadingProgressRepository } from '@/storage';
import { BookId } from '@/domain';

export async function sweepOrphans(
  opfs: OpfsAdapter,
  bookRepo: BookRepository,
  progressRepo?: ReadingProgressRepository,
): Promise<void> {
  let dirs: readonly string[];
  try {
    dirs = await opfs.list('books');
  } catch {
    return;
  }
  const all = await bookRepo.getAll();
  const known = new Set(all.map((b) => b.id));

  // OPFS sweep
  await Promise.all(
    dirs.map(async (id) => {
      if (!known.has(BookId(id))) {
        try {
          await opfs.removeRecursive(`books/${id}`);
        } catch (err) {
          console.warn('orphan sweep failed for', id, err);
        }
      }
    }),
  );

  // Reading-progress sweep
  if (progressRepo) {
    // No list API on the repo; sweep via raw store
    const allKeys = await opfs.listAllProgressKeys?.(); // see note below
    // Simpler: extend ReadingProgressRepository with a `listKeys()` method.
    // Decide based on what reads cleanest in the codebase. Prefer adding a
    // `listKeys()` to the repo over poking IndexedDB from this module.
  }
}
```

Then implement the cleaner option: extend `ReadingProgressRepository` with `listKeys(): Promise<readonly string[]>` (and add a test for it back in `readingProgress.test.ts`). Use it here:

```ts
  if (progressRepo) {
    const keys = await progressRepo.listKeys();
    await Promise.all(
      keys.filter((k) => !known.has(BookId(k))).map((k) => progressRepo.delete(k)),
    );
  }
```

Update `readingProgress.ts` to add:

```ts
    async listKeys() {
      return db.getAllKeys(READING_PROGRESS_STORE) as Promise<readonly string[]>;
    },
```

And add a quick unit test for it in `readingProgress.test.ts`:

```ts
  it('listKeys returns all stored bookIds', async () => {
    const repo = createReadingProgressRepository(db);
    await repo.put('a', { kind: 'epub-cfi', cfi: 'x' });
    await repo.put('b', { kind: 'epub-cfi', cfi: 'y' });
    const keys = await repo.listKeys();
    expect([...keys].sort()).toEqual(['a', 'b']);
  });
```

- [ ] **Step 4: Update `App.tsx` to pass the progress repo into `sweepOrphans`**

In `App.tsx`'s boot effect:

```ts
void sweepOrphans(wiring.opfs, wiring.bookRepo, wiring.readingProgressRepo).catch(() => {
  /* best effort */
});
```

- [ ] **Step 5: Run all related tests → pass**

```bash
pnpm vitest run src/features/library/orphan-sweep.test.ts src/storage/repositories/readingProgress.test.ts
```

Expected: PASS.

- [ ] **Step 6: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add src/features/library/orphan-sweep.ts src/features/library/orphan-sweep.test.ts src/storage/repositories/readingProgress.ts src/storage/repositories/readingProgress.test.ts src/app/App.tsx
git commit -m "feat(library): orphan-sweep removes stale reading_progress

Adds listKeys() to readingProgress repo so the sweep doesn't reach
into IndexedDB directly. App.tsx passes the repo into sweepOrphans;
records for deleted books are pruned at boot."
```

---

## Milestone 7 — End-to-end & docs

### Task 18: E2E — open EPUB → see content → navigate TOC

**Files:**
- Create: `e2e/reader-open.spec.ts`

Refer to existing e2e specs (`e2e/library-import.spec.ts`) for the import-helper pattern.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test('opens an imported EPUB and navigates via the TOC', async ({ page }) => {
  await page.goto('/');

  // Import via the file picker (re-use the pattern from library-import.spec.ts)
  await page.getByLabel(/import/i).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);

  // Wait for the imported card to appear on the bookshelf
  const card = page.getByRole('button', { name: /pride and prejudice/i });
  await expect(card).toBeVisible({ timeout: 10000 });

  // Click the card → reader opens
  await card.click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();

  // Open the TOC and click the first entry
  await page.getByRole('button', { name: /table of contents/i }).click();
  const tocPanel = page.locator('aside.toc-panel');
  await expect(tocPanel).toBeVisible();
  const firstEntry = tocPanel.getByRole('button').first();
  await expect(firstEntry).toBeVisible();
  await firstEntry.click();

  // After click, TOC closes (sheet implementation in ReaderView)
  await expect(tocPanel).toBeHidden({ timeout: 1000 });
});
```

- [ ] **Step 2: Run the spec → expect pass**

```bash
pnpm exec playwright test e2e/reader-open.spec.ts
```

Expected: PASS. If foliate-js renders into an iframe, your `aside.toc-panel` selector is fine because the TOC lives in the parent React tree, not in the iframe. If your TOC button labels differ from the test's, update the test (preferred over loosening a label users will read).

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-open.spec.ts
git commit -m "test(e2e): open EPUB and navigate TOC"
```

---

### Task 19: E2E — restore last reading position

**Files:**
- Create: `e2e/reader-restore.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test('restores reading position after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/import/i).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);

  const card = page.getByRole('button', { name: /pride and prejudice/i });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();

  // Open TOC and jump to ~middle entry
  await page.getByRole('button', { name: /table of contents/i }).click();
  const tocEntries = page.locator('aside.toc-panel button.toc-panel__entry');
  const count = await tocEntries.count();
  expect(count).toBeGreaterThan(2);
  const targetIndex = Math.floor(count / 2);
  const targetLabel = (await tocEntries.nth(targetIndex).innerText()).trim();
  await tocEntries.nth(targetIndex).click();

  // Wait for save debounce to flush
  await page.waitForTimeout(800);

  // Reload — the app should land back in the reader at the saved position
  await page.reload();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({ timeout: 10000 });

  // Re-open TOC, verify the same entry is highlighted as current
  await page.getByRole('button', { name: /table of contents/i }).click();
  const current = page.locator('aside.toc-panel button.toc-panel__entry--current');
  await expect(current).toContainText(targetLabel);
});

test('reload from library view stays in library', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/import/i).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await expect(page.getByRole('button', { name: /pride and prejudice/i })).toBeVisible({ timeout: 10000 });
  await page.reload();
  await expect(page.getByRole('button', { name: /pride and prejudice/i })).toBeVisible();
});
```

- [ ] **Step 2: Run → pass**

```bash
pnpm exec playwright test e2e/reader-restore.spec.ts
```

Expected: PASS. The "current" highlight depends on `currentAnchorId` being threaded into `TocPanel` from `ReaderView` — verify that wire-up exists; if not, add it (it's a small edit in `ReaderView.tsx`'s TOC render block).

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-restore.spec.ts
git commit -m "test(e2e): restore reading position across reloads"
```

---

### Task 20: E2E — preferences persist across reloads and books

**Files:**
- Create: `e2e/reader-preferences.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const FIXTURE = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test('typography + theme preferences persist', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/import/i).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);

  const card = page.getByRole('button', { name: /pride and prejudice/i });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();

  // Open typography panel, switch to dark theme + bigger font
  await page.getByRole('button', { name: /reader preferences/i }).click();
  await page.getByRole('radio', { name: /dark/i }).click();
  await page.getByRole('button', { name: /increase font size/i }).click();

  await page.waitForTimeout(300); // debounced save

  // Theme should be reflected on the reader root
  await expect(page.locator('.reader-view')).toHaveAttribute('data-reader-theme', 'dark');

  // Reload — reader still in dark mode
  await page.reload();
  await expect(page.locator('.reader-view')).toHaveAttribute('data-reader-theme', 'dark');

  // Back to library, then re-open — same dark mode applies on first paint
  await page.getByRole('button', { name: /back to library/i }).click();
  await page.getByRole('button', { name: /pride and prejudice/i }).click();
  await expect(page.locator('.reader-view')).toHaveAttribute('data-reader-theme', 'dark');
});
```

- [ ] **Step 2: Run → pass**

```bash
pnpm exec playwright test e2e/reader-preferences.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-preferences.spec.ts
git commit -m "test(e2e): typography + theme preferences persist across reload and book switch"
```

---

### Task 21: E2E — back navigation leaves library intact

**Files:**
- Create: `e2e/reader-back-nav.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const FIXTURE = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test('back from reader keeps library state intact', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/import/i).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);

  await expect(page.getByRole('button', { name: /pride and prejudice/i })).toBeVisible({ timeout: 10000 });

  // Type into the search box first
  const searchBox = page.getByPlaceholder(/search/i);
  await searchBox.fill('pride');
  await expect(page.getByRole('button', { name: /pride and prejudice/i })).toBeVisible();

  // Open then back
  await page.getByRole('button', { name: /pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();
  await page.getByRole('button', { name: /back to library/i }).click();

  // Library is back, AND the search filter is preserved (transient UI state)
  await expect(page.getByRole('button', { name: /pride and prejudice/i })).toBeVisible();
  // (If search resets on view-change, that's a product call — flag it during PR review.)
});
```

- [ ] **Step 2: Run → pass**

```bash
pnpm exec playwright test e2e/reader-back-nav.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-back-nav.spec.ts
git commit -m "test(e2e): back navigation preserves library state"
```

---

### Task 22: Doc updates (decision history + roadmap)

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Add a decision-history entry for `foliate-js`**

In `docs/02-system-architecture.md`, append to the Decision history section:

```markdown
### 2026-05-03 — Phase 2.1 dependency additions
- `foliate-js` pinned at <version> for EPUB rendering. Sole consumer:
  `src/features/reader/epub/EpubReaderAdapter.ts`. Mapping of foliate-js
  exports to our `BookReader` interface lives at
  `src/features/reader/epub/foliate-notes.md`.
- Schema migrated to v2: new `reading_progress` and `reader_preferences`
  IndexedDB stores. Settings store gains a `view` key that persists
  library-vs-reader navigation across reloads (no router added).
```

- [ ] **Step 2: Update the roadmap status block**

In `docs/04-implementation-roadmap.md`, change the Status block:

```markdown
## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (2026-05-03)
- Phase 2 — in progress (Task 2.1 complete YYYY-MM-DD)
```

(Leave 2.2 / 2.3 unmarked.)

- [ ] **Step 3: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: record foliate-js + schema v2 decisions; mark Phase 2.1 complete"
```

---

### Task 23: Final verification + open PR

**Files:** none

- [ ] **Step 1: Full quality gate**

```bash
pnpm check
```

Expected: all green.

- [ ] **Step 2: Full E2E suite**

```bash
pnpm test:e2e
```

Expected: all green (Phase 1 + Phase 2.1 specs).

- [ ] **Step 3: Manual smoke pass**

```bash
pnpm dev
```

In the browser:
- Import the fixture EPUB; verify it lands on the bookshelf
- Open it; verify content renders, TOC is populated, theme/font controls work
- Navigate to a TOC entry; reload; verify position restored
- Switch to dark theme; reload; verify it persists
- Test paginated vs scroll mode; ensure both render
- Resize the window to mobile width; verify the reader chrome adapts (sheets stay usable)
- Use "Back to library"; verify the bookshelf is intact

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin phase-2-reading-core

gh pr create --title "Phase 2.1 — EPUB reader adapter + minimal reader shell" --body "$(cat <<'EOF'
## Summary
- New `domain/reader/` types + `BookReader` interface
- `EpubReaderAdapter` wrapping `foliate-js` (only file that imports it)
- `readerMachine` (XState v5) for the load lifecycle
- `ReaderView` orchestrator + `ReaderChrome` / `TocPanel` / `TypographyPanel`
- IndexedDB schema v2: `reading_progress` + `reader_preferences` stores
- App-level `view` discriminated union persisted via the existing settings repo (no router added)
- `orphan-sweep` extended to clean up reading_progress for deleted books
- Four new e2e specs (open / restore / preferences / back-nav)

See `docs/superpowers/specs/2026-05-03-phase-2-1-epub-reader-adapter-design.md` for design rationale.

## Test plan
- [ ] `pnpm check` green
- [ ] `pnpm test:e2e` green
- [ ] Manual: import + open + TOC nav + restore on reload (desktop)
- [ ] Manual: theme + font controls + persistence (desktop)
- [ ] Manual: mobile viewport renders reader sheet UI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Mark this plan as complete in the roadmap once the PR merges (separate commit on main)**

---

## Scope coverage check (against spec)

Section in spec → tasks that cover it:

| Spec section | Tasks |
|---|---|
| 4. Architecture (modules, boundaries, per-format mode exception) | T2 (types), T3 (schema), T8 (adapter only foliate-js importer) |
| 5. Domain types | T2 |
| 5.1 `open()` returns `{ toc }` + `onLocationChange` listener | T2 (interface), T8 (impl) |
| 6. Components | T10–T13 + T16 |
| 7. Data flow (open → restore → save → close → reload) | T13, T16 |
| 7.1 `key={bookId}` + debounced save + `applyPreferences` | T13, T16 |
| 8. Reader-load XState machine | T9 |
| 9.1 Schema v1 → v2 | T3, T4 |
| 9.2 Migration test | T4 |
| 9.3 Repos (readingProgress + readerPreferences) | T5, T6 |
| 9.4 View persistence in App | T7, T16 |
| 9.5 Orphan-sweep extension | T17 |
| 10. Error handling & edge cases | T8, T9, T13, T16 |
| 11.1 Unit tests | T2, T4, T5, T6, T7, T9, T10, T11 |
| 11.2 Integration tests | T8, T17 |
| 11.3 E2E specs | T18–T21 |
| 11.4 Acceptance criteria coverage | T18–T21 |
| 12. Risks (deps, throwaway chrome, App growth, theme stripe) | T1, T8, T13, T16 |
| 13. New + modified files | All tasks |
| 14. Dependencies (foliate-js) | T1 |
| 16. Validation checklist | T23 |
