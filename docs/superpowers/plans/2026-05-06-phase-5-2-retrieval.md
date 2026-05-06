# Phase 5.2 — Retrieval Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship retrieval mode end-to-end — eager embeddings during indexing, hybrid BM25+cosine retrieval via RRF, token-budgeted evidence bundles, and a "Search this book" chat-mode UI with multi-source provenance.

**Architecture:** Embeddings extend Phase 5.1's `runIndexing` pipeline (`chunking{n} → embedding{n} → ready`); vectors live in a new `book_embeddings` IDB store keyed by `ChunkId` (schema v7 → v8). Retrieval runs send-time when an `attachedRetrieval` chip is present: question is embedded via NanoGPT, BM25 + cosine rank chunks in parallel, Reciprocal Rank Fusion combines them, then `assembleEvidenceBundle` token-budgets and section-groups the survivors into a numbered citation bundle that `assembleRetrievalChatPrompt` ships to the chat completion endpoint. The assistant message persists `contextRefs` of `{kind: 'chunk', chunkId}` in citation order so `MessageBubble` and `NotebookRow` can render multi-source jump UIs.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`, `noImplicitAny`, `noUncheckedIndexedAccess`); React 19; Zustand; XState; idb 8; pdfjs-dist 5; foliate-js 1; Vitest + happy-dom + fake-indexeddb; Playwright. NanoGPT proxy at `https://nano-gpt.com/api/v1` with `text-embedding-3-small` (1536 dims).

**Spec:** `docs/superpowers/specs/2026-05-06-phase-5-2-retrieval-design.md` (approved 2026-05-06).

**Quality gate:** `pnpm check` (typecheck + lint + format + unit tests) clean per commit. `pnpm test:e2e` runs before the docs commit.

---

## Pre-flight

Before Task 1, verify:

```bash
git status               # clean working tree on `phase-5-2-retrieval`
git log --oneline -5     # confirm a731737 spec commit is present
pnpm check               # baseline: should pass
```

If any baseline fails, stop and investigate. Do NOT proceed.

---

## Task 1: Domain — `BookEmbedding` type

**Files:**
- Modify: `src/domain/ai/types.ts`
- Modify: `src/domain/index.ts` (re-export)

**Goal:** Add the `BookEmbedding` record type alongside `TextChunk` so storage and pipeline layers can import it without circular deps.

- [ ] **Step 1: Locate the existing `TextChunk` type**

Run: `grep -n "export type TextChunk" src/domain/ai/types.ts src/domain/index.ts`

Expected: One match showing the canonical declaration. Note its location for adjacency.

- [ ] **Step 2: Add `BookEmbedding` next to `TextChunk`**

Open `src/domain/ai/types.ts` and add this declaration immediately after the `TextChunk` block (do not duplicate imports — `BookId`, `ChunkId`, `IsoTimestamp` should already be imported in this file; if any are missing, add them):

```typescript
// Phase 5.2: a single-chunk vector embedding. id mirrors the chunk's id so
// the two stores stay 1:1; chunkerVersion + embeddingModelVersion let us
// invalidate independently (chunker bump → chunks rebuild → embeddings
// cascade-invalidate; model bump → embeddings drop, chunks untouched).
export type BookEmbedding = {
  readonly id: ChunkId;
  readonly bookId: BookId;
  readonly vector: Float32Array;
  readonly chunkerVersion: number;
  readonly embeddingModelVersion: number;
  readonly embeddedAt: IsoTimestamp;
};
```

- [ ] **Step 3: Re-export from the domain barrel**

Open `src/domain/index.ts` and add `BookEmbedding` to the existing export list from `./ai/types` (find the existing `TextChunk` re-export and append `BookEmbedding` next to it).

- [ ] **Step 4: Verify**

```bash
pnpm check
```

Expected: PASS. Type is unused so far; should compile cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ai/types.ts src/domain/index.ts
git commit -m "$(cat <<'EOF'
feat(domain): chunks — add BookEmbedding type

Adds the BookEmbedding record (id, bookId, vector, chunker/model versions,
embeddedAt) alongside TextChunk in src/domain/ai/types.ts. Two-version
field set keeps chunk lifecycle and embedding lifecycle independent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Storage — v7 → v8 migration adds `book_embeddings` store

**Files:**
- Modify: `src/storage/db/schema.ts:16` (bump `CURRENT_DB_VERSION`), `:122-129` (add interface entry), `:142` (add store-name constant)
- Modify: `src/storage/db/migrations.ts:14` (add `'book_embeddings'` to StoreName), `:93` (add migration `7`)
- Test: `src/storage/db/__tests__/migrations.test.ts` (or wherever the existing migration test lives — grep first)

**Goal:** Additive schema change so reading `BookEmbedding` records by-id (primary key = `ChunkId`) and listing by-book is supported.

- [ ] **Step 1: Locate existing migration tests**

Run: `find src/storage -name "*migration*" -o -name "*open*test*"` then `grep -rn "openBookwormDB\|CURRENT_DB_VERSION" src/storage/`

Note the test file path for Step 5.

- [ ] **Step 2: Write the failing test**

In the migration test file (or create `src/storage/db/migrations.test.ts` if none), add:

```typescript
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { openBookwormDB } from './open';
import { BOOK_EMBEDDINGS_STORE, CURRENT_DB_VERSION } from './schema';

describe('Phase 5.2 — v8 migration (book_embeddings)', () => {
  it('CURRENT_DB_VERSION is 8', () => {
    expect(CURRENT_DB_VERSION).toBe(8);
  });

  it('opens fresh DB and creates book_embeddings store with by-book index', async () => {
    // Use a unique DB name so this test doesn't collide with parallel tests.
    const dbName = `bookworm-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    const db = await openBookwormDB(dbName);
    try {
      expect(db.objectStoreNames.contains(BOOK_EMBEDDINGS_STORE)).toBe(true);
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      expect(tx.store.indexNames.contains('by-book')).toBe(true);
    } finally {
      db.close();
    }
  });
});
```

If `openBookwormDB` does not currently accept a `dbName` arg, skip the second test for now (the schema-version test alone is enough to gate the implementation). Re-run after Step 4 — if the second test would have passed without the optional arg (i.e. it uses a single shared DB), ensure cleanup deletes between runs. (If unclear: read `src/storage/db/open.ts` and adjust the test to its actual API.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/storage/db/migrations.test.ts`

Expected: FAIL — `CURRENT_DB_VERSION` is `7` (or `BOOK_EMBEDDINGS_STORE` is undefined).

- [ ] **Step 4: Implement schema change**

In `src/storage/db/schema.ts`:

Line 16 — change `7` to `8`:
```typescript
export const CURRENT_DB_VERSION = 8;
```

After line 129 (right after the `book_chunks` interface block), add:
```typescript
  book_embeddings: {
    key: string;
    value: BookEmbedding;
    indexes: {
      'by-book': string;
    };
  };
```

Add `BookEmbedding` to the existing `import type` block at the top of the file (line 2-11). The block currently imports several types from `@/domain` — append `BookEmbedding` to that list:
```typescript
import type {
  Book,
  BookEmbedding,
  Bookmark,
  ChatMessage,
  ChatThread,
  Highlight,
  Note,
  SavedAnswer,
  TextChunk,
} from '@/domain';
```

After line 142 (the last store-name constant), add:
```typescript
export const BOOK_EMBEDDINGS_STORE = 'book_embeddings' as const;
```

In `src/storage/db/migrations.ts`:

Line 14 — append `'book_embeddings'` to the `StoreName` union:
```typescript
type StoreName =
  | 'books'
  | 'settings'
  | 'reading_progress'
  | 'reader_preferences'
  | 'bookmarks'
  | 'highlights'
  | 'notes'
  | 'chat_threads'
  | 'chat_messages'
  | 'saved_answers'
  | 'book_chunks'
  | 'book_embeddings';
```

After line 93 (right before the closing `};` of the migrations map), add migration `7`:
```typescript
  // 7 → 8: Phase 5.2 book embeddings store
  7: ({ db }) => {
    if (!db.objectStoreNames.contains('book_embeddings')) {
      const store = db.createObjectStore('book_embeddings', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
    }
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/storage/db/migrations.test.ts`

Expected: PASS — version is 8, store exists with index.

- [ ] **Step 6: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storage/db/schema.ts src/storage/db/migrations.ts src/storage/db/migrations.test.ts
git commit -m "$(cat <<'EOF'
feat(storage): v8 migration — add book_embeddings store

Bumps CURRENT_DB_VERSION to 8, adds BOOK_EMBEDDINGS_STORE with a by-book
secondary index. Migration 7 is additive (no data backfill); existing
chunked books will populate vectors on next indexing pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `BookEmbeddingsRepository`

**Files:**
- Create: `src/storage/repositories/bookEmbeddings.ts`
- Create: `src/storage/repositories/bookEmbeddings.test.ts`
- Modify: `src/storage/index.ts:44` (add re-export)

**Goal:** Mirror `BookChunksRepository` shape but with two extra methods: `hasEmbeddingFor(chunkId)` for per-chunk idempotent resume and `deleteOrphans(validIds)` for chunker-cascade cleanup.

- [ ] **Step 1: Write the failing test**

Create `src/storage/repositories/bookEmbeddings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openBookwormDB } from '../db/open';
import type { BookwormDB } from '../db/open';
import { createBookEmbeddingsRepository } from './bookEmbeddings';
import {
  BookId,
  ChunkId,
  IsoTimestamp,
  type BookEmbedding,
} from '@/domain';

let db: BookwormDB;

function makeEmbedding(overrides: Partial<BookEmbedding> = {}): BookEmbedding {
  const v = new Float32Array(1536);
  for (let i = 0; i < 1536; i++) v[i] = (i % 7) / 7;
  return {
    id: ChunkId('chunk-b1-s1-0'),
    bookId: BookId('b1'),
    vector: v,
    chunkerVersion: 1,
    embeddingModelVersion: 1,
    embeddedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  const name = `test-be-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  db = await openBookwormDB(name);
});

afterEach(() => {
  db.close();
});

describe('BookEmbeddingsRepository', () => {
  it('upsertMany + listByBook round-trips Float32Array vectors', async () => {
    const repo = createBookEmbeddingsRepository(db);
    const e = makeEmbedding();
    await repo.upsertMany([e]);
    const list = await repo.listByBook(BookId('b1'));
    expect(list).toHaveLength(1);
    expect(list[0]?.vector).toBeInstanceOf(Float32Array);
    expect(list[0]?.vector.length).toBe(1536);
    expect(list[0]?.vector[0]).toBeCloseTo(e.vector[0]!);
    expect(list[0]?.vector[1535]).toBeCloseTo(e.vector[1535]!);
  });

  it('upsertMany on empty array no-ops', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([]);
    expect(await repo.countByBook(BookId('b1'))).toBe(0);
  });

  it('hasEmbeddingFor returns true for present, false for absent', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([makeEmbedding({ id: ChunkId('chunk-b1-s1-0') })]);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-0'))).toBe(true);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-99'))).toBe(false);
  });

  it('countByBook scopes per-book', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({ id: ChunkId('chunk-b1-s1-0'), bookId: BookId('b1') }),
      makeEmbedding({ id: ChunkId('chunk-b1-s1-1'), bookId: BookId('b1') }),
      makeEmbedding({ id: ChunkId('chunk-b2-s1-0'), bookId: BookId('b2') }),
    ]);
    expect(await repo.countByBook(BookId('b1'))).toBe(2);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('deleteByBook removes only that book', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({ id: ChunkId('chunk-b1-s1-0'), bookId: BookId('b1') }),
      makeEmbedding({ id: ChunkId('chunk-b2-s1-0'), bookId: BookId('b2') }),
    ]);
    await repo.deleteByBook(BookId('b1'));
    expect(await repo.countByBook(BookId('b1'))).toBe(0);
    expect(await repo.countByBook(BookId('b2'))).toBe(1);
  });

  it('countStaleVersions returns books with embeddingModelVersion < current', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({ id: ChunkId('chunk-old-s1-0'), bookId: BookId('old'), embeddingModelVersion: 0 }),
      makeEmbedding({ id: ChunkId('chunk-cur-s1-0'), bookId: BookId('cur'), embeddingModelVersion: 1 }),
    ]);
    const stale = await repo.countStaleVersions(1);
    expect(stale).toContain(BookId('old'));
    expect(stale).not.toContain(BookId('cur'));
  });

  it('deleteOrphans removes records whose id is not in the valid set', async () => {
    const repo = createBookEmbeddingsRepository(db);
    await repo.upsertMany([
      makeEmbedding({ id: ChunkId('chunk-b1-s1-0') }),
      makeEmbedding({ id: ChunkId('chunk-b1-s1-1') }),
      makeEmbedding({ id: ChunkId('chunk-b1-s1-2') }),
    ]);
    const valid = new Set<ChunkId>([
      ChunkId('chunk-b1-s1-0'),
      ChunkId('chunk-b1-s1-2'),
    ]);
    const removed = await repo.deleteOrphans(valid);
    expect(removed).toBe(1);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-0'))).toBe(true);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-1'))).toBe(false);
    expect(await repo.hasEmbeddingFor(ChunkId('chunk-b1-s1-2'))).toBe(true);
  });

  it('listByBook filters out malformed records (validating reads)', async () => {
    const repo = createBookEmbeddingsRepository(db);
    // Inject a malformed record bypassing the typed API.
    const tx = db.transaction('book_embeddings', 'readwrite');
    // @ts-expect-error - intentional bad record to exercise validation
    await tx.store.put({
      id: 'chunk-b1-s1-0',
      bookId: 'b1',
      vector: 'not-a-float32array',
      chunkerVersion: 1,
      embeddingModelVersion: 1,
      embeddedAt: '2026-05-06T00:00:00.000Z',
    });
    await tx.done;
    const list = await repo.listByBook(BookId('b1'));
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/storage/repositories/bookEmbeddings.test.ts`

Expected: FAIL — `bookEmbeddings.ts` doesn't exist yet.

- [ ] **Step 3: Implement the repository**

Create `src/storage/repositories/bookEmbeddings.ts`:

```typescript
import { BookId, ChunkId, type BookEmbedding } from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_EMBEDDINGS_STORE } from '../db/schema';

export type BookEmbeddingsRepository = {
  upsertMany(records: readonly BookEmbedding[]): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly BookEmbedding[]>;
  deleteByBook(bookId: BookId): Promise<void>;
  countByBook(bookId: BookId): Promise<number>;
  hasEmbeddingFor(chunkId: ChunkId): Promise<boolean>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
  deleteOrphans(validChunkIds: ReadonlySet<ChunkId>): Promise<number>;
};

function normalizeEmbedding(record: unknown): BookEmbedding | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<BookEmbedding> & Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  if (!(r.vector instanceof Float32Array)) return null;
  if (r.vector.length === 0) return null;
  if (typeof r.chunkerVersion !== 'number' || !Number.isInteger(r.chunkerVersion)) return null;
  if (typeof r.embeddingModelVersion !== 'number' || !Number.isInteger(r.embeddingModelVersion)) {
    return null;
  }
  if (typeof r.embeddedAt !== 'string') return null;
  return {
    id: ChunkId(r.id),
    bookId: BookId(r.bookId),
    vector: r.vector,
    chunkerVersion: r.chunkerVersion,
    embeddingModelVersion: r.embeddingModelVersion,
    embeddedAt: r.embeddedAt as BookEmbedding['embeddedAt'],
  };
}

export function createBookEmbeddingsRepository(db: BookwormDB): BookEmbeddingsRepository {
  return {
    async upsertMany(records) {
      if (records.length === 0) return;
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readwrite');
      for (const r of records) {
        await tx.store.put(r);
      }
      await tx.done;
    },
    async listByBook(bookId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      const records = await index.getAll(bookId);
      return records
        .map(normalizeEmbedding)
        .filter((e): e is BookEmbedding => e !== null);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readwrite');
      const index = tx.store.index('by-book');
      let cursor = await index.openKeyCursor(bookId);
      while (cursor) {
        await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async countByBook(bookId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const index = tx.store.index('by-book');
      return index.count(bookId);
    },
    async hasEmbeddingFor(chunkId) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const key = await tx.store.getKey(chunkId);
      return key !== undefined;
    },
    async countStaleVersions(currentVersion) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readonly');
      const stale = new Set<BookId>();
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const e = normalizeEmbedding(cursor.value);
        if (e !== null && e.embeddingModelVersion < currentVersion) {
          stale.add(e.bookId);
        }
        cursor = await cursor.continue();
      }
      return [...stale];
    },
    async deleteOrphans(validChunkIds) {
      const tx = db.transaction(BOOK_EMBEDDINGS_STORE, 'readwrite');
      let removed = 0;
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const e = normalizeEmbedding(cursor.value);
        if (e === null || !validChunkIds.has(e.id)) {
          await tx.store.delete(cursor.primaryKey);
          removed += 1;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      return removed;
    },
  };
}
```

- [ ] **Step 4: Re-export from storage barrel**

In `src/storage/index.ts`, after line 44 (the `bookChunks` re-export block), add:

```typescript
export {
  createBookEmbeddingsRepository,
  type BookEmbeddingsRepository,
} from './repositories/bookEmbeddings';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/storage/repositories/bookEmbeddings.test.ts`

Expected: PASS — all 8 cases.

- [ ] **Step 6: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storage/repositories/bookEmbeddings.ts src/storage/repositories/bookEmbeddings.test.ts src/storage/index.ts
git commit -m "$(cat <<'EOF'
feat(storage): BookEmbeddingsRepository

Mirrors BookChunksRepository surface plus hasEmbeddingFor (per-chunk
idempotent-resume) and deleteOrphans (chunker-cascade cleanup).
Validating-reads filter malformed records on listByBook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Tighten `ContextRef.chunk` validation

**Files:**
- Modify: `src/storage/repositories/contextRefValidation.ts:28`
- Modify (or create): `src/storage/repositories/contextRefValidation.test.ts`

**Goal:** Replace the lenient pass-through for the `chunk` variant with real validation: `chunkId` must be a non-empty string. Phase 4.4 deliberately deferred this; Phase 5.2 actually populates chunk refs (on retrieval-mode assistant messages), so the validator must catch malformed records on read.

- [ ] **Step 1: Pre-flight grep for existing chunk-ref construction**

```bash
git grep "kind: ['\"]chunk['\"]" src/
```

Expected: zero matches in non-test code (chunk refs are introduced for the first time in Task 13). If matches exist outside tests, stop and reconcile — they must already conform to the tightened shape.

- [ ] **Step 2: Locate or create the validator test**

```bash
ls src/storage/repositories/contextRefValidation.test.ts 2>/dev/null
```

If absent, create it. If present, append the new cases.

- [ ] **Step 3: Write the failing tests**

Create / append `src/storage/repositories/contextRefValidation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isValidContextRef } from './contextRefValidation';

