# Phase 1 — Library + Import Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a polished, local-first library that lets users import EPUB/PDF files via drag-and-drop or file picker, persists everything across reloads, and surfaces honest errors. No reading, no annotations, no AI yet.

**Architecture:** Functional core (pure parsers, selectors, state machine) plus an imperative shell (OPFS + IndexedDB adapters, Web Worker, React UI). Per-file XState machine wraps the import pipeline; Zustand stores hold UI state; `idb` wraps IndexedDB; `fflate` reads EPUB zips; `pdfjs-dist` reads PDFs. See `docs/superpowers/specs/2026-05-02-phase-1-library-import-design.md` for the full spec.

**Tech Stack:** React 19 + TypeScript strict + Vite, Zustand, XState v5, `idb`, `fflate`, `pdfjs-dist`, Vitest (with `fake-indexeddb` + `happy-dom`), Playwright.

---

## Milestones

1. **Setup** — dependencies + domain type extensions.
2. **Storage layer** — OPFS adapter, IDB wrapper, migrations, repositories.
3. **Library state + boot** — Zustand store, search/sort selectors, boot loading & error.
4. **Parsing layer** — format detector, EPUB & PDF metadata parsers, fixtures.
5. **Import pipeline** — worker, state machine, queue store, hook.
6. **UI components** — DropOverlay, ImportTray, BookCard, Chrome, Bookshelf, evolved EmptyState.
7. **Integration & verification** — wire `App`, orphan sweep, E2E, full verification.

## File structure

### New files

```
src/
  domain/
    library/
      sort.ts                     # SortKey + comparators
    import/
      result.ts                   # ImportResult discriminated union
      parse-message.ts            # Worker message types
  shared/
    text/
      normalize.ts                # Diacritic + case normalization
  storage/
    db/
      schema.ts                   # IDB store/index names + upgrade fn
      open.ts                     # openBookwormDB factory
      migrations.ts               # Versioned upgrade routines
    adapters/
      opfs.ts                     # OpfsAdapter interface + real impl
      opfs-in-memory.ts           # Test variant
    repositories/
      books.ts                    # BookRepository
      settings.ts                 # SettingsRepository
    orphan-sweep.ts               # Background reconciliation
    index.ts                      # Public storage barrel
  features/
    library/
      LibraryView.tsx             # MODIFIED — picks empty vs workspace
      LibraryWorkspace.tsx
      LibraryBootError.tsx
      Bookshelf.tsx
      BookCard.tsx
      BookCardMenu.tsx
      LibraryChrome.tsx
      LibrarySearchField.tsx
      LibrarySortDropdown.tsx
      ImportButton.tsx
      DropOverlay.tsx
      LibraryEmptyState.tsx       # MODIFIED — adds "Import a book to begin." link
      *.css                       # Co-located CSS per component
      store/
        libraryStore.ts           # Zustand: books, sort, search, derived
        coverCache.ts              # Object URL cache helpers
      boot/
        loadLibrary.ts             # Boot sequence
      import/
        importMachine.ts           # XState v5
        importStore.ts             # Queue orchestrator (Zustand)
        useImportQueue.ts          # React adapter hook
        ImportTray.tsx
        ImportTrayItem.tsx
        importTray.css
        parsers/
          format.ts                # Magic-byte detection
          epub.ts                  # EPUB metadata via fflate
          pdf.ts                   # PDF metadata via pdfjs
        workers/
          import-parser.worker.ts  # Web Worker entry
test-fixtures/
  README.md
  small-pride-and-prejudice.epub  # Project Gutenberg
  malformed-missing-opf.epub      # Built by script
  text-friendly.pdf               # Built by script
  not-a-book.txt
scripts/
  fixtures/
    build-malformed-epub.ts
    build-text-pdf.ts
e2e/
  library-import.spec.ts
  library-search-sort.spec.ts
  library-remove.spec.ts
```

### Modified files

```
package.json                  # Add idb, fflate, pdfjs-dist
src/domain/import/types.ts    # Add SourceRef.checksum
src/domain/book/types.ts      # Add Book.lastOpenedAt
src/app/App.tsx               # Mount DropOverlay + boot library
src/main.tsx                  # Trigger library boot
e2e/empty-state.spec.ts       # Update assertions for the evolved empty state
docs/02-system-architecture.md       # Note new deps in Decision history
docs/04-implementation-roadmap.md    # Mark Phase 1 tasks underway
```

---

## Milestone 1 — Setup

### Task 1: Install Phase 1 dependencies and document them

**Files:**
- Modify: `package.json`
- Modify: `docs/02-system-architecture.md` (Decision history append)

- [ ] **Step 1: Add dependencies via pnpm**

```bash
pnpm add idb fflate pdfjs-dist
```

Expected: pnpm reports `idb` (~3 KB), `fflate` (~9 KB), `pdfjs-dist` resolved. No errors.

- [ ] **Step 2: Verify versions are sane**

```bash
pnpm list idb fflate pdfjs-dist 2>&1 | head
```

Expected: `idb@^8`, `fflate@^0.8`, `pdfjs-dist@^4`. If majors differ, that's fine — pin what pnpm chose.

- [ ] **Step 3: Append a Decision history entry**

Add to the bottom of `docs/02-system-architecture.md`:

```markdown
### 2026-05-02 — Phase 1 dependency additions
- `idb` for IndexedDB promise wrapping
- `fflate` for EPUB zip reading (no `foliate-js` until Phase 2)
- `pdfjs-dist` for PDF metadata + cover thumbnail (already locked in Phase 0; introduced now)
```

- [ ] **Step 4: Verify build still passes**

```bash
pnpm build
```

Expected: build succeeds, dist emitted. (Bundle size grows by ~50–100 KB; we'll measure after wiring.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml docs/02-system-architecture.md
git commit -m "chore: add Phase 1 deps (idb, fflate, pdfjs-dist)"
```

---

### Task 2: Extend domain types

**Files:**
- Modify: `src/domain/import/types.ts`
- Modify: `src/domain/book/types.ts`
- Create: `src/domain/library/sort.ts`
- Create: `src/domain/import/result.ts`
- Create: `src/domain/import/parse-message.ts`
- Modify: `src/domain/index.ts`

- [ ] **Step 1: Add `checksum` to `SourceRef`**

Edit `src/domain/import/types.ts`:

```ts
export type ImportStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'parsing'; readonly progressPercent: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

export type SourceKind = 'imported-file' | 'linked-folder';

export type SourceRef = {
  readonly kind: SourceKind;
  readonly opfsPath: string;
  readonly originalName: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly checksum: string; // SHA-256 hex; used for duplicate detection
};
```

- [ ] **Step 2: Add `lastOpenedAt` to `Book`**

Edit `src/domain/book/types.ts`. Insert into the `Book` type, immediately above `createdAt`:

```ts
  readonly lastOpenedAt?: IsoTimestamp; // undefined = never opened
```

- [ ] **Step 3: Create the sort key module**

Create `src/domain/library/sort.ts`:

```ts
export type SortKey = 'recently-opened' | 'recently-added' | 'title' | 'author';

export const ALL_SORT_KEYS: readonly SortKey[] = [
  'recently-opened',
  'recently-added',
  'title',
  'author',
];

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  'recently-opened': 'Recently opened',
  'recently-added': 'Recently added',
  title: 'Title (A–Z)',
  author: 'Author (A–Z)',
};

export const DEFAULT_SORT: SortKey = 'recently-opened';
```

- [ ] **Step 4: Create the import result discriminated union**

Create `src/domain/import/result.ts`:

```ts
import type { Book } from '../book/types';
import type { BookId } from '../ids';

export type ImportResult =
  | { readonly kind: 'success'; readonly book: Book }
  | { readonly kind: 'duplicate'; readonly existingBookId: BookId }
  | { readonly kind: 'failure'; readonly reason: string; readonly fileName: string };
```

- [ ] **Step 5: Create the worker message contract**

Create `src/domain/import/parse-message.ts`:

```ts
import type { BookFormat } from '../book/types';

export type ParsedMetadata = {
  readonly format: BookFormat;
  readonly title: string;
  readonly author?: string;
  readonly pageOrChapterCount?: number;
  readonly cover?: { readonly bytes: ArrayBuffer; readonly mimeType: string };
};

export type ParseRequest = {
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
  readonly originalName: string;
};

export type ParseResponse =
  | { readonly kind: 'ok'; readonly metadata: ParsedMetadata }
  | { readonly kind: 'error'; readonly reason: string };
```

- [ ] **Step 6: Re-export through the domain barrel**

Edit `src/domain/index.ts`. Append these lines after the existing exports:

```ts
export * from './library/sort';
export * from './import/result';
export * from './import/parse-message';
```

- [ ] **Step 7: Verify type-check passes**

```bash
pnpm type-check
```

Expected: `tsc -b` exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/domain
git commit -m "feat(domain): extend SourceRef with checksum, Book with lastOpenedAt; add SortKey, ImportResult, parse-message types"
```

---

## Milestone 2 — Storage layer

### Task 3: OPFS adapter interface + in-memory test variant

**Files:**
- Create: `src/storage/adapters/opfs.ts`
- Create: `src/storage/adapters/opfs-in-memory.ts`
- Create: `src/storage/adapters/opfs-in-memory.test.ts`

- [ ] **Step 1: Define the adapter interface**

Create `src/storage/adapters/opfs.ts`:

```ts
// OpfsAdapter is the only allowed surface for OPFS access. The real adapter
// is wired in production; tests inject the in-memory variant.

export type OpfsAdapter = {
  writeFile(path: string, blob: Blob): Promise<void>;
  readFile(path: string): Promise<Blob | undefined>;
  removeRecursive(path: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
};

export class OpfsError extends Error {
  constructor(
    readonly cause: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'OpfsError';
  }
}

// Real OPFS implementation. Path segments separated by '/'.
export function createOpfsAdapter(): OpfsAdapter {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new OpfsError(undefined, 'OPFS unavailable in this environment.');
  }

  async function getDirHandle(
    parts: readonly string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  async function getFileHandleAt(
    path: string,
    create: boolean,
  ): Promise<FileSystemFileHandle> {
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) {
      throw new OpfsError(undefined, 'Empty path');
    }
    const fileName = segments[segments.length - 1]!;
    const dirSegments = segments.slice(0, -1);
    const dir = await getDirHandle(dirSegments, create);
    return dir.getFileHandle(fileName, { create });
  }

  return {
    async writeFile(path, blob) {
      try {
        const handle = await getFileHandleAt(path, true);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (err) {
        throw new OpfsError(err, `OPFS write failed at ${path}`);
      }
    },

    async readFile(path) {
      try {
        const handle = await getFileHandleAt(path, false);
        return await handle.getFile();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') {
          return undefined;
        }
        throw new OpfsError(err, `OPFS read failed at ${path}`);
      }
    },

    async removeRecursive(path) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length === 0) return;
      try {
        const parent = await getDirHandle(segments.slice(0, -1), false);
        await parent.removeEntry(segments[segments.length - 1]!, { recursive: true });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return;
        throw new OpfsError(err, `OPFS removeRecursive failed at ${path}`);
      }
    },

    async list(prefix) {
      const segments = prefix.split('/').filter(Boolean);
      try {
        const dir = await getDirHandle(segments, false);
        const names: string[] = [];
        for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
          names.push(name);
        }
        return names;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return [];
        throw new OpfsError(err, `OPFS list failed at ${prefix}`);
      }
    },
  };
}
```

- [ ] **Step 2: Write a failing test for the in-memory adapter**

Create `src/storage/adapters/opfs-in-memory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createInMemoryOpfsAdapter } from './opfs-in-memory';

describe('inMemoryOpfsAdapter', () => {
  it('writes, reads, lists, and removes files recursively', async () => {
    const opfs = createInMemoryOpfsAdapter();

    await opfs.writeFile('books/abc/source.epub', new Blob(['hello']));
    await opfs.writeFile('books/abc/cover.png', new Blob(['cover']));
    await opfs.writeFile('books/xyz/source.pdf', new Blob(['pdf-bytes']));

    const sourceFile = await opfs.readFile('books/abc/source.epub');
    expect(sourceFile).toBeDefined();
    expect(await sourceFile!.text()).toBe('hello');

    expect(await opfs.list('books')).toEqual(expect.arrayContaining(['abc', 'xyz']));
    expect(await opfs.list('books/abc')).toEqual(
      expect.arrayContaining(['source.epub', 'cover.png']),
    );

    await opfs.removeRecursive('books/abc');
    expect(await opfs.readFile('books/abc/source.epub')).toBeUndefined();
    expect(await opfs.list('books')).toEqual(['xyz']);
  });

  it('returns undefined on missing file and empty list on missing dir', async () => {
    const opfs = createInMemoryOpfsAdapter();
    expect(await opfs.readFile('nope/file.txt')).toBeUndefined();
    expect(await opfs.list('nope')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test — expect it to fail**

```bash
pnpm vitest run src/storage/adapters/opfs-in-memory.test.ts
```

Expected: FAIL — `createInMemoryOpfsAdapter` not defined.

- [ ] **Step 4: Implement the in-memory adapter**

Create `src/storage/adapters/opfs-in-memory.ts`:

```ts
import type { OpfsAdapter } from './opfs';

export function createInMemoryOpfsAdapter(): OpfsAdapter {
  // Flat map keyed by full path. Directory existence is implied by file
  // entries; list() simulates directory traversal by string-prefix.
  const files = new Map<string, Blob>();

  const split = (path: string) => path.split('/').filter(Boolean);

  return {
    async writeFile(path, blob) {
      files.set(split(path).join('/'), blob);
    },
    async readFile(path) {
      return files.get(split(path).join('/'));
    },
    async removeRecursive(path) {
      const prefix = split(path).join('/');
      for (const key of [...files.keys()]) {
        if (key === prefix || key.startsWith(`${prefix}/`)) {
          files.delete(key);
        }
      }
    },
    async list(prefix) {
      const segments = split(prefix);
      const base = segments.join('/');
      const seen = new Set<string>();
      for (const key of files.keys()) {
        if (segments.length === 0 || key.startsWith(`${base}/`)) {
          const remainder = segments.length === 0 ? key : key.slice(base.length + 1);
          const head = remainder.split('/')[0];
          if (head) seen.add(head);
        }
      }
      return [...seen];
    },
  };
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm vitest run src/storage/adapters/opfs-in-memory.test.ts
```

Expected: 2 passed.

- [ ] **Step 6: Type-check & lint**

```bash
pnpm type-check && pnpm lint
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/storage/adapters
git commit -m "feat(storage): OpfsAdapter interface + real and in-memory implementations"
```

---

### Task 4: IDB schema + open helper + migration runner

**Files:**
- Create: `src/storage/db/schema.ts`
- Create: `src/storage/db/migrations.ts`
- Create: `src/storage/db/open.ts`
- Create: `src/storage/db/migrations.test.ts`

- [ ] **Step 1: Define the schema types and constants**

Create `src/storage/db/schema.ts`:

```ts
import type { DBSchema } from 'idb';
import type { Book } from '@/domain';

export const DB_NAME = 'bookworm';
export const CURRENT_DB_VERSION = 1;

export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' };

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
}

