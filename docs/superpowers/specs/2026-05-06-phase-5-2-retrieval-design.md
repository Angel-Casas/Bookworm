# Phase 5.2 — Retrieval baseline

**Status:** approved 2026-05-06
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 5 → Task 5.2
**Predecessors:** Phase 4.3 chat panel (introduces `ChatPanel`, `useChatSend`, `assembleOpenChatPrompt`, `MessageBubble`, `PrivacyPreview`, `nanogptChat.ts` network module, `ChatErrorBubble`); Phase 4.4 passage mode (introduces the chip pattern, `attachedPassage`, `assemblePassageChatPrompt`, the validating-reads `isValidContextRef` storage normalizer, `MessageBubble` source footer, `NotebookRow.savedAnswer` Jump-to-passage); Phase 5.1 chunking (introduces the `book_chunks` IDB store + `BookChunksRepository`, the `runIndexing` pipeline, `IndexingQueue`, `useIndexing` hook, `BookCardIndexingStatus`, `IndexInspectorModal`, `CHUNKER_VERSION`).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` §"Retrieval mode" (the 7-step pipeline this phase implements), §"Embeddings strategy" + §"Local embedding policy" (compute via NanoGPT, store local, similarity search local, avoid re-embedding unchanged chunks); `docs/02-system-architecture.md` (functional core / imperative shell split, additive IDB migrations); `docs/06-quality-strategy.md` (file/function thresholds, error-state requirements, accessibility floor).

---

## 1. Goal & scope

Ship retrieval mode end-to-end. Embeddings compute eagerly during the existing indexing pipeline (extending Phase 5.1's `runIndexing` from `chunking{n} → ready` to `chunking{n} → embedding{n} → ready`). When the user attaches a "Search this book" chip and sends a question, the system runs hybrid retrieval (BM25 + cosine via Reciprocal Rank Fusion), assembles a token-budgeted, section-grouped evidence bundle with citation tags, sends it through `assembleRetrievalChatPrompt`, and renders multi-source provenance in the assistant's reply (with click-to-jump on each citation).

**In scope (v1, this phase):**

*Embeddings pipeline:*
- Extend `runIndexing` with an embedding stage that runs after chunking-ready. Per-chunk idempotent resume via a `hasEmbeddingFor(chunkId)` check, mirroring 5.1's `hasChunksFor` pattern.
- New `BookEmbeddingsRepository` over a new `book_embeddings` IDB store (schema v7 → v8, additive). Records: `{id: ChunkId, bookId, vector: Float32Array (1536-dim, L2-normalized at write time), chunkerVersion, embeddingModelVersion, embeddedAt}`. Index `by-book`.
- Versioning: `EMBEDDING_MODEL_VERSION = 1` (the constant maps to `'text-embedding-3-small'`). Stale-version scan on app open mirrors 5.1's chunker-version scan. Two version fields independently: chunker bump invalidates chunks → embeddings cascade-invalidate; model bump invalidates embeddings only.
- New NanoGPT network module `nanogptEmbeddings.ts` for `POST /v1/embeddings`. Single endpoint; non-streaming; batches up to 32 chunks per request.
- Failure handling: extend `IndexingStatus.failed.reason` strings with `'embedding-failed'` for terminal embedding errors and `'embedding-rate-limited'` for retry-exhausted 429s. Network rate-limits retry with exponential backoff (3 attempts max); other errors fail terminally per-book.

*Retrieval pipeline (pure helpers + one orchestrator):*
- `tokenizeForBM25(s: string)` — pure, deterministic; lowercase + strip diacritics + split + strip pure-punctuation tokens.
- `bm25Rank(query, chunks, params?, topN?)` — pure; computes IDF on-the-fly per book, returns top-30 by default.
- `cosineRank(queryVector, embeddings, topN?)` — pure; pre-normalized vectors → dot product, returns top-30.
- `reciprocalRankFusion(rankings, k=60)` — pure; combines the BM25 and cosine ranked lists.
- `assembleEvidenceBundle(rankedIds, chunks, options)` — pure; greedy-pack to ~3000 tokens, regroup by section, add citation tags `[1]…[N]`.
- `runRetrieval(book, question, deps)` — orchestrator; embeds question via NanoGPT, runs both retrievers in parallel, fuses, assembles bundle.

*Prompt assembly:*
- New `assembleRetrievalChatPrompt({book, history, newUserText, bundle})` next to `assembleOpenChatPrompt` and `assemblePassageChatPrompt`. Same single-combined-system-message pattern as 4.4. Output shape: `[ system(open prompt + retrieval addendum), …history, user(evidence-bundle + newUserText) ]`. Citation tags `[1]…[N]` baked into the bundle.
- New `RETRIEVAL_MODE_ADDENDUM` string in `promptAssembly.ts` instructing the model to ground answers in the retrieved excerpts and reference them by citation tag.
- History soft-cap drops to `HISTORY_SOFT_CAP_RETRIEVAL = 25` (more aggressive than passage's 30, since retrieval bundles dwarf passage payloads). Single check at assembly time.
- Exported `buildEvidenceBundleForPreview(...)` so PrivacyPreview can render the actual bundle character-for-character (post-retrieval, before send).

*UI:*
- New "Search this book" icon button in `ChatComposer` (next to send). Click → workspace state sets `attachedRetrieval: AttachedRetrieval | null`. Same chip lifecycle as 4.4's passage chip.
- New `RetrievalChip` component, renders in the same chip slot as `PassageChip`. Visual: `🔍 Searching this book ✕`. Cleared on send (one-shot per message — distinct from passage chip's sticky-across-sends).
- `useChatSend` extends with `attachedRetrieval?: AttachedRetrieval | null` + `retrievalDeps?: RetrievalDeps`. Branch: when present, run `runRetrieval` first, then route through `assembleRetrievalChatPrompt`. `mode: 'retrieval'` set on both messages; `contextRefs` set only on the assistant message (carries one `{kind: 'chunk', chunkId}` ref per retrieved chunk, in citation-tag order).
- `MessageBubble` source-footer extends from "find one passage" to "filter all passage|chunk refs" — renders as `📎 Sources: Ch 4 [3] · Ch 9 [1] [2] · Ch 12 [7]`. Click each citation chip → `onJumpToSource(chunk.locationAnchor)`. Compact by default; expand-on-click reveals each source's preview.
- `PrivacyPreview` extends with a "Search plan" subsection when `attachedRetrieval !== null`: book name + chunk count + budget. After-the-fact, the saved-answer view (notebook) shows the actual retrieved chunks via `contextRefs`.
- `BookCardIndexingStatus` already has a forward-compat `embedding{progressPercent}` label ("Preparing for AI…") — Phase 5.1 designed for this; activates naturally now that embeddings populate the state.
- `IndexInspectorModal` header counts extend with embedding-model version so the user can verify both versions match.

*Notebook:*
- `NotebookRow.savedAnswer` Jump-to-passage button (4.4) extends to handle multi-source retrieval answers — when the saved answer's `contextRefs` contain multiple `chunk` refs, render multi-source UI (inline chips up to 5; popover for >5).
- 4.4's `isValidContextRef` validator gains real validation for the `chunk` variant (replacing the lenient pass-through): `chunkId` must be a non-empty string.

*Testing:*
- Unit: pure helpers (~30 tests).
- Component: `RetrievalChip`, `MessageBubble` multi-source footer, `PrivacyPreview` search-plan subsection, `ChatComposer` search toggle, `ChatPanel` chip slot, `NotebookRow` multi-source (~10 tests).
- Imperative shell: `BookEmbeddingsRepository`, `nanogptEmbeddings.embed`, `runEmbeddingStage`, `runRetrieval`, `useChatSend.attachedRetrieval` (~15 tests).
- Integration: end-to-end `runRetrieval` against a fixture corpus + mocked embed client; end-to-end `runIndexing` chunking → embedding → ready; app-open scan with stale embeddings (~3 tests).
- E2E: `chat-retrieval-mode-desktop`, `chat-retrieval-mode-no-embeddings`, `library-card-embedding-status`.

**Out of scope (v1, deferred — see §14):**
- Prompt caching breakpoints (engine doc §; Phase 6 polish).
- Pre-built BM25 inverted index (compute on-the-fly per query is fast enough at our scale).
- ANN / HNSW index for sub-linear search (overkill at <2K vectors per book).
- Local on-device embeddings (Transformers.js / WebGPU). Privacy isn't load-bearing here (chunks already go to NanoGPT for chat); deferred.
- Cross-book retrieval (search multiple books at once) — Phase 5+ multi-book mode.
- Configurable evidence budget / top-K in settings — defaults baked in; settings exposure is Phase 6 polish.
- Suggested prompts (Phase 5.3).
- Chapter mode (Phase 5.4 — will reuse the same infrastructure).
- Web-Worker embedding compute or retrieval (main-thread is fast enough at our scale).
- Re-ranking with a separate model (cross-encoder) — Phase 5+.
- Embedding-cost meter / budget UI in settings — Phase 6.
- Multi-language tokenizer (BM25 v1 is space-split + ASCII punct strip; books with Latin-script text only).
- "Retry embeddings only" without re-chunking — v1 just full-rebuilds.
- Per-thread question-embedding cache — defer until duplicate-question patterns appear.

---

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Embedding compute timing | **Eager, in the existing pipeline** | Extends 5.1's `runIndexing` so chunking-ready transitions automatically into the `embedding{progressPercent}` state Phase 5.1 already designed. Cost is small (~$0.0001 per book against `text-embedding-3-small`). Reading is unaffected (background work). The pre-designed `IndexingStatus.embedding{...}` and 5.1's per-section idempotent resume make this nearly free architecturally. |
| Embedding model | **`text-embedding-3-small` hardcoded as v1 default** | 1536 dims, ~$0.02/1M tokens, ~6KB per chunk. Quality/cost sweet spot for chunk-level retrieval. Versioned via `embeddingModelVersion` on the embedding record (same pattern as `chunkerVersion` from 5.1) so a future phase can switch models with auto-rebuild. NanoGPT proxies many providers; user-configurable selector is Phase 6 polish. |
| Vector storage | **New `book_embeddings` IDB store keyed by `ChunkId`** | Schema v7 → v8, additive. Decouples chunk lifecycle from embedding lifecycle: chunks can exist with no vectors yet, vectors can be regenerated without touching chunks (model bump), and the pipeline's idempotent-resume check is `hasEmbeddingFor(chunkId)`. |
| Similarity search | **Pre-normalized vectors + dot product on main thread** | Vectors normalized to unit length at store-time; query-time similarity = pure dot product. ~3M FLOPs per query (250 chunks × 1536 dims) runs in <5ms on the main thread. No division-by-zero edge cases. Phase 6+ can promote to a worker if profiling justifies. |
| Hybrid retrieval | **BM25 + cosine via Reciprocal Rank Fusion** | RRF score = `Σ 1/(k + rank)` with k=60. No score calibration needed. The engine doc explicitly mandates "keyword + semantic". BM25 implementation: tokenize at query time, compute IDF inline. No third IDB store for inverted index; storage stays simple. |
| Evidence bundle | **Token-budgeted, grouped by section, in reading order within group** | RRF score drives which chunks are included; section-group + reading-order drives prompt presentation. Budget 3000 tokens; minChunks 3, maxChunks 12; RRF k=60. Citation tags `[1]…[N]` for unambiguous source provenance. Grouping helps the model build a coherent picture even when fragments rank apart. |
| Retrieval mode trigger | **"Search this book" button + chip in composer area** | Same UX vocabulary as 4.4's passage chip (chips mean "the next message will use this context"). Mode is implicit-from-attachment again. Mutual exclusivity with the passage chip enforced at workspace level. Chip is one-shot per message (clears on send) — distinct from passage chip's sticky-across-sends because each retrieval re-runs from question. |
| Provenance | **Pre-send PrivacyPreview shows search plan; post-send source footer shows actual chunks** | Pre-send the actual chunks aren't determined yet (depend on the question). Post-send the `MessageBubble` source-footer extends from 4.4's single-source to a multi-source variant with citation chips. Saved-answer rows in the notebook expose the same multi-source jump pattern via `contextRefs`. Engine doc's privacy doctrine satisfied — user sees what's being sent (in plan form) before send and what was sent (in actual form) after. |

---

## 3. Architecture

```
┌─────────────────── INDEXING PIPELINE (extends Phase 5.1) ─────────────────────┐
│                                                                                │
│   Book {indexingStatus: pending}                                               │
│         │                                                                      │
│         ▼                                                                      │
│   [Phase 5.1 chunking stage — unchanged]                                       │
│   listSections → for each: paragraphs → chunks → upsertMany                    │
│   IndexingStatus transitions: pending → chunking{n}                            │
│         │                                                                      │
│         ▼                                                                      │
│   [Phase 5.2 NEW — embedding stage]                                            │
│   IndexingStatus.kind: 'embedding' { progressPercent: 0 }                      │
│         │                                                                      │
│         ▼                                                                      │
│   chunksRepo.listByBook(bookId) → all chunks                                   │
│         │                                                                      │
│         ▼                                                                      │
│   for each batch of 32 chunks:                                                 │
│     - filter to chunks WHERE NOT hasEmbeddingFor(chunk.id)  ← idempotent       │
│       resume per-chunk                                                          │
│     - if batch empty after filter → skip                                       │
│     - nanogptEmbeddings.embed(normalizedText[]) → Float32Array[]               │
│     - L2-normalize each vector                                                 │
│     - embeddingsRepo.upsertMany([{id, bookId, vector,                          │
│                                  chunkerVersion, embeddingModelVersion,        │
│                                  embeddedAt}, …])                              │
│     - update progressPercent                                                   │
│     - await yieldToBrowser()                                                   │
│         │                                                                      │
│         ▼                                                                      │
│   IndexingStatus.kind: 'ready'                                                 │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────── RETRIEVAL PIPELINE (new, send-time) ────────────────────┐
│                                                                                │
│   ChatPanel.attachedRetrieval !== null && composer.send(text)                  │
│         │                                                                      │
│         ▼                                                                      │
│   useChatSend.send → if attachedRetrieval, run retrieval first                 │
│         │                                                                      │
│         ▼                                                                      │
│   runRetrieval(book, question, deps)                                           │
│         │                                                                      │
│         ├─→ nanogptEmbeddings.embed([question]) → 1×1536 vector               │
│         │     (L2-normalize → queryVector)                                     │
│         │                                                                      │
│         ├─→ chunksRepo.listByBook(book.id)        ──┐                          │
│         │                                            │                          │
│         ├─→ embeddingsRepo.listByBook(book.id)   ──┤ Promise.all                │
│         │                                            │                          │
│         │                                            ▼                          │
│         ├─→ Parallel ranking (Promise.all):                                    │
│         │     • bm25Score(question, chunks) → ranked, top 30                  │
│         │     • cosineRank(queryVector, embeddings) → ranked, top 30          │
│         │                                                                      │
│         ├─→ reciprocalRankFusion(bm25Ranked, cosineRanked, k=60) → fusedRanks │
│         │                                                                      │
│         ├─→ assembleEvidenceBundle(fusedRanks, chunks, {                       │
│         │     budgetTokens: 3000, minChunks: 3, maxChunks: 12 })               │
│         │                                                                      │
│         ▼                                                                      │
│   assembleRetrievalChatPrompt({ book, history, newUserText, bundle })          │
│         │                                                                      │
│         ▼                                                                      │
│   nanogptChat.streamChatCompletion(messages) — same path as 4.3 / 4.4          │
│         │                                                                      │
│         ▼                                                                      │
│   Persist assistant message with mode='retrieval' + contextRefs[]              │
│   = each retrieved chunk as {kind: 'chunk', chunkId} in citation order         │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

