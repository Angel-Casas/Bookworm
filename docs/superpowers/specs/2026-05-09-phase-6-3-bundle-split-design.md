# Phase 6.3 — Main-bundle code-splitting via route-level `React.lazy`

**Status:** approved 2026-05-09
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 6 → Task 6.3 (Performance pass)
**Predecessors:** Phase 6 audit. Resolves finding F3.1 (important — main JS bundle 420.51 KB gz, over the 250 KB soft target).
**Architecture decisions referenced:** `docs/02-system-architecture.md` (boot path); existing route switching in `src/app/App.tsx`; the foliate-js + pdfjs runtime cost.

---

## 1. Goal & scope

The Phase 6 audit measured the main `dist/assets/index-*.js` chunk at **420.51 KB gz / 1.4 MB raw** — substantially over the 250 KB gz soft target it set. Vite's build output already warns: "(!) Some chunks are larger than 500 kB after minification."

This PR introduces route-level `React.lazy` boundaries for three of the four top-level views (Reader, Notebook, Settings) plus a small refactor that relocates the EPUB/PDF adapter imports out of `useReaderHost` (eagerly loaded from `App.tsx`) into `ReaderWorkspace` (lazy chunk), so the heavy foliate-js + pdfjs surfaces actually move out of the main bundle.

### In scope

