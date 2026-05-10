# Phase 6.1 — Motion language design

Date: 2026-05-10
Status: spec
Supersedes: closes out Phase 6.1 (audit-time inline fixes covered F1.1–F1.4 + F1.6; this spec replaces the deferred F1.5 docs-only follow-up with a broader systematic motion language)

## 1. Goals and non-goals

### Goals
- Define a small, named motion vocabulary every surface uses, so the app feels coherent under motion rather than a quilt of one-off keyframes.
- Eliminate literal durations and easings in `src/**/*.css`; everything goes through tokens or shared primitives.
- Document the language in `docs/05-design-system.md` so future contributions don't drift.
- Cover currently-static surfaces (notebook, settings, route-loading, etc.) without making the app *more* animated overall — the goal is intentionality, not maximalism.
- Land cross-surface transitions via the View Transitions API where it is the cleanest tool (library↔reader, panels, modals, notebook).
- Honor `prefers-reduced-motion` fully and provably.

### Non-goals
- No motion library (`framer-motion`, `motion-one`, etc.). CSS plus a tiny View Transitions hook only.
- No JS-driven physics; springiness is `--ease-spring` on a CSS animation.
- No screenshot or visual-regression baselines.
- No surface redesigns; motion only. If a layout has to change to support a transition, it is the smallest possible change.
- Page-turn / paginator animation inside `foliate-js` and PDF.js page transitions are out of scope.

## 2. The motion language

### Durations (no change to tokens)
- `--duration-fast` 120ms — instant feedback (hover background, focus ring tint).
- `--duration-base` 200ms — standard affordance (press, scrim fade, plain fade-in).
- `--duration-slow` 320ms — considered surface change (sheet, modal, toast, pulse).
- `--duration-slower` 480ms — one-shot reveal (empty-state, drop-overlay).

### Curves (three-curve palette, all kept; documented purposes)
- `--ease-out` — default. Hover, press, fade, rise, scrim, pulse, transitions.
- `--ease-in-out` — infinite loops only (typing caret, future skeleton shimmer).
- `--ease-spring` — exclusively for focal arrivals (sheet, modal, toast). Decisive moments only.

### F1.5 resolution — hover-affordance duration
Today reader-chrome uses `--duration-fast` (120ms) and chat/library use `--duration-base` (200ms). **Unify on `--duration-fast`** for all hover-bg / hover-color affordances. Snappier feel everywhere; matches the most navigation-dense surface (reader chrome). Documented as a project rule in `docs/05-design-system.md`.

### Shared primitives
Live in new `src/design-system/motion.css`. Each primitive is a utility class wired to canonical tokens.

| Primitive | Purpose | Duration / Curve | Replaces today |
|---|---|---|---|
| `.motion-fade-in` | opacity 0→1 | `--duration-base` `--ease-out` | `suggested-prompts-fade-in`, `library-empty-fade`, `hint-fade-in` |
| `.motion-rise` | translateY(8px)+opacity | `--duration-slower` `--ease-out` | `library-empty-rise`, `import-tray-in`, `chrome-fade-in`, `drop-overlay-in` |
| `.motion-sheet-in` | translateY(100%)→0 | `--duration-slow` `--ease-spring` | `mobile-sheet-in` |
| `.motion-scrim-in` | opacity 0→1 (backdrop) | `--duration-base` `--ease-out` | `mobile-sheet-scrim-in` |
| `.motion-toast-in` | translateY(-8px)+opacity | `--duration-slow` `--ease-spring` | `sw-toast-in` |
| `.motion-pulse` | scale 1→1.04→1 | `--duration-slow` `--ease-out` | `reader-chrome-bookmark-pulse` |
| `.motion-rule-grow` | scaleX 0→1 (origin: left) | `--duration-slower` `--ease-out` | `library-empty-rule-grow` |
| `.motion-breath` | opacity loop, infinite | `--duration-base * N` `--ease-in-out` | `bubble-caret` |

Hover and press are not primitives in the same sense (no `@keyframes` involved); they are documented canonical declarations, with optional helper classes provided as convenience wrappers:
- Hover (`.motion-hover-bg`): `transition: background var(--duration-fast) var(--ease-out);`
- Press (`.motion-press`): `transition: transform var(--duration-base) var(--ease-out);` paired with `:active { transform: scale(0.98); }` where pressable.

Components may use the helper classes or write the declaration inline; the rule is the tokens, not the class.

### Stagger pattern
When multiple primitives land together (e.g. empty-state items), components apply `animation-delay` in token-multiples (`calc(var(--duration-fast) * N)`), never literal ms. Token-multiples zero correctly under reduced-motion.

## 3. Architecture and file layout