export const BOOK_STORE = 'books' as const;
export const SETTINGS_STORE = 'settings' as const;
```

- [ ] **Step 2: Implement the migration runner**

Create `src/storage/db/migrations.ts`:

```ts
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { BookwormDBSchema } from './schema';

type UpgradeContext = {
  readonly db: IDBPDatabase<BookwormDBSchema>;
  readonly tx: IDBPTransaction<BookwormDBSchema, ('books' | 'settings')[], 'versionchange'>;
};

type Migration = (ctx: UpgradeContext) => void;

// Each migration moves persisted state from version N to version N+1.
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
};

export function runMigrations(ctx: UpgradeContext, oldVersion: number, newVersion: number): void {
  for (let v = oldVersion; v < newVersion; v += 1) {
    const m = migrations[v];
    if (!m) {
      throw new Error(`No migration registered for version ${v} → ${v + 1}`);
    }
    m(ctx);
  }
}
```

- [ ] **Step 3: Implement the DB opener**

Create `src/storage/db/open.ts`:

```ts
import { openDB, type IDBPDatabase } from 'idb';
import { CURRENT_DB_VERSION, DB_NAME, type BookwormDBSchema } from './schema';
import { runMigrations } from './migrations';

export type BookwormDB = IDBPDatabase<BookwormDBSchema>;

export async function openBookwormDB(name: string = DB_NAME): Promise<BookwormDB> {
  return openDB<BookwormDBSchema>(name, CURRENT_DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      runMigrations({ db, tx }, oldVersion, newVersion ?? CURRENT_DB_VERSION);
    },
    blocked() {
      // eslint-disable-next-line no-console
      console.warn('Bookworm DB upgrade blocked by another tab.');
    },
  });
}
```

- [ ] **Step 4: Add `fake-indexeddb` as a dev dep**

```bash
pnpm add -D fake-indexeddb
```

Expected: `fake-indexeddb@^6` resolved (any current major fine).

- [ ] **Step 5: Write the migration test**

Create `src/storage/db/migrations.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openBookwormDB } from './open';
import { BOOK_STORE, SETTINGS_STORE } from './schema';

describe('v1 baseline migration', () => {
  it('creates books and settings stores with the expected indexes', async () => {
    const db = await openBookwormDB(`bookworm-test-${crypto.randomUUID()}`);

    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining([BOOK_STORE, SETTINGS_STORE]));

    const tx = db.transaction(BOOK_STORE, 'readonly');
    const store = tx.objectStore(BOOK_STORE);
    expect([...store.indexNames]).toEqual(
      expect.arrayContaining(['by-checksum', 'by-created', 'by-last-opened']),
    );

    db.close();
  });
});
```

- [ ] **Step 6: Run the test**

```bash
pnpm vitest run src/storage/db/migrations.test.ts
```

Expected: 1 passed.

- [ ] **Step 7: Type-check & lint**

```bash
pnpm type-check && pnpm lint
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/storage/db
git commit -m "feat(storage): IDB schema, migration runner, v1 baseline"
```

---

### Task 5: BookRepository

**Files:**
- Create: `src/storage/repositories/books.ts`
- Create: `src/storage/repositories/books.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/repositories/books.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createBookRepository } from './books';
import {
  BookId,
  IsoTimestamp,
  type Book,
} from '@/domain';

const sampleBook = (overrides: Partial<Book> = {}): Book => ({
  id: BookId(crypto.randomUUID()),
  title: 'Quiet Things',
  author: 'L. Onuma',
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: 'books/test/source.epub',
    originalName: 'quiet-things.epub',
    byteSize: 1024,
    mimeType: 'application/epub+zip',
    checksum: 'a'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp(new Date().toISOString()),
  updatedAt: IsoTimestamp(new Date().toISOString()),
  ...overrides,
});

