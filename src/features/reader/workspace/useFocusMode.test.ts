import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusMode } from './useFocusMode';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function press(key: string, modifiers: { meta?: boolean; ctrl?: boolean } = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, metaKey: !!modifiers.meta, ctrlKey: !!modifiers.ctrl }),
  );
}

const baseOpts = {
  initial: 'normal' as const,
  onChange: () => undefined,
  hasShownFirstTimeHint: true,
  onFirstTimeHintShown: () => undefined,
};

describe('useFocusMode', () => {
  it('starts in the initial mode and exposes shouldRenderChrome', () => {
    const { result } = renderHook(() => useFocusMode(baseOpts));
    expect(result.current.mode).toBe('normal');
    expect(result.current.shouldRenderChrome).toBe(true);
  });

  it('toggle flips mode and fires onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useFocusMode({ ...baseOpts, onChange }));
    act(() => {
      result.current.toggle();
    });
    expect(result.current.mode).toBe('focus');
    expect(onChange).toHaveBeenCalledWith('focus');
    expect(result.current.shouldRenderChrome).toBe(false);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.mode).toBe('normal');
    expect(onChange).toHaveBeenLastCalledWith('normal');
  });

  it('F key toggles when not in input', () => {
    const { result } = renderHook(() => useFocusMode(baseOpts));
    act(() => {
      press('F');
    });
    expect(result.current.mode).toBe('focus');
  });

  it('lowercase f key toggles too (no Shift required)', () => {
    const { result } = renderHook(() => useFocusMode(baseOpts));
    act(() => {
      press('f');
    });
    expect(result.current.mode).toBe('focus');
  });

  it('Cmd+\\ toggles', () => {
    const { result } = renderHook(() => useFocusMode(baseOpts));
    act(() => {
      press('\\', { meta: true });
    });
    expect(result.current.mode).toBe('focus');
  });

  it('Escape exits focus mode but does not enter from normal', () => {
    const { result } = renderHook(() => useFocusMode(baseOpts));
    // Escape from normal — no change
    act(() => {
      press('Escape');
    });
    expect(result.current.mode).toBe('normal');
    // Enter focus, then Escape exits
    act(() => {
      result.current.toggle();
    });
    expect(result.current.mode).toBe('focus');
    act(() => {
      press('Escape');
    });
    expect(result.current.mode).toBe('normal');
  });

  it('keyboard shortcuts ignored when input is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const { result } = renderHook(() => useFocusMode(baseOpts));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true }));
    expect(result.current.mode).toBe('normal');
  });

  it('first-time hint shows and fires onFirstTimeHintShown', () => {
    const onFirstTimeHintShown = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({
        ...baseOpts,
        hasShownFirstTimeHint: false,
        onFirstTimeHintShown,
      }),
    );
    act(() => {
      result.current.toggle();
    });
    expect(result.current.firstTimeHintVisible).toBe(true);
    expect(onFirstTimeHintShown).toHaveBeenCalledOnce();
  });

  it('does not show hint when hasShownFirstTimeHint is true', () => {
    const onFirstTimeHintShown = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({ ...baseOpts, hasShownFirstTimeHint: true, onFirstTimeHintShown }),
    );
    act(() => {
      result.current.toggle();
    });
    expect(result.current.firstTimeHintVisible).toBe(false);
    expect(onFirstTimeHintShown).not.toHaveBeenCalled();
  });
});
