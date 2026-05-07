# Phase 5.3 — Suggested prompts

**Status:** approved 2026-05-06
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 5 → Task 5.3
**Predecessors:** Phase 4.3 chat panel (`ChatPanel`, `ChatEmptyState`, `ChatComposer`, `nanogptChat.ts`); Phase 4.4 passage mode (chip pattern, `composerFocusRef` one-shot focus signal); Phase 5.1 chunking (`BookChunksRepository`, `TextChunk`); Phase 5.2 retrieval baseline (`BookEmbeddingsRepository`, `runRetrieval` orchestrator pattern, `EmbedClient` DI seam).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` §"Suggested prompts system" (the input/output spec this phase implements), §"Structured outputs" (schema-constrained prompt suggestions), §"Prompt caching strategy" (forward-compat — book profile is the stable prefix); `docs/02-system-architecture.md` (functional core / imperative shell split, additive IDB migrations); `docs/06-quality-strategy.md` (file/function thresholds, error-state requirements, accessibility floor).

---

## 1. Goal & scope

Generate a structured book profile (`{summary, genre, structure, themes, keyEntities}`) on first chat-panel open per book and derive 4-8 categorized suggested prompts from it. Persist both as a single `BookProfile` record in a new `book_profiles` IDB store. Render prompts in the existing `no-threads` empty state of the chat panel; click sends, ✎ icon fills composer instead. Failure shows an inline retry chip + falls back to the generic "Start a conversation" button.

**In scope (v1, this phase):**

*Storage:*
- New `book_profiles` IDB store (schema v8 → v9, additive). Single record per book, keyed by `BookId`. Holds `profile + prompts + profileSchemaVersion + generatedAt`.
- New `BookProfilesRepository`: `get/put/deleteByBook/countStaleVersions`. Validating reads (matching the 4.4 / 5.1 / 5.2 pattern).

*Domain:*
- New `BookProfile`, `BookProfileRecord`, `SuggestedPrompt`, `BookStructure`, `SuggestedPromptCategory` types in `src/domain/book/types.ts` alongside `BookEmbedding`.

*Network:*
- New `nanogptStructured.ts` module — POST `/v1/chat/completions` with `response_format: { type: 'json_schema', json_schema: ... }`. Mirrors `nanogptChat.ts` failure taxonomy with a new `'schema-violation'` reason for typed-failure variants.

*Generation pipeline (pure helpers + one orchestrator):*
- `BOOK_PROFILE_SCHEMA` — JSON Schema constant; single source of truth for both the request `response_format` field and the defensive `validateProfile` check.
- `sampleChunksForProfile(sections, options)` — pure; even-stride sampling under a token budget.
- `assembleProfilePrompt(book, sampledChunks)` — pure; builds the `[system, user]` message pair sent to NanoGPT.
- `validateProfile(raw, bookId, schemaVersion)` — pure; defensively re-validates the LLM response against the schema; throws `Error` with descriptive message on schema violations; trims prompts to `≤8`.
- `runProfileGeneration({book, modelId, deps, signal})` — orchestrator; reads chunks → samples → builds prompt → calls `structuredClient.complete` → validates → persists. Returns discriminated union: `ok | no-chunks | failed{reason}`.

*UI:*
- New `SuggestedPromptList` + `SuggestedPromptItem` components.
- `ChatEmptyState` `no-threads` variant extended: when `profileState.status === 'ready'`, render the prompts list in place of the generic "Start a conversation" button. `loading`, `failed`, `no-chunks`, `idle` each render the original button + an appropriate chip.
- New `EditIcon` (✎) for the per-row fill-on-edit secondary action.
- `ChatComposer` extended with `initialTextRef` — a one-shot textarea-prefill signal (mirrors the existing `focusRequest` pattern).
- `useBookProfile` hook: lazy-on-mount generation with single-flight guard + retry.

*Click behavior:*
- Whole prompt row is the primary `<button>` → calls `onSelectPrompt(text)` → `handleSendNew(text)` → creates a thread + sends as the first user message.
- Nested ✎ icon (`stopPropagation`) → calls `onEditPrompt(text)` → fills composer textarea via `initialTextRef` + focus signal; user can review/append/send.

*Cross-feature integration:*
- `useReaderHost.onRemoveBook` cascade extends with `bookProfilesRepo.deleteByBook(bookId)` after the existing embeddings cascade.
- `App.tsx` constructs `structuredClient` (from `nanogptStructured.complete + getApiKey`), assembles `profileDeps` (`{chunksRepo, profilesRepo, structuredClient}`), threads it to `ReaderWorkspace` → `ChatPanel`.

*Testing:*
- Unit (~25 tests): pure helpers (`sampleChunksForProfile`, `assembleProfilePrompt`, `validateProfile`, schema shape).
- Imperative shell (~12 tests): `BookProfilesRepository`, `nanogptStructured.complete`, `runProfileGeneration`, `useBookProfile`.
- Component (~8 tests): `SuggestedPromptList`, `SuggestedPromptItem`, `ChatEmptyState` (extended), `ChatComposer` `initialTextRef`.
- Integration (~3 tests): end-to-end `runProfileGeneration` against fixture corpus + mocked client; `useBookProfile` cache miss → generate → cache hit; `useReaderHost.onRemoveBook` cascade verified.
- E2E: `prompts-empty-state-no-key`, `prompts-no-chunks`, `prompts-render-mocked`.

**Out of scope (v1, deferred — see §13):**
- Manual "Regenerate prompts" button (Phase 6 polish).
- Per-chapter prompts / chapter-mode prompts (Phase 5.4).
- Concept maps / family trees / glossary entries / study cards / chapter profiles (Phase 7).
- Streaming the structured-output response (single-shot non-streaming; ~3-5s wait acceptable in v1).
- Privacy preview surfacing the sampled excerpts (Phase 6.5 polish).
- Multilingual prompt-generation tweaks (Phase 6+).
- Settings UI for prompt count / categories / regeneration cadence (Phase 6 polish).
- Auto-invalidation on `profileSchemaVersion` bump (Phase 6+ when schema changes warrant it).
- Few-shot examples in the profile-generation system prompt (Phase 6.5 polish; tightening).
- Cross-window single-flight (BroadcastChannel) (Phase 7).
- Display-time grouping by category (Phase 6 polish — schema already supports).
- Per-prompt rationale field (Phase 6+ if user testing demands).

---

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Generation scope | **Profile-first** | Profile is load-bearing for Phase 5.4 chapter mode + Phase 6 prompt-caching breakpoints; generating it now means downstream phases skip re-engineering this layer. Cost ~2× API calls vs. just-prompts (~$0.0002 negligible). |
| Generation timing | **Lazy on first chat-panel open per book** | Privacy-positive (chat-panel open == implicit consent). Don't pay for books the user only reads. Loading state mirrors the existing model-list spinner. |
| Profile schema | **Categorized** — `{summary, genre, themes[], keyEntities: {characters[], concepts[], places[]}, structure}` | The `structure: 'fiction' \| 'nonfiction' \| 'textbook' \| 'reference'` discriminator drives prompt category selection. Typed entity buckets enable category-aware prompts (relationship maps for fiction, claim maps for nonfiction). |
| Prompt schema | **`{text, category}`** with category ∈ `'comprehension' \| 'analysis' \| 'structure' \| 'creative' \| 'study'` | Matches engine doc's five categories. Lets the UI add badges/grouping later without re-generating. ~5-10 extra tokens per prompt. |
| Display location | **No-threads empty state only** | Suggestions are an onboarding surface, not always-visible chrome. Once user has a thread, surfacing prompts again would be visual noise. Matches ChatGPT/Claude empty-state convention. |
| Click behavior | **Primary action sends; ✎ secondary action fills composer** | Pre-vetted LLM-generated prompts shouldn't need editing by default → primary path is zero-friction. The ✎ icon offers an opt-in tweak for users who want to scope. |
| Failure handling | **Inline error + retry + fallback to generic empty state** | Keeps the original "Start a conversation" button reachable; adds a small "Couldn't load suggestions [Retry]" chip. Generic message in v1; per-reason messaging is Phase 6.5 polish. |
| Persistence | **New `book_profiles` IDB store, no auto-invalidation** | Mirrors Phase 5.1 / 5.2 separate-store pattern. Profile content doesn't degrade with chunker bumps. Cascade-deletes on book removal. Manual regenerate is Phase 6. |
| Chunk sampling | **Even-stride first chunks, packed under 3000-token budget** | Defends against first-chapter bias. Deterministic (same book → same prompt every time). Stride = `ceil(sections.length / samplesNeeded)`. |
| Chat completions endpoint | **Reuse `/v1/chat/completions` with `response_format: json_schema`** | Avoids a separate "structured outputs" abstraction; OpenAI-compatible JSON-schema-mode is well-supported by NanoGPT proxy. Thin module wraps the structured-output request. |

---

## 3. Architecture

```
┌────────────── PROFILE-GENERATION PIPELINE (lazy, on chat-panel open) ──────────────┐
│                                                                                     │
│   ChatPanel mounts (variant === 'no-threads')                                      │
│         │                                                                           │
│         ▼                                                                           │
│   useBookProfile(book, modelId, enabled, deps) hook                                │
│         │                                                                           │
│         ├─→ profilesRepo.get(bookId) → existing record?                            │
│         │                                                                           │
│         │   YES → set status: 'ready' → render prompts                             │
│         │   NO  → set status: 'loading' → kick off generation                      │
│         │                                                                           │
│         ▼                                                                           │
│   runProfileGeneration({ book, modelId, deps, signal })                            │
│         │                                                                           │
│         ├─→ chunksRepo.listByBook(book.id)                                          │
│         │     • If 0 chunks → { kind: 'no-chunks' } → fallback UI                  │
│         │                                                                           │
│         ├─→ groupBySection(chunks) → sections[]                                    │
│         │                                                                           │
│         ├─→ sampleChunksForProfile(sections, { budgetTokens: 3000,                 │
│         │                                       samplesPerSection: 1 })            │
│         │     • Even stride across sections                                        │
│         │     • Greedy-pack first chunks until budget exhausted                    │
│         │                                                                           │
│         ├─→ assembleProfilePrompt(book, sampledChunks)                             │
│         │     • System: "You are characterizing a book. Return JSON                │
│         │       matching the schema. Prompts must reference specific               │
│         │       entities/themes/chapter titles. Distribute across ≥3               │
│         │       categories."                                                        │
│         │     • User: title, author, TOC (depth-indented), excerpts                │
│         │                                                                           │
│         ├─→ structuredClient.complete<RawProfile>({ messages,                      │
│         │     schema: BOOK_PROFILE_SCHEMA, modelId, signal })                      │
│         │     • POST /v1/chat/completions with response_format: json_schema        │
│         │     • Parses JSON content; throws StructuredError on any failure         │
│         │                                                                           │
│         ├─→ validateProfile(rawResponse, bookId, schemaVersion)                    │
│         │     • Reject if missing required fields, invalid enums                   │
│         │     • Trim prompts to ≤ 8                                                │
│         │     • Return BookProfileRecord                                           │
│         │                                                                           │
│         ▼                                                                           │
│   profilesRepo.put(record)                                                          │
│         │                                                                           │
│         ▼                                                                           │
│   ChatEmptyState renders SuggestedPromptList                                       │
│   - 4-8 prompt rows                                                                │
│   - Click row → onSelectPrompt(text) → handleSendNew(text)                         │
│   - Click ✎ → onEditPrompt(text) → fills composer via initialTextRef               │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Functional core / imperative shell split per `06-quality-strategy.md`:**