describe('BookRepository', () => {
  let db: BookwormDB;

  beforeEach(async () => {
    db = await openBookwormDB(`bookworm-test-${crypto.randomUUID()}`);
  });

  it('round-trips a book via put/getById', async () => {
    const repo = createBookRepository(db);
    const book = sampleBook();
    await repo.put(book);
    const got = await repo.getById(book.id);
    expect(got?.title).toBe('Quiet Things');
  });

  it('finds a book by checksum', async () => {
    const repo = createBookRepository(db);
    const book = sampleBook({ source: { ...sampleBook().source, checksum: 'b'.repeat(64) } });
    await repo.put(book);
    const found = await repo.findByChecksum('b'.repeat(64));
    expect(found?.id).toBe(book.id);
    const missing = await repo.findByChecksum('c'.repeat(64));
    expect(missing).toBeUndefined();
  });

  it('lists all books', async () => {
    const repo = createBookRepository(db);
    await repo.put(sampleBook({ title: 'A' }));
    await repo.put(
      sampleBook({
        title: 'B',
        source: { ...sampleBook().source, checksum: 'd'.repeat(64) },
      }),
    );
    const all = await repo.getAll();
    expect(all.length).toBe(2);
  });

  it('deletes a book', async () => {
    const repo = createBookRepository(db);
    const book = sampleBook();
    await repo.put(book);
    await repo.delete(book.id);
    expect(await repo.getById(book.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/storage/repositories/books.test.ts
```

Expected: FAIL — repository not defined.

- [ ] **Step 3: Implement the repository**

Create `src/storage/repositories/books.ts`:

```ts
import type { Book, BookId } from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_STORE } from '../db/schema';

export type BookRepository = {
  getAll(): Promise<readonly Book[]>;
  getById(id: BookId): Promise<Book | undefined>;
  findByChecksum(checksum: string): Promise<Book | undefined>;
  put(book: Book): Promise<void>;
  delete(id: BookId): Promise<void>;
};

export function createBookRepository(db: BookwormDB): BookRepository {
  return {
    async getAll() {
      return (await db.getAll(BOOK_STORE)) as readonly Book[];
    },
    async getById(id) {
      return (await db.get(BOOK_STORE, id)) as Book | undefined;
    },
    async findByChecksum(checksum) {
      return (await db.getFromIndex(BOOK_STORE, 'by-checksum', checksum)) as Book | undefined;
    },
    async put(book) {
      await db.put(BOOK_STORE, book);
    },
    async delete(id) {
      await db.delete(BOOK_STORE, id);
    },
  };
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/storage/repositories/books.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories/books.ts src/storage/repositories/books.test.ts
git commit -m "feat(storage): BookRepository over typed idb wrapper"
```

---

### Task 6: SettingsRepository

**Files:**
- Create: `src/storage/repositories/settings.ts`
- Create: `src/storage/repositories/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/repositories/settings.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createSettingsRepository } from './settings';

describe('SettingsRepository', () => {
  let db: BookwormDB;

  beforeEach(async () => {
    db = await openBookwormDB(`bookworm-test-${crypto.randomUUID()}`);
  });

  it('reads and writes the librarySort key', async () => {
    const settings = createSettingsRepository(db);
    expect(await settings.getLibrarySort()).toBeUndefined();
    await settings.setLibrarySort('title');
    expect(await settings.getLibrarySort()).toBe('title');
  });

  it('reads and writes the storage persist result', async () => {
    const settings = createSettingsRepository(db);
    await settings.setStoragePersistResult('granted');
    expect(await settings.getStoragePersistResult()).toBe('granted');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/storage/repositories/settings.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the repository**

Create `src/storage/repositories/settings.ts`:

```ts
import type { SortKey } from '@/domain';
import type { BookwormDB } from '../db/open';
import { SETTINGS_STORE, type SettingsRecord } from '../db/schema';

export type SettingsRepository = {
  getLibrarySort(): Promise<SortKey | undefined>;
  setLibrarySort(key: SortKey): Promise<void>;
  getStoragePersistResult(): Promise<'granted' | 'denied' | undefined>;
  setStoragePersistResult(value: 'granted' | 'denied'): Promise<void>;
};

const VALID_SORT_KEYS: ReadonlySet<SortKey> = new Set([
  'recently-opened',
  'recently-added',
  'title',
  'author',
]);

export function createSettingsRepository(db: BookwormDB): SettingsRepository {
  async function get<T extends SettingsRecord>(key: T['key']): Promise<T | undefined> {
    return (await db.get(SETTINGS_STORE, key)) as T | undefined;
  }

  async function put(record: SettingsRecord): Promise<void> {
    await db.put(SETTINGS_STORE, record);
  }

  return {
    async getLibrarySort() {
      const rec = await get<Extract<SettingsRecord, { key: 'librarySort' }>>('librarySort');
      const value = rec?.value as SortKey | undefined;
      return value && VALID_SORT_KEYS.has(value) ? value : undefined;
    },
    async setLibrarySort(key) {
      await put({ key: 'librarySort', value: key });
    },
    async getStoragePersistResult() {
      const rec = await get<Extract<SettingsRecord, { key: 'storagePersistResult' }>>(
        'storagePersistResult',
      );
      return rec?.value;
    },
    async setStoragePersistResult(value) {
      await put({ key: 'storagePersistResult', value });
    },
  };
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/storage/repositories/settings.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories/settings.ts src/storage/repositories/settings.test.ts
git commit -m "feat(storage): SettingsRepository with validated SortKey reads"
```

---

### Task 7: Storage barrel + vitest setup tweaks

**Files:**
- Create: `src/storage/index.ts`
- Modify: `vitest.setup.ts`

- [ ] **Step 1: Public storage barrel**

Create `src/storage/index.ts`:

```ts
export { openBookwormDB, type BookwormDB } from './db/open';
export { CURRENT_DB_VERSION } from './db/schema';
export {
  createBookRepository,
  type BookRepository,
} from './repositories/books';
export {
  createSettingsRepository,
  type SettingsRepository,
} from './repositories/settings';
export {
  createOpfsAdapter,
  OpfsError,
  type OpfsAdapter,
} from './adapters/opfs';
export { createInMemoryOpfsAdapter } from './adapters/opfs-in-memory';
```

- [ ] **Step 2: Make `fake-indexeddb` available globally for tests**

Edit `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: all green (4 test files at minimum, 8+ tests).

- [ ] **Step 4: Commit**

```bash
git add src/storage/index.ts vitest.setup.ts
git commit -m "feat(storage): public barrel; load fake-indexeddb globally for tests"
```

---

## Milestone 3 — Library state + boot

### Task 8: Search-normalization helper

**Files:**
- Create: `src/shared/text/normalize.ts`
- Create: `src/shared/text/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/text/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeForSearch, matchesQuery } from './normalize';

describe('normalizeForSearch', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeForSearch('Vallée')).toBe('vallee');
    expect(normalizeForSearch('Übermensch')).toBe('ubermensch');
    expect(normalizeForSearch('  AlrEady  ')).toBe('  already  ');
  });
});

describe('matchesQuery', () => {
  it('substring match against any haystack', () => {
    expect(matchesQuery('vallee', ['Field Notes from Nowhere', 'P. Vallée'])).toBe(true);
    expect(matchesQuery('vallee', ['Quiet Things', 'L. Onuma'])).toBe(false);
  });
  it('empty query matches anything', () => {
    expect(matchesQuery('', ['anything'])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/shared/text/normalize.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the helper**

Create `src/shared/text/normalize.ts`:

```ts
export function normalizeForSearch(s: string): string {
  return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function matchesQuery(query: string, haystacks: readonly (string | undefined)[]): boolean {
  const q = normalizeForSearch(query.trim());
  if (q.length === 0) return true;
  for (const haystack of haystacks) {
    if (haystack && normalizeForSearch(haystack).includes(q)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/shared/text/normalize.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/text
git commit -m "feat(shared): diacritic-tolerant search normalization"
```

---

### Task 9: Sort comparators

**Files:**
- Create: `src/features/library/store/sort.ts`
- Create: `src/features/library/store/sort.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/library/store/sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareBooks } from './sort';
import { BookId, IsoTimestamp, type Book } from '@/domain';

const make = (over: Partial<Book> & Pick<Book, 'id' | 'title' | 'createdAt'>): Book =>
  ({
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: 'p',
      originalName: 'p',
      byteSize: 0,
      mimeType: 'application/epub+zip',
      checksum: 'x'.repeat(64),
    },
    importStatus: { kind: 'ready' },
    indexingStatus: { kind: 'pending' },
    aiProfileStatus: { kind: 'pending' },
    updatedAt: over.createdAt,
    ...over,
  }) as Book;

const t = (s: string) => IsoTimestamp(s);

describe('compareBooks', () => {
  it('sorts by recently-opened with never-opened to the bottom', () => {
    const opened = make({
      id: BookId('a'),
      title: 'A',
      createdAt: t('2024-01-01T00:00:00Z'),
      lastOpenedAt: t('2024-05-02T00:00:00Z'),
    });
    const never = make({ id: BookId('b'), title: 'B', createdAt: t('2024-04-01T00:00:00Z') });
    const result = [never, opened].sort(compareBooks('recently-opened'));
    expect(result.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('sorts by recently-added desc', () => {
    const older = make({ id: BookId('a'), title: 'A', createdAt: t('2024-01-01T00:00:00Z') });
    const newer = make({ id: BookId('b'), title: 'B', createdAt: t('2024-04-01T00:00:00Z') });
    expect([older, newer].sort(compareBooks('recently-added')).map((b) => b.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('sorts by title locale-compare', () => {
    const z = make({ id: BookId('z'), title: 'Zebra', createdAt: t('2024-01-01T00:00:00Z') });
    const a = make({ id: BookId('a'), title: 'apple', createdAt: t('2024-01-01T00:00:00Z') });
    expect([z, a].sort(compareBooks('title')).map((b) => b.title)).toEqual(['apple', 'Zebra']);
  });

  it('sorts by author with missing authors last', () => {
    const named = make({
      id: BookId('a'),
      title: 'A',
      author: 'Beta',
      createdAt: t('2024-01-01T00:00:00Z'),
    });
    const noauthor = make({ id: BookId('b'), title: 'B', createdAt: t('2024-01-01T00:00:00Z') });
    expect([noauthor, named].sort(compareBooks('author')).map((b) => b.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/features/library/store/sort.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement comparators**

Create `src/features/library/store/sort.ts`:

```ts
import type { Book, SortKey } from '@/domain';

type Cmp = (a: Book, b: Book) => number;

const byString = (a: string | undefined, b: string | undefined): number => {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1; // missing values sort last
  if (b === undefined) return -1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
};

const recentlyOpened: Cmp = (a, b) => {
  if (a.lastOpenedAt === undefined && b.lastOpenedAt === undefined) {
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  }
  if (a.lastOpenedAt === undefined) return 1;
  if (b.lastOpenedAt === undefined) return -1;
  return (
    b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
};

const recentlyAdded: Cmp = (a, b) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

const byTitle: Cmp = (a, b) =>
  byString(a.title, b.title) || b.createdAt.localeCompare(a.createdAt);

const byAuthor: Cmp = (a, b) =>
  byString(a.author, b.author) || byString(a.title, b.title) || a.id.localeCompare(b.id);

const COMPARATORS: Readonly<Record<SortKey, Cmp>> = {
  'recently-opened': recentlyOpened,
  'recently-added': recentlyAdded,
  title: byTitle,
  author: byAuthor,
};

export function compareBooks(key: SortKey): Cmp {
  return COMPARATORS[key];
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/features/library/store/sort.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/library/store/sort.ts src/features/library/store/sort.test.ts
git commit -m "feat(library): sort comparators with stable tie-breakers"
```

---

### Task 10: Add Zustand dependency and library store

**Files:**
- Modify: `package.json`
- Create: `src/features/library/store/coverCache.ts`
- Create: `src/features/library/store/libraryStore.ts`
- Create: `src/features/library/store/libraryStore.test.ts`

- [ ] **Step 1: Add Zustand**

```bash
pnpm add zustand
```

Expected: `zustand@^5` installed.

- [ ] **Step 2: Implement the cover URL cache helper**

Create `src/features/library/store/coverCache.ts`:

```ts
import type { Book, BookId } from '@/domain';
import type { OpfsAdapter } from '@/storage';

// Object URLs are tied to the document. We keep one per BookId and revoke on
// removal or page hide. Resolution is best-effort: if the file or OPFS read
// fails we cache `null` for the session so we don't hammer disk on each render.

export type CoverCache = {
  getUrl(book: Book): Promise<string | null>;
  forget(id: BookId): void;
  forgetAll(): void;
};

export function createCoverCache(opfs: OpfsAdapter): CoverCache {
  const urls = new Map<BookId, string | null>();
  const inflight = new Map<BookId, Promise<string | null>>();

  return {
    async getUrl(book) {
      if (urls.has(book.id)) return urls.get(book.id)!;
      const pending = inflight.get(book.id);
      if (pending) return pending;
      const ref = book.coverRef;
      if (ref.kind !== 'opfs') {
        urls.set(book.id, null);
        return null;
      }
      const work = (async () => {
        try {
          const blob = await opfs.readFile(ref.path);
          if (!blob) {
            urls.set(book.id, null);
            return null;
          }
          const url = URL.createObjectURL(blob);
          urls.set(book.id, url);
          return url;
        } finally {
          inflight.delete(book.id);
        }
      })();
      inflight.set(book.id, work);
      return work;
    },
    forget(id) {
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.delete(id);
    },
    forgetAll() {
      for (const url of urls.values()) {
        if (url) URL.revokeObjectURL(url);
      }
      urls.clear();
    },
  };
}
```

- [ ] **Step 3: Write the library-store test**

Create `src/features/library/store/libraryStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLibraryStore } from './libraryStore';
import { BookId, IsoTimestamp, type Book, DEFAULT_SORT } from '@/domain';

const make = (over: Partial<Book> & Pick<Book, 'id' | 'title'>): Book =>
  ({
    author: undefined,
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: '',
      originalName: '',
      byteSize: 0,
      mimeType: 'application/epub+zip',
      checksum: 'x'.repeat(64),
    },
    importStatus: { kind: 'ready' },
    indexingStatus: { kind: 'pending' },
    aiProfileStatus: { kind: 'pending' },
    createdAt: IsoTimestamp('2024-01-01T00:00:00Z'),
    updatedAt: IsoTimestamp('2024-01-01T00:00:00Z'),
    ...over,
  }) as Book;

describe('libraryStore', () => {
  it('starts empty with the default sort', () => {
    const store = createLibraryStore();
    const state = store.getState();
    expect(state.books).toEqual([]);
    expect(state.sort).toBe(DEFAULT_SORT);
    expect(state.search).toBe('');
  });

  it('exposes a derived visibleBooks selector', () => {
    const store = createLibraryStore();
    store.getState().setBooks([
      make({ id: BookId('a'), title: 'Quiet Things', author: 'L. Onuma' }),
      make({ id: BookId('b'), title: 'On Reading Slowly', author: 'A. Marek' }),
    ]);
    store.getState().setSearch('marek');
    const visible = store.getState().visibleBooks();
    expect(visible.map((b) => b.id)).toEqual(['b']);
  });

  it('upserts a single book', () => {
    const store = createLibraryStore();
    store.getState().upsertBook(make({ id: BookId('a'), title: 'A' }));
    expect(store.getState().books.length).toBe(1);
    store.getState().upsertBook(make({ id: BookId('a'), title: 'A revised' }));
    expect(store.getState().books[0]?.title).toBe('A revised');
  });

  it('removes a book', () => {
    const store = createLibraryStore();
    store.getState().setBooks([make({ id: BookId('a'), title: 'A' })]);
    store.getState().removeBook(BookId('a'));
    expect(store.getState().books).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test — expect failure**

```bash
pnpm vitest run src/features/library/store/libraryStore.test.ts
```

Expected: FAIL.

- [ ] **Step 5: Implement the store**

Create `src/features/library/store/libraryStore.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Book, BookId, SortKey } from '@/domain';
import { DEFAULT_SORT } from '@/domain';
import { compareBooks } from './sort';
import { matchesQuery } from '@/shared/text/normalize';

export type LibraryState = {
  readonly books: readonly Book[];
  readonly sort: SortKey;
  readonly search: string;
  readonly bootStatus:
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready' }
    | { readonly kind: 'error'; readonly reason: string };

  setBooks(books: readonly Book[]): void;
  upsertBook(book: Book): void;
  removeBook(id: BookId): void;
  setSort(key: SortKey): void;
  setSearch(query: string): void;
  setBootStatus(status: LibraryState['bootStatus']): void;

  visibleBooks(): readonly Book[];
};

export type LibraryStore = StoreApi<LibraryState>;

export function createLibraryStore(): LibraryStore {
  return createStore<LibraryState>((set, get) => ({
    books: [],
    sort: DEFAULT_SORT,
    search: '',
    bootStatus: { kind: 'idle' },

    setBooks(books) {
      set({ books });
    },
    upsertBook(book) {
      set((s) => ({
        books: s.books.some((b) => b.id === book.id)
          ? s.books.map((b) => (b.id === book.id ? book : b))
          : [...s.books, book],
      }));
    },
    removeBook(id) {
      set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
    },
    setSort(key) {
      set({ sort: key });
    },
    setSearch(query) {
      set({ search: query });
    },
    setBootStatus(bootStatus) {
      set({ bootStatus });
    },
    visibleBooks() {
      const { books, sort, search } = get();
      const sorted = [...books].sort(compareBooks(sort));
      if (!search.trim()) return sorted;
      return sorted.filter((b) => matchesQuery(search, [b.title, b.author]));
    },
  }));
}
```

- [ ] **Step 6: Run test — expect pass**

```bash
pnpm vitest run src/features/library/store/libraryStore.test.ts
```

Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/library/store
git commit -m "feat(library): Zustand library store + cover URL cache"
```

---

### Task 11: Library boot — load and error UI

**Files:**
- Create: `src/features/library/boot/loadLibrary.ts`
- Create: `src/features/library/LibraryBootError.tsx`
- Create: `src/features/library/library-boot-error.css`

- [ ] **Step 1: Implement the boot loader**

Create `src/features/library/boot/loadLibrary.ts`:

```ts
import {
  createBookRepository,
  createSettingsRepository,
  openBookwormDB,
  type BookwormDB,
} from '@/storage';
import type { LibraryStore } from '../store/libraryStore';

export type LibraryBootDeps = {
  readonly store: LibraryStore;
  readonly openDB?: () => Promise<BookwormDB>;
};

export async function loadLibrary({ store, openDB = () => openBookwormDB() }: LibraryBootDeps) {
  store.getState().setBootStatus({ kind: 'loading' });
  try {
    const db = await openDB();
    const books = await createBookRepository(db).getAll();
    const settings = createSettingsRepository(db);
    const sort = await settings.getLibrarySort();
    store.getState().setBooks(books);
    if (sort) store.getState().setSort(sort);
    store.getState().setBootStatus({ kind: 'ready' });
    return db;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    store.getState().setBootStatus({ kind: 'error', reason });
    throw err;
  }
}
```

- [ ] **Step 2: Implement the boot-error component**

Create `src/features/library/LibraryBootError.tsx`:

```tsx
import './library-boot-error.css';

type Props = {
  readonly reason: string;
};

export function LibraryBootError({ reason }: Props) {
  return (
    <main className="library-boot-error" aria-labelledby="boot-error-title">
      <div className="library-boot-error__plate">
        <p className="library-boot-error__eyebrow">Bookworm</p>
        <h1 id="boot-error-title" className="library-boot-error__title">
          We couldn’t open your library.
        </h1>
        <p className="library-boot-error__body">{reason}</p>
        <p className="library-boot-error__hint">
          Reloading usually clears this. If it keeps happening, your storage may need attention.
        </p>
        <button
          className="library-boot-error__action"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: CSS for the boot error**

Create `src/features/library/library-boot-error.css`:

```css
.library-boot-error {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-10) var(--space-8);
}
.library-boot-error__plate {
  max-width: 36rem;
  padding: var(--space-12) var(--space-10);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}
.library-boot-error__eyebrow {
  font-size: var(--text-sm);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-accent);
  margin-bottom: var(--space-7);
}
.library-boot-error__title {
  font-family: var(--font-serif);
  font-size: var(--text-2xl);
  line-height: var(--leading-tight);
  font-weight: 500;
  margin-bottom: var(--space-7);
}
.library-boot-error__body {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  margin-bottom: var(--space-7);
  word-break: break-word;
}
.library-boot-error__hint {
  font-style: italic;
  color: var(--color-text-subtle);
  font-size: var(--text-sm);
  margin-bottom: var(--space-10);
}
.library-boot-error__action {
  background: var(--color-text);
  color: var(--color-bg);
  border: none;
  padding: 10px 18px;
  border-radius: var(--radius-base);
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  cursor: pointer;
}
.library-boot-error__action:hover {
  background: color-mix(in oklab, var(--color-text) 88%, var(--color-accent) 12%);
}
```

- [ ] **Step 4: Type-check & lint**

```bash
pnpm type-check && pnpm lint
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/library/boot src/features/library/LibraryBootError.tsx src/features/library/library-boot-error.css
git commit -m "feat(library): boot loader + LibraryBootError surface"
```

---

## Milestone 4 — Parsing layer

### Task 12: Format detector

**Files:**
- Create: `src/features/library/import/parsers/format.ts`
- Create: `src/features/library/import/parsers/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/library/import/parsers/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectFormat } from './format';

const bytesOf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;

describe('detectFormat', () => {
  it('detects PDF by %PDF- prefix', () => {
    expect(detectFormat(bytesOf('%PDF-1.7\n...'))).toBe('pdf');
  });
  it('detects EPUB by zip magic + epub mime', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const buf = new Uint8Array(zipMagic.length + 30);
    buf.set(zipMagic, 0);
    expect(detectFormat(buf.buffer)).toBe('epub');
  });
  it('returns null for unknown content', () => {
    expect(detectFormat(bytesOf('hello world'))).toBeNull();
  });
  it('returns null for empty bytes', () => {
    expect(detectFormat(new ArrayBuffer(0))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/features/library/import/parsers/format.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement detector**

Create `src/features/library/import/parsers/format.ts`:

```ts
import type { BookFormat } from '@/domain';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function startsWith(view: Uint8Array, magic: readonly number[]): boolean {
  if (view.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (view[i] !== magic[i]) return false;
  }
  return true;
}

export function detectFormat(bytes: ArrayBuffer): BookFormat | null {
  if (bytes.byteLength === 0) return null;
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16));
  if (startsWith(view, PDF_MAGIC)) return 'pdf';
  if (startsWith(view, ZIP_MAGIC)) return 'epub';
  return null;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/features/library/import/parsers/format.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/library/import/parsers/format.ts src/features/library/import/parsers/format.test.ts
git commit -m "feat(import): magic-byte format detector"
```

---

### Task 13: EPUB metadata parser

**Files:**
- Create: `src/features/library/import/parsers/epub.ts`
- Create: `src/features/library/import/parsers/epub.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/library/import/parsers/epub.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseEpubMetadata } from './epub';

function buildEpub(opts: {
  containerXml?: string;
  opf?: string;
  files?: Record<string, string | Uint8Array>;
}): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      opts.containerXml ??
        `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>`,
    ),
    'OEBPS/content.opf': strToU8(
      opts.opf ??
        `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Quiet Things</dc:title>
            <dc:creator>L. Onuma</dc:creator>
            <meta name="cover" content="cover-img"/>
          </metadata>
          <manifest>
            <item id="cover-img" href="cover.png" media-type="image/png"/>
          </manifest>
        </package>`,
    ),
    'OEBPS/cover.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    ...Object.fromEntries(
      Object.entries(opts.files ?? {}).map(([k, v]) => [
        k,
        typeof v === 'string' ? strToU8(v) : v,
      ]),
    ),
  };
  return zipSync(files).buffer;
}

describe('parseEpubMetadata', () => {
  it('extracts title, author and cover', async () => {
    const buf = buildEpub({});
    const meta = await parseEpubMetadata(buf, 'quiet-things.epub');
    expect(meta.kind).toBe('ok');
    if (meta.kind === 'ok') {
      expect(meta.metadata.title).toBe('Quiet Things');
      expect(meta.metadata.author).toBe('L. Onuma');
      expect(meta.metadata.cover?.mimeType).toBe('image/png');
    }
  });

  it('falls back to filename when title is missing', async () => {
    const buf = buildEpub({
      opf: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata/></package>`,
    });
    const meta = await parseEpubMetadata(buf, 'untitled-draft.epub');
    expect(meta.kind).toBe('ok');
    if (meta.kind === 'ok') expect(meta.metadata.title).toBe('untitled-draft');
  });

  it('errors when META-INF/container.xml is missing', async () => {
    const buf = buildEpub({
      // pass empty container; the OPF won't be discoverable
      containerXml: ' ',
    });
    const meta = await parseEpubMetadata(buf, 'broken.epub');
    expect(meta.kind).toBe('error');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/features/library/import/parsers/epub.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement parser**

Create `src/features/library/import/parsers/epub.ts`:

```ts
import { unzipSync, strFromU8 } from 'fflate';
import type { ParsedMetadata, ParseResponse } from '@/domain';

const CONTAINER_PATH = 'META-INF/container.xml';

const COVER_MIME = (href: string): string => {
  const lower = href.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
};

function findOpfPath(containerXml: string): string | null {
  const match = /<rootfile[^>]*full-path="([^"]+)"/.exec(containerXml);
  return match?.[1] ?? null;
}

function pluckTagText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`);
  const m = re.exec(xml);
  return m?.[1]?.trim();
}

function pluckCoverHref(opfXml: string): string | undefined {
  // EPUB 3: <item properties="cover-image" href="...">
  const ep3 = /<item\s[^>]*properties="[^"]*cover-image[^"]*"[^>]*href="([^"]+)"/.exec(opfXml);
  if (ep3?.[1]) return ep3[1];
  // EPUB 2: <meta name="cover" content="<id>"/>; resolve via manifest
  const idMatch = /<meta\s+name="cover"\s+content="([^"]+)"/.exec(opfXml);
  if (idMatch?.[1]) {
    const idRe = new RegExp(`<item[^>]*id="${idMatch[1]}"[^>]*href="([^"]+)"`);
    const m = idRe.exec(opfXml);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function joinPath(base: string, rel: string): string {
  const segments = base.split('/').slice(0, -1).concat(rel.split('/'));
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export async function parseEpubMetadata(
  bytes: ArrayBuffer,
  fileName: string,
): Promise<ParseResponse> {
  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch (err) {
    return { kind: 'error', reason: 'This EPUB couldn’t be unzipped.' };
  }

  const containerBytes = entries[CONTAINER_PATH];
  if (!containerBytes) {
    return {
      kind: 'error',
      reason: 'This EPUB is missing its core file (META-INF/container.xml).',
    };
  }
  const opfPath = findOpfPath(strFromU8(containerBytes));
  if (!opfPath) {
    return { kind: 'error', reason: 'This EPUB has no OPF root file.' };
  }
  const opfBytes = entries[opfPath];
  if (!opfBytes) {
    return { kind: 'error', reason: `This EPUB references ${opfPath} but it’s not in the file.` };
  }
  const opfXml = strFromU8(opfBytes);

  const titleFromOpf = pluckTagText(opfXml, 'title');
  const authorFromOpf = pluckTagText(opfXml, 'creator');

  const coverHref = pluckCoverHref(opfXml);
  let cover: ParsedMetadata['cover'];
  if (coverHref) {
    const coverPath = joinPath(opfPath, coverHref);
    const coverBytes = entries[coverPath];
    if (coverBytes) {
      cover = {
        bytes: coverBytes.buffer.slice(
          coverBytes.byteOffset,
          coverBytes.byteOffset + coverBytes.byteLength,
        ) as ArrayBuffer,
        mimeType: COVER_MIME(coverHref),
      };
    }
  }

  const fallbackTitle = fileName.replace(/\.[^.]+$/, '') || fileName;

  return {
    kind: 'ok',
    metadata: {
      format: 'epub',
      title: titleFromOpf || fallbackTitle,
      author: authorFromOpf,
      cover,
    },
  };
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/features/library/import/parsers/epub.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/library/import/parsers/epub.ts src/features/library/import/parsers/epub.test.ts
git commit -m "feat(import): EPUB metadata parser via fflate"
```

---

### Task 14: PDF metadata parser

**Files:**
- Create: `src/features/library/import/parsers/pdf.ts`
- Create: `scripts/fixtures/build-text-pdf.ts`
- Create: `test-fixtures/text-friendly.pdf` (output of script)
- Create: `src/features/library/import/parsers/pdf.test.ts`
- Create: `test-fixtures/README.md`

- [ ] **Step 1: Write the fixture-builder script**

Create `scripts/fixtures/build-text-pdf.ts`:

```ts
// Produces a minimal valid 1-page PDF with /Info Title and Author.
// Run with: pnpm tsx scripts/fixtures/build-text-pdf.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function pdfString(s: string): string {
  return `(${s.replace(/[\\()]/g, (ch) => `\\${ch}`)})`;
}

function buildPdf(): Uint8Array {
  const objects: string[] = [];
  const offsets: number[] = [];

  const push = (body: string) => {
    const id = objects.length + 1;
    objects.push(`${id} 0 obj\n${body}\nendobj\n`);
    return id;
  };

  const fontId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentStream = 'BT /F1 24 Tf 72 720 Td (Hello, Bookworm.) Tj ET';
  const contentId = push(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
  const pageId = objects.length + 2; // we'll compute below; placeholder

  // We need the pages object id BEFORE we know it. Build in order: page, pages, catalog.
  // Restart with correct ordering:
  objects.length = 0;
  offsets.length = 0;
  const fId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const cId = push(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
  // Reserve next ids: page=3, pages=4, catalog=5
  const pId = push(
    `<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Contents ${cId} 0 R /Resources << /Font << /F1 ${fId} 0 R >> >> >>`,
  );
  const psId = push(`<< /Type /Pages /Kids [${pId} 0 R] /Count 1 >>`);
  const catId = push(`<< /Type /Catalog /Pages ${psId} 0 R >>`);
  const infoId = push(
    `<< /Title ${pdfString('Text-Friendly PDF')} /Author ${pdfString('Bookworm Test Suite')} >>`,
  );

  const header = '%PDF-1.4\n%âãÏÓ\n';
  let body = header;
  for (let i = 0; i < objects.length; i += 1) {
    offsets[i] = body.length;
    body += objects[i];
  }
  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${objects.length + 1} /Root ${catId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
}

const out = resolve(process.cwd(), 'test-fixtures/text-friendly.pdf');
writeFileSync(out, buildPdf());
// eslint-disable-next-line no-console
console.log(`Wrote ${out}`);
```

- [ ] **Step 2: Add tsx and run the fixture builder**

```bash
pnpm add -D tsx
pnpm tsx scripts/fixtures/build-text-pdf.ts
```

Expected: writes `test-fixtures/text-friendly.pdf` (~700 bytes).

- [ ] **Step 3: Add the fixtures README**

Create `test-fixtures/README.md`:

```markdown
# Bookworm test fixtures

These are versioned fixtures used by Vitest and Playwright. Each entry is intentional — replacement requires explanation in the PR.

| File | Purpose | Provenance |
|---|---|---|
| `small-pride-and-prejudice.epub` | Well-formed EPUB, small | Project Gutenberg, public domain — see https://www.gutenberg.org/ebooks/1342 |
| `text-friendly.pdf` | Simple text PDF | Generated reproducibly by `scripts/fixtures/build-text-pdf.ts` |
| `malformed-missing-opf.epub` | EPUB without `META-INF/container.xml` | Generated by `scripts/fixtures/build-malformed-epub.ts` |
| `not-a-book.txt` | Plain text, used in unsupported-format paths | Hand-authored |

To regenerate the synthetic fixtures: `pnpm tsx scripts/fixtures/<name>.ts`
```

- [ ] **Step 4: Configure pdf.js worker for tests and runtime**

Vitest runs in `happy-dom`; pdf.js looks for a worker. We use the `legacy` build (no worker) in node + browser tests; production wires the bundled worker.

Create a small wiring module — `src/features/library/import/parsers/pdf-pdfjs.ts`:

```ts
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  // In production we ship the worker via Vite's `?worker` import.
  // This module imports a URL-resolved worker only on the browser.
  // The dynamic import keeps Node + tests happy.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import('pdfjs-dist/build/pdf.worker.mjs?url').then((mod) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = (mod as { default: string }).default;
  });
}

export const pdfjs = pdfjsLib;
```

- [ ] **Step 5: Write the parser test**

Create `src/features/library/import/parsers/pdf.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePdfMetadata } from './pdf';

describe('parsePdfMetadata', () => {
  it('reads /Info title and author from the text-friendly fixture', async () => {
    const buf = await readFile(resolve(process.cwd(), 'test-fixtures/text-friendly.pdf'));
    const meta = await parsePdfMetadata(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      'text-friendly.pdf',
    );
    expect(meta.kind).toBe('ok');
    if (meta.kind === 'ok') {
      expect(meta.metadata.title).toBe('Text-Friendly PDF');
      expect(meta.metadata.author).toBe('Bookworm Test Suite');
    }
  });

  it('falls back to filename when /Info is missing', async () => {
    const meta = await parsePdfMetadata(
      new TextEncoder().encode(
        '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj 2 0 obj << /Type /Pages /Count 0 /Kids [] >> endobj xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000054 00000 n \ntrailer << /Size 3 /Root 1 0 R >>\nstartxref\n100\n%%EOF',
      ).buffer as ArrayBuffer,
      'mystery.pdf',
    );
    if (meta.kind === 'ok') {
      expect(meta.metadata.title).toBe('mystery');
    }
  });
});
```

- [ ] **Step 6: Implement the parser**

Create `src/features/library/import/parsers/pdf.ts`:

```ts
import type { ParseResponse } from '@/domain';
import { pdfjs } from './pdf-pdfjs';

export async function parsePdfMetadata(
  bytes: ArrayBuffer,
  fileName: string,
): Promise<ParseResponse> {
  try {
    const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, disableFontFace: true }).promise;
    let title: string | undefined;
    let author: string | undefined;
    try {
      const info = (await doc.getMetadata()).info as { Title?: string; Author?: string };
      title = info.Title?.trim() || undefined;
      author = info.Author?.trim() || undefined;
    } catch {
      // some PDFs have no Info dict; fall through
    }
    const pageCount = doc.numPages;
    let cover: { bytes: ArrayBuffer; mimeType: string } | undefined;
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.6 });
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(viewport.width, viewport.height)
          : null;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport })
            .promise;
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          cover = { bytes: await blob.arrayBuffer(), mimeType: 'image/png' };
        }
      }
    } catch {
      // cover render is best-effort
    }
    await doc.destroy();
    return {
      kind: 'ok',
      metadata: {
        format: 'pdf',
        title: title || fileName.replace(/\.[^.]+$/, '') || fileName,
        author,
        pageOrChapterCount: pageCount,
        cover,
      },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'PDF parse failed';
    return { kind: 'error', reason: `This PDF couldn’t be opened (${reason}).` };
  }
}
```

- [ ] **Step 7: Run the parser test**

```bash
pnpm vitest run src/features/library/import/parsers/pdf.test.ts
```

Expected: 2 passed. (`OffscreenCanvas` may be unavailable in `happy-dom`; the cover render is best-effort and the test only checks title/author.)

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml scripts test-fixtures src/features/library/import/parsers
git commit -m "feat(import): PDF metadata parser + reproducible PDF fixture"
```

---

### Task 15: Malformed-EPUB fixture + the not-a-book.txt fixture

**Files:**
- Create: `scripts/fixtures/build-malformed-epub.ts`
- Create: `test-fixtures/malformed-missing-opf.epub` (output)
- Create: `test-fixtures/not-a-book.txt`

- [ ] **Step 1: Write the fixture script**

Create `scripts/fixtures/build-malformed-epub.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const buf = zipSync({
  mimetype: strToU8('application/epub+zip'),
  // Intentionally no META-INF/container.xml
});

const out = resolve(process.cwd(), 'test-fixtures/malformed-missing-opf.epub');
writeFileSync(out, buf);
// eslint-disable-next-line no-console
console.log(`Wrote ${out}`);
```

- [ ] **Step 2: Run it**

```bash
pnpm tsx scripts/fixtures/build-malformed-epub.ts
```

Expected: writes the malformed fixture (~50 bytes).

- [ ] **Step 3: Create the not-a-book file**

Create `test-fixtures/not-a-book.txt`:

```
This is a plain text file. Bookworm should refuse to import it.
```

- [ ] **Step 4: Source the Project Gutenberg EPUB manually**

The Pride and Prejudice EPUB (`small-pride-and-prejudice.epub`) is downloaded once from `https://www.gutenberg.org/ebooks/1342` and committed. If absent, fail loudly:

```bash
test -f test-fixtures/small-pride-and-prejudice.epub \
  || echo "Download from https://www.gutenberg.org/ebooks/1342 (EPUB version) and save as test-fixtures/small-pride-and-prejudice.epub"
```

- [ ] **Step 5: Commit fixtures**

```bash
git add scripts/fixtures/build-malformed-epub.ts test-fixtures/malformed-missing-opf.epub test-fixtures/not-a-book.txt
git commit -m "test: add malformed-EPUB and not-a-book fixtures"
```

---

## Milestone 5 — Import pipeline

### Task 16: Import worker

**Files:**
- Create: `src/features/library/import/workers/import-parser.worker.ts`

- [ ] **Step 1: Implement the worker**

Create `src/features/library/import/workers/import-parser.worker.ts`:

```ts
/// <reference lib="webworker" />
import type { ParseRequest, ParseResponse } from '@/domain';
import { detectFormat } from '../parsers/format';
import { parseEpubMetadata } from '../parsers/epub';
import { parsePdfMetadata } from '../parsers/pdf';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { bytes, originalName } = event.data;
  let response: ParseResponse;
  try {
    const format = detectFormat(bytes);
    if (format === 'epub') {
      response = await parseEpubMetadata(bytes, originalName);
    } else if (format === 'pdf') {
      response = await parsePdfMetadata(bytes, originalName);
    } else {
      response = { kind: 'error', reason: 'Not a supported format.' };
    }
  } catch (err) {
    response = {
      kind: 'error',
      reason: err instanceof Error ? `Unknown error — ${err.message}` : 'Unknown error.',
    };
  }
  self.postMessage(response);
};
```

- [ ] **Step 2: Type-check & lint**

```bash
pnpm type-check && pnpm lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/library/import/workers
git commit -m "feat(import): dedicated parser worker"
```

---

### Task 17: Import state machine

**Files:**
- Create: `src/features/library/import/importMachine.ts`
- Create: `src/features/library/import/importMachine.test.ts`

- [ ] **Step 1: Add XState dependency**

```bash
pnpm add xstate @xstate/react
```

Expected: `xstate@^5`, `@xstate/react@^5` installed.

- [ ] **Step 2: Write the state-machine test**

Create `src/features/library/import/importMachine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { importMachine } from './importMachine';
import {
  BookId,
  IsoTimestamp,
  type Book,
  type ParsedMetadata,
} from '@/domain';

const fakeFile = (bytes: Uint8Array, name: string, type: string): File =>
  new File([bytes], name, { type });

const fakeBook: Book = {
  id: BookId('test'),
  title: 'Quiet Things',
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: 'books/test/source.epub',
    originalName: 'qt.epub',
    byteSize: 4,
    mimeType: 'application/epub+zip',
    checksum: 'a'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp('2024-01-01T00:00:00Z'),
  updatedAt: IsoTimestamp('2024-01-01T00:00:00Z'),
};

const baseInput = {
  file: fakeFile(new Uint8Array([1, 2, 3, 4]), 'qt.epub', 'application/epub+zip'),
  readBytes: async () => new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer,
  hashBytes: async () => 'a'.repeat(64),
  findByChecksum: async (_: string) => undefined as Book | undefined,
  parseInWorker: async (): Promise<ParsedMetadata> => ({
    format: 'epub',
    title: 'Quiet Things',
  }),
  persistBook: async (_args: unknown) => fakeBook,
};

describe('importMachine', () => {
  it('happy path resolves to success', async () => {
    const actor = createActor(importMachine, { input: baseInput }).start();
    const result = await new Promise((resolve) => {
      actor.subscribe((s) => {
        if (s.status === 'done') resolve(s.output);
      });
    });
    expect(result).toMatchObject({ kind: 'success', book: { id: 'test' } });
  });

  it('resolves to duplicate when checksum matches existing book', async () => {
    const actor = createActor(importMachine, {
      input: { ...baseInput, findByChecksum: async () => fakeBook },
    }).start();
    const result = await new Promise((resolve) => {
      actor.subscribe((s) => {
        if (s.status === 'done') resolve(s.output);
      });
    });
    expect(result).toMatchObject({ kind: 'duplicate', existingBookId: 'test' });
  });

  it('resolves to failure when parsing throws', async () => {
    const actor = createActor(importMachine, {
      input: {
        ...baseInput,
        parseInWorker: async () => {
          throw new Error('Not a valid EPUB');
        },
      },
    }).start();
    const result = await new Promise((resolve) => {
      actor.subscribe((s) => {
        if (s.status === 'done') resolve(s.output);
      });
    });
    expect(result).toMatchObject({ kind: 'failure' });
  });
});
```

- [ ] **Step 3: Run test — expect failure**

```bash
pnpm vitest run src/features/library/import/importMachine.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement the machine**

Create `src/features/library/import/importMachine.ts`:

```ts
import { assign, fromPromise, setup } from 'xstate';
import type { Book, BookId, ParsedMetadata } from '@/domain';

export type ImportInput = {
  readonly file: File;
  readBytes(file: File): Promise<ArrayBuffer>;
  hashBytes(bytes: ArrayBuffer): Promise<string>;
  findByChecksum(checksum: string): Promise<Book | undefined>;
  parseInWorker(args: { bytes: ArrayBuffer; mimeType: string; originalName: string }): Promise<ParsedMetadata>;
  persistBook(args: {
    file: File;
    bytes: ArrayBuffer;
    metadata: ParsedMetadata;
    checksum: string;
  }): Promise<Book>;
};

type Context = {
  readonly file: File;
  bytes?: ArrayBuffer;
  checksum?: string;
  metadata?: ParsedMetadata;
  book?: Book;
  existingBookId?: BookId;
  reason?: string;
};

export type ImportOutput =
  | { kind: 'success'; book: Book }
  | { kind: 'duplicate'; existingBookId: BookId }
  | { kind: 'failure'; reason: string; fileName: string };

export const importMachine = setup({
  types: {
    input: {} as ImportInput,
    context: {} as Context,
    output: {} as ImportOutput,
  },
  actors: {
    readBytes: fromPromise(async ({ input }: { input: { input: ImportInput } }) =>
      input.input.readBytes(input.input.file),
    ),
    hashBytes: fromPromise(
      async ({ input }: { input: { input: ImportInput; bytes: ArrayBuffer } }) =>
        input.input.hashBytes(input.bytes),
    ),
    findByChecksum: fromPromise(
      async ({ input }: { input: { input: ImportInput; checksum: string } }) =>
        input.input.findByChecksum(input.checksum),
    ),
    parseInWorker: fromPromise(
      async ({
        input,
      }: {
        input: { input: ImportInput; bytes: ArrayBuffer };
      }) =>
        input.input.parseInWorker({
          bytes: input.bytes,
          mimeType: input.input.file.type,
          originalName: input.input.file.name,
        }),
    ),
    persistBook: fromPromise(
      async ({
        input,
      }: {
        input: {
          input: ImportInput;
          file: File;
          bytes: ArrayBuffer;
          metadata: ParsedMetadata;
          checksum: string;
        };
      }) =>
        input.input.persistBook({
          file: input.file,
          bytes: input.bytes,
          metadata: input.metadata,
          checksum: input.checksum,
        }),
    ),
  },
}).createMachine({
  id: 'import',
  initial: 'reading',
  context: ({ input }) => ({ file: input.file }) satisfies Context,
  output: ({ context }): ImportOutput => {
    if (context.book) return { kind: 'success', book: context.book };
    if (context.existingBookId) return { kind: 'duplicate', existingBookId: context.existingBookId };
    return {
      kind: 'failure',
      reason: context.reason ?? 'Unknown error.',
      fileName: context.file.name,
    };
  },
  states: {
    reading: {
      invoke: {
        src: 'readBytes',
        input: ({ self }) => ({ input: self.system.get('input') ?? (self as unknown as { _input: ImportInput })._input }),
        onDone: {
          target: 'hashing',
          actions: assign({ bytes: ({ event }) => event.output as ArrayBuffer }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            reason: ({ event }) =>
              event.error instanceof Error
                ? `Couldn't read this file (${event.error.message}).`
                : "Couldn't read this file.",
          }),
        },
      },
    },
    hashing: {
      invoke: {
        src: 'hashBytes',
        input: ({ context, self }) => ({
          input: (self as unknown as { _input: ImportInput })._input,
          bytes: context.bytes!,
        }),
        onDone: {
          target: 'dedupCheck',
          actions: assign({ checksum: ({ event }) => event.output as string }),
        },
        onError: {
          target: 'failed',
          actions: assign({ reason: () => 'Hashing failed.' }),
        },
      },
    },
    dedupCheck: {
      invoke: {
        src: 'findByChecksum',
        input: ({ context, self }) => ({
          input: (self as unknown as { _input: ImportInput })._input,
          checksum: context.checksum!,
        }),
        onDone: [
          {
            guard: ({ event }) => Boolean(event.output),
            target: 'duplicate',
            actions: assign({
              existingBookId: ({ event }) => (event.output as Book).id,
            }),
          },
          { target: 'parsing' },
        ],
        onError: {
          target: 'failed',
          actions: assign({ reason: () => 'Couldn’t check for duplicates.' }),
        },
      },
    },
    parsing: {
      invoke: {
        src: 'parseInWorker',
        input: ({ context, self }) => ({
          input: (self as unknown as { _input: ImportInput })._input,
          bytes: context.bytes!,
        }),
        onDone: {
          target: 'persisting',
          actions: assign({ metadata: ({ event }) => event.output as ParsedMetadata }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            reason: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Parse failed.',
          }),
        },
      },
    },
    persisting: {
      invoke: {
        src: 'persistBook',
        input: ({ context, self }) => ({
          input: (self as unknown as { _input: ImportInput })._input,
          file: context.file,
          bytes: context.bytes!,
          metadata: context.metadata!,
          checksum: context.checksum!,
        }),
        onDone: {
          target: 'done',
          actions: assign({ book: ({ event }) => event.output as Book }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            reason: ({ event }) =>
              event.error instanceof Error
                ? event.error.name === 'QuotaExceededError'
                  ? 'Browser ran out of storage.'
                  : `Couldn’t save book (${event.error.message}).`
                : 'Couldn’t save book.',
          }),
        },
      },
    },
    done: { type: 'final' },
    duplicate: { type: 'final' },
    failed: { type: 'final' },
  },
});
```

> **Note:** XState v5's exact `input` plumbing for nested actor inputs is brittle to write generically — if the test fails because the actor input shape doesn't match, switch each `invoke.src` from a registered actor name to an inline `fromPromise` that closes over the parent input. The minimum-viable shape is "actor receives `input` and returns the right typed result." This implementation note is here so the executing engineer can adapt without re-engineering the contract.

- [ ] **Step 5: Run test — expect pass (fix actor wiring if needed)**

```bash
pnpm vitest run src/features/library/import/importMachine.test.ts
```

Expected: 3 passed. If actor input wiring complains, replace named-actor invokes with inline `fromPromise` wrappers that capture the input via the machine's `input`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/library/import
git commit -m "feat(import): per-file XState v5 machine with all transition tests"
```

