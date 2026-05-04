# Phase 4.2 — Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the model catalog: a "Models" section in the existing Settings page that fetches `/v1/models` from NanoGPT, persists the snapshot + the user's chosen model, and refreshes on demand. Visible only when the API key is available; auto-fetches on key entry/unlock; cascades on key removal.

**Architecture:** Two new `SettingsRecord` variants (`'modelCatalog'` + `'selectedModelId'`) + a new Zustand `modelCatalogStore` mirroring `apiKeyStore`'s pattern. `nanogptApi.fetchCatalog` is a semantic alias around the same `/v1/models` request `validateKey` already makes (private `getModels` shared). UI under `src/features/ai/models/`. Boot hydrates the cached snapshot synchronously before first paint; explicit Refresh is the only way to re-fetch (no hidden uploads).

**Tech Stack:** TypeScript strict, React 19, Zustand 5, `idb` (existing), Vitest + happy-dom (unit), Playwright (E2E).

**Reference:** Spec at `docs/superpowers/specs/2026-05-04-phase-4-2-model-catalog-design.md`.

---

## Task ordering

Storage first (everything depends on `SettingsRecord` extension + repo methods). Then the `Model` domain type, then `nanogptApi.fetchCatalog`, then the Zustand store, then small pure helpers (`messages`, `refreshCatalog`). Then UI leaf-up: `ModelRow` → `ModelList` → `ModelsSection`. Then SettingsView integration (renders section + auto-fetch + cascade). Then App.tsx boot hydration. Then 7 E2E specs. Then docs. Then final verification + PR.

---

### Task 1: Storage — `SettingsRecord` variants + `SettingsRepository` methods + validators

**Files:**
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/repositories/settings.ts`
- Modify: `src/storage/repositories/settings.test.ts`
- Modify: `src/storage/index.ts`

> **Strategy:** Two additive `SettingsRecord` variants (`'modelCatalog'`, `'selectedModelId'`); six new repo methods; two validators (`isValidModelCatalogValue`, `isValidSelectedModelId`). Same defensive-read pattern as `isValidApiKeyValue`.

- [ ] **Step 1: Append failing tests to `src/storage/repositories/settings.test.ts`**

Inside the outer `describe('SettingsRepository', ...)` block, before its closing `});`, add:

```ts
  describe('modelCatalog', () => {
    function makeSnapshot(): ModelCatalogSnapshot {
      return {
        models: [{ id: 'gpt-x' }, { id: 'claude-y' }],
        fetchedAt: 1_700_000_000_000,
      };
    }

    it('returns undefined when no snapshot is stored', async () => {
      const settings = createSettingsRepository(db);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('round-trips a snapshot', async () => {
      const settings = createSettingsRepository(db);
      const snap = makeSnapshot();
      await settings.putModelCatalog(snap);
      const round = await settings.getModelCatalog();
      expect(round).toEqual(snap);
    });

    it('putModelCatalog overwrites the existing record', async () => {
      const settings = createSettingsRepository(db);
      await settings.putModelCatalog(makeSnapshot());
      const next: ModelCatalogSnapshot = {
        models: [{ id: 'only-one' }],
        fetchedAt: 1_700_000_000_001,
      };
      await settings.putModelCatalog(next);
      expect(await settings.getModelCatalog()).toEqual(next);
    });

    it('deleteModelCatalog removes the record', async () => {
      const settings = createSettingsRepository(db);
      await settings.putModelCatalog(makeSnapshot());
      await settings.deleteModelCatalog();
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('returns undefined for corrupt records (missing models array)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'modelCatalog',
        value: { fetchedAt: 1 },
      } as never);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('returns undefined for corrupt records (model with non-string id)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'modelCatalog',
        value: { models: [{ id: 42 }], fetchedAt: 1 },
      } as never);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('returns undefined for corrupt records (non-finite fetchedAt)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'modelCatalog',
        value: { models: [], fetchedAt: Number.NaN },
      } as never);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });
  });

  describe('selectedModelId', () => {
    it('returns undefined when nothing is stored', async () => {
      const settings = createSettingsRepository(db);
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });

    it('round-trips a non-empty id', async () => {
      const settings = createSettingsRepository(db);
      await settings.putSelectedModelId('gpt-4o');
      expect(await settings.getSelectedModelId()).toBe('gpt-4o');
    });

    it('deleteSelectedModelId removes the record', async () => {
      const settings = createSettingsRepository(db);
      await settings.putSelectedModelId('gpt-4o');
      await settings.deleteSelectedModelId();
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });

    it('returns undefined for corrupt records (empty string)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', { key: 'selectedModelId', value: '' } as never);
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });

    it('returns undefined for corrupt records (non-string value)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', { key: 'selectedModelId', value: 42 } as never);
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });
  });
```

Update the imports at the top:

```ts
import type { ApiKeyBlob, ModelCatalogSnapshot } from '@/storage';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --run src/storage/repositories/settings.test.ts`
Expected: FAIL — `ModelCatalogSnapshot` not exported, `getModelCatalog/putModelCatalog/deleteModelCatalog/getSelectedModelId/putSelectedModelId/deleteSelectedModelId` not on `SettingsRepository`.

- [ ] **Step 3: Edit `src/storage/db/schema.ts`**

Replace the existing `SettingsRecord` union:

```ts
export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' }
  | { readonly key: 'view'; readonly value: AppView }
  | { readonly key: 'focusModeHintShown'; readonly value: boolean }
  | {
      readonly key: 'apiKey';
      readonly value: {
        readonly salt: ArrayBuffer;
        readonly iv: ArrayBuffer;
        readonly ciphertext: ArrayBuffer;
        readonly iterations: number;
      };
    }
  | {
      readonly key: 'modelCatalog';
      readonly value: {
        readonly models: readonly { readonly id: string }[];
        readonly fetchedAt: number;
      };
    }
  | { readonly key: 'selectedModelId'; readonly value: string };
```

- [ ] **Step 4: Edit `src/storage/repositories/settings.ts`**

Add the `ModelCatalogSnapshot` type after `ApiKeyBlob`:

```ts
export type ModelCatalogSnapshot = {
  readonly models: readonly { readonly id: string }[];
  readonly fetchedAt: number;
};
```

Extend `SettingsRepository` with the six new methods (after `deleteApiKeyBlob`):

```ts
  getModelCatalog(): Promise<ModelCatalogSnapshot | undefined>;
  putModelCatalog(snapshot: ModelCatalogSnapshot): Promise<void>;
  deleteModelCatalog(): Promise<void>;
  getSelectedModelId(): Promise<string | undefined>;
  putSelectedModelId(id: string): Promise<void>;
  deleteSelectedModelId(): Promise<void>;
```

Add two validator functions before `VALID_SORT_KEYS`:

```ts
function isValidModelCatalogValue(v: unknown): v is ModelCatalogSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;
  if (typeof x.fetchedAt !== 'number' || !Number.isFinite(x.fetchedAt)) return false;
  if (!Array.isArray(x.models)) return false;
  return x.models.every(
    (m) => typeof m === 'object' && m !== null && typeof (m as { id?: unknown }).id === 'string',
  );
}

