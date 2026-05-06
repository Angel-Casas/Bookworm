# Phase 4.4 — Passage mode design

**Status:** approved 2026-05-05
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 4 → Task 4.4
**Predecessors:** Phase 3.2 highlights (introduces `HighlightAnchor` discriminated union, `HighlightToolbar`, the selection-event pipeline), Phase 3.3 notes (precedent for "selection action triggers context-augmented behavior"), Phase 3.4 notebook (introduces `NotebookEntry` union with `savedAnswer` variant from 4.3, anchor-jump pattern via `goReaderAt`), Phase 4.3 chat panel (introduces `ChatPanel`, `useChatSend`, `assembleOpenChatPrompt`, `MessageBubble`, `PrivacyPreview`, `SavedAnswer` entity with `contextRefs` snapshot).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` operating mode 1 (passage mode payload + best-for list), prompt assembly rules (role / answer-style / grounding / evidence boundaries), provenance requirements ("source excerpt cards / jump-to-passage / saved provenance in chat history"), safety rules ("never imply the model has read the entire book"), `docs/05-design-system.md` (calm motion, AI controls discoverable but secondary), `docs/06-quality-strategy.md` (file/function thresholds, error-state requirements, accessibility floor).

---

## 1. Goal & scope

Ship passage mode: the user selects text in the reader, attaches it as a context chip in the chat panel via a new "Ask AI" toolbar action, and asks questions grounded in that exact passage. Responses cite the source via an inline footer with click-to-jump. Saved answers preserve the passage anchor so they're jump-back-able from the notebook indefinitely.

The design fulfills three deferred promises from Phase 4.3: (1) passage-mode chat (the engine doc's operating mode #1), (2) jump-to-passage on saved-answer notebook rows (was a TODO awaiting `contextRefs.passage.anchor`), (3) mobile chat surface as a `MobileSheet` tab.

**In scope (v1, this phase):**
- Extend `ContextRef.passage` to carry the source anchor + section title + nearby-text windows (~400 chars before/after the selection). `anchor` is **required** — the variant is unusable for the product's "response links back to source" criterion without it. `windowBefore`/`windowAfter`/`sectionTitle`/`chunkId` remain optional.
- Add `BookReader.getPassageContextAt(anchor)` to the reader contract: returns `{text, windowBefore?, windowAfter?, sectionTitle?}`. Implemented by both `EpubReaderAdapter` and `PdfReaderAdapter` with graceful degradation when extraction fails (returns `{text}` only, never throws).
- Selection text capped at 4000 chars in the outgoing prompt + chip + privacy preview, with `(truncated for AI)` notice; the full anchor is preserved regardless.
- Window character bounds: ~400 before, ~400 after, word-boundary trimmed, ellipses surface in the prompt block.
- New pure helper `assemblePassageChatPrompt(input)` next to the existing `assembleOpenChatPrompt`. Output structure: `[ system(open-mode prompt + "\n\n" + passage-addendum, single combined message) | …history | user-with-passage-block ]`. Single combined system (not two adjacent systems) for upstream-provider parity. The passage block is prepended to the new user message (not a separate message — keeps the model's attention focused), with bold delimiters around the exact selection and ellipses on the windows.
- History soft-cap drops from 40 user/assistant pairs to 30 when **any** message in the thread is `mode === 'passage'` OR the new message is passage-mode. Single-condition check at assembly time.
- `useChatSend` accepts an optional `attachedPassage: AttachedPassage | null` prop. When non-null, send goes through `assemblePassageChatPrompt`, sets `mode: 'passage'` on **both** user and assistant messages, and writes `contextRefs: [{kind: 'passage', text, anchor, sectionTitle?, windowBefore?, windowAfter?}]` **only on the assistant message** (the user message keeps `contextRefs: []`). When null, behavior identical to Phase 4.3 (`mode: 'open'`, empty `contextRefs` on both).
- New "Ask AI" action in `HighlightToolbar` — appears in both `'create'` (fresh selection) and `'edit'` (existing-highlight tap) modes, gated by `canAskAI` (api-key state ∈ session/unlocked AND selectedModelId is non-empty). Hidden entirely when `canAskAI` is false — no disabled state.
- Selection bridge in `ReaderWorkspace`: clicking "Ask AI" calls `readerState.getPassageContextAt(anchor)`, stores the resulting `AttachedPassage` in workspace state, auto-expands the right rail (desktop) or auto-switches to the chat tab + opens the sheet (mobile), focuses the chat composer via the existing `pendingFocus` ref pattern, and dismisses the highlight toolbar. No `Highlight` record is created — the selection is materialized only as a chip + transient state.
- New `PassageChip` component: sits above `ChatComposer` when `attachedPassage` is non-null, shows section title (when present) + truncated selection text (~80 chars + ellipsis), ✕ button to dismiss, `role="status" aria-live="polite"`. Sticky across sends (Q3 lock); replaced when the user re-selects + clicks "Ask AI" again; cleared when the user switches threads or dismisses explicitly.
- `ChatPanel` accepts `attachedPassage` + `onClearAttachedPassage` props; threads them through to `useChatSend`; renders `PassageChip` between message list and composer.
- `MessageBubble` (assistant variant) gains an inline source footer when `contextRefs.find(r => r.kind === 'passage')` is defined: `📎 Source: "{snippet…}"` with click → `onJumpToSource(matchedRef.anchor)`. `.find()` (not `[0]?.kind`) so the predicate survives Phase 5+ multi-source mode without a follow-up edit. `MessageBubble.onJumpToSource?` is added; `undefined` hides the footer (used in surfaces like the notebook's preview where jump-back is handled differently).
- `PrivacyPreview` updated: collapsed summary shows "+ section + selected passage (~N chars)" when attached; expanded form adds an "Attached passage" subsection with the literal selection text + windows. Snapshot-tested against `assemblePassageChatPrompt` output (same pattern as the existing system-prompt snapshot test).
- `MobileSheet` chat tab: 4th entry in the existing `tabs` array. Uses the same `ChatPanel` instance pattern. `ChatPanel` mounts only when the chat tab is active (tab-switching unmounts; sheet-dismissal unmounts; in-flight streams cancel cleanly via the existing `useChatSend` cleanup effect). The 4.3 spec's "keep mounted by transform" idea is **not** implemented — simpler unmount semantics win; in-flight messages get `truncated + error: 'interrupted'` per Phase 4.3's stale-stream detection.
- Notebook saved-answer jump-back: `NotebookRow`'s `'savedAnswer'` variant gains a "Jump to passage" affordance when `contextRefs.find(r => r.kind === 'passage')?.anchor` is non-null. Wired through `NotebookList → NotebookView → App.tsx`'s existing `view.goReaderAt(book.id, anchor)`. 4.3 saved answers (no passage refs) just don't render the button — pure backward compat.
- Repository normalizers extend with light `ContextRef.passage` validation: malformed `passage` refs are dropped from the array, but the message itself is kept (more lenient than the current "drop entire message" behavior, matching the existing validating-reads spirit).
- E2E: `chat-passage-mode-desktop`, `chat-passage-mode-mobile`, `chat-passage-mode-jump-from-notebook`. Extension to existing `chat-panel-empty-states` covering "Ask AI" button visibility under no-key / no-model.
- Roadmap status block updated: `Phase 4.4 — complete (YYYY-MM-DD)`. Architecture decision-history entry under `docs/02-system-architecture.md`.

**Out of scope (deferred — see §15 for destinations):**
- Multi-passage / ordered excerpts (Phase 5 multi-excerpt mode).
- Chapter mode (Phase 5).
- Retrieval mode (Phase 5.2 — requires chunking + embeddings).
- Prompt caching breakpoints (Phase 5+ when savings matter).
- Suggested prompts (Phase 5.3).
- Save passage as highlight (no auto-action; user can highlight independently if desired).
- Multiple sources per assistant message (Phase 5+ retrieval mode).
- Re-attach previous passage from history (YAGNI).
- Right-rail resize (Phase 6 polish).
- Markdown / code-block rendering in answers (Phase 6).
- Chat tab keep-mounted-on-dismiss across sheet close (simpler unmount semantics chosen instead).

---

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Selection-action trigger | **"Ask AI" button in `HighlightToolbar`** (create + edit modes) | Toolbar is the established "I'm doing something with this selection" surface; consistent with how highlights and notes work; visible only when there's a selection. Discoverable regardless of rail state — auto-expands when needed. |
| Context payload | **Selected passage + section title + nearby paragraph window (~400 chars before/after)** | The AI engine doc's full passage-mode payload spec. Window helps the model handle fragmentary selections. Implementation uses fixed-character span (not paragraph DOM walks) — works uniformly across EPUB and PDF. |
| Chip lifetime after send | **Sticky until dismissed or replaced** | Passage mode's "Best for" list (paraphrase / define / connect) is inherently a follow-up pattern. Always-visible chip + privacy preview keep carry-over impossible to miss. Replacement gesture (re-select + "Ask AI") naturally swaps without explicit dismiss. |
| Source-card / provenance display | **Inline footer on the assistant bubble** | Bubble footer is the existing per-message metadata surface (badge / time / save). Calm and discoverable. Same pattern scales to multi-source modes in Phase 5+. |
| Auto-highlight on "Ask AI" | **No — chip stays transient; `ContextRef.passage` carries anchor directly** | The engine doc's "separate user notes from AI-generated content" rule extends naturally to "don't auto-create user-facing annotations as AI side effects". Domain change is small (one new required field on the passage variant). Phase 5's multi-excerpt / retrieval modes will explicitly NOT auto-highlight every chunk — landing 4.4 with the cleaner pattern keeps later phases consistent. |
| Mobile UX | **Chat as 4th tab in `MobileSheet`; auto-open + auto-switch from "Ask AI"** | Fulfills the 4.3 architecture-decision-history commitment ("chat-on-mobile lands when 4.4 adds passage-mode UX"). `ChatPanel` is container-agnostic — sheet-tab integration is mostly plumbing. Parity is the right product call: someone reading on mobile should be able to ask about passages on mobile. |
| Multi-passage support | **Single passage per message in 4.4** | Multi-excerpt mode is named in the engine doc as Phase 5's deliverable. Single-passage in 4.4 preserves clean phase boundaries; the chip pattern extends naturally to a chip-list UX in Phase 5. |
| Domain extension | **`ContextRef.passage.anchor` is required** | The whole point of passage mode is "response links back to source". A `passage` ref without an anchor is unusable for the product invariant. Type-safety enforcement of the product rule. |
| Storage migration | **None — additive contextRefs payload, validators handle the new fields** | Existing 4.3 records all have `mode: 'open'` and empty `contextRefs[]`. No old `passage` refs exist. New required field `anchor` is enforced from this phase forward; older records round-trip unchanged. |
| Soft-cap reduction in passage threads | **40 → 30 user/assistant pairs when any message is passage-mode** | Conservative token-explosion guard. Single constant; visible in privacy preview when truncation kicks in. Easy to tune. |
| Selection-text cap | **4000 chars in chip + privacy preview + outgoing prompt; full anchor preserved** | Practical limit that handles "user selected an entire chapter" gracefully. Truncation marker is honest. Jump-back works regardless of truncation. |
| Tab-switch / sheet-dismiss semantics on mobile | **Unmount on tab change OR sheet dismiss; in-flight streams cancel cleanly** | Simpler than "keep mounted by transform". Existing `useChatSend` cleanup already handles cancellation; existing 4.3 stale-stream detection handles the post-reload case. Closing the sheet or switching tabs is an explicit "doing something else" gesture — silent stream continuation would be more surprising than truncation. |
| Commit shape | **Approach 2 — same scope, sliced into ~17 reviewable commits** | Mirrors Phase 3.x and 4.3 patterns. Each commit independently green; bisect-friendly. |

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ ReaderWorkspace (extended)                                     │
│  ├─ Selection event (existing — Phase 3.2 onSelectionChange)   │
│  └─ Active toolbar (existing)                                  │
│       ├─ Color swatches  (existing)                            │
│       ├─ Add note        (existing)                            │
│       ├─ Delete          (existing — edit mode)                │
│       └─ Ask AI          NEW (gated by canAskAI)               │
│             │                                                   │
│             ▼                                                   │
│       Selection bridge:                                         │
│       readerState.getPassageContextAt(anchor)                   │
│       → setAttachedPassage(passage)                             │
│       → rightRail.set(true) [desktop]                           │
│       → setActiveSheet(...) + setActiveRailTab('chat') [mobile] │
│       → focus composer via pendingFocus ref                     │
│                                                                 │
│  ChatPanel (extended) ──────────────────────────────────────┐   │
│   ├─ ChatHeader            (existing)                       │   │
│   ├─ MessageList           (existing)                       │   │
│   │    ├─ MessageBubble    (extended — source footer)       │   │
│   │    └─ ChatErrorBubble  (existing)                       │   │
│   ├─ PrivacyPreview        (extended — passage block)       │   │
│   ├─ PassageChip           NEW (when attachedPassage non-null)  │
│   ├─ ChatComposer          (existing)                       │   │
│   └─ useChatSend           (extended — accepts attachedPassage) │
│                                                             │   │
│  MobileSheet (extended) ────────────────────────────────────┤   │
│   tabs: [contents | bookmarks | highlights | chat ← NEW]    │   │
│   When chat tab active → mounts ChatPanel                   │   │
└─────────────────────────────────────────────────────────────┴───┘

┌─ Adapters (extended) ──────────────────────────────────────────┐
│ EpubReaderAdapter  → getPassageContextAt(anchor)                │
│   - Resolve CFI range → DOM nodes via foliate's CFI utils       │
│   - Walk back/forward from range, accumulate ~400 chars         │
│   - Truncate at word boundaries                                 │
│ PdfReaderAdapter   → getPassageContextAt(anchor)                │
│   - Get page text via existing getPageText() (Phase 3.1)        │
│   - String-match selection in page text → ±400 char slice       │
│   - Word-boundary trim                                          │
│ Both: degrade gracefully — return {text} only on extraction fail│
└────────────────────────────────────────────────────────────────┘

┌─ Notebook (extended) ──────────────────────────────────────────┐
│ NotebookRow.savedAnswer → "Jump to passage" button when         │
│   contextRefs.find(r => r.kind === 'passage')?.anchor           │
│   → view.goReaderAt(bookId, anchor) [existing path]             │
└────────────────────────────────────────────────────────────────┘
```