Functional-core / imperative-shell split per `06-quality-strategy.md`:

- **Pure (testable without I/O):** `tokenizeForBM25`, `bm25Rank`, `cosineRank`, `reciprocalRankFusion`, `assembleEvidenceBundle`, `buildEvidenceBundleForPreview`, `assembleRetrievalChatPrompt`, `RETRIEVAL_MODE_ADDENDUM` string constant, citation-tag builder, `l2Normalize`, `classifyEmbeddingError`, `chunkArray` (batching helper).
- **Side-effectful:** `nanogptEmbeddings.embed` (HTTP), `BookEmbeddingsRepository` (IDB), `runEmbeddingStage` (the new pipeline phase), `runRetrieval` (orchestrator), `useChatSend.send` extension, UI components.

**Concurrency:**
- **Embedding stage**: sequential per book (existing IndexingQueue); within a book, batches of 32 process sequentially (no parallel network requests; simplifies rate-limit handling).
- **Retrieval pipeline**: BM25 and cosine ranking run in parallel via `Promise.all` (both pure). Question embedding is the only network call. Total query time: embed (~200ms) + parallel rank (~5ms) + fuse + bundle (negligible).
- **No new threads / workers** in v1.

**Integration with existing infrastructure:**
- `runIndexing` (5.1) gains an embedding stage at the bottom; existing abort signal threads through.
- `IndexingQueue` (5.1) is unchanged.
- `useReaderHost.onRemoveBook` cascade extends with `embeddingsRepo.deleteByBook(bookId)` after the existing chunks deletion.
- `useChatSend` extends with two new optional props; existing `attachedPassage` path unchanged.
- `MessageBubble` source-footer logic extends; existing single-source path unchanged.
- No `BookReader` contract changes.