function isValidSelectedModelId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
```

Add the six implementations inside the returned `createSettingsRepository` object, after `deleteApiKeyBlob`:

```ts
    async getModelCatalog() {
      const rec = await get<Extract<SettingsRecord, { key: 'modelCatalog' }>>('modelCatalog');
      if (!rec) return undefined;
      return isValidModelCatalogValue(rec.value) ? rec.value : undefined;
    },
    async putModelCatalog(snapshot) {
      await put({ key: 'modelCatalog', value: snapshot });
    },
    async deleteModelCatalog() {
      await db.delete(SETTINGS_STORE, 'modelCatalog');
    },
    async getSelectedModelId() {
      const rec =
        await get<Extract<SettingsRecord, { key: 'selectedModelId' }>>('selectedModelId');
      if (!rec) return undefined;
      return isValidSelectedModelId(rec.value) ? rec.value : undefined;
    },
    async putSelectedModelId(id) {
      await put({ key: 'selectedModelId', value: id });
    },
    async deleteSelectedModelId() {
      await db.delete(SETTINGS_STORE, 'selectedModelId');
    },
```

- [ ] **Step 5: Edit `src/storage/index.ts`**

Replace the settings export block:

```ts
export {
  createSettingsRepository,
  type SettingsRepository,
  type ApiKeyBlob,
  type ModelCatalogSnapshot,
} from './repositories/settings';
```

- [ ] **Step 6: Fix existing test mocks of `SettingsRepository`**

Two existing test files build fake `SettingsRepository` objects and will now fail type-check:

- `src/app/useAppView.test.ts` — `fakeSettingsRepo()` factory
- `src/app/useReaderHost.test.ts` — `settingsRepo` mock object

Add the six new methods to each fake. Pattern (verbatim for `useAppView.test.ts`):

```ts
function fakeSettingsRepo(): SettingsRepository & { setView: ReturnType<typeof vi.fn> } {
  const setView = vi.fn(() => Promise.resolve());
  return {
    getLibrarySort: () => Promise.resolve(undefined),
    setLibrarySort: () => Promise.resolve(),
    getStoragePersistResult: () => Promise.resolve(undefined),
    setStoragePersistResult: () => Promise.resolve(),
    getView: () => Promise.resolve(undefined),
    setView,
    getFocusModeHintShown: () => Promise.resolve(false),
    setFocusModeHintShown: () => Promise.resolve(),
    getApiKeyBlob: () => Promise.resolve(undefined),
    putApiKeyBlob: () => Promise.resolve(),
    deleteApiKeyBlob: () => Promise.resolve(),
    getModelCatalog: () => Promise.resolve(undefined),
    putModelCatalog: () => Promise.resolve(),
    deleteModelCatalog: () => Promise.resolve(),
    getSelectedModelId: () => Promise.resolve(undefined),
    putSelectedModelId: () => Promise.resolve(),
    deleteSelectedModelId: () => Promise.resolve(),
  };
}
```

For `useReaderHost.test.ts`, add the six methods to the existing `settingsRepo: { ... }` block as `vi.fn(() => Promise.resolve(undefined))` / `vi.fn(() => Promise.resolve())` matching the pattern already there.

- [ ] **Step 7: Run all storage + app tests**

Run: `pnpm test --run src/storage/repositories/settings.test.ts src/app/useAppView.test.ts src/app/useReaderHost.test.ts`
Expected: PASS — existing tests still pass, 12 new modelCatalog/selectedModelId tests pass.

- [ ] **Step 8: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/storage/db/schema.ts src/storage/repositories/settings.ts src/storage/repositories/settings.test.ts src/storage/index.ts src/app/useAppView.test.ts src/app/useReaderHost.test.ts
git commit -m "feat(storage): SettingsRecord gains modelCatalog + selectedModelId variants"
```

---

### Task 2: Domain type — `Model`

**Files:**
- Create: `src/domain/ai.ts`
- Modify: `src/domain/index.ts`

> **Strategy:** A standalone `Model` type that 4.3+ can extend without thrashing the storage contract. Tiny file; no test (a one-field type isn't worth a unit test).

- [ ] **Step 1: Create `src/domain/ai.ts`**

```ts
export type Model = {
  readonly id: string;
};
```

- [ ] **Step 2: Re-export from `src/domain/index.ts`**

Read the current file first to see the export style. Append a new line at the end:

```ts
export type { Model } from './ai';
```

- [ ] **Step 3: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/domain/ai.ts src/domain/index.ts
git commit -m "feat(domain): Model type for AI catalog"
```

---

### Task 3: `nanogptApi` — `fetchCatalog` semantic alias

**Files:**
- Modify: `src/features/ai/key/nanogptApi.ts`
- Modify: `src/features/ai/key/nanogptApi.test.ts`

> **Strategy:** Promote the existing `validateKey` body to a private `getModels` and add a `fetchCatalog` public alias. No behavior change for 4.1 callers; one new export. Add a parity test.

- [ ] **Step 1: Append a failing test to `src/features/ai/key/nanogptApi.test.ts`**

Inside the existing `describe('validateKey', ...)` block, after the last `it`, but before the closing `});`, add a new top-level describe (after the closing `});` of validateKey). Or simpler: just append at the end of the file, before the very last `});`:

```ts
describe('fetchCatalog', () => {
  it('returns identical results to validateKey for the same response (parity)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockFetchResponse({ data: [{ id: 'a' }, { id: 'b' }] }))
      .mockResolvedValueOnce(mockFetchResponse({ data: [{ id: 'a' }, { id: 'b' }] }));
    const r1 = await fetchCatalog('sk-test');
    const r2 = await validateKey('sk-test');
    expect(r1).toEqual(r2);
  });

  it('calls /v1/models with Authorization Bearer', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [{ id: 'm-1' }] }),
    );
    await fetchCatalog('sk-test');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]! as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(call[0]).toMatch(/\/v1\/models$/);
    expect(call[1].headers.Authorization).toBe('Bearer sk-test');
  });
});
```

Update the import at the top of the file:

```ts
import { validateKey, fetchCatalog } from './nanogptApi';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/key/nanogptApi.test.ts`
Expected: FAIL — `fetchCatalog` not exported.

- [ ] **Step 3: Edit `src/features/ai/key/nanogptApi.ts`**

Replace the file:

```ts
const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type ValidateKeyResult =
  | { readonly ok: true; readonly models: readonly { id: string }[] }
  | {
      readonly ok: false;
      readonly reason: 'invalid-key' | 'network' | 'other';
      readonly status?: number;
    };

export type ModelsFetchResult = ValidateKeyResult;

type ModelsResponseBody = { readonly data?: readonly unknown[] };

