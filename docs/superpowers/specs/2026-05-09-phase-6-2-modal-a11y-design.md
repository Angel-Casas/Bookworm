# Phase 6.2 — Modal focus trap + restoration + import-tray contrast

**Status:** approved 2026-05-09
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 6 → Task 6.2 (Accessibility pass)
**Predecessors:** Phase 6 audit. Resolves findings F2.1 (important), F2.3 (important), F2.4 (important). F2.5 (manual keyboard walkthrough) and F2.2 (already inline-fixed in PR-C) remain out of scope.
**Architecture decisions referenced:** `docs/06-quality-strategy.md` (a11y floor); `docs/05-design-system.md` (text color tier); existing `MobileSheet`, `IndexInspectorModal`, `HighlightToolbar` patterns.

---

## 1. Goal & scope

The Phase 6 audit found three serious-impact findings under 6.2 that share a theme: a11y at the modal/dialog boundary plus a small-text contrast failure in the import tray. This PR addresses all three together.

### In scope

- **Focus trap (F2.3).** New `src/shared/a11y/useFocusTrap.ts` hook. Pure React; ~50 lines; no new runtime dep. Applied to `MobileSheet`, `IndexInspectorModal`, `HighlightToolbar`.
- **Focus restoration (F2.4).** Same hook handles capture-on-mount / restore-on-unmount of `document.activeElement`.
- **Import-tray contrast (F2.1).** Four CSS color swaps in `src/features/library/import/import-tray.css`: `.import-tray__status`, `.import-tray__clear`, `.import-tray__action`, `.import-tray__dismiss` switch from `var(--color-text-subtle)` / `var(--color-accent)` to `var(--color-text-muted)` (passes WCAG AA at ~7:1).
- **Axe baseline update.** `e2e/axe.spec.ts`: lower `BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL` from `1` to `0` after the contrast fix lands.

### Out of scope (deferred)

- **Design-system-wide token darkening.** Token-level changes are best driven by a deliberate design-system pass, not a single audit's surface. The other places using `--color-text-subtle` did not surface as axe violations; they may be over larger text or higher-contrast backgrounds.
- **Adding `--color-accent-strong`** for action-tier accent. The Clear link gets `--color-text-muted` instead — italic + serif + hover state preserve the affordance distinction without needing a new token.
- **HighlightToolbar keyboard-invocation a11y** (e.g., reaching the toolbar from a keyboard-driven text selection). The existing implementation can't be reached by keyboard alone today; that's a separate concern from the focus-trap fix and was deferred in the audit (F2.5).
- **Library `focus-trap-react`** dep. Custom hook fits three flat-focusable modals; the library's edge cases (radio groups, dynamic visibility) don't apply.
- **E2e tests** that drive Tab through a modal. Unit-level coverage is sufficient.
- **Manual keyboard walkthrough (F2.5).** Defer to a future hands-on browser session.

---

## 2. `useFocusTrap` hook architecture

### File: `src/shared/a11y/useFocusTrap.ts` (new)

```ts
import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function findFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function focusSafely(el: Element | null): void {
  if (!(el instanceof HTMLElement)) return;
  try {
    el.focus();
  } catch {
    document.body.focus();
  }
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  isActive: boolean,
): void {
  useEffect(() => {
    if (!isActive) return;
    const root = ref.current;
    if (!root) return;

    const restoreTarget = document.activeElement;
    const initial = findFocusable(root);
    if (initial.length > 0) initial[0]?.focus();
    // If there are no focusables, the trap is effectively dormant — Tab still
    // gets preventDefault'd (see onKeyDown below) so focus can't escape, but
    // there's nowhere to land. None of the three modals consuming this hook
    // hit this case (they all have buttons); the guard exists to avoid
    // crashing on unusual consumers.

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return;
      const list = findFocusable(root);
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      // Restore focus to the element that was focused before the trap began.
      // If that element is no longer in the DOM (e.g., the trigger was
      // removed), focusSafely falls back to document.body.
      focusSafely(restoreTarget);
    };
  }, [ref, isActive]);
}
```

### Key behaviors

- **Mount:** captures `document.activeElement` (the trigger), focuses the first focusable inside the trapped element. If there are none, the trap is dormant — Tab is still prevented from escaping, but no element receives initial focus. None of the three modals hit this case.
- **Tab interception:** at the **last** focusable, Tab wraps to the **first**. At the **first**, Shift+Tab wraps to the **last**. Browser-default behavior at all other positions (so single-Tab presses inside the trap work normally).
- **Re-query on every Tab:** `findFocusable(root)` re-runs each keypress. Dynamic content (e.g., expanding a chunk row in `IndexInspectorModal`) is included automatically.
- **Cleanup / unmount:** removes the listener, restores focus to the captured trigger via `focusSafely` (safe fallback to `document.body` if the trigger is gone or non-focusable).
- **No interference with Escape:** the hook only listens for `Tab`. Escape continues to flow through the existing window-level keydown listener in each modal.

