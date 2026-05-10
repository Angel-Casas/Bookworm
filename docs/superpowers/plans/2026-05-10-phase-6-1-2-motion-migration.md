# Phase 6.1.2 — Motion Migration + Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every animated surface in `src/` to consume the shared motion primitives from 6.1.1, fill motion into currently-static surfaces, and tighten the regression net so no literal motion strings remain in the codebase.

**Architecture:** Two parallel work streams. (1) **Migration:** for each existing `@keyframes` + local `animation:` block, replace with the matching `.motion-*` utility class on the JSX element; remove the local keyframe and the redundant `@media (prefers-reduced-motion: reduce)` block. (2) **Gaps:** for currently-static surfaces, add the appropriate primitive class on mount. Tests gain a parametrized contract over every migrated CSS file; the e2e baseline gains a strict "no inline literal motion anywhere on the page" sweep.

**Tech Stack:** Vanilla CSS, TypeScript strict, React 19, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-10-phase-6-1-motion-language-design.md` (§5 6.1.2, §6).

**Branch:** `phase-6-1-2-motion-migration`

---

## Migration pattern (applied across Tasks 3–11)

For each existing animated surface:

1. Identify the JSX consumer rendering the animated element.
2. Add the matching `.motion-*` class to that element's `className` (concatenate with existing classes; do not replace).
3. In the CSS file:
   - Remove the local `@keyframes <name>` block.
   - Remove the local `animation: <name> ...` declaration on the affected selector(s).
   - Remove the local `@media (prefers-reduced-motion: reduce)` block (the global token override now handles it).
4. If the original keyframe set initial transform/opacity values that the primitive does not, decide: keep the visual difference (slight motion change documented in the task) or apply the small extra style outside the animation (e.g. as a static initial style overridden by the primitive).
5. Verify in dev: animation still fires on mount; reduced-motion suppresses it.

---

## Gap-fill pattern (applied across Tasks 12–17)

For each currently-static surface that should gain motion:

1. Identify the JSX consumer for the surface.
2. Add the appropriate `.motion-*` class to the right element (typically the surface root or its enter point).
3. No CSS keyframe is added — the primitives already exist.
4. Press affordances: add `.motion-press` to interactive elements where pressing should give visible feedback.

---

## Task 1 — Branch from latest main

**Files:** none

- [ ] **Step 1.1: Sync and branch**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b phase-6-1-2-motion-migration
```

- [ ] **Step 1.2: Confirm 6.1.1 is in main**

```bash
test -f src/design-system/motion.css && test -f src/shared/motion/contracts.ts && echo "6.1.1 foundation present"
```

Expected: `6.1.1 foundation present`. If the files are missing, abort — 6.1.1 must be merged first.

---

## Task 2 — Cross-cutting hover-affordance unify (`--duration-base` → `--duration-fast`)

The audit's F1.5 surfaced the inconsistency: chat / library / right-rail use `--duration-base` for hover affordances; reader-chrome uses `--duration-fast`. Spec §2 unifies on `--duration-fast`.

