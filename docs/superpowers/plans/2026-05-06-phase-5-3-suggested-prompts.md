# Phase 5.3 — Suggested Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a categorized book profile (`{summary, genre, structure, themes, keyEntities}`) on first chat-panel open per book and surface 4-8 categorized suggested prompts in the no-threads empty state. Click sends; ✎ icon fills composer.

**Architecture:** Lazy-on-mount profile generation via a new `useBookProfile` hook. New `nanogptStructured` network module wraps `/v1/chat/completions` with `response_format: json_schema`. Profile + prompts persist as a single `BookProfileRecord` in a new `book_profiles` IDB store (schema v8 → v9, additive). New `SuggestedPromptList` slots into `ChatEmptyState`'s extended `no-threads` variant.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`, `noImplicitAny`, `noUncheckedIndexedAccess`); React 19; idb 8; Vitest + happy-dom + fake-indexeddb; Playwright. NanoGPT proxy at `https://nano-gpt.com/api/v1` with `gpt-4o-mini`-class models supporting `response_format: { type: 'json_schema' }`.

**Spec:** `docs/superpowers/specs/2026-05-06-phase-5-3-suggested-prompts-design.md` (approved 2026-05-06).

**Quality gate:** `pnpm check` (typecheck + lint + format + unit tests) clean per commit. `pnpm test:e2e` runs before the docs commit.

---

## Pre-flight

Before Task 1, verify:

```bash
git status               # clean working tree on `phase-5-3-suggested-prompts`
git log --oneline -5     # confirm 40de3fd spec commit is on top
pnpm check               # baseline: should pass with 790 tests across 122 files
```

If any baseline fails, stop and investigate. Do NOT proceed.

---

## Task 1: Domain types — `BookProfile`, `BookProfileRecord`, `SuggestedPrompt`, `BookStructure`, `SuggestedPromptCategory`

**Files:**
- Modify: `src/domain/book/types.ts` (append after the `BookEmbedding` block)

**Goal:** Add the five new domain types alongside `BookEmbedding`. The barrel `src/domain/index.ts` already re-exports `book/types`, so no barrel edit is needed.

- [ ] **Step 1: Verify the existing `BookEmbedding` location**

Run: `grep -n "export type BookEmbedding" src/domain/book/types.ts`

Expected: one match (~line 67-77, post-5.2). Note its end position for the append.

- [ ] **Step 2: Append the new types**

Open `src/domain/book/types.ts` and add immediately after the `BookEmbedding` type block:

```typescript
export type BookStructure = 'fiction' | 'nonfiction' | 'textbook' | 'reference';

// 2-4 sentence summary, genre, structure-tag, themes (typically 3-8 strings),
// and keyEntities split into characters / concepts / places. characters can
// be empty for non-fiction.
export type BookProfile = {
  readonly summary: string;
  readonly genre: string;
  readonly structure: BookStructure;
  readonly themes: readonly string[];
  readonly keyEntities: {
    readonly characters: readonly string[];
    readonly concepts: readonly string[];
    readonly places: readonly string[];
  };
};

export type SuggestedPromptCategory =
  | 'comprehension'
  | 'analysis'
  | 'structure'
  | 'creative'
  | 'study';

export type SuggestedPrompt = {
  readonly text: string;
  readonly category: SuggestedPromptCategory;
};

// Per-book record persisted in book_profiles IDB store. profileSchemaVersion
// enables future-phase migration; v1 ships at 1 with no app-open scan.
export type BookProfileRecord = {
  readonly bookId: BookId;
  readonly profile: BookProfile;
  readonly prompts: readonly SuggestedPrompt[];
  readonly profileSchemaVersion: number;
  readonly generatedAt: IsoTimestamp;
};
```

- [ ] **Step 3: Verify**

Run: `pnpm check`

Expected: PASS. Types are unused so far; should compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/domain/book/types.ts
git commit -m "$(cat <<'EOF'
feat(domain): book profile types — BookProfile, BookProfileRecord, SuggestedPrompt, BookStructure, SuggestedPromptCategory

Adds the categorized BookProfile type ({summary, genre, structure,
themes, keyEntities}) plus SuggestedPrompt + 5-category union and
BookProfileRecord for IDB persistence. profileSchemaVersion is reserved
for forward-compat (no v1 invalidation scan).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Storage — v8 → v9 migration adds `book_profiles` store

**Files:**
- Modify: `src/storage/db/schema.ts` (bump `CURRENT_DB_VERSION`, add interface entry, add store-name constant, add `BookProfileRecord` import)
- Modify: `src/storage/db/migrations.ts` (add `'book_profiles'` to StoreName, add migration `8`)
- Modify: `src/storage/db/migrations.test.ts` (add v8 → v9 tests)

**Goal:** Additive schema change. New store keyed by `BookId` (= primary key); no secondary indexes (every read is by `bookId`).

- [ ] **Step 1: Write failing tests**

Append to `src/storage/db/migrations.test.ts`:

```typescript
describe('v8 → v9 migration', () => {
  it('CURRENT_DB_VERSION is 9', () => {
    expect(CURRENT_DB_VERSION).toBe(9);
  });

  it('opening at v9 from scratch creates the book_profiles store', async () => {
    const dbName = `bookworm-mig9-fresh-${crypto.randomUUID()}`;
    const db = await openBookwormDB(dbName);
    expect(db.objectStoreNames.contains(BOOK_PROFILES_STORE)).toBe(true);
    db.close();
  });

  it('v8 → v9 preserves existing embeddings while adding the profiles store', async () => {
    const dbName = `bookworm-mig9-${crypto.randomUUID()}`;

    const v8 = await openDB(dbName, 8, {
      upgrade(db, oldVersion, newVersion, tx) {
        runMigrations(
          { db: db as never, tx: tx as never },
          oldVersion,
          newVersion ?? 8,
        );
      },
    });
    await v8.put('books', { id: 'b1', title: 'Survivor' });
    await v8.put('book_embeddings', {
      id: 'chunk-b1-s1-0',
      bookId: 'b1',
      vector: new Float32Array(1536),
      chunkerVersion: 1,
      embeddingModelVersion: 1,
      embeddedAt: '2026-05-06T00:00:00.000Z',
    });
    v8.close();

    const v9 = await openDB(dbName, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        runMigrations(
          { db: db as never, tx: tx as never },
          oldVersion,
          newVersion ?? CURRENT_DB_VERSION,
        );
      },
    });

    expect(v9.objectStoreNames.contains(BOOK_PROFILES_STORE)).toBe(true);
    const survivors = await v9.getAll('book_embeddings');
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({ id: 'chunk-b1-s1-0' });

    v9.close();
  });
});
```

Add `BOOK_PROFILES_STORE` to the existing schema-imports block at the top of the test file:

```typescript
import {
  BOOK_STORE,
  SETTINGS_STORE,
  READING_PROGRESS_STORE,
  READER_PREFERENCES_STORE,
  BOOKMARKS_STORE,
  HIGHLIGHTS_STORE,
  NOTES_STORE,
  CHAT_THREADS_STORE,
  CHAT_MESSAGES_STORE,
  SAVED_ANSWERS_STORE,
  BOOK_EMBEDDINGS_STORE,
  BOOK_PROFILES_STORE,
  CURRENT_DB_VERSION,
} from './schema';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/storage/db/migrations.test.ts`

Expected: FAIL — `CURRENT_DB_VERSION` is `8`, `BOOK_PROFILES_STORE` is undefined.

- [ ] **Step 3: Implement schema change**

In `src/storage/db/schema.ts`:

Add `BookProfileRecord` to the `import type` block at the top:

```typescript
import type {
  Book,
  BookEmbedding,
  BookProfileRecord,
  Bookmark,
  ChatMessage,
  ChatThread,
  Highlight,
  Note,
  SavedAnswer,
  TextChunk,
} from '@/domain';
```

Bump version constant:

```typescript
export const CURRENT_DB_VERSION = 9;
```

After the `book_embeddings` interface block (post-5.2), add:

```typescript
  book_profiles: {
    key: string;
    value: BookProfileRecord;
  };
```

After the `BOOK_EMBEDDINGS_STORE` constant, add:

```typescript
export const BOOK_PROFILES_STORE = 'book_profiles' as const;
```

In `src/storage/db/migrations.ts`:

Append `'book_profiles'` to the `StoreName` union:

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
  | 'book_embeddings'
  | 'book_profiles';
```

Add migration `8` after migration `7`:

```typescript
  // 8 → 9: Phase 5.3 book profiles store
  8: ({ db }) => {
    if (!db.objectStoreNames.contains('book_profiles')) {
      db.createObjectStore('book_profiles', { keyPath: 'bookId' });
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/storage/db/migrations.test.ts`

Expected: PASS — version is 9, store exists, existing embeddings preserved.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/db/schema.ts src/storage/db/migrations.ts src/storage/db/migrations.test.ts
git commit -m "$(cat <<'EOF'
feat(storage): v9 migration — add book_profiles store

Bumps CURRENT_DB_VERSION to 9 and adds BOOK_PROFILES_STORE keyed by
bookId. Migration 8 is additive (no data backfill); existing book
records will get profiles generated lazily on first chat-panel open.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `BookProfilesRepository`

**Files:**
- Create: `src/storage/repositories/bookProfiles.ts`
- Create: `src/storage/repositories/bookProfiles.test.ts`
- Modify: `src/storage/index.ts` (re-export)

**Goal:** Repository with `get`, `put`, `deleteByBook`, `countStaleVersions`. Validating reads filter malformed records on `get` (returns `null`).

- [ ] **Step 1: Write failing test**

Create `src/storage/repositories/bookProfiles.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createBookProfilesRepository } from './bookProfiles';
import {
  BookId,
  IsoTimestamp,
  type BookProfileRecord,
} from '@/domain';

let db: BookwormDB;

function makeRecord(overrides: Partial<BookProfileRecord> = {}): BookProfileRecord {
  return {
    bookId: BookId('b1'),
    profile: {
      summary: 'A short novel.',
      genre: 'classic literature',
      structure: 'fiction',
      themes: ['marriage', 'class'],
      keyEntities: {
        characters: ['Elizabeth Bennet'],
        concepts: ['pride'],
        places: ['Pemberley'],
      },
    },
    prompts: [
      { text: 'Track the evolving motives of Elizabeth.', category: 'analysis' },
      { text: 'Map the relationships between the Bennets.', category: 'structure' },
      { text: 'Identify scenes that foreshadow Darcy.', category: 'analysis' },
      { text: 'What does the title mean?', category: 'comprehension' },
    ],
    profileSchemaVersion: 1,
    generatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  const name = `test-bp-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  db = await openBookwormDB(name);
});

afterEach(() => {
  db.close();
});

describe('BookProfilesRepository', () => {
  it('put + get round-trips a record', async () => {
    const repo = createBookProfilesRepository(db);
    const r = makeRecord();
    await repo.put(r);
    const got = await repo.get(BookId('b1'));
    expect(got).not.toBeNull();
    expect(got?.profile.structure).toBe('fiction');
    expect(got?.prompts).toHaveLength(4);
    expect(got?.prompts[0]?.category).toBe('analysis');
  });

  it('get returns null for missing bookId', async () => {
    const repo = createBookProfilesRepository(db);
    expect(await repo.get(BookId('missing'))).toBeNull();
  });

  it('put twice updates (last writer wins)', async () => {
    const repo = createBookProfilesRepository(db);
    await repo.put(makeRecord({ profile: { ...makeRecord().profile, genre: 'first' } }));
    await repo.put(makeRecord({ profile: { ...makeRecord().profile, genre: 'second' } }));
    const got = await repo.get(BookId('b1'));
    expect(got?.profile.genre).toBe('second');
  });

  it('deleteByBook removes the record', async () => {
    const repo = createBookProfilesRepository(db);
    await repo.put(makeRecord());
    await repo.deleteByBook(BookId('b1'));
    expect(await repo.get(BookId('b1'))).toBeNull();
  });

  it('deleteByBook is a no-op on missing record', async () => {
    const repo = createBookProfilesRepository(db);
    await expect(repo.deleteByBook(BookId('missing'))).resolves.toBeUndefined();
  });

  it('countStaleVersions returns books with profileSchemaVersion < current', async () => {
    const repo = createBookProfilesRepository(db);
    await repo.put(makeRecord({ bookId: BookId('old'), profileSchemaVersion: 0 }));
    await repo.put(makeRecord({ bookId: BookId('cur'), profileSchemaVersion: 1 }));
    const stale = await repo.countStaleVersions(1);
    expect(stale).toContain(BookId('old'));
    expect(stale).not.toContain(BookId('cur'));
  });

  it('get filters malformed records (validating reads)', async () => {
    const repo = createBookProfilesRepository(db);
    const tx = db.transaction('book_profiles', 'readwrite');
    await tx.store.put({
      bookId: 'b1',
      profile: 'not-an-object',
      prompts: [],
      profileSchemaVersion: 1,
      generatedAt: '2026-05-06T00:00:00.000Z',
    } as unknown as BookProfileRecord);
    await tx.done;
    expect(await repo.get(BookId('b1'))).toBeNull();
  });

  it('get filters records with invalid prompt category', async () => {
    const repo = createBookProfilesRepository(db);
    const tx = db.transaction('book_profiles', 'readwrite');
    const bad = makeRecord();
    await tx.store.put({
      ...bad,
      prompts: [{ text: 'x', category: 'not-a-category' }],
    } as unknown as BookProfileRecord);
    await tx.done;
    expect(await repo.get(BookId('b1'))).toBeNull();
  });

  it('get filters records with invalid structure', async () => {
    const repo = createBookProfilesRepository(db);
    const tx = db.transaction('book_profiles', 'readwrite');
    const bad = makeRecord();
    await tx.store.put({
      ...bad,
      profile: { ...bad.profile, structure: 'not-a-structure' },
    } as unknown as BookProfileRecord);
    await tx.done;
    expect(await repo.get(BookId('b1'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/storage/repositories/bookProfiles.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the repository**

Create `src/storage/repositories/bookProfiles.ts`:

```typescript
import {
  BookId,
  IsoTimestamp,
  type BookProfile,
  type BookProfileRecord,
  type BookStructure,
  type SuggestedPrompt,
  type SuggestedPromptCategory,
} from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_PROFILES_STORE } from '../db/schema';

export type BookProfilesRepository = {
  get(bookId: BookId): Promise<BookProfileRecord | null>;
  put(record: BookProfileRecord): Promise<void>;
  deleteByBook(bookId: BookId): Promise<void>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
};

const VALID_STRUCTURES: ReadonlySet<BookStructure> = new Set([
  'fiction',
  'nonfiction',
  'textbook',
  'reference',
]);

const VALID_CATEGORIES: ReadonlySet<SuggestedPromptCategory> = new Set([
  'comprehension',
  'analysis',
  'structure',
  'creative',
  'study',
]);

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function normalizeProfile(value: unknown): BookProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.summary !== 'string') return null;
  if (typeof p.genre !== 'string') return null;
  if (typeof p.structure !== 'string') return null;
  if (!VALID_STRUCTURES.has(p.structure as BookStructure)) return null;
  if (!isStringArray(p.themes)) return null;
  if (typeof p.keyEntities !== 'object' || p.keyEntities === null) return null;
  const ke = p.keyEntities as Record<string, unknown>;
  if (!isStringArray(ke.characters)) return null;
  if (!isStringArray(ke.concepts)) return null;
  if (!isStringArray(ke.places)) return null;
  return {
    summary: p.summary,
    genre: p.genre,
    structure: p.structure as BookStructure,
    themes: p.themes,
    keyEntities: {
      characters: ke.characters,
      concepts: ke.concepts,
      places: ke.places,
    },
  };
}

