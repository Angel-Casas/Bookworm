import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useModelCatalogStore,
  useCatalogState,
  useSelectedModelId,
  useStaleNotice,
  getCurrentSelectedModelId,
} from './modelCatalogStore';

beforeEach(() => {
  useModelCatalogStore.setState({
    state: { kind: 'idle' },
    selectedId: null,
    staleNotice: null,
    lastRefreshError: null,
  });
});

describe('modelCatalogStore', () => {
  it('initial state is idle with all fields cleared', () => {
    const s = useModelCatalogStore.getState();
    expect(s.state).toEqual({ kind: 'idle' });
    expect(s.selectedId).toBeNull();
    expect(s.staleNotice).toBeNull();
    expect(s.lastRefreshError).toBeNull();
  });

  it('setLoading transitions to loading', () => {
    useModelCatalogStore.getState().setLoading();
    expect(useModelCatalogStore.getState().state).toEqual({ kind: 'loading' });
  });

  it('setReady transitions to ready and clears lastRefreshError', () => {
    useModelCatalogStore.setState({ lastRefreshError: 'network' });
    useModelCatalogStore.getState().setReady([{ id: 'a' }], 1234);
    const s = useModelCatalogStore.getState();
    expect(s.state).toEqual({ kind: 'ready', models: [{ id: 'a' }], fetchedAt: 1234 });
    expect(s.lastRefreshError).toBeNull();
  });

  it('setError transitions to error with reason', () => {
    useModelCatalogStore.getState().setError('invalid-key');
    expect(useModelCatalogStore.getState().state).toEqual({
      kind: 'error',
      reason: 'invalid-key',
    });
  });

  it('setRefreshFailureWithCache keeps state ready and sets lastRefreshError', () => {
    useModelCatalogStore.getState().setReady([{ id: 'a' }], 1234);
    useModelCatalogStore.getState().setRefreshFailureWithCache('network');
    const s = useModelCatalogStore.getState();
    expect(s.state).toEqual({ kind: 'ready', models: [{ id: 'a' }], fetchedAt: 1234 });
    expect(s.lastRefreshError).toBe('network');
  });

  it('setRefreshFailureWithCache no-ops when state is not ready', () => {
    useModelCatalogStore.getState().setLoading();
    useModelCatalogStore.getState().setRefreshFailureWithCache('network');
    expect(useModelCatalogStore.getState().state).toEqual({ kind: 'loading' });
    expect(useModelCatalogStore.getState().lastRefreshError).toBeNull();
  });

  it('setSelectedId updates selectedId', () => {
    useModelCatalogStore.getState().setSelectedId('gpt-4o');
    expect(useModelCatalogStore.getState().selectedId).toBe('gpt-4o');
    useModelCatalogStore.getState().setSelectedId(null);
    expect(useModelCatalogStore.getState().selectedId).toBeNull();
  });

  it('setStaleNotice updates staleNotice', () => {
    useModelCatalogStore.getState().setStaleNotice('gone-id');
    expect(useModelCatalogStore.getState().staleNotice).toBe('gone-id');
    useModelCatalogStore.getState().setStaleNotice(null);
    expect(useModelCatalogStore.getState().staleNotice).toBeNull();
  });

  it('reset clears state, selectedId, staleNotice, lastRefreshError', () => {
    useModelCatalogStore.setState({
      state: { kind: 'ready', models: [{ id: 'a' }], fetchedAt: 1 },
      selectedId: 'a',
      staleNotice: 'old',
      lastRefreshError: 'network',
    });
    useModelCatalogStore.getState().reset();
    const s = useModelCatalogStore.getState();
    expect(s.state).toEqual({ kind: 'idle' });
    expect(s.selectedId).toBeNull();
    expect(s.staleNotice).toBeNull();
    expect(s.lastRefreshError).toBeNull();
  });

  it('getCurrentSelectedModelId returns the id or null', () => {
    expect(getCurrentSelectedModelId()).toBeNull();
    useModelCatalogStore.getState().setSelectedId('xyz');
    expect(getCurrentSelectedModelId()).toBe('xyz');
  });

  it('selectors subscribe correctly via hooks', () => {
    const { result: catalog } = renderHook(() => useCatalogState());
    const { result: sel } = renderHook(() => useSelectedModelId());
    const { result: stale } = renderHook(() => useStaleNotice());
    expect(catalog.current).toEqual({ kind: 'idle' });
    expect(sel.current).toBeNull();
    expect(stale.current).toBeNull();
    act(() => {
      useModelCatalogStore.getState().setReady([{ id: 'a' }], 5);
      useModelCatalogStore.getState().setSelectedId('a');
      useModelCatalogStore.getState().setStaleNotice('old');
    });
    expect(catalog.current).toEqual({ kind: 'ready', models: [{ id: 'a' }], fetchedAt: 5 });
    expect(sel.current).toBe('a');
    expect(stale.current).toBe('old');
  });
});
