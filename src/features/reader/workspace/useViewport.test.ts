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
      listeners.forEach((cb) => {
        cb({ matches: newMatches } as MediaQueryListEvent);
      });
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
    act(() => {
      ctl.fire(false);
    });
    expect(result.current).toBe('mobile');
  });
});
