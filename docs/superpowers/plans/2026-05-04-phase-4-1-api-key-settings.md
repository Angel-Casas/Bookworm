# Phase 4.1 — API Key Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the API key settings UI: a new `'settings'` `AppView` accessible from the library chrome, with a form that takes a NanoGPT API key, validates it against `/v1/models`, and stores it either in-memory (session) or encrypted on-device (WebCrypto PBKDF2 + AES-GCM, passphrase-protected). Cold-start unlock prompts for the passphrase. Removal wipes both surfaces.

**Architecture:** Additive `AppView` extension + new `SettingsRecord` variant for the encrypted blob (no DB migration). Three new modules under `src/features/ai/key/`: `apiKeyStore` (Zustand state machine), `apiKeyCrypto` (WebCrypto helpers), `nanogptApi` (validation fetch). UI lives at `src/features/ai/settings/SettingsView.tsx`, composed of `ApiKeyForm` + `UnlockForm` + `ApiKeyStatusCard`. Library chrome gains a Settings icon. Boot extends `Promise.all` with a fourth IDB read; if a blob exists, store transitions to `'locked'` before first paint.

**Tech Stack:** TypeScript strict, React 19, Zustand 5, WebCrypto (`crypto.subtle.deriveKey` + AES-GCM), `idb` (existing), Vitest + happy-dom (unit), Playwright (E2E).

**Reference:** Spec at `docs/superpowers/specs/2026-05-04-phase-4-1-api-key-settings-design.md`.

---

## Task ordering

Storage extensions first (everything else depends on the AppView union + repo). Then non-UI plumbing (view helpers, useAppView, store, crypto, validation fetch, icons). Then UI components leaf-up (form, unlock, status card, chrome, view). Then library-chrome button, App.tsx wiring (third-to-last because it ties everything together), E2E specs, docs, final verification + PR.

---

### Task 1: Storage — `AppView` + `ApiKeyBlob` + `SettingsRecord` + validators

**Files:**
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/repositories/settings.ts`
- Modify: `src/storage/repositories/settings.test.ts`
- Modify: `src/storage/index.ts`

> **Strategy:** Extend `AppView` with `'settings'`. Add `apiKey` variant to `SettingsRecord`. Add three new methods to `SettingsRepository` for round-tripping the encrypted blob. Validator drops corrupt records.

- [ ] **Step 1: Write the failing tests**

Append to `src/storage/repositories/settings.test.ts`:

```ts
describe('settings view (settings kind)', () => {
  it('round-trips a settings view', async () => {
    const settings = createSettingsRepository(db);
    await settings.setView({ kind: 'settings' });
    expect(await settings.getView()).toEqual({ kind: 'settings' });
  });
});

describe('apiKey blob', () => {
  function makeBlob(): ApiKeyBlob {
    return {
      salt: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).buffer,
      iv: new Uint8Array([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]).buffer,
      ciphertext: new Uint8Array([100, 101, 102, 103, 104, 105]).buffer,
      iterations: 600_000,
    };
  }

  it('returns undefined when no blob is stored', async () => {
    const settings = createSettingsRepository(db);
    expect(await settings.getApiKeyBlob()).toBeUndefined();
  });

  it('round-trips a blob', async () => {
    const settings = createSettingsRepository(db);
    const blob = makeBlob();
    await settings.putApiKeyBlob(blob);
    const round = await settings.getApiKeyBlob();
    expect(round).toBeDefined();
    expect(new Uint8Array(round!.salt)).toEqual(new Uint8Array(blob.salt));
    expect(new Uint8Array(round!.iv)).toEqual(new Uint8Array(blob.iv));
    expect(new Uint8Array(round!.ciphertext)).toEqual(new Uint8Array(blob.ciphertext));
    expect(round!.iterations).toBe(600_000);
  });

  it('putApiKeyBlob overwrites the existing record', async () => {
    const settings = createSettingsRepository(db);
    await settings.putApiKeyBlob(makeBlob());
    const replacement: ApiKeyBlob = {
      ...makeBlob(),
      ciphertext: new Uint8Array([200]).buffer,
    };
    await settings.putApiKeyBlob(replacement);
    const round = await settings.getApiKeyBlob();
    expect(new Uint8Array(round!.ciphertext)).toEqual(new Uint8Array([200]));
  });

  it('deleteApiKeyBlob removes the record', async () => {
    const settings = createSettingsRepository(db);
    await settings.putApiKeyBlob(makeBlob());
    await settings.deleteApiKeyBlob();
    expect(await settings.getApiKeyBlob()).toBeUndefined();
  });

  it('returns undefined for corrupt records (missing iv)', async () => {
    const settings = createSettingsRepository(db);
    await db.put('settings', {
      key: 'apiKey',
      value: { salt: new ArrayBuffer(8), ciphertext: new ArrayBuffer(8), iterations: 600_000 },
    } as never);
    expect(await settings.getApiKeyBlob()).toBeUndefined();
  });

  it('returns undefined for corrupt records (iterations not a number)', async () => {
    const settings = createSettingsRepository(db);
    await db.put('settings', {
      key: 'apiKey',
      value: {
        salt: new ArrayBuffer(8),
        iv: new ArrayBuffer(8),
        ciphertext: new ArrayBuffer(8),
        iterations: '600000',
      },
    } as never);
    expect(await settings.getApiKeyBlob()).toBeUndefined();
  });
});
```

At the top of the file, add `ApiKeyBlob` to the `@/storage` import line:

```ts
import { createSettingsRepository } from './settings';
import type { ApiKeyBlob } from '@/storage';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --run src/storage/repositories/settings.test.ts`
Expected: FAIL — `ApiKeyBlob` not exported, `getApiKeyBlob`/`putApiKeyBlob`/`deleteApiKeyBlob` not on `SettingsRepository`, settings-view kind rejected by `isValidView`.

- [ ] **Step 3: Edit `src/storage/db/schema.ts`**

Find the `AppView` union:

```ts
export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string }
  | { readonly kind: 'notebook'; readonly bookId: string };
```

Replace with:

```ts
export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string }
  | { readonly kind: 'notebook'; readonly bookId: string }
  | { readonly kind: 'settings' };
```

Find the `SettingsRecord` union:

```ts
export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' }
  | { readonly key: 'view'; readonly value: AppView }
  | { readonly key: 'focusModeHintShown'; readonly value: boolean };
```

Replace with:

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
    };
```

- [ ] **Step 4: Edit `src/storage/repositories/settings.ts`**

Replace the file:

```ts
import type { SortKey } from '@/domain';
import type { AppView } from '@/app/view';
import type { BookwormDB } from '../db/open';
import { SETTINGS_STORE, type SettingsRecord } from '../db/schema';

export type ApiKeyBlob = {
  readonly salt: ArrayBuffer;
  readonly iv: ArrayBuffer;
  readonly ciphertext: ArrayBuffer;
  readonly iterations: number;
};

export type SettingsRepository = {
  getLibrarySort(): Promise<SortKey | undefined>;
  setLibrarySort(key: SortKey): Promise<void>;
  getStoragePersistResult(): Promise<'granted' | 'denied' | undefined>;
  setStoragePersistResult(value: 'granted' | 'denied'): Promise<void>;
  getView(): Promise<AppView | undefined>;
  setView(view: AppView): Promise<void>;
  getFocusModeHintShown(): Promise<boolean>;
  setFocusModeHintShown(shown: boolean): Promise<void>;
  getApiKeyBlob(): Promise<ApiKeyBlob | undefined>;
  putApiKeyBlob(blob: ApiKeyBlob): Promise<void>;
  deleteApiKeyBlob(): Promise<void>;
};

function isValidView(v: unknown): v is AppView {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as { kind?: unknown; bookId?: unknown };
  if (x.kind === 'library' || x.kind === 'settings') return true;
  if (
    (x.kind === 'reader' || x.kind === 'notebook') &&
    typeof x.bookId === 'string' &&
    x.bookId.length > 0
  ) {
    return true;
  }
  return false;
}

function isValidApiKeyValue(v: unknown): v is ApiKeyBlob {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;
  return (
    x.salt instanceof ArrayBuffer &&
    x.iv instanceof ArrayBuffer &&
    x.ciphertext instanceof ArrayBuffer &&
    typeof x.iterations === 'number' &&
    x.iterations > 0
  );
}

const VALID_SORT_KEYS: ReadonlySet<SortKey> = new Set([
  'recently-opened',
  'recently-added',
  'title',
  'author',
]);

export function createSettingsRepository(db: BookwormDB): SettingsRepository {
  async function get<T extends SettingsRecord>(key: T['key']): Promise<T | undefined> {
    return (await db.get(SETTINGS_STORE, key)) as T | undefined;
  }

  async function put(record: SettingsRecord): Promise<void> {
    await db.put(SETTINGS_STORE, record);
  }

  return {
    async getLibrarySort() {
      const rec = await get<Extract<SettingsRecord, { key: 'librarySort' }>>('librarySort');
      const value = rec?.value as SortKey | undefined;
      return value && VALID_SORT_KEYS.has(value) ? value : undefined;
    },
    async setLibrarySort(key) {
      await put({ key: 'librarySort', value: key });
    },
    async getStoragePersistResult() {
      const rec =
        await get<Extract<SettingsRecord, { key: 'storagePersistResult' }>>('storagePersistResult');
      return rec?.value;
    },
    async setStoragePersistResult(value) {
      await put({ key: 'storagePersistResult', value });
    },
    async getView() {
      const rec = await get<Extract<SettingsRecord, { key: 'view' }>>('view');
      if (!rec) return undefined;
      return isValidView(rec.value) ? rec.value : undefined;
    },
    async setView(view) {
      await put({ key: 'view', value: view });
    },
    async getFocusModeHintShown() {
      const rec = await get<Extract<SettingsRecord, { key: 'focusModeHintShown' }>>(
        'focusModeHintShown',
      );
      return typeof rec?.value === 'boolean' ? rec.value : false;
    },
    async setFocusModeHintShown(shown) {
      await put({ key: 'focusModeHintShown', value: shown });
    },
    async getApiKeyBlob() {
      const rec = await get<Extract<SettingsRecord, { key: 'apiKey' }>>('apiKey');
      if (!rec) return undefined;
      return isValidApiKeyValue(rec.value) ? rec.value : undefined;
    },
    async putApiKeyBlob(blob) {
      await put({ key: 'apiKey', value: blob });
    },
    async deleteApiKeyBlob() {
      await db.delete(SETTINGS_STORE, 'apiKey');
    },
  };
}
```

- [ ] **Step 5: Edit `src/storage/index.ts`**

Find:

```ts
export {
  createSettingsRepository,
  type SettingsRepository,
} from './repositories/settings';
```

Replace with:

```ts
export {
  createSettingsRepository,
  type SettingsRepository,
  type ApiKeyBlob,
} from './repositories/settings';
```

- [ ] **Step 6: Run settings tests**

Run: `pnpm test --run src/storage/repositories/settings.test.ts`
Expected: PASS — all existing + 7 new tests.

- [ ] **Step 7: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/storage/db/schema.ts src/storage/repositories/settings.ts src/storage/repositories/settings.test.ts src/storage/index.ts
git commit -m "feat(storage): AppView gains 'settings' kind; ApiKeyBlob CRUD on SettingsRepository"
```

---

### Task 2: `app/view.ts` — `settingsView` helper + tests

**Files:**
- Modify: `src/app/view.ts`
- Modify: `src/app/view.test.ts`

> **Strategy:** Mirror `notebookView`. Update the exhaustive-narrowing test.

- [ ] **Step 1: Edit `src/app/view.test.ts`**

Replace the file contents:

```ts
import { describe, it, expect } from 'vitest';
import {
  LIBRARY_VIEW,
  readerView,
  notebookView,
  settingsView,
  type AppView,
} from './view';

describe('view helpers', () => {
  it('LIBRARY_VIEW is a stable singleton-shape', () => {
    expect(LIBRARY_VIEW).toEqual({ kind: 'library' });
  });

  it('readerView builds a reader AppView', () => {
    expect(readerView('b1')).toEqual({ kind: 'reader', bookId: 'b1' });
  });

  it('notebookView builds a notebook AppView', () => {
    expect(notebookView('b1')).toEqual({ kind: 'notebook', bookId: 'b1' });
  });

  it('settingsView builds a settings AppView', () => {
    expect(settingsView()).toEqual({ kind: 'settings' });
  });

  it('AppView narrowing is exhaustive', () => {
    function describeView(view: AppView): string {
      switch (view.kind) {
        case 'library':
          return 'library';
        case 'reader':
          return `reader:${view.bookId}`;
        case 'notebook':
          return `notebook:${view.bookId}`;
        case 'settings':
          return 'settings';
      }
    }
    expect(describeView(LIBRARY_VIEW)).toBe('library');
    expect(describeView(readerView('b1'))).toBe('reader:b1');
    expect(describeView(notebookView('b1'))).toBe('notebook:b1');
    expect(describeView(settingsView())).toBe('settings');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/app/view.test.ts`
Expected: FAIL — `settingsView` not exported.

- [ ] **Step 3: Edit `src/app/view.ts`**

Append after `notebookView`:

```ts
export const SETTINGS_VIEW: AppView = { kind: 'settings' };

export function settingsView(): AppView {
  return SETTINGS_VIEW;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/app/view.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/view.ts src/app/view.test.ts
git commit -m "feat(app): settingsView helper + AppView exhaustive narrowing"
```

---

### Task 3: `useAppView` — `goSettings()`

**Files:**
- Modify: `src/app/useAppView.ts`
- Modify: `src/app/useAppView.test.ts`

> **Strategy:** One new method. The existing book-deletion guard already covers reader+notebook; settings has no bookId so no guard needed.

- [ ] **Step 1: Append to `src/app/useAppView.test.ts`**

Insert before the closing `});` of the outermost `describe`:

```ts
  describe('settings', () => {
    it('goSettings sets view to {kind:"settings"}', () => {
      const settingsRepo = fakeSettingsRepo();
      const libraryStore = fakeLibraryStore([sampleBook('book-1')]);
      const { result } = renderHook(() =>
        useAppView({ settingsRepo, libraryStore, initial: LIBRARY_VIEW }),
      );
      act(() => {
        result.current.goSettings();
      });
      expect(result.current.current).toEqual({ kind: 'settings' });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/app/useAppView.test.ts`
Expected: FAIL — `goSettings` not on the handle.

- [ ] **Step 3: Edit `src/app/useAppView.ts`**

Add to the `AppViewHandle` type (alongside the other navigators):

```ts
export type AppViewHandle = {
  current: AppView;
  goLibrary: () => void;
  goReader: (book: Book) => void;
  goNotebook: (bookId: string) => void;
  goReaderAt: (bookId: string, anchor: LocationAnchor) => void;
  goSettings: () => void;
  consumePendingAnchor: () => LocationAnchor | undefined;
};
```

Add `settingsView` to the imports:

```ts
import {
  LIBRARY_VIEW,
  readerView,
  notebookView,
  settingsView,
  type AppView,
} from '@/app/view';
```

Add the callback inside `useAppView`, after `goReaderAt`:

```ts
  const goSettings = useCallback(() => {
    setView(settingsView());
  }, [setView]);
```

Add `goSettings` to the returned handle:

```ts
  return {
    current: view,
    goLibrary,
    goReader,
    goNotebook,
    goReaderAt,
    goSettings,
    consumePendingAnchor,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/app/useAppView.test.ts`
Expected: PASS — all existing + 1 new test.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/useAppView.ts src/app/useAppView.test.ts
git commit -m "feat(app): useAppView — goSettings()"
```

---

### Task 4: `apiKeyStore` — Zustand state

**Files:**
- Create: `src/features/ai/key/apiKeyStore.ts`
- Create: `src/features/ai/key/apiKeyStore.test.ts`

> **Strategy:** Discriminated-union state. `useApiKeyState` selector hook for React. `getCurrentApiKey()` synchronous accessor for non-React consumers (chat code in 4.3+).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/key/apiKeyStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useApiKeyStore,
  useApiKeyState,
  getCurrentApiKey,
} from './apiKeyStore';

beforeEach(() => {
  useApiKeyStore.setState({ state: { kind: 'none' } });
});

describe('apiKeyStore', () => {
  it('initial state is none', () => {
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
  });

  it('setSession transitions to session with key', () => {
    useApiKeyStore.getState().setSession('sk-1234');
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'session', key: 'sk-1234' });
  });

  it('setUnlocked transitions to unlocked with key', () => {
    useApiKeyStore.getState().setUnlocked('sk-5678');
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'unlocked', key: 'sk-5678' });
  });

  it('markLocked transitions to locked', () => {
    useApiKeyStore.getState().markLocked();
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'locked' });
  });

  it('clear transitions to none from any state', () => {
    useApiKeyStore.getState().setSession('x');
    useApiKeyStore.getState().clear();
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
    useApiKeyStore.getState().markLocked();
    useApiKeyStore.getState().clear();
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
  });

  it('getCurrentApiKey returns the key in session and unlocked', () => {
    expect(getCurrentApiKey()).toBeNull();
    useApiKeyStore.getState().setSession('a');
    expect(getCurrentApiKey()).toBe('a');
    useApiKeyStore.getState().setUnlocked('b');
    expect(getCurrentApiKey()).toBe('b');
  });

  it('getCurrentApiKey returns null in locked and none', () => {
    useApiKeyStore.getState().markLocked();
    expect(getCurrentApiKey()).toBeNull();
    useApiKeyStore.getState().clear();
    expect(getCurrentApiKey()).toBeNull();
  });

  it('useApiKeyState selector subscribes correctly', () => {
    const { result } = renderHook(() => useApiKeyState());
    expect(result.current).toEqual({ kind: 'none' });
    act(() => {
      useApiKeyStore.getState().setSession('s1');
    });
    expect(result.current).toEqual({ kind: 'session', key: 's1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/key/apiKeyStore.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the store**

```ts
// src/features/ai/key/apiKeyStore.ts
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

/**
 * Synchronous accessor for non-React consumers (e.g., chat fetch wrappers
 * in 4.3+). Returns the current key, or null if not available.
 */
export function getCurrentApiKey(): string | null {
  const s = useApiKeyStore.getState().state;
  if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/key/apiKeyStore.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/key/apiKeyStore.ts src/features/ai/key/apiKeyStore.test.ts
git commit -m "feat(ai/key): apiKeyStore — Zustand discriminated-union state"
```

---

### Task 5: `apiKeyCrypto` — WebCrypto encrypt/decrypt

**Files:**
- Create: `src/features/ai/key/apiKeyCrypto.ts`
- Create: `src/features/ai/key/apiKeyCrypto.test.ts`

> **Strategy:** Pure async functions. PBKDF2-SHA256 (600k) → AES-GCM. Salt + IV randomly generated per encryption. Decrypt throws on wrong passphrase or corrupted blob (callers handle as "wrong passphrase"). Tests verify round-trip + wrong-passphrase failure + nonce uniqueness.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/key/apiKeyCrypto.test.ts
import { describe, it, expect } from 'vitest';
import { encryptKey, decryptKey, PBKDF2_ITERATIONS } from './apiKeyCrypto';

describe('apiKeyCrypto', () => {
  it('encryptKey produces a non-trivial blob with correct iterations', async () => {
    const blob = await encryptKey('sk-secret-key', 'my-passphrase');
    expect(blob.iterations).toBe(PBKDF2_ITERATIONS);
    expect(blob.salt.byteLength).toBeGreaterThanOrEqual(16);
    expect(blob.iv.byteLength).toBe(12);
    expect(blob.ciphertext.byteLength).toBeGreaterThan(0);
  });

  it('encryptKey then decryptKey round-trips the original key', async () => {
    const original = 'sk-test-' + Math.random().toString(36).slice(2);
    const blob = await encryptKey(original, 'pp-1');
    const decrypted = await decryptKey(blob, 'pp-1');
    expect(decrypted).toBe(original);
  });

  it('decryptKey with wrong passphrase throws', async () => {
    const blob = await encryptKey('sk-test', 'right');
    await expect(decryptKey(blob, 'wrong')).rejects.toThrow();
  });

  it('decryptKey with corrupted ciphertext throws', async () => {
    const blob = await encryptKey('sk-test', 'pp');
    const ct = new Uint8Array(blob.ciphertext);
    ct[0] = ct[0] ^ 0xff; // flip a bit
    const corrupted = { ...blob, ciphertext: ct.buffer };
    await expect(decryptKey(corrupted, 'pp')).rejects.toThrow();
  });

  it('salt and IV are different on each encryption (no nonce reuse)', async () => {
    const blob1 = await encryptKey('sk-x', 'pp');
    const blob2 = await encryptKey('sk-x', 'pp');
    expect(new Uint8Array(blob1.salt)).not.toEqual(new Uint8Array(blob2.salt));
    expect(new Uint8Array(blob1.iv)).not.toEqual(new Uint8Array(blob2.iv));
    expect(new Uint8Array(blob1.ciphertext)).not.toEqual(new Uint8Array(blob2.ciphertext));
  });

  it('decrypts a blob encrypted with non-default iterations (forward-compat)', async () => {
    // Manual blob with a smaller iteration count to keep the test fast.
    const passphrase = 'pp';
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const baseKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      enc.encode('legacy-key'),
    );
    const blob = { salt: salt.buffer, iv: iv.buffer, ciphertext, iterations: 1000 };
    const decrypted = await decryptKey(blob, passphrase);
    expect(decrypted).toBe('legacy-key');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/key/apiKeyCrypto.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the crypto module**

```ts
// src/features/ai/key/apiKeyCrypto.ts
import type { ApiKeyBlob } from '@/storage';

const SALT_BYTES = 16;
const IV_BYTES = 12;
export const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const KEY_BITS = 256;

async function deriveKey(
  passphrase: string,
  salt: BufferSource,
  iterations: number,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    [usage],
  );
}

export async function encryptKey(apiKey: string, passphrase: string): Promise<ApiKeyBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(apiKey),
  );
  return {
    salt: salt.buffer,
    iv: iv.buffer,
    ciphertext,
    iterations: PBKDF2_ITERATIONS,
  };
}

/**
 * Decrypts the blob using the passphrase. Throws on wrong passphrase or
 * corrupted ciphertext (AES-GCM authentication failure manifests as a
 * DOMException). Callers handle the throw as "wrong passphrase."
 */
export async function decryptKey(blob: ApiKeyBlob, passphrase: string): Promise<string> {
  const aesKey = await deriveKey(passphrase, blob.salt, blob.iterations, 'decrypt');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.iv },
    aesKey,
    blob.ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
```

- [ ] **Step 4: Run crypto tests**

Run: `pnpm test --run src/features/ai/key/apiKeyCrypto.test.ts`
Expected: PASS — 6 tests. Note: the round-trip test does ~2× 600k PBKDF2 iterations, which takes ~1–3s in happy-dom depending on hardware. Acceptable.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/key/apiKeyCrypto.ts src/features/ai/key/apiKeyCrypto.test.ts
git commit -m "feat(ai/key): apiKeyCrypto — PBKDF2-SHA256 (600k) + AES-GCM"
```

---

### Task 6: `nanogptApi` — `validateKey`

**Files:**
- Create: `src/features/ai/key/nanogptApi.ts`
- Create: `src/features/ai/key/nanogptApi.test.ts`

> **Strategy:** Single GET to `/v1/models`. Discriminated-union result. Mock `global.fetch` with `vi.fn()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/key/nanogptApi.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateKey } from './nanogptApi';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('validateKey', () => {
  it('calls /v1/models with Authorization: Bearer …', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [{ id: 'model-a' }] }),
    );
    await validateKey('sk-test');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toMatch(/\/v1\/models$/);
    expect(call[1]?.headers.Authorization).toBe('Bearer sk-test');
  });

  it('200 with data array → ok:true with parsed models', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [{ id: 'gpt-4' }, { id: 'gpt-3.5' }] }),
    );
    const r = await validateKey('sk-test');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models).toEqual([{ id: 'gpt-4' }, { id: 'gpt-3.5' }]);
  });

  it('200 with malformed entries filters them out', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [{ id: 'm-1' }, { name: 'no-id' }, null, 'string'] }),
    );
    const r = await validateKey('sk-test');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models).toEqual([{ id: 'm-1' }]);
  });

  it('200 with no data array → ok:true with empty models', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({}),
    );
    const r = await validateKey('sk-test');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models).toEqual([]);
  });

  it('401 → ok:false reason invalid-key', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ error: 'unauthorized' }, 401),
    );
    const r = await validateKey('sk-bad');
    expect(r).toEqual({ ok: false, reason: 'invalid-key', status: 401 });
  });

  it('403 → ok:false reason invalid-key', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({}, 403),
    );
    const r = await validateKey('sk-bad');
    expect(r).toEqual({ ok: false, reason: 'invalid-key', status: 403 });
  });

  it('500 → ok:false reason other', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({}, 500),
    );
    const r = await validateKey('sk-test');
    expect(r).toEqual({ ok: false, reason: 'other', status: 500 });
  });

  it('network failure → ok:false reason network', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('failed to fetch'));
    const r = await validateKey('sk-test');
    expect(r).toEqual({ ok: false, reason: 'network' });
  });

  it('malformed JSON body → ok:false reason other', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('bad json')),
    } as unknown as Response);
    const r = await validateKey('sk-test');
    expect(r).toEqual({ ok: false, reason: 'other' });
  });

  it('passes AbortSignal through to fetch', async () => {
    const ac = new AbortController();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [] }),
    );
    await validateKey('sk-test', ac.signal);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1]?.signal).toBe(ac.signal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/key/nanogptApi.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the validation module**

```ts
// src/features/ai/key/nanogptApi.ts
const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export type ValidateKeyResult =
  | { readonly ok: true; readonly models: readonly { id: string }[] }
  | {
      readonly ok: false;
      readonly reason: 'invalid-key' | 'network' | 'other';
      readonly status?: number;
    };

type ModelsResponseBody = { readonly data?: readonly unknown[] };

export async function validateKey(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ValidateKeyResult> {
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
        typeof m === 'object' &&
        m !== null &&
        'id' in m &&
        typeof (m as { id: unknown }).id === 'string',
    )
    .map((m) => ({ id: m.id }));
  return { ok: true, models };
}
```

- [ ] **Step 4: Run validation tests**

Run: `pnpm test --run src/features/ai/key/nanogptApi.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/key/nanogptApi.ts src/features/ai/key/nanogptApi.test.ts
git commit -m "feat(ai/key): nanogptApi.validateKey — GET /v1/models with Bearer auth"
```

---

### Task 7: Icons — `SettingsIcon`, `EyeIcon`, `EyeOffIcon`

**Files:**
- Create: `src/shared/icons/SettingsIcon.tsx`
- Create: `src/shared/icons/EyeIcon.tsx`
- Create: `src/shared/icons/EyeOffIcon.tsx`
- Modify: `src/shared/icons/index.ts`
- Modify: `src/shared/icons/icons.test.tsx`

> **Strategy:** Three monochrome SVG components matching the existing pattern (`NotebookIcon`, `NoteIcon`, `ArrowLeftIcon`). 16px default, 1.5px stroke, `currentColor`.

- [ ] **Step 1: Append failing tests**

Append to `src/shared/icons/icons.test.tsx`, before the closing `});`:

```tsx
  it('SettingsIcon renders an svg', () => {
    const { container } = render(<SettingsIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('icon')).toBe(true);
  });

  it('EyeIcon renders an svg', () => {
    const { container } = render(<EyeIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('EyeOffIcon renders an svg', () => {
    const { container } = render(<EyeOffIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
```

Update the import line at the top:

```tsx
import {
  NotebookIcon,
  NoteIcon,
  ArrowLeftIcon,
  SettingsIcon,
  EyeIcon,
  EyeOffIcon,
} from './index';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/shared/icons/icons.test.tsx`
Expected: FAIL — three new icons don't exist.

- [ ] **Step 3: Create `src/shared/icons/SettingsIcon.tsx`**

```tsx
import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function SettingsIcon({ size = 16, className }: Props) {
  const cls = className ? `icon ${className}` : 'icon';
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.13 1.13M4.53 11.47L3.4 12.6M12.6 12.6l-1.13-1.13M4.53 4.53L3.4 3.4" />
    </svg>
  );
}
```

- [ ] **Step 4: Create `src/shared/icons/EyeIcon.tsx`**

```tsx
import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function EyeIcon({ size = 16, className }: Props) {
  const cls = className ? `icon ${className}` : 'icon';
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}
```

- [ ] **Step 5: Create `src/shared/icons/EyeOffIcon.tsx`**

```tsx
import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function EyeOffIcon({ size = 16, className }: Props) {
  const cls = className ? `icon ${className}` : 'icon';
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 2l12 12" />
      <path d="M6.5 6.5a2 2 0 0 0 2.83 2.83" />
      <path d="M3.5 5C2.5 6 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.04 0 1.97-.27 2.78-.7" />
      <path d="M5.4 3.6C6.18 3.34 7.05 3.2 8 3.2c4 0 6.5 4.8 6.5 4.8s-.6 1.18-1.74 2.34" />
    </svg>
  );
}
```

- [ ] **Step 6: Edit `src/shared/icons/index.ts`**

Replace the file:

```ts
export { NotebookIcon } from './NotebookIcon';
export { NoteIcon } from './NoteIcon';
export { ArrowLeftIcon } from './ArrowLeftIcon';
export { SettingsIcon } from './SettingsIcon';
export { EyeIcon } from './EyeIcon';
export { EyeOffIcon } from './EyeOffIcon';
```

- [ ] **Step 7: Run icon tests**

Run: `pnpm test --run src/shared/icons/icons.test.tsx`
Expected: PASS — all existing + 3 new tests.

- [ ] **Step 8: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/shared/icons/SettingsIcon.tsx src/shared/icons/EyeIcon.tsx src/shared/icons/EyeOffIcon.tsx src/shared/icons/index.ts src/shared/icons/icons.test.tsx
git commit -m "feat(icons): SettingsIcon + EyeIcon + EyeOffIcon"
```

---

### Task 8: `ApiKeyForm` component

**Files:**
- Create: `src/features/ai/key/ApiKeyForm.tsx`
- Create: `src/features/ai/key/api-key-form.css`
- Create: `src/features/ai/key/ApiKeyForm.test.tsx`

> **Strategy:** Pure presentation. Local state for inputs, mode toggle, error. Conditional passphrase field. Submit button label adapts to mode. Show-toggle on the key input only.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/ai/key/ApiKeyForm.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ApiKeyForm } from './ApiKeyForm';

afterEach(cleanup);

function setup(overrides: Partial<React.ComponentProps<typeof ApiKeyForm>> = {}) {
  const onSubmit = vi.fn(async () => ({ ok: true as const }));
  const onCancel = vi.fn();
  const props = {
    onSubmit: overrides.onSubmit ?? onSubmit,
    onCancel: overrides.onCancel ?? onCancel,
    ...(overrides.initialMode !== undefined && { initialMode: overrides.initialMode }),
    ...(overrides.initialKey !== undefined && { initialKey: overrides.initialKey }),
    ...(overrides.hideKeyField !== undefined && { hideKeyField: overrides.hideKeyField }),
  };
  return { ...props, ...render(<ApiKeyForm {...props} />) };
}

describe('ApiKeyForm', () => {
  it('renders masked key input + show toggle', () => {
    setup();
    const input = screen.getByLabelText(/NanoGPT API key/i);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /show key/i })).toBeInTheDocument();
  });

  it('show toggle flips input type to text', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /show key/i }));
    const input = screen.getByLabelText(/NanoGPT API key/i);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide key/i })).toBeInTheDocument();
  });

  it('mode segmented control toggles between session and save', () => {
    setup();
    expect(screen.queryByLabelText(/Passphrase/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    expect(screen.getByLabelText(/Passphrase/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Use this session/i }));
    expect(screen.queryByLabelText(/Passphrase/i)).toBeNull();
  });

  it('submit disabled until key is non-empty (session mode)', () => {
    setup();
    const submit = screen.getByRole('button', { name: /Use this session/i, expanded: false }) ??
      screen.getByRole('button', { name: /^Use this session$/i });
    // The label appears in two places (mode chip + submit). Filter to submit.
    const submitButton = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('type') === 'submit');
    expect(submitButton).toBeDefined();
    expect(submitButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-x' } });
    expect(submitButton).not.toBeDisabled();
  });

  it('submit disabled until passphrase is non-empty (save mode)', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-x' } });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Passphrase/i), { target: { value: 'pp' } });
    expect(submit).not.toBeDisabled();
  });

  it('submit calls onSubmit with the right shape (session)', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    setup({ onSubmit });
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: '  sk-test  ' },
    });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ mode: 'session', key: 'sk-test' });
    });
  });

  it('submit calls onSubmit with the right shape (save mode)', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText(/Passphrase/i), { target: { value: 'my-pp' } });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        mode: 'save',
        key: 'sk-test',
        passphrase: 'my-pp',
      });
    });
  });

  it('error message renders when onSubmit returns ok:false', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false as const, message: 'bad key' }));
    setup({ onSubmit });
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-bad' } });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText(/bad key/i)).toBeInTheDocument();
    });
  });

  it('hideKeyField renders without the key input (session→save upgrade path)', () => {
    setup({ hideKeyField: true, initialKey: 'sk-prefilled', initialMode: 'save' });
    expect(screen.queryByLabelText(/NanoGPT API key/i)).toBeNull();
    expect(screen.getByLabelText(/Passphrase/i)).toBeInTheDocument();
  });

  it('cancel triggers onCancel', () => {
    const onCancel = vi.fn();
    setup({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/key/ApiKeyForm.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ApiKeyForm`**

```tsx
// src/features/ai/key/ApiKeyForm.tsx
import { useState } from 'react';
import { EyeIcon, EyeOffIcon } from '@/shared/icons';
import './api-key-form.css';

export type Mode = 'session' | 'save';

export type SubmitInput =
  | { readonly mode: 'session'; readonly key: string }
  | { readonly mode: 'save'; readonly key: string; readonly passphrase: string };

export type SubmitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

type Props = {
  readonly onSubmit: (input: SubmitInput) => Promise<SubmitResult>;
  readonly onCancel?: () => void;
  readonly initialMode?: Mode;
  readonly initialKey?: string;
  readonly hideKeyField?: boolean;
};

export function ApiKeyForm({
  onSubmit,
  onCancel,
  initialMode = 'session',
  initialKey = '',
  hideKeyField = false,
}: Props) {
  const [key, setKey] = useState(initialKey);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [passphrase, setPassphrase] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedKey = (hideKeyField ? initialKey : key).trim();
  const submitDisabled =
    isSubmitting ||
    trimmedKey === '' ||
    (mode === 'save' && passphrase === '');

  const submitLabel = mode === 'session' ? 'Use this session' : 'Save key';

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (submitDisabled) return;
    setIsSubmitting(true);
    setError(null);
    const input: SubmitInput =
      mode === 'session'
        ? { mode: 'session', key: trimmedKey }
        : { mode: 'save', key: trimmedKey, passphrase };
    const result = await onSubmit(input);
    if (!result.ok) {
      setError(result.message);
      setIsSubmitting(false);
    }
    // On success, parent unmounts this form (driven by store).
  };

  return (
    <form className="api-key-form" onSubmit={handleSubmit}>
      {!hideKeyField ? (
        <div className="api-key-form__field">
          <label htmlFor="api-key-input" className="api-key-form__label">
            NanoGPT API key
          </label>
          <div className="api-key-form__input-row">
            <input
              id="api-key-input"
              type={showKey ? 'text' : 'password'}
              className="api-key-form__input"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="api-key-form__show-toggle"
              aria-label={showKey ? 'Hide key' : 'Show key'}
              onClick={() => {
                setShowKey((v) => !v);
              }}
              disabled={isSubmitting}
            >
              {showKey ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
      ) : null}

      <div className="api-key-form__field">
        <span className="api-key-form__label">Where to keep it</span>
        <div className="api-key-form__mode-toggle" role="group" aria-label="Storage mode">
          <button
            type="button"
            className={
              mode === 'session'
                ? 'api-key-form__mode api-key-form__mode--active'
                : 'api-key-form__mode'
            }
            aria-pressed={mode === 'session'}
            onClick={() => {
              setMode('session');
            }}
            disabled={isSubmitting}
          >
            Use this session
          </button>
          <button
            type="button"
            className={
              mode === 'save'
                ? 'api-key-form__mode api-key-form__mode--active'
                : 'api-key-form__mode'
            }
            aria-pressed={mode === 'save'}
            onClick={() => {
              setMode('save');
            }}
            disabled={isSubmitting}
          >
            Save on this device
          </button>
        </div>
        <p className="api-key-form__privacy">
          Your key stays on this device. <strong>Use this session</strong> keeps it in memory only —
          closing the tab forgets it. <strong>Save on this device</strong> encrypts it on disk with
          your passphrase, which we never store.
        </p>
      </div>

      {mode === 'save' ? (
        <div className="api-key-form__field">
          <label htmlFor="api-key-passphrase" className="api-key-form__label">
            Passphrase
          </label>
          <input
            id="api-key-passphrase"
            type="password"
            className="api-key-form__input"
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
            }}
            autoComplete="new-password"
            disabled={isSubmitting}
          />
          <p className="api-key-form__hint">
            Used to encrypt your key. We never store it — you'll re-enter it after each reload.
          </p>
        </div>
      ) : null}

      {error !== null ? (
        <p className="api-key-form__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="api-key-form__actions">
        {onCancel !== undefined ? (
          <button
            type="button"
            className="api-key-form__cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          className="api-key-form__submit"
          disabled={submitDisabled}
        >
          {isSubmitting ? 'Validating…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
```

```css
/* src/features/ai/key/api-key-form.css */
.api-key-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 480px;
}
.api-key-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.api-key-form__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}
.api-key-form__input-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
}
.api-key-form__input {
  flex: 1 1 auto;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  outline: none;
}
.api-key-form__input:focus {
  border-color: var(--color-text-muted);
}
.api-key-form__input:disabled {
  opacity: 0.6;
}
.api-key-form__show-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}
.api-key-form__show-toggle:hover:not(:disabled) {
  color: var(--color-text);
}
.api-key-form__mode-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  align-self: flex-start;
}
.api-key-form__mode {
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
}
.api-key-form__mode + .api-key-form__mode {
  border-left: 1px solid var(--color-border);
}
.api-key-form__mode--active {
  background: var(--color-text);
  color: var(--color-bg);
}
.api-key-form__privacy,
.api-key-form__hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  line-height: 1.4;
}
.api-key-form__error {
  margin: 0;
  padding: 8px 10px;
  background: rgba(192, 57, 43, 0.08);
  border-left: 3px solid #c0392b;
  color: #c0392b;
  font-size: var(--text-sm);
}
.api-key-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.api-key-form__cancel {
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
}
.api-key-form__cancel:hover:not(:disabled) {
  background: var(--color-surface-hover, var(--color-surface));
}
.api-key-form__submit {
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  background: var(--color-text);
  color: var(--color-bg);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.api-key-form__submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Run form tests**

Run: `pnpm test --run src/features/ai/key/ApiKeyForm.test.tsx`
Expected: PASS — 10 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/key/ApiKeyForm.tsx src/features/ai/key/api-key-form.css src/features/ai/key/ApiKeyForm.test.tsx
git commit -m "feat(ai/key): ApiKeyForm — masked input + mode toggle + conditional passphrase"
```

---

### Task 9: `UnlockForm` component

**Files:**
- Create: `src/features/ai/key/UnlockForm.tsx`
- Create: `src/features/ai/key/unlock-form.css`
- Create: `src/features/ai/key/UnlockForm.test.tsx`

> **Strategy:** Smaller cousin of ApiKeyForm. Passphrase input + Unlock + Remove buttons.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/ai/key/UnlockForm.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { UnlockForm } from './UnlockForm';

afterEach(cleanup);

describe('UnlockForm', () => {
  it('renders passphrase input + unlock + remove buttons', () => {
    render(<UnlockForm onSubmit={async () => ({ ok: true as const })} onRemove={() => undefined} />);
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^unlock$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove saved key/i })).toBeInTheDocument();
  });

  it('submit calls onSubmit with the passphrase', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    render(<UnlockForm onSubmit={onSubmit} onRemove={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'pp' } });
    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('pp');
    });
  });

  it('error renders on ok:false', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false as const, message: 'Wrong passphrase' }));
    render(<UnlockForm onSubmit={onSubmit} onRemove={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));
    await waitFor(() => {
      expect(screen.getByText(/wrong passphrase/i)).toBeInTheDocument();
    });
  });

  it('Remove triggers onRemove', () => {
    const onRemove = vi.fn();
    render(
      <UnlockForm onSubmit={async () => ({ ok: true as const })} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove saved key/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('submit disabled when passphrase is empty', () => {
    render(<UnlockForm onSubmit={async () => ({ ok: true as const })} onRemove={() => undefined} />);
    expect(screen.getByRole('button', { name: /^unlock$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'p' } });
    expect(screen.getByRole('button', { name: /^unlock$/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/key/UnlockForm.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/ai/key/UnlockForm.tsx
import { useState } from 'react';
import './unlock-form.css';

type Props = {
  readonly onSubmit: (passphrase: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  readonly onRemove: () => void;
};

export function UnlockForm({ onSubmit, onRemove }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (passphrase === '' || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const result = await onSubmit(passphrase);
    if (!result.ok) {
      setError(result.message);
      setIsSubmitting(false);
    }
  };

  return (
    <form className="unlock-form" onSubmit={handleSubmit}>
      <p className="unlock-form__intro">
        Your API key is saved on this device. Enter your passphrase to unlock it.
      </p>
      <div className="unlock-form__field">
        <label htmlFor="unlock-passphrase" className="unlock-form__label">
          Passphrase
        </label>
        <input
          id="unlock-passphrase"
          type="password"
          className="unlock-form__input"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
          }}
          autoComplete="current-password"
          disabled={isSubmitting}
        />
      </div>
      {error !== null ? (
        <p className="unlock-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="unlock-form__actions">
        <button
          type="button"
          className="unlock-form__remove"
          onClick={onRemove}
          disabled={isSubmitting}
        >
          Remove saved key
        </button>
        <button
          type="submit"
          className="unlock-form__submit"
          disabled={passphrase === '' || isSubmitting}
        >
          {isSubmitting ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
    </form>
  );
}
```

```css
/* src/features/ai/key/unlock-form.css */
.unlock-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 480px;
}
.unlock-form__intro {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.unlock-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.unlock-form__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}
.unlock-form__input {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  outline: none;
}
.unlock-form__input:focus {
  border-color: var(--color-text-muted);
}
.unlock-form__error {
  margin: 0;
  padding: 8px 10px;
  background: rgba(192, 57, 43, 0.08);
  border-left: 3px solid #c0392b;
  color: #c0392b;
  font-size: var(--text-sm);
}
.unlock-form__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
.unlock-form__remove {
  padding: 8px 14px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
}
.unlock-form__remove:hover:not(:disabled) {
  color: #c0392b;
}
.unlock-form__submit {
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  background: var(--color-text);
  color: var(--color-bg);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.unlock-form__submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Run unlock tests**

Run: `pnpm test --run src/features/ai/key/UnlockForm.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/key/UnlockForm.tsx src/features/ai/key/unlock-form.css src/features/ai/key/UnlockForm.test.tsx
git commit -m "feat(ai/key): UnlockForm — passphrase entry + remove escape hatch"
```

---

### Task 10: `SettingsChrome` component

**Files:**
- Create: `src/features/ai/settings/SettingsChrome.tsx`
- Create: `src/features/ai/settings/settings-chrome.css`
- Create: `src/features/ai/settings/SettingsChrome.test.tsx`

> **Strategy:** Mirror NotebookChrome. Back button + "Settings" title.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/ai/settings/SettingsChrome.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SettingsChrome } from './SettingsChrome';

afterEach(cleanup);

describe('SettingsChrome', () => {
  it('renders back button + Settings title', () => {
    render(<SettingsChrome onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: /back to library/i })).toBeInTheDocument();
    expect(screen.getByText(/^Settings$/)).toBeInTheDocument();
  });

  it('calls onClose when back is clicked', () => {
    const onClose = vi.fn();
    render(<SettingsChrome onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /back to library/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/settings/SettingsChrome.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/ai/settings/SettingsChrome.tsx
import { ArrowLeftIcon } from '@/shared/icons';
import './settings-chrome.css';

type Props = {
  readonly onClose: () => void;
};

export function SettingsChrome({ onClose }: Props) {
  return (
    <header className="settings-chrome">
      <button
        type="button"
        className="settings-chrome__back"
        onClick={onClose}
        aria-label="Back to library"
      >
        <ArrowLeftIcon />
        <span>Library</span>
      </button>
      <div className="settings-chrome__title" aria-live="polite">
        Settings
      </div>
    </header>
  );
}
```

```css
/* src/features/ai/settings/settings-chrome.css */
.settings-chrome {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg);
}
.settings-chrome__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
}
.settings-chrome__back:hover {
  background: var(--color-surface-hover, var(--color-surface));
}
.settings-chrome__title {
  flex: 1 1 auto;
  font-weight: 600;
  color: var(--color-text);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/features/ai/settings/SettingsChrome.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/settings/SettingsChrome.tsx src/features/ai/settings/settings-chrome.css src/features/ai/settings/SettingsChrome.test.tsx
git commit -m "feat(ai/settings): SettingsChrome — back button + title"
```

---

### Task 11: `SettingsView` — composition + state-driven rendering

**Files:**
- Create: `src/features/ai/settings/SettingsView.tsx`
- Create: `src/features/ai/settings/settings-view.css`
- Create: `src/features/ai/settings/SettingsView.test.tsx`

> **Strategy:** Composes everything. Reads `apiKeyStore` state. Renders ApiKeyForm / UnlockForm / status card based on state. Wires submit handlers to validateKey + encryptKey + repo + store. Handles the session→save upgrade local state.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/ai/settings/SettingsView.test.tsx
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { useApiKeyStore } from '../key/apiKeyStore';
import type { SettingsRepository, ApiKeyBlob } from '@/storage';

afterEach(cleanup);

const originalFetch = global.fetch;

beforeEach(() => {
  useApiKeyStore.setState({ state: { kind: 'none' } });
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function fakeRepo(overrides: Partial<SettingsRepository> = {}): SettingsRepository {
  let blob: ApiKeyBlob | undefined;
  return {
    getLibrarySort: vi.fn(() => Promise.resolve(undefined)),
    setLibrarySort: vi.fn(() => Promise.resolve()),
    getStoragePersistResult: vi.fn(() => Promise.resolve(undefined)),
    setStoragePersistResult: vi.fn(() => Promise.resolve()),
    getView: vi.fn(() => Promise.resolve(undefined)),
    setView: vi.fn(() => Promise.resolve()),
    getFocusModeHintShown: vi.fn(() => Promise.resolve(false)),
    setFocusModeHintShown: vi.fn(() => Promise.resolve()),
    getApiKeyBlob: vi.fn(() => Promise.resolve(blob)),
    putApiKeyBlob: vi.fn((b: ApiKeyBlob) => {
      blob = b;
      return Promise.resolve();
    }),
    deleteApiKeyBlob: vi.fn(() => {
      blob = undefined;
      return Promise.resolve();
    }),
    ...overrides,
  };
}

function mockFetch200WithModels(): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: [{ id: 'm-1' }] }),
  });
}

function mockFetch401(): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    status: 401,
    json: () => Promise.resolve({}),
  });
}

describe('SettingsView', () => {
  it('renders ApiKeyForm when state is none', () => {
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByLabelText(/NanoGPT API key/i)).toBeInTheDocument();
  });

  it('session submit → calls validateKey → store transitions to session', async () => {
    mockFetch200WithModels();
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: 'sk-test' },
    });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(useApiKeyStore.getState().state).toEqual({ kind: 'session', key: 'sk-test' });
    });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('save submit → encrypts + persists + store transitions to unlocked', async () => {
    mockFetch200WithModels();
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    fireEvent.change(screen.getByLabelText(/Passphrase/i), {
      target: { value: 'pp' },
    });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(useApiKeyStore.getState().state).toEqual({ kind: 'unlocked', key: 'sk-test' });
    });
    expect(repo.putApiKeyBlob).toHaveBeenCalled();
  }, 10_000);

  it('session state shows status card with Save + Remove buttons', async () => {
    useApiKeyStore.setState({ state: { kind: 'session', key: 'sk-x' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByText(/using API key for this session/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save on this device/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();
  });

  it('unlocked state shows status card with Remove only', () => {
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByText(/API key unlocked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save on this device/i })).toBeNull();
  });

  it('locked state shows UnlockForm + Remove escape', () => {
    useApiKeyStore.setState({ state: { kind: 'locked' } });
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Unlock$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove saved key/i })).toBeInTheDocument();
  });

  it('Remove with confirm wipes blob + transitions to none', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    const repo = fakeRepo();
    await repo.putApiKeyBlob({
      salt: new ArrayBuffer(16),
      iv: new ArrayBuffer(12),
      ciphertext: new ArrayBuffer(8),
      iterations: 600_000,
    });
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    await waitFor(() => {
      expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
    });
    expect(repo.deleteApiKeyBlob).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Remove without confirm does nothing', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useApiKeyStore.setState({ state: { kind: 'unlocked', key: 'sk-x' } });
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'unlocked', key: 'sk-x' });
    expect(repo.deleteApiKeyBlob).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('validation 401 → form shows invalid-key message; store stays none', async () => {
    mockFetch401();
    render(<SettingsView settingsRepo={fakeRepo()} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: 'sk-bad' },
    });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText(/rejected by NanoGPT/i)).toBeInTheDocument();
    });
    expect(useApiKeyStore.getState().state).toEqual({ kind: 'none' });
  });

  it('session→save upgrade: shows passphrase form, encrypts, transitions to unlocked', async () => {
    useApiKeyStore.setState({ state: { kind: 'session', key: 'sk-already-validated' } });
    const repo = fakeRepo();
    render(<SettingsView settingsRepo={repo} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    expect(screen.getByLabelText(/Passphrase/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/NanoGPT API key/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Passphrase/i), { target: { value: 'pp' } });
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    fireEvent.click(submit);
    await waitFor(() => {
      expect(useApiKeyStore.getState().state).toEqual({
        kind: 'unlocked',
        key: 'sk-already-validated',
      });
    });
    // No re-validation: fetch was not called for this upgrade path.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(repo.putApiKeyBlob).toHaveBeenCalled();
  }, 10_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/features/ai/settings/SettingsView.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the view**

```tsx
// src/features/ai/settings/SettingsView.tsx
import { useState } from 'react';
import type { SettingsRepository } from '@/storage';
import { ApiKeyForm, type SubmitInput, type SubmitResult } from '../key/ApiKeyForm';
import { UnlockForm } from '../key/UnlockForm';
import { encryptKey, decryptKey } from '../key/apiKeyCrypto';
import { validateKey, type ValidateKeyResult } from '../key/nanogptApi';
import { useApiKeyStore, useApiKeyState } from '../key/apiKeyStore';
import { SettingsChrome } from './SettingsChrome';
import './settings-view.css';

type Props = {
  readonly settingsRepo: SettingsRepository;
  readonly onClose: () => void;
};

function messageFor(result: ValidateKeyResult): string {
  if (result.ok) return '';
  switch (result.reason) {
    case 'invalid-key':
      return `That key was rejected by NanoGPT (${String(result.status ?? '')}). Double-check it on your NanoGPT dashboard.`;
    case 'network':
      return "Couldn't reach NanoGPT. Check your connection and try again.";
    case 'other':
      return result.status !== undefined
        ? `NanoGPT returned an unexpected error (status ${String(result.status)}). Try again in a moment.`
        : 'Unexpected response from NanoGPT. Try again in a moment.';
  }
}

export function SettingsView({ settingsRepo, onClose }: Props) {
  const state = useApiKeyState();
  const { setSession, setUnlocked, clear } = useApiKeyStore.getState();
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);

  const handleEntrySubmit = async (input: SubmitInput): Promise<SubmitResult> => {
    // Session→save upgrade: skip re-validation. The key was validated when
    // entered as session; we trust it.
    if (
      input.mode === 'save' &&
      state.kind === 'session' &&
      input.key === state.key
    ) {
      try {
        const blob = await encryptKey(state.key, input.passphrase);
        await settingsRepo.putApiKeyBlob(blob);
        setUnlocked(state.key);
        setShowUpgradeForm(false);
        return { ok: true };
      } catch (err) {
        console.error('[settings] save upgrade failed', err);
        return { ok: false, message: "Couldn't save your key. Reload and try again." };
      }
    }

    const result = await validateKey(input.key);
    if (!result.ok) return { ok: false, message: messageFor(result) };

    if (input.mode === 'session') {
      setSession(input.key);
      return { ok: true };
    }

    try {
      const blob = await encryptKey(input.key, input.passphrase);
      await settingsRepo.putApiKeyBlob(blob);
      setUnlocked(input.key);
      return { ok: true };
    } catch (err) {
      console.error('[settings] save failed', err);
      return { ok: false, message: "Couldn't save your key. Reload and try again." };
    }
  };

  const handleUnlockSubmit = async (
    passphrase: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    const blob = await settingsRepo.getApiKeyBlob();
    if (!blob) {
      clear();
      return { ok: false, message: 'No saved key found.' };
    }
    try {
      const key = await decryptKey(blob, passphrase);
      setUnlocked(key);
      return { ok: true };
    } catch {
      return { ok: false, message: 'Wrong passphrase.' };
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (
      !window.confirm(
        "Remove API key from this device? You'll need to re-enter it next time.",
      )
    ) {
      return;
    }
    if (state.kind === 'unlocked' || state.kind === 'locked') {
      await settingsRepo.deleteApiKeyBlob();
    }
    clear();
    setShowUpgradeForm(false);
  };

  return (
    <div className="settings-view">
      <SettingsChrome onClose={onClose} />
      <main className="settings-view__main">
        <section className="settings-view__section">
          <h2 className="settings-view__section-title">API key</h2>
          {state.kind === 'none' ? <ApiKeyForm onSubmit={handleEntrySubmit} /> : null}
          {state.kind === 'locked' ? (
            <UnlockForm
              onSubmit={handleUnlockSubmit}
              onRemove={() => {
                void handleRemove();
              }}
            />
          ) : null}
          {state.kind === 'session' && !showUpgradeForm ? (
            <ApiKeyStatusCard
              label="Using API key for this session"
              hint="Closing the tab will forget it."
              secondaryActionLabel="Save on this device"
              onSecondaryAction={() => {
                setShowUpgradeForm(true);
              }}
              onRemove={() => {
                void handleRemove();
              }}
            />
          ) : null}
          {state.kind === 'session' && showUpgradeForm ? (
            <ApiKeyForm
              initialMode="save"
              initialKey={state.key}
              hideKeyField
              onSubmit={handleEntrySubmit}
              onCancel={() => {
                setShowUpgradeForm(false);
              }}
            />
          ) : null}
          {state.kind === 'unlocked' ? (
            <ApiKeyStatusCard
              label="API key unlocked"
              hint="Encrypted on this device. We'll ask for your passphrase next time you reload."
              onRemove={() => {
                void handleRemove();
              }}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}

type ApiKeyStatusCardProps = {
  readonly label: string;
  readonly hint: string;
  readonly secondaryActionLabel?: string;
  readonly onSecondaryAction?: () => void;
  readonly onRemove: () => void;
};

function ApiKeyStatusCard({
  label,
  hint,
  secondaryActionLabel,
  onSecondaryAction,
  onRemove,
}: ApiKeyStatusCardProps) {
  return (
    <div className="api-key-status-card">
      <div className="api-key-status-card__main">
        <p className="api-key-status-card__label">{label}</p>
        <p className="api-key-status-card__hint">{hint}</p>
      </div>
      <div className="api-key-status-card__actions">
        {secondaryActionLabel !== undefined && onSecondaryAction !== undefined ? (
          <button
            type="button"
            className="api-key-status-card__secondary"
            onClick={onSecondaryAction}
          >
            {secondaryActionLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="api-key-status-card__remove"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
```

```css
/* src/features/ai/settings/settings-view.css */
.settings-view {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--color-bg);
}
.settings-view__main {
  flex: 1 1 auto;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
@media (max-width: 720px) {
  .settings-view__main {
    max-width: none;
  }
}
.settings-view__section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 var(--space-3);
}
.api-key-status-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
}
.api-key-status-card__main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.api-key-status-card__label {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}
.api-key-status-card__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.api-key-status-card__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.api-key-status-card__secondary {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
}
.api-key-status-card__secondary:hover {
  background: var(--color-surface-hover, var(--color-surface));
}
.api-key-status-card__remove {
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
}
.api-key-status-card__remove:hover {
  color: #c0392b;
}
```

- [ ] **Step 4: Run view tests**

Run: `pnpm test --run src/features/ai/settings/SettingsView.test.tsx`
Expected: PASS — 10 tests. Note: the save-mode and upgrade tests do real PBKDF2 (600k iterations) inside happy-dom; allow ~5–10s for that file.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/settings/SettingsView.tsx src/features/ai/settings/settings-view.css src/features/ai/settings/SettingsView.test.tsx
git commit -m "feat(ai/settings): SettingsView — state-driven entry/unlock/status with full CRUD"
```

---

### Task 12: Library chrome — Settings button

**Files:**
- Modify: `src/features/library/LibraryChrome.tsx`
- Modify: `src/features/library/library-chrome.css`
- Modify: `src/features/library/LibraryChrome.test.tsx`
- Modify: `src/features/library/LibraryView.tsx`
- Modify: `src/features/library/LibraryWorkspace.tsx`

> **Strategy:** Add `onOpenSettings` prop down the tree. New SettingsIcon button in `LibraryChrome` actions row.

- [ ] **Step 1: Write the failing test**

Append to `src/features/library/LibraryChrome.test.tsx`:

```tsx
describe('LibraryChrome — settings button', () => {
  it('renders a Settings button (gear icon)', () => {
    render(
      <LibraryChrome
        search=""
        onSearchChange={() => undefined}
        sort="recently-opened"
        onSortChange={() => undefined}
        onFilesPicked={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
  });

  it('clicking the button calls onOpenSettings', () => {
    const onOpenSettings = vi.fn();
    render(
      <LibraryChrome
        search=""
        onSearchChange={() => undefined}
        sort="recently-opened"
        onSortChange={() => undefined}
        onFilesPicked={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
```

(If the existing `LibraryChrome.test.tsx` is empty or doesn't exist, create it with the standard test scaffold: imports for `vitest`, `@testing-library/react`, `LibraryChrome`, `afterEach(cleanup)`. If it already has tests, append the new `describe` block.)

- [ ] **Step 2: Edit `src/features/library/LibraryChrome.tsx`**

Replace the file:

```tsx
import type { SortKey } from '@/domain';
import { SettingsIcon } from '@/shared/icons';
import { LibrarySearchField } from './LibrarySearchField';
import { LibrarySortDropdown } from './LibrarySortDropdown';
import { ImportButton } from './ImportButton';
import './library-chrome.css';

type Props = {
  readonly search: string;
  readonly onSearchChange: (next: string) => void;
  readonly sort: SortKey;
  readonly onSortChange: (next: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onOpenSettings: () => void;
};

export function LibraryChrome(props: Props) {
  return (
    <header className="library-chrome">
      <div className="library-chrome__wordmark">Bookworm</div>
      <div className="library-chrome__search">
        <LibrarySearchField value={props.search} onChange={props.onSearchChange} />
      </div>
      <div className="library-chrome__actions">
        <LibrarySortDropdown value={props.sort} onChange={props.onSortChange} />
        <ImportButton onFilesPicked={props.onFilesPicked} />
        <button
          type="button"
          className="library-chrome__settings"
          aria-label="Settings"
          title="Settings"
          onClick={props.onOpenSettings}
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Edit `src/features/library/library-chrome.css`**

Append:

```css
.library-chrome__settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}
.library-chrome__settings:hover {
  color: var(--color-text);
  background: var(--color-surface-hover, var(--color-surface));
}
```

- [ ] **Step 4: Edit `src/features/library/LibraryWorkspace.tsx`**

Find:

```ts
type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onRemoveBook: (book: Book) => void;
  readonly onOpenBook?: (book: Book) => void;
};
```

Replace with:

```ts
type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onRemoveBook: (book: Book) => void;
  readonly onOpenBook?: (book: Book) => void;
  readonly onOpenSettings: () => void;
};
```

Find:

```ts
export function LibraryWorkspace({
  libraryStore,
  importStore,
  coverCache,
  onPersistSort,
  onFilesPicked,
  onRemoveBook,
  onOpenBook,
}: Props) {
```

Replace with:

```ts
export function LibraryWorkspace({
  libraryStore,
  importStore,
  coverCache,
  onPersistSort,
  onFilesPicked,
  onRemoveBook,
  onOpenBook,
  onOpenSettings,
}: Props) {
```

Find the `<LibraryChrome ...>` JSX:

```tsx
      <LibraryChrome
        search={search}
        onSearchChange={onSearchChange}
        sort={sort}
        onSortChange={onSortChange}
        onFilesPicked={onFilesPicked}
      />
```

Replace with:

```tsx
      <LibraryChrome
        search={search}
        onSearchChange={onSearchChange}
        sort={sort}
        onSortChange={onSortChange}
        onFilesPicked={onFilesPicked}
        onOpenSettings={onOpenSettings}
      />
```

- [ ] **Step 5: Edit `src/features/library/LibraryView.tsx`**

Find:

```ts
type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly hasBooks: boolean;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onRemoveBook: (book: Book) => void;
  readonly onOpenBook?: (book: Book) => void;
};
```

Replace with:

```ts
type Props = {
  readonly libraryStore: LibraryStore;
  readonly importStore: ImportStore;
  readonly coverCache: CoverCache;
  readonly hasBooks: boolean;
  readonly onPersistSort: (key: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onRemoveBook: (book: Book) => void;
  readonly onOpenBook?: (book: Book) => void;
  readonly onOpenSettings: () => void;
};
```

Find the `<LibraryWorkspace ...>` JSX and add `onOpenSettings={props.onOpenSettings}` to its props.

- [ ] **Step 6: Run library tests**

Run: `pnpm test --run src/features/library/LibraryChrome.test.tsx`
Expected: PASS — all existing + 2 new tests.

- [ ] **Step 7: Type-check**

Run: `pnpm type-check`
Expected: FAIL — `App.tsx` doesn't yet pass `onOpenSettings`. We'll fix in Task 13. Skip.

- [ ] **Step 8: Commit**

```bash
git add src/features/library/LibraryChrome.tsx src/features/library/library-chrome.css src/features/library/LibraryChrome.test.tsx src/features/library/LibraryView.tsx src/features/library/LibraryWorkspace.tsx
git commit -m "feat(library): chrome gains Settings button + onOpenSettings plumbing"
```

---

### Task 13: `App.tsx` — fourth view branch + boot integration

**Files:**
- Modify: `src/app/App.tsx`

> **Strategy:** Boot extends `Promise.all` with `getApiKeyBlob`. If blob present, `markLocked()` synchronously before `setBoot('ready')`. Fourth view branch renders `<SettingsView>`. Library view receives `onOpenSettings`.

- [ ] **Step 1: Edit `src/app/App.tsx`**

Add imports:

```ts
import { SettingsView } from '@/features/ai/settings/SettingsView';
import { useApiKeyStore } from '@/features/ai/key/apiKeyStore';
```

Find the boot promise:

```ts
        const [persistedView, prefs, hintShown] = await Promise.all([
          wiring.settingsRepo.getView(),
          wiring.readerPreferencesRepo.get(),
          wiring.settingsRepo.getFocusModeHintShown(),
        ]);
```

Replace with:

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

Find the existing `'notebook'` branch in `ReadyApp`. After it, before the `'reader'` branch, add the settings branch:

```tsx
  if (view.current.kind === 'settings') {
    return (
      <div className="app">
        <SettingsView
          settingsRepo={wiring.settingsRepo}
          onClose={view.goLibrary}
        />
      </div>
    );
  }
```

Find the library `<LibraryView ...>`:

```tsx
      <LibraryView
        libraryStore={libraryStore}
        importStore={importStore}
        coverCache={coverCache}
        hasBooks={showWorkspace}
        onFilesPicked={reader.onFilesPicked}
        onPersistSort={reader.onPersistSort}
        onRemoveBook={reader.onRemoveBook}
        onOpenBook={view.goReader}
      />
```

Replace with:

```tsx
      <LibraryView
        libraryStore={libraryStore}
        importStore={importStore}
        coverCache={coverCache}
        hasBooks={showWorkspace}
        onFilesPicked={reader.onFilesPicked}
        onPersistSort={reader.onPersistSort}
        onRemoveBook={reader.onRemoveBook}
        onOpenBook={view.goReader}
        onOpenSettings={view.goSettings}
      />
```

- [ ] **Step 2: Type-check + build**

Run: `pnpm type-check && pnpm build`
Expected: clean.

- [ ] **Step 3: Run all unit tests**

Run: `pnpm test`
Expected: PASS — full suite.

- [ ] **Step 4: Manual smoke (~5 minutes)**

```bash
pnpm dev
```

In `http://localhost:5173`:
1. Library chrome shows a Settings button (gear icon).
2. Click → Settings view opens with API key form.
3. Paste a fake key (e.g., `sk-test-bad-key`), keep mode "Use this session", click Submit. NanoGPT will return 401 (assuming the key is bogus); see the error message.
4. Reload — Settings is still the active view.
5. Click back → returns to library.
6. Open Settings, paste a real key (or skip if you don't have one), submit. If you have a real key, validation succeeds and you see "Using API key for this session".
7. Click "Save on this device" → form prompts for passphrase. Enter one, submit. Blob persists; reload → see "API key (saved on this device)" + Unlock form.
8. Enter wrong passphrase → "Wrong passphrase" error. Enter correct → "API key unlocked".
9. Click Remove → confirm → state returns to None. Reload → still None.

If anything looks broken, fix and re-test before committing.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): settings view branch + boot reads apiKey blob into store"
```

---

### Task 14: E2E — open Settings from library, persist on reload, close

**Files:**
- Create: `e2e/settings-open-from-library.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings: open from library chrome, persist across reload, close back', async ({ page }) => {
  await page.goto('/');

  // Library is the boot view; the chrome should expose a Settings button.
  const settingsBtn = page.getByRole('button', { name: /open settings/i });
  await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
  await settingsBtn.click();

  // Settings view chrome + section.
  await expect(page.getByRole('heading', { name: /settings/i, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /api key/i, level: 2 })).toBeVisible();

  // Default 'none' state shows the entry form (key field).
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();

  // Reload — settings persists.
  await page.reload();
  await expect(page.getByRole('heading', { name: /api key/i, level: 2 })).toBeVisible();

  // Close → back to library.
  await page.getByRole('button', { name: /back to library/i }).click();
  await expect(page.getByRole('button', { name: /open settings/i })).toBeVisible();
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm exec playwright test e2e/settings-open-from-library.spec.ts`
Expected: FAIL — "Open settings" button doesn't exist yet (or one of the assertions inside Settings fails).

- [ ] **Step 3: Verify it passes after Tasks 1–13**

If the prior tasks were implemented correctly, the spec should pass without further code changes.

Run: `pnpm exec playwright test e2e/settings-open-from-library.spec.ts`
Expected: PASS.

If it fails, fix the cause in the appropriate earlier file (NOT in the spec). Likely culprits: missing `aria-label` on the gear button, missing `<h1>Settings</h1>` in `SettingsChrome`, or `view` settings record not persisting.

- [ ] **Step 4: Commit**

```bash
git add e2e/settings-open-from-library.spec.ts
git commit -m "test(e2e): settings opens from library, persists on reload, closes back"
```

---

### Task 15: E2E — add session-only key, status card, remove

**Files:**
- Create: `e2e/settings-api-key-session.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings: paste key, "Use this session", see status card, Remove', async ({ page }) => {
  // Mock NanoGPT validation as success.
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-session-key');
  // Default mode is "Use this session" — submit should be enabled.
  const submitBtn = page.getByRole('button', { name: /use this session/i });
  await expect(submitBtn).toBeEnabled();
  await submitBtn.click();

  // Transitions to the status card.
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();

  // Remove via confirm dialog.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/remove api key/i);
    void dialog.accept();
  });
  await page.getByRole('button', { name: /^remove/i }).click();

  // Back to entry form.
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-api-key-session.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-api-key-session.spec.ts
git commit -m "test(e2e): settings session-mode key entry + remove"
```

---

### Task 16: E2E — save on device, reload locked, unlock with passphrase

**Files:**
- Create: `e2e/settings-api-key-save-and-reload.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings: save on device → reload locked → unlock with passphrase', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-saved-key');
  await page.getByRole('radio', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('correct horse battery staple');

  await page.getByRole('button', { name: /save key/i }).click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible({ timeout: 5_000 });

  // Reload — the blob is in IDB; store should rehydrate to 'locked'.
  await page.reload();
  await expect(page.getByRole('heading', { name: /api key.*saved on this device/i })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeVisible();

  // Wrong passphrase first.
  await page.getByLabel(/^passphrase$/i).fill('wrong-passphrase');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByText(/wrong passphrase/i)).toBeVisible();

  // Correct passphrase.
  await page.getByLabel(/^passphrase$/i).fill('correct horse battery staple');
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-api-key-save-and-reload.spec.ts`
Expected: PASS.

If the unlock step is slow on CI, the 5_000ms timeout above gives PBKDF2 600k iterations enough headroom (~1s on most machines, capped at our worst-case Chromebook estimate).

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-api-key-save-and-reload.spec.ts
git commit -m "test(e2e): settings save key + reload locked + unlock"
```

---

### Task 17: E2E — validation error blocks save, then succeeds

**Files:**
- Create: `e2e/settings-validation-error.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings: 401 from /v1/models blocks save; 200 then succeeds', async ({ page }) => {
  let allowSuccess = false;
  await page.route('**/api/v1/models', async (route) => {
    if (allowSuccess) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid api key' }),
      });
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  await page.getByLabel(/nanogpt api key/i).fill('sk-test-bad');
  await page.getByRole('button', { name: /use this session/i }).click();

  await expect(page.getByText(/rejected by nanogpt/i)).toBeVisible({ timeout: 5_000 });
  // Status card must NOT appear.
  await expect(page.getByText(/using api key for this session/i)).toBeHidden();

  // Now flip to success and try again.
  allowSuccess = true;
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-good');
  await page.getByRole('button', { name: /use this session/i }).click();
  await expect(page.getByText(/using api key for this session/i)).toBeVisible();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-validation-error.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-validation-error.spec.ts
git commit -m "test(e2e): settings shows error on 401, succeeds on 200"
```

---

### Task 18: E2E — remove saved key persists across reload

**Files:**
- Create: `e2e/settings-remove-and-reload.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings: save key, remove, reload — Settings shows fresh entry form', async ({ page }) => {
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'demo-model' }] }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /open settings/i }).click();

  // Save a key.
  await page.getByLabel(/nanogpt api key/i).fill('sk-test-removable');
  await page.getByRole('radio', { name: /save on this device/i }).click();
  await page.getByLabel(/^passphrase$/i).fill('hunter2');
  await page.getByRole('button', { name: /save key/i }).click();
  await expect(page.getByText(/api key unlocked/i)).toBeVisible();

  // Remove with confirmation.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /^remove/i }).click();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();

  // Reload — should still show fresh form, not unlock form.
  await page.reload();
  await expect(page.getByLabel(/nanogpt api key/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^unlock$/i })).toBeHidden();
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-remove-and-reload.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-remove-and-reload.spec.ts
git commit -m "test(e2e): settings removal wipes blob — reload confirms"
```

---

### Task 19: E2E — chrome icons render as SVGs (no emoji)

**Files:**
- Create: `e2e/settings-icons.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('Settings: chrome icons are SVGs, not emoji glyphs', async ({ page }) => {
  await page.goto('/');

  // Library chrome: gear button has an SVG icon.
  const gearBtn = page.getByRole('button', { name: /open settings/i });
  await expect(gearBtn).toBeVisible({ timeout: 15_000 });
  await expect(gearBtn.locator('svg.icon')).toHaveCount(1);
  expect((await gearBtn.textContent()) ?? '').not.toContain('⚙');
  expect((await gearBtn.textContent()) ?? '').not.toContain('🛠');

  await gearBtn.click();

  // Settings chrome back button is an SVG.
  const backBtn = page.getByRole('button', { name: /back to library/i });
  await expect(backBtn.locator('svg.icon')).toHaveCount(1);

  // Eye toggle on the masked input is an SVG.
  const showToggle = page.getByRole('button', { name: /show api key/i });
  await expect(showToggle.locator('svg.icon')).toHaveCount(1);

  // After clicking, label flips to "Hide".
  await showToggle.click();
  const hideToggle = page.getByRole('button', { name: /hide api key/i });
  await expect(hideToggle.locator('svg.icon')).toHaveCount(1);
});
```

- [ ] **Step 2: Run + verify pass**

Run: `pnpm exec playwright test e2e/settings-icons.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings-icons.spec.ts
git commit -m "test(e2e): settings chrome and eye toggle render SVG icons"
```

---

### Task 20: Documentation — architecture decision log + roadmap status

**Files:**
- Modify: `docs/02-system-architecture.md`
- Modify: `docs/04-implementation-roadmap.md`

- [ ] **Step 1: Append a Phase 4.1 entry to the architecture decision history**

Open `docs/02-system-architecture.md`, find the existing decision-history section, and append:

```markdown
### 2026-05-04 — Phase 4.1: API key settings

- **Surface:** New `AppView` kind `'settings'`. Persists across reload via the existing `view` settings record. Accessible from a gear icon in the library chrome.
- **State model:** Single Zustand `apiKeyStore` with discriminated-union state (`'none' | 'session' | 'unlocked' | 'locked'`). No XState machine — transitions are linear and well-defined.
- **Persistence:** New `apiKey` `SettingsRecord` variant. ArrayBuffers stored natively (no base64). `iterations` persisted alongside the blob for forward-compat.
- **Crypto:** WebCrypto PBKDF2-SHA256 (600k iterations, OWASP 2023) → 256-bit AES-GCM. Random salt + IV per encryption. Passphrase never persisted.
- **Validation:** On submit, `GET /v1/models` against NanoGPT base URL. 200 → save. 401/403 → "rejected" message. Other → generic error. Same call 4.2 will use for the model catalog.
- **Cold-start unlock:** Boot reads `apiKeyBlob`, calls `markLocked()` synchronously before `setBoot('ready')` if present. Settings UI never sees a transient flash.
- **Remove flow:** `window.confirm` dialog; on accept, wipes IDB blob + clears in-memory store. Stays in Settings.
- **Out of scope:** Model catalog UI (4.2), chat panel (4.3), passage mode (4.4), provider switcher, biometric unlock, multi-tab sync, "forgot passphrase" recovery.
```

- [ ] **Step 2: Update the roadmap status**

Open `docs/04-implementation-roadmap.md`, find the `## Status` block at the top, and update it to:

```markdown
## Status
- Phase 0 — complete (2026-05-02)
- Phase 1 — complete (2026-05-03)
- Phase 2 — complete (2026-05-03)
- Phase 3 — complete (2026-05-04)
- Phase 4.1 — complete (2026-05-04)
```

(The line numbers in `04-implementation-roadmap.md` show the existing Phase-3-complete line at line 7. Replace lines 4–7 with the four-bullet block ending at "Phase 4.1 — complete" — keep formatting identical to existing bullets.)

- [ ] **Step 3: Commit**

```bash
git add docs/02-system-architecture.md docs/04-implementation-roadmap.md
git commit -m "docs: Phase 4.1 architecture decision + roadmap status"
```

---

### Task 21: Final verification + open PR

**Files:**
- No new files. This task is verification + PR open.

- [ ] **Step 1: Type-check, lint, build, test in one shot**

Run: `pnpm check`
Expected: PASS — formatter, type-check, lint, unit tests, build all clean.

If anything fails: fix the cause in the offending file (do NOT silence). Re-run until clean. Each fix gets its own commit (`fix(<area>): <what>`) — small, atomic, reviewable.

- [ ] **Step 2: Full Playwright suite**

Run: `pnpm exec playwright test`
Expected: PASS — entire suite, including the 6 new Phase 4.1 specs.

If a pre-existing test fails (not one of the 6 new specs), that's an unrelated flake. Re-run the failing spec in isolation; if reproducible, investigate before opening the PR.

- [ ] **Step 3: Manual smoke (~5 minutes)**

```bash
pnpm dev
```

Walk through all four states once, on both desktop (1280×800) and mobile (390×844 via DevTools device toolbar):

1. **None → session.** Open Settings → paste fake key → submit. With a fake key, NanoGPT returns 401; observe the "rejected" message. With a real key (if you have one), observe transition to status card.
2. **None → save.** Toggle to "Save on this device" → enter passphrase → submit. Observe transition to "API key unlocked".
3. **Reload → locked.** Reload page → Settings shows "API key (saved on this device)" + Unlock form.
4. **Locked → unlocked.** Wrong passphrase → "Wrong passphrase" inline error. Correct passphrase → "API key unlocked".
5. **Session → save upgrade.** From session state, click "Save on this device" → form takes only passphrase (key field hidden) → submit → transitions to "API key unlocked" without re-validating.
6. **Remove (locked).** From locked state, "Remove saved key" → confirm → state becomes 'none', form returns.
7. **Remove (unlocked).** From unlocked state, "Remove" → confirm → state becomes 'none'.

Check that:
- Settings persists across reload (you stay in Settings after F5).
- Closing back to library uses the chrome back button.
- The eye toggle on the key input flips between masked and plaintext.
- Mobile layout: the segmented control fits, inputs are reachable, soft keyboard does not occlude the submit button.

If anything looks wrong, fix and re-test before opening the PR.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin phase-4-1-api-key-settings

gh pr create --title "feat: Phase 4.1 — API key settings" --body "$(cat <<'EOF'
## Summary
- New `AppView` kind `'settings'`: dedicated Settings page accessible from library chrome (gear icon). Persists across reload via the existing `view` settings record.
- API key entry with two storage modes: **Use this session** (in-memory only) and **Save on this device** (passphrase-encrypted via WebCrypto PBKDF2-SHA256 600k → AES-GCM). Validation hits `/v1/models` on submit so typos fail fast.
- Cold-start unlock flow: if a saved blob exists, the Settings page shows an Unlock form on boot. Wrong passphrase → inline error; correct → store transitions to `'unlocked'`.
- Single Zustand `apiKeyStore` with discriminated-union state (`none / session / unlocked / locked`). Decrypted keys never touch IDB; encrypted blobs never reach the in-memory store.
- Privacy-forward copy throughout: the user can always see what's in memory vs. on disk.

## Test Plan
- [x] `pnpm check` clean (format + type-check + lint + unit + build)
- [x] Playwright suite green; six new Phase 4.1 E2E specs cover open-from-library, session entry + remove, save + reload + unlock, validation error, remove + reload, and chrome icons
- [x] Manual smoke on desktop (1280×800) and mobile (390×844): all four states (none / session / unlocked / locked), session→save upgrade, both remove paths
- [x] Architecture decision history + roadmap status doc updates committed

## Out of scope
- Model catalog UI (Task 4.2)
- Chat panel (Task 4.3)
- Passage mode (Task 4.4)
- Provider switcher (NanoGPT only in v1)
- Biometric / WebAuthn unlock
- "Forgot passphrase" recovery (recovery path is "Remove + re-enter")
EOF
)"
```

- [ ] **Step 5: Capture the PR URL**

`gh pr create` prints the PR URL. Save it for the user. Done.

---

## Self-Review Checklist

After writing this plan, run through the writing-plans skill's three-point self-review:

### 1. Spec coverage

Walk every section of the spec and map to a task:

| Spec section | Task(s) covering it |
|---|---|
| §4.2 `AppView` `'settings'` extension | Task 1 (schema + validator), Task 2 (`settingsView()`), Task 3 (`goSettings`) |
| §4.3 `SettingsRecord` `apiKey` variant | Task 1 (schema + `isValidApiKeyValue`) |
| §4.5 `isValidApiKeyValue` validator | Task 1 |
| §4.6 `SettingsRepository` extensions | Task 1 |
| §5.1 New icons (`SettingsIcon`, `EyeIcon`, `EyeOffIcon`) | Task 7 |
| §5.2 `apiKeyStore` Zustand | Task 4 |
| §5.3 `apiKeyCrypto` (WebCrypto) | Task 5 |
| §5.4 `nanogptApi.validateKey` | Task 6 |
| §5.5 `ApiKeyForm` | Task 8 |
| §5.6 `UnlockForm` | Task 9 |
| §5.7 `SettingsView` (state-driven rendering) | Task 11 |
| §5.8 `SettingsChrome` | Task 10 |
| §5.9 Library chrome — Settings button | Task 12 |
| §5.10 `App.tsx` fourth branch | Task 13 |
| §5.11 Boot integration (`Promise.all` + `markLocked`) | Task 13 |
| §6.1–6.5 Data flow (session entry, save mode, cold-start unlock, upgrade, removal) | Tasks 11 + 13 (logic) + Tasks 15–18 (E2E coverage) |
| §6.6 Error surfaces (`messageFor`, etc.) | Task 11 (`messageFor` defined inside SettingsView module) |
| §7.1 Unit tests (per file) | Each implementation task includes a "Write the failing test" step using the matching test file from §7.1 |
| §7.2 E2E tests | Tasks 14–19 (one task per spec) |
| §11 Acceptance criteria 1–15 | Verified in Task 21 (`pnpm check` + Playwright suite + manual smoke) |

No gaps.

### 2. Placeholder scan

- No "TBD" / "TODO" / "implement later" in any task body.
- All test code in tasks is complete and runnable (no `// fill in details`).
- Every step that changes code shows the actual code.
- Cross-references (Task N) always reference tasks defined earlier; no forward dangling.

### 3. Type consistency

Names cross-checked:

- `apiKeyStore.state.kind` — `'none' | 'session' | 'unlocked' | 'locked'` everywhere (store impl, hooks, SettingsView, tests).
- `setSession(key)` / `setUnlocked(key)` / `markLocked()` / `clear()` — used consistently across Tasks 4, 11, 13.
- `ApiKeyBlob` — `{ salt, iv, ciphertext, iterations }` with ArrayBuffer fields + number; consistent across Tasks 1, 5, 6, 11.
- `validateKey(apiKey, signal?)` returns `{ ok: true; models } | { ok: false; reason; status? }` — same shape in Tasks 6 and 11.
- `encryptKey(apiKey, passphrase)` / `decryptKey(blob, passphrase)` — Tasks 5 + 11 align.
- `getApiKeyBlob` / `putApiKeyBlob` / `deleteApiKeyBlob` — Tasks 1 + 11 align.
- `goSettings()` — defined Task 3, called Task 12.
- `view.kind === 'settings'` — branched on in Task 13.
- `SubmitInput` discriminated by `mode: 'session' | 'save'` — same shape in Task 8 form, Task 11 SettingsView handler.
- `messageFor(ValidateKeyResult)` — defined in Task 11; reasons match `'invalid-key' | 'network' | 'other'` from Task 6.

No type drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-phase-4-1-api-key-settings.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