### New files
- `src/design-system/motion.css` — primitives (`@keyframes` named `bw-fade-in`, `bw-rise`, `bw-sheet-in`, `bw-scrim-in`, `bw-toast-in`, `bw-pulse`, `bw-rule-grow`, `bw-breath`) plus utility classes wiring them to tokens. Imported in `src/main.tsx` immediately after `tokens.css`.
- `src/shared/motion/useViewTransition.ts` — thin wrapper around `document.startViewTransition`. Signature: `(updater: () => void) => void`. Detects support; falls back to running `updater` synchronously when the API is absent or reduced-motion is preferred. (Per-element naming uses the CSS `view-transition-name` property, not a hook argument.)
- `src/shared/motion/viewTransitionNames.ts` — string constants for `view-transition-name` values (`reader-root`, `library-card-${id}`, `panel-root`, `modal-root`, `notebook-root`).
- `src/shared/motion/contracts.ts` — vitest helpers `expectTokenizedTransition(el, prop)` and `expectReducedMotionZeroes(el)`.

### Modified files
- `src/design-system/tokens.css` — header comment pointing to the design-system motion section. No token value changes.
- `docs/05-design-system.md` — new "Motion" section: principles, vocabulary, primitive table, stagger pattern, View Transitions usage, reduced-motion guarantees, do/don't list.
- App-level CSS — migrated to consume primitives in 6.1.2 (full inventory in §5).
- Route-change call sites — wired through `useViewTransition` in 6.1.3.

### View Transitions in CSS
Pseudo-element styling lives in `motion.css` initially (split to `view-transitions.css` if it exceeds ~80 lines):

```css
::view-transition-old(reader-root),
::view-transition-new(reader-root) {
  animation-duration: var(--duration-slow);
  animation-timing-function: var(--ease-spring);
}
```

Defaults (cross-fade) are inherited; only override when a named transition needs custom timing.

### Boundaries
- `motion.css` depends on `tokens.css`. Nothing else in design-system depends on motion.
- `useViewTransition` depends on the browser API; no other internal deps. Constants are the only thing both call sites and CSS reference.
- Test contracts depend on `getComputedStyle`; they live alongside vitest setup so any component test can use them.

## 4. View Transitions inventory (6.1.3)

| Wired transition | View-transition-name | Recipe |
|---|---|---|
| Library → Reader (open book) | `reader-root` on reader root + `library-card-${bookId}` on the active card | focal arrival: `--duration-slow` `--ease-spring` |
| Reader → Library (back to library) | same | reverse cross-morph |
| Reader → Notebook | `notebook-root` on notebook root | calm cross-fade: `--duration-base` `--ease-out` |
| Reader → Settings | `panel-root` on settings panel root | calm cross-fade |
| Modal open / close | `modal-root` (only on the outermost modal) | calm cross-fade |

Modal-root collision rule: only the outermost modal in z-order receives the name. Nested modals do not get a transition. Documented in the motion section.

## 5. Sub-PR scopes

### 6.1.1 — Foundation

**In scope**
- New `src/design-system/motion.css` with all 8 primitives plus documented helper classes for canonical hover/press declarations (e.g. `.motion-hover-bg`, `.motion-press`).
- Import `motion.css` immediately after `tokens.css` in app entry.
- New `src/shared/motion/useViewTransition.ts` (hook only; not yet wired to any route).
- New `src/shared/motion/viewTransitionNames.ts`.
- New `src/shared/motion/contracts.ts` with vitest helpers.
- New "Motion" section in `docs/05-design-system.md`.
- Tests: unit tests for `useViewTransition` covering all three branches (API present, API absent, reduced-motion preferred); contract assertions on the primitive utility classes.
- E2e: new `e2e/motion-tokens.spec.ts` baseline asserting no inline `style` with literal `ms`/`cubic-bezier` on a sample of surfaces.

**Out of scope**
- No existing CSS file is touched.
- No View Transitions wired to any route yet.

**Acceptance**
- `pnpm check` green.
- New primitives documented and visible in the design-system doc.
- Hook unit-tested across all three branches (API present, API absent, reduced-motion preferred).

### 6.1.2 — Migration + gaps

