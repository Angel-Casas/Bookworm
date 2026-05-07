# Phase 5.4 — Chapter mode

**Status:** approved 2026-05-07
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 5 → Task 5.4 (chapter portion only; multi-excerpt split out as Phase 5.5)
**Predecessors:** Phase 4.3 chat panel (`ChatPanel`, `ChatComposer`, `useChatSend`); Phase 4.4 passage mode (chip pattern, `attachedPassage` arg, `PassageChip`, mutual exclusion in render); Phase 5.1 chunking (`BookChunksRepository`, `TextChunk`, `sectionId` shape); Phase 5.2 retrieval baseline (composer-toolbar toggle pattern, `attachedRetrieval` arg, `contextRefs` source-footer rendering); Phase 5.3 hardening (`onBookStatusChange` callback shape; sentinel-id avoidance pattern from PR #25); annotations (`HighlightsRepository`, `NotesRepository`).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` §2 "Chapter mode" (input/output spec); `docs/02-system-architecture.md` §"Decision history" (functional core / imperative shell split, snapshot-not-live attached-context semantics from Phase 4.4, mutually-exclusive chip rendering from Phase 5.2); `docs/06-quality-strategy.md` (file/function thresholds, error-state requirements, accessibility floor); today's `2026-05-07 — Phase 5.3 post-merge hardening` entry (callback-based store updates, no upward dependency from pipeline to React store).

---

## 1. Goal & scope

Add a chapter-mode chat affordance: a composer-toolbar button (`📖`) next to the existing search-mode toggle attaches the **current chapter** as context for the next chat. The attachment renders as a dismissible chip (`📖 [Chapter title] · N chunks · M highlights · K notes`), mirroring the passage chip pattern. Send routes through a new chapter branch in `useChatSend` that includes the chapter's chunks + the user's highlights/notes from that chapter as the LLM context. Source evidence stays visible via the chip during composition and via a `contextRefs` source footer on the assistant message after streaming.

**In scope (v1, this phase):**

*Domain:*
- New `AttachedChapter` type (in `useChatSend.ts` next to `AttachedPassage` and `AttachedRetrieval`):
  `{ sectionId, sectionTitle, chunks: readonly TextChunk[], highlights: readonly Highlight[], notes: readonly Note[] }`. Snapshot taken at click time — chip and payload are frozen at that moment.
- `ChatMessage.mode` literal `'chapter'` added to existing union.
- `ContextRef` discriminated-union variant: `{ kind: 'chapter-section'; sectionId: SectionId; sectionTitle: string }`.

*Pure helpers:*
- `resolveCurrentChapter(currentEntryId, allBookChunks) → { sectionId, sectionTitle, chunks } | null`. Strips URI fragment from `currentEntryId`, prefixes `spine:`, queries chunks. Returns `null` when no chunks match. Drives the toolbar button's `disabled` state at render time AND produces the snapshot at click time.
- `assembleChapterPrompt({ book, sectionTitle, chunks, highlights, notes })` → `ChatCompletionMessage[]`. Builds the `[system, user]` pair. Even-stride sampling on chunks if their tokens exceed the chapter-context budget; highlights/notes always included.

*Network/orchestration:*
- New chapter branch inside `useChatSend.send`. Parallel to the existing passage and retrieval branches: assembles messages, persists user message with `mode: 'chapter'` and `contextRefs: [{ kind: 'chapter-section', ... }]`, streams answer with `mode: 'chapter'` propagated to the assistant placeholder.

*UI:*
- New `ChapterChip` component (mirrors `PassageChip` shape): renders title + chunk/highlight/note counts; × dismisses.
- `ChatComposer` toolbar button between the existing search toggle and send button. Disabled when `attachable` is false. Click → toggles `attachedChapter` state.
- `ReaderWorkspace` state: new `attachedChapter` plus a single `setActiveAttachment(kind, payload)` reducer that owns the mutual-exclusion logic for all three attachment kinds (`passage` | `retrieval` | `chapter`).
- `ChatPanel` chip-render block extended: render exactly one of `RetrievalChip` / `PassageChip` / `ChapterChip` (existing if-else extended).

*Token budget:*
- 6500 internal tokens reserved for chapter context (consistent with `EMBED_TOKEN_BUDGET` from Phase 5.2 hardening).
- Highlights + notes always included (typically < 500 tokens combined).
- Chunks fill the remainder. Even-stride sample if chunks exceed.

**Out of scope (deferred):**

- **Per-chapter LLM-generated summaries** — AI context engine doc mentions "chapter summary if available" but Phase 5.3 only generates a book-level summary. Generating per-chapter summaries is its own substantial feature.
- **Precise per-anchor TOC↔chunk matching** for multi-chapter spine files. v1 maps coarsely by spine entry; if a multi-chapter HTML file contains chapters VII and VIII, the chip pulls chunks for both. Acceptable trade-off documented as a known limitation.
- **PDF chapter mode without TOC.** Button disabled in that case.
- **Multi-excerpt mode** — Phase 5.5.
- **Rich evidence rendering in the assistant message.** Source footer just shows the chapter title; jumping back uses the existing `onJumpToReaderAnchor` plumbing from Phase 5.2.
- **Stale-snapshot prompts.** If user navigates after attaching, chip still points at the original chapter (snapshot semantics). Chip label makes this obvious; no UI to suggest "you've moved — re-attach?".

---

## 2. UX & flow

**Trigger placement:** composer toolbar, between the existing search-mode toggle and the send button. `📖` glyph (or `BookOpenIcon` if added). When clicked with no current chapter resolvable, button is disabled with tooltip "No chapter detected for the current page."

**Mutual exclusion:** setting `attachedChapter` clears any active `attachedPassage` and `attachedRetrieval`. Setting either of those clears `attachedChapter`. Routed through `setActiveAttachment` so the rule lives in one place.

**Snapshot semantics (matches Phase 4.4 passage mode):** clicking the button takes a snapshot of `{sectionId, sectionTitle, chunks, highlights, notes}` at that moment. Subsequent reader navigation does not silently re-target. Chip label shows the snapshotted chapter title so the user can see what's attached.

**Empty / null states:**

| Reader state | Button | Tooltip |
|---|---|---|
| No book loaded | hidden (composer not rendered yet) | n/a |
| Loaded, `currentEntryId` undefined | disabled | "No chapter detected for the current page." |
| Loaded, `resolveCurrentChapter` returns null (PDF without TOC, etc.) | disabled | "No chapter detected for the current page." |
| Loaded, chapter resolvable, no chip active | enabled | "Ask about this chapter" |
| Loaded, chapter chip already attached | enabled (acts as toggle-off) | "Clear chapter context" |

**Chip rendering:** `📖 [Chapter VII] · 12 chunks · 3 highlights · 1 note  ×`. Clicking × dismisses. The counts surface what's attached; the title surfaces which chapter (which is the snapshot, not the live position).

**Source evidence after send:** assistant message renders a source footer "Drawn from [Chapter VII]" using the existing `MessageBubble` source-footer code path (Phase 5.2 already renders `contextRefs[0]` if present); the new `chapter-section` variant slots in.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  ReaderWorkspace                                                  │
│    state: attachedChapter | attachedPassage | attachedRetrieval   │
│    setActiveAttachment(kind, payload)  ← single reducer            │
│    derives: currentEntryId from readerState                       │
│                                                                   │
│    ┌─────────────────────────┐    ┌─────────────────────────┐     │
│    │ ChatPanel                │    │ resolveCurrentChapter    │     │
│    │  - chip render block     │←───│  (currentEntryId,        │     │
│    │  - useChatSend           │    │   chunksRepo.listByBook) │     │
│    │     · attachedChapter    │    │   → AttachedChapter|null │     │
│    │     · chapter branch     │    └─────────────────────────┘     │
│    └────────┬────────────────┘                                    │
│             │                                                     │
│             ▼                                                     │
│   ┌─────────────────────────────────────┐                         │
│   │  useChatSend chapter branch          │                         │
│   │   ├── assembleChapterPrompt(...)     │                         │
│   │   ├── append user msg (mode:chapter, │                         │
│   │   │     contextRefs:[chapter-section]│                         │
│   │   ├── append assistant placeholder   │                         │
│   │   └── stream → finalize              │                         │
│   └─────────────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────┘
```

**Key boundaries:**

- `resolveCurrentChapter` is pure, takes only the data it needs (entry id + chunks list). Lives in `features/ai/prompts/` next to `assembleChapterPrompt`. Testable in isolation.
- `assembleChapterPrompt` is pure, produces `ChatCompletionMessage[]`. No I/O, no state.
- `useChatSend` chapter branch follows the same shape as the existing passage and retrieval branches (read args via `argsRef`, append user, append assistant, stream, finalize). The threadId-override fix from PR #25 is automatic — chapter branch uses the same resolved `threadId` local.
- `setActiveAttachment` reducer in `ReaderWorkspace` is the single source of truth for which chip is active. Components consume read-only state and call setter actions.

**Data-model resolution: TOC entry → chunks.**

EPUB TOC entries have `id` shaped like `OEBPS/foo.html` or `OEBPS/foo.html#chapter-7` (raw href from foliate-js). Chunks are stored with `sectionId` shaped like `spine:OEBPS/foo.html`. To bridge:

```
1. fragment = currentEntryId.indexOf('#')
2. spineFile = fragment >= 0 ? currentEntryId.slice(0, fragment) : currentEntryId
3. targetSectionId = SectionId('spine:' + spineFile)
4. chunks = allChunks.filter(c => c.sectionId === targetSectionId)
5. if chunks.length === 0 → return null (button disabled / chip not creatable)
```

Multi-chapter spine files: if Chapter VII and VIII are in the same HTML, both TOC entries resolve to the same `targetSectionId`, so both pull the same chunk set. Documented v1 limitation; precise per-anchor matching is a follow-up.

**Highlights/notes lookup:**

`HighlightsRepository.listByBook(bookId) → Highlight[]` already exists. Each highlight has an `anchor` (LocationAnchor — CFI for EPUB, page+rect for PDF). To filter to "highlights in current chapter", match on the same spine-prefix logic: parse the highlight's anchor CFI to extract the spine file path; keep only highlights whose spine path matches the snapshot's `sectionId`. Notes are looked up by `highlightId` once highlights are filtered (`NotesRepository.listByHighlightIds`).

For PDFs: highlights have `{ kind: 'pdf', page, rect }` anchors. Chapter mode is disabled for PDFs without TOC (and we noted PDF chapter mode is out of scope), so PDF anchor parsing is irrelevant for v1.

---

## 4. Domain model changes

```typescript
// src/features/ai/chat/useChatSend.ts (or domain re-export)

export type AttachedChapter = {
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly chunks: readonly TextChunk[];
  readonly highlights: readonly Highlight[];
  readonly notes: readonly Note[];
};

// existing union extended:
type ChatMessageMode = 'open' | 'passage' | 'retrieval' | 'chapter';

// existing union extended:
type ContextRef =
  | { kind: 'passage'; ... }
  | { kind: 'retrieval-chunk'; ... }
  | { kind: 'chapter-section'; sectionId: SectionId; sectionTitle: string };
```

No IDB migration. `mode` is a string field; `contextRefs` is a JSON-serialized array. Both accept new union members without schema bumps.

Existing `useChatSend` `Args` shape gains:

```typescript
readonly attachedChapter?: AttachedChapter | null;
```

Mirrors the `attachedPassage` and `attachedRetrieval` props.

---

## 5. Token budget

**Constant:** `CHAPTER_CONTEXT_TOKEN_BUDGET = 6500` (declared in `assembleChapterPrompt.ts` next to the helper). Consistent with `EMBED_TOKEN_BUDGET` from Phase 5.2 — same internal-tokens-vs-server-tokens reasoning, same headroom semantics.

**Allocation (in order):**

1. **System prompt** — fixed shape, ~150 tokens. Counts toward budget.
2. **Chapter title + section header** — < 50 tokens.
3. **Highlights + notes** — included in full unless their combined `tokenEstimate` exceeds the entire budget. If they do (degenerate case): truncate by FIFO, log `console.warn` with the count truncated.
4. **Chunks** — fill remaining budget. Use `tokenEstimate` field on `TextChunk`. If chunks exceed remainder: even-stride sample (Phase 5.3 `sampleChunksForProfile` pattern adapted: walk chunks in document order, advance by `Math.ceil(allChunks.length / desiredCount)`).

**Formula sketch (illustrative; concrete allocation lives in `assembleChapterPrompt`):**

```
budgetForChunks = CHAPTER_CONTEXT_TOKEN_BUDGET
                  − tokenEstimate(systemPrompt)
                  − tokenEstimate(highlights + notes)
if (sum(chunks.tokenEstimate) <= budgetForChunks) → include all
else stride = Math.ceil(chunks.length / Math.floor(budgetForChunks / avgChunkTokens))
```

`tokenEstimate` is the existing helper from `paragraphsToChunks`/`sampleChunksForProfile` — same heuristic across the codebase. The system prompt is small enough (~150 tokens) that estimating it precisely vs. using a constant doesn't matter; impl can reserve a small constant.

---

## 6. Error handling

| Failure mode | Handling |
|---|---|
| `currentEntryId` undefined | Toolbar button disabled, tooltip explains. No chip ever created. |
| `resolveCurrentChapter` returns null | Same as above. |
| User clicks 📖 then unloads book before send fires | `attachedChapter` snapshot is stable; send proceeds normally with frozen chunks. |
| User navigates to a different chapter after attaching | Chip stays pointing at the snapshot. By design. |
| Chunks repo returns empty for the snapshot's sectionId at send time | Should never happen (resolve happened at click time using the same data); if it does, send proceeds with empty chunks list and the LLM gets only highlights/notes. Console.warn. |
| Highlights or notes repo throws during snapshot resolution | Catch + log + treat empty. Chip rendered with `0 highlights · 0 notes`. Send proceeds. |
| API failures (rate-limit, invalid-key, insufficient-balance, server) | Cascade through existing chat-failure surfaces. No new failure modes specific to chapter mode. The `embedding-no-key` actionable copy from PR #24 doesn't apply here — chapter mode uses chat-completion, not embedding. |

---

## 7. Testing

**Unit:**

- `resolveCurrentChapter.test.ts`
  - href without fragment → strip nothing, prefix `spine:`, find chunks
  - href with fragment → strip `#...`, prefix, find chunks
  - href with no matching chunks → null
  - undefined entryId → null
  - empty chunks list → null
  - multi-chapter spine: both TOC hrefs map to the same chunk set (documents the v1 limitation)

- `assembleChapterPrompt.test.ts`
  - returns `[system, user]` pair
  - system message references "chapter mode" / contains the chapter title
  - user message contains chunks in document order
  - user message contains highlights + notes (when present)
  - chunks under budget → all included
  - chunks over budget → sampled (count < input.length, evenly distributed)
  - empty highlights/notes → user message renders without the highlight/note section

- `useChatSend.test.ts` (extends existing file)
  - chapter branch persists user message with `mode: 'chapter'` and `contextRefs[0].kind === 'chapter-section'`
  - threadId-override pattern still works with chapter branch (regression coverage from PR #25)
  - chapter branch and passage branch don't accidentally double-send (`attachedChapter` set with `attachedPassage` also set: chapter wins, asserted by message inspection — although in production state mutual exclusion makes this unreachable)

- `ChapterChip.test.tsx`
  - renders title + counts
  - × button fires `onDismiss`
  - aria-label includes the chapter title

- `ChatComposer.test.tsx` (extends existing)
  - chapter button hidden when `onToggleChapter` undefined (mirrors retrieval-toggle pattern: `onToggleSearch?: () => void`)
  - chapter button disabled when `chapterAttachable === false`
  - click on chapter button → fires `onToggleChapter()` (no-arg invocation; the parent owns the boolean state and the toggle direction, same as the existing `onToggleSearch`)
  - aria-pressed state reflects chip presence (`chapterAttached?: boolean` prop, same shape as the existing `retrievalAttached`)

**E2E:**

- `chapter-mode-no-crash.spec.ts` — import fixture → open book → open chat → assert chapter-mode button is visible. No api-key fixture needed since we only verify the UI surface lands.

Full happy-path (click 📖 → send → assistant streams answer with source footer) requires the same API-key + embeddings-mock fixture infrastructure that's currently TODO'd for the 4 indexing specs (PR #28). Will land alongside that future work.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| TOC↔chunks mapping fails for some EPUB layouts (deep anchors, orphan TOC entries) | Button is disabled when `resolveCurrentChapter` returns null. Tooltip explains. The disabled-button surface is graceful. |
| Snapshot stale across navigation surprises the user | Chip label always shows the snapshotted chapter title. Visually obvious. Single-click dismiss + re-attach to switch. |
| Three-way mutually-exclusive state drift across components | Single `setActiveAttachment` reducer in `ReaderWorkspace` owns the rule. All component-level setters call into it. |
| Multi-chapter HTML files send too much context | Documented v1 limitation. Acceptable for the reading flow this targets. Per-anchor matching is a follow-up PR. |
| Highlights/notes repo returning slowly delays click-to-chip render | Resolution is local IDB read (sync-fast). If profiling reveals latency, move to the click-handler being explicitly async with a "Loading…" intermediate chip state. YAGNI for v1. |

---

## 9. Validation checklist

After implementation:

- [ ] `pnpm check` clean (type-check + lint + unit tests)
- [ ] `pnpm test:e2e` — new chapter-mode no-crash spec passes; no regressions in the 70 currently-passing specs
- [ ] **Manual:** import a book → reader opens → chat panel → 📖 button visible & enabled → click → chip shows current chapter title + counts → type "summarize this chapter" → send → assistant streams answer that obviously references chapter content → message has source footer
- [ ] **Manual (mutual exclusion):** highlight some text → Ask AI (passage chip) → click 📖 → passage chip clears, chapter chip appears → click search-mode toggle → chapter chip clears, retrieval mode active → click ✕ on retrieval chip → no chip
- [ ] **Manual (snapshot):** click 📖 in chapter VII → navigate to chapter X → chip still says VII → send → answer about VII (not X)
- [ ] **Manual (disabled):** open a PDF without TOC → 📖 button disabled with tooltip
- [ ] **Self-review scorecard ≥ 22/27** per `docs/08-agent-self-improvement.md`
- [ ] `docs/04-implementation-roadmap.md` Status block updated to mark Phase 5.4 complete
- [ ] `docs/02-system-architecture.md` decision-history entry added