- **Pure (testable without I/O):** `BOOK_PROFILE_SCHEMA`, `sampleChunksForProfile`, `assembleProfilePrompt`, `validateProfile`, `categorizePromptsForDisplay`.
- **Side-effectful:** `nanogptStructured.complete` (HTTP), `BookProfilesRepository` (IDB), `runProfileGeneration` (orchestrator), `useBookProfile` (React hook), UI components.

**Concurrency:**
- Generation is single-flight per book at the hook level (a ref guards against double-fire on remount).
- No worker / no parallelism within generation — one network call wraps the whole thing.
- Generation runs concurrent with anything else in the chat panel (no blocking).

**Integration with existing infrastructure:**
- `runProfileGeneration` reads from `BookChunksRepository` (Phase 5.1) and writes to the new `BookProfilesRepository`. Independent of embeddings — no Phase 5.2 dependency.
- `nanogptStructured.ts` is a sibling of `nanogptChat.ts` and `nanogptEmbeddings.ts`. Same `Bearer ${apiKey}` auth pattern; same failure taxonomy plus `'schema-violation'`.
- `ChatEmptyState` extended in-place (still a discriminated-union prop type); existing `'no-threads'` variant gains optional `profileState`, `onSelectPrompt`, `onEditPrompt` fields.
- `useReaderHost.onRemoveBook` cascade extends with `bookProfilesRepo.deleteByBook` after the existing embeddings cascade.
- No `BookReader` contract changes. No retrieval pipeline changes. No `useChatSend` changes.

