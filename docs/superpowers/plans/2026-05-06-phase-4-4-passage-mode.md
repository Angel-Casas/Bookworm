# Phase 4.4 — Passage Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship passage-mode chat: user selects text in the reader, attaches it as a sticky context chip in chat via an "Ask AI" toolbar action, and asks questions grounded in that exact passage. Assistant answers include an inline source footer (click → jumps reader to the anchor). Saved-answer rows in the notebook expose the same jump-back when their snapshotted contextRefs include a passage anchor.

**Architecture:** Extend `ContextRef.passage` with a required `anchor: HighlightAnchor` + optional `windowBefore`/`windowAfter`/`sectionTitle`. Add `getPassageContextAt(anchor)` to the `BookReader` contract; both `EpubReaderAdapter` and `PdfReaderAdapter` implement it (graceful degradation on extraction failure). New pure helper `assemblePassageChatPrompt` produces a **single combined system message** (open-mode prompt + `\n\n` + passage addendum) followed by history and a passage-block-prefixed user message. `useChatSend` takes optional `attachedPassage`; when present, calls passage assembly, sets `mode: 'passage'` on **both** user + assistant messages, and writes the passage `contextRef` **only on the assistant message**. Selection bridge in `ReaderWorkspace` calls the reader's `getPassageContextAt`, stores the result in workspace state, auto-expands the right rail (desktop) or auto-switches `MobileSheet` to a new chat tab (mobile), and focuses the composer.

**Tech Stack:** TypeScript 5.x (strict + `exactOptionalPropertyTypes: true`), React 19, Vitest + happy-dom + `@testing-library/react` for unit/component tests, Playwright for E2E, foliate-js (EPUB), pdfjs-dist (PDF), IndexedDB via repository pattern (`fake-indexeddb/auto` in storage tests).

**Spec:** `docs/superpowers/specs/2026-05-05-phase-4-4-passage-mode-design.md`

**Quality gate:** Each task's final commit must produce a green `pnpm check` (`tsc -b && eslint . && vitest run`). E2E (`pnpm test:e2e`) is run before the docs commit.

**Repo invariants worth restating before starting:**
- `exactOptionalPropertyTypes: true` — never pass `undefined` to an optional prop. Use conditional spreads `...(value !== undefined && { key: value })`.
- No `any`. No `eslint-disable` outside the existing locked exceptions.
- Path alias `@/*` → `src/*`.
- Domain types are re-exported via `src/domain/index.ts` automatically — no manual re-export needed when adding a field to an existing type.

---

## Task 1: Domain — extend `ContextRef.passage`

**Spec refs:** §4.1, §13 commit 1.

**Files:**
- Modify: `src/domain/ai/types.ts:27-31` — replace the passage variant
- Test: this domain change is exercised through later tasks (storage validators, prompt assembly); no dedicated test in this task

- [ ] **Step 1: Read current `ContextRef` to confirm shape.**

Open `src/domain/ai/types.ts`. Confirm the passage variant is on lines 27–31 and reads:

```ts
export type ContextRef =
  | { readonly kind: 'passage'; readonly text: string; readonly chunkId?: ChunkId }
  | { readonly kind: 'highlight'; readonly highlightId: HighlightId }
  | { readonly kind: 'chunk'; readonly chunkId: ChunkId }
  | { readonly kind: 'section'; readonly sectionId: SectionId };
```

- [ ] **Step 2: Add `HighlightAnchor` import.**

At the top of `src/domain/ai/types.ts`, add (or extend if a `from '../annotations/types'` import already exists):

```ts
import type { HighlightAnchor } from '../annotations/types';
```

- [ ] **Step 3: Replace the passage variant.**

Replace lines 27–31 with:

```ts
export type ContextRef =
  | {
      readonly kind: 'passage';
      readonly text: string;
      readonly anchor: HighlightAnchor;
      readonly sectionTitle?: string;
      readonly windowBefore?: string;
      readonly windowAfter?: string;
      readonly chunkId?: ChunkId;
    }
  | { readonly kind: 'highlight'; readonly highlightId: HighlightId }
  | { readonly kind: 'chunk'; readonly chunkId: ChunkId }
  | { readonly kind: 'section'; readonly sectionId: SectionId };
```

- [ ] **Step 4: Run type-check to confirm no existing call site breaks.**

```bash
pnpm type-check
```

Expected: PASS (no current code constructs `passage` refs — pre-flight grep verified).

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/domain/ai/types.ts
git commit -m "feat(domain): chat — extend ContextRef.passage with anchor + section + window"
```

---

## Task 2: Reader contract + `EpubReaderAdapter.getPassageContextAt`

**Spec refs:** §5.1, §5.2, §13 commit 2.

**Files:**
- Modify: `src/domain/reader/types.ts:82+` — add method to `BookReader` interface
- Modify: `src/features/reader/epub/EpubReaderAdapter.ts` — implement
- Test: `src/features/reader/epub/EpubReaderAdapter.test.ts` (existing) — add tests for the new method

- [ ] **Step 1: Add `HighlightAnchor` import to reader types.**

At the top of `src/domain/reader/types.ts`, add:

```ts
import type { HighlightAnchor } from '../annotations/types';
```

(If an annotations import already exists, just append `HighlightAnchor` to it.)

- [ ] **Step 2: Extend `BookReader` interface.**

In `src/domain/reader/types.ts`, after the `getSectionTitleAt` line (around line 82), add:

```ts
  readonly getPassageContextAt: (anchor: HighlightAnchor) => Promise<{
    readonly text: string;
    readonly windowBefore?: string;
    readonly windowAfter?: string;
    readonly sectionTitle?: string;
  }>;
```

- [ ] **Step 3: Run type-check — both adapters should now report missing implementation.**

```bash
pnpm type-check
```

Expected: FAIL with two errors — `EpubReaderAdapter` and `PdfReaderAdapter` don't implement `getPassageContextAt`. This is the desired red state.

- [ ] **Step 4: Write a failing test in `EpubReaderAdapter.test.ts`.**

Add a new `describe` block at the bottom of `src/features/reader/epub/EpubReaderAdapter.test.ts`:

```ts
describe('getPassageContextAt', () => {
  it('returns the selected text with windowBefore/windowAfter when DOM walk succeeds', async () => {
    const adapter = new EpubReaderAdapter();
    // ...load fixture EPUB, navigate, simulate a CFI range covering known text
    const result = await adapter.getPassageContextAt({
      kind: 'epub-cfi',
      cfi: '/* CFI for known fixture range */',
    });
    expect(result.text).toContain('expected exact selection');
    expect(result.windowBefore).toBeDefined();
    expect(result.windowAfter).toBeDefined();
    expect(result.sectionTitle).toBeDefined();
  });

  it('returns {text} only when extraction fails (degrades gracefully, never throws)', async () => {
    const adapter = new EpubReaderAdapter();
    // Anchor with malformed CFI
    const result = await adapter.getPassageContextAt({
      kind: 'epub-cfi',
      cfi: 'invalid-cfi-string',
    });
    expect(result.text).toBe('');
    expect(result.windowBefore).toBeUndefined();
    expect(result.windowAfter).toBeUndefined();
  });

  it('caps text at 4000 chars when the selection is longer', async () => {
    const adapter = new EpubReaderAdapter();
    // Fixture with a >4000-char selection
    const result = await adapter.getPassageContextAt({
      kind: 'epub-cfi',
      cfi: '/* CFI for >4000-char range */',
    });
    expect(result.text.length).toBeLessThanOrEqual(4000);
  });

  it('trims windows at word boundaries', async () => {
    const adapter = new EpubReaderAdapter();
    const result = await adapter.getPassageContextAt({
      kind: 'epub-cfi',
      cfi: '/* CFI for fixture */',
    });
    if (result.windowBefore !== undefined) {
      // Should not start mid-word
      expect(result.windowBefore).not.toMatch(/^\S/);
    }
  });
});
```

> **Engineer note:** the existing EPUB adapter test file uses real foliate-view via happy-dom; check the existing test fixtures (look for `.epub` files in `src/test-fixtures/` or similar) and reuse the same fixture-loading helper (likely `loadFixture(name)` or inline `await fetch(fixtureUrl).then(r => r.blob())`). If fixture-load is too heavy for unit testing, mark these tests with `it.skip` and rely on the E2E coverage in Task 16; the impl can still be locked in. **Prefer real fixture if a precedent exists in `EpubReaderAdapter.test.ts`.**

- [ ] **Step 5: Run the failing test.**

```bash
pnpm test src/features/reader/epub/EpubReaderAdapter.test.ts
```

Expected: FAIL — `getPassageContextAt is not a function` or method missing.

- [ ] **Step 6: Implement `getPassageContextAt` in `EpubReaderAdapter`.**

In `src/features/reader/epub/EpubReaderAdapter.ts`, after `getSectionTitleAt` add:

```ts
async getPassageContextAt(anchor: HighlightAnchor): Promise<{
  text: string;
  windowBefore?: string;
  windowAfter?: string;
  sectionTitle?: string;
}> {
  if (anchor.kind !== 'epub-cfi') return { text: '' };
  if (!this.view) return { text: '' };
  try {
    const range = await this.view.resolveCFI(anchor.cfi);
    if (!range) return { text: '' };

    const fullText = range.toString();
    const cappedText = fullText.length > 4000
      ? fullText.slice(0, 4000)
      : fullText;

    const windowBefore = this.collectWindowBefore(range, 400);
    const windowAfter = this.collectWindowAfter(range, 400);
    const sectionTitle = this.getSectionTitleAt(
      this.anchorFromRange(range),
    ) ?? undefined;

    const result: {
      text: string;
      windowBefore?: string;
      windowAfter?: string;
      sectionTitle?: string;
    } = { text: cappedText };
    if (windowBefore !== undefined) result.windowBefore = windowBefore;
    if (windowAfter !== undefined) result.windowAfter = windowAfter;
    if (sectionTitle !== undefined) result.sectionTitle = sectionTitle;
    return result;
  } catch (err) {
    console.warn('[passage-mode] EPUB extraction failed; returning text-only', err);
    return { text: '' };
  }
}

private collectWindowBefore(range: Range, maxChars: number): string | undefined {
  // Walk backward from range.startContainer collecting textContent.
  // Stop at section root or when accumulated length >= maxChars.
  // Trim at last word boundary (space). Return undefined if zero chars collected.
  let collected = '';
  let node: Node | null = range.startContainer;
  while (node && collected.length < maxChars) {
    const prev = this.previousTextNode(node);
    if (!prev) break;
    collected = (prev.textContent ?? '') + collected;
    node = prev;
  }
  if (collected.length === 0) return undefined;
  const trimmed = collected.slice(-maxChars);
  const wordBoundary = trimmed.indexOf(' ');
  const final = wordBoundary >= 0 ? trimmed.slice(wordBoundary + 1) : trimmed;
  return final.length > 0 ? final : undefined;
}

private collectWindowAfter(range: Range, maxChars: number): string | undefined {
  let collected = '';
  let node: Node | null = range.endContainer;
  while (node && collected.length < maxChars) {
    const next = this.nextTextNode(node);
    if (!next) break;
    collected = collected + (next.textContent ?? '');
    node = next;
  }
  if (collected.length === 0) return undefined;
  const trimmed = collected.slice(0, maxChars);
  const wordBoundary = trimmed.lastIndexOf(' ');
  const final = wordBoundary >= 0 ? trimmed.slice(0, wordBoundary) : trimmed;
  return final.length > 0 ? final : undefined;
}

private previousTextNode(node: Node): Node | null {
  // DOM tree walk: previous sibling, descend to last leaf; else parent's prev; etc.
  // Stop at section root (e.g., the iframe document body).
  // Implementation: use TreeWalker with NodeFilter.SHOW_TEXT.
  // ... (concrete walker logic — see foliate's existing utilities if available)
}

private nextTextNode(node: Node): Node | null {
  // Symmetric to previousTextNode.
}

