# Phase 6.1.1 — Motion Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the motion-language foundation: shared CSS primitives, a tiny View Transitions hook, naming constants, contract test helpers, e2e regression net, and design-system documentation. No existing surface is modified.

**Architecture:** New `src/design-system/motion.css` provides 8 primitive utility classes wired to existing motion tokens. New `src/shared/motion/` directory holds `useViewTransition` (browser-API wrapper with reduced-motion fallback), `viewTransitionNames` (constants), and `contracts` (test helpers). `motion.css` is imported once in `src/main.tsx`. No surface migrations or View-Transition wiring in this PR — that lands in 6.1.2 and 6.1.3.

**Tech Stack:** Vanilla CSS (no preprocessor), TypeScript strict, React 19 + `@testing-library/react`, vitest with happy-dom, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-05-10-phase-6-1-motion-language-design.md` (§3, §5 6.1.1, §6, §7).

**Branch:** `phase-6-1-1-motion-foundation`

---

## File structure

### New files
- `src/design-system/motion.css` — 8 primitive `@keyframes` + utility classes + canonical hover/press helper classes.
- `src/design-system/motion.test.ts` — vitest tests for the primitive declarations.
- `src/shared/motion/useViewTransition.ts` — hook wrapping `document.startViewTransition` with API-absent and reduced-motion fallbacks.
- `src/shared/motion/useViewTransition.test.ts` — three branches (API present, API absent, reduced-motion).
- `src/shared/motion/viewTransitionNames.ts` — string constants.
- `src/shared/motion/viewTransitionNames.test.ts` — basic identity test (catches accidental rename).
- `src/shared/motion/contracts.ts` — vitest helpers that operate on the `motion.css` source text plus reduced-motion `@media` block in `tokens.css`.
- `src/shared/motion/contracts.test.ts` — self-test that the helpers correctly accept clean fixtures and reject literal-bearing fixtures.
- `e2e/motion-tokens.spec.ts` — Playwright baseline asserting no literal-ms inline styles on a sampled set of surfaces.

### Modified files
- `src/main.tsx` — import `motion.css` immediately after `tokens.css`.
- `docs/05-design-system.md` — replace the existing short "Motion rules" section with the full Motion vocabulary section (principles, primitive table, hover/press canon, stagger pattern, View Transitions usage, reduced-motion guarantee, do/don't list).

---

## Task 1 — Create branch and scaffold the `shared/motion/` directory

**Files:**
- Create directory: `src/shared/motion/`

- [ ] **Step 1.1: Create the branch from latest `main`**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b phase-6-1-1-motion-foundation
```

- [ ] **Step 1.2: Create the directory**

```bash
mkdir -p src/shared/motion
```

- [ ] **Step 1.3: No commit yet** — directory will be committed alongside its first file.

---

## Task 2 — `viewTransitionNames` constants module (TDD)

**Files:**
- Create: `src/shared/motion/viewTransitionNames.ts`
- Test: `src/shared/motion/viewTransitionNames.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// src/shared/motion/viewTransitionNames.test.ts
import { describe, it, expect } from 'vitest';
import {
  VIEW_TRANSITION_READER_ROOT,
  VIEW_TRANSITION_NOTEBOOK_ROOT,
  VIEW_TRANSITION_PANEL_ROOT,
  VIEW_TRANSITION_MODAL_ROOT,
  libraryCardViewTransitionName,
} from './viewTransitionNames';

describe('viewTransitionNames', () => {
  it('exports stable string constants for shared roots', () => {
    expect(VIEW_TRANSITION_READER_ROOT).toBe('reader-root');
    expect(VIEW_TRANSITION_NOTEBOOK_ROOT).toBe('notebook-root');
    expect(VIEW_TRANSITION_PANEL_ROOT).toBe('panel-root');
    expect(VIEW_TRANSITION_MODAL_ROOT).toBe('modal-root');
  });

  it('builds per-instance library-card names from a book id', () => {
    expect(libraryCardViewTransitionName('abc-123')).toBe(
      'library-card-abc-123',
    );
  });

  it('handles ids that contain CSS-unsafe characters by encoding them', () => {
    expect(libraryCardViewTransitionName('book with spaces')).toBe(
      'library-card-book-with-spaces',
    );
  });
});
```

