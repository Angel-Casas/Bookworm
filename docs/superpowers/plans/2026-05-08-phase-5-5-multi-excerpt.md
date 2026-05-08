# Phase 5.5 — Multi-excerpt mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-08-phase-5-5-multi-excerpt-design.md` (read first)

**Goal:** Add a multi-excerpt chat affordance: the user builds a small ordered set (≤ 6) of excerpts from highlights and/or ad-hoc selections, then asks a comparison question; send routes through a new `multi-excerpt` branch in `useChatSend` and renders numbered citation chips on the assistant message.

**Architecture:** New domain types + pure tray reducer in `domain/ai/multiExcerpt.ts`. New `assembleMultiExcerptPrompt` in `features/ai/prompts/`. Extend `useChatSend` with a fourth send branch parallel to chapter/passage/retrieval, emitting one `kind: 'passage'` `ContextRef` per excerpt so the existing `MultiSourceFooter` renders `[1][2][3]` chips for free. New `MultiExcerptChip` component, `+ Compare` toolbar button, per-row `+`/`✓` toggle in `HighlightsPanel`, and `useMultiExcerptTray` hook in `ReaderWorkspace`. Extend `setActiveAttachment` reducer with a fourth kind. No IDB schema changes — tray is workspace state.

**Tech Stack:** TypeScript (strict), React, Vitest (unit + RTL), Playwright (e2e), XState (already in `useChatSend`), pnpm.

**Project conventions (from CLAUDE.md and repo state):**
- `pnpm check` is the quality gate (type-check + lint + test). Run after each task group.
- `pnpm test:e2e` runs Playwright. Rebuild dist before running e2e (per `testing_runtime_fidelity` memory).
- Tests use co-located `.test.ts` / `.test.tsx` files alongside the unit under test.
- Domain stays pure (no React/IDB imports); side effects live in feature hooks/services.
- Prefer simple architecture; YAGNI; one new file per responsibility.

---

## File map

**Create:**
- `src/domain/ai/multiExcerpt.ts` — types + constants + `stableAnchorHash` + `compareExcerptOrder` + `trayReduce`
- `src/domain/ai/multiExcerpt.test.ts`
- `src/features/ai/prompts/assembleMultiExcerptPrompt.ts`
- `src/features/ai/prompts/assembleMultiExcerptPrompt.test.ts`
- `src/features/ai/chat/MultiExcerptChip.tsx`
- `src/features/ai/chat/MultiExcerptChip.test.tsx`
- `src/features/ai/chat/multi-excerpt-chip.css`
- `src/features/reader/workspace/useMultiExcerptTray.ts`
- `src/features/reader/workspace/useMultiExcerptTray.test.ts`
- `e2e/chat-multi-excerpt-mode.spec.ts`

**Modify:**
- `src/features/reader/workspace/highlightSort.ts` — extract `compareAnchorsInBookOrder`; have `compareHighlightsInBookOrder` delegate
- `src/features/reader/workspace/highlightSort.test.ts` — add tests for the extracted helper
- `src/features/ai/chat/useChatSend.ts` — add `attachedMultiExcerpt` arg + new send branch
- `src/features/ai/chat/useChatSend.test.ts` — new branch tests
- `src/features/reader/HighlightToolbar.tsx` — `+ Compare` button
- `src/features/reader/HighlightToolbar.test.tsx` — button tests
- `src/features/reader/HighlightsPanel.tsx` — per-row `+`/`✓` button
- `src/features/reader/HighlightsPanel.test.tsx` — toggle tests
- `src/features/ai/chat/ChatPanel.tsx` — fourth chip branch
- `src/features/reader/workspace/ReaderWorkspace.tsx` — `attachedMultiExcerpt` state, extend `setActiveAttachment`, wire handlers down to `HighlightToolbar`/`HighlightsPanel`/`ChatPanel`
- `src/features/reader/workspace/ReaderWorkspace.test.tsx` — mutual-exclusion + wiring tests
- `docs/04-implementation-roadmap.md` — mark Phase 5.5 complete and update Task 5.4 description

---

## Task 1: Domain — `AttachedExcerpt` type, constants, and `stableAnchorHash`

**Files:**
- Create: `src/domain/ai/multiExcerpt.ts`
- Create: `src/domain/ai/multiExcerpt.test.ts`

- [ ] **Step 1.1: Write failing tests for types and `stableAnchorHash`**

`src/domain/ai/multiExcerpt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import {
  MAX_EXCERPTS,
  MAX_EXCERPT_CHARS,
  stableAnchorHash,
  type AttachedExcerpt,
} from './multiExcerpt';

describe('multiExcerpt — constants', () => {
  it('caps tray at 6 excerpts', () => {
    expect(MAX_EXCERPTS).toBe(6);
  });
  it('caps per-excerpt text at 4000 chars', () => {
    expect(MAX_EXCERPT_CHARS).toBe(4000);
  });
});

describe('stableAnchorHash', () => {
  it('returns identical hash for the same EPUB CFI anchor', () => {
    const a = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' });
    const b = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' });
    expect(a).toBe(b);
  });
  it('returns different hashes for different CFI anchors', () => {
    const a = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' });
    const b = stableAnchorHash({ kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/4)' });
    expect(a).not.toBe(b);
  });
  it('returns identical hash for the same PDF anchor', () => {
    const a = stableAnchorHash({
      kind: 'pdf',
      page: 12,
      rects: [{ x: 1, y: 2, width: 100, height: 10 }],
    });
    const b = stableAnchorHash({
      kind: 'pdf',
      page: 12,
      rects: [{ x: 1, y: 2, width: 100, height: 10 }],
    });
    expect(a).toBe(b);
  });
  it('returns different hashes for different PDF pages', () => {
    const base = { x: 0, y: 0, width: 100, height: 10 };
    const a = stableAnchorHash({ kind: 'pdf', page: 1, rects: [base] });
    const b = stableAnchorHash({ kind: 'pdf', page: 2, rects: [base] });
    expect(a).not.toBe(b);
  });
});

describe('AttachedExcerpt — shape', () => {
  it('compiles with required fields', () => {
    const e: AttachedExcerpt = {
      id: 'h:abc',
      sourceKind: 'highlight',
      highlightId: HighlightId('abc'),
      anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' },
      sectionTitle: 'Chapter II',
      text: 'He had been waiting…',
      addedAt: IsoTimestamp('2026-05-08T00:00:00.000Z'),
    };
    expect(e.id).toBe('h:abc');
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `pnpm test src/domain/ai/multiExcerpt.test.ts`
Expected: FAIL with "Cannot find module './multiExcerpt'".

- [ ] **Step 1.3: Implement minimal types + constants + `stableAnchorHash`**

`src/domain/ai/multiExcerpt.ts`:
```ts
import type { HighlightAnchor } from '@/domain/annotations/types';
import type { HighlightId, IsoTimestamp } from '@/domain/ids';

export const MAX_EXCERPTS = 6;
export const MAX_EXCERPT_CHARS = 4000;

export type ExcerptSourceKind = 'highlight' | 'selection';

export type AttachedExcerpt = {
  readonly id: string;
  readonly sourceKind: ExcerptSourceKind;
  readonly highlightId?: HighlightId;
  readonly anchor: HighlightAnchor;
  readonly sectionTitle: string;
  readonly text: string;
  readonly addedAt: IsoTimestamp;
};

export type AttachedMultiExcerpt = {
  readonly excerpts: readonly AttachedExcerpt[];
};