function normalizePrompt(value: unknown): SuggestedPrompt | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.text !== 'string' || p.text === '') return null;
  if (typeof p.category !== 'string') return null;
  if (!VALID_CATEGORIES.has(p.category as SuggestedPromptCategory)) return null;
  return { text: p.text, category: p.category as SuggestedPromptCategory };
}

function normalizeRecord(value: unknown): BookProfileRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.bookId !== 'string' || r.bookId === '') return null;
  const profile = normalizeProfile(r.profile);
  if (profile === null) return null;
  if (!Array.isArray(r.prompts)) return null;
  const prompts = r.prompts.map(normalizePrompt);
  if (prompts.some((p) => p === null)) return null;
  if (typeof r.profileSchemaVersion !== 'number' || !Number.isInteger(r.profileSchemaVersion)) {
    return null;
  }
  if (typeof r.generatedAt !== 'string') return null;
  return {
    bookId: BookId(r.bookId),
    profile,
    prompts: prompts as readonly SuggestedPrompt[],
    profileSchemaVersion: r.profileSchemaVersion,
    generatedAt: IsoTimestamp(r.generatedAt),
  };
}

export function createBookProfilesRepository(db: BookwormDB): BookProfilesRepository {
  return {
    async get(bookId) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readonly');
      const raw = await tx.store.get(bookId);
      return raw === undefined ? null : normalizeRecord(raw);
    },
    async put(record) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readwrite');
      await tx.store.put(record);
      await tx.done;
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readwrite');
      await tx.store.delete(bookId);
      await tx.done;
    },
    async countStaleVersions(currentVersion) {
      const tx = db.transaction(BOOK_PROFILES_STORE, 'readonly');
      const stale = new Set<BookId>();
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const r = normalizeRecord(cursor.value);
        if (r !== null && r.profileSchemaVersion < currentVersion) {
          stale.add(r.bookId);
        }
        cursor = await cursor.continue();
      }
      return [...stale];
    },
  };
}
```

- [ ] **Step 4: Re-export from storage barrel**

In `src/storage/index.ts`, after the `bookEmbeddings` re-export block, add:

```typescript
export {
  createBookProfilesRepository,
  type BookProfilesRepository,
} from './repositories/bookProfiles';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/storage/repositories/bookProfiles.test.ts`

Expected: PASS — all 9 cases.

- [ ] **Step 6: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storage/repositories/bookProfiles.ts src/storage/repositories/bookProfiles.test.ts src/storage/index.ts
git commit -m "$(cat <<'EOF'
feat(storage): BookProfilesRepository — get/put/deleteByBook/countStaleVersions

Mirrors the BookEmbeddingsRepository surface but keyed by BookId (no
secondary indexes). Validating reads filter malformed records (invalid
structure, invalid prompt category, missing fields) and return null so
the calling hook can treat the read as a cache miss and regenerate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Pure helpers — schema constant + sampling + prompt assembly + validation

**Files:**
- Create: `src/features/ai/prompts/PROFILE_SCHEMA_VERSION.ts`
- Create: `src/features/ai/prompts/bookProfileSchema.ts`
- Create: `src/features/ai/prompts/sampleChunksForProfile.ts` (+test)
- Create: `src/features/ai/prompts/assembleProfilePrompt.ts` (+test)
- Create: `src/features/ai/prompts/validateProfile.ts` (+test)

**Goal:** Pure helpers with no I/O. Test-first. The schema literal is the single source of truth for both request-time `response_format` and post-response `validateProfile` checks.

- [ ] **Step 1: Write failing tests for `sampleChunksForProfile`**

Create `src/features/ai/prompts/sampleChunksForProfile.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { sampleChunksForProfile } from './sampleChunksForProfile';
import { BookId, ChunkId, SectionId, type TextChunk } from '@/domain';

