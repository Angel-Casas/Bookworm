# Phase 6 — Polish & trust audit

**Status:** approved 2026-05-09
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 6 (Tasks 6.1 Animation polish, 6.2 Accessibility pass, 6.3 Performance pass, 6.4 Offline & resume hardening, 6.5 Empty/error state polish)
**Architecture decisions referenced:** `docs/06-quality-strategy.md` (accessibility floor, error-state requirements); `docs/05-design-system.md` (motion tokens, focus ring conventions); `docs/02-system-architecture.md` (PWA / SW boundaries); `docs/01-product-prd.md` ("polish and trust" goal).

---

## 1. Goal & scope

Phase 6 is positioned as a *raise-the-bar audit*: no v1 deadline, no specific debt list, no seeded issues. We don't yet know which of the five sub-task areas need real work and which are already in good shape, so the first deliverable is not implementation — it's a single combined audit that surfaces and triages findings.

This spec defines the **audit plan**: what we examine, with which tools, what artifacts we produce, how findings are classified, and how triage decisions translate into follow-up work. The audit's *output* — the actual findings list — is produced by the implementation phase that follows this spec.

### In scope (this spec drives PRs A–C)

- **PR-A — design spec.** This document. Pure doc.
- **PR-B — tooling & scaffolding.** Adds `@axe-core/react` as a dev-only dependency wired into the dev-mode `main.tsx` boot path; adds an `axe.spec.ts` Playwright spec covering Library, Reader, Highlights, Chat, Settings; creates `docs/superpowers/audits/` with `motion-inventory.md` and `state-matrix.md` template files. No app behavior change in production builds.
- **PR-C — findings doc.** `docs/superpowers/audits/2026-05-09-phase-6-findings.md`. Filled-in motion inventory, filled-in state matrix, per-sub-task findings list with severity and triage decision per finding. Pure doc except for a soft-capped (~10) batch of trivially-fixable inline fixes applied alongside.

### Out of scope (deferred)

- Implementing fixes for any non-trivial finding (those land in PRs D…N, each with their own design spec following Phase 4/5 precedent).
- Setting performance budgets in CI (requires v1-readiness conversation; defer).
- Manual VoiceOver / real-device screen-reader passes (depth-C territory; defer until findings indicate need).
- Color contrast analysis across all theme tokens (defer; design-system-adjacent work).
- Any new *runtime* dependency. Only one new *dev* dep is permitted: `@axe-core/react`.

---

## 2. Deliverable shape

```
PR-A  (this spec)            docs/superpowers/specs/2026-05-09-phase-6-audit-design.md
PR-B  (tooling)              src/main.tsx                           — dev-mode axe wiring
                             e2e/axe.spec.ts                  — runtime a11y assertions
                             e2e/offline.spec.ts              — SW + offline behavior
                             docs/superpowers/audits/motion-inventory.md  — empty template
                             docs/superpowers/audits/state-matrix.md      — empty template
                             package.json                           — @axe-core/react devDep
PR-C  (findings)             docs/superpowers/audits/2026-05-09-phase-6-findings.md
                             docs/superpowers/audits/motion-inventory.md  — filled
                             docs/superpowers/audits/state-matrix.md      — filled
                             (soft-capped ~10 inline trivially-fixable changes across src/)
PRs D…N  (implementation)    Per affected sub-task, each with own design spec.
                             E.g., docs/superpowers/specs/2026-05-1X-phase-6-2-a11y-design.md
```

PR-B and PR-C must pass `pnpm check` and the e2e suite. PR-A is doc-only.

---

## 3. Audit method per sub-task

### 3.1 Animation polish (Task 6.1)

**Method.** Mechanically extract every `transition:`, `animation:`, `@keyframes`, and `prefers-reduced-motion` block from CSS files under `src/`. Read surrounding selectors to infer purpose (state-change feedback, panel entry/exit, hover affordance, loading indicator, drag/drop affordance, page transition). Group inventory rows by purpose.