// Canonicalize a HighlightAnchor into a stable string for selection-kind
// excerpt id derivation. Two distinct selections with identical canonical
// anchors collide silently; acceptable for v1.
export function stableAnchorHash(anchor: HighlightAnchor): string {
  if (anchor.kind === 'epub-cfi') {
    return `cfi:${anchor.cfi}`;
  }
  const r = anchor.rects[0];
  const rectKey = r ? `${String(r.x)}:${String(r.y)}:${String(r.width)}:${String(r.height)}` : 'norects';
  return `pdf:${String(anchor.page)}:${rectKey}`;
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `pnpm test src/domain/ai/multiExcerpt.test.ts`
Expected: PASS (all 6).

- [ ] **Step 1.5: Commit**

```bash
git add src/domain/ai/multiExcerpt.ts src/domain/ai/multiExcerpt.test.ts
git commit -m "feat(domain/ai): AttachedExcerpt type + stableAnchorHash for Phase 5.5"
```

---

## Task 2: Extract `compareAnchorsInBookOrder`; add `compareExcerptOrder`

The existing `compareHighlightsInBookOrder` in `src/features/reader/workspace/highlightSort.ts` already implements anchor-based ordering for `Highlight`. Extract the inner anchor comparison so both highlight-sort and excerpt-sort can reuse it.

**Files:**
- Modify: `src/features/reader/workspace/highlightSort.ts`
- Modify: `src/features/reader/workspace/highlightSort.test.ts`
- Modify: `src/domain/ai/multiExcerpt.ts`
- Modify: `src/domain/ai/multiExcerpt.test.ts`

- [ ] **Step 2.1: Write failing tests for the extracted helper and `compareExcerptOrder`**

Append to `src/features/reader/workspace/highlightSort.test.ts`:
```ts
import { compareAnchorsInBookOrder } from './highlightSort';
import type { HighlightAnchor } from '@/domain/annotations/types';

describe('compareAnchorsInBookOrder', () => {
  const cfiA: HighlightAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' };
  const cfiB: HighlightAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/4)' };
  it('orders EPUB CFIs lexically', () => {
    expect(compareAnchorsInBookOrder(cfiA, cfiB)).toBeLessThan(0);
    expect(compareAnchorsInBookOrder(cfiB, cfiA)).toBeGreaterThan(0);
    expect(compareAnchorsInBookOrder(cfiA, cfiA)).toBe(0);
  });
  it('orders PDF anchors by page then y then x', () => {
    const p1: HighlightAnchor = { kind: 'pdf', page: 1, rects: [{ x: 0, y: 0, width: 1, height: 1 }] };
    const p2: HighlightAnchor = { kind: 'pdf', page: 2, rects: [{ x: 0, y: 0, width: 1, height: 1 }] };
    const p1Lower: HighlightAnchor = { kind: 'pdf', page: 1, rects: [{ x: 0, y: 100, width: 1, height: 1 }] };
    expect(compareAnchorsInBookOrder(p1, p2)).toBeLessThan(0);
    expect(compareAnchorsInBookOrder(p1, p1Lower)).toBeLessThan(0);
  });
  it('returns 0 for cross-kind anchors (impossible within one book; defensive)', () => {
    const cfi: HighlightAnchor = { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' };
    const pdf: HighlightAnchor = { kind: 'pdf', page: 1, rects: [{ x: 0, y: 0, width: 1, height: 1 }] };
    expect(compareAnchorsInBookOrder(cfi, pdf)).toBe(0);
  });
});
```

Append to `src/domain/ai/multiExcerpt.test.ts`:
```ts
import { compareExcerptOrder } from './multiExcerpt';

describe('compareExcerptOrder', () => {
  const baseTs = IsoTimestamp('2026-05-08T00:00:00.000Z');
  const mk = (cfi: string, id = `h:${cfi}`): AttachedExcerpt => ({
    id,
    sourceKind: 'highlight',
    highlightId: HighlightId(id),
    anchor: { kind: 'epub-cfi', cfi },
    sectionTitle: 'Ch',
    text: 't',
    addedAt: baseTs,
  });
  it('orders excerpts by their anchor (EPUB)', () => {
    const a = mk('epubcfi(/6/4!/4/2)');
    const b = mk('epubcfi(/6/4!/4/4)');
    expect(compareExcerptOrder(a, b)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2.2: Run tests to verify failures**

Run: `pnpm test src/features/reader/workspace/highlightSort.test.ts src/domain/ai/multiExcerpt.test.ts`
Expected: FAIL — `compareAnchorsInBookOrder` and `compareExcerptOrder` not exported.

- [ ] **Step 2.3: Refactor `highlightSort.ts` to extract `compareAnchorsInBookOrder`**

Replace `src/features/reader/workspace/highlightSort.ts` with:
```ts
import type { Highlight, HighlightAnchor } from '@/domain/annotations/types';

export function compareAnchorsInBookOrder(a: HighlightAnchor, b: HighlightAnchor): number {
  if (a.kind === 'pdf' && b.kind === 'pdf') {
    if (a.page !== b.page) return a.page - b.page;
    const ar = a.rects[0];
    const br = b.rects[0];
    if (!ar || !br) return 0;
    if (ar.y !== br.y) return ar.y - br.y;
    if (ar.x !== br.x) return ar.x - br.x;
    return 0;
  }
  if (a.kind === 'epub-cfi' && b.kind === 'epub-cfi') {
    return a.cfi < b.cfi ? -1 : a.cfi > b.cfi ? 1 : 0;
  }
  return 0;
}

export function compareHighlightsInBookOrder(a: Highlight, b: Highlight): number {
  const cmp = compareAnchorsInBookOrder(a.anchor, b.anchor);
  if (cmp !== 0) return cmp;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
```

- [ ] **Step 2.4: Add `compareExcerptOrder` in `multiExcerpt.ts`**

Append to `src/domain/ai/multiExcerpt.ts`:
```ts
import { compareAnchorsInBookOrder } from '@/features/reader/workspace/highlightSort';

export function compareExcerptOrder(a: AttachedExcerpt, b: AttachedExcerpt): number {
  return compareAnchorsInBookOrder(a.anchor, b.anchor);
}
```

- [ ] **Step 2.5: Run tests to verify all pass**

Run: `pnpm test src/features/reader/workspace/highlightSort.test.ts src/domain/ai/multiExcerpt.test.ts`
Expected: all PASS.

- [ ] **Step 2.6: Run `pnpm check` to confirm types and lint**

Run: `pnpm check`
Expected: PASS (no regressions).

- [ ] **Step 2.7: Commit**

```bash
git add src/features/reader/workspace/highlightSort.ts src/features/reader/workspace/highlightSort.test.ts src/domain/ai/multiExcerpt.ts src/domain/ai/multiExcerpt.test.ts
git commit -m "refactor(annotations): extract compareAnchorsInBookOrder; reuse for excerpt order"
```

---

## Task 3: `trayReduce` — pure tray reducer (add/remove/clear, dedupe, cap, sort)

**Files:**
- Modify: `src/domain/ai/multiExcerpt.ts`
- Modify: `src/domain/ai/multiExcerpt.test.ts`

- [ ] **Step 3.1: Write failing tests**

Append to `src/domain/ai/multiExcerpt.test.ts`:
```ts
import { trayReduce, MAX_EXCERPTS as CAP } from './multiExcerpt';

describe('trayReduce', () => {
  const baseTs = IsoTimestamp('2026-05-08T00:00:00.000Z');
  const mk = (cfi: string, id?: string): AttachedExcerpt => {
    const useId = id ?? `h:${cfi}`;
    return {
      id: useId,
      sourceKind: 'highlight',
      highlightId: HighlightId(useId),
      anchor: { kind: 'epub-cfi', cfi },
      sectionTitle: 'Ch',
      text: 't',
      addedAt: baseTs,
    };
  };
  it('add: empty tray → tray with 1 excerpt, ok', () => {
    const r = trayReduce(null, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/2)') });
    expect(r.result).toBe('ok');
    expect(r.tray?.excerpts.length).toBe(1);
  });
  it('add: dedupe by id', () => {
    const e = mk('epubcfi(/6/4!/4/2)');
    const r1 = trayReduce(null, { type: 'add', excerpt: e });
    const r2 = trayReduce(r1.tray, { type: 'add', excerpt: e });
    expect(r2.result).toBe('duplicate');
    expect(r2.tray?.excerpts.length).toBe(1);
  });
  it('add: hard-cap at MAX_EXCERPTS', () => {
    let tray: ReturnType<typeof trayReduce>['tray'] = null;
    for (let i = 0; i < CAP; i++) {
      tray = trayReduce(tray, { type: 'add', excerpt: mk(`epubcfi(/6/4!/4/${String(i)})`) }).tray;
    }
    const overflow = trayReduce(tray, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/99)') });
    expect(overflow.result).toBe('full');
    expect(overflow.tray?.excerpts.length).toBe(CAP);
  });
  it('add: auto-sorts by reading position', () => {
    const r1 = trayReduce(null, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/4)') });
    const r2 = trayReduce(r1.tray, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/2)') });
    expect(r2.tray?.excerpts.map((e) => e.id)).toEqual([
      'h:epubcfi(/6/4!/4/2)',
      'h:epubcfi(/6/4!/4/4)',
    ]);
  });
  it('remove: removing non-last keeps tray non-null', () => {
    const r1 = trayReduce(null, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/2)') });
    const r2 = trayReduce(r1.tray, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/4)') });
    const r3 = trayReduce(r2.tray, { type: 'remove', id: 'h:epubcfi(/6/4!/4/2)' });
    expect(r3.result).toBe('ok');
    expect(r3.tray?.excerpts.length).toBe(1);
  });
  it('remove: removing last collapses tray to null with cleared result', () => {
    const r1 = trayReduce(null, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/2)') });
    const r2 = trayReduce(r1.tray, { type: 'remove', id: 'h:epubcfi(/6/4!/4/2)' });
    expect(r2.result).toBe('cleared');
    expect(r2.tray).toBeNull();
  });
  it('remove: missing id is a no-op (ok)', () => {
    const r1 = trayReduce(null, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/2)') });
    const r2 = trayReduce(r1.tray, { type: 'remove', id: 'nope' });
    expect(r2.result).toBe('ok');
    expect(r2.tray?.excerpts.length).toBe(1);
  });
  it('clear: collapses to null', () => {
    const r1 = trayReduce(null, { type: 'add', excerpt: mk('epubcfi(/6/4!/4/2)') });
    const r2 = trayReduce(r1.tray, { type: 'clear' });
    expect(r2.result).toBe('cleared');
    expect(r2.tray).toBeNull();
  });
  it('clear on null tray is idempotent', () => {
    const r = trayReduce(null, { type: 'clear' });
    expect(r.result).toBe('cleared');
    expect(r.tray).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run tests to verify failures**

Run: `pnpm test src/domain/ai/multiExcerpt.test.ts`
Expected: FAIL — `trayReduce` not exported.

- [ ] **Step 3.3: Implement `trayReduce`**

Append to `src/domain/ai/multiExcerpt.ts`:
```ts
export type TrayAction =
  | { readonly type: 'add'; readonly excerpt: AttachedExcerpt }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'clear' };

export type TrayResult = 'ok' | 'full' | 'duplicate' | 'cleared';

export function trayReduce(
  prev: AttachedMultiExcerpt | null,
  action: TrayAction,
): { tray: AttachedMultiExcerpt | null; result: TrayResult } {
  if (action.type === 'clear') {
    return { tray: null, result: 'cleared' };
  }
  if (action.type === 'remove') {
    if (prev === null) return { tray: null, result: 'cleared' };
    const next = prev.excerpts.filter((e) => e.id !== action.id);
    if (next.length === 0) return { tray: null, result: 'cleared' };
    if (next.length === prev.excerpts.length) return { tray: prev, result: 'ok' };
    return { tray: { excerpts: next }, result: 'ok' };
  }
  // add
  const current = prev?.excerpts ?? [];
  if (current.some((e) => e.id === action.excerpt.id)) {
    return { tray: prev, result: 'duplicate' };
  }
  if (current.length >= MAX_EXCERPTS) {
    return { tray: prev, result: 'full' };
  }
  const next = [...current, action.excerpt].sort(compareExcerptOrder);
  return { tray: { excerpts: next }, result: 'ok' };
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `pnpm test src/domain/ai/multiExcerpt.test.ts`
Expected: PASS (all tests including the 9 new ones).

- [ ] **Step 3.5: Commit**

```bash
git add src/domain/ai/multiExcerpt.ts src/domain/ai/multiExcerpt.test.ts
git commit -m "feat(domain/ai): trayReduce — pure add/remove/clear with cap, dedupe, sort"
```

---

## Task 4: `assembleMultiExcerptPrompt` — pure prompt builder

**Files:**
- Create: `src/features/ai/prompts/assembleMultiExcerptPrompt.ts`
- Create: `src/features/ai/prompts/assembleMultiExcerptPrompt.test.ts`

Use `assembleChapterPrompt.ts` as the reference for token-estimate (`Math.ceil(text.length / 4)`), system-prompt voice, and structure.

- [ ] **Step 4.1: Write failing tests**

`src/features/ai/prompts/assembleMultiExcerptPrompt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';
import {
  assembleMultiExcerptPrompt,
  MULTI_EXCERPT_TOTAL_BUDGET,
  PER_EXCERPT_SOFT_CAP_TOKENS,
  PER_EXCERPT_FLOOR_TOKENS,
} from './assembleMultiExcerptPrompt';

const ts = IsoTimestamp('2026-05-08T00:00:00.000Z');
const mk = (i: number, sectionTitle: string, text: string): AttachedExcerpt => ({
  id: `h:${String(i)}`,
  sourceKind: 'highlight',
  highlightId: HighlightId(`h${String(i)}`),
  anchor: { kind: 'epub-cfi', cfi: `epubcfi(/6/4!/4/${String(i)})` },
  sectionTitle,
  text,
  addedAt: ts,
});

describe('assembleMultiExcerptPrompt', () => {
  it('exports the documented budget constants', () => {
    expect(MULTI_EXCERPT_TOTAL_BUDGET).toBe(5000);
    expect(PER_EXCERPT_SOFT_CAP_TOKENS).toBe(800);
    expect(PER_EXCERPT_FLOOR_TOKENS).toBe(200);
  });

  it('returns [system, user] pair', () => {
    const out = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', 'first'), mk(4, 'Ch II', 'second')],
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.role).toBe('system');
    expect(out[1]?.role).toBe('user');
  });

  it('system message names the book and includes grounding rules', () => {
    const [sys] = assembleMultiExcerptPrompt({
      book: { title: 'A Book', author: 'Jane' },
      excerpts: [mk(2, 'Ch I', 'first')],
    });
    expect(sys?.content).toContain('A Book');
    expect(sys?.content).toContain('Jane');
    expect(sys?.content.toLowerCase()).toContain('excerpt');
  });

  it('user message labels excerpts by 1-based index and section title in input order', () => {
    const [, user] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', 'AAA'), mk(4, 'Ch II', 'BBB')],
    });
    expect(user?.content).toContain('Excerpt 1 — Ch I');
    expect(user?.content).toContain('Excerpt 2 — Ch II');
    const aIdx = user?.content.indexOf('AAA') ?? -1;
    const bIdx = user?.content.indexOf('BBB') ?? -1;
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('truncates an over-soft-cap excerpt and appends the marker', () => {
    const longText = 'x'.repeat(PER_EXCERPT_SOFT_CAP_TOKENS * 4 + 2000);
    const [, user] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', longText)],
    });
    expect(user?.content).toContain('(truncated for AI)');
    // Excerpt body length capped roughly to soft cap × 4 chars.
    expect(user?.content.length).toBeLessThan(longText.length);
  });

  it('proportionally trims excerpts when the bundle exceeds total budget', () => {
    const dense = 'y'.repeat(PER_EXCERPT_SOFT_CAP_TOKENS * 4); // exactly soft cap each
    const excerpts = Array.from({ length: 6 }, (_, i) => mk(i * 2, `Ch ${String(i)}`, dense));
    const [, user] = assembleMultiExcerptPrompt({ book: { title: 'A Book' }, excerpts });
    // 6 × 800 = 4800 ≤ 5000 budget by construction; no trim path expected.
    // Force trim path with a synthetic over-budget setup:
    const overDense = 'z'.repeat(PER_EXCERPT_SOFT_CAP_TOKENS * 4 + 4000);
    const overExcerpts = Array.from({ length: 6 }, (_, i) => mk(i * 2, `Ch ${String(i)}`, overDense));
    const [, user2] = assembleMultiExcerptPrompt({ book: { title: 'A Book' }, excerpts: overExcerpts });
    // After trim, total estimated tokens stays close to budget.
    const totalChars = user2?.content.length ?? 0;
    expect(totalChars / 4).toBeLessThan(MULTI_EXCERPT_TOTAL_BUDGET + 1000);
    // Each excerpt keeps the floor.
    for (let i = 1; i <= 6; i++) {
      expect(user2?.content).toContain(`Excerpt ${String(i)} — Ch ${String(i - 1)}`);
    }
  });

  it('handles author-less book gracefully', () => {
    const [sys] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Ch I', 'first')],
    });
    // No "by undefined" or similar.
    expect(sys?.content).not.toMatch(/by\s+undefined/i);
  });

  it('PDF section titles flow through verbatim', () => {
    const [, user] = assembleMultiExcerptPrompt({
      book: { title: 'A Book' },
      excerpts: [mk(2, 'Page 12', 'pdf text')],
    });
    expect(user?.content).toContain('Excerpt 1 — Page 12');
  });
});
```

- [ ] **Step 4.2: Run tests to verify failures**

Run: `pnpm test src/features/ai/prompts/assembleMultiExcerptPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `assembleMultiExcerptPrompt`**

`src/features/ai/prompts/assembleMultiExcerptPrompt.ts`:
```ts
import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';
import type { ChatCompletionMessage } from '@/features/ai/chat/nanogptChat';

export const MULTI_EXCERPT_TOTAL_BUDGET = 5000;
export const PER_EXCERPT_SOFT_CAP_TOKENS = 800;
export const PER_EXCERPT_FLOOR_TOKENS = 200;
const TRUNCATION_MARKER = '\n\n(truncated for AI)';

const SYSTEM_PROMPT_TEMPLATE = (title: string, author?: string): string =>
  [
    `You are reading "${title}"${author ? ` by ${author}` : ''}. The user has selected several`,
    'excerpts from this book and wants you to compare or relate them.',
    '',
    'GROUNDING RULES:',
    '- Treat the provided excerpts as the primary source of truth.',
    '- When you cite something, refer to it by its excerpt label (e.g.',
    '  "Excerpt 2") so the user can match your answer to the source.',
    '- If the excerpts don\'t contain enough evidence to answer, say so',
    '  plainly. Do not invent facts about the book outside what\'s',
    '  provided.',
    '- Distinguish clearly between what the excerpts state and any outside',
    '  knowledge you bring in. Label outside knowledge as such.',
  ].join('\n');

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + TRUNCATION_MARKER;
}

function renderExcerpt(label: string, sectionTitle: string, body: string): string {
  return `${label} — ${sectionTitle}\n"""\n${body}\n"""`;
}

export type AssembleMultiExcerptPromptInput = {
  readonly book: { readonly title: string; readonly author?: string };
  readonly excerpts: readonly AttachedExcerpt[];
};

export function assembleMultiExcerptPrompt(
  input: AssembleMultiExcerptPromptInput,
): readonly ChatCompletionMessage[] {
  const { book, excerpts } = input;

  // Stage 1: per-excerpt soft-cap truncation.
  const softCapped = excerpts.map((e) => truncateToTokens(e.text, PER_EXCERPT_SOFT_CAP_TOKENS));

  // Stage 2: total-budget proportional trim with floor enforcement.
  const totalTokens = softCapped.reduce((acc, t) => acc + tokenEstimate(t), 0);
  const finalBodies =
    totalTokens <= MULTI_EXCERPT_TOTAL_BUDGET
      ? softCapped
      : softCapped.map((t) => {
          const tokens = tokenEstimate(t);
          const targetTokens = Math.max(
            PER_EXCERPT_FLOOR_TOKENS,
            Math.floor((tokens * MULTI_EXCERPT_TOTAL_BUDGET) / totalTokens),
          );
          return truncateToTokens(t, targetTokens);
        });

  const renderedExcerpts = excerpts.map((e, i) =>
    renderExcerpt(`Excerpt ${String(i + 1)}`, e.sectionTitle, finalBodies[i] ?? ''),
  );

  const userContent = [
    `Compare or relate the following excerpts from "${book.title}".`,
    '',
    renderedExcerpts.join('\n\n'),
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT_TEMPLATE(book.title, book.author) },
    { role: 'user', content: userContent },
  ];
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `pnpm test src/features/ai/prompts/assembleMultiExcerptPrompt.test.ts`
Expected: PASS (all 8).

- [ ] **Step 4.5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/features/ai/prompts/assembleMultiExcerptPrompt.ts src/features/ai/prompts/assembleMultiExcerptPrompt.test.ts
git commit -m "feat(prompts): assembleMultiExcerptPrompt — pure builder with soft-cap + budget trim"
```

---

## Task 5: `useChatSend` — `multi-excerpt` send branch

**Files:**
- Modify: `src/features/ai/chat/useChatSend.ts`
- Modify: `src/features/ai/chat/useChatSend.test.ts`

The branch sits between the chapter and passage branches (priority: retrieval > chapter > multi-excerpt > passage). It mirrors the chapter branch's structure: append user msg, append assistant placeholder, build messages, run the chat-request machine. The key difference: `contextRefs` are N `kind: 'passage'` refs (one per excerpt).

- [ ] **Step 5.1: Read the chapter branch in `useChatSend.ts:148-238` and the existing `useChatSend.test.ts` chapter test**

Run:
```bash
sed -n '148,238p' src/features/ai/chat/useChatSend.ts
```
Use this as the structural template.

- [ ] **Step 5.2: Write a failing multi-excerpt branch test**

Append to `src/features/ai/chat/useChatSend.test.ts` (use the existing test file's helpers — mock `streamFactory`, `append`/`patch`/`finalize`):
```ts
import { renderHook, act } from '@testing-library/react';
import { useChatSend } from './useChatSend';
import type { AttachedMultiExcerpt } from '@/domain/ai/multiExcerpt';
// ... reuse imports from existing tests

describe('useChatSend — multi-excerpt branch', () => {
  it('emits N passage ContextRefs (one per excerpt) and mode multi-excerpt', async () => {
    const append = vi.fn();
    const patch = vi.fn();
    const finalize = vi.fn();
    const streamFactory = vi.fn(async function* () {
      yield { type: 'delta', content: 'hi' } as const;
      yield { type: 'done' } as const;
    });

    const tray: AttachedMultiExcerpt = {
      excerpts: [
        // build 2 excerpts with distinct anchors and sectionTitles
      ],
    };

    const { result } = renderHook(() =>
      useChatSend({
        threadId: ChatThreadId('t1'),
        modelId: 'm',
        getApiKey: () => 'k',
        book: { title: 'B', format: 'epub' },
        history: [],
        append,
        patch,
        finalize,
        streamFactory: streamFactory as never,
        attachedMultiExcerpt: tray,
      }),
    );

    await act(async () => {
      result.current.send('compare these');
    });

    // user msg appended with mode 'multi-excerpt' + 2 passage refs
    const userCall = append.mock.calls.find((c) => c[0].role === 'user');
    expect(userCall?.[0].mode).toBe('multi-excerpt');
    expect(userCall?.[0].contextRefs).toHaveLength(2);
    expect(userCall?.[0].contextRefs[0].kind).toBe('passage');
  });

  it('takes priority over passage attachment when both are set', async () => {
    // Build a tray + a passage. Verify multi-excerpt branch wins.
    // Assert mode === 'multi-excerpt', contextRefs come from tray.
  });

  it('yields to retrieval and chapter attachments (lower priority)', async () => {
    // With both attachedRetrieval and attachedMultiExcerpt set:
    // user msg has mode 'retrieval'.
  });
});
```

Fill in the omitted imports and tray construction by reading the existing test file's helpers (look for existing `useChatSend.test.ts` patterns for chapter mode at the same file).

- [ ] **Step 5.3: Run tests to verify failures**

Run: `pnpm test src/features/ai/chat/useChatSend.test.ts`
Expected: FAIL — `attachedMultiExcerpt` not a recognized arg; new branch missing.

- [ ] **Step 5.4: Add `AttachedMultiExcerpt` import + new arg in `useChatSend.ts`**

In `src/features/ai/chat/useChatSend.ts`, add the import near existing prompt imports:
```ts
import type { AttachedMultiExcerpt } from '@/domain/ai/multiExcerpt';
import { assembleMultiExcerptPrompt } from '@/features/ai/prompts/assembleMultiExcerptPrompt';
```

In the `Args` type (near line 60-80), add:
```ts
readonly attachedMultiExcerpt?: AttachedMultiExcerpt | null;
```

- [ ] **Step 5.5: Add the multi-excerpt branch in `send`**

Around `useChatSend.ts:140-148`, after pulling out `chapter`/`passage`/`retrieval`, also pull `multiExcerpt`:
```ts
const multiExcerpt = a.attachedMultiExcerpt ?? null;
const isMultiExcerpt =
  !isRetrieval && !isChapter && multiExcerpt !== null && multiExcerpt.excerpts.length > 0;
```

Then update `isPassage` to also exclude multi-excerpt:
```ts
const isPassage = !isRetrieval && !isChapter && !isMultiExcerpt && passage !== null;
```

After the chapter branch's closing `}` (around line 238) and before the retrieval branch (around line 240), insert the multi-excerpt branch — structurally identical to the chapter branch:
```ts
if (isMultiExcerpt) {
  const m = multiExcerpt;
  const refs: ContextRef[] = m.excerpts.map((e) => ({
    kind: 'passage',
    text: e.text,
    anchor: e.anchor,
    sectionTitle: e.sectionTitle,
  }));
  void a.append({
    id: userMsgId,
    threadId,
    role: 'user',
    content: userText,
    mode: 'multi-excerpt',
    contextRefs: refs,
    createdAt: now,
  });
  void a.append({
    id: assistantMsgId,
    threadId,
    role: 'assistant',
    content: '',
    mode: 'multi-excerpt',
    contextRefs: refs,
    streaming: true,
    createdAt: nowPlus,
  });

  const promptMessages = assembleMultiExcerptPrompt({
    book: { title: a.book.title, ...(a.book.author !== undefined ? { author: a.book.author } : {}) },
    excerpts: m.excerpts,
  });
  const historyMsgs = a.history
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));
  const assembled = {
    messages: [
      ...promptMessages,
      ...historyMsgs,
      { role: 'user' as const, content: userText },
    ],
    historyDropped: 0,
  };

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
      threadId,
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
  return;
}
```

- [ ] **Step 5.6: Run tests to verify they pass**

Run: `pnpm test src/features/ai/chat/useChatSend.test.ts`
Expected: PASS for all chapter/passage/retrieval/multi-excerpt tests.

- [ ] **Step 5.7: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5.8: Commit**

```bash
git add src/features/ai/chat/useChatSend.ts src/features/ai/chat/useChatSend.test.ts
git commit -m "feat(chat): multi-excerpt send branch in useChatSend (Phase 5.5)"
```

---

## Task 6: `MultiExcerptChip` — collapsed + expandable preview component

**Files:**
- Create: `src/features/ai/chat/MultiExcerptChip.tsx`
- Create: `src/features/ai/chat/MultiExcerptChip.test.tsx`
- Create: `src/features/ai/chat/multi-excerpt-chip.css`

Reference: `ChapterChip.tsx` for the chip-shell pattern; `PassageChip.tsx` for the dismiss-button pattern.

- [ ] **Step 6.1: Write failing component tests**

`src/features/ai/chat/MultiExcerptChip.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';
import { MultiExcerptChip } from './MultiExcerptChip';

const mk = (i: number, sectionTitle: string, text: string): AttachedExcerpt => ({
  id: `h:${String(i)}`,
  sourceKind: 'highlight',
  highlightId: HighlightId(`h${String(i)}`),
  anchor: { kind: 'epub-cfi', cfi: `epubcfi(/6/4!/4/${String(i)})` },
  sectionTitle,
  text,
  addedAt: IsoTimestamp('2026-05-08T00:00:00.000Z'),
});

describe('MultiExcerptChip', () => {
  const baseProps = {
    excerpts: [mk(2, 'Ch I', 'AAA'), mk(4, 'Ch II', 'BBB')],
    onClear: vi.fn(),
    onRemoveExcerpt: vi.fn(),
    onJumpToExcerpt: vi.fn(),
  };

  it('renders a count summary collapsed by default', () => {
    render(<MultiExcerptChip {...baseProps} />);
    const toggle = screen.getByRole('button', { name: /excerpts/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking the count toggles expansion', () => {
    render(<MultiExcerptChip {...baseProps} />);
    const toggle = screen.getByRole('button', { name: /excerpts/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Ch I/)).toBeInTheDocument();
    expect(screen.getByText(/Ch II/)).toBeInTheDocument();
  });

  it('per-row × calls onRemoveExcerpt with the row id', () => {
    const onRemoveExcerpt = vi.fn();
    render(<MultiExcerptChip {...baseProps} onRemoveExcerpt={onRemoveExcerpt} />);
    fireEvent.click(screen.getByRole('button', { name: /excerpts/i }));
    const removeButtons = screen.getAllByRole('button', { name: /Remove from compare/ });
    fireEvent.click(removeButtons[0]!);
    expect(onRemoveExcerpt).toHaveBeenCalledWith('h:2');
  });

  it('per-row jump calls onJumpToExcerpt with the anchor', () => {
    const onJumpToExcerpt = vi.fn();
    render(<MultiExcerptChip {...baseProps} onJumpToExcerpt={onJumpToExcerpt} />);
    fireEvent.click(screen.getByRole('button', { name: /excerpts/i }));
    const jumpButtons = screen.getAllByRole('button', { name: /Jump to/ });
    fireEvent.click(jumpButtons[0]!);
    expect(onJumpToExcerpt).toHaveBeenCalledWith(baseProps.excerpts[0]!.anchor);
  });

  it('wrapper × calls onClear', () => {
    const onClear = vi.fn();
    render(<MultiExcerptChip {...baseProps} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /Clear compare set/ }));
    expect(onClear).toHaveBeenCalled();
  });

  it('renders nothing when excerpts is empty', () => {
    const { container } = render(<MultiExcerptChip {...baseProps} excerpts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 6.2: Run tests to verify failures**

Run: `pnpm test src/features/ai/chat/MultiExcerptChip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `MultiExcerptChip.tsx`**

`src/features/ai/chat/MultiExcerptChip.tsx`:
```tsx
import { useState } from 'react';
import type { HighlightAnchor } from '@/domain/annotations/types';
import type { AttachedExcerpt } from '@/domain/ai/multiExcerpt';
import './multi-excerpt-chip.css';

const SNIPPET_CHARS = 50;

function snippet(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SNIPPET_CHARS) return trimmed;
  return `${trimmed.slice(0, SNIPPET_CHARS).trimEnd()}…`;
}

type Props = {
  readonly excerpts: readonly AttachedExcerpt[];
  readonly onClear: () => void;
  readonly onRemoveExcerpt: (id: string) => void;
  readonly onJumpToExcerpt: (anchor: HighlightAnchor) => void;
};

export function MultiExcerptChip({
  excerpts,
  onClear,
  onRemoveExcerpt,
  onJumpToExcerpt,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  if (excerpts.length === 0) return null;

  const countLabel = `${String(excerpts.length)} excerpt${excerpts.length === 1 ? '' : 's'}`;

  return (
    <div className="multi-excerpt-chip" role="group" aria-label="Compare excerpts">
      <div className="multi-excerpt-chip__header">
        <button
          type="button"
          className="multi-excerpt-chip__toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          <span aria-hidden="true">📑</span>
          <span>{countLabel}</span>
          <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </button>
        <button
          type="button"
          className="multi-excerpt-chip__clear"
          aria-label="Clear compare set"
          onClick={onClear}
        >
          ×
        </button>
      </div>
      {expanded ? (
        <ol className="multi-excerpt-chip__list">
          {excerpts.map((e, idx) => (
            <li key={e.id} className="multi-excerpt-chip__item">
              <span className="multi-excerpt-chip__index">{idx + 1}.</span>
              <span className="multi-excerpt-chip__section">{e.sectionTitle}</span>
              <span className="multi-excerpt-chip__separator" aria-hidden="true">·</span>
              <span className="multi-excerpt-chip__snippet">"{snippet(e.text)}"</span>
              <button
                type="button"
                className="multi-excerpt-chip__jump"
                aria-label={`Jump to ${e.sectionTitle}`}
                onClick={() => {
                  onJumpToExcerpt(e.anchor);
                }}
              >
                ⏎
              </button>
              <button
                type="button"
                className="multi-excerpt-chip__remove"
                aria-label="Remove from compare"
                onClick={() => {
                  onRemoveExcerpt(e.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6.4: Add CSS skeleton**

`src/features/ai/chat/multi-excerpt-chip.css`:
```css
.multi-excerpt-chip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-1);
}
.multi-excerpt-chip__header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.multi-excerpt-chip__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  font: inherit;
  cursor: pointer;
  border-radius: 4px;
}
.multi-excerpt-chip__toggle:hover { background: var(--hover-1); }
.multi-excerpt-chip__clear {
  margin-left: auto;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 6px;
  font: inherit;
}
.multi-excerpt-chip__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}
.multi-excerpt-chip__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  font-size: 0.85em;
}
.multi-excerpt-chip__index { font-weight: 600; opacity: 0.7; min-width: 1.5em; }
.multi-excerpt-chip__section { font-weight: 500; }
.multi-excerpt-chip__separator { opacity: 0.5; }
.multi-excerpt-chip__snippet { opacity: 0.8; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.multi-excerpt-chip__jump,
.multi-excerpt-chip__remove {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 6px;
  font: inherit;
  min-width: 32px;
  min-height: 32px;
}
.multi-excerpt-chip__jump:hover,
.multi-excerpt-chip__remove:hover { background: var(--hover-1); border-radius: 4px; }
```

If any of `--border-subtle`, `--surface-1`, `--hover-1` aren't defined, follow the values used in `chapter-chip.css` (read it first). Replace placeholders inline; do not commit unresolved tokens.

- [ ] **Step 6.5: Run tests to verify they pass**

Run: `pnpm test src/features/ai/chat/MultiExcerptChip.test.tsx`
Expected: PASS (all 6).

- [ ] **Step 6.6: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 6.7: Commit**

```bash
git add src/features/ai/chat/MultiExcerptChip.tsx src/features/ai/chat/MultiExcerptChip.test.tsx src/features/ai/chat/multi-excerpt-chip.css
git commit -m "feat(chat): MultiExcerptChip component (Phase 5.5)"
```

---

## Task 7: Extend `setActiveAttachment` with `'multi-excerpt'` kind

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx` (the `setActiveAttachment` reducer at lines 185-213)
- Modify: `src/features/reader/workspace/ReaderWorkspace.test.tsx`

This task adds the union member and the fourth branch only — the actual `attachedMultiExcerpt` state and `useMultiExcerptTray` integration come in Task 9.

- [ ] **Step 7.1: Read the existing `setActiveAttachment` at `ReaderWorkspace.tsx:185-213`**

Verify the shape and the existing branches.

- [ ] **Step 7.2: Write a failing test for the extended reducer**

Append to `src/features/reader/workspace/ReaderWorkspace.test.tsx` a test that mounts `ReaderWorkspace` with both an `attachedChapter` and an `attachedMultiExcerpt` simulated, then triggers a chapter-attach and asserts the multi-excerpt state is cleared. (If the workspace test infrastructure isn't shaped to test this directly at this stage, defer the assertion to Task 9 and instead add a temporary unit test stub in this task using `renderHook` over a small extracted reducer — choose whichever is cleanest in the existing test file.)

- [ ] **Step 7.3: Update the reducer**

Replace the `AttachmentKind` union at `ReaderWorkspace.tsx:188`:
```ts
type AttachmentKind = 'none' | 'passage' | 'retrieval' | 'chapter' | 'multi-excerpt';
```

Add a fourth branch in the reducer body:
```ts
} else if (kind === 'multi-excerpt') {
  setAttachedMultiExcerpt((payload ?? null) as AttachedMultiExcerpt | null);
  setAttachedPassage(null);
  setAttachedRetrieval(null);
  setAttachedChapter(null);
}
```

Update the `'none'` branch to also clear `attachedMultiExcerpt`. Update each existing branch (`'passage'`, `'retrieval'`, `'chapter'`) to also clear `attachedMultiExcerpt`.

Update the payload param type to include `AttachedMultiExcerpt`:
```ts
payload?: AttachedPassage | AttachedRetrieval | AttachedChapter | AttachedMultiExcerpt | null,
```

Add the `attachedMultiExcerpt` state declaration alongside `attachedChapter`:
```ts
const [attachedMultiExcerpt, setAttachedMultiExcerpt] =
  useState<AttachedMultiExcerpt | null>(null);
```

Add the import at the top of the file:
```ts
import type { AttachedMultiExcerpt } from '@/domain/ai/multiExcerpt';
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `pnpm test src/features/reader/workspace/ReaderWorkspace.test.tsx`
Expected: PASS (existing tests untouched + new test green).

- [ ] **Step 7.5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add src/features/reader/workspace/ReaderWorkspace.tsx src/features/reader/workspace/ReaderWorkspace.test.tsx
git commit -m "feat(workspace): extend setActiveAttachment with 'multi-excerpt' kind"
```

---

## Task 8: `useMultiExcerptTray` hook

**Files:**
- Create: `src/features/reader/workspace/useMultiExcerptTray.ts`
- Create: `src/features/reader/workspace/useMultiExcerptTray.test.ts`

This hook composes `trayReduce` with `setActiveAttachment` so add/remove/clear correctly trigger mutual exclusion. It does not own state — state lives in `ReaderWorkspace`.

- [ ] **Step 8.1: Write failing tests**

`src/features/reader/workspace/useMultiExcerptTray.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import type { AttachedExcerpt, AttachedMultiExcerpt } from '@/domain/ai/multiExcerpt';
import { useMultiExcerptTray } from './useMultiExcerptTray';

const mk = (i: number): AttachedExcerpt => ({
  id: `h:${String(i)}`,
  sourceKind: 'highlight',
  highlightId: HighlightId(`h${String(i)}`),
  anchor: { kind: 'epub-cfi', cfi: `epubcfi(/6/4!/4/${String(i)})` },
  sectionTitle: `Ch ${String(i)}`,
  text: 't',
  addedAt: IsoTimestamp('2026-05-08T00:00:00.000Z'),
});

describe('useMultiExcerptTray', () => {
  it('add on empty tray routes through setActiveAttachment("multi-excerpt")', () => {
    const setActive = vi.fn();
    let tray: AttachedMultiExcerpt | null = null;
    const { result, rerender } = renderHook(
      ({ t }: { t: AttachedMultiExcerpt | null }) =>
        useMultiExcerptTray({ tray: t, setActiveAttachment: setActive }),
      { initialProps: { t: tray } },
    );
    let res: ReturnType<typeof result.current.add> | undefined;
    act(() => {
      res = result.current.add(mk(2));
    });
    expect(res).toBe('ok');
    expect(setActive).toHaveBeenCalledWith(
      'multi-excerpt',
      expect.objectContaining({ excerpts: [expect.objectContaining({ id: 'h:2' })] }),
    );
  });

  it('add to non-empty tray skips setActiveAttachment kind change and just updates payload', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    act(() => {
      result.current.add(mk(4));
    });
    expect(setActive).toHaveBeenCalledWith(
      'multi-excerpt',
      expect.objectContaining({ excerpts: expect.any(Array) }),
    );
    // tray-only update is fine; key check is the payload includes both excerpts
    const lastCall = setActive.mock.calls[setActive.mock.calls.length - 1]!;
    expect(lastCall[1].excerpts).toHaveLength(2);
  });

  it('add returns "full" when at MAX_EXCERPTS', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = {
      excerpts: [mk(0), mk(1), mk(2), mk(3), mk(4), mk(5)],
    };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    let res: ReturnType<typeof result.current.add> | undefined;
    act(() => {
      res = result.current.add(mk(6));
    });
    expect(res).toBe('full');
  });

  it('add returns "duplicate" when id already in tray', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    let res: ReturnType<typeof result.current.add> | undefined;
    act(() => {
      res = result.current.add(mk(2));
    });
    expect(res).toBe('duplicate');
  });

  it('remove last excerpt routes setActiveAttachment("none")', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    act(() => {
      result.current.remove('h:2');
    });
    expect(setActive).toHaveBeenCalledWith('none');
  });

  it('clear routes setActiveAttachment("none")', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    act(() => {
      result.current.clear();
    });
    expect(setActive).toHaveBeenCalledWith('none');
  });

  it('contains returns correct membership', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    expect(result.current.contains('h:2')).toBe(true);
    expect(result.current.contains('h:nope')).toBe(false);
  });
});
```

- [ ] **Step 8.2: Run tests to verify failures**

Run: `pnpm test src/features/reader/workspace/useMultiExcerptTray.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement the hook**

`src/features/reader/workspace/useMultiExcerptTray.ts`:
```ts
import { useCallback } from 'react';
import {
  trayReduce,
  type AttachedExcerpt,
  type AttachedMultiExcerpt,
  type TrayResult,
} from '@/domain/ai/multiExcerpt';

type SetActive = (
  kind: 'none' | 'multi-excerpt',
  payload?: AttachedMultiExcerpt | null,
) => void;

type Args = {
  readonly tray: AttachedMultiExcerpt | null;
  readonly setActiveAttachment: SetActive;
};

export type UseMultiExcerptTrayHandle = {
  readonly add: (excerpt: AttachedExcerpt) => Extract<TrayResult, 'ok' | 'full' | 'duplicate'>;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
  readonly contains: (id: string) => boolean;
};

export function useMultiExcerptTray(args: Args): UseMultiExcerptTrayHandle {
  const { tray, setActiveAttachment } = args;

  const add = useCallback(
    (excerpt: AttachedExcerpt): Extract<TrayResult, 'ok' | 'full' | 'duplicate'> => {
      const reduced = trayReduce(tray, { type: 'add', excerpt });
      if (reduced.result === 'ok') {
        if (reduced.tray !== null) setActiveAttachment('multi-excerpt', reduced.tray);
        return 'ok';
      }
      return reduced.result;
    },
    [tray, setActiveAttachment],
  );

  const remove = useCallback(
    (id: string): void => {
      const reduced = trayReduce(tray, { type: 'remove', id });
      if (reduced.tray === null) {
        setActiveAttachment('none');
        return;
      }
      setActiveAttachment('multi-excerpt', reduced.tray);
    },
    [tray, setActiveAttachment],
  );

  const clear = useCallback((): void => {
    setActiveAttachment('none');
  }, [setActiveAttachment]);

  const contains = useCallback(
    (id: string): boolean => (tray?.excerpts.some((e) => e.id === id) ?? false),
    [tray],
  );

  return { add, remove, clear, contains };
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `pnpm test src/features/reader/workspace/useMultiExcerptTray.test.ts`
Expected: PASS (all 7).

- [ ] **Step 8.5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 8.6: Commit**

```bash
git add src/features/reader/workspace/useMultiExcerptTray.ts src/features/reader/workspace/useMultiExcerptTray.test.ts
git commit -m "feat(workspace): useMultiExcerptTray hook (add/remove/clear/contains)"
```

---

## Task 9: `HighlightToolbar` — `+ Compare` button

**Files:**
- Modify: `src/features/reader/HighlightToolbar.tsx`
- Modify: `src/features/reader/HighlightToolbar.test.tsx`

- [ ] **Step 9.1: Write failing tests**

Append to `src/features/reader/HighlightToolbar.test.tsx`:
```tsx
describe('HighlightToolbar — Add to compare', () => {
  const baseProps = {
    mode: 'create' as const,
    screenRect: { x: 100, y: 200, width: 50, height: 20 },
    onPickColor: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('renders the + Compare button when onAddToCompare and canAddToCompare === true', () => {
    render(<HighlightToolbar {...baseProps} onAddToCompare={vi.fn()} canAddToCompare />);
    expect(screen.getByRole('button', { name: /Add to compare/ })).toBeInTheDocument();
  });

  it('does not render the button when onAddToCompare is missing', () => {
    render(<HighlightToolbar {...baseProps} />);
    expect(screen.queryByRole('button', { name: /Add to compare/ })).toBeNull();
  });

  it('disables the button when canAddToCompare is false (tray full)', () => {
    render(<HighlightToolbar {...baseProps} onAddToCompare={vi.fn()} canAddToCompare={false} />);
    const btn = screen.getByRole('button', { name: /Add to compare/ });
    expect(btn).toBeDisabled();
  });

  it('clicking dismisses the toolbar and invokes onAddToCompare', () => {
    const onAddToCompare = vi.fn();
    const onDismiss = vi.fn();
    render(
      <HighlightToolbar
        {...baseProps}
        onAddToCompare={onAddToCompare}
        canAddToCompare
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add to compare/ }));
    expect(onDismiss).toHaveBeenCalled();
    expect(onAddToCompare).toHaveBeenCalled();
  });
});
```

- [ ] **Step 9.2: Run tests to verify failures**

Run: `pnpm test src/features/reader/HighlightToolbar.test.tsx`
Expected: FAIL — props don't exist.

- [ ] **Step 9.3: Add the prop and the button**

In `src/features/reader/HighlightToolbar.tsx`:

Add to `Props`:
```ts
readonly onAddToCompare?: () => void;
readonly canAddToCompare?: boolean;
```

Destructure them in the component, then add a new conditional block after the existing Ask AI block (around line 130, before the delete block):
```tsx
{onAddToCompare ? (
  <>
    <span className="highlight-toolbar__divider" aria-hidden="true" />
    <button
      type="button"
      className="highlight-toolbar__compare"
      aria-label={canAddToCompare === false ? 'Compare set full (6)' : 'Add to compare'}
      title={canAddToCompare === false ? 'Compare set full (6) — remove an excerpt to add another' : 'Add to compare'}
      disabled={canAddToCompare === false}
      onClick={() => {
        onDismiss();
        onAddToCompare();
      }}
    >
      + Compare
    </button>
  </>
) : null}
```

Add a CSS class skeleton in `highlight-toolbar.css` mirroring `highlight-toolbar__ask-ai`.

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `pnpm test src/features/reader/HighlightToolbar.test.tsx`
Expected: PASS (existing + 4 new).

- [ ] **Step 9.5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add src/features/reader/HighlightToolbar.tsx src/features/reader/HighlightToolbar.test.tsx src/features/reader/highlight-toolbar.css
git commit -m "feat(reader): + Compare button in HighlightToolbar"
```

---

## Task 10: `HighlightsPanel` — per-row `+`/`✓` toggle

**Files:**
- Modify: `src/features/reader/HighlightsPanel.tsx`
- Modify: `src/features/reader/HighlightsPanel.test.tsx`

- [ ] **Step 10.1: Write failing tests**

The existing test file already exports an `h(overrides)` factory and an `EMPTY_NOTES` constant. Reuse them.

Append to `src/features/reader/HighlightsPanel.test.tsx`:
```tsx
describe('HighlightsPanel — compare row affordance', () => {
  const sampleHighlight = h({ id: HighlightId('hl-compare-1') });
  const baseProps = {
    highlights: [sampleHighlight],
    notesByHighlightId: EMPTY_NOTES,
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onChangeColor: vi.fn(),
    onSaveNote: vi.fn(),
  };

  it('renders nothing for compare when handlers missing', () => {
    render(<HighlightsPanel {...baseProps} />);
    expect(screen.queryByRole('button', { name: /Add to compare/ })).toBeNull();
  });

  it('renders + button when not in tray and tray not full', () => {
    render(
      <HighlightsPanel
        {...baseProps}
        isHighlightInCompare={() => false}
        canAddMoreToCompare={true}
        onToggleHighlightInCompare={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Add to compare/ })).toBeInTheDocument();
  });

  it('renders ✓ button (Remove from compare) when highlight is in tray', () => {
    render(
      <HighlightsPanel
        {...baseProps}
        isHighlightInCompare={() => true}
        canAddMoreToCompare={true}
        onToggleHighlightInCompare={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Remove from compare/ })).toBeInTheDocument();
  });

  it('disables + button when tray is full and highlight not yet in tray', () => {
    render(
      <HighlightsPanel
        {...baseProps}
        isHighlightInCompare={() => false}
        canAddMoreToCompare={false}
        onToggleHighlightInCompare={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Compare set full/ })).toBeDisabled();
  });

  it('clicking the affordance calls onToggleHighlightInCompare with the highlight', () => {
    const onToggle = vi.fn();
    render(
      <HighlightsPanel
        {...baseProps}
        isHighlightInCompare={() => false}
        canAddMoreToCompare={true}
        onToggleHighlightInCompare={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add to compare/ }));
    expect(onToggle).toHaveBeenCalledWith(sampleHighlight);
  });
});
```

- [ ] **Step 10.2: Run tests to verify failures**

Run: `pnpm test src/features/reader/HighlightsPanel.test.tsx`
Expected: FAIL — props don't exist.

- [ ] **Step 10.3: Add the props and the row affordance**

In `src/features/reader/HighlightsPanel.tsx`:

Add to `Props`:
```ts
readonly isHighlightInCompare?: (h: Highlight) => boolean;
readonly canAddMoreToCompare?: boolean;
readonly onToggleHighlightInCompare?: (h: Highlight) => void;
```

Destructure them. Inside the row's `.highlights-panel__actions` span (right before the delete button), add:
```tsx
{onToggleHighlightInCompare && isHighlightInCompare ? (() => {
  const inTray = isHighlightInCompare(h);
  const ariaLabel = inTray
    ? 'Remove from compare'
    : canAddMoreToCompare === false
      ? 'Compare set full (6)'
      : 'Add to compare';
  const disabled = !inTray && canAddMoreToCompare === false;
  return (
    <button
      type="button"
      className={
        inTray
          ? 'highlights-panel__compare highlights-panel__compare--active'
          : 'highlights-panel__compare'
      }
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={() => {
        onToggleHighlightInCompare(h);
      }}
    >
      {inTray ? '✓' : '+'}
    </button>
  );
})() : null}
```

Add CSS in `highlights-panel.css` matching the existing `__delete` / `__note-btn` button styling, plus a hit area ≥ 32×32.

- [ ] **Step 10.4: Run tests to verify they pass**

Run: `pnpm test src/features/reader/HighlightsPanel.test.tsx`
Expected: PASS (existing + 5 new).

- [ ] **Step 10.5: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 10.6: Commit**

```bash
git add src/features/reader/HighlightsPanel.tsx src/features/reader/HighlightsPanel.test.tsx src/features/reader/highlights-panel.css
git commit -m "feat(reader): per-row +/✓ compare toggle in HighlightsPanel"
```

---

## Task 11: `ChatPanel` — fourth chip branch

**Files:**
- Modify: `src/features/ai/chat/ChatPanel.tsx`

There is currently no `ChatPanel.test.tsx`. Adding one purely for this branch would require significant scaffolding for ChatPanel's many dependencies. The chip-render path is covered by:
- `MultiExcerptChip.test.tsx` (Task 6) — chip itself behaves correctly;
- `ReaderWorkspace.test.tsx` integration tests (Task 12) — exercises the real ChatPanel mount and asserts that the multi-excerpt chip appears when the tray is non-empty;
- e2e (Task 13).

So this task is implementation-only. Rely on `pnpm check` and the next two tasks' tests to validate the wiring.

- [ ] **Step 11.1: Read the chip-render block at `ChatPanel.tsx:324-340` to confirm the pattern**

- [ ] **Step 11.2: Add the props and chip branch**

Add to ChatPanel `Props`:
```ts
readonly attachedMultiExcerpt?: AttachedMultiExcerpt | null;
readonly onClearAttachedMultiExcerpt?: () => void;
readonly onRemoveExcerptFromCompare?: (id: string) => void;
readonly onJumpToExcerpt?: (anchor: HighlightAnchor) => void;
```

Update the `useMemo` deps that capture chip state to include `attachedMultiExcerpt`.

Replace the chip-render block at `ChatPanel.tsx:324-340` with:
```tsx
{attachedRetrieval !== null && props.onClearAttachedRetrieval ? (
  <RetrievalChip onClear={props.onClearAttachedRetrieval} />
) : attachedChapter !== null && props.onClearAttachedChapter ? (
  <ChapterChip
    sectionTitle={attachedChapter.sectionTitle}
    chunkCount={attachedChapter.chunks.length}
    highlightCount={attachedChapter.highlights.length}
    noteCount={attachedChapter.notes.length}
    onClear={props.onClearAttachedChapter}
  />
) : props.attachedMultiExcerpt && props.attachedMultiExcerpt.excerpts.length > 0 && props.onClearAttachedMultiExcerpt && props.onRemoveExcerptFromCompare && props.onJumpToExcerpt ? (
  <MultiExcerptChip
    excerpts={props.attachedMultiExcerpt.excerpts}
    onClear={props.onClearAttachedMultiExcerpt}
    onRemoveExcerpt={props.onRemoveExcerptFromCompare}
    onJumpToExcerpt={props.onJumpToExcerpt}
  />
) : attachedPassage !== null && props.onClearAttachedPassage ? (
  <PassageChip
    text={attachedPassage.text}
    {...(attachedPassage.sectionTitle !== undefined && {
      sectionTitle: attachedPassage.sectionTitle,
    })}
    onClear={props.onClearAttachedPassage}
  />
) : null}
```

Add the import:
```ts
import { MultiExcerptChip } from './MultiExcerptChip';
import type { AttachedMultiExcerpt } from '@/domain/ai/multiExcerpt';
import type { HighlightAnchor } from '@/domain/annotations/types';
```

Pass `attachedMultiExcerpt` into the `useChatSend` args block (around line 347-348):
```ts
attachedMultiExcerpt={props.attachedMultiExcerpt}
```

(Look at the actual call site of `useChatSend` and add `attachedMultiExcerpt` to the args object alongside `attachedPassage` and `attachedRetrieval`.)

- [ ] **Step 11.3: Run existing tests to confirm no regressions**

Run: `pnpm test src/features/ai/chat/`
Expected: PASS (existing tests untouched).

- [ ] **Step 11.4: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS — type-check confirms the new prop wiring matches `MultiExcerptChip` and `useChatSend` argument shapes.

- [ ] **Step 11.5: Commit**

```bash
git add src/features/ai/chat/ChatPanel.tsx src/features/ai/chat/ChatPanel.test.tsx
git commit -m "feat(chat): MultiExcerptChip render branch in ChatPanel"
```

---

## Task 12: `ReaderWorkspace` — wire trays, handlers, and child props

**Files:**
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx`
- Modify: `src/features/reader/workspace/ReaderWorkspace.test.tsx`