---

## 4. Domain & storage

### 4.1 Domain types

`AIProfileStatus` (`src/domain/indexing/types.ts:8`) is already typed. No domain change to status type itself; v1 doesn't write to `Book.aiProfileStatus` (that field is reserved for a future "profile generation as part of the indexing pipeline" path; v1 generates lazily on chat-panel open and tracks generation state in the hook).

New types alongside `BookEmbedding` in `src/domain/book/types.ts`:

```ts
export type BookStructure = 'fiction' | 'nonfiction' | 'textbook' | 'reference';

export type BookProfile = {
  readonly summary: string;                       // 2-4 sentences
  readonly genre: string;                          // freeform short string
  readonly structure: BookStructure;
  readonly themes: readonly string[];              // 3-8 strings
  readonly keyEntities: {
    readonly characters: readonly string[];        // empty for non-fiction
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

export type BookProfileRecord = {
  readonly bookId: BookId;
  readonly profile: BookProfile;
  readonly prompts: readonly SuggestedPrompt[];    // 4-8 prompts
  readonly profileSchemaVersion: number;           // = 1 in v1
  readonly generatedAt: IsoTimestamp;
};
```

### 4.2 Profile schema versioning

```ts
// src/features/ai/prompts/PROFILE_SCHEMA_VERSION.ts
export const PROFILE_SCHEMA_VERSION = 1;
```

Stale-version detection is wired (`BookProfilesRepository.countStaleVersions(currentVersion)`) for forward-compat. **No app-open scan runs against it in v1** — schema bumps are a Phase 6+ concern. The field exists so a future migration doesn't have to add a column.

### 4.3 New IDB store: `book_profiles` (schema v9)

Migration v8 → v9, additive:

```ts
// src/storage/db/schema.ts
export const BOOK_PROFILES_STORE = 'book_profiles';

interface BookwormDBSchema_v9 extends BookwormDBSchema_v8 {
  book_profiles: {
    key: string;                        // BookId — primary key (no secondary indexes)
    value: BookProfileRecord;
  };
}
```

Migration `8` (i.e. v8 → v9) creates the store with `keyPath: 'bookId'`. Defensive `objectStoreNames.contains` check matches the 5.1/5.2 pattern. No secondary indexes needed: every read is by `bookId` (= primary key).

Storage cost per book: ~1KB JSON (small profile + ≤8 short prompt strings).

### 4.4 `BookProfilesRepository` contract

```ts
// src/storage/repositories/bookProfiles.ts
export type BookProfilesRepository = {
  get(bookId: BookId): Promise<BookProfileRecord | null>;
  put(record: BookProfileRecord): Promise<void>;
  deleteByBook(bookId: BookId): Promise<void>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
};
```

Validating-reads: malformed records (missing required fields, invalid `structure` value, invalid prompt category, prompts with non-string text, prompts > 8) are filtered at read time → `get` returns `null`. The hook treats `null` as "no profile yet" and re-generates. (More lenient than throwing: a single bad record doesn't permanently break the panel.)

### 4.5 Cascade extension

`useReaderHost.onRemoveBook` already cascades `messages → threads → savedAnswers → chunks → embeddings`. One more line at the end:

```ts
await wiring.bookProfilesRepo.deleteByBook(BookId(book.id));
```

Synchronous `indexing.cancel(bookId)` at the top of the cascade (Phase 5.1) already aborts in-flight indexing work; profile generation has its own `AbortController` lifetime tied to the hook's mount, separate from indexing. Removal-during-generation is harmless: the hook's effect cleanup fires `signal.abort()`, and `runProfileGeneration` returns aborted (no record persisted).

### 4.6 JSON-schema constant

```ts
// src/features/ai/prompts/bookProfileSchema.ts
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
          structure: { type: 'string', enum: ['fiction', 'nonfiction', 'textbook', 'reference'] },
          themes: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
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

The schema is the single source of truth for what the LLM is allowed to return — used both at request time (sent in `response_format`) and at validation time (`validateProfile` checks structural conformance defensively in case the provider violates it).

### 4.7 `App.tsx` wiring (deltas only)

- New field on `Wiring`: `bookProfilesRepo: BookProfilesRepository`
- New constant constructed in `App.tsx`: `structuredClient: StructuredClient` built from `nanogptStructured.complete + getApiKey`
- New `profileDeps: ProfileGenerationDeps = { chunksRepo, profilesRepo, structuredClient }` passed to `ReaderWorkspace` → `ChatPanel`

---

## 5. Profile-generation pipeline

### 5.1 New network module: `nanogptStructured.ts`

Mirrors `nanogptChat.ts` (single non-streaming POST) and reuses the `/v1/chat/completions` endpoint with a `response_format` field.

```ts
// src/features/ai/chat/nanogptStructured.ts
const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type StructuredRequest = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly messages: readonly ChatCompletionMessage[];
  readonly schema: { readonly name: string; readonly strict: true; readonly schema: object };
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
  /* … */
}