private anchorFromRange(range: Range): LocationAnchor {
  // Reuse existing helper that builds an anchor from a range; adapter likely already has one.
}
```

> **Engineer note:** the EPUB adapter likely already has internal CFI/Range utilities for highlight rendering. **Reuse them** — search the existing file for `resolveCFI`, `Range`, and any `TreeWalker` usage before implementing fresh DOM walking. If `previousTextNode` / `nextTextNode` aren't already available, foliate exposes range utilities — check the existing imports.

- [ ] **Step 7: Run the test to verify it now passes.**

```bash
pnpm test src/features/reader/epub/EpubReaderAdapter.test.ts
```

Expected: PASS for all four `getPassageContextAt` cases (or PASS+skipped if fixture-loading was deferred per the note in Step 4).

- [ ] **Step 8: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add src/domain/reader/types.ts src/features/reader/epub/EpubReaderAdapter.ts src/features/reader/epub/EpubReaderAdapter.test.ts
git commit -m "feat(reader): BookReader.getPassageContextAt contract + EpubReaderAdapter impl"
```

---

## Task 3: `PdfReaderAdapter.getPassageContextAt`

**Spec refs:** §5.3, §13 commit 3.

**Files:**
- Modify: `src/features/reader/pdf/PdfReaderAdapter.ts` — implement after `getSnippetAt` (line ~204)
- Test: `src/features/reader/pdf/PdfReaderAdapter.test.ts` — add tests including first-match-wins fixture

- [ ] **Step 1: Write a failing test in `PdfReaderAdapter.test.ts`.**

Append to `src/features/reader/pdf/PdfReaderAdapter.test.ts`:

```ts
describe('getPassageContextAt', () => {
  it('returns text + windows for a found selection', async () => {
    const adapter = new PdfReaderAdapter();
    // Open a fixture PDF where page 1 contains a known sentence.
    // ...setup
    const result = await adapter.getPassageContextAt({
      kind: 'pdf',
      page: 1,
      rects: [{ x: 0, y: 100, width: 100, height: 20 }],
    });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.windowBefore).toBeDefined();
    expect(result.windowAfter).toBeDefined();
  });

  it('falls back to {text} only when selection is not found in page text', async () => {
    const adapter = new PdfReaderAdapter();
    // ...setup with anchor whose rects don't correspond to any text item
    const result = await adapter.getPassageContextAt({
      kind: 'pdf',
      page: 1,
      rects: [],
    });
    expect(result.text).toBe('');
    expect(result.windowBefore).toBeUndefined();
    expect(result.windowAfter).toBeUndefined();
  });

  // Documents the v1 first-match-wins limitation. When the selected text appears twice,
  // we extract windows from the first match. Future enhancement: bias by rect y-coordinate.
  it('uses first-match-wins when selection text appears multiple times on the page', async () => {
    const adapter = new PdfReaderAdapter();
    // Fixture page where the phrase "the same words" appears on lines 1 and 5.
    // The anchor's y points at line 5; v1 still returns line 1's window (documented limitation).
    const result = await adapter.getPassageContextAt({
      kind: 'pdf',
      page: 1,
      rects: [{ x: 0, y: 500, width: 100, height: 20 }],
    });
    expect(result.text).toContain('the same words');
    // Assert the windowBefore/windowAfter come from the first occurrence (whatever fixture content sits around line 1).
    expect(result.windowBefore).toContain('/* line 1's preceding sentence */');
  });

  it('caps text at 4000 chars', async () => {
    const adapter = new PdfReaderAdapter();
    // ...fixture with a long selection
    const result = await adapter.getPassageContextAt({
      kind: 'pdf',
      page: 1,
      rects: [/* long selection */],
    });
    expect(result.text.length).toBeLessThanOrEqual(4000);
  });

  it('returns sectionTitle = undefined for PDFs (no first-class sections)', async () => {
    const adapter = new PdfReaderAdapter();
    const result = await adapter.getPassageContextAt({
      kind: 'pdf',
      page: 1,
      rects: [{ x: 0, y: 100, width: 100, height: 20 }],
    });
    expect(result.sectionTitle).toBeUndefined();
  });
});
```

> **Engineer note:** existing PDF tests at `PdfReaderAdapter.test.ts:4-9` mention deferring real-pdfjs interaction to E2E. If unit-testing this in happy-dom is impractical, mark these `it.skip` with a clear comment, capture coverage in the new E2E spec (Task 16), and still write the implementation — the contract is locked by the type interface. **At minimum keep the first-match-wins test as documentation, even if skipped.**

- [ ] **Step 2: Run the failing test.**

```bash
pnpm test src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: FAIL — `getPassageContextAt is not a function`.

- [ ] **Step 3: Implement `getPassageContextAt` in `PdfReaderAdapter`.**

After the existing `getSnippetAt` method (around line 204) in `src/features/reader/pdf/PdfReaderAdapter.ts`:

```ts
async getPassageContextAt(anchor: HighlightAnchor): Promise<{
  text: string;
  windowBefore?: string;
  windowAfter?: string;
  sectionTitle?: string;
}> {
  if (anchor.kind !== 'pdf') return { text: '' };
  if (!this.pdfDoc) return { text: '' };
  if (anchor.page < 1 || anchor.page > this.pageCount) return { text: '' };

  try {
    const page = await this.pdfDoc.getPage(anchor.page);
    const textContent = await page.getTextContent();
    const items = textContent.items as { str?: string }[];
    const joined = items
      .map((i) => i.str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined.length === 0) return { text: '' };

    // Reconstruct the selected text from the rects. The adapter's existing
    // selection-to-text logic should already exist for highlight rendering;
    // reuse it. Pseudocode:
    const selectedText = await this.extractTextForRects(page, anchor.rects);
    if (selectedText.length === 0) return { text: '' };

    // Cap selected text at 4000 chars.
    const cappedText = selectedText.length > 4000
      ? selectedText.slice(0, 4000)
      : selectedText;

    // First-match-wins: search joined for cappedText (or its first chunk if capped).
    // TODO(passage-y-bias): bias toward anchor.rects mean-y when feasible.
    // Requires keeping a parallel item→char-offset map; deferred until users hit
    // the limitation. See spec §5.3.
    const searchText = cappedText.slice(0, 200); // search prefix to be resilient
    const matchIdx = joined.indexOf(searchText);
    if (matchIdx < 0) {
      return { text: cappedText };
    }

    const beforeStart = Math.max(0, matchIdx - 400);
    const beforeRaw = joined.slice(beforeStart, matchIdx);
    const afterStart = matchIdx + cappedText.length;
    const afterRaw = joined.slice(afterStart, afterStart + 400);

    const windowBefore = this.trimAtWordBoundaryStart(beforeRaw);
    const windowAfter = this.trimAtWordBoundaryEnd(afterRaw);

    const result: {
      text: string;
      windowBefore?: string;
      windowAfter?: string;
      sectionTitle?: string;
    } = { text: cappedText };
    if (windowBefore !== undefined) result.windowBefore = windowBefore;
    if (windowAfter !== undefined) result.windowAfter = windowAfter;
    return result;
  } catch (err) {
    console.warn('[passage-mode] PDF extraction failed; returning text-only', err);
    return { text: '' };
  }
}

