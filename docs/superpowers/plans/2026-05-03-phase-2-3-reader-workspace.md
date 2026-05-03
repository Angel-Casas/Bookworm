# Phase 2.3 — Reader Workspace Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal reader shell from Phase 2.1/2.2 with a proper reader workspace — TOC moves into a permanent left rail on desktop, mobile gets a bottom-sheet pattern, and a focus mode hides chrome + rail for true immersive reading. Also resolves App.tsx growth debt by extracting reader-host concerns into `useReaderHost` and `useAppView` hooks.

**Architecture:** A new `ReaderWorkspace` component owns layout (rail vs sheet vs focused-fullscreen) and composes `ReaderChrome` + `DesktopRail`/`MobileSheet` + `ReaderView`. `ReaderView` is slimmed to own only adapter lifecycle and exposes its state via a new `onStateChange` prop so the workspace can render TOC into either the rail (desktop) or a sheet (mobile). Focus mode (`useFocusMode`) is desktop-only, persisted globally in `readerPreferences.focusMode`. App.tsx shrinks from ~282 lines to ~150 by extracting reader-host callbacks into `useReaderHost` and view state into `useAppView`.

**Tech Stack:** React 19 + TypeScript strict + Vite, Zustand (existing), XState v5 (existing — unchanged), `idb` (existing), Vitest + happy-dom (existing test stack), Playwright.

See `docs/superpowers/specs/2026-05-03-phase-2-3-reader-workspace-design.md` for the full design rationale.

---

## Milestones

1. **Foundation** — `FocusMode` type, `ReaderPreferences.focusMode`, validator soften, `settings.focusModeHintShown`
2. **Hooks** — `useViewport`, `useFocusMode`, `useAppView`, `useReaderHost`
3. **Workspace components** — `DesktopRail`, `MobileSheet`, `ReaderChrome` modifications, `ReaderView` slim-down, `ReaderWorkspace`
4. **App.tsx wire-up** — App.tsx uses new hooks + `ReaderWorkspace`; old reader callback bodies removed
5. **End-to-end + docs** — four E2E specs, doc updates, final verification

## File structure

### New files

```
src/app/
  useAppView.ts
  useAppView.test.ts
  useReaderHost.ts
  useReaderHost.test.ts
src/features/reader/workspace/
  ReaderWorkspace.tsx
  ReaderWorkspace.test.tsx
  DesktopRail.tsx
  DesktopRail.test.tsx
  MobileSheet.tsx
  MobileSheet.test.tsx
  useFocusMode.ts
  useFocusMode.test.ts
  useViewport.ts
  useViewport.test.ts
  workspace.css
  desktop-rail.css
  mobile-sheet.css
e2e/
  reader-workspace-desktop.spec.ts
  reader-workspace-mobile.spec.ts
  reader-focus-persists.spec.ts
  reader-workspace-resize.spec.ts
```

### Modified files

```
src/domain/reader/types.ts                          # add FocusMode + focusMode field + default
src/storage/repositories/readerPreferences.ts       # normalize fills missing focusMode
src/storage/repositories/readerPreferences.test.ts  # new test for v2.2→v2.3 record loads cleanly
src/storage/repositories/settings.ts                # add getFocusModeHintShown / setFocusModeHintShown
src/storage/repositories/settings.test.ts           # round-trip test
src/storage/db/schema.ts                            # extend SettingsRecord with 'focusModeHintShown'
src/features/reader/ReaderView.tsx                  # slim; expose state via onStateChange; sheet rendering moves out
src/features/reader/ReaderChrome.tsx                # accept showFocusToggle / showTocButton + onToggleFocus props
src/app/App.tsx                                     # uses useAppView + useReaderHost; mounts ReaderWorkspace
docs/02-system-architecture.md                      # Decision history entry for 2.3
docs/04-implementation-roadmap.md                   # mark Phase 2.3 + Phase 2 complete
```

## Common commands

```bash
# Single test file
pnpm vitest run path/to/file.test.ts

# Full quality gate
pnpm check

# Playwright E2E (run pnpm build first if source has changed)
pnpm build && pnpm test:e2e

# Single E2E spec
pnpm exec playwright test e2e/reader-workspace-desktop.spec.ts

# Dev server (StrictMode on; useful for catching double-mount issues)
pnpm dev
```

---

## Milestone 1 — Foundation

### Task 1: Add `FocusMode` type + `ReaderPreferences.focusMode`

**Files:**
- Modify: `src/domain/reader/types.ts`

- [ ] **Step 1: Add the FocusMode type and extend ReaderPreferences**

In `src/domain/reader/types.ts`, add the `FocusMode` type alongside the other reader-only types (just below `ReaderMode`):

```ts
export type FocusMode = 'normal' | 'focus';
```

Extend the `ReaderPreferences` type:

```ts
export type ReaderPreferences = {
  readonly typography: ReaderTypography;
  readonly theme: ReaderTheme;
  readonly modeByFormat: { readonly epub: ReaderMode; readonly pdf: ReaderMode };
  readonly focusMode: FocusMode;
};
```

Extend the default:

```ts
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  typography: {
    fontFamily: 'system-serif',
    fontSizeStep: 2,
    lineHeightStep: 1,
    marginStep: 1,
  },
  theme: 'light',
  modeByFormat: { epub: 'paginated', pdf: 'paginated' },
  focusMode: 'normal',
};
```

Re-export `FocusMode` from `src/domain/reader/index.ts`:

```ts
export type {
  // ...existing exports...
  FocusMode,
} from './types';
```

- [ ] **Step 2: Type-check**

```bash
pnpm type-check
```

Expected: `readerPreferences.ts` is the only file flagged (its `normalize` function will reject records missing `focusMode`). T2 fixes that. Other downstream files don't read `focusMode` yet so they shouldn't break.

- [ ] **Step 3: Commit**

```bash
git add src/domain/reader/types.ts src/domain/reader/index.ts
git commit -m "feat(reader): add FocusMode type + ReaderPreferences.focusMode

Default = 'normal'. Validator + downstream consumers updated in
subsequent commits."
```

---

### Task 2: Soften `readerPreferences` validator for `focusMode`

**Files:**
- Modify: `src/storage/repositories/readerPreferences.ts`
- Modify: `src/storage/repositories/readerPreferences.test.ts`

- [ ] **Step 1: Write the failing test (v2.2-shape record loads cleanly)**

Append to `src/storage/repositories/readerPreferences.test.ts`:

```ts
  it('loads a v2.2 record (missing focusMode) and synthesizes default', async () => {
    const repo = createReaderPreferencesRepository(db);
    // Inject a record in the v2.2 shape — no focusMode field
    await db.put('reader_preferences', {
      key: 'global',
      value: {
        typography: DEFAULT_READER_PREFERENCES.typography,
        theme: 'dark',
        modeByFormat: { epub: 'scroll', pdf: 'paginated' },
      } as never,
    });
    const loaded = await repo.get();
    expect(loaded.theme).toBe('dark');
    expect(loaded.modeByFormat.epub).toBe('scroll');
    expect(loaded.focusMode).toBe('normal'); // default synthesized
  });

  it('normalizes corrupted focusMode to default', async () => {
    const repo = createReaderPreferencesRepository(db);
    await db.put('reader_preferences', {
      key: 'global',
      value: {
        ...DEFAULT_READER_PREFERENCES,
        focusMode: 'ultra-zen' as never,
      },
    });
    const loaded = await repo.get();
    expect(loaded.focusMode).toBe('normal');
  });
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/storage/repositories/readerPreferences.test.ts
```

Expected: FAIL — the strict validator rejects the v2.2-shape record (missing `focusMode`); for the corrupted case, `normalize` may also reject.

- [ ] **Step 3: Add focusMode handling to normalize**

Edit `src/storage/repositories/readerPreferences.ts`. Add to the imports at the top:

```ts
import {
  // ...existing imports...
  type FocusMode,
} from '@/domain/reader';
```

Add the validator alongside the others:

```ts
const VALID_FOCUS_MODES: ReadonlySet<string> = new Set(['normal', 'focus']);
function isValidFocusMode(v: unknown): v is FocusMode {
  return typeof v === 'string' && VALID_FOCUS_MODES.has(v);
}
```

Update `LoosePreferences` type:

```ts
type LoosePreferences = {
  typography?: Partial<ReaderTypography>;
  theme?: unknown;
  modeByFormat?: { epub?: unknown; pdf?: unknown };
  focusMode?: unknown;
};
```

In the `normalize()` function, after the existing modeByFormat handling and before the return, compute `focusMode`:

```ts
  const focusMode = isValidFocusMode(v.focusMode)
    ? v.focusMode
    : DEFAULT_READER_PREFERENCES.focusMode;
```

Update the returned object:

```ts
  return {
    typography: { ... },
    theme: v.theme,
    modeByFormat: { epub, pdf },
    focusMode,
  };
```

- [ ] **Step 4: Run all readerPreferences tests → pass**

```bash
pnpm vitest run src/storage/repositories/readerPreferences.test.ts
```

Expected: PASS for all original tests + the 2 new ones.

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/storage/repositories/readerPreferences.ts src/storage/repositories/readerPreferences.test.ts
git commit -m "feat(storage): forward-compat readerPreferences for Phase 2.3

normalize() fills missing focusMode with 'normal' default rather than
rejecting the whole record. Existing user theme/modeByFormat preferences
from Phase 2.2 survive the v2.3 deploy. Corrupted focusMode values
normalize to 'normal'."
```

---

### Task 3: Add `focusModeHintShown` to settings

**Files:**
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/repositories/settings.ts`
- Modify: `src/storage/repositories/settings.test.ts`

- [ ] **Step 1: Extend `SettingsRecord` type**

In `src/storage/db/schema.ts`, add a new variant:

```ts
export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' }
  | { readonly key: 'view'; readonly value: AppView }
  | { readonly key: 'focusModeHintShown'; readonly value: boolean };
```

- [ ] **Step 2: Write the failing test**

Append to `src/storage/repositories/settings.test.ts`:

```ts
  it('round-trips focusModeHintShown', async () => {
    const settings = createSettingsRepository(db);
    expect(await settings.getFocusModeHintShown()).toBe(false);
    await settings.setFocusModeHintShown(true);
    expect(await settings.getFocusModeHintShown()).toBe(true);
  });

  it('returns false when focusModeHintShown is malformed', async () => {
    const settings = createSettingsRepository(db);
    await db.put('settings', {
      key: 'focusModeHintShown',
      value: 'oops' as never,
    });
    expect(await settings.getFocusModeHintShown()).toBe(false);
  });
```

