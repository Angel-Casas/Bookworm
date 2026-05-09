# Phase 6.3 Bundle Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the main `dist/assets/index-*.js` chunk from ~420 KB gz under the 250 KB gz soft target by lazy-loading three top-level routes (Reader, Notebook, Settings) via `React.lazy`, plus relocate `createAdapter` from `useReaderHost` into `ReaderWorkspace` so foliate-js + pdfjs land in the lazy chunk rather than the main bundle.

**Architecture:** App.tsx replaces three static imports with `React.lazy(() => import(...))` calls and wraps each render site in `<Suspense fallback={<RouteLoading />}>`. The `createAdapter` `useCallback` (currently in `useReaderHost.ts`, eagerly imported by `ReadyApp`) moves into `ReaderWorkspace` so its EpubReaderAdapter and PdfReaderAdapter imports follow the lazy chunk graph. LibraryView stays eager — it's the landing page.

**Tech Stack:** React 19, Vite, TypeScript. No new dependencies.

---

## File map

**New (3):**
- `src/app/RouteLoading.tsx` — shared Suspense fallback
- `src/app/route-loading.css` — fallback styling
- `src/app/RouteLoading.test.tsx` — single render test

**Modified (4):**
- `src/app/useReaderHost.ts` — remove `createAdapter` useCallback + adapter imports; drop from `ReaderHostHandle` type and return
- `src/features/reader/workspace/ReaderWorkspace.tsx` — import EpubReaderAdapter + PdfReaderAdapter; define local `createAdapter` useCallback; drop `createAdapter` from `Props`
- `src/app/App.tsx` — replace 3 static imports with `React.lazy`; wrap 3 render sites in `<Suspense>`; drop the `createAdapter={reader.createAdapter}` prop pass
- `docs/04-implementation-roadmap.md` — mark 6.3 complete

7 files total.

---

## Task 1: `RouteLoading` component (TDD)

**Files:**
- Create: `src/app/RouteLoading.tsx`
- Create: `src/app/RouteLoading.test.tsx`
- Create: `src/app/route-loading.css`

- [ ] **Step 1: Write the failing test**

Create `src/app/RouteLoading.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RouteLoading } from './RouteLoading';

afterEach(cleanup);

describe('RouteLoading', () => {
  it('renders with role="main", aria-busy="true", and "Loading…" copy', () => {
    render(<RouteLoading />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(main.textContent).toMatch(/Loading/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/RouteLoading.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/app/RouteLoading.tsx`:

```tsx
import './route-loading.css';

export function RouteLoading() {
  return (
    <main className="route-loading" aria-busy="true">
      <p className="route-loading__copy">Loading&hellip;</p>
    </main>
  );
}
```

Create `src/app/route-loading.css`:

```css
.route-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--color-bg);
}

.route-loading__copy {
  font-family: var(--font-serif);
  font-size: var(--text-md);
  color: var(--color-text-muted);
  font-style: italic;
  margin: 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/RouteLoading.test.tsx`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/RouteLoading.tsx src/app/RouteLoading.test.tsx src/app/route-loading.css
git commit -m "$(cat <<'EOF'
feat(app): RouteLoading Suspense fallback (Phase 6.3)

Single shared component used as React.lazy Suspense fallback for the
three top-level lazy routes (Reader, Notebook, Settings). Generic
"Loading…" copy with role="main" + aria-busy="true". Design-system-
token-styled to match the boot loader's feel.

Not yet wired into App.tsx — that lands together with the lazy
boundaries in Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Relocate `createAdapter` from `useReaderHost` into `ReaderWorkspace`

This task is purely a refactor — no behavior change. Verify with `pnpm check` after the move.

**Files:**
- Modify: `src/app/useReaderHost.ts`
- Modify: `src/features/reader/workspace/ReaderWorkspace.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add adapter imports + local `createAdapter` to `ReaderWorkspace.tsx`**

In `src/features/reader/workspace/ReaderWorkspace.tsx`, near the top with the other reader feature imports, add:

```tsx
import { EpubReaderAdapter } from '@/features/reader/epub/EpubReaderAdapter';
import { PdfReaderAdapter } from '@/features/reader/pdf/PdfReaderAdapter';
```

(Adjacent to existing imports like `useHighlights`, `useBookmarks`, etc. — find them via `grep -n "from '@/features/reader" src/features/reader/workspace/ReaderWorkspace.tsx`.)

Inside the `ReaderWorkspace` function component, after the existing `useReaderHost`/state setup (look for the existing `useCallback` declarations around line 200+), add:

```tsx
  const createAdapter = useCallback(
    (mountInto: HTMLElement, format: BookFormat): BookReader => {
      if (format === 'pdf') return new PdfReaderAdapter(mountInto);
      return new EpubReaderAdapter(mountInto);
    },
    [],
  );