async function getModels(apiKey: string, signal?: AbortSignal): Promise<ValidateKeyResult> {
  let res: Response;
  try {
    res = await fetch(`${NANOGPT_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(signal !== undefined && { signal }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: 'invalid-key', status: res.status };
  }
  if (!res.ok) {
    return { ok: false, reason: 'other', status: res.status };
  }
  let body: ModelsResponseBody;
  try {
    body = (await res.json()) as ModelsResponseBody;
  } catch {
    return { ok: false, reason: 'other' };
  }
  const models = (body.data ?? [])
    .filter(
      (m): m is { id: string } =>
        typeof m === 'object' && m !== null && 'id' in m && typeof m.id === 'string',
    )
    .map((m) => ({ id: m.id }));
  return { ok: true, models };
}

export async function validateKey(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ValidateKeyResult> {
  return getModels(apiKey, signal);
}

export async function fetchCatalog(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelsFetchResult> {
  return getModels(apiKey, signal);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/key/nanogptApi.test.ts`
Expected: PASS — existing 10 + 2 new = 12 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/key/nanogptApi.ts src/features/ai/key/nanogptApi.test.ts
git commit -m "feat(ai/key): fetchCatalog alias on shared private getModels"
```

---

### Task 4: `modelCatalogStore` — Zustand state

**Files:**
- Create: `src/features/ai/models/modelCatalogStore.ts`
- Create: `src/features/ai/models/modelCatalogStore.test.ts`

> **Strategy:** Mirror `apiKeyStore`. Discriminated-union `state` + standalone `selectedId`/`staleNotice`/`lastRefreshError`. Selector hooks. Synchronous accessor for non-React consumers.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/models/modelCatalogStore.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/models/modelCatalogStore.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the store**

```ts
// src/features/ai/models/modelCatalogStore.ts
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
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/models/modelCatalogStore.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/models/modelCatalogStore.ts src/features/ai/models/modelCatalogStore.test.ts
git commit -m "feat(ai/models): modelCatalogStore — Zustand catalog state machine"
```

---

### Task 5: `messages` — error reason → user-facing copy

**Files:**
- Create: `src/features/ai/models/messages.ts`
- Create: `src/features/ai/models/messages.test.ts`

> **Strategy:** Pure function. Maps `(reason, hasCache, fetchedAtMs)` to a string. Tested per row of §6.4 in the spec.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/models/messages.test.ts
import { describe, it, expect } from 'vitest';
import { messageForCatalogError } from './messages';

describe('messageForCatalogError', () => {
  const now = 1_700_000_000_000;
  const fiveMinAgo = now - 5 * 60_000;

  it('invalid-key, no cache → "rejected the key"', () => {
    expect(messageForCatalogError('invalid-key', { hasCache: false, now })).toMatch(
      /rejected the key/i,
    );
  });

  it('invalid-key, with cache → mentions last-known list', () => {
    expect(
      messageForCatalogError('invalid-key', { hasCache: true, fetchedAt: fiveMinAgo, now }),
    ).toMatch(/last-known list/i);
  });

  it('network, no cache → "Couldn\'t reach NanoGPT"', () => {
    expect(messageForCatalogError('network', { hasCache: false, now })).toMatch(
      /couldn['’]t reach nanogpt/i,
    );
  });

  it('network, with cache → mentions last-known list', () => {
    expect(
      messageForCatalogError('network', { hasCache: true, fetchedAt: fiveMinAgo, now }),
    ).toMatch(/last-known list/i);
  });

  it('other, no cache → "Unexpected response"', () => {
    expect(messageForCatalogError('other', { hasCache: false, now })).toMatch(
      /unexpected response/i,
    );
  });

  it('other, with cache → mentions last-known list', () => {
    expect(
      messageForCatalogError('other', { hasCache: true, fetchedAt: fiveMinAgo, now }),
    ).toMatch(/last-known list/i);
  });

  it('with-cache messages include a relative time', () => {
    const msg = messageForCatalogError('network', {
      hasCache: true,
      fetchedAt: fiveMinAgo,
      now,
    });
    expect(msg).toMatch(/5 min/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/models/messages.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the messages module**

```ts
// src/features/ai/models/messages.ts
import type { RefreshErrorReason } from './modelCatalogStore';

export type CatalogErrorContext =
  | { readonly hasCache: false; readonly now: number }
  | { readonly hasCache: true; readonly fetchedAt: number; readonly now: number };

function relativeMinutes(fetchedAt: number, now: number): string {
  const diffMs = Math.max(0, now - fetchedAt);
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'less than a minute';
  if (mins === 1) return '1 min';
  if (mins < 60) return `${String(mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return '1 h';
  if (hours < 24) return `${String(hours)} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${String(days)} days`;
}

export function messageForCatalogError(
  reason: RefreshErrorReason,
  ctx: CatalogErrorContext,
): string {
  if (!ctx.hasCache) {
    switch (reason) {
      case 'invalid-key':
        return 'NanoGPT rejected the key. Try removing it and entering it again.';
      case 'network':
        return "Couldn't reach NanoGPT. Check your connection and try Refresh again.";
      case 'other':
        return 'Unexpected response from NanoGPT. Try Refresh again.';
    }
  }
  const age = relativeMinutes(ctx.fetchedAt, ctx.now);
  switch (reason) {
    case 'invalid-key':
      return `Couldn't refresh — NanoGPT rejected the key. Using the last-known list (${age} old).`;
    case 'network':
      return `Couldn't refresh — network error. Using the last-known list (${age} old).`;
    case 'other':
      return `Couldn't refresh — unexpected error. Using the last-known list (${age} old).`;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/models/messages.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/models/messages.ts src/features/ai/models/messages.test.ts
git commit -m "feat(ai/models): messageForCatalogError — reason → human copy"
```

---

### Task 6: `refreshCatalog` — fetch + persist + stale-selection check

**Files:**
- Create: `src/features/ai/models/refreshCatalog.ts`
- Create: `src/features/ai/models/refreshCatalog.test.ts`

> **Strategy:** A single async function `refreshCatalog(deps)` that orchestrates: setLoading → fetchCatalog → success: setReady + persist + stale-selection-check; failure: branch on whether `state.kind === 'ready'` (cache present) → setRefreshFailureWithCache, else setError. Deps injected for testability.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/models/refreshCatalog.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/models/refreshCatalog.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `refreshCatalog`**

```ts
// src/features/ai/models/refreshCatalog.ts
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
  // Capture the previous ready snapshot (if any) so we can roll back on failure.
  const prevReady: Extract<CatalogState, { kind: 'ready' }> | null =
    store.state.kind === 'ready' ? store.state : null;

  store.setLoading();
  const result = await deps.fetchCatalog(deps.apiKey);

  if (!result.ok) {
    if (prevReady) {
      // Restore the cached list, then mark the failure flag.
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

  // Stale-selection check.
  const after = useModelCatalogStore.getState();
  const sel = after.selectedId;
  if (sel !== null && !result.models.find((m) => m.id === sel)) {
    after.setSelectedId(null);
    after.setStaleNotice(sel);
    await deps.deleteSelectedModelId();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/models/refreshCatalog.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/models/refreshCatalog.ts src/features/ai/models/refreshCatalog.test.ts
git commit -m "feat(ai/models): refreshCatalog — fetch + persist + stale check"
```

---

### Task 7: `ModelRow` component

**Files:**
- Create: `src/features/ai/models/ModelRow.tsx`
- Create: `src/features/ai/models/ModelRow.test.tsx`

> **Strategy:** Pure presentation. Renders the id; click → `onClick(model)`; `aria-pressed` = `isSelected`. Styles share a stylesheet with `ModelList` and `ModelsSection` (introduced in Task 9).

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/ai/models/ModelRow.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ModelRow } from './ModelRow';

afterEach(cleanup);

describe('ModelRow', () => {
  it('renders the model id', () => {
    render(<ModelRow model={{ id: 'gpt-4o' }} isSelected={false} onClick={() => undefined} />);
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
  });

  it('aria-pressed reflects isSelected', () => {
    render(<ModelRow model={{ id: 'gpt-4o' }} isSelected onClick={() => undefined} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking calls onClick with the model', () => {
    const onClick = vi.fn();
    render(<ModelRow model={{ id: 'gpt-4o' }} isSelected={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith({ id: 'gpt-4o' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/models/ModelRow.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ModelRow`**

```tsx
// src/features/ai/models/ModelRow.tsx
import type { Model } from '@/domain';

type Props = {
  readonly model: Model;
  readonly isSelected: boolean;
  readonly onClick: (model: Model) => void;
};

export function ModelRow({ model, isSelected, onClick }: Props) {
  return (
    <button
      type="button"
      className={
        isSelected ? 'model-row model-row--selected' : 'model-row'
      }
      aria-pressed={isSelected}
      onClick={() => {
        onClick(model);
      }}
    >
      <span
        className={
          isSelected ? 'model-row__radio model-row__radio--selected' : 'model-row__radio'
        }
        aria-hidden="true"
      />
      <span className="model-row__id">{model.id}</span>
    </button>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/models/ModelRow.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/models/ModelRow.tsx src/features/ai/models/ModelRow.test.tsx
git commit -m "feat(ai/models): ModelRow — selectable row with radio + id"
```

---

### Task 8: `ModelList` component

**Files:**
- Create: `src/features/ai/models/ModelList.tsx`
- Create: `src/features/ai/models/ModelList.test.tsx`

> **Strategy:** Pure. Sorts models alphabetically by id. Renders one `ModelRow` per model. `selectedId` may be null. `onSelect(model)` is the row callback.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/ai/models/ModelList.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ModelList } from './ModelList';

afterEach(cleanup);

describe('ModelList', () => {
  const models = [{ id: 'b-model' }, { id: 'a-model' }, { id: 'c-model' }];

  it('renders one row per model, sorted alphabetically by id', () => {
    render(<ModelList models={models} selectedId={null} onSelect={() => undefined} />);
    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['a-model', 'b-model', 'c-model']);
  });

  it('marks the selected row', () => {
    render(<ModelList models={models} selectedId="b-model" onSelect={() => undefined} />);
    const rows = screen.getAllByRole('button');
    const selected = rows.find((r) => r.getAttribute('aria-pressed') === 'true');
    expect(selected?.textContent).toBe('b-model');
  });

  it('clicking a row calls onSelect with that model', () => {
    const onSelect = vi.fn();
    render(<ModelList models={models} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'b-model' }));
    expect(onSelect).toHaveBeenCalledWith({ id: 'b-model' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/models/ModelList.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ModelList`**

```tsx
// src/features/ai/models/ModelList.tsx
import { useMemo } from 'react';
import type { Model } from '@/domain';
import { ModelRow } from './ModelRow';

type Props = {
  readonly models: readonly Model[];
  readonly selectedId: string | null;
  readonly onSelect: (model: Model) => void;
};

export function ModelList({ models, selectedId, onSelect }: Props) {
  const sorted = useMemo(() => [...models].sort((a, b) => a.id.localeCompare(b.id)), [models]);
  return (
    <div className="model-list" role="list">
      {sorted.map((model) => (
        <ModelRow
          key={model.id}
          model={model}
          isSelected={model.id === selectedId}
          onClick={onSelect}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/models/ModelList.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/models/ModelList.tsx src/features/ai/models/ModelList.test.tsx
git commit -m "feat(ai/models): ModelList — sorted rows of models"
```

---

### Task 9: `ModelsSection` — composition + state-driven rendering

**Files:**
- Create: `src/features/ai/models/ModelsSection.tsx`
- Create: `src/features/ai/models/models-section.css`
- Create: `src/features/ai/models/ModelsSection.test.tsx`

> **Strategy:** Top-level for the section. Subscribes to `useCatalogState`/`useSelectedModelId`/`useStaleNotice`/`useLastRefreshError`. Routes by state. Owns the Refresh callback (calls `refreshCatalog` with deps from props), the selection-click handler (persists), and the stale-notice dismissal.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/ai/models/ModelsSection.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ModelsSection } from './ModelsSection';
import { useModelCatalogStore } from './modelCatalogStore';
import type { SettingsRepository } from '@/storage';
import type { ModelsFetchResult } from '@/features/ai/key/nanogptApi';

afterEach(cleanup);

beforeEach(() => {
  useModelCatalogStore.getState().reset();
});

function fakeRepo(): SettingsRepository {
  return {
    getLibrarySort: vi.fn(() => Promise.resolve(undefined)),
    setLibrarySort: vi.fn(() => Promise.resolve()),
    getStoragePersistResult: vi.fn(() => Promise.resolve(undefined)),
    setStoragePersistResult: vi.fn(() => Promise.resolve()),
    getView: vi.fn(() => Promise.resolve(undefined)),
    setView: vi.fn(() => Promise.resolve()),
    getFocusModeHintShown: vi.fn(() => Promise.resolve(false)),
    setFocusModeHintShown: vi.fn(() => Promise.resolve()),
    getApiKeyBlob: vi.fn(() => Promise.resolve(undefined)),
    putApiKeyBlob: vi.fn(() => Promise.resolve()),
    deleteApiKeyBlob: vi.fn(() => Promise.resolve()),
    getModelCatalog: vi.fn(() => Promise.resolve(undefined)),
    putModelCatalog: vi.fn(() => Promise.resolve()),
    deleteModelCatalog: vi.fn(() => Promise.resolve()),
    getSelectedModelId: vi.fn(() => Promise.resolve(undefined)),
    putSelectedModelId: vi.fn(() => Promise.resolve()),
    deleteSelectedModelId: vi.fn(() => Promise.resolve()),
  };
}

function setup(opts: {
  readonly fetchResult?: ModelsFetchResult;
  readonly apiKey?: string;
}) {
  const repo = fakeRepo();
  const fetchCatalog = vi.fn(() =>
    Promise.resolve(opts.fetchResult ?? { ok: true as const, models: [] }),
  );
  return {
    repo,
    fetchCatalog,
    rendered: render(
      <ModelsSection
        settingsRepo={repo}
        fetchCatalog={fetchCatalog}
        getApiKey={() => opts.apiKey ?? 'sk-test'}
      />,
    ),
  };
}

describe('ModelsSection', () => {
  it('renders idle copy + enabled refresh in idle state', () => {
    setup({});
    expect(screen.getByText(/refresh to load available models/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeEnabled();
  });

  it('refresh-click triggers fetch and transitions to ready', async () => {
    const { fetchCatalog, repo } = setup({
      fetchResult: { ok: true, models: [{ id: 'm-1' }, { id: 'm-2' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(useModelCatalogStore.getState().state.kind).toBe('ready');
    });
    expect(fetchCatalog).toHaveBeenCalledWith('sk-test');
    expect(repo.putModelCatalog).toHaveBeenCalled();
    expect(screen.getByText('m-1')).toBeInTheDocument();
    expect(screen.getByText('m-2')).toBeInTheDocument();
  });

  it('shows empty state when ready with 0 models', () => {
    useModelCatalogStore.getState().setReady([], 1);
    setup({});
    expect(screen.getByText(/returned no models/i)).toBeInTheDocument();
  });

  it('shows full error state with no cache', () => {
    useModelCatalogStore.getState().setError('network');
    setup({});
    expect(screen.getByText(/couldn['’]t reach nanogpt/i)).toBeInTheDocument();
  });

  it('shows list + inline banner on cached error', () => {
    useModelCatalogStore.getState().setReady([{ id: 'cached-1' }], Date.now() - 60_000);
    useModelCatalogStore.getState().setRefreshFailureWithCache('network');
    setup({});
    expect(screen.getByText('cached-1')).toBeInTheDocument();
    expect(screen.getByText(/last-known list/i)).toBeInTheDocument();
  });

  it('selection-click persists + clears any stale notice', async () => {
    useModelCatalogStore.getState().setReady([{ id: 'a' }, { id: 'b' }], 1);
    useModelCatalogStore.getState().setStaleNotice('old-id');
    const { repo } = setup({});
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    await waitFor(() => {
      expect(useModelCatalogStore.getState().selectedId).toBe('a');
    });
    expect(useModelCatalogStore.getState().staleNotice).toBeNull();
    expect(repo.putSelectedModelId).toHaveBeenCalledWith('a');
  });

  it('refresh disables the button while loading', async () => {
    let resolveFetch!: (v: ModelsFetchResult) => void;
    const pending = new Promise<ModelsFetchResult>((r) => {
      resolveFetch = r;
    });
    const repo = fakeRepo();
    const fetchCatalog = vi.fn(() => pending);
    render(
      <ModelsSection
        settingsRepo={repo}
        fetchCatalog={fetchCatalog}
        getApiKey={() => 'sk-test'}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    });
    resolveFetch({ ok: true, models: [] });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeEnabled();
    });
  });

  it('stale notice can be dismissed', () => {
    useModelCatalogStore.getState().setReady([{ id: 'a' }], 1);
    useModelCatalogStore.getState().setStaleNotice('old');
    setup({});
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(useModelCatalogStore.getState().staleNotice).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/models/ModelsSection.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ModelsSection`**

```tsx
// src/features/ai/models/ModelsSection.tsx
import type { Model } from '@/domain';
import type { SettingsRepository } from '@/storage';
import type { ModelsFetchResult } from '@/features/ai/key/nanogptApi';
import {
  useModelCatalogStore,
  useCatalogState,
  useSelectedModelId,
  useStaleNotice,
  useLastRefreshError,
} from './modelCatalogStore';
import { ModelList } from './ModelList';
import { refreshCatalog } from './refreshCatalog';
import { messageForCatalogError } from './messages';
import './models-section.css';

type Props = {
  readonly settingsRepo: SettingsRepository;
  readonly fetchCatalog: (apiKey: string) => Promise<ModelsFetchResult>;
  readonly getApiKey: () => string | null;
};

function relativeTime(fetchedAt: number, now: number): string {
  const mins = Math.round((now - fetchedAt) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${String(mins)} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${String(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}

export function ModelsSection({ settingsRepo, fetchCatalog, getApiKey }: Props) {
  const state = useCatalogState();
  const selectedId = useSelectedModelId();
  const staleNotice = useStaleNotice();
  const lastRefreshError = useLastRefreshError();

  const onRefresh = (): void => {
    const apiKey = getApiKey();
    if (apiKey === null) return;
    void refreshCatalog({
      apiKey,
      fetchCatalog,
      putModelCatalog: (snap) => settingsRepo.putModelCatalog(snap),
      deleteSelectedModelId: () => settingsRepo.deleteSelectedModelId(),
    });
  };

  const onSelect = (model: Model): void => {
    useModelCatalogStore.getState().setSelectedId(model.id);
    useModelCatalogStore.getState().setStaleNotice(null);
    void settingsRepo.putSelectedModelId(model.id).catch((err: unknown) => {
      console.error('[models] putSelectedModelId failed', err);
    });
  };

  const refreshDisabled = state.kind === 'loading';

  return (
    <section className="models-section">
      <header className="models-section__header">
        <h2 className="models-section__title">Models</h2>
        <button
          type="button"
          className="models-section__refresh"
          onClick={onRefresh}
          disabled={refreshDisabled}
        >
          {state.kind === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {state.kind === 'ready' ? (
        <p className="models-section__updated">
          Updated {relativeTime(state.fetchedAt, Date.now())}
        </p>
      ) : null}

      {staleNotice !== null ? (
        <div className="models-section__stale-notice" role="status">
          <span>
            Your previous selection <code>{staleNotice}</code> is no longer available. Pick another
            model below.
          </span>
          <button
            type="button"
            className="models-section__stale-dismiss"
            aria-label="Dismiss"
            onClick={() => {
              useModelCatalogStore.getState().setStaleNotice(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {state.kind === 'ready' && lastRefreshError !== null ? (
        <p className="models-section__inline-error" role="alert">
          {messageForCatalogError(lastRefreshError, {
            hasCache: true,
            fetchedAt: state.fetchedAt,
            now: Date.now(),
          })}
        </p>
      ) : null}

      {state.kind === 'idle' ? (
        <p className="models-section__hint">Refresh to load available models.</p>
      ) : null}

      {state.kind === 'loading' ? (
        <p className="models-section__hint">Loading models…</p>
      ) : null}

      {state.kind === 'ready' && state.models.length > 0 ? (
        <ModelList models={state.models} selectedId={selectedId} onSelect={onSelect} />
      ) : null}

      {state.kind === 'ready' && state.models.length === 0 ? (
        <p className="models-section__hint">
          NanoGPT returned no models. Check your account or refresh later.
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <p className="models-section__error" role="alert">
          {messageForCatalogError(state.reason, { hasCache: false, now: Date.now() })}
        </p>
      ) : null}
    </section>
  );
}
```

```css
/* src/features/ai/models/models-section.css */
.models-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
.models-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.models-section__title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}
.models-section__refresh {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
}
.models-section__refresh:hover:not(:disabled) {
  background: var(--color-surface-hover, var(--color-surface));
}
.models-section__refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.models-section__updated,
.models-section__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.models-section__stale-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: 8px 10px;
  background: rgba(243, 156, 18, 0.08);
  border-left: 3px solid #f39c12;
  color: var(--color-text);
  font-size: var(--text-sm);
}
.models-section__stale-notice code {
  font-family: var(--font-mono, monospace);
}
.models-section__stale-dismiss {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 1.2em;
  line-height: 1;
  padding: 0 4px;
}
.models-section__inline-error {
  margin: 0;
  padding: 8px 10px;
  background: rgba(192, 57, 43, 0.08);
  border-left: 3px solid #c0392b;
  color: #c0392b;
  font-size: var(--text-sm);
}
.models-section__error {
  margin: 0;
  padding: 8px 10px;
  background: rgba(192, 57, 43, 0.08);
  border-left: 3px solid #c0392b;
  color: #c0392b;
  font-size: var(--text-sm);
}
.model-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-surface);
}
.model-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 14px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--color-text);
}
.model-row + .model-row {
  border-top: 1px solid var(--color-border-subtle, var(--color-border));
}
.model-row:hover {
  background: var(--color-surface-hover, var(--color-surface));
}
.model-row--selected {
  background: color-mix(in oklab, var(--color-text) 5%, transparent);
}
.model-row__radio {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-border);
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}
.model-row__radio--selected {
  border-color: var(--color-text);
}
.model-row__radio--selected::after {
  content: '';
  position: absolute;
  inset: 2.5px;
  background: var(--color-text);
  border-radius: 50%;
}
.model-row__id {
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/models/ModelsSection.test.tsx`
Expected: PASS — 8 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/models/ModelsSection.tsx src/features/ai/models/models-section.css src/features/ai/models/ModelsSection.test.tsx
git commit -m "feat(ai/models): ModelsSection — state-driven catalog UI"
```

---

### Task 10: Wire `ModelsSection` into `SettingsView` (visibility, auto-fetch, cascade)

**Files:**
- Modify: `src/features/ai/settings/SettingsView.tsx`
- Modify: `src/features/ai/settings/SettingsView.test.tsx`

> **Strategy:** Render `ModelsSection` below the API key section, only when `apiKeyStore.state.kind ∈ {'session','unlocked'}`. After successful key entry/unlock, fire-and-forget a refresh. On `handleRemove`, cascade-clear the catalog + selection.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/ai/settings/SettingsView.test.tsx`, before the closing `});` of the outer `describe`:

```tsx
  it('renders ModelsSection when key state is session', () => {
    useApiKeyStore.setState({ state: { kind: 'session', key: 'sk-x' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByRole('heading', { name: /models/i, level: 2 })).toBeInTheDocument();
  });

  it('renders ModelsSection when key state is unlocked', () => {
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByRole('heading', { name: /models/i, level: 2 })).toBeInTheDocument();
  });

  it('does NOT render ModelsSection when key state is none', () => {
    useApiKeyStore.setState({ state: { kind: 'none' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.queryByRole('heading', { name: /models/i, level: 2 })).toBeNull();
  });

  it('does NOT render ModelsSection when key state is locked', () => {
    useApiKeyStore.setState({ state: { kind: 'locked' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.queryByRole('heading', { name: /models/i, level: 2 })).toBeNull();
  });

  it('removing the key cascades to model catalog + selection', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    useModelCatalogStore.getState().setReady([{ id: 'a' }], 1);
    useModelCatalogStore.getState().setSelectedId('a');
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    await waitFor(() => {
      expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
    });
    expect(repo.deleteModelCatalog).toHaveBeenCalled();
    expect(repo.deleteSelectedModelId).toHaveBeenCalled();
    expect(useModelCatalogStore.getState().state).toEqual({ kind: 'idle' });
    expect(useModelCatalogStore.getState().selectedId).toBeNull();
    confirmSpy.mockRestore();
  });
```

Update the imports at the top of the test file:

```tsx
import { useModelCatalogStore } from '../models/modelCatalogStore';
```

Reset the catalog store in the existing `beforeEach`:

```tsx
beforeEach(() => {
  useApiKeyStore.setState({ state: { kind: 'none' } });
  useModelCatalogStore.getState().reset();
  global.fetch = vi.fn();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --run src/features/ai/settings/SettingsView.test.tsx`
Expected: FAIL — section not rendered, cascade not implemented.

- [ ] **Step 3: Edit `src/features/ai/settings/SettingsView.tsx`**

Add imports near the existing ones:

```ts
import { ModelsSection } from '../models/ModelsSection';
import { useModelCatalogStore } from '../models/modelCatalogStore';
import { fetchCatalog } from '../key/nanogptApi';
import { refreshCatalog } from '../models/refreshCatalog';
```

Inside the existing `handleEntrySubmit`, after `setSession(input.key)` (the success path) AND after `setUnlocked(input.key)` (in both the upgrade path and the regular save success), schedule a catalog refresh:

```ts
function scheduleCatalogRefresh(apiKey: string): void {
  void refreshCatalog({
    apiKey,
    fetchCatalog,
    putModelCatalog: (snap) => settingsRepo.putModelCatalog(snap),
    deleteSelectedModelId: () => settingsRepo.deleteSelectedModelId(),
  }).catch((err: unknown) => {
    console.error('[settings] refreshCatalog failed', err);
  });
}
```

Place that helper *inside* `SettingsView` so it captures `settingsRepo`. Then call `scheduleCatalogRefresh(state.key)` after `setUnlocked(state.key)` in the upgrade branch, and `scheduleCatalogRefresh(input.key)` after `setSession(input.key)` and `setUnlocked(input.key)` in the validate-and-save branches.

Inside `handleUnlockSubmit`, after `setUnlocked(key)`, call `scheduleCatalogRefresh(key)`.

Extend `handleRemove` to cascade:

```ts
const handleRemove = async (): Promise<void> => {
  if (!window.confirm("Remove API key from this device? You'll need to re-enter it next time.")) {
    return;
  }
  if (state.kind === 'unlocked' || state.kind === 'locked') {
    await settingsRepo.deleteApiKeyBlob();
  }
  await Promise.all([
    settingsRepo.deleteModelCatalog(),
    settingsRepo.deleteSelectedModelId(),
  ]);
  useModelCatalogStore.getState().reset();
  clear();
  setShowUpgradeForm(false);
};
```

Render `ModelsSection` below the existing API-key `<section>`. Replace the existing single `<section>` JSX so the API-key UI is in its own section, then add a sibling section for models. Find the existing `<section className="settings-view__section">` block and split it like this — keep the existing content, then add after the closing `</section>`:

```tsx
        {(state.kind === 'session' || state.kind === 'unlocked') ? (
          <ModelsSection
            settingsRepo={settingsRepo}
            fetchCatalog={fetchCatalog}
            getApiKey={() => {
              const s = useApiKeyStore.getState().state;
              if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
              return null;
            }}
          />
        ) : null}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/settings/SettingsView.test.tsx`
Expected: PASS — existing 10 + 5 new = 15 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/settings/SettingsView.tsx src/features/ai/settings/SettingsView.test.tsx
git commit -m "feat(ai/settings): SettingsView renders ModelsSection + cascades on key removal"
```

---

### Task 11: `App.tsx` — boot hydration of catalog snapshot + selectedId

**Files:**
- Modify: `src/app/App.tsx`

> **Strategy:** Extend the boot `Promise.all` from 4 reads to 6 (adds `getModelCatalog` + `getSelectedModelId`). Hydrate the store synchronously before `setBoot('ready')`. No fetch on boot.

- [ ] **Step 1: Edit `src/app/App.tsx`**

Add imports near the other ai imports:

```ts
import { useModelCatalogStore } from '@/features/ai/models/modelCatalogStore';
```

Find the boot `Promise.all` (currently 4 entries):

```ts
const [persistedView, prefs, hintShown, apiKeyBlob] = await Promise.all([
  wiring.settingsRepo.getView(),
  wiring.readerPreferencesRepo.get(),
  wiring.settingsRepo.getFocusModeHintShown(),
  wiring.settingsRepo.getApiKeyBlob(),
]);
if (apiKeyBlob) {
  useApiKeyStore.getState().markLocked();
}
```

Replace with:

```ts
const [persistedView, prefs, hintShown, apiKeyBlob, catalogSnapshot, selectedId] =
  await Promise.all([
    wiring.settingsRepo.getView(),
    wiring.readerPreferencesRepo.get(),
    wiring.settingsRepo.getFocusModeHintShown(),
    wiring.settingsRepo.getApiKeyBlob(),
    wiring.settingsRepo.getModelCatalog(),
    wiring.settingsRepo.getSelectedModelId(),
  ]);
if (apiKeyBlob) {
  useApiKeyStore.getState().markLocked();
}
if (catalogSnapshot) {
  useModelCatalogStore.getState().setReady(catalogSnapshot.models, catalogSnapshot.fetchedAt);
}
if (selectedId !== undefined) {
  useModelCatalogStore.getState().setSelectedId(selectedId);
}
```

- [ ] **Step 2: Type-check + build**

Run: `pnpm type-check && pnpm build`
Expected: clean.

- [ ] **Step 3: Run all unit tests**

Run: `pnpm test`
Expected: PASS — full suite.

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): boot hydrates model catalog + selection from IDB"
```

---

### Task 12: E2E — load and select models

**Files:**
- Create: `e2e/settings-models-load-and-select.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings/Models: enter key, list loads, select persists across reload', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'gpt-x' }, { id: 'claude-y' }, { id: 'gemini-z' }],
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-models');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();

  // Models section appears with all 3 models, sorted (claude-y, gemini-z, gpt-x).
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^claude-y$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^gemini-z$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^gpt-x$/ })).toBeVisible();

  // Click claude-y
  await page.getByRole('button', { name: /^claude-y$/ }).click();
  await expect(page.getByRole('button', { name: /^claude-y$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Reload — selection persists, catalog persists (note: session key vanishes;
  // section will hide because state goes back to 'none'. Use save-mode to preserve key.)
  // Re-enter for a save-mode test in the next spec; this one verifies catalog persistence
  // when the session key is gone:
  await page.reload();
  // Section is hidden after reload (no session key), but the catalog snapshot persists.
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-models-load-and-select.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-models-load-and-select.spec.ts
git commit -m "test(e2e): models load + select + section hides without key"
```

---

### Task 13: E2E — manual refresh updates the list

**Files:**
- Create: `e2e/settings-models-refresh.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings/Models: clicking Refresh re-fetches and updates the list', async ({ page }) => {
  let firstCallDone = false;
  await page.route('**/api/v1/models', async (route) => {
    if (!firstCallDone) {
      firstCallDone = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-refresh');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: /^a$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^c$/ })).toBeHidden();

  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByRole('button', { name: /^c$/ })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: /^d$/ })).toBeVisible();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-models-refresh.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-models-refresh.spec.ts
git commit -m "test(e2e): models refresh re-fetches catalog"
```

---

### Task 14: E2E — stale selection notice

**Files:**
- Create: `e2e/settings-models-stale-selection.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings/Models: selection that disappears on refresh shows stale notice', async ({
  page,
}) => {
  let secondFetch = false;
  await page.route('**/api/v1/models', async (route) => {
    if (!secondFetch) {
      secondFetch = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'keep-me' }, { id: 'will-vanish' }] }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'keep-me' }, { id: 'new-arrival' }] }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-stale');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: /^will-vanish$/ })).toBeVisible();

  await page.getByRole('button', { name: /^will-vanish$/ }).click();
  await expect(page.getByRole('button', { name: /^will-vanish$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: /^refresh$/i }).click();

  // Stale notice mentions the gone id; selection cleared; new-arrival visible.
  await expect(page.getByText(/will-vanish/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/no longer available/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^new-arrival$/ })).toBeVisible();

  // Pick another model → notice clears.
  await page.getByRole('button', { name: /^keep-me$/ }).click();
  await expect(page.getByText(/no longer available/i)).toBeHidden();
  await expect(page.getByRole('button', { name: /^keep-me$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-models-stale-selection.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-models-stale-selection.spec.ts
git commit -m "test(e2e): stale-selection notice + clears on re-pick"
```

---

### Task 15: E2E — refresh failure with cached snapshot

**Files:**
- Create: `e2e/settings-models-error.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings/Models: refresh failure with cache shows inline banner; recovery clears it', async ({
  page,
}) => {
  let call = 0;
  await page.route('**/api/v1/models', async (route) => {
    call += 1;
    if (call === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'cached-1' }, { id: 'cached-2' }] }),
      });
    } else if (call === 2) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'cached-1' }, { id: 'cached-2' }, { id: 'fresh' }] }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-cached-error');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: /^cached-1$/ })).toBeVisible();

  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByText(/last-known list/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: /^cached-1$/ })).toBeVisible();

  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByRole('button', { name: /^fresh$/ })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/last-known list/i)).toBeHidden();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-models-error.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-models-error.spec.ts
git commit -m "test(e2e): refresh failure with cache shows inline banner"
```

---

### Task 16: E2E — full error state without cache

**Files:**
- Create: `e2e/settings-models-error-no-cache.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings/Models: full error state with no cache; recovery loads list', async ({ page }) => {
  let call = 0;
  await page.route('**/api/v1/models', async (route) => {
    call += 1;
    if (call === 1) {
      // The validateKey call from 4.1 — must succeed so we get past key entry.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    } else if (call === 2) {
      // The auto-refresh after key entry — fail (network).
      await route.abort('failed');
    } else if (call === 3) {
      // Manual refresh — succeed.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'recovered' }] }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'recovered' }] }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-no-cache');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();

  // Auto-refresh fails — full error state visible.
  await expect(page.getByText(/couldn['’]t reach nanogpt/i)).toBeVisible({ timeout: 5_000 });

  // Manual refresh recovers.
  await page.getByRole('button', { name: /^refresh$/i }).click();
  await expect(page.getByRole('button', { name: /^recovered$/ })).toBeVisible({ timeout: 5_000 });
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-models-error-no-cache.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-models-error-no-cache.spec.ts
git commit -m "test(e2e): full error state with no cache + manual recovery"
```

---

### Task 17: E2E — cascade on key removal

**Files:**
- Create: `e2e/settings-models-cascade-on-key-remove.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings/Models: removing the API key cascades to catalog + selection', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'm-1' }, { id: 'm-2' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-cascade');
  await page.getByRole('button', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('cascade-pp');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });

  await expect(page.getByRole('button', { name: /^m-1$/ })).toBeVisible();
  await page.getByRole('button', { name: /^m-1$/ }).click();
  await expect(page.getByRole('button', { name: /^m-1$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Reload — boot hydrates catalog + selection + locked key state.
  await page.reload();
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeVisible({ timeout: 8_000 });
  // Models section is hidden in 'locked' state.
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();

  // Unlock — section reappears with selection still highlighted.
  await page.getByLabel(/^passphrase$/i).fill('cascade-pp');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: /^m-1$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Remove key with confirmation.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /^remove$/i }).click();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
  // Section is hidden after removal.
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();

  // Reload — catalog/selection are gone (no leftover).
  await page.reload();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-models-cascade-on-key-remove.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-models-cascade-on-key-remove.spec.ts
git commit -m "test(e2e): catalog + selection cascade on API key remove"
```

---

### Task 18: E2E — section hidden in locked state, returns on unlock

**Files:**
- Create: `e2e/settings-models-hidden-when-locked.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings/Models: hidden when key is locked; reappears on unlock', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'mm-1' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-locked');
  await page.getByRole('button', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('lock-pp');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeVisible();

  // Reload → locked → no section.
  await page.reload();
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeHidden();

  // Unlock → section returns.
  await page.getByLabel(/^passphrase$/i).fill('lock-pp');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByRole('heading', { name: /^models$/i, level: 2 })).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.getByRole('button', { name: /^mm-1$/ })).toBeVisible();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-models-hidden-when-locked.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-models-hidden-when-locked.spec.ts
git commit -m "test(e2e): models section hidden in locked state, returns on unlock"
```

---

### Task 19: Documentation — architecture decision log + roadmap status

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Append a Phase 4.2 entry to the architecture decision history**

Open `docs/02-system-architecture.md`, find the existing decision-history section, and append directly after the `## Decision history` heading (before the existing `### 2026-05-04 — Phase 4.1 …` entry):

```markdown
### 2026-05-04 — Phase 4.2: Model catalog

- **Surface:** New "Models" section in the existing Settings page, below "API key". Visible only when `apiKeyStore.state.kind ∈ {'session','unlocked'}`. Hidden in `'none'` and `'locked'`.
- **State model:** New Zustand `modelCatalogStore` with discriminated-union `state` (`'idle' | 'loading' | 'ready' | 'error'`) plus standalone `selectedId`, `staleNotice`, and `lastRefreshError`. Mirrors `apiKeyStore`'s pattern.
- **Persistence:** Two new `SettingsRecord` variants: `'modelCatalog'` (snapshot of `{models, fetchedAt}`) and `'selectedModelId'` (the chosen id). Independent update cadences; no DB migration.
- **Fetch trigger:** Piggybacks on existing 4.1 key flows (after `validateKey` success and `decryptKey` success). Manual Refresh button in the section header. Boot does NOT auto-fetch — explicit user action only (no hidden uploads).
- **Stale-selection:** A successful refresh that returns a catalog *not* containing the persisted selection drops the selection and shows a one-line notice "Your previous selection `<id>` is no longer available."
- **Refresh failure with cache:** Keeps the cached list visible and adds an inline banner. Failure with no cache → full error state. Recovery on next successful refresh.
- **Cascade:** Removing the API key wipes the catalog snapshot + selection from IDB and resets the in-memory store.
- **`nanogptApi`:** Promoted the `validateKey` body to a private `getModels`; `validateKey` and `fetchCatalog` are semantic aliases over the same call.
- **Out of scope (deferred):** Fast/Balanced/Deep presets, per-book overrides, provider/context-length/pricing metadata, search filter, auto-selection.
```

- [ ] **Step 2: Update the roadmap status**

Open `docs/04-implementation-roadmap.md` and update the `## Status` block (currently ends at "Phase 4.1 — complete"):

```markdown
## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (2026-05-03)
- Phase 2 — complete (2026-05-03)
- Phase 3 — complete (2026-05-04)
- Phase 4.1 — complete (2026-05-04)
- Phase 4.2 — complete (2026-05-04)
```

- [ ] **Step 3: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: Phase 4.2 architecture decision + roadmap status"
```

---

### Task 20: Final verification + open PR

**Files:**
- No new files. Verification + PR.

- [ ] **Step 1: Full quality gate**

Run: `pnpm check`
Expected: PASS — formatter + type-check + lint + 384+ unit tests + build.

If anything fails: fix the cause, atomic commit (`fix(<area>): <what>`), re-run.

- [ ] **Step 2: Full Playwright suite**

Run: `pnpm exec playwright test`
Expected: PASS — entire suite, including 7 new Phase 4.2 specs.

If a pre-existing test fails (not one of the 7 new specs), re-run that spec in isolation; if reproducible, investigate before opening the PR.

- [ ] **Step 3: Manual smoke (~5 minutes)**

```bash
pnpm dev
```

Walk through on desktop (1280×800):

1. **No key → no Models section.** Open Settings; verify only the API key form is visible.
2. **Session entry triggers auto-fetch.** Paste a real NanoGPT key (or skip if you don't have one and rely on the E2E coverage); verify the Models section appears and populates.
3. **Selection.** Click a model row; verify it highlights. Reload (session-mode key disappears, so the section hides; catalog persists in IDB but isn't visible until next key entry).
4. **Save mode + reload + locked.** Re-enter the key; switch to "Save on this device"; enter a passphrase; submit. Verify catalog re-loads. Reload — verify the Models section is hidden (locked state). Unlock — verify it returns with selection highlighted.
5. **Refresh.** Click Refresh. Verify "Updated just now" / "Updated N min ago" updates.
6. **Stale-selection.** (Hard to test manually without controlling NanoGPT's response — covered by E2E.)
7. **Remove cascade.** Remove the key with confirmation. Reload → catalog is gone (next key entry will refetch).

Mobile (390×844):

8. Repeat 1, 2, 3, 5. Verify rows are tappable; refresh works.

If anything looks wrong, fix and re-test before opening the PR.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin phase-4-2-model-catalog

gh pr create --title "feat: Phase 4.2 — model catalog" --body "$(cat <<'EOF'
## Summary
- New "Models" section in Settings: lists `/v1/models` from NanoGPT as selectable rows. Visible only when the key is `'session'` or `'unlocked'`.
- Two new `SettingsRecord` variants: `'modelCatalog'` (snapshot + `fetchedAt`) and `'selectedModelId'`. New Zustand `modelCatalogStore` mirroring `apiKeyStore`'s pattern.
- Auto-fetch piggybacks on existing 4.1 key flows (after `validateKey` and `decryptKey` succeed). Manual Refresh button. Boot does NOT auto-fetch — hydrates the cached snapshot synchronously.
- Stale-selection notice when a saved selection vanishes from the latest catalog. Refresh failure with cache shows inline banner; without cache shows full error state.
- Removing the API key cascades to wipe catalog + selection.

## Test Plan
- [x] `pnpm check` clean (format + type-check + lint + unit + build)
- [x] Playwright suite green; seven new Phase 4.2 E2E specs cover: load+select, refresh, stale-selection, cached error, no-cache error, cascade-on-remove, hidden-when-locked
- [ ] Manual smoke on desktop and mobile: empty/loading/ready/error states, refresh, selection persistence, locked/unlocked transitions, removal cascade
- [x] Architecture decision history + roadmap status updated

## Out of scope
- Fast / Balanced / Deep presets (4.3 or later)
- Per-book model overrides (4.3 or later)
- Provider / context-length / pricing metadata in rows
- Search/filter input on the model list
- Auto-selection on first catalog load
EOF
)"
```

- [ ] **Step 5: Capture the PR URL**

`gh pr create` prints the URL. Save it for the user. Done.

---

## Self-Review Checklist

After writing this plan, run through the writing-plans skill's three-point self-review:

### 1. Spec coverage

| Spec section | Task(s) covering it |
|---|---|
| §4.1 `Model` domain type | Task 2 |
| §4.2 `SettingsRecord` variants | Task 1 |
| §4.3 No DB migration | implicit (Task 1 doesn't bump `CURRENT_DB_VERSION`) |
| §4.4 Validators | Task 1 |
| §4.5 Repo extensions | Task 1 |
| §4.6 `modelCatalogStore` | Task 4 |
| §4.7 `nanogptApi.fetchCatalog` | Task 3 |
| §4.8 Cascade on key removal | Task 10 (`SettingsView.handleRemove` extension) |
| §5.1 ModelsSection placement | Task 10 (visibility wiring) + Task 9 (component) |
| §5.2 States table | Task 9 (rendering) + Task 4 (`setRefreshFailureWithCache`) + Task 6 (refresh logic) |
| §5.3 Refresh button behavior | Task 9 (UI) + Task 6 (logic) |
| §5.4 Auto-fetch on key flows | Task 10 (`scheduleCatalogRefresh` helper) |
| §5.5 Selection click | Task 9 (`onSelect` handler) |
| §5.6 Boot hydration | Task 11 |
| §6.1–6.5 Data flow | Task 6 (refreshCatalog), Task 9 (UI wiring) |
| §6.4 `messageForCatalogError` | Task 5 |
| §6.5 Removal cascade | Task 10 |
| §6.7 State invariants | unit-tested across Tasks 4, 6, 9, 10 |
| §7.1 Unit tests | Each implementation task has matching test code from §7.1 |
| §7.2 E2E tests | Tasks 12–18 (one task per spec) |
| §11 Acceptance criteria 1–15 | Task 20 (`pnpm check` + Playwright + manual smoke) |

No gaps.

### 2. Placeholder scan

- No "TBD" / "TODO" / "implement later".
- All test code is complete and runnable.
- Every step that changes code shows the actual code.
- Cross-references reference earlier tasks only; no forward dangling.

### 3. Type consistency

- `Model` — `{id: string}`. Used identically in store, list, row, refresh, messages.
- `CatalogState` — discriminated union with `'idle' | 'loading' | 'ready' | 'error'`. Used in store, ModelsSection, refresh.
- `RefreshErrorReason` — `'invalid-key' | 'network' | 'other'`. Same in store, messages, refresh.
- `ModelCatalogSnapshot` — `{models, fetchedAt}`. Same in storage, store hydration, refresh.
- `useApiKeyStore.state.kind` — `'none' | 'session' | 'unlocked' | 'locked'`. Used in SettingsView visibility check (Task 10) — matches 4.1's invariants.
- `setRefreshFailureWithCache` — defined Task 4, called Task 6, observed in Task 9 tests.
- `useLastRefreshError` selector — exported Task 4, consumed Task 9.
- `getApiKey` prop on ModelsSection — function returning `string | null` — consistent across Tasks 9 and 10.

No type drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-phase-4-2-model-catalog.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