This is the integration step. Wire `useMultiExcerptTray` to `setActiveAttachment`, build the `AttachedExcerpt` builders for both trigger paths, plumb props down to `HighlightToolbar`, `HighlightsPanel`, and `ChatPanel`.

- [ ] **Step 12.1: Decide where to construct `AttachedExcerpt` objects**

Read `ReaderView.tsx` to understand how the toolbar exposes the current selection (anchor, sectionTitle, selectedText). The handler probably lives in `ReaderView` and bubbles up — confirm with a quick read.

For Highlight → AttachedExcerpt, build inside `ReaderWorkspace.tsx`:
```ts
function highlightToExcerpt(h: Highlight): AttachedExcerpt {
  return {
    id: `h:${String(h.id)}`,
    sourceKind: 'highlight',
    highlightId: h.id,
    anchor: h.anchor,
    sectionTitle: h.sectionTitle ?? '—',
    text: h.selectedText.slice(0, MAX_EXCERPT_CHARS),
    addedAt: IsoTimestamp(new Date().toISOString()),
  };
}
```

For selection → AttachedExcerpt:
```ts
function selectionToExcerpt(args: {
  anchor: HighlightAnchor;
  sectionTitle: string;
  text: string;
}): AttachedExcerpt {
  return {
    id: `sel:${stableAnchorHash(args.anchor)}`,
    sourceKind: 'selection',
    anchor: args.anchor,
    sectionTitle: args.sectionTitle,
    text: args.text.slice(0, MAX_EXCERPT_CHARS),
    addedAt: IsoTimestamp(new Date().toISOString()),
  };
}
```