---

## 4. Domain & storage

### 4.1 Domain types — minimal changes

- `ChatMode` (`src/domain/ai/types.ts:20`): already includes `'retrieval'`. No change.
- `ContextRef.chunk` variant: already typed. No change to the type. Storage validators (`isValidContextRef` in `contextRefValidation.ts`) gain real validation for the `chunk` variant: `chunkId` must be a non-empty string.
- `IndexingStatus.embedding{progressPercent}`: already typed. No change. `failed.reason` strings extend with `'embedding-failed'` and `'embedding-rate-limited'` (no type change).
- `TextChunk`: no change. `normalizedText` is what gets sent to NanoGPT for embedding.

### 4.2 New `AttachedRetrieval` type

```ts
// src/features/ai/chat/useChatSend.ts (alongside existing AttachedPassage)
export type AttachedRetrieval = {
  readonly bookId: BookId;
};
```

Carries `bookId` (not just an empty marker) for clarity and forward-compat with multi-book retrieval (Phase 5+).

### 4.3 Embedding model versioning

```ts
// src/features/library/indexing/embeddings/EMBEDDING_MODEL.ts
export const EMBEDDING_MODEL_VERSION = 1;
export const EMBEDDING_MODEL_IDS: Readonly<Record<number, string>> = {
  1: 'text-embedding-3-small',
};
export const CURRENT_EMBEDDING_MODEL_ID = EMBEDDING_MODEL_IDS[EMBEDDING_MODEL_VERSION]!;
export const EMBEDDING_DIMS = 1536;
```

Two-version model (chunker + embedding):
| chunker | embedding | result |
|---|---|---|
| current | current | embeddings used as-is |
| stale | current | chunks rebuilt → embeddings cascade-invalidate (chunkId no longer matches) |
| current | stale | embeddings dropped + re-pendinged on next app open; chunks untouched |
| stale | stale | both rebuilt |

The cascade-invalidate path is handled by `deleteOrphans()` (run after a chunker-version rebuild) plus the existing 5.1 `cascade.deleteByBook(chunks)` for full removals.

### 4.4 New IDB store: `book_embeddings` (schema v8)

Migration v7 → v8, additive:

```ts
// src/storage/db/schema.ts
export const BOOK_EMBEDDINGS_STORE = 'book_embeddings';

interface BookwormDBSchema_v8 extends BookwormDBSchema_v7 {
  book_embeddings: {
    key: string;  // ChunkId — same as the chunk's id
    value: BookEmbedding;
    indexes: {
      'by-book': string;  // BookId
    };
  };
}
```

```ts
// src/domain/ai/types.ts (or new file)
export type BookEmbedding = {
  readonly id: ChunkId;            // primary key
  readonly bookId: BookId;
  readonly vector: Float32Array;   // L2-normalized, EMBEDDING_DIMS = 1536
  readonly chunkerVersion: number;
  readonly embeddingModelVersion: number;
  readonly embeddedAt: IsoTimestamp;
};
```

`Float32Array` round-trips through `idb` natively (structured-clone). Storage cost: 1536 floats × 4 bytes = 6KB per chunk; 250 chunks × 6KB = 1.5MB per book.

Migration `7` (i.e. v7→v8) creates the store with the `by-book` index. Defensive `objectStoreNames.contains` check matches the 5.1 pattern.

### 4.5 `BookEmbeddingsRepository` contract

```ts
// src/storage/repositories/bookEmbeddings.ts
export type BookEmbeddingsRepository = {
  upsertMany(records: readonly BookEmbedding[]): Promise<void>;
  listByBook(bookId: BookId): Promise<readonly BookEmbedding[]>;
  deleteByBook(bookId: BookId): Promise<void>;
  countByBook(bookId: BookId): Promise<number>;
  hasEmbeddingFor(chunkId: ChunkId): Promise<boolean>;
  countStaleVersions(currentVersion: number): Promise<readonly BookId[]>;
  deleteOrphans(validChunkIds: ReadonlySet<ChunkId>): Promise<number>;
};
```