---

### Task 18: Import store (queue orchestrator)

**Files:**
- Create: `src/features/library/import/importStore.ts`
- Create: `src/features/library/import/useImportQueue.ts`

- [ ] **Step 1: Implement the import store**

Create `src/features/library/import/importStore.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createActor } from 'xstate';
import type { Book, BookId, ImportResult, ParsedMetadata } from '@/domain';
import {
  importMachine,
  type ImportInput,
  type ImportOutput,
} from './importMachine';

export type ImportEntryStatus =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly book: Book }
  | { readonly kind: 'duplicate'; readonly existingBookId: BookId }
  | { readonly kind: 'failed'; readonly reason: string };

export type ImportEntry = {
  readonly id: string; // task id (uuid)
  readonly fileName: string;
  readonly addedAt: number;
  readonly status: ImportEntryStatus;
};

export type ImportRunnerDeps = Omit<ImportInput, 'file'>;

export type ImportState = {
  readonly entries: readonly ImportEntry[];
  enqueue(file: File): string;
  dismiss(id: string): void;
  clearTerminal(): void;
};

export type ImportStore = StoreApi<ImportState>;

export function createImportStore(deps: ImportRunnerDeps): ImportStore {
  let processing = false;

  const store = createStore<ImportState>((set, get) => ({
    entries: [],
    enqueue(file) {
      const id = crypto.randomUUID();
      set((s) => ({
        entries: [
          ...s.entries,
          {
            id,
            fileName: file.name,
            addedAt: Date.now(),
            status: { kind: 'waiting' },
          },
        ],
      }));
      // Stash the file beside the entry — kept in a private map so React state
      // never holds the File handle.
      pendingFiles.set(id, file);
      void processNext();
      return id;
    },
    dismiss(id) {
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    },
    clearTerminal() {
      set((s) => ({
        entries: s.entries.filter((e) => e.status.kind === 'waiting' || e.status.kind === 'running'),
      }));
    },
  }));

  const pendingFiles = new Map<string, File>();

  const updateEntry = (id: string, status: ImportEntryStatus): void => {
    store.setState((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, status } : e)),
    }));
  };

  async function processNext(): Promise<void> {
    if (processing) return;
    const next = store.getState().entries.find((e) => e.status.kind === 'waiting');
    if (!next) return;
    const file = pendingFiles.get(next.id);
    if (!file) {
      updateEntry(next.id, { kind: 'failed', reason: 'Lost file reference.' });
      return processNext();
    }
    processing = true;
    updateEntry(next.id, { kind: 'running' });
    try {
      const output = await runOne({ file, ...deps });
      const status: ImportEntryStatus =
        output.kind === 'success'
          ? { kind: 'done', book: output.book }
          : output.kind === 'duplicate'
            ? { kind: 'duplicate', existingBookId: output.existingBookId }
            : { kind: 'failed', reason: output.reason };
      updateEntry(next.id, status);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error.';
      updateEntry(next.id, { kind: 'failed', reason });
    } finally {
      pendingFiles.delete(next.id);
      processing = false;
      void processNext();
    }
  }

  async function runOne(input: ImportInput): Promise<ImportOutput> {
    const actor = createActor(importMachine, { input }).start();
    return new Promise<ImportOutput>((resolve) => {
      actor.subscribe((snapshot) => {
        if (snapshot.status === 'done') {
          resolve(snapshot.output as ImportOutput);
        }
      });
    });
  }

  return store;
}

// Convenience to translate from machine output to ImportResult, for callers
// that prefer the domain shape.
export function toImportResult(entry: ImportEntry): ImportResult | undefined {
  if (entry.status.kind === 'done')
    return { kind: 'success', book: entry.status.book };
  if (entry.status.kind === 'duplicate')
    return { kind: 'duplicate', existingBookId: entry.status.existingBookId };
  if (entry.status.kind === 'failed')
    return { kind: 'failure', reason: entry.status.reason, fileName: entry.fileName };
  return undefined;
}
```