- [ ] **Step 3: Run test → expect fail**

```bash
pnpm vitest run src/storage/repositories/settings.test.ts
```

Expected: FAIL — `getFocusModeHintShown` / `setFocusModeHintShown` don't exist.

- [ ] **Step 4: Implement the new methods**

Edit `src/storage/repositories/settings.ts`. Add to the `SettingsRepository` type:

```ts
export type SettingsRepository = {
  // ...existing...
  getFocusModeHintShown(): Promise<boolean>;
  setFocusModeHintShown(shown: boolean): Promise<void>;
};
```

Inside the returned object, add the two methods:

```ts
    async getFocusModeHintShown() {
      const rec = await get<Extract<SettingsRecord, { key: 'focusModeHintShown' }>>(
        'focusModeHintShown',
      );
      return typeof rec?.value === 'boolean' ? rec.value : false;
    },
    async setFocusModeHintShown(shown) {
      await put({ key: 'focusModeHintShown', value: shown });
    },
```

- [ ] **Step 5: Run test → pass**

```bash
pnpm vitest run src/storage/repositories/settings.test.ts
```

Expected: PASS for all settings tests including 2 new ones.

- [ ] **Step 6: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add src/storage/db/schema.ts src/storage/repositories/settings.ts src/storage/repositories/settings.test.ts
git commit -m "feat(storage): add focusModeHintShown to settings repo

One-time flag for showing the 'cursor to top to bring chrome back'
hint on first focus-mode entry. Defaults to false when missing or
malformed. No IDB schema bump (settings is already a key-value store)."
```

---

## Milestone 2 — Hooks

### Task 4: `useViewport` — desktop / mobile breakpoint hook

**Files:**
- Create: `src/features/reader/workspace/useViewport.ts`
- Create: `src/features/reader/workspace/useViewport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/workspace/useViewport.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewport } from './useViewport';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockMatchMedia(matches: boolean): {
  fire: (newMatches: boolean) => void;
} {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches,
    media: '(min-width: 768px)',
    onchange: null,
    addEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    fire: (newMatches: boolean) => {
      mql.matches = newMatches;
      listeners.forEach((cb) => cb({ matches: newMatches } as MediaQueryListEvent));
    },
  };
}

