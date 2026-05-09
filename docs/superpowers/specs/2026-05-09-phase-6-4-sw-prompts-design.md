# Phase 6.4 — SW update prompt + offline-ready toast

**Status:** approved 2026-05-09
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 6 → Task 6.4 (Offline & resume hardening)
**Predecessors:** Phase 6 audit (PR-A spec, PR-B tooling, PR-C findings) — landed as `docs/superpowers/audits/2026-05-09-phase-6-findings.md`. This spec resolves audit findings F4.1 (important) and F4.2 (nice-to-have).
**Architecture decisions referenced:** `docs/02-system-architecture.md` (PWA / SW boundaries); `docs/06-quality-strategy.md` (error-state requirements); existing `libraryStore.ts` (vanilla zustand pattern); existing `apiKeyStore.ts` (`bookworm.` localStorage namespace convention).

---

## 1. Goal & scope

`src/pwa/register-sw.ts` has two empty `TODO` callbacks left over from Phase 0 wiring:

```ts
onNeedRefresh() {
  // TODO: surface the update-available prompt in Phase 6.
},
onOfflineReady() {
  // TODO: surface the "offline ready" toast in Phase 6.
},
```

This PR fills them in with two small fixed-position toasts. `vite-plugin-pwa` already invokes the callbacks correctly on update detection / first-install; only the React-visible UI is missing.

### In scope

- New vanilla-zustand store `src/pwa/swUpdateStore.ts` bridging the SW callbacks to React subscribers via `useSyncExternalStore`.
- New `UpdateAvailableToast.tsx` — bottom-right fixed-position card. "An update is available." + "Refresh" button + ✕ dismiss. No auto-dismiss; user makes a deliberate choice.
- New `OfflineReadyToast.tsx` — same fixed position. "Bookworm is ready offline." + ✕ dismiss. Auto-dismisses after 8s. Persisted: shown once per device via `bookworm.offlineReadySeen` localStorage key.
- New `sw-toast.css` — shared base styling + per-variant overrides.
- `register-sw.ts` rewritten to capture the `updateSW` function returned by `registerSW()` and route the callbacks into the store.
- Both toasts mounted in `App.tsx` inside `<AppErrorBoundary>` (next to `<ReadyApp />`).
- Roadmap mark.

### Out of scope (deferred)

- E2e tests. The existing `e2e/offline.spec.ts` cold-offline test already exercises SW installation and cache hits. An e2e that fires `onNeedRefresh` requires a second-deployed SW build to detect; not justified for this PR.
- Telemetry / analytics on prompt interactions. Local-first; no backend.
- Deeper offline UX (retry banners, sync queues, etc.). The audit didn't surface anything else and this PR's scope is the two specific TODOs.
- Update-available auto-prompt with timer / countdown. The toast stays visible until the user acts.

---

## 2. State bridge architecture

### `src/pwa/swUpdateStore.ts` (new)

Vanilla zustand store, matching the `libraryStore.ts` precedent:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useSyncExternalStore } from 'react';

export type SwUpdateState = {
  readonly needsRefresh: boolean;
  readonly offlineReady: boolean;
  readonly applyUpdate: () => Promise<void>;
  // Mutators (called from register-sw.ts and from toast components)
  setApplyUpdate: (fn: () => Promise<void>) => void;
  markNeedsRefresh: () => void;
  markOfflineReady: () => void;     // no-op if localStorage flag is already set
  dismissNeedsRefresh: () => void;
  dismissOfflineReady: () => void;  // also writes the localStorage flag
};

const STORAGE_KEY = 'bookworm.offlineReadySeen';

function readSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Private mode or quota — not fatal, fall through.
    console.warn('[swUpdateStore] could not persist offlineReadySeen');
  }
}

export const swUpdateStore: StoreApi<SwUpdateState> = createStore<SwUpdateState>(
  (set) => ({
    needsRefresh: false,
    offlineReady: false,
    applyUpdate: () => Promise.resolve(),
    setApplyUpdate: (fn) => set({ applyUpdate: fn }),
    markNeedsRefresh: () => set({ needsRefresh: true }),
    markOfflineReady: () => {
      if (readSeen()) return;
      set({ offlineReady: true });
    },
    dismissNeedsRefresh: () => set({ needsRefresh: false }),
    dismissOfflineReady: () => {
      writeSeen();
      set({ offlineReady: false });
    },
  }),
);