function chunk(sectionId: string, idx: number, tokens: number): TextChunk {
  return {
    id: ChunkId(`chunk-b1-${sectionId}-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId(sectionId),
    sectionTitle: `Ch ${sectionId}`,
    text: `chunk ${sectionId}-${String(idx)}`,
    normalizedText: `chunk ${sectionId}-${String(idx)}`,
    tokenEstimate: tokens,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

describe('sampleChunksForProfile', () => {
  it('returns empty for zero sections', () => {
    expect(sampleChunksForProfile([], { budgetTokens: 3000 })).toEqual([]);
  });

  it('takes the first chunk of each section under budget', () => {
    const sections = [
      { sectionId: SectionId('s1'), chunks: [chunk('s1', 0, 100), chunk('s1', 1, 100)] },
      { sectionId: SectionId('s2'), chunks: [chunk('s2', 0, 100)] },
    ];
    const result = sampleChunksForProfile(sections, { budgetTokens: 1000 });
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(ChunkId('chunk-b1-s1-0'));
    expect(result[1]?.id).toBe(ChunkId('chunk-b1-s2-0'));
  });

  it('honors the token budget, stopping greedily', () => {
    const sections = Array.from({ length: 10 }, (_, i) => ({
      sectionId: SectionId(`s${String(i)}`),
      chunks: [chunk(`s${String(i)}`, 0, 400)],
    }));
    const result = sampleChunksForProfile(sections, { budgetTokens: 1000 });
    // 400 + 400 = 800 fits; 800 + 400 = 1200 overflows → stop after 2.
    expect(result).toHaveLength(2);
  });

  it('strides across sections to spread coverage', () => {
    const sections = Array.from({ length: 20 }, (_, i) => ({
      sectionId: SectionId(`s${String(i)}`),
      chunks: [chunk(`s${String(i)}`, 0, 400)],
    }));
    // budget=3000 → desiredSamples = floor(3000/400) = 7 → stride=ceil(20/7)=3
    // → take s0, s3, s6, s9, s12, s15, s18 → 7 sections, 7 * 400 = 2800 tokens
    const result = sampleChunksForProfile(sections, { budgetTokens: 3000 });
    expect(result.map((c) => c.sectionId)).toEqual([
      SectionId('s0'),
      SectionId('s3'),
      SectionId('s6'),
      SectionId('s9'),
      SectionId('s12'),
      SectionId('s15'),
      SectionId('s18'),
    ]);
  });

  it('is deterministic — same input yields same output', () => {
    const sections = [
      { sectionId: SectionId('s1'), chunks: [chunk('s1', 0, 100)] },
      { sectionId: SectionId('s2'), chunks: [chunk('s2', 0, 100)] },
    ];
    const a = sampleChunksForProfile(sections, { budgetTokens: 500 });
    const b = sampleChunksForProfile(sections, { budgetTokens: 500 });
    expect(a).toEqual(b);
  });

  it('handles single section with multiple chunks (samplesPerSection default = 1)', () => {
    const sections = [
      {
        sectionId: SectionId('s1'),
        chunks: [chunk('s1', 0, 100), chunk('s1', 1, 100), chunk('s1', 2, 100)],
      },
    ];
    const result = sampleChunksForProfile(sections, { budgetTokens: 1000 });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(ChunkId('chunk-b1-s1-0'));
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm vitest run src/features/ai/prompts/sampleChunksForProfile.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `PROFILE_SCHEMA_VERSION.ts`**

Create `src/features/ai/prompts/PROFILE_SCHEMA_VERSION.ts`:

```typescript
export const PROFILE_SCHEMA_VERSION = 1;
```

- [ ] **Step 4: Implement `sampleChunksForProfile.ts`**

Create `src/features/ai/prompts/sampleChunksForProfile.ts`:

```typescript
import type { SectionId, TextChunk } from '@/domain';

export type ProfileSamplingSection = {
  readonly sectionId: SectionId;
  readonly chunks: readonly TextChunk[];
};

export type ProfileSamplingOptions = {
  readonly budgetTokens: number;
  readonly samplesPerSection?: number;
};

const APPROX_TOKENS_PER_CHUNK = 400;

export function sampleChunksForProfile(
  sections: readonly ProfileSamplingSection[],
  options: ProfileSamplingOptions,
): readonly TextChunk[] {
  if (sections.length === 0) return [];
  const samplesPerSection = options.samplesPerSection ?? 1;
  const desiredSamples = Math.max(
    1,
    Math.floor(options.budgetTokens / APPROX_TOKENS_PER_CHUNK),
  );
  const stride = Math.max(1, Math.ceil(sections.length / desiredSamples));

  const out: TextChunk[] = [];
  let totalTokens = 0;
  for (let i = 0; i < sections.length; i += stride) {
    const section = sections[i];
    if (section === undefined) continue;
    const head = section.chunks.slice(0, samplesPerSection);
    for (const c of head) {
      const wouldBe = totalTokens + c.tokenEstimate;
      if (wouldBe > options.budgetTokens) return out;
      out.push(c);
      totalTokens = wouldBe;
    }
  }
  return out;
}
```

- [ ] **Step 5: Run sampling tests — pass**

Run: `pnpm vitest run src/features/ai/prompts/sampleChunksForProfile.test.ts`

Expected: PASS — 6 cases.

- [ ] **Step 6: Write failing tests for `assembleProfilePrompt`**

Create `src/features/ai/prompts/assembleProfilePrompt.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { assembleProfilePrompt, BOOK_PROFILE_SYSTEM_PROMPT } from './assembleProfilePrompt';
import {
  BookId,
  ChunkId,
  SectionId,
  type TextChunk,
  type TocEntry,
} from '@/domain';

function chunk(sectionId: string, sectionTitle: string, text: string): TextChunk {
  return {
    id: ChunkId(`chunk-b1-${sectionId}-0`),
    bookId: BookId('b1'),
    sectionId: SectionId(sectionId),
    sectionTitle,
    text,
    normalizedText: text,
    tokenEstimate: 5,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

const tocEntry = (id: string, title: string, depth: number): TocEntry => ({
  id: SectionId(id),
  title,
  anchor: { kind: 'epub-cfi', cfi: `/6/${id}` },
  depth,
});

describe('assembleProfilePrompt', () => {
  it('returns [system, user] message pair', () => {
    const messages = assembleProfilePrompt(
      { title: 'Pride and Prejudice', author: 'Austen', toc: [] },
      [],
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('system prompt mentions schema, categories, and specificity demand', () => {
    expect(BOOK_PROFILE_SYSTEM_PROMPT).toMatch(/JSON/);
    expect(BOOK_PROFILE_SYSTEM_PROMPT).toMatch(/comprehension/);
    expect(BOOK_PROFILE_SYSTEM_PROMPT).toMatch(/specific/);
  });

  it('user message contains title, author, and TOC', () => {
    const messages = assembleProfilePrompt(
      {
        title: 'Pride and Prejudice',
        author: 'Jane Austen',
        toc: [tocEntry('s1', 'Chapter One', 0), tocEntry('s2', 'Chapter Two', 0)],
      },
      [],
    );
    const body = messages[1]?.content ?? '';
    expect(body).toContain('Pride and Prejudice');
    expect(body).toContain('Jane Austen');
    expect(body).toContain('Chapter One');
    expect(body).toContain('Chapter Two');
  });

  it('user message contains sampled excerpts with section headers', () => {
    const messages = assembleProfilePrompt(
      { title: 'B', toc: [] },
      [chunk('s1', 'Ch 1', 'Lorem ipsum.'), chunk('s2', 'Ch 2', 'Dolor sit amet.')],
    );
    const body = messages[1]?.content ?? '';
    expect(body).toContain('Ch 1');
    expect(body).toContain('Lorem ipsum.');
    expect(body).toContain('Ch 2');
    expect(body).toContain('Dolor sit amet.');
  });

  it('TOC depth indents nested entries', () => {
    const messages = assembleProfilePrompt(
      {
        title: 'B',
        toc: [tocEntry('s1', 'Part One', 0), tocEntry('s1.1', 'Sub', 1)],
      },
      [],
    );
    const body = messages[1]?.content ?? '';
    // Depth-1 entry should be indented (some whitespace before the bullet/title).
    expect(body).toMatch(/^\s+.*Sub/m);
  });

  it('renders "(none)" for empty TOC', () => {
    const messages = assembleProfilePrompt({ title: 'B', toc: [] }, []);
    expect(messages[1]?.content).toContain('(none)');
  });

  it('renders Author: Unknown when author is absent', () => {
    const messages = assembleProfilePrompt({ title: 'B', toc: [] }, []);
    expect(messages[1]?.content).toContain('Unknown');
  });
});
```

- [ ] **Step 7: Implement `assembleProfilePrompt.ts`**

Create `src/features/ai/prompts/assembleProfilePrompt.ts`:

```typescript
import type { TextChunk, TocEntry } from '@/domain';
import type { ChatCompletionMessage } from '@/features/ai/chat/nanogptChat';

export const BOOK_PROFILE_SYSTEM_PROMPT = [
  'You are characterizing a book to help a reader explore it.',
  'Return a JSON object with two top-level fields:',
  '`profile` containing summary (2-4 sentences), genre, structure, themes (3-8), and',
  'keyEntities (characters, concepts, places).',
  '`prompts` containing 4-8 suggested questions the reader might ask.',
  'Each prompt MUST reference something specific from the book: an entity, a theme,',
  'or a chapter title. Avoid generic prompts like "What is this book about?".',
  'Each prompt must be category-tagged with one of:',
  'comprehension, analysis, structure, creative, study.',
  'Distribute prompts across at least 3 of the 5 categories.',
  'If the book is fiction, include relationship-arc and motive-tracking prompts.',
  'If non-fiction, include claim-mapping and key-term prompts.',
  'If textbook, include prerequisite-map and exam-style prompts.',
  'If keyEntities is sparse (poetry, anthology), lean on themes for grounding.',
].join(' ');

function renderToc(toc: readonly TocEntry[]): string {
  if (toc.length === 0) return '(none)';
  return toc
    .map((entry) => `${'  '.repeat(entry.depth)}- ${entry.title}`)
    .join('\n');
}

function renderExcerpts(chunks: readonly TextChunk[]): string {
  if (chunks.length === 0) return '(no excerpts available)';
  return chunks
    .map((c) => `[Section: ${c.sectionTitle}]\n${c.text}`)
    .join('\n\n');
}

export function assembleProfilePrompt(
  book: { readonly title: string; readonly author?: string; readonly toc: readonly TocEntry[] },
  sampledChunks: readonly TextChunk[],
): readonly ChatCompletionMessage[] {
  const author = book.author ?? 'Unknown';
  const userContent = [
    `Title: ${book.title}`,
    `Author: ${author}`,
    '',
    'Table of contents:',
    renderToc(book.toc),
    '',
    'Sampled excerpts (one per representative section):',
    '',
    renderExcerpts(sampledChunks),
  ].join('\n');

  return [
    { role: 'system', content: BOOK_PROFILE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
```

- [ ] **Step 8: Run prompt-assembly tests — pass**

Run: `pnpm vitest run src/features/ai/prompts/assembleProfilePrompt.test.ts`

Expected: PASS — 7 cases.

- [ ] **Step 9: Implement `bookProfileSchema.ts`**

Create `src/features/ai/prompts/bookProfileSchema.ts`:

```typescript
export const BOOK_PROFILE_SCHEMA = {
  name: 'book_profile_with_prompts',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['profile', 'prompts'],
    properties: {
      profile: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'genre', 'structure', 'themes', 'keyEntities'],
        properties: {
          summary: { type: 'string' },
          genre: { type: 'string' },
          structure: {
            type: 'string',
            enum: ['fiction', 'nonfiction', 'textbook', 'reference'],
          },
          themes: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 8,
          },
          keyEntities: {
            type: 'object',
            additionalProperties: false,
            required: ['characters', 'concepts', 'places'],
            properties: {
              characters: { type: 'array', items: { type: 'string' } },
              concepts: { type: 'array', items: { type: 'string' } },
              places: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      prompts: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'category'],
          properties: {
            text: { type: 'string' },
            category: {
              type: 'string',
              enum: ['comprehension', 'analysis', 'structure', 'creative', 'study'],
            },
          },
        },
      },
    },
  },
} as const;
```

- [ ] **Step 10: Write failing tests for `validateProfile`**

Create `src/features/ai/prompts/validateProfile.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { validateProfile } from './validateProfile';
import { BookId } from '@/domain';

const validRaw = {
  profile: {
    summary: 'A short novel.',
    genre: 'classic',
    structure: 'fiction',
    themes: ['marriage'],
    keyEntities: {
      characters: ['Elizabeth'],
      concepts: ['pride'],
      places: ['Pemberley'],
    },
  },
  prompts: [
    { text: 'Track motives.', category: 'analysis' },
    { text: 'Map relations.', category: 'structure' },
    { text: 'Foreshadowing scenes.', category: 'analysis' },
    { text: 'Title meaning.', category: 'comprehension' },
  ],
};

describe('validateProfile', () => {
  it('happy path returns BookProfileRecord with bookId, schemaVersion, generatedAt', () => {
    const r = validateProfile(validRaw, BookId('b1'), 1);
    expect(r.bookId).toBe(BookId('b1'));
    expect(r.profileSchemaVersion).toBe(1);
    expect(r.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(r.profile.structure).toBe('fiction');
    expect(r.prompts).toHaveLength(4);
  });

  it('rejects missing top-level profile', () => {
    expect(() => validateProfile({ prompts: validRaw.prompts }, BookId('b1'), 1)).toThrow();
  });

  it('rejects missing top-level prompts', () => {
    expect(() => validateProfile({ profile: validRaw.profile }, BookId('b1'), 1)).toThrow();
  });

  it('rejects fewer than 4 prompts', () => {
    expect(() =>
      validateProfile(
        { ...validRaw, prompts: validRaw.prompts.slice(0, 3) },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('trims prompts to at most 8', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      text: `Q${String(i)}`,
      category: 'analysis' as const,
    }));
    const r = validateProfile({ ...validRaw, prompts: many }, BookId('b1'), 1);
    expect(r.prompts).toHaveLength(8);
  });

  it('rejects invalid structure enum', () => {
    expect(() =>
      validateProfile(
        { ...validRaw, profile: { ...validRaw.profile, structure: 'novel' } },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('rejects invalid prompt category enum', () => {
    expect(() =>
      validateProfile(
        {
          ...validRaw,
          prompts: [{ text: 'x', category: 'fun' }, ...validRaw.prompts.slice(0, 3)],
        },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('rejects empty themes array', () => {
    expect(() =>
      validateProfile(
        { ...validRaw, profile: { ...validRaw.profile, themes: [] } },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => validateProfile(null, BookId('b1'), 1)).toThrow();
    expect(() => validateProfile('string', BookId('b1'), 1)).toThrow();
  });
});
```

- [ ] **Step 11: Implement `validateProfile.ts`**

Create `src/features/ai/prompts/validateProfile.ts`:

```typescript
import {
  IsoTimestamp,
  type BookId,
  type BookProfile,
  type BookProfileRecord,
  type BookStructure,
  type SuggestedPrompt,
  type SuggestedPromptCategory,
} from '@/domain';

const VALID_STRUCTURES: ReadonlySet<string> = new Set([
  'fiction',
  'nonfiction',
  'textbook',
  'reference',
]);

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'comprehension',
  'analysis',
  'structure',
  'creative',
  'study',
]);

const MAX_PROMPTS = 8;
const MIN_PROMPTS = 4;
const MIN_THEMES = 1;

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function fail(reason: string): never {
  throw new Error(`validateProfile: ${reason}`);
}

function parseProfile(value: unknown): BookProfile {
  if (typeof value !== 'object' || value === null) fail('profile is not an object');
  const p = value as Record<string, unknown>;
  if (typeof p.summary !== 'string') fail('profile.summary missing or not a string');
  if (typeof p.genre !== 'string') fail('profile.genre missing or not a string');
  if (typeof p.structure !== 'string' || !VALID_STRUCTURES.has(p.structure)) {
    fail('profile.structure missing or not in enum');
  }
  if (!isStringArray(p.themes)) fail('profile.themes is not a string array');
  if (p.themes.length < MIN_THEMES) fail('profile.themes is empty');
  if (typeof p.keyEntities !== 'object' || p.keyEntities === null) {
    fail('profile.keyEntities is not an object');
  }
  const ke = p.keyEntities as Record<string, unknown>;
  if (!isStringArray(ke.characters)) fail('profile.keyEntities.characters not a string array');
  if (!isStringArray(ke.concepts)) fail('profile.keyEntities.concepts not a string array');
  if (!isStringArray(ke.places)) fail('profile.keyEntities.places not a string array');
  return {
    summary: p.summary,
    genre: p.genre,
    structure: p.structure as BookStructure,
    themes: p.themes,
    keyEntities: {
      characters: ke.characters,
      concepts: ke.concepts,
      places: ke.places,
    },
  };
}

function parsePrompt(value: unknown, index: number): SuggestedPrompt {
  if (typeof value !== 'object' || value === null) fail(`prompts[${String(index)}] not an object`);
  const p = value as Record<string, unknown>;
  if (typeof p.text !== 'string' || p.text === '') fail(`prompts[${String(index)}].text missing`);
  if (typeof p.category !== 'string' || !VALID_CATEGORIES.has(p.category)) {
    fail(`prompts[${String(index)}].category not in enum`);
  }
  return { text: p.text, category: p.category as SuggestedPromptCategory };
}

export function validateProfile(
  raw: unknown,
  bookId: BookId,
  schemaVersion: number,
): BookProfileRecord {
  if (typeof raw !== 'object' || raw === null) fail('input is not an object');
  const r = raw as Record<string, unknown>;
  if (!('profile' in r)) fail('top-level profile missing');
  if (!('prompts' in r)) fail('top-level prompts missing');
  if (!Array.isArray(r.prompts)) fail('prompts is not an array');
  if (r.prompts.length < MIN_PROMPTS) fail(`prompts has < ${String(MIN_PROMPTS)} entries`);

  const profile = parseProfile(r.profile);
  const prompts = r.prompts
    .slice(0, MAX_PROMPTS)
    .map((p, i) => parsePrompt(p, i));

  return {
    bookId,
    profile,
    prompts,
    profileSchemaVersion: schemaVersion,
    generatedAt: IsoTimestamp(new Date().toISOString()),
  };
}
```

- [ ] **Step 12: Run validation tests — pass**

Run: `pnpm vitest run src/features/ai/prompts/validateProfile.test.ts`

Expected: PASS — 9 cases.

- [ ] **Step 13: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add src/features/ai/prompts/
git commit -m "$(cat <<'EOF'
feat(prompts): BOOK_PROFILE_SCHEMA + sampleChunksForProfile + assembleProfilePrompt + validateProfile

Pure helpers for the profile-generation pipeline:
- PROFILE_SCHEMA_VERSION constant (= 1).
- BOOK_PROFILE_SCHEMA — single source of truth for both request-time
  response_format and post-response defensive validation.
- sampleChunksForProfile — even-stride first-chunks under a token budget.
- assembleProfilePrompt — [system, user] message pair with title,
  author, indented TOC, sampled excerpts.
- validateProfile — defensively re-validates the LLM response; trims
  prompts to <=8; throws Error with descriptive message on schema
  violations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---


## Task 5: `nanogptStructured` network module

**Files:**
- Create: `src/features/ai/chat/nanogptStructured.ts`
- Create: `src/features/ai/chat/nanogptStructured.test.ts`

**Goal:** Single-call POST to `/v1/chat/completions` with `response_format: { type: 'json_schema', json_schema }`. Mirrors `nanogptChat.ts` failure taxonomy plus a new `'schema-violation'` reason.

> ⚠️ **IMPLEMENTATION-TIME VERIFICATION (before completing this task):** With a known-good NanoGPT API key, verify `response_format: json_schema` is supported:
>
> ```bash
> curl -sS https://nano-gpt.com/api/v1/chat/completions \
>   -H "Authorization: Bearer $NANOGPT_KEY" \
>   -H "Content-Type: application/json" \
>   -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Return {\"ok\":true}"}],
>        "response_format":{"type":"json_schema","json_schema":{"name":"probe","strict":true,
>          "schema":{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}}}}' \
>   | jq '.choices[0].message.content'
> ```
>
> Expected: `"{\"ok\":true}"`. If unsupported, fall back to a "Respond with JSON matching this schema:" prompt-instruction approach + tighter `validateProfile` and document the divergence in `docs/02-system-architecture.md`'s decision history.

- [ ] **Step 1: Write failing tests**

Create `src/features/ai/chat/nanogptStructured.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { complete, StructuredError } from './nanogptStructured';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

const PROBE_SCHEMA = {
  name: 'probe',
  strict: true as const,
  schema: {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  },
};

function makeOkResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('nanogptStructured.complete', () => {
  it('happy path JSON-parses choices[0].message.content into T', async () => {
    mockFetch((_input, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer KEY');
      const body = JSON.parse(init?.body as string) as {
        model: string;
        messages: { role: string; content: string }[];
        response_format: { type: string; json_schema: { name: string } };
      };
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.name).toBe('probe');
      return Promise.resolve(makeOkResponse('{"ok":true}'));
    });
    const result = await complete<{ ok: boolean }>({
      apiKey: 'KEY',
      modelId: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Return ok=true' }],
      schema: PROBE_SCHEMA,
    });
    expect(result.value).toEqual({ ok: true });
    expect(result.usage?.prompt).toBe(10);
    expect(result.usage?.completion).toBe(5);
  });

  it('throws invalid-key on 401', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 401 })));
    await expect(
      complete({
        apiKey: 'BAD',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'invalid-key', status: 401 } });
  });

  it('throws rate-limit with retryAfterSeconds on 429', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '5' } })),
    );
    try {
      await complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError);
      expect((e as StructuredError).failure).toEqual({
        reason: 'rate-limit',
        status: 429,
        retryAfterSeconds: 5,
      });
    }
  });

  it('throws model-unavailable on 404', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'nope',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'model-unavailable', status: 404 } });
  });

  it('throws server on 500', async () => {
    mockFetch(() => Promise.resolve(new Response('', { status: 500 })));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'server', status: 500 } });
  });

  it('throws network on fetch rejection', async () => {
    mockFetch(() => Promise.reject(new TypeError('network down')));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'network' } });
  });

  it('throws aborted when AbortError fires', async () => {
    mockFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'aborted' } });
  });

  it('throws malformed-response on non-JSON body', async () => {
    mockFetch(() => Promise.resolve(new Response('not json', { status: 200 })));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });

  it('throws malformed-response when message.content is empty', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
        }),
      ),
    );
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });

  it('throws malformed-response when content is not valid JSON', async () => {
    mockFetch(() => Promise.resolve(makeOkResponse('this is not json')));
    await expect(
      complete({
        apiKey: 'KEY',
        modelId: 'gpt-4o-mini',
        messages: [],
        schema: PROBE_SCHEMA,
      }),
    ).rejects.toMatchObject({ failure: { reason: 'malformed-response' } });
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm vitest run src/features/ai/chat/nanogptStructured.test.ts`

Expected: FAIL.

- [ ] **Step 3: Run the implementation-time probe (see warning above)**

Document the response shape in your scratch notes. If the probe fails, adapt Step 4's parser and update the spec's risk-mitigation note.

- [ ] **Step 4: Implement `nanogptStructured.ts`**

Create `src/features/ai/chat/nanogptStructured.ts`:

```typescript
import type { ChatCompletionMessage } from './nanogptChat';

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type StructuredJsonSchema = {
  readonly name: string;
  readonly strict: true;
  readonly schema: object;
};

export type StructuredRequest = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly messages: readonly ChatCompletionMessage[];
  readonly schema: StructuredJsonSchema;
  readonly signal?: AbortSignal;
};

export type StructuredResult<T> = {
  readonly value: T;
  readonly usage?: { readonly prompt: number; readonly completion: number };
};

export type StructuredFailure =
  | { readonly reason: 'invalid-key'; readonly status: 401 | 403 }
  | { readonly reason: 'rate-limit'; readonly status: 429; readonly retryAfterSeconds?: number }
  | { readonly reason: 'model-unavailable'; readonly status: 404 | 400 }
  | { readonly reason: 'server'; readonly status: number }
  | { readonly reason: 'network' }
  | { readonly reason: 'aborted' }
  | { readonly reason: 'malformed-response' }
  | { readonly reason: 'schema-violation'; readonly issue: string };

export class StructuredError extends Error {
  readonly failure: StructuredFailure;
  constructor(failure: StructuredFailure) {
    super(`structured request failed: ${failure.reason}`);
    this.name = 'StructuredError';
    this.failure = failure;
  }
}

// Client surface used by callers; apiKey is bound at construction time so
// downstream code (orchestrators, hooks) doesn't have to thread the key.
export type StructuredClient = {
  complete<T>(req: Omit<StructuredRequest, 'apiKey'>): Promise<StructuredResult<T>>;
};

function classifyHttpFailure(res: Response): StructuredFailure {
  const status = res.status;
  if (status === 401 || status === 403) return { reason: 'invalid-key', status };
  if (status === 429) {
    const ra = res.headers.get('Retry-After');
    const parsed = ra !== null ? Number.parseInt(ra, 10) : Number.NaN;
    return Number.isFinite(parsed)
      ? { reason: 'rate-limit', status: 429, retryAfterSeconds: parsed }
      : { reason: 'rate-limit', status: 429 };
  }
  if (status === 404 || status === 400) return { reason: 'model-unavailable', status };
  return { reason: 'server', status };
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

type RawChatResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function complete<T>(req: StructuredRequest): Promise<StructuredResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${NANOGPT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.modelId,
        messages: req.messages,
        response_format: { type: 'json_schema', json_schema: req.schema },
      }),
      ...(req.signal !== undefined && { signal: req.signal }),
    });
  } catch (e) {
    if (isAbortError(e)) throw new StructuredError({ reason: 'aborted' });
    throw new StructuredError({ reason: 'network' });
  }

  if (!res.ok) throw new StructuredError(classifyHttpFailure(res));

  let payload: RawChatResponse;
  try {
    payload = (await res.json()) as RawChatResponse;
  } catch {
    throw new StructuredError({ reason: 'malformed-response' });
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content === '') {
    throw new StructuredError({ reason: 'malformed-response' });
  }

  let value: T;
  try {
    value = JSON.parse(content) as T;
  } catch {
    throw new StructuredError({ reason: 'malformed-response' });
  }

  const result: StructuredResult<T> =
    typeof payload.usage?.prompt_tokens === 'number' &&
    typeof payload.usage.completion_tokens === 'number'
      ? {
          value,
          usage: {
            prompt: payload.usage.prompt_tokens,
            completion: payload.usage.completion_tokens,
          },
        }
      : { value };
  return result;
}
```

- [ ] **Step 5: Run tests — pass**

Run: `pnpm vitest run src/features/ai/chat/nanogptStructured.test.ts`

Expected: PASS — 10 cases.

- [ ] **Step 6: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/ai/chat/nanogptStructured.ts src/features/ai/chat/nanogptStructured.test.ts
git commit -m "$(cat <<'EOF'
feat(network): nanogptStructured — POST /v1/chat/completions with response_format:json_schema

Single-call (non-streaming) module for schema-constrained responses.
Mirrors nanogptChat's StructuredError + StructuredFailure pattern.
Parses choices[0].message.content as JSON; throws malformed-response on
empty content, non-JSON body, or JSON.parse failure. The schema-violation
failure variant is reserved for orchestrator-level validation (see
runProfileGeneration in Task 6).

Implementation-time verification probe documented; v1 assumes NanoGPT
proxy supports response_format:{type:'json_schema'} per OpenAI spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `runProfileGeneration` orchestrator

**Files:**
- Create: `src/features/ai/prompts/runProfileGeneration.ts`
- Create: `src/features/ai/prompts/runProfileGeneration.test.ts`

**Goal:** Side-effectful orchestrator with discriminated-union result. Reads chunks → samples → builds prompt → calls structured client → validates → persists.

- [ ] **Step 1: Write failing tests**

Create `src/features/ai/prompts/runProfileGeneration.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { runProfileGeneration } from './runProfileGeneration';
import {
  BookId,
  ChunkId,
  IsoTimestamp,
  SectionId,
  type Book,
  type BookProfileRecord,
  type TextChunk,
  type TocEntry,
} from '@/domain';
import type { BookChunksRepository, BookProfilesRepository } from '@/storage';
import type { StructuredClient } from '@/features/ai/chat/nanogptStructured';
import { StructuredError } from '@/features/ai/chat/nanogptStructured';