Functional-core / imperative-shell split per `06-quality-strategy.md`:

- **Pure (testable without I/O):** `assemblePassageChatPrompt`, soft-cap selector, passage-block format, `ContextRef.passage` normalizer, source-footer rendering predicate, jump-button rendering predicate.
- **Side-effectful:** `getPassageContextAt` adapter implementations (DOM/text-layer reads), selection bridge in `ReaderWorkspace`, mobile auto-switch sequence, composer focus.

---

## 4. Domain & storage

### 4.1 `ContextRef.passage` extension

```ts
// src/domain/ai/types.ts
export type ContextRef =
  | {
      readonly kind: 'passage';
      readonly text: string;                         // exact selection (≤4000 chars; truncated with notice if larger)
      readonly anchor: HighlightAnchor;              // NEW — required: enables jump-to-passage
      readonly sectionTitle?: string;                // NEW — optional: e.g., "Chapter 4"
      readonly windowBefore?: string;                // NEW — optional: ~400 chars before, word-trimmed
      readonly windowAfter?: string;                 // NEW — optional: ~400 chars after, word-trimmed
      readonly chunkId?: ChunkId;                    // existing — Phase 5 retrieval will populate
    }
  | { readonly kind: 'highlight'; readonly highlightId: HighlightId }
  | { readonly kind: 'chunk'; readonly chunkId: ChunkId }
  | { readonly kind: 'section'; readonly sectionId: SectionId };
```