**Migration (existing animated surfaces → primitives)**
- `src/features/reader/reader-chrome.css` — bookmark-pulse → `.motion-pulse`; hover-bg unify on `--duration-fast`.
- `src/features/reader/workspace/mobile-sheet.css` — sheet-in → `.motion-sheet-in`; scrim-in → `.motion-scrim-in`.
- `src/features/reader/workspace/workspace.css` — chrome-fade and hint-fade → `.motion-fade-in`.
- `src/features/library/library-empty-state.css` — rises → `.motion-rise` with token-stagger; rule-grow → `.motion-rule-grow`; fade → `.motion-fade-in`.
- `src/features/library/import/import-tray.css` — in → `.motion-rise`.
- `src/features/library/drop-overlay.css` — in → `.motion-rise`.
- `src/features/ai/prompts/suggested-prompts.css` — fade-in → `.motion-fade-in`; hover unify.
- `src/features/ai/chat/message-bubble.css` — typing caret → `.motion-breath`.
- `src/pwa/sw-toast.css` — in → `.motion-toast-in`.
- Hover/press tokenize and unify to `--duration-fast` in: `book-card.css`, `thread-list.css`, `bookmarks-panel.css`, `highlights-panel.css`, `toc-panel.css`, `typography-panel.css`, `right-rail.css`, `pdf-page.css`, `library-chrome.css`, `notebook-chrome.css`.

**Fill gaps (currently-static surfaces)**
- `src/features/annotations/notebook/notebook-row.css` — `.motion-fade-in` on row enter; press affordance on the row's primary action.
- `src/features/annotations/notebook/notebook-empty-state.css` — `.motion-rise` on the empty-state composition.
- `src/features/annotations/notebook/notebook-search-bar.css` — focus-ring tokenized.
- `src/features/ai/settings/settings-view.css` and `settings-chrome.css` — `.motion-fade-in` on view content; press on action buttons.
- `src/app/route-loading.css` — `.motion-fade-in` on the loader appearing after a delay; if a spinner exists, switch to a `.motion-breath` opacity loop instead of rotation.
- `src/features/library/indexing/indexing-inspector.css` — `.motion-fade-in` on table rows.
- `src/features/reader/note-editor.css` — `.motion-fade-in` on editor mount.
- `src/features/library/bookshelf.css` — book-cover image fade-in via `.motion-fade-in` keyed off a `data-loaded="true"` attribute set in `BookCard` on `<img onLoad>`.

**Out of scope**
- Still no View Transitions API.
- No layout or visual redesigns; only adding/migrating motion.

**Acceptance**
- Zero remaining literal `ms` / `cubic-bezier` / bare `ease` / `ease-in-out` strings in `src/**/*.css` (manual grep documented in the plan).
- Reduced-motion contracts pass on every migrated surface (vitest unit tests, one assertion per file is sufficient).
- App still feels calm in regular motion mode (manual smoke plan in the plan doc).
- Redundant local `@media (prefers-reduced-motion: reduce)` blocks removed in the migrated files (single source of truth in `tokens.css`).

### 6.1.3 — View Transitions API

**In scope**
- Wire `useViewTransition` into the four documented route-change paths (§4 inventory).
- Add `view-transition-name` declarations on root containers (`ReaderView` root, `BookCard`, notebook root, settings root, modal roots).
- View-transition CSS in `motion.css` (or split to `view-transitions.css` if it grows past ~80 lines): `reader-root` and `library-card-*` use focal-arrival; `panel-root`/`modal-root`/`notebook-root` use calm cross-fade.
- Reduced-motion path: hook short-circuits when `matchMedia('(prefers-reduced-motion: reduce)').matches` is true, running `updater` directly.
- Tests: vitest for the hook's `skip` and reduced-motion branches; e2e smoke `e2e/view-transitions.spec.ts` asserting library→reader navigation completes in default (API present) and forced-fallback (`delete document.startViewTransition`) modes.

**Out of scope**
- No new route paths; only existing transitions get wired.
- No deep customization of `::view-transition-group` per item beyond the two recipes.

**Acceptance**
- Each of the four wired transitions visibly morphs in supporting browsers (manual verification plan in plan doc).
- Fallback path verified on a browser without the API.
- Reduced-motion users get instantaneous transitions, proven by hook test.

### Sequencing
PRs are independently mergeable. 6.1.3 may fork in parallel with 6.1.2 after 6.1.1 lands, since 6.1.3 touches disjoint files (TSX wiring + small CSS additions only). 1→2→3 sequential is the default.

## 6. Reduced-motion strategy

1. Tokens-only animations get reduced-motion for free — duration goes to 0ms via the global override in `tokens.css`.
2. Local `@media (prefers-reduced-motion: reduce) { animation: none; }` blocks become redundant after 6.1.2 migration; remove them in: `reader-chrome.css`, `mobile-sheet.css`, `workspace.css`, `library-empty-state.css`, `import-tray.css`, `drop-overlay.css`, `message-bubble.css`, `sw-toast.css`.
3. `transform`-keyframe animations (rise, sheet-in, toast-in, pulse) zero correctly: with 0ms duration they snap to the final keyframe — no offset settles in. Already working this way today for `library-empty-rise`.
4. The View Transitions API does **not** auto-honor reduced-motion when timing is customized; the hook checks `matchMedia` and runs the updater directly to guarantee no transition for those users.
5. Infinite loops (`.motion-breath`) freeze at the first keyframe under reduced-motion (duration 0). Acceptable; documented in the motion section.

