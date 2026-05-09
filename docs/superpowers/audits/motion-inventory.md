# Motion inventory

Living document. Captures every CSS `transition`, `animation`, `@keyframes`,
and `prefers-reduced-motion` block under `src/`. Filled in during the Phase 6
audit (PR-C, 2026-05-09); kept up to date as the design system evolves.

## Design-system motion tokens

Defined in `src/design-system/tokens.css`:

| Token | Value | Purpose |
|---|---|---|
| `--duration-fast` | 120ms | Panel-chrome hover affordances |
| `--duration-base` | 200ms | List/card hover, panel entry |
| `--duration-slow` | 320ms | Mobile sheet slide-up |
| `--duration-slower` | 480ms | Hero entry (library empty) |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | Default — natural deceleration |
| `--ease-in-out` | cubic-bezier(0.65, 0, 0.35, 1) | Bidirectional |
| `--ease-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | Spring overshoot (currently unused) |

`tokens.css` also has a global `@media (prefers-reduced-motion: reduce)` block
that zeroes all duration tokens — so any consumer using these tokens
automatically respects reduced-motion.

## Inventory

### Group: hover-affordance
Color / background / border / opacity transitions triggered by `:hover` or `:focus-within`.

| File:Line | Selector | Property / duration / easing | Observation |
|---|---|---|---|
| `reader/reader-chrome.css:22` | `.reader-chrome__back` | background / fast / ease-out | tokens ✓ |
| `reader/reader-chrome.css:61` | `.reader-chrome__actions button` | background / fast / ease-out | tokens ✓ |
| `reader/toc-panel.css:27` | `.toc-panel__entry` | background / fast / ease-out | tokens ✓ |
| `reader/bookmarks-panel.css:85` | `.bookmarks-panel__delete` | opacity / fast / ease-out | hover-reveal pattern; tokens ✓ |
| `reader/highlights-panel.css:90` | `.highlights-panel__actions` | opacity / fast / ease-out | hover-reveal pattern; tokens ✓ |
| `reader/pdf/pdf-page.css:87` | `.pdf-reader__nav-strip button` | background / fast / ease-out | tokens ✓ |
| `reader/typography-panel.css:39` | `.typography-panel__row select/button` | background / fast / ease-out | tokens ✓ |
| `reader/workspace/right-rail.css:34` | `.right-rail__collapse` | color / base / ease-out | tokens ✓; faster than reader chrome (base vs fast) — see Observation A |
| `reader/workspace/right-rail.css:67` | `.right-rail__edge-tab` | color / base / ease-out | tokens ✓; same as 34 |
| `ai/chat/thread-list.css:28` | `.thread-list__row` | background-color / base / ease-out | tokens ✓ |
| `ai/chat/thread-list.css:76` | `.thread-list__delete` | opacity / base / ease-out | hover-reveal; tokens ✓ |
| `ai/chat/thread-list.css:133` | `.chat-header__actions button` | color / base / ease-out | tokens ✓ |
| `library/book-card.css:20` | `.book-card__open` | transform / base / ease-out | tokens ✓; uses `transform` (good for compositing) |
| `library/book-card.css:93` | `.book-card__menu-trigger` | opacity / base / ease-out | hover-reveal; tokens ✓ |
| `library/library-chrome.css:30` | `.library-search` | border-color / base / ease-out | focus-within affordance; tokens ✓ |
| `ai/prompts/suggested-prompts.css:19` | `.suggested-prompts__item` | background / **150ms / ease** (literal) | **F1.1** — outside design-system tokens, no reduced-motion handling (see §Reduced-motion coverage) |

**Observation A.** Hover-affordance durations are split into two groups by surface:
reader panel chrome (back, actions, toc, bookmarks-delete, highlights-actions, pdf-nav, typography) all use `--duration-fast` (120ms); chat/library/right-rail (thread row, thread-delete, chat-header, book-card, library-search, right-rail collapse + edge tab) all use `--duration-base` (200ms). Within each surface the durations are consistent. The split appears intentional (faster ambient hover in dense reader chrome, more deliberate elsewhere) but is undocumented. **F1.5** (nice-to-have): document the split in `docs/05-design-system.md`.

### Group: panel-entry
One-shot animations when a panel/overlay/sheet appears.

| File:Line | Selector | Animation / duration / easing | Observation |
|---|---|---|---|
| `reader/workspace/mobile-sheet.css:6` | `.mobile-sheet__scrim` | mobile-sheet-scrim-in / base / ease-out | tokens ✓ |
| `reader/workspace/mobile-sheet.css:19` | `.mobile-sheet` | mobile-sheet-in / slow / ease-out | tokens ✓; slower than scrim (base) — intentional staggered entry |
| `library/drop-overlay.css:10` | `.drop-overlay` | drop-overlay-in / base / ease-out | tokens ✓ |
| `library/import/import-tray.css:5` | `.import-tray` | import-tray-in / base / ease-out | tokens ✓ |
| `reader/workspace/workspace.css:31` | `.reader-workspace[data-mode='focus'] .reader-chrome` | chrome-fade-in / base / ease-out | tokens ✓ |
| `reader/workspace/workspace.css:47` | `.reader-workspace__hint` | hint-fade-in / base / ease-out | tokens ✓ |
| `ai/prompts/suggested-prompts.css:60` | `.suggested-prompts` (container) | suggested-prompts-fade-in / **250ms / ease** (literal) | **F1.2** — outside tokens; no reduced-motion handling |

### Group: hero-entry (library empty-state set)
Coordinated entrance animations on the first-run library landing page.

| File:Line | Selector | Animation / duration / easing | Observation |
|---|---|---|---|
| `library/library-empty-state.css:66` | `.library-empty__mark` | library-empty-rise / slower / ease-out | tokens ✓ |
| `library/library-empty-state.css:79` | `.library-empty__wordmark` | library-empty-rise / slower / ease-out | tokens ✓ |
| `library/library-empty-state.css:92` | `.library-empty__tagline` | library-empty-rise / slower / ease-out | tokens ✓ |
| `library/library-empty-state.css:102` | `.library-empty__rule` | library-empty-rule-grow / slower / ease-out | tokens ✓ |
| `library/library-empty-state.css:112` | `.library-empty__privacy` | library-empty-fade / slower / ease-out | tokens ✓ |
| `library/library-empty-state.css:148` | `.library-empty__cta` | library-empty-rise / slower / ease-out | tokens ✓ |

### Group: state-feedback
One-off pulse / flash on a state change.

| File:Line | Selector | Animation / duration / easing | Observation |
|---|---|---|---|
| `reader/reader-chrome.css:81` | `.reader-chrome__bookmark--pulse` | reader-chrome-bookmark-pulse / **250ms / var(--ease-out)** | **F1.3** — literal duration (token easing); not aligned with any token (closest is `--duration-base` 200ms or `--duration-slow` 320ms) |

### Group: loading-indicator
Looping animations for ongoing async state.

| File:Line | Selector | Animation / duration / easing | Observation |
|---|---|---|---|
| `ai/chat/message-bubble.css:45` | `.message-bubble__caret` | bubble-caret / **1.4s / ease-in-out / infinite** (literal) | **F1.4** — literal duration + literal easing; loop is unbounded but caret element unmounts when streaming ends; reduced-motion handled in-file |

## Reduced-motion coverage

| File | Has `prefers-reduced-motion` block? | Notes |
|---|---|---|
| `design-system/tokens.css` | yes (line 135) | Global; zeroes all `--duration-*` tokens |
| `ai/chat/message-bubble.css` | yes (line 48) | Local — animation uses literal duration so the global token override doesn't apply |
| `ai/chat/thread-list.css` | no | Auto-handled — all transitions use tokens |
| `ai/prompts/suggested-prompts.css` | **no** | **F1.6** — animations + transitions use literal values, so the global token override does NOT cover this file. Reduced-motion users still see motion. |
| `library/book-card.css` | no | Auto-handled — tokens |
| `library/drop-overlay.css` | yes (line 43) | Local — uses literal-free animation but defensive override |
| `library/import/import-tray.css` | yes (line 87) | Local — defensive override |
| `library/library-chrome.css` | no | Auto-handled — tokens |
| `library/library-empty-state.css` | yes (line 154) | Local — defensive override |
| `reader/bookmarks-panel.css` | no | Auto-handled — tokens |
| `reader/highlights-panel.css` | no | Auto-handled — tokens |
| `reader/pdf/pdf-page.css` | no | Auto-handled — tokens |
| `reader/reader-chrome.css` | yes (line 84) | Local — required because bookmark-pulse uses literal duration |
| `reader/toc-panel.css` | no | Auto-handled — tokens |
| `reader/typography-panel.css` | no | Auto-handled — tokens |
| `reader/workspace/mobile-sheet.css` | yes (line 47) | Local — defensive override |
| `reader/workspace/right-rail.css` | no | Auto-handled — tokens |
| `reader/workspace/workspace.css` | yes (line 72) | Local — defensive override |

## Candidate findings (to triage in PR-C findings doc)

- **F1.1** (`suggested-prompts.css:19`) — `.suggested-prompts__item` transition uses literal `150ms / ease`. Should use `--duration-fast / var(--ease-out)`. Severity: nice-to-have.
- **F1.2** (`suggested-prompts.css:60`) — `.suggested-prompts` fade-in animation uses literal `250ms / ease`. Should use `--duration-base / var(--ease-out)`. Severity: nice-to-have.
- **F1.3** (`reader-chrome.css:81`) — bookmark-pulse animation uses literal `250ms`. Closest token is `--duration-base` (200ms) or `--duration-slow` (320ms). Severity: nice-to-have.
- **F1.4** (`message-bubble.css:45`) — bubble-caret uses literal `1.4s / ease-in-out`. Loops are inherently outside the design-system duration vocabulary, but the easing should be tokenized (`--ease-in-out`). Severity: nice-to-have.
- **F1.5** (cross-file) — undocumented split in hover-affordance duration: reader panel chrome uses `--duration-fast`, chat/library uses `--duration-base`. Likely intentional but not recorded in `docs/05-design-system.md`. Severity: nice-to-have.
- **F1.6** (`suggested-prompts.css`) — file has motion using literals AND no `prefers-reduced-motion` block. Reduced-motion users still see motion. Severity: **important** (a11y-adjacent). If F1.1 + F1.2 are tokenized, F1.6 dissolves automatically — fixing F1.1/F1.2 is the cheapest path.

No layout-thrashing properties (`top`, `left`, `width`, `height`) found in transitions. All transitions on transform / opacity / color / background / border-color (compositor-friendly).
