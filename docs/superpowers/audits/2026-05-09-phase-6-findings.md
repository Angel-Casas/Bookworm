# Phase 6 audit findings — 2026-05-09

Audit per `docs/superpowers/specs/2026-05-09-phase-6-audit-design.md` (PRs A–C).
Companion artifacts: `motion-inventory.md`, `state-matrix.md`.

## Summary

| Sub-task | critical | important | nice-to-have | Withdrawn | Total |
|---|---|---|---|---|---|
| 6.1 Animation | 0 | 1 (F1.6) | 5 (F1.1–F1.5) | 0 | 6 |
| 6.2 A11y | 0 | 4 (F2.1–F2.4) | 1 (F2.5 deferred) | 0 | 5 |
| 6.3 Performance | 0 | 1 (F3.1) | 2 (F3.2, F3.3) | 0 | 3 |
| 6.4 Offline | 0 | 1 (F4.1) | 1 (F4.2) | 0 | 2 |
| 6.5 Empty/error | 1 (F5.3) | 1 (F5.2) | 3 (F5.5–F5.7) | 2 (F5.1, F5.4) | 7 |
| **Totals** | **1** | **8** | **12** | **2** | **23** |

### Headline triage decisions

- **6.1 Animation** — closing out. Five candidates inline-fixed in this PR; F1.5 is a docs-only follow-up that can land alongside the next design-system update. No 6.1 implementation spec needed.
- **6.2 A11y** — follow-up spec. Three findings (F2.1 color-contrast, F2.3 focus trap, F2.4 focus restoration) need design or architectural decisions. F2.2 inline-fixed. F2.5 (manual walkthrough) deferred to a future hands-on browser session.
- **6.3 Performance** — follow-up spec. F3.1 (bundle size 418 KB gz, over 250 KB soft threshold) is the only actionable item; F3.2/F3.3 are nice-to-have or deferred.
- **6.4 Offline** — follow-up spec, small. F4.1 + F4.2 are the two `TODO: surface ... in Phase 6` comments in `register-sw.ts`; combine into one PR introducing the update-available prompt and offline-ready toast.
- **6.5 Empty/error** — follow-up spec. F5.3 (no top-level ErrorBoundary) is the only critical finding in the entire audit and the spec's open question (§7) — placement recommendation lives in `state-matrix.md`.

## 6.1 Animation findings

| ID | Finding | Severity | Location | Triage |
|---|---|---|---|---|
| F1.1 | `transition: background 150ms ease;` should use design-system tokens | nice-to-have | `src/features/ai/prompts/suggested-prompts.css:19` | **fix-inline** |
| F1.2 | `animation: suggested-prompts-fade-in 250ms ease;` should use design-system tokens | nice-to-have | `src/features/ai/prompts/suggested-prompts.css:60` | **fix-inline** |
| F1.3 | `animation: reader-chrome-bookmark-pulse 250ms var(--ease-out);` literal duration | nice-to-have | `src/features/reader/reader-chrome.css:81` | **fix-inline** |
| F1.4 | `animation: bubble-caret 1.4s ease-in-out infinite;` literal easing | nice-to-have | `src/features/ai/chat/message-bubble.css:45` | **fix-inline** |
| F1.5 | Undocumented hover-affordance duration split: reader chrome uses `--duration-fast` (120ms), chat/library uses `--duration-base` (200ms). Likely intentional but not documented. | nice-to-have | cross-file (see motion-inventory §Group: hover-affordance) | **defer** to next design-system update; record in `docs/05-design-system.md` |
| F1.6 | `suggested-prompts.css` had literal motion AND no local `prefers-reduced-motion` block — reduced-motion users still saw motion since the global token override didn't reach this file. | important | `src/features/ai/prompts/suggested-prompts.css` | **fix-inline (dissolved)** — F1.1 + F1.2 tokenization automatically dissolves this since tokens are zeroed under reduced-motion |

## 6.2 A11y findings

| ID | Finding | Severity | Location | Triage |
|---|---|---|---|---|
| F2.1 | `color-contrast` axe violation: `.import-tray__clear` (uses `var(--color-accent)`) and `.import-tray__status` (uses `var(--color-text-subtle)`) fail WCAG AA against the import-tray surface backgrounds (and the success/danger tinted variants). | important | `src/features/library/import/import-tray.css:18-23, 53-58` | **spec → 6.2** — needs design-system color-contrast decision (likely a darker subtle / a non-accent action color) |
| F2.2 | `aria-prohibited-attr` axe violation: `<div className="reader-view__mount" aria-label="Book content" />` — `aria-label` on a generic `<div>` without a role is not permitted. | important | `src/features/reader/ReaderView.tsx:299` | **fix-inline** (added `role="region"` so the aria-label becomes valid) |
| F2.3 | No focus-trap on modals — Tab can escape `MobileSheet`, `IndexInspectorModal`, `HighlightToolbar` popover. Escape *does* close them (handled), but Tab order leaks. Verified by absence of any `focus-trap`/`FocusTrap`/`firstFocus` references in src/. | important | `src/features/reader/workspace/MobileSheet.tsx:23`, `src/features/library/indexing/IndexInspectorModal.tsx:67`, `src/features/reader/HighlightToolbar.tsx` | **spec → 6.2** |
| F2.4 | No focus-restoration after modal close — when Escape or close-button fires, focus does not return to the element that opened the modal. | important | same as F2.3 | **spec → 6.2** (combine with F2.3 in one PR) |
| F2.5 | Manual keyboard walkthrough was not performed in this inline audit (would require browser interaction). The other three a11y signals (jsx-a11y lint = 0, axe = 2 violations now down to 1, code review for keyboard escape) cover most cases but a real-device pass is the gold standard. | nice-to-have | n/a | **defer** to a future hands-on browser session; revisit if user-reported keyboard issues surface |

