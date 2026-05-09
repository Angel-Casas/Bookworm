# Phase 6.4 SW Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two empty TODO callbacks in `src/pwa/register-sw.ts` with two small fixed-position toasts: an "Update available" prompt with a Refresh button (Phase 6 audit F4.1), and a "Ready offline" toast that auto-dismisses (F4.2).

**Architecture:** A vanilla zustand store (`swUpdateStore`) bridges the SW callbacks (called outside React from `register-sw.ts`) to the React tree (consumed via `useSyncExternalStore`). Two specific toast components share a `.sw-toast` base CSS class. Mounted in `App.tsx` inside `<AppErrorBoundary>`. Persistence: `bookworm.offlineReadySeen` localStorage flag for once-ever-per-device offline-ready toast.

**Tech Stack:** React 19, TypeScript, vanilla `zustand` (already in deps), Vitest + `@testing-library/react`, `vite-plugin-pwa` (already configured). No new runtime deps.

---

## File map

**New (7):**
- `src/pwa/swUpdateStore.ts` — vanilla store + `useSwUpdates` hook
- `src/pwa/swUpdateStore.test.ts` — store unit tests
- `src/pwa/UpdateAvailableToast.tsx`
- `src/pwa/UpdateAvailableToast.test.tsx`
- `src/pwa/OfflineReadyToast.tsx`
- `src/pwa/OfflineReadyToast.test.tsx`
- `src/pwa/sw-toast.css`

**Modified (3):**
- `src/pwa/register-sw.ts` — capture `updateSW`, route callbacks into the store
- `src/app/App.tsx` — mount both toasts inside `<AppErrorBoundary>`
- `docs/04-implementation-roadmap.md` — mark 6.4 complete

10 files total.

---

## Task 1: `swUpdateStore` — vanilla zustand store + hook

**Files:**
- Create: `src/pwa/swUpdateStore.ts`
- Create: `src/pwa/swUpdateStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/pwa/swUpdateStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { swUpdateStore } from './swUpdateStore';

const STORAGE_KEY = 'bookworm.offlineReadySeen';

beforeEach(() => {
  localStorage.clear();
  swUpdateStore.setState({
    needsRefresh: false,
    offlineReady: false,
    applyUpdate: () => Promise.resolve(),
  });
});

describe('swUpdateStore', () => {
  it('initial state has both flags false and a noop applyUpdate', () => {
    const s = swUpdateStore.getState();
    expect(s.needsRefresh).toBe(false);
    expect(s.offlineReady).toBe(false);
    // noop returns a resolved promise
    return s.applyUpdate();
  });

  it('setApplyUpdate replaces the function', async () => {
    let called = false;
    swUpdateStore.getState().setApplyUpdate(() => {
      called = true;
      return Promise.resolve();
    });
    await swUpdateStore.getState().applyUpdate();
    expect(called).toBe(true);
  });

  it('markNeedsRefresh sets needsRefresh = true', () => {
    swUpdateStore.getState().markNeedsRefresh();
    expect(swUpdateStore.getState().needsRefresh).toBe(true);
  });

  it('markOfflineReady sets offlineReady = true when localStorage flag is absent', () => {
    swUpdateStore.getState().markOfflineReady();
    expect(swUpdateStore.getState().offlineReady).toBe(true);
  });

  it('markOfflineReady is a no-op when localStorage flag is present', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    swUpdateStore.getState().markOfflineReady();
    expect(swUpdateStore.getState().offlineReady).toBe(false);
  });

  it('dismissNeedsRefresh sets needsRefresh = false', () => {
    swUpdateStore.setState({ needsRefresh: true });
    swUpdateStore.getState().dismissNeedsRefresh();
    expect(swUpdateStore.getState().needsRefresh).toBe(false);
  });

  it('dismissOfflineReady writes the localStorage flag and sets offlineReady = false', () => {
    swUpdateStore.setState({ offlineReady: true });
    swUpdateStore.getState().dismissOfflineReady();
    expect(swUpdateStore.getState().offlineReady).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('survives localStorage failures gracefully (markOfflineReady)', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      // Should not throw; should still set flag (treats failure as "not seen")
      swUpdateStore.getState().markOfflineReady();
      expect(swUpdateStore.getState().offlineReady).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('survives localStorage failures gracefully (dismissOfflineReady)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      swUpdateStore.setState({ offlineReady: true });
      swUpdateStore.getState().dismissOfflineReady();
      // State still updates; localStorage just couldn't persist
      expect(swUpdateStore.getState().offlineReady).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/pwa/swUpdateStore.test.ts`
Expected: FAIL — `./swUpdateStore` module not found.

- [ ] **Step 3: Implement the store**