export type StructuredClient = {
  complete<T>(req: Omit<StructuredRequest, 'apiKey'>): Promise<StructuredResult<T>>;
};

export async function complete<T>(req: StructuredRequest): Promise<StructuredResult<T>>;
```

Request body: `POST /v1/chat/completions` with `{ model, messages, response_format: { type: 'json_schema', json_schema: req.schema } }`. Response: standard chat-completion shape; `choices[0].message.content` is a JSON string that gets `JSON.parse`d into `T`. Failure to parse → `'malformed-response'`. Empty content / missing choice → `'malformed-response'`.

> ⚠️ **Implementation-time verification before commit 5 of `nanogptStructured.ts`** — hit the endpoint with a small JSON-schema request + a known-good API key, verify NanoGPT supports `response_format: { type: 'json_schema' }`. If unsupported, fall back to a "Respond with valid JSON matching this schema:" prompt-instruction approach + tighter `validateProfile`. Document the fallback path in the architecture decision history. **Probe command:**
> ```bash
> curl -sS https://nano-gpt.com/api/v1/chat/completions \
>   -H "Authorization: Bearer $NANOGPT_KEY" \
>   -H "Content-Type: application/json" \
>   -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Return {\"ok\":true}"}],
>        "response_format":{"type":"json_schema","json_schema":{"name":"probe","strict":true,
>          "schema":{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}}}}' \
>   | jq '.choices[0].message.content'
> ```
> Expected: `"{\"ok\":true}"`.

### 5.2 `runProfileGeneration` orchestrator

```ts
// src/features/ai/prompts/runProfileGeneration.ts
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

export async function runProfileGeneration(
  input: ProfileGenerationInput,
): Promise<ProfileGenerationResult>;
```

Implementation:
1. `chunks = await deps.chunksRepo.listByBook(book.id)`. If empty → `{ kind: 'no-chunks' }`.
2. Group chunks by `sectionId`, preserve `chunkIndex` order within section.
3. `sampled = sampleChunksForProfile(sections, { budgetTokens: 3000, samplesPerSection: 1 })`.
4. `messages = assembleProfilePrompt(book, sampled)`.
5. `try { result = await deps.structuredClient.complete<RawProfileResponse>({ messages, schema: BOOK_PROFILE_SCHEMA, modelId, signal }) } catch (StructuredError) { return { kind: 'failed', reason: failure.reason } }`.
6. `try { record = validateProfile(result.value, book.id, PROFILE_SCHEMA_VERSION) } catch { return { kind: 'failed', reason: 'schema-violation' } }`.
7. `await deps.profilesRepo.put(record)`. If aborted between validate + put, the `put` may still complete — acceptable; the next mount will read the cached record.
8. Return `{ kind: 'ok', record }`.

Abort handling: any `signal.aborted` check between awaits short-circuits to `{ kind: 'aborted' }`. UI treats `aborted` as silent (no chip).

### 5.3 Pure helpers

#### `sampleChunksForProfile`

```ts
// src/features/ai/prompts/sampleChunksForProfile.ts
export function sampleChunksForProfile(
  sections: readonly { sectionId: SectionId; chunks: readonly TextChunk[] }[],
  options: { budgetTokens: number; samplesPerSection?: number },
): readonly TextChunk[];
```

Algorithm:
1. If `sections.length === 0` → return `[]`.
2. `desiredSamples = max(1, floor(options.budgetTokens / 400))` (assumes ~400 tokens per chunk).
3. `stride = max(1, ceil(sections.length / desiredSamples))`.
4. For `i = 0; i < sections.length; i += stride`, take `sections[i].chunks.slice(0, samplesPerSection ?? 1)`.
5. Greedy-pack into output until cumulative `tokenEstimate` would exceed `budgetTokens`. Stop on first overflow.
6. Return the packed list in source order.

Deterministic: same input → same output. No randomness.

#### `assembleProfilePrompt`

```ts
// src/features/ai/prompts/assembleProfilePrompt.ts
export const BOOK_PROFILE_SYSTEM_PROMPT = [
  'You are characterizing a book to help a reader explore it.',
  'Return a JSON object with two top-level fields:',
  '- `profile` containing summary (2-4 sentences), genre, structure, themes (3-8), and keyEntities (characters, concepts, places).',
  '- `prompts` containing 4-8 suggested questions the reader might ask.',
  'Each prompt must reference something specific from the book: an entity, a theme, or a chapter title.',
  'Avoid generic prompts ("What is this book about?"). Each prompt must be category-tagged.',
  'Distribute prompts across at least 3 of the 5 categories: comprehension, analysis, structure, creative, study.',
  'If the book is fiction, include relationship-arc and motive-tracking prompts.',
  'If non-fiction, include claim-mapping and key-term prompts.',
  'If textbook, include prerequisite-map and exam-style prompts.',
  'If keyEntities is sparse (poetry, anthology), lean on themes for grounding.',
].join(' ');

export function assembleProfilePrompt(
  book: { title: string; author?: string; toc: readonly TocEntry[] },
  sampledChunks: readonly TextChunk[],
): readonly ChatCompletionMessage[];
```

User message body:
```
Title: {title}
Author: {author ?? 'Unknown'}

Table of contents:
{toc-rendered with depth-indented bullets}

Sampled excerpts (one per representative section):

[Section: {sectionTitle}]
{chunk.text}

[Section: {sectionTitle}]
{chunk.text}

…
```

### 5.4 `useBookProfile` hook (imperative shell)

```ts
// src/features/ai/prompts/useBookProfile.ts
export type UseBookProfileState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly record: BookProfileRecord }
  | { readonly status: 'no-chunks' }
  | { readonly status: 'failed'; readonly reason: StructuredFailure['reason'] };

export type UseBookProfileHandle = UseBookProfileState & {
  readonly retry: () => void;
};

