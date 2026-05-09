# Phase 6.5 — Top-level ErrorBoundary + reader-panel error states

**Status:** approved 2026-05-09
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 6 → Task 6.5 (Empty/error state polish)
**Predecessors:** Phase 6 audit (PR-A spec, PR-B tooling, PR-C findings doc) — landed as `docs/superpowers/audits/2026-05-09-phase-6-findings.md`. This spec resolves audit findings F5.3 (critical) and F5.2 (important).
**Architecture decisions referenced:** `docs/06-quality-strategy.md` §"error-state requirements"; existing `LibraryBootError` (`src/features/library/LibraryBootError.tsx`) and `library-boot-error.css` for fallback-UI consistency; `docs/superpowers/audits/state-matrix.md` §"ErrorBoundary placement recommendation".

---

## 1. Goal & scope

Address the only **critical** finding from the Phase 6 audit (F5.3) — no top-level `ErrorBoundary` anywhere in `src/`, so any unhandled render error after boot unmounts the entire React tree, leaving the user with a blank page and no recovery path. Bundled with F5.2 (data-loading hooks silently swallow repo rejections at load time, leaving panels rendering the empty state — indistinguishable from "no data").

Single PR addressing two areas:

1. **AppErrorBoundary (F5.3).** Class component wrapping `<ReadyApp boot={boot} />` in `App.tsx:450`. Catches any render-time error in any descendant. Fallback UI is visually consistent with `LibraryBootError`, includes a collapsible "Show details" `<details>` revealing `error.message + error.stack`, and a "Reload Bookworm" button. Tier-1 only.

2. **Hook-level error states (F5.2).** Four data-loading hooks — `useBookmarks`, `useHighlights`, `useNotes`, `useChatThreads` — currently fire-and-forget their initial repo load. This PR adds explicit try/catch, exposes `loadError + retryLoad` through the hook handle, and wires three downstream panels (`HighlightsPanel`, `BookmarksPanel`, `ThreadList`) to render an error variant with a Retry button. `TocPanel` is unchanged (TOC comes from the book reader, not a repo).

### In scope (v1)

- `src/app/AppErrorBoundary.tsx` (new): class component + `AppErrorFallback` functional component in the same file. ~80 lines total.
- `src/app/App.tsx`: wrap `<ReadyApp boot={boot} />` with `<AppErrorBoundary>` at line 450. No other change.
- `src/features/reader/workspace/useBookmarks.ts`: add `loadError + retryLoad` to `UseBookmarksHandle`; replace silent `void repo.listByBook(...)` with try/catch + `loadNonce`-driven retry.
- `src/features/reader/workspace/useHighlights.ts`: same change pattern.
- `src/features/reader/workspace/useNotes.ts`: same change pattern *if* the load shape matches (verify in plan task before applying — see §7 risks).
- `src/features/ai/chat/useChatThreads.ts`: same change pattern.
- `src/features/reader/HighlightsPanel.tsx`: accept `loadError + onRetryLoad` props; render error variant with `role="alert"` + Retry button before the existing empty-state branch.
- `src/features/reader/BookmarksPanel.tsx`: same.
- `src/features/ai/chat/ThreadList.tsx`: same.
- CSS: `--error` modifier blocks added to `highlights-panel.css`, `bookmarks-panel.css`, `thread-list.css`. Reuse the existing empty-state container styling. Differ in icon (`!`), color (subtle warning, not full danger), and the action button.
- Wiring: `ReaderWorkspace` passes new props through to the reader panels; the chat-panel host passes through to `ThreadList`.
- Tests: see §6.

### Out of scope (deferred)

- **Tier-2 per-route boundaries** (around `<ReaderWorkspace />`, `<NotebookView />`, `<SettingsView />`). Defer to v1.x unless an incident warrants. Single tier-1 boundary catches everything; per-route boundaries only change the granularity of the fallback (full-app reload vs route-level fallback).
- **Tier-3 per-panel boundaries.** Deferred for the same reason.
- **E2e tests.** Render errors are hard to inject in a production build without polluting prod code. Unit coverage is sufficient.
- **Error-reporting telemetry.** Local-first PWA; no backend.
- **Retry throttle/debounce.** No rate-limit on `retryLoad`; rapid retries are serialized by IndexedDB and don't warrant special handling.
- **`reset()` wiring.** The `AppErrorBoundary` class exposes a private `reset` method but it is not wired to the fallback in this PR. Reserved for hypothetical future tier-2 boundaries.

