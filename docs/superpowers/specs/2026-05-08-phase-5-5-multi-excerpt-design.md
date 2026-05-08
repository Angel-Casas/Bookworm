# Phase 5.5 — Multi-excerpt mode

**Status:** approved 2026-05-08
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 5 → Task 5.4 (multi-excerpt portion; chapter portion shipped as Phase 5.4)
**Predecessors:** Phase 4.3 chat panel (`ChatPanel`, `ChatComposer`, `useChatSend`); Phase 4.4 passage mode (chip pattern, `attachedPassage` arg, `PassageChip`, mutual exclusion in render, 4000-char text cap, `(truncated for AI)` marker, `MultiSourceFooter` citation chips); Phase 5.1 chunking; Phase 5.2 retrieval (`MultiSourceFooter` rendering N passage refs, `onJumpToSource` plumbing); Phase 5.3 (callback-based store updates pattern); Phase 5.4 chapter mode (`AttachedChapter`, `setActiveAttachment` reducer, snapshot semantics, chapter prompt assembly).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` §3 "Multi-excerpt mode" (input/output spec); `docs/02-system-architecture.md` §"Decision history" (functional core / imperative shell split, snapshot-not-live attached-context semantics, mutually-exclusive chip rendering); `docs/06-quality-strategy.md` (file/function thresholds, error-state requirements, accessibility floor); Phase 5.4 spec §"Out of scope" (multi-excerpt explicitly deferred).

---

## 1. Goal & scope

Add a multi-excerpt chat affordance: the user builds a small ordered set (≤ 6) of excerpts from existing highlights and/or fresh ad-hoc selections, then asks a comparison question. The set renders in the composer as a single chip (`📑 N excerpts ▾`) with an expandable inline preview. Send routes through a new `multi-excerpt` branch in `useChatSend` that prompts the model with ordered, labelled excerpts and emits one `kind: 'passage'` `ContextRef` per excerpt. The existing `MultiSourceFooter` then renders them as `[1] [2] [3]` citation chips that the user can click to jump back — and those numbers line up with the "Excerpt 1, Excerpt 2…" labels the model is told to cite.

### In scope (v1)

**Domain (`domain/ai/multiExcerpt.ts`, new):**

- `AttachedExcerpt` (single item):
  ```ts
  {
    id: string;                    // 'h:<HighlightId>' for highlights, 'sel:<anchor-hash>' for ad-hoc
    sourceKind: 'highlight' | 'selection';
    highlightId?: HighlightId;     // present iff sourceKind === 'highlight'
    anchor: HighlightAnchor;
    sectionTitle: string;          // for highlights: from highlight.sectionTitle (with "Page N" fallback for PDF w/o TOC); for selections: resolved from current reader state at add-time
    text: string;                  // truncated to MAX_EXCERPT_CHARS (4000) at add-time
    addedAt: IsoTimestamp;
  }
  ```

  No `sectionId`. Ordering uses the anchor directly: EPUB CFIs encode spine position; PDF anchors carry `page`. `Highlight` doesn't store `sectionId` — only `sectionTitle` — so requiring one would force a brittle resolution step for highlight-kind excerpts.
- `AttachedMultiExcerpt`:
  ```ts
  { excerpts: readonly AttachedExcerpt[] }   // length 1..6, sorted by reading position
  ```
- Constants: `MAX_EXCERPTS = 6`, `MAX_EXCERPT_CHARS = 4000`.
- `ChatMessage.mode = 'multi-excerpt'` (already exists in the union — no domain change needed).

**ContextRef strategy (no new variant):**

Multi-excerpt sends emit `contextRefs: excerpts.map(e => ({ kind: 'passage', text: e.text, anchor: e.anchor, sectionTitle: e.sectionTitle }))` — one `passage` ref per excerpt. The existing `MultiSourceFooter` (Phase 5.2) renders this as numbered citation chips. Numbers match the "Excerpt N" labels in the prompt by construction. No `ContextRef` union extension.

**Pure helpers:**

- `compareExcerptOrder(a: AttachedExcerpt, b: AttachedExcerpt): number` — orders by anchor. EPUB anchors: CFI-string lex-compare via existing CFI primitives in `features/reader/epub/` (CFIs are designed to be ordering-stable when compared as parsed path tuples). PDF anchors: `(page, rects[0].y)` tuple. Cross-kind anchors (mixing EPUB and PDF) are not possible within one book.
- `trayReduce(prev: AttachedMultiExcerpt | null, action: TrayAction): { tray: AttachedMultiExcerpt | null; result: 'ok' | 'full' | 'duplicate' | 'cleared' }` — pure reducer. `TrayAction = {type:'add', excerpt} | {type:'remove', id} | {type:'clear'}`. Dedupes by `id`, hard-caps at 6, auto-sorts via `compareExcerptOrder`. Lives in `domain/ai/multiExcerpt.ts`.
- `assembleMultiExcerptPrompt({ book, excerpts }): ChatCompletionMessage[]` — pure builder, returns `[system, user]`. Lives in `features/ai/prompts/assembleMultiExcerptPrompt.ts`. Per-excerpt label = `Excerpt N — <sectionTitle>`. Per-excerpt soft-cap 800 tokens (truncate with `(truncated for AI)`); total bundle cap 5000 tokens with proportional-trim fallback (per-excerpt floor ~200 tokens).

**Network/orchestration:**

- New `multi-excerpt` branch in `useChatSend.send`, parallel to the existing chapter / passage / retrieval branches. New optional arg `attachedMultiExcerpt?: AttachedMultiExcerpt | null`.

**UI:**

- `MultiExcerptChip` (new, `features/ai/chat/MultiExcerptChip.tsx`) — collapsed count chip with expandable inline preview (one `<li>` per excerpt with label + jump + remove).
- `HighlightToolbar` — new `+ Compare` button alongside existing `Ask AI`.
- `HighlightsPanel` — per-row `+` (or `✓` if already in tray) icon button.
- `ChatPanel` — chip-render block extended to render exactly one of the four chips.
- `MessageBubble` — no changes; `MultiSourceFooter` already handles N passage refs.
- `ReaderWorkspace` — new `attachedMultiExcerpt` state; new `useMultiExcerptTray` hook composes with the existing `setActiveAttachment` reducer to enforce mutual exclusion.

**Token budget:**

- `MULTI_EXCERPT_TOTAL_BUDGET = 5000` tokens (sits between chapter's 6500 and passage's lighter footprint).
- `PER_EXCERPT_SOFT_CAP_TOKENS = 800`. Cap × 6 excerpts = 4800-token natural ceiling, fits inside total budget by construction.
- Proportional-trim fallback when per-excerpt totals still exceed 5000 (rare; defensive).

### Out of scope (deferred)

- **User-editable labels** — auto only in v1. Adds per-excerpt edit state + UI.
- **Drag-reorder / insertion-order ordering** — auto reading-position sort only.
- **Persistence across reload** — workspace state only; rejected during brainstorming. No IDB schema changes.
- **Multi-select mode in `HighlightsPanel`** — per-row `+` only in v1.
- **Cross-book comparison** — single book only.
- **Compare-builder modal / dedicated rail panel** — explicitly rejected in brainstorming; inline chip + expanded preview wins.
- **Caching breakpoints** — prompt structure is cache-friendly, but enabling caching is Phase 6.
- **Auto-prune tray when underlying highlight is deleted** — tray is a snapshot; entry stays valid. Revisit if real friction emerges.

---

## 2. UX & flow

### Trigger 1 — `HighlightToolbar` (fresh selection in reader)

Existing toolbar order: `[swatches] [Note] [Ask AI]`. Add `[+ Compare]` to the right of `Ask AI`. Click → builds `AttachedExcerpt` (sourceKind: `'selection'`, `id = 'sel:' + stableAnchorHash(anchor)`, `text` truncated to `MAX_EXCERPT_CHARS`), routes through `addExcerpt`, closes the toolbar. No auto-highlighting — same boundary as 4.4.

Disabled state: tray full (`count === MAX_EXCERPTS`), tooltip "Compare set full (6) — remove an excerpt to add another."

### Trigger 2 — `HighlightsPanel` row

Each row gets a small `+` icon button on the right. Click → builds `AttachedExcerpt` (sourceKind: `'highlight'`, `id = 'h:' + highlightId`), routes through `toggleHighlightInTray`.

Row affordance states:
- Not in tray, room available → `+`, tooltip "Add to compare".
- Not in tray, full → `+` disabled, tooltip "Compare set full (6)".
- In tray → `✓`, tooltip "Remove from compare". Click removes.

### Mutual exclusion (extends `setActiveAttachment`)

| Action | Effect on other attachments |
|---|---|
| Add 1st excerpt to empty tray | Clears `attachedPassage`, `attachedRetrieval`, `attachedChapter`. |
| Add 2nd–6th excerpt | No change — tray already active. |
| Set passage / retrieval / chapter | Clears the entire tray. |
| Remove last excerpt from tray | Tray clears (`attachedMultiExcerpt = null`); no other attachment activates. |

The single-active-attachment invariant holds: at most one of `{passage, retrieval, chapter, multi-excerpt}` is set at any time.

### Chip & expanded preview

Collapsed:
```
📑 3 excerpts ▾                                         ×
```
Expanded:
```
📑 3 excerpts ▴                                         ×
  1. Chapter II  · "He had been waiting…"          ⏎  ×
  2. Chapter V   · "The garden was overgrown…"     ⏎  ×
  3. Chapter IX  · "At long last she returned…"    ⏎  ×