export function useBookProfile(args: {
  readonly book: Pick<Book, 'id' | 'title' | 'author' | 'toc'>;
  readonly modelId: string | null;
  readonly enabled: boolean;
  readonly deps: ProfileGenerationDeps;
}): UseBookProfileHandle;
```

Lifecycle on mount when `enabled === true && modelId !== null`:
1. Read `profilesRepo.get(book.id)`. If non-null → `status: 'ready'` with cached record (no network call).
2. Otherwise → `status: 'loading'` → call `runProfileGeneration` → write `status` from result.kind:
   - `ok` → `status: 'ready'`
   - `no-chunks` → `status: 'no-chunks'`
   - `failed{reason}` → `status: 'failed{reason}'`
   - `aborted` → no status change (cleanup running)
3. Single-flight guard: a `inFlightRef` boolean tracks whether generation is in flight; re-renders don't re-fire.
4. `retry()` clears the failed/no-chunks state and re-runs the same flow (no network call if cached).
5. Cleanup: `signal.abort()` in the effect cleanup; in-flight `runProfileGeneration` returns `aborted` and skips the `put`.

When `enabled === false`: hook stays in `idle`. (Avoids running generation when the chat panel is in `no-key` / `no-model` variant, which would error anyway.)

### 5.5 Failure handling matrix

| Failure | UI shown | Auto-retry? | User-recoverable? |
|---|---|---|---|
| `no-chunks` | Generic "Start a conversation" + small info chip "Indexing in progress…" | Yes — re-runs on next chat-panel mount once indexing reaches `ready` | Wait for indexing |
| `network` / `server` / `rate-limit` / `aborted` (in-flight only) / `malformed-response` / `schema-violation` | Generic CTA + "Couldn't load suggestions [Retry]" chip | No | Yes — Retry button |
| `invalid-key` | No suggestion UI; ChatPanel's `no-key` variant of empty state already wins | N/A | Configure key in Settings |
| `model-unavailable` | Same as `invalid-key`: the upstream `no-model` state already gates this | N/A | Pick a different model |

### 5.6 Edge cases

- **Concurrent open of two reader windows for the same book**: per-book single-flight is hook-local, not global. Two `useBookProfile` instances may both run generation. The repo's `put` is last-writer-wins; both writes converge on the same logical record. Acceptable; no UI artifact. Cross-window coordination is Phase 7.
- **Generation in progress when user navigates away**: signal aborts via the hook's cleanup; `runProfileGeneration` returns `aborted`; nothing persists.
- **Book has only one section**: stride = 1; one section sampled until budget exhausted. No special-casing.
- **Book has zero TOC**: `assembleProfilePrompt` renders `Table of contents: (none)`. LLM still has title + author + excerpts.
- **Generation succeeded but prompts violate `minItems: 4`**: `validateProfile` rejects → `failed{schema-violation}` → retry chip.
- **NanoGPT silently truncates the schema-constrained response**: `JSON.parse` throws → `malformed-response` → retry chip.
- **Profile validation rejects `structure` value not in enum**: schema-violation; retry usually recovers.

---

## 6. UI

### 6.1 `ChatEmptyState` extension

Existing variants stay; the `no-threads` variant gains four optional fields:

```tsx
type Props =
  | { variant: 'no-key'; bookTitle; onOpenSettings }
  | { variant: 'no-model'; bookTitle; onOpenSettings }
  | {
      variant: 'no-threads';
      bookTitle;
      onStartDraft: () => void;
      // Phase 5.3: when defined, render prompts/states instead of the generic CTA.
      promptsState?: UseBookProfileHandle;
      onSelectPrompt?: (text: string) => void;       // primary action: sends
      onEditPrompt?: (text: string) => void;          // secondary ✎: fills composer
    };
```

When `promptsState` is undefined (unit-test surfaces, edge configurations), the component renders the original generic empty state — preserves backward compat.

When `promptsState` is defined:

| `promptsState.status` | Render |
|---|---|
| `'loading'` | Spinner + "Generating suggestions for *{bookTitle}*…" headline. `aria-busy="true"`. |
| `'ready'` | `<SuggestedPromptList prompts={record.prompts} onSelect={onSelectPrompt} onEdit={onEditPrompt} />` followed by a small "or, [Start a blank conversation]" link (calls `onStartDraft`). |
| `'failed'` | Original "Start a conversation" button + "Couldn't load suggestions [Retry]" chip below (calls `promptsState.retry`). |
| `'no-chunks'` | Original button + "This book is still being prepared for AI" info chip (no retry). |
| `'idle'` | Original "Start a conversation" button (rendered briefly between mount and the hook's first effect). |

### 6.2 `SuggestedPromptList` + `SuggestedPromptItem`

```tsx
// src/features/ai/prompts/SuggestedPromptList.tsx
type ListProps = {
  readonly prompts: readonly SuggestedPrompt[];
  readonly onSelect: (text: string) => void;
  readonly onEdit: (text: string) => void;
};