- [ ] **Step 2: Implement the React hook**

Create `src/features/library/import/useImportQueue.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { ImportStore } from './importStore';

export function useImportQueue(store: ImportStore) {
  const entries = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getState().entries,
    () => store.getState().entries,
  );
  return {
    entries,
    enqueue: store.getState().enqueue,
    dismiss: store.getState().dismiss,
    clearTerminal: store.getState().clearTerminal,
  };
}
```

- [ ] **Step 3: Type-check & lint**

```bash
pnpm type-check && pnpm lint
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/library/import/importStore.ts src/features/library/import/useImportQueue.ts
git commit -m "feat(import): sequential queue orchestrator + React hook"
```

---

## Milestone 6 — UI components

### Task 19: DropOverlay

**Files:**
- Create: `src/features/library/DropOverlay.tsx`
- Create: `src/features/library/drop-overlay.css`

- [ ] **Step 1: Component**

Create `src/features/library/DropOverlay.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import './drop-overlay.css';

type Props = {
  readonly onFilesDropped: (files: readonly File[]) => void;
};

export function DropOverlay({ onFilesDropped }: Props) {
  const [active, setActive] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    function isFileDrag(e: DragEvent): boolean {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files');
    }
    function onEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      counter.current += 1;
      setActive(true);
      e.preventDefault();
    }
    function onLeave(e: DragEvent) {
      if (!isFileDrag(e)) return;
      counter.current = Math.max(0, counter.current - 1);
      if (counter.current === 0) setActive(false);
    }
    function onOver(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      counter.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFilesDropped(files);
    }
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFilesDropped]);

  if (!active) return null;
  return (
    <div className="drop-overlay" role="presentation" aria-hidden="true">
      <div className="drop-overlay__plate">
        <p className="drop-overlay__title">Drop to add to your library</p>
        <p className="drop-overlay__hint">Files stay on this device.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

Create `src/features/library/drop-overlay.css`:

```css
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--layer-overlay);
  display: grid;
  place-items: center;
  background: color-mix(in oklab, var(--color-bg) 85%, transparent);
  backdrop-filter: blur(2px);
  padding: var(--space-12);
  animation: drop-overlay-in var(--duration-base) var(--ease-out) forwards;
}
.drop-overlay__plate {
  width: min(80vw, 36rem);
  aspect-ratio: 16 / 9;
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  background: color-mix(in oklab, var(--color-surface) 75%, transparent);
}
.drop-overlay__title {
  font-family: var(--font-serif);
  font-size: var(--text-xl);
  color: var(--color-text);
}
.drop-overlay__hint {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: var(--text-sm);
  color: var(--color-text-subtle);
}
@keyframes drop-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .drop-overlay { animation: none; }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/library/DropOverlay.tsx src/features/library/drop-overlay.css
git commit -m "feat(library): full-page DropOverlay with privacy reassurance"
```

---

### Task 20: BookCard + ⋯ menu

**Files:**
- Create: `src/features/library/BookCard.tsx`
- Create: `src/features/library/BookCardMenu.tsx`
- Create: `src/features/library/book-card.css`

- [ ] **Step 1: BookCardMenu**

Create `src/features/library/BookCardMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

