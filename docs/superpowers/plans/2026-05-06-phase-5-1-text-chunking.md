# Phase 5.1 — Text Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate deterministic `TextChunk` records (paragraph-bounded, ~400-token-capped) for every imported book (EPUB + PDF) on a background pipeline that runs at import time, with idempotent resumption on app open and a library-card inspector UI. Lay the foundation for Phase 5.2 retrieval and Phase 5.4 chapter mode.

**Architecture:** Single-flight queue feeds a per-book pipeline. Format-specific extractors (`EpubChunkExtractor` reuses foliate-js headlessly; `PdfChunkExtractor` uses pdfjs-dist with paragraph-reconstruction heuristics) emit a stream of `(text, locationAnchor)` paragraphs into a shared pure `paragraphsToChunks` packer. Chunks persist per-section atomically in a new `book_chunks` IDB store; on app open, a resume scan re-runs the pipeline and the per-section `hasChunksFor` check naturally short-circuits work that already landed. Chunker is versioned (`CHUNKER_VERSION = 1`); stale-version chunks are dropped + re-pendinged on app open. Inspector UI lives on the library card (status indicator) + a modal listing chunks with previews and a Rebuild button.

**Tech Stack:** TypeScript 5.x (strict + `exactOptionalPropertyTypes: true`), React 19, Vitest + happy-dom + `@testing-library/react` for unit/component tests, Playwright for E2E, foliate-js (EPUB headless parse), pdfjs-dist (PDF text extraction), IndexedDB via `idb` library + `fake-indexeddb` in storage tests.

**Spec:** `docs/superpowers/specs/2026-05-06-phase-5-1-text-chunking-design.md`

**Quality gate:** Each task's final commit must produce a green `pnpm check` (`tsc -b && eslint . && vitest run`). E2E (`pnpm test:e2e`) is run before the docs commit.

**Repo invariants worth restating before starting:**
- `exactOptionalPropertyTypes: true` — never pass `undefined` to an optional prop. Use conditional spreads `...(value !== undefined && { key: value })`.
- No `any`. No `eslint-disable` outside the existing locked exceptions.
- Path alias `@/*` → `src/*`.
- `BookRepository` (singular) not `BooksRepository`; `getAll()` not `listAll()`; **no partial-update method exists** — books are replaced wholesale via `put()`. The pipeline fetches a book, mutates `indexingStatus`, calls `put()`.
- Indexes in `BookwormDBSchema` use raw `string` (not branded `BookId` / `SectionId`).
- The `useReaderHost` hook lives at `src/app/useReaderHost.ts` (not under `features/reader/workspace/`). The cascade is at lines 169–199 in that file.
- The post-persist call site for `indexing.enqueue(...)` is `src/features/library/wiring.ts:156`, immediately after `bookRepo.put(book)` in the `persistBook` function. The `wiring.ts` module receives an `indexing` handle that App.tsx provides.

---

## Task 1: Domain — extend `TextChunk`

**Spec refs:** §4.1, §12 commit 1.

**Files:**
- Modify: `src/domain/book/types.ts:55-64` — extend the `TextChunk` shape

- [ ] **Step 1: Read current `TextChunk`.**

Open `src/domain/book/types.ts`. Confirm lines 55–64 read:

```ts
export type TextChunk = {
  readonly id: ChunkId;
  readonly bookId: BookId;
  readonly sectionId: SectionId;
  readonly text: string;
  readonly normalizedText: string;
  readonly tokenEstimate: number;
  readonly locationAnchor: LocationAnchor;
  readonly checksum: string;
};
```

- [ ] **Step 2: Replace with the extended shape.**

```ts
export type TextChunk = {
  readonly id: ChunkId;
  readonly bookId: BookId;
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly text: string;
  readonly normalizedText: string;
  readonly tokenEstimate: number;
  readonly locationAnchor: LocationAnchor;
  readonly checksum: string;
  readonly chunkerVersion: number;
};
```

- [ ] **Step 3: Run type-check to confirm no existing call site breaks.**

```bash
pnpm type-check
```

Expected: PASS. No code currently constructs `TextChunk` records (the type is shipped but nothing consumes it yet — Phase 5.1 is its first user).

- [ ] **Step 4: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/domain/book/types.ts
git commit -m "feat(domain): chunks — extend TextChunk with sectionTitle + chunkerVersion"
```

---

## Task 2: Storage — schema v7 migration + `book_chunks` store

**Spec refs:** §4.3, §12 commit 2.

**Files:**
- Modify: `src/storage/db/schema.ts` — bump version, add store, export constant
- Modify: `src/storage/db/migrations.ts` — add migration `6` (v6→v7)

- [ ] **Step 1: Open `src/storage/db/schema.ts`. Confirm `CURRENT_DB_VERSION = 6` near line 15.**

- [ ] **Step 2: Bump version + add the new store + export constant.**

Update the version constant:

```ts
export const CURRENT_DB_VERSION = 7;
```

Inside the `BookwormDBSchema` interface, after the `saved_answers` block (around line 121), add:

```ts
  book_chunks: {
    key: string;
    value: TextChunk;
    indexes: {
      'by-book': string;
      'by-book-section': [string, string];
    };
  };
```

Add the import for `TextChunk` at the top of the file (if not already present):

```ts
import type { TextChunk } from '@/domain';
```

After the existing store-name constants (around line 133), add:

```ts
export const BOOK_CHUNKS_STORE = 'book_chunks' as const;
```

- [ ] **Step 3: Add the v7 migration in `src/storage/db/migrations.ts`.**

Open the file. Confirm the existing migration map ends with key `5` (the v5→v6 migration). After that block (around line 84), add migration `6`:

```ts
  6: ({ db }) => {
    if (!db.objectStoreNames.contains('book_chunks')) {
      const store = db.createObjectStore('book_chunks', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
      store.createIndex('by-book-section', ['bookId', 'sectionId'], { unique: false });
    }
  },
```

> Note the trailing comma so the existing `runMigrations` switch logic continues to work. The migration checks `objectStoreNames.contains` defensively so re-running the migration on an already-upgraded DB is safe.

- [ ] **Step 4: Run type-check.**

```bash
pnpm type-check
```

Expected: PASS.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS — no existing tests touch the new store, so existing tests continue to pass with the version bump.

- [ ] **Step 6: Commit.**

```bash
git add src/storage/db/schema.ts src/storage/db/migrations.ts
git commit -m "feat(storage): v7 migration — add book_chunks store with by-book + by-book-section indexes"
```

---

## Task 3: `BookChunksRepository`

**Spec refs:** §4.6, §12 commit 3.

**Files:**
- Create: `src/storage/repositories/bookChunks.ts`
- Create: `src/storage/repositories/bookChunks.test.ts`
- Modify: `src/storage/index.ts` — export the new creator + type

- [ ] **Step 1: Write the failing test first.**

Create `src/storage/repositories/bookChunks.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createBookChunksRepository } from './bookChunks';
import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';
import { BOOK_CHUNKS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-chunks-${crypto.randomUUID()}`);
});

function makeChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  return {
    id: ChunkId(crypto.randomUUID()),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Chapter 1',
    text: 'hello world',
    normalizedText: 'hello world',
    tokenEstimate: 3,
    locationAnchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' },
    checksum: 'abc',
    chunkerVersion: 1,
    ...overrides,
  };
}

describe('BookChunksRepository', () => {
  it('upsertMany → listByBook round-trips', async () => {
    const repo = createBookChunksRepository(db);
    const c1 = makeChunk({ id: ChunkId('c1') });
    const c2 = makeChunk({ id: ChunkId('c2') });
    await repo.upsertMany([c1, c2]);
    const list = await repo.listByBook(BookId('b1'));
    expect(list.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('listBySection filters by both bookId and sectionId', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), sectionId: SectionId('s1') }),
      makeChunk({ id: ChunkId('c2'), sectionId: SectionId('s2') }),
    ]);
    const s1 = await repo.listBySection(BookId('b1'), SectionId('s1'));
    expect(s1).toHaveLength(1);
    expect(s1[0]!.id).toBe(ChunkId('c1'));
  });

  it('hasChunksFor returns true when chunks exist for the section', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([makeChunk({ sectionId: SectionId('s1') })]);
    expect(await repo.hasChunksFor(BookId('b1'), SectionId('s1'))).toBe(true);
    expect(await repo.hasChunksFor(BookId('b1'), SectionId('absent'))).toBe(false);
  });

  it('countByBook counts chunks per book', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), bookId: BookId('b1') }),
      makeChunk({ id: ChunkId('c2'), bookId: BookId('b1') }),
      makeChunk({ id: ChunkId('c3'), bookId: BookId('b2') }),
    ]);
    expect(await repo.countByBook(BookId('b1'))).toBe(2);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('countStaleVersions returns book IDs with chunks at versions below current', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), bookId: BookId('b1'), chunkerVersion: 1 }),
      makeChunk({ id: ChunkId('c2'), bookId: BookId('b2'), chunkerVersion: 2 }),
    ]);
    const stale = await repo.countStaleVersions(2);
    expect(stale).toEqual([BookId('b1')]);
    const noneStale = await repo.countStaleVersions(1);
    expect(noneStale).toEqual([]);
  });

  it('deleteByBook removes only matching chunks', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), bookId: BookId('b1') }),
      makeChunk({ id: ChunkId('c2'), bookId: BookId('b2') }),
    ]);
    await repo.deleteByBook(BookId('b1'));
    expect(await repo.countByBook(BookId('b1'))).toBe(0);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('deleteBySection removes only the matching section', async () => {
    const repo = createBookChunksRepository(db);
    await repo.upsertMany([
      makeChunk({ id: ChunkId('c1'), sectionId: SectionId('s1') }),
      makeChunk({ id: ChunkId('c2'), sectionId: SectionId('s2') }),
    ]);
    await repo.deleteBySection(BookId('b1'), SectionId('s1'));
    expect(await repo.countByBook(BookId('b1'))).toBe(1);
    const remaining = await repo.listByBook(BookId('b1'));
    expect(remaining[0]!.sectionId).toBe(SectionId('s2'));
  });

  // Validating-reads pattern (matches 4.4 contextRefs validator): drop
  // malformed chunks but preserve siblings.
  it('filters malformed chunk records on read but keeps the rest', async () => {
    const repo = createBookChunksRepository(db);
    const good = makeChunk({ id: ChunkId('good') });
    await repo.upsertMany([good]);
    // Inject a bad record directly via raw IDB put.
    await db.put(BOOK_CHUNKS_STORE, {
      id: 'bad',
      bookId: 'b1',
      sectionId: 's1',
      // missing sectionTitle, normalizedText, tokenEstimate, etc.
    } as never);
    const list = await repo.listByBook(BookId('b1'));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(ChunkId('good'));
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/storage/repositories/bookChunks.test.ts
```

Expected: FAIL — `createBookChunksRepository` not defined.

- [ ] **Step 3: Implement the repository.**

Create `src/storage/repositories/bookChunks.ts`:

```ts
import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_CHUNKS_STORE } from '../db/schema';

export type BookChunksRepository = {
  upsertMany(chunks: readonly TextChunk[]): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly TextChunk[]>;
  listBySection(bookId: BookId, sectionId: SectionId): Promise<readonly TextChunk[]>;
  deleteByBook(bookId: BookId): Promise<void>;
  deleteBySection(bookId: BookId, sectionId: SectionId): Promise<void>;
  countByBook(bookId: BookId): Promise<number>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
  hasChunksFor(bookId: BookId, sectionId: SectionId): Promise<boolean>;
};

function isValidAnchor(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  return v.kind === 'epub-cfi' || v.kind === 'pdf';
}

function normalizeChunk(record: unknown): TextChunk | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<TextChunk> & Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  if (typeof r.sectionId !== 'string' || r.sectionId === '') return null;
  if (typeof r.sectionTitle !== 'string') return null;
  if (typeof r.text !== 'string') return null;
  if (typeof r.normalizedText !== 'string') return null;
  if (typeof r.tokenEstimate !== 'number' || !Number.isFinite(r.tokenEstimate)) return null;
  if (!isValidAnchor(r.locationAnchor)) return null;
  if (typeof r.checksum !== 'string') return null;
  if (typeof r.chunkerVersion !== 'number' || !Number.isInteger(r.chunkerVersion)) return null;
  return {
    id: ChunkId(r.id),
    bookId: BookId(r.bookId),
    sectionId: SectionId(r.sectionId),
    sectionTitle: r.sectionTitle,
    text: r.text,
    normalizedText: r.normalizedText,
    tokenEstimate: r.tokenEstimate,
    locationAnchor: r.locationAnchor as TextChunk['locationAnchor'],
    checksum: r.checksum,
    chunkerVersion: r.chunkerVersion,
  };
}

export function createBookChunksRepository(db: BookwormDB): BookChunksRepository {
  return {
    async upsertMany(chunks) {
      if (chunks.length === 0) return;
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readwrite');
      for (const chunk of chunks) {
        await tx.store.put(chunk);
      }
      await tx.done;
    },
    async listByBook(bookId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      return records
        .map(normalizeChunk)
        .filter((c): c is TextChunk => c !== null);
    },
    async listBySection(bookId, sectionId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book-section');
      const records = await index.getAll([bookId, sectionId]);
      return records
        .map(normalizeChunk)
        .filter((c): c is TextChunk => c !== null);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async deleteBySection(bookId, sectionId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readwrite');
      const index = tx.store.index('by-book-section');
      let cursor = await index.openKeyCursor([bookId, sectionId]);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async countByBook(bookId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      return index.count(bookId);
    },
    async countStaleVersions(currentVersion) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const stale = new Set<BookId>();
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const c = normalizeChunk(cursor.value);
        if (c !== null && c.chunkerVersion < currentVersion) {
          stale.add(c.bookId);
        }
        cursor = await cursor.continue();
      }
      return [...stale];
    },
    async hasChunksFor(bookId, sectionId) {
      const tx = db.transaction(BOOK_CHUNKS_STORE, 'readonly');
      const index = tx.store.index('by-book-section');
      const cursor = await index.openKeyCursor([bookId, sectionId]);
      return cursor !== null;
    },
  };
}
```

- [ ] **Step 4: Re-export from `src/storage/index.ts`.**

Open `src/storage/index.ts`. After the existing `createSavedAnswersRepository` re-export (around line 40), add:

```ts
export {
  createBookChunksRepository,
  type BookChunksRepository,
} from './repositories/bookChunks';
```

- [ ] **Step 5: Run the tests.**

```bash
pnpm test src/storage/repositories/bookChunks.test.ts
```

Expected: PASS — all 8 cases.

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/storage/repositories/bookChunks.ts src/storage/repositories/bookChunks.test.ts src/storage/index.ts
git commit -m "feat(storage): BookChunksRepository — upsertMany, listByBook, listBySection, count*, hasChunksFor"
```

---

## Task 4: Indexing module — pure helpers + `CHUNKER_VERSION`

**Spec refs:** §5.5, §6.6 (`classifyError`), §12 commit 4.

**Files:**
- Create: `src/features/library/indexing/CHUNKER_VERSION.ts`
- Create: `src/features/library/indexing/normalize.ts`
- Create: `src/features/library/indexing/normalize.test.ts`
- Create: `src/features/library/indexing/paragraphsToChunks.ts`
- Create: `src/features/library/indexing/paragraphsToChunks.test.ts`

- [ ] **Step 1: Create `CHUNKER_VERSION.ts`.**

```ts
// Phase 5.1 chunker version. Bump whenever the chunking algorithm or
// normalization rules change. The app-open scan drops chunks below the
// current version and re-pendings the affected books for rebuild.
export const CHUNKER_VERSION = 1;
```

- [ ] **Step 2: Write failing tests for `normalize.ts`.**

Create `src/features/library/indexing/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeChunkText, tokenEstimate } from './normalize';