`HighlightAnchor` (existing — Phase 3.2) reuses the EPUB CFI / PDF rects discriminated union. The jump-to-passage code path uses the same `goToAnchor` projection bookmarks/highlights/notebook already use; cross-format jump-back is free.

### 4.2 `ChatMessage.mode` actually populated

4.3 sets `mode: 'open'` on every message. 4.4 sets:
- `mode: 'passage'` when `attachedPassage !== null` at `useChatSend.send()` time (both user + assistant messages of that turn — keeps the soft-cap history scan symmetric and obvious).
- `mode: 'open'` otherwise.

`contextRefs`, by contrast, is set **only on the assistant message** (the one with provenance — the source footer renders there). The user message keeps `contextRefs: []` even in passage mode. This avoids ~5KB of duplicated payload per question that nothing consumes; the soft-cap selector reads `mode`, not `contextRefs`, so the symmetry isn't load-bearing.

### 4.3 Storage normalizers

`chatMessages.ts` and `savedAnswers.ts` validators extend with light per-element validation of `contextRefs[]`:

```ts
function isValidContextRef(value: unknown): value is ContextRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'passage') {
    const p = v as Record<string, unknown>;
    if (typeof p.text !== 'string') return false;
    if (typeof p.anchor !== 'object' || p.anchor === null) return false;
    // anchor is HighlightAnchor — light shape check (kind ∈ {epub-cfi, pdf})
    const a = p.anchor as { kind?: unknown };
    if (a.kind !== 'epub-cfi' && a.kind !== 'pdf') return false;
    if (p.sectionTitle !== undefined && typeof p.sectionTitle !== 'string') return false;
    if (p.windowBefore !== undefined && typeof p.windowBefore !== 'string') return false;
    if (p.windowAfter !== undefined && typeof p.windowAfter !== 'string') return false;
    return true;
  }
  // other variants: existing validation
  return true;
}
```

Malformed `passage` refs are filtered from the array (`contextRefs.filter(isValidContextRef)`); the message itself is preserved with the surviving valid refs. More lenient than the current "drop entire message if `contextRefs` non-array" — matches the validating-reads spirit.