private trimAtWordBoundaryStart(s: string): string | undefined {
  if (s.length === 0) return undefined;
  const idx = s.indexOf(' ');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

private trimAtWordBoundaryEnd(s: string): string | undefined {
  if (s.length === 0) return undefined;
  const idx = s.lastIndexOf(' ');
  return idx >= 0 ? s.slice(0, idx) : s;
}
```

Add the import at the top of the file if not already present:

```ts
import type { HighlightAnchor } from '@/domain/annotations/types';
```

> **Engineer note:** `extractTextForRects` is a placeholder for the adapter's existing rect→text logic used for highlight rendering. Find it in the file (likely involves PDF.js viewport coordinates + textContent items). Reuse rather than re-implement.

- [ ] **Step 4: Run the tests.**

```bash
pnpm test src/features/reader/pdf/PdfReaderAdapter.test.ts
```

Expected: PASS (or PASS+skipped if fixtures deferred).

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS — both adapters now satisfy the `BookReader` interface.

- [ ] **Step 6: Commit.**

```bash
git add src/features/reader/pdf/PdfReaderAdapter.ts src/features/reader/pdf/PdfReaderAdapter.test.ts
git commit -m "feat(reader): PdfReaderAdapter.getPassageContextAt impl"
```

---

## Task 4: `ReaderViewExposedState` passthrough

**Spec refs:** §5.4, §13 commit 4.

**Files:**
- Modify: `src/features/reader/ReaderView.tsx` — extend `ReaderViewExposedState` type + expose

- [ ] **Step 1: Add `HighlightAnchor` import.**

In `src/features/reader/ReaderView.tsx`, add to the existing imports:

```ts
import type { HighlightAnchor } from '@/domain/annotations/types';
```

- [ ] **Step 2: Extend the `ReaderViewExposedState` type (around line 16-32).**

After the `getSectionTitleAt` line, add:

```ts
  readonly getPassageContextAt: (anchor: HighlightAnchor) => Promise<{
    readonly text: string;
    readonly windowBefore?: string;
    readonly windowAfter?: string;
    readonly sectionTitle?: string;
  }>;
```

- [ ] **Step 3: Run type-check — workspace should now report missing field on the exposed state.**

```bash
pnpm type-check
```

Expected: FAIL with errors at `ReaderView.tsx`'s `onStateChange` callback site (where the exposed state is constructed).

- [ ] **Step 4: Add the passthrough where `ReaderViewExposedState` is constructed (around line 240).**

In the `onStateChange` payload (or wherever the state is assembled), add:

```ts
getPassageContextAt: (anchor) => adapter.getPassageContextAt(anchor),
```

(Mirror the existing pattern used for `getSnippetAt` — it should be visible nearby.)

- [ ] **Step 5: Run type-check.**

```bash
pnpm type-check
```

Expected: PASS.

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/reader/ReaderView.tsx
git commit -m "feat(reader): ReaderViewExposedState passthrough for getPassageContextAt"
```

---

## Task 5: `assemblePassageChatPrompt` + soft-cap reduction

**Spec refs:** §6.1, §6.2, §6.3, §6.4, §13 commit 5.

**Files:**
- Modify: `src/features/ai/chat/promptAssembly.ts` — add constants + helper + new assembly fn
- Test: `src/features/ai/chat/promptAssembly.test.ts` — add new describe block

- [ ] **Step 1: Write failing tests for the new assembly + soft-cap selector.**

Append to `src/features/ai/chat/promptAssembly.test.ts`:

```ts
import {
  assemblePassageChatPrompt,
  HISTORY_SOFT_CAP_OPEN,
  HISTORY_SOFT_CAP_PASSAGE,
} from './promptAssembly';

describe('assemblePassageChatPrompt', () => {
  const book = { title: 'Pride and Prejudice', author: 'Jane Austen', format: 'epub' as const };
  const passage = {
    text: 'She scarcely heard the rest, she was so taken aback.',
    windowBefore: 'the conversation drifted, and as Mr. Darcy spoke,',
    windowAfter: 'all of this in the midst of the parlour\'s quiet hum.',
    sectionTitle: 'Chapter 4',
  };

  it('emits exactly one combined system message with both prompts and addendum', () => {
    const result = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'What is happening here?',
      passage,
    });
    const systemMsgs = result.messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0].content).toContain('Pride and Prejudice');
    expect(systemMsgs[0].content).toContain('passage');
    expect(systemMsgs[0].content).toContain('attached');
  });

  it('prepends the passage block to the new user message with bold delimiters and ellipses', () => {
    const result = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'Explain.',
      passage,
    });
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain(`**${passage.text}**`);
    expect(last.content).toContain(`…${passage.windowBefore!}`);
    expect(last.content).toContain(`${passage.windowAfter!}…`);
    expect(last.content).toContain(passage.sectionTitle!);
    expect(last.content).toContain('Explain.');
  });

  it('handles missing windows and section gracefully', () => {
    const result = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'Explain.',
      passage: { text: passage.text },
    });
    const last = result.messages[result.messages.length - 1];
    expect(last.content).toContain(`**${passage.text}**`);
    expect(last.content).not.toContain('…');
  });

  it('preserves user/assistant history between system and last user', () => {
    const history: ChatMessage[] = [
      makeUserMessage('first question'),
      makeAssistantMessage('first answer'),
    ];
    const result = assemblePassageChatPrompt({
      book,
      history,
      newUserText: 'follow-up',
      passage,
    });
    expect(result.messages.length).toBe(4); // system + 2 history + 1 new user
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toBe('first question');
    expect(result.messages[2].role).toBe('assistant');
  });

  it('drops to HISTORY_SOFT_CAP_PASSAGE when current message is passage-mode', () => {
    const history: ChatMessage[] = makePairs(35); // 35 pairs = 70 messages
    const result = assemblePassageChatPrompt({
      book,
      history,
      newUserText: 'q',
      passage,
    });
    expect(result.historyDropped).toBe((35 - HISTORY_SOFT_CAP_PASSAGE) * 2);
  });

  it('drops to HISTORY_SOFT_CAP_PASSAGE when ANY history message is passage-mode (assembleOpenChatPrompt also uses 30)', () => {
    const history = makePairs(35);
    history[10] = { ...history[10], mode: 'passage' };
    const result = assembleOpenChatPrompt({
      book,
      history,
      newUserText: 'q',
    });
    expect(result.historyDropped).toBe((35 - HISTORY_SOFT_CAP_PASSAGE) * 2);
  });

  it('uses HISTORY_SOFT_CAP_OPEN when no message is passage-mode', () => {
    const history = makePairs(45);
    const result = assembleOpenChatPrompt({
      book,
      history,
      newUserText: 'q',
    });
    expect(result.historyDropped).toBe((45 - HISTORY_SOFT_CAP_OPEN) * 2);
  });

  it('caps selection text at 4000 chars in the prompt', () => {
    const longText = 'x'.repeat(5000);
    const result = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'q',
      passage: { text: longText },
    });
    const last = result.messages[result.messages.length - 1];
    // Find the bolded selection
    const match = last.content.match(/\*\*(.*?)\*\*/s);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThanOrEqual(4000);
    expect(last.content).toContain('(truncated for AI)');
  });
});
```

> **Engineer note:** look at the existing test file (`promptAssembly.test.ts`) for the `makeUserMessage` / `makeAssistantMessage` / `makePairs` helpers — extend or reuse. If they don't exist, create them at the top of the test file:
>
> ```ts
> function makeUserMessage(content: string, mode: ChatMode = 'open'): ChatMessage {
>   return { id: 'm1' as ChatMessageId, threadId: 't1' as ChatThreadId, role: 'user', content, mode, contextRefs: [], createdAt: '2026-01-01T00:00:00Z' as IsoTimestamp };
> }
> // ... similar for assistant, makePairs(n)
> ```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/ai/chat/promptAssembly.test.ts
```

Expected: FAIL — `assemblePassageChatPrompt` and `HISTORY_SOFT_CAP_*` not exported.

- [ ] **Step 3: Implement constants + selector + new assembly fn.**

Replace the existing `HISTORY_SOFT_CAP` constant (line 4) with:

```ts
export const HISTORY_SOFT_CAP_OPEN = 40;
export const HISTORY_SOFT_CAP_PASSAGE = 30;

// Backward alias — keep the old name for existing call sites that don't yet know about modes.
export const HISTORY_SOFT_CAP = HISTORY_SOFT_CAP_OPEN;

function effectiveSoftCap(
  history: readonly ChatMessage[],
  thisModeIsPassage: boolean,
): number {
  if (thisModeIsPassage) return HISTORY_SOFT_CAP_PASSAGE;
  if (history.some((m) => m.mode === 'passage')) return HISTORY_SOFT_CAP_PASSAGE;
  return HISTORY_SOFT_CAP_OPEN;
}
```

In `assembleOpenChatPrompt`, replace the line that computes `preservedCount`:

```ts
const cap = effectiveSoftCap(input.history, false);
const preservedCount = cap * 2;
```

Add the passage-mode addendum constant (above `assembleOpenChatPrompt`):

```ts
const PASSAGE_MODE_ADDENDUM =
  'The user has attached a passage from this book. Treat the bolded text between the ellipsis windows as the primary subject. The surrounding ellipsis text is included only for orientation — do not summarize or analyze it as if it were the user\'s selection. If the user asks for something that requires text outside the attached window, say so and offer to help once they share more.';
```

Add the new assembly function at the bottom of the file:

```ts
export type AssemblePassageChatInput = {
  readonly book: {
    readonly title: string;
    readonly author?: string;
    readonly format: BookFormat;
  };
  readonly history: readonly ChatMessage[];
  readonly newUserText: string;
  readonly passage: {
    readonly text: string;
    readonly windowBefore?: string;
    readonly windowAfter?: string;
    readonly sectionTitle?: string;
  };
};

const SELECTION_CHAR_CAP = 4000;

function buildPassageBlock(
  bookTitle: string,
  passage: AssemblePassageChatInput['passage'],
): string {
  const titleLine = passage.sectionTitle !== undefined
    ? `[Passage from "${bookTitle}" — ${passage.sectionTitle}]`
    : `[Passage from "${bookTitle}"]`;

  const cappedText = passage.text.length > SELECTION_CHAR_CAP
    ? passage.text.slice(0, SELECTION_CHAR_CAP)
    : passage.text;
  const truncationNotice = passage.text.length > SELECTION_CHAR_CAP
    ? '\n(truncated for AI)'
    : '';

  const before = passage.windowBefore !== undefined
    ? `…${passage.windowBefore}\n`
    : '';
  const after = passage.windowAfter !== undefined
    ? `\n${passage.windowAfter}…`
    : '';

  return `${titleLine}\n${before}**${cappedText}**${truncationNotice}${after}`;
}

export function assemblePassageChatPrompt(
  input: AssemblePassageChatInput,
): AssembleOpenChatResult {
  const combinedSystem: ChatCompletionMessage = {
    role: 'system',
    content: `${buildOpenModeSystemPrompt(input.book)}\n\n${PASSAGE_MODE_ADDENDUM}`,
  };

  const cap = effectiveSoftCap(input.history, true);
  const preservedCount = cap * 2;
  const dropFromFront = Math.max(0, input.history.length - preservedCount);
  const preserved = input.history.slice(dropFromFront);

  const historyMsgs: ChatCompletionMessage[] = preserved
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const passageBlock = buildPassageBlock(input.book.title, input.passage);
  const tail: ChatCompletionMessage = {
    role: 'user',
    content: `${passageBlock}\n\n${input.newUserText}`,
  };

  return {
    messages: [combinedSystem, ...historyMsgs, tail],
    historyDropped: dropFromFront,
  };
}
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm test src/features/ai/chat/promptAssembly.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/ai/chat/promptAssembly.ts src/features/ai/chat/promptAssembly.test.ts
git commit -m "feat(ai): assemblePassageChatPrompt + soft-cap reduction for passage threads"
```

---

## Task 6: `useChatSend.attachedPassage`; `mode='passage'` on send

**Spec refs:** §7.1, §7.2, §13 commit 6.

**Files:**
- Modify: `src/features/ai/chat/useChatSend.ts` — add `attachedPassage` prop + branching
- Test: `src/features/ai/chat/useChatSend.test.ts` — add cases

- [ ] **Step 1: Add the `AttachedPassage` type to a shared location.**

Create or update `src/features/ai/chat/types.ts` (if it exists) or add inline at the top of `useChatSend.ts`:

```ts
import type { HighlightAnchor } from '@/domain/annotations/types';

export type AttachedPassage = {
  readonly anchor: HighlightAnchor;
  readonly text: string;
  readonly windowBefore?: string;
  readonly windowAfter?: string;
  readonly sectionTitle?: string;
};
```

> **Engineer note:** if there isn't an existing `types.ts` in this feature folder, putting it in `useChatSend.ts` is fine and other files (ChatPanel, PassageChip) can `import type { AttachedPassage } from './useChatSend'`.

- [ ] **Step 2: Write failing tests for the new branch.**

Append to `src/features/ai/chat/useChatSend.test.ts`:

```ts
describe('useChatSend with attachedPassage', () => {
  it('uses assemblePassageChatPrompt when attachedPassage is non-null', async () => {
    // ...mount hook with attachedPassage
    // ...assert that the streamFactory was called with the passage-block content
  });

  it('sets mode=passage on BOTH user and assistant messages of the turn', async () => {
    // ...mount, send, finalize
    // Assert: append called twice with mode: 'passage'
  });

  it('writes passage contextRefs ONLY on the assistant message; user message has empty contextRefs', async () => {
    const append = vi.fn();
    const finalize = vi.fn();
    // ... mount + send
    // Last user message append: contextRefs === []
    // Assistant finalize: contextRefs.find(r => r.kind === 'passage')?.anchor toEqual attachedPassage.anchor
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', mode: 'passage', contextRefs: [] }),
    );
    expect(finalize).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        contextRefs: [expect.objectContaining({ kind: 'passage' })],
      }),
    );
  });

  it('falls back to open-mode behavior when attachedPassage is null', async () => {
    // Existing 4.3 behavior assertions
  });

  it('does not auto-clear attachedPassage on send (sticky semantics owned by ChatPanel)', async () => {
    // useChatSend never calls onClearAttachedPassage; ChatPanel handles lifecycle
  });
});
```

- [ ] **Step 3: Run failing tests.**

```bash
pnpm test src/features/ai/chat/useChatSend.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Extend `Args` and the send branch in `useChatSend.ts`.**

Add to `Args`:

```ts
readonly attachedPassage?: AttachedPassage | null;
```

In the `send` callback (around lines 77–95 of the current file), replace the hardcoded mode/contextRefs/assembly block with:

```ts
const passage = args.attachedPassage ?? null;
const isPassage = passage !== null;

const userMessage: ChatMessage = {
  id: makeId(),
  threadId,
  role: 'user',
  content: userText,
  mode: isPassage ? 'passage' : 'open',
  contextRefs: [], // Always empty on user message — assistant carries provenance.
  createdAt: nowIso(),
};

const assistantId = makeId();
const assistantInitial: ChatMessage = {
  id: assistantId,
  threadId,
  role: 'assistant',
  content: '',
  mode: isPassage ? 'passage' : 'open',
  contextRefs: isPassage
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
    : [],
  streaming: true,
  createdAt: nowIso(),
};

await args.append(userMessage);
await args.append(assistantInitial);

const assembleResult = isPassage
  ? assemblePassageChatPrompt({
      book: args.book,
      history: args.history,
      newUserText: userText,
      passage: {
        text: passage!.text,
        ...(passage!.windowBefore !== undefined && { windowBefore: passage!.windowBefore }),
        ...(passage!.windowAfter !== undefined && { windowAfter: passage!.windowAfter }),
        ...(passage!.sectionTitle !== undefined && { sectionTitle: passage!.sectionTitle }),
      },
    })
  : assembleOpenChatPrompt({
      book: args.book,
      history: args.history,
      newUserText: userText,
    });
```

> **Engineer note:** the existing `useChatSend.ts` may have an inlined `nowIso()` and `makeId()`; if not, look for the patterns at the top of the file. **Do not** invent new helpers — reuse what's there. The `passage!` non-null assertions are safe because `isPassage === true` implies `passage !== null`; if the engineer prefers, narrow the variable instead.

- [ ] **Step 5: Run the tests.**

```bash
pnpm test src/features/ai/chat/useChatSend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/ai/chat/useChatSend.ts src/features/ai/chat/useChatSend.test.ts
git commit -m "feat(ai): useChatSend accepts attachedPassage; mode=passage on send"
```

---

## Task 7: Storage — validate `ContextRef.passage` in normalizers

**Spec refs:** §4.3, §4.4, §13 commit 7.