`pnpm lint` finds zero `eslint-plugin-jsx-a11y` violations. After F2.2 inline fix, the `e2e/axe.spec.ts` baseline drops from 1 to 0 for both reader views; library-with-book remains at 1 (the F2.1 color-contrast).

## 6.3 Performance findings

| ID | Finding | Severity | Location | Triage |
|---|---|---|---|---|
| F3.1 | Main JS bundle is **1.3 MB raw / 418 KB gz**, well over the 250 KB gz soft threshold. Vite warns at build time. PDF.js worker (2.1 MB raw) is correctly lazy-loaded. The fattening contributors are likely `xstate`, `foliate-js`, the four nanogpt clients (chat / structured / embeddings / models), and Settings UI — all eagerly loaded. | important | `dist/assets/index-*.js` | **spec → 6.3** — code-splitting candidates: `useChatSend` and nanogpt clients (load on first chat open), Settings (load on settings route entry), foliate-js engines (already lazy via the small chunks: `epub-`, `mobi-`, `paginator-`, `fixed-layout-`, `fb2-`, `comic-book-` — only `index-*.js` itself is the pile-up) |
| F3.2 | No timing instrumentation in the indexing pipeline. User-facing progress is reported via `setStatus` per phase, but devs cannot identify which phase is slowest from logs alone. | nice-to-have | `src/features/library/indexing/pipeline.ts` | **defer** — adding `performance.mark()` / `performance.measure()` is cheap but not prerequisite to anything else in v1 |
| F3.3 | Lighthouse + React DevTools Profiler runs not performed in this inline audit (browser-required). | nice-to-have | n/a | **defer** to a future hands-on browser session; revisit if user-reported performance issues surface |

## 6.4 Offline findings

| ID | Finding | Severity | Location | Triage |
|---|---|---|---|---|
| F4.1 | `registerSW({ onNeedRefresh })` callback is an empty TODO — when a new SW version is detected, the user is never prompted; they keep using the old version until they manually refresh. | important | `src/pwa/register-sw.ts:11-13` | **spec → 6.4** |
| F4.2 | `registerSW({ onOfflineReady })` callback is an empty TODO — first-time users get no signal that offline mode is now available. | nice-to-have | `src/pwa/register-sw.ts:14-16` | **spec → 6.4** (combine with F4.1) |

E2e baselines (PR-B) confirmed *good* current behavior:
- Cold-offline: app shell loads from SW cache after reload — working.
- Mid-session-offline: imported book renders from IndexedDB — working.
- API-down: chat send surfaces `ChatErrorBubble` (role="alert" + Retry) — working.

## 6.5 Empty/error findings

| ID | Finding | Severity | Location | Triage |
|---|---|---|---|---|
| ~~F5.1~~ | ~~Reader has no user-visible error state~~ | — | — | **withdrawn** — Reader has comprehensive error UI via state machine + `describeError()` overlay (`ReaderView.tsx:305-312`, `readerMachine.ts:110, 141`). Initial reading missed it. |
| F5.2 | Reader panels (TocPanel, HighlightsPanel, BookmarksPanel) and ThreadList have no error state if their repos throw. The DB is local IndexedDB so failures are unlikely, but a corrupted store would render as a blank panel. | important | `src/features/reader/{Toc,Highlights,Bookmarks}Panel.tsx`, `src/features/ai/chat/ThreadList.tsx` | **spec → 6.5** (combine with F5.3) |
| F5.3 | **No top-level `ErrorBoundary` anywhere in `src/`** (verified: zero hits for `ErrorBoundary` / `componentDidCatch` / `getDerivedStateFromError`). Any unhandled render error after `<ReadyApp boot={boot} />` mounts will unmount the entire React tree, leaving the user with a blank page and no recovery. | **critical** | `src/app/App.tsx:450` | **spec → 6.5** — placement recommendation in `state-matrix.md`: tier-1 `<AppErrorBoundary>` around `<ReadyApp />`, optional tier-2 per-route boundaries (Reader, Notebook, Settings) |
| ~~F5.4~~ | ~~Reader has no loading state~~ | — | — | **withdrawn** — Reader has "Opening book…" overlay in `ReaderView.tsx:300`. |
| F5.5 | `BookCard` has no fallback when the cover image fails to render (e.g., extracted cover blob is corrupt) — broken-image icon shows. | nice-to-have | `src/features/library/BookCard.tsx` | **defer** — needs an `<img onError>` handler + a graceful placeholder; small but not architectural |
| F5.6 | `NoteEditor` has no explicit empty-state copy; editor renders empty when no note text. | nice-to-have | `src/features/reader/NoteEditor.tsx` | **defer** — design-decision-adjacent |
| F5.7 | `IndexInspectorModal` has no explicit empty-state for zero chunks; the table is just empty. | nice-to-have | `src/features/library/indexing/IndexInspectorModal.tsx` | **defer** |