```

- `▾` toggles expansion; `aria-expanded` flips. `▴` when expanded.
- Per-row label = `${index + 1}. ${sectionTitle} · "${ellipsisHead(text, 50)}"`.
- `⏎` button → `onJumpToReaderAnchor(excerpt.anchor)` (existing plumbing). Reader navigates; tray persists.
- Per-row `×` → `removeExcerpt(id)`.
- Wrapper `×` → `clearTray()`.
- Tray auto-clears when last excerpt is removed.

### Snapshot semantics

Identical to chapter mode. Each excerpt's `text + sectionTitle + anchor` is captured at add-time. If the user later edits or deletes the underlying highlight, the tray entry is unaffected.

### Send

Tray remains intact after send (matches chapter chip). The user can ask follow-up questions against the same set without rebuilding it. Send flow is structurally identical to the chapter branch:

```
useChatSend.send(userText)
  ├── isMultiExcerpt = !isRetrieval && attachedMultiExcerpt !== null && excerpts.length > 0
  └── if isMultiExcerpt:
        contextRefs = excerpts.map(e => ({
          kind: 'passage', text: e.text, anchor: e.anchor, sectionTitle: e.sectionTitle
        }))
        append user msg { mode: 'multi-excerpt', contextRefs }
        append assistant placeholder { mode: 'multi-excerpt', contextRefs, streaming: true }
        messages = assembleMultiExcerptPrompt({ book, excerpts }) ++ history ++ [user]
        stream → finalize