### Applications (3 files, ~3 lines each)

**`MobileSheet.tsx`:**
```tsx
const ref = useRef<HTMLDivElement>(null);
useFocusTrap(ref, true);
return (
  <>
    <div className="mobile-sheet__scrim" ... />
    <div className="mobile-sheet" role="dialog" aria-modal="true" ref={ref}>
      ...
    </div>
  </>
);
```

**`IndexInspectorModal.tsx`:** ref on the `.index-inspector` div (the role="dialog" container).

**`HighlightToolbar.tsx`:** the component already declares `const ref = useRef<HTMLDivElement>(null);` (line 45). Just add `useFocusTrap(ref, true);` after the existing `useEffect`. The ref is already attached to the toolbar root.

For all three, `isActive = true` (the modals are unmounted entirely when closed; we never need to "deactivate while mounted"). The hook accepts the parameter for future use cases.

---

## 3. Import-tray contrast fix

### Changes to `src/features/library/import/import-tray.css`

Four `color:` declarations swap from failing tokens to `var(--color-text-muted)`:

| Selector | Was | Now | WCAG AA on `--color-bg`? |
|---|---|---|---|
| `.import-tray__status` (line 56) | `var(--color-text-subtle)` (#8a7d6d) | `var(--color-text-muted)` (#5a4f44) | Was ~3.4:1. Now ~7:1. ✓ |
| `.import-tray__clear` (line 22) | `var(--color-accent)` (#b08a4b) | `var(--color-text-muted)` | Was ~3.5:1. Now ~7:1. ✓ |
| `.import-tray__action` (line 63) | `var(--color-accent)` | `var(--color-text-muted)` | Same fix; defensive. |
| `.import-tray__dismiss` (line 63) | `var(--color-accent)` (shared rule) | `var(--color-text-muted)` | Same. |

### Visual change

The "Clear" / per-row "Action" / "Dismiss" links lose their accent gold and become muted-text-italic. The italic + serif + cursor:pointer + (eventual hover state) preserve the affordance distinction. Status text becomes a touch darker — improvement, since it currently looks washed out.

If the design intent originally was "accent-tinted action affordance," that intent is preserved by the italic typography. No accent gold appears on the import tray after this change; it's reserved for genuinely accent-tier surfaces (like Settings status text).

### Optional follow-up (not in this PR)

Add a hover state to `.import-tray__clear` / `.import-tray__action` / `.import-tray__dismiss` that returns to `var(--color-text)` (full contrast) — strengthens the affordance on interaction. Out of scope unless the visual reduction looks too quiet.

---

## 4. Axe baseline update

`e2e/axe.spec.ts`:

```ts
// Was:
const BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL = 1;
// Now:
const BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL = 0;
```

After the contrast fix, all four baseline flows are at 0 — strictest possible, any future serious/critical regression fails CI. The comment explaining the F2.1 deferral (lines 12-14 of the spec) becomes stale; replace it with a note that all flows are at parity.

---

## 5. File summary

```
NEW   src/shared/a11y/useFocusTrap.ts                            ~60 lines
NEW   src/shared/a11y/useFocusTrap.test.tsx                      ~140 lines
MOD   src/features/reader/workspace/MobileSheet.tsx              add ref + hook call (~3 lines)
MOD   src/features/reader/workspace/MobileSheet.test.tsx         add focus-trap behavior tests
MOD   src/features/library/indexing/IndexInspectorModal.tsx      add ref + hook call (~3 lines)
MOD   src/features/library/indexing/IndexInspectorModal.test.tsx add focus-trap behavior tests
MOD   src/features/reader/HighlightToolbar.tsx                   hook call only (ref pre-exists)
MOD   src/features/reader/HighlightToolbar.test.tsx              add focus-trap behavior tests
MOD   src/features/library/import/import-tray.css                4 color swaps
MOD   e2e/axe.spec.ts                                             lower BASELINE_LIBRARY_WITH_BOOK to 0; update comment
MOD   docs/04-implementation-roadmap.md                           mark 6.2 complete
```

11 files. Compact PR — focused on a11y semantics with a small contrast bonus.

---

## 6. Testing

### `src/shared/a11y/useFocusTrap.test.tsx`

Test harness pattern: render a small consumer that supplies a ref + isActive flag + a list of focusable elements.

**Cases (7):**
1. On mount, the first focusable element receives focus.
2. With `isActive = false`, no focus change occurs (hook is a no-op).
3. Tab on a non-last button: native browser behavior (focus moves to the next sibling). The trap does not interfere.
4. Tab on the last focusable: prevents default, focuses the first.
5. Shift+Tab on the first focusable: prevents default, focuses the last.
6. On unmount, focus restores to the previously-active element (a "trigger" rendered alongside the harness, focused before the modal mounts).
7. With zero focusable children inside the ref, no element is auto-focused on mount, but Tab is still preventDefault'd (focus cannot escape).

The "restoreTarget gone" path (where the trigger is removed before the trap unmounts) is exercised by Test 6's variant that unmounts the trigger first — assert no crash, focus falls to `document.body`.

### Modal-level behavior tests (3 small additions)

For each modal, render the component and verify:
- After mount, `document.activeElement` is the expected first focusable (e.g., the Close button in `IndexInspectorModal`).
- After unmount, focus returns to the trigger button rendered outside the modal in the test setup.

These tests serve as integration-level proof that the hook is correctly wired into each modal. They share the harness pattern with the focus-trap tests.

### No e2e tests added

The existing `axe.spec.ts` baselines validate that no new a11y violations appear from this PR. Driving Tab keys through a modal in Playwright is doable but high-effort relative to value; the unit + behavior tests cover the contract.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `useFocusTrap` interferes with the modal's existing Escape handler | Hook only handles `Tab` keydown. Escape passes through to the existing window-level listener untouched. |
| First focusable in `IndexInspectorModal` is the close button (`×`) — Tab from there cycles through "Rebuild index" + chunk rows | Acceptable; close affordance reachable first matches keyboard convention. User can Escape at any time. |
| `HighlightToolbar` is a popover, not a modal — focus-trap on it is unusual | The toolbar's existing dismiss paths (Escape, outside-click, scroll) provide multiple escape routes. Trap behavior matches modal conventions; Tab cycles within. Keyboard-invocation a11y (F2.5) is a separate deferred concern. |
| `restoreTarget.focus()` throws (non-focusable element, removed from DOM) | `focusSafely` wraps in try/catch and falls back to `document.body.focus()`. Covered by tests. |
| Color change weakens "Clear" affordance | Italic + serif + cursor:pointer + (existing) hover state preserve actionability. Visual contrast (foreground on background) increases — net improvement. |
| Tab re-query on every keypress is expensive | The selector is a single `querySelectorAll`. Modal trees are tens of nodes at most. Negligible cost; React's reconciliation does heavier work on every state change. |
| Empty-children dormant trap could leave a keyboard user stranded | None of the three modals hit this case — all have buttons. Documented in the hook source. If a future consumer hits it, the symptom is "Tab does nothing inside the modal" — visible in unit testing. |
| Axe baseline update could mask new violations introduced elsewhere | Baseline at `0` is strictest — any new serious/critical violation immediately fails CI. The opposite of masking. |
| `IndexInspectorModal` chunk-row expand reveals new focusable buttons during the modal's lifetime | The hook re-queries focusables on every Tab keypress, so newly-revealed children become reachable automatically. No special wiring needed. |

---

## 8. Open question deliberately deferred

**`HighlightToolbar` keyboard-invocation flow.** Today the toolbar appears only after a mouse-driven text selection. Keyboard users with Shift+Arrow selection might invoke it, but selection-via-keyboard isn't fully tested. This is a separate concern from focus-trap and was deferred by the audit (F2.5). Solving it would require selection-event plumbing, dedicated tests, and possibly a different a11y model for the toolbar (auto-focus + dismiss-on-blur rather than focus-trap). Out of scope for this PR; reconsider if user-reported keyboard issues surface.

---

## 9. Acceptance criteria

- `src/shared/a11y/useFocusTrap.ts` exists with the documented behavior. All 7 unit tests in `useFocusTrap.test.tsx` pass.
- `MobileSheet`, `IndexInspectorModal`, `HighlightToolbar` consume the hook via `ref` + `useFocusTrap(ref, true)`. No other behavior change in any of the three.
- Each modal has a behavior test verifying focus on mount + restoration on unmount.
- `import-tray.css` has the four documented `var(--color-...)` swaps.
- `e2e/axe.spec.ts` `BASELINE_LIBRARY_WITH_BOOK_SERIOUS_OR_CRITICAL` is `0`. Spec passes.
- `pnpm check` green (~1015 unit tests, +12 new across the hook + 3 modals).
- `pnpm test:e2e` green (85 + 6 skipped, no new e2e specs).
- Production bundle delta < 2 KB gz (the hook is small, no new deps).
- Roadmap marks `Phase 6.2 — complete (2026-05-XX)`.
