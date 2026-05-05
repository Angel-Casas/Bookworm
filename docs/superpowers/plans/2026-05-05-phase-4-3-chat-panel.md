# Phase 4.3 — Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a multi-thread, streaming chat panel grounded only in book metadata. The panel lives in the reader workspace's right rail (desktop) and a new mobile-sheet tab. Threads + messages + saved AI answers persist via three new IDB stores at v6. Streaming uses an XState `chatRequestMachine` over `fetch + ReadableStream` with replay safety. Save-as-note creates a distinct `SavedAnswer` entity (not a `Note`) to honor the AI-engine doc's "separate user notes from AI-generated content" rule.

**Architecture:** Functional core / imperative shell. Pure modules: `parseSSE`, `assembleOpenChatPrompt`, `chatRequestMachine` transitions, list/sort/filter helpers. Side-effectful: `streamChatCompletion` (fetch + Authorization), three new repos, four chat hooks (mirror `useBookmarks`/`useHighlights`/`useNotes` precedent), one rail-visibility hook (mirror `useFocusMode`). UI under `src/features/ai/chat/` (panel, header, message list, bubble, composer, error/empty bubbles, privacy preview, save-answer inline). Right-rail container under `src/features/reader/workspace/`. Notebook (Phase 3.4) extends with a `savedAnswer` entry kind + "AI answers" filter chip.

**Tech Stack:** TypeScript strict, React 19, Zustand 5 (existing), XState 5 (already in tree), `idb` (existing), foliate-js + pdf.js (untouched), Vitest + happy-dom + @testing-library/react (unit/component), Playwright (E2E). NanoGPT is OpenAI-compatible (`/v1/chat/completions` with `stream: true`).

**Reference:** Spec at `docs/superpowers/specs/2026-05-05-phase-4-3-chat-panel-design.md`.

---

## Task ordering

Storage and domain first (everything depends on the type shapes and stores). Then pure modules (`parseSSE`, `promptAssembly`) and the network adapter, then the state machine, then hooks. Then icons + rail container primitives. Then chat UI leaf-up: empty/error bubbles → message bubble → list → header → composer → privacy preview → save-answer inline → `ChatPanel` composes everything. Then notebook integration. Then app-level wiring + cascade + mobile sheet. Then E2E. Then docs.

| # | Commit (per spec §13) | Task |
|---|---|---|
| 1 | domain | extend `ChatMode`, refactor mode→message, add `SavedAnswer` |
| 2 | v6 migration | three new stores |
| 3 | repos | `chatThreads`, `chatMessages`, `savedAnswers` |
| 4 | rail pref + hint setting | `rightRailVisible` + `chatPanelHintShown` |
| 5 | parseSSE | pure SSE event parser |
| 6 | nanogptChat | streaming chat completions adapter |
| 7 | promptAssembly | open-mode system prompt builder |
| 8 | chatRequestMachine | XState machine for one send lifecycle |
| 9 | chat hooks | `useChatThreads` / `useChatMessages` / `useChatSend` / `useSavedAnswers` |
| 10 | icons | `ChatIcon`, `SendIcon`, `StopIcon`, `SaveAnswerIcon` |
| 11 | useRightRailVisibility | hook + persistence |
| 12 | RightRail | container + collapsed-tab + workspace integration |
| 13 | ChatEmptyState | three precedence variants |
| 14 | MessageBubble + ChatErrorBubble | typed variants + streaming caret |
| 15 | MessageList | auto-scroll-near-bottom |
| 16 | ChatHeader + ThreadList | picker / new / rename / delete |
| 17 | ChatComposer | textarea + send + cancel + ⌘+Enter |
| 18 | PrivacyPreview | verbatim system prompt |
| 19 | SaveAnswerInline + first-time hint | inline save form |
| 20 | ChatPanel | composes everything |
| 21 | notebook integration | `savedAnswer` entry kind + AI filter chip |
| 22 | app wiring | repos + cascade + mobile sheet tab |
| 23 | E2E | chat suite + SSE fixture |
| 24 | docs | architecture decision + roadmap status |

---

### Task 1: Domain — extend `ChatMode`, move `mode` to `ChatMessage`, add `SavedAnswer`

**Files:**
- Modify: `src/domain/ai/types.ts`
- Modify: `src/domain/ids.ts`
- Modify: `src/domain/index.ts` (only if `SavedAnswerId` needs explicit re-export — the existing barrel uses `export *`)

> **Strategy:** Type-only changes; chat domain is currently unused by any production code (verified by grep before this task). No data migration. The refactor of `mode` from thread→message is free at this point.

- [ ] **Step 1: Pre-flight — confirm chat types are unused**

Run:
```bash
rg -n "ChatThread|ChatMessage|ChatMode|AnswerStyle|ContextRef|TokenUsage" src --type ts
```
Expected: matches only inside `src/domain/ai/types.ts`. If anything matches under `src/features/` or `src/storage/`, stop and review — this plan assumes the chat types are not yet consumed.

- [ ] **Step 2: Add `SavedAnswerId` brand to `src/domain/ids.ts`**

Locate the existing `Brand` declarations (near other `XxxId` types). Add:

```ts
export type SavedAnswerId = Brand<string, 'SavedAnswerId'>;
export const SavedAnswerId = (raw: string): SavedAnswerId => raw as SavedAnswerId;
```

Match the pattern of the closest neighbor (e.g., `ChatThreadId`, `NoteId`) — same `Brand` helper, same constructor function shape.

- [ ] **Step 3: Extend `ChatMode` and refactor `ChatThread` / `ChatMessage` in `src/domain/ai/types.ts`**

Replace the `ChatMode`, `ChatThread`, and `ChatMessage` declarations with:

```ts
export type ChatMode = 'open' | 'passage' | 'chapter' | 'multi-excerpt' | 'retrieval' | 'full-book';

export type ChatThread = {
  readonly id: ChatThreadId;
  readonly bookId: BookId;
  readonly title: string;
  readonly modelId: string;
  readonly answerStyle: AnswerStyle;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
};

export type ChatMessage = {
  readonly id: ChatMessageId;
  readonly threadId: ChatThreadId;
  readonly role: ChatRole;
  readonly content: string;
  readonly mode?: ChatMode;
  readonly contextRefs: readonly ContextRef[];
  readonly usage?: TokenUsage;
  readonly streaming?: boolean;
  readonly truncated?: boolean;
  readonly error?: 'interrupted' | 'failed';
  readonly createdAt: IsoTimestamp;
};
```

Note: `mode` removed from `ChatThread`; added (optional) to `ChatMessage`; three transient flags (`streaming` / `truncated` / `error`) added to `ChatMessage`.

- [ ] **Step 4: Add `SavedAnswer` to `src/domain/ai/types.ts`**

Append after the `ChatMessage` block:

```ts
export type SavedAnswer = {
  readonly id: SavedAnswerId;
  readonly bookId: BookId;
  readonly threadId: ChatThreadId;
  readonly messageId: ChatMessageId;
  readonly modelId: string;
  readonly mode: ChatMode;
  readonly content: string;
  readonly question: string;
  readonly contextRefs: readonly ContextRef[];
  readonly userNote?: string;
  readonly createdAt: IsoTimestamp;
};
```

Update the `import type { ... } from '../ids'` line at the top to include `SavedAnswerId`.

- [ ] **Step 5: Type-check**

Run:
```bash
pnpm type-check
```
Expected: PASS. (No production code consumes these types yet, so the rename of `ChatThread.mode` → `ChatMessage.mode` doesn't break anything.)

- [ ] **Step 6: Lint**

Run:
```bash
pnpm lint
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/ai/types.ts src/domain/ids.ts
git commit -m "feat(domain): chat — extend ChatMode with 'open', move mode to message, add SavedAnswer"
```

---

### Task 2: Storage — v6 migration adds three new stores

**Files:**
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/db/migrations.ts`
- Modify: `src/storage/db/migrations.test.ts`

> **Strategy:** Additive-only migration. Three new object stores with appropriate indexes. Existing v5 data untouched. Idempotent re-run.

- [ ] **Step 1: Extend `BookwormDBSchema` and add `CHAT_*` constants in `src/storage/db/schema.ts`**

At the top of the file, alongside existing imports:

```ts
import type { ChatMessage, ChatMessageId, ChatThread, ChatThreadId, SavedAnswer, SavedAnswerId } from '@/domain';
```

Bump `CURRENT_DB_VERSION`:

```ts
export const CURRENT_DB_VERSION = 6;
```

Inside the `BookwormDBSchema` interface, after the existing `notes` block, add:

```ts
  chat_threads: {
    key: ChatThreadId;
    value: ChatThread;
    indexes: { 'by-book': string; 'by-updated': string };
  };
  chat_messages: {
    key: ChatMessageId;
    value: ChatMessage;
    indexes: { 'by-thread': string };
  };
  saved_answers: {
    key: SavedAnswerId;
    value: SavedAnswer;
    indexes: { 'by-book': string; 'by-message': string };
  };
```

Below the existing `NOTES_STORE` constant, add:

```ts
export const CHAT_THREADS_STORE = 'chat_threads' as const;
export const CHAT_MESSAGES_STORE = 'chat_messages' as const;
export const SAVED_ANSWERS_STORE = 'saved_answers' as const;
```

- [ ] **Step 2: Write the failing migration test in `src/storage/db/migrations.test.ts`**

Locate the existing `describe('migrations', ...)` block. Append a new sub-describe:

```ts
  describe('v5 → v6 (chat + saved answers)', () => {
    it('creates chat_threads / chat_messages / saved_answers stores with correct indexes', async () => {
      const dbName = `bookworm-test-v6-${Math.random()}`;
      // open at v5 first, seed
      const db5 = await openDB<BookwormDBSchema>(dbName, 5, {
        upgrade: (db, oldV, newV, tx) => upgradeBookwormDB(db, oldV, newV ?? 5, tx),
      });
      await db5.put('settings', { key: 'view', value: { kind: 'library' } });
      db5.close();

      // re-open at v6
      const db6 = await openDB<BookwormDBSchema>(dbName, 6, {
        upgrade: (db, oldV, newV, tx) => upgradeBookwormDB(db, oldV, newV ?? 6, tx),
      });
      try {
        // new stores exist
        expect(db6.objectStoreNames.contains('chat_threads')).toBe(true);
        expect(db6.objectStoreNames.contains('chat_messages')).toBe(true);
        expect(db6.objectStoreNames.contains('saved_answers')).toBe(true);

        // indexes exist
        const threadStore = db6.transaction('chat_threads').store;
        expect(threadStore.indexNames.contains('by-book')).toBe(true);
        expect(threadStore.indexNames.contains('by-updated')).toBe(true);

        const msgStore = db6.transaction('chat_messages').store;
        expect(msgStore.indexNames.contains('by-thread')).toBe(true);

        const ansStore = db6.transaction('saved_answers').store;
        expect(ansStore.indexNames.contains('by-book')).toBe(true);
        expect(ansStore.indexNames.contains('by-message')).toBe(true);

        // pre-existing v5 data intact
        const view = await db6.get('settings', 'view');
        expect(view).toEqual({ key: 'view', value: { kind: 'library' } });
      } finally {
        db6.close();
        await deleteDB(dbName);
      }
    });

    it('is idempotent if v6 is opened twice', async () => {
      const dbName = `bookworm-test-v6-idem-${Math.random()}`;
      const db1 = await openDB<BookwormDBSchema>(dbName, 6, {
        upgrade: (db, oldV, newV, tx) => upgradeBookwormDB(db, oldV, newV ?? 6, tx),
      });
      db1.close();
      // open again at the same version — must not throw
      const db2 = await openDB<BookwormDBSchema>(dbName, 6, {
        upgrade: (db, oldV, newV, tx) => upgradeBookwormDB(db, oldV, newV ?? 6, tx),
      });
      try {
        expect(db2.objectStoreNames.contains('chat_threads')).toBe(true);
      } finally {
        db2.close();
        await deleteDB(dbName);
      }
    });
  });
```

If `deleteDB` is not already imported, add it: `import { deleteDB, openDB } from 'idb';`.

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm test src/storage/db/migrations.test.ts
```
Expected: FAIL with `objectStoreNames.contains('chat_threads') === false` or similar.

- [ ] **Step 4: Implement the v6 step in `src/storage/db/migrations.ts`**

Locate `upgradeBookwormDB`. Below the existing v5 step (`if (oldVersion < 5) { ... }`), add:

```ts
  if (oldVersion < 6) {
    if (!db.objectStoreNames.contains('chat_threads')) {
      const s = db.createObjectStore('chat_threads', { keyPath: 'id' });
      s.createIndex('by-book', 'bookId');
      s.createIndex('by-updated', 'updatedAt');
    }
    if (!db.objectStoreNames.contains('chat_messages')) {
      const s = db.createObjectStore('chat_messages', { keyPath: 'id' });
      s.createIndex('by-thread', 'threadId');
    }
    if (!db.objectStoreNames.contains('saved_answers')) {
      const s = db.createObjectStore('saved_answers', { keyPath: 'id' });
      s.createIndex('by-book', 'bookId');
      s.createIndex('by-message', 'messageId');
    }
  }
```

- [ ] **Step 5: Run the migration tests**

```bash
pnpm test src/storage/db/migrations.test.ts
```
Expected: PASS (the new sub-describe and all prior cases).

- [ ] **Step 6: Run full unit suite to confirm no regressions**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storage/db/schema.ts src/storage/db/migrations.ts src/storage/db/migrations.test.ts
git commit -m "feat(storage): v6 migration — chat_threads, chat_messages, saved_answers stores"
```

---

### Task 3: Storage — `chatThreads`, `chatMessages`, `savedAnswers` repositories

**Files:**
- Create: `src/storage/repositories/chatThreads.ts`
- Create: `src/storage/repositories/chatThreads.test.ts`
- Create: `src/storage/repositories/chatMessages.ts`
- Create: `src/storage/repositories/chatMessages.test.ts`
- Create: `src/storage/repositories/savedAnswers.ts`
- Create: `src/storage/repositories/savedAnswers.test.ts`
- Modify: `src/storage/index.ts` (barrel re-exports)

> **Strategy:** Three repos in the validating-reads pattern established by `bookmarks.ts` / `highlights.ts` / `notes.ts`. Each repo has a `normalize{Type}` helper that drops malformed records silently. Each `.test.ts` mirrors the testing pattern in `bookmarks.test.ts` (round-trip, drop corrupt, indexed queries return correct order, cascade delete).

- [ ] **Step 1: Read the canonical pattern**

Open and read these as the reference:
- `src/storage/repositories/bookmarks.ts`
- `src/storage/repositories/bookmarks.test.ts`
- `src/storage/repositories/notes.ts`
- `src/storage/repositories/notes.test.ts`

Note the structure: factory function `createXxxRepository(db)` returning an object literal with named methods; `normalizeXxx` defensive validator at the top of the file; tests use the in-memory IDB helper from `src/storage/adapters/opfs-in-memory.ts` and the test-only DB factory.

- [ ] **Step 2: Write the failing test for `chatThreads.test.ts`**

Create `src/storage/repositories/chatThreads.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { openTestBookwormDB, closeTestDB } from '@/storage/test-helpers';
import { createChatThreadsRepository } from './chatThreads';
import type { ChatThread } from '@/domain';
import { BookId, ChatThreadId } from '@/domain';

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: ChatThreadId('t-1'),
    bookId: BookId('b-1'),
    title: 'Discussion of chapter 1',
    modelId: 'gpt-x',
    answerStyle: 'open',
    createdAt: '2026-05-05T00:00:00.000Z' as ChatThread['createdAt'],
    updatedAt: '2026-05-05T00:00:00.000Z' as ChatThread['updatedAt'],
    ...overrides,
  };
}