### 4.4 No migration

v6 schema unchanged. `contextRefs` JSON payload is additive; existing 4.3 records (always `[]`) round-trip cleanly. Pre-flight grep (verified 2026-05-06: `git grep "kind: *['\"]passage['\"]"` matches only the type definition in `src/domain/ai/types.ts:28` — zero call sites construct or persist `passage` refs) confirms no `passage` refs were ever persisted in 4.3 (only `'open'` mode shipped) — no back-compat work for the new required `anchor` field. Even if a stray malformed ref surfaced, the lenient validator (§4.3) would filter it without dropping the surrounding message.

---

## 5. Adapter layer

### 5.1 `BookReader` contract

```ts
// src/domain/reader/types.ts
export interface BookReader {
  // ...existing methods...
  readonly getPassageContextAt: (anchor: HighlightAnchor) => Promise<{
    readonly text: string;
    readonly windowBefore?: string;
    readonly windowAfter?: string;
    readonly sectionTitle?: string;
  }>;
}
```

Both adapters implement. Extraction failures → return `{text}` only (selection text alone). Never throw. Logged warning for diagnostics.

### 5.2 `EpubReaderAdapter` implementation

- Resolve the CFI range via foliate's existing CFI utilities (already imported by the adapter for highlight rendering).
- Walk backward from `range.startContainer` collecting `.textContent` until ≥400 chars or reaching the section start.
- Walk forward from `range.endContainer` symmetrically.
- Both walks trim at the last word boundary (last space character in the accumulated string).
- `text` = `range.toString()`, capped at 4000 chars with `(truncated for AI)` marker on the outgoing prompt and chip.
- `sectionTitle` = reuse existing `getSectionTitleAt(anchor)` from Phase 3.1 (the bookmark snippet path).

### 5.3 `PdfReaderAdapter` implementation