```

Mutual-exclusion priority order in `useChatSend.send`: `retrieval > chapter > multi-excerpt > passage`.

### Provenance after send

`MessageBubble`'s existing `MultiSourceFooter` (Phase 5.2) renders one citation chip per `passage` ref: `[1] [2] [3]`. Click → `onJumpToReaderAnchor`. The model is instructed to cite by "Excerpt 1, Excerpt 2…" labels which align with the chip numbers by construction.

### Empty / null states

| Reader state | Toolbar `+ Compare` | Panel `+` |
|---|---|---|
| No selection | n/a (toolbar not shown) | per-row, normal rules |
| No highlights yet | normal | n/a (rows absent) |
| Tray full (6) | disabled, "Compare set full (6)" | disabled, "Compare set full (6)" |
| Item already in tray (highlight) | n/a (selection-kind always allowed) | shows `✓`, click removes |
| Otherwise | enabled | enabled |

---

## 3. Architecture

### File map

```
src/
├── domain/ai/
│   ├── multiExcerpt.ts                  (new)
│   └── multiExcerpt.test.ts             (new)
├── features/ai/prompts/
│   ├── assembleMultiExcerptPrompt.ts    (new)
│   └── assembleMultiExcerptPrompt.test.ts (new)
├── features/ai/chat/
│   ├── useChatSend.ts                   (extend — new branch + arg)
│   ├── useChatSend.test.ts              (extend)
│   ├── MultiExcerptChip.tsx             (new)
│   ├── MultiExcerptChip.test.tsx        (new)
│   ├── multi-excerpt-chip.css           (new)
│   └── ChatPanel.tsx                    (extend — chip-render block)
├── features/reader/
│   ├── HighlightToolbar.tsx             (extend — + Compare button)
│   ├── HighlightToolbar.test.tsx        (extend)
│   ├── HighlightsPanel.tsx              (extend — per-row +/✓ button)
│   └── HighlightsPanel.test.tsx         (extend)
├── features/reader/workspace/
│   ├── ReaderWorkspace.tsx              (extend — attachedMultiExcerpt state, wiring)
│   ├── ReaderWorkspace.test.tsx         (extend)
│   ├── useMultiExcerptTray.ts           (new — hook over trayReduce + setActiveAttachment)
│   └── useMultiExcerptTray.test.ts      (new)
└── e2e/
    └── chat-multi-excerpt-mode.spec.ts  (new)