describe('isValidContextRef — chunk variant (Phase 5.2)', () => {
  it('accepts a chunk ref with a non-empty chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk', chunkId: 'chunk-b1-s1-0' })).toBe(true);
  });

  it('rejects chunk ref with missing chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk' })).toBe(false);
  });

  it('rejects chunk ref with empty chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk', chunkId: '' })).toBe(false);
  });

  it('rejects chunk ref with non-string chunkId', () => {
    expect(isValidContextRef({ kind: 'chunk', chunkId: 42 })).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify the empty/missing/numeric cases fail**

Run: `pnpm vitest run src/storage/repositories/contextRefValidation.test.ts`

Expected: FAIL — current code returns `true` for any object with `kind: 'chunk'`.

- [ ] **Step 5: Implement the tightened validator**

In `src/storage/repositories/contextRefValidation.ts`, replace lines 28-29:

```typescript
  if (v.kind === 'highlight' || v.kind === 'section') return true;
  if (v.kind === 'chunk') {
    const c = v as Record<string, unknown>;
    return typeof c.chunkId === 'string' && c.chunkId !== '';
  }
  return false;
```

Update the file's leading comment block (lines 1-13) to reflect the change — replace `keep their existing lenient pass-through behavior` with `keep their existing lenient pass-through behavior; chunk gains real validation in Phase 5.2 (retrieval mode is the first feature to populate chunk refs)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/storage/repositories/contextRefValidation.test.ts`

Expected: PASS — all four chunk cases plus the existing passage cases.

- [ ] **Step 7: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/storage/repositories/contextRefValidation.ts src/storage/repositories/contextRefValidation.test.ts
git commit -m "feat(storage): tighten ContextRef.chunk validation in shared validator"
```

---

## Task 5: Embedding constants + `l2Normalize` + `classifyEmbeddingError`

**Files:**
- Create: `src/features/library/indexing/embeddings/EMBEDDING_MODEL.ts`
- Create: `src/features/library/indexing/embeddings/normalize.ts`
- Create: `src/features/library/indexing/embeddings/normalize.test.ts`
- Create: `src/features/library/indexing/embeddings/classifyEmbeddingError.ts`
- Create: `src/features/library/indexing/embeddings/classifyEmbeddingError.test.ts`
- Create: `src/features/library/indexing/embeddings/types.ts` (`EmbedClient` interface)
- Modify: `src/domain/indexing/types.ts` (extend `failed.reason` union with `'embedding-failed'` and `'embedding-rate-limited'`)

**Goal:** Pure helpers with no I/O dependencies. Test-first.

- [ ] **Step 1: Verify `IndexingStatus.failed.reason` union**

```bash
grep -n "'embedding-failed'\|'embedding-rate-limited'" src/domain/indexing/types.ts
```

If missing, open `src/domain/indexing/types.ts`, locate the `failed` discriminated-union variant, and append `| 'embedding-failed' | 'embedding-rate-limited'` to its `reason` string-literal union.

- [ ] **Step 2: Write failing tests for `l2Normalize`**

Create `src/features/library/indexing/embeddings/normalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { l2Normalize } from './normalize';

describe('l2Normalize', () => {
  it('produces a unit vector for typical input', () => {
    const v = new Float32Array([3, 4]);
    const n = l2Normalize(v);
    const norm = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]!);
    expect(norm).toBeCloseTo(1, 5);
    expect(n[0]).toBeCloseTo(0.6, 5);
    expect(n[1]).toBeCloseTo(0.8, 5);
  });

  it('returns zero vector unchanged', () => {
    const n = l2Normalize(new Float32Array([0, 0, 0]));
    expect(Array.from(n)).toEqual([0, 0, 0]);
  });

  it('preserves an already-unit vector', () => {
    const n = l2Normalize(new Float32Array([1, 0, 0]));
    expect(n[0]).toBeCloseTo(1, 5);
    expect(n[1]).toBeCloseTo(0, 5);
  });

  it('does not mutate the input', () => {
    const v = new Float32Array([3, 4]);
    const before = Array.from(v);
    l2Normalize(v);
    expect(Array.from(v)).toEqual(before);
  });

  it('handles a 1536-dim vector', () => {
    const v = new Float32Array(1536);
    for (let i = 0; i < 1536; i++) v[i] = (i % 11) + 1;
    const n = l2Normalize(v);
    let sumSq = 0;
    for (let i = 0; i < 1536; i++) sumSq += n[i]! * n[i]!;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 4);
  });
});
```

- [ ] **Step 3: Run — fails (module missing)**

Run: `pnpm vitest run src/features/library/indexing/embeddings/normalize.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement `EMBEDDING_MODEL.ts`**

Create `src/features/library/indexing/embeddings/EMBEDDING_MODEL.ts`:

```typescript
export const EMBEDDING_MODEL_VERSION = 1;

export const EMBEDDING_MODEL_IDS: Readonly<Record<number, string>> = {
  1: 'text-embedding-3-small',
};

const currentId = EMBEDDING_MODEL_IDS[EMBEDDING_MODEL_VERSION];
if (currentId === undefined) {
  throw new Error(
    `EMBEDDING_MODEL_IDS missing entry for version ${String(EMBEDDING_MODEL_VERSION)}`,
  );
}
export const CURRENT_EMBEDDING_MODEL_ID: string = currentId;

export const EMBEDDING_DIMS = 1536;
```

- [ ] **Step 5: Implement `normalize.ts`**

Create `src/features/library/indexing/embeddings/normalize.ts`:

```typescript
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i]!;
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return new Float32Array(vec);
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i]! / norm;
  return out;
}
```

- [ ] **Step 6: Run — passes**

Run: `pnpm vitest run src/features/library/indexing/embeddings/normalize.test.ts`

Expected: PASS.

- [ ] **Step 7: Write failing tests for `classifyEmbeddingError`**

Create `src/features/library/indexing/embeddings/classifyEmbeddingError.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyEmbeddingError } from './classifyEmbeddingError';

function fakeEmbedError(reason: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`embed: ${reason}`), {
    failure: { reason, ...extra },
  });
}

describe('classifyEmbeddingError', () => {
  it('rate-limit → embedding-rate-limited', () => {
    expect(classifyEmbeddingError(fakeEmbedError('rate-limit', { status: 429 }))).toBe(
      'embedding-rate-limited',
    );
  });

  it('invalid-key → embedding-failed', () => {
    expect(classifyEmbeddingError(fakeEmbedError('invalid-key', { status: 401 }))).toBe(
      'embedding-failed',
    );
  });

  it('network → embedding-failed', () => {
    expect(classifyEmbeddingError(fakeEmbedError('network'))).toBe('embedding-failed');
  });

  it('unknown error → embedding-failed', () => {
    expect(classifyEmbeddingError(new Error('boom'))).toBe('embedding-failed');
  });

  it('non-error value → embedding-failed', () => {
    expect(classifyEmbeddingError('boom')).toBe('embedding-failed');
  });
});
```

- [ ] **Step 8: Implement `classifyEmbeddingError.ts`**

Create `src/features/library/indexing/embeddings/classifyEmbeddingError.ts`:

```typescript
function isRateLimitErrorShape(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { failure?: { reason?: unknown } };
  return e.failure?.reason === 'rate-limit';
}

export function classifyEmbeddingError(
  err: unknown,
): 'embedding-failed' | 'embedding-rate-limited' {
  if (isRateLimitErrorShape(err)) return 'embedding-rate-limited';
  return 'embedding-failed';
}
```

- [ ] **Step 9: Run tests — pass**

Run: `pnpm vitest run src/features/library/indexing/embeddings/classifyEmbeddingError.test.ts`

Expected: PASS — all 5 cases.

- [ ] **Step 10: Create `types.ts` with the `EmbedClient` interface**

Create `src/features/library/indexing/embeddings/types.ts`:

```typescript
export type EmbedResult = {
  readonly vectors: readonly Float32Array[];
  readonly usage?: { readonly prompt: number };
};

export type EmbedClient = {
  embed(req: {
    readonly modelId: string;
    readonly inputs: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<EmbedResult>;
};
```

- [ ] **Step 11: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/features/library/indexing/embeddings/ src/domain/indexing/types.ts
git commit -m "feat(indexing): EMBEDDING_MODEL constants + l2Normalize + classifyEmbeddingError"
```

---

## Task 6: `nanogptEmbeddings` network module

**Files:**
- Create: `src/features/ai/chat/nanogptEmbeddings.ts`
- Create: `src/features/ai/chat/nanogptEmbeddings.test.ts`

**Goal:** Single-call POST to `/v1/embeddings` mirroring `nanogptChat.ts`'s typed-failure pattern. Returns `EmbedResult` (typed) or throws `EmbedError`.

> ⚠️ **IMPLEMENTATION-TIME VERIFICATION (before completing this task):** With a known-good NanoGPT API key, run a one-shot probe to confirm the response shape matches the OpenAI-compatible structure the parser assumes:
>
> ```bash
> curl -sS https://nano-gpt.com/api/v1/embeddings \
>   -H "Authorization: Bearer $NANOGPT_KEY" \
>   -H "Content-Type: application/json" \
>   -d '{"model":"text-embedding-3-small","input":["hello world"]}' \
>   | jq '{has_data: (.data|type=="array"), first_index: .data[0].index, vec_len: (.data[0].embedding|length), usage_prompt: .usage.prompt_tokens}'
> ```
>
> Expected: `{has_data: true, first_index: 0, vec_len: 1536, usage_prompt: <number>}`. If the response shape diverges (e.g. `embeddings` instead of `data`, `vector` instead of `embedding`, missing `index`), adapt the parser in Step 3 and document the divergence in `docs/02-system-architecture.md`'s decision history.

- [ ] **Step 1: Write failing tests**

Create `src/features/ai/chat/nanogptEmbeddings.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { embed, EmbedError } from './nanogptEmbeddings';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl as typeof fetch;
}

function makeOkResponse(vectors: number[][], promptTokens = 7): Response {
  return new Response(
    JSON.stringify({
      data: vectors.map((v, i) => ({ embedding: v, index: i })),
      usage: { prompt_tokens: promptTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('nanogptEmbeddings.embed', () => {
  it('happy path returns vectors in input order', async () => {
    const dim = 1536;
    const v0 = new Array<number>(dim).fill(0).map((_, i) => i / dim);
    const v1 = new Array<number>(dim).fill(0).map((_, i) => (i + 1) / dim);
    mockFetch(async (input, init) => {
      expect(typeof input).toBe('string');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer KEY');
      const body = JSON.parse(init?.body as string) as { model: string; input: string[] };
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toEqual(['a', 'b']);
      return makeOkResponse([v0, v1]);
    });
    const result = await embed({
      apiKey: 'KEY',
      modelId: 'text-embedding-3-small',
      inputs: ['a', 'b'],
    });
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(result.vectors[0]?.length).toBe(dim);
    expect(result.vectors[0]?.[0]).toBeCloseTo(0, 5);
    expect(result.vectors[1]?.[1]).toBeCloseTo(2 / dim, 5);
    expect(result.usage?.prompt).toBe(7);
  });

  it('reorders by `index` when API returns out-of-order', async () => {
    const dim = 1536;
    const v0 = new Array<number>(dim).fill(0.1);
    const v1 = new Array<number>(dim).fill(0.2);
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { embedding: v1, index: 1 },
              { embedding: v0, index: 0 },
            ],
            usage: { prompt_tokens: 4 },
          }),
          { status: 200 },
        ),
    );
    const result = await embed({
      apiKey: 'KEY',
      modelId: 'text-embedding-3-small',
      inputs: ['a', 'b'],
    });
    expect(result.vectors[0]?.[0]).toBeCloseTo(0.1, 5);
    expect(result.vectors[1]?.[0]).toBeCloseTo(0.2, 5);
  });

  it('throws invalid-key on 401', async () => {
    mockFetch(async () => new Response('', { status: 401 }));
    await expect(
      embed({ apiKey: 'BAD', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'invalid-key', status: 401 } });
  });

  it('throws rate-limit with retryAfterSeconds on 429', async () => {
    mockFetch(
      async () => new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
    );
    try {
      await embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbedError);
      expect((e as EmbedError).failure).toEqual({
        reason: 'rate-limit',
        status: 429,
        retryAfterSeconds: 3,
      });
    }
  });

  it('throws model-unavailable on 404', async () => {
    mockFetch(async () => new Response('', { status: 404 }));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'nope', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'model-unavailable', status: 404 } });
  });

  it('throws server on 500', async () => {
    mockFetch(async () => new Response('', { status: 500 }));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'server', status: 500 } });
  });

  it('throws network on fetch rejection', async () => {
    mockFetch(async () => {
      throw new TypeError('network down');
    });
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'network' } });
  });

  it('throws aborted when AbortError fires', async () => {
    mockFetch(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'aborted' } });
  });

  it('throws malformed-response on non-JSON body', async () => {
    mockFetch(async () => new Response('not json', { status: 200 }));
    await expect(
      embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });

  it('throws dimensions-mismatch when vector length != 1536', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [1, 2, 3], index: 0 }],
            usage: { prompt_tokens: 1 },
          }),
          { status: 200 },
        ),
    );
    try {
      await embed({ apiKey: 'KEY', modelId: 'text-embedding-3-small', inputs: ['x'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbedError);
      expect((e as EmbedError).failure).toEqual({
        reason: 'dimensions-mismatch',
        expected: 1536,
        got: 3,
      });
    }
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm vitest run src/features/ai/chat/nanogptEmbeddings.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `nanogptEmbeddings.ts`**

Create `src/features/ai/chat/nanogptEmbeddings.ts`:

```typescript
import { EMBEDDING_DIMS } from '@/features/library/indexing/embeddings/EMBEDDING_MODEL';

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type EmbedRequest = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly inputs: readonly string[];
  readonly signal?: AbortSignal;
};

export type EmbedResult = {
  readonly vectors: readonly Float32Array[];
  readonly usage?: { readonly prompt: number };
};

export type EmbedFailure =
  | { readonly reason: 'invalid-key'; readonly status: 401 | 403 }
  | { readonly reason: 'rate-limit'; readonly status: 429; readonly retryAfterSeconds?: number }
  | { readonly reason: 'model-unavailable'; readonly status: 404 | 400 }
  | { readonly reason: 'server'; readonly status: number }
  | { readonly reason: 'network' }
  | { readonly reason: 'aborted' }
  | { readonly reason: 'malformed-response' }
  | { readonly reason: 'dimensions-mismatch'; readonly expected: number; readonly got: number };

export class EmbedError extends Error {
  readonly failure: EmbedFailure;
  constructor(failure: EmbedFailure) {
    super(`embed failed: ${failure.reason}`);
    this.name = 'EmbedError';
    this.failure = failure;
  }
}

function classifyHttpFailure(res: Response): EmbedFailure {
  const status = res.status;
  if (status === 401 || status === 403) return { reason: 'invalid-key', status: status as 401 | 403 };
  if (status === 429) {
    const ra = res.headers.get('Retry-After');
    const parsed = ra !== null ? Number.parseInt(ra, 10) : Number.NaN;
    return Number.isFinite(parsed)
      ? { reason: 'rate-limit', status: 429, retryAfterSeconds: parsed }
      : { reason: 'rate-limit', status: 429 };
  }
  if (status === 404 || status === 400) return { reason: 'model-unavailable', status: status as 404 | 400 };
  return { reason: 'server', status };
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

type RawResponse = {
  data?: { embedding?: number[]; index?: number }[];
  usage?: { prompt_tokens?: number };
};

export async function embed(req: EmbedRequest): Promise<EmbedResult> {
  let res: Response;
  try {
    res = await fetch(`${NANOGPT_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: req.modelId, input: req.inputs }),
      ...(req.signal !== undefined && { signal: req.signal }),
    });
  } catch (e) {
    if (isAbortError(e)) throw new EmbedError({ reason: 'aborted' });
    throw new EmbedError({ reason: 'network' });
  }

  if (!res.ok) throw new EmbedError(classifyHttpFailure(res));

  let payload: RawResponse;
  try {
    payload = (await res.json()) as RawResponse;
  } catch {
    throw new EmbedError({ reason: 'malformed-response' });
  }
  if (!Array.isArray(payload.data) || payload.data.length !== req.inputs.length) {
    throw new EmbedError({ reason: 'malformed-response' });
  }

  const ordered: (Float32Array | null)[] = new Array<Float32Array | null>(req.inputs.length).fill(null);
  for (const item of payload.data) {
    if (!Array.isArray(item.embedding) || typeof item.index !== 'number') {
      throw new EmbedError({ reason: 'malformed-response' });
    }
    if (item.embedding.length !== EMBEDDING_DIMS) {
      throw new EmbedError({
        reason: 'dimensions-mismatch',
        expected: EMBEDDING_DIMS,
        got: item.embedding.length,
      });
    }
    if (item.index < 0 || item.index >= ordered.length) {
      throw new EmbedError({ reason: 'malformed-response' });
    }
    ordered[item.index] = Float32Array.from(item.embedding);
  }
  if (ordered.some((v) => v === null)) {
    throw new EmbedError({ reason: 'malformed-response' });
  }

  const vectors = ordered as Float32Array[];
  const result: EmbedResult =
    typeof payload.usage?.prompt_tokens === 'number'
      ? { vectors, usage: { prompt: payload.usage.prompt_tokens } }
      : { vectors };
  return result;
}
```

- [ ] **Step 4: Run — passes**

Run: `pnpm vitest run src/features/ai/chat/nanogptEmbeddings.test.ts`

Expected: PASS — 10 cases.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/chat/nanogptEmbeddings.ts src/features/ai/chat/nanogptEmbeddings.test.ts
git commit -m "feat(network): nanogptEmbeddings — POST /v1/embeddings + EmbedError typed failures"
```

---


## Task 7: `runEmbeddingStage` — extend pipeline + retry-with-backoff

**Files:**
- Modify: `src/features/library/indexing/pipeline.ts:9-14` (extend `PipelineDeps`), `:33-94` (insert embedding stage before `ready`)
- Modify: `src/features/library/indexing/pipeline.test.ts` (extend with embedding-stage cases)

**Goal:** Insert the embedding stage between chunking-complete and final `ready`. Per-batch idempotent resume, retry-with-backoff for rate limits, terminal failure for other embed errors.

- [ ] **Step 1: Add the new deps + helpers (read-then-edit, since pipeline.ts is small)**

Open `src/features/library/indexing/pipeline.ts`. The current shape (lines 1-95) is:

```typescript
import { IsoTimestamp, type Book, type BookId } from '@/domain';
import type { IndexingStatus } from '@/domain/indexing/types';
import type { BookRepository, BookChunksRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { paragraphsToChunks } from './paragraphsToChunks';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { classifyError } from './classifyError';
```

Replace the import block with:

```typescript
import { IsoTimestamp, type Book, type BookEmbedding, type BookId, type TextChunk } from '@/domain';
import type { IndexingStatus } from '@/domain/indexing/types';
import type { BookChunksRepository, BookEmbeddingsRepository, BookRepository } from '@/storage';
import type { ChunkExtractor } from './extractor';
import { paragraphsToChunks } from './paragraphsToChunks';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { classifyError } from './classifyError';
import {
  CURRENT_EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_VERSION,
} from './embeddings/EMBEDDING_MODEL';
import { l2Normalize } from './embeddings/normalize';
import { classifyEmbeddingError } from './embeddings/classifyEmbeddingError';
import type { EmbedClient, EmbedResult } from './embeddings/types';
```

Replace `PipelineDeps` (lines 9-14) with:

```typescript
export type PipelineDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
  readonly embedClient: EmbedClient;
};

const EMBED_BATCH_SIZE = 32;
const EMBED_RETRY_ATTEMPTS = 3;

function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function embedWithRetry(
  client: EmbedClient,
  req: { modelId: string; inputs: readonly string[]; signal?: AbortSignal },
): Promise<EmbedResult> {
  for (let attempt = 0; attempt < EMBED_RETRY_ATTEMPTS - 1; attempt++) {
    try {
      return await client.embed(req);
    } catch (err) {
      const failure = (err as { failure?: { reason?: string; retryAfterSeconds?: number } }).failure;
      if (failure?.reason !== 'rate-limit') throw err;
      const baseDelayMs = (failure.retryAfterSeconds ?? 1) * 1000;
      const backoffMs = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return client.embed(req);
}
```

Replace `runIndexing` (lines 33-94) — keep the chunking stage exactly as-is, then insert the embedding stage before final `ready`:

```typescript
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
      await setStatus(book.id, { kind: 'failed', reason: 'no-text-found' }, deps.booksRepo);
      return;
    }

    let processedCount = 0;
    for (const section of sections) {
      if (signal.aborted) return;

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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (signal.aborted) return;
        await deps.chunksRepo.upsertMany(drafts);
      }

      processedCount += 1;
      const progressPercent = Math.round((processedCount / sections.length) * 100);
      await setStatus(book.id, { kind: 'chunking', progressPercent }, deps.booksRepo);
      await yieldToBrowser();
    }

    if (signal.aborted) return;

    const embeddingResult = await runEmbeddingStage(book, signal, deps);
    if (embeddingResult === 'aborted') return;
    if (embeddingResult === 'failed') return; // status already set inside

    await setStatus(book.id, { kind: 'ready' }, deps.booksRepo);
  } catch (err) {
    if (signal.aborted) return;
    console.warn('[indexing]', err);
    await setStatus(book.id, { kind: 'failed', reason: classifyError(err) }, deps.booksRepo);
  }
}

type EmbeddingStageOutcome = 'ok' | 'aborted' | 'failed';

async function runEmbeddingStage(
  book: Book,
  signal: AbortSignal,
  deps: PipelineDeps,
): Promise<EmbeddingStageOutcome> {
  await setStatus(book.id, { kind: 'embedding', progressPercent: 0 }, deps.booksRepo);
  const allChunks = await deps.chunksRepo.listByBook(book.id);
  if (allChunks.length === 0) return 'ok';

  const toEmbed: TextChunk[] = [];
  for (const c of allChunks) {
    if (await deps.embeddingsRepo.hasEmbeddingFor(c.id)) continue;
    toEmbed.push(c);
  }

  let processed = allChunks.length - toEmbed.length;
  for (const batch of chunkArray(toEmbed, EMBED_BATCH_SIZE)) {
    if (signal.aborted) return 'aborted';

    let result: EmbedResult;
    try {
      result = await embedWithRetry(deps.embedClient, {
        modelId: CURRENT_EMBEDDING_MODEL_ID,
        inputs: batch.map((c) => c.normalizedText),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      if (signal.aborted) return 'aborted';
      console.warn('[indexing][embedding]', err);
      await setStatus(
        book.id,
        { kind: 'failed', reason: classifyEmbeddingError(err) },
        deps.booksRepo,
      );
      return 'failed';
    }

    if (signal.aborted) return 'aborted';

    const records: BookEmbedding[] = batch.map((chunk, i) => ({
      id: chunk.id,
      bookId: chunk.bookId,
      vector: l2Normalize(result.vectors[i]!),
      chunkerVersion: chunk.chunkerVersion,
      embeddingModelVersion: EMBEDDING_MODEL_VERSION,
      embeddedAt: IsoTimestamp(new Date().toISOString()),
    }));
    await deps.embeddingsRepo.upsertMany(records);

    processed += batch.length;
    const progressPercent = Math.round((processed / allChunks.length) * 100);
    await setStatus(book.id, { kind: 'embedding', progressPercent }, deps.booksRepo);
    await yieldToBrowser();
  }
  return 'ok';
}
```

- [ ] **Step 2: Update `pipeline.test.ts` stubs**

The existing `makeStubChunksRepo()` returns a `BookChunksRepository`. Add a parallel `makeStubEmbeddingsRepo()` and a `makeStubEmbedClient()`:

In `src/features/library/indexing/pipeline.test.ts`, after the existing stub helpers, add:

```typescript
import type { BookEmbeddingsRepository } from '@/storage';
import type { EmbedClient } from './embeddings/types';
import { ChunkId, type BookId, type BookEmbedding } from '@/domain';

function makeStubEmbeddingsRepo(): BookEmbeddingsRepository {
  const records = new Map<string, BookEmbedding>();
  return {
    upsertMany: async (recs) => {
      for (const r of recs) records.set(r.id, r);
    },
    listByBook: async (bookId) =>
      [...records.values()].filter((r) => r.bookId === bookId),
    deleteByBook: async (bookId) => {
      for (const [k, v] of records) if (v.bookId === bookId) records.delete(k);
    },
    countByBook: async (bookId) =>
      [...records.values()].filter((r) => r.bookId === bookId).length,
    hasEmbeddingFor: async (chunkId) => records.has(chunkId),
    countStaleVersions: async (cur) => {
      const stale = new Set<BookId>();
      for (const r of records.values())
        if (r.embeddingModelVersion < cur) stale.add(r.bookId);
      return [...stale];
    },
    deleteOrphans: async (validIds) => {
      let n = 0;
      for (const [k, v] of records) {
        if (!validIds.has(v.id)) {
          records.delete(k);
          n += 1;
        }
      }
      return n;
    },
  };
}

function makeStubEmbedClient(behavior?: {
  throwOn?: number;
  throwError?: unknown;
}): EmbedClient {
  let calls = 0;
  return {
    embed: async ({ inputs }) => {
      calls += 1;
      if (behavior?.throwOn === calls) {
        throw behavior.throwError ?? new Error('embed boom');
      }
      const vectors = inputs.map(() => {
        const v = new Float32Array(1536);
        for (let i = 0; i < 1536; i++) v[i] = (i % 7) / 7;
        return v;
      });
      return { vectors, usage: { prompt: inputs.length * 5 } };
    },
  };
}
```

Add tests for the embedding stage:

```typescript
describe('runIndexing — embedding stage (Phase 5.2)', () => {
  it('writes embedding records and transitions through embedding{n} → ready', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const chunksRepo = makeStubChunksRepo();
    const embeddingsRepo = makeStubEmbeddingsRepo();
    const epubExtractor = makeStubExtractor([{ id: 's1', title: 'Ch 1' }]);
    const pdfExtractor = makeStubExtractor([]);
    const embedClient = makeStubEmbedClient();

    await runIndexing(book, new AbortController().signal, {
      booksRepo,
      chunksRepo,
      embeddingsRepo,
      epubExtractor,
      pdfExtractor,
      embedClient,
    });

    expect((await booksRepo.current()).indexingStatus).toEqual({ kind: 'ready' });
    expect(await embeddingsRepo.countByBook(book.id)).toBeGreaterThan(0);
  });

  it('idempotent resume: skips chunks that already have embeddings', async () => {
    const book = makeBook();
    const chunksRepo = makeStubChunksRepo();
    const embeddingsRepo = makeStubEmbeddingsRepo();
    // Pre-seed: pretend one chunk already has an embedding.
    const epubExtractor = makeStubExtractor([{ id: 's1', title: 'Ch 1' }]);
    const pdfExtractor = makeStubExtractor([]);
    const embedClient = makeStubEmbedClient();

    // Run once to populate chunks + embeddings.
    await runIndexing(book, new AbortController().signal, {
      booksRepo: makeStubBookRepo(book),
      chunksRepo,
      embeddingsRepo,
      epubExtractor,
      pdfExtractor,
      embedClient,
    });
    const firstCount = await embeddingsRepo.countByBook(book.id);

    // Run again — embeddingsRepo.hasEmbeddingFor returns true for all chunks.
    await runIndexing(book, new AbortController().signal, {
      booksRepo: makeStubBookRepo(book),
      chunksRepo,
      embeddingsRepo,
      epubExtractor,
      pdfExtractor,
      embedClient,
    });
    expect(await embeddingsRepo.countByBook(book.id)).toBe(firstCount);
  });

  it('writes failed{embedding-failed} when embedClient throws non-rate-limit', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const epubExtractor = makeStubExtractor([{ id: 's1', title: 'Ch 1' }]);
    const pdfExtractor = makeStubExtractor([]);
    const embedClient = makeStubEmbedClient({
      throwOn: 1,
      throwError: Object.assign(new Error('embed: invalid-key'), {
        failure: { reason: 'invalid-key', status: 401 },
      }),
    });

    await runIndexing(book, new AbortController().signal, {
      booksRepo,
      chunksRepo: makeStubChunksRepo(),
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor,
      pdfExtractor,
      embedClient,
    });

    expect((await booksRepo.current()).indexingStatus).toEqual({
      kind: 'failed',
      reason: 'embedding-failed',
    });
  });

  it('aborts cleanly mid-batch without writing failed', async () => {
    const book = makeBook();
    const booksRepo = makeStubBookRepo(book);
    const ctrl = new AbortController();
    const epubExtractor = makeStubExtractor([{ id: 's1', title: 'Ch 1' }]);
    const pdfExtractor = makeStubExtractor([]);
    const embedClient: EmbedClient = {
      embed: async () => {
        ctrl.abort();
        const v = new Float32Array(1536);
        return { vectors: [v], usage: { prompt: 1 } };
      },
    };

    await runIndexing(book, ctrl.signal, {
      booksRepo,
      chunksRepo: makeStubChunksRepo(),
      embeddingsRepo: makeStubEmbeddingsRepo(),
      epubExtractor,
      pdfExtractor,
      embedClient,
    });

    const status = (await booksRepo.current()).indexingStatus;
    // Either chunking{n} or embedding{n} — the key is NOT 'failed' nor 'ready'.
    expect(status.kind === 'chunking' || status.kind === 'embedding').toBe(true);
  });
});
```

- [ ] **Step 3: Run pipeline tests**

Run: `pnpm vitest run src/features/library/indexing/pipeline.test.ts`

Expected: PASS — existing chunking tests + 4 new embedding-stage tests. If existing tests break, the most likely cause is a missing `embeddingsRepo` / `embedClient` in their `runIndexing(...)` deps object. Fix each call site by passing `embeddingsRepo: makeStubEmbeddingsRepo(), embedClient: makeStubEmbedClient()`.

- [ ] **Step 4: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/library/indexing/pipeline.ts src/features/library/indexing/pipeline.test.ts
git commit -m "feat(indexing): runEmbeddingStage — extend pipeline with embedding stage + retry-with-backoff"
```

---

## Task 8: `IndexingQueue.onAppOpen` — embedding-stale scan + chunker-cascade

**Files:**
- Modify: `src/features/library/indexing/IndexingQueue.ts:7-12` (extend deps), `:46-64` (extend onAppOpen), `:66-92` (extend drain)
- Modify: `src/features/library/indexing/IndexingQueue.test.ts` (add embedding-stale test)
- Modify: `src/features/library/indexing/useIndexing.ts:7-12` (extend deps)
- Modify: `src/features/library/indexing/useIndexing.test.ts` (extend stubs)

- [ ] **Step 1: Extend `IndexingQueueDeps` + threading**

In `src/features/library/indexing/IndexingQueue.ts`, replace lines 1-12 with:

```typescript
import { IsoTimestamp, type BookId } from '@/domain';
import type {
  BookChunksRepository,
  BookEmbeddingsRepository,
  BookRepository,
} from '@/storage';
import type { ChunkExtractor } from './extractor';
import { CHUNKER_VERSION } from './CHUNKER_VERSION';
import { EMBEDDING_MODEL_VERSION } from './embeddings/EMBEDDING_MODEL';
import type { EmbedClient } from './embeddings/types';
import { runIndexing, type PipelineDeps } from './pipeline';

export type IndexingQueueDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
  readonly embedClient: EmbedClient;
};
```

Replace `onAppOpen` (lines 46-64) with:

```typescript
  async onAppOpen(): Promise<void> {
    const staleChunkBooks = await this.deps.chunksRepo.countStaleVersions(CHUNKER_VERSION);
    const cascaded = new Set<BookId>();
    for (const id of staleChunkBooks) {
      await this.deps.chunksRepo.deleteByBook(id);
      // Cascade: stale chunks invalidate their embeddings too (chunkId no longer matches).
      await this.deps.embeddingsRepo.deleteByBook(id);
      cascaded.add(id);
      await this.markPending(id);
    }

    const staleEmbedBooks = await this.deps.embeddingsRepo.countStaleVersions(
      EMBEDDING_MODEL_VERSION,
    );
    for (const id of staleEmbedBooks) {
      if (cascaded.has(id)) continue;
      await this.deps.embeddingsRepo.deleteByBook(id);
      await this.markPending(id);
    }

    const all = await this.deps.booksRepo.getAll();
    for (const book of all) {
      const k = book.indexingStatus.kind;
      if (k === 'pending' || k === 'chunking' || k === 'embedding') this.enqueue(book.id);
    }
  }

  private async markPending(id: BookId): Promise<void> {
    const book = await this.deps.booksRepo.getById(id);
    if (book === undefined) return;
    await this.deps.booksRepo.put({
      ...book,
      indexingStatus: { kind: 'pending' },
      updatedAt: IsoTimestamp(new Date().toISOString()),
    });
  }
```

Update the existing inline pending-mark in the existing `rebuild()` body to delegate to `markPending`:

Find the block in `rebuild()` (lines 36-42) that reads:
```typescript
    const book = await this.deps.booksRepo.getById(bookId);
    if (book !== undefined) {
      await this.deps.booksRepo.put({
        ...book,
        indexingStatus: { kind: 'pending' },
        updatedAt: IsoTimestamp(new Date().toISOString()),
      });
    }
```
and replace it with:
```typescript
    await this.markPending(bookId);
```

Also extend `rebuild()` to clear embeddings before re-enqueueing — after `await this.deps.chunksRepo.deleteByBook(bookId);`:
```typescript
    await this.deps.embeddingsRepo.deleteByBook(bookId);
```

Update `drain()` (lines 66-92) to thread the new deps through `pipelineDeps`:

```typescript
          const pipelineDeps: PipelineDeps = {
            booksRepo: this.deps.booksRepo,
            chunksRepo: this.deps.chunksRepo,
            embeddingsRepo: this.deps.embeddingsRepo,
            epubExtractor: this.deps.epubExtractor,
            pdfExtractor: this.deps.pdfExtractor,
            embedClient: this.deps.embedClient,
          };
```

- [ ] **Step 2: Extend `useIndexing.ts`**

In `src/features/library/indexing/useIndexing.ts`, replace lines 1-12:

```typescript
import { useEffect, useRef } from 'react';
import type { BookId } from '@/domain';
import type {
  BookChunksRepository,
  BookEmbeddingsRepository,
  BookRepository,
} from '@/storage';
import type { ChunkExtractor } from './extractor';
import type { EmbedClient } from './embeddings/types';
import { IndexingQueue } from './IndexingQueue';

export type UseIndexingDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
  readonly embedClient: EmbedClient;
};
```

(Body of the hook stays the same — `IndexingQueue` consumes the extended deps verbatim.)

- [ ] **Step 3: Extend `IndexingQueue.test.ts`**

Add a stub for `embeddingsRepo` + `embedClient` to existing helpers (mirror the Task 7 pattern). Add a new test:

```typescript
describe('IndexingQueue.onAppOpen — embedding-stale scan (Phase 5.2)', () => {
  it('drops stale-version embeddings and re-pendings affected books', async () => {
    const books = new Map<string, Book>();
    const b = makeBook({ id: BookId('b1'), indexingStatus: { kind: 'ready' } });
    books.set('b1', b);

    const booksRepo = makeStubBookRepo(books);
    const chunksRepo = makeStubChunksRepo();
    const embeddingsRepo = makeStubEmbeddingsRepo();
    // Seed a stale-version embedding.
    await embeddingsRepo.upsertMany([
      {
        id: ChunkId('chunk-b1-s1-0'),
        bookId: BookId('b1'),
        vector: new Float32Array(1536),
        chunkerVersion: 1,
        embeddingModelVersion: 0, // stale (current is 1)
        embeddedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
      },
    ]);

    const queue = new IndexingQueue({
      booksRepo,
      chunksRepo,
      embeddingsRepo,
      epubExtractor: makeStubExtractor(),
      pdfExtractor: makeStubExtractor(),
      embedClient: makeStubEmbedClient(),
    });
    await queue.onAppOpen();
    await settle();

    expect(await embeddingsRepo.countByBook(BookId('b1'))).toBe(0);
    expect(books.get('b1')?.indexingStatus.kind === 'pending' ||
           books.get('b1')?.indexingStatus.kind === 'chunking' ||
           books.get('b1')?.indexingStatus.kind === 'embedding' ||
           books.get('b1')?.indexingStatus.kind === 'ready').toBe(true);
  });
});
```

- [ ] **Step 4: Extend `useIndexing.test.ts` stubs**

Find `makeStubs()` and add the two new fields. The exact pattern depends on the existing structure; mirror Task 7's `makeStubEmbeddingsRepo` / `makeStubEmbedClient`.

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run src/features/library/indexing/IndexingQueue.test.ts src/features/library/indexing/useIndexing.test.ts
```

Expected: PASS (existing + new tests). Fix any signature drift — every direct `new IndexingQueue({...})` or `useIndexing({...})` call site in test files needs `embeddingsRepo` + `embedClient` added.

- [ ] **Step 6: Run full check**

Run: `pnpm check`

Expected: PASS — existing pipeline tests should still pass after Task 7's extensions.

- [ ] **Step 7: Commit**

```bash
git add src/features/library/indexing/IndexingQueue.ts src/features/library/indexing/IndexingQueue.test.ts src/features/library/indexing/useIndexing.ts src/features/library/indexing/useIndexing.test.ts
git commit -m "feat(indexing): IndexingQueue.onAppOpen — embedding-stale scan + chunker-cascade"
```

---

## Task 9: Retrieval pure helpers — `tokenize`, `bm25Rank`, `cosineRank`, `rrf`

**Files:**
- Create: `src/features/ai/retrieval/tokenize.ts` (+test)
- Create: `src/features/ai/retrieval/bm25.ts` (+test)
- Create: `src/features/ai/retrieval/cosine.ts` (+test)
- Create: `src/features/ai/retrieval/rrf.ts` (+test)

- [ ] **Step 1: Tokenize — write failing test**

Create `src/features/ai/retrieval/tokenize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tokenizeForBM25 } from './tokenize';

describe('tokenizeForBM25', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenizeForBM25('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips diacritics', () => {
    expect(tokenizeForBM25('café résumé')).toEqual(['cafe', 'resume']);
  });

  it('drops pure-punctuation tokens', () => {
    expect(tokenizeForBM25('hello, world!')).toEqual(['hello,', 'world!'].map(s => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')));
    // Equivalent: ['hello', 'world']
  });

  it('returns empty for empty / whitespace-only input', () => {
    expect(tokenizeForBM25('')).toEqual([]);
    expect(tokenizeForBM25('   ')).toEqual([]);
  });

  it('preserves Unicode letters', () => {
    expect(tokenizeForBM25('hello 你好 world')).toEqual(['hello', '你好', 'world']);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `pnpm vitest run src/features/ai/retrieval/tokenize.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `tokenize.ts`**

Create `src/features/ai/retrieval/tokenize.ts`:

```typescript
const PURE_PUNCT_RE = /^[^\p{L}\p{N}]+$/u;
const TRIM_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function tokenizeForBM25(text: string): readonly string[] {
  // 1) Lowercase + NFD-decompose + drop combining marks.
  const folded = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  // 2) Whitespace split, trim leading/trailing punctuation, drop pure-punct or empty tokens.
  return folded
    .split(/\s+/)
    .map((t) => t.replace(TRIM_PUNCT_RE, ''))
    .filter((t) => t.length > 0 && !PURE_PUNCT_RE.test(t));
}
```

- [ ] **Step 4: Tests pass**

Run: `pnpm vitest run src/features/ai/retrieval/tokenize.test.ts`

Expected: PASS.

- [ ] **Step 5: BM25 — write failing test**

Create `src/features/ai/retrieval/bm25.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { bm25Rank } from './bm25';
import { BookId, ChunkId, IsoTimestamp, SectionId, type TextChunk } from '@/domain';

function chunk(id: string, text: string): TextChunk {
  return {
    id: ChunkId(id),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Ch 1',
    text,
    normalizedText: text,
    tokenEstimate: Math.ceil(text.length / 4),
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('bm25Rank', () => {
  it('returns matching chunks ordered by score desc', () => {
    const chunks = [
      chunk('chunk-b1-s1-0', 'cats are cute small mammals'),
      chunk('chunk-b1-s1-1', 'dogs bark loudly at strangers'),
      chunk('chunk-b1-s1-2', 'the cat sat on the mat with another cat'),
    ];
    const ranked = bm25Rank('cat', chunks);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.score).toBeGreaterThan(0);
    // Chunks containing "cat" rank higher than the dog chunk
    const dogScore = ranked.find((r) => r.chunkId === ChunkId('chunk-b1-s1-1'))?.score ?? 0;
    const catScores = ranked
      .filter((r) => r.chunkId !== ChunkId('chunk-b1-s1-1'))
      .map((r) => r.score);
    for (const s of catScores) expect(s).toBeGreaterThan(dogScore);
  });

  it('returns empty for query with no overlap', () => {
    const chunks = [chunk('chunk-b1-s1-0', 'hello world')];
    const ranked = bm25Rank('zebra', chunks);
    expect(ranked).toHaveLength(0);
  });

  it('respects topN', () => {
    const chunks = Array.from({ length: 50 }, (_, i) =>
      chunk(`chunk-b1-s1-${String(i)}`, `cat number ${String(i)}`),
    );
    const ranked = bm25Rank('cat', chunks, undefined, 5);
    expect(ranked).toHaveLength(5);
  });

  it('handles empty corpus', () => {
    expect(bm25Rank('cat', [])).toEqual([]);
  });

  it('penalizes longer chunks for the same tf', () => {
    const short = chunk('chunk-b1-s1-0', 'cat');
    const long = chunk('chunk-b1-s1-1', 'cat ' + 'lorem '.repeat(50));
    const ranked = bm25Rank('cat', [short, long]);
    expect(ranked[0]?.chunkId).toBe(ChunkId('chunk-b1-s1-0'));
  });
});
```

- [ ] **Step 6: Implement `bm25.ts`**