Create `src/pwa/swUpdateStore.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useSyncExternalStore } from 'react';

export type SwUpdateState = {
  readonly needsRefresh: boolean;
  readonly offlineReady: boolean;
  readonly applyUpdate: () => Promise<void>;
  readonly setApplyUpdate: (fn: () => Promise<void>) => void;
  readonly markNeedsRefresh: () => void;
  readonly markOfflineReady: () => void;
  readonly dismissNeedsRefresh: () => void;
  readonly dismissOfflineReady: () => void;
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
    console.warn('[swUpdateStore] could not persist offlineReadySeen');
  }
}

export const swUpdateStore: StoreApi<SwUpdateState> = createStore<SwUpdateState>((set) => ({
  needsRefresh: false,
  offlineReady: false,
  applyUpdate: () => Promise.resolve(),
  setApplyUpdate: (fn) => {
    set({ applyUpdate: fn });
  },
  markNeedsRefresh: () => {
    set({ needsRefresh: true });
  },
  markOfflineReady: () => {
    if (readSeen()) return;
    set({ offlineReady: true });
  },
  dismissNeedsRefresh: () => {
    set({ needsRefresh: false });
  },
  dismissOfflineReady: () => {
    writeSeen();
    set({ offlineReady: false });
  },
}));

export function useSwUpdates(): SwUpdateState {
  return useSyncExternalStore(swUpdateStore.subscribe, swUpdateStore.getState);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/pwa/swUpdateStore.test.ts`
Expected: 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pwa/swUpdateStore.ts src/pwa/swUpdateStore.test.ts
git commit -m "$(cat <<'EOF'
feat(pwa): swUpdateStore for SW callback → React state bridge (Phase 6.4)

Vanilla zustand store + useSyncExternalStore-based useSwUpdates hook.
Holds needsRefresh / offlineReady flags + applyUpdate function.
Persists offlineReadySeen in localStorage (gracefully handles
localStorage failures).

Not wired into register-sw.ts yet — that's the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `register-sw.ts` to the store

**Files:**
- Modify: `src/pwa/register-sw.ts`

- [ ] **Step 1: Replace the file**

Replace `src/pwa/register-sw.ts` (currently has TODO comments):

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
    await updateSW(true);
  });
}
```

The `updateSW(true)` call asks workbox to skipWaiting + reload the controlled page.

- [ ] **Step 2: Run quality gate**

Run: `pnpm check`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/pwa/register-sw.ts
git commit -m "$(cat <<'EOF'
feat(pwa): wire SW callbacks into swUpdateStore (Phase 6.4)

Replaces the two empty TODOs in register-sw.ts. onNeedRefresh and
onOfflineReady now mutate the store; updateSW (returned by
registerSW) is captured into the store via setApplyUpdate so the
React UI can trigger a controlled reload via a typed function call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Shared `sw-toast.css`

**Files:**
- Create: `src/pwa/sw-toast.css`

- [ ] **Step 1: Create the stylesheet**

Create `src/pwa/sw-toast.css`:

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
  from {
    transform: translateY(8px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
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

No commit yet — the stylesheet is consumed by the toasts in Tasks 4 and 5.

---

## Task 4: `UpdateAvailableToast` (TDD)

**Files:**
- Create: `src/pwa/UpdateAvailableToast.tsx`
- Create: `src/pwa/UpdateAvailableToast.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/pwa/UpdateAvailableToast.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { UpdateAvailableToast } from './UpdateAvailableToast';
import { swUpdateStore } from './swUpdateStore';

beforeEach(() => {
  swUpdateStore.setState({
    needsRefresh: false,
    offlineReady: false,
    applyUpdate: () => Promise.resolve(),
  });
});
afterEach(cleanup);

describe('UpdateAvailableToast', () => {
  it('renders nothing when needsRefresh is false', () => {
    const { container } = render(<UpdateAvailableToast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title, body, Refresh, and Dismiss when needsRefresh is true', () => {
    swUpdateStore.setState({ needsRefresh: true });
    render(<UpdateAvailableToast />);
    expect(screen.getByText('An update is available.')).toBeDefined();
    expect(screen.getByText('Reload to get the latest Bookworm.')).toBeDefined();
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Dismiss$/i })).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('Refresh click invokes applyUpdate', async () => {
    const applyUpdate = vi.fn(() => Promise.resolve());
    swUpdateStore.setState({ needsRefresh: true, applyUpdate });
    render(<UpdateAvailableToast />);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/i }));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('Dismiss click invokes dismissNeedsRefresh', () => {
    swUpdateStore.setState({ needsRefresh: true });
    render(<UpdateAvailableToast />);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }));
    expect(swUpdateStore.getState().needsRefresh).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/pwa/UpdateAvailableToast.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/pwa/UpdateAvailableToast.tsx`:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/pwa/UpdateAvailableToast.test.tsx`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pwa/UpdateAvailableToast.tsx src/pwa/UpdateAvailableToast.test.tsx src/pwa/sw-toast.css