## Inline fixes applied in this PR

Five fixes (well within the soft cap of ~10):

- **F1.1** — `suggested-prompts.css:19` — replaced literal `150ms ease` with `var(--duration-fast) var(--ease-out)`.
- **F1.2** — `suggested-prompts.css:60` — replaced literal `250ms ease` with `var(--duration-base) var(--ease-out)`.
- **F1.3** — `reader-chrome.css:81` — replaced literal `250ms` duration with `var(--duration-slow)` for the bookmark-pulse animation.
- **F1.4** — `message-bubble.css:45` — tokenized the easing on the typing-caret animation (literal `ease-in-out` → `var(--ease-in-out)`).
- **F2.2** — `ReaderView.tsx:299` — added `role="region"` to `.reader-view__mount` so its `aria-label` is permitted.

F1.6 is automatically dissolved by F1.1 + F1.2 (tokenization makes the global reduced-motion override apply).

The `e2e/axe.spec.ts` baselines for both reader views were lowered from 1 → 0 to reflect the F2.2 fix; library-with-book stays at 1 pending F2.1.

## Triaged for follow-up specs

### 6.1 — closing out
No implementation spec needed. F1.5 (docs-only) folds into a future design-system pass.

### 6.2 — Modal a11y + import-tray contrast
**Scope sketch:** Introduce a focus-trap utility (e.g., `useFocusTrap` hook) and apply to `MobileSheet`, `IndexInspectorModal`, `HighlightToolbar` popover. Add focus-restoration: each modal's open path captures `document.activeElement`; close path restores. Separately, address F2.1 by either (a) picking a higher-contrast `--color-text-subtle` token (affects more than just import-tray; design-system-wide), or (b) introducing a tray-specific text-color token. Estimated 1 PR.

### 6.3 — Bundle code-splitting
**Scope sketch:** Identify the largest contributors to `index-*.js` via `vite build --mode production --debug` or visual inspection. Lazy-import: nanogpt chat/structured/embeddings clients (load when the chat panel first mounts), Settings views (load when the settings route entered), `useChatSend` heavy logic. Targets: drive main bundle gz under 250 KB. Estimated 1 PR.

### 6.4 — SW update prompt + offline-ready toast
**Scope sketch:** Implement the two `register-sw.ts` TODOs. `onNeedRefresh` shows a small "An update is available — refresh" toast with refresh / dismiss. `onOfflineReady` shows a one-time "Offline ready" toast. New small components, presumably reusing existing toast patterns from import-tray or chat-error styling. Estimated 1 small PR.

### 6.5 — Top-level ErrorBoundary + reader-panel error states
**Scope sketch:** Implement the tier-1 `AppErrorBoundary` per `state-matrix.md` recommendation: class component, fallback UI consistent with `LibraryBootError`, reload button, error message displayable. Wrap `<ReadyApp boot={boot} />` in `App.tsx:450`. Add unit test for the boundary. Separately, add error states to `TocPanel`, `HighlightsPanel`, `BookmarksPanel`, `ThreadList` when their respective repo calls reject (replace blank render with a "Could not load X — retry" panel). Defer tier-2 per-route boundaries to v1.x unless a specific incident warrants them. Estimated 1 PR.

## Decisions deferred

- **Performance budgets in CI** (per spec §1 *Out of scope*) — defer to v1 release prep.
- **VoiceOver / real-device a11y session** (per spec §1 *Out of scope*) — defer until 6.2 follow-up lands so we're not testing a moving baseline.
- **Color contrast pass across all theme tokens** (per spec §1 *Out of scope*) — F2.1 is the one finding the audit surfaced; if 6.2 follow-up shows the contrast issue is more pervasive, escalate.
- **Lighthouse + React DevTools Profiler runs** (F3.3) — defer to a future hands-on browser session; current bundle finding (F3.1) is the most actionable perf issue and can be worked from build output alone.
- **Manual keyboard walkthrough** (F2.5) — same as above; defer to a hands-on session.

## Open questions resolved

- **Where does the `ErrorBoundary` belong?** (spec §7) — Answered in `state-matrix.md`. Tier-1: wrap `<ReadyApp boot={boot} />` in `App.tsx:450`. Tier-2 (deferred): per-route around Reader/Notebook/Settings.