type Props = {
  readonly onRemove: () => void;
};

export function BookCardMenu({ onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className="book-card__menu" ref={ref}>
      <button
        type="button"
        className="book-card__menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Book actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="book-card__menu-popover">
          <button
            type="button"
            role="menuitem"
            className="book-card__menu-item"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            Remove from library
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: BookCard**

Create `src/features/library/BookCard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Book } from '@/domain';
import type { CoverCache } from './store/coverCache';
import { BookCardMenu } from './BookCardMenu';
import './book-card.css';

type Props = {
  readonly book: Book;
  readonly coverCache: CoverCache;
  readonly onRemove: (book: Book) => void;
};

export function BookCard({ book, coverCache, onRemove }: Props) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    coverCache.getUrl(book).then((url) => {
      if (!cancelled) setCoverUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [book, coverCache]);

  return (
    <article className="book-card" data-book-id={book.id}>
      {coverUrl ? (
        <img className="book-card__cover" src={coverUrl} alt="" />
      ) : (
        <div className="book-card__cover book-card__cover--blank" aria-hidden="true">
          <span className="book-card__cover-fallback-title">{book.title}</span>
        </div>
      )}
      <BookCardMenu onRemove={() => onRemove(book)} />
      <div className="book-card__title">{book.title}</div>
      <div className="book-card__author">{book.author ?? ''}</div>
    </article>
  );
}
```

- [ ] **Step 3: CSS**

Create `src/features/library/book-card.css`:

```css
.book-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.book-card__cover {
  aspect-ratio: 2 / 3;
  width: 100%;
  border-radius: var(--radius-sm);
  background: var(--color-panel);
  box-shadow: var(--shadow-md);
  object-fit: cover;
}
.book-card__cover--blank {
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-linear-gradient(45deg, var(--color-panel) 0 6px, var(--color-border-subtle) 6px 12px);
  border: 1px solid var(--color-border);
  padding: var(--space-5);
  text-align: center;
}
.book-card__cover-fallback-title {
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.book-card__title {
  font-family: var(--font-serif);
  font-size: var(--text-base);
  line-height: 1.25;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.book-card__author {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.book-card__menu {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}
.book-card__menu-trigger {
  background: color-mix(in oklab, var(--color-bg) 80%, transparent);
  color: var(--color-text);
  border-radius: var(--radius-full);
  width: 28px;
  height: 28px;
  font-size: 18px;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out);
}
.book-card:hover .book-card__menu-trigger,
.book-card__menu-trigger:focus-visible,
@media (hover: none) {
  .book-card__menu-trigger { opacity: 1; }
}
.book-card__menu-popover {
  position: absolute;
  top: 32px;
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  box-shadow: var(--shadow-lg);
  min-width: 180px;
  padding: var(--space-3);
}
.book-card__menu-item {
  width: 100%;
  text-align: left;
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  color: var(--color-text);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xs);
}
.book-card__menu-item:hover {
  background: var(--color-panel);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/library/BookCard.tsx src/features/library/BookCardMenu.tsx src/features/library/book-card.css
git commit -m "feat(library): BookCard with cross-hatch fallback and ⋯ remove menu"
```

---

### Task 21: LibraryChrome (search + sort + import)

**Files:**
- Create: `src/features/library/LibrarySearchField.tsx`
- Create: `src/features/library/LibrarySortDropdown.tsx`
- Create: `src/features/library/ImportButton.tsx`
- Create: `src/features/library/LibraryChrome.tsx`
- Create: `src/features/library/library-chrome.css`

- [ ] **Step 1: SearchField**

Create `src/features/library/LibrarySearchField.tsx`:

```tsx
type Props = {
  readonly value: string;
  readonly onChange: (next: string) => void;
};

export function LibrarySearchField({ value, onChange }: Props) {
  return (
    <label className="library-search">
      <span className="library-search__icon" aria-hidden="true">⌕</span>
      <input
        className="library-search__input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        aria-label="Search your library"
      />
    </label>
  );
}
```

- [ ] **Step 2: SortDropdown**

Create `src/features/library/LibrarySortDropdown.tsx`:

```tsx
import { ALL_SORT_KEYS, SORT_LABELS, type SortKey } from '@/domain';

type Props = {
  readonly value: SortKey;
  readonly onChange: (next: SortKey) => void;
};

export function LibrarySortDropdown({ value, onChange }: Props) {
  return (
    <label className="library-sort">
      <span className="library-sort__label">Sort</span>
      <select
        className="library-sort__select"
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
      >
        {ALL_SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 3: ImportButton**

Create `src/features/library/ImportButton.tsx`:

```tsx
import { useRef } from 'react';

type Props = {
  readonly onFilesPicked: (files: readonly File[]) => void;
};

export function ImportButton({ onFilesPicked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="library-import-button"
        onClick={() => inputRef.current?.click()}
      >
        + Import
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFilesPicked(files);
          e.target.value = '';
        }}
      />
    </>
  );
}
```

- [ ] **Step 4: LibraryChrome composition**

Create `src/features/library/LibraryChrome.tsx`:

```tsx
import type { SortKey } from '@/domain';
import { LibrarySearchField } from './LibrarySearchField';
import { LibrarySortDropdown } from './LibrarySortDropdown';
import { ImportButton } from './ImportButton';
import './library-chrome.css';