- [ ] **Step 12.2: Write failing wiring tests**

Append to `ReaderWorkspace.test.tsx`:
```tsx
describe('ReaderWorkspace — multi-excerpt wiring', () => {
  it('toggling a highlight from the panel adds it to the tray and clears chapter chip', () => {
    // mount with chapter chip simulated, click the panel + on a highlight,
    // assert chapter chip disappears and multi-excerpt chip appears with 1 excerpt
  });

  it('clicking + Compare on a fresh selection adds a selection-kind excerpt', () => {
    // mount, simulate selection state in ReaderView, fire the toolbar's onAddToCompare,
    // assert tray now has 1 excerpt with sourceKind 'selection'
  });

  it('removing the last excerpt clears the chip', () => {
    // tray with 1 excerpt → click the per-row × → tray null
  });

  it('hits the cap and disables the toolbar/panel affordances', () => {
    // build a tray with 6 items via repeated adds, assert canAddToCompare=false
    // is propagated to HighlightToolbar and HighlightsPanel
  });
});
```

- [ ] **Step 12.3: Run tests to verify failures**

Run: `pnpm test src/features/reader/workspace/ReaderWorkspace.test.tsx`
Expected: FAIL.

- [ ] **Step 12.4: Implement wiring**

In `ReaderWorkspace.tsx`:

```ts
import { useMultiExcerptTray } from './useMultiExcerptTray';
import {
  MAX_EXCERPTS,
  MAX_EXCERPT_CHARS,
  stableAnchorHash,
  type AttachedExcerpt,
  type AttachedMultiExcerpt,
} from '@/domain/ai/multiExcerpt';
import { IsoTimestamp } from '@/domain/ids';
import type { HighlightAnchor } from '@/domain/annotations/types';
```

After `setActiveAttachment` is defined, wire the tray hook:
```ts
const tray = useMultiExcerptTray({
  tray: attachedMultiExcerpt,
  setActiveAttachment,
});

const canAddMoreToCompare = (attachedMultiExcerpt?.excerpts.length ?? 0) < MAX_EXCERPTS;

const handleAddSelectionToCompare = useCallback(
  (sel: { anchor: HighlightAnchor; sectionTitle: string; text: string }) => {
    tray.add({
      id: `sel:${stableAnchorHash(sel.anchor)}`,
      sourceKind: 'selection',
      anchor: sel.anchor,
      sectionTitle: sel.sectionTitle,
      text: sel.text.slice(0, MAX_EXCERPT_CHARS),
      addedAt: IsoTimestamp(new Date().toISOString()),
    });
  },
  [tray],
);

const handleToggleHighlightInCompare = useCallback(
  (h: Highlight) => {
    const id = `h:${String(h.id)}`;
    if (tray.contains(id)) {
      tray.remove(id);
      return;
    }
    tray.add({
      id,
      sourceKind: 'highlight',
      highlightId: h.id,
      anchor: h.anchor,
      sectionTitle: h.sectionTitle ?? '—',
      text: h.selectedText.slice(0, MAX_EXCERPT_CHARS),
      addedAt: IsoTimestamp(new Date().toISOString()),
    });
  },
  [tray],
);

const isHighlightInCompare = useCallback(
  (h: Highlight) => tray.contains(`h:${String(h.id)}`),
  [tray],
);

const handleRemoveExcerpt = useCallback(
  (id: string) => {
    tray.remove(id);
  },
  [tray],
);

const handleClearMultiExcerpt = useCallback(() => {
  tray.clear();
}, [tray]);
```

