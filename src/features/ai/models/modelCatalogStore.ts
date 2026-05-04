import { create } from 'zustand';
import type { Model } from '@/domain';

export type RefreshErrorReason = 'invalid-key' | 'network' | 'other';

export type CatalogState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly models: readonly Model[]; readonly fetchedAt: number }
  | { readonly kind: 'error'; readonly reason: RefreshErrorReason };

type ModelCatalogStore = {
  readonly state: CatalogState;
  readonly selectedId: string | null;
  readonly staleNotice: string | null;
  readonly lastRefreshError: RefreshErrorReason | null;
  readonly setLoading: () => void;
  readonly setReady: (models: readonly Model[], fetchedAt: number) => void;
  readonly setError: (reason: RefreshErrorReason) => void;
  readonly setRefreshFailureWithCache: (reason: RefreshErrorReason) => void;
  readonly setSelectedId: (id: string | null) => void;
  readonly setStaleNotice: (id: string | null) => void;
  readonly reset: () => void;
};

export const useModelCatalogStore = create<ModelCatalogStore>((set, get) => ({
  state: { kind: 'idle' },
  selectedId: null,
  staleNotice: null,
  lastRefreshError: null,
  setLoading: () => {
    set({ state: { kind: 'loading' } });
  },
  setReady: (models, fetchedAt) => {
    set({ state: { kind: 'ready', models, fetchedAt }, lastRefreshError: null });
  },
  setError: (reason) => {
    set({ state: { kind: 'error', reason } });
  },
  setRefreshFailureWithCache: (reason) => {
    if (get().state.kind !== 'ready') return;
    set({ lastRefreshError: reason });
  },
  setSelectedId: (id) => {
    set({ selectedId: id });
  },
  setStaleNotice: (id) => {
    set({ staleNotice: id });
  },
  reset: () => {
    set({
      state: { kind: 'idle' },
      selectedId: null,
      staleNotice: null,
      lastRefreshError: null,
    });
  },
}));

export function useCatalogState(): CatalogState {
  return useModelCatalogStore((s) => s.state);
}

export function useSelectedModelId(): string | null {
  return useModelCatalogStore((s) => s.selectedId);
}

export function useStaleNotice(): string | null {
  return useModelCatalogStore((s) => s.staleNotice);
}

export function useLastRefreshError(): RefreshErrorReason | null {
  return useModelCatalogStore((s) => s.lastRefreshError);
}

export function getCurrentSelectedModelId(): string | null {
  return useModelCatalogStore.getState().selectedId;
}