describe('useViewport', () => {
  it('returns desktop when matchMedia matches', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useViewport());
    expect(result.current).toBe('desktop');
  });

  it('returns mobile when matchMedia does not match', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useViewport());
    expect(result.current).toBe('mobile');
  });

  it('updates when the media query changes', () => {
    const ctl = mockMatchMedia(true);
    const { result } = renderHook(() => useViewport());
    expect(result.current).toBe('desktop');
    act(() => ctl.fire(false));
    expect(result.current).toBe('mobile');
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/workspace/useViewport.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `useViewport.ts`**

Create `src/features/reader/workspace/useViewport.ts`:

```ts
import { useEffect, useState } from 'react';

export type Viewport = 'desktop' | 'mobile';

const QUERY = '(min-width: 768px)';

function read(): Viewport {
  if (typeof window === 'undefined') return 'desktop';
  return window.matchMedia(QUERY).matches ? 'desktop' : 'mobile';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(read);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (): void => {
      setViewport(mq.matches ? 'desktop' : 'mobile');
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, []);
  return viewport;
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/workspace/useViewport.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/workspace/useViewport.ts src/features/reader/workspace/useViewport.test.ts
git commit -m "feat(reader): useViewport — matchMedia-based desktop/mobile hook

Single breakpoint at 768px. Updates on media query change. SSR-safe
(returns 'desktop' when window undefined)."
```

---

### Task 5: `useFocusMode` — focus state, keyboard shortcut, hover reveal

**Files:**
- Create: `src/features/reader/workspace/useFocusMode.ts`
- Create: `src/features/reader/workspace/useFocusMode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/workspace/useFocusMode.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusMode } from './useFocusMode';

afterEach(() => {
  vi.restoreAllMocks();
});

function press(key: string, modifiers: { meta?: boolean; ctrl?: boolean } = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, metaKey: !!modifiers.meta, ctrlKey: !!modifiers.ctrl }),
  );
}

describe('useFocusMode', () => {
  it('starts in the initial mode and exposes shouldRenderChrome', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        initial: 'normal',
        onChange,
        hasShownFirstTimeHint: false,
        onFirstTimeHintShown: () => undefined,
      }),
    );
    expect(result.current.mode).toBe('normal');
    expect(result.current.shouldRenderChrome).toBe(true);
  });

  it('toggle flips mode and fires onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        initial: 'normal',
        onChange,
        hasShownFirstTimeHint: true,
        onFirstTimeHintShown: () => undefined,
      }),
    );
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('focus');
    expect(onChange).toHaveBeenCalledWith('focus');
    expect(result.current.shouldRenderChrome).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('normal');
    expect(onChange).toHaveBeenLastCalledWith('normal');
  });

  it('F key toggles when not in input', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        initial: 'normal',
        onChange,
        hasShownFirstTimeHint: true,
        onFirstTimeHintShown: () => undefined,
      }),
    );
    act(() => press('F'));
    expect(result.current.mode).toBe('focus');
  });

  it('Cmd+\\ toggles', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        initial: 'normal',
        onChange,
        hasShownFirstTimeHint: true,
        onFirstTimeHintShown: () => undefined,
      }),
    );
    act(() => press('\\', { meta: true }));
    expect(result.current.mode).toBe('focus');
  });

  it('Escape exits focus mode (does not enter)', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ initial }: { initial: 'normal' | 'focus' }) =>
        useFocusMode({
          initial,
          onChange,
          hasShownFirstTimeHint: true,
          onFirstTimeHintShown: () => undefined,
        }),
      { initialProps: { initial: 'normal' as const } },
    );
    act(() => press('Escape'));
    expect(result.current.mode).toBe('normal'); // no entry from escape
    rerender({ initial: 'focus' });
    act(() => result.current.toggle()); // explicit re-set after rerender
    act(() => result.current.toggle()); // back to normal
    // Now go to focus and Escape should exit
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('focus');
    act(() => press('Escape'));
    expect(result.current.mode).toBe('normal');
  });

  it('keyboard shortcuts ignored when input is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        initial: 'normal',
        onChange,
        hasShownFirstTimeHint: true,
        onFirstTimeHintShown: () => undefined,
      }),
    );
    // Dispatch on the input so its target is the input
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true }));
    expect(result.current.mode).toBe('normal');
    input.remove();
  });

  it('first-time hint shows once and fires onFirstTimeHintShown', () => {
    const onFirstTimeHintShown = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        initial: 'normal',
        onChange: () => undefined,
        hasShownFirstTimeHint: false,
        onFirstTimeHintShown,
      }),
    );
    act(() => result.current.toggle());
    expect(result.current.firstTimeHintVisible).toBe(true);
    expect(onFirstTimeHintShown).toHaveBeenCalledOnce();
  });

  it('does not show first-time hint when hasShownFirstTimeHint is true', () => {
    const onFirstTimeHintShown = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        initial: 'normal',
        onChange: () => undefined,
        hasShownFirstTimeHint: true,
        onFirstTimeHintShown,
      }),
    );
    act(() => result.current.toggle());
    expect(result.current.firstTimeHintVisible).toBe(false);
    expect(onFirstTimeHintShown).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/workspace/useFocusMode.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `useFocusMode.ts`**

Create `src/features/reader/workspace/useFocusMode.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { FocusMode } from '@/domain/reader';

const HOVER_ZONE_PX = 40;
const HIDE_DELAY_MS = 1500;
const HINT_DURATION_MS = 4000;

type Options = {
  readonly initial: FocusMode;
  readonly onChange: (mode: FocusMode) => void;
  readonly hasShownFirstTimeHint: boolean;
  readonly onFirstTimeHintShown: () => void;
};

type FocusModeState = {
  readonly mode: FocusMode;
  readonly shouldRenderChrome: boolean;
  readonly firstTimeHintVisible: boolean;
  toggle(): void;
};

function isInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
}

export function useFocusMode(opts: Options): FocusModeState {
  const [mode, setMode] = useState<FocusMode>(opts.initial);
  const [isChromeRevealed, setIsChromeRevealed] = useState(false);
  const [firstTimeHintVisible, setFirstTimeHintVisible] = useState(false);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: FocusMode = current === 'focus' ? 'normal' : 'focus';
      opts.onChange(next);
      // Show first-time hint when entering focus for the first time
      if (next === 'focus' && !opts.hasShownFirstTimeHint) {
        setFirstTimeHintVisible(true);
        opts.onFirstTimeHintShown();
        window.setTimeout(() => setFirstTimeHintVisible(false), HINT_DURATION_MS);
      }
      // Reveal chrome cancels itself when leaving focus
      if (next === 'normal') setIsChromeRevealed(false);
      return next;
    });
  }, [opts]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isInputElement(e.target)) return;
      if (e.key === 'F' && !e.metaKey && !e.ctrlKey) toggle();
      else if (e.key === 'Escape' && mode === 'focus') toggle();
      else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [mode, toggle]);

  // Hover-reveal: only when in focus mode
  useEffect(() => {
    if (mode !== 'focus') return undefined;
    let hideTimer: number | undefined;
    const onMove = (e: MouseEvent): void => {
      const inHoverZone = e.clientY <= HOVER_ZONE_PX;
      if (inHoverZone) {
        setIsChromeRevealed(true);
        if (hideTimer !== undefined) {
          window.clearTimeout(hideTimer);
          hideTimer = undefined;
        }
      } else {
        if (hideTimer !== undefined) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => setIsChromeRevealed(false), HIDE_DELAY_MS);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [mode]);

  return {
    mode,
    shouldRenderChrome: mode === 'normal' || isChromeRevealed,
    firstTimeHintVisible,
    toggle,
  };
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/workspace/useFocusMode.test.ts
```

Expected: PASS (8 tests). Note the "Escape exits" test is intentionally a bit involved because the hook reads `mode` synchronously in its keyboard effect; the rerender + toggle dance verifies that escape only fires when actually in focus.

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/workspace/useFocusMode.ts src/features/reader/workspace/useFocusMode.test.ts
git commit -m "feat(reader): useFocusMode — focus state, keyboard shortcut, hover reveal

State machine: 'normal' (chrome+rail visible) ↔ 'focus' (chrome+rail
hidden, mouse-near-top reveals chrome). Keyboard shortcuts: F (toggle),
Escape (exit), Cmd/Ctrl+\\ (toggle). Shortcuts ignored in inputs.
Persistence + first-time hint storage are caller responsibilities
(passed in via props), so the hook stays storage-agnostic."
```

---

### Task 6: `useAppView` — view state + persistence + deleted-book guard

**Files:**
- Create: `src/app/useAppView.ts`
- Create: `src/app/useAppView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/useAppView.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppView } from './useAppView';
import { LIBRARY_VIEW, readerView } from '@/app/view';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import type { SettingsRepository } from '@/storage';
import type { Book } from '@/domain';
import { BookId, IsoTimestamp } from '@/domain';

function fakeLibraryStore(books: Book[]): LibraryStore {
  return {
    getState: () => ({
      books,
      visibleBooks: () => books,
      sort: 'recently-opened',
      search: '',
      setSearch: () => undefined,
      setSort: () => undefined,
      upsertBook: () => undefined,
      removeBook: () => undefined,
      replaceAll: () => undefined,
    }),
    subscribe: () => () => undefined,
  } as unknown as LibraryStore;
}

function fakeSettingsRepo(): SettingsRepository & { setView: ReturnType<typeof vi.fn> } {
  const setView = vi.fn(() => Promise.resolve());
  return {
    getLibrarySort: () => Promise.resolve(undefined),
    setLibrarySort: () => Promise.resolve(),
    getStoragePersistResult: () => Promise.resolve(undefined),
    setStoragePersistResult: () => Promise.resolve(),
    getView: () => Promise.resolve(undefined),
    setView,
    getFocusModeHintShown: () => Promise.resolve(false),
    setFocusModeHintShown: () => Promise.resolve(),
  } as never;
}

const sampleBook = (id: string): Book => ({
  id: BookId(id),
  title: id,
  format: 'epub',
  coverRef: { kind: 'none' },
  toc: [],
  source: {
    kind: 'imported-file',
    opfsPath: `books/${id}/source.epub`,
    originalName: `${id}.epub`,
    byteSize: 1,
    mimeType: 'application/epub+zip',
    checksum: 'a'.repeat(64),
  },
  importStatus: { kind: 'ready' },
  indexingStatus: { kind: 'pending' },
  aiProfileStatus: { kind: 'pending' },
  createdAt: IsoTimestamp(new Date().toISOString()),
  updatedAt: IsoTimestamp(new Date().toISOString()),
});

describe('useAppView', () => {
  it('initializes with the provided view', () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: readerView('book-1') }),
    );
    expect(result.current.current).toEqual({ kind: 'reader', bookId: 'book-1' });
  });

  it('falls back to library when initial reader view references a deleted book', () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([]); // book deleted
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: readerView('ghost') }),
    );
    expect(result.current.current).toEqual(LIBRARY_VIEW);
  });

  it('goReader sets view + persists', async () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
    );
    act(() => result.current.goReader(sampleBook('book-1')));
    expect(result.current.current).toEqual({ kind: 'reader', bookId: 'book-1' });
    // Allow microtask flush
    await Promise.resolve();
    expect(settingsRepo.setView).toHaveBeenCalledWith({ kind: 'reader', bookId: 'book-1' });
  });

  it('goLibrary sets view + persists', async () => {
    const settingsRepo = fakeSettingsRepo();
    const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
    const { result } = renderHook(() =>
      useAppView({ settingsRepo, libraryStore, initial: readerView('book-1') }),
    );
    act(() => result.current.goLibrary());
    expect(result.current.current).toEqual(LIBRARY_VIEW);
    await Promise.resolve();
    expect(settingsRepo.setView).toHaveBeenCalledWith(LIBRARY_VIEW);
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/app/useAppView.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `useAppView.ts`**

Create `src/app/useAppView.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { Book } from '@/domain';
import type { SettingsRepository } from '@/storage';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import { LIBRARY_VIEW, readerView, type AppView } from '@/app/view';

export type AppViewHandle = {
  current: AppView;
  goLibrary: () => void;
  goReader: (book: Book) => void;
};

function findBook(libraryStore: LibraryStore, bookId: string): Book | undefined {
  return libraryStore.getState().books.find((b) => b.id === bookId);
}

type UseAppViewOptions = {
  readonly settingsRepo: SettingsRepository;
  readonly libraryStore: LibraryStore;
  readonly initial: AppView;
};

export function useAppView({ settingsRepo, libraryStore, initial }: UseAppViewOptions): AppViewHandle {
  const [view, setViewState] = useState<AppView>(() => {
    if (initial.kind === 'reader' && !findBook(libraryStore, initial.bookId)) {
      return LIBRARY_VIEW;
    }
    return initial;
  });

  const setView = useCallback(
    (next: AppView) => {
      setViewState(next);
      void settingsRepo.setView(next);
    },
    [settingsRepo],
  );

  // Guard: book deleted while in reader → fall back to library
  useEffect(() => {
    if (view.kind === 'reader' && !findBook(libraryStore, view.bookId)) {
      setView(LIBRARY_VIEW);
    }
  }, [view, libraryStore, setView]);

  const goLibrary = useCallback(() => {
    setView(LIBRARY_VIEW);
  }, [setView]);

  const goReader = useCallback(
    (book: Book) => {
      setView(readerView(book.id));
    },
    [setView],
  );

  return { current: view, goLibrary, goReader };
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/app/useAppView.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/app/useAppView.ts src/app/useAppView.test.ts
git commit -m "feat(app): useAppView — view state + persistence + deleted-book guard

Extracts the view-state slice from App.tsx. Persists every transition
to settings.view. Guards against the user landing on a reader view for
a book that was deleted in another tab — falls back to library."
```

---

### Task 7: `useReaderHost` — reader + library callbacks bundle

**Files:**
- Create: `src/app/useReaderHost.ts`
- Create: `src/app/useReaderHost.test.ts`

> **Strategy:** This hook bundles all the wiring-touching callbacks that App.tsx currently has inline. The test is light — most behavior is exercised through E2E. Unit tests cover the structural contract (returns the right keys, callbacks fire-and-forget correctly, focus-mode load happens).

- [ ] **Step 1: Write the failing test**

Create `src/app/useReaderHost.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReaderHost } from './useReaderHost';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import { DEFAULT_READER_PREFERENCES } from '@/domain/reader';
import { LIBRARY_VIEW } from '@/app/view';

function fakeLibraryStore(): LibraryStore {
  return {
    getState: () => ({
      books: [],
      visibleBooks: () => [],
      sort: 'recently-opened',
      search: '',
      setSearch: () => undefined,
      setSort: () => undefined,
      upsertBook: () => undefined,
      removeBook: () => undefined,
      replaceAll: () => undefined,
    }),
    subscribe: () => () => undefined,
  } as unknown as LibraryStore;
}

function fakeWiring() {
  return {
    db: {} as never,
    bookRepo: {
      getById: vi.fn(() => Promise.resolve(undefined)),
      getAll: vi.fn(() => Promise.resolve([])),
      findByChecksum: vi.fn(() => Promise.resolve(undefined)),
      put: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    },
    settingsRepo: {
      setLibrarySort: vi.fn(() => Promise.resolve()),
      getLibrarySort: () => Promise.resolve(undefined),
      setView: vi.fn(() => Promise.resolve()),
      getView: () => Promise.resolve(undefined),
      getStoragePersistResult: () => Promise.resolve(undefined),
      setStoragePersistResult: () => Promise.resolve(),
      getFocusModeHintShown: vi.fn(() => Promise.resolve(false)),
      setFocusModeHintShown: vi.fn(() => Promise.resolve()),
    },
    opfs: {
      readFile: vi.fn(() => Promise.resolve(undefined)),
      writeFile: vi.fn(() => Promise.resolve()),
      removeRecursive: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => Promise.resolve([])),
    },
    readingProgressRepo: {
      get: vi.fn(() => Promise.resolve(undefined)),
      put: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      listKeys: vi.fn(() => Promise.resolve([])),
    },
    readerPreferencesRepo: {
      get: vi.fn(() => Promise.resolve({ ...DEFAULT_READER_PREFERENCES, focusMode: 'focus' as const })),
      put: vi.fn(() => Promise.resolve()),
    },
    importDeps: {} as never,
    persistFirstQuotaRequest: vi.fn(() => Promise.resolve()),
  };
}

describe('useReaderHost', () => {
  it('returns the expected callback bundle', () => {
    const { result } = renderHook(() =>
      useReaderHost({
        wiring: fakeWiring() as never,
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
      }),
    );
    expect(typeof result.current.loadBookForReader).toBe('function');
    expect(typeof result.current.createAdapter).toBe('function');
    expect(typeof result.current.onAnchorChange).toBe('function');
    expect(typeof result.current.onPreferencesChange).toBe('function');
    expect(typeof result.current.onFocusModeChange).toBe('function');
    expect(typeof result.current.onFilesPicked).toBe('function');
    expect(typeof result.current.onPersistSort).toBe('function');
    expect(typeof result.current.onRemoveBook).toBe('function');
    expect(typeof result.current.findBook).toBe('function');
  });

  it('reads initialFocusMode from readerPreferences at mount', async () => {
    const wiring = fakeWiring();
    const { result } = renderHook(() =>
      useReaderHost({
        wiring: wiring as never,
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
      }),
    );
    // Default before async load completes
    expect(result.current.initialFocusMode).toBe('normal');
    await waitFor(() => {
      expect(result.current.initialFocusMode).toBe('focus');
    });
    expect(wiring.readerPreferencesRepo.get).toHaveBeenCalled();
  });

  it('reads hasShownFirstTimeHint from settings at mount', async () => {
    const wiring = fakeWiring();
    wiring.settingsRepo.getFocusModeHintShown = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() =>
      useReaderHost({
        wiring: wiring as never,
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
      }),
    );
    await waitFor(() => {
      expect(result.current.hasShownFirstTimeHint).toBe(true);
    });
  });

  it('onFocusModeChange persists via readerPreferencesRepo', async () => {
    const wiring = fakeWiring();
    const { result } = renderHook(() =>
      useReaderHost({
        wiring: wiring as never,
        libraryStore: fakeLibraryStore(),
        view: LIBRARY_VIEW,
      }),
    );
    await waitFor(() => {
      expect(wiring.readerPreferencesRepo.get).toHaveBeenCalled();
    });
    await result.current.onFocusModeChange('focus');
    expect(wiring.readerPreferencesRepo.put).toHaveBeenCalledWith(
      expect.objectContaining({ focusMode: 'focus' }),
    );
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/app/useReaderHost.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `useReaderHost.ts`**

Create `src/app/useReaderHost.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookId, type Book, type BookFormat, type LocationAnchor, type SortKey } from '@/domain';
import type {
  BookReader,
  FocusMode,
  ReaderPreferences,
} from '@/domain/reader';
import type { LibraryStore } from '@/features/library/store/libraryStore';
import type { Wiring } from '@/features/library/wiring';
import { EpubReaderAdapter } from '@/features/reader/epub/EpubReaderAdapter';
import { PdfReaderAdapter } from '@/features/reader/pdf/PdfReaderAdapter';
import { LIBRARY_VIEW, type AppView } from '@/app/view';

export type ReaderHostHandle = {
  // Reader callbacks
  loadBookForReader: (
    bookId: string,
  ) => Promise<{ blob: Blob; preferences: ReaderPreferences; initialAnchor?: LocationAnchor }>;
  createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
  onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  onPreferencesChange: (prefs: ReaderPreferences) => void;
  initialFocusMode: FocusMode;
  hasShownFirstTimeHint: boolean;
  onFocusModeChange: (mode: FocusMode) => Promise<void>;
  onFirstTimeHintShown: () => void;
  // Library callbacks
  onFilesPicked: (files: readonly File[]) => void;
  onPersistSort: (key: SortKey) => void;
  onRemoveBook: (book: Book) => void;
  findBook: (bookId: string) => Book | undefined;
};

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fn(...args);
    }, ms);
  }) as T;
}

type UseReaderHostOptions = {
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly view: AppView;
  readonly onBookRemovedWhileInReader?: () => void;
};

export function useReaderHost({
  wiring,
  libraryStore,
  view,
  onBookRemovedWhileInReader,
}: UseReaderHostOptions): ReaderHostHandle {
  const [initialFocusMode, setInitialFocusMode] = useState<FocusMode>('normal');
  const [hasShownFirstTimeHint, setHasShownFirstTimeHint] = useState(false);

  // Boot: read once
  useEffect(() => {
    void wiring.readerPreferencesRepo.get().then((p) => {
      setInitialFocusMode(p.focusMode);
    });
    void wiring.settingsRepo.getFocusModeHintShown().then((shown) => {
      setHasShownFirstTimeHint(shown);
    });
  }, [wiring]);

  const loadBookForReader = useCallback(
    async (
      bookId: string,
    ): Promise<{
      blob: Blob;
      preferences: ReaderPreferences;
      initialAnchor?: LocationAnchor;
    }> => {
      const book = await wiring.bookRepo.getById(BookId(bookId));
      if (book?.source.kind !== 'imported-file') {
        throw new Error(`Book ${bookId} is missing or has no source`);
      }
      const blob = await wiring.opfs.readFile(book.source.opfsPath);
      if (!blob) throw new Error(`Book ${bookId} blob missing from OPFS`);
      const preferences = await wiring.readerPreferencesRepo.get();
      const initialAnchor = await wiring.readingProgressRepo.get(bookId);
      return initialAnchor ? { blob, preferences, initialAnchor } : { blob, preferences };
    },
    [wiring],
  );

  const createAdapter = useCallback(
    (mountInto: HTMLElement, format: BookFormat): BookReader => {
      if (format === 'pdf') return new PdfReaderAdapter(mountInto);
      return new EpubReaderAdapter(mountInto);
    },
    [],
  );

  const onAnchorChange = useCallback(
    (bookId: string, anchor: LocationAnchor) => {
      void wiring.readingProgressRepo.put(bookId, anchor);
    },
    [wiring],
  );

  const onPreferencesChange = useCallback(
    (prefs: ReaderPreferences) => {
      void wiring.readerPreferencesRepo.put(prefs);
    },
    [wiring],
  );

  const onFocusModeChange = useCallback(
    async (mode: FocusMode) => {
      const current = await wiring.readerPreferencesRepo.get();
      await wiring.readerPreferencesRepo.put({ ...current, focusMode: mode });
    },
    [wiring],
  );

  const onFirstTimeHintShown = useCallback(() => {
    setHasShownFirstTimeHint(true);
    void wiring.settingsRepo.setFocusModeHintShown(true);
  }, [wiring]);

  // ----- Library callbacks -----

  const onFilesPicked = useCallback(
    (files: readonly File[]): void => {
      // The actual import is wired in App.tsx today via importStore.enqueue + persistFirstQuotaRequest.
      // We re-create that here so App.tsx becomes a thin caller.
      // NOTE: importStore is consumed by App, not this hook — App already has it. We just expose
      // the Wiring-based half (persistFirstQuotaRequest); enqueueing happens in App.
      void wiring.persistFirstQuotaRequest();
      // Forward files via a custom event so App can pick them up — keeps this hook
      // decoupled from importStore. App.tsx subscribes once at boot.
      window.dispatchEvent(new CustomEvent('bookworm:files-picked', { detail: files }));
    },
    [wiring],
  );

  const onPersistSort = useMemo(
    () =>
      debounce((key: SortKey) => {
        void wiring.settingsRepo.setLibrarySort(key);
      }, 200),
    [wiring],
  );

  const onRemoveBook = useCallback(
    (book: Book): void => {
      void (async () => {
        libraryStore.getState().removeBook(book.id);
        try {
          await wiring.bookRepo.delete(book.id);
          await wiring.opfs.removeRecursive(`books/${book.id}`);
          await wiring.readingProgressRepo.delete(book.id);
        } catch (err) {
          console.warn('Remove failed:', err);
        }
        if (view.kind === 'reader' && view.bookId === book.id) {
          onBookRemovedWhileInReader?.();
        }
      })();
    },
    [wiring, libraryStore, view, onBookRemovedWhileInReader],
  );

  const findBook = useCallback(
    (bookId: string): Book | undefined =>
      libraryStore.getState().books.find((b) => b.id === bookId),
    [libraryStore],
  );

  return {
    loadBookForReader,
    createAdapter,
    onAnchorChange,
    onPreferencesChange,
    initialFocusMode,
    hasShownFirstTimeHint,
    onFocusModeChange,
    onFirstTimeHintShown,
    onFilesPicked,
    onPersistSort,
    onRemoveBook,
    findBook,
  };
}
```

> **Note about `onFilesPicked` and the custom event:** App.tsx today wires `onFilesPicked` to call both `wiring.persistFirstQuotaRequest()` AND `importStore.enqueue(file)` per file. The hook can't do the second part because `importStore` is App-state (created in App's boot effect, not part of `wiring`). The pragmatic split: this hook handles the wiring-touching part (`persistFirstQuotaRequest`) and emits a custom DOM event with the files; App.tsx listens for the event in a `useEffect` and calls `importStore.getState().enqueue(file)` for each. T13 wires the App side.

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/app/useReaderHost.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/app/useReaderHost.ts src/app/useReaderHost.test.ts
git commit -m "feat(app): useReaderHost — bundle reader + library callbacks

Extracts ~80 lines from App.tsx into a single hook returning the
callback bundle. Reads readerPreferences.focusMode and
settings.focusModeHintShown once at mount; exposes them as
synchronous props for downstream components. onFilesPicked emits a
'bookworm:files-picked' DOM event so App.tsx can drive importStore
without bringing it into the hook."
```

---

## Milestone 3 — Workspace components

### Task 8: `DesktopRail` — left rail (TOC) on desktop

**Files:**
- Create: `src/features/reader/workspace/DesktopRail.tsx`
- Create: `src/features/reader/workspace/DesktopRail.test.tsx`
- Create: `src/features/reader/workspace/desktop-rail.css`

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/workspace/DesktopRail.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DesktopRail } from './DesktopRail';
import type { TocEntry } from '@/domain';
import { SectionId } from '@/domain';

afterEach(cleanup);

const TOC: readonly TocEntry[] = [
  { id: SectionId('c1'), title: 'Chapter 1', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'a' } },
  { id: SectionId('c2'), title: 'Chapter 2', depth: 0, anchor: { kind: 'epub-cfi', cfi: 'b' } },
];

describe('DesktopRail', () => {
  it('renders TOC entries inside an aside.desktop-rail container', () => {
    render(<DesktopRail toc={TOC} onSelect={() => undefined} />);
    expect(document.querySelector('aside.desktop-rail')).not.toBeNull();
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('Chapter 2')).toBeDefined();
  });

  it('forwards click to onSelect with the entry', () => {
    const onSelect = vi.fn();
    render(<DesktopRail toc={TOC} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Chapter 2'));
    expect(onSelect).toHaveBeenCalledWith(TOC[1]);
  });

  it('marks the current entry', () => {
    render(<DesktopRail toc={TOC} currentEntryId={String(TOC[0]?.id)} onSelect={() => undefined} />);
    const btn = screen.getByText('Chapter 1').closest('button');
    expect(btn?.className).toContain('toc-panel__entry--current');
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/workspace/DesktopRail.test.tsx
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `DesktopRail.tsx`**

Create `src/features/reader/workspace/DesktopRail.tsx`:

```tsx
import type { TocEntry } from '@/domain';
import { TocPanel } from '@/features/reader/TocPanel';
import './desktop-rail.css';

type Props = {
  readonly toc: readonly TocEntry[];
  readonly currentEntryId?: string;
  readonly onSelect: (entry: TocEntry) => void;
};

export function DesktopRail({ toc, currentEntryId, onSelect }: Props) {
  return (
    <aside className="desktop-rail">
      <TocPanel
        toc={toc}
        {...(currentEntryId !== undefined && { currentEntryId })}
        onSelect={onSelect}
      />
    </aside>
  );
}
```

Create `src/features/reader/workspace/desktop-rail.css`:

```css
.desktop-rail {
  flex: 0 0 auto;
  width: 280px;
  height: 100%;
  background: var(--color-panel);
  border-inline-end: 1px solid var(--color-border-subtle);
  overflow: hidden;
}

.desktop-rail .toc-panel {
  border-inline-start: 0;
  height: 100%;
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/workspace/DesktopRail.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/workspace/DesktopRail.tsx src/features/reader/workspace/DesktopRail.test.tsx src/features/reader/workspace/desktop-rail.css
git commit -m "feat(reader): DesktopRail — left rail wrapping TocPanel for desktop

280px wide aside that hosts the existing TocPanel. Overrides the
default leading border (rail provides its own trailing border). No
new TOC component — DesktopRail is purely a layout adapter."
```

---

### Task 9: `MobileSheet` — bottom sheet wrapper

**Files:**
- Create: `src/features/reader/workspace/MobileSheet.tsx`
- Create: `src/features/reader/workspace/MobileSheet.test.tsx`
- Create: `src/features/reader/workspace/mobile-sheet.css`

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/workspace/MobileSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MobileSheet } from './MobileSheet';

afterEach(cleanup);

describe('MobileSheet', () => {
  it('renders sheet + scrim with role=dialog', () => {
    render(<MobileSheet onDismiss={() => undefined}>content</MobileSheet>);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.querySelector('.mobile-sheet__scrim')).not.toBeNull();
    expect(document.querySelector('.mobile-sheet__handle')).not.toBeNull();
    expect(screen.getByText('content')).toBeDefined();
  });

  it('fires onDismiss when scrim is clicked', () => {
    const onDismiss = vi.fn();
    render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    fireEvent.click(document.querySelector('.mobile-sheet__scrim') as Element);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('fires onDismiss on Escape key', () => {
    const onDismiss = vi.fn();
    render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not fire onDismiss on other keys', () => {
    const onDismiss = vi.fn();
    render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('removes Escape listener on unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<MobileSheet onDismiss={onDismiss}>x</MobileSheet>);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/workspace/MobileSheet.test.tsx
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `MobileSheet.tsx`**

Create `src/features/reader/workspace/MobileSheet.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';
import './mobile-sheet.css';

type Props = {
  readonly onDismiss: () => void;
  readonly children: ReactNode;
};

export function MobileSheet({ onDismiss, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  return (
    <>
      <div
        className="mobile-sheet__scrim"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div className="mobile-sheet" role="dialog" aria-modal="true">
        <div className="mobile-sheet__handle" aria-hidden="true" />
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </>
  );
}
```

Create `src/features/reader/workspace/mobile-sheet.css`:

```css
.mobile-sheet__scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 50;
  animation: mobile-sheet-scrim-in var(--duration-base) var(--ease-out);
}

.mobile-sheet {
  position: fixed;
  inset: auto 0 0 0;
  height: 60vh;
  background: var(--color-panel);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  z-index: 51;
  display: flex;
  flex-direction: column;
  animation: mobile-sheet-in var(--duration-slow) var(--ease-out);
}

.mobile-sheet__handle {
  flex: 0 0 auto;
  width: 36px;
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  margin: var(--space-4) auto var(--space-3);
}

.mobile-sheet__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 0 env(safe-area-inset-bottom);
}

@keyframes mobile-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes mobile-sheet-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-sheet,
  .mobile-sheet__scrim {
    animation: none;
  }
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/workspace/MobileSheet.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/workspace/MobileSheet.tsx src/features/reader/workspace/MobileSheet.test.tsx src/features/reader/workspace/mobile-sheet.css
git commit -m "feat(reader): MobileSheet — bottom sheet wrapper for mobile

Slides up from bottom (60vh), with scrim and visual drag handle.
Escape key + scrim tap dismiss. Respects prefers-reduced-motion.
Drag-to-resize is a Phase 6 follow-up; the handle is visual-only
in v2.3."
```

---

### Task 10: `ReaderChrome` — focus toggle + conditional buttons

**Files:**
- Modify: `src/features/reader/ReaderChrome.tsx`
- Create: `src/features/reader/ReaderChrome.test.tsx`

- [ ] **Step 1: Write the failing test (covers new behavior)**

Create `src/features/reader/ReaderChrome.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReaderChrome } from './ReaderChrome';

afterEach(cleanup);

const baseProps = {
  title: 'Pride and Prejudice',
  onBack: () => undefined,
  onOpenToc: () => undefined,
  onOpenTypography: () => undefined,
  onToggleFocus: () => undefined,
};

describe('ReaderChrome', () => {
  it('shows back, title, and settings always', () => {
    render(<ReaderChrome {...baseProps} />);
    expect(screen.getByLabelText('Back to library')).toBeDefined();
    expect(screen.getByText('Pride and Prejudice')).toBeDefined();
    expect(screen.getByLabelText('Reader preferences')).toBeDefined();
  });

  it('shows TOC button when showTocButton is true', () => {
    render(<ReaderChrome {...baseProps} showTocButton />);
    expect(screen.getByLabelText('Table of contents')).toBeDefined();
  });

  it('hides TOC button when showTocButton is false', () => {
    render(<ReaderChrome {...baseProps} showTocButton={false} />);
    expect(screen.queryByLabelText('Table of contents')).toBeNull();
  });

  it('shows focus toggle when showFocusToggle is true and fires onToggleFocus', () => {
    const onToggleFocus = vi.fn();
    render(<ReaderChrome {...baseProps} showFocusToggle onToggleFocus={onToggleFocus} />);
    const btn = screen.getByLabelText('Toggle focus mode');
    fireEvent.click(btn);
    expect(onToggleFocus).toHaveBeenCalledOnce();
  });

  it('hides focus toggle when showFocusToggle is false', () => {
    render(<ReaderChrome {...baseProps} showFocusToggle={false} />);
    expect(screen.queryByLabelText('Toggle focus mode')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/ReaderChrome.test.tsx
```

Expected: FAIL — `showFocusToggle`, `showTocButton`, `onToggleFocus` props don't exist.

- [ ] **Step 3: Update `ReaderChrome.tsx`**

Replace the entire file:

```tsx
import './reader-chrome.css';

type Props = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly onOpenToc: () => void;
  readonly onOpenTypography: () => void;
  readonly onToggleFocus: () => void;
  readonly showTocButton?: boolean;
  readonly showFocusToggle?: boolean;
  readonly focusMode?: 'normal' | 'focus';
};

export function ReaderChrome({
  title,
  subtitle,
  onBack,
  onOpenToc,
  onOpenTypography,
  onToggleFocus,
  showTocButton = true,
  showFocusToggle = false,
  focusMode = 'normal',
}: Props) {
  return (
    <header className="reader-chrome">
      <button
        type="button"
        className="reader-chrome__back"
        onClick={onBack}
        aria-label="Back to library"
      >
        ← Library
      </button>
      <div className="reader-chrome__title" aria-live="polite">
        <span className="reader-chrome__title-main">{title}</span>
        {subtitle ? <span className="reader-chrome__title-sub"> — {subtitle}</span> : null}
      </div>
      <div className="reader-chrome__actions">
        {showFocusToggle ? (
          <button
            type="button"
            onClick={onToggleFocus}
            aria-label="Toggle focus mode"
            aria-pressed={focusMode === 'focus'}
            title={focusMode === 'focus' ? 'Exit focus mode (F)' : 'Enter focus mode (F)'}
          >
            {focusMode === 'focus' ? '⊞' : '⊟'}
          </button>
        ) : null}
        <button type="button" onClick={onOpenTypography} aria-label="Reader preferences">
          ⚙
        </button>
        {showTocButton ? (
          <button type="button" onClick={onOpenToc} aria-label="Table of contents">
            ☰
          </button>
        ) : null}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/ReaderChrome.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: type-check flags `ReaderView.tsx` because it constructs `<ReaderChrome>` without the new `onToggleFocus` prop. T11 fixes that.

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/ReaderChrome.tsx src/features/reader/ReaderChrome.test.tsx
git commit -m "feat(reader): ReaderChrome accepts focus toggle + conditional TOC button

New props: onToggleFocus, showTocButton (default true), showFocusToggle
(default false), focusMode (default 'normal'). When showFocusToggle is
true, renders an aria-pressed button that toggles between ⊟ (collapse)
and ⊞ (expand) icons with descriptive titles. Workspace decides which
buttons appear per viewport — desktop shows focus toggle and hides TOC
(rail provides it); mobile shows TOC and hides focus toggle."
```

---

### Task 11: `ReaderView` slim-down — `onStateChange` API

**Files:**
- Modify: `src/features/reader/ReaderView.tsx`

> **Strategy:** Two changes: (1) add an optional `onStateChange` prop that exposes TOC/currentEntry/prefs/goToAnchor/applyPreferences to the parent. (2) remove the internal sheet rendering (TOC + Typography) — those move to `ReaderWorkspace` in T12. Existing 2.1/2.2 tests must keep passing because the prop is optional.

- [ ] **Step 1: Add the exposed-state type and the prop**

Edit `src/features/reader/ReaderView.tsx`. Add the type at the top of the file (after imports):

```ts
export type ReaderViewExposedState = {
  readonly toc: readonly TocEntry[] | null;
  readonly currentEntryId: string | undefined;
  readonly prefs: ReaderPreferences | null;
  readonly goToAnchor: (anchor: LocationAnchor) => void;
  readonly applyPreferences: (prefs: ReaderPreferences) => void;
};
```

Update `ReaderViewProps`:

```ts
type ReaderViewProps = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookSubtitle?: string;
  readonly bookFormat: BookFormat;
  readonly onBack: () => void;
  readonly loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  readonly createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
  readonly onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  readonly onPreferencesChange: (prefs: ReaderPreferences) => void;
  readonly onStateChange?: (state: ReaderViewExposedState) => void;
};
```

Destructure `onStateChange` in the function signature.

- [ ] **Step 2: Remove sheet rendering and chrome from ReaderView's JSX**

ReaderView no longer renders chrome, TOC sheet, or TypographyPanel sheet — those move to `ReaderWorkspace`. Replace the return JSX with the slimmed version:

```tsx
return (
  <div className="reader-view" data-reader-theme={prefs?.theme ?? 'light'}>
    <div className="reader-view__body">
      <div ref={mountRef} className="reader-view__mount" aria-label="Book content" />
      {status === 'loadingBlob' || status === 'opening' ? (
        <div className="reader-view__overlay" role="status">
          Opening book…
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="reader-view__overlay reader-view__overlay--error" role="alert">
          <p>{describeError(state.context.error)}</p>
          <button type="button" onClick={onBack}>
            Back to library
          </button>
        </div>
      ) : null}
    </div>
  </div>
);
```

Remove the now-unused `tocOpen`, `typoOpen`, `currentEntry`, `setTocOpen`, `setTypoOpen`, `setCurrentEntry`, `handleTocSelect`, and `handlePrefChange` if they're only used in the removed JSX. Keep `handlePrefChange` if you reuse it for the exposed-state callback.

Also remove the `import { ReaderChrome } from './ReaderChrome';`, `import { TocPanel } from './TocPanel';`, `import { TypographyPanel } from './TypographyPanel';` lines — they're no longer used here.

- [ ] **Step 3: Wire `onStateChange`**

Inside ReaderView, define helpers that the workspace can call back into:

```ts
  const goToAnchor = useCallback((anchor: LocationAnchor) => {
    void adapterRef.current?.goToAnchor(anchor);
  }, []);

  const applyPreferences = useCallback(
    (next: ReaderPreferences) => {
      setPrefs(next);
      adapterRef.current?.applyPreferences(next);
      onPreferencesChange(next);
    },
    [onPreferencesChange],
  );
```

Compose the exposed state and emit it whenever the relevant inputs change:

```ts
  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({
      toc: state.context.toc,
      currentEntryId: undefined, // updated when goToAnchor is called via the workspace
      prefs,
      goToAnchor,
      applyPreferences,
    });
  }, [onStateChange, state.context.toc, prefs, goToAnchor, applyPreferences]);
```

> Tracking the `currentEntryId` is a small follow-on: the workspace will compute it from the rail/sheet click and pass it back, OR ReaderView tracks it internally when the workspace calls `goToAnchor`. For v2.3 simplicity, leave `currentEntryId: undefined` — the rail just won't highlight the current entry. We can wire this in Phase 3 polish when annotation overlays need precise location tracking too.

- [ ] **Step 4: Verify existing tests still pass**

The existing E2E specs (`reader-open`, `reader-restore`, `reader-preferences`, `reader-back-nav` and the four PDF specs) test ReaderView through App.tsx. They DON'T pass `onStateChange`. After T13 wires the new workspace, those E2E specs target chrome/TOC/typography differently. **For now (after just T11 + T12), most things will be broken until T13 lands.**

Type-check should still pass (everything new is additive):

```bash
pnpm type-check && pnpm lint
```

Expected: clean. Existing unit tests should also pass:

```bash
pnpm vitest run src/features/reader/
```

Expected: PASS for all reader unit tests (no test directly mounts ReaderView; it's only tested via composition).

- [ ] **Step 5: Commit**

```bash
git add src/features/reader/ReaderView.tsx
git commit -m "refactor(reader): ReaderView slim — expose state via onStateChange

Removes inline ReaderChrome + TOC/Typography sheet rendering. Adds an
optional onStateChange prop that surfaces toc/prefs/goToAnchor/
applyPreferences to a parent (ReaderWorkspace). Existing prop API
stays compatible — onStateChange is optional. App.tsx will mount
ReaderView through ReaderWorkspace in T13."
```

---

### Task 12: `ReaderWorkspace` — composition root

**Files:**
- Create: `src/features/reader/workspace/ReaderWorkspace.tsx`
- Create: `src/features/reader/workspace/ReaderWorkspace.test.tsx`
- Create: `src/features/reader/workspace/workspace.css`

- [ ] **Step 1: Write the failing test**

Create `src/features/reader/workspace/ReaderWorkspace.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReaderWorkspace } from './ReaderWorkspace';

afterEach(cleanup);

const baseProps = {
  bookId: 'b1',
  bookTitle: 'Test',
  bookFormat: 'epub' as const,
  onBack: () => undefined,
  loadBookForReader: () =>
    Promise.reject(new Error('test stub: loader not invoked in render-only checks')),
  createAdapter: () => {
    throw new Error('test stub: createAdapter not invoked in render-only checks');
  },
  onAnchorChange: () => undefined,
  onPreferencesChange: () => undefined,
  initialFocusMode: 'normal' as const,
  hasShownFirstTimeHint: true,
  onFocusModeChange: () => Promise.resolve(),
  onFirstTimeHintShown: () => undefined,
};

describe('ReaderWorkspace (smoke)', () => {
  it('mounts with chrome visible in normal mode', () => {
    render(<ReaderWorkspace {...baseProps} />);
    expect(screen.getByLabelText('Back to library')).toBeDefined();
    // Reader-workspace root carries data-mode + data-viewport attributes
    expect(document.querySelector('.reader-workspace')).not.toBeNull();
  });

  it('respects initialFocusMode=focus → chrome hidden, focus mode applied', () => {
    render(<ReaderWorkspace {...baseProps} initialFocusMode="focus" />);
    expect(document.querySelector('.reader-workspace')?.getAttribute('data-mode')).toBe('focus');
    // Chrome is not rendered when focus mode is on (and chrome not revealed)
    expect(screen.queryByLabelText('Back to library')).toBeNull();
  });
});
```

> **Why minimal**: ReaderWorkspace is a composition root that renders ReaderView, which then talks to a real adapter (foliate-js / pdfjs). End-to-end behavior is best tested via Playwright. The unit test verifies only the structural assembly (chrome conditional rendering, data-attributes); E2E in T14-T17 covers full flows.

- [ ] **Step 2: Run test → expect fail**

```bash
pnpm vitest run src/features/reader/workspace/ReaderWorkspace.test.tsx
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ReaderWorkspace.tsx`**

Create `src/features/reader/workspace/ReaderWorkspace.tsx`:

```tsx
import { useCallback, useState } from 'react';
import type { BookFormat, LocationAnchor } from '@/domain';
import type {
  BookReader,
  FocusMode,
  ReaderPreferences,
} from '@/domain/reader';
import { ReaderChrome } from '@/features/reader/ReaderChrome';
import { ReaderView, type ReaderViewExposedState } from '@/features/reader/ReaderView';
import { TocPanel } from '@/features/reader/TocPanel';
import { TypographyPanel } from '@/features/reader/TypographyPanel';
import { DesktopRail } from './DesktopRail';
import { MobileSheet } from './MobileSheet';
import { useFocusMode } from './useFocusMode';
import { useViewport } from './useViewport';
import './workspace.css';

type Props = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookSubtitle?: string;
  readonly bookFormat: BookFormat;
  readonly onBack: () => void;
  readonly loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  readonly createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
  readonly onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  readonly onPreferencesChange: (prefs: ReaderPreferences) => void;
  readonly initialFocusMode: FocusMode;
  readonly hasShownFirstTimeHint: boolean;
  readonly onFocusModeChange: (mode: FocusMode) => Promise<void>;
  readonly onFirstTimeHintShown: () => void;
};

const FOCUS_HINT_TEXT = 'Move the cursor to the top to bring the menu back · F or Esc to exit';

export function ReaderWorkspace(props: Props) {
  const viewport = useViewport();
  const focus = useFocusMode({
    initial: props.initialFocusMode,
    onChange: (mode) => {
      void props.onFocusModeChange(mode);
    },
    hasShownFirstTimeHint: props.hasShownFirstTimeHint,
    onFirstTimeHintShown: props.onFirstTimeHintShown,
  });

  const [activeSheet, setActiveSheet] = useState<'toc' | 'typography' | null>(null);
  const [readerState, setReaderState] = useState<ReaderViewExposedState | null>(null);

  const handleStateChange = useCallback((s: ReaderViewExposedState) => {
    setReaderState(s);
  }, []);

  const showRail = viewport === 'desktop' && focus.mode === 'normal' && readerState?.toc !== null;
  const isDesktop = viewport === 'desktop';

  return (
    <div
      className="reader-workspace"
      data-mode={focus.mode}
      data-viewport={viewport}
    >
      {focus.shouldRenderChrome ? (
        <ReaderChrome
          title={props.bookTitle}
          {...(props.bookSubtitle !== undefined && { subtitle: props.bookSubtitle })}
          onBack={props.onBack}
          onOpenToc={() => setActiveSheet('toc')}
          onOpenTypography={() => setActiveSheet('typography')}
          onToggleFocus={focus.toggle}
          showTocButton={!isDesktop}
          showFocusToggle={isDesktop}
          focusMode={focus.mode}
        />
      ) : null}

      <div className="reader-workspace__body">
        {showRail && readerState?.toc ? (
          <DesktopRail
            toc={readerState.toc}
            {...(readerState.currentEntryId !== undefined && {
              currentEntryId: readerState.currentEntryId,
            })}
            onSelect={(entry) => readerState.goToAnchor(entry.anchor)}
          />
        ) : null}
        <div className="reader-workspace__reader-host">
          <ReaderView
            bookId={props.bookId}
            bookTitle={props.bookTitle}
            bookFormat={props.bookFormat}
            {...(props.bookSubtitle !== undefined && { bookSubtitle: props.bookSubtitle })}
            onBack={props.onBack}
            loadBookForReader={props.loadBookForReader}
            createAdapter={props.createAdapter}
            onAnchorChange={props.onAnchorChange}
            onPreferencesChange={props.onPreferencesChange}
            onStateChange={handleStateChange}
          />
        </div>
      </div>

      {!isDesktop && activeSheet === 'toc' && readerState?.toc ? (
        <MobileSheet onDismiss={() => setActiveSheet(null)}>
          <TocPanel
            toc={readerState.toc}
            {...(readerState.currentEntryId !== undefined && {
              currentEntryId: readerState.currentEntryId,
            })}
            onSelect={(entry) => {
              readerState.goToAnchor(entry.anchor);
              setActiveSheet(null);
            }}
          />
        </MobileSheet>
      ) : null}

      {!isDesktop && activeSheet === 'typography' && readerState?.prefs ? (
        <MobileSheet onDismiss={() => setActiveSheet(null)}>
          <TypographyPanel
            preferences={readerState.prefs}
            bookFormat={props.bookFormat}
            onChange={readerState.applyPreferences}
          />
        </MobileSheet>
      ) : null}

      {focus.firstTimeHintVisible ? (
        <div className="reader-workspace__hint" role="status">{FOCUS_HINT_TEXT}</div>
      ) : null}
    </div>
  );
}
```

Create `src/features/reader/workspace/workspace.css`:

```css
.reader-workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: var(--color-bg);
}

.reader-workspace__body {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}

.reader-workspace__reader-host {
  flex: 1 1 auto;
  position: relative;
  min-width: 0;
  min-height: 0;
}

.reader-workspace__reader-host .reader-view {
  height: 100%;
}

.reader-workspace[data-mode='focus'] .reader-chrome {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  z-index: 10;
  animation: chrome-fade-in var(--duration-base) var(--ease-out);
}

.reader-workspace__hint {
  position: fixed;
  inset-block-start: 60px;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  padding: var(--space-3) var(--space-7);
  font-size: var(--text-sm);
  z-index: 60;
  animation: hint-fade-in var(--duration-base) var(--ease-out);
}

@keyframes chrome-fade-in {
  from { opacity: 0; transform: translateY(-100%); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes hint-fade-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .reader-workspace[data-mode='focus'] .reader-chrome,
  .reader-workspace__hint {
    animation: none;
  }
}
```

- [ ] **Step 4: Run test → pass**

```bash
pnpm vitest run src/features/reader/workspace/ReaderWorkspace.test.tsx
```

Expected: PASS (2 tests). The smoke tests don't actually render `ReaderView`'s adapter — that path is only exercised once the host node is in the DOM AND the loader resolves. The test stub loader rejects on access, but ReaderView swallows that into its error state which doesn't affect the assertions.

- [ ] **Step 5: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/reader/workspace/ReaderWorkspace.tsx src/features/reader/workspace/ReaderWorkspace.test.tsx src/features/reader/workspace/workspace.css
git commit -m "feat(reader): ReaderWorkspace — top-level layout shell

Composes ReaderChrome + DesktopRail (desktop) or MobileSheet (mobile)
+ ReaderView. Owns focus mode (via useFocusMode), viewport breakpoint
(via useViewport), and active-sheet state. ReaderView's exposed state
(toc/prefs/goToAnchor/applyPreferences) is surfaced via onStateChange
and routed to the rail or sheet depending on viewport. First-time hint
chip + animated chrome reveal in focus mode."
```

---

## Milestone 4 — App.tsx wire-up

### Task 13: `App.tsx` uses new hooks + `ReaderWorkspace`

**Files:**
- Modify: `src/app/App.tsx`

> **Strategy:** This is the biggest single edit. App.tsx becomes a thin composition root. Replace the existing `ReadyApp` body to use `useAppView` and `useReaderHost`. Mount `ReaderWorkspace` instead of `ReaderView` directly. Wire the `bookworm:files-picked` custom event from `useReaderHost.onFilesPicked` to `importStore.enqueue`.

- [ ] **Step 1: Read the existing App.tsx to confirm what's there**

```bash
cat src/app/App.tsx | head -60
```

Confirm structure: `BootState` type, `loadBoot()` effect logic, `ReadyApp` component, helper hooks `useHasBooks`/`useHasImportActivity`. The `App` component at the bottom returns one of three states.

- [ ] **Step 2: Replace `ReadyApp` body with the new composition**

Open `src/app/App.tsx`. Update imports — remove `EpubReaderAdapter`, `PdfReaderAdapter`, `BookId` direct imports (now inside `useReaderHost`), and `LIBRARY_VIEW`/`readerView` direct imports (now inside `useAppView`):

```ts
import { useEffect, useSyncExternalStore, useState, useRef } from 'react';
import { openBookwormDB } from '@/storage';
import { createLibraryStore, type LibraryStore } from '@/features/library/store/libraryStore';
import { createCoverCache, type CoverCache } from '@/features/library/store/coverCache';
import { createImportStore, type ImportStore } from '@/features/library/import/importStore';
import { createWiring, type Wiring } from '@/features/library/wiring';
import { loadLibrary } from '@/features/library/boot/loadLibrary';
import { sweepOrphans } from '@/features/library/orphan-sweep';
import { LibraryView } from '@/features/library/LibraryView';
import { LibraryBootError } from '@/features/library/LibraryBootError';
import { DropOverlay } from '@/features/library/DropOverlay';
import { ReaderWorkspace } from '@/features/reader/workspace/ReaderWorkspace';
import { useAppView } from '@/app/useAppView';
import { useReaderHost } from '@/app/useReaderHost';
import type { AppView } from '@/app/view';
import './app.css';
```

Replace the `BootState` definitions to include `initialView`:

```ts
type ReadyBoot = {
  readonly kind: 'ready';
  readonly wiring: Wiring;
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly initialView: AppView;
};

type BootState =
  | { readonly kind: 'loading' }
  | ReadyBoot
  | { readonly kind: 'error'; readonly reason: string };
```

Keep the existing helper hooks `useHasBooks` and `useHasImportActivity` — unchanged.

Replace `ReadyApp` entirely:

```tsx
function ReadyApp({ boot }: { readonly boot: ReadyBoot }) {
  const { wiring, libraryStore, importStore, coverCache, initialView } = boot;
  const view = useAppView({ settingsRepo: wiring.settingsRepo, libraryStore, initial: initialView });
  const reader = useReaderHost({
    wiring,
    libraryStore,
    view: view.current,
    onBookRemovedWhileInReader: view.goLibrary,
  });
  const hasBooks = useHasBooks(libraryStore);
  const hasImportActivity = useHasImportActivity(importStore);
  const showWorkspace = hasBooks || hasImportActivity;

  // Forward picked files from useReaderHost to importStore.
  useEffect(() => {
    const onPicked = (e: Event): void => {
      const files = (e as CustomEvent<readonly File[]>).detail;
      for (const file of files) importStore.getState().enqueue(file);
    };
    window.addEventListener('bookworm:files-picked', onPicked);
    return () => {
      window.removeEventListener('bookworm:files-picked', onPicked);
    };
  }, [importStore]);

  // Cover cache cleanup on hide (existing behavior — unchanged).
  useEffect(() => {
    const onHide = (): void => {
      coverCache.forgetAll();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
    };
  }, [coverCache]);

  if (view.current.kind === 'reader') {
    const book = reader.findBook(view.current.bookId);
    if (!book) return null; // useAppView guard will fall back to library next render
    return (
      <div className="app">
        <ReaderWorkspace
          key={view.current.bookId}
          bookId={view.current.bookId}
          bookTitle={book.title}
          bookFormat={book.format}
          {...(book.author !== undefined && { bookSubtitle: book.author })}
          onBack={view.goLibrary}
          loadBookForReader={reader.loadBookForReader}
          createAdapter={reader.createAdapter}
          onAnchorChange={reader.onAnchorChange}
          onPreferencesChange={reader.onPreferencesChange}
          initialFocusMode={reader.initialFocusMode}
          hasShownFirstTimeHint={reader.hasShownFirstTimeHint}
          onFocusModeChange={reader.onFocusModeChange}
          onFirstTimeHintShown={reader.onFirstTimeHintShown}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <LibraryView
        libraryStore={libraryStore}
        importStore={importStore}
        coverCache={coverCache}
        hasBooks={showWorkspace}
        onFilesPicked={reader.onFilesPicked}
        onPersistSort={reader.onPersistSort}
        onRemoveBook={reader.onRemoveBook}
        onOpenBook={view.goReader}
      />
      <DropOverlay onFilesDropped={reader.onFilesPicked} />
    </div>
  );
}
```

Update the `App` component's boot effect to include `initialView`. Inside the boot effect, after the existing reads, ADD:

```ts
        const persistedView = await wiring.settingsRepo.getView();
```

And in the `setBoot({ kind: 'ready', ... })` call, ADD:

```ts
          initialView: persistedView ?? { kind: 'library' as const },
```

Remove the now-unused `debounce` helper from this file (it lives in `useReaderHost`). Remove unused `BookId`, `LIBRARY_VIEW`, `readerView`, `Book`, `BookFormat`, `LocationAnchor`, `SortKey`, `EpubReaderAdapter`, `PdfReaderAdapter`, `ReaderPreferences`, `BookReader`, `useCallback`, `useMemo` imports.

- [ ] **Step 3: Verify line count**

```bash
wc -l src/app/App.tsx
```

Expected: ~150 lines (down from ~282).

- [ ] **Step 4: Type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: clean. If any unused imports are flagged, remove them.

- [ ] **Step 5: Run unit suite**

```bash
pnpm test
```

Expected: PASS for everything (~95+ tests by now). The workspace + hook tests already passed in M2/M3; nothing else exercises App.tsx directly.

- [ ] **Step 6: Manual smoke**

```bash
pnpm dev
```

In the browser at `http://localhost:5173`:

- Open the bookshelf, click an EPUB → reader opens with chrome + left rail (TOC visible)
- Click a chapter in the rail → reader navigates
- Press `F` → chrome and rail disappear, reader fills viewport
- Move cursor to top → chrome fades in; move away → chrome fades out
- Press `F` again (or `Esc`) → back to normal mode
- Use browser devtools to switch to mobile viewport (390 × 844) → rail disappears
- Tap ☰ → bottom sheet slides up with TOC; tap scrim → dismisses
- Reload while in focus mode → reader still in focus mode on first paint

If anything's visibly broken, debug per `superpowers:systematic-debugging` (see `.claude` memory: stop after 2 failed fixes; instrument first).

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): App.tsx uses useAppView + useReaderHost + ReaderWorkspace

App.tsx shrinks from ~282 lines to ~150. Three clear jobs:
1) boot/error/loading
2) view routing (library vs reader)
3) composition