- [ ] **Step 2.2: Run the test and verify it fails**

```bash
pnpm test --run src/shared/motion/viewTransitionNames.test.ts
```

Expected: FAIL with module-not-found errors on the imports.

- [ ] **Step 2.3: Write the minimal implementation**

```ts
// src/shared/motion/viewTransitionNames.ts
export const VIEW_TRANSITION_READER_ROOT = 'reader-root';
export const VIEW_TRANSITION_NOTEBOOK_ROOT = 'notebook-root';
export const VIEW_TRANSITION_PANEL_ROOT = 'panel-root';
export const VIEW_TRANSITION_MODAL_ROOT = 'modal-root';

/**
 * Builds the per-instance view-transition-name for a library book card.
 * Replaces any character outside `[A-Za-z0-9_-]` with `-` so the value
 * is a valid CSS identifier suffix.
 */
export function libraryCardViewTransitionName(bookId: string): string {
  const safe = bookId.replace(/[^A-Za-z0-9_-]+/g, '-');
  return `library-card-${safe}`;
}
```

- [ ] **Step 2.4: Run the test and verify it passes**

```bash
pnpm test --run src/shared/motion/viewTransitionNames.test.ts
```

Expected: 3 PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/shared/motion/viewTransitionNames.ts src/shared/motion/viewTransitionNames.test.ts
git commit -m "feat(motion): viewTransitionNames constants (Phase 6.1.1)"
```

---

## Task 3 — `useViewTransition` hook (TDD, 3 branches)

**Files:**
- Create: `src/shared/motion/useViewTransition.ts`
- Test: `src/shared/motion/useViewTransition.test.ts`

The hook detects support and reduced-motion preference; runs the updater synchronously when the API is unavailable or reduced-motion is requested; otherwise wraps the updater in `document.startViewTransition`.

- [ ] **Step 3.1: Write the failing tests**

```ts
// src/shared/motion/useViewTransition.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewTransition } from './useViewTransition';

afterEach(() => {
  vi.restoreAllMocks();
  // Ensure each test starts without a stub on document.
  // (vi.restoreAllMocks restores spies; we set startViewTransition by
  //  assignment, so we delete it explicitly here as well.)
  delete (document as unknown as { startViewTransition?: unknown })
    .startViewTransition;
});

function mockReducedMotion(reduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion: reduce')
          ? reduced
          : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }) satisfies MediaQueryList,
  );
}

describe('useViewTransition', () => {
  it('calls document.startViewTransition when the API is present and reduced-motion is off', () => {
    mockReducedMotion(false);
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition: () => {} };
    });
    (document as unknown as { startViewTransition: typeof start }).startViewTransition = start;

    const updater = vi.fn();
    const { result } = renderHook(() => useViewTransition());
    result.current(updater);

    expect(start).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledTimes(1);
  });

  it('runs the updater synchronously when the API is absent', () => {
    mockReducedMotion(false);
    expect(
      (document as unknown as { startViewTransition?: unknown })
        .startViewTransition,
    ).toBeUndefined();

    const updater = vi.fn();
    const { result } = renderHook(() => useViewTransition());
    result.current(updater);

    expect(updater).toHaveBeenCalledTimes(1);
  });

  it('runs the updater synchronously when reduced-motion is preferred, even if the API is present', () => {
    mockReducedMotion(true);
    const start = vi.fn();
    (document as unknown as { startViewTransition: typeof start }).startViewTransition = start;

    const updater = vi.fn();
    const { result } = renderHook(() => useViewTransition());
    result.current(updater);

    expect(start).not.toHaveBeenCalled();
    expect(updater).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3.2: Run the tests and verify they fail**

```bash
pnpm test --run src/shared/motion/useViewTransition.test.ts
```

Expected: 3 FAIL with module-not-found.

- [ ] **Step 3.3: Write the minimal implementation**

```ts
// src/shared/motion/useViewTransition.ts
import { useCallback } from 'react';

type ViewTransitionStarter = (updater: () => void) => void;

interface DocumentWithViewTransition {
  startViewTransition?: (updater: () => void) => unknown;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * React hook that wraps `document.startViewTransition` when the browser
 * supports it AND the user has not requested reduced motion. Otherwise the
 * updater is invoked synchronously, so callers always get a single,
 * predictable code path: pass an updater that mutates state, the rest is
 * handled here.
 */
export function useViewTransition(): ViewTransitionStarter {
  return useCallback((updater: () => void) => {
    const doc = document as DocumentWithViewTransition;
    if (prefersReducedMotion() || typeof doc.startViewTransition !== 'function') {
      updater();
      return;
    }
    doc.startViewTransition(updater);
  }, []);
}
```

- [ ] **Step 3.4: Run the tests and verify they pass**

```bash
pnpm test --run src/shared/motion/useViewTransition.test.ts
```

Expected: 3 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/shared/motion/useViewTransition.ts src/shared/motion/useViewTransition.test.ts
git commit -m "feat(motion): useViewTransition hook with reduced-motion + fallback (Phase 6.1.1)"
```

---

## Task 4 — `motion.css` primitives + helper classes

**Files:**
- Create: `src/design-system/motion.css`
- Modify: `src/main.tsx` (one new import line)

This is a CSS-only task; tests come in Task 6.

- [ ] **Step 4.1: Create `motion.css`**

```css
/* src/design-system/motion.css
 *
 * Motion primitives. See docs/05-design-system.md §Motion for the full
 * vocabulary. All durations and easings come from tokens.css; do not write
 * literal ms or cubic-bezier values here.
 */

/* ---- Keyframes -------------------------------------------------------- */

@keyframes bw-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes bw-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes bw-sheet-in {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}

@keyframes bw-scrim-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes bw-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes bw-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}

@keyframes bw-rule-grow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}