- `hasEmbeddingFor`: per-chunk idempotent-resume check (mirrors 5.1's `hasChunksFor`).
- `countStaleVersions`: app-open scan (drops embeddings below `EMBEDDING_MODEL_VERSION`, marks affected books `pending`).
- `deleteOrphans`: runs once after a chunker-version rebuild — receives valid chunk IDs from `chunksRepo`, deletes embeddings whose `id` isn't in the set. Returns count for logging.

Validating-reads (matching 4.4/5.1): malformed records (bad vector length, non-Float32Array, missing version fields) filtered on read; siblings preserved.

### 4.6 Cascade extension

`useReaderHost.onRemoveBook` already cascades `messages → threads → savedAnswers → chunks`. One more line at the end:

```ts
await wiring.bookEmbeddingsRepo.deleteByBook(BookId(book.id));
```

Synchronous `indexing.cancel(bookId)` at the top of the cascade (5.1) already aborts in-flight embedding work.

### 4.7 Storage normalizer for `ContextRef.chunk`

Phase 4.4's `isValidContextRef` (in `src/storage/repositories/contextRefValidation.ts`) currently has full validation for `passage` + lenient pass-through for `highlight | chunk | section`. Extend the `chunk` branch:

```ts
if (v.kind === 'chunk') {
  return typeof (v as Record<string, unknown>).chunkId === 'string'
      && (v as Record<string, unknown>).chunkId !== '';
}
```

Pre-flight grep equivalent (5.1's pattern) before commit 1: `git grep "kind: ['\"]chunk['\"]" src/` to confirm no existing call sites construct chunk refs (the type has been pre-typed since the original domain model but never populated until 5.2).

### 4.8 `App.tsx` wiring

Existing `App.tsx` already wires `bookChunksRepo` (5.1). Adds:
- `bookEmbeddingsRepo` — new field on `Wiring` interface
- `useIndexing` accepts the new repo as a dep
- `embedClient` constructed in App.tsx and passed through
- Inspector modal extends header to show embedding-model version

---

## 5. Embedding pipeline (extends Phase 5.1)

### 5.1 New network module: `nanogptEmbeddings.ts`

Mirrors `nanogptChat.ts` (4.3) — typed failure variants + an `EmbedError` class.

```ts
// src/features/ai/chat/nanogptEmbeddings.ts
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

export class EmbedError extends Error { readonly failure: EmbedFailure; /* … */ }

export async function embed(req: EmbedRequest): Promise<EmbedResult>;
```

Single `POST /v1/embeddings` with `{model, input: inputs[]}`. Response: `{data: [{embedding: number[], index: number}], usage: {prompt_tokens}}` decoded into `Float32Array[]` indexed back to input order. Validates response vector length matches `EMBEDDING_DIMS = 1536`; mismatch → `'dimensions-mismatch'`. No streaming.

> ⚠️ **Implementation-time verification before commit 1 of `nanogptEmbeddings.ts`** — hit the endpoint with `{model: 'text-embedding-3-small', input: ['hello world']}` + a known-good API key, verify the response shape matches the assumed OpenAI-compatible structure. If it diverges, adapt the parser and document in the architecture decision history.

### 5.2 New pipeline stage: `runEmbeddingStage`

Extends `pipeline.ts`. The existing `runIndexing` (5.1) flows `pending → chunking{n} → ready`. Phase 5.2 inserts an embedding stage before the final `ready`:

```ts
export type PipelineDeps = {
  readonly booksRepo: BookRepository;
  readonly chunksRepo: BookChunksRepository;
  readonly embeddingsRepo: BookEmbeddingsRepository;     // NEW
  readonly epubExtractor: ChunkExtractor;
  readonly pdfExtractor: ChunkExtractor;
  readonly embedClient: EmbedClient;                      // NEW
};

export async function runIndexing(book, signal, deps): Promise<void> {
  // … existing chunking stage from 5.1 (unchanged) …

  if (signal.aborted) return;
  await runEmbeddingStage(book, signal, deps);
  if (signal.aborted) return;

  await setStatus(book.id, { kind: 'ready' }, deps.booksRepo);
}

async function runEmbeddingStage(book, signal, deps): Promise<void> {
  await setStatus(book.id, { kind: 'embedding', progressPercent: 0 }, deps.booksRepo);
  const allChunks = await deps.chunksRepo.listByBook(book.id);
  if (allChunks.length === 0) return;  // 5.1 already wrote 'failed' if no text

  const toEmbed: TextChunk[] = [];
  for (const c of allChunks) {
    if (await deps.embeddingsRepo.hasEmbeddingFor(c.id)) continue;
    toEmbed.push(c);
  }

  let processed = allChunks.length - toEmbed.length;
  for (const batch of chunkArray(toEmbed, EMBED_BATCH_SIZE)) {
    if (signal.aborted) return;

    let result: EmbedResult;
    try {
      result = await embedWithRetry(deps.embedClient, {
        modelId: CURRENT_EMBEDDING_MODEL_ID,
        inputs: batch.map((c) => c.normalizedText),
        signal,
      });
    } catch (err) {
      if (signal.aborted) return;
      console.warn('[indexing][embedding]', err);
      await setStatus(book.id, {
        kind: 'failed',
        reason: classifyEmbeddingError(err),
      }, deps.booksRepo);
      return;
    }

    if (signal.aborted) return;

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
}

const EMBED_BATCH_SIZE = 32;
```

The `embedClient: EmbedClient` is an injected interface so `runEmbeddingStage` is unit-testable with a stub client.

### 5.3 `EmbedClient` interface (for dependency injection)

```ts
// src/features/library/indexing/embeddings/types.ts
export type EmbedClient = {
  embed(req: {
    readonly modelId: string;
    readonly inputs: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<EmbedResult>;
};
```

App.tsx constructs:
```ts
const embedClient: EmbedClient = {
  embed: (req) => embeddingsModule.embed({
    apiKey: getApiKey() ?? '',
    ...req,
  }),
};
```

If api key is null, the network call fails with `invalid-key` → pipeline writes `failed: 'embedding-failed'` → user sees library-card prompt. Retry resumes idempotently.

### 5.4 Retry-with-backoff for rate limits

```ts
async function embedWithRetry(
  client: EmbedClient,
  req: EmbedRequest,
  attempts = 3,
): Promise<EmbedResult> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.embed(req);
    } catch (err) {
      if (!(err instanceof EmbedError)) throw err;
      if (err.failure.reason !== 'rate-limit') throw err;
      const baseDelayMs = (err.failure.retryAfterSeconds ?? 1) * 1000;
      const backoffMs = baseDelayMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return client.embed(req);  // last attempt; let any error propagate
}
```

Worst-case wait: 1s + 2s + 4s + final attempt = ~7s before terminal failure. On exhaustion, pipeline writes `failed: 'embedding-rate-limited'`.

### 5.5 L2-normalization helper

```ts
// src/features/library/indexing/embeddings/normalize.ts (pure)
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i]! * vec[i]!;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;  // zero vector edge case
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i]! / norm;
  return out;
}
```

### 5.6 App-open scan extension

`IndexingQueue.onAppOpen` (5.1) currently runs the chunker-version stale check. Phase 5.2 extends:

```ts
async onAppOpen(): Promise<void> {
  // 1) Existing 5.1: chunker stale check (now also cascades embeddings)
  const staleChunkBooks = await this.deps.chunksRepo.countStaleVersions(CHUNKER_VERSION);
  for (const id of staleChunkBooks) {
    await this.deps.chunksRepo.deleteByBook(id);
    await this.deps.embeddingsRepo.deleteByBook(id);  // NEW: cascade
    await this.markPending(id);
  }

  // 2) NEW 5.2: embedding-model stale check (skip books already in step 1)
  const staleEmbedBooks = await this.deps.embeddingsRepo.countStaleVersions(EMBEDDING_MODEL_VERSION);
  for (const id of staleEmbedBooks) {
    if (staleChunkBooks.includes(id)) continue;
    await this.deps.embeddingsRepo.deleteByBook(id);
    await this.markPending(id);
  }

  // 3) Existing 5.1: resume non-terminal status
  // …
}
```

Resumption is naturally idempotent: a book with chunks but no embeddings runs only the embedding stage.

### 5.7 Edge cases

- **Book with zero chunks**: never reaches embedding stage — 5.1 already wrote `failed: 'no-text-found'`.
- **App closed mid-batch**: per-chunk `hasEmbeddingFor` filter on resume catches it.
- **API key removed mid-embedding**: in-flight call throws `invalid-key`; pipeline writes `failed`.
- **Unicode normalization**: embeddings always use `chunk.normalizedText` (already deterministic).
- **Dimensions mismatch from model**: caught by `dimensions-mismatch` failure; pipeline fails terminally.

---

## 6. Retrieval pipeline (query → bundle → prompt)

### 6.1 Pure helpers

```ts
// src/features/ai/retrieval/tokenize.ts
export function tokenizeForBM25(text: string): readonly string[];
//   Lowercase → strip diacritics (NFD + remove combining marks) →
//   split on /\s+/ → drop length-0 or pure-punct tokens.

// src/features/ai/retrieval/bm25.ts
export type BM25Params = { readonly k1: number; readonly b: number };
export const BM25_DEFAULT: BM25Params = { k1: 1.2, b: 0.75 };
export type ScoredChunk = { readonly chunkId: ChunkId; readonly score: number };

export function bm25Rank(
  query: string,
  chunks: readonly TextChunk[],
  params?: BM25Params,
  topN?: number,
): readonly ScoredChunk[];
//   IDF(t) = ln((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
//   Score: Σ idf(t) * tf(t,c) * (k1+1) / (tf(t,c) + k1*(1 - b + b*|c|/avgLen))
//   Returns top-N (default 30) sorted desc by score, score > 0.

// src/features/ai/retrieval/cosine.ts
export function cosineRank(
  queryVector: Float32Array,
  embeddings: readonly BookEmbedding[],
  topN?: number,
): readonly ScoredChunk[];
//   Pre-normalized vectors → dot product. Top-N (default 30) desc by score.

// src/features/ai/retrieval/rrf.ts
export function reciprocalRankFusion(
  rankings: readonly (readonly ScoredChunk[])[],
  k?: number,  // default 60
): readonly ScoredChunk[];
//   For each chunkId in any ranking, score += 1/(k + rank).
//   Returns full union sorted desc by RRF score.

// src/features/ai/retrieval/evidenceBundle.ts
export type EvidenceBundle = {
  readonly sectionGroups: readonly {
    readonly sectionId: SectionId;
    readonly sectionTitle: string;
    readonly chunks: readonly { readonly chunk: TextChunk; readonly citationTag: number }[];
  }[];
  readonly includedChunkIds: readonly ChunkId[];  // citation order: tag N → includedChunkIds[N-1]
  readonly totalTokens: number;
};

export function assembleEvidenceBundle(
  rankedChunkIds: readonly ChunkId[],
  chunks: readonly TextChunk[],
  options: { budgetTokens: number; minChunks: number; maxChunks: number },
): EvidenceBundle;
//   1. Resolve chunkIds → TextChunk records (skip missing).
//   2. Greedy-pack in RRF order until budget exhausted, capped at maxChunks
//      and floored at minChunks. includedChunkIds in RRF rank order.
//   3. Re-group by sectionId, preserving section first-appearance order.
//   4. Within each section: sort by chunk-index parsed from chunkId.
//   5. Return EvidenceBundle.

export function buildEvidenceBundleForPreview(bundle: EvidenceBundle): string;
//   Same character-for-character output that goes into the user message
//   block. Exported so PrivacyPreview can show the actual bundle.
```

`chunkIndexInSection` parse: chunkId is `chunk-{bookId}-{sectionId}-{N}` (5.1 format). Trailing `-N` parsed as integer; on parse-fail (defensive), the chunk falls to the end of its section group.

### 6.2 `assembleRetrievalChatPrompt`

```ts
// src/features/ai/chat/promptAssembly.ts (extended)

const RETRIEVAL_MODE_ADDENDUM =
  'The user has searched this book for relevant excerpts; they are ' +
  'numbered [1], [2], … below. Treat these as the primary evidence. ' +
  'Reference them by tag in your answer when you draw on a specific ' +
  'excerpt (e.g. "as discussed in [3]"). If the excerpts do not contain ' +
  'enough to answer, say so plainly and offer to help once they share more ' +
  'context. Do not invent excerpts that are not present.';

export const HISTORY_SOFT_CAP_RETRIEVAL = 25;

export type AssembleRetrievalChatInput = {
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
  readonly bundle: EvidenceBundle;
};

export function assembleRetrievalChatPrompt(
  input: AssembleRetrievalChatInput,
): AssembleOpenChatResult;
```

Output structure: `[ system(open-mode prompt + "\n\n" + RETRIEVAL_MODE_ADDENDUM, single combined message), …history, user(buildEvidenceBundleForPreview(bundle) + "\n\n" + newUserText) ]`.

The user message body:
```
You are answering questions about "Pride and Prejudice" using the
following excerpts.

### Chapter 4 — At Netherfield
[3] <chunk text>
[7] <chunk text>

### Chapter 9 — Bingley's choice
[1] <chunk text>
[2] <chunk text>

(User question: ) What does Mr. Darcy think of Elizabeth's family?
```

Soft-cap reduction (extended from 4.4):
```ts
function effectiveSoftCap(history, thisModeIsRetrieval, thisModeIsPassage): number {
  if (thisModeIsRetrieval || history.some((m) => m.mode === 'retrieval')) return HISTORY_SOFT_CAP_RETRIEVAL;
  if (thisModeIsPassage   || history.some((m) => m.mode === 'passage'))   return HISTORY_SOFT_CAP_PASSAGE;
  return HISTORY_SOFT_CAP_OPEN;
}
```

### 6.3 `runRetrieval` orchestrator

```ts
// src/features/ai/retrieval/runRetrieval.ts

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

export async function runRetrieval(input: {
  readonly bookId: BookId;
  readonly question: string;
  readonly deps: RetrievalDeps;
  readonly signal?: AbortSignal;
}): Promise<RetrievalResult>;
```

Implementation:
1. Parallel fetch: `Promise.all([chunksRepo.listByBook, embeddingsRepo.listByBook])`.
2. If `embeddings.length === 0` → `{kind: 'no-embeddings'}`.
3. Embed question via `deps.embedClient.embed`. On failure → `{kind: 'embed-failed', reason}`. L2-normalize result.
4. `Promise.all([bm25Rank, cosineRank])`.
5. `reciprocalRankFusion`. If empty → `{kind: 'no-results'}`.
6. `assembleEvidenceBundle` with default options.
7. Return `{kind: 'ok', bundle}`.

Wall-clock: ~250ms (mostly question-embedding round-trip).

### 6.4 `useChatSend` extension

```ts
type Args = {
  // ...existing 4.3 + 4.4 fields...
  readonly attachedRetrieval?: AttachedRetrieval | null;
  readonly retrievalDeps?: RetrievalDeps;
};
```

Branch precedence:
1. `attachedRetrieval` → `runRetrieval`, branch on result:
   - `ok` → `assembleRetrievalChatPrompt`, `mode: 'retrieval'`, `contextRefs` on assistant = retrieved chunks in citation order.
   - `no-embeddings` → inline error bubble: "still being prepared for AI".
   - `embed-failed` → `ChatErrorBubble` with reason.
   - `no-results` → inline error bubble: "no relevant excerpts found".
2. Else if `attachedPassage` → existing 4.4 path.
3. Else → existing 4.3 open-mode path.

Mutual exclusivity is enforced at the workspace level; `useChatSend` dispatches on whichever is non-null.

### 6.5 Edge cases

- **Empty question**: composer disables send; never reached.
- **Question >2000 chars**: defensively truncated before embedding (preserves original in `userMessage.content`).
- **User cancels mid-retrieval**: abort signal propagates through `embed`. User message preserved.
- **Single chunk in book**: `assembleEvidenceBundle` honors minChunks only if available; emits the 1.
- **All chunks tied at score 0 in BM25**: `bm25Rank` returns empty; cosine ranking carries forward; bundle ships.

---

## 7. UI — trigger + provenance

### 7.1 `ChatComposer` — search toggle

New icon button next to send:

```tsx
{onToggleSearch !== undefined ? (
  <button
    type="button"
    className={
      retrievalAttached
        ? 'chat-composer__search-toggle chat-composer__search-toggle--active'
        : 'chat-composer__search-toggle'
    }
    aria-label={retrievalAttached ? 'Cancel book search' : 'Search this book'}
    aria-pressed={retrievalAttached}
    onClick={onToggleSearch}
  >
    <SearchIcon />
  </button>
) : null}
```

New props: `onToggleSearch?: () => void` and `retrievalAttached?: boolean`. Hidden when `onToggleSearch` is undefined.

### 7.2 `RetrievalChip` component

```ts
// src/features/ai/chat/RetrievalChip.tsx
type Props = {
  readonly onDismiss: () => void;
};
```

Visual layout: `🔍 Searching this book ✕`. `role="status" aria-live="polite"`. Same surface-elevated styling as `PassageChip`.

### 7.3 `ChatPanel` — single-chip slot

```tsx
{attachedRetrieval !== null && props.onClearAttachedRetrieval ? (
  <RetrievalChip onDismiss={props.onClearAttachedRetrieval} />
) : attachedPassage !== null && props.onClearAttachedPassage ? (
  <PassageChip /* …existing props… */ />
) : null}
```

ChatPanel props extend with: `attachedRetrieval`, `onClearAttachedRetrieval`, `retrievalDeps`. `useChatSend` integration: passes `attachedRetrieval` and `retrievalDeps` through.

### 7.4 `MessageBubble` — multi-source footer

Extended logic:
```tsx
const sourceRefs = message.contextRefs.filter(
  (r) => r.kind === 'passage' || r.kind === 'chunk',
);
if (sourceRefs.length === 0) return null;
if (sourceRefs.length === 1) return <SingleSourceFooter ... />;
return <MultiSourceFooter refs={sourceRefs} ... />;
```

`SingleSourceFooter` is the existing 4.4 rendering, extracted for clarity. `MultiSourceFooter` is new:

Compact: `📎 Sources: Ch 4 [3] · Ch 9 [1] [2] · Ch 12 [7]` — `[N]` are clickable citation chips, grouped by section in citation order.

For `chunk` refs, the anchor is resolved via a new prop:
```ts
readonly resolveChunkAnchor?: (chunkId: ChunkId) => Promise<LocationAnchor | null>;
```

The async resolver is fine because click-to-jump is user-initiated. `sectionTitle` is denormalized on the chunk record; one batch fetch on first render of the footer caches it.

### 7.5 `PrivacyPreview` — search-plan subsection

Collapsed summary updates:
```
Sending: Pride and Prejudice + search this book + your messages → gpt-x
```

Expanded form gains a "Search plan" subsection:
```
Search plan
This book — 250 chunks · embeddings ready
Will fetch up to 12 chunks / ~3000 tokens of the most relevant excerpts
to gpt-x. The actual excerpts depend on your question.
```

Counts read from `chunksRepo.countByBook` + `embeddingsRepo.countByBook`. If `embeddingsCount === 0`, warning shown:
```
This book is still being prepared for AI. Sending now will return
"no embeddings yet". Wait for the library card to show ✓ Indexed.
```

### 7.6 `NotebookRow.savedAnswer` — multi-source jump

4.4 added a single Jump button. Phase 5.2 extends:
- 0 sources: no button (open-mode answer)
- 1 source: existing single Jump button
- 2-5 sources: inline citation chips
- 6+ sources: ▾ popover listing all sources

Same component as the message bubble's multi-source footer (extract to a shared `MultiSourceList`).

### 7.7 `ReaderWorkspace` — state + bridge

```ts
const [attachedRetrieval, setAttachedRetrieval] = useState<AttachedRetrieval | null>(null);

const handleToggleSearch = useCallback((): void => {
  if (attachedRetrieval !== null) {
    setAttachedRetrieval(null);
  } else {
    setAttachedPassage(null);  // mutual exclusivity
    setAttachedRetrieval({ bookId: BookId(props.bookId) });
  }
}, [attachedRetrieval, props.bookId]);

const handleClearAttachedRetrieval = useCallback((): void => {
  setAttachedRetrieval(null);
}, []);
```

`retrievalDeps`:
```ts
const retrievalDeps: RetrievalDeps = useMemo(() => ({
  chunksRepo: wiring.bookChunksRepo,
  embeddingsRepo: wiring.bookEmbeddingsRepo,
  embedClient: { embed: (req) => nanogptEmbeddings.embed({apiKey: getApiKey() ?? '', ...req}) },
}), [wiring, getApiKey]);
```

`handleAskAI` (4.4) clears `attachedRetrieval` when materializing a passage chip — mutual exclusivity.

### 7.8 CSS additions

```css
.retrieval-chip {
  /* shape identical to .passage-chip */
}

.message-bubble__multi-source {
  display: flex;
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
}

.chat-composer__search-toggle {
  /* icon button, transparent default */
}
.chat-composer__search-toggle--active {
  background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface));
}
```

### 7.9 Accessibility

- Search toggle: `role="button"` + `aria-pressed` + `aria-label` describes both states.
- RetrievalChip: `role="status" aria-live="polite"`.
- Multi-source footer chips: each `<button>` with `aria-label="Jump to source 3"` (or section title when available).
- "Search plan" subsection: `<section>` with `<h3>`.

---

## 8. Cross-feature integration

- **`useReaderHost.onRemoveBook`** gains `await wiring.bookEmbeddingsRepo.deleteByBook(BookId(book.id));` after the existing chunks deletion.
- **Library import** (`wiring.ts:persistBook` or successor): unchanged. The same `setOnBookImported` callback (5.1) triggers the same `indexing.enqueue`, which now includes the embedding stage.
- **`App.tsx`** instantiates `wiring.bookEmbeddingsRepo` via `createBookEmbeddingsRepository(db)`; constructs `embedClient` via `nanogptEmbeddings.embed`; passes both to `useIndexing`. Constructs `retrievalDeps` and threads it through `ChatPanel`.
- **`ChatPanel`** props gain `attachedRetrieval`, `onClearAttachedRetrieval`, `retrievalDeps`. Threads `attachedRetrieval` + `retrievalDeps` into `useChatSend`.
- **`useReaderHost`** Args extend with `bookEmbeddingsRepo: BookEmbeddingsRepository`.
- **No `useReaderHost` API changes** beyond the cascade extension.
- **No reader contract changes.**

---

## 9. Privacy & accessibility

### 9.1 Privacy doctrine reinforcement

- Chunks are derived from book content the user already imported into local IDB. Embedding sends `normalizedText` to NanoGPT (same provider already trusted with chat completions); not new exposure.
- Pre-send: `PrivacyPreview` explicitly states what's being sent (search plan + token budget). Honest about what's *known* at compose-time vs *determined* at send-time.
- Post-send: `MessageBubble` source footer shows actual chunks. Saved-answer rows snapshot `contextRefs` so the user can audit later.
- Engine doc's "user always sees what we send" principle: satisfied via `buildEvidenceBundleForPreview` exporting the exact prompt content (snapshot-tested for equivalence with `assembleRetrievalChatPrompt`).

### 9.2 Accessibility

Per §7.9 plus:
- All new interactive elements have visible focus rings (existing accent token).
- AA contrast verified against the existing palette.
- Modal patterns inherit existing settings-modal accessibility.
- Async chunk-anchor resolution shows a brief loading state on the source footer (`aria-busy="true"` until resolved); never blocks the page.

---

## 10. Testing strategy

### 10.1 Unit (Vitest)

**Pure helpers (~30 tests):**
- `tokenizeForBM25` — diacritics, punctuation, mixed-case, unicode letters preserved, empty-after-strip.
- `bm25Rank` — known small corpus → expected ranking; no-overlap query → empty; tied scores; long vs short chunks (length normalization).
- `cosineRank` — pre-normalized → expected dot products; zero query vector → no scores; dimension mismatch throws.
- `reciprocalRankFusion` — known input → expected merged order; both empty → empty; one empty → other preserved.
- `assembleEvidenceBundle` — happy path with budget exhaustion; minChunks/maxChunks honored; section regrouping; reading-order within section; missing chunk IDs skipped.
- `buildEvidenceBundleForPreview` — character-for-character match with `assembleRetrievalChatPrompt` (snapshot-equivalence test, same pattern as 4.4 PrivacyPreview).
- `assembleRetrievalChatPrompt` — combined system; addendum substring; bundle in last user message; soft-cap reduction triggered correctly.
- `l2Normalize` — typical → ‖result‖ ≈ 1; zero → zero; already-unit → unchanged.
- `classifyEmbeddingError` — error → reason mapping.
- `chunkArray` — exact-multiple, off-by-one, empty.

**Imperative shell (~15 tests):**
- `BookEmbeddingsRepository` — round-trip with `fake-indexeddb`; `hasEmbeddingFor`; `countByBook`; `countStaleVersions`; `deleteByBook`; `deleteOrphans`; validating-reads; Float32Array round-trips.
- `nanogptEmbeddings.embed` — happy path mocked; auth header; response parsed in input order; HTTP failures classified into typed `EmbedFailure`; abort propagates.
- `runEmbeddingStage` — happy path writes status correctly; idempotent resume; abort returns without writing failed; embedClient throws → status flips to `failed{reason}`; rate-limit retry hits 3× then throws.
- `runRetrieval` — happy path; embeddings missing → `no-embeddings`; embed throws → `embed-failed`; empty fusion → `no-results`.
- `useChatSend` with `attachedRetrieval` — `mode: 'retrieval'` on both messages; `contextRefs` on assistant only (4.4's asymmetry holds); chunks in citation order; calls `assembleRetrievalChatPrompt`.

**Component (~10 tests):**
- `RetrievalChip` — renders + dismiss + ARIA.
- `MessageBubble` multi-source footer — 1-source unchanged; 2+ refs → multi-source; chip clicks call `onJumpToSource`; aria-labels include section title.
- `ChatComposer` search toggle — visible only when `onToggleSearch` provided; `aria-pressed` reflects state; click fires.
- `ChatPanel` chip slot — renders correct chip per state.
- `PrivacyPreview` "Search plan" — renders only when attached; counts reflect props; warning when `embeddingsCount === 0`.
- `NotebookRow.savedAnswer` multi-source — 0/1/2-5/6+ ref handling.

### 10.2 Integration (Vitest + happy-dom + fake-indexeddb)

- End-to-end `runRetrieval` against a fixture corpus + mocked embed client; bundle output matches snapshot.
- End-to-end `runIndexing` chunking → embedding → ready (mocked extractor + embed client); partial-resume scenario.
- App-open scan: pre-populate stale-version embeddings; confirm `onAppOpen` drops + re-pendings.

### 10.3 E2E (Playwright)

- `chat-retrieval-mode-desktop.spec.ts`: configure key + model → import → wait for `ready` → click Search → see chip → mock `/v1/embeddings` and `/v1/chat/completions` → send question → multi-source footer → click [1] → reader navigates.
- `chat-retrieval-mode-no-embeddings.spec.ts`: import → before embedding finishes, click Search + send → "still being prepared" error bubble.
- `library-card-embedding-status.spec.ts`: import → observe `pending → chunking{n} → embedding{n} → ready`.

### 10.4 Quality gate

`pnpm check` clean per commit. `pnpm test:e2e` runs before the docs commit.

---

## 11. File map

### 11.1 New files

```
src/features/ai/chat/
  nanogptEmbeddings.ts (+test)
  RetrievalChip.tsx (+test)

