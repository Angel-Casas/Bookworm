# Phase 6 Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the Phase 6 polish-and-trust audit per `docs/superpowers/specs/2026-05-09-phase-6-audit-design.md`. Produces two PRs: **PR-B** (axe + offline scaffolding, audit-doc templates), then **PR-C** (filled audit findings, capped inline fixes).

**Architecture:** PR-B is TDD-shaped — small code change in `main.tsx` to wire `@axe-core/react` in dev mode only, plus two new Playwright specs that baseline current axe and offline behavior. PR-C is audit-shaped — read source, fill structured tables, classify findings; not TDD. The e2e specs added in PR-B run as part of the standard `pnpm test:e2e` suite from PR-B onward.

**Tech Stack:** TypeScript, React 19, Vite, `vite-plugin-pwa` (workbox), Playwright, `@axe-core/react` (new dev dep), `eslint-plugin-jsx-a11y` (already configured).

---

## File map

**PR-B:**
- Modify: `src/main.tsx` — add dev-only dynamic axe import + invocation
- Modify: `package.json` + `pnpm-lock.yaml` — add `@axe-core/react` to `devDependencies`
- Create: `e2e/axe.spec.ts` — runtime a11y baseline assertions across primary flows
- Create: `e2e/offline.spec.ts` — cold-offline, mid-session-offline, API-down scenarios
- Create: `docs/superpowers/audits/motion-inventory.md` — empty template (column headers, intro)
- Create: `docs/superpowers/audits/state-matrix.md` — empty template (column headers, intro)

**PR-C:**
- Modify: `docs/superpowers/audits/motion-inventory.md` — filled rows
- Modify: `docs/superpowers/audits/state-matrix.md` — filled rows + `ErrorBoundary` recommendation
- Create: `docs/superpowers/audits/2026-05-09-phase-6-findings.md` — full findings + severity + triage
- Modify: up to ~10 `src/**/*` files for trivially-fixable inline findings (specific files unknown until audit runs)
- Modify: `docs/04-implementation-roadmap.md` — mark Phase 6 audit complete

**File sizing:** every new file is small (template with table headers; e2e spec under 200 lines). Existing files touched in PR-C are bounded by the soft cap of ~10 inline fixes.

---

# PR-B — Tooling and scaffolding

PR-B does not change app behavior. Production builds must be byte-identical except for any axe-related metadata that is tree-shaken away.

## Task 1: Add `@axe-core/react` dev dep and wire dev-only

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `src/main.tsx`

- [ ] **Step 1: Add the dev dependency**

Run from repo root:
```bash
pnpm add -D @axe-core/react
```

Expected: `package.json` gains `"@axe-core/react": "^4.x"` under `devDependencies`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Wire it into `src/main.tsx` (dev-only, dynamic import)**

Replace the existing file with:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './design-system/tokens.css';
import './design-system/reset.css';

import { App } from '@/app/App';
import { checkCapabilities } from '@/shared/capabilities';
import { UnsupportedBrowser } from '@/shared/UnsupportedBrowser';
import { registerServiceWorker } from '@/pwa/register-sw';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Bookworm: root element #root not found in index.html.');
}

const capabilities = checkCapabilities();

if (import.meta.env.DEV) {
  // Phase 6 audit: runtime a11y violation logger (dev-only).
  // Dynamic import keeps this out of production bundles.
  void Promise.all([
    import('react'),
    import('react-dom'),
    import('@axe-core/react'),
  ]).then(([React, ReactDOM, { default: reactAxe }]) => {
    reactAxe(React, ReactDOM, 1000);
  });
}

createRoot(rootEl).render(
  <StrictMode>
    {capabilities.kind === 'supported' ? (
      <App />
    ) : (
      <UnsupportedBrowser missing={capabilities.missing} />
    )}
  </StrictMode>,
);

if (capabilities.kind === 'supported') {
  registerServiceWorker();
}
```

- [ ] **Step 3: Verify `pnpm dev` boots without crashes and axe logs to console**

Run:
```bash
pnpm dev
```

Open `http://localhost:5173/Bookworm/` (or whatever Vite reports). Open browser devtools console. Expected: `axe-core` violation entries appear (existing baseline; we are not yet driving them down). No new errors related to wiring.

Stop the dev server (Ctrl-C).

- [ ] **Step 4: Verify production build does NOT include axe-core**

Run:
```bash
pnpm build
```

Then:
```bash
grep -ri "axe-core" dist/ | head -5
```

Expected: empty output (no matches). Vite's tree-shaker plus the `import.meta.env.DEV` gate should exclude axe entirely from the production bundle.