export function useSwUpdates(): SwUpdateState {
  return useSyncExternalStore(swUpdateStore.subscribe, swUpdateStore.getState);
}
```

### `src/pwa/register-sw.ts` (rewrite)

```ts
import { registerSW } from 'virtual:pwa-register';
import { swUpdateStore } from './swUpdateStore';

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      swUpdateStore.getState().markNeedsRefresh();
    },
    onOfflineReady() {
      swUpdateStore.getState().markOfflineReady();
    },
  });

  swUpdateStore.getState().setApplyUpdate(async () => {
    await updateSW(true); // true = reload after activation
  });
}
```

The `updateSW(true)` call asks workbox to skipWaiting + reload. We pass it through the store so the React UI doesn't import `virtual:pwa-register` directly (which is a Vite-specific virtual module that complicates testing).

### Mounting in `App.tsx`

```tsx
return (
  <AppErrorBoundary>
    <ReadyApp boot={boot} />
    <UpdateAvailableToast />
    <OfflineReadyToast />
  </AppErrorBoundary>
);
```

Both toasts render `null` when their flag is false — zero DOM cost when inactive. They live inside the boundary so a toast crash takes the boundary path, not the whole app.

---

## 3. Toast components

### `UpdateAvailableToast.tsx` (new)

```tsx
import { useSwUpdates } from './swUpdateStore';
import './sw-toast.css';