function mkChunk(idx: number): TextChunk {
  return {
    id: ChunkId(`chunk-b1-s1-${String(idx)}`),
    bookId: BookId('b1'),
    sectionId: SectionId('s1'),
    sectionTitle: 'Ch 1',
    text: `chunk ${String(idx)}`,
    normalizedText: `chunk ${String(idx)}`,
    tokenEstimate: 50,
    locationAnchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2' },
    checksum: 'cs',
    chunkerVersion: 1,
  };
}

const sampleBook: Pick<Book, 'id' | 'title' | 'author' | 'toc'> = {
  id: BookId('b1'),
  title: 'Test',
  author: 'Author',
  toc: [
    {
      id: SectionId('s1'),
      title: 'Ch 1',
      anchor: { kind: 'epub-cfi', cfi: '/6/2' },
      depth: 0,
    } satisfies TocEntry,
  ],
};

const validRawProfile = {
  profile: {
    summary: 'A short novel.',
    genre: 'classic',
    structure: 'fiction',
    themes: ['marriage'],
    keyEntities: { characters: ['Eliza'], concepts: [], places: [] },
  },
  prompts: [
    { text: 'Track motives.', category: 'analysis' },
    { text: 'Map relations.', category: 'structure' },
    { text: 'Foreshadow scenes.', category: 'analysis' },
    { text: 'Title meaning.', category: 'comprehension' },
  ],
};

function chunksRepoFromList(chunks: readonly TextChunk[]): BookChunksRepository {
  return {
    upsertMany: () => Promise.resolve(),
    listByBook: () => Promise.resolve(chunks),
    listBySection: () => Promise.resolve([]),
    deleteByBook: () => Promise.resolve(),
    deleteBySection: () => Promise.resolve(),
    countByBook: () => Promise.resolve(chunks.length),
    countStaleVersions: () => Promise.resolve([]),
    hasChunksFor: () => Promise.resolve(true),
  };
}

function profilesRepoStub(): BookProfilesRepository & {
  putCalls: BookProfileRecord[];
} {
  const putCalls: BookProfileRecord[] = [];
  return {
    putCalls,
    get: () => Promise.resolve(null),
    put: (r) => {
      putCalls.push(r);
      return Promise.resolve();
    },
    deleteByBook: () => Promise.resolve(),
    countStaleVersions: () => Promise.resolve([]),
  };
}

function structuredClientReturning(value: unknown): StructuredClient {
  return {
    complete: <T>() => Promise.resolve({ value: value as T }),
  };
}

function structuredClientThrowing(failure: StructuredError['failure']): StructuredClient {
  return {
    complete: () => Promise.reject(new StructuredError(failure)),
  };
}

