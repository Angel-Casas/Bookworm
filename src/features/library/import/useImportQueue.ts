import { useSyncExternalStore } from 'react';
import type { ImportStore } from './importStore';

export function useImportQueue(store: ImportStore) {
  const entries = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getState().entries,
    () => store.getState().entries,
  );
  return {
    entries,
    enqueue: (file: File): string => store.getState().enqueue(file),
    dismiss: (id: string): void => {
      store.getState().dismiss(id);
    },
    clearTerminal: (): void => {
      store.getState().clearTerminal();
    },
  };
}
