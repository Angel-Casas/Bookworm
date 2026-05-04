import { create } from 'zustand';

export type ApiKeyState =
  | { readonly kind: 'none' }
  | { readonly kind: 'session'; readonly key: string }
  | { readonly kind: 'unlocked'; readonly key: string }
  | { readonly kind: 'locked' };

type ApiKeyStore = {
  readonly state: ApiKeyState;
  readonly setSession: (key: string) => void;
  readonly setUnlocked: (key: string) => void;
  readonly markLocked: () => void;
  readonly clear: () => void;
};

export const useApiKeyStore = create<ApiKeyStore>((set) => ({
  state: { kind: 'none' },
  setSession: (key) => {
    set({ state: { kind: 'session', key } });
  },
  setUnlocked: (key) => {
    set({ state: { kind: 'unlocked', key } });
  },
  markLocked: () => {
    set({ state: { kind: 'locked' } });
  },
  clear: () => {
    set({ state: { kind: 'none' } });
  },
}));

export function useApiKeyState(): ApiKeyState {
  return useApiKeyStore((s) => s.state);
}

export function getCurrentApiKey(): string | null {
  const s = useApiKeyStore.getState().state;
  if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
  return null;
}
