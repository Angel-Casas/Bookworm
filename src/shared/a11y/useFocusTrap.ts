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
    const initialFirst = initial[0];
    if (initialFirst) initialFirst.focus();
    // If empty, the trap is dormant — Tab still preventDefaults below so focus
    // can't escape, but no element receives initial focus. None of the three
    // consumer modals hit this case.

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return;
      const trapRoot = ref.current;
      if (!trapRoot) return;
      const list = findFocusable(trapRoot);
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
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
      focusSafely(restoreTarget);
    };
  }, [ref, isActive]);
}