describe('runProfileGeneration', () => {
  it('happy path persists record and returns ok', async () => {
    const profilesRepo = profilesRepoStub();
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo,
        structuredClient: structuredClientReturning(validRawProfile),
      },
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(profilesRepo.putCalls).toHaveLength(1);
    expect(result.record.profile.structure).toBe('fiction');
    expect(result.record.prompts).toHaveLength(4);
  });

  it('returns no-chunks when chunksRepo.listByBook is empty', async () => {
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientReturning(validRawProfile),
      },
    });
    expect(result.kind).toBe('no-chunks');
  });

  it('returns failed{invalid-key} when structuredClient throws invalid-key', async () => {
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientThrowing({
          reason: 'invalid-key',
          status: 401,
        }),
      },
    });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.reason).toBe('invalid-key');
  });

  it('returns failed{schema-violation} when validateProfile rejects', async () => {
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientReturning({ profile: 'wrong shape' }),
      },
    });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.reason).toBe('schema-violation');
  });

  it('returns aborted when signal is already aborted at start', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await runProfileGeneration({
      book: sampleBook,
      modelId: 'gpt-4o-mini',
      deps: {
        chunksRepo: chunksRepoFromList([mkChunk(0)]),
        profilesRepo: profilesRepoStub(),
        structuredClient: structuredClientReturning(validRawProfile),
      },
      signal: ctrl.signal,
    });
    expect(result.kind).toBe('aborted');
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm vitest run src/features/ai/prompts/runProfileGeneration.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `runProfileGeneration.ts`**

Create `src/features/ai/prompts/runProfileGeneration.ts`:

```typescript
import type { Book, BookProfileRecord, SectionId, TextChunk } from '@/domain';
import type { BookChunksRepository, BookProfilesRepository } from '@/storage';
import {
  StructuredError,
  type StructuredClient,
  type StructuredFailure,
} from '@/features/ai/chat/nanogptStructured';
import { BOOK_PROFILE_SCHEMA } from './bookProfileSchema';
import { PROFILE_SCHEMA_VERSION } from './PROFILE_SCHEMA_VERSION';
import { sampleChunksForProfile } from './sampleChunksForProfile';
import { assembleProfilePrompt } from './assembleProfilePrompt';
import { validateProfile } from './validateProfile';

const PROFILE_BUDGET_TOKENS = 3000;

export type ProfileGenerationDeps = {
  readonly chunksRepo: BookChunksRepository;
  readonly profilesRepo: BookProfilesRepository;
  readonly structuredClient: StructuredClient;
};

export type ProfileGenerationInput = {
  readonly book: Pick<Book, 'id' | 'title' | 'author' | 'toc'>;
  readonly modelId: string;
  readonly deps: ProfileGenerationDeps;
  readonly signal?: AbortSignal;
};

export type ProfileGenerationResult =
  | { readonly kind: 'ok'; readonly record: BookProfileRecord }
  | { readonly kind: 'no-chunks' }
  | { readonly kind: 'failed'; readonly reason: StructuredFailure['reason'] }
  | { readonly kind: 'aborted' };

function groupBySection(
  chunks: readonly TextChunk[],
): { sectionId: SectionId; chunks: readonly TextChunk[] }[] {
  const order: SectionId[] = [];
  const map = new Map<SectionId, TextChunk[]>();
  for (const c of chunks) {
    const list = map.get(c.sectionId);
    if (list === undefined) {
      map.set(c.sectionId, [c]);
      order.push(c.sectionId);
    } else {
      list.push(c);
    }
  }
  return order.map((sectionId) => ({
    sectionId,
    chunks: map.get(sectionId) ?? [],
  }));
}

export async function runProfileGeneration(
  input: ProfileGenerationInput,
): Promise<ProfileGenerationResult> {
  const { book, modelId, deps, signal } = input;
  if (signal?.aborted === true) return { kind: 'aborted' };

  const chunks = await deps.chunksRepo.listByBook(book.id);
  if (chunks.length === 0) return { kind: 'no-chunks' };

  if (signal?.aborted === true) return { kind: 'aborted' };

  const sections = groupBySection(chunks);
  const sampled = sampleChunksForProfile(sections, {
    budgetTokens: PROFILE_BUDGET_TOKENS,
  });
  const messages = assembleProfilePrompt(book, sampled);

  let raw: unknown;
  try {
    const result = await deps.structuredClient.complete<unknown>({
      modelId,
      messages,
      schema: BOOK_PROFILE_SCHEMA,
      ...(signal !== undefined ? { signal } : {}),
    });
    raw = result.value;
  } catch (err) {
    if (err instanceof StructuredError) {
      if (err.failure.reason === 'aborted') return { kind: 'aborted' };
      return { kind: 'failed', reason: err.failure.reason };
    }
    return { kind: 'failed', reason: 'network' };
  }

  if (signal?.aborted === true) return { kind: 'aborted' };

  let record: BookProfileRecord;
  try {
    record = validateProfile(raw, book.id, PROFILE_SCHEMA_VERSION);
  } catch {
    return { kind: 'failed', reason: 'schema-violation' };
  }

  await deps.profilesRepo.put(record);
  return { kind: 'ok', record };
}
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm vitest run src/features/ai/prompts/runProfileGeneration.test.ts`

Expected: PASS — 5 cases.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/prompts/runProfileGeneration.ts src/features/ai/prompts/runProfileGeneration.test.ts
git commit -m "feat(prompts): runProfileGeneration orchestrator with no-chunks/failed/aborted/ok variants

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `useBookProfile` hook

**Files:**
- Create: `src/features/ai/prompts/useBookProfile.ts`
- Create: `src/features/ai/prompts/useBookProfile.test.tsx`

**Goal:** Lazy-on-mount React hook that reads cached profile if available, otherwise generates one. Single-flight via ref. Retry helper for failed/no-chunks states.

- [ ] **Step 1: Write failing tests**

Create `src/features/ai/prompts/useBookProfile.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBookProfile } from './useBookProfile';
import {
  BookId,
  IsoTimestamp,
  SectionId,
  type Book,
  type BookProfileRecord,
  type TocEntry,
} from '@/domain';
import type { BookChunksRepository, BookProfilesRepository } from '@/storage';
import type { StructuredClient } from '@/features/ai/chat/nanogptStructured';

const sampleBook: Pick<Book, 'id' | 'title' | 'author' | 'toc'> = {
  id: BookId('b1'),
  title: 'T',
  author: 'A',
  toc: [
    {
      id: SectionId('s1'),
      title: 'Ch 1',
      anchor: { kind: 'epub-cfi', cfi: '/' },
      depth: 0,
    } satisfies TocEntry,
  ],
};

const cachedRecord: BookProfileRecord = {
  bookId: BookId('b1'),
  profile: {
    summary: 'cached',
    genre: 'g',
    structure: 'fiction',
    themes: ['t'],
    keyEntities: { characters: [], concepts: [], places: [] },
  },
  prompts: [
    { text: 'q1', category: 'analysis' },
    { text: 'q2', category: 'analysis' },
    { text: 'q3', category: 'analysis' },
    { text: 'q4', category: 'analysis' },
  ],
  profileSchemaVersion: 1,
  generatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
};

function makeDeps(overrides: {
  cached?: BookProfileRecord | null;
  chunks?: readonly { id: string }[];
  structuredResponse?: unknown;
  structuredThrows?: Error;
}): {
  chunksRepo: BookChunksRepository;
  profilesRepo: BookProfilesRepository;
  structuredClient: StructuredClient;
  putSpy: ReturnType<typeof vi.fn>;
} {
  const putSpy = vi.fn(() => Promise.resolve());
  const chunksRepo: BookChunksRepository = {
    upsertMany: () => Promise.resolve(),
    listByBook: () =>
      Promise.resolve(
        (overrides.chunks ?? [{ id: 'chunk-b1-s1-0' }]).map(
          (c) =>
            ({
              id: c.id,
              bookId: 'b1',
              sectionId: 's1',
              sectionTitle: 'Ch 1',
              text: 't',
              normalizedText: 't',
              tokenEstimate: 50,
              locationAnchor: { kind: 'epub-cfi', cfi: '/' },
              checksum: 'cs',
              chunkerVersion: 1,
            }) as never,
        ),
      ),
    listBySection: () => Promise.resolve([]),
    deleteByBook: () => Promise.resolve(),
    deleteBySection: () => Promise.resolve(),
    countByBook: () => Promise.resolve(1),
    countStaleVersions: () => Promise.resolve([]),
    hasChunksFor: () => Promise.resolve(true),
  };
  const profilesRepo: BookProfilesRepository = {
    get: () => Promise.resolve(overrides.cached ?? null),
    put: putSpy,
    deleteByBook: () => Promise.resolve(),
    countStaleVersions: () => Promise.resolve([]),
  };
  const structuredClient: StructuredClient = {
    complete: <T>() => {
      if (overrides.structuredThrows) return Promise.reject(overrides.structuredThrows);
      return Promise.resolve({
        value: (overrides.structuredResponse ?? {
          profile: {
            summary: 's',
            genre: 'g',
            structure: 'fiction',
            themes: ['t'],
            keyEntities: { characters: [], concepts: [], places: [] },
          },
          prompts: [
            { text: 'a', category: 'analysis' },
            { text: 'b', category: 'analysis' },
            { text: 'c', category: 'analysis' },
            { text: 'd', category: 'analysis' },
          ],
        }) as T,
      });
    },
  };
  return { chunksRepo, profilesRepo, structuredClient, putSpy };
}

describe('useBookProfile', () => {
  it('cached read short-circuits — status: ready, no put call', async () => {
    const deps = makeDeps({ cached: cachedRecord });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    if (result.current.status === 'ready') {
      expect(result.current.record.profile.summary).toBe('cached');
    }
    expect(deps.putSpy).not.toHaveBeenCalled();
  });

  it('cache miss triggers generation — idle → loading → ready, persists record', async () => {
    const deps = makeDeps({ cached: null });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(deps.putSpy).toHaveBeenCalledTimes(1);
  });

  it('enabled: false keeps state in idle', async () => {
    const deps = makeDeps({ cached: null });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: false,
        deps,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.status).toBe('idle');
    expect(deps.putSpy).not.toHaveBeenCalled();
  });

  it('returns no-chunks when book has zero chunks', async () => {
    const deps = makeDeps({ cached: null, chunks: [] });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('no-chunks');
    });
  });

  it('returns failed when structuredClient throws', async () => {
    const { StructuredError } = await import('@/features/ai/chat/nanogptStructured');
    const deps = makeDeps({
      cached: null,
      structuredThrows: new StructuredError({ reason: 'rate-limit', status: 429 }),
    });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    if (result.current.status === 'failed') {
      expect(result.current.reason).toBe('rate-limit');
    }
  });

  it('retry from failed re-runs generation', async () => {
    const deps = makeDeps({ cached: null });
    let callCount = 0;
    deps.structuredClient = {
      complete: <T>() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.reject(new Error('first-call boom'));
        }
        return Promise.resolve({
          value: {
            profile: {
              summary: 's',
              genre: 'g',
              structure: 'fiction',
              themes: ['t'],
              keyEntities: { characters: [], concepts: [], places: [] },
            },
            prompts: [
              { text: 'a', category: 'analysis' },
              { text: 'b', category: 'analysis' },
              { text: 'c', category: 'analysis' },
              { text: 'd', category: 'analysis' },
            ],
          } as T,
        });
      },
    };
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: 'gpt-4o-mini',
        enabled: true,
        deps,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(callCount).toBe(2);
  });

  it('modelId === null keeps state in idle (waits for model selection)', async () => {
    const deps = makeDeps({ cached: null });
    const { result } = renderHook(() =>
      useBookProfile({
        book: sampleBook,
        modelId: null,
        enabled: true,
        deps,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm vitest run src/features/ai/prompts/useBookProfile.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement `useBookProfile.ts`**

Create `src/features/ai/prompts/useBookProfile.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookProfileRecord } from '@/domain';
import type { StructuredFailure } from '@/features/ai/chat/nanogptStructured';
import {
  runProfileGeneration,
  type ProfileGenerationDeps,
} from './runProfileGeneration';

export type UseBookProfileState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly record: BookProfileRecord }
  | { readonly status: 'no-chunks' }
  | { readonly status: 'failed'; readonly reason: StructuredFailure['reason'] };

export type UseBookProfileHandle = UseBookProfileState & {
  readonly retry: () => void;
};

export type UseBookProfileArgs = {
  readonly book: Pick<Book, 'id' | 'title' | 'author' | 'toc'>;
  readonly modelId: string | null;
  readonly enabled: boolean;
  readonly deps: ProfileGenerationDeps;
};

export function useBookProfile(args: UseBookProfileArgs): UseBookProfileHandle {
  const [state, setState] = useState<UseBookProfileState>({ status: 'idle' });
  const [retryToken, setRetryToken] = useState<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const argsRef = useRef(args);

  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  const run = useCallback(async (signal: AbortSignal): Promise<void> => {
    if (inFlightRef.current) return;
    const a = argsRef.current;
    if (!a.enabled || a.modelId === null) return;

    inFlightRef.current = true;
    try {
      const cached = await a.deps.profilesRepo.get(a.book.id);
      if (signal.aborted) return;
      if (cached !== null) {
        setState({ status: 'ready', record: cached });
        return;
      }
      setState({ status: 'loading' });
      const result = await runProfileGeneration({
        book: a.book,
        modelId: a.modelId,
        deps: a.deps,
        signal,
      });
      if (signal.aborted) return;
      if (result.kind === 'ok') setState({ status: 'ready', record: result.record });
      else if (result.kind === 'no-chunks') setState({ status: 'no-chunks' });
      else if (result.kind === 'failed') setState({ status: 'failed', reason: result.reason });
      // 'aborted' → no state change (cleanup ran).
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void run(ctrl.signal);
    return () => {
      ctrl.abort();
    };
  }, [args.book.id, args.modelId, args.enabled, retryToken, run]);

  const retry = useCallback((): void => {
    if (inFlightRef.current) return;
    setRetryToken((t) => t + 1);
    setState({ status: 'idle' });
  }, []);

  return { ...state, retry };
}
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm vitest run src/features/ai/prompts/useBookProfile.test.tsx`

Expected: PASS — 7 cases.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/prompts/useBookProfile.ts src/features/ai/prompts/useBookProfile.test.tsx
git commit -m "feat(prompts): useBookProfile hook with single-flight + retry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `EditIcon`

**Files:**
- Create: `src/shared/icons/EditIcon.tsx`
- Modify: `src/shared/icons/index.ts` (re-export)

- [ ] **Step 1: Implement `EditIcon`**

Create `src/shared/icons/EditIcon.tsx`:

```tsx
import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function EditIcon({ size = 16, className }: Props) {
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
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" />
    </svg>
  );
}
```

- [ ] **Step 2: Add to icons barrel**

In `src/shared/icons/index.ts`, append:

```typescript
export { EditIcon } from './EditIcon';
```

- [ ] **Step 3: Run check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/icons/EditIcon.tsx src/shared/icons/index.ts
git commit -m "feat(icons): EditIcon — pencil glyph used by SuggestedPromptItem

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `SuggestedPromptItem` + `SuggestedPromptList`

**Files:**
- Create: `src/features/ai/prompts/SuggestedPromptItem.tsx` (+test)
- Create: `src/features/ai/prompts/SuggestedPromptList.tsx` (+test)
- Create: `src/features/ai/prompts/suggested-prompts.css`
- Create: `src/features/ai/prompts/index.ts` (barrel — exports `useBookProfile`, types, components)

- [ ] **Step 1: Write failing tests for `SuggestedPromptItem`**

Create `src/features/ai/prompts/SuggestedPromptItem.test.tsx`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SuggestedPromptItem } from './SuggestedPromptItem';

afterEach(() => {
  cleanup();
});

describe('SuggestedPromptItem', () => {
  it('renders prompt text and category badge', () => {
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    expect(container.textContent).toContain('Track motives.');
    expect(container.textContent?.toLowerCase()).toContain('analysis');
  });

  it('clicking the row fires onSelect with the prompt text', () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={onSelect}
        onEdit={onEdit}
      />,
    );
    const row = container.querySelector('.suggested-prompts__item');
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith('Track motives.');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('clicking the edit icon fires onEdit and not onSelect (event isolation)', () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={onSelect}
        onEdit={onEdit}
      />,
    );
    const editBtn = container.querySelector('.suggested-prompts__edit');
    expect(editBtn).not.toBeNull();
    fireEvent.click(editBtn!);
    expect(onEdit).toHaveBeenCalledWith('Track motives.');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('row aria-label is "Ask: {text}"', () => {
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    const row = container.querySelector('.suggested-prompts__item');
    expect(row?.getAttribute('aria-label')).toBe('Ask: Track motives.');
  });

  it('edit-button aria-label is "Edit before asking: {text}"', () => {
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    const editBtn = container.querySelector('.suggested-prompts__edit');
    expect(editBtn?.getAttribute('aria-label')).toBe(
      'Edit before asking: Track motives.',
    );
  });
});
```

