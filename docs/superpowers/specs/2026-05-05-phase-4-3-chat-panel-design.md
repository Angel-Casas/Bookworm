# Phase 4.3 — Chat panel design

**Status:** approved 2026-05-05
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 4 → Task 4.3
**Predecessors:** Phase 4.1 API key settings (introduces `apiKeyStore`, `nanogptApi`, the WebCrypto unlock flow), Phase 4.2 model catalog (introduces `modelCatalogStore`, `selectedModelId` persistence), Phase 3.4 annotation notebook (introduces `NotebookEntry` discriminated union + filter chip pattern).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` (operating modes, prompt assembly, failure handling, provenance, safety rules), `docs/02-system-architecture.md` (functional core / imperative shell, three-pane workspace, ChatThread/ChatMessage entities, XState chat-request flow, replay-safe AI requests), `docs/05-design-system.md` (three-pane defaults, AI-controls-secondary, motion rules, anti-patterns), `docs/06-quality-strategy.md` (file/function thresholds, error-state requirements, accessibility floor).

---

## 1. Goal & scope

Ship a working, threaded, streaming chat panel grounded only in book metadata for v1. Phase 4.3 is the *channel* — multi-thread persistence, NanoGPT streaming, replay safety, save-as-note via a distinct entity, transparent privacy preview. Phase 4.4 (passage mode) and Phase 5 (retrieval) attach grounded context payloads on top of this channel without re-shaping it.

The chat surface lives in the right rail of the reader workspace on desktop (the rail that has been a placeholder since Phase 2.3 finally earns its place) and in a new tab of the existing mobile sheet. The right-rail visibility is a persisted `ReaderPreferences` boolean defaulting to `true`.

**In scope (v1, this phase):**
- New `'open'` value on the `ChatMode` union — "general chat about a book, no specific excerpt or chapter context attached".
- Move `mode` from `ChatThread` to `ChatMessage` (refactor of currently-unused domain types — zero data migration cost). Threads carry `answerStyle`; messages carry `mode`.
- New `SavedAnswer` domain type and IDB store. Snapshots message content + question + model + mode + context refs at save time, immutable thereafter, survives chat thread deletion.
- IndexedDB schema bump v5 → v6: three additive stores (`chat_threads`, `chat_messages`, `saved_answers`) with appropriate indexes.
- New `chat_threads` / `chat_messages` / `saved_answers` repositories with the validating-reads pattern established in Phase 3.x.
- `ReaderPreferences.rightRailVisible` boolean (forward-compatible validator soften, no schema bump).
- New `chatPanelHintShown` `SettingsRecord` variant (mirrors Phase 2.3 `focusModeHintShown`).
- `streamChatCompletion` async generator in a new `nanogptChat.ts` module — the sole consumer of `/v1/chat/completions`. Uses fetch + `ReadableStream` (no `EventSource` — can't carry `Authorization`). Returns typed `StreamEvent`s; throws typed `ChatCompletionFailure` on pre-stream failures only.
- Pure `parseSSE` helper next to `nanogptChat.ts` — line-buffered, permissive, exhaustively unit-tested.
- Pure `assembleOpenChatPrompt` helper. Single source-of-truth for the `'open'` mode system prompt; the `PrivacyPreview` UI imports the same constant verbatim.
- XState `chatRequestMachine` for one send lifecycle: `idle → assembling → sending → streaming → done | error | aborted`. Replay-safe at the IDB layer (user message persisted before send; assistant placeholder persisted at `sending` entry; deltas debounced-written every 80ms; `streaming: true` flag flipped on finalize; stale-stream detection on mount converts orphaned `streaming: true && createdAt < now - 30s` rows to `truncated + error: 'interrupted'`).
- Four chat hooks under `src/features/ai/chat/`: `useChatThreads`, `useChatMessages`, `useChatSend`, `useSavedAnswers`. One hook for the right-rail toggle: `useRightRailVisibility`. Same per-book-hook pattern as `useBookmarks` / `useHighlights` / `useNotes`.
- ChatPanel UI: `ChatHeader` (thread picker + new + collapse), `ThreadList` (overflow drawer for picker), `MessageList` (auto-scroll-near-bottom heuristic), `MessageBubble` (user / assistant / streaming / truncated variants), `ChatErrorBubble` (typed retry/switch-model affordances), `ChatComposer` (textarea + send + cancel, ⌘+Enter / Ctrl+Enter sends), `PrivacyPreview` (collapsed-by-default, expands inline, renders the literal prompt template), `SaveAnswerInline` (inline save form with optional commentary), `ChatEmptyState` (no-key / no-model / no-threads variants by precedence).
- Right-rail layout: `RightRail` (visible state) + `RightRailCollapsedTab` (28px edge tab when collapsed). Width fixed at 360px. Translate-based collapse animation (no width animation — avoids reader iframe reflow).
- Mobile: new `chat` tab in `MobileSheet` joining `toc | bookmarks | highlights`. Sheet expands to full-screen on tap. Mid-stream sheet dismissal does not cancel the stream — answer arrives in background; tab badge pulses when new content lands.
- Notebook (Phase 3.4) extension: `NotebookEntry` union gains `{ kind: 'savedAnswer'; savedAnswer: SavedAnswer }`; new "AI answers" filter chip; new row variant in `NotebookRow`; search includes saved-answer content + question. Saved answers sort by `createdAt` (no book-position anchor in 4.3 — Phase 4.4 will add provenance for passage-mode saves).
- Cascade-on-book-removal extends `useReaderHost.onRemoveBook`: messages-by-thread, then threads-by-book, then saved-answers-by-book.
- New monochrome SVG line icons in `src/shared/icons/`: `ChatIcon`, `SendIcon`, `StopIcon`, `SaveAnswerIcon`. Same conventions as Phase 3.4's icon set (16px default, 1.5px stroke, `currentColor`).
- E2E suite covering: empty-state precedence walkthrough, stream send with mocked SSE, mid-stream cancel + truncation, save answer + notebook surface + AI filter chip, reload-mid-stream stale detection, mobile sheet dismissal during stream, book removal cascade.
- `pnpm check` green; lint-clean; type-check-clean.
- Roadmap status block updated: `Phase 4.3 — complete (2026-05-05)`. Architecture decision-history entry under `docs/02-system-architecture.md`.

**Out of scope (deferred — see §15 for destinations):**
- Passage mode and any selection-driven context.
- Chapter, multi-excerpt, retrieval, full-book modes.
- Suggested prompts.
- Markdown / code-block rendering.
- Right-rail resize.
- Per-book persisted active-thread.
- Active-thread persistence across reloads.
- Re-generate / branch from same question with a different model.
- Token cost or pricing hint UI.
- Prompt caching breakpoints.
- Provider switcher (NanoGPT only per PRD).
- Auto-titling threads via AI summarization (4.3 derives titles from the first user message).
- Search across threads / messages.
- Export / share chat thread.

---

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Surface placement | **Right rail (desktop) + mobile sheet tab** | Matches `02-system-architecture.md` three-pane plan and `05-design-system.md` "all three panels visible by default". Right rail finally earns its place. Adjacent-to-reader is what 4.4 passage mode wants. |
| Threads per book | **Multiple, with picker UI from v1** | User explicit: chat is a "very important part of the project". Domain shape (`ChatThread.id/bookId/title`) already supports multi-thread. Single-thread would be a deliberate downgrade. |
| Context payload in 4.3 | **Book metadata only** (title, author, format) + chat history | Most honest baseline. Forces a meaningful privacy preview from day one. Additive path for 4.4/Phase 5: each subsequent phase adds layers without re-shaping the channel. The AI engine doc explicitly forbids "send the whole book" defaults. |
| Save-as-note shape | **New `SavedAnswer` entity, distinct from `Note`** | The AI engine doc requires "Clearly separate user notes from AI-generated content" and "Never show AI output as if it were a verified annotation". Overloading `Note` with an "AI" badge would blur the boundary; users glancing at the notebook would forget which words were authored vs. generated. A separate entity is the only choice that survives the rule without compromise. Snapshotting at save time also preserves provenance after thread deletion. |
| Right-rail default | **Persisted preference, defaults to visible, collapse persists** | Honors "three-pane by default" on first run; respects user choice thereafter. Mirrors the Phase 2.3 `focusMode` persistence pattern. |
| Mode field placement | **Move to `ChatMessage`, drop from `ChatThread`** | Real conversations mix modes — general → passage → general. Storing on the thread forces an artificial mode lock. Free refactor since chat domain is currently unused. Threads keep `answerStyle` (which IS thread-stable). |
| State machine | **XState `chatRequestMachine`, one instance per send** | `02-system-architecture.md` explicitly names "chat-request" as an XState flow. Single send lifecycle is the right granularity (per-thread or per-app machines would muddy ownership). |
| Stream protocol | **Async generator over `fetch + ReadableStream`** | `EventSource` can't send `Authorization`. Generator shape composes naturally with the machine's await loop. Permissive line-buffered SSE parser handles real-world variation. |
| Mid-stream cancel policy | **Save partial as `truncated: true` assistant message** | Preserves user effort; makes truncation explicit in the transcript. The user can save a truncated answer if they want — it's just shorter. |
| Replay safety | **Persist user message before send; persist streaming assistant placeholder at `sending` entry; debounced patches every 80ms; `streaming: true` flag flipped on finalize; stale-stream detection on mount** | Architecture doc requires AI requests be "replay-safe at the UI level". This is the strongest practical version: a hard-reload mid-flight surfaces the question as a retry-able interruption rather than disappearing. |
| Hook split | **Five small hooks** (`useChatThreads`, `useChatMessages`, `useChatSend`, `useSavedAnswers`, `useRightRailVisibility`) | Matches the existing `useBookmarks` / `useHighlights` / `useNotes` precedent. A single `useChat` mega-hook would exceed the file/function size warnings in `06-quality-strategy.md` and be harder to test. |
| Active-thread continuity | **Most-recently-updated thread, in-memory only** | No persisted "active thread per book" setting in v1. Easy to add if friction proves real. Simplification keeps boot-hydration small. |
| Draft thread persistence | **Drafts stay in memory until first user message succeeds** | Avoids cluttering the picker with empty threads. Title is derived from that first message (60 chars, word-boundary trim, ellipsis). |
| Empty-state precedence | **No-key → No-model → No-threads** | Each branch resolves to a settings-link or in-place CTA. Composer hidden in the no-key/no-model variants; visible in no-threads (so user can type and send to start the first thread). |
| Privacy preview source | **Imports the same `OPEN_MODE_SYSTEM_PROMPT` constant the network adapter sends** | "What we say we send" cannot diverge from "what we actually send". Snapshot-tested. |
| Markdown rendering | **Plain text in v1** | Reduces XSS surface. Honors AI engine doc's "Never show AI output as if it were a verified annotation" — a richly-formatted answer reads as more authoritative than it is. Trade-off: code-heavy answers look unfortunate; revisit in Phase 6 polish with a curated allowlist. |
| Token-explosion guard | **Soft cap: drop oldest user/assistant pair when history > 40** | Metadata-only context stays small; this prevents pathological growth while keeping the cap easy to tune. One-line notice surfaces when it kicks in. |
| Notebook integration | **Extend `NotebookEntry` union with `'savedAnswer'`; sort by `createdAt`; new "AI answers" filter chip** | Phase 3.4's union pattern is built for additive variants. No book-position anchor in 4.3 — saved answers cluster by recency. 4.4 will gain anchors when passage mode lands; the row will then surface "jump to passage". |
| Cascade order on book removal | **Messages-by-thread → threads-by-book → saved-answers-by-book** | Children before parents inside `deleteByBook` to avoid orphan messages if interrupted. Saved answers are independent (snapshots); deleted last. |
| Commit shape | **Approach 2 — same scope, sliced into ~24 reviewable commits** | Mirrors how Phase 3.x phases were built. Each commit compiles + passes `pnpm check`. Easy to revert any one slice. |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ ReaderWorkspace (extended)                                          │
│  ├─ DesktopRail            [existing]                               │
│  ├─ ReaderView             [existing]                               │
│  └─ RightRail              NEW (visible iff rightRailVisible)       │
│       └─ ChatPanel         NEW                                       │
│            ├─ ChatHeader   (thread picker + new + collapse)         │
│            ├─ MessageList  (role=log aria-live=polite)              │
│            │   ├─ MessageBubble × N                                  │
│            │   └─ ChatErrorBubble (when failure set)                │
│            ├─ PrivacyPreview                                        │
│            └─ ChatComposer                                          │
│  OR (when collapsed)                                                │
│  └─ RightRailCollapsedTab  NEW (28px edge tab)                      │
│                                                                      │
│ MobileSheet [existing]: tabs = toc | bookmarks | highlights | chat  │
└─────────────────────────────────────────────────────────────────────┘

┌─ State / data flow ─────────────────────────────────────────────────┐
│                                                                      │
│  ChatPanel                                                           │
│   ├─ useChatThreads({ bookId, threadsRepo })                         │
│   │    list + activeId + draft + setActive/start/rename/remove       │
│   ├─ useChatMessages({ threadId, messagesRepo })                     │
│   │    list + append + patch (debounced) + finalize                  │
│   ├─ useChatSend({ threadId, modelId, getApiKey, book, history,      │
│   │                append, patch, finalize })                        │
│   │    state + partial + failure + send/cancel/retry                 │
│   │       └─ wraps chatRequestMachine (XState)                       │
│   │            └─ streamChatCompletion(req)  ─async generator─       │
│   │                 └─ fetch /v1/chat/completions  + parseSSE        │
│   └─ useSavedAnswers({ bookId, savedAnswersRepo })                   │
│        list + add + remove + update                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌─ Persistence (IndexedDB v6) ────────────────────────────────────────┐
│ chat_threads     key=ChatThreadId   indexes: by-book, by-updated    │
│ chat_messages    key=ChatMessageId  indexes: by-thread              │
│ saved_answers    key=SavedAnswerId  indexes: by-book, by-message    │
│ settings         (existing)         + chatPanelHintShown variant    │
│ reader_preferences (existing)       + rightRailVisible field        │
└──────────────────────────────────────────────────────────────────────┘
```