If matches appear, the gate isn't working — investigate before proceeding.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/main.tsx
git commit -m "$(cat <<'EOF'
feat(dev): wire @axe-core/react in dev mode (Phase 6 PR-B)

Adds dev-only runtime a11y violation logging. Dynamic import + DEV
env gate ensures axe-core stays out of production bundles. No app
behavior change in production.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `e2e/axe.spec.ts` baseline

The goal is a *baseline*: count current violations per primary flow so future regressions are visible. The spec is green if violation counts on `main` match the recorded baseline (or are lower); it does not assert "zero violations" — that's what the 6.2 implementation PR will drive toward.

**Files:**
- Create: `e2e/axe.spec.ts`

- [ ] **Step 1: Add `axe-core` runtime helper as dev dep**

`@axe-core/react` is for in-page React integration; the Playwright path needs the standalone analyzer. Run:

```bash
pnpm add -D @axe-core/playwright
```

Expected: `@axe-core/playwright` added to `devDependencies`.

- [ ] **Step 2: Write the spec**

Create `e2e/axe.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

// Baseline counts captured 2026-05-09. Increases mean we regressed; decreases
// during 6.2 implementation are good and the constants get lowered to match.
// Each flow records the current count of violations at "serious" or "critical"
// impact only — minor/moderate are still inspected during the audit but not
// gated here.
const BASELINE_LIBRARY_EMPTY_SERIOUS_OR_CRITICAL = 0;
const BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL = 0;
const BASELINE_READER_EPUB_SERIOUS_OR_CRITICAL = 0;
const BASELINE_HIGHLIGHTS_PANEL_SERIOUS_OR_CRITICAL = 0;
const BASELINE_CHAT_PANEL_SERIOUS_OR_CRITICAL = 0;

async function seriousOrCriticalCount(builder: AxeBuilder): Promise<number> {
  const result = await builder.analyze();
  return result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  ).length;
}

test.describe('Phase 6 a11y baseline', () => {
  test('library empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible();
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_LIBRARY_EMPTY_SERIOUS_OR_CRITICAL);
  });

  test('library with imported book', async ({ page }) => {
    await page.goto('/');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import a book to begin.' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(PG_EPUB);
    await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL);
  });

  test('reader epub view', async ({ page }) => {
    await page.goto('/');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import a book to begin.' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(PG_EPUB);
    await page.getByText(/pride and prejudice/i).first().click();
    // Wait for reader to settle. Use existing reader landmark or first paragraph.
    await page.waitForLoadState('networkidle');
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_READER_EPUB_SERIOUS_OR_CRITICAL);
  });

  test('highlights panel open', async ({ page }) => {
    await page.goto('/');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import a book to begin.' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(PG_EPUB);
    await page.getByText(/pride and prejudice/i).first().click();
    await page.waitForLoadState('networkidle');
    // Find highlights panel toggle by accessible name; existing e2es pattern.
    await page.getByRole('button', { name: /highlights/i }).first().click();
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_HIGHLIGHTS_PANEL_SERIOUS_OR_CRITICAL);
  });

  test('chat panel open', async ({ page }) => {
    await page.goto('/');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import a book to begin.' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(PG_EPUB);
    await page.getByText(/pride and prejudice/i).first().click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /chat/i }).first().click();
    const count = await seriousOrCriticalCount(new AxeBuilder({ page }));
    expect(count).toBeLessThanOrEqual(BASELINE_CHAT_PANEL_SERIOUS_OR_CRITICAL);
  });
});
```

**Note on selectors:** the `getByRole({ name: /highlights/i })` and `getByRole({ name: /chat/i })` calls assume those panel toggles are buttons with accessible names. If they aren't, the existing e2e suite already navigates these — copy the working selectors from `e2e/highlights-epub-create.spec.ts` and `e2e/chat-passage-mode-desktop.spec.ts`.

- [ ] **Step 3: Run the spec to determine actual baselines**

Run:
```bash
pnpm test:e2e e2e/axe.spec.ts
```

Expected: tests fail showing actual violation counts. **Edit the `BASELINE_*` constants to match observed counts.** Re-run until green.