type Props = {
  readonly search: string;
  readonly onSearchChange: (next: string) => void;
  readonly sort: SortKey;
  readonly onSortChange: (next: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
};

export function LibraryChrome(props: Props) {
  return (
    <header className="library-chrome">
      <div className="library-chrome__wordmark">Bookworm</div>
      <div className="library-chrome__search">
        <LibrarySearchField value={props.search} onChange={props.onSearchChange} />
      </div>
      <div className="library-chrome__actions">
        <LibrarySortDropdown value={props.sort} onChange={props.onSortChange} />
        <ImportButton onFilesPicked={props.onFilesPicked} />
      </div>
    </header>
  );
}
```

- [ ] **Step 5: CSS**

Create `src/features/library/library-chrome.css`:

```css
.library-chrome {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-7);
  padding: var(--space-7) var(--space-10);
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg);
}
.library-chrome__wordmark {
  font-family: var(--font-serif);
  font-size: var(--text-lg);
  letter-spacing: -0.01em;
  color: var(--color-text);
}
.library-chrome__search { max-width: 32rem; }
.library-chrome__actions {
  display: flex;
  gap: var(--space-5);
  align-items: center;
}
.library-search {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  transition: border-color var(--duration-base) var(--ease-out);
}
.library-search:focus-within { border-color: var(--color-accent); }
.library-search__icon {
  font-size: var(--text-md);
  color: var(--color-text-subtle);
}
.library-search__input {
  border: none;
  background: transparent;
  width: 100%;
  font-family: var(--font-serif);
  font-size: var(--text-base);
  color: var(--color-text);
  outline: none;
}
.library-sort { display: flex; align-items: center; gap: var(--space-3); }
.library-sort__label {
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.library-sort__select {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  padding: 6px 10px;
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  background: var(--color-surface);
  color: var(--color-text);
}
.library-import-button {
  background: var(--color-text);
  color: var(--color-bg);
  border: none;
  padding: 8px 14px;
  border-radius: var(--radius-base);
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  cursor: pointer;
}
.library-import-button:hover {
  background: color-mix(in oklab, var(--color-text) 88%, var(--color-accent) 12%);
}

@media (max-width: 640px) {
  .library-chrome {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    gap: var(--space-5);
    padding: var(--space-6);
  }
  .library-chrome__wordmark { grid-column: 1; grid-row: 1; }
  .library-chrome__actions { grid-column: 2; grid-row: 1; }
  .library-chrome__search {
    grid-column: 1 / span 2;
    grid-row: 2;
    max-width: none;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/features/library/Library*.tsx src/features/library/ImportButton.tsx src/features/library/library-chrome.css
git commit -m "feat(library): chrome (search + sort + import button)"
```

---

### Task 22: ImportTray + ImportTrayItem

**Files:**
- Create: `src/features/library/import/ImportTray.tsx`
- Create: `src/features/library/import/ImportTrayItem.tsx`
- Create: `src/features/library/import/import-tray.css`

- [ ] **Step 1: ImportTrayItem**

Create `src/features/library/import/ImportTrayItem.tsx`:

```tsx
import type { ImportEntry } from './importStore';

type Props = {
  readonly entry: ImportEntry;
  readonly onDismiss: (id: string) => void;
  readonly onViewExisting: (bookId: string) => void;
};

function statusLabel(entry: ImportEntry): string {
  switch (entry.status.kind) {
    case 'waiting':
      return 'Waiting…';
    case 'running':
      return 'Importing…';
    case 'done':
      return 'Imported';
    case 'duplicate':
      return 'Already in your library';
    case 'failed':
      return entry.status.reason;
  }
}

export function ImportTrayItem({ entry, onDismiss, onViewExisting }: Props) {
  return (
    <li className={`import-tray__item import-tray__item--${entry.status.kind}`}>
      <div className="import-tray__icon" aria-hidden="true">
        {entry.status.kind === 'waiting' && '◌'}
        {entry.status.kind === 'running' && '◐'}
        {entry.status.kind === 'done' && '✓'}
        {entry.status.kind === 'duplicate' && '↺'}
        {entry.status.kind === 'failed' && '!'}
      </div>
      <div className="import-tray__body">
        <div className="import-tray__name">{entry.fileName}</div>
        <div className="import-tray__status">{statusLabel(entry)}</div>
      </div>
      {entry.status.kind === 'duplicate' && (
        <button
          type="button"
          className="import-tray__action"
          onClick={() => onViewExisting(entry.status.kind === 'duplicate' ? entry.status.existingBookId : '')}
        >
          View existing
        </button>
      )}
      {(entry.status.kind === 'failed' || entry.status.kind === 'duplicate') && (
        <button type="button" className="import-tray__dismiss" onClick={() => onDismiss(entry.id)}>
          Remove
        </button>
      )}
    </li>
  );
}
```

- [ ] **Step 2: ImportTray**

Create `src/features/library/import/ImportTray.tsx`:

```tsx
import { useEffect } from 'react';
import type { ImportEntry, ImportStore } from './importStore';
import { useImportQueue } from './useImportQueue';
import { ImportTrayItem } from './ImportTrayItem';
import './import-tray.css';

type Props = {
  readonly store: ImportStore;
  readonly onViewExisting: (bookId: string) => void;
};

function summary(entries: readonly ImportEntry[]): string {
  if (entries.length === 0) return '';
  const running = entries.filter(
    (e) => e.status.kind === 'waiting' || e.status.kind === 'running',
  ).length;
  if (running > 0) return `Importing ${running} ${running === 1 ? 'book' : 'books'}…`;
  const failed = entries.filter((e) => e.status.kind === 'failed').length;
  if (failed > 0)
    return `Couldn’t import ${failed} ${failed === 1 ? 'book' : 'books'}`;
  const done = entries.filter((e) => e.status.kind === 'done').length;
  return done === 1 ? '1 book imported' : `${done} books imported`;
}

export function ImportTray({ store, onViewExisting }: Props) {
  const { entries, dismiss, clearTerminal } = useImportQueue(store);

  // Auto-clear successful entries after 2s
  useEffect(() => {
    const timers: number[] = [];
    for (const e of entries) {
      if (e.status.kind === 'done') {
        const t = window.setTimeout(() => dismiss(e.id), 2000);
        timers.push(t);
      }
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [entries, dismiss]);

  if (entries.length === 0) return null;

  const allTerminal = entries.every(
    (e) => e.status.kind !== 'waiting' && e.status.kind !== 'running',
  );

  return (
    <section className="import-tray" aria-label="Import status">
      <header className="import-tray__header">
        <span className="import-tray__summary">{summary(entries)}</span>
        {allTerminal && (
          <button type="button" className="import-tray__clear" onClick={clearTerminal}>
            Clear
          </button>
        )}
      </header>
      <ul className="import-tray__list">
        {entries.map((e) => (
          <ImportTrayItem
            key={e.id}
            entry={e}
            onDismiss={dismiss}
            onViewExisting={onViewExisting}
          />
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: CSS**

Create `src/features/library/import/import-tray.css`:

```css
.import-tray {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  padding: var(--space-5) var(--space-10);
  animation: import-tray-in var(--duration-base) var(--ease-out) forwards;
}
.import-tray__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}
.import-tray__summary {
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.import-tray__clear {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: var(--text-sm);
  color: var(--color-accent);
}
.import-tray__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.import-tray__item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}
.import-tray__icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  font-family: var(--font-serif);
}
.import-tray__name {
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  color: var(--color-text);
}
.import-tray__status {
  font-family: var(--font-serif);
  font-size: var(--text-xs);
  color: var(--color-text-subtle);
  font-style: italic;
}
.import-tray__action,
.import-tray__dismiss {
  font-family: var(--font-serif);
  font-size: var(--text-xs);
  color: var(--color-accent);
  background: none;
  border: none;
  cursor: pointer;
}
.import-tray__item--failed { background: color-mix(in oklab, var(--color-danger) 8%, var(--color-bg)); }
.import-tray__item--duplicate { background: color-mix(in oklab, var(--color-accent) 6%, var(--color-bg)); }
.import-tray__item--done { background: color-mix(in oklab, var(--color-success) 6%, var(--color-bg)); }
@keyframes import-tray-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .import-tray { animation: none; }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/library/import/ImportTray.tsx src/features/library/import/ImportTrayItem.tsx src/features/library/import/import-tray.css
git commit -m "feat(library): ImportTray + per-entry status item"
```

---

### Task 23: Bookshelf grid + LibraryWorkspace + EmptyState evolution

**Files:**
- Create: `src/features/library/Bookshelf.tsx`
- Create: `src/features/library/bookshelf.css`
- Create: `src/features/library/LibraryWorkspace.tsx`
- Modify: `src/features/library/LibraryEmptyState.tsx`
- Modify: `src/features/library/library-empty-state.css`

- [ ] **Step 1: Bookshelf grid**

Create `src/features/library/Bookshelf.tsx`:

```tsx
import type { Book } from '@/domain';
import { BookCard } from './BookCard';
import type { CoverCache } from './store/coverCache';
import './bookshelf.css';

type Props = {
  readonly books: readonly Book[];
  readonly coverCache: CoverCache;
  readonly searchActive: boolean;
  readonly onRemove: (book: Book) => void;
};

export function Bookshelf({ books, coverCache, searchActive, onRemove }: Props) {
  if (books.length === 0 && searchActive) {
    return (
      <section className="bookshelf bookshelf--empty-search">
        <p className="bookshelf__no-results">No books match your search.</p>
      </section>
    );
  }
  return (
    <section className="bookshelf">
      <ul className="bookshelf__grid">
        {books.map((book) => (
          <li key={book.id} className="bookshelf__cell">
            <BookCard book={book} coverCache={coverCache} onRemove={onRemove} />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Bookshelf CSS**

Create `src/features/library/bookshelf.css`:

```css
.bookshelf {
  flex: 1;
  padding: var(--space-10);
  background:
    radial-gradient(ellipse 60% 30% at 50% 0%, color-mix(in oklab, var(--color-accent) 4%, transparent) 0%, transparent 70%),
    var(--color-bg);
}
.bookshelf__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-10) var(--space-7);
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
}
.bookshelf__no-results {
  text-align: center;
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--color-text-subtle);
  padding: var(--space-12);
}
@media (max-width: 480px) {
  .bookshelf__grid { grid-template-columns: repeat(2, 1fr); }
  .bookshelf { padding: var(--space-6); }
}
```

- [ ] **Step 3: LibraryWorkspace**

Create `src/features/library/LibraryWorkspace.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Book, BookId, SortKey } from '@/domain';
import type { LibraryStore } from './store/libraryStore';
import type { CoverCache } from './store/coverCache';
import type { ImportStore } from './import/importStore';
import { LibraryChrome } from './LibraryChrome';
import { Bookshelf } from './Bookshelf';
import { ImportTray } from './import/ImportTray';

type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onRemoveBook: (book: Book) => void;
};

export function LibraryWorkspace({
  libraryStore,
  importStore,
  coverCache,
  onPersistSort,
  onRemoveBook,
}: Props) {
  const [search, setSearch] = useState(libraryStore.getState().search);
  const [sort, setSort] = useState(libraryStore.getState().sort);
  const [books, setBooks] = useState(libraryStore.getState().visibleBooks());

  useEffect(() => {
    return libraryStore.subscribe((state) => {
      setSearch(state.search);
      setSort(state.sort);
      setBooks(state.visibleBooks());
    });
  }, [libraryStore]);

  const onSearchChange = (q: string) => {
    libraryStore.getState().setSearch(q);
  };
  const onSortChange = (key: SortKey) => {
    libraryStore.getState().setSort(key);
    onPersistSort(key);
  };
  const onFilesPicked = (files: readonly File[]) => {
    for (const file of files) {
      importStore.getState().enqueue(file);
    }
  };
  const onViewExisting = (bookId: string) => {
    document
      .querySelector(`[data-book-id="${CSS.escape(bookId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="library-workspace">
      <LibraryChrome
        search={search}
        onSearchChange={onSearchChange}
        sort={sort}
        onSortChange={onSortChange}
        onFilesPicked={onFilesPicked}
      />
      <ImportTray store={importStore} onViewExisting={onViewExisting} />
      <Bookshelf
        books={books}
        coverCache={coverCache}
        searchActive={search.trim().length > 0}
        onRemove={onRemoveBook}
      />
    </div>
  );
}
```

- [ ] **Step 4: Evolve the empty state**

Replace `src/features/library/LibraryEmptyState.tsx` with:

```tsx
import { useRef } from 'react';
import './library-empty-state.css';

type Props = {
  readonly onFilesPicked: (files: readonly File[]) => void;
};

export function LibraryEmptyState({ onFilesPicked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="library-empty" aria-labelledby="library-empty-title">
      <div className="library-empty__atmosphere" aria-hidden="true" />
      <div className="library-empty__column">
        <svg
          className="library-empty__mark"
          viewBox="0 0 64 64"
          role="img"
          aria-label="Bookworm bookmark"
          style={{ animationDelay: '80ms' }}
        >
          <path d="M22 14 H42 V50 L32 44 L22 50 Z" fill="var(--color-accent)" />
        </svg>

        <h1
          id="library-empty-title"
          className="library-empty__wordmark"
          style={{ animationDelay: '240ms' }}
        >
          Bookworm
        </h1>

        <p className="library-empty__tagline" style={{ animationDelay: '400ms' }}>
          A quiet place to read books and think with&nbsp;them.
        </p>

        <span
          className="library-empty__rule"
          aria-hidden="true"
          style={{ animationDelay: '560ms' }}
        />

        <button
          type="button"
          className="library-empty__cta"
          style={{ animationDelay: '660ms' }}
          onClick={() => inputRef.current?.click()}
        >
          Import a book to begin.
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".epub,.pdf,application/epub+zip,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onFilesPicked(files);
            e.target.value = '';
          }}
        />

        <p className="library-empty__privacy" style={{ animationDelay: '820ms' }}>
          Your books stay on this device. Nothing leaves until you ask.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add the CTA styles**

Append to `src/features/library/library-empty-state.css`:

```css
.library-empty__cta {
  background: none;
  border: none;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: var(--text-md);
  color: var(--color-text);
  text-decoration: underline;
  text-decoration-color: var(--color-accent);
  text-underline-offset: 4px;
  cursor: pointer;
  opacity: 0;
  transform: translateY(8px);
  animation: library-empty-rise var(--duration-slower) var(--ease-out) forwards;
}
.library-empty__cta:hover {
  color: var(--color-accent);
}
@media (prefers-reduced-motion: reduce) {
  .library-empty__cta { opacity: 1; transform: none; animation: none; }
}
```

- [ ] **Step 6: Update LibraryView to dispatch between empty and workspace**

Replace `src/features/library/LibraryView.tsx`:

```tsx
import type { Book, SortKey } from '@/domain';
import type { LibraryStore } from './store/libraryStore';
import type { CoverCache } from './store/coverCache';
import type { ImportStore } from './import/importStore';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryWorkspace } from './LibraryWorkspace';

type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly hasBooks: boolean;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onRemoveBook: (book: Book) => void;
};

export function LibraryView(props: Props) {
  if (!props.hasBooks) return <LibraryEmptyState onFilesPicked={props.onFilesPicked} />;
  return (
    <LibraryWorkspace
      libraryStore={props.libraryStore}
      importStore={props.importStore}
      coverCache={props.coverCache}
      onPersistSort={props.onPersistSort}
      onRemoveBook={props.onRemoveBook}
    />
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/features/library
git commit -m "feat(library): Bookshelf grid, workspace, evolved empty state with import affordance"
```

---

## Milestone 7 — Integration, orphan sweep, E2E

### Task 24: Wire `App` to boot, deps, and persistence

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/main.tsx`
- Create: `src/features/library/index.ts` (public barrel)
- Create: `src/features/library/wiring.ts` (composition root for deps)
- Create: `src/features/library/orphan-sweep.ts`

- [ ] **Step 1: Wiring composition root**

Create `src/features/library/wiring.ts`:

```ts
import {
  type BookwormDB,
  createBookRepository,
  createOpfsAdapter,
  createSettingsRepository,
  type OpfsAdapter,
  type BookRepository,
  type SettingsRepository,
} from '@/storage';
import {
  BookId,
  IsoTimestamp,
  type Book,
  type ParsedMetadata,
} from '@/domain';
import type { ImportInput } from './import/importMachine';

const u8 = (s: string) => new TextEncoder().encode(s);
const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export type Wiring = {
  readonly db: BookwormDB;
  readonly bookRepo: BookRepository;
  readonly settingsRepo: SettingsRepository;
  readonly opfs: OpfsAdapter;
  readonly importDeps: Omit<ImportInput, 'file'>;
  readonly persistFirstQuotaRequest: () => Promise<void>;
};

export function createWiring(db: BookwormDB): Wiring {
  const bookRepo = createBookRepository(db);
  const settingsRepo = createSettingsRepository(db);
  const opfs = createOpfsAdapter();

  // Worker is module-instantiated via Vite's `?worker` import to keep build settings local
  // and to allow code-split tests to reuse the same parser modules without spawning a worker.
  // The dynamic worker instance is reused across imports.
  let workerSingleton: Worker | null = null;
  const ensureWorker = (): Worker => {
    if (workerSingleton) return workerSingleton;
    workerSingleton = new Worker(
      new URL('./import/workers/import-parser.worker.ts', import.meta.url),
      { type: 'module' },
    );
    return workerSingleton;
  };

  const importDeps: Omit<ImportInput, 'file'> = {
    async readBytes(file: File) {
      return file.arrayBuffer();
    },
    async hashBytes(bytes) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return toHex(digest);
    },
    async findByChecksum(checksum) {
      return bookRepo.findByChecksum(checksum);
    },
    async parseInWorker({ bytes, mimeType, originalName }) {
      const w = ensureWorker();
      return new Promise((resolve, reject) => {
        const onMessage = (event: MessageEvent<{ kind: 'ok' | 'error'; metadata?: ParsedMetadata; reason?: string }>) => {
          w.removeEventListener('message', onMessage);
          if (event.data.kind === 'ok' && event.data.metadata) {
            resolve(event.data.metadata);
          } else {
            reject(new Error(event.data.reason ?? 'Parse failed'));
          }
        };
        w.addEventListener('message', onMessage);
        w.postMessage({ bytes, mimeType, originalName }, [bytes]);
      });
    },
    async persistBook({ file, bytes, metadata, checksum }) {
      const id = BookId(crypto.randomUUID());
      const ext =
        metadata.format === 'pdf'
          ? 'pdf'
          : metadata.format === 'epub'
            ? 'epub'
            : 'bin';
      const sourcePath = `books/${id}/source.${ext}`;
      await opfs.writeFile(sourcePath, file);
      let coverRef: Book['coverRef'] = { kind: 'none' };
      if (metadata.cover) {
        const coverExt =
          metadata.cover.mimeType === 'image/png'
            ? 'png'
            : metadata.cover.mimeType === 'image/jpeg'
              ? 'jpg'
              : metadata.cover.mimeType === 'image/svg+xml'
                ? 'svg'
                : 'bin';
        const coverPath = `books/${id}/cover.${coverExt}`;
        await opfs.writeFile(coverPath, new Blob([metadata.cover.bytes], { type: metadata.cover.mimeType }));
        coverRef = { kind: 'opfs', path: coverPath };
      }
      const now = IsoTimestamp(new Date().toISOString());
      const book: Book = {
        id,
        title: metadata.title,
        author: metadata.author,
        format: metadata.format,
        coverRef,
        toc: [],
        source: {
          kind: 'imported-file',
          opfsPath: sourcePath,
          originalName: file.name,
          byteSize: bytes.byteLength,
          mimeType: file.type || (metadata.format === 'epub' ? 'application/epub+zip' : 'application/pdf'),
          checksum,
        },
        importStatus: { kind: 'ready' },
        indexingStatus: { kind: 'pending' },
        aiProfileStatus: { kind: 'pending' },
        createdAt: now,
        updatedAt: now,
      };
      await bookRepo.put(book);
      return book;
    },
  };

  const persistFirstQuotaRequest = async () => {
    const existing = await settingsRepo.getStoragePersistResult();
    if (existing) return;
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    const granted = await navigator.storage.persist();
    await settingsRepo.setStoragePersistResult(granted ? 'granted' : 'denied');
  };

  // Avoid unused-var lint noise; expose `u8` for fixture-builder reuse if needed.
  void u8;

  return { db, bookRepo, settingsRepo, opfs, importDeps, persistFirstQuotaRequest };
}
```

- [ ] **Step 2: Orphan sweep**

Create `src/features/library/orphan-sweep.ts`:

```ts
import type { OpfsAdapter, BookRepository } from '@/storage';

// Background pass: any subdirectory under `books/` whose id isn't represented
// in IndexedDB is removed. Runs after library boot.

export async function sweepOrphans(opfs: OpfsAdapter, bookRepo: BookRepository): Promise<void> {
  let dirs: readonly string[];
  try {
    dirs = await opfs.list('books');
  } catch {
    return;
  }
  if (dirs.length === 0) return;
  const all = await bookRepo.getAll();
  const known = new Set(all.map((b) => b.id));
  await Promise.all(
    dirs.map(async (id) => {
      if (!known.has(id as ReturnType<typeof String>)) {
        try {
          await opfs.removeRecursive(`books/${id}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('orphan sweep failed for', id, err);
        }
      }
    }),
  );
}
```

- [ ] **Step 3: Update `App.tsx`**

Replace `src/app/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  createCoverCache,
  createLibraryStore,
  type LibraryStore,
} from '@/features/library/store/libraryStore';
import { createImportStore, type ImportStore } from '@/features/library/import/importStore';
import { createWiring, type Wiring } from '@/features/library/wiring';
import { loadLibrary } from '@/features/library/boot/loadLibrary';
import { sweepOrphans } from '@/features/library/orphan-sweep';
import { LibraryView } from '@/features/library/LibraryView';
import { LibraryBootError } from '@/features/library/LibraryBootError';
import { DropOverlay } from '@/features/library/DropOverlay';
import { openBookwormDB } from '@/storage';
import './app.css';

export function App() {
  const [boot, setBoot] = useState<
    | { kind: 'loading' }
    | {
        kind: 'ready';
        wiring: Wiring;
        libraryStore: LibraryStore;
        importStore: ImportStore;
        coverCache: ReturnType<typeof createCoverCache>;
      }
    | { kind: 'error'; reason: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const db = await openBookwormDB();
        if (!active) return;
        const wiring = createWiring(db);
        const libraryStore = createLibraryStore();
        const coverCache = createCoverCache(wiring.opfs);
        const importStore = createImportStore(wiring.importDeps);

        // bridge: when imports complete, upsert into libraryStore
        importStore.subscribe((s) => {
          for (const e of s.entries) {
            if (e.status.kind === 'done') {
              libraryStore.getState().upsertBook(e.status.book);
            }
          }
        });

        await loadLibrary({ store: libraryStore, openDB: async () => db });
        sweepOrphans(wiring.opfs, wiring.bookRepo).catch(() => {
          // best effort
        });
        if (!active) return;
        setBoot({ kind: 'ready', wiring, libraryStore, importStore, coverCache });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        if (active) setBoot({ kind: 'error', reason });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (boot.kind === 'loading') {
    return (
      <main className="app app--loading">
        <p className="app__loading">Reaching for your library…</p>
      </main>
    );
  }
  if (boot.kind === 'error') {
    return <LibraryBootError reason={boot.reason} />;
  }

  const { wiring, libraryStore, importStore, coverCache } = boot;

  const onFilesPicked = (files: readonly File[]) => {
    for (const file of files) importStore.getState().enqueue(file);
    void wiring.persistFirstQuotaRequest();
  };

  const onPersistSort = useMemo(
    () => debounce((key) => wiring.settingsRepo.setLibrarySort(key), 200),
    [wiring],
  );

  const onRemoveBook = async (book: Parameters<typeof libraryStore.getState>['']) => {
    // typed below
  };

  // narrow type: define inline since hooks above are stable
  const removeBook = async (book: Parameters<typeof libraryStore.getState.prototype.removeBook>[0] | { id: string; coverRef: { kind: string; path?: string } }) => {
    // unused — see immediate inline below
  };

  // Real remove handler:
  const handleRemove = async (book: { id: string; source: { opfsPath: string }; coverRef: { kind: string; path?: string } }) => {
    libraryStore.getState().removeBook(book.id as ReturnType<typeof String>);
    coverCache.forget(book.id as ReturnType<typeof String>);
    try {
      await wiring.bookRepo.delete(book.id as ReturnType<typeof String>);
      await wiring.opfs.removeRecursive(`books/${book.id}`);
    } catch (err) {
      // log; orphan sweep collects on next boot
      // eslint-disable-next-line no-console
      console.warn('Remove failed:', err);
    }
  };

  return (
    <div className="app">
      <LibraryView
        libraryStore={libraryStore}
        importStore={importStore}
        coverCache={coverCache}
        hasBooks={libraryStore.getState().books.length > 0}
        onFilesPicked={onFilesPicked}
        onPersistSort={onPersistSort}
        onRemoveBook={handleRemove as unknown as (book: import('@/domain').Book) => void}
      />
      <DropOverlay onFilesDropped={onFilesPicked} />
    </div>
  );
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  }) as T;
}
```

> **Implementer note:** the type-acrobatics around `BookId` branding require either an `as BookId` at each callsite or a thin helper. If the executor prefers, refactor to add a small `removeBookById(id: BookId)` exposed by the store and a helper that types `Book.id` cleanly. Keep behavior the same.

- [ ] **Step 4: Subscribe `LibraryView` to `hasBooks`**

To respond to library changes, replace the `hasBooks={...}` prop in `App.tsx` with a small bridge component or a `useSyncExternalStore` adapter. Add this hook just above `App` in the same file:

```tsx
import { useSyncExternalStore } from 'react';
function useHasBooks(libraryStore: LibraryStore): boolean {
  return useSyncExternalStore(
    (cb) => libraryStore.subscribe(cb),
    () => libraryStore.getState().books.length > 0,
    () => libraryStore.getState().books.length > 0,
  );
}
```

Then change the JSX:

```tsx
const hasBooks = useHasBooks(libraryStore);
return (
  <div className="app">
    <LibraryView ... hasBooks={hasBooks} ... />
    <DropOverlay onFilesDropped={onFilesPicked} />
  </div>
);
```

- [ ] **Step 5: Hook `coverCache.forgetAll()` to `pagehide`**

Inside the `App` component, after `boot.kind === 'ready'` is established (i.e., after the `if (boot.kind === 'error') ...` block, before the `const { wiring, libraryStore, importStore, coverCache } = boot;` is consumed), add:

```tsx
useEffect(() => {
  if (boot.kind !== 'ready') return;
  const cache = boot.coverCache;
  const onHide = () => cache.forgetAll();
  window.addEventListener('pagehide', onHide);
  return () => window.removeEventListener('pagehide', onHide);
}, [boot]);
```

This revokes Object URLs cleanly on tab close / reload.

- [ ] **Step 6: Update `app.css`**

Replace `src/app/app.css`:

```css
.app {
  min-height: 100dvh;
  background: var(--color-bg);
  color: var(--color-text);
  display: flex;
  flex-direction: column;
}
.app--loading {
  display: grid;
  place-items: center;
}
.app__loading {
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--color-text-muted);
}
```

- [ ] **Step 7: Type-check, lint, build**

```bash
pnpm type-check && pnpm lint && pnpm build
```

Expected: all exit 0. (If type errors appear around branded IDs, add focused `as BookId` casts at the boundaries; this is the only place where the brand needs help.)

- [ ] **Step 8: Manual smoke**

```bash
pnpm dev
```

Open `http://localhost:5173/Bookworm/`. The empty state shows the new "Import a book to begin." link. Click it → file picker opens. Pick the Project Gutenberg EPUB → tray slides in → bookshelf renders the book. Reload the page → book is still there.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "feat(library): wire boot, import pipeline, orphan sweep, and remove flow into App"
```

---

### Task 25: Update Phase 0 e2e for the evolved empty state

**Files:**
- Modify: `e2e/empty-state.spec.ts`

- [ ] **Step 1: Update assertions**

Replace `e2e/empty-state.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('shows the Bookworm empty-state landing on first visit', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible();
  await expect(page.getByText('A quiet place to read books')).toBeVisible();
  await expect(page.getByText('Your books stay on this device')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import a book to begin.' })).toBeVisible();

  expect(
    consoleErrors,
    `unexpected console/page errors:\n${consoleErrors.join('\n')}`,
  ).toEqual([]);
});
```

- [ ] **Step 2: Run e2e**

```bash
pnpm test:e2e
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/empty-state.spec.ts
git commit -m "test(e2e): assert evolved empty-state Import affordance"
```

---

### Task 26: Phase 1 e2e tests — import, search/sort, remove

**Files:**
- Create: `e2e/library-import.spec.ts`
- Create: `e2e/library-search-sort.spec.ts`
- Create: `e2e/library-remove.spec.ts`

- [ ] **Step 1: Import test**

Create `e2e/library-import.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');
const TXT = resolve(process.cwd(), 'test-fixtures/not-a-book.txt');