describe('ChatThreadsRepository', () => {
  let db: IDBPDatabase<BookwormDBSchema>;

  beforeEach(async () => {
    db = await openTestBookwormDB();
  });

  afterEach(async () => {
    await closeTestDB(db);
  });

  it('returns undefined for missing thread', async () => {
    const repo = createChatThreadsRepository(db);
    expect(await repo.getById(ChatThreadId('nope'))).toBeUndefined();
  });

  it('round-trips upsert / getById', async () => {
    const repo = createChatThreadsRepository(db);
    const t = makeThread();
    await repo.upsert(t);
    expect(await repo.getById(t.id)).toEqual(t);
  });

  it('upsert overwrites', async () => {
    const repo = createChatThreadsRepository(db);
    const t = makeThread();
    await repo.upsert(t);
    await repo.upsert({ ...t, title: 'Renamed', updatedAt: '2026-05-06T00:00:00.000Z' as ChatThread['updatedAt'] });
    const read = await repo.getById(t.id);
    expect(read?.title).toBe('Renamed');
  });

  it('getByBook returns only threads for the requested book, sorted updatedAt desc', async () => {
    const repo = createChatThreadsRepository(db);
    await repo.upsert(makeThread({ id: ChatThreadId('t-1'), bookId: BookId('a'), updatedAt: '2026-05-05T01:00:00.000Z' as ChatThread['updatedAt'] }));
    await repo.upsert(makeThread({ id: ChatThreadId('t-2'), bookId: BookId('a'), updatedAt: '2026-05-05T03:00:00.000Z' as ChatThread['updatedAt'] }));
    await repo.upsert(makeThread({ id: ChatThreadId('t-3'), bookId: BookId('b'), updatedAt: '2026-05-05T02:00:00.000Z' as ChatThread['updatedAt'] }));
    const list = await repo.getByBook(BookId('a'));
    expect(list.map((t) => t.id)).toEqual([ChatThreadId('t-2'), ChatThreadId('t-1')]);
  });

  it('drops malformed records silently', async () => {
    await db.put('chat_threads', { id: 'corrupt', bookId: 42 } as never);
    const repo = createChatThreadsRepository(db);
    expect(await repo.getById('corrupt' as never)).toBeUndefined();
    expect(await repo.getByBook(BookId('a'))).toEqual([]);
  });

  it('delete removes a single record', async () => {
    const repo = createChatThreadsRepository(db);
    const t = makeThread();
    await repo.upsert(t);
    await repo.delete(t.id);
    expect(await repo.getById(t.id)).toBeUndefined();
  });

  it('deleteByBook removes only matching threads', async () => {
    const repo = createChatThreadsRepository(db);
    await repo.upsert(makeThread({ id: ChatThreadId('t-1'), bookId: BookId('a') }));
    await repo.upsert(makeThread({ id: ChatThreadId('t-2'), bookId: BookId('b') }));
    await repo.deleteByBook(BookId('a'));
    expect(await repo.getById(ChatThreadId('t-1'))).toBeUndefined();
    expect(await repo.getById(ChatThreadId('t-2'))).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm test src/storage/repositories/chatThreads.test.ts
```
Expected: FAIL with `Cannot find module './chatThreads'`.

- [ ] **Step 4: Implement `src/storage/repositories/chatThreads.ts`**

```ts
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { CHAT_THREADS_STORE } from '@/storage/db/schema';
import type { AnswerStyle, ChatThread, ChatThreadId } from '@/domain';
import { BookId, ChatThreadId as makeChatThreadId } from '@/domain';

const ANSWER_STYLES: readonly AnswerStyle[] = ['strict-grounded', 'grounded-plus', 'open'];

function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function normalizeChatThread(value: unknown): ChatThread | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (typeof v.bookId !== 'string' || v.bookId === '') return null;
  if (typeof v.title !== 'string') return null;
  if (typeof v.modelId !== 'string' || v.modelId === '') return null;
  if (typeof v.answerStyle !== 'string' || !ANSWER_STYLES.includes(v.answerStyle as AnswerStyle)) return null;
  if (!isIsoTimestamp(v.createdAt) || !isIsoTimestamp(v.updatedAt)) return null;
  return value as ChatThread;
}

export type ChatThreadsRepository = {
  readonly getById: (id: ChatThreadId) => Promise<ChatThread | undefined>;
  readonly getByBook: (bookId: ReturnType<typeof BookId>) => Promise<readonly ChatThread[]>;
  readonly upsert: (thread: ChatThread) => Promise<void>;
  readonly delete: (id: ChatThreadId) => Promise<void>;
  readonly deleteByBook: (bookId: ReturnType<typeof BookId>) => Promise<void>;
};

export function createChatThreadsRepository(
  db: IDBPDatabase<BookwormDBSchema>,
): ChatThreadsRepository {
  return {
    async getById(id) {
      const raw = await db.get(CHAT_THREADS_STORE, id);
      const normalized = normalizeChatThread(raw);
      return normalized ?? undefined;
    },
    async getByBook(bookId) {
      const tx = db.transaction(CHAT_THREADS_STORE, 'readonly');
      const idx = tx.store.index('by-book');
      const raw = await idx.getAll(bookId);
      const normalized: ChatThread[] = [];
      for (const r of raw) {
        const n = normalizeChatThread(r);
        if (n) normalized.push(n);
      }
      normalized.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      return normalized;
    },
    async upsert(thread) {
      await db.put(CHAT_THREADS_STORE, thread);
    },
    async delete(id) {
      await db.delete(CHAT_THREADS_STORE, id);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(CHAT_THREADS_STORE, 'readwrite');
      const idx = tx.store.index('by-book');
      const keys = await idx.getAllKeys(bookId);
      for (const k of keys) {
        await tx.store.delete(k);
      }
      await tx.done;
    },
  };
}

export { normalizeChatThread, makeChatThreadId };
```

(If `BookId` / `ChatThreadId` constructors are not yet exported from `@/domain`, fall back to direct casts. The test file uses the constructors — match what the existing domain barrel exports.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm test src/storage/repositories/chatThreads.test.ts
```
Expected: PASS.

- [ ] **Step 6: Repeat the test → implement → pass cycle for `chatMessages`**

Create `src/storage/repositories/chatMessages.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { openTestBookwormDB, closeTestDB } from '@/storage/test-helpers';
import { createChatMessagesRepository } from './chatMessages';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId } from '@/domain';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ChatMessageId('m-1'),
    threadId: ChatThreadId('t-1'),
    role: 'user',
    content: 'hello',
    contextRefs: [],
    createdAt: '2026-05-05T00:00:00.000Z' as ChatMessage['createdAt'],
    ...overrides,
  };
}

describe('ChatMessagesRepository', () => {
  let db: IDBPDatabase<BookwormDBSchema>;
  beforeEach(async () => { db = await openTestBookwormDB(); });
  afterEach(async () => { await closeTestDB(db); });

  it('round-trips upsert / getById', async () => {
    const repo = createChatMessagesRepository(db);
    const m = makeMessage();
    await repo.upsert(m);
    expect(await repo.getById(m.id)).toEqual(m);
  });

  it('getByThread returns thread messages oldest-first', async () => {
    const repo = createChatMessagesRepository(db);
    await repo.upsert(makeMessage({ id: ChatMessageId('m-1'), createdAt: '2026-05-05T00:00:02.000Z' as ChatMessage['createdAt'] }));
    await repo.upsert(makeMessage({ id: ChatMessageId('m-2'), createdAt: '2026-05-05T00:00:01.000Z' as ChatMessage['createdAt'] }));
    await repo.upsert(makeMessage({ id: ChatMessageId('m-3'), threadId: ChatThreadId('t-other'), createdAt: '2026-05-05T00:00:00.000Z' as ChatMessage['createdAt'] }));
    const list = await repo.getByThread(ChatThreadId('t-1'));
    expect(list.map((m) => m.id)).toEqual([ChatMessageId('m-2'), ChatMessageId('m-1')]);
  });

  it('drops malformed records', async () => {
    await db.put('chat_messages', { id: 'bad', role: 'wizard' } as never);
    const repo = createChatMessagesRepository(db);
    expect(await repo.getById('bad' as never)).toBeUndefined();
  });

  it('deleteByThread removes only that thread', async () => {
    const repo = createChatMessagesRepository(db);
    await repo.upsert(makeMessage({ id: ChatMessageId('m-1'), threadId: ChatThreadId('t-a') }));
    await repo.upsert(makeMessage({ id: ChatMessageId('m-2'), threadId: ChatThreadId('t-b') }));
    await repo.deleteByThread(ChatThreadId('t-a'));
    expect(await repo.getById(ChatMessageId('m-1'))).toBeUndefined();
    expect(await repo.getById(ChatMessageId('m-2'))).toBeDefined();
  });
});
```

Run: `pnpm test src/storage/repositories/chatMessages.test.ts` → FAIL with module-missing.

Implement `src/storage/repositories/chatMessages.ts`:

```ts
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { CHAT_MESSAGES_STORE } from '@/storage/db/schema';
import type { ChatMessage, ChatMessageId, ChatRole, ChatThreadId } from '@/domain';

const ROLES: readonly ChatRole[] = ['system', 'user', 'assistant'];

function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

export function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (typeof v.threadId !== 'string' || v.threadId === '') return null;
  if (typeof v.role !== 'string' || !ROLES.includes(v.role as ChatRole)) return null;
  if (typeof v.content !== 'string') return null;
  if (!Array.isArray(v.contextRefs)) return null;
  if (!isIsoTimestamp(v.createdAt)) return null;
  return value as ChatMessage;
}

export type ChatMessagesRepository = {
  readonly getById: (id: ChatMessageId) => Promise<ChatMessage | undefined>;
  readonly getByThread: (threadId: ChatThreadId) => Promise<readonly ChatMessage[]>;
  readonly upsert: (msg: ChatMessage) => Promise<void>;
  readonly delete: (id: ChatMessageId) => Promise<void>;
  readonly deleteByThread: (threadId: ChatThreadId) => Promise<void>;
};

export function createChatMessagesRepository(
  db: IDBPDatabase<BookwormDBSchema>,
): ChatMessagesRepository {
  return {
    async getById(id) {
      const raw = await db.get(CHAT_MESSAGES_STORE, id);
      const n = normalizeChatMessage(raw);
      return n ?? undefined;
    },
    async getByThread(threadId) {
      const tx = db.transaction(CHAT_MESSAGES_STORE, 'readonly');
      const idx = tx.store.index('by-thread');
      const raw = await idx.getAll(threadId);
      const out: ChatMessage[] = [];
      for (const r of raw) {
        const n = normalizeChatMessage(r);
        if (n) out.push(n);
      }
      out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      return out;
    },
    async upsert(msg) {
      await db.put(CHAT_MESSAGES_STORE, msg);
    },
    async delete(id) {
      await db.delete(CHAT_MESSAGES_STORE, id);
    },
    async deleteByThread(threadId) {
      const tx = db.transaction(CHAT_MESSAGES_STORE, 'readwrite');
      const idx = tx.store.index('by-thread');
      const keys = await idx.getAllKeys(threadId);
      for (const k of keys) {
        await tx.store.delete(k);
      }
      await tx.done;
    },
  };
}
```

Run: `pnpm test src/storage/repositories/chatMessages.test.ts` → PASS.

- [ ] **Step 7: Repeat the test → implement → pass cycle for `savedAnswers`**

Create `src/storage/repositories/savedAnswers.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { openTestBookwormDB, closeTestDB } from '@/storage/test-helpers';
import { createSavedAnswersRepository } from './savedAnswers';
import type { SavedAnswer } from '@/domain';
import { BookId, ChatMessageId, ChatThreadId, SavedAnswerId } from '@/domain';

function makeSaved(overrides: Partial<SavedAnswer> = {}): SavedAnswer {
  return {
    id: SavedAnswerId('s-1'),
    bookId: BookId('b-1'),
    threadId: ChatThreadId('t-1'),
    messageId: ChatMessageId('m-1'),
    modelId: 'gpt-x',
    mode: 'open',
    content: 'The book argues that...',
    question: 'What is this book about?',
    contextRefs: [],
    createdAt: '2026-05-05T00:00:00.000Z' as SavedAnswer['createdAt'],
    ...overrides,
  };
}

describe('SavedAnswersRepository', () => {
  let db: IDBPDatabase<BookwormDBSchema>;
  beforeEach(async () => { db = await openTestBookwormDB(); });
  afterEach(async () => { await closeTestDB(db); });

  it('round-trips upsert / getById', async () => {
    const repo = createSavedAnswersRepository(db);
    const s = makeSaved();
    await repo.upsert(s);
    expect(await repo.getById(s.id)).toEqual(s);
  });

  it('getByBook returns saved answers for the book', async () => {
    const repo = createSavedAnswersRepository(db);
    await repo.upsert(makeSaved({ id: SavedAnswerId('s-1'), bookId: BookId('a') }));
    await repo.upsert(makeSaved({ id: SavedAnswerId('s-2'), bookId: BookId('b') }));
    const list = await repo.getByBook(BookId('a'));
    expect(list.map((s) => s.id)).toEqual([SavedAnswerId('s-1')]);
  });

  it('getByMessage returns the saved answer linked to a message', async () => {
    const repo = createSavedAnswersRepository(db);
    await repo.upsert(makeSaved({ id: SavedAnswerId('s-1'), messageId: ChatMessageId('m-x') }));
    expect(await repo.getByMessage(ChatMessageId('m-x'))).toBeDefined();
    expect(await repo.getByMessage(ChatMessageId('m-other'))).toBeUndefined();
  });

  it('drops malformed records', async () => {
    await db.put('saved_answers', { id: 'bad' } as never);
    const repo = createSavedAnswersRepository(db);
    expect(await repo.getById('bad' as never)).toBeUndefined();
  });

  it('deleteByBook removes only matching answers', async () => {
    const repo = createSavedAnswersRepository(db);
    await repo.upsert(makeSaved({ id: SavedAnswerId('s-1'), bookId: BookId('a') }));
    await repo.upsert(makeSaved({ id: SavedAnswerId('s-2'), bookId: BookId('b') }));
    await repo.deleteByBook(BookId('a'));
    expect(await repo.getById(SavedAnswerId('s-1'))).toBeUndefined();
    expect(await repo.getById(SavedAnswerId('s-2'))).toBeDefined();
  });
});
```

Run: `pnpm test src/storage/repositories/savedAnswers.test.ts` → FAIL.

Implement `src/storage/repositories/savedAnswers.ts`:

```ts
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { SAVED_ANSWERS_STORE } from '@/storage/db/schema';
import type { BookId, ChatMessageId, ChatMode, SavedAnswer, SavedAnswerId } from '@/domain';

const MODES: readonly ChatMode[] = ['open', 'passage', 'chapter', 'multi-excerpt', 'retrieval', 'full-book'];

function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

export function normalizeSavedAnswer(value: unknown): SavedAnswer | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (typeof v.bookId !== 'string' || v.bookId === '') return null;
  if (typeof v.threadId !== 'string' || v.threadId === '') return null;
  if (typeof v.messageId !== 'string' || v.messageId === '') return null;
  if (typeof v.modelId !== 'string' || v.modelId === '') return null;
  if (typeof v.mode !== 'string' || !MODES.includes(v.mode as ChatMode)) return null;
  if (typeof v.content !== 'string') return null;
  if (typeof v.question !== 'string') return null;
  if (!Array.isArray(v.contextRefs)) return null;
  if (!isIsoTimestamp(v.createdAt)) return null;
  return value as SavedAnswer;
}

export type SavedAnswersRepository = {
  readonly getById: (id: SavedAnswerId) => Promise<SavedAnswer | undefined>;
  readonly getByBook: (bookId: BookId) => Promise<readonly SavedAnswer[]>;
  readonly getByMessage: (messageId: ChatMessageId) => Promise<SavedAnswer | undefined>;
  readonly upsert: (saved: SavedAnswer) => Promise<void>;
  readonly delete: (id: SavedAnswerId) => Promise<void>;
  readonly deleteByBook: (bookId: BookId) => Promise<void>;
};

export function createSavedAnswersRepository(
  db: IDBPDatabase<BookwormDBSchema>,
): SavedAnswersRepository {
  return {
    async getById(id) {
      const raw = await db.get(SAVED_ANSWERS_STORE, id);
      const n = normalizeSavedAnswer(raw);
      return n ?? undefined;
    },
    async getByBook(bookId) {
      const tx = db.transaction(SAVED_ANSWERS_STORE, 'readonly');
      const idx = tx.store.index('by-book');
      const raw = await idx.getAll(bookId);
      const out: SavedAnswer[] = [];
      for (const r of raw) {
        const n = normalizeSavedAnswer(r);
        if (n) out.push(n);
      }
      out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return out;
    },
    async getByMessage(messageId) {
      const tx = db.transaction(SAVED_ANSWERS_STORE, 'readonly');
      const idx = tx.store.index('by-message');
      const raw = await idx.get(messageId);
      const n = normalizeSavedAnswer(raw);
      return n ?? undefined;
    },
    async upsert(saved) {
      await db.put(SAVED_ANSWERS_STORE, saved);
    },
    async delete(id) {
      await db.delete(SAVED_ANSWERS_STORE, id);
    },
    async deleteByBook(bookId) {
      const tx = db.transaction(SAVED_ANSWERS_STORE, 'readwrite');
      const idx = tx.store.index('by-book');
      const keys = await idx.getAllKeys(bookId);
      for (const k of keys) {
        await tx.store.delete(k);
      }
      await tx.done;
    },
  };
}
```

Run: `pnpm test src/storage/repositories/savedAnswers.test.ts` → PASS.

- [ ] **Step 8: Add barrel re-exports**

Open `src/storage/index.ts`. Below existing repository re-exports, add:

```ts
export {
  createChatThreadsRepository,
  type ChatThreadsRepository,
} from './repositories/chatThreads';
export {
  createChatMessagesRepository,
  type ChatMessagesRepository,
} from './repositories/chatMessages';
export {
  createSavedAnswersRepository,
  type SavedAnswersRepository,
} from './repositories/savedAnswers';
```

- [ ] **Step 9: Verify the full unit suite is green**

```bash
pnpm check
```
Expected: PASS (type-check + lint + tests).

- [ ] **Step 10: Commit**

```bash
git add src/storage/repositories/chatThreads.ts src/storage/repositories/chatThreads.test.ts \
        src/storage/repositories/chatMessages.ts src/storage/repositories/chatMessages.test.ts \
        src/storage/repositories/savedAnswers.ts src/storage/repositories/savedAnswers.test.ts \
        src/storage/index.ts
git commit -m "feat(storage): chatThreads / chatMessages / savedAnswers repositories"
```

---

### Task 4: Storage — `rightRailVisible` reader pref + `chatPanelHintShown` setting

**Files:**
- Modify: `src/storage/db/schema.ts` (extend `SettingsRecord` union)
- Modify: `src/storage/repositories/settings.ts` (add getter/setter for `chatPanelHintShown`)
- Modify: `src/storage/repositories/settings.test.ts` (cover the new pair)
- Modify: `src/storage/repositories/readerPreferences.ts` (extend `ReaderPreferences` + normalizer)
- Modify: `src/storage/repositories/readerPreferences.test.ts` (cover the new field)
- Modify: `src/domain/reader/index.ts` (or wherever `ReaderPreferences` is declared — extend type)

> **Strategy:** Forward-compatible validator soften for `ReaderPreferences.rightRailVisible` (defaults to `true` when missing). New `SettingsRecord` variant `'chatPanelHintShown'` mirrors `'focusModeHintShown'`. No DB migration.

- [ ] **Step 1: Locate the `ReaderPreferences` declaration and the `focusModeHintShown` precedent**

Run:
```bash
rg -n "ReaderPreferences|focusModeHintShown" src --type ts
```

Note the file paths. Read `src/storage/repositories/settings.ts` for the `focusModeHintShown` getter/setter shape. Read the `ReaderPreferences` type for its current fields and the `normalizeReaderPreferences` helper that softens missing fields.

- [ ] **Step 2: Extend `ReaderPreferences` type**

In the file declaring `ReaderPreferences` (likely `src/domain/reader/index.ts` or `src/domain/reader/types.ts`), add a `rightRailVisible: boolean` field:

```ts
export type ReaderPreferences = {
  // existing fields…
  readonly rightRailVisible: boolean;
};
```

- [ ] **Step 3: Soften the normalizer in `readerPreferences.ts`**

In `normalizeReaderPreferences`, for any object missing `rightRailVisible`, default it to `true`:

```ts
const rightRailVisible = typeof v.rightRailVisible === 'boolean' ? v.rightRailVisible : true;
return { ...rest, rightRailVisible };
```

(Match the exact shape of the existing `focusMode` defaulting code in this file.)

- [ ] **Step 4: Write the failing test in `readerPreferences.test.ts`**

Append:

```ts
  it('defaults rightRailVisible to true when missing on read', async () => {
    const repo = createReaderPreferencesRepository(db);
    await db.put('reader_preferences', { key: 'global', value: { focusMode: 'chrome', modeByFormat: { epub: 'paginated', pdf: 'scroll' } } } as never);
    const prefs = await repo.get();
    expect(prefs.rightRailVisible).toBe(true);
  });

  it('round-trips rightRailVisible: false', async () => {
    const repo = createReaderPreferencesRepository(db);
    await repo.update({ rightRailVisible: false });
    const prefs = await repo.get();
    expect(prefs.rightRailVisible).toBe(false);
  });
```

(If `repo.update` doesn't exist with that exact partial shape, mirror the pattern used by an existing field — e.g., `repo.setFocusMode` — and add `repo.setRightRailVisible(value: boolean)` to the repository.)

Run: `pnpm test src/storage/repositories/readerPreferences.test.ts`. Failing tests guide the implementation.

- [ ] **Step 5: Add a `setRightRailVisible` method to the repo if not present**

```ts
async setRightRailVisible(visible: boolean) {
  const current = await this.get();
  await this.put({ ...current, rightRailVisible: visible });
},
```

(Match the shape of `setFocusMode`.)

Run the test → PASS.

- [ ] **Step 6: Extend `SettingsRecord` for `chatPanelHintShown`**

In `src/storage/db/schema.ts`, append to the `SettingsRecord` union:

```ts
  | { readonly key: 'chatPanelHintShown'; readonly value: boolean }
```

- [ ] **Step 7: Add getter/setter in `SettingsRepository`**

In `src/storage/repositories/settings.ts`, mirroring `getFocusModeHintShown` / `setFocusModeHintShown`:

```ts
async getChatPanelHintShown(): Promise<boolean> {
  const rec = await db.get('settings', 'chatPanelHintShown');
  return typeof rec?.value === 'boolean' ? rec.value : false;
},
async setChatPanelHintShown(value: boolean): Promise<void> {
  await db.put('settings', { key: 'chatPanelHintShown', value });
},
```

- [ ] **Step 8: Write tests in `settings.test.ts`**

Inside the existing outer `describe('SettingsRepository', ...)`:

```ts
  describe('chatPanelHintShown', () => {
    it('defaults to false when not set', async () => {
      const settings = createSettingsRepository(db);
      expect(await settings.getChatPanelHintShown()).toBe(false);
    });
    it('round-trips a value', async () => {
      const settings = createSettingsRepository(db);
      await settings.setChatPanelHintShown(true);
      expect(await settings.getChatPanelHintShown()).toBe(true);
    });
  });
```

- [ ] **Step 9: Verify**

```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/domain/reader src/storage/db/schema.ts src/storage/repositories/settings.ts src/storage/repositories/settings.test.ts src/storage/repositories/readerPreferences.ts src/storage/repositories/readerPreferences.test.ts
git commit -m "feat(storage): rightRailVisible reader pref + chatPanelHintShown setting"
```

---

### Task 5: AI — `parseSSE` (pure SSE event parser)

**Files:**
- Create: `src/features/ai/chat/parseSSE.ts`
- Create: `src/features/ai/chat/parseSSE.test.ts`

> **Strategy:** Pure helper. Permissive SSE parser: tolerates `\n` and `\r\n`, skips comment lines starting with `:`, joins multi-line `data:` continuations, stops on the `[DONE]` sentinel. Returns the unconsumed remainder so the caller can re-buffer between chunk reads.

- [ ] **Step 1: Write the failing tests**

Create `src/features/ai/chat/parseSSE.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSSE } from './parseSSE';

describe('parseSSE', () => {
  it('returns no events and no remainder on empty input', () => {
    expect(parseSSE('', '')).toEqual({ events: [], remainder: '' });
  });

  it('parses one complete data event', () => {
    const r = parseSSE('data: {"a":1}\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: '{"a":1}' }]);
    expect(r.remainder).toBe('');
  });

  it('parses multiple events in one chunk', () => {
    const r = parseSSE('data: a\n\ndata: b\n\n', '');
    expect(r.events).toEqual([
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ]);
  });

  it('emits done sentinel for [DONE]', () => {
    const r = parseSSE('data: [DONE]\n\n', '');
    expect(r.events).toEqual([{ kind: 'done' }]);
  });

  it('tolerates \\r\\n line endings', () => {
    const r = parseSSE('data: x\r\n\r\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'x' }]);
  });

  it('skips comment lines beginning with :', () => {
    const r = parseSSE(':keep-alive\n\ndata: x\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'x' }]);
  });

  it('joins multi-line data fields', () => {
    const r = parseSSE('data: line1\ndata: line2\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'line1\nline2' }]);
  });

  it('returns remainder for partial last event', () => {
    const r = parseSSE('data: complete\n\ndata: parti', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'complete' }]);
    expect(r.remainder).toBe('data: parti');
  });

  it('reattaches buffered remainder', () => {
    const r1 = parseSSE('data: par', '');
    expect(r1.events).toEqual([]);
    const r2 = parseSSE('tial\n\n', r1.remainder);
    expect(r2.events).toEqual([{ kind: 'data', data: 'partial' }]);
  });

  it('ignores unknown field types (event:, id:, retry:)', () => {
    const r = parseSSE('event: ping\nid: 1\nretry: 100\ndata: payload\n\n', '');
    expect(r.events).toEqual([{ kind: 'data', data: 'payload' }]);
  });

  it('ignores blank lines that are not event terminators', () => {
    // Two consecutive blanks after data: still terminates correctly.
    const r = parseSSE('data: a\n\n\ndata: b\n\n', '');
    expect(r.events).toEqual([
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ]);
  });

  it('handles a chunk that is exactly the terminator', () => {
    const r1 = parseSSE('data: x\n', '');
    expect(r1.events).toEqual([]);
    expect(r1.remainder).toBe('data: x\n');
    const r2 = parseSSE('\n', r1.remainder);
    expect(r2.events).toEqual([{ kind: 'data', data: 'x' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test src/features/ai/chat/parseSSE.test.ts
```
Expected: FAIL with `Cannot find module './parseSSE'`.

- [ ] **Step 3: Implement `parseSSE.ts`**

```ts
export type ParsedSSEEvent =
  | { readonly kind: 'data'; readonly data: string }
  | { readonly kind: 'done' };

export type SSEParseResult = {
  readonly events: readonly ParsedSSEEvent[];
  readonly remainder: string;
};

export function parseSSE(chunk: string, buffered: string): SSEParseResult {
  const text = buffered + chunk;
  // Normalize \r\n to \n for line splitting; remainder will be re-emitted in original form.
  const normalized = text.replace(/\r\n/g, '\n');

  const events: ParsedSSEEvent[] = [];
  let cursor = 0;

  // Find double-newline event separators.
  while (true) {
    const sep = normalized.indexOf('\n\n', cursor);
    if (sep < 0) break;
    const block = normalized.slice(cursor, sep);
    cursor = sep + 2;

    const lines = block.split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line === '') continue;
      if (line.startsWith(':')) continue;
      // Field parsing per SSE spec: "field:value" or "field: value"
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const field = line.slice(0, colon);
      let value = line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') dataLines.push(value);
      // event/id/retry — ignored for our purposes
    }

    if (dataLines.length === 0) continue;
    const joined = dataLines.join('\n');
    if (joined === '[DONE]') {
      events.push({ kind: 'done' });
    } else {
      events.push({ kind: 'data', data: joined });
    }
  }

  // remainder is whatever is unconsumed after the last \n\n
  const remainder = normalized.slice(cursor);
  return { events, remainder };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test src/features/ai/chat/parseSSE.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/chat/parseSSE.ts src/features/ai/chat/parseSSE.test.ts
git commit -m "feat(ai): parseSSE — pure SSE event parser"
```

---

### Task 6: AI — `nanogptChat` streaming chat completions adapter

**Files:**
- Create: `src/features/ai/chat/nanogptChat.ts`
- Create: `src/features/ai/chat/nanogptChat.test.ts`

> **Strategy:** Async generator over `fetch + ReadableStream`. Permissive: emits `delta` events for text deltas, `usage` when present in the final chunk, `done` for `[DONE]`. Throws typed `ChatCompletionFailure` on pre-stream HTTP failures. Cancellation via `AbortSignal`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/ai/chat/nanogptChat.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChatCompletion, type ChatCompletionRequest } from './nanogptChat';

function makeStreamResponse(body: string, status = 200): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function makeJsonErrorResponse(status: number, retryAfterSeconds?: number): Response {
  const headers = new Headers();
  if (retryAfterSeconds !== undefined) headers.set('Retry-After', String(retryAfterSeconds));
  return new Response('{"error":"x"}', { status, headers });
}

const baseReq: ChatCompletionRequest = {
  apiKey: 'sk-fake',
  modelId: 'gpt-x',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('streamChatCompletion', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('emits delta events from data chunks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeStreamResponse(
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
        'data: [DONE]\n\n',
      ),
    );
    const events: unknown[] = [];
    for await (const e of streamChatCompletion(baseReq)) events.push(e);
    expect(events).toEqual([
      { kind: 'delta', text: 'hel' },
      { kind: 'delta', text: 'lo' },
      { kind: 'done' },
    ]);
  });

  it('emits usage event from final chunk when present', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeStreamResponse(
        'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n' +
        'data: [DONE]\n\n',
      ),
    );
    const events: unknown[] = [];
    for await (const e of streamChatCompletion(baseReq)) events.push(e);
    expect(events).toContainEqual({ kind: 'usage', prompt: 10, completion: 3 });
  });

  it('throws invalid-key on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(401));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) { /* drain */ }
    }).rejects.toMatchObject({ reason: 'invalid-key', status: 401 });
  });

  it('throws rate-limit with retryAfter on 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(429, 12));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) { /* drain */ }
    }).rejects.toMatchObject({ reason: 'rate-limit', status: 429, retryAfterSeconds: 12 });
  });

  it('throws model-unavailable on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(404));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) { /* drain */ }
    }).rejects.toMatchObject({ reason: 'model-unavailable', status: 404 });
  });

  it('throws server on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeJsonErrorResponse(500));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) { /* drain */ }
    }).rejects.toMatchObject({ reason: 'server', status: 500 });
  });

  it('throws network on fetch rejection', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('network down'));
    await expect(async () => {
      for await (const _ of streamChatCompletion(baseReq)) { /* drain */ }
    }).rejects.toMatchObject({ reason: 'network' });
  });

  it('returns silently on AbortError', async () => {
    const ctrl = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      // simulate fetch reading the signal and aborting
      if (init?.signal?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      ctrl.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const events: unknown[] = [];
    try {
      for await (const e of streamChatCompletion({ ...baseReq, signal: ctrl.signal })) events.push(e);
    } catch (e) {
      expect((e as { reason: string }).reason).toBe('aborted');
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test src/features/ai/chat/nanogptChat.test.ts
```
Expected: FAIL with module-missing.

- [ ] **Step 3: Implement `nanogptChat.ts`**

```ts
import { parseSSE } from './parseSSE';

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type ChatCompletionMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
};

export type ChatCompletionRequest = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly messages: readonly ChatCompletionMessage[];
  readonly signal?: AbortSignal;
};

export type StreamEvent =
  | { readonly kind: 'delta'; readonly text: string }
  | { readonly kind: 'usage'; readonly prompt: number; readonly completion: number; readonly cached?: number }
  | { readonly kind: 'done' };

export type ChatCompletionFailure =
  | { readonly reason: 'invalid-key'; readonly status: 401 | 403 }
  | { readonly reason: 'rate-limit'; readonly status: 429; readonly retryAfterSeconds?: number }
  | { readonly reason: 'model-unavailable'; readonly status: 404 | 400 }
  | { readonly reason: 'server'; readonly status: number }
  | { readonly reason: 'network' }
  | { readonly reason: 'aborted' }
  | { readonly reason: 'malformed-stream' };

function classifyHttpFailure(res: Response): ChatCompletionFailure {
  const status = res.status;
  if (status === 401 || status === 403) return { reason: 'invalid-key', status: status as 401 | 403 };
  if (status === 429) {
    const ra = res.headers.get('Retry-After');
    const retryAfterSeconds = ra ? Number.parseInt(ra, 10) : undefined;
    return { reason: 'rate-limit', status: 429, ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
  }
  if (status === 404 || status === 400) return { reason: 'model-unavailable', status: status as 404 | 400 };
  return { reason: 'server', status };
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export async function* streamChatCompletion(req: ChatCompletionRequest): AsyncGenerator<StreamEvent> {
  let res: Response;
  try {
    res = await fetch(`${NANOGPT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.modelId,
        messages: req.messages,
        stream: true,
      }),
      ...(req.signal !== undefined && { signal: req.signal }),
    });
  } catch (e) {
    if (isAbortError(e)) throw { reason: 'aborted' } satisfies ChatCompletionFailure;
    throw { reason: 'network' } satisfies ChatCompletionFailure;
  }
  if (!res.ok || !res.body) throw classifyHttpFailure(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const result = parseSSE(chunk, buffered);
      buffered = result.remainder;
      for (const evt of result.events) {
        if (evt.kind === 'done') {
          yield { kind: 'done' };
          return;
        }
        // evt.kind === 'data' — parse the JSON payload.
        let payload: unknown;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          throw { reason: 'malformed-stream' } satisfies ChatCompletionFailure;
        }
        const p = payload as {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number };
        };
        const delta = p.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield { kind: 'delta', text: delta };
        }
        if (p.usage) {
          yield {
            kind: 'usage',
            prompt: p.usage.prompt_tokens ?? 0,
            completion: p.usage.completion_tokens ?? 0,
            ...(p.usage.cached_tokens !== undefined ? { cached: p.usage.cached_tokens } : {}),
          };
        }
      }
    }
  } catch (e) {
    if (isAbortError(e)) throw { reason: 'aborted' } satisfies ChatCompletionFailure;
    if (typeof e === 'object' && e !== null && 'reason' in e) throw e as ChatCompletionFailure;
    throw { reason: 'malformed-stream' } satisfies ChatCompletionFailure;
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/features/ai/chat/nanogptChat.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/chat/nanogptChat.ts src/features/ai/chat/nanogptChat.test.ts
git commit -m "feat(ai): nanogptChat — streaming chat completions adapter"
```

---

### Task 7: AI — `promptAssembly` (open-mode system prompt)

**Files:**
- Create: `src/features/ai/chat/promptAssembly.ts`
- Create: `src/features/ai/chat/promptAssembly.test.ts`

> **Strategy:** Pure helpers. `buildOpenModeSystemPrompt(book)` returns the literal system prompt; `assembleOpenChatPrompt(input)` produces the message array for `streamChatCompletion`. Includes the soft history cap (40 pairs).

- [ ] **Step 1: Write the failing tests**

Create `src/features/ai/chat/promptAssembly.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  HISTORY_SOFT_CAP,
  assembleOpenChatPrompt,
  buildOpenModeSystemPrompt,
} from './promptAssembly';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId } from '@/domain';

function msg(role: 'user' | 'assistant', content: string, idx: number): ChatMessage {
  return {
    id: ChatMessageId(`m-${idx}`),
    threadId: ChatThreadId('t-1'),
    role,
    content,
    contextRefs: [],
    createdAt: `2026-05-05T00:00:${String(idx).padStart(2, '0')}.000Z` as ChatMessage['createdAt'],
  };
}

describe('buildOpenModeSystemPrompt', () => {
  it('includes the book title', () => {
    const out = buildOpenModeSystemPrompt({ title: 'Moby-Dick' });
    expect(out).toContain('Moby-Dick');
  });
  it('includes the author when present', () => {
    const out = buildOpenModeSystemPrompt({ title: 'Moby-Dick', author: 'Herman Melville' });
    expect(out).toContain('Herman Melville');
  });
  it('omits author when absent', () => {
    const out = buildOpenModeSystemPrompt({ title: 'Anonymous' });
    expect(out).not.toContain('by ');
  });
  it('mentions the no-excerpts disclaimer', () => {
    const out = buildOpenModeSystemPrompt({ title: 'X' });
    expect(out.toLowerCase()).toMatch(/no excerpts|no passages|haven't (read|seen)|not.*excerpts/);
  });
});

describe('assembleOpenChatPrompt', () => {
  it('produces system + history + new user message in order', () => {
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history: [msg('user', 'first', 1), msg('assistant', 'reply', 2)],
      newUserText: 'second',
    });
    expect(out.messages.length).toBe(4);
    expect(out.messages[0].role).toBe('system');
    expect(out.messages[1]).toEqual({ role: 'user', content: 'first' });
    expect(out.messages[2]).toEqual({ role: 'assistant', content: 'reply' });
    expect(out.messages[3]).toEqual({ role: 'user', content: 'second' });
    expect(out.historyDropped).toBe(0);
  });

  it('drops oldest pairs when history exceeds soft cap', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < HISTORY_SOFT_CAP * 2; i++) {
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `t${i}`, i));
    }
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history,
      newUserText: 'now',
    });
    expect(out.historyDropped).toBeGreaterThan(0);
    // 1 system + (2 * HISTORY_SOFT_CAP) preserved + 1 newUser
    expect(out.messages.length).toBe(1 + HISTORY_SOFT_CAP * 2 + 1);
  });

  it('keeps full history when under cap', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 4; i++) history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `t${i}`, i));
    const out = assembleOpenChatPrompt({
      book: { title: 'X', format: 'epub' },
      history,
      newUserText: 'now',
    });
    expect(out.historyDropped).toBe(0);
    expect(out.messages.length).toBe(1 + 4 + 1);
  });
});
```

- [ ] **Step 2: Run tests → fail**

```bash
pnpm test src/features/ai/chat/promptAssembly.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `promptAssembly.ts`**

```ts
import type { BookFormat, ChatMessage } from '@/domain';
import type { ChatCompletionMessage } from './nanogptChat';

export const HISTORY_SOFT_CAP = 40; // pairs preserved (== messages preserved when alternating)

export function buildOpenModeSystemPrompt(book: {
  readonly title: string;
  readonly author?: string;
}): string {
  const subject = book.author ? `the book "${book.title}" by ${book.author}` : `the book "${book.title}"`;
  return [
    `You are helping a reader discuss ${subject}.`,
    `The user has not selected any passages or chapters; you have only the book's title${book.author ? ' and author' : ''}.`,
    `Answer carefully. When discussing book contents, distinguish between what the title strongly implies and what you actually have evidence for.`,
    `If the user asks about specifics, say plainly that no excerpts are attached and offer to help once they share a passage.`,
    `Do not pretend to have read the book.`,
  ].join(' ');
}

export type AssembleOpenChatInput = {
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
};

export type AssembleOpenChatResult = {
  readonly messages: readonly ChatCompletionMessage[];
  readonly historyDropped: number;
};

export function assembleOpenChatPrompt(input: AssembleOpenChatInput): AssembleOpenChatResult {
  const system: ChatCompletionMessage = {
    role: 'system',
    content: buildOpenModeSystemPrompt(input.book),
  };

  const preservedCount = HISTORY_SOFT_CAP * 2;
  const dropFromFront = Math.max(0, input.history.length - preservedCount);
  const preserved = input.history.slice(dropFromFront);

  const historyMsgs: ChatCompletionMessage[] = preserved
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const tail: ChatCompletionMessage = { role: 'user', content: input.newUserText };

  return {
    messages: [system, ...historyMsgs, tail],
    historyDropped: dropFromFront,
  };
}
```

- [ ] **Step 4: Run tests → pass**

```bash
pnpm test src/features/ai/chat/promptAssembly.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/chat/promptAssembly.ts src/features/ai/chat/promptAssembly.test.ts
git commit -m "feat(ai): promptAssembly — open-mode system prompt builder"
```

---

### Task 8: AI — `chatRequestMachine` (XState)

**Files:**
- Create: `src/features/ai/chat/chatRequestMachine.ts`
- Create: `src/features/ai/chat/chatRequestMachine.test.ts`

> **Strategy:** A `setup({...}).createMachine(...)` from XState v5. One instance per send. Drives the lifecycle: `assembling → sending → streaming → done` with branches to `error` (typed failure) and `aborted` (with optional `truncated` save). The machine itself is pure-ish — the side effects (network call, IDB writes) are passed in as actor logic / actions; the React hook layer wires the real implementations.

- [ ] **Step 1: Read XState v5 docs you'll touch**

Skim:
- The `setup({...}).createMachine(...)` API.
- `fromCallback` for invoking the streaming generator (the generator is the actor; events from it become machine events).
- `assign` action helper.

XState v5 is already in the dep tree (`xstate ^5.31.0`).

- [ ] **Step 2: Write the failing tests**

Create `src/features/ai/chat/chatRequestMachine.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createActor } from 'xstate';
import { makeChatRequestMachine } from './chatRequestMachine';
import type { StreamEvent } from './nanogptChat';
import { ChatMessageId, ChatThreadId } from '@/domain';

type Sink = {
  events: unknown[];
  finalize: (id: string, fields: Record<string, unknown>) => Promise<void>;
};

function makeSink(): Sink {
  const events: unknown[] = [];
  return {
    events,
    finalize: vi.fn(async (id, fields) => {
      events.push({ kind: 'finalize', id, fields });
    }),
  };
}

async function runWith(stream: AsyncGenerator<StreamEvent> | (() => AsyncGenerator<StreamEvent>), sink: Sink) {
  const factory = typeof stream === 'function' ? stream : () => stream;
  const machine = makeChatRequestMachine({
    // Match MachineDeps.streamFactory: (assembled, modelId, signal) => AsyncGenerator<StreamEvent>
    streamFactory: (_assembled, _modelId, _signal) => factory(),
    onDelta: (id, fields) => { sink.events.push({ kind: 'delta', id, fields }); return Promise.resolve(); },
    finalize: sink.finalize,
  });
  const actor = createActor(machine, {
    input: {
      threadId: ChatThreadId('t-1'),
      pendingUserMessageId: ChatMessageId('u-1'),
      pendingAssistantMessageId: ChatMessageId('a-1'),
      modelId: 'gpt-x',
      assembled: { messages: [{ role: 'user', content: 'hi' }] },
    },
  });
  actor.start();
  return actor;
}

async function* mkStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of events) yield e;
}

describe('chatRequestMachine', () => {
  it('reaches done after a clean stream', async () => {
    const sink = makeSink();
    const actor = await runWith(
      mkStream([
        { kind: 'delta', text: 'hel' },
        { kind: 'delta', text: 'lo' },
        { kind: 'usage', prompt: 5, completion: 2 },
        { kind: 'done' },
      ]),
      sink,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(actor.getSnapshot().status).toBe('done');
    expect(sink.events.some((e) => (e as any).kind === 'finalize')).toBe(true);
  });

  it('captures partial text on cancel and finalizes truncated=true', async () => {
    const sink = makeSink();
    let resolveSecond: () => void;
    const second = new Promise<void>((r) => { resolveSecond = r; });
    async function* slow(): AsyncGenerator<StreamEvent> {
      yield { kind: 'delta', text: 'partial' };
      await second;
      yield { kind: 'done' };
    }
    const actor = await runWith(slow(), sink);
    // give it time to enter streaming
    await new Promise((r) => setTimeout(r, 5));
    actor.send({ type: 'CANCEL' });
    resolveSecond!();
    await new Promise((r) => setTimeout(r, 20));
    const finalize = sink.events.find((e) => (e as any).kind === 'finalize') as any;
    expect(finalize.fields.truncated).toBe(true);
  });

  it('routes invalid-key failure to error state', async () => {
    const sink = makeSink();
    async function* failing(): AsyncGenerator<StreamEvent> {
      // Throwing simulates a fetch-time failure handed up through the actor.
      throw { reason: 'invalid-key', status: 401 };
      // eslint-disable-next-line no-unreachable
      yield { kind: 'done' };
    }
    const machine = makeChatRequestMachine({
      streamFactory: failing,
      onDelta: () => Promise.resolve(),
      finalize: sink.finalize,
    });
    const actor = createActor(machine, {
      input: {
        threadId: ChatThreadId('t-1'),
        pendingUserMessageId: ChatMessageId('u-1'),
        pendingAssistantMessageId: ChatMessageId('a-1'),
        modelId: 'gpt-x',
        assembled: { messages: [{ role: 'user', content: 'hi' }] },
      },
    });
    actor.start();
    await new Promise((r) => setTimeout(r, 20));
    const snap = actor.getSnapshot();
    expect(snap.status).toBe('done');
    expect((snap as any).output?.failure?.reason).toBe('invalid-key');
  });
});
```

- [ ] **Step 3: Run tests → fail**

```bash
pnpm test src/features/ai/chat/chatRequestMachine.test.ts
```
Expected: FAIL with module-missing.

- [ ] **Step 4: Implement `chatRequestMachine.ts`**

```ts
import { assign, fromCallback, setup } from 'xstate';
import type { ChatMessageId, ChatThreadId, TokenUsage } from '@/domain';
import type { ChatCompletionFailure, ChatCompletionMessage, StreamEvent } from './nanogptChat';

export type ChatRequestInput = {
  readonly threadId: ChatThreadId;
  readonly pendingUserMessageId: ChatMessageId;
  readonly pendingAssistantMessageId: ChatMessageId;
  readonly modelId: string;
  readonly assembled: { readonly messages: readonly ChatCompletionMessage[] };
};

export type ChatRequestContext = ChatRequestInput & {
  partial: string;
  usage?: TokenUsage;
  failure?: ChatCompletionFailure;
};

export type ChatRequestEvent =
  | { type: 'DELTA'; text: string }
  | { type: 'USAGE'; usage: TokenUsage }
  | { type: 'STREAM_DONE' }
  | { type: 'STREAM_ERROR'; failure: ChatCompletionFailure }
  | { type: 'CANCEL' };

export type MachineDeps = {
  readonly streamFactory: (
    assembled: { readonly messages: readonly ChatCompletionMessage[] },
    modelId: string,
    signal: AbortSignal,
  ) => AsyncGenerator<StreamEvent>;
  readonly onDelta: (id: ChatMessageId, fields: { content: string; streaming: true }) => Promise<void>;
  readonly finalize: (
    id: ChatMessageId,
    fields: {
      content: string;
      streaming: false;
      usage?: TokenUsage;
      truncated?: true;
      error?: 'failed' | 'interrupted';
    },
  ) => Promise<void>;
};

export function makeChatRequestMachine(deps: MachineDeps) {
  const streamActor = fromCallback<{ type: 'NOOP' }, { input: ChatRequestContext }>(({ sendBack, input }) => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const gen = deps.streamFactory(input.assembled, input.modelId, ctrl.signal);
        for await (const evt of gen) {
          if (cancelled) return;
          if (evt.kind === 'delta') sendBack({ type: 'DELTA', text: evt.text });
          else if (evt.kind === 'usage') sendBack({ type: 'USAGE', usage: { promptTokens: evt.prompt, completionTokens: evt.completion, ...(evt.cached !== undefined ? { cachedTokens: evt.cached } : {}) } });
          else if (evt.kind === 'done') sendBack({ type: 'STREAM_DONE' });
        }
      } catch (e) {
        if (cancelled) return;
        const failure = (e && typeof e === 'object' && 'reason' in (e as object))
          ? (e as ChatCompletionFailure)
          : ({ reason: 'malformed-stream' } as ChatCompletionFailure);
        sendBack({ type: 'STREAM_ERROR', failure });
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  });

  return setup({
    types: {
      context: {} as ChatRequestContext,
      events: {} as ChatRequestEvent,
      input: {} as ChatRequestInput,
    },
    actors: { streamActor },
    actions: {
      appendDelta: assign({
        partial: ({ context, event }) =>
          event.type === 'DELTA' ? context.partial + event.text : context.partial,
      }),
      assignUsage: assign({
        usage: ({ event }) => (event.type === 'USAGE' ? event.usage : undefined),
      }),
      assignFailure: assign({
        failure: ({ event }) => (event.type === 'STREAM_ERROR' ? event.failure : undefined),
      }),
      patchPartialAsync: ({ context, event }) => {
        if (event.type !== 'DELTA') return;
        const next = context.partial + event.text;
        void deps.onDelta(context.pendingAssistantMessageId, { content: next, streaming: true });
      },
      finalizeDone: ({ context }) => {
        void deps.finalize(context.pendingAssistantMessageId, {
          content: context.partial,
          streaming: false,
          ...(context.usage ? { usage: context.usage } : {}),
        });
      },
      finalizeAborted: ({ context }) => {
        void deps.finalize(context.pendingAssistantMessageId, {
          content: context.partial,
          streaming: false,
          truncated: true,
        });
      },
      finalizeFailed: ({ context }) => {
        void deps.finalize(context.pendingAssistantMessageId, {
          content: context.partial,
          streaming: false,
          error: 'failed',
        });
      },
    },
  }).createMachine({
    id: 'chatRequest',
    initial: 'streaming',
    context: ({ input }) => ({ ...input, partial: '' }),
    states: {
      streaming: {
        invoke: { src: 'streamActor', input: ({ context }) => context },
        on: {
          DELTA: { actions: ['appendDelta', 'patchPartialAsync'] },
          USAGE: { actions: 'assignUsage' },
          STREAM_DONE: { target: 'done' },
          STREAM_ERROR: { target: 'failed', actions: 'assignFailure' },
          CANCEL: { target: 'aborted' },
        },
      },
      done: { type: 'final', entry: 'finalizeDone', output: ({ context }) => ({ partial: context.partial, usage: context.usage }) },
      aborted: { type: 'final', entry: 'finalizeAborted', output: ({ context }) => ({ partial: context.partial, aborted: true }) },
      failed: { type: 'final', entry: 'finalizeFailed', output: ({ context }) => ({ partial: context.partial, failure: context.failure }) },
    },
  });
}
```

(Note: the spec's `assembling` and `sending` substates are collapsed into the `streaming` state for v1 — the assembler runs synchronously in the hook *before* `actor.start()`, and the actor's `invoke` covers both pre-stream fetch and streaming. Simpler than three separate substates and equally testable.)

- [ ] **Step 5: Run tests → pass**

```bash
pnpm test src/features/ai/chat/chatRequestMachine.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/chat/chatRequestMachine.ts src/features/ai/chat/chatRequestMachine.test.ts
git commit -m "feat(ai): chatRequestMachine — XState machine for one send lifecycle"
```

---

### Task 9: AI — chat hooks (`useChatThreads`, `useChatMessages`, `useChatSend`, `useSavedAnswers`)

**Files:**
- Create: `src/features/ai/chat/useChatThreads.ts` (+ test)
- Create: `src/features/ai/chat/useChatMessages.ts` (+ test)
- Create: `src/features/ai/chat/useChatSend.ts` (+ test)
- Create: `src/features/ai/chat/useSavedAnswers.ts` (+ test)
- Create: `src/features/ai/chat/index.ts` (barrel)

> **Strategy:** Mirror the `useBookmarks` / `useHighlights` / `useNotes` shape — factory hook taking repos + IDs, returning `{ list, ...mutators }` with optimistic CRUD + rollback. `useChatSend` instantiates the XState machine via `createActor` and bridges it to React state. Stale-stream detection in `useChatMessages` runs on first load.

- [ ] **Step 1: Read the precedent**

Open and study:
- `src/features/reader/workspace/useBookmarks.ts` (+ `.test.ts`)
- `src/features/reader/workspace/useNotes.ts` (+ `.test.ts`)

Note: `renderHook` from `@testing-library/react`, `act` for async transitions, optimistic-with-rollback pattern.

- [ ] **Step 2: Implement `useChatThreads.ts`**

Test (`useChatThreads.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { openTestBookwormDB, closeTestDB } from '@/storage/test-helpers';
import { createChatThreadsRepository } from '@/storage/repositories/chatThreads';
import { useChatThreads } from './useChatThreads';
import { BookId, ChatThreadId } from '@/domain';

describe('useChatThreads', () => {
  let db: IDBPDatabase<BookwormDBSchema>;
  beforeEach(async () => { db = await openTestBookwormDB(); });
  afterEach(async () => { await closeTestDB(db); });

  it('loads existing threads sorted updatedAt desc; sets activeId to most recent', async () => {
    const repo = createChatThreadsRepository(db);
    await repo.upsert({
      id: ChatThreadId('t-old'), bookId: BookId('b'), title: 'Old', modelId: 'm', answerStyle: 'open',
      createdAt: '2026-05-04T00:00:00.000Z' as never, updatedAt: '2026-05-04T00:00:00.000Z' as never,
    });
    await repo.upsert({
      id: ChatThreadId('t-new'), bookId: BookId('b'), title: 'New', modelId: 'm', answerStyle: 'open',
      createdAt: '2026-05-05T00:00:00.000Z' as never, updatedAt: '2026-05-05T00:00:00.000Z' as never,
    });
    const { result } = renderHook(() => useChatThreads({ bookId: BookId('b'), threadsRepo: repo }));
    await waitFor(() => expect(result.current.list.length).toBe(2));
    expect(result.current.list[0].id).toBe(ChatThreadId('t-new'));
    expect(result.current.activeId).toBe(ChatThreadId('t-new'));
  });

  it('startDraft sets a draft with no persistence', async () => {
    const repo = createChatThreadsRepository(db);
    const { result } = renderHook(() => useChatThreads({ bookId: BookId('b'), threadsRepo: repo }));
    await waitFor(() => expect(result.current.list.length).toBe(0));
    act(() => { result.current.startDraft('gpt-x'); });
    expect(result.current.draft).not.toBeNull();
    // not in list yet
    expect(result.current.list).toEqual([]);
    // not in repo yet
    expect((await repo.getByBook(BookId('b'))).length).toBe(0);
  });

  it('rename updates list optimistically and persists', async () => {
    const repo = createChatThreadsRepository(db);
    await repo.upsert({
      id: ChatThreadId('t-1'), bookId: BookId('b'), title: 'Original', modelId: 'm', answerStyle: 'open',
      createdAt: '2026-05-05T00:00:00.000Z' as never, updatedAt: '2026-05-05T00:00:00.000Z' as never,
    });
    const { result } = renderHook(() => useChatThreads({ bookId: BookId('b'), threadsRepo: repo }));
    await waitFor(() => expect(result.current.list.length).toBe(1));
    await act(async () => { await result.current.rename(ChatThreadId('t-1'), 'Renamed'); });
    expect(result.current.list[0].title).toBe('Renamed');
    const persisted = await repo.getById(ChatThreadId('t-1'));
    expect(persisted?.title).toBe('Renamed');
  });

  it('remove cascades messages then deletes the thread', async () => {
    // covered in Task 22 (app wiring) at integration level; here verify the thread is gone
    const repo = createChatThreadsRepository(db);
    await repo.upsert({
      id: ChatThreadId('t-1'), bookId: BookId('b'), title: 'X', modelId: 'm', answerStyle: 'open',
      createdAt: '2026-05-05T00:00:00.000Z' as never, updatedAt: '2026-05-05T00:00:00.000Z' as never,
    });
    const messagesRepo = { deleteByThread: async () => { /* no-op for this test */ } };
    const { result } = renderHook(() => useChatThreads({ bookId: BookId('b'), threadsRepo: repo, messagesRepo: messagesRepo as never }));
    await waitFor(() => expect(result.current.list.length).toBe(1));
    await act(async () => { await result.current.remove(ChatThreadId('t-1')); });
    expect(result.current.list.length).toBe(0);
    expect(await repo.getById(ChatThreadId('t-1'))).toBeUndefined();
  });
});
```

Implementation (`useChatThreads.ts`):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatThreadsRepository, ChatMessagesRepository } from '@/storage';
import type { BookId, ChatThread, ChatThreadId } from '@/domain';

type DraftState = { tempId: string; modelId: string };

type Args = {
  readonly bookId: BookId;
  readonly threadsRepo: ChatThreadsRepository;
  readonly messagesRepo?: ChatMessagesRepository;
};

export type UseChatThreadsHandle = {
  readonly list: readonly ChatThread[];
  readonly activeId: ChatThreadId | null;
  readonly draft: DraftState | null;
  readonly setActive: (id: ChatThreadId) => void;
  readonly startDraft: (modelId: string) => void;
  readonly clearDraft: () => void;
  readonly rename: (id: ChatThreadId, title: string) => Promise<void>;
  readonly remove: (id: ChatThreadId) => Promise<void>;
  readonly persistDraft: (thread: ChatThread) => Promise<void>;
};

export function useChatThreads({ bookId, threadsRepo, messagesRepo }: Args): UseChatThreadsHandle {
  const [list, setList] = useState<readonly ChatThread[]>([]);
  const [activeId, setActiveId] = useState<ChatThreadId | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fetched = await threadsRepo.getByBook(bookId);
      if (cancelled) return;
      setList(fetched);
      if (fetched.length > 0 && !loadedRef.current) {
        setActiveId(fetched[0].id);
      }
      loadedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [bookId, threadsRepo]);

  const setActive = useCallback((id: ChatThreadId) => { setActiveId(id); setDraft(null); }, []);
  const startDraft = useCallback((modelId: string) => {
    setDraft({ tempId: `draft-${Date.now()}`, modelId });
    setActiveId(null);
  }, []);
  const clearDraft = useCallback(() => { setDraft(null); }, []);

  const persistDraft = useCallback(async (thread: ChatThread) => {
    await threadsRepo.upsert(thread);
    setList((prev) => [thread, ...prev.filter((t) => t.id !== thread.id)]);
    setActiveId(thread.id);
    setDraft(null);
  }, [threadsRepo]);

  const rename = useCallback(async (id: ChatThreadId, title: string) => {
    const before = list;
    const target = list.find((t) => t.id === id);
    if (!target) return;
    const updated = { ...target, title, updatedAt: new Date().toISOString() as ChatThread['updatedAt'] };
    setList((prev) => prev.map((t) => (t.id === id ? updated : t)));
    try {
      await threadsRepo.upsert(updated);
    } catch (e) {
      setList(before);
      throw e;
    }
  }, [list, threadsRepo]);

  const remove = useCallback(async (id: ChatThreadId) => {
    const before = list;
    setList((prev) => prev.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(before.find((t) => t.id !== id)?.id ?? null);
    try {
      if (messagesRepo) await messagesRepo.deleteByThread(id);
      await threadsRepo.delete(id);
    } catch (e) {
      setList(before);
      throw e;
    }
  }, [list, activeId, threadsRepo, messagesRepo]);

  return { list, activeId, draft, setActive, startDraft, clearDraft, rename, remove, persistDraft };
}
```

Run: `pnpm test src/features/ai/chat/useChatThreads.test.ts` → PASS.

- [ ] **Step 3: Implement `useChatMessages.ts` with stale-stream detection**

Test (`useChatMessages.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { openTestBookwormDB, closeTestDB } from '@/storage/test-helpers';
import { createChatMessagesRepository } from '@/storage/repositories/chatMessages';
import { useChatMessages } from './useChatMessages';
import { ChatMessageId, ChatThreadId } from '@/domain';

describe('useChatMessages', () => {
  let db: IDBPDatabase<BookwormDBSchema>;
  beforeEach(async () => { db = await openTestBookwormDB(); });
  afterEach(async () => { await closeTestDB(db); });

  it('loads messages for the thread oldest-first', async () => {
    const repo = createChatMessagesRepository(db);
    await repo.upsert({ id: ChatMessageId('m-2'), threadId: ChatThreadId('t-1'), role: 'assistant', content: 'b', contextRefs: [], createdAt: '2026-05-05T00:00:02.000Z' as never });
    await repo.upsert({ id: ChatMessageId('m-1'), threadId: ChatThreadId('t-1'), role: 'user', content: 'a', contextRefs: [], createdAt: '2026-05-05T00:00:01.000Z' as never });
    const { result } = renderHook(() => useChatMessages({ threadId: ChatThreadId('t-1'), messagesRepo: repo }));
    await waitFor(() => expect(result.current.list.length).toBe(2));
    expect(result.current.list.map((m) => m.id)).toEqual([ChatMessageId('m-1'), ChatMessageId('m-2')]);
  });

  it('on mount, marks orphaned streaming records as truncated+error', async () => {
    const repo = createChatMessagesRepository(db);
    const old = new Date(Date.now() - 60_000).toISOString();
    await repo.upsert({ id: ChatMessageId('m-stale'), threadId: ChatThreadId('t-1'), role: 'assistant', content: 'partial', contextRefs: [], streaming: true, createdAt: old as never });
    const { result } = renderHook(() => useChatMessages({ threadId: ChatThreadId('t-1'), messagesRepo: repo }));
    await waitFor(() => expect(result.current.list[0].streaming).not.toBe(true));
    expect(result.current.list[0].truncated).toBe(true);
    expect(result.current.list[0].error).toBe('interrupted');
  });

  it('append + finalize round-trip', async () => {
    const repo = createChatMessagesRepository(db);
    const { result } = renderHook(() => useChatMessages({ threadId: ChatThreadId('t-1'), messagesRepo: repo }));
    await waitFor(() => expect(result.current.list.length).toBe(0));
    await act(async () => {
      await result.current.append({ id: ChatMessageId('m-1'), threadId: ChatThreadId('t-1'), role: 'user', content: 'hi', contextRefs: [], createdAt: new Date().toISOString() as never });
    });
    expect(result.current.list.length).toBe(1);
    await act(async () => {
      await result.current.finalize(ChatMessageId('m-1'), { content: 'hi (final)' });
    });
    expect(result.current.list[0].content).toBe('hi (final)');
  });
});
```

Implementation (`useChatMessages.ts`):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessagesRepository } from '@/storage';
import type { ChatMessage, ChatMessageId, ChatThreadId } from '@/domain';

const STALE_THRESHOLD_MS = 30_000;
const PATCH_DEBOUNCE_MS = 80;

type Args = {
  readonly threadId: ChatThreadId;
  readonly messagesRepo: ChatMessagesRepository;
};

export type UseChatMessagesHandle = {
  readonly list: readonly ChatMessage[];
  readonly append: (msg: ChatMessage) => Promise<void>;
  readonly patch: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
  readonly finalize: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
};

export function useChatMessages({ threadId, messagesRepo }: Args): UseChatMessagesHandle {
  const [list, setList] = useState<readonly ChatMessage[]>([]);
  const debouncedTimers = useRef<Map<ChatMessageId, ReturnType<typeof setTimeout>>>(new Map());
  const pendingPatches = useRef<Map<ChatMessageId, Partial<ChatMessage>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await messagesRepo.getByThread(threadId);
      if (cancelled) return;
      const now = Date.now();
      const repaired: ChatMessage[] = [];
      for (const m of raw) {
        if (m.streaming === true && Date.parse(m.createdAt) < now - STALE_THRESHOLD_MS) {
          const fixed: ChatMessage = { ...m, streaming: false, truncated: true, error: 'interrupted' };
          await messagesRepo.upsert(fixed);
          repaired.push(fixed);
        } else {
          repaired.push(m);
        }
      }
      if (!cancelled) setList(repaired);
    })();
    return () => {
      cancelled = true;
      for (const t of debouncedTimers.current.values()) clearTimeout(t);
      debouncedTimers.current.clear();
      pendingPatches.current.clear();
    };
  }, [threadId, messagesRepo]);

  const append = useCallback(async (msg: ChatMessage) => {
    await messagesRepo.upsert(msg);
    setList((prev) => [...prev, msg]);
  }, [messagesRepo]);

  const flushPending = useCallback(async (id: ChatMessageId) => {
    const fields = pendingPatches.current.get(id);
    if (!fields) return;
    pendingPatches.current.delete(id);
    const target = listRef.current.find((m) => m.id === id);
    if (!target) return;
    const next = { ...target, ...fields };
    await messagesRepo.upsert(next);
    setList((prev) => prev.map((m) => (m.id === id ? next : m)));
  }, [messagesRepo]);

  // We need a ref to current list to read inside the debounced callback without
  // turning the whole hook into a render-per-tick.
  const listRef = useRef<readonly ChatMessage[]>(list);
  useEffect(() => { listRef.current = list; }, [list]);

  const patch = useCallback(async (id: ChatMessageId, fields: Partial<ChatMessage>) => {
    // Optimistic update for the UI; the IDB write is debounced.
    setList((prev) => prev.map((m) => (m.id === id ? { ...m, ...fields } : m)));
    pendingPatches.current.set(id, { ...(pendingPatches.current.get(id) ?? {}), ...fields });
    const existing = debouncedTimers.current.get(id);
    if (existing) clearTimeout(existing);
    debouncedTimers.current.set(id, setTimeout(() => {
      void flushPending(id);
      debouncedTimers.current.delete(id);
    }, PATCH_DEBOUNCE_MS));
  }, [flushPending]);

  const finalize = useCallback(async (id: ChatMessageId, fields: Partial<ChatMessage>) => {
    const t = debouncedTimers.current.get(id);
    if (t) clearTimeout(t);
    debouncedTimers.current.delete(id);
    pendingPatches.current.delete(id);

    setList((prev) => {
      const target = prev.find((m) => m.id === id);
      if (!target) return prev;
      const next = { ...target, ...fields };
      void messagesRepo.upsert(next);
      return prev.map((m) => (m.id === id ? next : m));
    });
  }, [messagesRepo]);

  return { list, append, patch, finalize };
}
```

Run: `pnpm test src/features/ai/chat/useChatMessages.test.ts` → PASS.

- [ ] **Step 4: Implement `useChatSend.ts`**

Test (`useChatSend.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatSend } from './useChatSend';
import type { StreamEvent } from './nanogptChat';
import { ChatThreadId } from '@/domain';

