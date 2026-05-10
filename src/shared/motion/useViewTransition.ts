import { useCallback } from 'react';

type ViewTransitionStarter = (updater: () => void) => void;

interface DocumentWithViewTransition {
  startViewTransition?: (updater: () => void) => unknown;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * React hook that wraps `document.startViewTransition` when the browser
 * supports it AND the user has not requested reduced motion. Otherwise the
 * updater is invoked synchronously, so callers always get a single,
 * predictable code path: pass an updater that mutates state, the rest is
 * handled here.
 */
export function useViewTransition(): ViewTransitionStarter {
  return useCallback((updater: () => void) => {
    const doc = document as DocumentWithViewTransition;
    if (
      prefersReducedMotion() ||
      typeof doc.startViewTransition !== 'function'
    ) {
      updater();
      return;
    }
    doc.startViewTransition(updater);
  }, []);
}