Create `src/features/ai/retrieval/bm25.ts`:

```typescript
import type { ChunkId, TextChunk } from '@/domain';
import { tokenizeForBM25 } from './tokenize';

export type BM25Params = { readonly k1: number; readonly b: number };
export const BM25_DEFAULT: BM25Params = { k1: 1.2, b: 0.75 };

export type ScoredChunk = { readonly chunkId: ChunkId; readonly score: number };

export function bm25Rank(
  query: string,
  chunks: readonly TextChunk[],
  params: BM25Params = BM25_DEFAULT,
  topN = 30,
): readonly ScoredChunk[] {
  if (chunks.length === 0) return [];
  const queryTerms = tokenizeForBM25(query);
  if (queryTerms.length === 0) return [];

  const N = chunks.length;
  // Pre-tokenize each chunk; compute df per query term over the corpus.
  const tokenized = chunks.map((c) => tokenizeForBM25(c.normalizedText));
  const lengths = tokenized.map((t) => t.length);
  const avgLen = lengths.reduce((s, n) => s + n, 0) / N;

  const df = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    let count = 0;
    for (const toks of tokenized) {
      if (toks.includes(term)) count += 1;
    }
    df.set(term, count);
  }

  const { k1, b } = params;
  const scored: ScoredChunk[] = [];
  for (let i = 0; i < N; i++) {
    const toks = tokenized[i]!;
    const len = lengths[i]!;
    let score = 0;
    for (const term of queryTerms) {
      const dfT = df.get(term) ?? 0;
      if (dfT === 0) continue;
      // tf for this term in this chunk
      let tf = 0;
      for (const t of toks) if (t === term) tf += 1;
      if (tf === 0) continue;
      const idf = Math.log((N - dfT + 0.5) / (dfT + 0.5) + 1);
      const denom = tf + k1 * (1 - b + b * (len / (avgLen || 1)));
      score += idf * ((tf * (k1 + 1)) / denom);
    }
    if (score > 0) scored.push({ chunkId: chunks[i]!.id, score });
  }

  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, topN);
}
```

- [ ] **Step 7: Run BM25 tests**

Run: `pnpm vitest run src/features/ai/retrieval/bm25.test.ts`

Expected: PASS.

- [ ] **Step 8: Cosine — write failing test**

Create `src/features/ai/retrieval/cosine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cosineRank } from './cosine';
import { BookId, ChunkId, IsoTimestamp, type BookEmbedding } from '@/domain';

function unit(...components: number[]): Float32Array {
  const v = new Float32Array(components);
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

function emb(id: string, vec: Float32Array): BookEmbedding {
  return {
    id: ChunkId(id),
    bookId: BookId('b1'),
    vector: vec,
    chunkerVersion: 1,
    embeddingModelVersion: 1,
    embeddedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

describe('cosineRank', () => {
  it('returns chunks ordered by dot product (pre-normalized)', () => {
    const q = unit(1, 0);
    const embeddings = [
      emb('chunk-b1-s1-0', unit(1, 0)),    // identical → 1
      emb('chunk-b1-s1-1', unit(1, 1)),    // 45deg → ~0.707
      emb('chunk-b1-s1-2', unit(0, 1)),    // orthogonal → 0
    ];
    const ranked = cosineRank(q, embeddings);
    expect(ranked[0]?.chunkId).toBe(ChunkId('chunk-b1-s1-0'));
    expect(ranked[0]?.score).toBeCloseTo(1, 4);
    expect(ranked[1]?.chunkId).toBe(ChunkId('chunk-b1-s1-1'));
    expect(ranked[1]?.score).toBeCloseTo(Math.cos(Math.PI / 4), 4);
  });

  it('respects topN', () => {
    const q = unit(1, 0);
    const embeddings = Array.from({ length: 10 }, (_, i) =>
      emb(`chunk-b1-s1-${String(i)}`, unit(1, i / 10)),
    );
    const ranked = cosineRank(q, embeddings, 3);
    expect(ranked).toHaveLength(3);
  });

  it('returns empty when embeddings list is empty', () => {
    expect(cosineRank(unit(1, 0), [])).toEqual([]);
  });
});
```

- [ ] **Step 9: Implement `cosine.ts`**

Create `src/features/ai/retrieval/cosine.ts`:

```typescript
import type { BookEmbedding } from '@/domain';
import type { ScoredChunk } from './bm25';

export function cosineRank(
  queryVector: Float32Array,
  embeddings: readonly BookEmbedding[],
  topN = 30,
): readonly ScoredChunk[] {
  if (embeddings.length === 0) return [];
  const dim = queryVector.length;
  const scored: ScoredChunk[] = [];
  for (const e of embeddings) {
    if (e.vector.length !== dim) continue;
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += queryVector[i]! * e.vector[i]!;
    if (dot > 0) scored.push({ chunkId: e.id, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
```

- [ ] **Step 10: RRF — write failing test**

Create `src/features/ai/retrieval/rrf.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from './rrf';
import { ChunkId, type ChunkId as CIDType } from '@/domain';

const cid = (n: number): CIDType => ChunkId(`chunk-b1-s1-${String(n)}`);

describe('reciprocalRankFusion', () => {
  it('combines two rankings with default k=60', () => {
    const a = [
      { chunkId: cid(1), score: 10 },
      { chunkId: cid(2), score: 5 },
    ];
    const b = [
      { chunkId: cid(2), score: 8 },
      { chunkId: cid(3), score: 2 },
    ];
    const fused = reciprocalRankFusion([a, b]);
    // chunk 2 appears in both lists → highest fused score.
    expect(fused[0]?.chunkId).toBe(cid(2));
    expect(fused.map((s) => s.chunkId)).toEqual([cid(2), cid(1), cid(3)]);
  });

  it('one empty list preserves the other', () => {
    const a = [{ chunkId: cid(1), score: 10 }];
    const fused = reciprocalRankFusion([a, []]);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.chunkId).toBe(cid(1));
  });

  it('both empty → empty', () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it('respects custom k', () => {
    const a = [{ chunkId: cid(1), score: 10 }];
    const k60 = reciprocalRankFusion([a], 60)[0]?.score ?? 0;
    const k1 = reciprocalRankFusion([a], 1)[0]?.score ?? 0;
    expect(k1).toBeGreaterThan(k60);
  });
});
```

- [ ] **Step 11: Implement `rrf.ts`**

Create `src/features/ai/retrieval/rrf.ts`:

```typescript
import type { ChunkId } from '@/domain';
import type { ScoredChunk } from './bm25';

const RRF_DEFAULT_K = 60;

export function reciprocalRankFusion(
  rankings: readonly (readonly ScoredChunk[])[],
  k: number = RRF_DEFAULT_K,
): readonly ScoredChunk[] {
  const fused = new Map<ChunkId, number>();
  for (const list of rankings) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]!;
      const contribution = 1 / (k + rank + 1);
      fused.set(item.chunkId, (fused.get(item.chunkId) ?? 0) + contribution);
    }
  }
  return [...fused.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 12: Run all retrieval tests**

```bash
pnpm vitest run src/features/ai/retrieval/
```

Expected: PASS — tokenize, bm25, cosine, rrf.

- [ ] **Step 13: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add src/features/ai/retrieval/
git commit -m "feat(retrieval): pure helpers — tokenize, bm25Rank, cosineRank, rrf"
```

---

## Task 10: `assembleEvidenceBundle` + `buildEvidenceBundleForPreview`

**Files:**
- Create: `src/features/ai/retrieval/evidenceBundle.ts` (+test)

**Goal:** Pure assembler. Greedy-pack ranked chunks under a token budget; regroup by section in first-appearance order; sort within section by chunk-index. Emit citation tags `[1]…[N]` with reading-order grouping.

- [ ] **Step 1: Write failing test**

Create `src/features/ai/retrieval/evidenceBundle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { assembleEvidenceBundle, buildEvidenceBundleForPreview } from './evidenceBundle';
import { BookId, ChunkId, SectionId, type TextChunk } from '@/domain';

function chunk(
  bookId: string,
  sectionId: string,
  idx: number,
  sectionTitle: string,
  text: string,
  tokens: number,
): TextChunk {
  return {
    id: ChunkId(`chunk-${bookId}-${sectionId}-${String(idx)}`),
    bookId: BookId(bookId),
    sectionId: SectionId(sectionId),
    sectionTitle,
    text,
    normalizedText: text,
    tokenEstimate: tokens,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('assembleEvidenceBundle', () => {
  it('happy path: includes top chunks within budget', () => {
    const chunks = [
      chunk('b1', 's1', 0, 'Ch 1', 'one', 100),
      chunk('b1', 's1', 1, 'Ch 1', 'two', 100),
      chunk('b1', 's2', 0, 'Ch 2', 'three', 100),
    ];
    const ranked = chunks.map((c) => c.id);
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 250,
      minChunks: 1,
      maxChunks: 12,
    });
    expect(bundle.includedChunkIds).toHaveLength(2); // 100+100 fits, 3rd would exceed
    expect(bundle.totalTokens).toBe(200);
  });

  it('honors minChunks even past budget', () => {
    const chunks = [
      chunk('b1', 's1', 0, 'Ch 1', 'one', 1000),
      chunk('b1', 's1', 1, 'Ch 1', 'two', 1000),
      chunk('b1', 's1', 2, 'Ch 1', 'three', 1000),
    ];
    const bundle = assembleEvidenceBundle(
      chunks.map((c) => c.id),
      chunks,
      { budgetTokens: 100, minChunks: 3, maxChunks: 12 },
    );
    expect(bundle.includedChunkIds).toHaveLength(3);
  });

  it('honors maxChunks ceiling', () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      chunk('b1', 's1', i, 'Ch 1', `c${String(i)}`, 10),
    );
    const bundle = assembleEvidenceBundle(
      chunks.map((c) => c.id),
      chunks,
      { budgetTokens: 100000, minChunks: 1, maxChunks: 5 },
    );
    expect(bundle.includedChunkIds).toHaveLength(5);
  });

  it('regroups by section preserving first-appearance order', () => {
    const chunks = [
      chunk('b1', 's2', 0, 'Ch 2', 'two-zero', 50),
      chunk('b1', 's1', 1, 'Ch 1', 'one-one', 50),
      chunk('b1', 's2', 1, 'Ch 2', 'two-one', 50),
      chunk('b1', 's1', 0, 'Ch 1', 'one-zero', 50),
    ];
    // RRF order: s2-0, s1-1, s2-1, s1-0
    const ranked = [chunks[0]!.id, chunks[1]!.id, chunks[2]!.id, chunks[3]!.id];
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    // Section first-appearance: s2 then s1
    expect(bundle.sectionGroups[0]?.sectionId).toBe(SectionId('s2'));
    expect(bundle.sectionGroups[1]?.sectionId).toBe(SectionId('s1'));
    // Within each section, chunk-index order: s2-0,s2-1; s1-0,s1-1
    expect(bundle.sectionGroups[0]?.chunks.map((c) => c.chunk.id)).toEqual([
      ChunkId('chunk-b1-s2-0'),
      ChunkId('chunk-b1-s2-1'),
    ]);
    expect(bundle.sectionGroups[1]?.chunks.map((c) => c.chunk.id)).toEqual([
      ChunkId('chunk-b1-s1-0'),
      ChunkId('chunk-b1-s1-1'),
    ]);
  });

  it('citation tags are 1-indexed in RRF order via includedChunkIds', () => {
    const chunks = [
      chunk('b1', 's1', 0, 'Ch 1', 'a', 50),
      chunk('b1', 's2', 0, 'Ch 2', 'b', 50),
    ];
    const ranked = [chunks[1]!.id, chunks[0]!.id]; // section 2 first
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    // includedChunkIds reflects RRF order: ['chunk-b1-s2-0', 'chunk-b1-s1-0']
    expect(bundle.includedChunkIds[0]).toBe(ChunkId('chunk-b1-s2-0'));
    expect(bundle.includedChunkIds[1]).toBe(ChunkId('chunk-b1-s1-0'));
    // Citation tags: chunk-b1-s2-0 → tag 1, chunk-b1-s1-0 → tag 2
    const flat = bundle.sectionGroups.flatMap((g) =>
      g.chunks.map((c) => ({ id: c.chunk.id, tag: c.citationTag })),
    );
    expect(flat.find((f) => f.id === ChunkId('chunk-b1-s2-0'))?.tag).toBe(1);
    expect(flat.find((f) => f.id === ChunkId('chunk-b1-s1-0'))?.tag).toBe(2);
  });

  it('skips chunkIds with no matching TextChunk', () => {
    const chunks = [chunk('b1', 's1', 0, 'Ch 1', 'a', 50)];
    const ranked = [ChunkId('chunk-b1-s9-99'), chunks[0]!.id];
    const bundle = assembleEvidenceBundle(ranked, chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    expect(bundle.includedChunkIds).toEqual([chunks[0]!.id]);
  });
});

describe('buildEvidenceBundleForPreview', () => {
  it('renders citation tags + section headers in stable order', () => {
    const chunks = [chunk('b1', 's1', 0, 'Ch 1', 'alpha', 50)];
    const bundle = assembleEvidenceBundle(
      [chunks[0]!.id],
      chunks,
      { budgetTokens: 1000, minChunks: 1, maxChunks: 12 },
    );
    const preview = buildEvidenceBundleForPreview(bundle);
    expect(preview).toContain('### Ch 1');
    expect(preview).toContain('[1]');
    expect(preview).toContain('alpha');
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm vitest run src/features/ai/retrieval/evidenceBundle.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `evidenceBundle.ts`**

Create `src/features/ai/retrieval/evidenceBundle.ts`:

```typescript
import type { ChunkId, SectionId, TextChunk } from '@/domain';

export type EvidenceBundleOptions = {
  readonly budgetTokens: number;
  readonly minChunks: number;
  readonly maxChunks: number;
};

export type EvidenceBundleSection = {
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly chunks: readonly { readonly chunk: TextChunk; readonly citationTag: number }[];
};

export type EvidenceBundle = {
  readonly sectionGroups: readonly EvidenceBundleSection[];
  readonly includedChunkIds: readonly ChunkId[];
  readonly totalTokens: number;
};