## 7. Testing strategy

### Unit (vitest, jsdom)
- `useViewTransition` test cases:
  1. API present → calls `document.startViewTransition` with the updater.
  2. API absent → calls updater synchronously, returns gracefully.
  3. Reduced-motion media matches → calls updater synchronously, skips API.
- `motion.css` primitives — one parametrized test per utility class in `src/design-system/motion.test.ts`, asserting `animation-name`, `animation-duration` (token), and `animation-timing-function`.

### Contracts (`src/shared/motion/contracts.ts`)
- `expectTokenizedTransition(el, prop)` — asserts duration on `prop` resolves through tokens, not literals.
- `expectReducedMotionZeroes(el)` — toggles `matchMedia` mock, asserts `animation-duration` and `transition-duration` become `0s`.
- Used by component tests in 6.1.2 (one assertion per migrated file).

### E2e (Playwright)
- `e2e/motion-tokens.spec.ts` (6.1.1) — sample ~6 surfaces; assert no inline-style literal `ms`/`cubic-bezier` strings.
- `e2e/view-transitions.spec.ts` (6.1.3) — library→reader navigation in default and forced-fallback modes; assert no console errors and reader root visible.

### Explicitly not doing
- Screenshot / visual regression.
- Timing-budget assertions.
- Reduced-motion e2e (covered by deterministic unit contracts).

### Manual verification (per plan doc)
- 6.1.1 — open the design-system doc; mount throwaway components using each primitive in dev to eyeball.
- 6.1.2 — smoke each migrated surface in dev; toggle OS reduced-motion; verify nothing animates.
- 6.1.3 — verify the four transitions in chromium with API on, then with `delete document.startViewTransition` in devtools to confirm fallback.

## 8. Risks and edge cases

### Architectural
- **View Transitions scope creep.** Four documented transitions in 6.1.3 are exhaustive for v1; new ones require a spec amendment.
- **`view-transition-name` collisions.** Per-instance names use a unique suffix (`library-card-${bookId}`); shared names (`reader-root`, `modal-root`) are guaranteed singleton because they live on a top-level container that mounts once per surface.
- **Modal-root reuse.** `HighlightToolbar`, `IndexInspectorModal`, and `MobileSheet` could co-occur (e.g. toolbar over a sheet). Only the outermost modal in z-order gets the name. Documented in the motion section.
- **Removing redundant local reduced-motion blocks** could regress; contracts test catches it at unit-test time.

### Browser/environment
- **Firefox lacks View Transitions support** at the time of writing. Hook fallback runs the updater synchronously; users get instant view changes.
- **Safari same-document View Transitions** is stable for ~a year. No special handling.
- **iOS `prefers-reduced-motion`** is read fresh on each hook call, so a mid-session OS toggle takes effect on the next transition.

### Implementation
- **`animation-delay` token-multiples** zero under reduced-motion because the underlying token zeroes; verified by one test.
- **Foliate-js page-turn animation** is its own engine. Not overridden. If foliate's defaults clash, that's a deferred concern.
- **PDF.js scroll/page transitions** likewise out of scope.
- **`bookshelf.css` cover image fade-in** — small `data-loaded="true"` toggle in `BookCard` on `<img onLoad>`. CSS keys off the attribute.

### Process
- **Three serial PRs ≈ ~2 weeks wall-clock.** 6.1.3 may fork in parallel with 6.1.2 after 6.1.1 lands.
- **Migration PR (6.1.2) touches ~25 CSS files.** Each commit migrates one logical group (reader, library, ai/chat, notebook, etc.) so the PR is reviewable commit-by-commit.

### Edge cases
- A reader-root mounting mid-navigation (race) — `useViewTransition` awaits the updater's resolution; React transition semantics handle async updates.
- Test environment (jsdom) doesn't implement `document.startViewTransition`. Hook tests mock it; component tests using the hook hit the synchronous fallback automatically — no extra setup.
- A user with reduced-motion *and* a slow device — bypassing View Transitions is correct; they asked for no motion.

## 9. Acceptance for Phase 6.1 overall

Phase 6.1 is complete when:
- All three sub-PRs (6.1.1, 6.1.2, 6.1.3) are merged.
- `docs/04-implementation-roadmap.md` Status is updated to mark Phase 6.1 complete with date.
- `docs/05-design-system.md` Motion section is current with the shipped primitives and View Transitions usage.
- `pnpm check` is green on `main` after each merge.
- A spot-grep of `src/**/*.css` shows zero literal `ms` or `cubic-bezier` strings.

## 10. Open questions

None at spec time. If new questions arise during plan-writing or implementation, amend this spec and re-review before proceeding.