Functional-core / imperative-shell split per `06-quality-strategy.md`:

- **Pure (testable without I/O):** `parseSSE`, `assembleOpenChatPrompt`, `chatRequestMachine` transitions, message-list ordering, empty-state precedence, soft-cap dropping, validating-read normalizers.
- **Side-effectful (adapter / hook layer):** `streamChatCompletion` (network), repos (IDB), hooks (React + repos), `ChatPanel` composition.

---

## 4. Domain model

### 4.1 `ChatMode` union — extend

```ts
// src/domain/ai/types.ts
export type ChatMode =
  | 'open'           // NEW — Phase 4.3: book metadata + chat history, no excerpt/chapter context
  | 'passage'        // existing — Phase 4.4
  | 'chapter'        // existing — Phase 5
  | 'multi-excerpt'  // existing — Phase 5
  | 'retrieval'      // existing — Phase 5
  | 'full-book';     // existing — Phase 7+
```

### 4.2 `ChatThread` — `mode` removed; `answerStyle` retained

```ts
export type ChatThread = {
  readonly id: ChatThreadId;
  readonly bookId: BookId;
  readonly title: string;          // derived from first user message; user-editable
  readonly modelId: string;        // snapshot at thread creation; user can switch later
  readonly answerStyle: AnswerStyle;  // 'open' for v1 (only `'open'` answer-style ships in 4.3)
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
};
```