function chunkIndexInSection(chunkId: ChunkId): number {
  // Phase 5.1 format: chunk-{bookId}-{sectionId}-{N}
  const m = /-(\d+)$/.exec(chunkId);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function assembleEvidenceBundle(
  rankedChunkIds: readonly ChunkId[],
  chunks: readonly TextChunk[],
  options: EvidenceBundleOptions,
): EvidenceBundle {
  const byId = new Map<ChunkId, TextChunk>();
  for (const c of chunks) byId.set(c.id, c);

  const included: TextChunk[] = [];
  let totalTokens = 0;
  for (const id of rankedChunkIds) {
    const c = byId.get(id);
    if (c === undefined) continue;
    if (included.length >= options.maxChunks) break;
    const wouldBe = totalTokens + c.tokenEstimate;
    const underBudget = wouldBe <= options.budgetTokens;
    const belowMin = included.length < options.minChunks;
    if (!underBudget && !belowMin) continue;
    included.push(c);
    totalTokens = wouldBe;
  }

  // Citation tags follow RRF (= rankedChunkIds) order.
  const tagById = new Map<ChunkId, number>();
  included.forEach((c, i) => {
    tagById.set(c.id, i + 1);
  });
  const includedChunkIds = included.map((c) => c.id);

  // Group by section in first-appearance order; sort within by chunk-index.
  const groupsBySection = new Map<SectionId, TextChunk[]>();
  const sectionOrder: SectionId[] = [];
  const sectionTitle = new Map<SectionId, string>();
  for (const c of included) {
    if (!groupsBySection.has(c.sectionId)) {
      groupsBySection.set(c.sectionId, []);
      sectionOrder.push(c.sectionId);
      sectionTitle.set(c.sectionId, c.sectionTitle);
    }
    groupsBySection.get(c.sectionId)!.push(c);
  }
  const sectionGroups: EvidenceBundleSection[] = sectionOrder.map((sid) => {
    const list = groupsBySection.get(sid)!;
    list.sort((a, b) => chunkIndexInSection(a.id) - chunkIndexInSection(b.id));
    return {
      sectionId: sid,
      sectionTitle: sectionTitle.get(sid) ?? '',
      chunks: list.map((c) => ({ chunk: c, citationTag: tagById.get(c.id)! })),
    };
  });

  return { sectionGroups, includedChunkIds, totalTokens };
}

export function buildEvidenceBundleForPreview(bundle: EvidenceBundle): string {
  const lines: string[] = [];
  for (const group of bundle.sectionGroups) {
    lines.push(`### ${group.sectionTitle}`);
    for (const { chunk, citationTag } of group.chunks) {
      lines.push(`[${String(citationTag)}] ${chunk.text}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm vitest run src/features/ai/retrieval/evidenceBundle.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/retrieval/evidenceBundle.ts src/features/ai/retrieval/evidenceBundle.test.ts
git commit -m "feat(retrieval): assembleEvidenceBundle + buildEvidenceBundleForPreview pure helpers"
```

---

## Task 11: `runRetrieval` orchestrator

**Files:**
- Create: `src/features/ai/retrieval/runRetrieval.ts` (+test)

**Goal:** Side-effectful orchestrator. Given a question and book ID, runs the full retrieval pipeline. Discriminated-union result for clean UI dispatch.

- [ ] **Step 1: Write failing tests**

Create `src/features/ai/retrieval/runRetrieval.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runRetrieval } from './runRetrieval';
import {
  BookId,
  ChunkId,
  IsoTimestamp,
  SectionId,
  type BookEmbedding,
  type TextChunk,
} from '@/domain';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import type { EmbedClient } from '@/features/library/indexing/embeddings/types';

function mkChunk(idx: number): TextChunk {
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Ch 1',
    text: `chunk ${String(idx)} text about cats`,
    normalizedText: `chunk ${String(idx)} text about cats`,
    tokenEstimate: 20,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

function mkEmbedding(idx: number): BookEmbedding {
  const v = new Float32Array(1536);
  for (let i = 0; i < 1536; i++) v[i] = idx === 0 ? 1 / Math.sqrt(1536) : (i + idx) / 1536;
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    vector: v,
    chunkerVersion: 1,
    embeddingModelVersion: 1,
    embeddedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
  };
}

function chunksRepoFromList(chunks: readonly TextChunk[]): BookChunksRepository {
  return {
    upsertMany: async () => {},
    listByBook: async () => chunks,
    listBySection: async () => [],
    deleteByBook: async () => {},
    deleteBySection: async () => {},
    countByBook: async () => chunks.length,
    countStaleVersions: async () => [],
    hasChunksFor: async () => true,
  };
}

function embeddingsRepoFromList(
  embeddings: readonly BookEmbedding[],
): BookEmbeddingsRepository {
  return {
    upsertMany: async () => {},
    listByBook: async () => embeddings,
    deleteByBook: async () => {},
    countByBook: async () => embeddings.length,
    hasEmbeddingFor: async () => true,
    countStaleVersions: async () => [],
    deleteOrphans: async () => 0,
  };
}

describe('runRetrieval', () => {
  it('happy path returns ok bundle', async () => {
    const chunks = [mkChunk(0), mkChunk(1), mkChunk(2)];
    const embeddings = chunks.map((_, i) => mkEmbedding(i));
    const embedClient: EmbedClient = {
      embed: async () => {
        const v = new Float32Array(1536);
        v[0] = 1;
        return { vectors: [v], usage: { prompt: 1 } };
      },
    };
    const result = await runRetrieval({
      bookId: BookId('b1'),
      question: 'what about cats',
      deps: {
        chunksRepo: chunksRepoFromList(chunks),
        embeddingsRepo: embeddingsRepoFromList(embeddings),
        embedClient,
      },
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.bundle.includedChunkIds.length).toBeGreaterThan(0);
  });

  it('returns no-embeddings when embeddings list is empty', async () => {
    const result = await runRetrieval({
      bookId: BookId('b1'),
      question: 'cats',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        embeddingsRepo: embeddingsRepoFromList([]),
        embedClient: {
          embed: async () => ({ vectors: [new Float32Array(1536)] }),
        },
      },
    });
    expect(result.kind).toBe('no-embeddings');
  });

  it('returns embed-failed when embedClient throws EmbedError-shaped error', async () => {
    const chunks = [mkChunk(0)];
    const embeddings = [mkEmbedding(0)];
    const result = await runRetrieval({
      bookId: BookId('b1'),
      question: 'cats',
      deps: {
        chunksRepo: chunksRepoFromList(chunks),
        embeddingsRepo: embeddingsRepoFromList(embeddings),
        embedClient: {
          embed: async () => {
            throw Object.assign(new Error('embed: invalid-key'), {
              failure: { reason: 'invalid-key', status: 401 },
            });
          },
        },
      },
    });
    expect(result.kind).toBe('embed-failed');
    if (result.kind === 'embed-failed') {
      expect(result.reason).toBe('invalid-key');
    }
  });

  it('returns no-results when fusion yields nothing matching', async () => {
    const chunks = [mkChunk(0)];
    const embeddings = [mkEmbedding(0)];
    // Question is gibberish unrelated to chunk text + query vector orthogonal to chunk vector.
    const orthogonalQ = new Float32Array(1536);
    orthogonalQ[1535] = 1;
    const result = await runRetrieval({
      bookId: BookId('b1'),
      question: 'zebra zebra zebra',
      deps: {
        chunksRepo: chunksRepoFromList(chunks),
        embeddingsRepo: embeddingsRepoFromList([
          { ...embeddings[0]!, vector: new Float32Array(1536) /* zero vector */ },
        ]),
        embedClient: {
          embed: async () => ({ vectors: [orthogonalQ] }),
        },
      },
    });
    expect(['no-results', 'ok']).toContain(result.kind);
    // If both BM25 and cosine return empty, runRetrieval emits 'no-results'.
    // If either is non-empty, 'ok' is acceptable; this test mainly exercises the wiring.
  });
});
```

- [ ] **Step 2: Implement `runRetrieval.ts`**

Create `src/features/ai/retrieval/runRetrieval.ts`:

```typescript
import type { BookId } from '@/domain';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import type { EmbedClient } from '@/features/library/indexing/embeddings/types';
import { CURRENT_EMBEDDING_MODEL_ID } from '@/features/library/indexing/embeddings/EMBEDDING_MODEL';
import { l2Normalize } from '@/features/library/indexing/embeddings/normalize';
import type { EmbedFailure } from '@/features/ai/chat/nanogptEmbeddings';
import { bm25Rank } from './bm25';
import { cosineRank } from './cosine';
import { reciprocalRankFusion } from './rrf';
import { assembleEvidenceBundle, type EvidenceBundle } from './evidenceBundle';

export type RetrievalDeps = {
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly embedClient: EmbedClient;
};

export type RetrievalResult =
  | { readonly kind: 'ok'; readonly bundle: EvidenceBundle }
  | { readonly kind: 'no-embeddings' }
  | { readonly kind: 'embed-failed'; readonly reason: EmbedFailure['reason'] }
  | { readonly kind: 'no-results' };

const BUDGET_TOKENS = 3000;
const MIN_CHUNKS = 3;
const MAX_CHUNKS = 12;

export async function runRetrieval(input: {
  readonly bookId: BookId;
  readonly question: string;
  readonly deps: RetrievalDeps;
  readonly signal?: AbortSignal;
}): Promise<RetrievalResult> {
  const { bookId, question, deps, signal } = input;
  const [chunks, embeddings] = await Promise.all([
    deps.chunksRepo.listByBook(bookId),
    deps.embeddingsRepo.listByBook(bookId),
  ]);

  if (embeddings.length === 0) return { kind: 'no-embeddings' };

  let queryVector: Float32Array;
  try {
    const result = await deps.embedClient.embed({
      modelId: CURRENT_EMBEDDING_MODEL_ID,
      inputs: [question],
      ...(signal !== undefined ? { signal } : {}),
    });
    queryVector = l2Normalize(result.vectors[0]!);
  } catch (err) {
    const failure = (err as { failure?: { reason?: EmbedFailure['reason'] } }).failure;
    return { kind: 'embed-failed', reason: failure?.reason ?? 'network' };
  }

  const [bm25, cosine] = await Promise.all([
    Promise.resolve(bm25Rank(question, chunks)),
    Promise.resolve(cosineRank(queryVector, embeddings)),
  ]);
  const fused = reciprocalRankFusion([bm25, cosine]);
  if (fused.length === 0) return { kind: 'no-results' };

  const bundle = assembleEvidenceBundle(
    fused.map((s) => s.chunkId),
    chunks,
    { budgetTokens: BUDGET_TOKENS, minChunks: MIN_CHUNKS, maxChunks: MAX_CHUNKS },
  );
  if (bundle.includedChunkIds.length === 0) return { kind: 'no-results' };
  return { kind: 'ok', bundle };
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/features/ai/retrieval/runRetrieval.test.ts`

Expected: PASS.

- [ ] **Step 4: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/retrieval/runRetrieval.ts src/features/ai/retrieval/runRetrieval.test.ts
git commit -m "feat(retrieval): runRetrieval orchestrator with no-embeddings / embed-failed / no-results variants"
```

---

## Task 12: `assembleRetrievalChatPrompt` + `RETRIEVAL_MODE_ADDENDUM` + `HISTORY_SOFT_CAP_RETRIEVAL`

**Files:**
- Modify: `src/features/ai/chat/promptAssembly.ts:8-12` (new soft-cap), `:71-78` (extend `effectiveSoftCap`), append new public function
- Modify: `src/features/ai/chat/promptAssembly.test.ts` (add retrieval suite)

- [ ] **Step 1: Write failing tests**

Append to `src/features/ai/chat/promptAssembly.test.ts`:

```typescript
import {
  assembleRetrievalChatPrompt,
  HISTORY_SOFT_CAP_RETRIEVAL,
} from './promptAssembly';
import { assembleEvidenceBundle } from '@/features/ai/retrieval/evidenceBundle';
import { BookId, ChunkId, SectionId, type TextChunk } from '@/domain';

function rChunk(idx: number, sec: string, secTitle: string, text: string): TextChunk {
  return {
    id: ChunkId(`chunk-b1-${sec}-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId(sec),
    sectionTitle: secTitle,
    text,
    normalizedText: text,
    tokenEstimate: text.length / 4,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('assembleRetrievalChatPrompt (Phase 5.2)', () => {
  it('combines open-mode prompt + RETRIEVAL_MODE_ADDENDUM in one system message', () => {
    const chunks = [rChunk(0, 's1', 'Ch 1', 'alpha')];
    const bundle = assembleEvidenceBundle([chunks[0]!.id], chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    const result = assembleRetrievalChatPrompt({
      book: { title: 'Book', author: 'Auth', format: 'epub' },
      history: [],
      newUserText: 'q?',
      bundle,
    });
    const sys = result.messages[0];
    expect(sys?.role).toBe('system');
    expect(sys?.content).toContain('numbered [1]');
    expect(sys?.content).toContain('Book');
  });

  it('embeds bundle text + new user text in last user message', () => {
    const chunks = [rChunk(0, 's1', 'Ch 1', 'alpha excerpt')];
    const bundle = assembleEvidenceBundle([chunks[0]!.id], chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    const result = assembleRetrievalChatPrompt({
      book: { title: 'Book', format: 'epub' },
      history: [],
      newUserText: 'why does the cat?',
      bundle,
    });
    const tail = result.messages[result.messages.length - 1];
    expect(tail?.role).toBe('user');
    expect(tail?.content).toContain('alpha excerpt');
    expect(tail?.content).toContain('[1]');
    expect(tail?.content).toContain('why does the cat?');
  });

  it('soft-cap drops to HISTORY_SOFT_CAP_RETRIEVAL when retrieval is in play', () => {
    const chunks = [rChunk(0, 's1', 'Ch 1', 'a')];
    const bundle = assembleEvidenceBundle([chunks[0]!.id], chunks, {
      budgetTokens: 1000,
      minChunks: 1,
      maxChunks: 12,
    });
    const longHistory = Array.from({ length: HISTORY_SOFT_CAP_RETRIEVAL * 2 + 6 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `m${String(i)}`, i, 'open'),
    );
    const result = assembleRetrievalChatPrompt({
      book: { title: 'Book', format: 'epub' },
      history: longHistory,
      newUserText: 'q?',
      bundle,
    });
    expect(result.historyDropped).toBeGreaterThan(0);
    // Preserved count should be HISTORY_SOFT_CAP_RETRIEVAL * 2 (pairs).
    const preservedHistMsgs = result.messages.length - 2; // minus system + tail user
    expect(preservedHistMsgs).toBeLessThanOrEqual(HISTORY_SOFT_CAP_RETRIEVAL * 2);
  });
});
```

(`msg` factory is defined at the top of the existing test file; reuse it.)

- [ ] **Step 2: Run — fails**

Run: `pnpm vitest run src/features/ai/chat/promptAssembly.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement extension to `promptAssembly.ts`**

In `src/features/ai/chat/promptAssembly.ts`:

After line 12 (existing soft-cap constants), add:

```typescript
export const HISTORY_SOFT_CAP_RETRIEVAL = 25;
```

After the `PASSAGE_MODE_ADDENDUM` block (around line 22), add:

```typescript
const RETRIEVAL_MODE_ADDENDUM =
  'The user has searched this book for relevant excerpts; they are ' +
  'numbered [1], [2], … below. Treat these as the primary evidence. ' +
  'Reference them by tag in your answer when you draw on a specific ' +
  'excerpt (e.g. "as discussed in [3]"). If the excerpts do not contain ' +
  'enough to answer, say so plainly and offer to help once they share more ' +
  'context. Do not invent excerpts that are not present.';
```

Update `effectiveSoftCap` (lines 71-78) to take a `thisModeIsRetrieval` flag (and re-order params for clarity):

```typescript
function effectiveSoftCap(
  history: readonly ChatMessage[],
  thisMode: 'open' | 'passage' | 'retrieval',
): number {
  if (thisMode === 'retrieval' || history.some((m) => m.mode === 'retrieval')) {
    return HISTORY_SOFT_CAP_RETRIEVAL;
  }
  if (thisMode === 'passage' || history.some((m) => m.mode === 'passage')) {
    return HISTORY_SOFT_CAP_PASSAGE;
  }
  return HISTORY_SOFT_CAP_OPEN;
}
```

Update the two call sites (`assembleOpenChatPrompt` line 106, `assemblePassageChatPrompt` line 150):

```typescript
// inside assembleOpenChatPrompt:
const cap = effectiveSoftCap(input.history, 'open');
// inside assemblePassageChatPrompt:
const cap = effectiveSoftCap(input.history, 'passage');
```

Append new types + function at the end of the file:

```typescript
import type { EvidenceBundle } from '@/features/ai/retrieval/evidenceBundle';
import { buildEvidenceBundleForPreview } from '@/features/ai/retrieval/evidenceBundle';

export type AssembleRetrievalChatInput = {
  readonly book: {
    readonly title: string;
    readonly author?: string;
    readonly format: BookFormat;
  };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
  readonly bundle: EvidenceBundle;
};

export function assembleRetrievalChatPrompt(
  input: AssembleRetrievalChatInput,
): AssembleOpenChatResult {
  const combinedSystem: ChatCompletionMessage = {
    role: 'system',
    content: `${buildOpenModeSystemPrompt(input.book)}\n\n${RETRIEVAL_MODE_ADDENDUM}`,
  };

  const cap = effectiveSoftCap(input.history, 'retrieval');
  const { preserved, dropFromFront } = preserveHistory(input.history, cap);
  const historyMsgs = historyToCompletionMessages(preserved);

  const bundleText = buildEvidenceBundleForPreview(input.bundle);
  const tail: ChatCompletionMessage = {
    role: 'user',
    content: `${bundleText}\n\n${input.newUserText}`,
  };

  return {
    messages: [combinedSystem, ...historyMsgs, tail],
    historyDropped: dropFromFront,
  };
}
```

(Move the new `import` lines to the top of the file alongside the existing imports — they cannot live after function declarations.)

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/features/ai/chat/promptAssembly.test.ts`

Expected: PASS — existing open + passage cases still pass; new retrieval suite passes.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/chat/promptAssembly.ts src/features/ai/chat/promptAssembly.test.ts
git commit -m "feat(ai): assembleRetrievalChatPrompt + RETRIEVAL_MODE_ADDENDUM + HISTORY_SOFT_CAP_RETRIEVAL"
```

---

## Task 13: `useChatSend` accepts `attachedRetrieval` + `retrievalDeps`

**Files:**
- Modify: `src/features/ai/chat/useChatSend.ts:21-40` (new type + Args), `:91-146` (send-time branching)
- Modify: `src/features/ai/chat/useChatSend.test.ts` (new suite)

**Goal:** Add the `attachedRetrieval` branch ahead of the existing `attachedPassage` branch. When set, run `runRetrieval` first; on `ok`, route through `assembleRetrievalChatPrompt` with `mode: 'retrieval'`. Persist `contextRefs` of `{kind: 'chunk', chunkId}` on the assistant only, in citation order.

- [ ] **Step 1: Write failing tests**

Append to `src/features/ai/chat/useChatSend.test.ts`:

```typescript
import { runRetrieval } from '@/features/ai/retrieval/runRetrieval';
import type { RetrievalDeps, RetrievalResult } from '@/features/ai/retrieval/runRetrieval';
import type { AttachedRetrieval } from './useChatSend';
import {
  BookId,
  ChunkId,
  IsoTimestamp,
  SectionId,
  type BookEmbedding,
  type TextChunk,
} from '@/domain';

function fakeRetrievalDeps(result: RetrievalResult): RetrievalDeps {
  // We bypass the helpers; the test stubs the orchestrator output by injecting
  // a custom retrievalRunner via test-only overload (see implementation note).
  // For this scaffold, we use real chunksRepo + embeddingsRepo stubs that
  // deterministically yield the desired runRetrieval result.
  // Cleaner alternative: see Step 3 — useChatSend exposes an internal
  // retrievalRunner override prop solely for tests.
  return {} as RetrievalDeps; // placeholder
}

describe('useChatSend with attachedRetrieval (Phase 5.2)', () => {
  it('mode=retrieval set on both messages; contextRefs on assistant only', async () => {
    // Implementation note: useChatSend accepts a `retrievalRunner` test-only
    // override that bypasses runRetrieval. See Step 3.
    const chunks: TextChunk[] = [
      {
        id: ChunkId('chunk-b1-s1-0'),
        bookId: BookId('b1'),
        sectionId: SectionId('s1'),
        sectionTitle: 'Ch 1',
        text: 'alpha',
        normalizedText: 'alpha',
        tokenEstimate: 2,
        locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
        checksum: 'cs',
        chunkerVersion: 1,
      },
    ];
    const bundle = {
      sectionGroups: [
        {
          sectionId: SectionId('s1'),
          sectionTitle: 'Ch 1',
          chunks: [{ chunk: chunks[0]!, citationTag: 1 }],
        },
      ],
      includedChunkIds: [ChunkId('chunk-b1-s1-0')],
      totalTokens: 2,
    };
    const ar: AttachedRetrieval = { bookId: BookId('b1') };

    const append = vi.fn(async () => {});
    const patch = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('t-1'),
        modelId: 'gpt-x',
        getApiKey: () => 'KEY',
        book: { title: 'T', format: 'epub' },
        history: [],
        append,
        patch,
        finalize,
        streamFactory: () => mkStream([{ kind: 'delta', text: 'ok' }, { kind: 'done' }]),
        attachedRetrieval: ar,
        retrievalDeps: {} as RetrievalDeps,
        retrievalRunner: async () => ({ kind: 'ok', bundle }),
      }),
    );

    act(() => {
      result.current.send('explain');
    });
    await waitFor(() => {
      expect(append).toHaveBeenCalledTimes(2);
    });

    const userMsg = append.mock.calls[0]?.[0];
    const assistantMsg = append.mock.calls[1]?.[0];
    expect(userMsg.mode).toBe('retrieval');
    expect(assistantMsg.mode).toBe('retrieval');
    expect(userMsg.contextRefs).toEqual([]);
    expect(assistantMsg.contextRefs).toEqual([
      { kind: 'chunk', chunkId: 'chunk-b1-s1-0' },
    ]);
  });

  it('renders inline error when retrievalRunner returns no-embeddings', async () => {
    const append = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('t-1'),
        modelId: 'gpt-x',
        getApiKey: () => 'KEY',
        book: { title: 'T', format: 'epub' },
        history: [],
        append,
        patch: vi.fn(async () => {}),
        finalize,
        streamFactory: () => mkStream([{ kind: 'done' }]),
        attachedRetrieval: { bookId: BookId('b1') },
        retrievalDeps: {} as RetrievalDeps,
        retrievalRunner: async () => ({ kind: 'no-embeddings' }),
      }),
    );

    act(() => {
      result.current.send('explain');
    });
    await waitFor(() => {
      expect(finalize).toHaveBeenCalled();
    });
    const finalizeCall = finalize.mock.calls[finalize.mock.calls.length - 1]?.[1];
    expect(finalizeCall.content).toMatch(/still being prepared|no embeddings/i);
  });
});
```

- [ ] **Step 2: Add `AttachedRetrieval` type + extended Args**

In `src/features/ai/chat/useChatSend.ts`, replace lines 21-40 (the Args block + AttachedPassage adjacency) with:

Add after `AttachedPassage`:

```typescript
// Phase 5.2 retrieval mode. Carries bookId for clarity and forward-compat
// with cross-book retrieval. Distinct from passage mode: retrieval is
// one-shot per send (chip clears on send), and the actual retrieved chunks
// are determined at send-time, not chip-attach-time.
export type AttachedRetrieval = {
  readonly bookId: BookId;
};
```

(Add `BookId` to the imports at line 4-9 if not already imported.)

Replace the `Args` type to include the new fields:

```typescript
type Args = {
  readonly threadId: ChatThreadId;
  readonly modelId: string;
  readonly getApiKey: () => string | null;
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly history: readonly ChatMessage[];
  readonly append: (msg: ChatMessage) => Promise<void>;
  readonly patch: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
  readonly finalize: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
  readonly streamFactory?: typeof streamChatCompletion;
  readonly attachedPassage?: AttachedPassage | null;
  readonly attachedRetrieval?: AttachedRetrieval | null;
  readonly retrievalDeps?: RetrievalDeps;
  readonly retrievalRunner?: typeof runRetrieval;
};
```

Add imports near the top of the file:

```typescript
import { runRetrieval, type RetrievalDeps } from '@/features/ai/retrieval/runRetrieval';
import { assembleRetrievalChatPrompt } from './promptAssembly';
```

- [ ] **Step 3: Branch the send logic**

Replace the send body (lines 77-197) — specifically, the section that builds `contextRefs` + assembles the prompt + creates the actor. Before the existing passage check:

```typescript
  const send = useCallback((userText: string): void => {
    const a = argsRef.current;
    const apiKey = a.getApiKey();
    if (apiKey === null) {
      setFailure({ reason: 'invalid-key', status: 401 });
      setState('error');
      return;
    }
    lastInputRef.current = userText;
    const userMsgId = nextId('u');
    const assistantMsgId = nextId('a');
    const now = IsoTimestamp(new Date().toISOString());
    const nowPlus = IsoTimestamp(new Date(Date.now() + 1).toISOString());

    const retrieval = a.attachedRetrieval ?? null;
    const passage = a.attachedPassage ?? null;
    const isRetrieval = retrieval !== null;
    const isPassage = !isRetrieval && passage !== null;
    const mode: ChatMessage['mode'] = isRetrieval ? 'retrieval' : isPassage ? 'passage' : 'open';

    if (isRetrieval) {
      // Retrieval needs an async runRetrieval before assembly. Append both
      // messages first (placeholder assistant content), then run retrieval +
      // either stream or finalize-with-error.
      void a.append({
        id: userMsgId,
        threadId: a.threadId,
        role: 'user',
        content: userText,
        mode: 'retrieval',
        contextRefs: [],
        createdAt: now,
      });
      void a.append({
        id: assistantMsgId,
        threadId: a.threadId,
        role: 'assistant',
        content: '',
        mode: 'retrieval',
        contextRefs: [],
        streaming: true,
        createdAt: nowPlus,
      });

      void (async () => {
        const runner = a.retrievalRunner ?? runRetrieval;
        if (a.retrievalDeps === undefined) {
          await a.finalize(assistantMsgId, {
            content: 'Retrieval is not configured for this book.',
            streaming: false,
          });
          setState('idle');
          return;
        }
        const result = await runner({
          bookId: retrieval.bookId,
          question: userText,
          deps: a.retrievalDeps,
        });
        if (result.kind === 'no-embeddings') {
          await a.finalize(assistantMsgId, {
            content:
              'This book is still being prepared for AI. Wait for the library card to show ✓ Indexed and try again.',
            streaming: false,
          });
          setState('idle');
          return;
        }
        if (result.kind === 'no-results') {
          await a.finalize(assistantMsgId, {
            content:
              'No relevant excerpts found for that question. Try rephrasing or asking about a different topic from the book.',
            streaming: false,
          });
          setState('idle');
          return;
        }
        if (result.kind === 'embed-failed') {
          setFailure({ reason: result.reason, status: 500 } as ChatCompletionFailure);
          await a.finalize(assistantMsgId, {
            content: '',
            streaming: false,
            truncated: true,
          });
          setState('error');
          return;
        }

        // ok — patch contextRefs onto assistant message and run assembly.
        const refs = result.bundle.includedChunkIds.map((id) => ({
          kind: 'chunk' as const,
          chunkId: id,
        }));
        await a.patch(assistantMsgId, { contextRefs: refs });

        const assembled = assembleRetrievalChatPrompt({
          book: a.book,
          history: a.history,
          newUserText: userText,
          bundle: result.bundle,
        });
        const factory = a.streamFactory ?? streamChatCompletion;
        const machine = makeChatRequestMachine({
          streamFactory: (assembled2, modelId, signal) =>
            factory({ apiKey, modelId, messages: assembled2.messages, signal }),
          onDelta: async (id, fields) => {
            setPartial(fields.content);
            await a.patch(id, fields);
          },
          finalize: async (id, fields) => {
            await a.finalize(id, fields);
          },
        });
        actorRef.current?.stop();
        const actor = createActor(machine, {
          input: {
            threadId: a.threadId,
            pendingUserMessageId: userMsgId,
            pendingAssistantMessageId: assistantMsgId,
            modelId: a.modelId,
            assembled,
          },
        });
        actor.subscribe((snap) => {
          if (snap.status === 'done') {
            if (snap.value === 'failed') {
              const ctxFailure = (snap.context as { failure?: ChatCompletionFailure }).failure;
              if (ctxFailure) setFailure(ctxFailure);
              setState('error');
            } else if (snap.value === 'aborted') {
              setState('aborted');
            } else {
              setState('idle');
            }
          }
        });
        actorRef.current = actor;
        setState('streaming');
        setPartial('');
        setFailure(null);
        actor.start();
      })();
      return;
    }

    // (existing passage / open path follows unchanged)
    const assistantContextRefs: readonly ContextRef[] = isPassage
      ? [
          {
            kind: 'passage',
            text: passage!.text,
            anchor: passage!.anchor,
            ...(passage!.sectionTitle !== undefined && { sectionTitle: passage!.sectionTitle }),
            ...(passage!.windowBefore !== undefined && { windowBefore: passage!.windowBefore }),
            ...(passage!.windowAfter !== undefined && { windowAfter: passage!.windowAfter }),
          },
        ]
      : [];

    void a.append({
      id: userMsgId,
      threadId: a.threadId,
      role: 'user',
      content: userText,
      mode,
      contextRefs: [],
      createdAt: now,
    });
    void a.append({
      id: assistantMsgId,
      threadId: a.threadId,
      role: 'assistant',
      content: '',
      mode,
      contextRefs: assistantContextRefs,
      streaming: true,
      createdAt: nowPlus,
    });

    const assembled = isPassage
      ? assemblePassageChatPrompt({
          book: a.book,
          history: a.history,
          newUserText: userText,
          passage: {
            text: passage!.text,
            ...(passage!.windowBefore !== undefined && { windowBefore: passage!.windowBefore }),
            ...(passage!.windowAfter !== undefined && { windowAfter: passage!.windowAfter }),
            ...(passage!.sectionTitle !== undefined && { sectionTitle: passage!.sectionTitle }),
          },
        })
      : assembleOpenChatPrompt({
          book: a.book,
          history: a.history,
          newUserText: userText,
        });

    const factory = a.streamFactory ?? streamChatCompletion;

    const machine = makeChatRequestMachine({
      streamFactory: (assembled2, modelId, signal) =>
        factory({ apiKey, modelId, messages: assembled2.messages, signal }),
      onDelta: async (id, fields) => {
        setPartial(fields.content);
        await a.patch(id, fields);
      },
      finalize: async (id, fields) => {
        await a.finalize(id, fields);
      },
    });

    actorRef.current?.stop();
    const actor = createActor(machine, {
      input: {
        threadId: a.threadId,
        pendingUserMessageId: userMsgId,
        pendingAssistantMessageId: assistantMsgId,
        modelId: a.modelId,
        assembled,
      },
    });

    actor.subscribe((snap) => {
      if (snap.status === 'done') {
        if (snap.value === 'failed') {
          const ctxFailure = (snap.context as { failure?: ChatCompletionFailure }).failure;
          if (ctxFailure) setFailure(ctxFailure);
          setState('error');
        } else if (snap.value === 'aborted') {
          setState('aborted');
        } else {
          setState('idle');
        }
      }
    });

    actorRef.current = actor;
    setState('streaming');
    setPartial('');
    setFailure(null);
    actor.start();
  }, []);
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/features/ai/chat/useChatSend.test.ts`

Expected: PASS — existing open + passage tests pass; new retrieval suite passes.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/chat/useChatSend.ts src/features/ai/chat/useChatSend.test.ts
git commit -m "feat(ai): useChatSend accepts attachedRetrieval + retrievalDeps; mode=retrieval on send"
```

---

## Task 14: `RetrievalChip` component

**Files:**
- Create: `src/features/ai/chat/RetrievalChip.tsx` (+test)

**Goal:** Mirror PassageChip in shape but show "🔍 Searching this book" with a dismiss button.

- [ ] **Step 1: Write failing test**

Create `src/features/ai/chat/RetrievalChip.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RetrievalChip } from './RetrievalChip';

describe('RetrievalChip', () => {
  it('renders the searching label', () => {
    render(<RetrievalChip onDismiss={() => {}} />);
    expect(screen.getByText(/searching this book/i)).toBeInTheDocument();
  });

  it('exposes role=status with aria-live=polite', () => {
    render(<RetrievalChip onDismiss={() => {}} />);
    const chip = screen.getByRole('status');
    expect(chip.getAttribute('aria-live')).toBe('polite');
  });

  it('calls onDismiss when the × button is clicked', () => {
    const onDismiss = vi.fn();
    render(<RetrievalChip onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement**

Create `src/features/ai/chat/RetrievalChip.tsx`:

```typescript
type Props = {
  readonly onDismiss: () => void;
};

export function RetrievalChip({ onDismiss }: Props) {
  return (
    <div
      className="retrieval-chip"
      role="status"
      aria-live="polite"
      aria-label="Searching this book for relevant excerpts"
    >
      <span className="retrieval-chip__icon" aria-hidden="true">
        🔍
      </span>
      <span className="retrieval-chip__body">
        <span className="retrieval-chip__text">Searching this book</span>
      </span>
      <button
        type="button"
        className="retrieval-chip__dismiss"
        aria-label="Dismiss book search"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add CSS**

In `src/features/ai/chat/chat-panel.css`, after the `.passage-chip__dismiss:focus-visible` rule (around line 234), append:

```css
.retrieval-chip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: color-mix(in oklab, var(--color-accent) 10%, var(--color-surface));
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  margin: 0 var(--space-3) var(--space-2);
  font-size: var(--text-sm);
}
.retrieval-chip__icon { font-size: var(--text-base); }
.retrieval-chip__body { flex: 1; min-width: 0; }
.retrieval-chip__text { color: var(--color-text); }
.retrieval-chip__dismiss {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
}
.retrieval-chip__dismiss:hover { color: var(--color-text); }
.retrieval-chip__dismiss:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm vitest run src/features/ai/chat/RetrievalChip.test.tsx
pnpm check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/chat/RetrievalChip.tsx src/features/ai/chat/RetrievalChip.test.tsx src/features/ai/chat/chat-panel.css
git commit -m "feat(chat): RetrievalChip — sticky chip with dismiss"
```

---

## Task 15: `ChatComposer` search toggle button + `aria-pressed`

**Files:**
- Create: `src/shared/icons/SearchIcon.tsx`
- Modify: `src/shared/icons/index.ts` (export)
- Modify: `src/features/ai/chat/ChatComposer.tsx:8-19` (extend Props), `:65-101` (add toggle button)
- Modify: `src/features/ai/chat/ChatComposer.test.tsx` (or create if absent)

- [ ] **Step 1: Create the SearchIcon**

Create `src/shared/icons/SearchIcon.tsx`:

```typescript
import './icon.css';

type Props = { readonly size?: number };

export function SearchIcon({ size = 16 }: Props) {
  return (
    <svg
      className="icon"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
```

In `src/shared/icons/index.ts`, append:

```typescript
export { SearchIcon } from './SearchIcon';
```

- [ ] **Step 2: Extend `ChatComposer` props**

In `src/features/ai/chat/ChatComposer.tsx`:

Replace the `Props` block (lines 8-19) with:

```typescript
type Props = {
  readonly disabled?: boolean;
  readonly streaming: boolean;
  readonly placeholder: string;
  readonly onSend: (text: string) => void;
  readonly onCancel: () => void;
  readonly focusRequest?: { current: boolean };
  readonly onToggleSearch?: () => void;
  readonly retrievalAttached?: boolean;
};
```

Update the destructure in the function signature (line 27-34) to include `onToggleSearch` and `retrievalAttached`.

Add `SearchIcon` to the import (line 2):

```typescript
import { SearchIcon, SendIcon, StopIcon } from '@/shared/icons';
```

Inside the rendered `<form>`, before the existing `<button type={streaming ? 'button' : 'submit'}>` (line 92), add:

```typescript
      {onToggleSearch !== undefined ? (
        <button
          type="button"
          className={
            retrievalAttached
              ? 'chat-composer__search-toggle chat-composer__search-toggle--active'
              : 'chat-composer__search-toggle'
          }
          aria-label={retrievalAttached ? 'Cancel book search' : 'Search this book'}
          aria-pressed={retrievalAttached === true}
          onClick={onToggleSearch}
        >
          <SearchIcon size={14} />
        </button>
      ) : null}
```

In `src/features/ai/chat/chat-composer.css` (find via `ls`), append:

```css
.chat-composer__search-toggle {
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  padding: var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chat-composer__search-toggle:hover {
  color: var(--color-text);
  background: var(--color-surface);
}
.chat-composer__search-toggle--active {
  background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface));
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.chat-composer__search-toggle:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
```

- [ ] **Step 3: Tests (component-level)**

Create `src/features/ai/chat/ChatComposer.test.tsx` (if it doesn't exist):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatComposer } from './ChatComposer';

describe('ChatComposer search toggle (Phase 5.2)', () => {
  it('hides the toggle when onToggleSearch is undefined', () => {
    render(
      <ChatComposer
        streaming={false}
        placeholder="Ask"
        onSend={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /search this book|cancel book search/i }))
      .toBeNull();
  });

  it('shows toggle, aria-pressed=false when not attached', () => {
    render(
      <ChatComposer
        streaming={false}
        placeholder="Ask"
        onSend={() => {}}
        onCancel={() => {}}
        onToggleSearch={() => {}}
        retrievalAttached={false}
      />,
    );
    const btn = screen.getByRole('button', { name: /search this book/i });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('aria-pressed=true and label flips to "Cancel book search" when active', () => {
    render(
      <ChatComposer
        streaming={false}
        placeholder="Ask"
        onSend={() => {}}
        onCancel={() => {}}
        onToggleSearch={() => {}}
        retrievalAttached={true}
      />,
    );
    const btn = screen.getByRole('button', { name: /cancel book search/i });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('click fires onToggleSearch', () => {
    const fn = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        placeholder="Ask"
        onSend={() => {}}
        onCancel={() => {}}
        onToggleSearch={fn}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /search this book/i }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm vitest run src/features/ai/chat/ChatComposer.test.tsx
pnpm check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/icons/SearchIcon.tsx src/shared/icons/index.ts src/features/ai/chat/ChatComposer.tsx src/features/ai/chat/ChatComposer.test.tsx src/features/ai/chat/chat-composer.css
git commit -m "feat(chat): ChatComposer search toggle button + aria-pressed state"
```

---

## Task 16: `ChatPanel` — single chip slot (XOR); thread `retrievalDeps`

**Files:**
- Modify: `src/features/ai/chat/ChatPanel.tsx:32-55` (extend Props), `:88-100` (thread to useChatSend), `:229-256` (chip slot becomes XOR)

- [ ] **Step 1: Extend Props**

In `src/features/ai/chat/ChatPanel.tsx`, replace lines 32-55 (the `Props` block) with:

```typescript
type Props = {
  readonly bookId: string;
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly apiKeyState: ApiKeyState;
  readonly getApiKey: () => string | null;
  readonly selectedModelId: string | null;
  readonly threadsRepo: ChatThreadsRepository;
  readonly messagesRepo: ChatMessagesRepository;
  readonly savedAnswersRepo: SavedAnswersRepository;
  readonly onOpenSettings: () => void;
  readonly onCollapse: () => void;
  readonly hintShown: boolean;
  readonly onHintDismiss: () => void;
  readonly attachedPassage?: AttachedPassage | null;
  readonly onClearAttachedPassage?: () => void;
  readonly attachedRetrieval?: AttachedRetrieval | null;
  readonly onClearAttachedRetrieval?: () => void;
  readonly onToggleSearch?: () => void;
  readonly retrievalDeps?: RetrievalDeps;
  readonly onJumpToReaderAnchor?: (anchor: HighlightAnchor) => void;
  readonly resolveChunkAnchor?: (chunkId: ChunkId) => Promise<LocationAnchor | null>;
  readonly composerFocusRef?: { current: boolean };
};
```

Add imports near the top:

```typescript
import { useChatSend, type AttachedPassage, type AttachedRetrieval } from './useChatSend';
import type { RetrievalDeps } from '@/features/ai/retrieval/runRetrieval';
import type { ChunkId, LocationAnchor } from '@/domain';
import { RetrievalChip } from './RetrievalChip';
```

(Replace the existing `useChatSend, type AttachedPassage` import line.)

- [ ] **Step 2: Thread `attachedRetrieval` and `retrievalDeps` to `useChatSend`**

Replace the existing `const send = useChatSend({...})` block (lines 90-100) with:

```typescript
  const attachedPassage = props.attachedPassage ?? null;
  const attachedRetrieval = props.attachedRetrieval ?? null;

  const send = useChatSend({
    threadId: activeThreadId,
    modelId: props.selectedModelId ?? '',
    getApiKey: props.getApiKey,
    book: props.book,
    history: messages.list,
    append: messages.append,
    patch: messages.patch,
    finalize: messages.finalize,
    attachedPassage,
    attachedRetrieval,
    ...(props.retrievalDeps !== undefined && { retrievalDeps: props.retrievalDeps }),
  });
```

- [ ] **Step 3: Make the chip slot XOR**

Replace the chip-slot JSX (existing block around lines 231-239 — the `{attachedPassage !== null && props.onClearAttachedPassage ? <PassageChip … /> : null}`) with:

```typescript
          {attachedRetrieval !== null && props.onClearAttachedRetrieval ? (
            <RetrievalChip onDismiss={props.onClearAttachedRetrieval} />
          ) : attachedPassage !== null && props.onClearAttachedPassage ? (
            <PassageChip
              text={attachedPassage.text}
              {...(attachedPassage.sectionTitle !== undefined && {
                sectionTitle: attachedPassage.sectionTitle,
              })}
              onDismiss={props.onClearAttachedPassage}
            />
          ) : null}
```

- [ ] **Step 4: Pass `onToggleSearch` and `retrievalAttached` into `ChatComposer`**

Replace the existing `<ChatComposer …/>` block (lines 246-255) with:

```typescript
          <ChatComposer
            disabled={false}
            streaming={send.state === 'streaming'}
            placeholder={`Ask about ${props.book.title}`}
            onSend={(text) => {
              handleSendNew(text);
            }}
            onCancel={send.cancel}
            {...(props.composerFocusRef && { focusRequest: props.composerFocusRef })}
            {...(props.onToggleSearch !== undefined && { onToggleSearch: props.onToggleSearch })}
            retrievalAttached={attachedRetrieval !== null}
          />
```

- [ ] **Step 5: Pass `attachedRetrieval` to `PrivacyPreview`**

Update the `<PrivacyPreview .../>` call (line 240-245) to include the new prop:

```typescript
          <PrivacyPreview
            book={props.book}
            modelId={props.selectedModelId ?? ''}
            historyCount={messages.list.length}
            attachedPassage={attachedPassage}
            attachedRetrieval={attachedRetrieval}
            chunksRepo={props.retrievalDeps?.chunksRepo}
            embeddingsRepo={props.retrievalDeps?.embeddingsRepo}
          />
```

(`PrivacyPreview` will be extended in Task 18 to consume these.)

- [ ] **Step 6: Update `handleSelectThread` to clear retrieval too**

Replace the existing `handleSelectThread` (lines 149-157) with:

```typescript
  const handleSelectThread = useCallback(
    (id: ChatThreadId): void => {
      props.onClearAttachedPassage?.();
      props.onClearAttachedRetrieval?.();
      threads.setActive(id);
    },
    [threads, props],
  );
```

- [ ] **Step 7: Run tests + check**

```bash
pnpm check
```

Expected: PASS. Existing ChatPanel-touching tests still pass (no ChatPanel.test.tsx exists — coverage is via E2E in Task 22).

- [ ] **Step 8: Commit**

```bash
git add src/features/ai/chat/ChatPanel.tsx
git commit -m "feat(chat): ChatPanel — single chip slot (retrieval XOR passage); thread retrievalDeps"
```

---

## Task 17: `MessageBubble` multi-source footer

**Files:**
- Modify: `src/features/ai/chat/MessageBubble.tsx:6-13` (extend Props), `:42-79` (extract single-source footer + add multi-source)
- Modify: `src/features/ai/chat/MessageBubble.test.tsx` (add multi-source suite)

**Goal:** When `contextRefs` contains 2+ refs (passage or chunk variants), render a multi-source footer with citation chips grouped by section.

- [ ] **Step 1: Write failing tests**

Append to `src/features/ai/chat/MessageBubble.test.tsx`:

```typescript
import type { ChunkId, LocationAnchor } from '@/domain';

describe('MessageBubble — multi-source (Phase 5.2)', () => {
  it('renders multi-source footer when assistant message has 2+ chunk refs', async () => {
    const onJumpToSource = vi.fn();
    const resolveChunkAnchor = vi.fn(async (id: ChunkId): Promise<LocationAnchor> => ({
      kind: 'epub-cfi',
      cfi: `/cfi/${id}`,
    }));
    const message = mk({
      role: 'assistant',
      contextRefs: [
        { kind: 'chunk', chunkId: 'chunk-b1-s1-0' },
        { kind: 'chunk', chunkId: 'chunk-b1-s2-0' },
      ],
    });
    render(
      <MessageBubble
        message={message}
        onJumpToSource={onJumpToSource}
        resolveChunkAnchor={resolveChunkAnchor}
      />,
    );
    // The footer renders citation chips [1] and [2].
    expect(screen.getAllByText(/\[1\]|\[2\]/)).toHaveLength(2);
  });

  it('falls back to single-source footer for one passage ref (existing behavior)', () => {
    const message = mk({
      role: 'assistant',
      contextRefs: [
        {
          kind: 'passage',
          text: 'old text',
          anchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
        },
      ],
    });
    render(<MessageBubble message={message} onJumpToSource={() => {}} />);
    expect(screen.getByText(/Source:/)).toBeInTheDocument();
  });

  it('clicking a citation chip calls onJumpToSource with resolved anchor', async () => {
    const onJumpToSource = vi.fn();
    const resolveChunkAnchor = vi.fn(async (): Promise<LocationAnchor> => ({
      kind: 'epub-cfi',
      cfi: '/resolved',
    }));
    const message = mk({
      role: 'assistant',
      contextRefs: [
        { kind: 'chunk', chunkId: 'chunk-b1-s1-0' },
        { kind: 'chunk', chunkId: 'chunk-b1-s2-0' },
      ],
    });
    render(
      <MessageBubble
        message={message}
        onJumpToSource={onJumpToSource}
        resolveChunkAnchor={resolveChunkAnchor}
      />,
    );
    const chip = screen.getAllByRole('button', { name: /Jump to source/i })[0];
    fireEvent.click(chip!);
    await waitFor(() => {
      expect(onJumpToSource).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Implement extension**

In `src/features/ai/chat/MessageBubble.tsx`, replace the entire file body with:

```typescript
import { useEffect, useState } from 'react';
import type { ChatMessage, ChatMessageId, ChunkId, ContextRef, LocationAnchor } from '@/domain';
import type { HighlightAnchor } from '@/domain/annotations/types';
import { SaveAnswerIcon } from '@/shared/icons';
import './message-bubble.css';

type Props = {
  readonly message: ChatMessage;
  readonly onSave?: (id: ChatMessageId) => void;
  readonly onJumpToSource?: (anchor: HighlightAnchor | LocationAnchor) => void;
  readonly resolveChunkAnchor?: (chunkId: ChunkId) => Promise<LocationAnchor | null>;
};

const SOURCE_SNIPPET_CAP = 40;

function snippetForFooter(text: string): string {
  if (text.length <= SOURCE_SNIPPET_CAP) return text;
  return text.slice(0, SOURCE_SNIPPET_CAP).trimEnd() + '…';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  return new Date(iso).toLocaleDateString();
}

type SourceRef =
  | (Extract<ContextRef, { kind: 'passage' }> & { citationTag: number })
  | (Extract<ContextRef, { kind: 'chunk' }> & { citationTag: number });

function SingleSourceFooter({
  passageRef,
  onJumpToSource,
}: {
  readonly passageRef: Extract<ContextRef, { kind: 'passage' }>;
  readonly onJumpToSource: (anchor: HighlightAnchor) => void;
}) {
  return (
    <button
      type="button"
      className="message-bubble__source-footer"
      aria-label={
        passageRef.sectionTitle !== undefined
          ? `Jump to passage from ${passageRef.sectionTitle}`
          : 'Jump to source'
      }
      onClick={() => {
        onJumpToSource(passageRef.anchor);
      }}
    >
      <span aria-hidden="true">📎</span>
      <span>Source: &ldquo;{snippetForFooter(passageRef.text)}&rdquo;</span>
      <span aria-hidden="true">→</span>
    </button>
  );
}

function MultiSourceFooter({
  refs,
  onJumpToSource,
  resolveChunkAnchor,
}: {
  readonly refs: readonly SourceRef[];
  readonly onJumpToSource: (anchor: LocationAnchor | HighlightAnchor) => void;
  readonly resolveChunkAnchor?: (chunkId: ChunkId) => Promise<LocationAnchor | null>;
}) {
  const [resolved, setResolved] = useState<Map<ChunkId, LocationAnchor>>(new Map());
  useEffect(() => {
    if (resolveChunkAnchor === undefined) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<ChunkId, LocationAnchor>();
      for (const r of refs) {
        if (r.kind !== 'chunk') continue;
        const a = await resolveChunkAnchor(r.chunkId);
        if (a !== null) next.set(r.chunkId, a);
      }
      if (!cancelled) setResolved(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [refs, resolveChunkAnchor]);

  return (
    <span className="message-bubble__multi-source">
      <span aria-hidden="true">📎</span>
      <span>Sources:</span>
      {refs.map((r) => {
        const tag = `[${String(r.citationTag)}]`;
        const onClick = (): void => {
          if (r.kind === 'passage') onJumpToSource(r.anchor);
          else {
            const anchor = resolved.get(r.chunkId);
            if (anchor !== undefined) onJumpToSource(anchor);
          }
        };
        return (
          <button
            key={r.kind === 'chunk' ? r.chunkId : `passage-${String(r.citationTag)}`}
            type="button"
            className="message-bubble__citation"
            aria-label={`Jump to source ${String(r.citationTag)}`}
            onClick={onClick}
          >
            {tag}
          </button>
        );
      })}
    </span>
  );
}

export function MessageBubble({ message, onSave, onJumpToSource, resolveChunkAnchor }: Props) {
  if (message.role === 'user') {
    return (
      <div className="message-bubble message-bubble--user" role="article">
        <p className="message-bubble__content">{message.content}</p>
      </div>
    );
  }
  const isStreaming = message.streaming === true;
  const isTruncated = message.truncated === true;

  const sourceRefs: SourceRef[] =
    onJumpToSource !== undefined
      ? message.contextRefs
          .filter((r): r is Extract<ContextRef, { kind: 'passage' | 'chunk' }> =>
            r.kind === 'passage' || r.kind === 'chunk',
          )
          .map((r, i) => ({ ...r, citationTag: i + 1 }))
      : [];

  return (
    <div
      className="message-bubble message-bubble--assistant"
      role="article"
      aria-busy={isStreaming || undefined}
    >
      <p className="message-bubble__content">
        {message.content}
        {isStreaming ? <span className="message-bubble__caret" aria-hidden="true" /> : null}
      </p>
      <div className="message-bubble__footer">
        {isTruncated ? <em className="message-bubble__truncated">(stopped)</em> : null}
        <span className="message-bubble__badge" aria-label="AI generated">AI</span>
        <span className="message-bubble__time">{relativeTime(message.createdAt)}</span>
        {sourceRefs.length === 1 && sourceRefs[0]!.kind === 'passage' && onJumpToSource ? (
          <SingleSourceFooter
            passageRef={sourceRefs[0]!}
            onJumpToSource={onJumpToSource as (a: HighlightAnchor) => void}
          />
        ) : sourceRefs.length >= 1 && onJumpToSource ? (
          <MultiSourceFooter
            refs={sourceRefs}
            onJumpToSource={onJumpToSource}
            {...(resolveChunkAnchor !== undefined && { resolveChunkAnchor })}
          />
        ) : null}
        {!isStreaming && onSave ? (
          <button
            type="button"
            className="message-bubble__save"
            aria-label="Save answer"
            onClick={() => {
              onSave(message.id);
            }}
          >
            <SaveAnswerIcon size={14} />
            <span>Save</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add CSS for `.message-bubble__multi-source` and `.message-bubble__citation`**

In `src/features/ai/chat/message-bubble.css` (locate via `ls`), append:

```css
.message-bubble__multi-source {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.message-bubble__citation {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: var(--color-surface-elevated, var(--color-surface));
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.message-bubble__citation:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.message-bubble__citation:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
```

- [ ] **Step 4: Run tests + check**

```bash
pnpm vitest run src/features/ai/chat/MessageBubble.test.tsx
pnpm check
```

Expected: PASS — existing single-source tests + new multi-source suite.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/chat/MessageBubble.tsx src/features/ai/chat/MessageBubble.test.tsx src/features/ai/chat/message-bubble.css
git commit -m "feat(chat): MessageBubble multi-source footer with citation-tag chips"
```

---

## Task 18: `PrivacyPreview` search-plan subsection

**Files:**
- Modify: `src/features/ai/chat/PrivacyPreview.tsx:5-12` (Props), `:23-31` (summary), `:66-83` (expanded form)
- Modify: `src/features/ai/chat/PrivacyPreview.test.tsx` (add suite)

- [ ] **Step 1: Write failing tests**

Append to `src/features/ai/chat/PrivacyPreview.test.tsx`:

```typescript
import { BookId } from '@/domain';
import type { AttachedRetrieval } from './useChatSend';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';

function fakeChunksRepo(count: number): BookChunksRepository {
  return {
    upsertMany: async () => {},
    listByBook: async () => [],
    listBySection: async () => [],
    deleteByBook: async () => {},
    deleteBySection: async () => {},
    countByBook: async () => count,
    countStaleVersions: async () => [],
    hasChunksFor: async () => true,
  };
}

function fakeEmbedRepo(count: number): BookEmbeddingsRepository {
  return {
    upsertMany: async () => {},
    listByBook: async () => [],
    deleteByBook: async () => {},
    countByBook: async () => count,
    hasEmbeddingFor: async () => true,
    countStaleVersions: async () => [],
    deleteOrphans: async () => 0,
  };
}

describe('PrivacyPreview — retrieval (Phase 5.2)', () => {
  it('renders Search plan subsection when attachedRetrieval is non-null', async () => {
    const ar: AttachedRetrieval = { bookId: BookId('b1') };
    render(
      <PrivacyPreview
        book={{ title: 'Book' }}
        modelId="gpt-x"
        historyCount={2}
        attachedRetrieval={ar}
        chunksRepo={fakeChunksRepo(250)}
        embeddingsRepo={fakeEmbedRepo(250)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(await screen.findByText(/Search plan/i)).toBeInTheDocument();
    expect(screen.getByText(/250 chunks/i)).toBeInTheDocument();
    expect(screen.getByText(/embeddings ready/i)).toBeInTheDocument();
  });

  it('shows warning when embeddingsCount === 0', async () => {
    const ar: AttachedRetrieval = { bookId: BookId('b1') };
    render(
      <PrivacyPreview
        book={{ title: 'Book' }}
        modelId="gpt-x"
        historyCount={0}
        attachedRetrieval={ar}
        chunksRepo={fakeChunksRepo(50)}
        embeddingsRepo={fakeEmbedRepo(0)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(await screen.findByText(/still being prepared/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

Replace the entire `src/features/ai/chat/PrivacyPreview.tsx` body with:

```typescript
import { useEffect, useState } from 'react';
import { buildOpenModeSystemPrompt, buildPassageBlockForPreview } from './promptAssembly';
import type { AttachedPassage, AttachedRetrieval } from './useChatSend';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';

type Props = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly modelId: string;
  readonly historyCount: number;
  readonly attachedPassage?: AttachedPassage | null;
  readonly attachedRetrieval?: AttachedRetrieval | null;
  readonly chunksRepo?: BookChunksRepository;
  readonly embeddingsRepo?: BookEmbeddingsRepository;
};

export function PrivacyPreview({
  book,
  modelId,
  historyCount,
  attachedPassage,
  attachedRetrieval,
  chunksRepo,
  embeddingsRepo,
}: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const [counts, setCounts] = useState<{ chunks: number; embeddings: number } | null>(null);
  const passage = attachedPassage ?? null;
  const retrieval = attachedRetrieval ?? null;

  useEffect(() => {
    if (retrieval === null || chunksRepo === undefined || embeddingsRepo === undefined) {
      setCounts(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [chunks, embeddings] = await Promise.all([
        chunksRepo.countByBook(retrieval.bookId),
        embeddingsRepo.countByBook(retrieval.bookId),
      ]);
      if (!cancelled) setCounts({ chunks, embeddings });
    })();
    return () => {
      cancelled = true;
    };
  }, [retrieval, chunksRepo, embeddingsRepo]);

  const summaryParts: string[] = [
    `${book.title}${book.author ? ` by ${book.author}` : ''}`,
  ];
  if (retrieval !== null) {
    summaryParts.push('search this book');
  } else if (passage !== null) {
    if (passage.sectionTitle !== undefined) summaryParts.push(passage.sectionTitle);
    summaryParts.push(`selected passage (~${String(passage.text.length)} chars)`);
  }
  summaryParts.push(`${String(historyCount)} prior messages`);
  const summary = `Sending: ${summaryParts.join(' + ')} → ${modelId}`;

  const prompt = buildOpenModeSystemPrompt(book);

  const passageBlock =
    passage !== null && retrieval === null
      ? buildPassageBlockForPreview(book.title, {
          text: passage.text,
          ...(passage.sectionTitle !== undefined && { sectionTitle: passage.sectionTitle }),
          ...(passage.windowBefore !== undefined && { windowBefore: passage.windowBefore }),
          ...(passage.windowAfter !== undefined && { windowAfter: passage.windowAfter }),
        })
      : null;

  return (
    <div className={open ? 'privacy-preview privacy-preview--open' : 'privacy-preview'}>
      <button
        type="button"
        className="privacy-preview__summary"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        ⓘ {summary}
      </button>
      {open ? (
        <div className="privacy-preview__body">
          <h4>System prompt</h4>
          <pre className="privacy-preview__prompt">{prompt}</pre>
          {passageBlock !== null ? (
            <>
              <h4>Attached passage</h4>
              <pre className="privacy-preview__prompt">{passageBlock}</pre>
            </>
          ) : null}
          {retrieval !== null ? (
            <>
              <h4>Search plan</h4>
              {counts === null ? (
                <p>Counting…</p>
              ) : counts.embeddings === 0 ? (
                <p className="privacy-preview__warning">
                  This book is still being prepared for AI. Sending now will return
                  &ldquo;no embeddings yet&rdquo;. Wait for the library card to show ✓ Indexed.
                </p>
              ) : (
                <p>
                  This book — {String(counts.chunks)} chunks · embeddings ready. Will fetch
                  up to 12 chunks / ~3000 tokens of the most relevant excerpts to {modelId}.
                  The actual excerpts depend on your question.
                </p>
              )}
            </>
          ) : null}
          <h4>Model</h4>
          <p>{modelId}</p>
          <h4>Messages included</h4>
          <p>1 system + {historyCount} prior</p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Run tests + check**

```bash
pnpm vitest run src/features/ai/chat/PrivacyPreview.test.tsx
pnpm check
```

Expected: PASS — existing tests + new retrieval suite.

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/chat/PrivacyPreview.tsx src/features/ai/chat/PrivacyPreview.test.tsx
git commit -m "feat(chat): PrivacyPreview search-plan subsection"
```

---

## Task 19: `NotebookRow` multi-source jump UI for retrieval saved answers

**Files:**
- Modify: `src/features/annotations/notebook/NotebookRow.tsx:40-90` (savedAnswer block)

- [ ] **Step 1: Locate the savedAnswer rendering**

Open `src/features/annotations/notebook/NotebookRow.tsx`. Lines 40-90 handle the `savedAnswer` branch.

- [ ] **Step 2: Update the savedAnswer rendering to handle chunk refs + multi-source UI**

Replace the savedAnswer branch (lines 40-107) with:

```typescript
  if (entry.kind === 'savedAnswer') {
    const s = entry.savedAnswer;
    const passageRef = s.contextRefs.find((r) => r.kind === 'passage');
    const chunkRefs = s.contextRefs.filter(
      (r): r is Extract<typeof r, { kind: 'chunk' }> => r.kind === 'chunk',
    );
    const passageAnchor: LocationAnchor | null =
      passageRef !== undefined
        ? passageRef.anchor.kind === 'epub-cfi'
          ? { kind: 'epub-cfi', cfi: passageRef.anchor.cfi }
          : { kind: 'pdf', page: passageRef.anchor.page }
        : null;
    const hasMultiSource = chunkRefs.length >= 1;
    return (
      <li className="notebook-row notebook-row--saved-answer">
        <div className="notebook-row__main">
          <span className="notebook-row__top">
            <span className="notebook-row__type">AI ANSWER</span>
            <span className="notebook-row__model">{s.modelId}</span>
            <span className="notebook-row__time">{relativeTime(s.createdAt, nowMs)}</span>
          </span>
          <p className="notebook-row__question">{s.question}</p>
          <button
            type="button"
            className={
              expanded
                ? 'notebook-row__answer notebook-row__answer--expanded'
                : 'notebook-row__answer'
            }
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((cur) => !cur);
            }}
          >
            {s.content}
          </button>
          {s.userNote ? (
            <p className="notebook-row__user-note">{s.userNote}</p>
          ) : null}
          {hasMultiSource ? (
            <span className="notebook-row__sources">
              <span aria-hidden="true">🔍</span>
              <span>Sources:</span>
              {chunkRefs.slice(0, 5).map((ref, i) => (
                <button
                  key={ref.chunkId}
                  type="button"
                  className="notebook-row__citation"
                  aria-label={`Jump to source ${String(i + 1)}`}
                  onClick={() => {
                    if (onJumpToChunk !== undefined) onJumpToChunk(ref.chunkId);
                  }}
                  disabled={onJumpToChunk === undefined}
                >
                  [{String(i + 1)}]
                </button>
              ))}
              {chunkRefs.length > 5 ? (
                <span className="notebook-row__more">+{String(chunkRefs.length - 5)} more</span>
              ) : null}
            </span>
          ) : passageAnchor !== null ? (
            <button
              type="button"
              className="notebook-row__jump-to-passage"
              aria-label="Jump to passage in book"
              onClick={() => {
                onJumpToAnchor(passageAnchor);
              }}
            >
              📎 Jump to passage
            </button>
          ) : null}
        </div>
        <span className="notebook-row__actions">
          {onRemoveSavedAnswer ? (
            <button
              type="button"
              className="notebook-row__delete"
              aria-label="Remove saved answer"
              onClick={() => {
                onRemoveSavedAnswer(s.id);
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

Add `onJumpToChunk` to Props (lines 11-20):

```typescript
type Props = {
  readonly entry: NotebookEntry;
  readonly nowMs?: number;
  readonly onJumpToAnchor: (anchor: LocationAnchor) => void;
  readonly onJumpToChunk?: (chunkId: ChunkId) => void;
  readonly onRemoveBookmark: (b: Bookmark) => void;
  readonly onRemoveHighlight: (h: Highlight) => void;
  readonly onChangeColor: (h: Highlight, color: HighlightColor) => void;
  readonly onSaveNote: (h: Highlight, content: string) => void;
  readonly onRemoveSavedAnswer?: (id: SavedAnswerId) => void;
};
```

Add `ChunkId` to the imports at line 3:

```typescript
import type { LocationAnchor, ChunkId, SavedAnswerId } from '@/domain';
```

Update the component signature destructure to include `onJumpToChunk`.

- [ ] **Step 3: Add CSS**

In `src/features/annotations/notebook/notebook-row.css`, append:

```css
.notebook-row__sources {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.notebook-row__citation {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: var(--color-surface-elevated, var(--color-surface));
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.notebook-row__citation:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.notebook-row__citation:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.notebook-row__citation:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.notebook-row__more {
  color: var(--color-text-muted);
  font-style: italic;
}
```

- [ ] **Step 4: Update the parent component to pass `onJumpToChunk`**

`NotebookView` is the parent. Locate it via `find src/features/annotations/notebook -name "NotebookView*"` then add an `onJumpToChunk` prop and pass it through. The plumbing target: NotebookView's caller (App.tsx, lines 192-208) receives a new prop `onJumpToChunk` and threads it through.

App.tsx — in the notebook view branch (lines 192-208), thread:

```typescript
          onJumpToChunk={async (chunkId) => {
            const chunks = await wiring.bookChunksRepo.listByBook(BookId(view.current.bookId));
            const c = chunks.find((x) => x.id === chunkId);
            if (c !== undefined) {
              view.goReaderAt(book.id, c.locationAnchor);
            }
          }}
```

NotebookView signature — add `readonly onJumpToChunk?: (chunkId: ChunkId) => void` and forward to NotebookRow.

- [ ] **Step 5: Run tests + check**

```bash
pnpm check
```

Expected: PASS. (Existing NotebookRow tests should still pass; multi-source rendering is conditional on chunk-ref presence, which existing fixtures don't have.)

- [ ] **Step 6: Commit**

```bash
git add src/features/annotations/notebook/NotebookRow.tsx src/features/annotations/notebook/notebook-row.css src/features/annotations/notebook/NotebookView.tsx src/app/App.tsx
git commit -m "feat(notebook): NotebookRow multi-source jump UI for retrieval saved answers"
```

---

## Task 20: Wire `bookEmbeddingsRepo` + `embedClient` + `retrievalDeps` + cascade integration

**Files:**
- Modify: `src/features/library/wiring.ts:25,57,78,195` (add bookEmbeddingsRepo)
- Modify: `src/app/App.tsx:88-120, 222-256` (instantiate embedClient + thread retrievalDeps)
- Modify: `src/app/useReaderHost.ts:172-208` (cascade extension)
- Modify: `src/app/useReaderHost.test.ts` (extend stub)
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx:32-74` (Props), `:148-165` (state), append handler, `:474-505` and `:577-608` (ChatPanel calls)

- [ ] **Step 1: Extend `wiring.ts`**

In `src/features/library/wiring.ts`:

Add to imports (around line 14):

```typescript
  createBookEmbeddingsRepository,
  type BookEmbeddingsRepository,
```

Add to `Wiring` type (after line 57):

```typescript
  readonly bookEmbeddingsRepo: BookEmbeddingsRepository;
```

Add factory call (after line 78):

```typescript
  const bookEmbeddingsRepo = createBookEmbeddingsRepository(db);
```

Add to return object (after line 195):

```typescript
    bookEmbeddingsRepo,
```

- [ ] **Step 2: Extend `App.tsx` to construct embedClient + thread deps**

In `src/app/App.tsx`:

Add imports near the top:

```typescript
import * as nanogptEmbeddings from '@/features/ai/chat/nanogptEmbeddings';
import type { EmbedClient } from '@/features/library/indexing/embeddings/types';
import type { RetrievalDeps } from '@/features/ai/retrieval/runRetrieval';
```

In `ReadyApp` (around line 87-111), construct embedClient and pass to useIndexing:

```typescript
  const embedClient: EmbedClient = useMemo(
    () => ({
      embed: (req) =>
        nanogptEmbeddings.embed({
          apiKey: getApiKey() ?? '',
          modelId: req.modelId,
          inputs: req.inputs,
          ...(req.signal !== undefined ? { signal: req.signal } : {}),
        }),
    }),
    // getApiKey is a useCallback below; bind to its identity.
    [],
  );
```

(`getApiKey` is defined at line 140-144 in current code; the useMemo above creates a forward reference. To avoid the dep-cycle, move the `getApiKey` useCallback up before the embedClient block.)

Move the `getApiKey` useCallback (lines 140-144) above the indexing setup:

```typescript
  const getApiKey = useCallback((): string | null => {
    const s = useApiKeyStore.getState().state;
    if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
    return null;
  }, []);
```

Update the embedClient useMemo to include `[getApiKey]` as the dep.

Update the `useIndexing` call to pass the new fields:

```typescript
  const indexing = useIndexing({
    booksRepo: wiring.bookRepo,
    chunksRepo: wiring.bookChunksRepo,
    embeddingsRepo: wiring.bookEmbeddingsRepo,
    epubExtractor,
    pdfExtractor,
    embedClient,
  });
```

Construct `retrievalDeps`:

```typescript
  const retrievalDeps: RetrievalDeps = useMemo(
    () => ({
      chunksRepo: wiring.bookChunksRepo,
      embeddingsRepo: wiring.bookEmbeddingsRepo,
      embedClient,
    }),
    [wiring, embedClient],
  );
```

Pass `retrievalDeps` and the new chunks-repo to ReaderWorkspace:

In the ReaderWorkspace JSX block (lines 222-256), add:

```typescript
          retrievalDeps={retrievalDeps}
          bookChunksRepo={wiring.bookChunksRepo}
          bookEmbeddingsRepo={wiring.bookEmbeddingsRepo}
```

- [ ] **Step 3: Extend `useReaderHost.onRemoveBook` cascade**

In `src/app/useReaderHost.ts`, in `onRemoveBook` (lines 172-208), after the line:

```typescript
          await wiring.bookChunksRepo.deleteByBook(BookId(book.id));
```

add:

```typescript
          await wiring.bookEmbeddingsRepo.deleteByBook(BookId(book.id));
```

- [ ] **Step 4: Update `useReaderHost.test.ts` stub**

Find the existing `fakeWiring()` helper (typically line 29-110). Add a `bookEmbeddingsRepo` stub:

```typescript
    bookEmbeddingsRepo: {
      upsertMany: vi.fn(() => Promise.resolve()),
      listByBook: vi.fn(() => Promise.resolve([])),
      deleteByBook: vi.fn(() => Promise.resolve()),
      countByBook: vi.fn(() => Promise.resolve(0)),
      hasEmbeddingFor: vi.fn(() => Promise.resolve(false)),
      countStaleVersions: vi.fn(() => Promise.resolve([])),
      deleteOrphans: vi.fn(() => Promise.resolve(0)),
    },
```

Add an explicit assertion in the existing onRemoveBook test (or add a new one) verifying the cascade call:

```typescript
it('cascades onRemoveBook to bookEmbeddingsRepo.deleteByBook', async () => {
  // …setup wiring + render hook + call onRemoveBook…
  await waitFor(() => {
    expect((wiring.bookEmbeddingsRepo.deleteByBook as ReturnType<typeof vi.fn>))
      .toHaveBeenCalledWith(BookId(book.id));
  });
});
```

- [ ] **Step 5: Extend `ReaderWorkspace`**

In `src/features/reader/workspace/ReaderWorkspace.tsx`:

Add Props (after line 73):

```typescript
  readonly retrievalDeps?: RetrievalDeps;
  readonly bookChunksRepo: BookChunksRepository;
  readonly bookEmbeddingsRepo: BookEmbeddingsRepository;
```

Add imports near the top:

```typescript
import type { RetrievalDeps } from '@/features/ai/retrieval/runRetrieval';
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import type { AttachedRetrieval } from '@/features/ai/chat/useChatSend';
```

Add state (after line 161 `attachedPassage` line):

```typescript
  const [attachedRetrieval, setAttachedRetrieval] = useState<AttachedRetrieval | null>(null);
```

Add handlers (after `handleClearAttachedPassage`, around line 337):

```typescript
  const handleToggleSearch = useCallback((): void => {
    setAttachedRetrieval((cur) => {
      if (cur !== null) return null;
      // Mutual exclusivity with passage chip.
      setAttachedPassage(null);
      return { bookId: BookId(props.bookId) };
    });
  }, [props.bookId]);

  const handleClearAttachedRetrieval = useCallback((): void => {
    setAttachedRetrieval(null);
  }, []);

  const resolveChunkAnchor = useCallback(
    async (chunkId: ChunkId): Promise<LocationAnchor | null> => {
      const allChunks = await props.bookChunksRepo.listByBook(BookId(props.bookId));
      const c = allChunks.find((x) => x.id === chunkId);
      return c !== undefined ? c.locationAnchor : null;
    },
    [props.bookChunksRepo, props.bookId],
  );
```

Update `handleAskAI` (lines 290-333) to also clear `attachedRetrieval` when materializing a passage chip:

After `setAttachedPassage(passage);`:

```typescript
        setAttachedRetrieval(null);
```

Update both `<ChatPanel />` calls (the desktop instance ~474-505 and the mobile-sheet instance ~577-608) to add the new props:

```typescript
              attachedRetrieval={attachedRetrieval}
              onClearAttachedRetrieval={handleClearAttachedRetrieval}
              {...(props.retrievalDeps !== undefined && { retrievalDeps: props.retrievalDeps })}
              onToggleSearch={handleToggleSearch}
              resolveChunkAnchor={resolveChunkAnchor}
```

- [ ] **Step 6: Run check**

```bash
pnpm check
```

Expected: PASS. Some test files may need their wiring stubs extended (any test that constructs a `Wiring` object literal must add `bookEmbeddingsRepo`).

- [ ] **Step 7: Commit**

```bash
git add src/features/library/wiring.ts src/app/App.tsx src/app/useReaderHost.ts src/app/useReaderHost.test.ts src/features/reader/workspace/ReaderWorkspace.tsx
git commit -m "feat(app): wire bookEmbeddingsRepo + embedClient + retrievalDeps + cascade integration"
```

---

## Task 21: `IndexInspectorModal` — show embedding-model version in header

**Files:**
- Modify: `src/features/library/indexing/IndexInspectorModal.tsx:6-13` (Props), `:25-46` (load + summary), `:71-89` (render)

- [ ] **Step 1: Extend Props**

In `src/features/library/indexing/IndexInspectorModal.tsx`:

Replace the Props block:

```typescript
type Props = {
  readonly bookId: BookId;
  readonly bookTitle: string;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;
  readonly onRebuild: (id: BookId) => Promise<void>;
  readonly onClose: () => void;
};
```

Add import:

```typescript
import type { BookChunksRepository, BookEmbeddingsRepository } from '@/storage';
import type { BookEmbedding } from '@/domain';
```

- [ ] **Step 2: Load embeddings + extend summary**

Replace the existing useEffect/useMemo block (lines 25-46) with:

```typescript
  const [chunks, setChunks] = useState<readonly TextChunk[] | null>(null);
  const [embeddings, setEmbeddings] = useState<readonly BookEmbedding[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void chunksRepo.listByBook(bookId).then(setChunks);
    void embeddingsRepo.listByBook(bookId).then(setEmbeddings);
  }, [bookId, chunksRepo, embeddingsRepo]);

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
    const chunkerVersion = chunks[0]?.chunkerVersion ?? 0;
    const embeddingsCount = embeddings?.length ?? 0;
    const embeddingModelVersion = embeddings?.[0]?.embeddingModelVersion ?? 0;
    return {
      count: chunks.length,
      sectionCount,
      totalTokens,
      chunkerVersion,
      embeddingsCount,
      embeddingModelVersion,
    };
  }, [chunks, embeddings]);
```

- [ ] **Step 3: Update summary line**

Replace the summary span (lines 73-76) with:

```typescript
            <span>
              {summary.count} chunks · {summary.sectionCount} sections · v
              {summary.chunkerVersion} chunker · ~{summary.totalTokens} tokens ·{' '}
              {summary.embeddingsCount}/{summary.count} embeddings · v
              {summary.embeddingModelVersion} model
            </span>
```

- [ ] **Step 4: Update App.tsx to pass embeddingsRepo**

In `src/app/App.tsx` where `<IndexInspectorModal …/>` is rendered (around line 281-290):

```typescript
        <IndexInspectorModal
          bookId={inspectorBookId}
          bookTitle={inspectorBook.title}
          chunksRepo={wiring.bookChunksRepo}
          embeddingsRepo={wiring.bookEmbeddingsRepo}
          onRebuild={(id) => indexing.rebuild(id)}
          onClose={() => {
            setInspectorBookId(null);
          }}
        />
```

- [ ] **Step 5: Run check**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/library/indexing/IndexInspectorModal.tsx src/app/App.tsx
git commit -m "feat(library): IndexInspectorModal — show embedding-model version in header"
```

---

## Task 22: E2E retrieval-mode specs

**Files:**
- Create: `e2e/chat-retrieval-mode-desktop.spec.ts`
- Create: `e2e/chat-retrieval-mode-no-embeddings.spec.ts`
- Create: `e2e/library-card-embedding-status.spec.ts`

**Goal:** Three Playwright specs covering the happy path, the no-embeddings error path, and the library-card status flow during the embedding stage.

- [ ] **Step 1: Inventory existing e2e helpers**

```bash
ls e2e/
```

Note the existing fixture-import helpers and chat-completion mock pattern. Reuse them.

- [ ] **Step 2: Create `library-card-embedding-status.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { importFixture } from './helpers/import';

test('library card transitions through chunking → embedding → ready', async ({ page }) => {
  // Mock /v1/embeddings to return a 1536-dim vector deterministically.
  await page.route('https://nano-gpt.com/api/v1/embeddings', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { input: string[] };
    const data = body.input.map((_, i) => ({
      index: i,
      embedding: new Array<number>(1536).fill(0).map((_, j) => ((i + 1) * (j + 1)) % 7 / 7),
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, usage: { prompt_tokens: 10 } }),
    });
  });

  await page.goto('/');
  await importFixture(page, 'small-pride-and-prejudice.epub');

  // Assert progression. The library card status text should pass through these states.
  await expect(page.getByText(/chunking|preparing for AI|preparing/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Indexed|✓/i)).toBeVisible({ timeout: 60_000 });
});
```

- [ ] **Step 3: Create `chat-retrieval-mode-no-embeddings.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { importFixture, configureApiKey, selectModel } from './helpers/import';

test('retrieval before embeddings finish shows "still being prepared" inline error', async ({
  page,
}) => {
  // Slow-roll the embeddings endpoint so we can attach the chip before completion.
  await page.route('https://nano-gpt.com/api/v1/embeddings', async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ index: 0, embedding: new Array<number>(1536).fill(0.1) }],
        usage: { prompt_tokens: 1 },
      }),
    });
  });

  await page.goto('/');
  await configureApiKey(page);
  await selectModel(page);
  await importFixture(page, 'small-pride-and-prejudice.epub');
  // Open reader before embeddings complete.
  await page.click('text=Open');
  await page.click('button[aria-label="Search this book"]');
  await page.fill('textarea', 'tell me about Mr Darcy');
  await page.keyboard.press('Meta+Enter');
  await expect(page.getByText(/still being prepared/i)).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 4: Create `chat-retrieval-mode-desktop.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { importFixture, configureApiKey, selectModel } from './helpers/import';

test('retrieval mode end-to-end: chip → search → multi-source footer → jump', async ({
  page,
}) => {
  // Mock embeddings + chat completions.
  await page.route('https://nano-gpt.com/api/v1/embeddings', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { input: string[] };
    const data = body.input.map((_, i) => ({
      index: i,
      embedding: new Array<number>(1536).fill(0).map((_, j) => ((i + 1) * (j + 1)) % 5 / 5),
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, usage: { prompt_tokens: 10 } }),
    });
  });
  await page.route('https://nano-gpt.com/api/v1/chat/completions', async (route) => {
    // SSE stream — minimal happy path: one delta + done.
    const sseBody =
      'data: {"choices":[{"delta":{"content":"Per [1], Mr Darcy is reserved."}}]}\n\n' +
      'data: [DONE]\n\n';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody,
    });
  });

  await page.goto('/');
  await configureApiKey(page);
  await selectModel(page);
  await importFixture(page, 'small-pride-and-prejudice.epub');
  await expect(page.getByText(/Indexed|✓/i)).toBeVisible({ timeout: 60_000 });
  await page.click('text=Open');

  // Toggle search chip
  await page.click('button[aria-label="Search this book"]');
  await expect(page.getByRole('status', { name: /Searching this book/i })).toBeVisible();

  // Send a question
  await page.fill('textarea', 'what is mr darcy like');
  await page.keyboard.press('Meta+Enter');

  // Multi-source footer with citation chips appears
  await expect(page.getByRole('button', { name: /Jump to source 1/i })).toBeVisible({
    timeout: 10_000,
  });
});
```

- [ ] **Step 5: Run E2E suite**

```bash
pnpm test:e2e
```

Expected: All three new specs pass + existing suites still pass. (If a helper like `configureApiKey` or `selectModel` doesn't exist, inline the steps or add minimal helpers in `e2e/helpers/import.ts` mirroring existing patterns.)

- [ ] **Step 6: Commit**

```bash
git add e2e/chat-retrieval-mode-desktop.spec.ts e2e/chat-retrieval-mode-no-embeddings.spec.ts e2e/library-card-embedding-status.spec.ts e2e/helpers/
git commit -m "test(e2e): retrieval mode — desktop + no-embeddings + library-card embedding status"
```

---

## Task 23: Docs — architecture decision + roadmap status complete

**Files:**
- Modify: `docs/04-implementation-roadmap.md` (Phase 5.2 status block)
- Modify: `docs/02-system-architecture.md` (decision-history entry)

- [ ] **Step 1: Update roadmap status**

Open `docs/04-implementation-roadmap.md`. Locate the Phase 5.2 entry. Update its status block:

```markdown
- **Phase 5.2 — Retrieval baseline** — complete (2026-05-06)
  - Embeddings auto-compute during indexing; new `book_embeddings` IDB store (v8).
  - Hybrid retrieval: BM25 + cosine via Reciprocal Rank Fusion.
  - Token-budgeted, section-grouped evidence bundles with citation tags.
  - "Search this book" chat-mode UI with multi-source jump-to-anchor.
  - Spec: `docs/superpowers/specs/2026-05-06-phase-5-2-retrieval-design.md`
  - Plan: `docs/superpowers/plans/2026-05-06-phase-5-2-retrieval.md`
```

- [ ] **Step 2: Add decision-history entry to 02-system-architecture.md**

Locate the decision-history section. Append:

```markdown
### 2026-05-06 — Phase 5.2 retrieval baseline

- **Embeddings storage**: new `book_embeddings` IDB store (v7 → v8 additive migration), keyed by `ChunkId`, indexed by `bookId`. Vectors stored as `Float32Array` (1536-dim, L2-normalized at write time). Decoupled from `book_chunks` lifecycle so model-version bumps invalidate embeddings without re-chunking.
- **Embedding model**: `text-embedding-3-small` hardcoded as v1 default (`EMBEDDING_MODEL_VERSION = 1`). User-selectable model is Phase 6+ polish. NanoGPT proxy at `/v1/embeddings`.
- **Hybrid retrieval**: BM25 (k1=1.2, b=0.75, IDF computed inline per query) + cosine (pre-normalized vectors → dot product) combined via Reciprocal Rank Fusion (k=60). No score calibration; no third IDB store for inverted index.
- **Evidence bundle**: greedy-pack to 3000-token budget, regroup by section in first-appearance order, sort by chunk-index within section. Citation tags `[1]…[N]` follow RRF order. `buildEvidenceBundleForPreview` exported so PrivacyPreview can render character-for-character what gets sent.
- **Pipeline integration**: `runIndexing` gains an `embedding{progressPercent}` stage between chunking-ready and final `ready`. Per-chunk idempotent resume via `embeddingsRepo.hasEmbeddingFor`. Two-version model (chunker + embedding) tracked independently — chunker bump cascades to embeddings; model bump leaves chunks intact.
- **UI provenance**: `ChatComposer` gains a "Search this book" toggle button with `aria-pressed`; `RetrievalChip` appears in the same chip slot as `PassageChip` (mutually exclusive at workspace level). `MessageBubble` extracts `SingleSourceFooter` (existing 4.4 behavior) + adds `MultiSourceFooter` with citation-chip click-to-jump. `NotebookRow.savedAnswer` extends with multi-source UI for retrieval-mode answers.
- **Privacy doctrine**: pre-send `PrivacyPreview` shows search plan (chunk count + budget); post-send `MessageBubble` shows actual retrieved chunks via `contextRefs[].kind === 'chunk'`. Engine doc's "user always sees what we send" principle satisfied.
```

- [ ] **Step 3: Run check (no code changes; doc-only)**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/04-implementation-roadmap.md docs/02-system-architecture.md
git commit -m "docs: Phase 5.2 — architecture decision + roadmap status complete"
```

---

## Validation Checklist

After all 23 commits land, verify the spec's §15 checklist:

- [ ] All ~23 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new retrieval-mode suite plus all prior suites.
- [ ] **Manual smoke (embeddings)**: import the fixture EPUB → wait for `ready` (chunking + embedding both visible in library card status) → confirm IDB has expected number of embeddings.
- [ ] **Manual smoke (retrieval)**: open chat → click Search → ask "where is X discussed" → confirm multi-source footer with reasonable citations → click [1] → reader navigates to that chunk.
- [ ] **Manual smoke (resume)**: kick off indexing → reload mid-embedding → confirm resume picks up at next un-embedded chunk.
- [ ] **Manual smoke (no-embeddings)**: import → before embedding finishes, click Search + send → confirm "still being prepared" inline error bubble.
- [ ] **Manual smoke (rebuild)**: rebuild from inspector → confirm embeddings regenerate alongside chunks.
- [ ] **Manual smoke (cascade)**: remove a book during embedding → pipeline cancels cleanly; no orphaned `embedding` status; no leaked embeddings.
- [ ] **Manual smoke (saved answers)**: send a retrieval-mode question → save → notebook → "AI answers" filter → verify multi-source jump-back works for each citation.
- [ ] `docs/04-implementation-roadmap.md` Status block updated.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard ≥ 22/27 per `docs/08-agent-self-improvement.md`.

---

## Implementation Notes

**foliate-js typing pattern (from Phase 5.1 lessons)**: Phase 5.2 does not import any untyped JS modules directly — `nanogptEmbeddings` uses `fetch()` natively. If a future task needs to import an untyped JS module, follow the Phase 5.1 pattern documented in `src/types/foliate-js.d.ts` (ambient declarations limited to the surface actually used).

**Prompt-cache stable prefix**: out of scope for Phase 5.2. Bundle ordering inside the user message is RRF→section-grouped; the system prompt is stable per book/mode. Phase 6 polish can introduce a stable-prefix-aware bundle ordering if profiling justifies.

**Zero-vector edge case**: a chunk whose embedding vector is the zero vector (degenerate corpus) gets a cosine score of 0 against any query and is excluded from the cosine ranking. BM25 may still surface it. RRF combines whatever survives. This degrades gracefully without code changes.

**Two-pass test runs**: when extending stub helpers across files (Tasks 7, 8, 20), the typecheck may red-line until every test file's `Wiring` / `IndexingQueueDeps` / `UseIndexingDeps` literal includes the new fields. Use `pnpm tsc --noEmit` between Steps to catch these incrementally.