- [ ] **Step 2: Implement `SuggestedPromptItem.tsx`**

Create `src/features/ai/prompts/SuggestedPromptItem.tsx`:

```tsx
import type { SuggestedPrompt } from '@/domain';
import { EditIcon } from '@/shared/icons';

type Props = {
  readonly prompt: SuggestedPrompt;
  readonly onSelect: (text: string) => void;
  readonly onEdit: (text: string) => void;
};

export function SuggestedPromptItem({ prompt, onSelect, onEdit }: Props) {
  return (
    <button
      type="button"
      className="suggested-prompts__item"
      aria-label={`Ask: ${prompt.text}`}
      onClick={() => {
        onSelect(prompt.text);
      }}
    >
      <span className="suggested-prompts__category">{prompt.category}</span>
      <span className="suggested-prompts__text">{prompt.text}</span>
      <span
        className="suggested-prompts__edit"
        role="button"
        tabIndex={0}
        aria-label={`Edit before asking: ${prompt.text}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(prompt.text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onEdit(prompt.text);
          }
        }}
      >
        <EditIcon size={14} />
      </span>
    </button>
  );
}
```

(The edit affordance is a `<span role="button">` not a nested `<button>` because nested buttons are invalid HTML; we get equivalent keyboard behavior with `tabIndex={0}` + Enter/Space handlers.)

- [ ] **Step 3: Run item tests — pass**

Run: `pnpm vitest run src/features/ai/prompts/SuggestedPromptItem.test.tsx`

Expected: PASS — 5 cases.

- [ ] **Step 4: Write failing tests for `SuggestedPromptList`**

Create `src/features/ai/prompts/SuggestedPromptList.test.tsx`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SuggestedPromptList } from './SuggestedPromptList';

afterEach(() => {
  cleanup();
});

describe('SuggestedPromptList', () => {
  it('renders one item per prompt', () => {
    const { container } = render(
      <SuggestedPromptList
        prompts={[
          { text: 'q1', category: 'analysis' },
          { text: 'q2', category: 'analysis' },
          { text: 'q3', category: 'comprehension' },
        ]}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    expect(container.querySelectorAll('.suggested-prompts__item')).toHaveLength(3);
  });

  it('container has role=region with aria-label', () => {
    const { container } = render(
      <SuggestedPromptList
        prompts={[{ text: 'q1', category: 'analysis' }]}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    const region = container.querySelector('.suggested-prompts');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBe('Suggested questions');
  });

  it('clicking the second item fires onSelect with that prompt text', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SuggestedPromptList
        prompts={[
          { text: 'first', category: 'analysis' },
          { text: 'second', category: 'analysis' },
        ]}
        onSelect={onSelect}
        onEdit={() => undefined}
      />,
    );
    const items = container.querySelectorAll('.suggested-prompts__item');
    fireEvent.click(items[1]!);
    expect(onSelect).toHaveBeenCalledWith('second');
  });
});
```

- [ ] **Step 5: Implement `SuggestedPromptList.tsx`**

Create `src/features/ai/prompts/SuggestedPromptList.tsx`:

```tsx
import type { SuggestedPrompt } from '@/domain';
import { SuggestedPromptItem } from './SuggestedPromptItem';
import './suggested-prompts.css';

type Props = {
  readonly prompts: readonly SuggestedPrompt[];
  readonly onSelect: (text: string) => void;
  readonly onEdit: (text: string) => void;
};

export function SuggestedPromptList({ prompts, onSelect, onEdit }: Props) {
  return (
    <div className="suggested-prompts" role="region" aria-label="Suggested questions">
      {prompts.map((p, i) => (
        <SuggestedPromptItem
          key={`${String(i)}-${p.text}`}
          prompt={p}
          onSelect={onSelect}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Implement `suggested-prompts.css`**

Create `src/features/ai/prompts/suggested-prompts.css`:

```css
.suggested-prompts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}
.suggested-prompts__item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-elevated, var(--color-surface));
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  transition: background 150ms ease;
}
.suggested-prompts__item:hover { background: var(--color-surface); }
.suggested-prompts__item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.suggested-prompts__category {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  flex-shrink: 0;
  padding-top: 2px;
}
.suggested-prompts__text { flex: 1; }
.suggested-prompts__edit {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
}
.suggested-prompts__edit:hover { color: var(--color-text); }
.suggested-prompts__edit:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.suggested-prompts__retry-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.suggested-prompts__loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  color: var(--color-text-muted);
  animation: suggested-prompts-fade-in 250ms ease;
}
@keyframes suggested-prompts-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

- [ ] **Step 7: Create `index.ts` barrel**

Create `src/features/ai/prompts/index.ts`:

```typescript
export { useBookProfile } from './useBookProfile';
export type {
  UseBookProfileHandle,
  UseBookProfileState,
  UseBookProfileArgs,
} from './useBookProfile';
export {
  runProfileGeneration,
  type ProfileGenerationDeps,
  type ProfileGenerationInput,
  type ProfileGenerationResult,
} from './runProfileGeneration';
export { SuggestedPromptList } from './SuggestedPromptList';
export { SuggestedPromptItem } from './SuggestedPromptItem';
```

- [ ] **Step 8: Run all prompts tests + check**

```bash
pnpm vitest run src/features/ai/prompts/
pnpm check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/ai/prompts/SuggestedPromptItem.tsx src/features/ai/prompts/SuggestedPromptItem.test.tsx src/features/ai/prompts/SuggestedPromptList.tsx src/features/ai/prompts/SuggestedPromptList.test.tsx src/features/ai/prompts/suggested-prompts.css src/features/ai/prompts/index.ts
git commit -m "feat(prompts): SuggestedPromptItem + SuggestedPromptList components

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `ChatComposer` `initialTextRef` one-shot drain

**Files:**
- Modify: `src/features/ai/chat/ChatComposer.tsx` (extend Props, drain ref in effect)

**Goal:** New optional `initialTextRef` prop. On render, if `initialTextRef.current` is non-null, set the textarea state to its value and null the ref. One-shot per assignment, mirrors the existing `focusRequest` pattern.

- [ ] **Step 1: Extend `Props` type**

In `src/features/ai/chat/ChatComposer.tsx`, replace the `Props` block:

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
  // Phase 5.3: when this ref's .current is non-null, the composer drains
  // it into the textarea on next render and clears the ref. Used by the
  // suggested-prompts ✎ icon to fill-without-sending.
  readonly initialTextRef?: { current: string | null };
};
```

Update the destructure in the function signature:

```typescript
export function ChatComposer({
  disabled,
  streaming,
  placeholder,
  onSend,
  onCancel,
  focusRequest,
  onToggleSearch,
  retrievalAttached,
  initialTextRef,
}: Props) {
```

- [ ] **Step 2: Drain the ref in the existing focus-request effect**

Find the existing `useEffect` that drains `focusRequest.current === true` (around line 51-56). Replace it with:

```typescript
  // Drains one-shot signals set by the workspace (Ask AI for focus, suggested
  // prompts ✎ for fill-then-focus). Both refs self-clear so each fires once
  // per assignment.
  useEffect(() => {
    if (initialTextRef?.current !== null && initialTextRef?.current !== undefined) {
      setText(initialTextRef.current);
      initialTextRef.current = null;
    }
    if (focusRequest?.current === true) {
      focusRequest.current = false;
      taRef.current?.focus();
    }
  });
```

- [ ] **Step 3: Run check**

Run: `pnpm check`

Expected: PASS — existing tests still pass; the new prop is optional.

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/chat/ChatComposer.tsx
git commit -m "feat(chat): ChatComposer initialTextRef one-shot drain for fill-on-edit

Phase 5.3 needs a way for the suggested-prompts ✎ icon to fill the
composer without sending. New optional initialTextRef mirrors the
existing focusRequest pattern: when non-null on render, the value drains
into the textarea state and the ref is cleared. Both signals are drained
in the same effect so a single ✎ click can both fill and focus.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `ChatEmptyState` — render suggested prompts in no-threads variant

**Files:**
- Modify: `src/features/ai/chat/ChatEmptyState.tsx` (extend Props, render `SuggestedPromptList` + retry/no-chunks chips)

**Goal:** Extend the `'no-threads'` variant Props with three optional fields: `promptsState`, `onSelectPrompt`, `onEditPrompt`. When all three are defined, render based on `promptsState.status`. Backward compat: when omitted, the component renders the original generic empty state.

- [ ] **Step 1: Replace `ChatEmptyState.tsx` body**

Replace the entire file contents:

```tsx
import type { UseBookProfileHandle } from '@/features/ai/prompts';
import { SuggestedPromptList } from '@/features/ai/prompts';

type Props =
  | {
      readonly variant: 'no-key';
      readonly bookTitle: string;
      readonly onOpenSettings: () => void;
    }
  | {
      readonly variant: 'no-model';
      readonly bookTitle: string;
      readonly onOpenSettings: () => void;
    }
  | {
      readonly variant: 'no-threads';
      readonly bookTitle: string;
      readonly onStartDraft: () => void;
      // Phase 5.3: when defined, render prompts/states instead of (or in
      // addition to) the generic CTA. When omitted, the original empty
      // state renders unchanged.
      readonly promptsState?: UseBookProfileHandle;
      readonly onSelectPrompt?: (text: string) => void;
      readonly onEditPrompt?: (text: string) => void;
    };

export function ChatEmptyState(props: Props) {
  if (props.variant === 'no-key') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Set up your API key to start chatting about <em>{props.bookTitle}</em>.
        </p>
        <button type="button" className="chat-empty__action" onClick={props.onOpenSettings}>
          Open Settings
        </button>
      </div>
    );
  }
  if (props.variant === 'no-model') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Choose a model in Settings to start chatting about <em>{props.bookTitle}</em>.
        </p>
        <button type="button" className="chat-empty__action" onClick={props.onOpenSettings}>
          Open Settings
        </button>
      </div>
    );
  }

  // variant === 'no-threads' — Phase 5.3 extension begins here
  const ps = props.promptsState;
  const onSelect = props.onSelectPrompt;
  const onEdit = props.onEditPrompt;
  const promptsWired = ps !== undefined && onSelect !== undefined && onEdit !== undefined;

  if (promptsWired && ps.status === 'loading') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Generating suggestions for <em>{props.bookTitle}</em>…
        </p>
        <div
          className="suggested-prompts__loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <span>Reading your book…</span>
        </div>
      </div>
    );
  }

  if (promptsWired && ps.status === 'ready') {
    return (
      <div className="chat-empty">
        <p className="chat-empty__lead">
          Suggestions for <em>{props.bookTitle}</em>:
        </p>
        <SuggestedPromptList
          prompts={ps.record.prompts}
          onSelect={onSelect}
          onEdit={onEdit}
        />
        <button
          type="button"
          className="chat-empty__action chat-empty__action--secondary"
          onClick={props.onStartDraft}
        >
          or, start a blank conversation
        </button>
      </div>
    );
  }

  // 'failed' / 'no-chunks' / 'idle' / not-wired all fall through to the
  // original button + an optional info chip below.
  const chip = !promptsWired
    ? null
    : ps.status === 'failed'
      ? (
          <button
            type="button"
            className="suggested-prompts__retry-chip"
            aria-label="Retry suggestions"
            onClick={ps.retry}
          >
            Couldn&rsquo;t load suggestions. Retry
          </button>
        )
      : ps.status === 'no-chunks'
        ? (
            <span className="suggested-prompts__retry-chip" role="status">
              This book is still being prepared for AI…
            </span>
          )
        : null;

  return (
    <div className="chat-empty">
      <p className="chat-empty__lead">
        Ask anything about <em>{props.bookTitle}</em>.
      </p>
      <button type="button" className="chat-empty__action" onClick={props.onStartDraft}>
        Start a conversation
      </button>
      {chip}
    </div>
  );
}
```

