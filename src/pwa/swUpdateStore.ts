import { createStore, type StoreApi } from 'zustand/vanilla';
import { useSyncExternalStore } from 'react';

export type SwUpdateState = {
  readonly needsRefresh: boolean;
  readonly offlineReady: boolean;
  readonly applyUpdate: () => Promise<void>;
  readonly setApplyUpdate: (fn: () => Promise<void>) => void;
  readonly markNeedsRefresh: () => void;
  readonly markOfflineReady: () => void;
  readonly dismissNeedsRefresh: () => void;
  readonly dismissOfflineReady: () => void;
};

const STORAGE_KEY = 'bookworm.offlineReadySeen';

function readSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    console.warn('[swUpdateStore] could not persist offlineReadySeen');
  }
}

export const swUpdateStore: StoreApi<SwUpdateState> = createStore<SwUpdateState>((set) => ({
  needsRefresh: false,
  offlineReady: false,
  applyUpdate: () => Promise.resolve(),
  setApplyUpdate: (fn) => {
    set({ applyUpdate: fn });
  },
  markNeedsRefresh: () => {
    set({ needsRefresh: true });
  },
  markOfflineReady: () => {
    if (readSeen()) return;
    set({ offlineReady: true });
  },
  dismissNeedsRefresh: () => {
    set({ needsRefresh: false });
  },
  dismissOfflineReady: () => {
    writeSeen();
    set({ offlineReady: false });
  },
}));

export function useSwUpdates(): SwUpdateState {
  return useSyncExternalStore(swUpdateStore.subscribe, swUpdateStore.getState);
}