src/features/ai/retrieval/
  tokenize.ts (+test)
  bm25.ts (+test)
  cosine.ts (+test)
  rrf.ts (+test)
  evidenceBundle.ts (+test)
  runRetrieval.ts (+test)

src/features/library/indexing/embeddings/
  EMBEDDING_MODEL.ts
  normalize.ts (+test)
  classifyEmbeddingError.ts (+test)
  types.ts                      — EmbedClient interface

src/storage/repositories/
  bookEmbeddings.ts (+test)

e2e/
  chat-retrieval-mode-desktop.spec.ts
  chat-retrieval-mode-no-embeddings.spec.ts
  library-card-embedding-status.spec.ts
```

### 11.2 Modified

```
src/domain/ai/types.ts                                  (BookEmbedding type added; ContextRef.chunk validation tightened indirectly)
src/storage/db/schema.ts                                (v7 → v8: add book_embeddings store + index)
src/storage/db/migrations.ts                            (migration 7 — adds book_embeddings store)
src/storage/index.ts                                    (export createBookEmbeddingsRepository, BookEmbeddingsRepository)
src/storage/repositories/contextRefValidation.ts        (real validation for chunk variant)
src/features/library/wiring.ts                          (add bookEmbeddingsRepo + embedClient construction)
src/features/library/indexing/pipeline.ts               (extend with runEmbeddingStage)
src/features/library/indexing/IndexingQueue.ts          (extend onAppOpen with embedding-stale check + cascade)
src/features/library/indexing/useIndexing.ts            (accept embeddingsRepo + embedClient)
src/features/library/indexing/IndexInspectorModal.tsx   (header shows embedding-model version)
src/app/useReaderHost.ts                                (cascade adds embeddingsRepo.deleteByBook; new prop bookEmbeddingsRepo)
src/app/App.tsx                                         (instantiate embedClient + retrievalDeps; pass to ChatPanel)
src/features/ai/chat/promptAssembly.ts                  (assembleRetrievalChatPrompt + RETRIEVAL_MODE_ADDENDUM + soft-cap extension)
src/features/ai/chat/useChatSend.ts                     (AttachedRetrieval type; attachedRetrieval branch)
src/features/ai/chat/ChatPanel.tsx                      (chip slot + threading)
src/features/ai/chat/ChatComposer.tsx                   (search toggle button + props)
src/features/ai/chat/MessageBubble.tsx                  (extract SingleSourceFooter; new MultiSourceFooter)
src/features/ai/chat/PrivacyPreview.tsx                 (search-plan subsection)
src/features/ai/chat/chat-panel.css                     (retrieval-chip + multi-source + composer-toggle styles)
src/features/annotations/notebook/NotebookRow.tsx       (multi-source jump UI; chunk-ref support)
src/features/reader/workspace/ReaderWorkspace.tsx       (attachedRetrieval state + handleToggleSearch + retrievalDeps)
src/storage/repositories/bookmarks.test.ts (et al)      (existing tests get bookEmbeddingsRepo stubs in fakeWiring)