git commit -m "$(cat <<'EOF'
feat(pwa): UpdateAvailableToast (Phase 6.4)

Bottom-right fixed-position card. Renders when swUpdateStore's
needsRefresh is true. "An update is available." + Refresh button
(invokes applyUpdate) + ✕ Dismiss (clears the flag). Includes shared
sw-toast.css base stylesheet. No auto-dismiss — user must choose.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `OfflineReadyToast` (TDD)

**Files:**
- Create: `src/pwa/OfflineReadyToast.tsx`
- Create: `src/pwa/OfflineReadyToast.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/pwa/OfflineReadyToast.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OfflineReadyToast } from './OfflineReadyToast';
import { swUpdateStore } from './swUpdateStore';

beforeEach(() => {
  localStorage.clear();
  swUpdateStore.setState({
    needsRefresh: false,
    offlineReady: false,
    applyUpdate: () => Promise.resolve(),
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('OfflineReadyToast', () => {
  it('renders nothing when offlineReady is false', () => {
    const { container } = render(<OfflineReadyToast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title with role="status" when offlineReady is true', () => {
    swUpdateStore.setState({ offlineReady: true });
    render(<OfflineReadyToast />);
    expect(screen.getByText('Bookworm is ready offline.')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('Dismiss click invokes dismissOfflineReady immediately', () => {
    swUpdateStore.setState({ offlineReady: true });
    render(<OfflineReadyToast />);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }));
    expect(swUpdateStore.getState().offlineReady).toBe(false);
    expect(localStorage.getItem('bookworm.offlineReadySeen')).toBe('1');
  });

  it('auto-dismisses after 8 seconds', () => {
    swUpdateStore.setState({ offlineReady: true });
    render(<OfflineReadyToast />);
    expect(swUpdateStore.getState().offlineReady).toBe(true);
    vi.advanceTimersByTime(8000);
    expect(swUpdateStore.getState().offlineReady).toBe(false);
    expect(localStorage.getItem('bookworm.offlineReadySeen')).toBe('1');
  });

  it('clears the auto-dismiss timer on unmount', () => {
    swUpdateStore.setState({ offlineReady: true });
    const { unmount } = render(<OfflineReadyToast />);
    unmount();
    // Manually flip the flag back to true so we can detect if dismiss fires.
    swUpdateStore.setState({ offlineReady: true });
    vi.advanceTimersByTime(10_000);
    expect(swUpdateStore.getState().offlineReady).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/pwa/OfflineReadyToast.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/pwa/OfflineReadyToast.tsx`:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/pwa/OfflineReadyToast.test.tsx`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pwa/OfflineReadyToast.tsx src/pwa/OfflineReadyToast.test.tsx
git commit -m "$(cat <<'EOF'
feat(pwa): OfflineReadyToast (Phase 6.4)

Same fixed position as UpdateAvailableToast. Renders when
swUpdateStore's offlineReady is true. Single "Bookworm is ready
offline." line + ✕ Dismiss. Auto-dismisses after 8 seconds via a
setTimeout cleared on unmount. Persistence (bookworm.offlineReadySeen)
already handled in the store's dismissOfflineReady().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Mount both toasts in `App.tsx`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add the imports**

In `src/app/App.tsx`, add to the imports (near the top, after the existing `AppErrorBoundary` import):

```tsx
import { UpdateAvailableToast } from '@/pwa/UpdateAvailableToast';
import { OfflineReadyToast } from '@/pwa/OfflineReadyToast';
```

- [ ] **Step 2: Mount inside the boundary**

Find the existing return at the bottom of `App()`:

```tsx
  return (
    <AppErrorBoundary>
      <ReadyApp boot={boot} />
    </AppErrorBoundary>
  );
}
```

Replace with:

```tsx
  return (
    <AppErrorBoundary>
      <ReadyApp boot={boot} />
      <UpdateAvailableToast />
      <OfflineReadyToast />
    </AppErrorBoundary>
  );
}
```

- [ ] **Step 3: Run quality gate**

Run: `pnpm check`
Expected: green.

- [ ] **Step 4: Run e2e to confirm no regression**

Run:
```bash
pnpm build
pnpm test:e2e
```
Expected: 85 passed, 6 skipped. The new toasts don't activate during e2e flows (no SW updates triggered, and `markOfflineReady` requires the SW to fire — the existing offline.spec primes the SW, which *might* fire `onOfflineReady` on first install. If `bookworm.offlineReadySeen` gets written, the toast renders briefly. Watch for any e2e that asserts an empty body where a toast might now appear.)

If an e2e fails because of the toast, the most likely culprit is that some test asserts on a global container element and finds the unexpected toast text. Read the failure carefully:
- If the test is broken because of the toast showing, the toast is correctly rendering — the test needs updating to either dismiss the toast or scope its assertion.
- If the toast is rendering when it shouldn't (e.g., on a fresh test run with empty localStorage, the SW fires offlineReady), consider whether the test should set `localStorage['bookworm.offlineReadySeen'] = '1'` in setup. Add that to the relevant test's `page.addInitScript` if needed.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): mount UpdateAvailableToast + OfflineReadyToast (Phase 6.4)

Both toasts mounted as siblings of <ReadyApp /> inside
<AppErrorBoundary>. Render null when their respective flag is false,
so they're zero-cost when inactive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Mark roadmap, verify, push, open PR

**Files:**
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Mark 6.4 complete in the roadmap**

In `docs/04-implementation-roadmap.md`, after the existing `Phase 6.5 — complete (2026-05-09)` line in the Status block at the top, add:

```markdown
- Phase 6.4 — complete (2026-05-XX)
```

(Replace `XX` with today's date — `2026-05-09` if the same day.)

- [ ] **Step 2: Final quality gate**

Run: `pnpm check`
Expected: green. ~995 unit tests pass (985 from prior + 9 store + 4 update toast + 5 offline toast = 1003, less any test count overlap).

- [ ] **Step 3: Final e2e**

Run: `pnpm build && pnpm test:e2e`
Expected: 85 passed, 6 skipped.

- [ ] **Step 4: Commit roadmap**

```bash
git add docs/04-implementation-roadmap.md
git commit -m "$(cat <<'EOF'
docs(roadmap): mark Phase 6.4 complete