async function* mkStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of events) yield e;
}

describe('useChatSend', () => {
  it('sends, accumulates partial, finalizes', async () => {
    const append = vi.fn(async () => undefined);
    const patch = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);
    // Match `typeof streamChatCompletion`: (req: ChatCompletionRequest) => AsyncGenerator<StreamEvent>
    const streamFactory = (_req: import('./nanogptChat').ChatCompletionRequest) => mkStream([
      { kind: 'delta', text: 'hi ' },
      { kind: 'delta', text: 'there' },
      { kind: 'done' },
    ]);
    const { result } = renderHook(() => useChatSend({
      threadId: ChatThreadId('t-1'),
      modelId: 'gpt-x',
      getApiKey: () => 'sk',
      book: { title: 'X', format: 'epub' },
      history: [],
      append,
      patch,
      finalize,
      streamFactory,
    }));
    await act(async () => { result.current.send('hello'); });
    await waitFor(() => expect(finalize).toHaveBeenCalled());
    expect(append).toHaveBeenCalledTimes(2); // user + assistant placeholder
    expect(result.current.partial).toContain('hi ');
  });

  it('cancel transitions to aborted and finalizes truncated', async () => {
    const append = vi.fn(async () => undefined);
    const patch = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);
    let resolveSecond: () => void;
    const second = new Promise<void>((r) => { resolveSecond = r; });
    async function* slow(): AsyncGenerator<StreamEvent> {
      yield { kind: 'delta', text: 'partial' };
      await second;
      yield { kind: 'done' };
    }
    const { result } = renderHook(() => useChatSend({
      threadId: ChatThreadId('t-1'),
      modelId: 'gpt-x',
      getApiKey: () => 'sk',
      book: { title: 'X', format: 'epub' },
      history: [],
      append,
      patch,
      finalize,
      streamFactory: (_req: import('./nanogptChat').ChatCompletionRequest) => slow(),
    }));
    await act(async () => { result.current.send('hello'); });
    await waitFor(() => expect(result.current.state).toBe('streaming'));
    act(() => { result.current.cancel(); });
    resolveSecond!();
    await waitFor(() => expect(result.current.state).toBe('aborted'));
    expect(finalize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ truncated: true }));
  });
});
```

Implementation (`useChatSend.ts`):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { createActor } from 'xstate';
import type { BookFormat, ChatMessage, ChatMessageId, ChatThreadId, TokenUsage } from '@/domain';
import { ChatMessageId as makeChatMessageId } from '@/domain';
import { assembleOpenChatPrompt } from './promptAssembly';
import { streamChatCompletion, type ChatCompletionFailure, type StreamEvent } from './nanogptChat';
import { makeChatRequestMachine } from './chatRequestMachine';

type SendState = 'idle' | 'sending' | 'streaming' | 'error' | 'aborted';

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
};

export type UseChatSendHandle = {
  readonly state: SendState;
  readonly partial: string;
  readonly failure: ChatCompletionFailure | null;
  readonly send: (userText: string) => void;
  readonly cancel: () => void;
  readonly retry: () => void;
};

function nextId(prefix: string): ChatMessageId {
  return makeChatMessageId(`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