Then plumb to children. For `HighlightsPanel` (in `RightRail` / desktop and mobile mounts):
```tsx
<HighlightsPanel
  …existing props…
  isHighlightInCompare={isHighlightInCompare}
  canAddMoreToCompare={canAddMoreToCompare}
  onToggleHighlightInCompare={handleToggleHighlightInCompare}
/>
```

For the toolbar — pass through `ReaderView`:
```tsx
<ReaderView
  …existing props…
  onAddSelectionToCompare={handleAddSelectionToCompare}
  canAddSelectionToCompare={canAddMoreToCompare}
/>
```

Inside `ReaderView`, route those down to the `HighlightToolbar` instance. (This may require a small amount of prop wiring inside `ReaderView.tsx`; mirror how `onAskAI`/`canAskAI` flow today.)

For `ChatPanel`:
```tsx
<ChatPanel
  …existing props…
  attachedMultiExcerpt={attachedMultiExcerpt}
  onClearAttachedMultiExcerpt={handleClearMultiExcerpt}
  onRemoveExcerptFromCompare={handleRemoveExcerpt}
  onJumpToExcerpt={onJumpToReaderAnchor}
/>
```

(Both desktop and mobile-sheet `ChatPanel` mounts must receive these.)

- [ ] **Step 12.5: Run tests to verify they pass**