---

## 2. AppErrorBoundary architecture

### File: `src/app/AppErrorBoundary.tsx` (new)

Class component (React 19's hook-based error handling still does not catch render-time errors — class boundaries remain mandatory):

```ts
type Props = { readonly children: ReactNode };
type State = { readonly error: Error | null };

class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] caught render error', error, info);
  }
  private reset = (): void => this.setState({ error: null });
  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return <AppErrorFallback error={this.state.error} onReload={() => window.location.reload()} />;
  }
}
```

`componentDidCatch` always logs to `console.error` (dev `@axe-core/react` console + production browser devtools both surface it). No side effects beyond logging.

`reset` is unused in this PR — present for future tier-2 wiring; presence costs nothing.

### Fallback (`AppErrorFallback`, same file)

Functional component. Visually consistent with `LibraryBootError`:
- Reuses `library-boot-error.css` (no new stylesheet)
- Same eyebrow / plate / typography
- Title: **"Something went wrong."**
- Body: **"Bookworm crashed. Reloading usually clears this."**
- **Collapsible technical details** via native `<details><summary>Show details</summary><pre>{error.message}\n\n{error.stack}</pre></details>`. Closed by default. Native element — no JS, accessible by default, expands with keyboard.
- Action button: **"Reload Bookworm"** → `onReload()` → `window.location.reload()`.

### Wire-up in `App.tsx:450`

Replace:
```tsx
return <ReadyApp boot={boot} />;
```

with:
```tsx
return (
  <AppErrorBoundary>
    <ReadyApp boot={boot} />
  </AppErrorBoundary>
);
```

### What's NOT inside the boundary

The `loading` and `error` boot-state branches at `App.tsx:440-449` render trivial markup that's vanishingly unlikely to throw, and they have their own explicit error handling (`LibraryBootError`). Wrapping them adds nothing.

---

## 3. Hook-level error handling

### Affected hooks (all use the same pattern)

1. `src/features/reader/workspace/useBookmarks.ts` — `repo.listByBook(bookId)` at line 30
2. `src/features/reader/workspace/useHighlights.ts` — `repo.listByBook(bookId)` at line ~54
3. `src/features/reader/workspace/useNotes.ts` — verify load shape in plan task before applying
4. `src/features/ai/chat/useChatThreads.ts` — `threadsRepo.listByBook(bookId)` at line 40

### Pattern (uniform)

Extend the handle type:

```ts
export type UseBookmarksHandle = {
  readonly list: readonly Bookmark[];
  readonly loadError: Error | null;
  readonly retryLoad: () => void;
  readonly add: () => Promise<void>;
  readonly remove: (b: Bookmark) => Promise<void>;
};
```

Replace the silent load:

```ts
useEffect(() => {
  let cancelled = false;
  void repo.listByBook(bookId).then((records) => {
    if (!cancelled) setList(sortNewestFirst(records));
  });
  return () => { cancelled = true; };
}, [bookId, repo]);
```

with explicit catch + retry wiring:

```ts
const [loadError, setLoadError] = useState<Error | null>(null);
const [loadNonce, setLoadNonce] = useState(0);

useEffect(() => {
  let cancelled = false;
  setLoadError(null);
  void (async () => {
    try {
      const records = await repo.listByBook(bookId);
      if (!cancelled) setList(sortNewestFirst(records));
    } catch (err) {
      if (!cancelled) setLoadError(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return () => { cancelled = true; };
}, [bookId, repo, loadNonce]);

const retryLoad = useCallback(() => setLoadNonce((n) => n + 1), []);
```

The `loadNonce` re-runs the effect by participating in the dep array. Cleaner than calling the load function imperatively (avoids a second copy of the load logic).

### Mutation methods unchanged

Existing `add` / `remove` / `patch` already have try/catches with rollback. The fix is **load-only**.

### Edge cases

- **Race between retry and unmount.** The `cancelled` flag handles this — if the user retries then immediately unmounts, the cleanup sets `cancelled = true` and the new try/catch's success/failure branches both no-op.
- **Rapid retry storm.** No throttle. IndexedDB serializes load calls naturally; mashing Retry just queues serial loads. Not a problem at the scale of local-first.
- **StrictMode double-invoke in dev.** Existing pattern already double-invokes; the `cancelled` flag already handles it. No behavior change.

---

## 4. Panel error rendering

### `HighlightsPanel.tsx`

Add to `Props`:
```ts
readonly loadError?: Error | null;
readonly onRetryLoad?: () => void;
```

Render order (mutually exclusive): error > empty > populated.

```tsx
if (loadError != null) {
  return (
    <aside
      className="highlights-panel highlights-panel--error"
      aria-label="Highlights"
      role="alert"
    >
      <p className="highlights-panel__error-icon" aria-hidden="true">!</p>
      <p className="highlights-panel__error-title">Couldn't load highlights</p>
      <button
        type="button"
        className="highlights-panel__error-action"
        onClick={onRetryLoad}
      >
        Retry
      </button>
    </aside>
  );
}
if (highlights.length === 0) { /* existing empty state */ }
/* existing populated render */
```

### `BookmarksPanel.tsx`
Same shape. Copy: "Couldn't load bookmarks".

### `ThreadList.tsx`
Same shape. Copy: "Couldn't load conversations".

### CSS

Each of `highlights-panel.css`, `bookmarks-panel.css`, `thread-list.css` gets an `--error` modifier block reusing the existing empty-state container (padding, layout, font). Differences:
- Icon glyph: `!` (consistent with `import-tray__item--failed`)
- Color: subtle warning (`color-mix(in oklab, var(--color-warning, #b45309) 70%, var(--color-text-subtle))` or similar — implementation phase picks the exact value to meet contrast)
- Action: button styled like the existing CTA in empty states

### Wiring

`ReaderWorkspace` passes through:
```tsx
<HighlightsPanel
  {...existingProps}
  loadError={highlights.loadError}
  onRetryLoad={highlights.retryLoad}
/>
```

Same for `BookmarksPanel` and `ThreadList`'s host. Plumbing is mechanical; the hook handles already include the new fields after §3.

### What's NOT shown in panel error states

The technical `error.message` is **not** displayed at panel scope — only in `AppErrorBoundary`'s collapsible details. Panel scope is too narrow for a stack-trace UI; "Retry" is the affordance.

---

## 5. File summary

```
NEW   src/app/AppErrorBoundary.tsx                           — class boundary + fallback (~80 lines)
NEW   src/app/AppErrorBoundary.test.tsx                      — 4 cases
MOD   src/app/App.tsx                                        — wrap <ReadyApp /> at line 450

MOD   src/features/reader/workspace/useBookmarks.ts          — loadError + retryLoad
MOD   src/features/reader/workspace/useHighlights.ts         — same
MOD   src/features/reader/workspace/useNotes.ts              — same (verify load shape first)
MOD   src/features/ai/chat/useChatThreads.ts                 — same

MOD   src/features/reader/workspace/useBookmarks.test.ts     — 3 new cases
MOD   src/features/reader/workspace/useHighlights.test.ts    — 3 new cases
MOD   src/features/reader/workspace/useNotes.test.ts         — 3 new cases (load-shape-dependent)
MOD   src/features/ai/chat/useChatThreads.test.ts            — 3 new cases

MOD   src/features/reader/HighlightsPanel.tsx                — error variant
MOD   src/features/reader/BookmarksPanel.tsx                 — error variant
MOD   src/features/ai/chat/ThreadList.tsx                    — error variant
MOD   src/features/reader/HighlightsPanel.test.tsx           — error variant case
MOD   src/features/reader/BookmarksPanel.test.tsx            — error variant case
MOD   src/features/ai/chat/ThreadList.test.tsx               — error variant case

MOD   src/features/reader/highlights-panel.css               — --error modifier
MOD   src/features/reader/bookmarks-panel.css                — --error modifier
MOD   src/features/ai/chat/thread-list.css                   — --error modifier

MOD   src/features/reader/workspace/ReaderWorkspace.tsx      — wire loadError + onRetryLoad through to HighlightsPanel + BookmarksPanel
MOD   src/features/ai/chat/ChatPanel.tsx                     — read loadError + retryLoad from useChatThreads, pass through to ChatHeader
MOD   src/features/ai/chat/ChatHeader.tsx                    — pass loadError + onRetryLoad through to ThreadList

MOD   docs/04-implementation-roadmap.md                      — mark 6.5 complete
```

~23 files modified or new.

---

## 6. Testing

**Five new/updated test files for hook + boundary work:**

1. **`src/app/AppErrorBoundary.test.tsx`** (new). Cases:
   - Renders children when no error.
   - Catches a render-time throw from a child, renders `AppErrorFallback`.
   - Reload button calls `window.location.reload` (mocked).
   - `<details>` for technical message is closed by default; expanding reveals `error.message`.

2. **`useBookmarks.test.ts`**, **`useHighlights.test.ts`**, **`useNotes.test.ts`**, **`useChatThreads.test.ts`** (extend existing). Cases per hook:
   - Load: repo rejects → handle exposes `loadError`; `list` stays `[]`.
   - `retryLoad()` re-runs the load; on success, `loadError` clears and `list` populates.
   - `retryLoad()` after second rejection still surfaces the new error.

**Three updated panel tests:**
- `HighlightsPanel.test.tsx`, `BookmarksPanel.test.tsx`, `ThreadList.test.tsx`: add a case supplying `loadError` + `onRetryLoad`, asserting the error variant renders with `role="alert"` and a Retry button. Click Retry; assert `onRetryLoad` is invoked.

**No e2e tests** for this PR. Render errors are hard to inject in production builds without polluting prod code with test hooks. Unit coverage is sufficient.

**Manual smoke check (deferred, not gating).** With `pnpm dev` open, throw an error from a Reader component and confirm fallback renders and reload button works. Five-minute hands-on check; not blocking.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `AppErrorBoundary` swallows errors useful in development | `componentDidCatch` always logs to `console.error`. Dev-mode `@axe-core/react` and React DevTools error overlays still surface throws before the boundary kicks in. Nothing is *lost*. |
| Adding `loadError` to four hooks in one PR causes mass test churn | Existing tests don't change; new cases append. Surface-area additive, not breaking. |
| `useNotes.ts` load shape differs from the others | Plan task #1 reads `useNotes.ts` first. If notes load per-highlight rather than per-book, the error UX shifts (per-row error in the highlight list, not a panel-wide error). Plan documents the divergence and adapts the test cases. If the divergence is large, defer notes to a follow-up and complete the other three. |
| Class component + functional fallback in one file | Acceptable for ~80 lines total. Splitting into two files is over-engineered. |
| Panel error variants disagree visually | All three reuse the existing empty-state container styles + a single `--error` modifier — convergent by construction. Manual visual check in implementation. |
| `library-boot-error.css` reuse couples `AppErrorFallback` to that file | Acceptable — both render the same plate composition. If styles need to diverge later, extract a `BootPlate` mixin. Not now. |
| `loadNonce`-based retry creates a stale-state moment between retry click and load completion | The new effect fires synchronously: `setLoadError(null)` clears the error before the load starts, so the panel briefly returns to empty-or-populated state. Acceptable — retry is a user-initiated action with implicit "loading" expectation. |

---

## 8. Open question deliberately deferred to implementation

**Exact error-state CSS color values.** The error variant should be a "subtle warning" that meets WCAG AA contrast against the panel background. The implementation phase picks a concrete color — likely `var(--color-warning)` or a `color-mix()` darkened variant of `--color-text-subtle`. If `--color-warning` doesn't exist in `tokens.css`, add it. Spec'ing it here would be premature; design-system color decisions belong with the implementation work.

---

## 9. Acceptance criteria

- `src/app/AppErrorBoundary.tsx` exists with class boundary + fallback, ~80 lines, all logic covered by `AppErrorBoundary.test.tsx`.
- `App.tsx:450` wraps `<ReadyApp boot={boot} />` in `<AppErrorBoundary>`.
- All four hooks expose `loadError + retryLoad`. Their existing tests still pass; new cases for load-failure + retry pass.
- `HighlightsPanel`, `BookmarksPanel`, `ThreadList` render an error variant with `role="alert"` + Retry button when `loadError !== null`. Existing tests still pass; new error-variant tests pass.
- `ReaderWorkspace` and the chat-panel host pass `loadError` + `onRetryLoad` through to the panels.
- Roadmap marks `Phase 6.5 — complete (2026-05-XX)`.
- `pnpm check` passes (type-check + lint + 970+ unit tests).
- `pnpm test:e2e` green (existing 85 + 6 skipped; no new e2e specs).
- E2e axe baselines unchanged from current main (no a11y regression introduced).
- Production bundle size delta for this PR is < 5 KB gz (the boundary is small; no new dependencies).