```

### Data flow on add

```
HighlightToolbar "+ Compare" click
  → ReaderView.handleAddSelectionToCompare(currentSelection)
      builds AttachedExcerpt { sourceKind: 'selection', id: 'sel:...', anchor, sectionTitle, text }
  → ReaderWorkspace.addExcerpt(excerpt)
      → useMultiExcerptTray.add(excerpt)
          → setActiveAttachment('multi-excerpt', candidate)   // clears others when first item
          → trayReduce(prev, { type: 'add', excerpt })        // dedupe + cap + sort
          → setAttachedMultiExcerpt(next)

HighlightsPanel "+" click
  → row handler builds AttachedExcerpt { sourceKind: 'highlight', id: 'h:<id>', highlightId, anchor, sectionTitle, text }
    (sectionTitle from highlight.sectionTitle, falling back to "—" if null; selectedText for text)
  → same path as above
```

### Data flow on send (parallels chapter branch in `useChatSend`)

See §2 "Send" snippet. Existing `setActiveAttachment` priority: `retrieval > chapter > multi-excerpt > passage`. The new `multi-excerpt` branch slots between chapter and passage.

### Ordering invariant

`compareExcerptOrder(a, b)` orders by anchor:
- EPUB (`kind: 'epub-cfi'`): parse CFI path tuple via existing CFI primitives in `features/reader/epub/` and lex-compare. CFIs are designed to be ordering-stable across the spine + intra-section paths.
- PDF (`kind: 'pdf'`): compare `(page, rects[0].y)` tuples.
- Mixed kinds within a book are not possible (a book is either EPUB or PDF), so the comparator can `if/else` on `a.anchor.kind` (asserting `b.anchor.kind` matches) without a fallback path.

Helper lives in `domain/ai/multiExcerpt.ts`. Reuses existing CFI primitives — no reader-component dependency leakage.

### Dedupe rule (in `trayReduce`)

By `id`:
- Highlight: `id = 'h:' + highlightId`.
- Selection: `id = 'sel:' + stableAnchorHash(anchor)`. Helper hashes the canonical anchor (CFI string for EPUB, `${pageIndex}:${offset}:${len}` for PDF). Two distinct selections with identical canonical anchors collide silently — acceptable for v1.

### No IDB schema changes

Tray is purely React state. No repository, no migration, no schema bump.

---

## 4. Prompt assembly

`assembleMultiExcerptPrompt({ book, excerpts }): ChatCompletionMessage[]` returns `[system, user]`. The user's actual question is appended later by `useChatSend.send` as a separate `{ role: 'user', content: userText }` message after history (same composition as chapter mode).

### System message

```
You are reading "<title>" by <author>. The user has selected several
excerpts from this book and wants you to compare or relate them.