@keyframes bw-breath {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

/* ---- Utility classes -------------------------------------------------- */

.motion-fade-in {
  animation: bw-fade-in var(--duration-base) var(--ease-out);
}

.motion-rise {
  animation: bw-rise var(--duration-slower) var(--ease-out);
}

.motion-sheet-in {
  animation: bw-sheet-in var(--duration-slow) var(--ease-spring);
}

.motion-scrim-in {
  animation: bw-scrim-in var(--duration-base) var(--ease-out);
}

.motion-toast-in {
  animation: bw-toast-in var(--duration-slow) var(--ease-spring);
}

.motion-pulse {
  animation: bw-pulse var(--duration-slow) var(--ease-out);
}

.motion-rule-grow {
  animation: bw-rule-grow var(--duration-slower) var(--ease-out);
  transform-origin: left center;
}

.motion-breath {
  animation: bw-breath calc(var(--duration-base) * 7) var(--ease-in-out) infinite;
}

/* ---- Hover / press helper classes ------------------------------------ */

.motion-hover-bg {
  transition: background var(--duration-fast) var(--ease-out);
}

.motion-press {
  transition: transform var(--duration-base) var(--ease-out);
}
.motion-press:active {
  transform: scale(0.98);
}
```

- [ ] **Step 4.2: Import `motion.css` in `src/main.tsx`**

Edit `src/main.tsx`. Find:

```ts
import './design-system/tokens.css';
import './design-system/reset.css';
```

Replace with:

```ts
import './design-system/tokens.css';
import './design-system/motion.css';
import './design-system/reset.css';
```

(`motion.css` goes between `tokens.css` and `reset.css` so motion utilities can reference tokens, and `reset.css` retains last-word on element resets.)

- [ ] **Step 4.3: Verify the build still compiles**

```bash
pnpm type-check
```

Expected: PASS (no TS errors; CSS imports are not type-checked but should not break the build).

- [ ] **Step 4.4: Manually verify the dev build loads the file**

```bash
pnpm build
```

Expected: build succeeds. Confirm `dist/assets/index-*.css` (or the bundled CSS asset) contains `motion-fade-in` by:

```bash
grep -l "motion-fade-in" dist/assets/*.css
```

Expected: at least one `.css` file matches.

- [ ] **Step 4.5: Commit**

```bash
git add src/design-system/motion.css src/main.tsx
git commit -m "feat(motion): motion.css primitives + hover/press helpers (Phase 6.1.1)"
```

- [ ] **Step 4.6: Add a header comment in `tokens.css` pointing readers to the motion doc**

Edit `src/design-system/tokens.css`. At the very top of the file (before any existing content), insert:

```css
/* Design tokens. See docs/05-design-system.md for the design-system overview;
 * §Motion documents the motion vocabulary built on the --duration-* and
 * --ease-* tokens declared below. */
```

If a top-of-file comment already exists, keep it and add the new comment immediately after it.

- [ ] **Step 4.7: Commit the comment**

```bash
git add src/design-system/tokens.css
git commit -m "docs(tokens): point readers from tokens.css to the motion doc (Phase 6.1.1)"
```

---

## Task 5 — `contracts.ts` test helpers (TDD)

**Files:**
- Create: `src/shared/motion/contracts.ts`
- Test: `src/shared/motion/contracts.test.ts`

The helpers operate on CSS source text loaded via `node:fs`. This sidesteps happy-dom's incomplete `getComputedStyle` resolution for CSS variables and gives deterministic tests. Two helpers:

- `assertNoLiteralMotion(cssSource: string)` — throws if `cssSource` contains literal `\d+ms`, literal `\d+s` (excluding `0s`), `cubic-bezier(`, or bare `ease`/`ease-in`/`ease-out`/`ease-in-out` outside of token references.
- `assertReducedMotionZeroesTokens(tokensSource: string)` — throws if the `@media (prefers-reduced-motion: reduce)` block in `tokensSource` does not set all four `--duration-*` tokens to `0ms`.

- [ ] **Step 5.1: Write the failing tests**

```ts
// src/shared/motion/contracts.test.ts
import { describe, it, expect } from 'vitest';
import {
  assertNoLiteralMotion,
  assertReducedMotionZeroesTokens,
} from './contracts';

describe('assertNoLiteralMotion', () => {
  it('accepts a tokenized declaration', () => {
    const src = `
      .motion-fade-in {
        animation: bw-fade-in var(--duration-base) var(--ease-out);
      }
    `;
    expect(() => assertNoLiteralMotion(src)).not.toThrow();
  });

  it('rejects a literal millisecond value', () => {
    const src = `.x { transition: opacity 250ms ease-out; }`;
    expect(() => assertNoLiteralMotion(src)).toThrow(/literal duration/i);
  });

  it('rejects a literal cubic-bezier', () => {
    const src = `.x { transition: opacity var(--duration-base) cubic-bezier(0.4, 0, 0.2, 1); }`;
    expect(() => assertNoLiteralMotion(src)).toThrow(/cubic-bezier/i);
  });

  it('rejects a bare ease keyword', () => {
    const src = `.x { transition: opacity var(--duration-base) ease; }`;
    expect(() => assertNoLiteralMotion(src)).toThrow(/bare easing keyword/i);
  });

  it('does not flag the keyword "ease" inside an --ease-* var name', () => {
    const src = `.x { animation: foo var(--duration-base) var(--ease-spring); }`;
    expect(() => assertNoLiteralMotion(src)).not.toThrow();
  });
});

describe('assertReducedMotionZeroesTokens', () => {
  it('accepts a block that zeroes all four duration tokens', () => {
    const src = `
      @media (prefers-reduced-motion: reduce) {
        :root {
          --duration-fast: 0ms;
          --duration-base: 0ms;
          --duration-slow: 0ms;
          --duration-slower: 0ms;
        }
      }
    `;
    expect(() => assertReducedMotionZeroesTokens(src)).not.toThrow();
  });

  it('rejects a block missing one of the duration tokens', () => {
    const src = `
      @media (prefers-reduced-motion: reduce) {
        :root {
          --duration-fast: 0ms;
          --duration-base: 0ms;
          --duration-slow: 0ms;
        }
      }
    `;
    expect(() => assertReducedMotionZeroesTokens(src)).toThrow(/--duration-slower/);
  });

  it('rejects when a duration token is not 0ms inside the block', () => {
    const src = `
      @media (prefers-reduced-motion: reduce) {
        :root {
          --duration-fast: 0ms;
          --duration-base: 0ms;
          --duration-slow: 0ms;
          --duration-slower: 100ms;
        }
      }
    `;
    expect(() => assertReducedMotionZeroesTokens(src)).toThrow(/--duration-slower/);
  });

  it('rejects when no reduced-motion @media block is present', () => {
    const src = `:root { --duration-fast: 120ms; }`;
    expect(() => assertReducedMotionZeroesTokens(src)).toThrow(/prefers-reduced-motion/);
  });
});
```

- [ ] **Step 5.2: Run the tests and verify they fail**

```bash
pnpm test --run src/shared/motion/contracts.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 5.3: Write the minimal implementation**

```ts
// src/shared/motion/contracts.ts
const LITERAL_MS_RE = /(?<![A-Za-z0-9_-])([0-9]+(?:\.[0-9]+)?)\s*ms\b/;
const LITERAL_S_RE = /(?<![A-Za-z0-9_-])([0-9]+(?:\.[0-9]+)?)\s*s\b/;
const CUBIC_BEZIER_RE = /cubic-bezier\s*\(/;
// Bare ease keywords are flagged unless they are inside `var(--ease-...)`.
// We rely on stripping `var(--ease-...)` first, then scanning for bare ease.
const BARE_EASE_RE = /\b(ease|ease-in|ease-out|ease-in-out)\b/;

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripVarReferences(src: string): string {
  // Replace `var(--anything)` with a placeholder so its inner ease-keyword
  // tokens (e.g., `--ease-out`) do not register as bare ease usage.
  return src.replace(/var\s*\(\s*[^)]*\)/g, 'VAR_REF');
}

export function assertNoLiteralMotion(cssSource: string): void {
  const cleaned = stripVarReferences(stripCssComments(cssSource));

  const ms = LITERAL_MS_RE.exec(cleaned);
  if (ms) {
    throw new Error(
      `motion contract: literal duration "${ms[0]}" found — use a --duration-* token`,
    );
  }

  // Reject literal seconds except `0s` (acceptable as a zero default).
  const sMatch = LITERAL_S_RE.exec(cleaned);
  if (sMatch && sMatch[1] !== '0') {
    throw new Error(
      `motion contract: literal duration "${sMatch[0]}" found — use a --duration-* token`,
    );
  }

  if (CUBIC_BEZIER_RE.test(cleaned)) {
    throw new Error(
      'motion contract: literal cubic-bezier(...) found — use a --ease-* token',
    );
  }

  if (BARE_EASE_RE.test(cleaned)) {
    throw new Error(
      'motion contract: bare easing keyword (ease/ease-in/ease-out/ease-in-out) found — use a --ease-* token',
    );
  }
}

const REDUCED_BLOCK_RE =
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/;
const REQUIRED_DURATIONS = [
  '--duration-fast',
  '--duration-base',
  '--duration-slow',
  '--duration-slower',
] as const;

export function assertReducedMotionZeroesTokens(tokensSource: string): void {
  const block = REDUCED_BLOCK_RE.exec(tokensSource);
  if (!block) {
    throw new Error(
      'motion contract: no `@media (prefers-reduced-motion: reduce)` block found in tokens source',
    );
  }
  const inner = block[1];
  for (const tok of REQUIRED_DURATIONS) {
    const re = new RegExp(`${tok}\\s*:\\s*([^;]+);`);
    const m = re.exec(inner);
    if (!m) {
      throw new Error(
        `motion contract: ${tok} is not set inside the reduced-motion block`,
      );
    }
    if (m[1].trim() !== '0ms') {
      throw new Error(
        `motion contract: ${tok} inside reduced-motion block is "${m[1].trim()}", expected "0ms"`,
      );
    }
  }
}
```

- [ ] **Step 5.4: Run the tests and verify they pass**

```bash
pnpm test --run src/shared/motion/contracts.test.ts
```

Expected: 9 PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/shared/motion/contracts.ts src/shared/motion/contracts.test.ts
git commit -m "feat(motion): contract test helpers for tokenization + reduced-motion (Phase 6.1.1)"
```

---

## Task 6 — `motion.test.ts` parametrized tests against the real `motion.css`

**Files:**
- Create: `src/design-system/motion.test.ts`

This test reads the actual `motion.css` and `tokens.css` files via `node:fs` and runs the contract helpers against them. It also asserts the expected utility class names exist.

- [ ] **Step 6.1: Write the failing test**

```ts
// src/design-system/motion.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertNoLiteralMotion,
  assertReducedMotionZeroesTokens,
} from '@/shared/motion/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const motionCss = readFileSync(resolve(here, 'motion.css'), 'utf8');
const tokensCss = readFileSync(resolve(here, 'tokens.css'), 'utf8');

const PRIMITIVE_CLASSES = [
  '.motion-fade-in',
  '.motion-rise',
  '.motion-sheet-in',
  '.motion-scrim-in',
  '.motion-toast-in',
  '.motion-pulse',
  '.motion-rule-grow',
  '.motion-breath',
  '.motion-hover-bg',
  '.motion-press',
] as const;

describe('motion.css contracts', () => {
  it('uses no literal durations or easings', () => {
    expect(() => assertNoLiteralMotion(motionCss)).not.toThrow();
  });

  it.each(PRIMITIVE_CLASSES)(
    'declares a rule for %s',
    (cls) => {
      expect(motionCss).toContain(`${cls} {`);
    },
  );
});

describe('tokens.css reduced-motion contract', () => {
  it('zeroes all four --duration-* tokens under prefers-reduced-motion', () => {
    expect(() => assertReducedMotionZeroesTokens(tokensCss)).not.toThrow();
  });
});
```

- [ ] **Step 6.2: Run the test and verify it passes**

The contract helpers (Task 5) and `motion.css` (Task 4) are already in place, so this should pass on first run.

```bash
pnpm test --run src/design-system/motion.test.ts
```

Expected: 12 PASS (1 + 10 primitives + 1).

- [ ] **Step 6.3: Commit**

```bash
git add src/design-system/motion.test.ts
git commit -m "test(motion): assert motion.css and tokens.css honor the contracts (Phase 6.1.1)"
```

---

## Task 7 — `e2e/motion-tokens.spec.ts` baseline

**Files:**
- Create: `e2e/motion-tokens.spec.ts`

A deliberately small e2e net: load the app, sample three known surfaces (the library chrome root, the import-tray drop-overlay if visible, and the suggested-prompts container if reachable), and assert their inline `style` attributes contain no literal `ms` or `cubic-bezier`. The goal is regression-catching for accidental future inline-style usage, not exhaustive coverage.

- [ ] **Step 7.1: Inspect the existing e2e files for the import patterns used**

```bash
sed -n '1,30p' e2e/axe.spec.ts
```

Read the imports and `test.describe` style; mirror it.

- [ ] **Step 7.2: Write the e2e test**

```ts
// e2e/motion-tokens.spec.ts
import { expect, test } from '@playwright/test';

const LITERAL_MS = /\b\d+(?:\.\d+)?ms\b/;
const CUBIC_BEZIER = /cubic-bezier\s*\(/;

test.describe('motion tokens', () => {
  test('library chrome has no literal ms or cubic-bezier in inline styles', async ({ page }) => {
    await page.goto('/');
    // Wait for the library shell to render. Adjust selector if the app's
    // top-level test id differs; this is a best-effort sample, not a deep
    // inspection.
    const shell = page.locator('[data-testid="library-chrome"], .library-chrome').first();
    await expect(shell).toBeVisible();

    const inlineStyle = (await shell.getAttribute('style')) ?? '';
    expect(inlineStyle).not.toMatch(LITERAL_MS);
    expect(inlineStyle).not.toMatch(CUBIC_BEZIER);
  });

  test('document-level CSS variables expose the four duration tokens', async ({ page }) => {
    await page.goto('/');
    const tokens = await page.evaluate(() => {
      const cs = window.getComputedStyle(document.documentElement);
      return {
        fast: cs.getPropertyValue('--duration-fast').trim(),
        base: cs.getPropertyValue('--duration-base').trim(),
        slow: cs.getPropertyValue('--duration-slow').trim(),
        slower: cs.getPropertyValue('--duration-slower').trim(),
      };
    });
    expect(tokens.fast).toMatch(/^\d+ms$/);
    expect(tokens.base).toMatch(/^\d+ms$/);
    expect(tokens.slow).toMatch(/^\d+ms$/);
    expect(tokens.slower).toMatch(/^\d+ms$/);
  });
});
```

> **Note for the engineer:** if the first test cannot find a `.library-chrome` (selector may differ), fall back to `page.locator('main, [role="main"]').first()`. The intent is "any top-level surface" — do not invent a new test id.

- [ ] **Step 7.3: Build the dist (Playwright runs against `pnpm preview`)**

Per repo memory: rebuild dist before `test:e2e`.

```bash
pnpm build
```

Expected: build succeeds.

- [ ] **Step 7.4: Run the new e2e test**

```bash
pnpm test:e2e e2e/motion-tokens.spec.ts
```

Expected: 2 PASS.

If the first test fails with "selector not visible," update the selector per the Step 7.2 note, rebuild, and re-run.

- [ ] **Step 7.5: Commit**

```bash
git add e2e/motion-tokens.spec.ts
git commit -m "test(motion): e2e baseline asserting tokens are exposed and no literal motion (Phase 6.1.1)"
```

---

## Task 8 — Document the Motion vocabulary in `docs/05-design-system.md`

**Files:**
- Modify: `docs/05-design-system.md`

The existing "Motion rules" section (a short bullet list) is replaced with a longer, structured "Motion" section. The replacement keeps the existing principles but adds the vocabulary, primitive table, hover/press canon, stagger pattern, View Transitions usage, reduced-motion guarantee, and a do/don't list.

- [ ] **Step 8.1: Read the current "Motion rules" section to know what is being replaced**

```bash
grep -n "## Motion rules" docs/05-design-system.md
```

Note the line range (the section ends where the next `## ` heading begins).

- [ ] **Step 8.2: Replace the section**

In `docs/05-design-system.md`, find the block:

```markdown
## Motion rules
- prefer opacity, transform, blur, scale
- avoid large bouncy motion
- keep durations short and calm
- preserve spatial continuity
- transitions should clarify structure
```

Replace it with:

```markdown
## Motion

### Principles
- Prefer opacity, transform, blur, scale.
- Calm and refined; avoid bouncy or attention-stealing motion.
- Keep durations short and on-token.
- Motion clarifies structure and supports comprehension; it never decorates.
- Reduced motion is honored automatically — see below.

### Tokens
Durations (defined in `src/design-system/tokens.css`):
- `--duration-fast` 120ms — instant feedback (hover background, focus ring tint)
- `--duration-base` 200ms — standard affordance (press, scrim fade, plain fade-in)
- `--duration-slow` 320ms — considered surface change (sheet, modal, toast, pulse)
- `--duration-slower` 480ms — one-shot reveal (empty-state, drop-overlay)

Curves (defined in `src/design-system/tokens.css`):
- `--ease-out` — default. Hover, press, fade, rise, scrim, pulse, transitions.
- `--ease-in-out` — infinite loops only (typing caret, future skeleton shimmer).
- `--ease-spring` — exclusively for focal arrivals (sheet, modal, toast).

### Primitives (`src/design-system/motion.css`)
Apply via utility class. Do not redeclare these keyframes in feature CSS.

| Class | Effect | Duration / Curve |
|---|---|---|
| `.motion-fade-in` | opacity 0→1 | base / out |
| `.motion-rise` | translateY(8px) + opacity | slower / out |
| `.motion-sheet-in` | translateY(100%) → 0 | slow / spring |
| `.motion-scrim-in` | opacity 0→1 (backdrop) | base / out |
| `.motion-toast-in` | translateY(-8px) + opacity | slow / spring |
| `.motion-pulse` | scale 1 → 1.04 → 1 | slow / out |
| `.motion-rule-grow` | scaleX 0 → 1 (origin: left) | slower / out |
| `.motion-breath` | opacity loop, infinite | base × 7 / in-out |

### Hover and press canon
Hover and press are documented declarations rather than keyframes. Helper classes are provided in `motion.css`; an inline declaration that uses the same tokens is equally valid.

- Hover (`.motion-hover-bg`): `transition: background var(--duration-fast) var(--ease-out);`
- Press (`.motion-press`): `transition: transform var(--duration-base) var(--ease-out);` paired with `:active { transform: scale(0.98); }` where pressable.

The rule is the tokens, not the class.

### Stagger pattern
When several primitives land together, apply `animation-delay` in token-multiples:

```css
.empty-item:nth-child(2) { animation-delay: calc(var(--duration-fast) * 1); }
.empty-item:nth-child(3) { animation-delay: calc(var(--duration-fast) * 2); }
```

Token-multiples zero correctly under reduced-motion because the underlying token zeroes.

### View Transitions
Cross-surface transitions (library↔reader, panel open/close, modal open/close, notebook open) use the View Transitions API via `useViewTransition` in `src/shared/motion/`. Names live in `viewTransitionNames.ts`. Per-instance names (e.g. a specific book card) are built with the `libraryCard…` helper. Only the outermost modal in z-order should claim `modal-root`.

### Reduced motion
The single source of truth is `tokens.css`: under `prefers-reduced-motion: reduce` all four `--duration-*` tokens become `0ms`. Any animation built on tokens — including primitives, helper classes, hover/press, and `animation-delay` token-multiples — is automatically suppressed. Authors do **not** need to write per-component `@media` overrides. The `useViewTransition` hook performs an analogous check and runs the updater synchronously, because the View Transitions API does not auto-honor reduced-motion when timing is customized.

### Do / Don't
- Do reach for tokens or primitives. Do not write literal `ms` or `cubic-bezier(...)` values.
- Do use `--ease-spring` only for focal arrivals (sheet, modal, toast). Default to `--ease-out`.
- Do remove redundant `@media (prefers-reduced-motion: reduce) { animation: none; }` blocks once a surface is fully tokenized.
- Don't add JS-driven physics or third-party motion libraries.
- Don't over-animate. The product should feel calm in regular motion mode.
```

- [ ] **Step 8.3: Verify the doc still renders cleanly**

```bash
grep -c "^## " docs/05-design-system.md
```

Expected: count is unchanged or +0 (we replaced one heading with one heading).

- [ ] **Step 8.4: Commit**

```bash
git add docs/05-design-system.md
git commit -m "docs(motion): expand design-system motion section with vocabulary + primitives (Phase 6.1.1)"
```

---

## Task 9 — Final quality gate and PR

**Files:** none modified

- [ ] **Step 9.1: Run the full project check**

```bash
pnpm check
```

Expected: PASS (`type-check` + `lint` + unit tests).

- [ ] **Step 9.2: Re-run the new e2e baseline against fresh dist**

```bash
pnpm build && pnpm test:e2e e2e/motion-tokens.spec.ts
```

Expected: 2 PASS.

- [ ] **Step 9.3: Update the roadmap status line**

Edit `docs/04-implementation-roadmap.md`. Find the `## Status` block; add a new line under the most recent entry:

```markdown
- Phase 6.1.1 motion-foundation — complete (2026-MM-DD)
```

(Use the actual completion date.)

- [ ] **Step 9.4: Commit the roadmap update**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "docs(roadmap): mark Phase 6.1.1 motion-foundation complete"
```

- [ ] **Step 9.5: Push and open the PR**

```bash
git push -u origin phase-6-1-1-motion-foundation
gh pr create --title "feat(motion): Phase 6.1.1 — motion-language foundation" --body "$(cat <<'EOF'
## Summary
- New `src/design-system/motion.css` with 8 primitive utility classes wired to existing tokens.
- New `src/shared/motion/` module: `useViewTransition` hook (with reduced-motion + API-absent fallbacks), `viewTransitionNames` constants, and `contracts` test helpers.
- New `src/design-system/motion.test.ts` and `e2e/motion-tokens.spec.ts` regression net.
- Expanded "Motion" section in `docs/05-design-system.md`.

No existing surface is modified in this PR. Migrations land in 6.1.2; View Transitions wiring in 6.1.3.

Spec: `docs/superpowers/specs/2026-05-10-phase-6-1-motion-language-design.md`.

## Test plan
- [ ] `pnpm check` passes
- [ ] `pnpm test:e2e e2e/motion-tokens.spec.ts` passes
- [ ] Inspect `docs/05-design-system.md` Motion section renders correctly on GitHub
- [ ] Confirm the dev server loads without console warnings about missing CSS

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9.6: Verify CI passes on the PR before requesting review**

```bash
gh pr checks --watch
```

Expected: all checks green.

---

## Acceptance summary

This plan is complete when:
- All 9 tasks are checked off and committed.
- `pnpm check` is green.
- `pnpm test:e2e e2e/motion-tokens.spec.ts` is green.
- The PR description above accurately reflects what shipped.
- `docs/04-implementation-roadmap.md` lists Phase 6.1.1 as complete.

Plans for 6.1.2 (migration + gaps) and 6.1.3 (View Transitions wiring) follow this PR's merge.