// src/features/ai/prompts/SuggestedPromptItem.tsx
type ItemProps = {
  readonly prompt: SuggestedPrompt;
  readonly onSelect: (text: string) => void;
  readonly onEdit: (text: string) => void;
};
```

Visual layout per item:
```
┌────────────────────────────────────────────────────────┐
│  [comprehension]  Track the evolving motives of …    ✎ │
└────────────────────────────────────────────────────────┘
```

- Whole row is a primary `<button>` (calls `onSelect`).
- Inside: a small category badge + the prompt text.
- A nested `<button>` with `aria-label="Edit before asking: {text}"` (icon: `<EditIcon />`). Clicks call `e.stopPropagation()` then `onEdit`.
- Default flat ordering = LLM relevance order. Display-time grouping by category is deferred to Phase 6 polish.

### 6.3 `ChatPanel` integration

`ChatPanel` already has `handleSendNew(text)` for thread-creation + send. Add a sibling `handleFillComposer(text)`:

```ts
const handleFillComposer = useCallback((text: string): void => {
  composerInitialTextRef.current = text;
  composerFocusRef.current = true;
}, []);
```

Hook wiring in `ChatPanel`:
```ts
const profile = useBookProfile({
  book: {
    id: BookId(props.bookId),
    title: props.book.title,
    author: props.book.author,
    toc: props.book.toc,                  // see prop-shape extension below
  },
  modelId: props.selectedModelId,
  enabled: variant === 'no-threads',
  deps: props.profileDeps,
});
```

`profileDeps` is a new prop on `ChatPanel` (`{ chunksRepo, profilesRepo, structuredClient }`), threaded from `ReaderWorkspace` ← `App.tsx`.

**Prop-shape extension:** `ChatPanel`'s `book` prop currently is `{ title, author?, format }` (Phase 4.3); Phase 5.3 extends it to `{ title, author?, format, toc: readonly TocEntry[] }`. `ReaderWorkspace` already has the full `Book` record from `App.tsx` and projects the new `toc` field alongside the existing fields. No new repo dep needed.

`<ChatEmptyState>` call site in the `no-threads` branch:
```tsx
<ChatEmptyState
  variant="no-threads"
  bookTitle={props.book.title}
  onStartDraft={() => threads.startDraft(props.selectedModelId ?? '')}
  promptsState={profile}
  onSelectPrompt={handleSendNew}
  onEditPrompt={handleFillComposer}
/>
```

### 6.4 `ChatComposer` extension for fill-on-edit

```tsx
type Props = {
  // … existing fields …
  readonly initialTextRef?: { current: string | null };
};
```

Behavior: in the same effect that drains `focusRequest.current === true`, also drain `initialTextRef.current`: if non-null, set the textarea state to the value, then null the ref. Both signals are one-shot per assignment.

`ReaderWorkspace` owns the `composerInitialTextRef` alongside the existing `composerFocusRef` and threads both to `ChatPanel` → `ChatComposer`.

### 6.5 Loading + transition motion

Per the project's "calm, refined motion" rule:
- Loading state uses a single `aria-busy="true"` container + a 250ms-fade-in spinner. No bouncing dots.
- Prompt list fades in (200ms opacity) on the `loading → ready` transition. No staggered item animations.
- Prompt buttons get the existing focus ring + a soft elevation on hover (matches the existing `passage-chip` / `retrieval-chip` visual vocabulary).

### 6.6 Accessibility

- Empty-state container: `role="region" aria-label="Suggested questions"`.
- Each prompt row: `<button>` with `aria-label="Ask: {text}"`.
- Edit icon: nested `<button>` with `aria-label="Edit before asking: {text}"`.
- Retry chip: `<button>` with `aria-label="Retry suggestions"`.
- Loading state: `role="status" aria-live="polite"`.
- All new interactive elements receive the existing accent-color focus ring; AA contrast verified against the existing palette.

### 6.7 CSS

Lives in `src/features/ai/prompts/suggested-prompts.css` (new file, imported from `SuggestedPromptList.tsx`). Follows the existing surface-elevated + border-subtle visual vocabulary of `passage-chip` / `retrieval-chip` / `message-bubble__citation`.

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
}
.suggested-prompts__edit:hover { color: var(--color-text); }
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
  animation: fade-in 250ms ease;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
```

---

## 7. Cross-feature integration

- **`useReaderHost.onRemoveBook`** gains `await wiring.bookProfilesRepo.deleteByBook(BookId(book.id));` after the existing embeddings deletion.
- **`App.tsx`** instantiates `wiring.bookProfilesRepo` via `createBookProfilesRepository(db)`; constructs `structuredClient` via `nanogptStructured.complete + getApiKey`; assembles `profileDeps` and threads it through `ReaderWorkspace` → `ChatPanel`.
- **`ChatPanel`** props gain `profileDeps`. Threads it into `useBookProfile`.
- **`ReaderWorkspace`** gains `profileDeps` prop (from App), constructs the `composerInitialTextRef`, threads both to `ChatPanel` (desktop + mobile-sheet instances).
- **No reader contract changes.** No retrieval pipeline changes. No `useChatSend` changes.

---

## 8. Privacy & accessibility

### 8.1 Privacy doctrine reinforcement

- Profile generation sends excerpts (already in local IDB, derived from a book the user imported) + book metadata (title, author, TOC) to NanoGPT. Same provider trusted with chat completions and embeddings; not new exposure.
- Implicit consent: user opens the chat panel → generation kicks off. If the user never opens chat, no profile is generated.
- Privacy preview: not surfaced in v1 for profile generation (the preview component lives below the composer, outside the empty-state surface). Phase 6.5 polish can add an inspector view showing what was sampled.
- Saved-answer rows in the notebook are unaffected — profile generation does not produce saved messages.

### 8.2 Accessibility

Per §6.6 plus:
- All prompt buttons have visible focus rings.
- Edit-icon buttons within prompt rows have non-overlapping focus targets (the row is one button, the icon is a nested button with `stopPropagation`).
- Retry chip is a button with explicit aria-label.
- Loading + idle states are perceivable to screen readers via `role="status"` and `aria-busy`.

---

## 9. Testing strategy

### 9.1 Unit (Vitest)

**Pure helpers (~25 tests):**
- `sampleChunksForProfile` — stride correctness (1 section, 5 sections, 100 sections); budget cap (3000 tokens, 100 tokens); empty sections; deterministic output.
- `assembleProfilePrompt` — TOC indentation; sampled-excerpts ordering; system-prompt invariants (mentions schema, mentions categories, demands specificity).
- `validateProfile` — happy path; missing top-level `profile`; missing `prompts`; invalid `structure` enum; invalid prompt category; prompt missing text; prompts trimmed to `≤ 8`; `themes` empty array rejected (minItems: 1).
- `BOOK_PROFILE_SCHEMA` — structural shape (no LLM round-trip); JSON-Schema-valid via simple shape checks.
- `categorizePromptsForDisplay` — stable ordering; empty list.

