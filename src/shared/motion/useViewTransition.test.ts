import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewTransition } from './useViewTransition';

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as unknown as { startViewTransition?: unknown })
    .startViewTransition;
});

function mockReducedMotion(reduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion: reduce')
          ? reduced
          : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }) satisfies MediaQueryList,
  );
}

describe('useViewTransition', () => {
  it('calls document.startViewTransition when the API is present and reduced-motion is off', () => {
    mockReducedMotion(false);
    const start = vi.fn((cb: () => void) => {
      cb();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: () => undefined,
      };
    });
    (
      document as unknown as { startViewTransition: typeof start }
    ).startViewTransition = start;

    const updater = vi.fn();
    const { result } = renderHook(() => useViewTransition());
    result.current(updater);

    expect(start).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledTimes(1);
  });

  it('runs the updater synchronously when the API is absent', () => {
    mockReducedMotion(false);
    expect(
      (document as unknown as { startViewTransition?: unknown })
        .startViewTransition,
    ).toBeUndefined();

    const updater = vi.fn();
    const { result } = renderHook(() => useViewTransition());
    result.current(updater);

    expect(updater).toHaveBeenCalledTimes(1);
  });

  it('runs the updater synchronously when reduced-motion is preferred, even if the API is present', () => {
    mockReducedMotion(true);
    const start = vi.fn();
    (
      document as unknown as { startViewTransition: typeof start }
    ).startViewTransition = start;

    const updater = vi.fn();
    const { result } = renderHook(() => useViewTransition());
    result.current(updater);

    expect(start).not.toHaveBeenCalled();
    expect(updater).toHaveBeenCalledTimes(1);
  });
});