docs/04-implementation-roadmap.md                       (status block)
docs/02-system-architecture.md                          (decision-history entry)
```

---

## 12. Commit slicing (Approach 2 — sliced commits)

Each commit independently green:

1. `feat(domain): chunks — add BookEmbedding type`
2. `feat(storage): v8 migration — add book_embeddings store with by-book index`
3. `feat(storage): BookEmbeddingsRepository — upsertMany/listByBook/hasEmbeddingFor/countStaleVersions/deleteOrphans`
4. `feat(storage): tighten ContextRef.chunk validation in shared validator`
5. `feat(indexing): EMBEDDING_MODEL constants + l2Normalize + classifyEmbeddingError pure helpers`
6. `feat(network): nanogptEmbeddings — POST /v1/embeddings + EmbedError typed failures (incl. dim-mismatch verification)`
7. `feat(indexing): runEmbeddingStage — extend pipeline with embedding stage + retry-with-backoff`
8. `feat(indexing): IndexingQueue.onAppOpen — embedding-stale scan + chunker-cascade`
9. `feat(retrieval): pure helpers — tokenize, bm25Rank, cosineRank, rrf`
10. `feat(retrieval): assembleEvidenceBundle + buildEvidenceBundleForPreview pure helpers`
11. `feat(retrieval): runRetrieval orchestrator with no-embeddings / embed-failed / no-results result variants`
12. `feat(ai): assembleRetrievalChatPrompt + RETRIEVAL_MODE_ADDENDUM + HISTORY_SOFT_CAP_RETRIEVAL`
13. `feat(ai): useChatSend accepts attachedRetrieval + retrievalDeps; mode=retrieval on send`
14. `feat(chat): RetrievalChip — sticky chip with dismiss`
15. `feat(chat): ChatComposer search toggle button + aria-pressed state`
16. `feat(chat): ChatPanel — single chip slot (retrieval XOR passage); thread retrievalDeps`
17. `feat(chat): MessageBubble multi-source footer with citation-tag chips`
18. `feat(chat): PrivacyPreview search-plan subsection`
19. `feat(notebook): NotebookRow multi-source jump UI for retrieval saved answers`
20. `feat(app): wire bookEmbeddingsRepo + embedClient + retrievalDeps + cascade integration`
21. `feat(library): IndexInspectorModal — show embedding-model version in header`
22. `test(e2e): retrieval mode — desktop + no-embeddings + library-card embedding status`
23. `docs: Phase 5.2 — architecture decision + roadmap status complete`

~23 commits.

---

## 13. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| NanoGPT's `/v1/embeddings` endpoint differs from OpenAI's shape | First embedding call fails | Implementation-time verification before commit 6 — hit the endpoint, verify response shape. Adapt parser if it diverges; document in decision history. |
| Network rate-limits | Multi-book imports hit limits | Retry-with-backoff (3 attempts × exponential); on exhaustion, fail terminally with `'embedding-rate-limited'`. User retries. |
| Float32Array IDB round-trip behavior | Vectors corrupt on read | `idb` uses structured-clone; preserves typed arrays per spec. Validating-reads filter catches corrupt records. Unit-tested with `fake-indexeddb`. |
| BM25 quality on multilingual books | Tokenizer is ASCII-leaning | v1 strips diacritics + splits on whitespace — works for Latin-script content. CJK/RTL is Phase 6+ (`Intl.Segmenter`). Documented limitation. |
| Chunker version bump leaves orphan embeddings | Storage waste | `deleteOrphans` runs after chunker-version cascade; logged warning if orphans found. |
| Embedding-mid-pipeline app close | Status stuck in `embedding{n}` | Resume scan on app open re-enqueues; `hasEmbeddingFor` filter skips done chunks. |
| Question-embedding cost at scale | $$$ over a long session | Each query ≈ $0.00002. 1000 queries = $0.02. Negligible. Phase 6+ can cache duplicate questions. |
| Bundle exceeds model context | Some chunks dropped silently | 3000-token budget is conservative; logs actual token count. Phase 6+ can surface a warning. |
| NanoGPT proxies a model with different dims | Dimensions mismatch | `dimensions-mismatch` failure caught; pipeline writes `failed`. Pre-flight verification minimizes the chance. |
| Multi-language tokenizer false-negatives | Retrieval falls back to semantic-only | Documented; semantic still works. Phase 6+ adds Unicode word-segmenter. |
| Saved-answer rows pre-5.2 with stale chunk refs | Notebook jump-to fails silently | Validating-reads pattern; rare in practice (no chunk refs were ever populated before 5.2). |

---

## 14. Out of scope (explicit destinations)

| Deferred | Destination phase |
|---|---|
| Prompt caching breakpoints | Phase 6 polish (engine doc §) |
| Pre-built BM25 inverted index | Phase 6+ if profiling justifies |
| ANN / HNSW | Phase 6+ if libraries grow >100K vectors |
| Local on-device embeddings (Transformers.js / WebGPU) | Phase 7 deferred exploration |
| Cross-book retrieval | Phase 5+ multi-book mode |
| Configurable evidence budget / top-K in settings | Phase 6 polish |
| Suggested prompts | Phase 5.3 |
| Chapter mode | Phase 5.4 (will reuse retrieval infrastructure) |
| Web Worker for retrieval / embedding compute | Phase 6+ if profiling justifies |
| Cross-encoder re-ranking | Phase 5+ (quality refinement) |
| Embedding-cost meter UI | Phase 6 polish |
| Multilingual tokenizer (CJK, RTL) | Phase 6+ via `Intl.Segmenter` |
| "Retry embeddings only" without re-chunking | Phase 6 polish (v1 just full-rebuilds) |
| Per-thread question-embedding cache | Phase 6+ if duplicate questions are common |
| User-configurable embedding model picker | Phase 6 polish |
| Prompt-cache-aware bundle ordering (stable prefix) | Phase 6 polish |

---

## 15. Validation checklist

Before declaring Phase 5.2 complete:

- [ ] All ~23 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new retrieval-mode suite plus all prior suites.
- [ ] **Manual smoke (embeddings)**: import the fixture EPUB → wait for `ready` (chunking + embedding both visible in library card status) → confirm IDB has expected number of embeddings.
- [ ] **Manual smoke (retrieval)**: open chat → click Search → ask "where is X discussed" → confirm multi-source footer with reasonable citations → click [1] → reader navigates to that chunk.
- [ ] **Manual smoke (resume)**: kick off indexing → reload mid-embedding → confirm resume picks up at next un-embedded chunk (observable in IDB embedding count + status flow).
- [ ] **Manual smoke (no-embeddings)**: import → before embedding finishes, click Search + send → confirm "still being prepared" inline error bubble.
- [ ] **Manual smoke (rebuild)**: rebuild from inspector → confirm embeddings regenerate alongside chunks.
- [ ] **Manual smoke (cascade)**: remove a book during embedding → pipeline cancels cleanly; no orphaned `embedding` status; no leaked embeddings.
- [ ] **Manual smoke (saved answers)**: send a retrieval-mode question → save → notebook → "AI answers" filter → verify multi-source jump-back works for each citation.
- [ ] `docs/04-implementation-roadmap.md` Status block updated: `Phase 5.2 — complete (YYYY-MM-DD)`.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard ≥ 22/27 per `docs/08-agent-self-improvement.md`.