SW update prompt + offline-ready toast landed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin phase-6-4-sw-prompts
gh pr create --title "feat: Phase 6.4 — SW update prompt + offline-ready toast" --body "$(cat <<'EOF'
## Summary

Resolves audit findings F4.1 (important — `onNeedRefresh` empty TODO) and F4.2 (nice-to-have — `onOfflineReady` empty TODO).

**State bridge:** new vanilla zustand store `src/pwa/swUpdateStore.ts` (matches `libraryStore` precedent). `register-sw.ts` writes from outside React; React subscribes via `useSyncExternalStore` through the `useSwUpdates` hook.

**`UpdateAvailableToast`:** bottom-right fixed-position card. "An update is available." + Refresh button (calls `updateSW(true)` to skipWaiting + reload) + ✕ Dismiss. No auto-dismiss; user makes a deliberate choice.

**`OfflineReadyToast`:** same position. "Bookworm is ready offline." + ✕ Dismiss. Auto-dismisses after 8s. Persisted via `bookworm.offlineReadySeen` localStorage flag — shown once per device, ever.

Both toasts mounted in `App.tsx` inside `<AppErrorBoundary>` (next to `<ReadyApp />`). Render `null` when inactive — zero DOM cost.

CSS: shared `sw-toast.css` base + per-variant overrides; mobile breakpoint at 600px; `prefers-reduced-motion` honored locally + globally via tokens.

**Out of scope:** new e2e (existing `offline.spec.ts` covers SW install; firing `onNeedRefresh` reliably needs a second-deployed SW build), error UI for `applyUpdate` rejection (vanishingly rare; user can re-click Refresh).

## Test plan
- [x] `pnpm check` green (~1003 unit tests, +18 new across store + 2 toasts)
- [x] `pnpm test:e2e` green (85 passed, 6 skipped — no regressions; offline.spec.ts continues to validate SW caching)
- [x] Store tests: state mutators, localStorage persistence, graceful localStorage failures
- [x] UpdateAvailableToast tests: render gating, copy, Refresh wires applyUpdate, Dismiss wires dismissNeedsRefresh
- [x] OfflineReadyToast tests: render gating, immediate dismiss, auto-dismiss after 8s, timer cleanup on unmount
- [x] Manual smoke (deferred, not gating): build + serve, observe console for SW callbacks

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done definition

- All 7 tasks complete with their commits.
- `register-sw.ts` no longer contains TODO comments.
- `<UpdateAvailableToast />` and `<OfflineReadyToast />` rendered inside `<AppErrorBoundary>` in `App.tsx`.
- `bookworm.offlineReadySeen` written on first dismissal/auto-dismiss.
- `pnpm check` green; `pnpm test:e2e` green.
- Roadmap marks `Phase 6.4 — complete (YYYY-MM-DD)`.
- PR opened.