GROUNDING RULES:
- Treat the provided excerpts as the primary source of truth.
- When you cite something, refer to it by its excerpt label (e.g.
  "Excerpt 2") so the user can match your answer to the source.
- If the excerpts don't contain enough evidence to answer, say so
  plainly. Do not invent facts about the book outside what's
  provided.
- Distinguish clearly between what the excerpts state and any outside
  knowledge you bring in. Label outside knowledge as such.
```

### User message

```
Compare or relate the following excerpts from "<title>".

Excerpt 1 — <sectionTitle>
"""
<excerpt text, possibly truncated with marker>
"""

Excerpt 2 — <sectionTitle>
"""
<excerpt text>
"""

…
```

The "Excerpt N" labels match the citation chip numbers rendered by `MultiSourceFooter` (since each excerpt becomes one `passage` ref in `contextRefs`, in the same order). The user gets a coherent loop: model says "see Excerpt 2," footer shows `[2]` chip, click → reader.

### Token budget & truncation

```
MULTI_EXCERPT_TOTAL_BUDGET     = 5000 tokens
PER_EXCERPT_SOFT_CAP_TOKENS    = 800
PER_EXCERPT_FLOOR_TOKENS       = 200
MAX_EXCERPT_CHARS              = 4000   // pre-truncation at add-time, ~1000 tokens worst case
```

Algorithm:

1. For each excerpt, count tokens (existing tokenizer from `prompts/`).
2. If excerpt tokens > `PER_EXCERPT_SOFT_CAP_TOKENS`, truncate to soft cap and append `(truncated for AI)`.
3. Sum totals. If total > `MULTI_EXCERPT_TOTAL_BUDGET`, proportionally trim each excerpt down further, preserving the marker; each excerpt keeps a floor of `PER_EXCERPT_FLOOR_TOKENS`.

The natural ceiling (6 excerpts × 800 token soft-cap = 4800 tokens) already fits inside the 5000 budget by construction; the proportional-trim path is a defensive fallback for unusually token-dense text. Tested explicitly with synthetic dense input.

---

## 5. UI components

### `MultiExcerptChip`

Props:
```ts
type MultiExcerptChipProps = {
  readonly excerpts: readonly AttachedExcerpt[];
  readonly onClear: () => void;
  readonly onRemoveExcerpt: (id: string) => void;
  readonly onJumpToExcerpt: (anchor: HighlightAnchor) => void;
};
```

Behavior: collapsed by default; toggle button on the count area expands to show `<ol>` of excerpts. `aria-expanded` reflects state. Wrapper `×` button calls `onClear`. Each row has a `⏎` button (`aria-label="Jump to <sectionTitle>"`) and a `×` button (`aria-label="Remove from compare"`).

Keyboard: `Enter`/`Space` toggles expand. `Esc` collapses (when focus is inside). `Tab` walks expanded rows in DOM order.

Renders `null` when `excerpts.length === 0`.

### `HighlightToolbar` extension

Add a new `<button type="button">` to the right of the existing `Ask AI` button:
```
[ swatches ] [ Note ] [ Ask AI ] [ + Compare ]
```

Text label `+ Compare` (matches existing toolbar text-label style; no icon). `disabled` when tray full, with tooltip "Compare set full (6) — remove an excerpt to add another."

### `HighlightsPanel` row extension

Each row gets a `+` (or `✓`) icon button on the right edge. Hit area ≥ 32×32 (a11y). Tooltips per state above.

### `ChatPanel` chip-render block

Order matches mutual-exclusion priority:
```tsx
{attachedRetrieval ? <RetrievalChip … />
 : attachedChapter ? <ChapterChip … />
 : attachedMultiExcerpt && attachedMultiExcerpt.excerpts.length > 0 ? <MultiExcerptChip … />
 : attachedPassage ? <PassageChip … />
 : null}