**Files:**
- Modify: `src/storage/repositories/chatMessages.ts` — extend normalizer
- Modify: `src/storage/repositories/savedAnswers.ts` — same
- Test: both `*.test.ts` files — add cases

- [ ] **Step 1: Write failing tests in `chatMessages.test.ts`.**

Append:

```ts
describe('contextRef.passage validation', () => {
  it('round-trips a well-formed passage ref', async () => {
    const repo = await createRepo();
    const msg: ChatMessage = makeAssistantMessage({
      contextRefs: [{
        kind: 'passage',
        text: 'hello',
        anchor: { kind: 'epub-cfi', cfi: '/6/4!/4/2/1:0,/4/2/1:5' },
        sectionTitle: 'Chapter 1',
        windowBefore: 'before…',
        windowAfter: '…after',
      }],
    });
    await repo.upsert(msg);
    const fetched = await repo.listByThread(msg.threadId);
    expect(fetched[0].contextRefs).toEqual(msg.contextRefs);
  });

  it('filters a malformed passage ref (missing anchor) but keeps the message', async () => {
    const repo = await createRepo();
    // Force an invalid record into IndexedDB (bypass type checks via raw put).
    const raw = makeRawChatMessageRecord({
      contextRefs: [
        { kind: 'passage', text: 'no anchor here' }, // malformed
      ],
    });
    await rawPut(repo, raw);
    const fetched = await repo.listByThread(raw.threadId);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].contextRefs).toEqual([]); // filtered
  });

  it('filters a passage ref with bad anchor.kind but keeps siblings', async () => {
    const repo = await createRepo();
    const raw = makeRawChatMessageRecord({
      contextRefs: [
        { kind: 'passage', text: 'bad', anchor: { kind: 'unknown' } },
        { kind: 'highlight', highlightId: 'h1' },
      ],
    });
    await rawPut(repo, raw);
    const fetched = await repo.listByThread(raw.threadId);
    expect(fetched[0].contextRefs).toEqual([{ kind: 'highlight', highlightId: 'h1' }]);
  });

  it('rejects passage ref with non-string sectionTitle', async () => {
    const repo = await createRepo();
    const raw = makeRawChatMessageRecord({
      contextRefs: [
        {
          kind: 'passage',
          text: 'x',
          anchor: { kind: 'epub-cfi', cfi: '/abc' },
          sectionTitle: 42, // wrong type
        },
      ],
    });
    await rawPut(repo, raw);
    const fetched = await repo.listByThread(raw.threadId);
    expect(fetched[0].contextRefs).toEqual([]);
  });
});
```

> **Engineer note:** `makeRawChatMessageRecord` and `rawPut` are illustrative — use whatever low-level put helper the existing test file uses to bypass type checks. If none exists, write one that opens the IDB store directly via `fake-indexeddb`.

Add the same four tests (round-trip / missing anchor / bad anchor.kind / bad sectionTitle type) to `src/storage/repositories/savedAnswers.test.ts`, with the substitutions:
- `ChatMessage` → `SavedAnswer`
- `makeAssistantMessage(...)` → `makeSavedAnswer(...)` (or whatever the existing test file uses)
- `repo.upsert(msg)` → `repo.upsert(answer)`
- `repo.listByThread(...)` → `repo.listByBook(...)` (or whatever the existing test file uses to fetch saved answers)

Verbatim repeat is fine — the engineer may read tasks out of order, and a single shared test helper isn't worth the abstraction for four tests.

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/storage/repositories/chatMessages.test.ts src/storage/repositories/savedAnswers.test.ts
```

Expected: FAIL — invalid passage refs are currently passed through unchanged or drop the whole message.

- [ ] **Step 3: Add `isValidContextRef` to a shared validation module.**

Create `src/storage/repositories/contextRefValidation.ts`:

```ts
import type { ContextRef } from '@/domain';

export function isValidContextRef(value: unknown): value is ContextRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  if (v.kind === 'passage') {
    const p = v as Record<string, unknown>;
    if (typeof p.text !== 'string') return false;
    if (typeof p.anchor !== 'object' || p.anchor === null) return false;
    const a = p.anchor as { kind?: unknown };
    if (a.kind !== 'epub-cfi' && a.kind !== 'pdf') return false;
    if (p.sectionTitle !== undefined && typeof p.sectionTitle !== 'string') return false;
    if (p.windowBefore !== undefined && typeof p.windowBefore !== 'string') return false;
    if (p.windowAfter !== undefined && typeof p.windowAfter !== 'string') return false;
    return true;
  }
  // Other variants: lenient pass-through (matches existing 4.3 validating-reads behavior).
  // Per spec §4.3, only the passage variant gets stricter validation in 4.4.
  if (v.kind === 'highlight' || v.kind === 'chunk' || v.kind === 'section') return true;
  return false;
}
```

- [ ] **Step 4: Use it in `chatMessages.ts` normalizer (around line 41).**

Find the line where `r.contextRefs` is currently handled (after the array check) and replace it with:

```ts
import { isValidContextRef } from './contextRefValidation';
// ...
const contextRefs = Array.isArray(r.contextRefs)
  ? r.contextRefs.filter(isValidContextRef)
  : [];