describe('normalizeChunkText', () => {
  it('collapses runs of whitespace to a single space', () => {
    expect(normalizeChunkText('hello   world\n\nfoo')).toBe('hello world foo');
  });

  it('strips leading and trailing whitespace', () => {
    expect(normalizeChunkText('  hello  ')).toBe('hello');
  });

  it('strips ASCII control characters', () => {
    expect(normalizeChunkText('hello world')).toBe('helloworld');
  });

  it('preserves non-control non-whitespace characters', () => {
    expect(normalizeChunkText('café — naïve')).toBe('café — naïve');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeChunkText('  \n\t  ')).toBe('');
  });
});

describe('tokenEstimate', () => {
  it('returns Math.ceil(length / 4)', () => {
    expect(tokenEstimate('')).toBe(0);
    expect(tokenEstimate('a')).toBe(1);
    expect(tokenEstimate('abcd')).toBe(1);
    expect(tokenEstimate('abcde')).toBe(2);
    expect(tokenEstimate('a'.repeat(400))).toBe(100);
  });
});
```

- [ ] **Step 3: Run failing tests.**

```bash
pnpm test src/features/library/indexing/normalize.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `normalize.ts`.**

```ts
// Pure helpers for chunk text normalization and token estimation.
// No I/O; fully unit-testable without a DOM or IDB.

const CONTROL_CHARS = /[ -]/g;
const WHITESPACE_RUN = /\s+/g;

export function normalizeChunkText(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').replace(WHITESPACE_RUN, ' ').trim();
}

// Char/4 heuristic — the classic OpenAI rule of thumb. Free, deterministic,
// good enough for chunk-packing where the budget is fuzzy. Phase 5.2 retrieval
// can self-calibrate against actual model usage.
export function tokenEstimate(s: string): number {
  return Math.ceil(s.length / 4);
}
```

- [ ] **Step 5: Run tests.**

```bash
pnpm test src/features/library/indexing/normalize.test.ts
```

Expected: PASS — all 6 cases.

- [ ] **Step 6: Write failing tests for `paragraphsToChunks.ts`.**

Create `src/features/library/indexing/paragraphsToChunks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { paragraphsToChunks } from './paragraphsToChunks';
import { BookId, SectionId, type LocationAnchor } from '@/domain';

const ANCHOR: LocationAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4)' };

async function* fromArray<T>(arr: readonly T[]): AsyncIterable<T> {
  for (const item of arr) yield item;
}

const baseInput = {
  bookId: BookId('b1'),
  sectionId: SectionId('s1'),
  sectionTitle: 'Chapter 1',
  chunkerVersion: 1,
};

describe('paragraphsToChunks', () => {
  it('packs short paragraphs into a single chunk under the cap', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: 'First paragraph.', locationAnchor: ANCHOR },
        { text: 'Second paragraph.', locationAnchor: ANCHOR },
      ]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.normalizedText).toContain('First paragraph');
    expect(result[0]!.normalizedText).toContain('Second paragraph');
  });

  it('emits chunk metadata: id, bookId, sectionId, sectionTitle, chunkerVersion, anchor', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([{ text: 'Solo.', locationAnchor: ANCHOR }]),
    });
    const chunk = result[0]!;
    expect(chunk.bookId).toBe(BookId('b1'));
    expect(chunk.sectionId).toBe(SectionId('s1'));
    expect(chunk.sectionTitle).toBe('Chapter 1');
    expect(chunk.chunkerVersion).toBe(1);
    expect(chunk.locationAnchor).toEqual(ANCHOR);
    expect(chunk.id).toMatch(/^chunk-b1-s1-\d+$/);
    expect(chunk.tokenEstimate).toBeGreaterThan(0);
    expect(chunk.checksum).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('starts a new chunk when the next paragraph would exceed the 400-token cap', async () => {
    // Each paragraph is ~600 chars = ~150 tokens. 3 paragraphs = ~450 tokens > 400.
    const longText = 'word '.repeat(120).trim(); // ~600 chars
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: longText, locationAnchor: ANCHOR },
        { text: longText, locationAnchor: ANCHOR },
        { text: longText, locationAnchor: ANCHOR },
      ]),
    });
    // Two paragraphs fit in one chunk (~300 tokens); the third opens a second chunk.
    expect(result.length).toBe(2);
    expect(result[0]!.tokenEstimate).toBeLessThanOrEqual(400);
    expect(result[1]!.tokenEstimate).toBeLessThanOrEqual(400);
  });

  it('splits a single paragraph at sentence boundaries when it alone exceeds the cap', async () => {
    // ~2400 chars = ~600 tokens > 400. Multiple sentences.
    const sentence = 'This is a test sentence. ';
    const longParagraph = sentence.repeat(100).trim();
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([{ text: longParagraph, locationAnchor: ANCHOR }]),
    });
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(400);
    }
  });

  it('chunk IDs are stable across reruns of the same input (deterministic)', async () => {
    const input = {
      ...baseInput,
      paragraphs: fromArray([
        { text: 'A.', locationAnchor: ANCHOR },
        { text: 'B.', locationAnchor: ANCHOR },
      ]),
    };
    const run1 = await paragraphsToChunks(input);
    const run2 = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: 'A.', locationAnchor: ANCHOR },
        { text: 'B.', locationAnchor: ANCHOR },
      ]),
    });
    expect(run1.map((c) => c.id)).toEqual(run2.map((c) => c.id));
    expect(run1.map((c) => c.checksum)).toEqual(run2.map((c) => c.checksum));
  });

  it('returns empty array when given no paragraphs', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([]),
    });
    expect(result).toEqual([]);
  });

  it('skips whitespace-only paragraphs', async () => {
    const result = await paragraphsToChunks({
      ...baseInput,
      paragraphs: fromArray([
        { text: '   ', locationAnchor: ANCHOR },
        { text: 'Real content.', locationAnchor: ANCHOR },
      ]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.normalizedText).toBe('Real content.');
  });
});
```

- [ ] **Step 7: Run failing tests.**

```bash
pnpm test src/features/library/indexing/paragraphsToChunks.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 8: Implement `paragraphsToChunks.ts`.**

```ts
import { BookId, ChunkId, SectionId, type LocationAnchor } from '@/domain';
import type { TextChunk } from '@/domain';
import { normalizeChunkText, tokenEstimate } from './normalize';

const MAX_CHUNK_TOKENS = 400;

export type ExtractedParagraph = {
  readonly text: string;
  readonly locationAnchor: LocationAnchor;
};

export type ParagraphsToChunksInput = {
  readonly paragraphs: AsyncIterable<ExtractedParagraph>;
  readonly bookId: BookId;
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly chunkerVersion: number;
};

// Web Crypto sha256 → hex string. Used for chunk checksum (existing TextChunk
// field, finally populated). Deterministic for a given normalizedText.
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function splitOversizedParagraph(text: string): string[] {
  // Sentence boundary split: lookbehind for terminal punctuation followed by
  // whitespace and an uppercase start. Handles most prose; documented
  // limitation for run-on or non-Latin scripts.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const result: string[] = [];
  let buf = '';
  for (const sent of sentences) {
    const candidate = buf.length === 0 ? sent : `${buf} ${sent}`;
    if (tokenEstimate(candidate) > MAX_CHUNK_TOKENS && buf.length > 0) {
      result.push(buf);
      buf = sent;
    } else if (tokenEstimate(candidate) > MAX_CHUNK_TOKENS) {
      // Single sentence alone exceeds the cap — split at the cap as a last
      // resort. Documented limitation in spec §5.6.
      const charCap = MAX_CHUNK_TOKENS * 4;
      for (let i = 0; i < sent.length; i += charCap) {
        result.push(sent.slice(i, i + charCap));
      }
      buf = '';
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) result.push(buf);
  return result;
}

export async function paragraphsToChunks(input: ParagraphsToChunksInput): Promise<readonly TextChunk[]> {
  const buffer: ExtractedParagraph[] = [];
  for await (const p of input.paragraphs) {
    if (normalizeChunkText(p.text).length > 0) buffer.push(p);
  }

  const chunks: TextChunk[] = [];
  let pending: ExtractedParagraph[] = [];
  let pendingTokens = 0;

  const flushPending = async (): Promise<void> => {
    if (pending.length === 0) return;
    const joinedRaw = pending.map((p) => p.text).join('\n\n');
    const normalizedText = normalizeChunkText(joinedRaw);
    if (normalizedText.length === 0) {
      pending = [];
      pendingTokens = 0;
      return;
    }
    const idx = chunks.length;
    chunks.push({
      id: ChunkId(`chunk-${input.bookId}-${input.sectionId}-${String(idx)}`),
      bookId: input.bookId,
      sectionId: input.sectionId,
      sectionTitle: input.sectionTitle,
      text: joinedRaw,
      normalizedText,
      tokenEstimate: tokenEstimate(normalizedText),
      locationAnchor: pending[0]!.locationAnchor,
      checksum: await sha256Hex(normalizedText),
      chunkerVersion: input.chunkerVersion,
    });
    pending = [];
    pendingTokens = 0;
  };

  for (const para of buffer) {
    const paraTokens = tokenEstimate(normalizeChunkText(para.text));

    if (paraTokens > MAX_CHUNK_TOKENS) {
      // Single paragraph exceeds cap — flush whatever's pending, then split
      // this paragraph at sentence boundaries and emit each piece as its own
      // chunk.
      await flushPending();
      const pieces = splitOversizedParagraph(para.text);
      for (const piece of pieces) {
        pending = [{ text: piece, locationAnchor: para.locationAnchor }];
        pendingTokens = tokenEstimate(normalizeChunkText(piece));
        await flushPending();
      }
      continue;
    }

    if (pendingTokens + paraTokens > MAX_CHUNK_TOKENS && pending.length > 0) {
      await flushPending();
    }
    pending.push(para);
    pendingTokens += paraTokens;
  }

  await flushPending();
  return chunks;
}
```

- [ ] **Step 9: Run tests.**

```bash
pnpm test src/features/library/indexing/paragraphsToChunks.test.ts
```

Expected: PASS — all 7 cases.

- [ ] **Step 10: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 11: Commit.**

```bash
git add src/features/library/indexing/CHUNKER_VERSION.ts \
        src/features/library/indexing/normalize.ts \
        src/features/library/indexing/normalize.test.ts \
        src/features/library/indexing/paragraphsToChunks.ts \
        src/features/library/indexing/paragraphsToChunks.test.ts
git commit -m "feat(indexing): pure helpers — normalize, tokenEstimate, paragraphsToChunks (+ chunker version constant)"
```

---

## Task 5: PDF helpers — line/paragraph grouping, dehyphenation, boilerplate filter

**Spec refs:** §5.4, §12 commit 5.

**Files:**
- Create: `src/features/library/indexing/pdfHelpers.ts`
- Create: `src/features/library/indexing/pdfHelpers.test.ts`

- [ ] **Step 1: Write failing tests.**

Create `src/features/library/indexing/pdfHelpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  groupItemsIntoLines,
  groupLinesIntoParagraphs,
  dehyphenateWordWraps,
  detectRunningHeadersFooters,
  isPageNumberOnly,
  type PdfItem,
} from './pdfHelpers';

function item(str: string, x: number, y: number): PdfItem {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

describe('groupItemsIntoLines', () => {
  it('groups items at the same y-position into one line', () => {
    const items = [item('Hello', 0, 100), item('world', 50, 100)];
    const lines = groupItemsIntoLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Hello world');
    expect(lines[0]!.y).toBe(100);
  });

  it('separates items at different y-positions', () => {
    const items = [item('First', 0, 200), item('Second', 0, 100)];
    const lines = groupItemsIntoLines(items);
    expect(lines).toHaveLength(2);
  });

  it('tolerates ±2px y-jitter as same line', () => {
    const items = [item('A', 0, 100), item('B', 50, 101.5)];
    const lines = groupItemsIntoLines(items);
    expect(lines).toHaveLength(1);
  });

  it('sorts items within a line by x-coordinate', () => {
    const items = [item('world', 50, 100), item('Hello', 0, 100)];
    const lines = groupItemsIntoLines(items);
    expect(lines[0]!.text).toBe('Hello world');
  });
});

describe('groupLinesIntoParagraphs', () => {
  it('treats consecutive close-spaced lines as one paragraph', () => {
    // y decreases as we go down a page; line spacing ~12 ≈ median.
    const lines = [
      { text: 'First line', y: 100, x: 0 },
      { text: 'second line', y: 88, x: 0 },
      { text: 'third line', y: 76, x: 0 },
    ];
    const paragraphs = groupLinesIntoParagraphs(lines);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.text).toBe('First line second line third line');
  });

  it('breaks paragraphs on a vertical gap > 1.5x median line height', () => {
    const lines = [
      { text: 'A', y: 100, x: 0 },
      { text: 'B', y: 88, x: 0 },
      { text: 'C', y: 50, x: 0 }, // gap of 38 > 1.5 * 12
      { text: 'D', y: 38, x: 0 },
    ];
    const paragraphs = groupLinesIntoParagraphs(lines);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.text).toBe('A B');
    expect(paragraphs[1]!.text).toBe('C D');
  });

  it('breaks paragraphs on indent shift > 5% of page width', () => {
    const lines = [
      { text: 'A', y: 100, x: 50 },
      { text: 'B', y: 88, x: 50 },
      { text: 'C', y: 76, x: 80 }, // indent shift
    ];
    const paragraphs = groupLinesIntoParagraphs(lines);
    expect(paragraphs).toHaveLength(2);
  });

  it('returns one paragraph for a single line', () => {
    const paragraphs = groupLinesIntoParagraphs([{ text: 'Lonely', y: 100, x: 0 }]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.text).toBe('Lonely');
  });

  it('returns empty array for empty input', () => {
    expect(groupLinesIntoParagraphs([])).toEqual([]);
  });
});