- **Route-level lazy loading.** `App.tsx` replaces three static imports with `React.lazy` + `<Suspense fallback={<RouteLoading />}>` wrappers. `LibraryView` stays eager (it's the landing).
- **`createAdapter` relocation.** Move the `useCallback` from `useReaderHost.ts:103-109` plus its imports of `EpubReaderAdapter` and `PdfReaderAdapter` into `ReaderWorkspace.tsx`. Drop `createAdapter` from the `ReaderHostHandle` type. Update App.tsx's pass-through to no longer thread it.
- **`<RouteLoading />` component.** Single shared Suspense fallback, ~10 lines + 15 lines CSS, design-system-token-styled.
- Roadmap mark.

### Out of scope (deferred)

- **Aggressive splitting** (chat panel, IndexInspectorModal, retrieval clients). Audit follow-up only if route-level isn't enough.
- **Pre-warming on hover** (`onPointerEnter` triggering dynamic import). Defer; only worth it if first-navigation latency feels noticeable.
- **Bundle-size CI enforcement.** Audit explicitly deferred perf budgets in CI; this PR keeps the soft target informational.
- **`source-map-explorer` dev dep.** One-time analysis; not committed.
- **Performance budgets in CI** (per audit spec §1).
- **Per-route skeleton screens.** Single generic `<RouteLoading />` is sufficient.

---

## 2. Architecture

### Route-level lazy boundaries

In `src/app/App.tsx`, three of four top-level imports become `React.lazy` calls:

```ts
// Before — eager imports at the top of App.tsx (lines 20-22):
import { ReaderWorkspace } from '@/features/reader/workspace/ReaderWorkspace';
import { NotebookView } from '@/features/annotations/notebook/NotebookView';
import { SettingsView } from '@/features/ai/settings/SettingsView';

// After:
import { lazy, Suspense } from 'react';
import { RouteLoading } from '@/app/RouteLoading';
import { LibraryView } from '@/features/library/LibraryView'; // stays eager

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

The `.then((m) => ({ default: m.X }))` shim is required because `React.lazy` expects a module with a default export, but the codebase uses named exports.

Each render site gets a `<Suspense>` wrapper:

```tsx
// Reader render site (around App.tsx:278):
if (view.current.kind === 'reader') {
  return (
    <Suspense fallback={<RouteLoading />}>
      <ReaderWorkspace {...} />
    </Suspense>
  );
}
```

Same shape for `notebook` (line ~246) and `settings` (line ~270).

### `createAdapter` relocation

**Current:** `src/app/useReaderHost.ts:14-15` statically imports `EpubReaderAdapter` and `PdfReaderAdapter`. Lines 103-109 define `createAdapter` as a `useCallback`. Lines 220-230 expose it via the `ReaderHostHandle` return.

**New:** the imports and the `useCallback` move to `ReaderWorkspace.tsx`:

```tsx
// In ReaderWorkspace.tsx near the top:
import { EpubReaderAdapter } from '@/features/reader/epub/EpubReaderAdapter';
import { PdfReaderAdapter } from '@/features/reader/pdf/PdfReaderAdapter';

// Inside ReaderWorkspace component:
const createAdapter = useCallback(
  (mountInto: HTMLElement, format: BookFormat): BookReader => {
    if (format === 'pdf') return new PdfReaderAdapter(mountInto);
    return new EpubReaderAdapter(mountInto);
  },
  [],
);
```

ReaderWorkspace already passes `createAdapter` through to `ReaderView` via props (line ~720 in ReaderWorkspace's render of ReaderView). Now it gets it from the local `useCallback` instead of the prop chain from App.tsx.

**`ReaderHostHandle` change** (`src/app/useReaderHost.ts:18-43`):

```ts
// Before:
export type ReaderHostHandle = {
  loadBookForReader: (bookId: string) => Promise<{...}>;
  createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
  onAnchorChange: (...) => void;
  // ...
};

// After: drop createAdapter
export type ReaderHostHandle = {
  loadBookForReader: (bookId: string) => Promise<{...}>;
  onAnchorChange: (...) => void;
  // ...
};
```

Also drop:
- The two adapter imports at the top of useReaderHost.ts (lines 14-15).
- The `useCallback` definition (lines 103-109).
- The `createAdapter,` line in the return (line 222).
- The `BookFormat` type import if it's now unused (verify; might still be needed for `loadBookForReader`).
- The `BookReader` type import if it's now unused.

**App.tsx changes:** wherever it passes `createAdapter` from the hook to `ReaderWorkspace`, drop that prop. Need to grep `<ReaderWorkspace` in App.tsx to find the spread or explicit prop list.

### `<RouteLoading />` component

`src/app/RouteLoading.tsx`:

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

`src/app/route-loading.css`:

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

The `100dvh` accounts for mobile dynamic viewports; falls back to `100vh` on browsers without `dvh` support.

### Why `LibraryView` stays eager

`LibraryView` is the landing page — the user sees it on cold start. Lazy-loading it would mean the user waits for two chunk fetches (boot + LibraryView) before seeing anything beyond the boot loader. Net negative for perceived performance. It also contains `Bookshelf`, `BookCard`, `LibraryEmptyState`, `DropOverlay`, `ImportTray` — none of which are heavyweights individually, and they all stay in the main chunk where they belong.

### Why xstate / foliate-js / pdfjs naturally land in the lazy chunk

After the createAdapter relocation, the *only* import path to `EpubReaderAdapter` and `PdfReaderAdapter` is via `ReaderWorkspace.tsx`. Vite's chunk graph follows the lazy boundary — anything reachable only through a `lazy(() => import(...))` boundary becomes part of that chunk. So:
- `foliate-js/view.js` (side-effect imported by EpubReaderAdapter) → ReaderWorkspace chunk.
- `pdfjs-dist` API surface (imported by PdfReaderAdapter) → ReaderWorkspace chunk.
- The xstate state machine (`readerMachine.ts`) is imported only by `ReaderView.tsx`, which is imported only by ReaderWorkspace → ReaderWorkspace chunk.
- `ChatPanel`, `MessageList`, `MultiExcerptChip`, retrieval clients, etc. — all imported only via ReaderWorkspace → ReaderWorkspace chunk.

Notebook chunk gets `NotebookView` + `notebookSearchBar` + saved-answers UI.
Settings chunk gets `SettingsView` + API-key UI + model-catalog UI.

---

## 3. Loading UX

### `<Suspense fallback={<RouteLoading />}>`

Three wrap sites: Reader, Notebook, Settings. Single shared component.

**First navigation to a lazy route:** the chunk fetches over the network (or from SW cache after first install). Fallback flashes for ~50–500ms depending on connection.

**Subsequent navigations:** chunks are cached by both the browser and the SW. Fallback flashes for one frame or not at all.

**On slow networks / offline:** the SW may have already precached the chunks (workbox's `globPatterns` includes `**/*.{js,css,html,svg,png,ico,woff2}`). Verify this in the build output's precache list.

### Why not a per-route skeleton

Per-route skeletons add code (one per view) that's only visible for milliseconds after the first SW cache. The audit's spec said "Per-route skeletons. Each lazy route gets a custom skeleton that mirrors its layout. More polished but more code; payoff is mostly invisible after the first SW-cache hit." User picked the generic loader. Single component, single CSS file, consistent.

### Aria semantics

`<main aria-busy="true">` signals to assistive tech that this region is loading. The `<main>` element ensures screen-reader users land in the right place by default after the route transitions.

---

## 4. File summary

```
NEW   src/app/RouteLoading.tsx                                  ~10 lines
NEW   src/app/route-loading.css                                 ~15 lines
NEW   src/app/RouteLoading.test.tsx                             trivial render test
MOD   src/app/App.tsx                                           replace 3 static imports with React.lazy + 3 Suspense wrappers + drop createAdapter pass-through
MOD   src/app/useReaderHost.ts                                  remove createAdapter useCallback, adapter imports, BookFormat/BookReader type imports if unused, createAdapter from ReaderHostHandle + return
MOD   src/features/reader/workspace/ReaderWorkspace.tsx         import EpubReaderAdapter + PdfReaderAdapter; define local createAdapter useCallback
MOD   docs/04-implementation-roadmap.md                         mark 6.3 complete
```

Existing tests for `useReaderHost` (if any assertions on `createAdapter`) and `ReaderWorkspace` may need adjustment — verify in the plan.

~5–7 files modified or new.

---

## 5. Expected savings

The main `index-*.js` chunk currently holds:
- React + React-DOM (~50 KB gz, stays in main)
- Zustand (~10 KB gz, stays in main — used by Library)
- App boot logic, useAppView, useReaderHost (slimmed), App.tsx (slimmed) — stays in main
- All Library feature code (BookCard, Bookshelf, LibraryEmptyState, DropOverlay, ImportTray, indexing pipeline, etc.) — stays in main
- IDB wrapper + storage layer — stays in main (used by Library)

Moves to `ReaderWorkspace-*.js`:
- foliate-js runtime (`view.js` side-effect import + Overlayer + spine helpers): ~80–120 KB gz
- pdfjs API surface (the parts NOT in pdf.worker, which is already split): ~20–40 KB gz
- xstate (`readerMachine.ts`): ~30 KB gz
- ReaderWorkspace UI (+ panels: TocPanel, BookmarksPanel, HighlightsPanel, MobileSheet, DesktopRail, RightRail, etc.): ~30 KB gz
- ChatPanel + MessageList + MultiExcerptChip + retrieval clients + nanogpt clients (chat/structured/embeddings/models): ~40 KB gz
- HighlightToolbar + selection logic: ~10 KB gz

**Subtotal moved out of main: ~210–280 KB gz.**

Moves to `NotebookView-*.js`: ~20–30 KB gz.
Moves to `SettingsView-*.js`: ~20–40 KB gz (API-key form, model catalog UI, validation, etc.).

**Conservative estimate:** main bundle drops from ~420 KB gz to **~120–180 KB gz** (well under the 250 KB target).

**Pessimistic estimate:** if shared dependencies (e.g., domain types, design-system tokens, shared icons) get duplicated into each chunk by Vite's default chunk strategy, savings may be lower. Still expecting under 280 KB gz worst case.

The actual number is verified during implementation (Plan Task 7 confirms the new sizes).

---

## 6. Testing

### `RouteLoading.test.tsx`

Trivial render test — assert "Loading…" text appears, `aria-busy="true"` is set, root element is `<main>`. Three asserts.

### Existing tests

- **ReaderWorkspace tests:** likely no change needed. The component now defines `createAdapter` locally instead of accepting it as a prop. If existing tests pass `createAdapter` via props, they need to be updated to drop that prop (or accept that the component now ignores it). Verify in plan.
- **useReaderHost tests:** if there's a test asserting on the `createAdapter` field of the handle, drop that assertion. Verify in plan.
- **ReaderView tests:** no change. ReaderView still receives `createAdapter` as a prop; it just comes from a different ancestor now.
- **App.tsx tests:** no direct App.tsx tests exist; integration via e2e covers this.

### E2e

The existing flows that navigate into the lazy routes (settings, reader, notebook) continue to work. The Suspense fallback may render briefly during the first chunk load — existing tests do not assert against its presence, so no change required.

If an e2e has timing assumptions that the lazy load violates (e.g., expecting an element within 100ms of route entry), it might flake on first run with empty cache. The Playwright tests run against `pnpm preview` which uses the build's pre-cached SW state by visit-2 — but the very first visit (e.g., `library-import` test's `await page.goto('/')`) navigates to the eager Library, which doesn't trigger any lazy load. Subsequent navigation to Reader does, but most tests `await` on user-visible content rather than tight time bounds. Verify the full e2e suite passes during Task 7.

### One-time verification

After implementation, before final commit:

1. Run `pnpm build` and capture the new chunk size for `dist/assets/index-*.js`.
2. Verify new chunks emerge: `dist/assets/ReaderWorkspace-*.js`, `dist/assets/NotebookView-*.js`, `dist/assets/SettingsView-*.js` (Vite names lazy chunks after the imported module).
3. Confirm main `index-*.js` is under **300 KB gz** (informational soft target). If under 250 KB, even better — record both numbers in PR description.
4. Spot-check the chunk graph: the new `ReaderWorkspace-*.js` chunk should be substantially large (likely >100 KB gz, since it now carries foliate-js + pdfjs + xstate + panels + chat). The main `index-*.js` should shrink proportionally. Eyeball the Vite build output (which prints per-chunk gz sizes) for sanity. String-grepping minified bundles is unreliable since identifiers get mangled.
5. Run `pnpm test:e2e` — full suite green.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Lazy chunk fails to load (network failure, SW cache miss) | React's Suspense renders the fallback. If the import promise rejects, an error propagates up to `<AppErrorBoundary>` (added in Phase 6.5), which surfaces the reload-button fallback. Acceptable. |
| `useReaderHost` test (if exists) asserts on `createAdapter` field | Plan task drops the assertion. Adapter creation is now ReaderWorkspace's concern; tested implicitly through the component's render output. |
| ReaderWorkspace tests pass `createAdapter` via props that no longer matter | Plan task verifies — if the component now ignores the prop, tests that supply it are still valid (extra prop is harmless to TypeScript with the change in shape, since the prop is dropped from the type). |
| Vite splits Library code that's also used by Reader (e.g., LibraryEmptyState in ReaderWorkspace's empty branch) into duplicate chunks | Vite's default chunking deduplicates shared modules into a vendor chunk or hoists them up. If duplication appears, add a `manualChunks` config to consolidate. Verify during step 4 of one-time verification — eyeball the chunk graph for surprises. |
| Bundle savings fall short of target | Audit explicitly said perf budgets are informational. If we land at 280 KB gz instead of 250, that's still a ~33% reduction — major win. Follow-up sub-task can drive further if user-perceived slowness drives it. |
| Adapter side-effect import (`foliate-js/view.js` registers `<foliate-view>` custom element) now fires later | Custom-element registration is idempotent and only matters before the element is queried. The reader view doesn't query `<foliate-view>` until ReaderWorkspace mounts, by which time the chunk has loaded. No timing issue. |
| Mobile users on slow networks see the fallback for longer than ideal on first visit | Acceptable for v1. If the app gets a real mobile audience and feedback says it's noticeable, pre-warm-on-hover or skeleton-screens can land later. The audit explicitly deferred those. |
| `App.tsx` passes `createAdapter` to `ReaderWorkspace` as a prop today; removing it is a breaking change for ReaderWorkspace's prop type | Plan task updates ReaderWorkspace's prop type to drop `createAdapter`. Existing call site in App.tsx is the only consumer; updating both in one task is straightforward. |

---

## 8. Open questions

None deferred. All architectural decisions are settled.

---

## 9. Acceptance criteria

- `src/app/RouteLoading.tsx` and `route-loading.css` exist; `RouteLoading.test.tsx` passes.
- `src/app/App.tsx` uses `React.lazy` for `ReaderWorkspace`, `NotebookView`, `SettingsView`. Each is wrapped in `<Suspense fallback={<RouteLoading />}>` at its render site. `LibraryView` is still eager.
- `src/app/useReaderHost.ts` no longer imports `EpubReaderAdapter` or `PdfReaderAdapter`. The `ReaderHostHandle` type and the hook's return value no longer expose `createAdapter`.
- `src/features/reader/workspace/ReaderWorkspace.tsx` imports both adapters and defines `createAdapter` as a local `useCallback`.
- `pnpm check` green (~1017 unit tests, +1 new for `RouteLoading`).
- `pnpm test:e2e` green (85 + 6 skipped, no new specs).
- `pnpm build`: new chunks `ReaderWorkspace-*.js`, `NotebookView-*.js`, `SettingsView-*.js` emerge. Main `index-*.js` is under 300 KB gz (informational target — actual number recorded in PR description).
- foliate-js and pdfjs do not appear in the main chunk.
- Roadmap marks `Phase 6.3 — complete (2026-05-XX)`.