- [ ] **Step 2: Add a small CSS rule for the secondary CTA**

Append to `src/features/ai/chat/chat-panel.css` (or wherever `.chat-empty__action` is defined; check via `grep -n chat-empty__action src/features/ai/chat/*.css`):

```css
.chat-empty__action--secondary {
  background: transparent;
  color: var(--color-text-muted);
  text-decoration: underline;
  margin-top: var(--space-2);
}
.chat-empty__action--secondary:hover { color: var(--color-text); }
```

- [ ] **Step 3: Run check**

Run: `pnpm check`

Expected: PASS — existing `ChatEmptyState` callers (only `ChatPanel`) pass the original three-variant shape; new optional fields don't break anything yet.

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/chat/ChatEmptyState.tsx src/features/ai/chat/chat-panel.css
git commit -m "feat(chat): ChatEmptyState — render suggested prompts in no-threads variant + retry/no-chunks chips

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `ChatPanel` — wire `useBookProfile` + `handleFillComposer` + `profileDeps` prop

**Files:**
- Modify: `src/features/ai/chat/ChatPanel.tsx`

**Goal:** New optional `profileDeps` prop. ChatPanel constructs the profile hook (only when variant is `'no-threads'` and gates pass) + a `handleFillComposer` callback. Threads new state to `ChatEmptyState` and `ChatComposer`.

- [ ] **Step 1: Extend `Props`**

In `src/features/ai/chat/ChatPanel.tsx`:

Add to the imports near the top:

```typescript
import { useBookProfile, type ProfileGenerationDeps } from '@/features/ai/prompts';
import type { TocEntry } from '@/domain';
```

Replace the existing `book` field on `Props` to include `toc`:

```typescript
  readonly book: {
    readonly title: string;
    readonly author?: string;
    readonly format: BookFormat;
    readonly toc: readonly TocEntry[];
  };
```

Add `profileDeps` to `Props` (near the existing `retrievalDeps` field):

```typescript
  readonly profileDeps?: ProfileGenerationDeps;
```

- [ ] **Step 2: Add `composerInitialTextRef` + hook + handler**

In `ChatPanel`'s body, after the existing `composerFocusRef` declaration:

```typescript
  const composerInitialTextRef = useRef<string | null>(null);
```

(add `useRef` to the imports from React if not already imported.)

Just before the existing `useChatSend` call, compute the variant + add the hook + the handler:

```typescript
  // Variant precedence (existing): no-key > no-model > no-threads > ready
  const variantForGate: Variant = useMemo(() => {
    if (props.apiKeyState.kind === 'none' || props.apiKeyState.kind === 'locked') return 'no-key';
    if (props.selectedModelId === null || props.selectedModelId === '') return 'no-model';
    if (threads.list.length === 0 && threads.draft === null) return 'no-threads';
    return 'ready';
  }, [props.apiKeyState.kind, props.selectedModelId, threads.list.length, threads.draft]);

  const profile = useBookProfile({
    book: {
      id: bookIdBranded,
      title: props.book.title,
      ...(props.book.author !== undefined ? { author: props.book.author } : {}),
      toc: props.book.toc,
    },
    modelId: props.selectedModelId,
    enabled: variantForGate === 'no-threads' && props.profileDeps !== undefined,
    deps: props.profileDeps ?? {
      // No-op deps used only when enabled=false; useBookProfile early-returns
      // before touching them. This avoids making the prop required.
      chunksRepo: {} as never,
      profilesRepo: {} as never,
      structuredClient: { complete: () => Promise.reject(new Error('no profileDeps')) },
    },
  });

  const handleFillComposer = useCallback((text: string): void => {
    composerInitialTextRef.current = text;
    composerFocusRef.current = true;
  }, []);
```

(The existing `variant` useMemo a few lines below this should be removed since `variantForGate` replaces it. Or — if the existing `variant` useMemo is shaped differently, replace `variantForGate` above with re-using the existing `variant`. Inspect the current file before applying.)

**Note on the `variant` rename:** the existing ChatPanel code has a `variant` useMemo around line 132-138. To avoid duplicating computation, rename my `variantForGate` block above to `variant` and remove the existing one — OR pull `useBookProfile` to *after* the existing `variant` declaration. The latter is less invasive; do that:

Move the `useBookProfile` + `handleFillComposer` block to be *after* the existing `const variant: Variant = useMemo(...)` line, and reference `variant` instead of `variantForGate`:

```typescript
  const profile = useBookProfile({
    book: {
      id: bookIdBranded,
      title: props.book.title,
      ...(props.book.author !== undefined ? { author: props.book.author } : {}),
      toc: props.book.toc,
    },
    modelId: props.selectedModelId,
    enabled: variant === 'no-threads' && props.profileDeps !== undefined,
    deps: props.profileDeps ?? {
      chunksRepo: {} as never,
      profilesRepo: {} as never,
      structuredClient: { complete: () => Promise.reject(new Error('no profileDeps')) },
    },
  });

  const handleFillComposer = useCallback((text: string): void => {
    composerInitialTextRef.current = text;
    composerFocusRef.current = true;
  }, []);
```

- [ ] **Step 3: Wire `ChatEmptyState` for the no-threads variant**

Find the existing `<ChatEmptyState variant="no-threads" ... />` call and replace with:

```tsx
            <ChatEmptyState
              variant="no-threads"
              onStartDraft={() => {
                threads.startDraft(props.selectedModelId ?? '');
              }}
              bookTitle={props.book.title}
              promptsState={profile}
              onSelectPrompt={handleSendNew}
              onEditPrompt={handleFillComposer}
            />
```

- [ ] **Step 4: Wire `ChatComposer` to receive `composerInitialTextRef`**

Find the `<ChatComposer .../>` call and add `initialTextRef={composerInitialTextRef}` to its props.

- [ ] **Step 5: Run check**

Run: `pnpm check`

Expected: PASS for typecheck + lint. Tests may fail on `ReaderWorkspace.test.tsx` because `props.book` no longer matches the test's stub shape (missing `toc`). That's fixed in Task 13.

If tests fail only on `ReaderWorkspace.test.tsx` for missing `toc`, that's expected and gets fixed in the next task. If other tests fail, stop and investigate.

- [ ] **Step 6: Commit (will land alongside Task 13's ReaderWorkspace fix)**

The two tasks are coupled by the `book.toc` shape change. Stage Task 12's edits but defer the commit until Task 13's fixes land. Skip the commit step for now — proceed to Task 13.

---

## Task 13: `ReaderWorkspace` — `composerInitialTextRef` + thread `profileDeps`

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx`
- Modify: `src/features/reader/workspace/ReaderWorkspace.test.tsx`

**Goal:** Workspace owns the `composerInitialTextRef` (so the desktop and mobile-sheet ChatPanel instances share the same prefill semantics through the parent) and accepts a `profileDeps` prop from App.tsx, threading both to `ChatPanel`. Also extends the projected `book` shape to include `toc`.

- [ ] **Step 1: Add `profileDeps` Prop + import + state**

In `src/features/reader/workspace/ReaderWorkspace.tsx`:

Add to the import block:

```typescript
import type { ProfileGenerationDeps } from '@/features/ai/prompts';
import type { Book } from '@/domain';
```

Add to `Props`:

```typescript
  readonly profileDeps?: ProfileGenerationDeps;
  readonly bookToc: Book['toc'];
```

(`bookToc` is a separate prop instead of changing the `book` projection at the App→Workspace boundary; keeps the existing `bookTitle`, `bookSubtitle`, `bookFormat` flat-prop pattern.)

Add a fresh `composerInitialTextRef` declaration alongside the existing `composerFocusRef`:

```typescript
  const composerInitialTextRef = useRef<string | null>(null);
```

- [ ] **Step 2: Thread `book.toc` + `profileDeps` + `composerInitialTextRef` to BOTH ChatPanel instances**

For both `<ChatPanel>` calls (desktop instance ~line 474-505, mobile-sheet instance ~line 577-608), update the `book` prop to include `toc`:

```tsx
              book={{
                title: props.bookTitle,
                ...(props.bookSubtitle !== undefined && { author: props.bookSubtitle }),
                format: props.bookFormat,
                toc: props.bookToc,
              }}
```

And add to BOTH ChatPanel calls:

```tsx
              {...(props.profileDeps !== undefined && { profileDeps: props.profileDeps })}
              composerInitialTextRef={composerInitialTextRef}
```

- [ ] **Step 3: Add `composerInitialTextRef` to `ChatPanel` Props (Task 12 leftover)**

In `src/features/ai/chat/ChatPanel.tsx`, add to Props (next to the existing `composerFocusRef`):

```typescript
  readonly composerInitialTextRef?: { current: string | null };
```

In the body, replace the local `const composerInitialTextRef = useRef...` (added in Task 12) with a reference to the prop:

```typescript
  const composerInitialTextRef = props.composerInitialTextRef ?? localComposerInitialTextRef;
```

Where `localComposerInitialTextRef` is a fallback ref for cases where the prop isn't supplied (e.g., unit tests that don't pass it):

```typescript
  const localComposerInitialTextRef = useRef<string | null>(null);
```

(This pattern: prefer the parent's ref when supplied; fall back to a local ref. Keeps the component usable in isolation.)

Add `composerInitialTextRef` (the resolved ref) to the props passed to `<ChatComposer>`:

```tsx
              initialTextRef={composerInitialTextRef}
```

- [ ] **Step 4: Update `ReaderWorkspace.test.tsx` baseProps**

In `src/features/reader/workspace/ReaderWorkspace.test.tsx`, find the `baseProps` constant and add `bookToc: []` (the workspace tests don't need a populated TOC):

```typescript
  apiKeyState: { kind: 'none' as const },
  getApiKey: () => null,
  selectedModelId: null,
  bookToc: [],
  bookChunksRepo: { /* … existing … */ },
  // … rest …
```

(Place the `bookToc: []` after `selectedModelId` and before `bookChunksRepo`.)

- [ ] **Step 5: Run check**

Run: `pnpm check`

Expected: PASS — but App.tsx-level wiring isn't done yet, so we're still missing the prop in App.tsx's call site. App.tsx errors will surface in Task 14.

If only App.tsx errors remain ("Property 'bookToc' is missing"), that's expected. Proceed to Task 14 — Tasks 12+13+14 commit together.

- [ ] **Step 6: No commit yet — proceed to Task 14**

---

## Task 14: App wiring — `bookProfilesRepo` + `structuredClient` + `profileDeps` + cascade

**Files:**
- Modify: `src/features/library/wiring.ts` (add `bookProfilesRepo`)
- Modify: `src/app/App.tsx` (construct `structuredClient` + `profileDeps`; thread `bookToc` + `profileDeps` to `ReaderWorkspace`; add `bookEmbeddingsRepo` to test stub if needed)
- Modify: `src/app/useReaderHost.ts` (cascade extension)
- Modify: `src/app/useReaderHost.test.ts` (fakeWiring stub)

**Goal:** Land the App→Workspace→ChatPanel wiring so typecheck closes.

- [ ] **Step 1: Extend `wiring.ts`**

In `src/features/library/wiring.ts`:

Add to the import block:

```typescript
  createBookProfilesRepository,
  type BookProfilesRepository,
```

Add to `Wiring` type (next to `bookEmbeddingsRepo`):

```typescript
  readonly bookProfilesRepo: BookProfilesRepository;
```

In the factory body (after `bookEmbeddingsRepo` is constructed):

```typescript
  const bookProfilesRepo = createBookProfilesRepository(db);
```

Add to the return object (after `bookEmbeddingsRepo,`):

```typescript
    bookProfilesRepo,
```

- [ ] **Step 2: Extend `useReaderHost.onRemoveBook` cascade**

In `src/app/useReaderHost.ts`, in the `onRemoveBook` function, after the existing `await wiring.bookEmbeddingsRepo.deleteByBook(BookId(book.id));` line:

```typescript
          // Phase 5.3: cascade book profile.
          await wiring.bookProfilesRepo.deleteByBook(BookId(book.id));
```

- [ ] **Step 3: Extend `useReaderHost.test.ts` stub**

In `src/app/useReaderHost.test.ts`, find `fakeWiring()` and add `bookProfilesRepo` after the `bookEmbeddingsRepo` stub:

```typescript
    bookProfilesRepo: {
      get: vi.fn(() => Promise.resolve(null)),
      put: vi.fn(() => Promise.resolve()),
      deleteByBook: vi.fn(() => Promise.resolve()),
      countStaleVersions: vi.fn(() => Promise.resolve([])),
    },
```

- [ ] **Step 4: Construct `structuredClient` + `profileDeps` in `App.tsx`**

In `src/app/App.tsx`:

Add to the import block:

```typescript
import * as nanogptStructured from '@/features/ai/chat/nanogptStructured';
import type {
  StructuredClient,
} from '@/features/ai/chat/nanogptStructured';
import type { ProfileGenerationDeps } from '@/features/ai/prompts';
```

In `ReadyApp`, after the existing `embedClient` useMemo (Phase 5.2):

```typescript
  const structuredClient: StructuredClient = useMemo(
    () => ({
      complete: (req) =>
        nanogptStructured.complete({
          apiKey: getApiKeyForEmbed(),
          modelId: req.modelId,
          messages: req.messages,
          schema: req.schema,
          ...(req.signal !== undefined ? { signal: req.signal } : {}),
        }),
    }),
    [getApiKeyForEmbed],
  );

  const profileDeps: ProfileGenerationDeps = useMemo(
    () => ({
      chunksRepo: wiring.bookChunksRepo,
      profilesRepo: wiring.bookProfilesRepo,
      structuredClient,
    }),
    [wiring.bookChunksRepo, wiring.bookProfilesRepo, structuredClient],
  );
```

- [ ] **Step 5: Thread `bookToc` + `profileDeps` to `ReaderWorkspace`**

In the `ReaderWorkspace` JSX block, add to its props (alongside the existing `retrievalDeps`):

```tsx
          retrievalDeps={retrievalDeps}
          bookChunksRepo={wiring.bookChunksRepo}
          bookEmbeddingsRepo={wiring.bookEmbeddingsRepo}
          bookToc={book.toc}
          profileDeps={profileDeps}
```

- [ ] **Step 6: Run check**

Run: `pnpm check`

Expected: PASS — typecheck, lint, and all tests should now succeed.

- [ ] **Step 7: Single bundled commit for Tasks 12+13+14**

Stage and commit all three tasks together:

```bash
git add src/features/ai/chat/ChatPanel.tsx \
        src/features/reader/workspace/ReaderWorkspace.tsx \
        src/features/reader/workspace/ReaderWorkspace.test.tsx \
        src/features/library/wiring.ts \
        src/app/App.tsx \
        src/app/useReaderHost.ts \
        src/app/useReaderHost.test.ts

git commit -m "$(cat <<'EOF'
feat(app): wire bookProfilesRepo + structuredClient + profileDeps + cascade

Bundles spec Tasks 12+13+14 into one commit because the ChatPanel +
ReaderWorkspace + App wiring share a coupled prop shape (book.toc
extension + profileDeps + composerInitialTextRef) that breaks under
partial sequencing.

ChatPanel:
- Props gain profileDeps?, composerInitialTextRef?, and book.toc.
- useBookProfile hook + handleFillComposer callback wired.
- ChatEmptyState gets promptsState + onSelectPrompt + onEditPrompt.
- ChatComposer gets initialTextRef.

ReaderWorkspace:
- Owns composerInitialTextRef alongside composerFocusRef.
- New props: profileDeps?, bookToc.
- Threads to both desktop and mobile-sheet ChatPanel instances.

useReaderHost:
- onRemoveBook cascade: + bookProfilesRepo.deleteByBook.

wiring + App:
- wiring.bookProfilesRepo factory.
- App constructs structuredClient + profileDeps; threads to
  ReaderWorkspace.

Test stubs updated for the new Wiring + ReaderWorkspace shapes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: E2E — suggested prompts specs

**Files:**
- Create: `e2e/prompts-empty-state-no-key.spec.ts`
- Create: `e2e/prompts-no-chunks.spec.ts`
- Create: `e2e/prompts-render-mocked.spec.ts`

**Goal:** Three Playwright specs covering the no-key parity check, the no-chunks edge, and the happy-path render (with `/v1/chat/completions` mocked).

- [ ] **Step 1: Create `prompts-empty-state-no-key.spec.ts`**

```typescript
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

async function openImportedBook(page: Page): Promise<void> {
  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({
    timeout: 15_000,
  });
}

// Suggested prompts are gated by api-key + selected-model state. With no
// key configured (the default fixture state) the no-key empty state wins
// and prompts are not rendered.
test('Suggested prompts are hidden when no API key is configured', async ({ page }) => {
  await page.goto('/');
  await importFixture(page);
  await openImportedBook(page);

  // No-key empty state visible; prompts region absent.
  await expect(page.getByText(/set up your api key/i)).toBeVisible();
  await expect(page.getByRole('region', { name: /suggested questions/i })).toHaveCount(0);
});
```

- [ ] **Step 2: Create `prompts-no-chunks.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

// Without a configured key the chat panel is in the no-key state. Without
// chunks the panel also can't render prompts. This spec is a smoke check
// that the panel renders (no crash) with no key and no imported book.
// Full no-chunks coverage (key configured + book without text) requires
// fixture infrastructure deferred to Phase 6.5 polish.
test('Empty library renders without crashing the chat surface', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import a book to begin.' })).toBeVisible();
});
```

- [ ] **Step 3: Create `prompts-render-mocked.spec.ts`**

```typescript
import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

// Full happy-path retrieval E2E (configure API key → import → wait for
// indexing → mock /v1/chat/completions structured response → click prompt
// → thread is created and the prompt text appears in the message list)
// requires test fixtures to set up the API key and a model in the
// modelCatalog store, plus mocked /v1/embeddings for the indexing pipeline.
// The existing chat-passage-mode-desktop.spec follows the same pragmatic
// policy of skipping LLM-streaming flows in e2e.
//
// What we CAN verify in e2e: importing a fixture book renders without
// crashing the prompts-aware ChatPanel (the empty-state + suggestions
// surface lands without breaking the page).
test('Prompts-aware ChatPanel renders without crashing on book import', async ({ page }) => {
  // Mock /v1/chat/completions in case profile generation is somehow
  // triggered without a key (defensive — should never fire).
  await page.route('https://nano-gpt.com/api/v1/chat/completions', (route: Route) =>
    route.fulfill({ status: 401, body: '' }),
  );
  await page.goto('/');
  await importFixture(page);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible();
});
```

- [ ] **Step 4: Run unit test suite to confirm baseline**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/prompts-empty-state-no-key.spec.ts e2e/prompts-no-chunks.spec.ts e2e/prompts-render-mocked.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): suggested prompts — no-key / no-chunks / render-mocked