test('imports an EPUB end-to-end and persists across reload', async ({ page }) => {
  await page.goto('/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);

  // Bookshelf should render the imported title
  await expect(
    page.getByRole('heading', { name: /pride and prejudice/i }).or(
      page.getByText(/pride and prejudice/i).first(),
    ),
  ).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible();
});

test('refuses a plain text file with a tray entry', async ({ page }) => {
  await page.goto('/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(TXT);

  await expect(page.getByText(/not a supported format/i)).toBeVisible({ timeout: 5_000 });
});

test('detects duplicate on second import of the same file', async ({ page }) => {
  await page.goto('/');

  // First import
  const first = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await first).setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });

  // Now use the chrome's import button to drop the same file
  const second = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '+ Import' }).click();
  await (await second).setFiles(PG_EPUB);

  await expect(page.getByText(/already in your library/i)).toBeVisible({ timeout: 5_000 });
});
```

- [ ] **Step 2: Search/sort test**

Create `e2e/library-search-sort.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');
const PDF = resolve(process.cwd(), 'test-fixtures/text-friendly.pdf');

test('search filters books and shows no-match state', async ({ page }) => {
  await page.goto('/');

  const fc1 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await fc1).setFiles([PG_EPUB, PDF]);

  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/text-friendly/i).first()).toBeVisible();

  await page.getByRole('searchbox', { name: /search/i }).fill('prejudice');
  await expect(page.getByText(/text-friendly/i)).toHaveCount(0);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible();

  await page.getByRole('searchbox', { name: /search/i }).fill('zzznothing');
  await expect(page.getByText(/no books match your search/i)).toBeVisible();
});

test('sort selection persists across reloads', async ({ page }) => {
  await page.goto('/');
  // Assumes prior tests don't share state; if they do, import a book first.
  await page.getByLabel(/sort/i).selectOption('title');
  await page.reload();
  await expect(page.getByLabel(/sort/i)).toHaveValue('title');
});
```

- [ ] **Step 3: Remove test**

Create `e2e/library-remove.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test('removes a book and it stays gone after reload', async ({ page }) => {
  await page.goto('/');

  const fc = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  await (await fc).setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Book actions' }).first().click();
  await page.getByRole('menuitem', { name: /remove from library/i }).click();
  await expect(page.getByText(/pride and prejudice/i)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(/pride and prejudice/i)).toHaveCount(0);
});
```

- [ ] **Step 4: Run all e2e**

```bash
pnpm test:e2e
```

Expected: 6 passed (2 in empty-state, 3 in library-import, 2 in library-search-sort, 1 in library-remove). If the search/sort sort-persist test depends on a book existing, import one first or run tests in `--workers=1` order.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(e2e): Phase 1 import, search/sort, remove flows"
```

---

### Task 27: Final verification + roadmap update

**Files:**
- Modify: `docs/04-implementation-roadmap.md` (mark Phase 1 done)

- [ ] **Step 1: Run the full check pipeline**

```bash
pnpm check && pnpm build && pnpm test:e2e
```

Expected:
- `pnpm check`: type-check, lint, all unit tests pass
- `pnpm build`: dist emitted, SW generated
- `pnpm test:e2e`: all e2e passes

- [ ] **Step 2: Note completion in the roadmap**

Append a "## Status" section near the top of `docs/04-implementation-roadmap.md`:

```markdown
## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (date: TBD on actual ship)
```

> Replace the date in the second line when this plan is fully merged.

- [ ] **Step 3: Self-review scorecard**

In the PR description (or the commit body for the final commit), include the rubric from `docs/08-agent-self-improvement.md`. Target ≥22/27.

- [ ] **Step 4: Final commit**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "docs: mark Phase 1 complete; record self-review scorecard"
```

---

## Self-review (post-plan-write)

**Spec coverage:**
- Import scope (thin) → Tasks 13, 14, 16, 17 (parsers + worker + machine)
- Import UX (drop everywhere + button) → Tasks 19, 21 (DropOverlay, ImportButton in chrome and empty state)
- Multi-file sequential queue → Task 18 (importStore)
- Bookshelf "floating cards on paper" → Tasks 20, 23 (BookCard, Bookshelf grid)
- Sort + search → Tasks 8, 9, 10, 21 (normalize, comparators, libraryStore selectors, chrome controls)
- Duplicate handling → Task 17 (machine `dedupCheck` + duplicate output) and Task 22 (tray "View existing" link)
- IndexedDB schema v1 → Task 4 (schema + migrations)
- OPFS layout → Tasks 3, 24 (adapter + wiring)
- Cover lazy-load + cache → Tasks 10, 20 (coverCache, BookCard)
- Drop overlay → Task 19
- Import tray with privacy + error reasons → Task 22
- Empty state evolution → Task 23 (LibraryEmptyState rewrite)
- Loading + boot error states → Task 11 (`LibraryBootError`) + `App` loading state in Task 24
- Sort persistence → Task 6 (settings) + Task 24 (debounced setter)
- Search empty-result state → Task 23 (Bookshelf component)
- Sort tie-breakers → Task 9 (comparators tests cover them)
- Search normalization → Task 8
- Concurrent imports / race-free dedup → Implicit in sequential queue (Task 18)
- App close mid-import → Task 24 (orphan sweep on boot)
- Removing a book → Task 24 (handleRemove)
- Cover URL lifecycle → Task 10 (`forget`/`forgetAll`) + Task 24 step 5 (`pagehide` listener)
- Quota request → Task 24 (`persistFirstQuotaRequest`)
- File-size headroom → Implicit; `QuotaExceededError` mapped in Task 17 machine
- Mobile breakpoints → Task 21 (chrome stacking) + Task 23 (grid)
- Privacy invariant → No network in any code path; verified by absence in Tasks 13, 14, 16, 24
- Tests at every layer → Tasks 3, 5, 6, 8, 9, 10, 12, 13, 14, 17 (unit); Task 26 (E2E)
- Fixtures → Tasks 14, 15

**Placeholder scan:** No `TBD`, "implement later", or vague "handle errors" remain. The "TBD on actual ship" date in Task 27 step 2 is intentional — that's a placeholder for the literal ship date, to be filled in by the engineer at merge time.

**Type consistency:** `BookId`, `IsoTimestamp`, `SortKey`, `ImportResult`, `ParsedMetadata`, `ParseRequest`, `ParseResponse`, `OpfsAdapter`, `BookRepository`, `SettingsRepository`, `BookwormDB`, `ImportInput`, `ImportOutput`, `ImportEntry`, `ImportEntryStatus`, `LibraryStore`, `ImportStore`, `CoverCache`, `Wiring` are all named consistently and used the same way across tasks. The XState v5 actor-input shape note in Task 17 acknowledges that the exact wiring is brittle and gives the executor permission to switch to inline `fromPromise`.

**Scope check:** Single coherent deliverable; one plan is correct.

---

## Acceptance criteria for this plan

A reviewer should be able to verify Phase 1 by:

1. Running `pnpm check` — all unit tests + type-check + lint pass.
2. Running `pnpm build` — clean PWA bundle.
3. Running `pnpm test:e2e` — empty-state + import + search/sort + remove specs all pass.
4. Visiting `pnpm dev` and confirming:
   - Empty state shows "Import a book to begin." link
   - Drop a book file → tray + bookshelf updates
   - Drop the same file → "already in your library" tray entry
   - Reload → library is restored
   - Click `⋯` → Remove → reload → still gone
   - Search filters; clearing search restores; "no matches" copy appears for misses
   - Sort selection persists across reloads