```

Use `contextRefs` (the filtered version) in the returned `ChatMessage` object. **Do not** drop the whole message when `contextRefs` is non-array — coerce to `[]`.

- [ ] **Step 5: Same change in `savedAnswers.ts`.**

Apply the same `isValidContextRef` filter at the analogous point in `savedAnswers.ts`'s normalizer.

- [ ] **Step 6: Run the tests.**

```bash
pnpm test src/storage/repositories/chatMessages.test.ts src/storage/repositories/savedAnswers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/storage/repositories/chatMessages.ts src/storage/repositories/savedAnswers.ts src/storage/repositories/contextRefValidation.ts src/storage/repositories/chatMessages.test.ts src/storage/repositories/savedAnswers.test.ts
git commit -m "feat(storage): validate ContextRef.passage in chatMessages + savedAnswers normalizers"
```

---

## Task 8: `HighlightToolbar` — Ask AI action

**Spec refs:** §8.2, §13 commit 8.

**Files:**
- Modify: `src/features/reader/HighlightToolbar.tsx` — add `onAskAI` + `canAskAI` props; render button
- Test: `src/features/reader/HighlightToolbar.test.tsx` — add visibility + click cases

- [ ] **Step 1: Write failing tests.**

Append to `src/features/reader/HighlightToolbar.test.tsx`:

```ts
describe('Ask AI action', () => {
  function renderWithDefaults(overrides: Partial<Props> = {}) {
    const props: Props = {
      mode: 'create',
      screenRect: { x: 100, y: 100, width: 200, height: 30 },
      onPickColor: vi.fn(),
      onDismiss: vi.fn(),
      ...overrides,
    };
    render(<HighlightToolbar {...props} />);
    return props;
  }

  it('shows the Ask AI button when canAskAI=true and onAskAI is defined', () => {
    renderWithDefaults({ canAskAI: true, onAskAI: vi.fn() });
    expect(screen.getByRole('button', { name: /ask ai/i })).toBeInTheDocument();
  });

  it('hides the Ask AI button when canAskAI=false', () => {
    renderWithDefaults({ canAskAI: false, onAskAI: vi.fn() });
    expect(screen.queryByRole('button', { name: /ask ai/i })).not.toBeInTheDocument();
  });

  it('hides the Ask AI button when onAskAI is undefined', () => {
    renderWithDefaults({ canAskAI: true });
    expect(screen.queryByRole('button', { name: /ask ai/i })).not.toBeInTheDocument();
  });

  it('shows in edit mode too', () => {
    renderWithDefaults({ mode: 'edit', canAskAI: true, onAskAI: vi.fn(), onDelete: vi.fn() });
    expect(screen.getByRole('button', { name: /ask ai/i })).toBeInTheDocument();
  });

  it('clicking Ask AI dismisses the toolbar and calls onAskAI', async () => {
    const onAskAI = vi.fn();
    const onDismiss = vi.fn();
    renderWithDefaults({ canAskAI: true, onAskAI, onDismiss });
    await userEvent.click(screen.getByRole('button', { name: /ask ai/i }));
    expect(onAskAI).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/reader/HighlightToolbar.test.tsx
```

Expected: FAIL — no Ask AI button.

- [ ] **Step 3: Add props to `HighlightToolbar.tsx`.**

In `src/features/reader/HighlightToolbar.tsx` around line 18, extend `Props`:

```ts
type Props = {
  readonly mode: Mode;
  readonly screenRect: { x: number; y: number; width: number; height: number };
  readonly currentColor?: HighlightColor;
  readonly onPickColor: (color: HighlightColor) => void;
  readonly onDelete?: () => void;
  readonly onNote?: () => void;
  readonly hasNote?: boolean;
  readonly onDismiss: () => void;
  readonly onAskAI?: () => void;
  readonly canAskAI?: boolean;
};
```

- [ ] **Step 4: Render the button after the note button (before delete).**

Find the existing `onNote` render block (around lines 93–109) and insert the Ask AI block after it:

```tsx
{onAskAI !== undefined && canAskAI === true && (
  <>
    <span className="highlight-toolbar__divider" aria-hidden="true" />
    <button
      type="button"
      className="highlight-toolbar__action"
      aria-label="Ask AI about this passage"
      onClick={() => {
        onDismiss();
        onAskAI();
      }}
    >
      <ChatIcon />
    </button>
  </>
)}
```

Add the import for `ChatIcon` at the top — it's the icon used in 4.3's `ChatHeader.tsx`:

```ts
import { ChatIcon } from './icons/ChatIcon'; // or wherever Phase 4.3 placed it
```

> **Engineer note:** confirm the actual import path by grepping for `ChatIcon` in `src/features/ai/chat/`.

- [ ] **Step 5: Add divider styling.**

In the toolbar's CSS (likely `src/features/reader/highlight-toolbar.css` or an inline style block):

```css
.highlight-toolbar__divider {
  width: 1px;
  height: 16px;
  background: var(--color-border-subtle);
  margin: 0 var(--space-2);
}
```

- [ ] **Step 6: Run the tests.**

```bash
pnpm test src/features/reader/HighlightToolbar.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/features/reader/HighlightToolbar.tsx src/features/reader/HighlightToolbar.test.tsx src/features/reader/highlight-toolbar.css
git commit -m "feat(reader): HighlightToolbar — Ask AI action (create + edit modes)"
```

---

## Task 9: `PassageChip` component

**Spec refs:** §8.3, §13 commit 9.

**Files:**
- Create: `src/features/ai/chat/PassageChip.tsx`
- Create: `src/features/ai/chat/PassageChip.test.tsx`
- Modify: `src/features/ai/chat/chat-panel.css` — add styling

- [ ] **Step 1: Write the failing test first.**

Create `src/features/ai/chat/PassageChip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PassageChip } from './PassageChip';

describe('PassageChip', () => {
  it('renders the section title and truncated selection text', () => {
    render(
      <PassageChip
        text="She scarcely heard the rest, she was so taken aback by his admission that she could only stare."
        sectionTitle="Chapter 4"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/chapter 4/i)).toBeInTheDocument();
    // Truncated to ~80 chars + ellipsis
    expect(screen.getByText(/she scarcely heard the rest/i)).toBeInTheDocument();
  });

  it('omits section line when sectionTitle is undefined', () => {
    render(<PassageChip text="some text" onDismiss={vi.fn()} />);
    expect(screen.queryByText(/chapter/i)).not.toBeInTheDocument();
  });

  it('truncates text longer than 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(120);
    render(<PassageChip text={long} onDismiss={vi.fn()} />);
    const textNode = screen.getByText(/x.*…/);
    expect(textNode.textContent!.length).toBeLessThan(120);
    expect(textNode.textContent).toContain('…');
  });

  it('calls onDismiss when ✕ is clicked', async () => {
    const onDismiss = vi.fn();
    render(<PassageChip text="t" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('exposes role=status with aria-live=polite', () => {
    render(<PassageChip text="t" onDismiss={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('aria-label includes the full section + selection for screen readers', () => {
    render(
      <PassageChip
        text="full selection text"
        sectionTitle="Chapter 1"
        onDismiss={vi.fn()}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute(
      'aria-label',
      expect.stringContaining('full selection text'),
    );
    expect(status.getAttribute('aria-label')).toContain('Chapter 1');
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/ai/chat/PassageChip.test.tsx
```

Expected: FAIL — `PassageChip` not defined.

- [ ] **Step 3: Implement the component.**

Create `src/features/ai/chat/PassageChip.tsx`:

```tsx
type Props = {
  readonly text: string;
  readonly sectionTitle?: string;
  readonly onDismiss: () => void;
};

const DISPLAY_CAP = 80;

function truncate(s: string): string {
  if (s.length <= DISPLAY_CAP) return s;
  return s.slice(0, DISPLAY_CAP).trimEnd() + '…';
}

export function PassageChip({ text, sectionTitle, onDismiss }: Props) {
  const displayText = truncate(text);
  const ariaLabel = sectionTitle !== undefined
    ? `Attached passage: ${sectionTitle}, "${text}"`
    : `Attached passage: "${text}"`;

  return (
    <div
      className="passage-chip"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <span className="passage-chip__icon" aria-hidden="true">📎</span>
      <span className="passage-chip__body">
        {sectionTitle !== undefined && (
          <span className="passage-chip__section">{sectionTitle}</span>
        )}
        <span className="passage-chip__text">{displayText}</span>
      </span>
      <button
        type="button"
        className="passage-chip__dismiss"
        aria-label="Dismiss attached passage"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS at the bottom of `chat-panel.css`.**

```css
.passage-chip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  margin: var(--space-2) var(--space-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}

.passage-chip__icon {
  flex-shrink: 0;
}

.passage-chip__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.passage-chip__section {
  font-weight: 500;
  color: var(--color-text-secondary);
}

.passage-chip__text {
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passage-chip__dismiss {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: var(--space-1);
  color: var(--color-text-secondary);
  border-radius: var(--radius-xs);
}

.passage-chip__dismiss:hover {
  background: var(--color-surface-hover);
}

.passage-chip__dismiss:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run the tests.**

```bash
pnpm test src/features/ai/chat/PassageChip.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/ai/chat/PassageChip.tsx src/features/ai/chat/PassageChip.test.tsx src/features/ai/chat/chat-panel.css
git commit -m "feat(chat): PassageChip — sticky chip with dismiss + replace"
```

---

## Task 10: `ChatPanel` — wire `attachedPassage`, render chip, clear on thread switch

**Spec refs:** §8.4, §13 commit 10.

**Files:**
- Modify: `src/features/ai/chat/ChatPanel.tsx` — add props, mount chip, wrap thread switch
- Test: `src/features/ai/chat/ChatPanel.test.tsx` (create if missing) — chip integration tests

- [ ] **Step 1: Write failing tests.**

Create or extend `src/features/ai/chat/ChatPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel';
// ...stub repos / state

describe('ChatPanel passage chip', () => {
  it('renders PassageChip when attachedPassage is non-null', () => {
    render(
      <ChatPanel
        {...baseProps}
        attachedPassage={{
          anchor: { kind: 'epub-cfi', cfi: '/abc' },
          text: 'selection text',
          sectionTitle: 'Chapter 1',
        }}
        onClearAttachedPassage={vi.fn()}
      />,
    );
    expect(screen.getByRole('status', { name: /attached passage/i })).toBeInTheDocument();
  });

  it('does not render PassageChip when attachedPassage is null', () => {
    render(
      <ChatPanel
        {...baseProps}
        attachedPassage={null}
        onClearAttachedPassage={vi.fn()}
      />,
    );
    expect(screen.queryByRole('status', { name: /attached passage/i })).not.toBeInTheDocument();
  });

  it('clicking ✕ on the chip calls onClearAttachedPassage', async () => {
    const onClear = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        attachedPassage={{
          anchor: { kind: 'epub-cfi', cfi: '/abc' },
          text: 'sel',
        }}
        onClearAttachedPassage={onClear}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('calls onClearAttachedPassage when user switches thread', async () => {
    // Mount with multiple threads, click another thread in ThreadList.
    // Expect onClearAttachedPassage to fire.
  });
});
```

> **Engineer note:** check whether `ChatPanel.test.tsx` already exists from Phase 4.3. If not, create it and use the same stub-repo pattern as `ReaderWorkspace.test.tsx` (search for `createStubRepo` or similar).

- [ ] **Step 2: Run the failing tests.**

```bash
pnpm test src/features/ai/chat/ChatPanel.test.tsx
```

Expected: FAIL — props not defined.

- [ ] **Step 3: Extend `ChatPanel.tsx`.**

In `src/features/ai/chat/ChatPanel.tsx` around lines 30–43:

```ts
type Props = {
  // ...existing 4.3 props...
  readonly attachedPassage: AttachedPassage | null;
  readonly onClearAttachedPassage: () => void;
};
```

Import `AttachedPassage` and `PassageChip`:

```ts
import { PassageChip } from './PassageChip';
import type { AttachedPassage } from './useChatSend';
```

Pass `attachedPassage` to `useChatSend` (around line 76):

```ts
const send = useChatSend({
  // ...existing args...
  attachedPassage,
});
```

Mount `PassageChip` between the message list and the privacy preview (around line 170):

```tsx
{attachedPassage !== null && (
  <PassageChip
    text={attachedPassage.text}
    {...(attachedPassage.sectionTitle !== undefined && {
      sectionTitle: attachedPassage.sectionTitle,
    })}
    onDismiss={onClearAttachedPassage}
  />
)}
```

Wrap the thread-switch handler (around line 138) so it clears the chip:

```ts
const handleSelectThread = useCallback(
  (id: ChatThreadId) => {
    onClearAttachedPassage();
    threads.setActive(id);
  },
  [threads, onClearAttachedPassage],
);
```

Replace the existing `onSelectThread={threads.setActive}` with `onSelectThread={handleSelectThread}`.

- [ ] **Step 4: Run the tests.**

```bash
pnpm test src/features/ai/chat/ChatPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS — note: `ReaderWorkspace.tsx` will now have a type error because it constructs `ChatPanel` without the new props. Fix it provisionally by passing `attachedPassage={null}` and `onClearAttachedPassage={() => {}}` for now; the real wiring happens in Task 13.

- [ ] **Step 6: Commit.**

```bash
git add src/features/ai/chat/ChatPanel.tsx src/features/ai/chat/ChatPanel.test.tsx src/features/reader/workspace/ReaderWorkspace.tsx
git commit -m "feat(chat): ChatPanel — wire attachedPassage prop, render chip, clear on thread switch"
```

---

## Task 11: `MessageBubble` — source footer with jump-to-passage

**Spec refs:** §8.5, §13 commit 11.

**Files:**
- Modify: `src/features/ai/chat/MessageBubble.tsx` — add `onJumpToSource` prop + footer
- Modify: `src/features/ai/chat/MessageList.tsx` — thread `onJumpToSource` prop
- Modify: `src/features/ai/chat/chat-panel.css` — footer styling
- Test: `src/features/ai/chat/MessageBubble.test.tsx` — render + click cases

- [ ] **Step 1: Write failing tests.**

Append to `src/features/ai/chat/MessageBubble.test.tsx`:

```tsx
describe('source footer (passage mode)', () => {
  it('renders source footer when assistant message has a passage contextRef AND onJumpToSource is defined', () => {
    const passageAnchor = { kind: 'epub-cfi' as const, cfi: '/6/4' };
    render(
      <MessageBubble
        message={{
          ...assistantBase,
          contextRefs: [
            { kind: 'passage', text: 'she scarcely heard the rest', anchor: passageAnchor },
          ],
        }}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /jump to passage/i })).toBeInTheDocument();
    expect(screen.getByText(/she scarcely heard the rest/i)).toBeInTheDocument();
  });

  it('uses .find() not [0] — footer renders even when passage is not the first ref', () => {
    const passageAnchor = { kind: 'epub-cfi' as const, cfi: '/6/4' };
    render(
      <MessageBubble
        message={{
          ...assistantBase,
          contextRefs: [
            { kind: 'highlight', highlightId: 'h1' as HighlightId },
            { kind: 'passage', text: 'sel', anchor: passageAnchor },
          ],
        }}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /jump to passage/i })).toBeInTheDocument();
  });

  it('does NOT render footer when message is open-mode (no passage ref)', () => {
    render(
      <MessageBubble
        message={{ ...assistantBase, contextRefs: [] }}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /jump to passage/i })).not.toBeInTheDocument();
  });

  it('does NOT render footer when onJumpToSource is undefined', () => {
    const passageAnchor = { kind: 'epub-cfi' as const, cfi: '/6/4' };
    render(
      <MessageBubble
        message={{
          ...assistantBase,
          contextRefs: [{ kind: 'passage', text: 's', anchor: passageAnchor }],
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /jump to passage/i })).not.toBeInTheDocument();
  });

  it('does NOT render footer on user-role message (assistant only)', () => {
    const passageAnchor = { kind: 'epub-cfi' as const, cfi: '/6/4' };
    render(
      <MessageBubble
        message={{
          ...assistantBase,
          role: 'user',
          contextRefs: [{ kind: 'passage', text: 's', anchor: passageAnchor }],
        }}
        onJumpToSource={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /jump to passage/i })).not.toBeInTheDocument();
  });

  it('clicking the footer calls onJumpToSource with the matched ref\'s anchor', async () => {
    const onJumpToSource = vi.fn();
    const passageAnchor = { kind: 'epub-cfi' as const, cfi: '/6/4' };
    render(
      <MessageBubble
        message={{
          ...assistantBase,
          contextRefs: [{ kind: 'passage', text: 's', anchor: passageAnchor }],
        }}
        onJumpToSource={onJumpToSource}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /jump to passage/i }));
    expect(onJumpToSource).toHaveBeenCalledWith(passageAnchor);
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/ai/chat/MessageBubble.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Extend `MessageBubble.tsx`.**

After line 7, extend the props:

```ts
import type { HighlightAnchor } from '@/domain/annotations/types';

type Props = {
  readonly message: ChatMessage;
  readonly onSave?: (id: ChatMessageId) => void;
  readonly onJumpToSource?: (anchor: HighlightAnchor) => void;
};
```

In the assistant variant render (around line 32), before the existing footer metadata, add:

```tsx
{(() => {
  if (message.role !== 'assistant') return null;
  if (onJumpToSource === undefined) return null;
  const passageRef = message.contextRefs.find((r) => r.kind === 'passage');
  if (passageRef === undefined) return null;
  // Type narrowing — passageRef.kind === 'passage'
  const snippet = passageRef.text.length > 40
    ? passageRef.text.slice(0, 40) + '…'
    : passageRef.text;
  return (
    <button
      type="button"
      className="message-bubble__source-footer"
      aria-label={
        passageRef.sectionTitle !== undefined
          ? `Jump to passage from ${passageRef.sectionTitle}`
          : 'Jump to source'
      }
      onClick={() => onJumpToSource(passageRef.anchor)}
    >
      <span aria-hidden="true">📎</span>
      <span>Source: "{snippet}"</span>
      <span aria-hidden="true">→</span>
    </button>
  );
})()}
```

- [ ] **Step 4: Thread the prop through `MessageList.tsx`.**

In `src/features/ai/chat/MessageList.tsx` extend `Props`:

```ts
readonly onJumpToSource?: (anchor: HighlightAnchor) => void;
```

Around line 56 where `MessageBubble` is rendered, pass:

```tsx
<MessageBubble
  message={msg}
  {...(onSaveMessage !== undefined && { onSave: onSaveMessage })}
  {...(onJumpToSource !== undefined && { onJumpToSource })}
/>
```

- [ ] **Step 5: Add footer styling to `chat-panel.css`.**

```css
.message-bubble__source-footer {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  border-radius: var(--radius-xs);
  text-align: left;
}

.message-bubble__source-footer:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.message-bubble__source-footer:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

- [ ] **Step 6: Wire jump-to-source from `ChatPanel` through `MessageList` to `MessageBubble`.**

Naming convention used in this plan:
- `MessageBubble`: prop is `onJumpToSource: (anchor: HighlightAnchor) => void` (this is the message-level affordance — spec §8.5).
- `MessageList`: prop is `onJumpToSource` (passes through unchanged).
- `ChatPanel`: accepts a higher-level prop `onJumpToReaderAnchor: (anchor: HighlightAnchor) => void` and threads it down as `onJumpToSource` to `MessageList`. Distinct name at the ChatPanel boundary because that prop semantically means "ChatPanel knows how to navigate the reader" (later phases may also navigate from sources other than the message footer).

Add to `ChatPanel.tsx` `Props`:

```ts
readonly onJumpToReaderAnchor?: (anchor: HighlightAnchor) => void;
```

In `ChatPanel`'s render, pass through:

```tsx
<MessageList
  // ...existing props...
  {...(onJumpToReaderAnchor !== undefined && { onJumpToSource: onJumpToReaderAnchor })}
/>
```

`ReaderWorkspace` (in Task 13) will pass `onJumpToReaderAnchor={goToAnchor}` — using the existing `goToAnchor` it already has from the reader exposed state.

> **Engineer note:** confirm `ChatPanel` doesn't already have a similarly-named prop from a prior phase. If something like `onJumpToAnchor` exists, reuse that name instead of introducing `onJumpToReaderAnchor` — pick whichever is consistent with the rest of the chat module. The contract from `MessageBubble`'s perspective stays `onJumpToSource(anchor)` regardless.

- [ ] **Step 7: Run the tests.**

```bash
pnpm test src/features/ai/chat/MessageBubble.test.tsx src/features/ai/chat/MessageList.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add src/features/ai/chat/MessageBubble.tsx src/features/ai/chat/MessageList.tsx src/features/ai/chat/ChatPanel.tsx src/features/ai/chat/chat-panel.css src/features/ai/chat/MessageBubble.test.tsx
git commit -m "feat(chat): MessageBubble — source footer with jump-to-passage"
```

---

## Task 12: `PrivacyPreview` — attached-passage section

**Spec refs:** §8.6, §13 commit 12.

**Files:**
- Modify: `src/features/ai/chat/PrivacyPreview.tsx` — accept `attachedPassage` prop; conditionally render
- Modify: `src/features/ai/chat/ChatPanel.tsx` — pass prop
- Test: `src/features/ai/chat/PrivacyPreview.test.tsx` — add cases including snapshot equivalence

- [ ] **Step 1: Write failing tests.**

Append to `src/features/ai/chat/PrivacyPreview.test.tsx`:

```tsx
describe('attached passage', () => {
  const baseProps = {
    book: { title: 'Pride and Prejudice', author: 'Jane Austen' },
    modelId: 'gpt-x',
    historyCount: 0,
  };

  it('summary excludes passage line when attachedPassage is null', () => {
    render(<PrivacyPreview {...baseProps} attachedPassage={null} />);
    expect(screen.queryByText(/selected passage/i)).not.toBeInTheDocument();
  });

  it('summary includes section + selected-passage chunk count when attached', () => {
    render(
      <PrivacyPreview
        {...baseProps}
        attachedPassage={{
          anchor: { kind: 'epub-cfi', cfi: '/abc' },
          text: 'a'.repeat(340),
          sectionTitle: 'Chapter 4',
          windowBefore: 'before',
          windowAfter: 'after',
        }}
      />,
    );
    expect(screen.getByText(/chapter 4/i)).toBeInTheDocument();
    expect(screen.getByText(/selected passage \(~340 chars\)/i)).toBeInTheDocument();
  });

  it('expanded form contains an "Attached passage" subsection with the literal text + windows', async () => {
    render(
      <PrivacyPreview
        {...baseProps}
        attachedPassage={{
          anchor: { kind: 'epub-cfi', cfi: '/abc' },
          text: 'She scarcely heard the rest',
          sectionTitle: 'Chapter 4',
          windowBefore: 'the conversation drifted',
          windowAfter: 'the parlour quiet hum',
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /show what.*sent/i }));
    expect(screen.getByText(/attached passage/i)).toBeInTheDocument();
    expect(screen.getByText(/she scarcely heard the rest/i)).toBeInTheDocument();
    expect(screen.getByText(/the conversation drifted/i)).toBeInTheDocument();
    expect(screen.getByText(/the parlour quiet hum/i)).toBeInTheDocument();
  });

  it('expanded form is character-for-character equivalent to assemblePassageChatPrompt output', async () => {
    const passage = {
      anchor: { kind: 'epub-cfi' as const, cfi: '/abc' },
      text: 'sel',
      sectionTitle: 'Chapter 4',
      windowBefore: 'before',
      windowAfter: 'after',
    };
    const assembled = assemblePassageChatPrompt({
      book: { ...baseProps.book, format: 'epub' },
      history: [],
      newUserText: 'q',
      passage: {
        text: passage.text,
        sectionTitle: passage.sectionTitle,
        windowBefore: passage.windowBefore,
        windowAfter: passage.windowAfter,
      },
    });

    render(<PrivacyPreview {...baseProps} attachedPassage={passage} />);
    await userEvent.click(screen.getByRole('button', { name: /show what.*sent/i }));

    const lastUserMsg = assembled.messages[assembled.messages.length - 1].content;
    // The passage block (everything before the user's question) should appear verbatim
    // in the privacy preview.
    const passageBlockMatch = lastUserMsg.match(/^\[Passage[\s\S]*?(?=\n\n[^*])/);
    expect(passageBlockMatch).not.toBeNull();
    expect(screen.getByText(passageBlockMatch![0], { exact: false })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/ai/chat/PrivacyPreview.test.tsx
```

Expected: FAIL — `attachedPassage` prop not accepted.

- [ ] **Step 3: Extend `PrivacyPreview.tsx`.**

```ts
import type { AttachedPassage } from './useChatSend';
import { /* extract or re-export */ buildPassageBlockForPreview } from './promptAssembly';

type Props = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly modelId: string;
  readonly historyCount: number;
  readonly attachedPassage?: AttachedPassage | null;
};
```

> **Engineer note:** to keep the privacy-preview / assembly equivalence test passing without copy-paste, **extract** the passage-block builder into an exported function in `promptAssembly.ts`:
>
> ```ts
> // promptAssembly.ts
> export function buildPassageBlockForPreview(
>   bookTitle: string,
>   passage: AssemblePassageChatInput['passage'],
> ): string {
>   return buildPassageBlock(bookTitle, passage); // existing private function, now re-exported
> }
> ```
>
> The privacy preview consumes this same builder so they cannot drift.

Update the summary line (around line 12):

```tsx
const summaryParts = [
  `${book.title}${book.author !== undefined ? ` by ${book.author}` : ''}`,
];
if (attachedPassage !== null && attachedPassage !== undefined) {
  if (attachedPassage.sectionTitle !== undefined) {
    summaryParts.push(attachedPassage.sectionTitle);
  }
  summaryParts.push(`selected passage (~${attachedPassage.text.length} chars)`);
}
summaryParts.push('your messages');
const summary = summaryParts.join(' + ');
```

Add the expanded "Attached passage" subsection (between system prompt and messages-included around lines 29-37):

```tsx
{attachedPassage !== null && attachedPassage !== undefined && (
  <section className="privacy-preview__section">
    <h3>Attached passage</h3>
    <pre className="privacy-preview__block">
      {buildPassageBlockForPreview(book.title, {
        text: attachedPassage.text,
        ...(attachedPassage.sectionTitle !== undefined && {
          sectionTitle: attachedPassage.sectionTitle,
        }),
        ...(attachedPassage.windowBefore !== undefined && {
          windowBefore: attachedPassage.windowBefore,
        }),
        ...(attachedPassage.windowAfter !== undefined && {
          windowAfter: attachedPassage.windowAfter,
        }),
      })}
    </pre>
  </section>
)}
```

- [ ] **Step 4: Pass `attachedPassage` from `ChatPanel` to `PrivacyPreview`.**

In `ChatPanel.tsx`, where `PrivacyPreview` is rendered:

```tsx
<PrivacyPreview
  book={book}
  modelId={selectedModelId ?? ''}
  historyCount={messages.length}
  attachedPassage={attachedPassage}
/>
```

- [ ] **Step 5: Run the tests.**

```bash
pnpm test src/features/ai/chat/PrivacyPreview.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/ai/chat/PrivacyPreview.tsx src/features/ai/chat/PrivacyPreview.test.tsx src/features/ai/chat/ChatPanel.tsx src/features/ai/chat/promptAssembly.ts
git commit -m "feat(chat): PrivacyPreview — attached-passage section"
```

---

## Task 13: `ReaderWorkspace` — selection bridge + auto-expand rail + mobile auto-switch

**Spec refs:** §8.7, §8.8, §13 commit 13.

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx` — state + handler + props wiring
- Test: `src/features/reader/workspace/ReaderWorkspace.test.tsx` — selection bridge cases

- [ ] **Step 1: Write failing tests.**

Append to `src/features/reader/workspace/ReaderWorkspace.test.tsx`:

```tsx
describe('passage-mode selection bridge', () => {
  it('clicking Ask AI in HighlightToolbar materializes attachedPassage and auto-expands the rail (desktop)', async () => {
    // ...mount with stub readerState whose getPassageContextAt returns a fixture
    // Trigger selection, click "Ask AI"
    // Assert: rail is now visible, chip is displayed in chat panel
  });

  it('canAskAI is true only when api-key state is session/unlocked AND a model is selected', () => {
    // Render with apiKeyState = locked → "Ask AI" not visible on toolbar
    // Render with apiKeyState = session, no model → not visible
    // Render with apiKeyState = session, model selected → visible
  });

  it('on mobile, Ask AI opens the sheet, switches to chat tab, and focuses the composer', async () => {
    // ...mock viewport = mobile
    // Click Ask AI → sheet opens → activeRailTab === 'chat' → composer has focus
  });

  it('falls back to {text} only when getPassageContextAt throws', async () => {
    // Stub readerState.getPassageContextAt to throw
    // Click Ask AI
    // Expect attachedPassage.text === selection text, no windows
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/reader/workspace/ReaderWorkspace.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Extend `RailTabKey` type.**

In `ReaderWorkspace.tsx` around line 116:

```ts
type RailTabKey = 'contents' | 'bookmarks' | 'highlights' | 'chat';
```

- [ ] **Step 4: Add state + ref.**

After line 150:

```ts
const [attachedPassage, setAttachedPassage] = useState<AttachedPassage | null>(null);
const pendingFocusRef = useRef<boolean>(false);
```

Import `AttachedPassage`:

```ts
import type { AttachedPassage } from '../../ai/chat/useChatSend';
```

- [ ] **Step 5: Compute `canAskAI`.**

In the body of `ReaderWorkspace` (near where api-key + model are read):

```ts
const canAskAI =
  (apiKeyState.kind === 'session' || apiKeyState.kind === 'unlocked') &&
  selectedModelId !== null &&
  selectedModelId !== '';
```

- [ ] **Step 6: Add `handleAskAI` callback.**

Near the existing toolbar handlers (around line 220):

```ts
const handleAskAI = useCallback(
  async (anchor: HighlightAnchor, selectedText: string) => {
    if (!readerState) return;
    let extracted: { text: string; windowBefore?: string; windowAfter?: string; sectionTitle?: string };
    try {
      extracted = await readerState.getPassageContextAt(anchor);
    } catch (err) {
      console.warn('[passage-mode] context extraction failed; using selection only', err);
      extracted = { text: selectedText };
    }
    const passage: AttachedPassage = {
      anchor,
      text: extracted.text || selectedText,
      ...(extracted.windowBefore !== undefined && { windowBefore: extracted.windowBefore }),
      ...(extracted.windowAfter !== undefined && { windowAfter: extracted.windowAfter }),
      ...(extracted.sectionTitle !== undefined && { sectionTitle: extracted.sectionTitle }),
    };
    setAttachedPassage(passage);
    if (isDesktop) {
      if (!rightRail.visible) rightRail.set(true);
    } else {
      // Open mobile sheet (use whatever existing function opens it for the TOC button)
      setActiveSheet('toc'); // or the equivalent "open" trigger
      setActiveRailTab('chat');
    }
    pendingFocusRef.current = true;
    setActiveToolbar(null); // dismiss
  },
  [readerState, isDesktop, rightRail, setActiveSheet, setActiveRailTab],
);
```

> **Engineer note:** the mobile-sheet open mechanism in 4.3 might be a single setter (`setActiveSheet('toc')`) — verify how the TOC button opens it. If a more direct "open sheet" setter exists (`setSheetOpen(true)`), use that. The point is: after this handler runs, the sheet should be visible and the active tab should be 'chat'.

- [ ] **Step 7: Add chat to `sheetTabs`.**

Around line 349:

```ts
const sheetTabs: readonly SheetTab[] = [
  { key: 'contents', label: 'Contents' },
  { key: 'bookmarks', label: 'Bookmarks', badge: bookmarks.list.length },
  { key: 'highlights', label: 'Highlights', badge: highlights.list.length },
  { key: 'chat', label: 'Chat' },
];
```

- [ ] **Step 8: Mount `ChatPanel` when `activeRailTab === 'chat'`.**

First, extend `ChatPanel.tsx` `Props` (in this task — Task 10's edits didn't add these):

```ts
type Props = {
  // ...existing 4.3 + Task 10 props...
  readonly onJumpToReaderAnchor?: (anchor: HighlightAnchor) => void;
  readonly composerFocusRef?: { current: boolean };
};
```

Add a `useEffect` in `ChatPanel` that runs on mount and on `composerFocusRef` change:

```ts
useEffect(() => {
  if (composerFocusRef?.current === true) {
    composerFocusRef.current = false;
    composerTextareaRef.current?.focus();
  }
}, [composerFocusRef]);
```

> **Engineer note:** `composerTextareaRef` should be a ref already used by `ChatComposer` for its own focus management. If `ChatComposer` doesn't expose a ref, extend it: forward a ref to its underlying textarea via `forwardRef` or accept a `textareaRef` prop. Reuse rather than re-invent.

Then in the rail body switch (likely around lines 325–339 for desktop, and similar for mobile sheet body):

```tsx
{activeRailTab === 'chat' && (
  <ChatPanel
    bookId={book.id}
    book={{ title: book.title, author: book.author, format: book.format }}
    apiKeyState={apiKeyState}
    getApiKey={getApiKey}
    selectedModelId={selectedModelId}
    threadsRepo={chatThreadsRepo}
    messagesRepo={chatMessagesRepo}
    savedAnswersRepo={savedAnswersRepo}
    onOpenSettings={onOpenSettings}
    onCollapse={() => rightRail.set(false)}
    hintShown={hintShown}
    onHintDismiss={dismissHint}
    attachedPassage={attachedPassage}
    onClearAttachedPassage={() => setAttachedPassage(null)}
    onJumpToReaderAnchor={(anchor) => goToAnchor(anchor)}
    composerFocusRef={pendingFocusRef}
  />
)}
```

- [ ] **Step 9: Wire `onAskAI` + `canAskAI` to `HighlightToolbar`.**

Where `HighlightToolbar` is rendered (around line 399+), add:

```tsx
<HighlightToolbar
  // ...existing props...
  {...(canAskAI && {
    canAskAI: true,
    onAskAI: () => handleAskAI(currentSelectionAnchor, currentSelectionText),
  })}
/>
```

The actual wiring depends on how the existing toolbar handlers know the current selection's anchor + text — check the existing `handleHighlightCreate` for the pattern.

- [ ] **Step 10: Run the tests.**

```bash
pnpm test src/features/reader/workspace/ReaderWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 12: Commit.**

```bash
git add src/features/reader/workspace/ReaderWorkspace.tsx src/features/reader/workspace/ReaderWorkspace.test.tsx src/features/ai/chat/ChatPanel.tsx
git commit -m "feat(reader): ReaderWorkspace — selection bridge + auto-expand rail + mobile auto-switch"
```

---

## Task 14: `MobileSheet` chat tab — wire `ChatPanel` as 4th tab

**Spec refs:** §8.7, §13 commit 14.

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx` — confirm sheet body switches on `'chat'` tab
- Test: `src/features/reader/workspace/ReaderWorkspace.test.tsx` — mobile-sheet integration tests

> **Note:** `MobileSheet.tsx` itself doesn't change (it's a thin wrapper); the wiring lives in `ReaderWorkspace.tsx`. This task is largely a **verification task** that the work in Task 13 covers the mobile case end-to-end and adds explicit mobile tests.

- [ ] **Step 1: Write failing mobile-specific tests.**

In `ReaderWorkspace.test.tsx`:

```tsx
describe('mobile sheet chat tab', () => {
  it('chat is the 4th tab in the sheet', () => {
    // Render in mobile viewport
    // Open sheet
    // Assert tabs: contents, bookmarks, highlights, chat
  });

  it('mounts ChatPanel only when chat tab is active', async () => {
    // Switch tabs, assert ChatPanel only rendered when active
  });

  it('switching away from chat tab unmounts ChatPanel and cancels in-flight stream cleanly', async () => {
    // Start a send; switch tab; assert: useChatSend cleanup runs, no warnings
  });

  it('dismissing the sheet unmounts the ChatPanel', async () => {
    // Open sheet → chat tab → dismiss → assert ChatPanel not in DOM
  });

  it('after Ask AI on mobile, the composer is focused on next mount', async () => {
    // Click Ask AI from selection → sheet opens → chat tab active → composer.focus() called
  });
});
```

- [ ] **Step 2: Verify the Task 13 implementation handles all of the above.**

Run:

```bash
pnpm test src/features/reader/workspace/ReaderWorkspace.test.tsx
```

Expected: ideally PASS (Task 13 should have covered most of this). If anything fails, fix in this task.

- [ ] **Step 3: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit (even if no production code changed — the test additions lock the contract).**

```bash
git add src/features/reader/workspace/ReaderWorkspace.test.tsx src/features/reader/workspace/ReaderWorkspace.tsx
git commit -m "feat(reader): MobileSheet chat tab — wire ChatPanel as 4th tab"
```

> **Note:** if Task 13's implementation diff already ships the chat tab and Task 14's test additions are included, this commit may overlap with Task 13. In that case, fold the test additions into Task 13's commit and skip this task. Decision is at the executing engineer's discretion based on the actual state of the diff after Task 13.

---

## Task 15: Notebook saved-answer Jump-to-passage

**Spec refs:** §8.9, §13 commit 15.

**Files:**
- Modify: `src/features/annotations/notebook/NotebookRow.tsx` — add jump button to `'savedAnswer'` variant
- Test: `src/features/annotations/notebook/NotebookRow.test.tsx` — add cases

- [ ] **Step 1: Write failing tests.**

Append to `src/features/annotations/notebook/NotebookRow.test.tsx`:

```tsx
describe('savedAnswer Jump to passage', () => {
  const passageAnchor = { kind: 'epub-cfi' as const, cfi: '/6/4' };

  it('shows Jump-to-passage button when contextRefs has a passage with anchor', () => {
    render(
      <NotebookRow
        entry={{
          kind: 'savedAnswer',
          savedAnswer: makeSavedAnswer({
            contextRefs: [{ kind: 'passage', text: 's', anchor: passageAnchor }],
          }),
        }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByRole('button', { name: /jump to passage/i })).toBeInTheDocument();
  });

  it('hides the button for 4.3 saved answers (no passage refs — pure backward compat)', () => {
    render(
      <NotebookRow
        entry={{
          kind: 'savedAnswer',
          savedAnswer: makeSavedAnswer({ contextRefs: [] }),
        }}
        {...defaultHandlers}
      />,
    );
    expect(screen.queryByRole('button', { name: /jump to passage/i })).not.toBeInTheDocument();
  });

  it('clicking the button calls onJumpToAnchor with the passage anchor', async () => {
    const onJumpToAnchor = vi.fn();
    render(
      <NotebookRow
        entry={{
          kind: 'savedAnswer',
          savedAnswer: makeSavedAnswer({
            contextRefs: [{ kind: 'passage', text: 's', anchor: passageAnchor }],
          }),
        }}
        {...defaultHandlers}
        onJumpToAnchor={onJumpToAnchor}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /jump to passage/i }));
    expect(onJumpToAnchor).toHaveBeenCalledWith(passageAnchor);
  });

  it('uses .find() — works when passage is not the first contextRef', () => {
    render(
      <NotebookRow
        entry={{
          kind: 'savedAnswer',
          savedAnswer: makeSavedAnswer({
            contextRefs: [
              { kind: 'highlight', highlightId: 'h1' as HighlightId },
              { kind: 'passage', text: 's', anchor: passageAnchor },
            ],
          }),
        }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByRole('button', { name: /jump to passage/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing tests.**

```bash
pnpm test src/features/annotations/notebook/NotebookRow.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Extend the savedAnswer variant rendering.**

In `src/features/annotations/notebook/NotebookRow.tsx`, inside the savedAnswer variant render (lines 40–84), after the existing answer button:

```tsx
{(() => {
  const passageRef = entry.savedAnswer.contextRefs.find((r) => r.kind === 'passage');
  if (passageRef === undefined) return null;
  return (
    <button
      type="button"
      className="notebook-row__jump-button"
      aria-label="Jump to passage in book"
      onClick={() => onJumpToAnchor(passageRef.anchor as LocationAnchor)}
    >
      Jump to passage
    </button>
  );
})()}
```

> **Engineer note:** `HighlightAnchor` is a structural subset/superset of `LocationAnchor` depending on the project. Verify the cast is sound — both `epub-cfi` and `pdf` variants exist in both unions. If the unions are identical, drop the `as` cast. If `LocationAnchor` is wider, the cast widens safely. If narrower, you may need a small adapter. Look at how `Bookmark.anchor: LocationAnchor` interacts with `HighlightAnchor` elsewhere — there's likely already a precedent.

- [ ] **Step 4: Run the tests.**

```bash
pnpm test src/features/annotations/notebook/NotebookRow.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run full check.**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/annotations/notebook/NotebookRow.tsx src/features/annotations/notebook/NotebookRow.test.tsx
git commit -m "feat(notebook): savedAnswer Jump-to-passage when contextRefs has passage anchor"
```

---

## Task 16: E2E — passage mode (desktop, mobile, notebook jump-back)

**Spec refs:** §11.3, §13 commit 16.

**Files:**
- Create: `e2e/chat-passage-mode-desktop.spec.ts`
- Create: `e2e/chat-passage-mode-mobile.spec.ts`
- Create: `e2e/chat-passage-mode-jump-from-notebook.spec.ts`
- Modify: `e2e/chat-panel-empty-states.spec.ts` — extend with Ask AI visibility cases

- [ ] **Step 1: Write `chat-passage-mode-desktop.spec.ts`.**

Create:

```ts
import { test, expect } from '@playwright/test';
import { importFixture, openImportedBook, configureMockApiKey, configureSelectedModel, mockChatStream } from './helpers';

test.describe('chat passage mode (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await importFixture(page, 'pride-and-prejudice.epub');
    await openImportedBook(page);
    await configureMockApiKey(page);
    await configureSelectedModel(page, 'mock-model');
  });

  test('select → Ask AI → chip appears → composer focused → send → assistant has source footer → click jumps to anchor', async ({ page }) => {
    // 1. Select text in the reader
    await selectTextInReader(page, /* selector or coordinates of fixture text */);

    // 2. Highlight toolbar appears
    await expect(page.getByRole('button', { name: /ask ai/i })).toBeVisible();

    // 3. Click Ask AI
    await page.getByRole('button', { name: /ask ai/i }).click();

    // 4. Right rail expands; chat panel mounted
    await expect(page.getByRole('status', { name: /attached passage/i })).toBeVisible();

    // 5. Composer has focus
    const composer = page.getByRole('textbox', { name: /ask about/i });
    await expect(composer).toBeFocused();

    // 6. Send a question with mocked stream
    await mockChatStream(page, 'This passage shows tension.');
    await composer.fill('What is happening here?');
    await composer.press('Enter');

    // 7. Assistant message appears with source footer
    await expect(page.getByRole('button', { name: /jump to passage/i })).toBeVisible();

    // 8. Click source footer → reader navigates to the anchor
    const initialAnchor = await readCurrentAnchor(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /jump to passage/i }).click();
    const newAnchor = await readCurrentAnchor(page);
    expect(newAnchor).toEqual(initialAnchor);
  });

  test('rail collapsed → Ask AI auto-expands the rail', async ({ page }) => {
    await collapseRightRail(page);
    await selectTextInReader(page);
    await page.getByRole('button', { name: /ask ai/i }).click();
    await expect(page.getByTestId('right-rail')).toBeVisible();
  });

  test('chip is sticky across sends and replaced on re-select', async ({ page }) => {
    await selectTextInReader(page, 'first selection');
    await page.getByRole('button', { name: /ask ai/i }).click();
    await mockChatStream(page, 'answer 1');
    await page.getByRole('textbox', { name: /ask about/i }).fill('q1');
    await page.getByRole('textbox', { name: /ask about/i }).press('Enter');

    // Chip still present
    await expect(page.getByRole('status', { name: /attached passage/i })).toBeVisible();
    await expect(page.getByText(/first selection/)).toBeVisible();

    // Re-select different text → click Ask AI → chip replaced
    await selectTextInReader(page, 'second selection');
    await page.getByRole('button', { name: /ask ai/i }).click();
    await expect(page.getByText(/second selection/)).toBeVisible();
    await expect(page.getByText(/first selection/)).not.toBeVisible();
  });
});
```

> **Engineer note:** the helpers `selectTextInReader`, `mockChatStream`, `readCurrentAnchor`, `collapseRightRail` may need to be added to `e2e/helpers.ts`. Check existing e2e specs (highlight tests, chat-panel-empty-states) for the closest precedent and reuse / extend.

- [ ] **Step 2: Write `chat-passage-mode-mobile.spec.ts`.**

```ts
import { test, expect, devices } from '@playwright/test';
import { importFixture, openImportedBook, configureMockApiKey, configureSelectedModel, mockChatStream, selectTextInReader } from './helpers';

test.use({ ...devices['iPhone 13'] });

test.describe('chat passage mode (mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await importFixture(page, 'pride-and-prejudice.epub');
    await openImportedBook(page);
    await configureMockApiKey(page);
    await configureSelectedModel(page, 'mock-model');
  });

  test('select → Ask AI → mobile sheet opens to chat tab → send → answer arrives → close + reopen preserves the answer', async ({ page }) => {
    await selectTextInReader(page);
    await page.getByRole('button', { name: /ask ai/i }).click();

    // Sheet open + chat tab active + chip visible
    await expect(page.getByRole('tab', { name: /chat/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('status', { name: /attached passage/i })).toBeVisible();

    // Send
    await mockChatStream(page, 'answer text');
    const composer = page.getByRole('textbox', { name: /ask about/i });
    await composer.fill('what?');
    await composer.press('Enter');
    await expect(page.getByText('answer text')).toBeVisible();

    // Close sheet + reopen + go back to chat tab — answer + chip preserved across remount
    await dismissSheet(page);
    await openSheet(page);
    await page.getByRole('tab', { name: /chat/i }).click();
    await expect(page.getByText('answer text')).toBeVisible();
    // Chip is transient — it should NOT survive sheet dismissal (intended; spec §14)
  });
});
```

- [ ] **Step 3: Write `chat-passage-mode-jump-from-notebook.spec.ts`.**

```ts
import { test, expect } from '@playwright/test';
import { importFixture, openImportedBook, configureMockApiKey, configureSelectedModel, mockChatStream, selectTextInReader, openNotebook, readCurrentAnchor } from './helpers';

test.describe('passage mode → save → notebook jump-back', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await importFixture(page, 'pride-and-prejudice.epub');
    await openImportedBook(page);
    await configureMockApiKey(page);
    await configureSelectedModel(page, 'mock-model');
  });

  test('save passage answer → open notebook → AI answers filter → Jump to passage → reader opens at anchor', async ({ page }) => {
    // Select + Ask AI + send
    await selectTextInReader(page);
    await page.getByRole('button', { name: /ask ai/i }).click();
    await mockChatStream(page, 'answer text');
    await page.getByRole('textbox', { name: /ask about/i }).fill('q');
    await page.getByRole('textbox', { name: /ask about/i }).press('Enter');

    // Save
    await page.getByRole('button', { name: /save answer/i }).click();
    await page.getByRole('textbox', { name: /note/i }).fill('my note');
    await page.getByRole('button', { name: /save/i }).click();

    // Capture original anchor for comparison
    const originalAnchor = await readCurrentAnchor(page);

    // Navigate elsewhere
    await page.evaluate(() => window.scrollTo(0, 9999));

    // Open notebook → AI answers filter
    await openNotebook(page);
    await page.getByRole('button', { name: /ai answers/i }).click();

    // Click Jump to passage
    await page.getByRole('button', { name: /jump to passage/i }).click();

    // Verify reader opened at anchor
    const newAnchor = await readCurrentAnchor(page);
    expect(newAnchor).toEqual(originalAnchor);
  });
});
```

- [ ] **Step 4: Extend `chat-panel-empty-states.spec.ts`.**

Append:

```ts
test.describe('Ask AI visibility under empty states', () => {
  test('Ask AI button hidden when no API key is configured', async ({ page }) => {
    await page.goto('/');
    await importFixture(page, 'pride-and-prejudice.epub');
    await openImportedBook(page);
    // No api key set
    await selectTextInReader(page);
    await expect(page.getByRole('button', { name: /ask ai/i })).not.toBeVisible();
  });

  test('Ask AI button hidden when no model is selected', async ({ page }) => {
    await page.goto('/');
    await importFixture(page, 'pride-and-prejudice.epub');
    await openImportedBook(page);
    await configureMockApiKey(page);
    // No model set
    await selectTextInReader(page);
    await expect(page.getByRole('button', { name: /ask ai/i })).not.toBeVisible();
  });

  test('Ask AI button visible when both key and model are configured', async ({ page }) => {
    await page.goto('/');
    await importFixture(page, 'pride-and-prejudice.epub');
    await openImportedBook(page);
    await configureMockApiKey(page);
    await configureSelectedModel(page, 'mock-model');
    await selectTextInReader(page);
    await expect(page.getByRole('button', { name: /ask ai/i })).toBeVisible();
  });
});
```

- [ ] **Step 5: Run all e2e specs.**

```bash
pnpm test:e2e
```

Expected: PASS for all new specs and prior suites.

- [ ] **Step 6: Run full check (just to confirm no Vitest fallout).**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add e2e/chat-passage-mode-desktop.spec.ts e2e/chat-passage-mode-mobile.spec.ts e2e/chat-passage-mode-jump-from-notebook.spec.ts e2e/chat-panel-empty-states.spec.ts e2e/helpers.ts
git commit -m "test(e2e): passage mode — desktop + mobile + notebook jump-back"
```

---

## Task 17: Docs — architecture decision + roadmap status

**Spec refs:** §1, §13 commit 17, §16.

**Files:**
- Modify: `docs/04-implementation-roadmap.md` — Phase 4.4 status block
- Modify: `docs/02-system-architecture.md` — decision-history entry

- [ ] **Step 1: Update roadmap status.**

In `docs/04-implementation-roadmap.md`, find the Phase 4.4 entry and update its status block to:

```
**Phase 4.4 — complete (2026-05-06)**
Passage mode: "Ask AI" on selection materializes a sticky chip; assemblePassageChatPrompt produces a single combined system message + passage block; assistant bubbles carry source-footer jump-back; mobile chat lives in a 4th sheet tab; notebook saved-answer rows expose Jump to passage when contextRefs include a passage anchor.
```

Replace `2026-05-06` with the actual completion date if different.

- [ ] **Step 2: Add decision-history entry.**

In `docs/02-system-architecture.md`, append to the decision-history section:

```markdown
### 2026-05-06 — Phase 4.4 — Passage mode

- **ContextRef.passage extended** with required `anchor: HighlightAnchor` (the product invariant "response links back to source" is now type-enforced) and optional `windowBefore`/`windowAfter`/`sectionTitle`.
- **Single combined system message** in `assemblePassageChatPrompt` — open-mode prompt + `\n\n` + passage addendum — chosen over two adjacent system messages for cross-upstream parity (NanoGPT proxies multiple providers, some of which collapse adjacent systems anyway).
- **Asymmetric `contextRefs` persistence** — `mode: 'passage'` on both user + assistant messages of a turn (keeps history scan symmetric); `contextRefs` populated only on the assistant message (avoids ~5KB of dead duplicate per question).
- **Auto-highlight on Ask AI: rejected** — chip stays transient; selection materializes via state, not via creating a Highlight record. Keeps "user notes vs AI side effects" boundary clean for Phase 5+ multi-excerpt mode.
- **Mobile chat as 4th sheet tab** — fulfills the 4.3 commitment ("chat-on-mobile lands when 4.4 adds passage-mode UX"). Tab unmount cancels in-flight streams cleanly via existing `useChatSend` cleanup; chosen over keep-mounted-by-transform for simpler semantics.
- **PDF first-match-wins documented limitation** — when the selected text appears multiple times on the page, the first string match wins for window extraction. Anchor (and therefore jump-back) is unaffected. `// TODO(passage-y-bias)` marker in the adapter for the future enhancement (bias toward rect-mean y).
```

- [ ] **Step 3: Commit.**

```bash
git add docs/04-implementation-roadmap.md docs/02-system-architecture.md
git commit -m "docs: Phase 4.4 — architecture decision + roadmap status complete"
```

- [ ] **Step 4: Verify final state.**

```bash
git log --oneline main..HEAD
pnpm check
pnpm test:e2e
```

Expected:
- 17 commits on the branch from the spec onward (1 spec commit + 17 implementation commits — or the spec edits committed as a follow-up + 17 impl).
- `pnpm check` PASS.
- `pnpm test:e2e` PASS.

---

## Validation checklist (run before declaring Phase 4.4 complete)

Mirrors spec §16:

- [ ] All 17 commits land green; `pnpm check` clean at each.
- [ ] `pnpm test:e2e` passes the new chat-passage-mode suite plus all prior suites.
- [ ] **Manual smoke (desktop):** select text → "Ask AI" → chip appears → composer focused → send (real or mocked NanoGPT) → assistant bubble has source footer → click source → reader navigates to anchor; rail collapsed → "Ask AI" auto-expands.
- [ ] **Manual smoke (mobile):** DevTools mobile viewport (real device preferred) → select → "Ask AI" → mobile sheet opens to chat tab with chip → send → answer arrives → close sheet → reopen → answer preserved (chip is transient — that's intended).
- [ ] **Notebook smoke:** passage answer → save with note → notebook → "AI answers" filter → "Jump to passage" → reader opens at correct anchor.
- [ ] Privacy preview snapshot test confirms `PrivacyPreview` content equals `assemblePassageChatPrompt` output for a given passage.
- [ ] `docs/04-implementation-roadmap.md` Status block updated.
- [ ] `docs/02-system-architecture.md` decision-history entry added.
- [ ] No `any` introductions; no `eslint-disable` outside the existing locked exceptions.
- [ ] File / function size warnings respected (per `06-quality-strategy.md`).
- [ ] Self-review scorecard complete per `docs/08-agent-self-improvement.md` — minimum **22/27** for this risky/core task.