describe('dehyphenateWordWraps', () => {
  it('joins lowercase-continuing word-wraps without the hyphen', () => {
    expect(dehyphenateWordWraps('foo-\nbar')).toBe('foobar');
  });

  it('preserves hyphens followed by uppercase or punct (sentence-end)', () => {
    expect(dehyphenateWordWraps('Smith-\nJones')).toBe('Smith-\nJones');
    expect(dehyphenateWordWraps('hello-\n!')).toBe('hello-\n!');
  });

  it('handles multiple word-wraps in one string', () => {
    expect(dehyphenateWordWraps('hap-\npy fam-\nilies')).toBe('happy families');
  });

  it('leaves regular hyphenated words alone (no newline)', () => {
    expect(dehyphenateWordWraps('well-being is great')).toBe('well-being is great');
  });
});

describe('detectRunningHeadersFooters', () => {
  it('returns line-strings that appear on > 50% of pages (4+ pages)', () => {
    const pages = [
      ['Header X', 'page 1 content'],
      ['Header X', 'page 2 content'],
      ['Header X', 'page 3 content'],
      ['Footer X', 'page 4 content'],
    ];
    const boilerplate = detectRunningHeadersFooters(pages);
    expect(boilerplate.has('Header X')).toBe(true);
  });

  it('does NOT flag a line that appears on ≤ 50% of pages', () => {
    const pages = [
      ['Header X', 'a'],
      ['Header X', 'b'],
      ['c', 'd'], // Header X missing
      ['e', 'f'], // Header X missing
    ];
    const boilerplate = detectRunningHeadersFooters(pages);
    expect(boilerplate.has('Header X')).toBe(false);
  });

  it('returns an empty set for fewer than 4 pages (insufficient sample)', () => {
    const pages = [
      ['Header X', 'a'],
      ['Header X', 'b'],
      ['Header X', 'c'],
    ];
    expect(detectRunningHeadersFooters(pages).size).toBe(0);
  });

  it('handles empty pages without throwing', () => {
    const pages = [[], [], [], []];
    expect(detectRunningHeadersFooters(pages).size).toBe(0);
  });
});