Pragmatic e2e coverage scoped to what's reachable without configured
API key + model:

- prompts-empty-state-no-key: verifies the no-key empty state wins over
  prompts (parity with chat-retrieval-mode-desktop).
- prompts-no-chunks: smoke test that empty library renders.
- prompts-render-mocked: defensive 401 mock + fixture import smoke;
  full happy-path requires API-key + model fixture infra deferred to
  Phase 6.5 polish.

Full prompts happy-path (chip → click → multi-turn → render) covered by
the unit + integration suite (runProfileGeneration.test, useBookProfile
test, SuggestedPromptList component test, ChatEmptyState extension).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Docs — roadmap status + decision history

**Files:**
- Modify: `docs/04-implementation-roadmap.md`
- Modify: `docs/02-system-architecture.md`

- [ ] **Step 1: Update roadmap status**

In `docs/04-implementation-roadmap.md`, find the Status block and add:

```markdown
- Phase 5.3 — complete (2026-05-06)
```

(Insert after `Phase 5.2 — complete (2026-05-06)`.)

- [ ] **Step 2: Add decision-history entry**

In `docs/02-system-architecture.md`, locate the Decision History section. Insert at the top (most-recent-first):

```markdown
### 2026-05-06 — Phase 5.3 suggested prompts

- **Profile-first generation.** A categorized BookProfile (`{summary,
  genre, structure, themes, keyEntities}`) is generated on first
  chat-panel open per book and persisted in a new `book_profiles` IDB
  store (v8 → v9 additive migration). The profile is load-bearing for
  Phase 5.4 (chapter mode prompts) and Phase 6 (prompt-cache stable
  prefix); generating it now means downstream phases skip re-engineering.
- **Lazy timing — chat-panel open == implicit consent.** Embeddings
  (Phase 5.2) were eager because retrieval is a critical path; profiles
  are a delight surface, so they're generated only when the user shows
  interest by opening the chat panel. Books the user only reads incur no
  AI cost.
- **Categorized profile schema.** `structure: 'fiction' | 'nonfiction' |
  'textbook' | 'reference'` discriminates prompt categories at LLM time
  (relationship maps for fiction, claim maps for nonfiction). Typed
  entity buckets (`characters/concepts/places`) ground prompts in
  specifics.
- **Prompt schema = `{text, category}`.** Five-category union
  (`comprehension/analysis/structure/creative/study`) matches engine doc
  §"Suggested prompts system". UI groups/badges deferred to Phase 6
  polish; v1 renders flat.
- **Display = no-threads empty state only.** Suggestions are an
  onboarding surface, not always-visible chrome. Once any thread exists,
  prompts are out of view; matches ChatGPT/Claude convention. The
  `'no-threads'` variant of `ChatEmptyState` extends with optional
  `promptsState`, `onSelectPrompt`, `onEditPrompt`.
- **Click sends; ✎ icon fills composer.** Pre-vetted LLM-generated
  prompts shouldn't need editing by default → primary path is
  zero-friction. The ✎ icon offers an opt-in tweak path. The ✎ uses a
  `<span role="button" tabIndex={0}>` because nested `<button>` is
  invalid HTML; equivalent keyboard semantics via Enter/Space handlers.
- **Network module: `nanogptStructured.ts`.** Reuses
  `/v1/chat/completions` with `response_format: { type: 'json_schema',
  json_schema }`. Failure taxonomy mirrors `nanogptChat` plus a new
  `'schema-violation'` reserved for orchestrator-level
  `validateProfile` rejections. Implementation-time probe verified
  NanoGPT supports the `json_schema` shape per OpenAI spec.
- **Defensive validation.** `validateProfile` re-checks the shape of the
  LLM's response despite `strict: true` because providers don't always
  honor strict; trims `prompts` to `≤8`. The schema literal is the
  single source of truth for both request-time `response_format` and
  post-response validation.
- **Even-stride sampling under a 3000-token budget.** Defends against
  first-chapter bias; deterministic (same book → same prompt every
  time). Stride = `ceil(sections.length / desiredSamples)`.
- **Cascade extension.**
  `useReaderHost.onRemoveBook` adds `bookProfilesRepo.deleteByBook` to
  the existing `messages → threads → savedAnswers → chunks → embeddings`
  cascade.
- **`profileSchemaVersion` reserved for forward-compat.**
  `BookProfilesRepository.countStaleVersions` is wired but no app-open
  scan runs against it in v1; auto-invalidation on schema bumps lands in
  Phase 6+ when warranted.
```

- [ ] **Step 3: Run check**

Run: `pnpm check`

Expected: PASS (docs-only changes; nothing else affected).

- [ ] **Step 4: Run E2E**

Run: `pnpm test:e2e`

Expected: PASS for new prompts specs + all prior suites. If a spec fails because of a pre-existing flake, document it and consult before continuing.

- [ ] **Step 5: Commit**

```bash
git add docs/04-implementation-roadmap.md docs/02-system-architecture.md
git commit -m "docs: Phase 5.3 — architecture decision + roadmap status complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Validation Checklist

After all 16 commits land, verify the spec's §14 checklist:

- [ ] All ~16 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new prompts suite plus all prior suites.
- [ ] **Manual smoke (happy path)**: import the fixture EPUB → wait for `ready` → open chat → see "Generating suggestions…" → see 4-8 prompts each referencing something specific.
- [ ] **Manual smoke (click → send)**: click a prompt → thread is created → prompt is sent as the first user message → assistant streams a reply.
- [ ] **Manual smoke (edit → send)**: click ✎ on a prompt → composer is filled with the prompt text + focused → user appends "specifically in chapter 4" + sends → message reflects the edit.
- [ ] **Manual smoke (cache hit)**: close + reopen chat panel → prompts re-render instantly (no spinner).
- [ ] **Manual smoke (no-chunks)**: import a malformed book that fails to chunk → open chat → empty state shows "indexing in progress" info chip, not prompts.
- [ ] **Manual smoke (retry)**: kill network, open chat for a fresh book → see retry chip; restore network → click Retry → prompts load.
- [ ] **Manual smoke (cascade)**: remove a book whose profile exists → confirm IDB has no orphan record.
- [ ] `docs/04-implementation-roadmap.md` Status block updated.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected.
- [ ] Self-review scorecard ≥ 22/27 per `docs/08-agent-self-improvement.md`.

---

## Implementation Notes

**Subagent execution recommendation.** This plan has 16 tasks averaging ~4-8 file edits each. Inline execution in a single session worked for Phase 5.2 (23 tasks) but consumed substantial context; subagent-driven execution should run faster end-to-end on this plan.

**The `book.toc` shape change touches three layers** — App.tsx → ReaderWorkspace (new `bookToc` prop) → ChatPanel (extended `book` shape). Tasks 12, 13, 14 are intentionally bundled into a single commit because the type contract crosses task boundaries (mirrors the Phase 5.2 Tasks 7+8 bundling pattern).

**JSON-schema verification probe in Task 5** — if NanoGPT proxy doesn't support `response_format: json_schema`, the fallback path is to add an explicit "Respond with JSON matching this schema:" instruction to the system prompt and tighten `validateProfile` to compensate. The defensive validation we already write makes this a lossless fallback.

**Cache-hit path is the common case.** After the first generation per book, every subsequent chat-panel open should render prompts instantly from the cached `BookProfileRecord`. The "no-spinner-on-second-mount" smoke test in §14 verifies this.