```

Only one ever renders. The empty-tray case is handled defensively even though `attachedMultiExcerpt` should be `null` when empty (tray auto-clears).

### `MessageBubble`

No changes. `MultiSourceFooter` already filters `kind: 'passage' | 'chunk'` and renders one numbered chip per ref — multi-excerpt sends emit N passage refs and reuse this path verbatim.

---

## 6. State machine — mutual exclusion

`setActiveAttachment` (already exists from Phase 5.4 — a `useCallback` reducer in `ReaderWorkspace` that switches on an `AttachmentKind` union) currently owns mutual exclusion across `passage / retrieval / chapter / 'none'`. Extend the union with `'multi-excerpt'` and add the corresponding branch with the matrix below. The existing three branches are unchanged except each now also clears `attachedMultiExcerpt`.

| Set kind →    | passage | retrieval | chapter | multi-excerpt | clear |
|---------------|---------|-----------|---------|---------------|-------|
| Effect        | clears r/c/m | clears p/c/m | clears p/r/m | clears p/r/c | clears all |

The new wrinkle for `multi-excerpt`: setting it to a tray with one item is a "set" (clears others); setting it to a tray with N+1 items where N items were already in the tray is just a tray update (others remain cleared because the tray was already active). The reducer detects this by checking whether `attachedMultiExcerpt` was previously `null`.

`useMultiExcerptTray` exposes:
```ts
{
  add: (excerpt: AttachedExcerpt) => 'ok' | 'full' | 'duplicate';
  remove: (id: string) => void;
  clear: () => void;
  contains: (id: string) => boolean;
}
```

The hook reads `attachedMultiExcerpt` and `setActiveAttachment` from context (lifted in `ReaderWorkspace`). `add` first checks the cap and dedupe via `trayReduce`; if the tray was previously empty, it routes through `setActiveAttachment('multi-excerpt', tray)` which clears other attachments; otherwise it directly sets the new tray (no clear).

---

## 7. Testing strategy

### Unit tests (Vitest)

| Surface | Coverage |
|---|---|
| `domain/ai/multiExcerpt.ts` (`compareExcerptOrder`, `trayReduce`, `stableAnchorHash`) | Sort by spineIndex+offset for both EPUB-CFI and PDF anchors. Dedupe by `id` (highlight kind via `'h:'+id`, selection kind via `'sel:'+hash`). Hard cap at 6 returns `'full'`. Empty-tray identity. Remove-last collapses to `null`. Add when present returns `'duplicate'`. |
| `assembleMultiExcerptPrompt.ts` | System message contains title + author. User message lists excerpts in given order with correct `Excerpt N — <sectionTitle>` labels and `"""` fences. Per-excerpt soft-cap truncation appends `(truncated for AI)`. Total-budget proportional trim path triggered with synthetic dense input. Per-excerpt floor of 200 tokens enforced. PDF fallback `sectionTitle = "Page N"` flows through. Empty-excerpts case returns degenerate but valid pair (defensive). |
| `useMultiExcerptTray.ts` | `add` first item clears other attachments; subsequent adds don't re-clear. `remove` keeps tray when non-empty, clears wholesale on last remove. Setting passage/retrieval/chapter clears tray. `contains` returns correct result for both id formats. |
| `useChatSend.test.ts` | New `multi-excerpt` branch persists user msg with `mode:'multi-excerpt'` + N `passage` refs. Assistant placeholder mirrors mode + refs. Stream/finalize/error paths match chapter-branch parity. Mutual-exclusion priority: retrieval beats multi-excerpt; multi-excerpt beats passage. |
| `MultiExcerptChip.test.tsx` | Collapsed/expanded toggles `aria-expanded`. Per-row `×` calls `onRemoveExcerpt(id)`. Wrapper `×` calls `onClear`. Per-row `⏎` calls `onJumpToExcerpt(anchor)`. Empty `excerpts` renders `null`. Keyboard: Enter on toggle expands; Esc collapses. |
| `HighlightToolbar.test.tsx` | `+ Compare` button: enabled normally; disabled with correct tooltip when tray full; click invokes the workspace handler with the current selection. Existing `Ask AI` behavior preserved (regression). |
| `HighlightsPanel.test.tsx` | Row `+` toggles to `✓` when item in tray. `+` disabled with correct tooltip when tray full and item not yet added. Click round-trips through `onToggleHighlightInCompare`. Existing row click + jump preserved (regression). |

### E2E tests (Playwright, `e2e/chat-multi-excerpt-mode.spec.ts`)

The project's existing e2e suite deliberately skips full send-and-stream flows because no SSE mock harness exists for `/api/v1/chat/completions` (see `e2e/chat-passage-mode-desktop.spec.ts`). Phase 5.5 follows the same pragmatic policy: e2e covers everything observable WITHOUT sending; streaming-dependent assertions are covered by unit tests instead.

**E2E (no streaming required):**

1. **Hybrid build.** Highlight text via the reader → panel `+` adds it. Make a fresh selection → toolbar `+ Compare` adds it. Open chat → multi-excerpt chip visible. Expand → 2 rows in reading order with the right section labels.
2. **Mutual exclusion.** Build 2-item tray. Click chapter button → tray cleared, chapter chip visible. Click `+ Compare` on a fresh selection → chapter chip cleared, tray has the new item.
3. **Tray full.** Add 6 items via repeated select + `+ Compare`. The 7th attempt: toolbar `+ Compare` disabled with "Compare set full" label. Panel `+` on un-added rows is also disabled.
4. **Dedupe — highlight kind.** Add a highlight via panel `+`. Indicator switches to `✓`. Click `✓` → entry removed, indicator returns to `+`.
5. **Dedupe — selection kind.** Make a selection, click `+ Compare`. Re-select the exact same range and click `+ Compare` again → tray still has 1 entry.
6. **Clearing the tray.** Build 2-item tray. Click the wrapper `×` on the chip → chip removed.
7. **Reload clears tray.** Build 2-item tray, reload → chip absent on next mount. Existing chat threads still present (regression for persistence boundary).

**Covered by unit tests instead (streaming-dependent):**

| Assertion | Unit test |
|---|---|
| Send emits N `kind: 'passage'` `ContextRef`s in order | `useChatSend.test.ts` |
| Assistant message renders `[1] [2] [3]` chips for N passage refs | `MessageBubble.test.tsx` (Phase 5.2 — already covers arbitrary N) |
| Click on `[N]` chip calls `onJumpToSource` with the right anchor | `MessageBubble.test.tsx` (Phase 5.2) |

**Deferred (would need a new fixture):**

- PDF without TOC e2e — prompt-side label rendering is covered by `assembleMultiExcerptPrompt.test.ts`; UI-side by `MultiExcerptChip.test.tsx`. A full e2e on a TOC-less PDF fixture is deferred until that fixture lands in `test-fixtures/`.

---

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| Composer-row height grows when chip expanded → eats reading area on small viewports | Cap expanded preview to 6 rows max (the tray cap); each row ~28px → ≤170px. On mobile, `max-height` + `overflow-y` so worst case scrolls inside the chip. |
| `HighlightToolbar` already crowded on mobile (4.4 risk register notes 7 controls, CSS wraps) — adding `+ Compare` makes it 8 | Test at 320px viewport. If wrap is ugly, "Note" + "Ask AI" + "+ Compare" can collapse into an overflow menu in Phase 6 polish. v1 ships flat. |
| User adds a highlight to tray, then deletes the underlying highlight from `HighlightsPanel` | Tray is a snapshot; entry stays valid. Documented behavior. The panel `✓` indicator naturally goes back to `+` on next add of a new highlight (the deleted one is gone from the list). |
| EPUB CFI offset comparison for two anchors in the same spine entry | `compareExcerptOrder` parses CFI path tuples and lex-compares within a spine entry. Existing CFI primitives in `features/reader/epub/` already expose what we need. Tested. |
| Token estimate drift across models | Same risk as chapter mode; we use the same tokenizer. The 5000-token bundle leaves margin for any over-counting. |
| Selection-kind dedupe via canonical anchor hash false-collides | Rare: requires two distinct selections with identical canonical anchors (i.e., same start/length). Acceptable for v1; tested. |
| `MultiSourceFooter` rendering 6 passage chips overflows on narrow viewports | Existing footer already wraps via flex; verify with 6-chip case in e2e. If ugly, defer wrap polish to Phase 6. |
| "Ask AI" + "+ Compare" both available on a selection — user confusion | The two buttons set mutually-exclusive attachments; picking the wrong one is recoverable (the other clears it on next click). Acceptable; tooltips disambiguate. |

---

## 9. Decision log

Recorded in this spec for future reference and the eventual PR description. All items below were considered and rejected during 2026-05-08 brainstorming.

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Excerpt source | Hybrid (highlights + ad-hoc) | Highlights only / ad-hoc only | Hybrid covers both "compare your highlights about X" and "compare these three paragraphs I just read" — both are natural workflows. |
| Tray UX | Inline chip + expandable preview | Dedicated rail panel / modal | Inline keeps the build flow tight to the composer; rail/modal would split attention or feel heavyweight. |
| Lifetime | Per-session, transient | Per-book, persisted | Matches existing chip semantics; no IDB schema changes; complexity not justified for v1. |
| Ordering | Auto by reading position | Insertion order / drag-reorder | "Compare from start to end" is the natural framing; reorder UI not needed. |
| Labels | Auto: chapter + truncated snippet | User-editable / numeric-only | Auto labels carry provenance for free; editing is per-excerpt state for marginal value. |
| Triggers | Toolbar button + per-row `+` | + multi-select mode in panel | Per-row `+` is enough for v1; multi-select mode adds friction and selection state. |
| Cap | 6 hard | 4 / 10 | 6 × 800-token soft cap = 4800 tok, fits 5000-tok budget by construction. 4 too restrictive; 10 forces excerpts too small. |
| `ContextRef` design | Reuse `kind: 'passage'` × N | New `kind: 'multi-excerpt'` variant | `MultiSourceFooter` already renders N passage refs as `[1][2][3]`; numbering aligns with prompt's "Excerpt N" labels. Zero new domain. |

---

## 10. Validation checklist

Before declaring Phase 5.5 complete:

- [ ] All commits land green; `pnpm check` clean at each commit.
- [ ] All new unit tests + e2e suite pass; existing suites pass.
- [ ] Manual smoke (desktop): build hybrid 3-item tray → send → footer shows `[1][2][3]` chips → jump-back works for each → reload clears tray.
- [ ] Manual smoke (mobile, 320px): toolbar wraps gracefully, expanded chip scrolls, tap targets ≥ 32px.
- [ ] Mutual-exclusion matrix exercised manually for all 12 transitions (4 attachments × add/clear).
- [ ] PDF without TOC renders "Page N" labels in chip and footer.
- [ ] Privacy preview / sent-context view shows the multi-excerpt prompt body when expanded — no surprise content.
- [ ] HighlightsPanel `+` ↔ `✓` toggle reflects tray membership correctly through add/remove/clear cycles.
