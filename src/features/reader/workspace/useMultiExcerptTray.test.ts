import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HighlightId, IsoTimestamp } from '@/domain/ids';
import type { AttachedExcerpt, AttachedMultiExcerpt } from '@/domain/ai/multiExcerpt';
import { useMultiExcerptTray } from './useMultiExcerptTray';

const mk = (i: number): AttachedExcerpt => ({
  id: `h:${String(i)}`,
  sourceKind: 'highlight',
  highlightId: HighlightId(`h${String(i)}`),
  anchor: { kind: 'epub-cfi', cfi: `epubcfi(/6/4!/4/${String(i)})` },
  sectionTitle: `Ch ${String(i)}`,
  text: 't',
  addedAt: IsoTimestamp('2026-05-08T00:00:00.000Z'),
});

describe('useMultiExcerptTray', () => {
  it('add on empty tray routes through setActiveAttachment("multi-excerpt")', () => {
    const setActive = vi.fn();
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: null, setActiveAttachment: setActive }),
    );
    let res: 'ok' | 'full' | 'duplicate' | undefined;
    act(() => {
      res = result.current.add(mk(2));
    });
    expect(res).toBe('ok');
    expect(setActive).toHaveBeenCalledWith(
      'multi-excerpt',
      expect.objectContaining({
        excerpts: [expect.objectContaining({ id: 'h:2' })],
      }),
    );
  });

  it('add to non-empty tray updates payload through setActiveAttachment', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    act(() => {
      result.current.add(mk(4));
    });
    const lastCall = setActive.mock.calls[setActive.mock.calls.length - 1] as
      | [unknown, AttachedMultiExcerpt | undefined]
      | undefined;
    expect(lastCall?.[0]).toBe('multi-excerpt');
    expect(lastCall?.[1]?.excerpts).toHaveLength(2);
  });

  it('add returns "full" when at MAX_EXCERPTS', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = {
      excerpts: [mk(0), mk(1), mk(2), mk(3), mk(4), mk(5)],
    };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    let res: 'ok' | 'full' | 'duplicate' | undefined;
    act(() => {
      res = result.current.add(mk(6));
    });
    expect(res).toBe('full');
  });

  it('add returns "duplicate" when id already in tray', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    let res: 'ok' | 'full' | 'duplicate' | undefined;
    act(() => {
      res = result.current.add(mk(2));
    });
    expect(res).toBe('duplicate');
  });

  it('remove last excerpt routes setActiveAttachment("none")', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    act(() => {
      result.current.remove('h:2');
    });
    expect(setActive).toHaveBeenCalledWith('none');
  });

  it('remove non-last excerpt routes setActiveAttachment("multi-excerpt", updatedTray)', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2), mk(4)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    act(() => {
      result.current.remove('h:2');
    });
    const call = setActive.mock.calls[0] as
      | [unknown, AttachedMultiExcerpt | undefined]
      | undefined;
    expect(call?.[0]).toBe('multi-excerpt');
    expect(call?.[1]?.excerpts).toHaveLength(1);
    expect(call?.[1]?.excerpts[0]?.id).toBe('h:4');
  });

  it('clear routes setActiveAttachment("none")', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    act(() => {
      result.current.clear();
    });
    expect(setActive).toHaveBeenCalledWith('none');
  });

  it('contains returns correct membership', () => {
    const setActive = vi.fn();
    const initial: AttachedMultiExcerpt = { excerpts: [mk(2)] };
    const { result } = renderHook(() =>
      useMultiExcerptTray({ tray: initial, setActiveAttachment: setActive }),
    );
    expect(result.current.contains('h:2')).toBe(true);
    expect(result.current.contains('h:nope')).toBe(false);
  });
});