export function useChatSend(args: Args): UseChatSendHandle {
  const [state, setState] = useState<SendState>('idle');
  const [partial, setPartial] = useState('');
  const [failure, setFailure] = useState<ChatCompletionFailure | null>(null);
  const actorRef = useRef<ReturnType<typeof createActor> | null>(null);
  const lastInputRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    actorRef.current?.stop();
    actorRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const send = useCallback((userText: string) => {
    const apiKey = args.getApiKey();
    if (!apiKey) {
      setFailure({ reason: 'invalid-key', status: 401 });
      setState('error');
      return;
    }
    lastInputRef.current = userText;
    const userMsgId = nextId('u');
    const assistantMsgId = nextId('a');
    const now = new Date().toISOString();

    void args.append({
      id: userMsgId,
      threadId: args.threadId,
      role: 'user',
      content: userText,
      mode: 'open',
      contextRefs: [],
      createdAt: now as ChatMessage['createdAt'],
    });
    void args.append({
      id: assistantMsgId,
      threadId: args.threadId,
      role: 'assistant',
      content: '',
      mode: 'open',
      contextRefs: [],
      streaming: true,
      createdAt: new Date(Date.now() + 1).toISOString() as ChatMessage['createdAt'],
    });

    const assembled = assembleOpenChatPrompt({
      book: args.book,
      history: args.history,
      newUserText: userText,
    });

    const machine = makeChatRequestMachine({
      streamFactory: (a, modelId, signal) =>
        (args.streamFactory ?? streamChatCompletion)({
          apiKey,
          modelId,
          messages: a.messages,
          signal,
        }),
      onDelta: async (id, fields) => {
        setPartial(fields.content);
        await args.patch(id, fields);
      },
      finalize: async (id, fields) => {
        await args.finalize(id, fields);
      },
    });

    const actor = createActor(machine, {
      input: {
        threadId: args.threadId,
        pendingUserMessageId: userMsgId,
        pendingAssistantMessageId: assistantMsgId,
        modelId: args.modelId,
        assembled,
      },
    });

    actor.subscribe((snap) => {
      if (snap.status === 'done') {
        const out = (snap as unknown as { output?: { failure?: ChatCompletionFailure; aborted?: boolean } }).output;
        if (out?.failure) { setFailure(out.failure); setState('error'); }
        else if (out?.aborted) { setState('aborted'); }
        else { setState('idle'); }
      }
    });

    actorRef.current = actor;
    setState('streaming');
    setPartial('');
    setFailure(null);
    actor.start();
  }, [args]);

  const cancel = useCallback(() => {
    actorRef.current?.send({ type: 'CANCEL' });
  }, []);

  const retry = useCallback(() => {
    if (lastInputRef.current !== null) send(lastInputRef.current);
  }, [send]);

  return { state, partial, failure, send, cancel, retry };
}
```

Run: `pnpm test src/features/ai/chat/useChatSend.test.ts` → PASS.

- [ ] **Step 5: Implement `useSavedAnswers.ts`**

Test (`useSavedAnswers.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { IDBPDatabase } from 'idb';
import type { BookwormDBSchema } from '@/storage/db/schema';
import { openTestBookwormDB, closeTestDB } from '@/storage/test-helpers';
import { createSavedAnswersRepository } from '@/storage/repositories/savedAnswers';
import { useSavedAnswers } from './useSavedAnswers';
import { BookId, ChatMessageId, ChatThreadId, SavedAnswerId } from '@/domain';

