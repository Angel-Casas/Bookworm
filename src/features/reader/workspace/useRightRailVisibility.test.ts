import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRightRailVisibility } from './useRightRailVisibility';

describe('useRightRailVisibility', () => {
  it('initializes from initial value', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useRightRailVisibility({ initial: false, onChange }));
    expect(result.current.visible).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggle flips state and calls onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useRightRailVisibility({ initial: true, onChange }));
    act(() => {
      result.current.toggle();
    });
    expect(result.current.visible).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('set explicitly assigns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useRightRailVisibility({ initial: false, onChange }));
    act(() => {
      result.current.set(true);
    });
    expect(result.current.visible).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