```

If `useCallback`, `BookFormat`, or `BookReader` aren't already imported at the top of ReaderWorkspace.tsx, add them. Verify with `grep -n "useCallback\|BookFormat\|BookReader" src/features/reader/workspace/ReaderWorkspace.tsx`.

- [ ] **Step 2: Drop `createAdapter` from ReaderWorkspace's Props type**

In `src/features/reader/workspace/ReaderWorkspace.tsx`, find the `Props` (or however it's typed) declaration around line 60-90. Remove the line:

```tsx
  readonly createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
```

- [ ] **Step 3: Use the local `createAdapter` at the ReaderView render site**

Find line ~721 in `src/features/reader/workspace/ReaderWorkspace.tsx`:

```tsx
            createAdapter={props.createAdapter}
```

Replace with:

```tsx
            createAdapter={createAdapter}
```

(`props.` → no prefix; we're using the local variable now.)

- [ ] **Step 4: Drop `createAdapter` from `useReaderHost.ts`**

In `src/app/useReaderHost.ts`:

a. Remove these imports (lines 14-15):
```tsx
import { EpubReaderAdapter } from '@/features/reader/epub/EpubReaderAdapter';
import { PdfReaderAdapter } from '@/features/reader/pdf/PdfReaderAdapter';
```

b. Remove these type imports if they're no longer used elsewhere in the file (check with grep first):
```tsx
import type { BookFormat } from '@/domain';   // keep if loadBookForReader still references it
import type { BookReader } from '@/domain/reader';   // likely unused after this change
```

Run `grep -n "BookFormat\|BookReader" src/app/useReaderHost.ts` after removing the import lines to verify the types aren't used elsewhere. If they are, leave the import.

c. Remove the `createAdapter` field from the `ReaderHostHandle` type (around line 22):
```ts
  createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
```

d. Remove the `useCallback` block (lines 103-109):
```tsx
  const createAdapter = useCallback(
    (mountInto: HTMLElement, format: BookFormat): BookReader => {
      if (format === 'pdf') return new PdfReaderAdapter(mountInto);
      return new EpubReaderAdapter(mountInto);
    },
    [],
  );
```

e. Remove the `createAdapter,` line from the return value (around line 222):
```tsx
    createAdapter,
```

- [ ] **Step 5: Drop the `createAdapter` prop pass in `App.tsx`**

Find line 294 in `src/app/App.tsx`:

```tsx
          createAdapter={reader.createAdapter}
```

Delete that line entirely. The other props on the ReaderWorkspace call site stay unchanged.

- [ ] **Step 6: Run quality gate**

Run: `pnpm check`
Expected: green (~1018 unit tests; +1 new from Task 1).

If TypeScript flags an error like "property `createAdapter` is missing on type ReaderHostHandle", a consumer somewhere else still references it. Search:

```bash
grep -rn "reader\.createAdapter\|useReaderHost.*createAdapter" src/
```

Update those call sites to remove the reference. (App.tsx:294 is the only known one; this is a defensive sweep.)

- [ ] **Step 7: Run e2e to verify behavior**

Run: `pnpm build && pnpm test:e2e`
Expected: 85 passed, 6 skipped. The reader-mode flows (highlights, bookmarks, chat) all exercise the relocated `createAdapter` — if they pass, the refactor is behaviorally clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/useReaderHost.ts src/features/reader/workspace/ReaderWorkspace.tsx src/app/App.tsx
git commit -m "$(cat <<'EOF'
refactor: relocate createAdapter into ReaderWorkspace (Phase 6.3 prep)

Adapter factory was in useReaderHost (called eagerly from ReadyApp),
which pulled foliate-js + pdfjs into the main bundle. Moving it into
ReaderWorkspace itself confines those imports to the (soon-to-be-
lazy) Reader chunk. No behavior change; pure code relocation.

Drops createAdapter from ReaderHostHandle, from ReaderWorkspace's
Props, and from App.tsx's ReaderWorkspace pass-through. The state
machine + ReaderView keep the same sync createAdapter() signature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Apply `React.lazy` + `<Suspense>` to three routes in `App.tsx`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add `lazy` and `Suspense` to the React import**

In `src/app/App.tsx` near the top, find the existing React import:

```tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
```

Replace with:

```tsx
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
```

- [ ] **Step 2: Replace static imports for the three lazy routes**

Find these existing imports (around lines 20-22 of `src/app/App.tsx`):

```tsx
import { ReaderWorkspace } from '@/features/reader/workspace/ReaderWorkspace';
import { NotebookView } from '@/features/annotations/notebook/NotebookView';
import { SettingsView } from '@/features/ai/settings/SettingsView';
```

Replace with:

```tsx
import { RouteLoading } from '@/app/RouteLoading';