**Files to touch:**
- `src/features/ai/chat/thread-list.css` (lines 28, 76, 133)
- `src/features/reader/workspace/right-rail.css` (lines 34, 67)
- `src/features/library/library-chrome.css` (line 30)
- `src/features/library/book-card.css` (line 93 — the **opacity** transition only; line 20's transform-press stays at `--duration-base` per the press canon)

- [ ] **Step 2.1: Update `thread-list.css` hover transitions**

Replace **all three** occurrences of `var(--duration-base)` with `var(--duration-fast)` in this file:

```bash
sed -i.bak 's|transition: \(background-color\|opacity\|color\) var(--duration-base) var(--ease-out);|transition: \1 var(--duration-fast) var(--ease-out);|g' src/features/ai/chat/thread-list.css
rm src/features/ai/chat/thread-list.css.bak
grep -n "duration-base" src/features/ai/chat/thread-list.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 2.2: Update `right-rail.css` hover transitions**

```bash
sed -i.bak 's|transition: color var(--duration-base) var(--ease-out);|transition: color var(--duration-fast) var(--ease-out);|g' src/features/reader/workspace/right-rail.css
rm src/features/reader/workspace/right-rail.css.bak
grep -n "duration-base" src/features/reader/workspace/right-rail.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 2.3: Update `library-chrome.css` border-color hover**

```bash
sed -i.bak 's|transition: border-color var(--duration-base) var(--ease-out);|transition: border-color var(--duration-fast) var(--ease-out);|g' src/features/library/library-chrome.css
rm src/features/library/library-chrome.css.bak
grep -n "duration-base" src/features/library/library-chrome.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 2.4: Update `book-card.css:93` opacity hover (NOT the transform press on line 20)**

Open `src/features/library/book-card.css`. Find the line:

```css
  transition: opacity var(--duration-base) var(--ease-out);
```

Replace with:

```css
  transition: opacity var(--duration-fast) var(--ease-out);
```

(Only this occurrence. The `transition: transform var(--duration-base) var(--ease-out);` on line 20 is press affordance per spec §2 — leave it.)

```bash
grep -n "duration-base" src/features/library/book-card.css
```

Expected: only line 20 (the transform/press transition) — line 93 should be gone.

- [ ] **Step 2.5: Run quality gate**

```bash
pnpm type-check && pnpm lint
```

Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
git add src/features/ai/chat/thread-list.css src/features/reader/workspace/right-rail.css src/features/library/library-chrome.css src/features/library/book-card.css
git commit -m "feat(motion): unify hover affordances on --duration-fast (Phase 6.1.2)"
```

---

## Task 3 — Migrate `reader-chrome.css` bookmark-pulse → `.motion-pulse`

**Files:**
- Modify: `src/features/reader/reader-chrome.css`
- Modify: the consumer that adds `.reader-chrome__bookmark--pulse` (find it in Step 3.1)

- [ ] **Step 3.1: Locate the consumer**

```bash
grep -rn "reader-chrome__bookmark--pulse" --include="*.tsx" --include="*.ts" src/
```

Note the file/line where the class is applied. The existing class triggers the pulse; the migration adds `.motion-pulse` alongside (or replaces if the bookmark icon needs only the pulse animation and no other styling).

- [ ] **Step 3.2: Update the JSX consumer**

In the consumer file (likely `ReaderChrome.tsx`), find the className that includes `reader-chrome__bookmark--pulse` and add `motion-pulse` to it. Example (your code may use template literals or `clsx` — match the project's idiom):

Before:
```tsx
className={`reader-chrome__bookmark${isPulsing ? ' reader-chrome__bookmark--pulse' : ''}`}
```

After:
```tsx
className={`reader-chrome__bookmark${isPulsing ? ' reader-chrome__bookmark--pulse motion-pulse' : ''}`}
```

- [ ] **Step 3.3: Remove the local keyframe and reduced-motion block in `reader-chrome.css`**

Open `src/features/reader/reader-chrome.css`. Delete this block:

```css
@keyframes reader-chrome-bookmark-pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

.reader-chrome__bookmark--pulse {
  animation: reader-chrome-bookmark-pulse var(--duration-slow) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .reader-chrome__bookmark--pulse {
    animation: none;
  }
}
```

(Note: `.motion-pulse` peaks at 1.04× scale rather than the previous 1.2×. This is an intentional tone change — calmer pulse — and aligns with the spec's "calm and refined" principle.)

- [ ] **Step 3.4: Verify the file is still well-formed**

```bash
grep -n "@keyframes\|@media (prefers-reduced-motion" src/features/reader/reader-chrome.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3.5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add src/features/reader/reader-chrome.css src/features/reader/ReaderChrome.tsx
git commit -m "feat(motion): migrate reader-chrome bookmark pulse to .motion-pulse (Phase 6.1.2)"
```

(If the consumer file path differs from `ReaderChrome.tsx`, adjust the `git add` command accordingly.)

---

## Task 4 — Migrate `mobile-sheet.css` to `.motion-sheet-in` + `.motion-scrim-in`

**Files:**
- Modify: `src/features/reader/workspace/mobile-sheet.css`
- Modify: `src/features/reader/workspace/MobileSheet.tsx` (or the consumer)

- [ ] **Step 4.1: Locate the consumer**

```bash
grep -rn "className=\"mobile-sheet\\b\\|mobile-sheet__scrim" --include="*.tsx" src/
```

- [ ] **Step 4.2: Add primitive classes in the consumer**

In `MobileSheet.tsx`, change:

Before:
```tsx
<div className="mobile-sheet__scrim" ... />
<div className="mobile-sheet" ... />
```

After:
```tsx
<div className="mobile-sheet__scrim motion-scrim-in" ... />
<div className="mobile-sheet motion-sheet-in" ... />
```

- [ ] **Step 4.3: Remove local animations and reduced-motion block from `mobile-sheet.css`**

In `src/features/reader/workspace/mobile-sheet.css`:

Remove the line on `.mobile-sheet__scrim`:
```css
animation: mobile-sheet-scrim-in var(--duration-base) var(--ease-out);
```

Remove the line on `.mobile-sheet`:
```css
animation: mobile-sheet-in var(--duration-slow) var(--ease-out);
```

Remove the keyframes:
```css
@keyframes mobile-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes mobile-sheet-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

Remove the reduced-motion block:
```css
@media (prefers-reduced-motion: reduce) {
  .mobile-sheet,
  .mobile-sheet__scrim {
    animation: none;
  }
}
```

(Note: `.motion-sheet-in` uses `--ease-spring` — a focal-arrival recipe per spec — versus the prior `--ease-out`. This is the intentional spec change.)

- [ ] **Step 4.4: Verify clean file**

```bash
grep -n "@keyframes\|animation:\|@media (prefers-reduced-motion" src/features/reader/workspace/mobile-sheet.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 4.5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/features/reader/workspace/mobile-sheet.css src/features/reader/workspace/MobileSheet.tsx
git commit -m "feat(motion): migrate mobile-sheet to .motion-sheet-in + .motion-scrim-in (Phase 6.1.2)"
```

---

## Task 5 — Migrate `workspace.css` chrome-fade + hint-fade → `.motion-fade-in`

**Files:**
- Modify: `src/features/reader/workspace/workspace.css`
- Modify: the consumer (likely `ReaderWorkspace.tsx`) — note that `chrome-fade-in` is keyed off `[data-mode='focus']` so the class application is conditional.

- [ ] **Step 5.1: Locate consumers**

```bash
grep -rn "reader-workspace__hint\|reader-chrome\\b" --include="*.tsx" src/features/reader/workspace/
```

### Why two approaches in this task

The `chrome-fade-in` rule is conditional on `[data-mode='focus']` (a CSS attribute selector). Adding a `.motion-fade-in` class via JSX would require ReaderWorkspace to know when to apply it — duplicating logic that lives in CSS today. Instead we **keep the conditional CSS rule** but rewrite its `animation:` declaration to consume the primitive's `bw-fade-in` keyframe directly. The contract `assertNoLiteralMotion` still passes (no literal ms / cubic-bezier).

The `hint` element is unconditional — every render shows it, then it dismisses. For that we **add `.motion-fade-in` via JSX** and remove the CSS animation entirely.

- [ ] **Step 5.2: Apply `.motion-fade-in` to `.reader-workspace__hint` consumer**

```tsx
<div className="reader-workspace__hint motion-fade-in">{...}</div>
```

- [ ] **Step 5.3: Rewrite chrome-fade animation to consume the primitive's keyframe; strip hint-fade entirely; strip the reduced-motion block**

In `src/features/reader/workspace/workspace.css`:

Change the `.reader-workspace[data-mode='focus'] .reader-chrome` rule's animation line:

Before:
```css
animation: chrome-fade-in var(--duration-base) var(--ease-out);
```

After:
```css
animation: bw-fade-in var(--duration-base) var(--ease-out);
```

(This re-uses `bw-fade-in` from `motion.css`; no local keyframe needed.)

Strip the `animation:` line on `.reader-workspace__hint` entirely (handled by the JSX class added in Step 5.2):

Remove:
```css
animation: hint-fade-in var(--duration-base) var(--ease-out);
```

Remove both keyframe blocks:
```css
@keyframes chrome-fade-in { ... }
@keyframes hint-fade-in { ... }
```

Remove the reduced-motion block:
```css
@media (prefers-reduced-motion: reduce) {
  .reader-workspace[data-mode='focus'] .reader-chrome,
  .reader-workspace__hint {
    animation: none;
  }
}
```

(Tone change: `chrome-fade-in` had a `translateY(-100%)` slide; `bw-fade-in` is opacity only. `hint-fade-in` had a `translateY(-8px)` shift; `.motion-fade-in` is opacity only. Both drop their slide motion. If the chrome slide-in is meaningfully missed, a follow-up can introduce a dedicated `.motion-chrome-drop` primitive — but the spec calls for `.motion-fade-in` here.)

- [ ] **Step 5.4: Verify clean file**

```bash
grep -n "@keyframes chrome-fade\|@keyframes hint-fade\|@media (prefers-reduced-motion" src/features/reader/workspace/workspace.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 5.5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: PASS.

- [ ] **Step 5.6: Commit**

```bash
git add src/features/reader/workspace/workspace.css src/features/reader/workspace/ReaderWorkspace.tsx
git commit -m "feat(motion): migrate workspace chrome/hint fades to .motion-fade-in (Phase 6.1.2)"
```

---

## Task 6 — Migrate `library-empty-state.css` + `LibraryEmptyState.tsx` (rises, rule-grow, fade, token-stagger)

This is the largest single migration. Six elements get primitives; six inline `animationDelay` literals migrate to token-multiples.

**Files:**
- Modify: `src/features/library/library-empty-state.css`
- Modify: `src/features/library/LibraryEmptyState.tsx`

- [ ] **Step 6.1: Update `LibraryEmptyState.tsx` className strings + inline delays**

Read the file first if needed. Then make these substitutions (preserve all other props):

`.library-empty__mark`:
```diff
- className="library-empty__mark"
- ...
- style={{ animationDelay: '80ms' }}
+ className="library-empty__mark motion-rise"
+ style={{ animationDelay: 'calc(var(--duration-fast) * 0)' }}
```

(Equivalent to no delay; we keep the inline declaration for explicitness and to make the cascade visible at the call site.)

`.library-empty__wordmark`:
```diff
- className="library-empty__wordmark"
- ...
- style={{ animationDelay: '240ms' }}
+ className="library-empty__wordmark motion-rise"
+ style={{ animationDelay: 'calc(var(--duration-fast) * 1)' }}
```

`.library-empty__tagline`:
```diff
- className="library-empty__tagline"
- ...
- style={{ animationDelay: '400ms' }}
+ className="library-empty__tagline motion-rise"
+ style={{ animationDelay: 'calc(var(--duration-fast) * 2)' }}
```

`.library-empty__rule`:
```diff
- className="library-empty__rule"
- ...
- style={{ animationDelay: '560ms' }}
+ className="library-empty__rule motion-rule-grow"
+ style={{ animationDelay: 'calc(var(--duration-fast) * 3)' }}
```

`.library-empty__cta`:
```diff
- className="library-empty__cta"
- ...
- style={{ animationDelay: '660ms' }}
+ className="library-empty__cta motion-rise"
+ style={{ animationDelay: 'calc(var(--duration-fast) * 4)' }}
```

`.library-empty__privacy`:
```diff
- className="library-empty__privacy"
- ...
- style={{ animationDelay: '820ms' }}
+ className="library-empty__privacy motion-fade-in"
+ style={{ animationDelay: 'calc(var(--duration-fast) * 5)' }}
```

(Cascade is now even-stepped at 1× hover-time per item — slightly faster overall than the previous 80/240/400/560/660/820 cadence; uniformly readable.)

- [ ] **Step 6.2: Strip the local animations from `library-empty-state.css`**

In `src/features/library/library-empty-state.css`, for each of these selectors, REMOVE the `animation:` line AND any `opacity: 0` / `transform: translateY(...)` initial state declarations (the `.motion-rise` / `.motion-fade-in` / `.motion-rule-grow` primitives handle initial state through their `from` keyframes):

- `.library-empty__mark` — remove `opacity: 0; transform: translateY(6px) scale(0.96); animation: ...`
- `.library-empty__wordmark` — remove `opacity: 0; transform: translateY(8px); animation: ...`
- `.library-empty__tagline` — remove `opacity: 0; transform: translateY(8px); animation: ...`
- `.library-empty__rule` — remove `width: 0; animation: ...`. Replace with `width: 64px;` (the primitive's scaleX-from-0 produces the grow effect).
- `.library-empty__privacy` — remove `opacity: 0; animation: ...`
- `.library-empty__cta` — remove `opacity: 0; transform: translateY(8px); animation: ...`

Also remove these keyframes blocks at the end of the file:
```css
@keyframes library-empty-rise { ... }
@keyframes library-empty-rule-grow { ... }
@keyframes library-empty-fade { ... }
```

Also remove the entire `@media (prefers-reduced-motion: reduce)` block in this file.

(Note: `.library-empty__mark` previously had a small scale animation 0.96→1. After migration it uses `.motion-rise` which is translateY only. Tone change: cleaner, less ornament. Acceptable per spec's "calm" principle.)

- [ ] **Step 6.3: Verify clean file**

```bash
grep -n "@keyframes\|@media (prefers-reduced-motion\|^\s*animation:" src/features/library/library-empty-state.css || echo "clean"
```

Expected: `clean` (no remaining hits).

- [ ] **Step 6.4: Run unit tests + e2e to confirm 6.1.1's "no inline literal motion" baseline now passes — defer if 6.1.1's strict sweep is not yet enabled (it isn't; that's Task 19 here)**

```bash
pnpm type-check && pnpm lint
```

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/features/library/library-empty-state.css src/features/library/LibraryEmptyState.tsx
git commit -m "feat(motion): migrate library-empty-state to primitives + token-stagger (Phase 6.1.2)"
```

---

## Task 7 — Migrate `import-tray.css` → `.motion-rise`

**Files:**
- Modify: `src/features/library/import/import-tray.css`
- Modify: `src/features/library/import/ImportTray.tsx` (or wherever `.import-tray` is rendered)

- [ ] **Step 7.1: Locate the consumer**

```bash
grep -rn "className=\"import-tray\\b" --include="*.tsx" src/
```

- [ ] **Step 7.2: Add `.motion-rise` to the JSX**

In the consumer:

```diff
- <div className="import-tray">
+ <div className="import-tray motion-rise">
```

(Match the file's idiom — could be `<aside>`, `<section>`, or another tag.)

- [ ] **Step 7.3: Strip animation from CSS**

In `src/features/library/import/import-tray.css`:

Remove the line on `.import-tray`:
```css
animation: import-tray-in var(--duration-base) var(--ease-out) forwards;
```

Remove the keyframe:
```css
@keyframes import-tray-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

Remove the reduced-motion block:
```css
@media (prefers-reduced-motion: reduce) {
  .import-tray {
    animation: none;
  }
}
```

(Note: `import-tray-in` translated `-6px → 0`. `.motion-rise` translates `+8px → 0` — the tray now rises from below rather than dropping from above. If a downward-drop is preferred, keep a small local style that overrides: `.import-tray { transform: translateY(-6px); }` initially — but the simpler, more consistent choice is to accept the upward rise.)

- [ ] **Step 7.4: Verify clean file**

```bash
grep -n "@keyframes\|animation:\|@media (prefers-reduced-motion" src/features/library/import/import-tray.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 7.5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add src/features/library/import/import-tray.css src/features/library/import/ImportTray.tsx
git commit -m "feat(motion): migrate import-tray to .motion-rise (Phase 6.1.2)"
```

---

## Task 8 — Migrate `drop-overlay.css` → `.motion-fade-in`

The original `drop-overlay-in` keyframe is opacity 0→1 only (no transform). That maps exactly to `.motion-fade-in`, not `.motion-rise`.

**Files:**
- Modify: `src/features/library/drop-overlay.css`
- Modify: `src/features/library/DropOverlay.tsx` (or consumer)

- [ ] **Step 8.1: Locate the consumer**

```bash
grep -rn "className=\"drop-overlay\\b" --include="*.tsx" src/
```

- [ ] **Step 8.2: Add primitive class**

```diff
- <div className="drop-overlay">
+ <div className="drop-overlay motion-fade-in">
```

- [ ] **Step 8.3: Strip animation from CSS**

In `src/features/library/drop-overlay.css`:

Remove `animation: drop-overlay-in var(--duration-base) var(--ease-out) forwards;` from `.drop-overlay`.

Remove the keyframe `@keyframes drop-overlay-in { ... }`.

Remove the `@media (prefers-reduced-motion: reduce) { .drop-overlay { animation: none; } }` block.

- [ ] **Step 8.4: Verify clean file**

```bash
grep -n "@keyframes\|animation:\|@media (prefers-reduced-motion" src/features/library/drop-overlay.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 8.5: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/library/drop-overlay.css src/features/library/DropOverlay.tsx
git commit -m "feat(motion): migrate drop-overlay to .motion-fade-in (Phase 6.1.2)"
```

---

## Task 9 — Migrate `suggested-prompts.css` loading fade → `.motion-fade-in`

**Files:**
- Modify: `src/features/ai/prompts/suggested-prompts.css`
- Modify: `src/features/ai/prompts/SuggestedPrompts.tsx` (or consumer of `.suggested-prompts__loading`)

- [ ] **Step 9.1: Locate the consumer**

```bash
grep -rn "suggested-prompts__loading" --include="*.tsx" src/
```

- [ ] **Step 9.2: Apply primitive class**

```diff
- <div className="suggested-prompts__loading">
+ <div className="suggested-prompts__loading motion-fade-in">
```

- [ ] **Step 9.3: Strip animation from CSS**

In `src/features/ai/prompts/suggested-prompts.css`:

Remove the line on `.suggested-prompts__loading`:
```css
animation: suggested-prompts-fade-in var(--duration-base) var(--ease-out);
```

Remove the keyframe:
```css
@keyframes suggested-prompts-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

(There is no local `@media (prefers-reduced-motion)` block in this file — already addressed in 6.1.1 by F1.6's auto-dissolution.)

- [ ] **Step 9.4: Verify clean file**

```bash
grep -n "@keyframes\|^\s*animation:" src/features/ai/prompts/suggested-prompts.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 9.5: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/ai/prompts/suggested-prompts.css src/features/ai/prompts/SuggestedPrompts.tsx
git commit -m "feat(motion): migrate suggested-prompts loading to .motion-fade-in (Phase 6.1.2)"
```

---

## Task 10 — Migrate `message-bubble.css` typing caret → `.motion-breath`

**Files:**
- Modify: `src/features/ai/chat/message-bubble.css`
- Modify: `src/features/ai/chat/MessageBubble.tsx` (or consumer of `.message-bubble__caret`)

- [ ] **Step 10.1: Locate the consumer**

```bash
grep -rn "message-bubble__caret" --include="*.tsx" src/
```

- [ ] **Step 10.2: Apply primitive class**

```diff
- <span className="message-bubble__caret" aria-hidden="true" />
+ <span className="message-bubble__caret motion-breath" aria-hidden="true" />
```

- [ ] **Step 10.3: Strip animation from CSS**

In `src/features/ai/chat/message-bubble.css`:

Remove the `animation:` line on `.message-bubble__caret`:
```css
animation: bubble-caret 1.4s var(--ease-in-out) infinite;
```

Remove the keyframe:
```css
@keyframes bubble-caret {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
```

Remove the reduced-motion block:
```css
@media (prefers-reduced-motion: reduce) {
  .message-bubble__caret {
    animation: none;
    opacity: 0.7;
  }
}
```

(Note: `.motion-breath` runs at `calc(var(--duration-base) * 7)` = 1400ms — same cadence as `1.4s`. Behavior is preserved. Under reduced-motion the duration goes to `0ms * 7 = 0ms`, and the keyframe freezes at 100% — opacity 1.0. Slight difference from prior `opacity: 0.7` static; visually negligible.)

- [ ] **Step 10.4: Verify clean file**

```bash
grep -n "@keyframes bubble-caret\|@media (prefers-reduced-motion" src/features/ai/chat/message-bubble.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 10.5: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/ai/chat/message-bubble.css src/features/ai/chat/MessageBubble.tsx
git commit -m "feat(motion): migrate message-bubble typing caret to .motion-breath (Phase 6.1.2)"
```

---

## Task 11 — Migrate `sw-toast.css` → `.motion-rise`

**Files:**
- Modify: `src/pwa/sw-toast.css`
- Modify: `src/pwa/SwToast.tsx` (or consumer)

The original `sw-toast-in` animates `translateY(8px)` → 0 (rises up). The toast is bottom-anchored (`inset-block-end: var(--space-6)`), so an upward rise is the correct direction. `.motion-toast-in` slides downward from `translateY(-8px)`, which is intended for top-anchored toasts; it would read backwards here. Use **`.motion-rise`** for sw-toast — it preserves the original direction and uses `--ease-out` (calmer than `--ease-spring`, appropriate for an SW status toast which is informational rather than focal).

- [ ] **Step 11.1: Locate the consumer**

```bash
grep -rn "className=\"sw-toast\\b" --include="*.tsx" src/
```

- [ ] **Step 11.2: Apply primitive class**

```diff
- <div className="sw-toast" role="status">
+ <div className="sw-toast motion-rise" role="status">
```

- [ ] **Step 11.3: Strip animation from CSS**

In `src/pwa/sw-toast.css`:

Remove the line on `.sw-toast`:
```css
animation: sw-toast-in var(--duration-base) var(--ease-out);
```

Remove the keyframe:
```css
@keyframes sw-toast-in {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

Remove the reduced-motion block:
```css
@media (prefers-reduced-motion: reduce) {
  .sw-toast {
    animation: none;
  }
}
```

(Note: tone change is `--duration-base` `--ease-out` → `--duration-slower` `--ease-out` — slightly longer rise, matching the empty-state cadence. If too slow for an SW toast, the engineer may add `style={{ animationDuration: 'var(--duration-slow)' }}` inline for this consumer.)

- [ ] **Step 11.4: Verify clean file**

```bash
grep -n "@keyframes\|^\s*animation:\|@media (prefers-reduced-motion" src/pwa/sw-toast.css || echo "clean"
```

Expected: `clean`.

- [ ] **Step 11.5: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/pwa/sw-toast.css src/pwa/SwToast.tsx
git commit -m "feat(motion): migrate sw-toast to .motion-rise (Phase 6.1.2)"
```

---

## Task 12 — Add motion to `notebook-row.css` + `notebook-empty-state.css`

**Files:**
- Modify: `src/features/annotations/notebook/NotebookRow.tsx` (or consumer)
- Modify: `src/features/annotations/notebook/NotebookEmptyState.tsx` (or consumer)

(No CSS keyframes need to change — both surfaces are static today; we only add primitive classes on the JSX.)

- [ ] **Step 12.1: Add `.motion-fade-in` to notebook rows**

```bash
grep -rn "className=\"notebook-row\\b" --include="*.tsx" src/
```

In the consumer (a row component):

```diff
- <div className="notebook-row">
+ <div className="notebook-row motion-fade-in">
```

(Each row fades in on mount. When a notebook with many rows opens, the rows all fade in together — under reduced-motion they appear instantly. If a stagger reads better, the engineer may apply `style={{ animationDelay: 'calc(var(--duration-fast) * <index>)' }}` per row in a follow-up; not required here.)

- [ ] **Step 12.2: Add `.motion-press` to the row's primary action**

The row likely has a `<button className="notebook-row__content">` for opening. Add `motion-press`:

```diff
- <button className="notebook-row__content" ...>
+ <button className="notebook-row__content motion-press" ...>
```

- [ ] **Step 12.3: Add `.motion-rise` to the empty state**

```bash
grep -rn "className=\"notebook-empty-state\\b" --include="*.tsx" src/
```

In the consumer:

```diff
- <div className="notebook-empty-state">
+ <div className="notebook-empty-state motion-rise">
```

- [ ] **Step 12.4: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/annotations/notebook/NotebookRow.tsx src/features/annotations/notebook/NotebookEmptyState.tsx
git commit -m "feat(motion): add motion to notebook row + empty-state (Phase 6.1.2)"
```

---

## Task 13 — Add motion to settings views

**Files:**
- Modify: `src/features/ai/settings/SettingsView.tsx`
- Modify: `src/features/ai/settings/SettingsChrome.tsx` (back button gets press affordance)

- [ ] **Step 13.1: Add `.motion-fade-in` to settings content root**

```bash
grep -rn "className=\"settings-view\\b\\|className=\"settings-view__main" --include="*.tsx" src/
```

In `SettingsView.tsx`, find the main content root. Add `motion-fade-in`:

```diff
- <main className="settings-view__main">
+ <main className="settings-view__main motion-fade-in">
```

- [ ] **Step 13.2: Add `.motion-press` to back button + any action buttons**

In `SettingsChrome.tsx`:

```diff
- <button className="settings-chrome__back" ...>
+ <button className="settings-chrome__back motion-press" ...>
```

- [ ] **Step 13.3: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/ai/settings/SettingsView.tsx src/features/ai/settings/SettingsChrome.tsx
git commit -m "feat(motion): fade-in settings content + press affordance on chrome (Phase 6.1.2)"
```

---

## Task 14 — Add motion to `route-loading`

**Files:**
- Modify: `src/app/RouteLoading.tsx`

- [ ] **Step 14.1: Add `.motion-fade-in` to the loading copy**

The route-loading screen appears briefly during route transitions. Adding `.motion-fade-in` makes the copy fade in if the loader hangs around long enough to be perceived; under reduced-motion it appears instantly.

In `src/app/RouteLoading.tsx`, find:

```tsx
<p className="route-loading__copy">Loading&hellip;</p>
```

Replace with:

```tsx
<p className="route-loading__copy motion-fade-in">Loading&hellip;</p>
```

- [ ] **Step 14.2: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/app/RouteLoading.tsx
git commit -m "feat(motion): fade-in route-loading copy (Phase 6.1.2)"
```

---

## Task 15 — Add motion to `IndexInspectorChunkRow`

**Files:**
- Modify: `src/features/library/indexing/IndexInspectorChunkRow.tsx`

- [ ] **Step 15.1: Read the chunk-row component to find its root element**

```bash
sed -n '1,40p' src/features/library/indexing/IndexInspectorChunkRow.tsx
```

- [ ] **Step 15.2: Add `.motion-fade-in` to the row**

In the JSX root (likely a `<div className="index-inspector__chunk-row">`):

```diff
- <div className="index-inspector__chunk-row" ...>
+ <div className="index-inspector__chunk-row motion-fade-in" ...>
```

- [ ] **Step 15.3: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/library/indexing/IndexInspectorChunkRow.tsx
git commit -m "feat(motion): fade-in index-inspector chunk rows (Phase 6.1.2)"
```

---

## Task 16 — Add motion to `note-editor`

**Files:**
- Modify: `src/features/reader/NoteEditor.tsx`

- [ ] **Step 16.1: Locate the editor root**

```bash
grep -rn "className=\"note-editor\\b" --include="*.tsx" src/
```

- [ ] **Step 16.2: Add `.motion-fade-in` to the editor wrapper**

```diff
- <div className="note-editor">
+ <div className="note-editor motion-fade-in">
```

(The editor is a popover that mounts on demand; fade-in reads as a polite arrival.)

- [ ] **Step 16.3: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/reader/NoteEditor.tsx
git commit -m "feat(motion): fade-in note-editor on mount (Phase 6.1.2)"
```

---

## Task 17 — Add motion to book-card cover image (`BookCard.tsx`)

**Files:**
- Modify: `src/features/library/BookCard.tsx`

The cover `<img>` mounts when `coverUrl` resolves. Adding `.motion-fade-in` directly works because the element is fresh-mounted at that moment.

- [ ] **Step 17.1: Edit `BookCard.tsx`**

Find:

```tsx
{coverUrl ? (
  <img className="book-card__cover" src={coverUrl} alt="" />
) : (
```

Replace with:

```tsx
{coverUrl ? (
  <img className="book-card__cover motion-fade-in" src={coverUrl} alt="" />
) : (
```

- [ ] **Step 17.2: Type-check + lint + commit**

```bash
pnpm type-check && pnpm lint
git add src/features/library/BookCard.tsx
git commit -m "feat(motion): fade-in book-card cover image on load (Phase 6.1.2)"
```

---

## Task 18 — Extend `motion.test.ts` to enforce contracts on every migrated CSS file

The 6.1.1 motion.test.ts only checks `motion.css` itself. Now extend it to a parametrized list covering every migrated and gap-filled CSS file. Two assertions per file:
- `assertNoLiteralMotion` — no literal ms / cubic-bezier / bare ease.
- `assertNoLocalReducedMotionBlock` — no `@media (prefers-reduced-motion: reduce)` block (the global token override is the single source of truth in migrated files).

**Files:**
- Modify: `src/shared/motion/contracts.ts` (add the new helper)
- Modify: `src/shared/motion/contracts.test.ts` (test the new helper)
- Modify: `src/design-system/motion.test.ts` (parametrize over migrated files)

- [ ] **Step 18.1: Write the failing test for `assertNoLocalReducedMotionBlock`**

In `src/shared/motion/contracts.test.ts`, append:

```ts
import { assertNoLocalReducedMotionBlock } from './contracts';

describe('assertNoLocalReducedMotionBlock', () => {
  it('accepts a file without any reduced-motion block', () => {
    const src = `.x { color: red; }`;
    expect(() => {
      assertNoLocalReducedMotionBlock(src);
    }).not.toThrow();
  });

  it('rejects a file containing a reduced-motion block', () => {
    const src = `
      .x { animation: y var(--duration-base); }
      @media (prefers-reduced-motion: reduce) {
        .x { animation: none; }
      }
    `;
    expect(() => {
      assertNoLocalReducedMotionBlock(src);
    }).toThrow(/local @media \(prefers-reduced-motion/i);
  });
});
```

- [ ] **Step 18.2: Run the failing test**

```bash
pnpm test --run src/shared/motion/contracts.test.ts
```

Expected: 2 new tests FAIL (export not found), 9 prior PASS.

- [ ] **Step 18.3: Add the helper to `contracts.ts`**

In `src/shared/motion/contracts.ts`, append:

```ts
const LOCAL_REDUCED_BLOCK_RE =
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/;

export function assertNoLocalReducedMotionBlock(cssSource: string): void {
  if (LOCAL_REDUCED_BLOCK_RE.test(cssSource)) {
    throw new Error(
      'motion contract: local @media (prefers-reduced-motion: reduce) block found — the global token override in tokens.css is the single source of truth; remove this local block',
    );
  }
}
```

- [ ] **Step 18.4: Run the test, verify it passes**

```bash
pnpm test --run src/shared/motion/contracts.test.ts
```

Expected: 11 PASS.

- [ ] **Step 18.5: Extend `motion.test.ts` with a parametrized contract over migrated files**

Replace the contents of `src/design-system/motion.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertNoLiteralMotion,
  assertNoLocalReducedMotionBlock,
  assertReducedMotionZeroesTokens,
} from '@/shared/motion/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

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

// CSS files that have been migrated to consume motion primitives. After
// migration each must (1) contain no literal ms/cubic-bezier/bare-ease
// strings and (2) contain no local prefers-reduced-motion @media block.
const MIGRATED_CSS_FILES = [
  'features/reader/reader-chrome.css',
  'features/reader/workspace/mobile-sheet.css',
  'features/reader/workspace/workspace.css',
  'features/library/library-empty-state.css',
  'features/library/import/import-tray.css',
  'features/library/drop-overlay.css',
  'features/ai/prompts/suggested-prompts.css',
  'features/ai/chat/message-bubble.css',
  'pwa/sw-toast.css',
  // hover/press unify
  'features/ai/chat/thread-list.css',
  'features/reader/workspace/right-rail.css',
  'features/library/library-chrome.css',
  'features/library/book-card.css',
] as const;

describe('motion.css contracts', () => {
  it('uses no literal durations or easings', () => {
    expect(() => {
      assertNoLiteralMotion(motionCss);
    }).not.toThrow();
  });

  it.each(PRIMITIVE_CLASSES)('declares a rule for %s', (cls) => {
    expect(motionCss).toContain(`${cls} {`);
  });
});

describe('tokens.css reduced-motion contract', () => {
  it('zeroes all four --duration-* tokens under prefers-reduced-motion', () => {
    expect(() => {
      assertReducedMotionZeroesTokens(tokensCss);
    }).not.toThrow();
  });
});

describe('migrated CSS files', () => {
  it.each(MIGRATED_CSS_FILES)('%s has no literal motion strings', (rel) => {
    const src = readFileSync(resolve(repoRoot, rel), 'utf8');
    expect(() => {
      assertNoLiteralMotion(src);
    }).not.toThrow();
  });

  it.each(MIGRATED_CSS_FILES)('%s has no local reduced-motion block', (rel) => {
    const src = readFileSync(resolve(repoRoot, rel), 'utf8');
    expect(() => {
      assertNoLocalReducedMotionBlock(src);
    }).not.toThrow();
  });
});
```

- [ ] **Step 18.6: Run the extended test**

```bash
pnpm test --run src/design-system/motion.test.ts
```

Expected: 38 PASS (1 + 10 primitives + 1 reduced-motion + 13 file no-literal + 13 file no-local-rm).

If any file fails: fix the file (it has remnant local motion). Common offenders: a leftover `animation:` or `@media (prefers-reduced-motion)` block from the migration tasks.

- [ ] **Step 18.7: Commit**

```bash
git add src/shared/motion/contracts.ts src/shared/motion/contracts.test.ts src/design-system/motion.test.ts
git commit -m "test(motion): parametrized contract over every migrated CSS file (Phase 6.1.2)"
```

---

## Task 19 — Upgrade `e2e/motion-tokens.spec.ts` with the strict inline-style sweep

The 6.1.1 PR deferred the "no element on the page has inline literal motion" test because pre-existing inline `animationDelay: 'Nms'` literals in `LibraryEmptyState` would have failed it. After Task 6 those literals are gone (replaced with `calc(var(--duration-fast) * N)`); enable the strict check now.

**Files:**
- Modify: `e2e/motion-tokens.spec.ts`

- [ ] **Step 19.1: Add the strict test**

Open `e2e/motion-tokens.spec.ts`. Inside `test.describe('motion tokens', () => { ... })`, append:

```ts
test('no element on the page carries literal ms or cubic-bezier in its inline style', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();

  const offending = await page.evaluate(() => {
    const LITERAL_MS = /\b\d+(?:\.\d+)?ms\b/;
    const CUBIC_BEZIER = /cubic-bezier\s*\(/;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[style]'));
    return els
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute('class') ?? '',
        style: el.getAttribute('style') ?? '',
      }))
      .filter(
        (e) => LITERAL_MS.test(e.style) || CUBIC_BEZIER.test(e.style),
      );
  });

  expect(offending, JSON.stringify(offending, null, 2)).toEqual([]);
});
```

Also remove the comment block at the top of the file that justified deferring this check; replace it with a one-liner noting the file is the motion-token regression net.

- [ ] **Step 19.2: Build and run e2e**

```bash
pnpm build && pnpm test:e2e e2e/motion-tokens.spec.ts
```

Expected: 3 PASS.

If the strict test fails with offending elements listed: that's a real migration miss. Either (a) the migration left inline literals somewhere, or (b) a downstream component carries dynamic inline `style` strings with literal ms. Fix at the source (replace with `calc(var(--duration-...) * N)` form).

- [ ] **Step 19.3: Commit**

```bash
git add e2e/motion-tokens.spec.ts
git commit -m "test(motion): enable strict no-inline-literal-motion sweep (Phase 6.1.2)"
```

---

## Task 20 — Final quality gate, roadmap, and PR

**Files:**
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 20.1: Run the full project check**

```bash
pnpm check
```

Expected: PASS (modulo the pre-existing locale-flaky `relativeTime` test noted in 6.1.1's PR).

- [ ] **Step 20.2: Re-run the e2e baseline**

```bash
pnpm build && pnpm test:e2e e2e/motion-tokens.spec.ts
```

Expected: 3 PASS.

- [ ] **Step 20.3: Manual smoke verification (record outcomes inline below)**

Open `pnpm dev` and exercise each migrated surface, plus toggle OS reduced-motion. Confirm:

- Library empty state: items rise in even-step cascade. With reduced-motion: items appear instantly.
- Bookshelf: a book cover fades in when its cached blob resolves.
- Library import tray: tray rises into view when imports start.
- Drop overlay: fades in when a file is dragged over the window.
- Reader chrome (focus mode): chrome fades in.
- Reader hint banner: fades in.
- Reader bookmark pulse: gentle 1.04× scale pulse.
- Mobile sheet: rises with spring-flavored arrival; scrim fades in behind.
- Suggested prompts loading: fades in.
- Typing caret in chat: breathes (opacity 1.0 ↔ 0.4) at ~1.4s cadence.
- SW toast: arrives with spring-flavored slide.
- Notebook rows: fade in on open.
- Notebook empty state: rises into view.
- Settings view: content fades in; back button gives tactile press.
- Route-loading copy: fades in.
- Index-inspector rows: fade in.
- Note-editor popover: fades in.

If any feel off: revisit the relevant task and adjust the primitive choice (e.g. swap `.motion-rise` for `.motion-fade-in`).

- [ ] **Step 20.4: Update the roadmap**

Edit `docs/04-implementation-roadmap.md`. Add to the Status block:

```markdown
- Phase 6.1.2 motion-migration — complete (2026-MM-DD)
```

(Use the actual completion date.)

- [ ] **Step 20.5: Commit roadmap**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "docs(roadmap): mark Phase 6.1.2 motion-migration complete"
```

- [ ] **Step 20.6: Push and open PR**

```bash
git push -u origin phase-6-1-2-motion-migration
gh pr create --title "feat(motion): Phase 6.1.2 — migrate surfaces + fill motion gaps" --body "$(cat <<'EOF'
## Summary
- Migrated every existing animated surface to consume `.motion-*` primitives from 6.1.1; removed local keyframes and redundant per-component `@media (prefers-reduced-motion: reduce)` blocks.
- Unified hover-affordance duration on `--duration-fast` (closes audit F1.5).
- Added motion to currently-static surfaces (notebook rows + empty state, settings views, route-loading, index-inspector rows, note-editor, book-card cover image).
- Migrated `LibraryEmptyState` inline `animationDelay` literals to token-multiples (`calc(var(--duration-fast) * N)`).
- Extended `motion.test.ts` with parametrized contracts over every migrated CSS file.
- Added new `assertNoLocalReducedMotionBlock` helper.
- Enabled the strict e2e sweep that catches any future inline literal motion.

No View Transitions wiring in this PR — that's 6.1.3.

Spec: `docs/superpowers/specs/2026-05-10-phase-6-1-motion-language-design.md`
Plan: `docs/superpowers/plans/2026-05-10-phase-6-1-2-motion-migration.md`

## Tone changes (intentional, per spec)
- `reader-chrome` bookmark pulse: peak scale 1.2× → 1.04× (calmer).
- `mobile-sheet` arrival: `--ease-out` → `--ease-spring` (spec's focal-arrival recipe).
- `library-empty` mark: dropped subtle scale animation (now translateY only).
- `library-empty` cascade: even 1× hover-time stepping (slightly faster overall).
- `import-tray` arrival: drops-from-above → rises-from-below.

## Test plan
- [ ] `pnpm check` passes (modulo the pre-existing relativeTime locale failure)
- [ ] `pnpm test:e2e e2e/motion-tokens.spec.ts` passes (3 tests including strict sweep)
- [ ] Manual smoke per the plan's Step 20.3 list
- [ ] Toggle OS reduced-motion and confirm every migrated surface goes still

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 20.7: Verify CI (no GitHub Actions configured in this repo, so the PR just needs human review)**

```bash
gh pr view --web
```

---

## Acceptance summary

This plan is complete when:
- All 20 tasks are checked off and committed.
- `pnpm check` passes (modulo the pre-existing locale failure).
- `pnpm test:e2e e2e/motion-tokens.spec.ts` passes including the strict inline-literal sweep.
- A spot-grep of `src/**/*.css` shows zero literal `ms` / `cubic-bezier` / bare `ease` strings:
  ```bash
  grep -rEn '[0-9]+ms\b|cubic-bezier|\bease(-in|-out|-in-out)?\b' --include="*.css" src/ | grep -v "var(--ease" | grep -v "var(--duration"
  ```
  Expected: empty output.
- All migrated CSS files have lost their local `@media (prefers-reduced-motion)` blocks.
- The motion section in `docs/05-design-system.md` remains accurate (no doc changes needed in this PR).

Plan for **6.1.3** (View Transitions API) follows this PR's merge.