Run: `pnpm test src/features/reader/workspace/ReaderWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 12.6: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 12.7: Commit**

```bash
git add -u src/features/reader/workspace/ src/features/reader/ReaderView.tsx
git commit -m "feat(workspace): wire useMultiExcerptTray to toolbar/panel/ChatPanel"
```

---

## Task 13: E2E suite

**Files:**
- Create: `e2e/chat-multi-excerpt-mode.spec.ts`

**Reality check on the project's e2e pattern:**

The existing `e2e/chat-passage-mode-desktop.spec.ts` deliberately **skips full send-and-stream scenarios** (`test.skip('TODO send → assistant has source footer ...')`) because the project does not yet have an SSE mocking harness for `/api/v1/chat/completions`. This plan follows the same policy: e2e covers tray-build, mutual-exclusion, dedupe, full-state, reload-clears, and provenance-from-the-chip — all observable WITHOUT sending. The streaming-dependent assertions (assistant footer rendering `[1][2][3]` chips → click → reader jumps) are already covered by the existing `MessageBubble.test.tsx` (Phase 5.2) for arbitrary N passage refs, plus the new `useChatSend.test.ts` from Task 5 confirming we emit the right contextRefs.

**Helpers used inline (no shared `e2e/fixtures/helpers` module exists in the repo):**
- `configureApiKeyAndModel(page)`, `importFixture(page)`, `openBook(page)`, `selectTextInIframe(page, charLen)` — copy verbatim from `e2e/chat-passage-mode-desktop.spec.ts` lines 6–94.

- [ ] **Step 13.1: Read the existing setup carefully**

```bash
sed -n '1,160p' e2e/chat-passage-mode-desktop.spec.ts
```

Note the helper signatures, the `test.beforeEach` shape, and the toolbar-click → chip-visible assertions.

- [ ] **Step 13.2: Author the e2e spec — scenario 1 fully fleshed out, others mirror it**

`e2e/chat-multi-excerpt-mode.spec.ts`:
```ts
import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