describe('useSavedAnswers', () => {
  let db: IDBPDatabase<BookwormDBSchema>;
  beforeEach(async () => { db = await openTestBookwormDB(); });
  afterEach(async () => { await closeTestDB(db); });

  it('loads existing saved answers for the book newest-first', async () => {
    const repo = createSavedAnswersRepository(db);
    await repo.upsert({
      id: SavedAnswerId('s-old'), bookId: BookId('b'), threadId: ChatThreadId('t'),
      messageId: ChatMessageId('m-1'), modelId: 'gpt-x', mode: 'open',
      content: 'old', question: 'q', contextRefs: [],
      createdAt: '2026-05-04T00:00:00.000Z' as never,
    });
    await repo.upsert({
      id: SavedAnswerId('s-new'), bookId: BookId('b'), threadId: ChatThreadId('t'),
      messageId: ChatMessageId('m-2'), modelId: 'gpt-x', mode: 'open',
      content: 'new', question: 'q', contextRefs: [],
      createdAt: '2026-05-05T00:00:00.000Z' as never,
    });
    const { result } = renderHook(() => useSavedAnswers({ bookId: BookId('b'), savedAnswersRepo: repo }));
    await waitFor(() => expect(result.current.list.length).toBe(2));
    expect(result.current.list[0].id).toBe(SavedAnswerId('s-new'));
  });

  it('add appends and persists', async () => {
    const repo = createSavedAnswersRepository(db);
    const { result } = renderHook(() => useSavedAnswers({ bookId: BookId('b'), savedAnswersRepo: repo }));
    await waitFor(() => expect(result.current.list.length).toBe(0));
    await act(async () => {
      await result.current.add({
        threadId: ChatThreadId('t'), messageId: ChatMessageId('m'),
        modelId: 'gpt-x', mode: 'open', content: 'a', question: 'q', contextRefs: [],
      });
    });
    expect(result.current.list.length).toBe(1);
    expect((await repo.getByBook(BookId('b'))).length).toBe(1);
  });
});
```

Implementation (`useSavedAnswers.ts`):

```ts
import { useCallback, useEffect, useState } from 'react';
import type { SavedAnswersRepository } from '@/storage';
import type { BookId, SavedAnswer, SavedAnswerId } from '@/domain';
import { SavedAnswerId as makeSavedAnswerId } from '@/domain';

type Args = {
  readonly bookId: BookId;
  readonly savedAnswersRepo: SavedAnswersRepository;
};

type AddInput = Omit<SavedAnswer, 'id' | 'bookId' | 'createdAt'>;

export type UseSavedAnswersHandle = {
  readonly list: readonly SavedAnswer[];
  readonly add: (input: AddInput) => Promise<SavedAnswer>;
  readonly remove: (id: SavedAnswerId) => Promise<void>;
  readonly update: (id: SavedAnswerId, fields: Partial<SavedAnswer>) => Promise<void>;
};