**Imperative shell (~12 tests):**
- `BookProfilesRepository` — round-trip; validating-reads filter (malformed records dropped); `deleteByBook`; `countStaleVersions`; primary-key collision (put then put = update).
- `nanogptStructured.complete` — happy path mocked; auth header; HTTP failure classification (401/403/404/400/429/500); abort signal propagates; non-JSON body → `'malformed-response'`; empty content → `'malformed-response'`.
- `runProfileGeneration` — happy path persists record; no-chunks early-return; structuredClient throws → `failed{reason}`; `validateProfile` throws → `failed{schema-violation}`; abort during structuredClient call.
- `useBookProfile` — idle → loading → ready transition; cached read short-circuits; retry recovers from `failed`; single-flight guard against double-fire on remount; `enabled: false` keeps state in `idle`.

**Component (~8 tests):**
- `SuggestedPromptList` — renders 4-8 items; primary click fires `onSelect`; ✎ click fires `onEdit` and not `onSelect` (event isolation); aria-labels.
- `SuggestedPromptItem` — category badge text; prompt text; edit-button focus-visible.
- `ChatEmptyState` (extended) — renders prompts on `status === 'ready'`; renders retry chip on `failed`; renders info chip on `no-chunks`; renders generic button on `idle`; renders loading spinner on `loading`.
- `ChatComposer` `initialTextRef` — drains text on next render and clears the ref.

### 9.2 Integration (Vitest + happy-dom + fake-indexeddb)

- End-to-end `runProfileGeneration` against a fixture corpus + mocked `structuredClient` → record persisted with expected shape.
- `useBookProfile` against `fake-indexeddb` + mocked client: cache miss → generate → cache hit on second mount.
- `useReaderHost.onRemoveBook` cascade includes `bookProfilesRepo.deleteByBook`.

### 9.3 E2E (Playwright)

- `prompts-empty-state-no-key.spec.ts`: import → open chat with no API key → confirm `no-key` empty state wins (parity check; prompts not visible).
- `prompts-no-chunks.spec.ts`: import a book that fails to chunk → open chat → empty state shows the indexing-in-progress info chip, not prompts.
- `prompts-render-mocked.spec.ts`: configure key + model + import → mock `/v1/chat/completions` to return a small valid `book_profile_with_prompts` payload → suggested prompts render → click prompt row → thread is created and the prompt text appears in the message list.

E2E that exercises the live LLM is deferred (parity with chat-completion specs which skip live streaming).

### 9.4 Quality gate

`pnpm check` clean per commit. `pnpm test:e2e` runs before the docs commit.

---

## 10. File map

### 10.1 New files

```
src/features/ai/prompts/
  PROFILE_SCHEMA_VERSION.ts            — version constant
  bookProfileSchema.ts                  — JSON-schema constant
  sampleChunksForProfile.ts (+test)     — pure helper
  assembleProfilePrompt.ts (+test)      — pure helper
  validateProfile.ts (+test)            — pure helper
  runProfileGeneration.ts (+test)       — orchestrator
  useBookProfile.ts (+test)             — React hook
  SuggestedPromptList.tsx (+test)       — list component
  SuggestedPromptItem.tsx (+test)       — row component
  suggested-prompts.css                 — styles
  index.ts                              — barrel

src/features/ai/chat/
  nanogptStructured.ts (+test)          — POST /v1/chat/completions w/ json_schema

src/storage/repositories/
  bookProfiles.ts (+test)               — IDB repo

src/shared/icons/
  EditIcon.tsx                          — ✎ icon

e2e/
  prompts-empty-state-no-key.spec.ts
  prompts-no-chunks.spec.ts
  prompts-render-mocked.spec.ts
```

### 10.2 Modified

```
src/domain/book/types.ts                — add BookProfile, BookProfileRecord, SuggestedPrompt, BookStructure, SuggestedPromptCategory
src/storage/db/schema.ts                — v8 → v9: add book_profiles store + BOOK_PROFILES_STORE constant
src/storage/db/migrations.ts            — migration 8 (additive)
src/storage/db/migrations.test.ts       — v8 → v9 migration tests
src/storage/index.ts                    — export createBookProfilesRepository, BookProfilesRepository
src/features/library/wiring.ts          — bookProfilesRepo field on Wiring; createBookProfilesRepository in factory
src/features/ai/chat/ChatEmptyState.tsx — extend no-threads variant with profileState + onSelectPrompt + onEditPrompt
src/features/ai/chat/ChatComposer.tsx   — initialTextRef one-shot drain
src/features/ai/chat/ChatPanel.tsx      — useBookProfile hook + profileDeps prop + handleFillComposer
src/features/reader/workspace/ReaderWorkspace.tsx — profileDeps prop; thread to ChatPanel; composerInitialTextRef
src/app/App.tsx                         — construct structuredClient + profileDeps; pass to ReaderWorkspace
src/app/useReaderHost.ts                — cascade: + bookProfilesRepo.deleteByBook
src/app/useReaderHost.test.ts           — fakeWiring stub: + bookProfilesRepo
src/shared/icons/index.ts               — export EditIcon
docs/04-implementation-roadmap.md       — Phase 5.3 status block
docs/02-system-architecture.md          — decision history entry
```

---

## 11. Commit slicing (Approach 2 — sliced commits)

Each commit independently green:

1. `feat(domain): book profile types — BookProfile, BookProfileRecord, SuggestedPrompt, BookStructure, SuggestedPromptCategory`
2. `feat(storage): v9 migration — add book_profiles store`
3. `feat(storage): BookProfilesRepository — get/put/deleteByBook/countStaleVersions`
4. `feat(prompts): BOOK_PROFILE_SCHEMA + PROFILE_SCHEMA_VERSION + sampleChunksForProfile + assembleProfilePrompt + validateProfile pure helpers`
5. `feat(network): nanogptStructured — POST /v1/chat/completions with response_format:json_schema (incl. JSON-schema verification)`
6. `feat(prompts): runProfileGeneration orchestrator with no-chunks / failed / aborted / ok variants`
7. `feat(prompts): useBookProfile hook with single-flight + retry`
8. `feat(icons): EditIcon`
9. `feat(prompts): SuggestedPromptItem + SuggestedPromptList components`
10. `feat(chat): ChatComposer initialTextRef one-shot drain for fill-on-edit`
11. `feat(chat): ChatEmptyState — render suggested prompts in no-threads variant + retry/no-chunks chips`
12. `feat(chat): ChatPanel — wire useBookProfile + handleFillComposer + profileDeps prop`
13. `feat(workspace): ReaderWorkspace — composerInitialTextRef + thread profileDeps`
14. `feat(app): wire bookProfilesRepo + structuredClient + profileDeps + cascade integration`
15. `test(e2e): suggested prompts — no-key / no-chunks / render-mocked`
16. `docs: Phase 5.3 — architecture decision + roadmap status complete`

~16 commits.

---

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| NanoGPT doesn't support `response_format: json_schema` | First profile generation fails | Implementation-time verification before commit 5; if unsupported, fall back to "Respond with JSON matching this schema:" prompt-instruction approach + tighter `validateProfile`. Documented in decision history. |
| Provider returns valid JSON that violates the schema | Profile validation throws → user sees retry chip | `validateProfile` is the safety net. Retry will usually recover (LLM nondeterminism). After 3 retries we don't auto-bail; user can dismiss and re-open the panel. |
| LLM generates generic prompts despite system-prompt instruction | Reduces "feels book-specific" acceptance criterion | System prompt explicitly demands prompts reference a specific entity, theme, or chapter title from the input. Phase 6.5 polish can tighten with few-shot examples. |
| Profile takes >10s to generate on a large book | User stares at spinner | Sampled excerpt budget capped at 3000 input tokens. Profile output is bounded by the schema (`≤8` prompts × `≤200` tokens + small profile). Total wall-clock ~3-5s on `gpt-4o-mini`-class models. Spinner is acceptable per the calm-motion rule. |
| Sampling skips a critical mid-book section | Profile misses key entities | Even-stride sampling spreads across sections. For very long books with many short sections, the budget cap may still skip. Acceptable for v1; Phase 6 can add adaptive sampling. |
| Two concurrent windows generate the profile twice | One wasted API call; last writer wins on `put` | Per-book single-flight is hook-local. Cost is negligible (~$0.0002/dup). Acceptable; cross-window coordination is Phase 7. |
| Profile schema evolves | Old records fail validation | `profileSchemaVersion` field in the record + `countStaleVersions` repo method. `validateProfile` rejects records below current version → hook treats as cache miss → regenerates. (Behavior latent in v1; activated when Phase 6+ bumps version.) |
| Generic prompts ship for a book with sparse keyEntities (poetry, anthology) | Prompts may feel less specific | The `structure` enum has a `'reference'` fallback. System prompt instructs: "If keyEntities is sparse, lean on themes for grounding." Acceptable; Phase 6 can refine. |
| Profile generation cost across a large library | $$$ for users importing many books | Lazy-on-first-chat-panel-open already gates this — only books the user opens chat for incur cost. Estimated $0.0001-0.0005 per book. Settings UI for cost meter is Phase 6+. |
| Click-to-send race: user clicks prompt + presses Enter on something else | Doubled send | The whole row button + textarea-keydown are independent surfaces; the click handler creates a new thread regardless of composer state. Existing `useChatSend` is single-flight via the actor; no race in practice. |

---

## 13. Out of scope (explicit destinations)

| Deferred | Destination phase |
|---|---|
| Manual "Regenerate prompts" button | Phase 6 polish |
| Per-chapter prompts / chapter-mode prompts | Phase 5.4 |
| Concept maps / family trees / glossary entries / study cards / chapter profiles | Phase 7 |
| Streaming the structured-output response | Phase 6+ if profile generation feels slow |
| Privacy preview surfacing the sampled excerpts | Phase 6.5 polish |
| Multilingual prompt-generation tweaks | Phase 6+ |
| Settings UI for prompt count / categories / regeneration cadence | Phase 6 polish |
| Auto-invalidation on `profileSchemaVersion` bump | Phase 6+ when schema changes warrant it |
| Few-shot examples in the profile-generation system prompt | Phase 6.5 polish (tightening) |
| Cross-window single-flight (BroadcastChannel) | Phase 7 |
| Display-time grouping by category | Phase 6 polish (schema already supports) |
| Per-prompt rationale field | Phase 6+ if user testing demands |
| Prompt-cache breakpoint placement using book profile as stable prefix | Phase 6 polish (engine doc §"Prompt caching strategy") |

---

## 14. Validation checklist

Before declaring Phase 5.3 complete:

- [ ] All ~16 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new prompts suite plus all prior suites.
- [ ] **Manual smoke (happy path)**: import the fixture EPUB → wait for `ready` → open chat → see "Generating suggestions…" → see 4-8 prompts each referencing something specific (entity/theme/chapter).
- [ ] **Manual smoke (click → send)**: click a prompt → thread is created → prompt is sent as the first user message → assistant streams a reply.
- [ ] **Manual smoke (edit → send)**: click ✎ on a prompt → composer is filled with the prompt text + focused → user appends "specifically in chapter 4" + sends → message reflects the edit.
- [ ] **Manual smoke (cache hit)**: close + reopen chat panel → prompts re-render instantly (no spinner).
- [ ] **Manual smoke (no-chunks)**: import a malformed book that fails to chunk → open chat → empty state shows "indexing in progress" info chip, not prompts.
- [ ] **Manual smoke (retry)**: kill network, open chat for a fresh book → see retry chip; restore network → click Retry → prompts load.
- [ ] **Manual smoke (cascade)**: remove a book whose profile exists → confirm IDB has no orphan record.
- [ ] `docs/04-implementation-roadmap.md` Status block updated: `Phase 5.3 — complete (YYYY-MM-DD)`.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard ≥ 22/27 per `docs/08-agent-self-improvement.md`.