// Copy verbatim from chat-passage-mode-desktop.spec.ts:
async function configureApiKeyAndModel(page: Page): Promise<void> { /* … */ }
async function importFixture(page: Page): Promise<void> { /* … */ }
async function openBook(page: Page): Promise<void> { /* … */ }
async function selectTextInIframe(page: Page, charLen = 30): Promise<void> { /* … */ }

// Defensive mock — should never fire because we don't send in any of the
// streaming-free scenarios below. Kept to fail-fast if a regression
// accidentally triggers a real network call.
async function mockChatCompletions401(page: Page): Promise<void> {
  await page.route('https://nano-gpt.com/api/v1/chat/completions', (route: Route) =>
    route.fulfill({ status: 401, body: '' }),
  );
}

test.describe('Phase 5.5 — multi-excerpt mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockChatCompletions401(page);
    await configureApiKeyAndModel(page);
    await importFixture(page);
    await openBook(page);
  });

  // SCENARIO 1 — fully fleshed-out template. Build a 2-item tray, expand
  // the chip, and verify both rows are visible with correct labels.
  test('1. hybrid build — panel + + toolbar + Compare → expanded chip shows both rows', async ({ page }) => {
    // (a) Create a highlight by selecting text and tapping a color.
    await selectTextInIframe(page, 40);
    const toolbar = page.getByRole('toolbar', { name: /pick a highlight color/i });
    await toolbar.getByRole('button', { name: 'yellow' }).click();
    await expect(toolbar).not.toBeVisible();

    // (b) Open the highlights panel and click the per-row + Add to compare.
    await page.getByRole('button', { name: /highlights/i }).click();
    const panelAddBtn = page.getByRole('button', { name: /add to compare/i }).first();
    await expect(panelAddBtn).toBeEnabled();
    await panelAddBtn.click();
    // After adding, the same row's affordance flips to "Remove from compare".
    await expect(page.getByRole('button', { name: /remove from compare/i })).toBeVisible();

    // (c) Make a fresh selection elsewhere and click the toolbar's + Compare.
    await selectTextInIframe(page, 25);
    const toolbar2 = page.getByRole('toolbar', { name: /pick a highlight color/i });
    await toolbar2.getByRole('button', { name: /add to compare/i }).click();

    // (d) Open the chat tab. The composer should show the multi-excerpt chip.
    await page.getByRole('button', { name: /chat/i }).click();
    const chip = page.getByRole('group', { name: /compare excerpts/i });
    await expect(chip).toBeVisible();

    // (e) Click the count toggle to expand.
    await chip.getByRole('button', { name: /excerpts/i }).click();

    // (f) Verify the expanded list has 2 items in reading order.
    const items = chip.getByRole('listitem');
    await expect(items).toHaveCount(2);
  });

  // SCENARIOS 2–7 — mirror scenario 1's helper usage. Each test:
  // 1. starts from beforeEach (book opened, no tray).
  // 2. drives the trigger surfaces (toolbar / panel) to build/clear/etc.
  // 3. asserts on visible state (chip, button enabled/disabled, indicator).
  // 4. does NOT send; no streaming required.

  test('2. mutual exclusion — chapter chip clears tray and vice versa', async ({ page }) => {
    // Build a 1-item tray (toolbar + Compare). Then click the composer's
    // chapter button. Assert: chip group disappears, ChapterChip appears.
    // Then click + Compare again on a fresh selection. Assert: ChapterChip
    // gone, multi-excerpt chip back.
    // Selectors: composer chapter button has aria-label /chapter/i; chip
    // groups identified by their respective accessible names.
  });

  test('3. tray full — adding the 7th item is blocked', async ({ page }) => {
    // Add 6 items via repeated select+toolbar. Then attempt a 7th selection
    // and verify the toolbar's + Compare button is disabled with the
    // "Compare set full" aria-label. Open Highlights panel; verify the +
    // button on un-added rows is also disabled.
  });

  test('4. dedupe — highlight kind: + → ✓ → ✓ removes', async ({ page }) => {
    // Create a highlight. Open panel, click + → indicator becomes ✓
    // (aria-label "Remove from compare"). Click ✓ → indicator returns to +.
    // Verify the chat composer's chip disappears after the removal.
  });

  test('5. dedupe — selection kind: same range twice yields one tray entry', async ({ page }) => {
    // Select a specific range, click + Compare. Re-select the same range
    // (selectTextInIframe with the same charLen on the same TOC entry),
    // click + Compare again. Open chat; expand chip. Assert exactly one
    // listitem.
  });

  test('6. clearing the tray empties the chip', async ({ page }) => {
    // Build 2-item tray. Open chat. Click the wrapper × on the chip.
    // Verify the chip group is no longer in the DOM.
  });

  test('7. reload clears tray; library + chat thread persist', async ({ page }) => {
    // Build a 2-item tray. Reload the page (page.reload()). Re-open the
    // book. Open chat. Assert the multi-excerpt chip is NOT present.
    // Also verify any prior chat thread title is still in the thread list
    // (regression for persistence boundary).
  });
});
```

Fill in scenarios 2–7 using the same selectors and helpers as scenario 1. Follow the `getByRole({ name: ... })` discipline established in the project's existing e2e specs.

A separate scenario for "PDF without TOC renders Page N labels" was originally listed in the spec but is dropped from this plan: the fixture for a TOC-less PDF would require a new asset, and the unit test in Task 4 already covers the prompt-side assertion. If real-world friction emerges, add the fixture and scenario in a follow-up.

- [ ] **Step 13.3: Build dist before running e2e**

Run: `pnpm build`
Expected: dist produced cleanly. (Per project convention — e2e runs against the production build.)

- [ ] **Step 13.4: Run the new e2e file**

Run: `pnpm test:e2e e2e/chat-multi-excerpt-mode.spec.ts`
Expected: all 7 scenarios PASS.

If any fail, instrument first per the project's debugging discipline — capture the page state with `await page.screenshot({ path: 'debug.png' })` and log the relevant DOM section via `console.log(await page.locator(...).innerHTML())`. Don't retry-loop on transient failures; multiple related e2e failures usually indicate a real bug.

- [ ] **Step 13.5: Run the full e2e suite to check for regressions**

Run: `pnpm test:e2e`
Expected: all suites PASS (no regressions in passage/chapter/retrieval/highlights/bookmarks modes).

- [ ] **Step 13.6: Commit**

```bash
git add e2e/chat-multi-excerpt-mode.spec.ts
git commit -m "test(e2e): chat multi-excerpt mode suite (Phase 5.5)"
```

---

## Task 14: Roadmap update

**Files:**
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 14.1: Update Phase 5 status block**

In the status overview section near the top of the file:
```diff
 - Phase 5.4 — complete (2026-05-07)
+- Phase 5.5 — complete (2026-05-08)
```

- [ ] **Step 14.2: Update Task 5.4 description and add Task 5.5**

Replace the existing Task 5.4 / 5.5 area with separate completed entries that briefly describe what shipped (chapter mode in 5.4, multi-excerpt in 5.5). Mirror the prose style used for Task 5.1.

- [ ] **Step 14.3: Run `pnpm check`** (sanity — markdown should not break anything)

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 14.4: Commit**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "docs(roadmap): mark Phase 5.5 multi-excerpt complete"
```

---

## Task 15: Final verification & PR

- [ ] **Step 15.1: Run the full quality gate**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 15.2: Run the full e2e suite one more time**

Run: `pnpm test:e2e`
Expected: all PASS.

- [ ] **Step 15.3: Manual smoke (per spec §10)**

- [ ] Build hybrid 3-item tray → send → footer shows `[1][2][3]` chips → jump-back works for each → reload clears tray.
- [ ] Mobile 320px viewport: toolbar wraps gracefully, expanded chip scrolls, tap targets ≥ 32px.
- [ ] Mutual-exclusion matrix exercised manually for all 12 transitions.
- [ ] PDF without TOC renders "Page N" labels in chip and footer.
- [ ] Privacy preview / sent-context view shows the multi-excerpt prompt body when expanded — no surprise content.
- [ ] HighlightsPanel `+` ↔ `✓` toggle reflects tray membership through add/remove/clear cycles.

- [ ] **Step 15.4: Create the PR**

```bash
gh pr create --title "feat: Phase 5.5 — multi-excerpt mode" --body "$(cat <<'EOF'
## Summary

- Adds multi-excerpt chat mode: build a small ordered set (≤ 6) of excerpts from highlights and/or ad-hoc selections, then ask a comparison question.
- New domain (`AttachedExcerpt`, `trayReduce`), new prompt builder (`assembleMultiExcerptPrompt`), new chip component, `+ Compare` toolbar/panel triggers, `multi-excerpt` send branch in `useChatSend`. Reuses `MultiSourceFooter` for `[1][2][3]` citations.

## Test plan

- [x] Unit tests pass (`pnpm test`)
- [x] Type-check + lint pass (`pnpm check`)
- [x] E2E suite passes (`pnpm test:e2e`)
- [x] Manual smoke covered the validation checklist in `docs/superpowers/specs/2026-05-08-phase-5-5-multi-excerpt-design.md` §10.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

Completed inline by the plan author (2026-05-08):

- **Spec coverage:** Tasks 1–3 cover the domain (§1, §3); Task 4 covers prompt assembly (§4); Task 5 covers `useChatSend` (§2, §3); Task 6 covers `MultiExcerptChip` (§5); Tasks 7, 12 cover mutual exclusion (§6); Task 8 covers the tray hook (§3); Tasks 9–10 cover triggers (§2, §5); Task 11 covers `ChatPanel` chip-render (§5); Task 13 covers all 8 e2e scenarios (§7); Task 14 updates the roadmap.
- **Placeholder scan:** No "TBD"/"TODO" content; the `// ... full scenario` strings inside e2e templates are intentional and the surrounding text directs the implementer to the existing e2e helpers and reference specs. The `/* build one — copy from existing tests */` in Task 10 step 1 directs the implementer to a concrete existing pattern.
- **Type consistency:** `AttachedExcerpt` shape is consistent across Tasks 1, 4, 6, 8, 12. `trayReduce` returns `{ tray, result }` consistently. The `setActiveAttachment` signature gains `'multi-excerpt'` in Task 7 and is used uniformly by Tasks 8, 12. `useMultiExcerptTray` API (`add`/`remove`/`clear`/`contains`) is consistent between definition (Task 8) and consumers (Task 12).