export function UpdateAvailableToast() {
  const { needsRefresh, applyUpdate, dismissNeedsRefresh } = useSwUpdates();
  if (!needsRefresh) return null;
  return (
    <div className="sw-toast sw-toast--update" role="status" aria-live="polite">
      <div className="sw-toast__body">
        <p className="sw-toast__title">An update is available.</p>
        <p className="sw-toast__text">Reload to get the latest Bookworm.</p>
      </div>
      <div className="sw-toast__actions">
        <button
          type="button"
          className="sw-toast__primary"
          onClick={() => {
            void applyUpdate();
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          className="sw-toast__dismiss"
          aria-label="Dismiss"
          onClick={dismissNeedsRefresh}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

No auto-dismiss. The user must click Refresh or ✕; if they navigate away mid-session, the SW prompt re-appears on next visit (since the workbox state persists across reloads).

### `OfflineReadyToast.tsx` (new)

```tsx
import { useEffect } from 'react';
import { useSwUpdates } from './swUpdateStore';
import './sw-toast.css';

const AUTO_DISMISS_MS = 8000;

export function OfflineReadyToast() {
  const { offlineReady, dismissOfflineReady } = useSwUpdates();
  useEffect(() => {
    if (!offlineReady) return;
    const timer = window.setTimeout(dismissOfflineReady, AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [offlineReady, dismissOfflineReady]);

  if (!offlineReady) return null;
  return (
    <div className="sw-toast sw-toast--ready" role="status" aria-live="polite">
      <div className="sw-toast__body">
        <p className="sw-toast__title">Bookworm is ready offline.</p>
      </div>
      <button
        type="button"
        className="sw-toast__dismiss"
        aria-label="Dismiss"
        onClick={dismissOfflineReady}
      >
        ✕
      </button>
    </div>
  );
}
```

### `sw-toast.css` (new)

Shared `.sw-toast` base: fixed bottom-right, design-system padding/radius/shadow, slide-in transition using motion tokens. `.sw-toast--update` adds the action button container styling. Mobile breakpoint: full-width minus 16px insets, sits above `safe-area-inset-bottom`.

```css
.sw-toast {
  position: fixed;
  inset-block-end: var(--space-6);
  inset-inline-end: var(--space-6);
  z-index: 80;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  max-width: min(380px, calc(100vw - 2 * var(--space-6)));
  animation: sw-toast-in var(--duration-base) var(--ease-out);
}

.sw-toast__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sw-toast__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  color: var(--color-text);
}

.sw-toast__text {
  margin: 0;
  font-family: var(--font-serif);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.sw-toast__actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.sw-toast__primary {
  font-family: var(--font-serif);
  font-size: var(--text-sm);
  color: var(--color-accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out);
}

.sw-toast__primary:hover {
  background: color-mix(in oklab, var(--color-accent) 8%, var(--color-surface));
}

.sw-toast__primary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.sw-toast__dismiss {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: var(--space-1);
  font-size: var(--text-md);
  line-height: 1;
}

.sw-toast__dismiss:hover {
  color: var(--color-text);
}

.sw-toast__dismiss:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

@keyframes sw-toast-in {
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 600px) {
  .sw-toast {
    inset-inline: var(--space-4);
    inset-block-end: max(var(--space-4), env(safe-area-inset-bottom));
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sw-toast {
    animation: none;
  }
}
```

The `prefers-reduced-motion` block mirrors the same convention used elsewhere in the codebase (per `docs/superpowers/audits/motion-inventory.md`). The `var(--duration-base)` token is already zeroed under reduced-motion globally, but a defensive local override keeps the file self-contained.

---

## 4. UX details

### Copy

- Update toast title: **"An update is available."**
- Update toast body: **"Reload to get the latest Bookworm."**
- Update toast primary action: **"Refresh"**
- Offline-ready title: **"Bookworm is ready offline."** (no body)

### Persistence

Single localStorage key: `bookworm.offlineReadySeen`. Read once on `markOfflineReady()` — if `'1'`, no-op. Written by `dismissOfflineReady()` (covers both the user clicking ✕ and auto-dismiss). The store, not the toast, owns the storage interaction.

`needsRefresh` is **not** persisted — it's per-session. If the SW reports an update again on next visit (because workbox detected a newer build), the prompt re-appears.

### Accessibility

- Both toasts: `role="status"` + `aria-live="polite"`. They're informational, not critical errors — `alert` is too aggressive.
- "Refresh" button: implicit accessible name from visible text.
- "✕" dismiss button: `aria-label="Dismiss"`.
- Tab order within the update toast: Refresh → Dismiss.
- The toast is a sibling of `<ReadyApp />`, so its focus order falls after the main app's tab order — easy to ignore via Tab unless the user is at the very end of the page's tab cycle. Acceptable for a non-modal informational element.

### Mobile

The 600px media query gives the toast full inset-bounded width and respects `safe-area-inset-bottom` for iOS notch / home indicator.

---

## 5. Testing

**Three unit-test files** (one per new component, plus the store):

1. `src/pwa/swUpdateStore.test.ts`:
   - Initial state: `needsRefresh = false`, `offlineReady = false`, `applyUpdate` is a noop resolved promise.
   - `setApplyUpdate(fn)` replaces the function.
   - `markNeedsRefresh()` sets `needsRefresh = true`.
   - `markOfflineReady()`: when `bookworm.offlineReadySeen` is absent, sets `offlineReady = true`. When present, no-op (flag stays false).
   - `dismissNeedsRefresh()` sets `needsRefresh = false`.
   - `dismissOfflineReady()`: writes `bookworm.offlineReadySeen = '1'` to localStorage, sets `offlineReady = false`.
   - Use `beforeEach` to clear localStorage between tests.

2. `src/pwa/UpdateAvailableToast.test.tsx`:
   - Renders nothing when `needsRefresh = false`.
   - With `needsRefresh = true`, renders title, body, Refresh button, Dismiss button. Element has `role="status"`.
   - Refresh click invokes `applyUpdate` (spy on the store's function).
   - Dismiss click invokes `dismissNeedsRefresh`.

3. `src/pwa/OfflineReadyToast.test.tsx`:
   - Renders nothing when `offlineReady = false`.
   - With `offlineReady = true`, renders title with `role="status"`.
   - Dismiss click invokes `dismissOfflineReady` immediately.
   - Auto-dismiss fires after 8s (use `vi.useFakeTimers()` + `vi.advanceTimersByTime(8000)`; assert `dismissOfflineReady` called).
   - Auto-dismiss timer clears on unmount (set `offlineReady = true`, render then unmount, advance time, assert `dismissOfflineReady` NOT called).

For component tests, mocking the store is straightforward — set state via `swUpdateStore.setState()` before render and spy on the methods you want to assert.

**No test for `register-sw.ts`.** It's a thin glue layer between `virtual:pwa-register` (third-party) and the store. Mocking the virtual module for unit tests is high-effort with little payoff; the integration is covered indirectly by `e2e/offline.spec.ts`.

**No new e2e.** The existing offline spec validates SW install + cached content. An e2e that fires `onNeedRefresh` reliably needs a second-deployed SW build — not justified for this PR.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `register-sw.ts` writer racing with `useSwUpdates()` consumers | Vanilla zustand handles concurrent reads/writes; `useSyncExternalStore` guarantees consistent snapshots. No issue at human timescales. |
| `bookworm.offlineReadySeen` localStorage write fails (private mode, quota) | Try/catch around `setItem`; on failure log a warn and fall through. The toast still dismisses correctly because the store update is independent. The next install would re-show — acceptable. |
| User dismisses update prompt and forgets, keeps using stale build | Acceptable. The user made the choice; future visits re-trigger the prompt if the SW still has a newer version pending. The audit explicitly considered this; no auto-prompt-after-N-seconds. |
| Auto-dismiss timer leaks on unmount | `useEffect` cleanup clears the timer; covered by test 3. |
| Two toasts could overlap on small viewports if both fire simultaneously | Practically impossible — `markOfflineReady` only fires once ever (first install), `markNeedsRefresh` only fires after a *subsequent* SW update is detected. The two events can't co-occur. If they did, they'd stack at the same position; acceptable since the user can dismiss either. |
| Toast slide-in animation respects `prefers-reduced-motion` | Local media query override + global token-based override (per `motion-inventory.md`). Belt-and-suspenders. |
| `applyUpdate` rejects (e.g., network down during reload) | The promise rejection is unhandled by the click handler (`void applyUpdate()`). The user is left with the toast still visible; they can click Refresh again or Dismiss. Adding inline error UI is out of scope; the path is exceedingly rare. |

---

## 7. Open questions

None deferred to implementation. All UX decisions, persistence behavior, file shape, and copy are settled in this spec.

---

## 8. File summary

```
NEW   src/pwa/swUpdateStore.ts                   — vanilla zustand store + useSwUpdates hook
NEW   src/pwa/swUpdateStore.test.ts              — store unit tests
NEW   src/pwa/UpdateAvailableToast.tsx           — fixed-position prompt with Refresh + ✕
NEW   src/pwa/UpdateAvailableToast.test.tsx
NEW   src/pwa/OfflineReadyToast.tsx              — fixed-position toast with auto-dismiss + ✕
NEW   src/pwa/OfflineReadyToast.test.tsx
NEW   src/pwa/sw-toast.css                       — shared base + variant styles
MOD   src/pwa/register-sw.ts                     — wire SW callbacks into the store
MOD   src/app/App.tsx                            — mount both toasts inside <AppErrorBoundary>
MOD   docs/04-implementation-roadmap.md          — mark 6.4 complete
```

10 files. Smallest of the three remaining Phase 6 sub-tasks, as expected.

---

## 9. Acceptance criteria

- `src/pwa/swUpdateStore.ts` exists with the documented mutators and `useSwUpdates` hook. All store unit tests pass.
- `register-sw.ts` no longer contains TODO comments; both callbacks route through the store; `applyUpdate` is wired to `updateSW(true)`.
- `UpdateAvailableToast` renders the documented copy + buttons when `needsRefresh = true`; renders `null` otherwise. Tests pass.
- `OfflineReadyToast` renders the documented copy + dismiss when `offlineReady = true`; auto-dismisses after 8s. Tests pass.
- Both toasts mounted inside `<AppErrorBoundary>` in `App.tsx`.
- `bookworm.offlineReadySeen` is written on dismiss/auto-dismiss; subsequent `markOfflineReady()` calls are no-ops.
- Production bundle includes the new components but no new runtime dependencies (everything reuses zustand, already shipped).
- `pnpm check` passes (~990 unit tests).
- `pnpm test:e2e` passes (85 + 6 skipped, no new specs).
- `prefers-reduced-motion` honored.
- Roadmap marks `Phase 6.4 — complete (2026-05-XX)`.