**Artifact.** `docs/superpowers/audits/motion-inventory.md` — table with columns: file, selector, property/duration/easing, purpose, group, observation. Lives past Phase 6 as a reference for design-system motion decisions.

**Finding heuristics.**
- Inconsistent durations within a single purpose group.
- Easings outside the design-system token set (`docs/05-design-system.md`) or `tokens.css`.
- Animations not honoring `prefers-reduced-motion` (8 stylesheets currently honor it; identify any that don't).
- Transitions on layout-triggering properties (`top`, `left`, `width`, `height`) where `transform` would compose better.
- Unbounded loops without a state condition that stops them.

### 3.2 Accessibility pass (Task 6.2)

**Method.**
1. Run `pnpm lint`. `eslint-plugin-jsx-a11y` is already configured; capture all rule violations.
2. Add `@axe-core/react` in dev-only `main.tsx` (production builds must be unaffected). Click through Library → Reader (EPUB and PDF) → HighlightsPanel → ChatPanel → IndexInspectorModal → Settings, capturing every console violation by area.
3. Keyboard-only walkthrough of the same flows. Note focus traps, keyboard-inaccessible interactions, missing focus rings, focus loss after modal/sheet close.
4. Tab-order check on every modal/sheet (TypographyPanel, IndexInspectorModal, MobileSheet, HighlightToolbar popover, etc.).

**Artifact.** Findings list inline in the findings doc. Columns: source (lint / axe / manual), component path, violation, severity.

**Finding heuristics.**
- Any axe `error`- or `serious`-level violation.
- Any keyboard dead-end or non-reachable interactive element.
- Any missing or inadequate focus ring on an interactive element.
- Any modal/sheet without proper focus trap on open or focus restoration on close.
- Any icon-only button without an accessible name.

### 3.3 Performance pass (Task 6.3)

**Method.**
1. `pnpm build` and inspect built chunk sizes from Vite's manifest output. No new dep needed.
2. Lighthouse run against `pnpm preview` on the Library route and the Reader route (with a representative book loaded). Capture LCP, TBT, CLS, total bundle weight gz.
3. React DevTools Profiler over one full Reader session: load EPUB → paginate forward 10 pages → open and close each panel (TOC, Highlights, Bookmarks, Chat) → highlight a passage → send one chat round-trip. Note any commit consistently >16ms and any re-render of a pure subtree on unrelated state change.
4. Read existing indexing-pipeline log output for one representative book (large EPUB) to confirm no slow phase is hidden.

**Artifact.** Findings list with concrete metric per row (e.g., "RightRail open commit: 32ms" or "main bundle gz: 1.2MB").

**Finding heuristics.**
- Any commit consistently >16ms during normal interaction.
- Any chunk over a soft 250KB gz threshold (threshold informational, not enforced).
- Any Lighthouse score below 80 on a primary route.
- Any obvious re-render of a pure subtree on unrelated state change.

### 3.4 Offline & resume hardening (Task 6.4)

**Method.**
1. Read `src/pwa/register-sw.ts` plus the Vite PWA / SW manifest configuration. Document what's cached vs. network-fetched in a short prose section of the findings doc.
2. New Playwright spec `e2e/offline.spec.ts` using `context.setOffline(true)`: cold-load offline; open an existing book; paginate; create an annotation; navigate back to library.
3. "Kill tab mid-read, reopen" test (Playwright) — verify resume position is restored correctly after a fresh tab.
4. Online-but-API-down test: with `context.route()` blocking the AI provider host, send a chat request and verify it surfaces a usable error rather than spinning indefinitely.

**Artifact.** Offline behavior matrix in the findings doc — rows: action, columns: cold-offline / mid-session-offline / API-only-offline → result (works / fails-gracefully / hangs / data loss). Plus per-row findings.

**Finding heuristics.**
- Any user-visible action that hangs without timeout when network is down.
- Any persistence path that silently fails offline.
- Any cold-offline boot that fails when assets *should* already be cached by the SW.
- Any discrepancy between what the SW caches and what the app actually loads.

### 3.5 Empty / error / loading state matrix (Task 6.5)

**Method.** Enumerate every user-facing surface:

> Library, Library import (DropOverlay + ImportTray), BookCard (and its menu), Reader (EPUB and PDF separately), TocPanel, HighlightsPanel, BookmarksPanel, NoteEditor, IndexInspectorModal, Chat thread list, ChatPanel, PrivacyPreview, SuggestedPrompts, multi-excerpt tray, Settings.

For each surface, ask whether each of the four canonical states exists: **loading**, **empty**, **success**, **error**. Read the component to confirm. Separately, confirm the grep finding that no top-level `ErrorBoundary` exists in `src/`, and identify the right place(s) to introduce one.

**Artifact.** `docs/superpowers/audits/state-matrix.md` — table with rows = surface, columns = state, cells = `present` / `absent` / `inadequate` plus a note. Plus a recommendation block on `ErrorBoundary` placement (see §7 Open question).

**Finding heuristics.**
- Any required state missing.
- Any error state that just shows a generic "something went wrong" without a recovery action (retry, reload, contact, etc. as appropriate).
- Any empty state that's a blank screen.
- Any indefinite loading without timeout or retry surface.

---

## 4. Sequencing within the audit

The audit work happens *between* PR-B landing and PR-C opening; everything produced lands in PR-C as a single doc-heavy commit. Within that window:

- 6.1 (motion inventory) and 6.5 (state matrix) are mechanical, file-driven; can run in parallel.
- 6.2 (axe) requires the dev-mode integration from PR-B, so it runs after PR-B lands.
- 6.3 (Lighthouse, profiler) and 6.4 (Playwright offline) are separate hands-on sessions.

Reasonable order: **PR-B scaffolding lands → audit work: (6.5 + 6.1 parallel) → 6.2 → 6.3 → 6.4 → consolidate findings doc → open PR-C**.

---

## 5. Findings doc structure

```
# Phase 6 audit findings — 2026-05-09

## Summary
- Counts per sub-task × severity
- Headline triage decisions per sub-task

## 6.1 Animation findings
| ID | Finding | Severity | Location | Triage |
| F1.1 | …       | important | reader-chrome.css:42 | spec → 6.1 |
| F1.2 | …       | nice-to-have | tokens.css | fix-inline |

## 6.2 A11y findings
…

## 6.3 Performance findings
…

## 6.4 Offline findings
…

## 6.5 Empty/error findings
…

## Inline fixes applied in this PR
- F1.2 — replaced ad-hoc 180ms easing with token
- F2.5 — added aria-label to BookCard menu button
- (≤ ~10 entries; cap)

## Triaged for follow-up specs
- 6.2 A11y → spec to be written: …
- 6.5 Empty/error → spec to be written: ErrorBoundary + reader-side empty states
- 6.1, 6.3, 6.4 → no follow-up needed (justification per area)

## Decisions deferred
- (e.g., perf budgets in CI — defer to v1 release prep)
```

### Severity rubric

| Severity | Definition |
|---|---|
| **critical** | User-visible bug; blocks a primary flow; a11y violation that locks out keyboard or screen-reader users; offline behavior diverges from documented expectation. |
| **important** | Degrades polish or trust but the flow still works; visible inconsistency; performance issue on a hot path. |
| **nice-to-have** | Quality detail; not user-perceptible most of the time. |

### Triage decisions per finding

- **fix-inline** — trivially fixable (≤ a couple of lines), no architectural decision needed. Goes into PR-C up to a soft cap of ~10 entries. If we hit the cap, switch the rest to spec.
- **spec → 6.X** — needs an implementation design spec for the relevant sub-task. Group findings by sub-task; one design doc per affected sub-task.
- **defer** — explicitly out of scope for Phase 6 (e.g., MOBI-related, requires backend, requires real-device session). Findings doc captures rationale so we don't re-discover.

---

## 6. Acceptance criteria

PR-A acceptance:
- This document committed; user-approved before brainstorming proceeds to writing-plans.

PR-B acceptance:
- `@axe-core/react` is in `devDependencies`, wired only into the dev-mode boot path; production bundle is byte-for-byte unaffected (verify with bundle inspection).
- `e2e/axe.spec.ts` runs and passes against the current main flows (with any current violations marked as expected baseline so the spec is green; baseline becomes a target to drive down during 6.2).
- `e2e/offline.spec.ts` runs and passes against *current* behavior. Failures encountered while writing the test are not PR-B blockers — assert current behavior (even if surprising) so the spec is green, and surface the surprise in PR-C as a 6.4 finding.
- `docs/superpowers/audits/motion-inventory.md` and `state-matrix.md` exist as empty templates with the column headings spelled out.
- `pnpm check` passes; full e2e suite green.

PR-C acceptance:
1. Motion inventory and state matrix are filled in.
2. Every primary surface has been examined under all five sub-task lenses.
3. Every finding has severity + triage.
4. Each sub-task area has either a "spec to follow" entry with a one-paragraph scope sketch, or an explicit "no significant findings" conclusion with brief justification.
5. Inline-fix soft cap respected (~10).
6. `pnpm check` passes; e2e suite (including the new offline + axe specs) green.

---

## 7. Open question deliberately deferred to the audit

**Where exactly the top-level `ErrorBoundary` belongs.** Options at the scoping level: around `<App />`, around route-level views, around the Reader workspace specifically, or some combination. The decision needs current-state context (read `App.tsx`, identify the actual render tree boundaries) and is therefore better answered during the 6.5 audit pass, not predetermined here. The findings doc must include a recommendation block.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Findings doc balloons into a wishlist | Severity rubric + soft cap on inline fixes; ruthless **defer** for nice-to-haves not relevant to v1. |
| Audit reveals a critical issue mid-flow | Critical findings may escalate past the inline-fix cap, or land their own micro-PR before the audit continues. Document the deviation in the findings doc. |
| `@axe-core/react` adds noise in dev console | Configure with sensible includes (skip known-OK 3rd-party iframes); document expected baseline noise in PR-B description. |
| Playwright offline test flakes | Use `context.setOffline(true)` before navigation only; do not toggle mid-test. If flaky, mark `test.describe.serial`. |
| Discovering Phase 6 needs deep work, blocking v1 | Triage decisions are per-finding, not per-sub-task — we ship the audit doc even if some sub-tasks turn out big; v1 readiness is a separate decision made off the findings doc. |
| Dev-only axe wiring leaks into production | Gate behind `import.meta.env.DEV` at the import-and-call site; verify with a `pnpm build` bundle inspection step in PR-B. |

---

## 9. Validation checklist

- [ ] PR-A: this spec committed.
- [ ] PR-B: `@axe-core/react` present in `devDependencies` only.
- [ ] PR-B: production build does not include axe (verify via bundle inspection).
- [ ] PR-B: `axe.spec.ts` and `offline.spec.ts` are green against current main.
- [ ] PR-B: `audits/motion-inventory.md` and `audits/state-matrix.md` exist as templates.
- [ ] PR-B: `pnpm check` passes.
- [ ] PR-C: motion inventory and state matrix filled.
- [ ] PR-C: every surface examined under all five lenses.
- [ ] PR-C: every finding has severity + triage.
- [ ] PR-C: each sub-task area has a follow-up decision recorded.
- [ ] PR-C: inline-fix soft cap (~10) respected.
- [ ] PR-C: `ErrorBoundary` placement recommendation included.
- [ ] PR-C: `pnpm check` passes; e2e suite green.