export function useSavedAnswers({ bookId, savedAnswersRepo }: Args): UseSavedAnswersHandle {
  const [list, setList] = useState<readonly SavedAnswer[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await savedAnswersRepo.getByBook(bookId);
      if (!cancelled) setList(raw);
    })();
    return () => { cancelled = true; };
  }, [bookId, savedAnswersRepo]);

  const add = useCallback(async (input: AddInput): Promise<SavedAnswer> => {
    const saved: SavedAnswer = {
      id: makeSavedAnswerId(`s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      bookId,
      ...input,
      createdAt: new Date().toISOString() as SavedAnswer['createdAt'],
    };
    await savedAnswersRepo.upsert(saved);
    setList((prev) => [saved, ...prev]);
    return saved;
  }, [bookId, savedAnswersRepo]);

  const remove = useCallback(async (id: SavedAnswerId) => {
    const before = list;
    setList((prev) => prev.filter((s) => s.id !== id));
    try {
      await savedAnswersRepo.delete(id);
    } catch (e) {
      setList(before);
      throw e;
    }
  }, [list, savedAnswersRepo]);

  const update = useCallback(async (id: SavedAnswerId, fields: Partial<SavedAnswer>) => {
    const before = list;
    const target = list.find((s) => s.id === id);
    if (!target) return;
    const next = { ...target, ...fields };
    setList((prev) => prev.map((s) => (s.id === id ? next : s)));
    try {
      await savedAnswersRepo.upsert(next);
    } catch (e) {
      setList(before);
      throw e;
    }
  }, [list, savedAnswersRepo]);

  return { list, add, remove, update };
}
```

Run: `pnpm test src/features/ai/chat/useSavedAnswers.test.ts` → PASS.

- [ ] **Step 6: Add the chat barrel `index.ts`**

```ts
// src/features/ai/chat/index.ts
export { parseSSE } from './parseSSE';
export type { ParsedSSEEvent, SSEParseResult } from './parseSSE';
export { streamChatCompletion } from './nanogptChat';
export type {
  ChatCompletionFailure,
  ChatCompletionMessage,
  ChatCompletionRequest,
  StreamEvent,
} from './nanogptChat';
export { assembleOpenChatPrompt, buildOpenModeSystemPrompt, HISTORY_SOFT_CAP } from './promptAssembly';
export { makeChatRequestMachine } from './chatRequestMachine';
export { useChatThreads } from './useChatThreads';
export type { UseChatThreadsHandle } from './useChatThreads';
export { useChatMessages } from './useChatMessages';
export type { UseChatMessagesHandle } from './useChatMessages';
export { useChatSend } from './useChatSend';
export type { UseChatSendHandle } from './useChatSend';
export { useSavedAnswers } from './useSavedAnswers';
export type { UseSavedAnswersHandle } from './useSavedAnswers';
```

- [ ] **Step 7: Verify**

```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/ai/chat/useChatThreads.ts src/features/ai/chat/useChatThreads.test.ts \
        src/features/ai/chat/useChatMessages.ts src/features/ai/chat/useChatMessages.test.ts \
        src/features/ai/chat/useChatSend.ts src/features/ai/chat/useChatSend.test.ts \
        src/features/ai/chat/useSavedAnswers.ts src/features/ai/chat/useSavedAnswers.test.ts \
        src/features/ai/chat/index.ts
git commit -m "feat(ai): useChatThreads / useChatMessages / useChatSend / useSavedAnswers hooks"
```

---

### Task 10: Icons — `ChatIcon`, `SendIcon`, `StopIcon`, `SaveAnswerIcon`

**Files:**
- Create: `src/shared/icons/ChatIcon.tsx`
- Create: `src/shared/icons/SendIcon.tsx`
- Create: `src/shared/icons/StopIcon.tsx`
- Create: `src/shared/icons/SaveAnswerIcon.tsx`
- Modify: `src/shared/icons/index.ts` (barrel re-exports)

> **Strategy:** Match the Phase 3.4 set (`NotebookIcon`, `NoteIcon`, `ArrowLeftIcon`). Monochrome SVG, 16px default, 1.5px stroke, `currentColor`. ~30 LoC each.

- [ ] **Step 1: Read the canonical icon shape**

Open `src/shared/icons/NotebookIcon.tsx` and `src/shared/icons/ArrowLeftIcon.tsx`. Note the props shape (`{ size?, className?, ariaLabel? }` or similar) and the SVG attributes used.

- [ ] **Step 2: Create `ChatIcon.tsx`**

A speech-bubble glyph:

```tsx
type Props = { readonly size?: number; readonly className?: string; readonly 'aria-hidden'?: boolean };

export function ChatIcon({ size = 16, className, ...rest }: Props) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" className={className} {...rest}
    >
      <path
        d="M2.5 4.5C2.5 3.395 3.395 2.5 4.5 2.5h7c1.105 0 2 .895 2 2v5c0 1.105-.895 2-2 2H7l-3 2.5v-2.5h-.5a1 1 0 0 1-1-1v-6Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
    </svg>
  );
}
```

(Match the prop type and export shape used by `NotebookIcon` exactly — if it accepts `aria-label` instead of `ariaLabel`, do the same.)

- [ ] **Step 3: Create `SendIcon.tsx`**

A paper-plane glyph:

```tsx
type Props = { readonly size?: number; readonly className?: string };
export function SendIcon({ size = 16, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M14 2 1.5 8l5 1.5L8 14l6-12Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 9.5 14 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 4: Create `StopIcon.tsx`**

A filled square (matches "stop streaming" affordance):

```tsx
type Props = { readonly size?: number; readonly className?: string };
export function StopIcon({ size = 16, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 5: Create `SaveAnswerIcon.tsx`**

A bookmark + sparkle (suggesting AI):

```tsx
type Props = { readonly size?: number; readonly className?: string };
export function SaveAnswerIcon({ size = 16, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2.5h7v11l-3.5-2.5L4 13.5v-11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12.5 5.5v3M11 7h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 6: Add to `src/shared/icons/index.ts`**

```ts
export { ChatIcon } from './ChatIcon';
export { SendIcon } from './SendIcon';
export { StopIcon } from './StopIcon';
export { SaveAnswerIcon } from './SaveAnswerIcon';
```

- [ ] **Step 7: Verify type-check + visual smoke (Storybook not used; render in a test)**

```bash
pnpm type-check && pnpm lint
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/icons/ChatIcon.tsx src/shared/icons/SendIcon.tsx src/shared/icons/StopIcon.tsx src/shared/icons/SaveAnswerIcon.tsx src/shared/icons/index.ts
git commit -m "feat(icons): ChatIcon, SendIcon, StopIcon, SaveAnswerIcon"
```

---

### Task 11: Reader workspace — `useRightRailVisibility` hook + persistence

**Files:**
- Create: `src/features/reader/workspace/useRightRailVisibility.ts`
- Create: `src/features/reader/workspace/useRightRailVisibility.test.ts`

> **Strategy:** Mirror the existing `useFocusMode` shape exactly. Boolean state; toggle persists via the provided `onChange`.

- [ ] **Step 1: Read `useFocusMode.ts` for the precedent**

```bash
sed -n '1,60p' src/features/reader/workspace/useFocusMode.ts
```

Note the exact prop names, default behavior, and persistence call pattern.

- [ ] **Step 2: Write the test**

```ts
// useRightRailVisibility.test.ts
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRightRailVisibility } from './useRightRailVisibility';

describe('useRightRailVisibility', () => {
  it('initializes from initial value', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRightRailVisibility({ initial: false, onChange }),
    );
    expect(result.current.visible).toBe(false);
  });

  it('toggle flips state and calls onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRightRailVisibility({ initial: true, onChange }),
    );
    act(() => { result.current.toggle(); });
    expect(result.current.visible).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('set explicitly assigns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRightRailVisibility({ initial: false, onChange }),
    );
    act(() => { result.current.set(true); });
    expect(result.current.visible).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Implement**

```ts
import { useCallback, useState } from 'react';

type Args = {
  readonly initial: boolean;
  readonly onChange: (visible: boolean) => void;
};

export type UseRightRailVisibilityHandle = {
  readonly visible: boolean;
  readonly toggle: () => void;
  readonly set: (next: boolean) => void;
};

export function useRightRailVisibility({ initial, onChange }: Args): UseRightRailVisibilityHandle {
  const [visible, setVisible] = useState<boolean>(initial);
  const toggle = useCallback(() => {
    setVisible((prev) => {
      const next = !prev;
      onChange(next);
      return next;
    });
  }, [onChange]);
  const set = useCallback((next: boolean) => {
    setVisible(next);
    onChange(next);
  }, [onChange]);
  return { visible, toggle, set };
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm test src/features/reader/workspace/useRightRailVisibility.test.ts
git add src/features/reader/workspace/useRightRailVisibility.ts src/features/reader/workspace/useRightRailVisibility.test.ts
git commit -m "feat(reader): useRightRailVisibility hook + persistence"
```

---

### Task 12: Reader workspace — `RightRail` + `RightRailCollapsedTab` + workspace integration

**Files:**
- Create: `src/features/reader/workspace/RightRail.tsx` (+ test)
- Create: `src/features/reader/workspace/RightRailCollapsedTab.tsx` (+ test)
- Create: `src/features/reader/workspace/right-rail.css`
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx` (mount the rail / collapsed tab)
- Modify: `src/features/reader/workspace/MobileSheet.tsx` (add `chat` tab slot)
- Modify: `src/features/reader/workspace/workspace.css` (three-pane grid adjustment)

> **Strategy:** This task adds the *container* only — `ChatPanel` itself ships in Tasks 13–20 and is rendered as a child later. For now, render a placeholder with the chat icon and a rail-ready empty area so the layout can be visually verified. The placeholder will be replaced in Task 20 with the real `<ChatPanel … />`.

- [ ] **Step 1: Implement `RightRail.tsx` shell**

```tsx
// src/features/reader/workspace/RightRail.tsx
import './right-rail.css';

type Props = {
  readonly onCollapse: () => void;
  readonly children?: React.ReactNode;
  readonly title?: string;
};

export function RightRail({ onCollapse, children, title = 'Chat' }: Props) {
  return (
    <aside className="right-rail" aria-label={title}>
      <header className="right-rail__header">
        <span className="right-rail__title">{title}</span>
        <button
          type="button"
          className="right-rail__collapse"
          aria-expanded={true}
          aria-label="Collapse chat panel"
          onClick={onCollapse}
        >
          ›
        </button>
      </header>
      <div className="right-rail__body">{children}</div>
    </aside>
  );
}
```

- [ ] **Step 2: Implement `RightRailCollapsedTab.tsx`**

```tsx
import { ChatIcon } from '@/shared/icons';
import './right-rail.css';

type Props = {
  readonly onExpand: () => void;
  readonly hasUnread?: boolean;
};

export function RightRailCollapsedTab({ onExpand, hasUnread }: Props) {
  return (
    <button
      type="button"
      className="right-rail__edge-tab"
      aria-expanded={false}
      aria-label="Expand chat panel"
      onClick={onExpand}
    >
      <ChatIcon size={16} />
      {hasUnread ? <span className="right-rail__edge-dot" aria-hidden="true" /> : null}
    </button>
  );
}
```

- [ ] **Step 3: Style `right-rail.css`**

Use existing tokens (`--surface`, `--border`, `--accent`, `--shadow-velvet`, etc.). Width 360px. The grid adjustment lives in `workspace.css` — use `display: grid; grid-template-columns: 320px 1fr 360px` when rail visible, `... 1fr 28px` when collapsed.

```css
.right-rail {
  background: var(--surface-elevated);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}
.right-rail__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}
.right-rail__title { font-weight: 600; }
.right-rail__collapse {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  color: var(--text-muted);
}
.right-rail__body { flex: 1 1 auto; overflow: hidden; }
.right-rail__edge-tab {
  width: 28px;
  height: 100%;
  background: var(--surface-elevated);
  border-left: 1px solid var(--border-subtle);
  border-right: none;
  border-top: none;
  border-bottom: none;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
}
.right-rail__edge-dot {
  position: absolute;
  top: 18px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
```

- [ ] **Step 4: Wire into `ReaderWorkspace.tsx`**

Add `useRightRailVisibility` and props for it (`initialRightRailVisible: boolean`, `onRightRailVisibilityChange: (v: boolean) => void`). Render either `<RightRail>` or `<RightRailCollapsedTab>` as a sibling of `ReaderView`. For now, the rail body is a placeholder (`<div className="right-rail__placeholder">Chat coming next…</div>`) — Task 20 swaps in the real `ChatPanel`.

Adjust the workspace's grid layout so the third column appears when visible.

Hide both elements while `focus.mode === 'focus'`.

- [ ] **Step 5: Add `chat` tab to `MobileSheet.tsx`**

`MobileSheet` already accepts a `tabs: { key, label, badge?, content }[]` style prop (verify by reading the file). Add a `chat` tab in `ReaderWorkspace.tsx` with placeholder content. Real content lands in Task 20.

- [ ] **Step 6: Smoke-test in dev**

```bash
pnpm dev
```
Open a book; toggle the rail; verify the layout adjusts; verify the placeholder is visible; verify focus mode hides the rail.

- [ ] **Step 7: Add component tests**

```ts
// RightRail.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { RightRail } from './RightRail';

describe('RightRail', () => {
  it('renders title and body', () => {
    render(<RightRail onCollapse={() => undefined} title="Chat">body</RightRail>);
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('calls onCollapse when collapse button clicked', async () => {
    const onCollapse = vi.fn();
    render(<RightRail onCollapse={onCollapse}>x</RightRail>);
    await userEvent.click(screen.getByLabelText('Collapse chat panel'));
    expect(onCollapse).toHaveBeenCalled();
  });
});
```

```ts
// RightRailCollapsedTab.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { RightRailCollapsedTab } from './RightRailCollapsedTab';

describe('RightRailCollapsedTab', () => {
  it('shows unread dot when flagged', () => {
    const { container } = render(<RightRailCollapsedTab onExpand={() => undefined} hasUnread />);
    expect(container.querySelector('.right-rail__edge-dot')).toBeInTheDocument();
  });
  it('calls onExpand when clicked', async () => {
    const onExpand = vi.fn();
    render(<RightRailCollapsedTab onExpand={onExpand} />);
    await userEvent.click(screen.getByLabelText('Expand chat panel'));
    expect(onExpand).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Verify**

```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/reader/workspace/RightRail.tsx src/features/reader/workspace/RightRail.test.tsx \
        src/features/reader/workspace/RightRailCollapsedTab.tsx src/features/reader/workspace/RightRailCollapsedTab.test.tsx \
        src/features/reader/workspace/right-rail.css \
        src/features/reader/workspace/ReaderWorkspace.tsx \
        src/features/reader/workspace/MobileSheet.tsx \
        src/features/reader/workspace/workspace.css
git commit -m "feat(reader): RightRail + RightRailCollapsedTab — workspace integration (placeholder body)"
```

---

### Task 13: Chat — `ChatEmptyState` (no-key / no-model / no-threads variants)

**Files:**
- Create: `src/features/ai/chat/ChatEmptyState.tsx`
- Create: `src/features/ai/chat/ChatEmptyState.test.tsx`

> **Strategy:** Pure presentational; props decide which variant. No store consumption inside the component — caller picks variant by precedence (`no-key → no-model → no-threads`).

- [ ] **Step 1: Test (`ChatEmptyState.test.tsx`)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatEmptyState } from './ChatEmptyState';

describe('ChatEmptyState', () => {
  it('no-key variant invites user to settings', async () => {
    const onOpenSettings = vi.fn();
    render(<ChatEmptyState variant="no-key" onOpenSettings={onOpenSettings} bookTitle="X" />);
    expect(screen.getByText(/api key/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
  it('no-model variant invites user to choose a model', async () => {
    const onOpenSettings = vi.fn();
    render(<ChatEmptyState variant="no-model" onOpenSettings={onOpenSettings} bookTitle="X" />);
    expect(screen.getByText(/choose a model/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
  it('no-threads variant invites user to start a conversation', async () => {
    const onStart = vi.fn();
    render(<ChatEmptyState variant="no-threads" onStartDraft={onStart} bookTitle="Moby-Dick" />);
    expect(screen.getByText(/Moby-Dick/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    expect(onStart).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
type Variant = 'no-key' | 'no-model' | 'no-threads';
type Props =
  | { readonly variant: 'no-key'; readonly onOpenSettings: () => void; readonly bookTitle: string }
  | { readonly variant: 'no-model'; readonly onOpenSettings: () => void; readonly bookTitle: string }
  | { readonly variant: 'no-threads'; readonly onStartDraft: () => void; readonly bookTitle: string };

export function ChatEmptyState(props: Props) {
  if (props.variant === 'no-key') {
    return (
      <div className="chat-empty">
        <p>Set up your API key to start chatting about this book.</p>
        <button type="button" onClick={props.onOpenSettings}>Open Settings</button>
      </div>
    );
  }
  if (props.variant === 'no-model') {
    return (
      <div className="chat-empty">
        <p>Choose a model in Settings to start chatting.</p>
        <button type="button" onClick={props.onOpenSettings}>Open Settings</button>
      </div>
    );
  }
  return (
    <div className="chat-empty">
      <p>Ask anything about <em>{props.bookTitle}</em>.</p>
      <button type="button" onClick={props.onStartDraft}>Start a conversation</button>
    </div>
  );
}
```

(Style with shared empty-state tokens; live in `chat-panel.css` from Task 20 or its own file. Inline minimal styles via class names; CSS lands in Task 20.)

- [ ] **Step 3: Run + commit**

```bash
pnpm test src/features/ai/chat/ChatEmptyState.test.tsx
git add src/features/ai/chat/ChatEmptyState.tsx src/features/ai/chat/ChatEmptyState.test.tsx
git commit -m "feat(chat): ChatEmptyState (no-key / no-model / no-threads variants)"
```

---

### Task 14: Chat — `MessageBubble` + `ChatErrorBubble`

**Files:**
- Create: `src/features/ai/chat/MessageBubble.tsx` (+ test)
- Create: `src/features/ai/chat/ChatErrorBubble.tsx` (+ test)
- Create: `src/features/ai/chat/message-bubble.css`

> **Strategy:** Pure presentational. `MessageBubble` discriminates on `message.role` + transient flags. `ChatErrorBubble` discriminates on `failure.reason`. `[Save]` button is a callback prop (the `SaveAnswerInline` integration lands in Task 19; for now the prop is wired through but its body is a no-op the test asserts).

- [ ] **Step 1: Implement `MessageBubble.tsx`**

```tsx
import type { ChatMessage } from '@/domain';
import { SaveAnswerIcon } from '@/shared/icons';
import './message-bubble.css';

type Props = {
  readonly message: ChatMessage;
  readonly onSave?: (id: ChatMessage['id']) => void;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function MessageBubble({ message, onSave }: Props) {
  if (message.role === 'user') {
    return (
      <div className="message-bubble message-bubble--user" role="article">
        <p className="message-bubble__content">{message.content}</p>
      </div>
    );
  }
  const isStreaming = message.streaming === true;
  const isTruncated = message.truncated === true;
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
        {!isStreaming && onSave ? (
          <button
            type="button"
            className="message-bubble__save"
            aria-label="Save answer"
            onClick={() => onSave(message.id)}
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

Test (`MessageBubble.test.tsx`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId } from '@/domain';

function mk(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ChatMessageId('m'), threadId: ChatThreadId('t'), role: 'assistant',
    content: 'hello', contextRefs: [],
    createdAt: new Date().toISOString() as ChatMessage['createdAt'],
    ...overrides,
  };
}

describe('MessageBubble', () => {
  it('renders user message right-aligned, no save', () => {
    const { container } = render(<MessageBubble message={mk({ role: 'user', content: 'hi' })} />);
    expect(container.querySelector('.message-bubble--user')).toBeInTheDocument();
    expect(screen.queryByLabelText('Save answer')).toBeNull();
  });

  it('renders assistant with AI badge and Save', async () => {
    const onSave = vi.fn();
    render(<MessageBubble message={mk()} onSave={onSave} />);
    expect(screen.getByLabelText('AI generated')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Save answer'));
    expect(onSave).toHaveBeenCalled();
  });

  it('shows streaming caret and hides Save while streaming', () => {
    const { container } = render(<MessageBubble message={mk({ streaming: true })} onSave={() => undefined} />);
    expect(container.querySelector('.message-bubble__caret')).toBeInTheDocument();
    expect(screen.queryByLabelText('Save answer')).toBeNull();
  });

  it('shows (stopped) when truncated', () => {
    render(<MessageBubble message={mk({ truncated: true })} />);
    expect(screen.getByText('(stopped)')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `ChatErrorBubble.tsx`**

```tsx
import type { ChatCompletionFailure } from './nanogptChat';
import './message-bubble.css';

type Props = {
  readonly failure: ChatCompletionFailure;
  readonly onRetry?: () => void;
  readonly onSwitchModel?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onDismiss?: () => void;
};

function copy(failure: ChatCompletionFailure): string {
  switch (failure.reason) {
    case 'invalid-key': return 'Your API key was rejected. Update it in Settings.';
    case 'rate-limit': return 'Rate limited by NanoGPT. Try again in a moment.';
    case 'model-unavailable': return "The selected model isn't available. Choose another.";
    case 'network': return 'No connection.';
    case 'server': return `NanoGPT had an issue (status ${failure.status}). Try again.`;
    case 'malformed-stream': return "The response stream couldn't be parsed. Try again.";
    case 'aborted': return 'Cancelled.';
  }
}

export function ChatErrorBubble({ failure, onRetry, onSwitchModel, onOpenSettings, onDismiss }: Props) {
  return (
    <div className="message-bubble message-bubble--error" role="alert">
      <p className="message-bubble__content">{copy(failure)}</p>
      <div className="message-bubble__footer">
        {failure.reason === 'invalid-key' && onOpenSettings ? (
          <button type="button" onClick={onOpenSettings}>Open Settings</button>
        ) : null}
        {(failure.reason === 'rate-limit' || failure.reason === 'network'
          || failure.reason === 'server' || failure.reason === 'malformed-stream') && onRetry ? (
          <button type="button" onClick={onRetry}>Retry</button>
        ) : null}
        {(failure.reason === 'model-unavailable' || failure.reason === 'server') && onSwitchModel ? (
          <button type="button" onClick={onSwitchModel}>Switch Model</button>
        ) : null}
        {onDismiss ? (
          <button type="button" aria-label="Dismiss" onClick={onDismiss}>×</button>
        ) : null}
      </div>
    </div>
  );
}
```

Test (`ChatErrorBubble.test.tsx`): one test per `reason` confirming the right buttons appear and call the right callback. Use the same `userEvent` pattern.

- [ ] **Step 3: Style `message-bubble.css`** (use existing tokens)

```css
.message-bubble { padding: 0.6rem 0.85rem; border-radius: 10px; max-width: 78%; margin: 0.4rem 0; }
.message-bubble--user {
  align-self: flex-end;
  background: color-mix(in oklab, var(--accent) 14%, var(--surface));
}
.message-bubble--assistant {
  align-self: flex-start;
  background: var(--surface-elevated);
  border: 1px solid var(--border-subtle);
}
.message-bubble--error {
  align-self: flex-start;
  background: color-mix(in oklab, var(--danger) 8%, var(--surface));
  border: 1px solid color-mix(in oklab, var(--danger) 40%, var(--border-subtle));
}
.message-bubble__caret {
  display: inline-block;
  width: 4px;
  height: 1em;
  background: currentColor;
  margin-left: 2px;
  vertical-align: text-bottom;
  opacity: 0.4;
  animation: bubble-caret 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .message-bubble__caret { animation: none; opacity: 0.7; }
}
@keyframes bubble-caret {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1.0; }
}
.message-bubble__footer { display: flex; gap: 0.6rem; align-items: center; margin-top: 0.4rem; font-size: 0.75rem; color: var(--text-muted); }
.message-bubble__badge { font-size: 0.65rem; padding: 0 0.35rem; border-radius: 3px; background: var(--surface); border: 1px solid var(--border-subtle); }
.message-bubble__save { display: inline-flex; align-items: center; gap: 0.25rem; background: transparent; border: none; cursor: pointer; color: var(--text-muted); padding: 0; }
.message-bubble__save:hover { color: var(--text); }
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test src/features/ai/chat/MessageBubble.test.tsx src/features/ai/chat/ChatErrorBubble.test.tsx
git add src/features/ai/chat/MessageBubble.tsx src/features/ai/chat/MessageBubble.test.tsx \
        src/features/ai/chat/ChatErrorBubble.tsx src/features/ai/chat/ChatErrorBubble.test.tsx \
        src/features/ai/chat/message-bubble.css
git commit -m "feat(chat): MessageBubble + ChatErrorBubble + streaming caret"
```

---

### Task 15: Chat — `MessageList` (auto-scroll-near-bottom)

**Files:**
- Create: `src/features/ai/chat/MessageList.tsx` (+ test)

> **Strategy:** Scroll container + role=log + aria-live=polite. Auto-scroll to bottom only when user is within 80px of the bottom; otherwise leave their scroll position alone. Honors `prefers-reduced-motion` (still scrolls; just no smooth-behavior).

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/domain';
import { MessageBubble } from './MessageBubble';
import { ChatErrorBubble } from './ChatErrorBubble';
import type { ChatCompletionFailure } from './nanogptChat';

const STICK_THRESHOLD_PX = 80;

type Props = {
  readonly messages: readonly ChatMessage[];
  readonly failure?: ChatCompletionFailure | null;
  readonly onSaveMessage?: (id: ChatMessage['id']) => void;
  readonly onRetry?: () => void;
  readonly onSwitchModel?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onDismissError?: () => void;
};

export function MessageList({ messages, failure, onSaveMessage, onRetry, onSwitchModel, onOpenSettings, onDismissError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    if (!ref.current) return;
    if (stickToBottom) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages, failure, stickToBottom]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    setStickToBottom(fromBottom <= STICK_THRESHOLD_PX);
  };

  return (
    <div
      ref={ref}
      className="message-list"
      role="log"
      aria-live="polite"
      onScroll={onScroll}
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} {...(onSaveMessage ? { onSave: onSaveMessage } : {})} />
      ))}
      {failure ? (
        <ChatErrorBubble
          failure={failure}
          {...(onRetry ? { onRetry } : {})}
          {...(onSwitchModel ? { onSwitchModel } : {})}
          {...(onOpenSettings ? { onOpenSettings } : {})}
          {...(onDismissError ? { onDismiss: onDismissError } : {})}
        />
      ) : null}
    </div>
  );
}
```

Test: render with N bubbles + observe scrollTop progression after appending. Use `Object.defineProperty` to mock `scrollHeight`/`clientHeight`/`scrollTop` on the element, since happy-dom doesn't compute layout.

- [ ] **Step 2: Run + commit**

```bash
pnpm test src/features/ai/chat/MessageList.test.tsx
git add src/features/ai/chat/MessageList.tsx src/features/ai/chat/MessageList.test.tsx
git commit -m "feat(chat): MessageList — auto-scroll-near-bottom"
```

---

### Task 16: Chat — `ChatHeader` + `ThreadList`

**Files:**
- Create: `src/features/ai/chat/ChatHeader.tsx` (+ test)
- Create: `src/features/ai/chat/ThreadList.tsx` (+ test)
- Create: `src/features/ai/chat/thread-list.css`

> **Strategy:** Header shows current thread title + "+" button + collapse "›". Click on title opens a `ThreadList` overlay (ARIA combobox+listbox). Each row: title, relative time, hover-revealed delete. Keyboard: Up/Down navigate, Enter selects, Esc closes.

- [ ] **Step 1: Implement `ThreadList.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ChatThread, ChatThreadId } from '@/domain';
import './thread-list.css';

type Props = {
  readonly threads: readonly ChatThread[];
  readonly activeId: ChatThreadId | null;
  readonly onSelect: (id: ChatThreadId) => void;
  readonly onRename: (id: ChatThreadId, title: string) => void;
  readonly onDelete: (id: ChatThreadId) => void;
  readonly onClose: () => void;
};

export function ThreadList({ threads, activeId, onSelect, onRename, onDelete, onClose }: Props) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [editing, setEditing] = useState<ChatThreadId | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((i) => Math.min(threads.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter') {
        const t = threads[focusIdx];
        if (t) onSelect(t.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusIdx, threads, onSelect, onClose]);

  return (
    <div ref={ref} className="thread-list" role="listbox" aria-label="Conversations">
      {threads.length === 0 ? (
        <p className="thread-list__empty">No conversations yet.</p>
      ) : (
        threads.map((t, i) => (
          <div
            key={t.id}
            role="option"
            aria-selected={t.id === activeId}
            className={`thread-list__row ${i === focusIdx ? 'thread-list__row--focus' : ''}`}
            onClick={() => onSelect(t.id)}
          >
            {editing === t.id ? (
              <input
                autoFocus
                className="thread-list__edit"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.currentTarget.value)}
                onBlur={() => { onRename(t.id, draftTitle.trim() || t.title); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setEditing(null); } }}
              />
            ) : (
              <button
                type="button"
                className="thread-list__title"
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(t.id); setDraftTitle(t.title); }}
              >
                {t.title}
              </button>
            )}
            <button
              type="button"
              className="thread-list__delete"
              aria-label={`Delete conversation ${t.title}`}
              onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `ChatHeader.tsx`**

```tsx
import { useState } from 'react';
import type { ChatThread, ChatThreadId } from '@/domain';
import { ThreadList } from './ThreadList';

type Props = {
  readonly threads: readonly ChatThread[];
  readonly activeId: ChatThreadId | null;
  readonly draftTitleHint?: string;
  readonly onSelectThread: (id: ChatThreadId) => void;
  readonly onRenameThread: (id: ChatThreadId, title: string) => void;
  readonly onDeleteThread: (id: ChatThreadId) => void;
  readonly onStartDraft: () => void;
  readonly onCollapse: () => void;
};

export function ChatHeader({
  threads, activeId, draftTitleHint, onSelectThread, onRenameThread, onDeleteThread, onStartDraft, onCollapse,
}: Props) {
  const [open, setOpen] = useState(false);
  const active = threads.find((t) => t.id === activeId) ?? null;
  const titleText = active ? active.title : (draftTitleHint ?? 'New conversation');

  return (
    <header className="chat-header">
      <button
        type="button"
        className="chat-header__title"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {titleText} ▾
      </button>
      <div className="chat-header__actions">
        <button type="button" aria-label="New conversation" onClick={onStartDraft}>+</button>
        <button type="button" aria-label="Collapse chat panel" onClick={onCollapse}>›</button>
      </div>
      {open ? (
        <ThreadList
          threads={threads}
          activeId={activeId}
          onSelect={(id) => { onSelectThread(id); setOpen(false); }}
          onRename={(id, title) => { onRenameThread(id, title); }}
          onDelete={(id) => { onDeleteThread(id); }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </header>
  );
}
```

- [ ] **Step 3: Tests**

`ChatHeader.test.tsx`: renders title; opens overlay on click; new-conversation click triggers callback; collapse click triggers callback.

`ThreadList.test.tsx`: lists rows; click selects; double-click edits and renames on blur; delete button confirms callback; keyboard up/down moves focus; Enter selects; Esc closes.

- [ ] **Step 4: Style `thread-list.css`**

Surface-elevated background, 1px border, max-height 320px with overflow:auto, row hover state, edit input full-width.

- [ ] **Step 5: Verify + commit**

```bash
pnpm test src/features/ai/chat/ChatHeader.test.tsx src/features/ai/chat/ThreadList.test.tsx
git add src/features/ai/chat/ChatHeader.tsx src/features/ai/chat/ChatHeader.test.tsx \
        src/features/ai/chat/ThreadList.tsx src/features/ai/chat/ThreadList.test.tsx \
        src/features/ai/chat/thread-list.css
git commit -m "feat(chat): ChatHeader + ThreadList — picker, rename, new, delete"
```

---

### Task 17: Chat — `ChatComposer` (textarea + send + cancel)

**Files:**
- Create: `src/features/ai/chat/ChatComposer.tsx` (+ test)
- Create: `src/features/ai/chat/chat-composer.css`

> **Strategy:** Textarea auto-grows to 6 lines max. ⌘+Enter (or Ctrl+Enter on non-Mac) sends; Enter alone newlines. Send button toggles to a Stop (cancel) button while `state ∈ {sending, streaming}`.

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState } from 'react';
import { SendIcon, StopIcon } from '@/shared/icons';
import './chat-composer.css';

type Props = {
  readonly disabled?: boolean;
  readonly streaming: boolean;
  readonly placeholder: string;
  readonly onSend: (text: string) => void;
  readonly onCancel: () => void;
};

const MAX_LINES = 6;

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}

export function ChatComposer({ disabled, streaming, placeholder, onSend, onCancel }: Props) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(ta).lineHeight || '20');
    const maxH = lh * MAX_LINES;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px';
  }, [text]);

  const sendNow = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => { e.preventDefault(); if (!streaming) sendNow(); }}
    >
      <textarea
        ref={taRef}
        className="chat-composer__textarea"
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        disabled={disabled || streaming}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          const modifier = isMac() ? e.metaKey : e.ctrlKey;
          if (e.key === 'Enter' && modifier) {
            e.preventDefault();
            if (streaming) onCancel();
            else sendNow();
          }
        }}
      />
      <button
        type={streaming ? 'button' : 'submit'}
        className="chat-composer__action"
        aria-label={streaming ? 'Stop' : 'Send'}
        disabled={!streaming && (disabled || text.trim().length === 0)}
        onClick={streaming ? onCancel : undefined}
      >
        {streaming ? <StopIcon size={14} /> : <SendIcon size={14} />}
      </button>
    </form>
  );
}
```

Test (`ChatComposer.test.tsx`): renders textarea + Send button; ⌘+Enter triggers `onSend`; Enter alone does not; while streaming, button is "Stop" and triggers `onCancel`.

- [ ] **Step 2: Style `chat-composer.css`**

```css
.chat-composer { display: flex; gap: 0.5rem; padding: 0.6rem; border-top: 1px solid var(--border-subtle); }
.chat-composer__textarea {
  flex: 1 1 auto;
  resize: none;
  font: inherit;
  padding: 0.45rem 0.6rem;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text);
  min-height: 1.6em;
  line-height: 1.4;
}
.chat-composer__textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.chat-composer__action {
  width: 36px; height: 36px;
  background: var(--accent); color: var(--accent-fg);
  border: none; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.chat-composer__action:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm test src/features/ai/chat/ChatComposer.test.tsx
git add src/features/ai/chat/ChatComposer.tsx src/features/ai/chat/ChatComposer.test.tsx src/features/ai/chat/chat-composer.css
git commit -m "feat(chat): ChatComposer — textarea, send, cancel, ⌘+Enter"
```

---

### Task 18: Chat — `PrivacyPreview` (verbatim system prompt)

**Files:**
- Create: `src/features/ai/chat/PrivacyPreview.tsx` (+ test)

> **Strategy:** Imports `buildOpenModeSystemPrompt` from `promptAssembly.ts` and renders it verbatim when expanded. Snapshot test asserts equivalence between the rendered text and the assembled system prompt.

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react';
import { buildOpenModeSystemPrompt } from './promptAssembly';

type Props = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly modelId: string;
  readonly historyCount: number;
};

export function PrivacyPreview({ book, modelId, historyCount }: Props) {
  const [open, setOpen] = useState(false);
  const summary = `Sending: ${book.title}${book.author ? ` by ${book.author}` : ''} + ${historyCount} prior messages → ${modelId}`;
  const prompt = buildOpenModeSystemPrompt(book);
  return (
    <div className={`privacy-preview ${open ? 'privacy-preview--open' : ''}`}>
      <button
        type="button"
        className="privacy-preview__summary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⓘ {summary}
      </button>
      {open ? (
        <div className="privacy-preview__body">
          <h4>System prompt</h4>
          <pre className="privacy-preview__prompt">{prompt}</pre>
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

Test (`PrivacyPreview.test.tsx`):

```ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivacyPreview } from './PrivacyPreview';
import { buildOpenModeSystemPrompt } from './promptAssembly';

describe('PrivacyPreview', () => {
  it('renders the verbatim system prompt when expanded', async () => {
    render(<PrivacyPreview book={{ title: 'X', author: 'Y' }} modelId="gpt-x" historyCount={3} />);
    await userEvent.click(screen.getByRole('button'));
    const expected = buildOpenModeSystemPrompt({ title: 'X', author: 'Y' });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('summary line includes title and model', () => {
    render(<PrivacyPreview book={{ title: 'X' }} modelId="gpt-x" historyCount={0} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toMatch(/X/);
    expect(btn.textContent).toMatch(/gpt-x/);
  });
});
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm test src/features/ai/chat/PrivacyPreview.test.tsx
git add src/features/ai/chat/PrivacyPreview.tsx src/features/ai/chat/PrivacyPreview.test.tsx
git commit -m "feat(chat): PrivacyPreview — verbatim system prompt"
```

---

### Task 19: Chat — `SaveAnswerInline` + first-time hint

**Files:**
- Create: `src/features/ai/chat/SaveAnswerInline.tsx` (+ test)
- Create: `src/features/ai/chat/ChatFirstTimeHint.tsx` (+ test) — small dismissible banner

> **Strategy:** `SaveAnswerInline` is opened by `MessageBubble`'s [Save] click via parent state in `ChatPanel`. Optional commentary input + Save / Cancel. On save, calls `useSavedAnswers.add(snapshot, userNote)` (caller wires it). Microconfirmation auto-fades after 2s. The first-time hint is a tiny banner above the message list, stored in `chatPanelHintShown`.

- [ ] **Step 1: Implement `SaveAnswerInline.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';

type Props = {
  readonly initialNote?: string;
  readonly onSave: (note: string) => Promise<void>;
  readonly onCancel: () => void;
};

export function SaveAnswerInline({ initialNote = '', onSave, onCancel }: Props) {
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(note.trim());
      setConfirm(true);
      confirmTimer.current = setTimeout(() => setConfirm(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  if (confirm) {
    return <p className="save-answer__confirm" role="status">Saved → notebook</p>;
  }
  return (
    <div className="save-answer">
      <textarea
        className="save-answer__note"
        placeholder="Add a note (optional)"
        aria-label="Add a note for this saved answer"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      <div className="save-answer__actions">
        <button type="button" onClick={handleSave} disabled={busy}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

Test: mounts; types into note; clicks Save; `onSave` called with the note; the microconfirmation appears and `confirm` text is rendered; the `Cancel` button calls `onCancel`.

- [ ] **Step 2: Implement `ChatFirstTimeHint.tsx`**

```tsx
type Props = {
  readonly visible: boolean;
  readonly onDismiss: () => void;
};

export function ChatFirstTimeHint({ visible, onDismiss }: Props) {
  if (!visible) return null;
  return (
    <div className="chat-first-time-hint" role="note">
      <p>Selected text becomes context in 4.4 — for now, ask about the book in general.</p>
      <button type="button" aria-label="Dismiss hint" onClick={onDismiss}>×</button>
    </div>
  );
}
```

Test: visibility toggles correctly; dismiss calls `onDismiss`.

- [ ] **Step 3: Verify + commit**

```bash
pnpm test src/features/ai/chat/SaveAnswerInline.test.tsx src/features/ai/chat/ChatFirstTimeHint.test.tsx
git add src/features/ai/chat/SaveAnswerInline.tsx src/features/ai/chat/SaveAnswerInline.test.tsx \
        src/features/ai/chat/ChatFirstTimeHint.tsx src/features/ai/chat/ChatFirstTimeHint.test.tsx
git commit -m "feat(chat): SaveAnswerInline + first-time hint"
```

---

### Task 20: Chat — `ChatPanel` composes everything

**Files:**
- Create: `src/features/ai/chat/ChatPanel.tsx` (+ test)
- Create: `src/features/ai/chat/chat-panel.css`
- Modify: `src/features/reader/workspace/RightRail.tsx` (or `ReaderWorkspace.tsx`) to render `<ChatPanel>` in place of the placeholder added in Task 12.

> **Strategy:** Owns the four chat hooks. Picks the empty-state variant by precedence. Bridges save-answer flow (clicking Save on a `MessageBubble` opens an inline `SaveAnswerInline` for that message). Wires the first-time hint via `useFirstTimeHint`-style local state backed by `chatPanelHintShown`.

- [ ] **Step 1: Implement `ChatPanel.tsx`**

```tsx
import { useCallback, useMemo, useState } from 'react';
import type { BookFormat, ChatMessageId, ChatThread } from '@/domain';
import { ChatThreadId } from '@/domain';
import type { ApiKeyState } from '@/features/ai/key/apiKeyStore';
import { useChatThreads } from './useChatThreads';
import { useChatMessages } from './useChatMessages';
import { useChatSend } from './useChatSend';
import { useSavedAnswers } from './useSavedAnswers';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { ChatComposer } from './ChatComposer';
import { PrivacyPreview } from './PrivacyPreview';
import { ChatEmptyState } from './ChatEmptyState';
import { SaveAnswerInline } from './SaveAnswerInline';
import { ChatFirstTimeHint } from './ChatFirstTimeHint';
import type { ChatThreadsRepository, ChatMessagesRepository, SavedAnswersRepository } from '@/storage';
import './chat-panel.css';

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
  readonly hintShown: boolean;
  readonly onHintDismiss: () => void;
};

function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().slice(0, 60);
  if (firstMessage.length <= 60) return trimmed;
  // word-boundary trim
  const cut = trimmed.lastIndexOf(' ');
  return (cut > 20 ? trimmed.slice(0, cut) : trimmed) + '…';
}

export function ChatPanel(props: Props) {
  const bookIdBranded = props.bookId as never;
  const threads = useChatThreads({
    bookId: bookIdBranded,
    threadsRepo: props.threadsRepo,
    messagesRepo: props.messagesRepo,
  });

  const activeThreadId = threads.activeId ?? null;
  const messages = useChatMessages({
    threadId: (activeThreadId ?? ChatThreadId('__none__')),
    messagesRepo: props.messagesRepo,
  });

  const send = useChatSend({
    threadId: (activeThreadId ?? ChatThreadId('__none__')),
    modelId: props.selectedModelId ?? '',
    getApiKey: props.getApiKey,
    book: props.book,
    history: messages.list,
    append: messages.append,
    patch: messages.patch,
    finalize: messages.finalize,
  });

  const savedAnswers = useSavedAnswers({
    bookId: bookIdBranded,
    savedAnswersRepo: props.savedAnswersRepo,
  });

  const [savingMessageId, setSavingMessageId] = useState<ChatMessageId | null>(null);

  const handleSendNew = useCallback(async (text: string) => {
    // If we're on a draft, persist the thread first (with the derived title).
    if (threads.draft && activeThreadId === null) {
      const id = ChatThreadId(`t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      const now = new Date().toISOString();
      const thread: ChatThread = {
        id,
        bookId: bookIdBranded,
        title: deriveTitle(text),
        modelId: threads.draft.modelId,
        answerStyle: 'open',
        createdAt: now as ChatThread['createdAt'],
        updatedAt: now as ChatThread['updatedAt'],
      };
      await threads.persistDraft(thread);
      // Drive send against the just-persisted thread.
      send.send(text);
      return;
    }
    send.send(text);
  }, [threads, activeThreadId, bookIdBranded, send]);

  const variant: 'no-key' | 'no-model' | 'no-threads' | 'ready' = useMemo(() => {
    if (props.apiKeyState.kind === 'none' || props.apiKeyState.kind === 'locked') return 'no-key';
    if (!props.selectedModelId) return 'no-model';
    if (threads.list.length === 0 && !threads.draft) return 'no-threads';
    return 'ready';
  }, [props.apiKeyState.kind, props.selectedModelId, threads.list.length, threads.draft]);

  return (
    <div className="chat-panel">
      <ChatHeader
        threads={threads.list}
        activeId={activeThreadId}
        draftTitleHint={threads.draft ? 'New conversation' : undefined}
        onSelectThread={threads.setActive}
        onRenameThread={(id, title) => { void threads.rename(id, title); }}
        onDeleteThread={(id) => { void threads.remove(id); }}
        onStartDraft={() => { threads.startDraft(props.selectedModelId ?? ''); }}
        onCollapse={() => { /* parent handles via onCollapse passed into RightRail */ }}
      />
      <ChatFirstTimeHint visible={!props.hintShown && variant === 'ready'} onDismiss={props.onHintDismiss} />
      <div className="chat-panel__body">
        {variant === 'no-key' || variant === 'no-model' ? (
          <ChatEmptyState
            variant={variant}
            onOpenSettings={props.onOpenSettings}
            bookTitle={props.book.title}
          />
        ) : variant === 'no-threads' ? (
          <ChatEmptyState
            variant="no-threads"
            onStartDraft={() => threads.startDraft(props.selectedModelId ?? '')}
            bookTitle={props.book.title}
          />
        ) : (
          <MessageList
            messages={messages.list}
            failure={send.failure}
            onSaveMessage={(id) => setSavingMessageId(id)}
            onRetry={send.retry}
            onOpenSettings={props.onOpenSettings}
            onDismissError={() => { /* no-op: failure clears on next send */ }}
          />
        )}
      </div>
      {savingMessageId ? (() => {
        const target = messages.list.find((m) => m.id === savingMessageId);
        if (!target) return null;
        const userMessage = messages.list.slice(0, messages.list.indexOf(target)).reverse().find((m) => m.role === 'user');
        return (
          <SaveAnswerInline
            onSave={async (note) => {
              await savedAnswers.add({
                threadId: (activeThreadId ?? ChatThreadId('__none__')),
                messageId: target.id,
                modelId: target.mode === 'open' ? props.selectedModelId ?? '' : props.selectedModelId ?? '',
                mode: target.mode ?? 'open',
                content: target.content,
                question: (userMessage?.content ?? '').slice(0, 240),
                contextRefs: target.contextRefs,
                ...(note ? { userNote: note } : {}),
              });
              setSavingMessageId(null);
            }}
            onCancel={() => setSavingMessageId(null)}
          />
        );
      })() : null}
      {variant === 'ready' || variant === 'no-threads' ? (
        <>
          <PrivacyPreview
            book={props.book}
            modelId={props.selectedModelId ?? ''}
            historyCount={messages.list.length}
          />
          <ChatComposer
            disabled={variant !== 'ready' && variant !== 'no-threads'}
            streaming={send.state === 'streaming' || send.state === 'sending'}
            placeholder={`Ask about ${props.book.title}`}
            onSend={(text) => { void handleSendNew(text); }}
            onCancel={send.cancel}
          />
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Style `chat-panel.css`** — flex-column layout, header on top, message list flex-1 with internal scroll, composer pinned to bottom, privacy preview + first-time hint above composer.

```css
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.chat-panel__body { flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; }
.message-list { flex: 1 1 auto; overflow-y: auto; padding: 0.5rem 0.75rem; display: flex; flex-direction: column; }
.chat-empty { padding: 1.5rem; text-align: center; color: var(--text-muted); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
.chat-empty button { padding: 0.4rem 0.85rem; border: 1px solid var(--border-subtle); background: var(--surface); border-radius: 6px; cursor: pointer; }
.privacy-preview { padding: 0.4rem 0.75rem; border-top: 1px solid var(--border-subtle); font-size: 0.8rem; color: var(--text-muted); }
.privacy-preview__summary { background: transparent; border: none; cursor: pointer; font: inherit; color: inherit; padding: 0; text-align: left; }
.privacy-preview__body { padding: 0.5rem 0; }
.privacy-preview__prompt { white-space: pre-wrap; background: var(--surface); border: 1px solid var(--border-subtle); padding: 0.5rem; border-radius: 6px; font-size: 0.78rem; }
.chat-first-time-hint { display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 0.75rem; background: color-mix(in oklab, var(--accent) 8%, var(--surface)); font-size: 0.8rem; }
.chat-first-time-hint button { background: transparent; border: none; cursor: pointer; color: var(--text-muted); }
.save-answer { padding: 0.6rem 0.75rem; border-top: 1px solid var(--border-subtle); }
.save-answer__note { width: 100%; min-height: 3rem; resize: vertical; background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.4rem; font: inherit; color: var(--text); }
.save-answer__actions { display: flex; gap: 0.4rem; margin-top: 0.4rem; }
.save-answer__confirm { padding: 0.5rem 0.75rem; color: var(--text-muted); font-size: 0.85rem; }
.chat-header { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border-subtle); }
.chat-header__title { background: transparent; border: none; cursor: pointer; font: inherit; color: var(--text); flex: 1 1 auto; text-align: left; }
.chat-header__actions { display: flex; gap: 0.3rem; }
.chat-header__actions button { background: transparent; border: none; cursor: pointer; color: var(--text-muted); width: 28px; height: 28px; }
```

- [ ] **Step 3: Wire `ChatPanel` into `RightRail`'s body in `ReaderWorkspace.tsx`**

Replace the placeholder added in Task 12 with `<ChatPanel … />`. Pass through repos, model, key, settings open callback, hint flag.

- [ ] **Step 4: Mobile sheet integration**

The `chat` tab's content in `MobileSheet` becomes `<ChatPanel … />` (same instance pattern). Verify: the sheet's collapsed-but-mounted strategy (per spec §8.4) must keep the panel mounted; modify `MobileSheet` only if needed to keep tab content mounted (using CSS `display: none` when not active rather than unmount).

- [ ] **Step 5: Component test for `ChatPanel`**

`ChatPanel.test.tsx` — happy path with all hooks stubbed:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

// Use in-memory IDB + real repos. Mock fetch globally for the network adapter.
// Verify: empty state precedence based on apiKeyState; ready variant renders composer.
// (Detailed cases — at least one per variant.)
```

- [ ] **Step 6: Verify**

```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/ai/chat/ChatPanel.tsx src/features/ai/chat/ChatPanel.test.tsx \
        src/features/ai/chat/chat-panel.css \
        src/features/reader/workspace/ReaderWorkspace.tsx \
        src/features/reader/workspace/MobileSheet.tsx
git commit -m "feat(chat): ChatPanel — composes everything"
```

---

### Task 21: Notebook — `savedAnswer` entry kind + AI filter chip

**Files:**
- Modify: `src/features/annotations/notebook/useNotebook.ts` (compose `savedAnswersRepo`)
- Modify: `src/features/annotations/notebook/compareNotebookEntries.ts` (handle `savedAnswer`)
- Modify: `src/features/annotations/notebook/matchesQuery.ts` (search `savedAnswer.question + content + userNote`)
- Modify: `src/features/annotations/notebook/matchesFilter.ts` (add `'ai'` filter value)
- Modify: `src/features/annotations/notebook/NotebookSearchBar.tsx` (new chip)
- Modify: `src/features/annotations/notebook/NotebookRow.tsx` (savedAnswer row variant)
- Modify: `src/features/annotations/notebook/NotebookView.tsx` (pass new repo through)
- Modify: `src/features/annotations/notebook/index.ts` (or its barrel) — type re-export if needed
- Modify: `src/app/App.tsx` (pass `savedAnswersRepo` to `NotebookView`)

> **Strategy:** Phase 3.4 already left a `NotebookEntry` discriminated union; this is purely additive. Update the existing pure helpers' tests to cover the new variant.

- [ ] **Step 1: Extend `NotebookEntry` union in `useNotebook.ts`**

Find the existing union and add:

```ts
| { kind: 'savedAnswer'; savedAnswer: SavedAnswer }
```

`useNotebook` accepts a new optional param `savedAnswersRepo: SavedAnswersRepository` and runs a fourth parallel `Promise.all` branch for `savedAnswersRepo.getByBook(bookId)`. Map each into `{ kind: 'savedAnswer', savedAnswer }` entries appended to the merge.

- [ ] **Step 2: Extend `compareNotebookEntries.ts`**

```ts
function entryCreatedAt(e: NotebookEntry): string {
  switch (e.kind) {
    case 'bookmark': return e.bookmark.createdAt;
    case 'highlight': return e.highlight.createdAt;
    case 'savedAnswer': return e.savedAnswer.createdAt;
  }
}
// In the comparator, savedAnswer-vs-anything falls back to createdAt (descending).
// savedAnswer doesn't have a book-position anchor, so position-based sort doesn't apply.
```

Update its existing test file to add cases for the new variant.

- [ ] **Step 3: Extend `matchesQuery.ts`**

```ts
case 'savedAnswer': {
  const haystack = `${e.savedAnswer.question}\n${e.savedAnswer.content}\n${e.savedAnswer.userNote ?? ''}`.toLowerCase();
  return haystack.includes(needle);
}
```

Update its tests.

- [ ] **Step 4: Extend `matchesFilter.ts`**

Add `'ai'` to the filter union; `matchesFilter(entry, 'ai')` returns `entry.kind === 'savedAnswer'`. Update tests.

- [ ] **Step 5: Add the AI chip to `NotebookSearchBar.tsx`**

Match the existing chip pattern — single-select; "AI answers" label.

- [ ] **Step 6: Implement `savedAnswer` variant in `NotebookRow.tsx`**

Show the question (truncated to ~80 chars) as the row title; full content (3-line clamp; click to expand); user note italic; meta row with model id + relative time + (in 4.4+) jump-to-passage link if `contextRefs` non-empty.

- [ ] **Step 7: Pass `savedAnswersRepo` through `NotebookView` from `App.tsx`**

Already wired in Task 22 (next), but the prop signature lands here.

- [ ] **Step 8: Component tests**

Add a test in `NotebookRow.test.tsx` that renders a `savedAnswer` entry and asserts the question + content + AI marker appear. Add a test in `NotebookSearchBar.test.tsx` that filtering by "AI answers" hides non-saved-answer entries.

- [ ] **Step 9: Verify**

```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/features/annotations/notebook/useNotebook.ts \
        src/features/annotations/notebook/compareNotebookEntries.ts \
        src/features/annotations/notebook/compareNotebookEntries.test.ts \
        src/features/annotations/notebook/matchesQuery.ts \
        src/features/annotations/notebook/matchesQuery.test.ts \
        src/features/annotations/notebook/matchesFilter.ts \
        src/features/annotations/notebook/matchesFilter.test.ts \
        src/features/annotations/notebook/NotebookSearchBar.tsx \
        src/features/annotations/notebook/NotebookSearchBar.test.tsx \
        src/features/annotations/notebook/NotebookRow.tsx \
        src/features/annotations/notebook/NotebookRow.test.tsx \
        src/features/annotations/notebook/NotebookView.tsx
git commit -m "feat(notebook): savedAnswer entry kind + AI filter chip"
```

---

### Task 22: App — wire chat repos + cascade + boot prefs

**Files:**
- Modify: `src/features/library/wiring.ts` (add three repos to `Wiring`)
- Modify: `src/app/useReaderHost.ts` (extend cascade + propagate repos)
- Modify: `src/app/App.tsx` (boot reads `rightRailVisible` and `chatPanelHintShown`; pass repos + state to `ReaderWorkspace` and `NotebookView`)

> **Strategy:** Pure plumbing. The chat hooks live inside `ChatPanel` (already wired in Task 20). This task threads the repo references and boot prefs from app root down. It also adds the cascade chain: messages-by-thread → threads-by-book → saved-answers-by-book inside `useReaderHost.onRemoveBook`.

- [ ] **Step 1: Extend `Wiring`**

In `src/features/library/wiring.ts`:

```ts
import {
  createChatThreadsRepository,
  createChatMessagesRepository,
  createSavedAnswersRepository,
  type ChatThreadsRepository,
  type ChatMessagesRepository,
  type SavedAnswersRepository,
} from '@/storage';

export type Wiring = {
  // existing fields…
  readonly chatThreadsRepo: ChatThreadsRepository;
  readonly chatMessagesRepo: ChatMessagesRepository;
  readonly savedAnswersRepo: SavedAnswersRepository;
};

export function createWiring(db: BookwormDB): Wiring {
  return {
    // existing…
    chatThreadsRepo: createChatThreadsRepository(db),
    chatMessagesRepo: createChatMessagesRepository(db),
    savedAnswersRepo: createSavedAnswersRepository(db),
  };
}
```

- [ ] **Step 2: Extend `useReaderHost.onRemoveBook` cascade**

After the existing cascade (highlights, notes, bookmarks):

```ts
// Chat cascade — children before parents.
const threads = await wiring.chatThreadsRepo.getByBook(bookIdBranded);
for (const t of threads) {
  await wiring.chatMessagesRepo.deleteByThread(t.id);
}
await wiring.chatThreadsRepo.deleteByBook(bookIdBranded);
await wiring.savedAnswersRepo.deleteByBook(bookIdBranded);
```

Add a unit test asserting all three stores are empty for the book after removal.

- [ ] **Step 3: Boot reads in `App.tsx`**

Inside the `Promise.all` in the `useEffect` boot, add:

```ts
wiring.settingsRepo.getChatPanelHintShown(),
```

(`rightRailVisible` is already part of `prefs` since Task 4 added it to `ReaderPreferences`.)

Pass through to `ReadyApp` boot:

```ts
initialChatPanelHintShown: hintChat,
```

`ReadyApp` passes `initialChatPanelHintShown` + `wiring.chatThreadsRepo` + `wiring.chatMessagesRepo` + `wiring.savedAnswersRepo` to `ReaderWorkspace`. `ReaderWorkspace` passes the repos + the `apiKeyState` (read via `useApiKeyState()`) + `getCurrentApiKey` + `useSelectedModelId()` + `onOpenSettings={view.goSettings}` + the hint flag down to `ChatPanel`.

- [ ] **Step 4: Right-rail-visibility persistence wiring**

`ReaderWorkspace`'s `useRightRailVisibility` `onChange` calls a new `wiring.readerPreferencesRepo.setRightRailVisible(value)` (added in Task 4). The initial value comes from boot's `prefs.rightRailVisible`.

- [ ] **Step 5: First-time hint persistence**

When the user dismisses the hint, call `wiring.settingsRepo.setChatPanelHintShown(true)`. Provide an `onHintDismiss` prop to `ChatPanel` that wraps this call.

- [ ] **Step 6: Pass `savedAnswersRepo` to `NotebookView`**

In the `view.kind === 'notebook'` branch in `App.tsx`, pass `savedAnswersRepo={reader.savedAnswersRepo}` through.

- [ ] **Step 7: Verify**

```bash
pnpm check
pnpm dev
```

Smoke test the flows manually: open a book → expand right rail → see no-key state → set up key + model in Settings → return → see no-threads → start a conversation → send a message (with real or mocked NanoGPT) → save answer → navigate to notebook → see saved answer + AI chip → remove book from library → verify no chat data remains for that book.

- [ ] **Step 8: Commit**

```bash
git add src/features/library/wiring.ts src/app/useReaderHost.ts src/app/App.tsx \
        src/features/reader/workspace/ReaderWorkspace.tsx
git commit -m "feat(app): wire chat repos + cascade + mobile sheet tab"
```

---

### Task 23: E2E — chat suite + SSE fixture

**Files:**
- Create: `tests/e2e/chat.spec.ts`
- Create: `tests/e2e/fixtures/nanogpt-chat-stream.txt`
- Modify: `tests/e2e/helpers.ts` (or wherever shared helpers live — add a route-mock for chat completions)

> **Strategy:** Use Playwright's route interception to mock `/v1/chat/completions`. Serve canned SSE chunks from the fixture file, optionally with controllable delay/holdopen for the mid-stream-cancel test. Real fetch elsewhere.

- [ ] **Step 1: Create the SSE fixture `tests/e2e/fixtures/nanogpt-chat-stream.txt`**

```
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":", "}}]}

data: {"choices":[{"delta":{"content":"reader."}}]}

data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":42,"completion_tokens":3}}

data: [DONE]

```

Each event terminated by `\n\n`.

- [ ] **Step 2: Add a route-mock helper**

In `tests/e2e/helpers.ts`:

```ts
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function mockNanoGPTChatStream(page: Page, options: { holdOpen?: boolean } = {}) {
  const body = readFileSync(resolve(__dirname, 'fixtures/nanogpt-chat-stream.txt'), 'utf-8');
  await page.route('**/v1/chat/completions', async (route) => {
    if (options.holdOpen) {
      // Send first chunk only; never close.
      const partial = body.split('\n\n')[0] + '\n\n';
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: partial,
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      });
    }
  });
}

export async function mockNanoGPTModels(page: Page, models = ['gpt-x', 'gpt-y']) {
  await page.route('**/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: models.map((id) => ({ id })) }),
    });
  });
}
```

- [ ] **Step 3: Write the E2E spec `tests/e2e/chat.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { mockNanoGPTChatStream, mockNanoGPTModels } from './helpers';

test.describe('chat panel', () => {
  test('empty-state precedence: no-key → no-model → no-threads', async ({ page }) => {
    await mockNanoGPTModels(page);
    await page.goto('/');
    // Import a fixture book (use the existing fixture flow from prior phases).
    // Open the book.
    // Expand the right rail.
    await page.getByLabel('Expand chat panel').click();
    await expect(page.getByText(/api key/i)).toBeVisible();
    // Open Settings → save key (test mode bypass; or use the Settings UI flow).
    // Return → no-model state visible.
    // Pick a model → no-threads state visible.
  });

  test('send a message with mocked stream', async ({ page }) => {
    await mockNanoGPTModels(page);
    await mockNanoGPTChatStream(page);
    // Setup: book + key + model from prior steps.
    // Click "Start a conversation".
    await page.getByRole('button', { name: /start a conversation/i }).click();
    await page.getByLabel(/Ask about/).fill('Tell me about this book.');
    await page.getByLabel('Send').click();
    await expect(page.getByText('Hello, reader.')).toBeVisible();
    await expect(page.getByLabel('Save answer')).toBeVisible();
  });

  test('cancel mid-stream shows truncated marker', async ({ page }) => {
    await mockNanoGPTModels(page);
    await mockNanoGPTChatStream(page, { holdOpen: true });
    // Setup → send → wait for first delta visible → click Stop.
    await page.getByLabel('Send').click();
    await page.waitForFunction(() => document.body.innerText.includes('Hello'));
    await page.getByLabel('Stop').click();
    await expect(page.getByText('(stopped)')).toBeVisible();
    await expect(page.getByLabel('Save answer')).toBeVisible(); // truncated saves are allowed
  });

  test('save answer surfaces in notebook with AI filter', async ({ page }) => {
    await mockNanoGPTModels(page);
    await mockNanoGPTChatStream(page);
    // Setup → send → click Save → add commentary → confirm.
    await page.getByLabel('Save answer').click();
    await page.getByLabel(/add a note/i).fill('Important answer.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved → notebook')).toBeVisible();
    // Open notebook.
    await page.getByLabel('Notebook').click();
    await expect(page.getByText('Important answer.')).toBeVisible();
    // Filter: AI answers chip — only saved-answer rows visible.
    await page.getByRole('button', { name: 'AI answers' }).click();
    // Assertions on row count / kind via test-ids.
  });

  test('reload mid-stream surfaces interrupted state with retry', async ({ page }) => {
    await mockNanoGPTModels(page);
    await mockNanoGPTChatStream(page, { holdOpen: true });
    // Setup → send → wait for first delta visible → reload.
    await page.getByLabel('Send').click();
    await page.waitForFunction(() => document.body.innerText.includes('Hello'));
    await page.reload();
    // After reload + stale-stream detection runs:
    await expect(page.getByText('(stopped)')).toBeVisible();
    // Retry path: error bubble visible with Retry button.
  });

  test('mobile sheet: dismiss mid-stream lets answer arrive in background', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockNanoGPTModels(page);
    await mockNanoGPTChatStream(page);
    // Setup → open mobile sheet → chat tab → send → close sheet → reopen sheet.
    // The answer should be present.
  });

  test('book removal cascades chat data', async ({ page }) => {
    await mockNanoGPTModels(page);
    await mockNanoGPTChatStream(page);
    // Setup → send → save answer.
    // Navigate to library → remove book → confirm.
    // Use page.evaluate to read IDB and assert chat_threads / chat_messages / saved_answers all have nothing for that book.
  });
});
```

- [ ] **Step 4: Run E2E**

```bash
pnpm test:e2e
```
Expected: PASS (all chat specs + all prior phase specs untouched).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/chat.spec.ts tests/e2e/fixtures/nanogpt-chat-stream.txt tests/e2e/helpers.ts
git commit -m "test(e2e): chat — open/send/cancel/save/reload/remove suite"
```

---

### Task 24: Docs — architecture decision + roadmap status

**Files:**
- Modify: `docs/02-system-architecture.md` (decision history entry)
- Modify: `docs/04-implementation-roadmap.md` (status block)

> **Strategy:** Append a dated entry to `02-system-architecture.md`'s "Decision history" section. Update the "Status" block at the top of `04-implementation-roadmap.md`.

- [ ] **Step 1: Update the roadmap status block**

In `docs/04-implementation-roadmap.md`, in the `## Status` section, add the line:

```
- Phase 4.3 — complete (2026-05-05)
```

(below the existing `Phase 4.2` line, matching the existing date format)

- [ ] **Step 2: Append decision-history entry to `docs/02-system-architecture.md`**

Add at the top of the `## Decision history` section (above the `### 2026-05-04 — Phase 4.2: Model catalog` entry):

```markdown
### 2026-05-05 — Phase 4.3 chat panel

- **Surface:** Reader workspace's right rail finally lands. New `RightRail` +
  `RightRailCollapsedTab` next to the existing `DesktopRail` and `ReaderView`.
  Width fixed at 360px; collapse via translate-only animation (no width
  animation — avoids foliate iframe reflow). Mobile: new `chat` tab in
  `MobileSheet`. Sheet is collapsed by transform (not unmount) so dismissing
  mid-stream doesn't kill the in-flight machine.
- **Data model:** `ChatMode` extends with `'open'` (4.3 baseline). `mode`
  moves from `ChatThread` to `ChatMessage` (real conversations mix modes;
  thread-level lock is wrong). `ChatMessage` gains transient `streaming` /
  `truncated` / `error` flags. New `SavedAnswer` domain type — distinct from
  `Note` per the AI-engine doc's "separate user notes from AI-generated
  content" rule. `SavedAnswer` snapshots `content/question/modelId/mode/
  contextRefs` so deleting a thread doesn't erase the saved answer.
- **Storage:** v6 migration adds `chat_threads` / `chat_messages` /
  `saved_answers` IDB stores with appropriate indexes. Three new repos in
  the validating-reads pattern. `rightRailVisible` added to
  `ReaderPreferences` via forward-compatible normalizer (no schema bump).
  `chatPanelHintShown` added as a new `SettingsRecord` variant (mirrors
  `focusModeHintShown`).
- **Network:** New `nanogptChat.ts` module — sole consumer of
  `/v1/chat/completions`. Async generator over `fetch + ReadableStream`
  (EventSource can't carry Authorization). Permissive `parseSSE` helper
  next door — line-buffered, tolerates `\r\n`, skips comment lines, joins
  multi-line `data:` continuations.
- **State machine:** XState v5 `chatRequestMachine`, one instance per send.
  `streaming → done | aborted | failed` with a `streamActor` invocation
  that translates the generator's events to machine events. The
  spec's `assembling`/`sending` substates are collapsed into `streaming`
  for v1 — assembly runs synchronously in the hook before
  `actor.start()`.
- **Hooks:** Five new hooks under `src/features/ai/chat/`:
  `useChatThreads`, `useChatMessages`, `useChatSend`, `useSavedAnswers`,
  plus `useRightRailVisibility` under workspace. Mirror the
  `useBookmarks` / `useHighlights` / `useNotes` per-book hook pattern.
- **Replay safety:** User message persisted before the machine starts;
  assistant placeholder persisted with `streaming: true` immediately;
  patches debounced 80ms; `finalize` cancels pending patch and writes
  immediately. Stale-stream detection on mount: any
  `streaming: true && createdAt < now - 30s` row is converted to
  `truncated + error: 'interrupted'` before the message list is
  exposed. A reload mid-flight surfaces a retry-able interrupted state.
- **Privacy:** `PrivacyPreview` imports the same
  `buildOpenModeSystemPrompt` constant used by the network adapter.
  Snapshot-tested. Refactoring the prompt automatically updates the UI
  in lockstep.
- **Save-as-note:** Distinct entity, not overloaded onto `Note`.
  `SaveAnswerInline` renders inline on the assistant bubble; on save,
  `useSavedAnswers.add(snapshot)` writes a new `SavedAnswer` and the
  bubble shows a 2s "Saved → notebook" microconfirmation.
- **Notebook integration:** `NotebookEntry` union expands with
  `{ kind: 'savedAnswer'; savedAnswer }`. New "AI answers" filter chip
  in `NotebookSearchBar`. Saved answers sort by `createdAt` (no
  book-position anchor in 4.3). Phase 4.4 will add provenance-jump
  affordances when `contextRefs` are non-empty.
- **Cascade on book removal:** `useReaderHost.onRemoveBook` chain extends
  with messages-by-thread → threads-by-book → saved-answers-by-book
  (children before parents).
- **First-time hint:** Dismissible banner on first chat panel render —
  "Selected text becomes context in 4.4 — for now, ask about the book
  in general." Persisted via `chatPanelHintShown`. Mirrors Phase 2.3's
  `focusModeHintShown` exactly.
- **Out of scope (deferred):** Passage mode, chapter mode,
  multi-excerpt, retrieval, full-book attach, suggested prompts (all
  Phase 4.4 / Phase 5+). Markdown rendering, right-rail resize,
  per-book persisted active-thread, AI-summarized thread titles,
  re-generate, token/cost hints, prompt caching breakpoints,
  provider switcher, thread search, export.
```

- [ ] **Step 3: Run the full quality gate one final time**

```bash
pnpm check && pnpm test:e2e
```
Expected: PASS.

- [ ] **Step 4: Commit + push branch + open PR**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: Phase 4.3 — architecture decision + roadmap status complete"
git push -u origin phase-4-3-chat-panel
```

Then open the PR via `gh pr create` with the standard project template referencing the spec at `docs/superpowers/specs/2026-05-05-phase-4-3-chat-panel-design.md` and the validation checklist from spec §16.

---

## Final validation gate (per spec §16)

Before marking Phase 4.3 complete:

- [ ] All 24 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new chat suite plus all prior suites.
- [ ] Manual smoke on desktop: empty-state precedence walkthrough; one full message round-trip; cancel mid-stream; save-as-answer; notebook surface + AI filter; book removal cascade.
- [ ] Manual smoke on mobile (DevTools viewport at minimum, real device preferred): chat tab, send, dismiss-mid-stream, reopen, badge pulse seen.
- [ ] `docs/04-implementation-roadmap.md` Status block updated.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard complete per `docs/08-agent-self-improvement.md` — minimum 22/27 for this risky/core task.
- [ ] Privacy preview snapshot test confirms `PrivacyPreview` content equals `buildOpenModeSystemPrompt(book)`.
- [ ] Stale-stream test confirms cold-reload-mid-flight surfaces interrupted state.





