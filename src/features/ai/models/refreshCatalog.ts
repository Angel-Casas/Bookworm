import type { ModelCatalogSnapshot } from '@/storage';
import type { ModelsFetchResult } from '@/features/ai/key/nanogptApi';
import { useModelCatalogStore, type CatalogState } from './modelCatalogStore';

export type RefreshCatalogDeps = {
  readonly apiKey: string;
  readonly fetchCatalog: (apiKey: string) => Promise<ModelsFetchResult>;
  readonly putModelCatalog: (snapshot: ModelCatalogSnapshot) => Promise<void>;
  readonly deleteSelectedModelId: () => Promise<void>;
  readonly nowMs?: () => number;
};

export async function refreshCatalog(deps: RefreshCatalogDeps): Promise<void> {
  const store = useModelCatalogStore.getState();
  const prevReady: Extract<CatalogState, { kind: 'ready' }> | null =
    store.state.kind === 'ready' ? store.state : null;

  store.setLoading();
  const result = await deps.fetchCatalog(deps.apiKey);

  if (!result.ok) {
    if (prevReady) {
      useModelCatalogStore.getState().setReady(prevReady.models, prevReady.fetchedAt);
      useModelCatalogStore.getState().setRefreshFailureWithCache(result.reason);
    } else {
      useModelCatalogStore.getState().setError(result.reason);
    }
    return;
  }

  const fetchedAt = deps.nowMs ? deps.nowMs() : Date.now();
  await deps.putModelCatalog({ models: result.models, fetchedAt });
  useModelCatalogStore.getState().setReady(result.models, fetchedAt);

  const after = useModelCatalogStore.getState();
  const sel = after.selectedId;
  if (sel !== null && !result.models.find((m) => m.id === sel)) {
    after.setSelectedId(null);
    after.setStaleNotice(sel);
    await deps.deleteSelectedModelId();
  }
}