### 4.3 `ChatMessage` — `mode` added; `streaming` + `truncated` + `error` flags added

```ts
export type ChatMessage = {
  readonly id: ChatMessageId;
  readonly threadId: ChatThreadId;
  readonly role: ChatRole;
  readonly content: string;
  readonly mode?: ChatMode;          // NEW — present on user/assistant pairs; omitted for system messages
  readonly contextRefs: readonly ContextRef[];
  readonly usage?: TokenUsage;
  readonly streaming?: boolean;       // NEW — true while in-flight; cleared on finalize
  readonly truncated?: boolean;       // NEW — set when user cancelled mid-stream
  readonly error?: 'interrupted' | 'failed';  // NEW — set on machine error or stale-stream detection
  readonly createdAt: IsoTimestamp;
};
```

### 4.4 `SavedAnswer` — new

```ts
// src/domain/ids.ts: add SavedAnswerId branded type
export type SavedAnswerId = Brand<string, 'SavedAnswerId'>;

// src/domain/ai/types.ts
export type SavedAnswer = {
  readonly id: SavedAnswerId;
  readonly bookId: BookId;
  readonly threadId: ChatThreadId;     // reference; thread may be deleted later
  readonly messageId: ChatMessageId;    // reference; message may be deleted later
  readonly modelId: string;             // snapshot — what model produced this
  readonly mode: ChatMode;               // snapshot of message mode
  readonly content: string;              // snapshot of assistant message content
  readonly question: string;             // first 240 chars of the user message that prompted it
  readonly contextRefs: readonly ContextRef[];  // snapshot of provenance (empty in 4.3)
  readonly userNote?: string;            // optional commentary the user added at save time
  readonly createdAt: IsoTimestamp;
};
```

Snapshotting `content`, `question`, `modelId`, `mode`, `contextRefs` ensures saved answers survive thread/message deletion.

### 4.5 `ReaderPreferences` — `rightRailVisible` added

Forward-compatible validator soften (same pattern as Phase 2.3 `focusMode` and Phase 2.2 `modeByFormat`). No DB schema bump.

```ts
export type ReaderPreferences = {
  // existing fields…
  readonly rightRailVisible: boolean;  // NEW — defaults to true on first read; forward-compat normalize
};
```

---

## 5. Storage

### 5.1 Migration v5 → v6

Additive only — no surgery on existing data. Idempotent for re-open at v6. Three new stores created via `createObjectStore`; existing stores untouched. Older builds (still on v5) ignore stores they don't know about per `idb` semantics; if a user reverts to a v5 build, the v6 stores remain intact and become visible again when they upgrade.

```ts
// src/storage/db/migrations.ts (extended)
export const migrationStepV6 = (db: IDBPDatabase<BookwormDBSchema>): void => {
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
};
```

`migrations.test.ts` extends with: open at v5 with seeded books/highlights/notes, run migration, assert (a) all three new stores exist, (b) all v5 data intact, (c) re-running v6 step is a no-op.

### 5.2 Repositories

Three new repos following the validating-reads pattern from `bookmarks.ts` / `highlights.ts` / `notes.ts`. Each has a soft `normalize{Type}` helper that drops malformed records silently (corrupt records never break list queries).