If a test gets stuck (e.g., a panel toggle isn't found), copy the relevant working pattern from another e2e spec referenced in Step 2's note.

- [ ] **Step 4: Document baseline rationale**

In the spec file, add a comment block at the top explaining that the baselines reflect 2026-05-09 main and are a moving target the 6.2 implementation work will lower. (Already partially done in Step 2's comment; expand if needed once real numbers are in.)

- [ ] **Step 5: Verify whole e2e suite still passes**

Run:
```bash
pnpm test:e2e
```

Expected: full suite green, including the new `axe.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml e2e/axe.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): axe a11y baseline for Phase 6 audit

Adds @axe-core/playwright and a baseline spec that records current
serious/critical a11y violations per primary flow. Counts are a
moving target: 6.2 implementation work will drive them down.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `e2e/offline.spec.ts`

Three scenarios per the spec §3.4. Each is an independent test. Failures discovered while writing the test are *not* PR-B blockers — assert the current behavior (even if surprising) and surface the surprise as a finding in PR-C.

**Files:**
- Create: `e2e/offline.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/offline.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

test.describe('Phase 6 offline behavior baseline', () => {
  test('cold-offline: app shell loads from SW cache', async ({ page, context }) => {
    // Prime: visit once online so SW installs and caches assets.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible();
    // Wait for SW to actually take control (workbox installs may need a tick).
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 10_000,
    });

    // Now go offline and reload.
    await context.setOffline(true);
    await page.reload();
    // App shell should still render. Asserting current behavior — if this fails,
    // record as 6.4 finding F4.X in PR-C, do not "fix" here.
    await expect(page.getByRole('heading', { name: 'Bookworm', level: 1 })).toBeVisible();
  });

  test('mid-session-offline: open existing book + paginate', async ({ page, context }) => {
    // Prime online: import book.
    await page.goto('/');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import a book to begin.' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(PG_EPUB);
    await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });

    // Go offline mid-session.
    await context.setOffline(true);

    // Open book.
    await page.getByText(/pride and prejudice/i).first().click();
    await page.waitForLoadState('networkidle');

    // Book content from IndexedDB should still render.
    // Asserting current behavior; if it fails, record as F4.X.
    const readerLandmark = page.locator('main, [role="main"], .reader-view').first();
    await expect(readerLandmark).toBeVisible({ timeout: 10_000 });
  });

  test('api-down: chat send surfaces error rather than hanging', async ({ page, context }) => {
    // Prime online: import + open book.
    await page.goto('/');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import a book to begin.' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(PG_EPUB);
    await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(/pride and prejudice/i).first().click();
    await page.waitForLoadState('networkidle');

    // Block AI provider hosts. nanogpt.com is the configured provider per memory;
    // adjust the glob if the audit surfaces a different host.
    await context.route('**://*.nanogpt.com/**', (route) => route.abort('failed'));
    await context.route('**://api.openai.com/**', (route) => route.abort('failed'));
    await context.route('**://api.anthropic.com/**', (route) => route.abort('failed'));

    // Open chat panel and try to send something. Selectors mirror the
    // chat-passage-mode-desktop.spec.ts pattern; adjust if needed.
    await page.getByRole('button', { name: /chat/i }).first().click();
    const composer = page.getByRole('textbox').first();
    await composer.fill('what is this book about');
    await page.getByRole('button', { name: /send/i }).first().click();

    // Within a generous timeout, *something* user-visible should signal failure
    // (an error chip, a retry button, an error message). Assert current behavior;
    // if no error is surfaced, that's F4.X (the most important offline finding).
    const errorIndicator = page
      .getByText(/error|failed|try again|offline|couldn't/i)
      .first();
    await expect(errorIndicator).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Run and adjust to current behavior**

Run:
```bash
pnpm test:e2e e2e/offline.spec.ts
```

For each test that fails: read the failure carefully. Decide:
- **Assertion is wrong and current behavior is correct:** loosen the assertion to match (e.g., a different selector for the offline indicator).
- **Assertion is right and current behavior diverges from expectation:** mark the test with `test.fail()` (Playwright lets a failing test be expected-fail) or skip with a clear comment, AND make a note in your scratch space — this becomes a 6.4 finding for PR-C.

If you mark a test `test.fail()`, the file should still be green when run.

Re-run until `pnpm test:e2e e2e/offline.spec.ts` is green.

- [ ] **Step 3: Verify whole e2e suite still passes**

Run:
```bash
pnpm test:e2e
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add e2e/offline.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): offline behavior baseline for Phase 6 audit

Three scenarios: cold-offline app shell, mid-session offline reading,
and API-down chat error surfacing. Tests assert current behavior so
the spec is green; surprises become 6.4 findings in PR-C.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create motion-inventory template

**Files:**
- Create: `docs/superpowers/audits/motion-inventory.md`

- [ ] **Step 1: Create the file**

```markdown
# Motion inventory

Living document. Captures every CSS `transition`, `animation`, `@keyframes`,
and `prefers-reduced-motion` block under `src/`. Initially empty; filled in
during the Phase 6 audit (PR-C); kept up to date as the design system evolves.

## How to use

- One row per declaration.
- `Group` collects rows by purpose (panel-entry, hover-affordance, etc.).
- `Observation` flags inconsistency, layout-thrash risk, missing reduced-motion handling, etc.

## Inventory

| File | Selector | Property / duration / easing | Purpose | Group | Observation |
|------|----------|------------------------------|---------|-------|-------------|
| _empty — fill in PR-C_ | | | | | |

## Reduced-motion coverage

| File | Has `prefers-reduced-motion` block | Notes |
|------|------------------------------------|-------|
| _empty — fill in PR-C_ | | |
```

- [ ] **Step 2: Commit**

```bash
mkdir -p docs/superpowers/audits
git add docs/superpowers/audits/motion-inventory.md
git commit -m "$(cat <<'EOF'
docs(audits): motion-inventory template for Phase 6 (PR-B)

Empty template; rows filled in PR-C. Lives past Phase 6 as a reference
for design-system motion decisions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create state-matrix template

**Files:**
- Create: `docs/superpowers/audits/state-matrix.md`

- [ ] **Step 1: Create the file**

```markdown
# Empty / loading / error / success state matrix

Living document. Every user-facing surface in the app, with a presence
check for each canonical state. Initially empty; filled in during the
Phase 6 audit (PR-C); kept current as new surfaces are added.

## Surfaces examined

(per `docs/superpowers/specs/2026-05-09-phase-6-audit-design.md` §3.5)

Library, Library import (DropOverlay + ImportTray), BookCard (and its menu),
Reader (EPUB + PDF), TocPanel, HighlightsPanel, BookmarksPanel, NoteEditor,
IndexInspectorModal, Chat thread list, ChatPanel, PrivacyPreview,
SuggestedPrompts, multi-excerpt tray, Settings.

## Matrix

| Surface | Loading | Empty | Success | Error | Notes |
|---------|---------|-------|---------|-------|-------|
| _empty — fill in PR-C_ | | | | | |

## ErrorBoundary placement recommendation

_To be written in PR-C after surveying `src/app/App.tsx` render tree._
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/audits/state-matrix.md
git commit -m "$(cat <<'EOF'
docs(audits): state-matrix template for Phase 6 (PR-B)

Empty template; rows filled in PR-C alongside ErrorBoundary placement
recommendation. Lives past Phase 6 as a reference.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verify and open PR-B

- [ ] **Step 1: Run the full quality gate**

Run:
```bash
pnpm check
```

Expected: type-check + lint + unit tests all green. If anything fails, fix root cause before proceeding (do not bypass).

- [ ] **Step 2: Run full e2e suite**

Run:
```bash
pnpm test:e2e
```

Expected: green, including the new `axe.spec.ts` and `offline.spec.ts`.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin <current-branch>
gh pr create --title "feat: Phase 6 audit tooling (PR-B)" --body "$(cat <<'EOF'
## Summary
- Add `@axe-core/react` (dev-only runtime a11y logger) and `@axe-core/playwright` (e2e analyzer)
- New `e2e/axe.spec.ts` records current serious/critical violation counts per primary flow as baselines
- New `e2e/offline.spec.ts` records current cold-offline / mid-session-offline / API-down behavior
- `docs/superpowers/audits/{motion-inventory,state-matrix}.md` templates (filled in PR-C)
- No production behavior change: axe is gated behind `import.meta.env.DEV` + dynamic import; verified `dist/` contains no `axe-core` references

Drives the Phase 6 raise-the-bar audit per spec `docs/superpowers/specs/2026-05-09-phase-6-audit-design.md`.

## Test plan
- [ ] `pnpm check` green
- [ ] `pnpm test:e2e` green
- [ ] Manual: `pnpm dev` → console shows axe baseline output
- [ ] Manual: `pnpm build && grep -ri axe-core dist/` returns nothing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR-B done. **Wait for PR-B to land before starting PR-C tasks.**

---

# PR-C — Audit execution and findings

PR-C tasks are audit-shaped: read source, fill structured tables, classify findings. They are not TDD-shaped because nothing is being tested — the tooling already added in PR-B does the testing. Each task produces a portion of the findings doc and updated audit artifacts.

Branch off `main` after PR-B has merged.

## Task 7: Fill motion inventory (6.1 audit)

**Files:**
- Modify: `docs/superpowers/audits/motion-inventory.md`

- [ ] **Step 1: Enumerate all CSS files containing motion**

Run:
```bash
grep -rEn "transition:|animation:|@keyframes|prefers-reduced-motion" src --include="*.css" -l | sort
```

Capture the file list — this is the full set to inventory.

- [ ] **Step 2: For each file, read it and extract every motion declaration**

For each CSS file in the list, run:
```bash
grep -nE "transition:|animation:|@keyframes|prefers-reduced-motion" <file>
```

Read the file with `Read` tool to see surrounding selectors. Add one row per declaration to the inventory table.

- [ ] **Step 3: Group rows by purpose**

Add a `Group` value to each row. Use stable group names: `state-feedback`, `panel-entry`, `panel-exit`, `hover-affordance`, `loading-indicator`, `drag-affordance`, `page-transition`, `focus-ring`, `other`.

- [ ] **Step 4: Mark observations**

For each row, fill `Observation` if any of the spec §3.1 finding heuristics apply:
- inconsistent durations within a single group
- non-token easing
- missing reduced-motion handling
- layout-triggering property used where transform would do
- unbounded loop with no stop condition

- [ ] **Step 5: Fill reduced-motion coverage table**

For each CSS file with motion, record whether it has its own `@media (prefers-reduced-motion: reduce)` block.

- [ ] **Step 6: Flag candidate findings (do not write findings doc yet)**

Keep a scratch list of inventory rows whose `Observation` column flags an issue. These become candidate F1.x findings in Task 13.

- [ ] **Step 7: Commit (intermediate)**

```bash
git add docs/superpowers/audits/motion-inventory.md
git commit -m "$(cat <<'EOF'
docs(audits): fill motion inventory (Phase 6 PR-C / 6.1)

Mechanically extracted every transition, animation, @keyframes, and
prefers-reduced-motion block under src/. Grouped by purpose; flagged
candidate findings in Observation column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Fill state matrix and ErrorBoundary recommendation (6.5 audit)

**Files:**
- Modify: `docs/superpowers/audits/state-matrix.md`

- [ ] **Step 1: For each surface in the spec list, locate the component file**

Use `Read` and `grep` to locate each. Record the file path next to the surface name.

- [ ] **Step 2: For each surface, determine which canonical states are implemented**

Read each component. For each canonical state (loading / empty / success / error), record:
- `present` — the state has a deliberate render path
- `absent` — the state has no render path; what would happen is undefined or a blank screen
- `inadequate` — the state exists but is generic, blank, or lacks recovery affordance

Add notes for any `inadequate` cases (what's missing).

- [ ] **Step 3: Confirm there is no top-level `ErrorBoundary`**

Run:
```bash
grep -rEn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" src --include="*.tsx" --include="*.ts"
```

Expected (per the brainstorming exploration): empty. If there *is* one, update the recommendation accordingly.

- [ ] **Step 4: Read `src/app/App.tsx` and decide ErrorBoundary placement**

Read `src/app/App.tsx`. Identify the render-tree boundaries:
- Around `<App />` itself (in `main.tsx`)?
- Around route-level views (Library, Reader)?
- Around the Reader workspace specifically (because PDF/EPUB adapters are the most likely crash sites)?

Decide a recommendation. Document it in the `## ErrorBoundary placement recommendation` section of `state-matrix.md`. The recommendation should specify:
- Which boundaries to add and in what file
- What each boundary's fallback UI should be
- Whether it logs (and if so, where)
- Whether per-screen boundaries also wrap the global one

This recommendation will translate into a finding (likely critical) in Task 13.

- [ ] **Step 5: Flag candidate findings (do not write findings doc yet)**

Scratch list: every surface row with `absent` or `inadequate` cells; the ErrorBoundary recommendation itself.

- [ ] **Step 6: Commit (intermediate)**

```bash
git add docs/superpowers/audits/state-matrix.md
git commit -m "$(cat <<'EOF'
docs(audits): fill state matrix + ErrorBoundary recommendation (Phase 6 PR-C / 6.5)

Per-surface presence check for loading/empty/success/error. Confirmed
no top-level ErrorBoundary exists; recommendation block added based
on current App.tsx render tree.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: A11y audit pass (6.2)

No artifact updated yet — this task produces a scratch list of candidate F2.x findings.

- [ ] **Step 1: Capture jsx-a11y lint state**

Run:
```bash
pnpm lint 2>&1 | grep -i "jsx-a11y\|a11y" | head -50
```

Record any violations to your scratch list as candidate F2.x findings (component, rule, severity rough estimate).

- [ ] **Step 2: Capture axe details from the dev-mode console**

The `@axe-core/react` integration wired in PR-B Task 1 logs every violation to the browser console with full detail (rule id, impact, target selector, help URL). Run:

```bash
pnpm dev
```

Open the app in Chrome with devtools console open. Navigate through each primary flow (library empty → library with book → reader → highlights panel → chat panel → IndexInspectorModal → settings). For each flow, copy the axe console output to your scratch list. Each violation block from axe gives you all the fields you need.

(The `e2e/axe.spec.ts` baselines from PR-B are the *count* — you don't need to re-run the e2e to enumerate; the dev-console output is more readable for audit notes.)

Stop the dev server when done.

- [ ] **Step 3: Manual keyboard walkthrough**

Run `pnpm dev`. With keyboard only (no mouse):
- Tab through the Library empty state — every interactive element reachable? Focus ring visible?
- Import a book via the keyboard. (May need to invoke the file picker via Enter on the import button.)
- Tab through the BookCard menu, open it via keyboard, navigate options.
- Open the Reader via keyboard. Tab through reader-chrome controls.
- Open each panel (TOC, Highlights, Bookmarks, Chat) via keyboard. Verify focus moves into the panel; verify focus returns sensibly on close.
- Open IndexInspectorModal. Verify focus trap and restoration.
- Open MobileSheet (resize viewport to mobile width). Verify focus trap.
- Open HighlightToolbar by selecting text — can this be triggered via keyboard at all? If not, that's a finding.

Record every blocker / missing focus ring / focus loss to scratch list.

- [ ] **Step 4: Tab-order check on each modal/sheet**

Specifically for: TypographyPanel, IndexInspectorModal, MobileSheet, HighlightToolbar popover. Tab order should flow logically (visual top → bottom or left → right) and not jump out of the modal until the user closes it.

- [ ] **Step 5: Consolidate scratch list**

Merge lint, axe, manual-keyboard, and tab-order observations into one structured list per the §5 findings table format. Don't write to findings doc yet — Task 13 does that.

No commit for this task — it produces only scratch notes.

---

## Task 10: Performance audit pass (6.3)

No artifact updated yet — produces candidate F3.x findings.

- [ ] **Step 1: Bundle size**

Run:
```bash
pnpm build
```

Then inspect `dist/assets/`:
```bash
ls -lah dist/assets/*.js dist/assets/*.css | sort -k5 -h
```

For each chunk over 250KB gz (use `gzip -k <file> && ls -lah <file>.gz`), record (chunk name, size, what it likely contains based on file naming).

- [ ] **Step 2: Lighthouse**

With `pnpm preview` running in another terminal:
```bash
pnpm preview &
sleep 3
```

Run Lighthouse in Chrome DevTools (Lighthouse panel) against:
- `http://localhost:4173/Bookworm/` (library route, empty state)
- After importing a book and opening it (reader route)

Record LCP, TBT, CLS, total bundle weight, and the score breakdown for any score below 80.

Stop preview server.

- [ ] **Step 3: React DevTools Profiler walkthrough**

Run `pnpm dev`. Open React DevTools Profiler tab. Record a session that does, in order:
- Import an EPUB (`test-fixtures/small-pride-and-prejudice.epub`)
- Open the book
- Paginate forward 10 pages
- Open and close TOC, Highlights, Bookmarks, Chat panels
- Highlight a passage
- Send one chat round-trip (skip if no API key configured locally)

Stop recording. Inspect the flame chart. Record:
- Any commit consistently >16ms during normal interaction (paginate, panel toggle, etc.)
- Any obvious re-render of a pure subtree on unrelated state change

- [ ] **Step 4: Indexing pipeline timing read**

Look at the indexing pipeline's existing log output. Find a representative book in the library; check for any slow phase (chunking, embeddings, persistence). Record timings to scratch list.

The pipeline logs are in `src/features/library/indexing/pipeline.ts` (read it; record what's logged). Run the dev server, import a non-trivial book, watch console.

- [ ] **Step 5: Consolidate scratch list**

Merge bundle, Lighthouse, profiler, indexing observations into structured F3.x candidate findings. No commit.

---

## Task 11: Offline audit pass (6.4)

No artifact updated yet — produces candidate F4.x findings.

- [ ] **Step 1: Read SW registration and Vite PWA config**

Read `src/pwa/register-sw.ts` and the `VitePWA` config block in `vite.config.ts`. Document in scratch:
- What workbox cache strategy is in use?
- What URL patterns are precached vs. runtime-cached?
- What's the SW lifecycle (immediate / wait-for-prompt)?
- The two existing `TODO: surface ... in Phase 6` comments in `register-sw.ts` — these become explicit findings.

- [ ] **Step 2: Examine the e2e offline spec results**

Run:
```bash
pnpm test:e2e e2e/offline.spec.ts -- --reporter=list
```

Read each test. For any test that you marked `test.fail()` in PR-B Task 3 Step 2, that's a definite finding — the assertion you wrote describes the *desired* behavior, the failure describes the gap. Record each.

- [ ] **Step 3: Manual offline flow check**

Run `pnpm preview`. In Chrome DevTools, Network tab → throttling dropdown → "Offline." Manually exercise:
- Cold reload the app — does the shell still load?
- Open an existing book — does it work?
- Create a highlight — does it persist?
- Reload the page — is resume position correct?
- Go online again — does any deferred sync happen? (None should; it's a local-first app.)

Record any surprises.

- [ ] **Step 4: Consolidate scratch list**

Merge SW-config observations, e2e failures, manual-flow observations into F4.x candidates. No commit.

---

## Task 12: Apply ≤10 inline trivial fixes

This is the only PR-C task that changes app code. It happens *after* the audit work in Tasks 7–11 has produced candidate findings, but *before* writing the findings doc in Task 13 — so the findings doc can record which findings were inline-fixed.

- [ ] **Step 1: Triage candidate findings to identify inline-fix candidates**

Look at all candidate findings from Tasks 7–11. Identify those that meet *all* of:
- ≤ 2 lines of code change
- No architectural decision needed
- No test reshape required
- Severity is **important** or **nice-to-have** (critical findings escalate to a follow-up spec, not inline)

Cap at ~10 fixes. If you have more candidates, take the highest-severity ones; defer the rest to follow-up specs.

- [ ] **Step 2: Apply each fix**

For each chosen fix, use `Edit` to make the change. Examples:
- "Add `aria-label` to icon-only button at `src/features/library/BookCardMenu.tsx:42`"
- "Replace ad-hoc 180ms duration with `var(--motion-duration-fast)` token in `src/features/reader/highlights-panel.css:17`"

Track which finding ID each fix addresses (e.g., F1.2, F2.5) — Task 13 needs this.

- [ ] **Step 3: Verify quality gate after fixes**

Run:
```bash
pnpm check
```

Expected: green. If a fix broke something, revert that one fix; do not push past a broken `pnpm check`.

- [ ] **Step 4: Verify e2e suite**

Run:
```bash
pnpm test:e2e
```

Expected: green. Note: if a fix improved a11y, the axe baseline counts in `e2e/axe.spec.ts` may now be lower than the baseline. **Lower the baseline constants to match** so the spec records the improvement.

- [ ] **Step 5: Commit (intermediate)**

Tasks 7 and 8 already committed their docs changes, so the only modifications outstanding are (a) the ≤10 inline fixes under `src/` and (b) possibly lowered baseline constants in `e2e/axe.spec.ts`. Stage them deterministically:

```bash
git status --short
# Verify the only changes shown are under src/ and possibly e2e/axe.spec.ts.
# If anything else is dirty, investigate before staging.
git add src/ e2e/axe.spec.ts
git commit -m "$(cat <<'EOF'
fix: capped inline polish fixes (Phase 6 PR-C)

≤10 trivially-fixable findings from the Phase 6 audit, applied inline.
Each is referenced by finding ID in docs/superpowers/audits/2026-05-09-phase-6-findings.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If `e2e/axe.spec.ts` was not modified (no a11y inline fixes), the `git add e2e/axe.spec.ts` line is a no-op — that's fine, git won't error.

---

## Task 13: Write findings doc

**Files:**
- Create: `docs/superpowers/audits/2026-05-09-phase-6-findings.md`

- [ ] **Step 1: Create the file with the canonical structure**

Use exactly the structure from spec §5:

```markdown
# Phase 6 audit findings — 2026-05-09

## Summary

| Sub-task | critical | important | nice-to-have | Total |
|----------|----------|-----------|--------------|-------|
| 6.1 Animation | _N_ | _N_ | _N_ | _N_ |
| 6.2 A11y | _N_ | _N_ | _N_ | _N_ |
| 6.3 Performance | _N_ | _N_ | _N_ | _N_ |
| 6.4 Offline | _N_ | _N_ | _N_ | _N_ |
| 6.5 Empty/error | _N_ | _N_ | _N_ | _N_ |

### Headline triage decisions

- 6.1: …
- 6.2: …
- 6.3: …
- 6.4: …
- 6.5: …

## 6.1 Animation findings

| ID | Finding | Severity | Location | Triage |
|----|---------|----------|----------|--------|
| F1.1 | … | … | … | … |

## 6.2 A11y findings
…

## 6.3 Performance findings
…

## 6.4 Offline findings
…

## 6.5 Empty/error findings
…

## Inline fixes applied in this PR
- F_X.Y_ — …

## Triaged for follow-up specs

For each sub-task that needs a follow-up implementation spec, write a
one-paragraph scope sketch. For each that doesn't, write a one-line
"no significant findings — closing out" justification.

- 6.1: …
- 6.2: …
- 6.3: …
- 6.4: …
- 6.5: …

## Decisions deferred

- …
```

- [ ] **Step 2: Fill from scratch lists**

Transcribe candidate findings from Tasks 7–11 scratch lists into the per-sub-task tables. Assign:
- A stable ID (F1.1, F1.2, F2.1, …) — sub-task number first, then sequential
- Severity per spec §5 rubric (critical / important / nice-to-have)
- Location (file:line where applicable)
- Triage (`fix-inline` if applied in Task 12, `spec → 6.X` if deferred to follow-up, `defer` if out of scope)

- [ ] **Step 3: Cross-reference Task 12's fixes**

For every fix applied in Task 12, ensure that finding's row in the table has triage `fix-inline`, and there's a matching entry under the `## Inline fixes applied in this PR` section. The two should be 1:1.

- [ ] **Step 4: Write headline triage decisions**

For each of 6.1–6.5, write one sentence in the Summary section:
- "spec to follow" + a one-line scope sketch, OR
- "no significant findings — closing out" + brief justification

For sub-tasks that need a follow-up spec, also write the one-paragraph scope sketch under `## Triaged for follow-up specs`. Each scope sketch should be specific enough that the next brainstorming session can start from it (e.g., "6.5 follow-up spec: introduce ErrorBoundary at App.tsx:NN, add error states to TocPanel + BookmarksPanel, replace LibraryEmptyState's static string with a recovery-action variant. Estimated 1 PR.").

- [ ] **Step 5: Fill the summary count table**

Count findings per sub-task × severity. Verify totals match per-section row counts.

- [ ] **Step 6: Sanity-check the doc**

Read the doc top-to-bottom. Every finding has all five fields populated. Every triage = `spec → 6.X` has a matching scope sketch in the follow-up section. Every triage = `fix-inline` has a matching entry in the inline-fixes section. No `_N_` or `…` placeholders remain.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/audits/2026-05-09-phase-6-findings.md
git commit -m "$(cat <<'EOF'
docs(audits): Phase 6 findings doc (PR-C)

Per-sub-task findings list with severity + triage. Triage decisions:
inline fixes applied in this PR (cross-ref by finding ID), follow-up
specs spawned for sub-tasks with non-trivial work, no-op closures
recorded for sub-tasks with no significant findings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Mark roadmap, verify, open PR-C

**Files:**
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Mark Phase 6 audit milestone in roadmap**

Open `docs/04-implementation-roadmap.md`. After the existing `Phase 5.5 — complete (2026-05-08)` line near the top, add a line for the audit milestone. Use the same date format as existing entries:

```markdown
- Phase 6 audit — complete (2026-05-XX)
```

(Replace `XX` with today's date.)

The actual sub-task acceptance criteria in §"Phase 6" are *not* marked complete by this PR — only the audit milestone. Sub-task completion happens in follow-up implementation PRs.

- [ ] **Step 2: Run quality gate**

Run:
```bash
pnpm check
```

Expected: green.

- [ ] **Step 3: Run e2e**

Run:
```bash
pnpm test:e2e
```

Expected: green.

- [ ] **Step 4: Push and open PR**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "$(cat <<'EOF'
docs(roadmap): mark Phase 6 audit complete

Sub-task implementation PRs follow per findings-doc triage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin <current-branch>
gh pr create --title "docs: Phase 6 audit findings (PR-C)" --body "$(cat <<'EOF'
## Summary
- Filled `docs/superpowers/audits/motion-inventory.md` (every CSS motion declaration, grouped by purpose, observation column)
- Filled `docs/superpowers/audits/state-matrix.md` (per-surface canonical-state presence check + ErrorBoundary placement recommendation)
- New `docs/superpowers/audits/2026-05-09-phase-6-findings.md` with per-sub-task findings, severity, and triage decision
- Applied ≤10 inline trivially-fixable findings (each cross-referenced by finding ID in the findings doc)
- Roadmap marked: Phase 6 audit complete

Drives spec `docs/superpowers/specs/2026-05-09-phase-6-audit-design.md`.

Sub-task implementation PRs (per the findings-doc triage) follow this PR.

## Test plan
- [ ] `pnpm check` green
- [ ] `pnpm test:e2e` green (axe baselines lowered to reflect inline fixes if applicable)
- [ ] Review findings doc: every finding has severity + triage; every `fix-inline` triage has a matching inline-fixes entry; every `spec → 6.X` has a scope sketch

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR-C done. Phase 6 audit phase is complete. Implementation specs for triaged sub-tasks become subsequent brainstorming sessions, each producing its own design doc + plan.

---

## Done definition

- PR-B merged: tooling, baselines, templates land on main. App behavior unchanged in production.
- PR-C merged: findings doc + filled audit artifacts + capped inline fixes land on main. Roadmap marks audit complete.
- For every sub-task area (6.1–6.5), the findings doc records either a follow-up spec scope sketch or a "no significant findings" closure with justification.