const ReaderWorkspace = lazy(() =>
  import('@/features/reader/workspace/ReaderWorkspace').then((m) => ({
    default: m.ReaderWorkspace,
  })),
);
const NotebookView = lazy(() =>
  import('@/features/annotations/notebook/NotebookView').then((m) => ({
    default: m.NotebookView,
  })),
);
const SettingsView = lazy(() =>
  import('@/features/ai/settings/SettingsView').then((m) => ({
    default: m.SettingsView,
  })),
);
```

The `.then((m) => ({ default: m.X }))` shim wraps named exports so `React.lazy` (which expects a default-export module) is happy.

- [ ] **Step 3: Wrap the three render sites in `<Suspense>`**

Find each render site by searching `view.current.kind === 'reader'`, `'notebook'`, `'settings'` in App.tsx (around lines 246, 270, 278).

For the **notebook** site (around line 246), the current code looks roughly like:

```tsx
  if (view.current.kind === 'notebook') {
    return <NotebookView {...} />;
  }
```

Wrap it:

```tsx
  if (view.current.kind === 'notebook') {
    return (
      <Suspense fallback={<RouteLoading />}>
        <NotebookView {...} />
      </Suspense>
    );
  }
```

Same shape for **settings** (line ~270) and **reader** (line ~278). Don't change the props; just wrap the existing JSX.

The `library` (default) branch stays unchanged — `LibraryView` is still statically imported.

- [ ] **Step 4: Run quality gate**

Run: `pnpm check`
Expected: green.

If TypeScript flags errors, the most likely culprit is the React.lazy default-export shim — verify each `import(...)` path resolves to the named-export module and that the `m.X` accessor matches the actual exported name. If a module has a different export name (unlikely; verified in the spec), adjust.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): lazy-load Reader, Notebook, Settings routes (Phase 6.3)

App.tsx replaces three static imports with React.lazy(() => import())
+ <Suspense fallback={<RouteLoading />}> wrappers. LibraryView stays
eager (it's the landing). Each lazy route gets its own chunk in the
build output; the heavy stuff (foliate-js, pdfjs, xstate, panels,
chat) moves out of the main index-*.js bundle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Verify build sizes + e2e

This is a verification-only task — no code changes if everything looks right.

**Files:** none (verification only)

- [ ] **Step 1: Build and capture chunk sizes**

Run: `pnpm build`

Look at the Vite output. Expected:
- `dist/assets/index-*.js` should be substantially smaller than ~420 KB gz (likely 120–280 KB gz).
- New chunks should appear: `dist/assets/ReaderWorkspace-*.js` (likely the largest at 100+ KB gz), `dist/assets/NotebookView-*.js`, `dist/assets/SettingsView-*.js`.
- The other existing small chunks (epub-*, mobi-*, paginator-*, fixed-layout-*, fb2-*, comic-book-*, zip-*, fflate-*, search-*, tts-*, workbox-window-*) stay roughly the same.

Record the new main bundle size. If it's under 250 KB gz, target hit. If it's between 250 and 300 KB gz, soft target essentially hit (audit defined 250 as informational). If it's over 300 KB gz, investigate — most likely cause is unexpected re-import paths from main code into lazy modules.

- [ ] **Step 2: Confirm the chunk graph looks right**

```bash
ls -lah dist/assets/*.js | sort -k5 -h
```

Sanity check:
- `ReaderWorkspace-*.js` is large (>50 KB gz, likely >100 KB).
- `index-*.js` is smaller than before (was ~1.4 MB raw / 420 KB gz).
- No accidental duplication — if a small shared module appears twice (e.g., `index-*.js` AND `ReaderWorkspace-*.js` both reference the same util), Vite usually consolidates into a `chunk-*.js` shared chunk. If you see suspicious duplication, that's a `manualChunks` config opportunity but probably not needed for this PR.

- [ ] **Step 3: Run full e2e**

Run: `pnpm test:e2e`
Expected: 85 passed, 6 skipped.

If e2e flakes due to lazy-load timing (e.g., a test asserts on Reader content within 100ms of clicking a book), the lazy chunk fetch may take longer than the test allows. Symptoms:
- Test fails with "element not visible after 5s" or similar timeout.
- Re-running the same test passes (after the chunk is in browser/SW cache).

If a flake appears on first run, increase the timeout for the affected step in that spec, or add a `await page.waitForLoadState('networkidle')` after navigation. Avoid masking a real regression — investigate first.

- [ ] **Step 4: No commit**

Verification produces no code changes. The PR description in Task 5 records the chunk size delta.

---

## Task 5: Mark roadmap, push, open PR

**Files:**
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Mark 6.3 complete**

In `docs/04-implementation-roadmap.md`, after the existing `Phase 6.2 — complete (2026-05-09)` line in the Status block at the top, add:

```markdown
- Phase 6.3 — complete (2026-05-XX)
```

(Replace `XX` with today's date.)

- [ ] **Step 2: Final quality gate**

Run: `pnpm check`
Expected: green.

- [ ] **Step 3: Final e2e**

Run: `pnpm build && pnpm test:e2e`
Expected: 85 passed, 6 skipped.

- [ ] **Step 4: Commit roadmap**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "$(cat <<'EOF'
docs(roadmap): mark Phase 6.3 complete

Main-bundle code-splitting via route-level React.lazy landed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push and open PR**

The PR body should include the actual before/after chunk sizes captured in Task 4 — fill in the bracketed values from your build output:

```bash
git push -u origin phase-6-3-bundle-split
gh pr create --title "feat: Phase 6.3 — main-bundle code-splitting via React.lazy" --body "$(cat <<'EOF'
## Summary

Resolves audit finding F3.1 (important — main JS bundle 420.51 KB gz, over the 250 KB gz soft target).

**Three lazy boundaries** via `React.lazy` at the route level:
- `ReaderWorkspace` — pulls foliate-js + pdfjs + xstate + panels + chat into its own chunk
- `NotebookView`
- `SettingsView`

`LibraryView` stays eager (it's the landing).

**Companion refactor:** `createAdapter` (and its imports of `EpubReaderAdapter` / `PdfReaderAdapter`) moved from `useReaderHost` into `ReaderWorkspace` itself. Without this, `useReaderHost` — eagerly called from `ReadyApp` — would still pull foliate-js + pdfjs into the main bundle, defeating the lazy boundary. Cleaner architectural fit too: the adapter factory is a Reader concern.

**Single shared `<RouteLoading />`** Suspense fallback. After first SW cache hit it flashes briefly or not at all.

## Bundle size impact

| Chunk | Before | After |
|---|---|---|
| `index-*.js` (main) | 420.51 KB gz | **{NEW_MAIN_GZ} KB gz** |
| `ReaderWorkspace-*.js` | (in main) | **{READER_GZ} KB gz** (new) |
| `NotebookView-*.js` | (in main) | **{NOTEBOOK_GZ} KB gz** (new) |
| `SettingsView-*.js` | (in main) | **{SETTINGS_GZ} KB gz** (new) |

(Replace `{...}` with values from the Task 4 verification.)

## Test plan
- [x] `pnpm check` green (~1018 unit tests, +1 new for `RouteLoading`)
- [x] `pnpm test:e2e` green (85 passed, 6 skipped)
- [x] `pnpm build` shows new chunks emerging; main `index-*.js` substantially smaller
- [x] Reader / Notebook / Settings flows still work end-to-end (covered by existing e2e)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done definition

- All 5 tasks complete with their commits.
- `RouteLoading` component exists and is used as the Suspense fallback for three routes.
- `createAdapter` lives in `ReaderWorkspace`, not `useReaderHost`.
- `pnpm check` green; `pnpm test:e2e` green.
- Main `index-*.js` bundle is under 300 KB gz (informational soft target).
- New per-route chunks appear in `dist/assets/`.
- Roadmap marks `Phase 6.3 — complete (YYYY-MM-DD)`.
- PR opened with before/after chunk size table filled in.