**`src/storage/repositories/chatThreads.ts`** — `getById`, `getByBook(bookId)` (uses `by-book` index, sorted by `by-updated` descending), `upsert(thread)` (uses `put` so `updatedAt` patches don't break invariants), `delete(id)`, `deleteByBook(bookId)`.

**`src/storage/repositories/chatMessages.ts`** — `getById`, `getByThread(threadId)` (uses `by-thread` index, sorted by `createdAt` ascending), `upsert(msg)`, `delete(id)`, `deleteByThread(threadId)`.

**`src/storage/repositories/savedAnswers.ts`** — `getById`, `getByBook(bookId)`, `getByMessage(messageId)`, `upsert(saved)`, `delete(id)`, `deleteByBook(bookId)`.

Each repo has a `.test.ts` covering: round-trip, normalizer drops bad records, indexed queries return correct order, cascade methods delete only the right scope, empty-store edge cases.

### 5.3 Settings extensions

- `SettingsRecord` gains `{ key: 'chatPanelHintShown'; value: boolean }`.
- `SettingsRepository` gains `getChatPanelHintShown()` / `setChatPanelHintShown(value)`.
- `ReaderPreferences` gains `rightRailVisible: boolean` via the existing forward-compat normalizer in `readerPreferencesRepo`.

### 5.4 Cascade chain (additive in `useReaderHost.onRemoveBook`)

Existing chain in 3.4 ends with `notesRepo.deleteByBook` after highlights cascade. 4.3 appends:

```
1. Load thread ids for the book: const threads = await chatThreadsRepo.getByBook(bookId)
2. For each thread: chatMessagesRepo.deleteByThread(thread.id)
3. chatThreadsRepo.deleteByBook(bookId)
4. savedAnswersRepo.deleteByBook(bookId)
```

If any step fails, the chain bails (errors propagate to the caller). Best-effort retry is left to the user (re-attempting "remove book" is idempotent because all `delete*` operations tolerate missing keys).

---

## 6. Network adapter & state machine

### 6.1 `parseSSE` (pure)

```ts
// src/features/ai/chat/parseSSE.ts
export type ParsedSSEEvent =
  | { kind: 'data'; data: string }   // raw `data:` line content (still JSON-encoded)
  | { kind: 'done' };                  // sentinel for `data: [DONE]`

export type SSEParseResult = {
  readonly events: readonly ParsedSSEEvent[];
  readonly remainder: string;          // bytes not yet a full event; pass back next call
};

export function parseSSE(chunk: string, buffered: string): SSEParseResult;
```

Permissive: tolerates `\r\n` and `\n`, ignores comment lines starting with `:`, ignores unknown field types, joins multi-line `data:` continuations per the SSE spec. Skips blank lines that aren't event terminators. Returns the unconsumed remainder of the chunk for re-buffering.

Test coverage: see §11.

### 6.2 `streamChatCompletion` (async generator)

```ts
// src/features/ai/chat/nanogptChat.ts
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
  | { kind: 'delta'; text: string }
  | { kind: 'usage'; prompt: number; completion: number; cached?: number }
  | { kind: 'done' };

export type ChatCompletionFailure =
  | { reason: 'invalid-key'; status: 401 | 403 }
  | { reason: 'rate-limit'; status: 429; retryAfterSeconds?: number }
  | { reason: 'model-unavailable'; status: 404 | 400 }
  | { reason: 'server'; status: number }
  | { reason: 'network' }
  | { reason: 'aborted' }
  | { reason: 'malformed-stream' };

export async function* streamChatCompletion(
  req: ChatCompletionRequest
): AsyncGenerator<StreamEvent>;
```

- POST to `/v1/chat/completions` with `Authorization: Bearer <apiKey>`, body `{ model, messages, stream: true }`.
- Pre-stream failures (status non-200 before body reads) throw a typed `ChatCompletionFailure` (caught by the machine).
- Once streaming, each delta extracted from `choices[0].delta.content` is yielded as `{ kind: 'delta', text }`.
- `usage` from the final chunk (if present) yields as `{ kind: 'usage', ... }`.
- `data: [DONE]` yields `{ kind: 'done' }`.
- On `AbortError` (signal aborted), the generator returns silently — the machine handles transition.
- On a malformed stream (parser exhaustion, unexpected EOF mid-event), throws `ChatCompletionFailure` with `reason: 'malformed-stream'`.

### 6.3 `assembleOpenChatPrompt` (pure)

```ts
// src/features/ai/chat/promptAssembly.ts
export const HISTORY_SOFT_CAP = 40;  // pairs; oldest dropped beyond this

export const buildOpenModeSystemPrompt = (book: {
  readonly title: string;
  readonly author?: string;
}): string => /* template literal — exported for PrivacyPreview to render verbatim */;

export type AssembleOpenChatInput = {
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly history: readonly ChatMessage[];   // oldest first
  readonly newUserText: string;
};

export type AssembleOpenChatResult = {
  readonly messages: readonly ChatCompletionMessage[];
  readonly historyDropped: number;            // 0 if under cap
};

export function assembleOpenChatPrompt(input: AssembleOpenChatInput): AssembleOpenChatResult;
```

The system prompt copy:

> You are helping a reader discuss the book "{title}" by {author}. The user has not selected any passages or chapters; you have only the book's title and author. Answer carefully — when discussing book contents, distinguish between what the title strongly implies and what you actually have evidence for. If the user asks about specifics, say plainly that no excerpts are attached and offer to help once they share a passage. Do not pretend to have read the book.

(Exact wording finalized at implementation time; tests assert structural properties — book title and author present, "no excerpts" disclaimer present — rather than verbatim string match, so minor wording refinement doesn't break the suite.)

### 6.4 `chatRequestMachine` (XState v5)

```
┌──────────┐  SEND   ┌────────────┐
│   idle   │────────▶│ assembling │
└──────────┘         └─────┬──────┘
                           │ (sync, on entry runs assembleOpenChatPrompt)
                           ▼
                     ┌────────────┐  CANCEL          ┌──────────┐
                     │  sending   │─────────────────▶│ aborted  │
                     │ (awaiting  │                  └──────────┘
                     │  first byte)                       ▲
                     └─────┬──────┘                       │
                           │ first delta arrives          │ CANCEL
                           ▼                              │
                     ┌────────────┐  CANCEL              │
                     │ streaming  │──────────────────────┘
                     │ (deltas    │
                     │  appended) │
                     └─────┬──────┘
                           │ DONE
                           ▼
                     ┌────────────┐
                     │    done    │  (final state)
                     └────────────┘

   Any state can transition to:
                     ┌────────────┐
                     │   error    │ ← FAIL (typed failure)
                     └────────────┘  (final state)
                          │ RETRY → assembling
```

**Context:**
```ts
type Ctx = {
  threadId: ChatThreadId;
  pendingUserMessageId: ChatMessageId;
  pendingAssistantMessageId: ChatMessageId;
  modelId: string;
  partial: string;                       // accumulating assistant text
  usage?: TokenUsage;
  failure?: ChatCompletionFailure;
  abort: AbortController;
};
```

**Side effects (invocations):**
- On `assembling` entry: pure prompt assembly. Sync transition to `sending`.
- On `sending` entry: invoke `streamChatCompletion`. The first event triggers transition to `streaming` (which is `sending`'s successor — no separate "first-byte" state needed, just an internal "any delta seen" flag).
- During `streaming`: each `delta` event mutates `ctx.partial` and triggers a `patch` callback to the React layer (debounced separately by the hook).
- On `done`: flushes any pending debounced patch, calls `finalize` with full content + usage. Final state.
- On `error`: calls `finalize` with `{ error: 'failed' }` on the assistant message; surfaces failure to the React layer.
- On `aborted`: calls `finalize` with `{ truncated: true }` if `partial.length > 0`, else deletes the empty placeholder.

**Guarantees:**
- User message persisted before machine starts (caller responsibility — the hook does this in `send()`).
- Assistant placeholder persisted at `sending` entry with `streaming: true`. Visible immediately in the UI.
- All exits flip `streaming: false` and clear the placeholder's transient flags.

### 6.5 Replay safety on mount

`useChatMessages` runs `loadByThread`, then for each message with `streaming: true && createdAt < now - 30s`, calls `messagesRepo.upsert({ ...msg, streaming: false, truncated: true, error: 'interrupted' })` *before* exposing the list. The 30s threshold avoids races with active streams from the same session (which would have a fresh `createdAt`).

---

## 7. Hooks & stores

No new global Zustand stores. `apiKeyStore` and `modelCatalogStore` (Phase 4.1, 4.2) are reused; both already expose synchronous accessors (`getCurrentApiKey()`, `getCurrentSelectedModelId()`) for non-React consumers.

### 7.1 `useChatThreads({ bookId, threadsRepo })`

```ts
{
  list: readonly ChatThread[];                             // sorted by updatedAt desc
  activeId: ChatThreadId | null;                            // most-recently-updated by default
  draft: { tempId: string; modelId: string } | null;        // unpersisted "new conversation"
  setActive: (id: ChatThreadId) => void;
  startDraft: (modelId: string) => void;
  rename: (id: ChatThreadId, title: string) => Promise<void>;
  remove: (id: ChatThreadId) => Promise<void>;
}
```

Optimistic CRUD with rollback (`useBookmarks` precedent). `remove` is the one that owns the cascade-within-thread (`messagesRepo.deleteByThread` → then `threadsRepo.delete`). Saved answers are NOT cascaded by thread deletion — they are independent snapshots.

### 7.2 `useChatMessages({ threadId, messagesRepo })`

```ts
{
  list: readonly ChatMessage[];                            // sorted by createdAt asc
  append: (msg: ChatMessage) => Promise<void>;             // adds + persists
  patch: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;  // debounced 80ms
  finalize: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;  // immediate + cancels pending patch
}
```

Re-keyed on `threadId` change (parent passes `key={activeId}` to ChatPanel's children that use this hook). Stale-stream detection runs on first load (§6.5).

### 7.3 `useChatSend({ threadId, modelId, getApiKey, book, history, append, patch, finalize })`

```ts
{
  state: 'idle' | 'sending' | 'streaming' | 'error' | 'aborted';
  partial: string;
  failure: ChatCompletionFailure | null;
  send: (userText: string) => void;
  cancel: () => void;
  retry: () => void;
}
```

Internally instantiates a `chatRequestMachine`. On `send`: persists the user message (via `append`), creates the assistant placeholder (via `append` with `streaming: true`), starts the machine. On `cancel`: aborts the in-flight signal. On unmount (e.g., thread switch): aborts any in-flight signal so orphan streams aren't wasted.

### 7.4 `useSavedAnswers({ bookId, savedAnswersRepo })`

Mirrors `useNotes` shape. `list`, `add(snapshot, userNote?)`, `remove(id)`, `update(id, fields)`. Used by `SaveAnswerInline` for writes and by the notebook for reads.

### 7.5 `useRightRailVisibility({ initial, onChange })`

Identical pattern to Phase 2.3's `useFocusMode`. Boolean state; toggle persists via `onChange` to `readerPreferencesRepo`.

---

## 8. UI surfaces

### 8.1 Module layout

```
src/features/ai/chat/
  index.ts                       (barrel)
  nanogptChat.ts (+test)
  parseSSE.ts (+test)
  promptAssembly.ts (+test)
  chatRequestMachine.ts (+test)
  useChatThreads.ts (+test)
  useChatMessages.ts (+test)
  useChatSend.ts (+test)
  useSavedAnswers.ts (+test)
  ChatPanel.tsx (+test)
  ChatHeader.tsx (+test)
  ThreadList.tsx (+test)
  MessageList.tsx (+test)
  MessageBubble.tsx (+test)
  ChatComposer.tsx (+test)
  PrivacyPreview.tsx (+test)
  SaveAnswerInline.tsx (+test)
  ChatEmptyState.tsx (+test)
  ChatErrorBubble.tsx (+test)
  chat-panel.css
  message-bubble.css
  chat-composer.css
  thread-list.css

src/features/reader/workspace/
  RightRail.tsx (+test)              NEW
  RightRailCollapsedTab.tsx (+test)  NEW
  useRightRailVisibility.ts (+test)  NEW
  right-rail.css                      NEW
```

### 8.2 `ChatPanel` — composition

Owns the four `useChat*` hooks. Composes:

```
<ChatHeader … />
<MessageList … >
  {messages.map(MessageBubble)}
  {failure && <ChatErrorBubble … />}
</MessageList>
<PrivacyPreview … />
<ChatComposer … />
```

When the empty state fires (no key / no model / no threads), `MessageList` is replaced with `ChatEmptyState`; the composer remains visible only in the no-threads variant.

### 8.3 Component contracts (essential)

**`ChatHeader`** — current thread title + chevron → opens `ThreadList` overlay. "+" button starts a draft. Collapse "›" (desktop) / Close "✕" (mobile). Rename via inline edit on title double-click. Delete via `ThreadList` row hover.

**`ThreadList`** — overlay listbox. Each row: title + relative time + delete-on-hover. Arrow-key navigation. Click selects + closes overlay.

**`MessageList`** — `role="log" aria-live="polite"`. Auto-scroll-to-bottom only when user is within 80px of the bottom (preserves intentional upward scroll during stream). Reduced-motion: skips bubble entry animation.

**`MessageBubble`** — discriminated render:
- `role === 'user'` → right-aligned, accent token bg, plain text, no controls.
- `role === 'assistant' && !streaming && !truncated && !error` → left-aligned, surface token bg, plain text, footer with `[Save]` + relative timestamp + "AI" microbadge.
- streaming → same shape; calm pulsing caret at end (4px, currentColor, opacity 0.4↔1.0 over 1.4s); no Save button.
- truncated → footer adds `(stopped)` italic; Save button still present.
- `error` → not rendered; `ChatErrorBubble` renders in its place.

**`ChatComposer`** — auto-grow textarea (max 6 lines). Send button → cancel button when `state ∈ {sending, streaming}`. ⌘+Enter / Ctrl+Enter triggers send (or cancel when streaming). Enter alone newlines. Disabled in no-key/no-model variants (composer hidden in those, this is fallback only).

**`PrivacyPreview`** — collapsed: single line "ⓘ Sending: title and author + your messages". Expanded: renders `buildOpenModeSystemPrompt(book)` verbatim, message count, selected model id. Snapshot-tested against the same constant used by the network adapter.

**`SaveAnswerInline`** — bubble expands to reveal optional-commentary textarea + Save / Cancel buttons. On save: calls `useSavedAnswers.add(snapshot, userNote)`; collapses; bubble footer shows "Saved → notebook" microconfirmation that auto-fades after 2s.

**`ChatEmptyState`** — three variants picked by precedence (no-key → no-model → no-threads). Each variant has its own copy and primary CTA.

**`ChatErrorBubble`** — typed copy + actions per `ChatCompletionFailure.reason`:
- `invalid-key` → "Your API key was rejected." [Open Settings]
- `rate-limit` → "Rate limited by NanoGPT." [Retry] (auto-retry hint after `retryAfterSeconds` if present)
- `model-unavailable` → "The selected model isn't available." [Switch Model]
- `network` → "No connection." [Retry]
- `server` → "NanoGPT had an issue (status N)." [Retry] [Switch Model]
- `malformed-stream` → "The response stream couldn't be parsed." [Retry]
- `aborted` → not surfaced as error; truncated message stands as its own row.

Switch Model opens an inline model picker sourced from `modelCatalogStore`. Picking one updates the thread's `modelId` (persists via `chatThreadsRepo.upsert`) and immediately retries.

### 8.4 Right-rail layout

**Desktop:** `[ DesktopRail 320px | ReaderView flex | RightRail 360px ]`. When `rightRailVisible === false`, the rail unmounts and `RightRailCollapsedTab` (28px vertical strip on the right edge) takes its place. Collapse animation: translate-only, 240ms ease-out, GPU-only (no width animation — width changes reflow the foliate iframe).

**Mobile:** `MobileSheet` tab `chat` joins `toc | bookmarks | highlights`. Tap-to-expand-fullscreen. Mid-stream sheet dismissal does NOT cancel the stream (the `useChatSend` instance lives in `ChatPanel`, which lives in `MobileSheet`'s render tree — so dismiss-as-close would unmount the hook). Implementation: keep `ChatPanel` mounted in the sheet's render output even when the sheet is collapsed; the sheet closes by transform, not by unmount. Tab badge pulses (single 600ms scale-1.06) when a delta arrives while the sheet is collapsed; static "•" dot persists until the sheet is reopened.

### 8.5 Visual & motion conformance

- All colors from existing `tokens.ts`. Assistant bubbles use the existing surface token; user bubbles use the existing accent token at reduced opacity.
- Streaming caret is the only continuous animation; everything else is one-shot.
- Bubble entry: 8px translate-y + opacity 0→1, 200ms ease-out. Skipped under reduced-motion.
- New icons (`ChatIcon`, `SendIcon`, `StopIcon`, `SaveAnswerIcon`) authored in the Phase 3.4 style: 16px default, 1.5px stroke, `currentColor`, ~30 LoC each.

### 8.6 Accessibility

- `MessageList` is `role="log" aria-live="polite"`. New assistant messages announce calmly at finalize, not per-token (`aria-busy="true"` during stream).
- Thread picker is a combobox-pattern button + listbox.
- Composer textarea has `aria-label="Ask about {book title}"`.
- Right-rail collapse button has `aria-expanded`.
- All interactive elements have visible focus rings using the existing focus token.
- Keyboard navigation: Tab through composer → privacy preview → message list (with arrow-key navigation through bubbles for the [Save] buttons).
- Reduced-motion respected via `prefers-reduced-motion: reduce` everywhere.

### 8.7 First-time hint

A small dismissible tip the first time the chat panel renders (any branch other than no-key — i.e., once chat is actually usable): "Selected text becomes context in 4.4 — for now, ask about the book in general." Stored in settings as `chatPanelHintShown: boolean`. Persists on first dismissal. Mirrors Phase 2.3's `focusModeHintShown`.

---

## 9. Cross-feature integration

### 9.1 `App.tsx` & `useReaderHost.ts`

- `createWiring(db)` returns three additional repos: `chatThreadsRepo`, `chatMessagesRepo`, `savedAnswersRepo`.
- Boot reads `prefs.rightRailVisible` (already part of the parallel `Promise.all` for prefs). No new boot reads beyond that.
- `useReaderHost.onRemoveBook` extends with the cascade chain from §5.4.
- `ReaderWorkspace` receives the three new repos as props.

### 9.2 Notebook (Phase 3.4) extension

`NotebookEntry` discriminated union in `useNotebook.ts` expands:

```ts
export type NotebookEntry =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'highlight'; highlight: Highlight; note: Note | null }
  | { kind: 'savedAnswer'; savedAnswer: SavedAnswer };  // new
```

- `useNotebook` composes a fourth repo (`savedAnswersRepo`) in the parallel load.
- `compareNotebookEntries` extends: saved answers compare by `createdAt` against each other; mixed-kind comparisons (savedAnswer vs bookmark/highlight) fall back to `createdAt` (since saved answers have no book-position anchor in 4.3).
- `matchesQuery` extends to include `savedAnswer.question + savedAnswer.content + savedAnswer.userNote` in the search corpus.
- `matchesFilter` extends with a new `'ai'` filter value.
- `NotebookSearchBar` adds an "AI answers" chip alongside the existing chips.
- `NotebookRow` gains a `savedAnswer` variant: question as title (truncated), answer body (3 lines, click-to-expand), user note below if present, model id + relative time in meta. No jump-to-passage in 4.3 (no anchor); 4.4 will add provenance jumps when `contextRefs` are non-empty.

### 9.3 Settings

`SettingsRepository` gains `getChatPanelHintShown()` / `setChatPanelHintShown(value)`. `ReaderPreferences` validator adds the `rightRailVisible` default (forward-compat).

### 9.4 Icons

Added to `src/shared/icons/`: `ChatIcon`, `SendIcon`, `StopIcon`, `SaveAnswerIcon`. Tested visually against the existing Phase 3.4 set for stroke consistency.

---

## 10. Privacy & accessibility

### 10.1 Privacy doctrine

The user can always see exactly what we're about to send. `PrivacyPreview` imports `buildOpenModeSystemPrompt` from `promptAssembly.ts` — the same function the network adapter calls. A snapshot test asserts the rendered preview text equals the assembled system prompt for a given book. This is what makes "no hidden uploads" credible: a refactor to the prompt updates the UI in lockstep, with tests catching divergence.

The assistant-message footer always shows model id + timestamp. The "AI" microbadge is small but always present so a glance never confuses generated text with the user's own writing. Saved answers preserve all of this (model snapshot, content snapshot, question snapshot) so the notebook is honest even years later.

### 10.2 Accessibility floor (per `06-quality-strategy.md`)

- **Keyboard:** every interaction reachable; focus order = composer → privacy preview → bubbles (with [Save] buttons reachable via arrow keys) → header.
- **Screen reader:** `role="log" aria-live="polite"` for streaming; assistant message announced once on finalize, not per-token.
- **Visible focus:** existing focus token, AA-contrast against all backgrounds in dark and light themes.
- **Touch targets:** ≥ 44×44 CSS px for all chat controls (composer, send/cancel button, Save button, collapse/close, thread row).
- **Reduced motion:** every entry animation guarded by `prefers-reduced-motion: reduce`. Streaming caret remains (calm enough to qualify as functional indicator, not decoration).

---

## 11. Testing strategy

### 11.1 Unit (Vitest)

- `parseSSE`: line buffering, `[DONE]` sentinel, `\r\n` and `\n` tolerance, blank lines, `:` comment lines, multi-line `data:` continuations, malformed JSON, partial chunks split mid-line, multiple events per chunk, empty input, trailing remainder.
- `streamChatCompletion`: feed a `ReadableStream` from a fixture; assert event sequence; cancellation; pre-stream failures (401/403/429/404/400/500/network); `malformed-stream` on truncated body.
- `assembleOpenChatPrompt`: book with author, book without author, empty history, history at cap, history above cap (drop count correct), system prompt contains title and author and "no excerpts" disclaimer.
- `chatRequestMachine`: every transition exercised — send→assembling→sending→streaming→done; cancel from each cancellable state; retry from error; failure routes for each `ChatCompletionFailure.reason`; aborted-with-partial vs aborted-empty distinguish placeholder finalize.
- All three new repos: round-trip, normalizer drops corrupt records, indexed queries return correct order, cascade methods (`deleteByBook`, `deleteByThread`) delete only the right scope, missing-key tolerance.
- v6 migration: open at v5 with seeded data, run, assert new stores exist + old data intact + idempotent re-run.
- `useChatThreads`, `useChatMessages`, `useChatSend`, `useSavedAnswers`: RTL `renderHook` with in-memory repo fakes; rollback on repo failure; debounce-flush-on-finalize; thread-switch unmount aborts.
- `useRightRailVisibility`: persists on toggle.

### 11.2 Component (RTL)

- `MessageBubble` variants (user, assistant, streaming, truncated, error-routes-to-ErrorBubble).
- `ChatComposer`: send/cancel modes; ⌘+Enter / Ctrl+Enter; disabled states; auto-grow.
- `ChatEmptyState` precedence: no-key beats no-model beats no-threads; correct CTAs.
- `ChatErrorBubble`: each reason renders the right copy and the right actions; Switch Model picker integrates with `modelCatalogStore`.
- `PrivacyPreview`: collapsed/expanded; snapshot test asserts content matches `buildOpenModeSystemPrompt(book)`.
- `ChatHeader`: thread picker open/close, switch, rename inline, new draft.
- `ThreadList`: row hover delete, arrow keys, escape closes.
- `SaveAnswerInline`: open form, save with note, save without note, microconfirmation fades.
- `ChatPanel`: composes everything; renders correct branch per state; cascade unmount on rail collapse aborts in-flight stream.

### 11.3 E2E (Playwright)

`tests/e2e/chat.spec.ts` with route-intercepted `/v1/chat/completions` returning canned SSE chunks from `tests/e2e/fixtures/nanogpt-chat-stream.txt` (versioned per the project's golden fixture rules).

Specs:
- Empty-state precedence walkthrough: open book, expand right rail, see no-key state, navigate to settings, enter key, return, see no-model state, pick a model, see no-threads state.
- Send a message with a mocked stream; assert streaming caret visible; assert final content; assert assistant message persisted (reload → still there).
- Cancel mid-stream; assert truncated marker and Save button still present.
- Save an answer with optional commentary; navigate to notebook; assert savedAnswer entry visible; toggle "AI answers" filter chip and assert only saved answers visible.
- Reload while a stream is "in flight" (mock holds open); assert assistant message in IDB has `streaming: true`; reload the app; assert the assistant message is now `truncated: true; error: 'interrupted'`; click Retry; new stream succeeds.
- Mobile viewport: open chat sheet, send a message, dismiss sheet mid-stream, reopen, assert answer arrived; tab badge pulse seen during dismiss.
- Remove a book that has chat threads + messages + saved answers; assert all three stores have nothing for that book.

### 11.4 Quality gate

Every commit (per Approach 2's slicing) must pass `pnpm check` (type-check + lint + unit/component tests). E2E run is in the final commit before the docs-update commit.

---

## 12. File map

### 12.1 New (~32 source files + ~20 test files + 1 E2E spec + 1 fixture)

```
src/domain/ids.ts                                       (extend — SavedAnswerId)
src/domain/ai/types.ts                                  (extend — ChatMode, ChatThread, ChatMessage, SavedAnswer)
src/domain/index.ts                                     (extend — exports if needed)

src/storage/db/schema.ts                                (extend — v6 + new stores + chatPanelHintShown variant)
src/storage/db/migrations.ts                            (extend — v6 step)
src/storage/db/migrations.test.ts                       (extend — v6 spec)
src/storage/repositories/chatThreads.ts
src/storage/repositories/chatThreads.test.ts
src/storage/repositories/chatMessages.ts
src/storage/repositories/chatMessages.test.ts
src/storage/repositories/savedAnswers.ts
src/storage/repositories/savedAnswers.test.ts
src/storage/repositories/settings.ts                    (extend — chatPanelHintShown)
src/storage/repositories/settings.test.ts               (extend)
src/storage/repositories/readerPreferences.ts           (extend — rightRailVisible)
src/storage/repositories/readerPreferences.test.ts      (extend)
src/storage/index.ts                                    (extend — barrel)

src/features/ai/chat/index.ts
src/features/ai/chat/parseSSE.ts (+test)
src/features/ai/chat/nanogptChat.ts (+test)
src/features/ai/chat/promptAssembly.ts (+test)
src/features/ai/chat/chatRequestMachine.ts (+test)
src/features/ai/chat/useChatThreads.ts (+test)
src/features/ai/chat/useChatMessages.ts (+test)
src/features/ai/chat/useChatSend.ts (+test)
src/features/ai/chat/useSavedAnswers.ts (+test)
src/features/ai/chat/ChatPanel.tsx (+test)
src/features/ai/chat/ChatHeader.tsx (+test)
src/features/ai/chat/ThreadList.tsx (+test)
src/features/ai/chat/MessageList.tsx (+test)
src/features/ai/chat/MessageBubble.tsx (+test)
src/features/ai/chat/ChatComposer.tsx (+test)
src/features/ai/chat/PrivacyPreview.tsx (+test)
src/features/ai/chat/SaveAnswerInline.tsx (+test)
src/features/ai/chat/ChatEmptyState.tsx (+test)
src/features/ai/chat/ChatErrorBubble.tsx (+test)
src/features/ai/chat/chat-panel.css
src/features/ai/chat/message-bubble.css
src/features/ai/chat/chat-composer.css
src/features/ai/chat/thread-list.css

src/features/reader/workspace/RightRail.tsx (+test)
src/features/reader/workspace/RightRailCollapsedTab.tsx (+test)
src/features/reader/workspace/useRightRailVisibility.ts (+test)
src/features/reader/workspace/right-rail.css

src/features/annotations/notebook/useNotebook.ts        (extend — savedAnswers)
src/features/annotations/notebook/NotebookRow.tsx       (extend — savedAnswer variant)
src/features/annotations/notebook/NotebookSearchBar.tsx (extend — AI chip)
src/features/annotations/notebook/compareNotebookEntries.ts (extend +test)
src/features/annotations/notebook/matchesQuery.ts       (extend +test)
src/features/annotations/notebook/matchesFilter.ts      (extend +test)

src/shared/icons/ChatIcon.tsx
src/shared/icons/SendIcon.tsx
src/shared/icons/StopIcon.tsx
src/shared/icons/SaveAnswerIcon.tsx

src/app/App.tsx                                         (extend — new repos)
src/app/useReaderHost.ts                                (extend — cascade)
src/features/library/wiring.ts                          (extend)

tests/e2e/chat.spec.ts
tests/e2e/fixtures/nanogpt-chat-stream.txt
```

### 12.2 Modified

```
docs/04-implementation-roadmap.md                       (status block — Phase 4.3 complete)
docs/02-system-architecture.md                          (decision-history entry)
src/features/reader/workspace/ReaderWorkspace.tsx       (RightRail + new props)
src/features/reader/workspace/MobileSheet.tsx           (new chat tab)
```

---

## 13. Commit slicing (Approach 2)

Each commit independently compiles, lints, and passes `pnpm check`.

1. `feat(domain): chat — extend types, add SavedAnswer, move mode to message`
2. `feat(storage): v6 migration — chat_threads, chat_messages, saved_answers stores`
3. `feat(storage): chatThreads / chatMessages / savedAnswers repositories`
4. `feat(storage): rightRailVisible reader pref + chatPanelHintShown setting`
5. `feat(ai): parseSSE — pure SSE event parser`
6. `feat(ai): nanogptChat — streaming chat completions adapter`
7. `feat(ai): promptAssembly — open-mode system prompt builder`
8. `feat(ai): chatRequestMachine — XState machine for one send lifecycle`
9. `feat(ai): useChatThreads / useChatMessages / useChatSend / useSavedAnswers hooks`
10. `feat(icons): ChatIcon, SendIcon, StopIcon, SaveAnswerIcon`
11. `feat(reader): useRightRailVisibility hook + persistence`
12. `feat(reader): RightRail + RightRailCollapsedTab — workspace integration`
13. `feat(chat): ChatEmptyState (no-key / no-model / no-threads variants)`
14. `feat(chat): MessageBubble + ChatErrorBubble + streaming caret`
15. `feat(chat): MessageList — auto-scroll-near-bottom`
16. `feat(chat): ChatHeader + ThreadList — picker, rename, new, delete`
17. `feat(chat): ChatComposer — textarea, send, cancel, ⌘+Enter`
18. `feat(chat): PrivacyPreview — verbatim system prompt`
19. `feat(chat): SaveAnswerInline + first-time hint`
20. `feat(chat): ChatPanel — composes everything`
21. `feat(notebook): savedAnswer entry kind + AI filter chip`
22. `feat(app): wire chat repos + cascade + mobile sheet tab`
23. `test(e2e): chat — open/send/cancel/save/reload/remove suite`
24. `docs: Phase 4.3 — architecture decision + roadmap status complete`

---

## 14. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scope size (~32 source files, ~24 commits) | Larger than any prior phase; review fatigue | Approach 2 slicing — each commit small, focused, independently green |
| NanoGPT SSE stream may have quirks vs OpenAI spec | Parser fails on real responses | Permissive parser; capture a real stream into the E2E fixture during first live test; permissiveness already absorbs `\r\n`, blank lines, comment lines, unknown fields |
| `'open'` mode + no real grounding means UX expectation gap | User may expect "ask the book anything" | First-time hint copy explicitly mentions "Selected text becomes context in 4.4"; system prompt itself disclaims the lack of excerpts; privacy preview is honest |
| Mode-on-message refactor touches type-only code | Possible test fixture regression | Grep for any test or fixture referencing `ChatThread.mode` before the refactor commit; chat domain is currently unused so blast radius is near-zero |
| Streaming + IDB writes could hammer the database | Perf regression in long answers | 80ms debounce on patch; `finalize` cancels pending; will be empirically verified in dev |
| Mid-stream sheet dismiss on mobile + tab badge | Risks feeling like a notification trick | Single calm 600ms scale-1.06 wobble + static dot; matches the project's "calm motion" anti-pattern guard against attention-grabbing animation |
| Auto-scroll yanks user away from earlier context during stream | Frustrating | "Near bottom" 80px heuristic — only auto-scroll if already there |
| Right-rail width-animation reflows the foliate iframe | Flicker / jank | Translate-only collapse animation; never animate width |
| Replay safety: stale `streaming: true` rows | Zombie messages on cold start | Stale-stream detection on mount converts `streaming: true && createdAt < now - 30s` to `truncated + error: 'interrupted'` before the list is exposed |
| Markdown deferred = code-heavy answers look bad | UX paper cut | v1 trade-off; revisit in Phase 6 polish with curated allowlist (code blocks + lists) |
| `useChatSend` orphan stream on thread switch | Wasted tokens, possible bubble bleed-through | Hook cleanup `cancel()`s in-flight machine; thread switch via `key` prop forces unmount |

---

## 15. Out of scope (explicit destinations)

| Deferred | Destination phase |
|---|---|
| Passage mode, context chips, source provenance, jump-to-passage from saved answers | 4.4 |
| Chapter mode | Phase 5 |
| Multi-excerpt mode | Phase 5 |
| Retrieval mode (keyword + semantic) | Phase 5 |
| Suggested prompts | Phase 5.3 |
| Full-book attach mode | Phase 7+ |
| Markdown / code-block rendering | Phase 6 polish |
| Right-rail resize | Phase 6 polish |
| Per-book persisted active-thread | Defer until friction proves real |
| Active-thread persistence across reloads | Defer until friction proves real |
| AI-summarized thread titles | Defer; first-message-derived works for v1 |
| Re-generate / branch from same question with a different model | Defer |
| Token cost / pricing hint UI | Phase 5+ (when more provider metadata is wired) |
| Prompt caching breakpoints | Phase 5 (chapter/retrieval — where savings actually matter) |
| Provider switcher | Out of scope per PRD (NanoGPT only) |
| Search across threads / messages | Defer |
| Export / share thread | Phase 7+ candidate |

---

## 16. Validation checklist

Before declaring Phase 4.3 complete:

- [ ] All 24 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new chat suite plus all prior suites.
- [ ] Manual smoke on desktop: empty-state precedence walks; one full message round-trip; cancel mid-stream; save-as-answer; notebook surface + AI filter; book removal cascade.
- [ ] Manual smoke on mobile (DevTools viewport at minimum, real device preferred): chat tab, send, dismiss-mid-stream, reopen, badge pulse seen.
- [ ] `docs/04-implementation-roadmap.md` Status block updated: `Phase 4.3 — complete (YYYY-MM-DD)`.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard complete per `docs/08-agent-self-improvement.md` — minimum 22/27 (risky/core task), zero on Correctness/Architectural fit/Type safety/Privacy fails the phase.
- [ ] Privacy preview snapshot test confirms `PrivacyPreview` content equals `buildOpenModeSystemPrompt(book)`.
- [ ] Stale-stream test confirms cold-reload-mid-flight surfaces interrupted state.