Reader-host concerns moved to useReaderHost. View-state moved to
useAppView. ReaderWorkspace replaces direct ReaderView mount.

A small custom DOM event ('bookworm:files-picked') bridges
useReaderHost (which doesn't know about importStore) to App.tsx
(which does). importStore stays in App because it's app-state
created during boot."
```

---

## Milestone 5 — End-to-end + docs

### Task 14: E2E `reader-workspace-desktop`

**Files:**
- Create: `e2e/reader-workspace-desktop.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

test('desktop workspace: rail visible, focus mode hides chrome + rail, hover reveals chrome', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({ timeout: 15_000 });

  // Default: rail visible
  await expect(page.locator('aside.desktop-rail')).toBeVisible();

  // Click a TOC entry in the rail
  const tocEntries = page.locator('aside.desktop-rail button.toc-panel__entry');
  await expect(tocEntries.first()).toBeVisible();
  await tocEntries.first().click();
  // No assertion on URL/chapter change here — that's covered by reader-open.spec.ts;
  // we just verify rail click doesn't break anything (chrome still there).
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();

  // Press F to enter focus mode
  await page.keyboard.press('F');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();
  await expect(page.locator('aside.desktop-rail')).toBeHidden();

  // Move cursor to the top to reveal chrome
  await page.mouse.move(640, 5);
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({ timeout: 1500 });

  // Move cursor away — chrome fades out (allow the 1.5s timer + 200ms transition)
  await page.mouse.move(640, 400);
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden({ timeout: 3000 });

  // Press Escape to exit focus mode
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible();
  await expect(page.locator('aside.desktop-rail')).toBeVisible();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-workspace-desktop.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-workspace-desktop.spec.ts
git commit -m "test(e2e): desktop workspace rail + focus mode + hover reveal"
```

---

### Task 15: E2E `reader-workspace-mobile`

**Files:**
- Create: `e2e/reader-workspace-mobile.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

test('mobile workspace: no rail, bottom sheet for TOC and typography', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({ timeout: 15_000 });

  // No rail in mobile viewport
  await expect(page.locator('aside.desktop-rail')).toBeHidden();

  // Tap ☰ → TOC sheet
  await page.getByRole('button', { name: /table of contents/i }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('aside.toc-panel')).toBeVisible();

  // Tap scrim to dismiss
  await page.locator('.mobile-sheet__scrim').click();
  await expect(sheet).toBeHidden();

  // Tap ⚙ → Typography sheet
  await page.getByRole('button', { name: /reader preferences/i }).click();
  const typoSheet = page.getByRole('dialog');
  await expect(typoSheet).toBeVisible();
  await expect(typoSheet.locator('section.typography-panel')).toBeVisible();

  // Press Escape to dismiss
  await page.keyboard.press('Escape');
  await expect(typoSheet).toBeHidden();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-workspace-mobile.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-workspace-mobile.spec.ts
git commit -m "test(e2e): mobile workspace — bottom sheet for TOC + typography"
```

---

### Task 16: E2E `reader-focus-persists`

**Files:**
- Create: `e2e/reader-focus-persists.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

test('focus mode persists across reload — no chrome flash', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({ timeout: 15_000 });

  // Enter focus mode
  await page.keyboard.press('F');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();

  // Allow the focus mode write to flush
  await page.waitForTimeout(300);

  // Reload — workspace re-mounts in focus mode from first paint
  await page.reload();

  // Wait for the reader-workspace root to be present
  const workspace = page.locator('.reader-workspace');
  await expect(workspace).toBeVisible({ timeout: 15_000 });

  // Verify data-mode is 'focus' on first observable paint and chrome is hidden
  await expect(workspace).toHaveAttribute('data-mode', 'focus');
  await expect(page.getByRole('button', { name: /back to library/i })).toBeHidden();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-focus-persists.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-focus-persists.spec.ts
git commit -m "test(e2e): focus mode persists across reload — no chrome flash"
```

---

### Task 17: E2E `reader-workspace-resize`

**Files:**
- Create: `e2e/reader-workspace-resize.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const PG_EPUB = resolve(process.cwd(), 'test-fixtures/small-pride-and-prejudice.epub');

async function importFixture(page: Page): Promise<void> {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a book to begin.' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(PG_EPUB);
  await expect(page.getByText(/pride and prejudice/i).first()).toBeVisible({ timeout: 15_000 });
}

test('resize across 768px breakpoint swaps rail ↔ sheet pattern', async ({ page }) => {
  // Start desktop
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importFixture(page);

  await page.getByRole('button', { name: /open pride and prejudice/i }).click();
  await expect(page.getByRole('button', { name: /back to library/i })).toBeVisible({ timeout: 15_000 });

  // Desktop = rail visible, no TOC button in chrome
  await expect(page.locator('aside.desktop-rail')).toBeVisible();
  await expect(page.getByRole('button', { name: /table of contents/i })).toBeHidden();

  // Resize to mobile width
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.locator('aside.desktop-rail')).toBeHidden();
  await expect(page.getByRole('button', { name: /table of contents/i })).toBeVisible();

  // Resize back to desktop
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('aside.desktop-rail')).toBeVisible();
  await expect(page.getByRole('button', { name: /table of contents/i })).toBeHidden();
});
```

- [ ] **Step 2: Build + run**

```bash
pnpm build && pnpm exec playwright test e2e/reader-workspace-resize.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reader-workspace-resize.spec.ts
git commit -m "test(e2e): resize across 768px breakpoint swaps rail ↔ sheet pattern"
```

---

### Task 18: Doc updates

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Decision history entry**

In `docs/02-system-architecture.md`, append above the Phase 2.2 entry (newest first):

```markdown
### 2026-05-03 — Phase 2.3 reader workspace layout

- New `ReaderWorkspace` (`src/features/reader/workspace/`) composes the reader
  shell — chrome, desktop rail (TocPanel), mobile bottom sheet (MobileSheet),
  focus mode, ReaderView. ReaderView slimmed to own only adapter lifecycle;
  exposes its state to the workspace via a new optional `onStateChange` prop.
- App.tsx extracted into three jobs: shell (App.tsx, ~150 lines), view routing
  (`useAppView`), reader hosting (`useReaderHost`). New ReaderWorkspace mounts
  inline.
- Two-pane layout in v2.3 (left rail + reader; right rail deferred to Phase 3
  when annotations have content for it). Right rail without content would be
  "dead chrome" — the design system explicitly prohibits.
- Mobile: iOS-Books-style bottom sheet (drag handle visual-only in v2.3,
  scrim, Escape + tap-to-dismiss). Drag-to-resize is a Phase 6 follow-up.
- Focus mode (desktop-only): keyboard shortcut (F / Esc / Cmd+\\) toggles;
  chrome AND rail hide; hover at top 40px reveals chrome with 1.5s hide-delay.
  First-time hint shown once (persisted via `settings.focusModeHintShown`).
- `ReaderPreferences.focusMode` new field — forward-compat normalize, no IDB
  schema bump.
- New responsive breakpoint at 768px via `useViewport` (matchMedia).
```

- [ ] **Step 2: Roadmap status — mark Phase 2 complete**

In `docs/04-implementation-roadmap.md`, update the Status block:

```markdown
## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (2026-05-03)
- Phase 2 — complete (2026-05-03)
- Phase 3 — pending
```

- [ ] **Step 3: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: record Phase 2.3 decisions; mark Phase 2 complete"
```

---

### Task 19: Final verification + open PR

**Files:** none

- [ ] **Step 1: Full quality gate**

```bash
pnpm check
```

Expected: type-check + lint + all unit tests pass.

- [ ] **Step 2: Full E2E suite**

```bash
pnpm build && pnpm test:e2e
```

Expected: all e2e green (17 prior + 4 new = 21).

- [ ] **Step 3: Manual smoke pass**

```bash
pnpm dev
```

Run through validation checklist from `docs/superpowers/specs/2026-05-03-phase-2-3-reader-workspace-design.md` Section 13:

- [ ] EPUB and PDF both work on desktop and mobile viewport
- [ ] Desktop: rail visible by default; click TOC entry navigates; F enters focus mode; chrome + rail hide; cursor near top reveals chrome; Esc exits
- [ ] Mobile (devtools 390×844): rail not visible; ☰ opens bottom sheet; scrim taps dismiss
- [ ] Resize across 768px breakpoint mid-read: layout swap is clean, position preserved
- [ ] Reload while in focus mode: reader fills viewport from first paint (no chrome flash)
- [ ] First-time focus mode entry shows the hint exactly once across reloads (open dev tools → Application → IndexedDB → bookworm → settings → focusModeHintShown=true after first entry)

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin phase-2-3-reader-workspace

gh pr create --title "Phase 2.3 — Reader workspace layout" --body "$(cat <<'EOF'
## Summary
- New `ReaderWorkspace` composes chrome + desktop rail (TocPanel) + mobile bottom sheet + ReaderView
- Two-pane layout in v2.3: left rail + reader (right rail deferred to Phase 3 when annotations exist)
- Mobile: iOS-Books-style bottom sheet for TOC + Typography (drag handle visual-only; drag-to-resize is Phase 6)
- Focus mode (desktop-only): F / Esc / Cmd+\ toggles; chrome AND rail hide; hover at top 40px reveals chrome with 1.5s hide-delay; first-time hint shown once
- ReaderView slimmed: exposes state via new optional `onStateChange` prop; no longer renders chrome/sheets directly
- App.tsx extracted: from ~282 lines → ~150. New `useAppView` (view state), `useReaderHost` (callbacks bundle)
- `ReaderPreferences.focusMode` new field — forward-compat normalize, no IDB schema bump
- New responsive breakpoint at 768px via `useViewport` (matchMedia)

No new dependencies.

## Spec + plan

- Spec: \`docs/superpowers/specs/2026-05-03-phase-2-3-reader-workspace-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-03-phase-2-3-reader-workspace.md\`

## Test plan

- [x] \`pnpm check\` green (~95+ unit tests)
- [x] \`pnpm test:e2e\` green (17 prior + 4 new = 21 specs)
- [ ] Manual: EPUB + PDF on desktop and mobile viewport
- [ ] Manual: F enters focus, hover top reveals chrome, Esc exits
- [ ] Manual: resize across 768px breakpoint mid-read
- [ ] Manual: reload while in focus mode — no chrome flash

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Done.** When the PR merges, Phase 2 is complete and the project is ready for Phase 3 (annotations).

---

## Scope coverage check (against spec)

| Spec section | Tasks |
|---|---|
| 4.1 Module layout | T4–T13 (new files); T11 (ReaderView slim); T13 (App.tsx) |
| 4.2 Boundary intent | T12 (ReaderWorkspace owns layout); T11 (ReaderView owns adapter); T5/T6/T7 (hooks single-responsibility) |
| 4.3 State ownership | T5 (focus state in useFocusMode); T6 (view state in useAppView); T12 (sheet state in workspace); T7 (initial focus mode read at boot) |
| 4.4 Migration | T2 (focusMode normalize); T3 (focusModeHintShown new key) |
| 4.5 Responsive breakpoint | T4 (useViewport at 768px) |
| 5.1 ReaderWorkspace shape | T12 |
| 5.2 ReaderView API change | T11 (onStateChange + ReaderViewExposedState) |
| 5.3 useFocusMode mechanics | T5 (state, keyboard, hover) |
| 5.4 Hover-reveal details | T5 (HOVER_ZONE_PX=40, HIDE_DELAY_MS=1500) |
| 5.5 First-time hint copy | T12 (FOCUS_HINT_TEXT constant); T3 + T7 (persistence wiring) |
| 5.6 MobileSheet mechanics | T9 (Escape, scrim, role=dialog, reduced-motion) |
| 5.7 useViewport mechanics | T4 |
| 6.1 App.tsx after extraction | T13 |
| 6.2 useAppView hook | T6 |
| 6.3 useReaderHost hook | T7 |
| 6.4 ReaderPreferences gains focusMode | T1 |
| 6.5 End-to-end data flow | T13 (wire-up); T14–T17 (verify) |
| 7. Error handling | T6 (deleted-book guard); T9 (escape only when sheet open); T11 (existing reader error states preserved) |
| 8. Testing strategy | T2, T3, T4, T5, T6, T7, T8, T9, T10, T12 (unit); T14–T17 (e2e) |
| 9. Risks (onStateChange leak, hover finicky, no chrome flash, A.tsx refactor risk) | T11 (typed exposed state); T5 (debounced timers); T7 (sync prop); T13 (manual smoke + e2e regression net) |
| 10. Files | All tasks |
| 12. Validation checklist | T19 |