- Get page text via existing `getPageText(page)` helper (Phase 3.1's snippet path).
- String-match selection text in page text via the existing snippet-extraction logic.
- Slice ±400 chars from the matched offset; word-boundary trim.
- If selection isn't found (whitespace-normalization mismatch — rare): graceful fallback to `{text}` only.
- `sectionTitle` is `null` for PDF (existing Phase 3.1 behavior — PDFs don't have first-class sections).

**Documented limitation — first-match wins.** When the selection text appears more than once on the page (common for short/common phrases), the implementation takes the first string match in the joined page text. The **anchor** (PDF rects on the page) is still correct, so jump-to-passage is unaffected; only `windowBefore`/`windowAfter` may come from a different instance than the user actually selected, which can subtly mislead the AI's reading of context. Acceptable for v1.

Mitigation in v1:
- A single-line code comment at the slice site documenting the first-match-wins choice.
- A unit test (`PdfReaderAdapter.test.ts`) asserting the documented behavior with a fixture page that has the selection text appearing twice — locks the contract so future refactors don't silently change it.
- A `// TODO(passage-y-bias)` marker pointing at the future enhancement: PDF anchors carry per-rect `y`, and `getTextContent()` items expose y via their transform — biasing the chosen match toward the rect-mean y is feasible. Deferred to a follow-up because it requires keeping a parallel item→char-offset map; the concrete cost in answer quality is unknown until users exercise the feature.

### 5.4 `ReaderViewExposedState` passthrough

`ReaderViewExposedState` (the workspace's view of the reader's state, defined in `ReaderView.tsx`) gains a `getPassageContextAt(anchor)` passthrough — same pattern as `getCurrentAnchor` and `getSectionTitleAt` from Phase 3.1.

---

## 6. Prompt assembly

### 6.1 `assemblePassageChatPrompt`

Pure helper. Lives next to `assembleOpenChatPrompt` in `promptAssembly.ts`.

```ts
export type AssemblePassageChatInput = {
  readonly book: { readonly title: string; readonly author?: string; readonly format: BookFormat };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
  readonly passage: {
    readonly text: string;
    readonly windowBefore?: string;
    readonly windowAfter?: string;
    readonly sectionTitle?: string;
  };
};

export function assemblePassageChatPrompt(input: AssemblePassageChatInput): AssembleChatResult;
```

### 6.2 Output structure

```
[ 0 ] system     — combined: open-mode prompt + "\n\n" + passage-mode addendum
[ 1…N-2 ] user/assistant — preserved history
[ N-1 ] user     — newUserText, prefixed with the passage block
```

A **single combined system message** is emitted, not two. NanoGPT proxies a wide range of upstream providers; OpenAI-compatible endpoints accept multi-system, but some providers (notably the Anthropic-via-shim path) collapse adjacent system messages anyway, and a couple of niche upstreams ignore everything past system[0]. Combining at assembly time guarantees parity across all upstreams at zero semantic cost — the addendum content is identical, just appended after a `\n\n` separator. Tests assert the addendum's substring is present in `messages[0].content`.

The passage block (prepended to the new user message — keeps the model's attention focused on the user's question alongside the source):

```
[Passage from "{book.title}"{section ? ` — ${section}` : ''}]
{windowBefore ? `…${windowBefore}` : ''}
**{text}**
{windowAfter ? `${windowAfter}…` : ''}

{newUserText}
```

The bold delimiters around the exact selection make the model's anchor unambiguous. Ellipses on the windows visually distinguish "context for orientation" from "the actual selection".

### 6.3 Passage-mode system addendum (appended to message [0])

> The user has attached a passage from this book. Treat the bolded text between the ellipsis windows as the primary subject. The surrounding ellipsis text is included only for orientation — do not summarize or analyze it as if it were the user's selection. If the user asks for something that requires text outside the attached window, say so and offer to help once they share more.

Concatenated to `buildOpenModeSystemPrompt(book)` with a `\n\n` separator at assembly time. Tested via structural assertions (book title in `messages[0].content`, addendum substring in `messages[0].content`, passage text bracketed by `**` in last user message) — not verbatim string match.

### 6.4 Soft-cap reduction

```ts
export const HISTORY_SOFT_CAP_OPEN = 40;
export const HISTORY_SOFT_CAP_PASSAGE = 30;

function effectiveSoftCap(history: readonly ChatMessage[], thisModeIsPassage: boolean): number {
  if (thisModeIsPassage) return HISTORY_SOFT_CAP_PASSAGE;
  if (history.some((m) => m.mode === 'passage')) return HISTORY_SOFT_CAP_PASSAGE;
  return HISTORY_SOFT_CAP_OPEN;
}
```

Single check at assembly time. Drop count surfaced in privacy preview when truncation kicks in.

---

## 7. Send pipeline

### 7.1 `useChatSend` extension

Existing 4.3 signature:

```ts
useChatSend({ threadId, modelId, getApiKey, book, history, append, patch, finalize });
// .send(userText: string)
```

4.4 extension (one new optional prop):

```ts
useChatSend({
  ...,
  attachedPassage: AttachedPassage | null,
});
```

Where:

```ts
type AttachedPassage = {
  readonly anchor: HighlightAnchor;
  readonly text: string;
  readonly windowBefore?: string;
  readonly windowAfter?: string;
  readonly sectionTitle?: string;
};
```

`attachedPassage` lifetime is owned by `ChatPanel` state (sticky-until-dismissed semantics from Q3). `useChatSend` is stateless about the chip — it just reads whatever is currently attached at send time.

### 7.2 `useChatSend.send` branching

```
if (attachedPassage === null) {
  user message    → mode: 'open',    contextRefs: []
  assistant msg   → mode: 'open',    contextRefs: []
  prompt          → assembleOpenChatPrompt(...)
}
else {
  user message    → mode: 'passage', contextRefs: []
  assistant msg   → mode: 'passage', contextRefs: [{
      kind: 'passage',
      text: attachedPassage.text,
      anchor: attachedPassage.anchor,
      ...(attachedPassage.sectionTitle && {sectionTitle: …}),
      ...(attachedPassage.windowBefore && {windowBefore: …}),
      ...(attachedPassage.windowAfter && {windowAfter: …}),
    }]
  prompt          → assemblePassageChatPrompt({...input, passage: attachedPassage})
}
```

`mode` is set on **both** messages of the turn — keeps the soft-cap history scan symmetric and makes "this turn was passage-mode" explicit on either side. `contextRefs` is set **only on the assistant message** — that's the surface with provenance (the source footer reads `contextRefs`); persisting the same payload on the user message would be ~5KB of dead duplicate per question. The `useChatSend` test must assert this asymmetry explicitly so future "let's normalize them" refactors don't silently re-introduce the bloat.

---

## 8. UI surfaces

### 8.1 Module layout

```
src/features/ai/chat/
  PassageChip.tsx (+test)                     NEW
  ChatPanel.tsx (extended)
  MessageBubble.tsx (extended — source footer)
  PrivacyPreview.tsx (extended — passage block)
  promptAssembly.ts (extended — assemblePassageChatPrompt + soft-cap helper)
  useChatSend.ts (extended — attachedPassage)
  chat-panel.css (extended — chip styling, source footer styling)

src/features/reader/
  HighlightToolbar.tsx (extended — Ask AI action)
  workspace/ReaderWorkspace.tsx (extended — selection bridge, attachedPassage state, mobile auto-switch)
  workspace/MobileSheet.tsx (chat tab integration via existing tabs prop — no component changes)

src/features/annotations/notebook/
  NotebookRow.tsx (extended — savedAnswer Jump-to-passage)

src/storage/repositories/
  chatMessages.ts (extended — passage variant validation)
  savedAnswers.ts (extended — passage variant validation)
```

### 8.2 `HighlightToolbar` extension

Existing toolbar renders `'create'` (4 colors + add-note) and `'edit'` (4 colors + add-note + delete) modes. Phase 4.4 adds an "Ask AI" action to both modes, gated by a new `canAskAI` prop.

```ts
type Props = {
  // ...existing...
  onAskAI?: () => void;        // NEW — undefined → button hidden
  canAskAI?: boolean;          // NEW — false → button hidden (used when AI is configured but not authorized for this surface)
};
```

When `onAskAI && canAskAI`, render a button using the `ChatIcon` from Phase 4.3, tucked at the right side of the pill after color swatches and "Add note", with a thin vertical divider between the color group and the AI/note group. Same translate-only motion the toolbar already uses on appear. Click dismisses the toolbar and fires `onAskAI`.

Aria-label: `"Ask AI about this passage"`.

### 8.3 `PassageChip` component

```ts
type Props = {
  readonly text: string;                  // selected text (truncated to ~80 chars in display)
  readonly sectionTitle?: string;
  readonly onDismiss: () => void;
};
```

Visual:

```
┌─────────────────────────────────────────────────────────────┐
│ 📎  Chapter 4 — "she scarcely heard the rest…"        ✕     │
└─────────────────────────────────────────────────────────────┘
```

- Surface-elevated background, 1px subtle border, 6-8px radius, 0.85rem font.
- Display: paperclip icon + section title (when present) + truncated selection text + dismiss ✕.
- `role="status"`, `aria-live="polite"`, aria-label includes the full section + selection (screen readers know what's attached).
- Click on chip body (not on ✕): future affordance to expand the chip preview — defer; not in 4.4 scope.

### 8.4 `ChatPanel` extension

```ts
type Props = {
  // ...existing 4.3 props...
  attachedPassage: AttachedPassage | null;     // NEW
  onClearAttachedPassage: () => void;          // NEW
};
```

Renders `<PassageChip>` between the message list and the privacy preview when `attachedPassage` non-null. Threads `attachedPassage` into `useChatSend`. Calls `onClearAttachedPassage` on:
- ✕ click on the chip
- thread switch (`onSelectThread` wraps `props.onClearAttachedPassage`)

Send does **not** clear the chip (sticky semantics — Q3 lock).

### 8.5 `MessageBubble` source-footer extension (assistant variant only)

```ts
type Props = {
  // ...existing...
  onJumpToSource?: (anchor: HighlightAnchor) => void;    // NEW — undefined hides the footer
};
```

Renders source footer when `message.role === 'assistant'` AND `message.contextRefs.find(r => r.kind === 'passage')` is defined AND `onJumpToSource` is defined. Use `.find()`, not `[0]?.kind`: Phase 5+ multi-source mode will mix `passage` with other ref kinds in the same array, and `.find()` survives that change without a follow-up edit. The matched ref's `anchor` is what `onJumpToSource` is called with. Layout:

```
AI · 2m ago · 📎 Source: "she scarcely heard the…"  →  [Save]
```

The "Source" item flexes — wraps to a new line when needed. `→` is a `chevron` icon indicating navigation. Click → `onJumpToSource(passageRef.anchor)`.

### 8.6 `PrivacyPreview` extension

Collapsed summary updates conditionally based on attached passage:

```
No attachment:
  ⓘ Sending: Moby-Dick by Herman Melville + your messages → gpt-x

Attached:
  ⓘ Sending: Moby-Dick by Herman Melville + Chapter 4 + selected passage (~340 chars) + your messages → gpt-x
```

Expanded form gains an "Attached passage" subsection between "System prompt" and "Messages included":

```
Attached passage
Chapter 4
…the conversation drifted, and as Mr. Darcy spoke,…
**She scarcely heard the rest, she was so taken aback by his…**
…all of this in the midst of the parlour's quiet hum.

```

Identical to what `assemblePassageChatPrompt` sends. Snapshot-tested for equivalence.

### 8.7 `MobileSheet` chat tab

`ReaderWorkspace` builds the sheet's `tabs` array; for 4.4:

```ts
const sheetTabs: readonly SheetTab[] = [
  { key: 'contents', label: 'Contents' },
  { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
  { key: 'highlights', label: 'Highlights', badge: highlights.list.length },
  { key: 'chat', label: 'Chat' },               // NEW
];
```

Sheet body switches on `activeRailTab`; the `'chat'` branch mounts `ChatPanel`. Tab switching unmounts and remounts (in-flight streams cancel cleanly via existing `useChatSend` cleanup; truncated messages handled by the existing 4.3 stale-stream detection on next mount).

Mobile auto-switch from "Ask AI":
1. `setAttachedPassage(passage)`
2. Open the sheet (toc-area open gesture, same as existing TOC button).
3. `setActiveRailTab('chat')`
4. `pendingFocus` ref set → composer focuses on next mount.
5. Dismiss the highlight toolbar.

### 8.8 Selection bridge — `ReaderWorkspace`

```ts
const [attachedPassage, setAttachedPassage] = useState<AttachedPassage | null>(null);
const pendingFocusRef = useRef<boolean>(false);

const handleAskAI = useCallback(async (anchor, selectedText) => {
  if (!readerState) return;
  let extracted;
  try {
    extracted = await readerState.getPassageContextAt(anchor);
  } catch (err) {
    console.warn('[passage-mode] context extraction failed; using selection only', err);
    extracted = { text: selectedText };
  }
  setAttachedPassage({ anchor, ...extracted });
  if (isDesktop) {
    if (!rightRail.visible) rightRail.set(true);
  } else {
    setActiveSheet(/* tap-to-open trigger */);
    setActiveRailTab('chat');
  }
  pendingFocusRef.current = true;
  setActiveToolbar(null);  // dismiss
}, [readerState, isDesktop, rightRail]);
```

`canAskAI` computed inline:

```ts
const canAskAI =
  (apiKeyState.kind === 'session' || apiKeyState.kind === 'unlocked') &&
  selectedModelId !== null &&
  selectedModelId !== '';
```

Passed to `HighlightToolbar` props alongside `onAskAI: handleAskAI`.

### 8.9 Notebook saved-answer jump-back

`NotebookRow.tsx`'s `'savedAnswer'` variant renders a "Jump to passage" button when `entry.savedAnswer.contextRefs.find(r => r.kind === 'passage')?.anchor` is non-null. Click → `onJumpToAnchor(passageRef.anchor)` — same path Phase 3.4's bookmark/highlight jump uses.

`NotebookRow` props purely additive — no shape changes. 4.3 saved answers (no passage refs) just don't render the button.

---

## 9. Cross-feature integration

- **`HighlightToolbar` props** gain `onAskAI?` + `canAskAI?` (both optional so the toolbar remains usable in surfaces that don't have AI).
- **`ReaderViewExposedState`** gains a `getPassageContextAt(anchor)` passthrough.
- **`ReaderWorkspace`** owns `attachedPassage` state, the `handleAskAI` bridge, the `pendingFocus` ref, and threads everything to `HighlightToolbar`, `ChatPanel`, and `MobileSheet` (via the existing tabs array). Receives `apiKeyState` + `selectedModelId` from props (already wired in 4.3 for the `ChatPanel`'s empty-state precedence — extends to `canAskAI` calculation).
- **`ChatPanel`** accepts `attachedPassage` + `onClearAttachedPassage`, threads through to `useChatSend`, renders `PassageChip`, calls clear on thread switch.
- **`MessageBubble`** accepts `onJumpToSource?`; source footer renders conditionally.
- **`MessageList`** accepts `onJumpToSource?` and threads it into each `MessageBubble`.
- **`NotebookRow`** accepts the existing `onJumpToAnchor` (already there for bookmark/highlight rows) and uses it for the savedAnswer variant when a passage anchor is present.
- **`App.tsx`** passes `onJumpToAnchor` to `NotebookView` (already wired in 4.3 — no new code).
- **No `useReaderHost` changes.** No new repos. No cascade updates (passage chips are transient; saved answers already cascade with chat).

---

## 10. Privacy & accessibility

### 10.1 Privacy doctrine reinforcement

The user always sees exactly what we send. `PrivacyPreview` imports the same `assemblePassageChatPrompt` constants the network adapter uses; the rendered passage block is character-for-character identical to the outgoing prompt. Snapshot-tested.

The chip's truncated display (~80 chars) and the privacy preview's truncated outgoing text (4000 chars) are both honest about truncation: the chip uses ellipsis; the prompt includes a `(truncated for AI)` marker when applicable.

### 10.2 Accessibility

- `HighlightToolbar` "Ask AI" button: `aria-label="Ask AI about this passage"`. Same focus management as existing toolbar buttons.
- `PassageChip`: `role="status" aria-live="polite"`, `aria-label` includes full section + selection (so screen readers announce "Attached passage: Chapter 4, 'she scarcely heard the rest…'" when the chip mounts).
- Source footer in `MessageBubble`: button with `aria-label="Jump to passage from {section}"` (or `"Jump to source"` when section absent).
- `NotebookRow.savedAnswer` jump button: `aria-label="Jump to passage in book"`.
- Mobile auto-focus on composer after "Ask AI" tap: same-gesture-window programmatic focus (works on iOS Safari per WebKit's "user activation" rules); fallback to "tap composer to focus" hint if the focus race fails on real devices.
- All new interactive elements have visible focus rings using existing focus token. AA contrast verified against the existing palette.

---

## 11. Testing strategy

### 11.1 Unit (Vitest)

- `assemblePassageChatPrompt` — passage block in last user message, addendum substring in `messages[0].content` (combined system, single message), history-soft-cap reduction triggers correctly when any history message is passage-mode, edge cases (no window, no section, truncated selection).
- `getPassageContextAt` for each adapter — happy path, missing window (selection at start/end of section/page), section title present/absent, 4000-char truncation marker. **PDF specifically**: a fixture page with the selection text appearing twice locks first-match-wins behavior.
- `ContextRef.passage` validator — accepts well-formed; rejects missing anchor; rejects bad anchor kind; preserves valid refs while filtering invalid siblings.
- `useChatSend` with attachedPassage — assembles correct prompt; sets `mode: 'passage'` on **both** user and assistant messages; sets `contextRefs` **only on the assistant message** (asymmetry asserted explicitly so a future refactor can't silently bloat persistence). Without attachedPassage — Phase 4.3 behavior unchanged.
- `MessageBubble` source-footer — renders when an assistant message has `contextRefs.find(r => r.kind === 'passage')` and `onJumpToSource` defined; absent for `'open'` messages and for messages where the only refs are non-passage; click calls `onJumpToSource` with the matched ref's anchor.
- `NotebookRow.savedAnswer` — renders "Jump to passage" only when `contextRefs.find(r => r.kind === 'passage')?.anchor` is non-null; click fires the right callback.
- `PrivacyPreview` — collapsed summary shows attached state; expanded form contains the passage block; snapshot equivalence with `assemblePassageChatPrompt` output.
- Repo normalizers (`chatMessages`, `savedAnswers`) — passage variant survives round-trip; malformed passage refs filter out without dropping the message.

### 11.2 Component (RTL)

- `HighlightToolbar` "Ask AI" — visible in create + edit modes when `onAskAI && canAskAI`; absent otherwise.
- `PassageChip` — renders truncated text + section; ✕ calls dismiss; aria-label includes full selection.
- `ChatPanel` chip integration — chip renders when attachedPassage non-null; chip clears on thread switch via `onSelectThread`; chip survives across sends.

### 11.3 E2E (Playwright)

- `chat-passage-mode-desktop.spec.ts`: open EPUB → select text → click "Ask AI" → chip appears in rail → composer auto-focused → send (mocked stream from existing fixture) → assistant bubble has source footer → click source footer → reader navigates to anchor; verify position via existing reader-state assertions.
- `chat-passage-mode-mobile.spec.ts`: mobile viewport → select text → tap "Ask AI" → mobile sheet opens to chat tab with chip → send → answer arrives → close sheet → reopen → answer + chip still there.
- `chat-passage-mode-jump-from-notebook.spec.ts`: passage-mode answer → save with note → open notebook → "AI answers" filter → click "Jump to passage" → reader opens at that anchor.
- Extension to `chat-panel-empty-states.spec.ts`: "Ask AI" button hidden when no key / no model.

### 11.4 Quality gate

Each commit passes `pnpm check`. E2E run before the docs-update commit.

---

## 12. File map

### 12.1 New (~5 files: 1 source + 1 test + 3 E2E specs)

```
src/features/ai/chat/PassageChip.tsx
src/features/ai/chat/PassageChip.test.tsx
e2e/chat-passage-mode-desktop.spec.ts
e2e/chat-passage-mode-mobile.spec.ts
e2e/chat-passage-mode-jump-from-notebook.spec.ts
```

### 12.2 Modified (~18 source/test files + 2 docs)

```
src/domain/ai/types.ts                                            (extend ContextRef.passage)
src/domain/reader/types.ts                                        (extend BookReader interface)
src/features/ai/chat/promptAssembly.ts (+test)                    (extend — assemblePassageChatPrompt + soft-cap helper)
src/features/ai/chat/useChatSend.ts (+test)                       (extend — attachedPassage)
src/features/ai/chat/ChatPanel.tsx (+test)                        (extend — chip, clear-on-thread-switch)
src/features/ai/chat/MessageBubble.tsx (+test)                    (extend — source footer)
src/features/ai/chat/MessageList.tsx                              (thread onJumpToSource through)
src/features/ai/chat/PrivacyPreview.tsx (+test)                   (extend — passage block)
src/features/ai/chat/chat-panel.css                               (extend — chip + source-footer styling)
src/features/reader/HighlightToolbar.tsx (+test)                  (extend — Ask AI action)
src/features/reader/ReaderView.tsx                                (extend ReaderViewExposedState passthrough)
src/features/reader/epub/EpubReaderAdapter.ts (+test)             (extend — getPassageContextAt impl)
src/features/reader/pdf/PdfReaderAdapter.ts (+test)               (extend — getPassageContextAt impl)
src/features/reader/workspace/ReaderWorkspace.tsx (+test)         (extend — selection bridge, attachedPassage state, mobile auto-switch, sheet chat tab)
src/features/annotations/notebook/NotebookRow.tsx (+test)         (extend — savedAnswer jump-to-passage)
src/storage/repositories/chatMessages.ts (+test)                  (extend — contextRef.passage validator)
src/storage/repositories/savedAnswers.ts (+test)                  (extend — same)
e2e/chat-panel-empty-states.spec.ts                               (extend — Ask AI visibility)

docs/04-implementation-roadmap.md                                 (status block)
docs/02-system-architecture.md                                    (decision-history entry)
```

---

## 13. Commit slicing (Approach 2)

Each commit independently green:

1. `feat(domain): chat — extend ContextRef.passage with anchor + section + window`
2. `feat(reader): BookReader.getPassageContextAt contract + EpubReaderAdapter impl`
3. `feat(reader): PdfReaderAdapter.getPassageContextAt impl`
4. `feat(reader): ReaderViewExposedState passthrough for getPassageContextAt`
5. `feat(ai): assemblePassageChatPrompt + soft-cap reduction for passage threads`
6. `feat(ai): useChatSend accepts attachedPassage; mode=passage on send`
7. `feat(storage): validate ContextRef.passage in chatMessages + savedAnswers normalizers`
8. `feat(reader): HighlightToolbar — Ask AI action (create + edit modes)`
9. `feat(chat): PassageChip — sticky chip with dismiss + replace`
10. `feat(chat): ChatPanel — wire attachedPassage prop, render chip, clear on thread switch`
11. `feat(chat): MessageBubble — source footer with jump-to-passage`
12. `feat(chat): PrivacyPreview — attached-passage section`
13. `feat(reader): ReaderWorkspace — selection bridge + auto-expand rail + mobile auto-switch`
14. `feat(reader): MobileSheet chat tab — wire ChatPanel as 4th tab`
15. `feat(notebook): savedAnswer Jump-to-passage when contextRefs has passage anchor`
16. `test(e2e): passage mode — desktop + mobile + notebook jump-back`
17. `docs: Phase 4.4 — architecture decision + roadmap status complete`

---

## 14. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Window extraction across formats | Edge cases in EPUB DOM walks and PDF text-layer matching | Graceful degradation — return `{text}` only when extraction fails. Logged warning. Unit tests cover boundary cases (selection at section/page start, image-only PDF, whitespace-mismatch fallback). |
| Soft-cap heuristic timing | 30-pair cap may be too aggressive or too loose | Single constant; surfaces in privacy preview when truncation triggers; tunable via the existing `historyDropped` field in `assembleResult`. |
| Mobile composer-focus race in iOS Safari | Programmatic focus after auto-switch may fail | "Ask AI" tap is a recent user gesture (within WebKit's user-activation window); should work. Fallback: a one-time "tap composer to focus" hint if real-device testing shows it fails. |
| Selection size — user selects entire chapter | Could be 100KB of text | Cap at 4000 chars in chip + privacy preview + outgoing prompt with `(truncated for AI)` marker; full anchor preserved for jump-back. |
| Edit-mode toolbar gets crowded (7 controls) | Cramped on smaller screens | CSS already wraps; tested at 320px viewport; if real-use shows it's a problem, "Add note" + "Ask AI" can collapse into an overflow menu in a later phase. |
| Chip persistence across reload | The chip is transient (workspace state) — not persisted; on reload it's gone | This is the intended behavior. The chat thread + saved answers persist; the next-message context (the chip) does not. User re-selects + re-attaches if they want to continue passage-mode questions. |
| Mobile tab-switch cancels in-flight stream | User switches from chat tab to highlights tab mid-stream | Per Phase 4.3's stale-stream detection: assistant message gets `truncated + error: 'interrupted'` on next mount. Visible to user as the existing "(stopped)" marker. Acceptable: tab switching is an explicit gesture. |
| `ContextRef.passage` validator strictness | Anchor must be `kind ∈ {epub-cfi, pdf}` — anything else drops the ref | Pre-flight grep confirms no `passage` refs persisted in 4.3. New required `anchor` field is enforced from this phase forward; older records had no passage refs to migrate. |

---

## 15. Out of scope (explicit destinations)

| Deferred | Destination phase |
|---|---|
| Multi-passage / ordered excerpts | Phase 5 multi-excerpt mode (chip pattern extends to chip-list) |
| Chapter mode | Phase 5 (different prompt assembly — full chapter excerpt or summary) |
| Retrieval mode | Phase 5.2 (requires chunking + embeddings + ranking) |
| Prompt caching breakpoints | Phase 5+ (savings matter when passage / chapter / retrieval contexts repeat) |
| Suggested prompts | Phase 5.3 |
| Save passage as highlight (auto or via chip menu) | Defer; user can highlight independently |
| Multiple sources per assistant message | Phase 5+ (multi-excerpt / retrieval) |
| Re-attach previous passage from history | Defer — YAGNI |
| Right-rail resize | Phase 6 polish |
| Markdown / code-block rendering in answers | Phase 6 polish |
| Chat tab keep-mounted-on-dismiss across sheet close | Simpler unmount semantics chosen instead — defer until real friction emerges |
| AI-summarized thread titles | Phase 5+ |

---

## 16. Validation checklist

Before declaring Phase 4.4 complete:

- [ ] All 17 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new chat-passage-mode suite plus all prior suites.
- [ ] Manual smoke on desktop: select text → "Ask AI" → chip appears → composer focused → send (real or mocked NanoGPT) → assistant bubble has source footer → click source → reader navigates to anchor; rail collapsed → "Ask AI" auto-expands.
- [ ] Manual smoke on mobile (DevTools viewport at minimum, real device preferred): select text → "Ask AI" → mobile sheet opens to chat tab with chip → send → answer arrives → close sheet → reopen → answer + chip preserved across the chat-tab unmount.
- [ ] Notebook smoke: passage-mode answer → save with note → notebook → "AI answers" filter → "Jump to passage" → reader opens at correct anchor.
- [ ] Privacy preview snapshot test confirms `PrivacyPreview` content equals `assemblePassageChatPrompt` output for a given passage.
- [ ] `docs/04-implementation-roadmap.md` Status block updated: `Phase 4.4 — complete (YYYY-MM-DD)`.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard complete per `docs/08-agent-self-improvement.md` — minimum 22/27 for this risky/core task.