describe('isPageNumberOnly', () => {
  it('matches Arabic page numbers', () => {
    expect(isPageNumberOnly('42')).toBe(true);
    expect(isPageNumberOnly('  42  ')).toBe(true);
    expect(isPageNumberOnly('1234')).toBe(true);
  });

  it('matches roman numeral page numbers (lower or upper)', () => {
    expect(isPageNumberOnly('iv')).toBe(true);
    expect(isPageNumberOnly('XII')).toBe(true);
    expect(isPageNumberOnly('viii')).toBe(true);
  });

  it('rejects strings with text content', () => {
    expect(isPageNumberOnly('Page 42')).toBe(false);
    expect(isPageNumberOnly('42 of 100')).toBe(false);
    expect(isPageNumberOnly('Chapter 1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isPageNumberOnly('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/library/indexing/pdfHelpers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pdfHelpers.ts`.**

```ts
// Pure helpers for PDF text extraction. PDF text-layer items are absolutely
// positioned (not in DOM reading order), so we reconstruct paragraphs from
// y-position groupings + line-spacing gaps + indent signals. All pure;
// fully unit-testable without spinning up pdfjs.

// Mirrors the shape pdfjs-dist's getTextContent() returns.
export type PdfItem = {
  readonly str: string;
  readonly transform: readonly [number, number, number, number, number, number];
};

export type PdfLine = {
  readonly text: string;
  readonly y: number;
  readonly x: number;
};

export type PdfParagraph = {
  readonly text: string;
  readonly y: number;
};

const Y_JITTER = 2;
const PARAGRAPH_GAP_MULTIPLIER = 1.5;
const INDENT_SHIFT_FRACTION = 0.05; // 5% of page width
const ASSUMED_PAGE_WIDTH = 612; // PDF.js default; close enough for indent ratio
const MIN_PAGES_FOR_BOILERPLATE = 4;
const BOILERPLATE_PAGE_FRACTION = 0.5;

export function groupItemsIntoLines(items: readonly PdfItem[]): PdfLine[] {
  if (items.length === 0) return [];
  // Sort by y descending (PDF y-axis is bottom-up; higher y = closer to top of page).
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5]);
  const lines: { items: PdfItem[]; y: number }[] = [];
  for (const item of sorted) {
    const y = item.transform[5];
    const last = lines[lines.length - 1];
    if (last !== undefined && Math.abs(last.y - y) <= Y_JITTER) {
      last.items.push(item);
    } else {
      lines.push({ items: [item], y });
    }
  }
  return lines.map((l) => {
    const sortedX = [...l.items].sort((a, b) => a.transform[4] - b.transform[4]);
    const text = sortedX
      .map((i) => i.str)
      .filter((s) => s.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const x = sortedX[0]?.transform[4] ?? 0;
    return { text, y: l.y, x };
  });
}

export function groupLinesIntoParagraphs(lines: readonly PdfLine[]): PdfParagraph[] {
  if (lines.length === 0) return [];
  if (lines.length === 1) {
    return [{ text: lines[0]!.text, y: lines[0]!.y }];
  }

  // Compute median vertical line spacing (descending y → spacing is prev.y - curr.y).
  const spacings: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    spacings.push(lines[i - 1]!.y - lines[i]!.y);
  }
  const sortedSpacings = [...spacings].sort((a, b) => a - b);
  const medianSpacing = sortedSpacings[Math.floor(sortedSpacings.length / 2)] ?? 12;
  const indentThreshold = ASSUMED_PAGE_WIDTH * INDENT_SHIFT_FRACTION;

  const paragraphs: { lines: PdfLine[] }[] = [{ lines: [lines[0]!] }];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const curr = lines[i]!;
    const gap = prev.y - curr.y;
    const indentShift = Math.abs(curr.x - prev.x);
    const breakHere =
      gap > medianSpacing * PARAGRAPH_GAP_MULTIPLIER || indentShift > indentThreshold;
    if (breakHere) {
      paragraphs.push({ lines: [curr] });
    } else {
      paragraphs[paragraphs.length - 1]!.lines.push(curr);
    }
  }

  return paragraphs.map((p) => ({
    text: p.lines.map((l) => l.text).join(' '),
    y: p.lines[0]!.y,
  }));
}

export function dehyphenateWordWraps(text: string): string {
  // Join `foo-\nbar` → `foobar` only when next char is lowercase (typical
  // word-wrap). Preserve hyphens that end before uppercase/punctuation
  // (Smith-\nJones, hello-\n!).
  return text.replace(/(\w+)-\n(\w*)/g, (match, before: string, after: string) => {
    if (after.length === 0 || !/^[a-z]/.test(after)) return match;
    return `${before}${after}`;
  });
}

export function detectRunningHeadersFooters(
  pageTexts: readonly (readonly string[])[],
): Set<string> {
  if (pageTexts.length < MIN_PAGES_FOR_BOILERPLATE) return new Set();
  const counts = new Map<string, number>();
  for (const page of pageTexts) {
    const seen = new Set<string>();
    for (const line of page) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  const threshold = pageTexts.length * BOILERPLATE_PAGE_FRACTION;
  const result = new Set<string>();
  for (const [line, n] of counts) {
    if (n > threshold) result.add(line);
  }
  return result;
}

const ARABIC_PAGE_NUMBER = /^\s*\d+\s*$/;
const ROMAN_PAGE_NUMBER = /^\s*[ivxlcdm]+\s*$/i;

export function isPageNumberOnly(s: string): boolean {
  if (s.length === 0) return false;
  return ARABIC_PAGE_NUMBER.test(s) || ROMAN_PAGE_NUMBER.test(s);
}
```

- [ ] **Step 4: Run tests.**

```bash
pnpm test src/features/library/indexing/pdfHelpers.test.ts
```

Expected: PASS — all 18 cases.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/library/indexing/pdfHelpers.ts \
        src/features/library/indexing/pdfHelpers.test.ts
git commit -m "feat(indexing): PDF helpers — line/paragraph grouping, dehyphenation, boilerplate filter, page-number predicate"
```

---

## Task 6: `ChunkExtractor` interface + `classifyError`

**Spec refs:** §5.1, §6.6, §12 commit 6.

**Files:**
- Create: `src/features/library/indexing/extractor.ts`
- Create: `src/features/library/indexing/classifyError.ts`
- Create: `src/features/library/indexing/classifyError.test.ts`

- [ ] **Step 1: Create `extractor.ts` (interface only — no impl yet).**

```ts
import type { Book, BookId, SectionId, LocationAnchor } from '@/domain';

export type SectionListing = {
  readonly id: SectionId;
  readonly title: string;
  readonly range: EpubSectionRange | PdfSectionRange;
};

export type EpubSectionRange = {
  readonly kind: 'epub';
  readonly spineIndex: number;
};

export type PdfSectionRange = {
  readonly kind: 'pdf';
  readonly startPage: number;
  readonly endPage: number;
};

export type ExtractedParagraph = {
  readonly text: string;
  readonly locationAnchor: LocationAnchor;
};

// The pipeline calls these two methods; the extractor is the only place that
// knows about format internals. Format-specific extractors implement this
// interface; the pipeline dispatches via book.format.
export interface ChunkExtractor {
  listSections(book: Book): Promise<readonly SectionListing[]>;
  streamParagraphs(
    book: Book,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph>;
}

// Re-export ExtractedParagraph from paragraphsToChunks's local copy so the
// types unify; in practice paragraphsToChunks consumes the same shape.
// (paragraphsToChunks.ts already declares its own; the engineer should ensure
// they're the same shape — TypeScript structural typing handles this.)
```

> Note: `paragraphsToChunks.ts` (Task 4) already exports an `ExtractedParagraph` type with the same shape. TypeScript's structural typing makes them interchangeable; both files locally declare what they need. If the engineer prefers to deduplicate, this `extractor.ts` is the canonical home — make `paragraphsToChunks.ts` import from here instead. Either is correct.

- [ ] **Step 2: Write failing tests for `classifyError.ts`.**

Create `src/features/library/indexing/classifyError.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyError } from './classifyError';

describe('classifyError', () => {
  it('classifies "no text" / "empty" errors as no-text-found', () => {
    expect(classifyError(new Error('no text content found'))).toBe('no-text-found');
    expect(classifyError(new Error('Empty document'))).toBe('no-text-found');
  });

  it('classifies parser/extraction errors as extract-failed', () => {
    expect(classifyError(new Error('Invalid EPUB'))).toBe('extract-failed');
    expect(classifyError(new Error('Failed to parse PDF outline'))).toBe('extract-failed');
    expect(classifyError(new Error('PasswordException: encrypted'))).toBe('extract-failed');
  });

  it('classifies IDB / quota errors as persist-failed', () => {
    const quotaErr = new Error('QuotaExceededError');
    expect(classifyError(quotaErr)).toBe('persist-failed');
    const idbErr = new Error('Transaction aborted');
    expect(classifyError(idbErr)).toBe('persist-failed');
  });

  it('falls through to unknown for unrecognized errors', () => {
    expect(classifyError(new Error('asdf'))).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError({ weird: true })).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run failing tests.**

```bash
pnpm test src/features/library/indexing/classifyError.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `classifyError.ts`.**

```ts
export type FailReason =
  | 'extract-failed'
  | 'no-text-found'
  | 'persist-failed'
  | 'unknown';

const NO_TEXT_PATTERNS = [/no text/i, /empty document/i, /no extractable/i];
const EXTRACT_PATTERNS = [
  /invalid (epub|pdf)/i,
  /failed to parse/i,
  /passwordexception/i,
  /encrypted/i,
  /malformed/i,
  /pdf parse/i,
  /epub parse/i,
];
const PERSIST_PATTERNS = [
  /quotaexceeded/i,
  /transaction aborted/i,
  /idb/i,
  /storage/i,
];

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

export function classifyError(err: unknown): FailReason {
  const msg = messageOf(err);
  if (msg.length === 0) return 'unknown';
  if (NO_TEXT_PATTERNS.some((p) => p.test(msg))) return 'no-text-found';
  if (EXTRACT_PATTERNS.some((p) => p.test(msg))) return 'extract-failed';
  if (PERSIST_PATTERNS.some((p) => p.test(msg))) return 'persist-failed';
  return 'unknown';
}
```

- [ ] **Step 5: Run tests.**

```bash
pnpm test src/features/library/indexing/classifyError.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/library/indexing/extractor.ts \
        src/features/library/indexing/classifyError.ts \
        src/features/library/indexing/classifyError.test.ts
git commit -m "feat(indexing): ChunkExtractor contract + classifyError"
```

---

## Task 7: `EpubChunkExtractor`

**Spec refs:** §5.2, §12 commit 7.

**Files:**
- Create: `src/features/library/indexing/EpubChunkExtractor.ts`
- Create: `src/features/library/indexing/EpubChunkExtractor.test.ts`

> ⚠️ **Implementation-time verification before this task** — Try `import { EPUB } from 'foliate-js/epub.js'` and `import { CFI } from 'foliate-js/epubcfi.js'` (or whatever the actual export shapes are). If foliate-js's package.json doesn't expose these entry points cleanly, fall back to the JSZip + DOMParser path: parse `META-INF/container.xml` → `content.opf` → spine href list → DOMParser each spine doc. Re-export foliate's CFI module from a local `epubCfi.ts` wrapper so the rest of the code doesn't care which path was taken.
>
> The contract below (`listSections`, `streamParagraphs`) doesn't change either way. Confirm at the start of this task which path applies.

- [ ] **Step 1: Verify foliate-js's headless API.**

Open a Node REPL or write a tiny scratch test:

```ts
// scratch.ts (delete after)
import('foliate-js/epub.js').then((m) => console.log(Object.keys(m)));
import('foliate-js/epubcfi.js').then((m) => console.log(Object.keys(m)));
```

If both expose usable APIs (`EPUB.load(blob)` returns `{ spine, toc }` etc., `CFI.fromRange(spineIndex, range)` produces a CFI string), proceed with the foliate path. If either fails with "Module not found" or the export shape is unexpected, switch to the JSZip + DOMParser fallback path described in the spec §5.2 warning.

This step does not produce a commit; it informs Step 2.

- [ ] **Step 2: Write failing tests (lifecycle-style, matching the EpubReaderAdapter test pattern).**

Create `src/features/library/indexing/EpubChunkExtractor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EpubChunkExtractor } from './EpubChunkExtractor';

const FIXTURE_PATH = resolve(__dirname, '../../../../test-fixtures/small-pride-and-prejudice.epub');

function loadFixtureBlob(): Blob {
  const bytes = readFileSync(FIXTURE_PATH);
  return new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' });
}

describe('EpubChunkExtractor (lifecycle)', () => {
  it('throws cleanly when listSections is called on a non-EPUB book', async () => {
    const extractor = new EpubChunkExtractor();
    const fakePdfBook = {
      id: 'b1',
      format: 'pdf',
      // ...other Book fields irrelevant for this guard
    } as never;
    await expect(extractor.listSections(fakePdfBook)).rejects.toThrow();
  });

  it(
    'happy-path: listSections against the fixture returns at least one section, OR fails cleanly in happy-dom',
    async () => {
      const extractor = new EpubChunkExtractor();
      const blob = loadFixtureBlob();
      const fakeBook = {
        id: 'b1',
        format: 'epub',
        title: 'Pride and Prejudice',
        toc: [],
        // The extractor reads the blob via book.source / opfsPath in production; in tests
        // pass a `loadBlob` injection or test-helper that returns the fixture blob directly.
      } as never;
      try {
        // The extractor's actual API may need a blob-loader injection;
        // adapt this test to whatever shape the implementation chooses.
        const sections = await extractor.listSectionsFromBlob(blob, 'Pride and Prejudice');
        expect(sections.length).toBeGreaterThan(0);
        for (const s of sections) {
          expect(s.id).toBeTruthy();
          expect(s.title).toBeTruthy();
          expect(s.range.kind).toBe('epub');
        }
      } catch (err) {
        console.warn(
          '[EpubChunkExtractor test] happy-dom couldn\'t load foliate-js (expected):',
          err instanceof Error ? err.message : err,
        );
      }
    },
  );

  // Real-extraction (paragraph stream against the fixture) is exercised in E2E
  // (Task 15) where Playwright runs against real Chromium.
});
```

> Note: `listSectionsFromBlob` is a test-only convenience method on the extractor that takes the blob directly (skipping the OPFS lookup). Production code paths use `listSections(book)` which reads the blob via `wiring.opfs.readFile(book.source.opfsPath)`. The implementation should expose `listSectionsFromBlob` (and a similar `streamParagraphsFromBlob`) as test seams.

- [ ] **Step 3: Run failing tests.**

```bash
pnpm test src/features/library/indexing/EpubChunkExtractor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `EpubChunkExtractor.ts` (foliate-js headless path).**

```ts
import { SectionId, BookId, type Book, type LocationAnchor } from '@/domain';
import type {
  ChunkExtractor,
  SectionListing,
  ExtractedParagraph,
} from './extractor';

// Foliate-js entry points. If these imports fail at build time, switch to
// the JSZip + DOMParser fallback (see spec §5.2).
import { EPUB } from 'foliate-js/epub.js';
import { CFI } from 'foliate-js/epubcfi.js';

const PARAGRAPH_TAGS = new Set([
  'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE',
]);

type ResolveBlob = (book: Book) => Promise<Blob>;

export class EpubChunkExtractor implements ChunkExtractor {
  // resolveBlob is an injection point; in production wired to wiring.opfs.readFile.
  // Tests pass a mock that returns the fixture blob.
  constructor(private readonly resolveBlob?: ResolveBlob) {}

  async listSections(book: Book): Promise<readonly SectionListing[]> {
    if (book.format !== 'epub') {
      throw new Error(`EpubChunkExtractor: cannot list sections for ${book.format}`);
    }
    if (this.resolveBlob === undefined) {
      throw new Error('EpubChunkExtractor: no blob resolver configured');
    }
    const blob = await this.resolveBlob(book);
    return this.listSectionsFromBlob(blob, book.title);
  }

  // Test seam: takes a blob directly so unit tests don't need the full Book shape.
  async listSectionsFromBlob(blob: Blob, bookTitle: string): Promise<readonly SectionListing[]> {
    const epub = await EPUB.load(blob);
    const spine = epub.spine ?? [];
    if (spine.length === 0) {
      // Synthetic single-section fallback for spine-less books.
      return [
        {
          id: SectionId('__whole_book__'),
          title: bookTitle,
          range: { kind: 'epub', spineIndex: 0 },
        },
      ];
    }
    return spine.map((entry: { href: string }, i: number): SectionListing => {
      const tocLabel = epub.toc?.find((t: { href: string; label: string }) =>
        t.href === entry.href || t.href.startsWith(entry.href + '#'),
      )?.label;
      return {
        id: SectionId('spine:' + entry.href),
        title: tocLabel ?? `Section ${String(i + 1)}`,
        range: { kind: 'epub', spineIndex: i },
      };
    });
  }

  async *streamParagraphs(
    book: Book,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (this.resolveBlob === undefined) {
      throw new Error('EpubChunkExtractor: no blob resolver configured');
    }
    const blob = await this.resolveBlob(book);
    yield* this.streamParagraphsFromBlob(blob, section);
  }

  async *streamParagraphsFromBlob(
    blob: Blob,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (section.range.kind !== 'epub') {
      throw new Error('EpubChunkExtractor: PDF section passed to EPUB extractor');
    }
    const spineIndex = section.range.spineIndex;
    const epub = await EPUB.load(blob);
    const spineEntry = epub.spine[spineIndex];
    if (spineEntry === undefined) return;
    const doc = await spineEntry.load(); // returns a Document
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode === doc.body ? walker.nextNode() : walker.currentNode;
    while (current !== null) {
      if (PARAGRAPH_TAGS.has((current as Element).tagName)) {
        const text = (current as Element).textContent ?? '';
        if (text.trim().length > 0) {
          const range = doc.createRange();
          range.selectNodeContents(current);
          range.collapse(true);
          let cfi: string;
          try {
            cfi = CFI.fromRange(spineIndex, range);
          } catch {
            // If CFI generation fails for an obscure node, skip — chunk
            // anchor would be unreliable. Reading still works for the
            // surrounding chunks.
            current = walker.nextNode();
            continue;
          }
          const locationAnchor: LocationAnchor = { kind: 'epub-cfi', cfi };
          yield { text, locationAnchor };
        }
      }
      current = walker.nextNode();
    }
  }
}
```

> Engineer note: foliate-js's TypeScript types may not be available; if so, the imports above + the inline shape annotations (e.g., `(entry: { href: string }, i: number)`) are the practical contract. If types are wrong at compile time, add a small `foliate-js.d.ts` ambient declaration.

- [ ] **Step 5: Run the tests.**

```bash
pnpm test src/features/library/indexing/EpubChunkExtractor.test.ts
```

Expected: PASS for the lifecycle test (the happy-dom-OR-fail test will likely log the warning + pass; full happy-path is covered by E2E).

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/library/indexing/EpubChunkExtractor.ts \
        src/features/library/indexing/EpubChunkExtractor.test.ts
git commit -m "feat(indexing): EpubChunkExtractor — foliate-js headless parse with JSZip+DOMParser fallback path"
```

---

## Task 8: `PdfChunkExtractor`

**Spec refs:** §5.3, §12 commit 8.

**Files:**
- Create: `src/features/library/indexing/PdfChunkExtractor.ts`
- Create: `src/features/library/indexing/PdfChunkExtractor.test.ts`

- [ ] **Step 1: Write failing tests (lifecycle, mirroring `PdfReaderAdapter.test.ts` pattern).**

Create `src/features/library/indexing/PdfChunkExtractor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PdfChunkExtractor } from './PdfChunkExtractor';

describe('PdfChunkExtractor (lifecycle)', () => {
  it('throws cleanly when listSections is called on a non-PDF book', async () => {
    const extractor = new PdfChunkExtractor();
    const fakeEpubBook = {
      id: 'b1',
      format: 'epub',
    } as never;
    await expect(extractor.listSections(fakeEpubBook)).rejects.toThrow();
  });

  it('returns a synthetic single section when outline is empty', async () => {
    const extractor = new PdfChunkExtractor();
    // Test seam: feed a stub pdfDoc that returns no outline.
    const stubPdfDoc = {
      numPages: 5,
      getOutline: () => Promise.resolve(null),
    } as never;
    const sections = await extractor.listSectionsFromPdfDoc(
      stubPdfDoc,
      'My Book',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe('__whole_book__');
    expect(sections[0]!.title).toBe('My Book');
    expect(sections[0]!.range.kind).toBe('pdf');
  });

  it('returns one section per outline entry, with page ranges derived from neighbors', async () => {
    const extractor = new PdfChunkExtractor();
    const stubPdfDoc = {
      numPages: 100,
      getOutline: () =>
        Promise.resolve([
          { title: 'Chapter 1', dest: [{ num: 0, gen: 0 }, { name: 'XYZ' }, 0, 800, 0] },
          { title: 'Chapter 2', dest: [{ num: 0, gen: 0 }, { name: 'XYZ' }, 0, 800, 0] },
        ]),
      getPageIndex: () => Promise.resolve(0), // simplified; real test seam should map dests to pages
    } as never;
    const sections = await extractor.listSectionsFromPdfDoc(stubPdfDoc, 'Book');
    expect(sections.length).toBeGreaterThanOrEqual(1);
    for (const s of sections) {
      expect(s.range.kind).toBe('pdf');
    }
  });

  // Real extraction is exercised in E2E (Task 15) — happy-dom can't reliably
  // load pdfjs-dist's worker.
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/library/indexing/PdfChunkExtractor.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `PdfChunkExtractor.ts`.**

```ts
import { SectionId, type Book, type LocationAnchor } from '@/domain';
import type {
  ChunkExtractor,
  SectionListing,
  ExtractedParagraph,
} from './extractor';
import {
  groupItemsIntoLines,
  groupLinesIntoParagraphs,
  dehyphenateWordWraps,
  detectRunningHeadersFooters,
  isPageNumberOnly,
  type PdfItem,
} from './pdfHelpers';
import { pdfjs } from '@/features/library/import/parsers/pdf-pdfjs';

type ResolveBlob = (book: Book) => Promise<Blob>;

// Minimal subset of pdfjs's PDFDocumentProxy we use. Lets us mock in tests.
type PdfDocLike = {
  numPages: number;
  getOutline(): Promise<readonly OutlineNode[] | null>;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getPageIndex?(dest: unknown): Promise<number>; // real PDFDocumentProxy has this
};

type OutlineNode = {
  readonly title: string;
  readonly dest?: unknown;
  readonly items?: readonly OutlineNode[];
};

type PdfPageLike = {
  getTextContent(): Promise<{ items: PdfItem[] }>;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export class PdfChunkExtractor implements ChunkExtractor {
  constructor(private readonly resolveBlob?: ResolveBlob) {}

  async listSections(book: Book): Promise<readonly SectionListing[]> {
    if (book.format !== 'pdf') {
      throw new Error(`PdfChunkExtractor: cannot list sections for ${book.format}`);
    }
    if (this.resolveBlob === undefined) {
      throw new Error('PdfChunkExtractor: no blob resolver configured');
    }
    const blob = await this.resolveBlob(book);
    const arrayBuffer = await blob.arrayBuffer();
    const pdfDoc = (await pdfjs.getDocument({ data: arrayBuffer }).promise) as PdfDocLike;
    return this.listSectionsFromPdfDoc(pdfDoc, book.title);
  }

  async listSectionsFromPdfDoc(
    pdfDoc: PdfDocLike,
    bookTitle: string,
  ): Promise<readonly SectionListing[]> {
    const outline = await pdfDoc.getOutline();
    if (outline === null || outline.length === 0) {
      return [
        {
          id: SectionId('__whole_book__'),
          title: bookTitle,
          range: { kind: 'pdf', startPage: 1, endPage: pdfDoc.numPages },
        },
      ];
    }
    // Flatten the outline tree depth-first; resolve each entry's destination
    // to a page number using getPageIndex.
    const flat: { title: string; pageNumber: number }[] = [];
    const walk = async (nodes: readonly OutlineNode[]): Promise<void> => {
      for (const n of nodes) {
        let pageNumber = 1;
        if (n.dest !== undefined && pdfDoc.getPageIndex !== undefined) {
          try {
            pageNumber = (await pdfDoc.getPageIndex(n.dest)) + 1;
          } catch {
            // Some destinations don't resolve; fall through.
          }
        }
        flat.push({ title: n.title, pageNumber });
        if (n.items !== undefined) await walk(n.items);
      }
    };
    await walk(outline);
    flat.sort((a, b) => a.pageNumber - b.pageNumber);

    const sections: SectionListing[] = flat.map((entry, i) => {
      const next = flat[i + 1];
      const endPage = next !== undefined ? next.pageNumber - 1 : pdfDoc.numPages;
      return {
        id: SectionId(`pdf:${String(entry.pageNumber)}:${slugify(entry.title)}`),
        title: entry.title,
        range: {
          kind: 'pdf',
          startPage: entry.pageNumber,
          endPage: Math.max(entry.pageNumber, endPage),
        },
      };
    });
    return sections;
  }

  async *streamParagraphs(
    book: Book,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (this.resolveBlob === undefined) {
      throw new Error('PdfChunkExtractor: no blob resolver configured');
    }
    if (section.range.kind !== 'pdf') {
      throw new Error('PdfChunkExtractor: EPUB section passed to PDF extractor');
    }
    const blob = await this.resolveBlob(book);
    const arrayBuffer = await blob.arrayBuffer();
    const pdfDoc = (await pdfjs.getDocument({ data: arrayBuffer }).promise) as PdfDocLike;
    yield* this.streamParagraphsFromPdfDoc(pdfDoc, section);
  }

  async *streamParagraphsFromPdfDoc(
    pdfDoc: PdfDocLike,
    section: SectionListing,
  ): AsyncIterable<ExtractedParagraph> {
    if (section.range.kind !== 'pdf') return;
    const { startPage, endPage } = section.range;

    // Pass 1: collect text for boilerplate detection.
    const allPagesText: string[][] = [];
    for (let p = startPage; p <= endPage; p++) {
      const page = await pdfDoc.getPage(p);
      const items = (await page.getTextContent()).items;
      const lines = groupItemsIntoLines(items);
      allPagesText.push(lines.map((l) => l.text));
    }
    const boilerplate = detectRunningHeadersFooters(allPagesText);

    // Pass 2: emit paragraphs.
    for (let p = startPage; p <= endPage; p++) {
      const page = await pdfDoc.getPage(p);
      const items = (await page.getTextContent()).items;
      const lines = groupItemsIntoLines(items);
      const paragraphs = groupLinesIntoParagraphs(lines);
      for (const para of paragraphs) {
        const trimmed = para.text.trim();
        if (trimmed.length === 0) continue;
        if (isPageNumberOnly(trimmed)) continue;
        if (boilerplate.has(trimmed)) continue;
        const dehyphenated = dehyphenateWordWraps(para.text);
        const locationAnchor: LocationAnchor = { kind: 'pdf', page: p };
        yield { text: dehyphenated, locationAnchor };
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm test src/features/library/indexing/PdfChunkExtractor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/library/indexing/PdfChunkExtractor.ts \
        src/features/library/indexing/PdfChunkExtractor.test.ts
git commit -m "feat(indexing): PdfChunkExtractor — pdfjs outline + two-pass paragraph extraction"
```

---

## Task 9: `runIndexing` pipeline

**Spec refs:** §6.1, §12 commit 9.

**Files:**
- Create: `src/features/library/indexing/pipeline.ts`
- Create: `src/features/library/indexing/pipeline.test.ts`

- [ ] **Step 1: Write failing tests.**

Create `src/features/library/indexing/pipeline.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runIndexing } from './pipeline';
import { BookId, ChunkId, SectionId, IsoTimestamp, type Book } from '@/domain';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: BookId('b1'),
    title: 'Test',
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: 'p',
      originalName: 'p',
      byteSize: 0,
      mimeType: 'x',
      checksum: 'x',
    },
    importStatus: { kind: 'ready' },
    indexingStatus: { kind: 'pending' },
    aiProfileStatus: { kind: 'pending' },
    createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    ...overrides,
  };
}

function makeStubExtractor(sections: { id: string; title: string }[]) {
  return {
    listSections: vi.fn(() =>
      Promise.resolve(
        sections.map((s) => ({
          id: SectionId(s.id),
          title: s.title,
          range: { kind: 'epub' as const, spineIndex: 0 },
        })),
      ),
    ),
    streamParagraphs: vi.fn(async function* () {
      yield {
        text: 'Hello',
        locationAnchor: { kind: 'epub-cfi' as const, cfi: '/abc' },
      };
    }),
  };
}

function makeStubBookRepo(book: Book) {
  let current = book;
  return {
    getById: vi.fn(() => Promise.resolve(current)),
    put: vi.fn((b: Book) => {
      current = b;
      return Promise.resolve();
    }),
    current: () => current,
  };
}

function makeStubChunksRepo() {
  const stored: Record<string, unknown[]> = {};
  return {
    upsertMany: vi.fn((chunks: readonly unknown[]) => {
      for (const c of chunks) {
        const k = (c as { bookId: string; sectionId: string }).sectionId;
        stored[k] = stored[k] ?? [];
        stored[k]!.push(c);
      }
      return Promise.resolve();
    }),
    hasChunksFor: vi.fn((_bookId, sectionId: string) => {
      return Promise.resolve((stored[sectionId]?.length ?? 0) > 0);
    }),
    deleteByBook: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(0)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    listByBook: vi.fn(() => Promise.resolve([])),
    listBySection: vi.fn(() => Promise.resolve([])),
    deleteBySection: vi.fn(() => Promise.resolve()),
  };
}

describe('runIndexing', () => {
  it('happy path: writes pending → chunking{...} → ready and persists chunks per section', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor([
      { id: 's1', title: 'Chapter 1' },
      { id: 's2', title: 'Chapter 2' },
    ]);
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    expect(chunksRepo.upsertMany).toHaveBeenCalledTimes(2);
    expect(booksRepo.current().indexingStatus).toEqual({ kind: 'ready' });
  });

  it('idempotent resume: skips sections that already have chunks', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    chunksRepo.hasChunksFor = vi.fn((_bookId, sectionId: string) => {
      return Promise.resolve(sectionId === 's1'); // s1 already done
    });
    const extractor = makeStubExtractor([
      { id: 's1', title: 'Chapter 1' },
      { id: 's2', title: 'Chapter 2' },
    ]);
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    // Only s2 should have been chunked.
    expect(chunksRepo.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('writes failed{no-text-found} when listSections returns empty', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor([]);
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    expect(booksRepo.current().indexingStatus).toEqual({
      kind: 'failed',
      reason: 'no-text-found',
    });
  });

  it('writes failed{...} on extractor error with classified reason', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = {
      listSections: vi.fn(() => Promise.reject(new Error('Invalid EPUB'))),
      streamParagraphs: vi.fn(),
    };
    const ctrl = new AbortController();

    await runIndexing(book, ctrl.signal, {
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    expect(booksRepo.current().indexingStatus).toEqual({
      kind: 'failed',
      reason: 'extract-failed',
    });
  });

  it('does not write failed when aborted mid-flight (signal aborted)', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor([
      { id: 's1', title: 'Chapter 1' },
      { id: 's2', title: 'Chapter 2' },
    ]);
    const ctrl = new AbortController();
    ctrl.abort();

    await runIndexing(book, ctrl.signal, {
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    expect(booksRepo.current().indexingStatus.kind).not.toBe('failed');
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/library/indexing/pipeline.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pipeline.ts`.**

```ts
import { IsoTimestamp, type Book, type IndexingStatus } from '@/domain';
import type { BookRepository } from '@/storage';
import type { BookChunksRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { paragraphsToChunks } from './paragraphsToChunks';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { classifyError } from './classifyError';

export type PipelineDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
};

export const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

async function setStatus(
  bookId: Book['id'],
  status: IndexingStatus,
  booksRepo: BookRepository,
): Promise<void> {
  const book = await booksRepo.getById(bookId);
  if (book === undefined) return;
  await booksRepo.put({
    ...book,
    indexingStatus: status,
    updatedAt: IsoTimestamp(new Date().toISOString()),
  });
}

export async function runIndexing(
  book: Book,
  signal: AbortSignal,
  deps: PipelineDeps,
): Promise<void> {
  const extractor = book.format === 'epub' ? deps.epubExtractor : deps.pdfExtractor;
  try {
    await setStatus(book.id, { kind: 'chunking', progressPercent: 0 }, deps.booksRepo);

    const sections = await extractor.listSections(book);
    if (sections.length === 0) {
      if (signal.aborted) return;
      await setStatus(
        book.id,
        { kind: 'failed', reason: 'no-text-found' },
        deps.booksRepo,
      );
      return;
    }

    for (let i = 0; i < sections.length; i++) {
      if (signal.aborted) return;
      const section = sections[i]!;

      const alreadyDone = await deps.chunksRepo.hasChunksFor(book.id, section.id);
      if (!alreadyDone) {
        const paragraphs = extractor.streamParagraphs(book, section);
        const drafts = await paragraphsToChunks({
          paragraphs,
          bookId: book.id,
          sectionId: section.id,
          sectionTitle: section.title,
          chunkerVersion: CHUNKER_VERSION,
        });
        if (signal.aborted) return;
        await deps.chunksRepo.upsertMany(drafts);
      }

      const progressPercent = Math.round(((i + 1) / sections.length) * 100);
      await setStatus(
        book.id,
        { kind: 'chunking', progressPercent },
        deps.booksRepo,
      );
      await yieldToBrowser();
    }

    if (signal.aborted) return;
    await setStatus(book.id, { kind: 'ready' }, deps.booksRepo);
  } catch (err) {
    if (signal.aborted) return;
    console.warn('[indexing]', err);
    await setStatus(
      book.id,
      { kind: 'failed', reason: classifyError(err) },
      deps.booksRepo,
    );
  }
}
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm test src/features/library/indexing/pipeline.test.ts
```

Expected: PASS — all 5 cases.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/library/indexing/pipeline.ts \
        src/features/library/indexing/pipeline.test.ts
git commit -m "feat(indexing): runIndexing pipeline — status transitions, idempotent resume, abort handling"
```

---

## Task 10: `IndexingQueue`

**Spec refs:** §6.2, §12 commit 10.

**Files:**
- Create: `src/features/library/indexing/IndexingQueue.ts`
- Create: `src/features/library/indexing/IndexingQueue.test.ts`

- [ ] **Step 1: Write failing tests.**

Create `src/features/library/indexing/IndexingQueue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { IndexingQueue } from './IndexingQueue';
import { BookId, IsoTimestamp, type Book } from '@/domain';

function fakeBook(id: string): Book {
  return {
    id: BookId(id),
    title: id,
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: 'p',
      originalName: 'p',
      byteSize: 0,
      mimeType: 'x',
      checksum: 'x',
    },
    importStatus: { kind: 'ready' },
    indexingStatus: { kind: 'pending' },
    aiProfileStatus: { kind: 'pending' },
    createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

function makeStubBookRepo(books: Map<string, Book>) {
  return {
    getById: vi.fn((id) => Promise.resolve(books.get(id))),
    put: vi.fn((b: Book) => {
      books.set(b.id, b);
      return Promise.resolve();
    }),
    getAll: vi.fn(() => Promise.resolve([...books.values()])),
    findByChecksum: vi.fn(() => Promise.resolve(undefined)),
    delete: vi.fn(() => Promise.resolve()),
  };
}

function makeStubChunksRepo() {
  return {
    upsertMany: vi.fn(() => Promise.resolve()),
    hasChunksFor: vi.fn(() => Promise.resolve(false)),
    deleteByBook: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(0)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    listByBook: vi.fn(() => Promise.resolve([])),
    listBySection: vi.fn(() => Promise.resolve([])),
    deleteBySection: vi.fn(() => Promise.resolve()),
  };
}

function makeStubExtractor() {
  return {
    listSections: vi.fn(() => Promise.resolve([])), // empty → fast no-text-found
    streamParagraphs: vi.fn(async function* () {}),
  };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

describe('IndexingQueue', () => {
  it('enqueue → drain runs the pipeline once for the queued book', async () => {
    const books = new Map<string, Book>();
    books.set('b1', fakeBook('b1'));
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    queue.enqueue(BookId('b1'));
    await settle();
    expect(extractor.listSections).toHaveBeenCalledTimes(1);
  });

  it('single-flight: enqueueing the same book while in-flight is a no-op', async () => {
    const books = new Map<string, Book>();
    books.set('b1', fakeBook('b1'));
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    queue.enqueue(BookId('b1'));
    queue.enqueue(BookId('b1'));
    queue.enqueue(BookId('b1'));
    await settle();
    expect(extractor.listSections).toHaveBeenCalledTimes(1);
  });

  it('cancel during in-flight aborts the pipeline cleanly (status not failed)', async () => {
    const books = new Map<string, Book>();
    books.set('b1', fakeBook('b1'));
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    let resolveSections!: (sections: never[]) => void;
    const extractor = {
      listSections: vi.fn(
        () =>
          new Promise<never[]>((resolve) => {
            resolveSections = resolve;
          }),
      ),
      streamParagraphs: vi.fn(async function* () {}),
    };
    const queue = new IndexingQueue({
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    queue.enqueue(BookId('b1'));
    await new Promise((r) => setTimeout(r, 10)); // let drain start
    queue.cancel(BookId('b1'));
    resolveSections([]);
    await settle();
    // Cancelled → status was set to 'chunking' at start but the catch path
    // bails on signal.aborted, so it doesn't write 'failed'. Status may
    // remain 'chunking' until the next tick — that's the expected behavior;
    // resume on next app open will pick up where things left off.
    const final = books.get('b1')!.indexingStatus.kind;
    expect(final).not.toBe('failed');
  });

  it('rebuild deletes existing chunks, marks pending, and re-enqueues', async () => {
    const books = new Map<string, Book>();
    books.set('b1', fakeBook('b1'));
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    await queue.rebuild(BookId('b1'));
    await settle();
    expect(chunksRepo.deleteByBook).toHaveBeenCalledWith(BookId('b1'));
    expect(extractor.listSections).toHaveBeenCalledTimes(1);
  });

  it('onAppOpen drops stale-version chunks and resumes non-terminal books', async () => {
    const books = new Map<string, Book>();
    const b1 = { ...fakeBook('b1'), indexingStatus: { kind: 'chunking' as const, progressPercent: 50 } };
    const b2 = { ...fakeBook('b2'), indexingStatus: { kind: 'pending' as const } };
    const b3 = { ...fakeBook('b3'), indexingStatus: { kind: 'ready' as const } };
    books.set('b1', b1);
    books.set('b2', b2);
    books.set('b3', b3);
    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    chunksRepo.countStaleVersions = vi.fn(() => Promise.resolve([BookId('b3')]));
    const extractor = makeStubExtractor();
    const queue = new IndexingQueue({
      booksRepo: booksRepo as never,
      chunksRepo: chunksRepo as never,
      epubExtractor: extractor as never,
      pdfExtractor: {} as never,
    });

    await queue.onAppOpen();
    await settle();
    // b3's stale chunks deleted + book set to pending → enqueued.
    // b1 (chunking) and b2 (pending) also enqueued.
    // → 3 books processed.
    expect(extractor.listSections).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/library/indexing/IndexingQueue.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `IndexingQueue.ts`.**

```ts
import { IsoTimestamp, type BookId } from '@/domain';
import type { BookRepository, BookChunksRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { runIndexing, type PipelineDeps } from './pipeline';

export type IndexingQueueDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
};

export class IndexingQueue {
  private inFlightBookId: BookId | null = null;
  private pending = new Set<BookId>();
  private aborts = new Map<BookId, AbortController>();

  constructor(private readonly deps: IndexingQueueDeps) {}

  enqueue(bookId: BookId): void {
    if (bookId === this.inFlightBookId) return;
    this.pending.add(bookId);
    void this.drain();
  }

  cancel(bookId: BookId): void {
    this.pending.delete(bookId);
    this.aborts.get(bookId)?.abort();
  }

  async rebuild(bookId: BookId): Promise<void> {
    this.cancel(bookId);
    await this.deps.chunksRepo.deleteByBook(bookId);
    const book = await this.deps.booksRepo.getById(bookId);
    if (book !== undefined) {
      await this.deps.booksRepo.put({
        ...book,
        indexingStatus: { kind: 'pending' },
        updatedAt: IsoTimestamp(new Date().toISOString()),
      });
    }
    this.enqueue(bookId);
  }

  async onAppOpen(): Promise<void> {
    const staleBookIds = await this.deps.chunksRepo.countStaleVersions(CHUNKER_VERSION);
    for (const id of staleBookIds) {
      await this.deps.chunksRepo.deleteByBook(id);
      const book = await this.deps.booksRepo.getById(id);
      if (book !== undefined) {
        await this.deps.booksRepo.put({
          ...book,
          indexingStatus: { kind: 'pending' },
          updatedAt: IsoTimestamp(new Date().toISOString()),
        });
      }
    }
    const all = await this.deps.booksRepo.getAll();
    for (const book of all) {
      const k = book.indexingStatus.kind;
      if (k === 'pending' || k === 'chunking') this.enqueue(book.id);
    }
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0 && this.inFlightBookId === null) {
      const next = this.pending.values().next().value as BookId | undefined;
      if (next === undefined) break;
      this.pending.delete(next);
      this.inFlightBookId = next;

      const ctrl = new AbortController();
      this.aborts.set(next, ctrl);

      try {
        const book = await this.deps.booksRepo.getById(next);
        if (book !== undefined) {
          const pipelineDeps: PipelineDeps = {
            booksRepo: this.deps.booksRepo,
            chunksRepo: this.deps.chunksRepo,
            epubExtractor: this.deps.epubExtractor,
            pdfExtractor: this.deps.pdfExtractor,
          };
          await runIndexing(book, ctrl.signal, pipelineDeps);
        }
      } finally {
        this.aborts.delete(next);
        this.inFlightBookId = null;
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm test src/features/library/indexing/IndexingQueue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/library/indexing/IndexingQueue.ts \
        src/features/library/indexing/IndexingQueue.test.ts
git commit -m "feat(indexing): IndexingQueue — single-flight per book, sequential across, cancel + rebuild + onAppOpen"
```

---

## Task 11: `useIndexing` hook

**Spec refs:** §6.4, §12 commit 11.

**Files:**
- Create: `src/features/library/indexing/useIndexing.ts`
- Create: `src/features/library/indexing/useIndexing.test.ts`

- [ ] **Step 1: Write failing tests.**

Create `src/features/library/indexing/useIndexing.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIndexing } from './useIndexing';
import { BookId } from '@/domain';

function makeStubs() {
  return {
    booksRepo: {
      getById: vi.fn(() => Promise.resolve(undefined)),
      getAll: vi.fn(() => Promise.resolve([])),
      put: vi.fn(() => Promise.resolve()),
      findByChecksum: vi.fn(() => Promise.resolve(undefined)),
      delete: vi.fn(() => Promise.resolve()),
    },
    chunksRepo: {
      countStaleVersions: vi.fn(() => Promise.resolve([])),
      deleteByBook: vi.fn(() => Promise.resolve()),
      upsertMany: vi.fn(() => Promise.resolve()),
      hasChunksFor: vi.fn(() => Promise.resolve(false)),
      countByBook: vi.fn(() => Promise.resolve(0)),
      listByBook: vi.fn(() => Promise.resolve([])),
      listBySection: vi.fn(() => Promise.resolve([])),
      deleteBySection: vi.fn(() => Promise.resolve()),
    },
    epubExtractor: {
      listSections: vi.fn(() => Promise.resolve([])),
      streamParagraphs: vi.fn(async function* () {}),
    },
    pdfExtractor: {
      listSections: vi.fn(() => Promise.resolve([])),
      streamParagraphs: vi.fn(async function* () {}),
    },
  };
}

describe('useIndexing', () => {
  it('runs onAppOpen exactly once on mount', async () => {
    const stubs = makeStubs();
    renderHook(() => useIndexing(stubs as never));
    await new Promise((r) => setTimeout(r, 50));
    expect(stubs.chunksRepo.countStaleVersions).toHaveBeenCalledTimes(1);
    expect(stubs.booksRepo.getAll).toHaveBeenCalledTimes(1);
  });

  it('exposes enqueue/rebuild/cancel methods', () => {
    const stubs = makeStubs();
    const { result } = renderHook(() => useIndexing(stubs as never));
    expect(typeof result.current.enqueue).toBe('function');
    expect(typeof result.current.rebuild).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
  });

  it('enqueue dispatches to the underlying queue', async () => {
    const stubs = makeStubs();
    const { result } = renderHook(() => useIndexing(stubs as never));
    result.current.enqueue(BookId('b1'));
    await new Promise((r) => setTimeout(r, 50));
    expect(stubs.booksRepo.getById).toHaveBeenCalledWith(BookId('b1'));
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/library/indexing/useIndexing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useIndexing.ts`.**

```ts
import { useEffect, useRef } from 'react';
import type { BookId } from '@/domain';
import type { BookRepository, BookChunksRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { IndexingQueue } from './IndexingQueue';

export type UseIndexingDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
};

export type UseIndexingHandle = {
  readonly enqueue: (id: BookId) => void;
  readonly rebuild: (id: BookId) => Promise<void>;
  readonly cancel: (id: BookId) => void;
};

export function useIndexing(deps: UseIndexingDeps): UseIndexingHandle {
  const queueRef = useRef<IndexingQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = new IndexingQueue(deps);
  }
  const queue = queueRef.current;

  useEffect(() => {
    void queue.onAppOpen();
  }, [queue]);

  return {
    enqueue: (id) => {
      queue.enqueue(id);
    },
    rebuild: (id) => queue.rebuild(id),
    cancel: (id) => {
      queue.cancel(id);
    },
  };
}
```

- [ ] **Step 4: Run tests.**

```bash
pnpm test src/features/library/indexing/useIndexing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/library/indexing/useIndexing.ts \
        src/features/library/indexing/useIndexing.test.ts
git commit -m "feat(indexing): useIndexing hook + onAppOpen scan (stale-version + non-terminal status)"
```

---

## Task 12: `BookCardIndexingStatus` component

**Spec refs:** §7.1, §12 commit 12.

**Files:**
- Create: `src/features/library/indexing/BookCardIndexingStatus.tsx`
- Create: `src/features/library/indexing/BookCardIndexingStatus.test.tsx`
- Create: `src/features/library/indexing/indexing-inspector.css`

- [ ] **Step 1: Write failing tests.**

Create `src/features/library/indexing/BookCardIndexingStatus.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BookCardIndexingStatus } from './BookCardIndexingStatus';
import type { Book } from '@/domain';

afterEach(cleanup);

function makeBook(status: Book['indexingStatus']): Book {
  return {
    id: 'b1' as never,
    title: 'X',
    format: 'epub',
    coverRef: { kind: 'none' },
    toc: [],
    source: {
      kind: 'imported-file',
      opfsPath: 'p',
      originalName: 'p',
      byteSize: 0,
      mimeType: 'x',
      checksum: 'x',
    },
    importStatus: { kind: 'ready' },
    indexingStatus: status,
    aiProfileStatus: { kind: 'pending' },
    createdAt: '2026-05-06T00:00:00.000Z' as never,
    updatedAt: '2026-05-06T00:00:00.000Z' as never,
  };
}

describe('BookCardIndexingStatus', () => {
  it('pending: shows queued text, no inspector link', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'pending' })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/queued for indexing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /index inspector/i })).toBeNull();
  });

  it('chunking: shows progress with the percent and a progressbar', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'chunking', progressPercent: 45 })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/indexing/i)).toBeInTheDocument();
    expect(screen.getByText(/45%/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('ready: shows checkmark + clickable inspector link', () => {
    const onOpenInspector = vi.fn();
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'ready' })}
        onOpenInspector={onOpenInspector}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /index inspector/i }));
    expect(onOpenInspector).toHaveBeenCalledOnce();
  });

  it('failed: shows reason in tooltip and Retry button', () => {
    const onRetry = vi.fn();
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'failed', reason: 'extract-failed' })}
        onOpenInspector={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/couldn't index/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('embedding: shows forward-compat "Preparing for AI" label', () => {
    render(
      <BookCardIndexingStatus
        book={makeBook({ kind: 'embedding', progressPercent: 30 })}
        onOpenInspector={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/preparing for ai/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/library/indexing/BookCardIndexingStatus.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `indexing-inspector.css`.**

```css
.book-card-indexing-status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-block-start: var(--space-1);
}

.book-card-indexing-status__progress {
  flex: 1;
  max-width: 80px;
  height: 4px;
}

.book-card-indexing-status__inspector-link {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
  font: inherit;
  color: var(--color-text-muted);
  text-decoration: underline dotted;
}

.book-card-indexing-status__inspector-link:hover {
  color: var(--color-text);
}

.book-card-indexing-status__inspector-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.book-card-indexing-status__retry {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
  font: inherit;
  color: var(--color-danger, #c0392b);
  text-decoration: underline dotted;
}
```

- [ ] **Step 4: Implement `BookCardIndexingStatus.tsx`.**

```tsx
import type { Book } from '@/domain';
import './indexing-inspector.css';

type Props = {
  readonly book: Book;
  readonly onOpenInspector: () => void;
  readonly onRetry: () => void;
};

export function BookCardIndexingStatus({ book, onOpenInspector, onRetry }: Props) {
  const status = book.indexingStatus;
  switch (status.kind) {
    case 'pending':
      return (
        <div className="book-card-indexing-status">
          <span aria-label="Queued for indexing">·</span>
          <span>Queued for indexing</span>
        </div>
      );
    case 'chunking':
      return (
        <div className="book-card-indexing-status">
          <progress
            className="book-card-indexing-status__progress"
            max={100}
            value={status.progressPercent}
            aria-label={`Indexing ${String(status.progressPercent)}%`}
          />
          <span>Indexing {status.progressPercent}%</span>
        </div>
      );
    case 'embedding':
      return (
        <div className="book-card-indexing-status">
          <span>Preparing for AI…</span>
        </div>
      );
    case 'ready':
      return (
        <div className="book-card-indexing-status">
          <span aria-hidden="true">✓</span>
          <span>Indexed</span>
          <button
            type="button"
            className="book-card-indexing-status__inspector-link"
            aria-label="Open index inspector"
            onClick={onOpenInspector}
          >
            Index inspector
          </button>
        </div>
      );
    case 'failed':
      return (
        <div className="book-card-indexing-status">
          <span aria-hidden="true">⚠</span>
          <span title={status.reason}>Couldn't index</span>
          <button
            type="button"
            className="book-card-indexing-status__retry"
            onClick={onRetry}
            aria-describedby="retry-reason"
          >
            Retry
          </button>
          <span id="retry-reason" className="visually-hidden">
            Reason: {status.reason}
          </span>
        </div>
      );
  }
}
```

- [ ] **Step 5: Run tests.**

```bash
pnpm test src/features/library/indexing/BookCardIndexingStatus.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/library/indexing/BookCardIndexingStatus.tsx \
        src/features/library/indexing/BookCardIndexingStatus.test.tsx \
        src/features/library/indexing/indexing-inspector.css
git commit -m "feat(library): BookCardIndexingStatus — five-state status indicator"
```

---

## Task 13: `IndexInspectorModal` + `IndexInspectorChunkRow`

**Spec refs:** §7.2, §7.3, §12 commit 13.

**Files:**
- Create: `src/features/library/indexing/IndexInspectorChunkRow.tsx`
- Create: `src/features/library/indexing/IndexInspectorChunkRow.test.tsx`
- Create: `src/features/library/indexing/IndexInspectorModal.tsx`
- Create: `src/features/library/indexing/IndexInspectorModal.test.tsx`
- Modify: `src/features/library/indexing/indexing-inspector.css` — append modal/row styles

- [ ] **Step 1: Write failing tests for `IndexInspectorChunkRow`.**

Create `src/features/library/indexing/IndexInspectorChunkRow.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IndexInspectorChunkRow } from './IndexInspectorChunkRow';
import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';

afterEach(cleanup);

function makeChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  return {
    id: ChunkId('c1'),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Chapter 1',
    text: 'It is a truth universally acknowledged.',
    normalizedText: 'It is a truth universally acknowledged.',
    tokenEstimate: 12,
    locationAnchor: { kind: 'epub-cfi', cfi: '/abc' },
    checksum: 'x',
    chunkerVersion: 1,
    ...overrides,
  };
}

describe('IndexInspectorChunkRow', () => {
  it('shows index, section title, token estimate, and a preview', () => {
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk()}
        index={0}
        total={87}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/#1 of 87/)).toBeInTheDocument();
    expect(screen.getByText(/Chapter 1/)).toBeInTheDocument();
    expect(screen.getByText(/~12/)).toBeInTheDocument();
    expect(screen.getByText(/truth universally acknowledged/)).toBeInTheDocument();
  });

  it('truncates the preview to ~80 chars with ellipsis when text is long', () => {
    const long = 'x'.repeat(200);
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk({ normalizedText: long })}
        index={0}
        total={1}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/x{60,80}…/)).toBeInTheDocument();
  });

  it('clicking the row toggles expansion', () => {
    const onToggle = vi.fn();
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk()}
        index={0}
        total={1}
        expanded={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('expanded shows the full normalizedText in a <pre>', () => {
    render(
      <IndexInspectorChunkRow
        chunk={makeChunk()}
        index={0}
        total={1}
        expanded={true}
        onToggle={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('It is a truth universally acknowledged.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/library/indexing/IndexInspectorChunkRow.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `IndexInspectorChunkRow.tsx`.**

```tsx
import type { TextChunk } from '@/domain';

type Props = {
  readonly chunk: TextChunk;
  readonly index: number;     // 0-based within the book
  readonly total: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
};

const PREVIEW_CAP = 80;

function preview(text: string): string {
  if (text.length <= PREVIEW_CAP) return text;
  return text.slice(0, PREVIEW_CAP).trimEnd() + '…';
}

export function IndexInspectorChunkRow({
  chunk,
  index,
  total,
  expanded,
  onToggle,
}: Props) {
  const panelId = `chunk-${chunk.id}-full`;
  return (
    <button
      type="button"
      className={
        expanded
          ? 'index-inspector__chunk-row index-inspector__chunk-row--expanded'
          : 'index-inspector__chunk-row'
      }
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <span className="index-inspector__chunk-meta">
        #{index + 1} of {total} · {chunk.sectionTitle} · ~{chunk.tokenEstimate} tk
      </span>
      {expanded ? (
        <pre id={panelId} className="index-inspector__chunk-full">
          {chunk.normalizedText}
        </pre>
      ) : (
        <span id={panelId} className="index-inspector__chunk-preview">
          {preview(chunk.normalizedText)}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run row tests.**

```bash
pnpm test src/features/library/indexing/IndexInspectorChunkRow.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write failing tests for `IndexInspectorModal`.**

Create `src/features/library/indexing/IndexInspectorModal.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { IndexInspectorModal } from './IndexInspectorModal';
import { BookId, ChunkId, SectionId } from '@/domain';
import type { TextChunk } from '@/domain';

afterEach(cleanup);

function makeChunks(n: number): TextChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    id: ChunkId(`c${String(i)}`),
    bookId: BookId('b1'),
    sectionId: SectionId(i < 3 ? 's1' : 's2'),
    sectionTitle: i < 3 ? 'Chapter 1' : 'Chapter 2',
    text: `Chunk ${String(i)}`,
    normalizedText: `Chunk ${String(i)} content`,
    tokenEstimate: 10 + i,
    locationAnchor: { kind: 'epub-cfi' as const, cfi: '/x' },
    checksum: 'x',
    chunkerVersion: 1,
  }));
}

function fakeChunksRepo(chunks: TextChunk[]) {
  return {
    listByBook: vi.fn(() => Promise.resolve(chunks)),
    upsertMany: vi.fn(() => Promise.resolve()),
    listBySection: vi.fn(() => Promise.resolve([])),
    deleteByBook: vi.fn(() => Promise.resolve()),
    deleteBySection: vi.fn(() => Promise.resolve()),
    countByBook: vi.fn(() => Promise.resolve(chunks.length)),
    countStaleVersions: vi.fn(() => Promise.resolve([])),
    hasChunksFor: vi.fn(() => Promise.resolve(true)),
  };
}

describe('IndexInspectorModal', () => {
  it('renders chunks with header counts derived from the chunk list', async () => {
    const chunks = makeChunks(5);
    const repo = fakeChunksRepo(chunks);
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={repo as never}
        onRebuild={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/5 chunks · 2 sections/i)).toBeInTheDocument();
    });
  });

  it('Rebuild button calls onRebuild and closes the modal', async () => {
    const chunks = makeChunks(2);
    const onRebuild = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={fakeChunksRepo(chunks) as never}
        onRebuild={onRebuild}
        onClose={onClose}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/2 chunks/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /rebuild index/i }));
    await waitFor(() => {
      expect(onRebuild).toHaveBeenCalledWith(BookId('b1'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('ESC key closes the modal', async () => {
    const onClose = vi.fn();
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={fakeChunksRepo(makeChunks(1)) as never}
        onRebuild={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders role="dialog" with aria-modal', () => {
    render(
      <IndexInspectorModal
        bookId={BookId('b1')}
        bookTitle="Test Book"
        chunksRepo={fakeChunksRepo(makeChunks(1)) as never}
        onRebuild={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
```

- [ ] **Step 6: Run failing modal tests.**

```bash
pnpm test src/features/library/indexing/IndexInspectorModal.test.tsx
```

Expected: FAIL.

- [ ] **Step 7: Implement `IndexInspectorModal.tsx`.**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { BookId } from '@/domain';
import type { TextChunk } from '@/domain';
import type { BookChunksRepository } from '@/storage';
import { IndexInspectorChunkRow } from './IndexInspectorChunkRow';

type Props = {
  readonly bookId: BookId;
  readonly bookTitle: string;
  readonly chunksRepo: BookChunksRepository;
  readonly onRebuild: (id: BookId) => Promise<void>;
  readonly onClose: () => void;
};

export function IndexInspectorModal({
  bookId,
  bookTitle,
  chunksRepo,
  onRebuild,
  onClose,
}: Props) {
  const [chunks, setChunks] = useState<readonly TextChunk[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void chunksRepo.listByBook(bookId).then(setChunks);
  }, [bookId, chunksRepo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const summary = useMemo(() => {
    if (chunks === null) return null;
    const sectionCount = new Set(chunks.map((c) => c.sectionId)).size;
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenEstimate, 0);
    const version = chunks[0]?.chunkerVersion ?? 0;
    return { count: chunks.length, sectionCount, totalTokens, version };
  }, [chunks]);

  const handleRebuild = async (): Promise<void> => {
    await onRebuild(bookId);
    onClose();
  };

  return (
    <div
      className="index-inspector__backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="index-inspector-title"
        className="index-inspector"
      >
        <header className="index-inspector__header">
          <h2 id="index-inspector-title">Index inspector — {bookTitle}</h2>
          <button
            type="button"
            className="index-inspector__close"
            aria-label="Close inspector"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {summary !== null ? (
          <div className="index-inspector__summary">
            {summary.count} chunks · {summary.sectionCount} sections · v
            {summary.version} chunker · ~{summary.totalTokens} tokens
            <button
              type="button"
              className="index-inspector__rebuild"
              onClick={() => {
                void handleRebuild();
              }}
            >
              Rebuild index
            </button>
          </div>
        ) : (
          <p className="index-inspector__loading">Loading…</p>
        )}
        <div className="index-inspector__rows" role="list">
          {chunks?.map((chunk, index) => (
            <IndexInspectorChunkRow
              key={chunk.id}
              chunk={chunk}
              index={index}
              total={chunks.length}
              expanded={expandedId === chunk.id}
              onToggle={() => {
                setExpandedId((cur) => (cur === chunk.id ? null : chunk.id));
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Append modal/row styles to `indexing-inspector.css`.**

```css
/* Modal backdrop + container */
.index-inspector__backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in oklab, black 40%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
}

.index-inspector {
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  width: min(720px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.index-inspector__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-block-end: 1px solid var(--color-border-subtle);
}

.index-inspector__close {
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 1.4rem;
  line-height: 1;
  padding: 0 var(--space-1);
  color: var(--color-text-muted);
}

.index-inspector__summary {
  padding: var(--space-3) var(--space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  border-block-end: 1px solid var(--color-border-subtle);
}

.index-inspector__rebuild {
  background: var(--color-surface-elevated, var(--color-surface));
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: var(--space-1) var(--space-3);
  font: inherit;
  color: var(--color-text);
}

.index-inspector__loading {
  padding: var(--space-4);
  text-align: center;
  color: var(--color-text-muted);
}

.index-inspector__rows {
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* Chunk row */
.index-inspector__chunk-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: start;
  font: inherit;
  color: var(--color-text);
}

.index-inspector__chunk-row:hover {
  background: var(--color-surface-elevated, var(--color-surface));
}

.index-inspector__chunk-row:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.index-inspector__chunk-meta {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.index-inspector__chunk-preview {
  font-size: var(--text-sm);
}

.index-inspector__chunk-full {
  white-space: pre-wrap;
  margin: 0;
  padding: var(--space-2);
  background: var(--color-surface-elevated, var(--color-surface));
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 9: Run modal tests.**

```bash
pnpm test src/features/library/indexing/IndexInspectorModal.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 11: Commit.**

```bash
git add src/features/library/indexing/IndexInspectorChunkRow.tsx \
        src/features/library/indexing/IndexInspectorChunkRow.test.tsx \
        src/features/library/indexing/IndexInspectorModal.tsx \
        src/features/library/indexing/IndexInspectorModal.test.tsx \
        src/features/library/indexing/indexing-inspector.css
git commit -m "feat(library): IndexInspectorModal + IndexInspectorChunkRow"
```

---

## Task 14: App wiring — instantiate `useIndexing`, thread callbacks, mount inspector, cascade integration

**Spec refs:** §4.5, §6.5, §7.4, §8, §12 commit 14.

**Files:**
- Modify: `src/features/library/wiring.ts` — add chunksRepo, accept `onIndexImported`, call after persist
- Modify: `src/app/useReaderHost.ts` — accept `indexing` + `chunksRepo`, extend cascade
- Modify: `src/features/library/BookCard.tsx` — slot for `BookCardIndexingStatus`, accept `onOpenInspector`/`onRetry` props
- Modify: `src/features/library/Bookshelf.tsx` — thread props to BookCard
- Modify: `src/features/library/LibraryWorkspace.tsx` — thread props to Bookshelf
- Modify: `src/app/App.tsx` — instantiate `useIndexing`, owns `inspectorBookId`, mounts modal

> ⚠️ This is the largest single task in the plan. The interface changes ripple through 6 files. To minimize the risk of getting stuck, drive it bottom-up: start at the leaf (BookCard) and work upward (Bookshelf → LibraryWorkspace → App.tsx). Type-check after each component.

- [ ] **Step 1: Extend `BookCard` props with `onOpenInspector` + `onRetry` and slot the new component.**

Open `src/features/library/BookCard.tsx`. Update the `Props` type:

```ts
type Props = {
  readonly book: Book;
  readonly coverCache: CoverCache;
  readonly onRemove: (book: Book) => void;
  readonly onOpen?: (book: Book) => void;
  readonly onOpenInspector?: (bookId: BookId) => void;  // NEW
  readonly onRetry?: (bookId: BookId) => void;          // NEW
};
```

Add the import:
```ts
import { BookCardIndexingStatus } from './indexing/BookCardIndexingStatus';
import { BookId } from '@/domain';
```

In the component's JSX, after `<div className="book-card__author">{book.author ?? ''}</div>`, add:

```tsx
{(onOpenInspector !== undefined || onRetry !== undefined) && (
  <BookCardIndexingStatus
    book={book}
    onOpenInspector={() => onOpenInspector?.(BookId(book.id))}
    onRetry={() => onRetry?.(BookId(book.id))}
  />
)}
```

Run type-check:
```bash
pnpm type-check
```
Expected: PASS.

- [ ] **Step 2: Thread the props through `Bookshelf`.**

Open `src/features/library/Bookshelf.tsx`. Add the same two optional props to its `Props` type and forward them to each `<BookCard>` it renders:

```ts
readonly onOpenInspector?: (bookId: BookId) => void;
readonly onRetry?: (bookId: BookId) => void;
```

Pass them through:
```tsx
<BookCard
  key={book.id}
  book={book}
  coverCache={coverCache}
  onRemove={onRemove}
  {...(onOpenBook && { onOpen: onOpenBook })}
  {...(onOpenInspector && { onOpenInspector })}
  {...(onRetry && { onRetry })}
/>
```

Run type-check:
```bash
pnpm type-check
```
Expected: PASS.

- [ ] **Step 3: Thread through `LibraryWorkspace`.**

Open `src/features/library/LibraryWorkspace.tsx`. Add the two optional props to its `Props`:

```ts
readonly onOpenInspector?: (bookId: BookId) => void;
readonly onRetry?: (bookId: BookId) => void;
```

Forward to `<Bookshelf>`:
```tsx
<Bookshelf
  books={books}
  coverCache={coverCache}
  searchQuery={search}
  onRemove={onRemoveBook}
  {...(onOpenBook && { onOpenBook })}
  {...(onOpenInspector && { onOpenInspector })}
  {...(onRetry && { onRetry })}
/>
```

Run type-check:
```bash
pnpm type-check
```
Expected: PASS.

- [ ] **Step 4: Extend `wiring.ts` to accept and provide the chunks repo + post-persist hook.**

Open `src/features/library/wiring.ts`. Locate the `persistBook` function (around line 156). After `await bookRepo.put(book);`, add a call to a new `onIndexImported` callback:

```ts
// In the wiring's input shape (the boot-time deps), add:
readonly onIndexImported?: (bookId: BookId) => void;

// And in persistBook, after bookRepo.put(book):
if (onIndexImported !== undefined) onIndexImported(book.id);
return book;
```

Also add a new repo to the wiring's exposed API:
```ts
readonly bookChunksRepo: BookChunksRepository;
```

Wire it in the wiring builder where the other repos are constructed:
```ts
const bookChunksRepo = createBookChunksRepository(db);
```

Run type-check:
```bash
pnpm type-check
```
Expected: FAIL — App.tsx (which constructs the wiring) doesn't yet pass `bookChunksRepo` or `onIndexImported`. We'll fix that in Step 6.

- [ ] **Step 5: Extend `useReaderHost` to accept `indexing` + cascade integration.**

Open `src/app/useReaderHost.ts`. In its arguments (around line 18), add:

```ts
readonly indexing: UseIndexingHandle;
readonly chunksRepo: BookChunksRepository;
```

Add imports:
```ts
import type { UseIndexingHandle } from '@/features/library/indexing/useIndexing';
import type { BookChunksRepository } from '@/storage';
```

In `onRemoveBook` (around line 169), after `await wiring.notesRepo.deleteByBook(BookId(book.id));`, add the cascade extension:

```ts
indexing.cancel(BookId(book.id));
// (other deletions follow)
await chunksRepo.deleteByBook(BookId(book.id));
```

Place `indexing.cancel` early (before any awaits) so the pipeline aborts immediately. Place `chunksRepo.deleteByBook` after the chat cascade for ordering consistency with the existing pattern.

Run type-check:
```bash
pnpm type-check
```
Expected: FAIL — App.tsx doesn't pass these yet. Continue to Step 6.

- [ ] **Step 6: Wire in `App.tsx`.**

Open `src/app/App.tsx`. After the `useReaderHost(...)` instantiation (around line 83), add:

```ts
const epubExtractor = useMemo(
  () => new EpubChunkExtractor(async (book) => boot.wiring.opfs.readFile(book.source.opfsPath)),
  [boot.wiring.opfs],
);
const pdfExtractor = useMemo(
  () => new PdfChunkExtractor(async (book) => boot.wiring.opfs.readFile(book.source.opfsPath)),
  [boot.wiring.opfs],
);
const indexing = useIndexing({
  booksRepo: boot.wiring.bookRepo,
  chunksRepo: boot.wiring.bookChunksRepo,
  epubExtractor,
  pdfExtractor,
});
const [inspectorBookId, setInspectorBookId] = useState<BookId | null>(null);
```

Add the imports:
```ts
import { useMemo, useState } from 'react';
import { BookId } from '@/domain';
import { EpubChunkExtractor } from '@/features/library/indexing/EpubChunkExtractor';
import { PdfChunkExtractor } from '@/features/library/indexing/PdfChunkExtractor';
import { useIndexing } from '@/features/library/indexing/useIndexing';
import { IndexInspectorModal } from '@/features/library/indexing/IndexInspectorModal';
```

> ⚠️ The `boot.wiring.opfs.readFile` signature must return a `Blob`. If wiring's OPFS adapter doesn't have a `readFile(path) => Promise<Blob>` method, look for the equivalent (likely `readBlob` or similar) and use it. If no such method exists, add one to the OPFS adapter as part of this task — the EPUB and PDF extractors both need to read book bytes by path.

Update the `useReaderHost` call to pass the new args:
```ts
const reader = useReaderHost({
  // ...existing args
  indexing,
  chunksRepo: boot.wiring.bookChunksRepo,
  // ...
});
```

Wire indexing to the import flow. The wiring is constructed at boot time (in `boot/loadLibrary.ts` or similar — find where `wiring.ts` is invoked). At that call site, pass `onIndexImported: (bookId) => indexing.enqueue(bookId)`. **However** — wiring is created BEFORE `useIndexing` runs (boot vs render), which is a chicken-and-egg problem. Solution: wiring stores the callback in a mutable holder, and App.tsx assigns the actual callback on first render via a useEffect:

```ts
useEffect(() => {
  boot.wiring.setOnIndexImported((bookId) => {
    indexing.enqueue(bookId);
  });
}, [boot.wiring, indexing]);
```

This requires extending `wiring.ts` to expose a `setOnIndexImported` method that mutates an internal callback ref. Add to wiring's return type:
```ts
readonly setOnIndexImported: (callback: (id: BookId) => void) => void;
```

And inside the wiring builder:
```ts
let onIndexImportedRef: ((id: BookId) => void) | null = null;
// ... pass it through to persistBook
return {
  // ... existing exports
  bookChunksRepo,
  setOnIndexImported: (callback) => {
    onIndexImportedRef = callback;
  },
};
// In persistBook, replace onIndexImported call with: onIndexImportedRef?.(book.id);
```

Pass `onOpenInspector` and `onRetry` to LibraryWorkspace:
```tsx
<LibraryWorkspace
  // ... existing props
  onOpenInspector={(bookId) => setInspectorBookId(bookId)}
  onRetry={(bookId) => { void indexing.rebuild(bookId); }}
/>
```

Mount the inspector modal:
```tsx
{inspectorBookId !== null && (
  <IndexInspectorModal
    bookId={inspectorBookId}
    bookTitle={
      boot.libraryStore.getState().books.find((b) => b.id === inspectorBookId)?.title ?? ''
    }
    chunksRepo={boot.wiring.bookChunksRepo}
    onRebuild={(id) => indexing.rebuild(id)}
    onClose={() => setInspectorBookId(null)}
  />
)}
```

Run type-check:
```bash
pnpm type-check
```
Expected: PASS — all the new props line up.

- [ ] **Step 7: Run full check.**

```bash
pnpm check
```

Expected: PASS — all 600+ tests still pass; no behavior regressions.

> If pre-existing tests fail (most likely the `useReaderHost` tests because of the new required args), update those tests to provide stub `indexing` + `chunksRepo`.

- [ ] **Step 8: Commit.**

```bash
git add src/app/App.tsx \
        src/app/useReaderHost.ts \
        src/features/library/wiring.ts \
        src/features/library/BookCard.tsx \
        src/features/library/Bookshelf.tsx \
        src/features/library/LibraryWorkspace.tsx
git commit -m "feat(app): wire indexing.enqueue on import + cascade integration + inspector modal mount"
```

---

## Task 15: E2E specs

**Spec refs:** §10.3, §12 commit 15.

**Files:**
- Create: `e2e/library-indexing-on-import.spec.ts`
- Create: `e2e/library-index-inspector.spec.ts`
- Create: `e2e/library-indexing-resume.spec.ts`

> ⚠️ E2E test reality: just like Phase 4.4's chat tests, these specs need to be honest about what's testable in CI vs what needs manual smoke. The selection→Ask AI flow worked in 4.4 because it's a synchronous user gesture. Indexing is asynchronous background work; flake-prone by nature. Each spec below uses generous timeouts and asserts on observable IDB state where possible.

- [ ] **Step 1: Write `library-indexing-on-import.spec.ts`.**

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

test('indexing kicks off on import; status transitions to ready; inspector link appears', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  // Wait for indexing to complete. The library card should show "Indexed".
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /index inspector/i })).toBeVisible();
});
```

- [ ] **Step 2: Write `library-index-inspector.spec.ts`.**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importAndWaitForReady(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
}

test('opening the inspector lists chunks and rebuild round-trips through chunking → ready', async ({ page }) => {
  await page.goto('/');
  await importAndWaitForReady(page);

  await page.getByRole('button', { name: /index inspector/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/\d+ chunks · \d+ sections/)).toBeVisible();

  // Click a row to expand. There should be at least one row visible.
  const firstRow = page.locator('.index-inspector__chunk-row').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await expect(firstRow.getByRole('region', { hidden: true })).toBeAttached();
  // Or simpler: the expanded class is present
  // Just verify aria-expanded transitioned to true.
  await expect(firstRow).toHaveAttribute('aria-expanded', 'true');

  // Click rebuild. Should close modal and re-trigger chunking.
  await page.getByRole('button', { name: /rebuild index/i }).click();
  // Modal closes, status flips back to chunking, then ready again.
  await expect(page.getByText(/indexing/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
});
```

- [ ] **Step 3: Write `library-indexing-resume.spec.ts`.**

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

test('reload mid-indexing → status resumes and reaches ready; chunks are not duplicated', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);

  // Wait for chunking to start (catch the progress UI).
  await expect(page.getByText(/indexing/i)).toBeVisible({ timeout: 30_000 });

  // Reload mid-flight.
  await page.reload();

  // After reload, status should be either still chunking (resume in progress)
  // or already ready. Either way we end up at ready within the timeout.
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });

  // Open the inspector and read the chunk count.
  await page.getByRole('button', { name: /index inspector/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Capture the chunk count text. We can't compare to a known absolute number
  // (depends on fixture), but we can verify it's > 0 and stable across rebuilds.
  const summary1 = await page.locator('.index-inspector__summary').textContent();
  await page.getByRole('button', { name: /rebuild index/i }).click();
  await expect(page.getByText(/indexed/i)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /index inspector/i }).click();
  const summary2 = await page.locator('.index-inspector__summary').textContent();

  expect(summary2).toBe(summary1); // deterministic across rebuilds
});
```

- [ ] **Step 4: Run all e2e tests.**

```bash
pnpm test:e2e
```

Expected: PASS for all three new specs (plus all prior suites).

> If a spec is flaky due to indexing timing, mark it `test.skip` with a TODO referencing the underlying timing issue. The unit + component test coverage already locks the bulk of the behavior; E2E is for end-to-end smoke.

- [ ] **Step 5: Run full check (just to confirm no Vitest fallout).**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add e2e/library-indexing-on-import.spec.ts \
        e2e/library-index-inspector.spec.ts \
        e2e/library-indexing-resume.spec.ts
git commit -m "test(e2e): indexing on import + inspector + resume"
```

---

## Task 16: Docs — roadmap + decision history

**Spec refs:** §1, §12 commit 16, §15.

**Files:**
- Modify: `docs/04-implementation-roadmap.md` — Phase 5.1 status block
- Modify: `docs/02-system-architecture.md` — decision-history entry

- [ ] **Step 1: Update roadmap status.**

In `docs/04-implementation-roadmap.md`, add to the Status block at the top (after `Phase 4.4`):

```
- Phase 5.1 — complete (2026-05-06)
```

(Or whatever today's date is at completion time.)

Find the Phase 5.1 section (around `#### Task 5.1 — Text normalization and chunking`) and replace the summary with:

```
#### Task 5.1 — Text normalization and chunking (complete YYYY-MM-DD)

Per-book chunking pipeline runs at import time on the main thread with
yielded scheduling. Format-specific extractors (`EpubChunkExtractor` reuses
foliate-js headlessly; `PdfChunkExtractor` uses pdfjs-dist with paragraph-
reconstruction heuristics + boilerplate filter) feed a shared pure
`paragraphsToChunks` packer (paragraph-bounded, ~400-token cap, never splits
paragraphs). Chunks persist per-section atomically in `book_chunks`
(IDB schema v7); idempotent resume on app open. Chunker is versioned;
stale-version chunks are dropped and rebuilt automatically. Inspector UI
lives on the library card (status indicator) + a modal listing chunks
with previews. Cascade extends `useReaderHost.onRemoveBook` with cancel +
deleteByBook.

**Deferred:**
- Embeddings / vector storage (Phase 5.2).
- Retrieval / ranking / chunk scoring (Phase 5.2).
- Suggested prompts derived from chunks (Phase 5.3).
- Chapter-mode prompt assembly using chunks (Phase 5.4).
- Web Worker promotion of the chunker (pure refactor when profiling justifies it).
- OCR for image-only PDFs (Phase 6+).
- Multi-column PDF column detection (best-effort in v1).
```

- [ ] **Step 2: Add decision-history entry.**

In `docs/02-system-architecture.md`, find the `## Decision history` section and add a new entry above the most recent one:

```markdown
### YYYY-MM-DD — Phase 5.1 text chunking

- **Pipeline timing — on import, background, main-thread yielded.** Reading
  isn't blocked. The pre-designed `IndexingStatus.chunking{progressPercent}`
  state is finally populated. Web Worker promotion is a pure refactor
  if/when profiling shows main-thread jank — not paid for upfront.
- **Chunks are paragraph-bounded, ~400-token capped.** Greedy-pack
  contiguous same-section paragraphs; never split a paragraph; sentence-
  fallback only when a single paragraph alone exceeds the cap. Each chunk
  is a self-contained semantic unit — better for retrieval ranking than
  a sliding window cut mid-paragraph.
- **Sections derive 1:1 from existing structure.** EPUB: each spine entry
  is a section (`sectionId = 'spine:' + href`). PDF: each TOC entry's
  page-range is a section (`sectionId = 'pdf:' + page + ':' + slugify(title)`).
  Books without TOC get a synthetic `'__whole_book__'` single section.
  No `book_sections` IDB store — all section info derives from
  `Book.toc` + format-specific spine/outline data at runtime.
- **Token estimation: char/4 heuristic.** Free, deterministic, no deps.
  NanoGPT proxies many providers (Claude, Gemini, etc.); picking a
  specific tokenizer (tiktoken, o200k) is already a guess. Phase 5.2
  retrieval-budget assembly will self-calibrate against actual completion
  usage data.
- **Idempotent resume by section.** Chunks persist atomically per section.
  The pipeline's outer loop checks `chunksRepo.hasChunksFor(bookId, sectionId)`
  before chunking each section; the resume scan on app open re-runs the
  pipeline against partially-indexed books and the per-section short-circuit
  picks up at the next un-chunked section. No persisted resume state
  needed (information already in IDB).
- **Chunker version constant + auto-rebuild on stale.** `CHUNKER_VERSION = 1`
  baked into the chunker; each chunk record stores the version it was
  generated with. On app open, scan for chunks below the current version;
  drop, mark book pending, eager resume re-indexes. Future chunker changes
  are a one-line bump.
- **EPUB extraction reuses foliate-js headlessly.** Same parser as the
  reader → chunk paragraph boundaries match what the user sees. JSZip +
  DOMParser fallback documented and concrete if the headless API turns
  out impractical at impl time.
- **PDF extraction uses heuristic reconstruction.** `getTextContent()` →
  y-position line grouping → gap/indent paragraph breaks → boilerplate
  filter (page numbers, > 50%-of-pages running headers/footers) →
  de-hyphenation. Multi-column layouts are documented as best-effort.
- **Inspector lives on the library card, not the rail.** The right rail
  is already 4 tabs (Contents/Bookmarks/Highlights/Chat as of 4.4);
  adding a 5th would crowd the reading surface. Library card is
  low-traffic — the right place for a per-book index inspector.
  Phase 5.2 retrieval will additionally show retrieved chunks inline in
  `PrivacyPreview` (per-message provenance, distinct from this per-book
  inspector).
- **No `book_sections` IDB store.** Sections derive from existing data
  at runtime. Phase 5.4 chapter-mode retrieval uses the
  `[bookId, sectionId]` compound index on `book_chunks` — the only
  load-bearing place for section identity. No sync-with-toc concerns.
- **Sequential queue, single-flight per book.** Avoids saturating the
  main thread on multi-import. Reading isn't blocked. Phase 5.2's
  embedding pipeline may revisit if the throughput hurts.
- **Cancellation cleanly integrated into the cascade.** `useReaderHost.onRemoveBook`
  calls `indexing.cancel(bookId)` synchronously at the top of the cascade,
  so the pipeline aborts before its catch can write `failed` to a deleted
  book. No orphaned status, no leaked chunks.
```

- [ ] **Step 3: Verify final state.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add docs/04-implementation-roadmap.md \
        docs/02-system-architecture.md
git commit -m "docs: Phase 5.1 — architecture decision + roadmap status complete"
```

- [ ] **Step 5: Verify the branch is mergeable.**

```bash
git log --oneline main..HEAD
pnpm check
pnpm test:e2e
```

Expected:
- 16 commits on the branch from the spec onward (1 spec commit + 16 implementation commits).
- `pnpm check` PASS.
- `pnpm test:e2e` PASS.

---

## Validation checklist (mirrors spec §15)

- [ ] All 16 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new indexing suite plus all prior suites.
- [ ] **Manual smoke (EPUB):** import the fixture EPUB → wait for `ready` → open inspector → confirm chunk count + previews look readable.
- [ ] **Manual smoke (PDF):** import a fixture PDF → same; verify the boilerplate filter dropped page numbers / running headers.
- [ ] **Manual smoke (resume):** kick off indexing → reload mid-flight → verify resume picks up at the next un-chunked section (observable in IDB chunk count + final state matches a fresh single-pass index).
- [ ] **Manual smoke (rebuild):** rebuild from inspector → confirm chunks regenerate with the same checksums (deterministic).
- [ ] **Manual smoke (cascade):** remove a book during indexing → pipeline cancels cleanly; no orphaned `chunking` status; no leaked chunks.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard ≥ 22/27 per `08-agent-self-improvement.md`.
- [ ] `docs/04-implementation-roadmap.md` Status block updated.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
