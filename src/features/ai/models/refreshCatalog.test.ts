import { describe, it, expect, beforeEach, vi } from 'vitest';
import { refreshCatalog } from './refreshCatalog';
import { useModelCatalogStore } from './modelCatalogStore';
import type { ModelsFetchResult } from '@/features/ai/key/nanogptApi';

beforeEach(() => {
  useModelCatalogStore.getState().reset();
});

function makeDeps(opts: {
  readonly result: ModelsFetchResult;
  readonly putModelCatalog?: ReturnType<typeof vi.fn>;
  readonly deleteSelectedModelId?: ReturnType<typeof vi.fn>;
}) {
  return {
    apiKey: 'sk-test',
    fetchCatalog: vi.fn(() => Promise.resolve(opts.result)),
    putModelCatalog: opts.putModelCatalog ?? vi.fn(() => Promise.resolve()),
    deleteSelectedModelId: opts.deleteSelectedModelId ?? vi.fn(() => Promise.resolve()),
    nowMs: () => 12_345,
  };
}

describe('refreshCatalog', () => {
  it('on success persists snapshot and transitions store to ready', async () => {
    const deps = makeDeps({ result: { ok: true, models: [{ id: 'a' }, { id: 'b' }] } });
    await refreshCatalog(deps);
    expect(deps.putModelCatalog).toHaveBeenCalledWith({
      models: [{ id: 'a' }, { id: 'b' }],
      fetchedAt: 12_345,
    });
    const s = useModelCatalogStore.getState();
    expect(s.state).toEqual({ kind: 'ready', models: [{ id: 'a' }, { id: 'b' }], fetchedAt: 12_345 });
    expect(s.lastRefreshError).toBeNull();
  });

  it('passes through loading state during the call', async () => {
    let observed: string | undefined;
    const deps = {
      apiKey: 'sk-test',
      fetchCatalog: vi.fn(() => {
        observed = useModelCatalogStore.getState().state.kind;
        return Promise.resolve({ ok: true as const, models: [] });
      }),
      putModelCatalog: vi.fn(() => Promise.resolve()),
      deleteSelectedModelId: vi.fn(() => Promise.resolve()),
      nowMs: () => 0,
    };
    await refreshCatalog(deps);
    expect(observed).toBe('loading');
  });

  it('on failure with no prior cache transitions to error', async () => {
    const deps = makeDeps({ result: { ok: false, reason: 'network' } });
    await refreshCatalog(deps);
    expect(useModelCatalogStore.getState().state).toEqual({
      kind: 'error',
      reason: 'network',
    });
  });

  it('on failure with prior cache keeps cache and sets lastRefreshError', async () => {
    useModelCatalogStore.getState().setReady([{ id: 'cached' }], 1);
    const deps = makeDeps({ result: { ok: false, reason: 'invalid-key', status: 401 } });
    await refreshCatalog(deps);
    const s = useModelCatalogStore.getState();
    expect(s.state).toEqual({ kind: 'ready', models: [{ id: 'cached' }], fetchedAt: 1 });
    expect(s.lastRefreshError).toBe('invalid-key');
  });

  it('on success drops a stale selection and sets staleNotice', async () => {
    useModelCatalogStore.getState().setSelectedId('vanished-model');
    const deleteSelectedModelId = vi.fn(() => Promise.resolve());
    const deps = makeDeps({
      result: { ok: true, models: [{ id: 'a' }, { id: 'b' }] },
      deleteSelectedModelId,
    });
    await refreshCatalog(deps);
    const s = useModelCatalogStore.getState();
    expect(s.selectedId).toBeNull();
    expect(s.staleNotice).toBe('vanished-model');
    expect(deleteSelectedModelId).toHaveBeenCalled();
  });

  it('on success does not drop a still-valid selection', async () => {
    useModelCatalogStore.getState().setSelectedId('a');
    const deleteSelectedModelId = vi.fn(() => Promise.resolve());
    const deps = makeDeps({
      result: { ok: true, models: [{ id: 'a' }, { id: 'b' }] },
      deleteSelectedModelId,
    });
    await refreshCatalog(deps);
    const s = useModelCatalogStore.getState();
    expect(s.selectedId).toBe('a');
    expect(s.staleNotice).toBeNull();
    expect(deleteSelectedModelId).not.toHaveBeenCalled();
  });
});
