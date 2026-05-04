# Phase 4.2 — Model catalog design

**Status:** approved 2026-05-04
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 4 → Task 4.2
**Predecessors:** Phase 4.1 API key settings (introduces `apiKeyStore`, `nanogptApi`, the `/settings` `AppView`, and the per-feature pattern under `src/features/ai/`).
**Architecture decisions referenced:** `docs/03-ai-context-engine.md` "Model strategy" (catalog snapshot + future Fast/Balanced/Deep presets) and `docs/02-system-architecture.md` Phase 4.1 decision history (settings page + WebCrypto pattern).

## 1. Goal & scope

Let the user choose a NanoGPT model and persist that choice. Catalog refreshes piggyback on the existing key-validation flow from 4.1; a manual Refresh button in the new Models section re-fetches on demand. Selection is global (one model used across all books). Phase 4.2 is the foundation for 4.3's chat panel and the future preset system; it ships only what's needed to unblock 4.3.

**In scope (v1, this phase):**
- Persist a snapshot of the catalog (the list of `{id}` returned by `/v1/models`) and the user's chosen model id, both in the existing `settings` IDB store as new `SettingsRecord` variants.
- Render a "Models" section in the existing Settings page below "API key", visible only when `apiKeyStore.state.kind` is `'session'` or `'unlocked'`. Hidden in `'locked'` and `'none'`.
- List of selectable rows, one per model, sorted alphabetically by id. Selected row highlighted; clicking a row updates the persisted selection.
- Refresh button in the Models section header → re-fetches `/v1/models` with the current key; on success, replaces the cached snapshot and re-renders.
- States surfaced in the section: **idle** (no fetch yet, no cache) / **loading** / **ready** (with rows; or empty if the catalog returned 0 models) / **error** (with cached fallback if available, or pure error if not).
- Stale-selection notice: when a refresh returns a catalog that doesn't contain the previously-selected id, drop the selection and surface a one-line notice "Your previous selection `<id>` is no longer available. Pick another model below."
- Auto-fetch on the same flows that already validate the key in 4.1: after a successful `validateKey` in `handleEntrySubmit` (session and save modes) and after a successful `decryptKey` in `handleUnlockSubmit`. The catalog is "warm" the moment a key becomes available.
- Cascade on key removal: removing the key (existing 4.1 flow) also wipes the cached catalog + selection in IDB and resets the in-memory store. A stale catalog with no key is dead state.
- In-memory `modelCatalogStore` (Zustand) with discriminated-union state, mirroring `apiKeyStore`'s pattern. Exposes `useCatalogState()` / `useSelectedModelId()` / `useStaleNotice()` hooks plus a synchronous `getCurrentSelectedModelId()` accessor for non-React consumers (4.3+).
- Boot hydration: if a cached catalog snapshot exists at app boot, hydrate the store to `'ready'` *before first paint*. Boot does NOT auto-fetch — refreshes are explicit (honors "no hidden uploads").

**Out of scope (deferred):**
- Fast/Balanced/Deep presets (4.3 or later).
- Per-book model overrides (4.3 or later — global preference is sufficient for v1).
- Provider, context-length, or pricing metadata in rows. NanoGPT's `/v1/models` returns only `id`; we do not derive provider from id prefix in v1.
- Search/filter input on the model list (small list — unnecessary).
- Auto-selection on first catalog load (user must explicitly pick).
- Periodic background refresh (manual + on-key-event only).
- Embedding/image-model picker (chat-only models in v1; we don't filter the response, but selection semantics target chat).
- Model rotation UX beyond "remove + add a new key" (which already cascades the catalog).
- Provider switcher (NanoGPT only per PRD).

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Selection style | **Raw selection** (no presets) | NanoGPT's `/v1/models` returns only `id`; presets require either hardcoded curation (brittle) or richer metadata (we don't have it). Raw selection is honest and unblocks 4.3. |
| Fetch trigger | **Piggyback on key validation/unlock + manual Refresh button** | Catalog rarely changes; the fetch is already happening in 4.1's flows. No background traffic; refreshes are explicit. |
| UI shape | **List of selectable rows** | Better than a dropdown for ~10–30 models; foundation for future metadata (context length etc.) without changing layout. |
| Selection scope | **Global preference** (one selection across all books) | Matches "calm, minimal" UX. Per-book overrides are YAGNI for v1. |
| Default selection | **Empty until user picks** | Most honest. 4.3 chat panel will handle "no model selected" with a hint to Settings. |
| Stale-selection behavior | **Drop + show notice on refresh** | Cleaner state model than keeping a stale id. 4.3 has one clear branch: selection valid (use it) / null (prompt user). |
| Boot behavior | **Hydrate cached snapshot; do not auto-fetch on boot** | Refreshes are explicit. Cached snapshot is hydrated before first paint to prevent UI flash. |
| Storage | **Two new `SettingsRecord` variants** (`'modelCatalog'` + `'selectedModelId'`) | Independent update cadences (catalog refresh vs. selection change). Single record would force unrelated writes. |
| In-memory store | **New Zustand `modelCatalogStore`** | Mirrors `apiKeyStore` pattern. Multiple consumers (Settings now, chat in 4.3); avoids re-querying IDB. |
| `Model` type | **`{ readonly id: string }` for v1** | Same shape `nanogptApi` already returns. Forward-compat: extend later without changing the storage contract. |
| `nanogptApi` shape | **Promote `validateKey` body to private `getModels`; expose both `validateKey` and `fetchCatalog` as semantic wrappers** | Avoids duplicate fetch logic. Both calls hit `/v1/models` with the same auth and parsing. |

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ SettingsView (existing — extended)                               │
│  ├─ ApiKeySection           (existing, Phase 4.1)                │
│  └─ ModelsSection           NEW — renders only when key available │
│      ├─ <ModelsSectionHeader> (title + "Updated X ago" + Refresh)│
│      ├─ <ModelsStaleNotice>   (conditional, when staleNotice set)│
│      └─ one of:                                                   │
│          <ModelList>          (state.kind === 'ready' & non-empty)│
│          <ModelsEmptyState>   (state.kind === 'ready' & empty)   │
│          <ModelsErrorState>   (state.kind === 'error', no cache) │
│          <ModelsLoadingState> (state.kind === 'loading')         │
│          <ModelsIdleState>    (state.kind === 'idle')            │
│                                                                   │
│ Stores (Zustand):                                                 │
│   modelCatalogStore                  NEW                          │
│     state: 'idle' | 'loading' | 'ready'(models, fetchedAt)       │
│            | 'error'(reason)                                      │
│     selectedId: string | null                                     │
│     staleNotice: string | null                                    │
│     setLoading(), setReady(models, fetchedAt), setError(reason), │
│     setSelectedId(id|null), setStaleNotice(id|null), reset()     │
│                                                                   │
│   apiKeyStore (existing) — read by ModelsSection for visibility   │
│                                                                   │
│ Persistence (settingsRepo extended):                              │
│   getModelCatalog / putModelCatalog / deleteModelCatalog          │
│   getSelectedModelId / putSelectedModelId / deleteSelectedModelId │
│                                                                   │
│ Catalog fetch (nanogptApi extended):                              │
│   fetchCatalog(apiKey, signal?) → ModelsFetchResult               │
│     (same shape as ValidateKeyResult; private getModels shared)   │
│                                                                   │
│ Trigger points:                                                   │
│   • SettingsView.handleEntrySubmit — after validateKey success    │
│   • SettingsView.handleUnlockSubmit — after decryptKey success    │
│   • Manual Refresh in ModelsSection                               │
│   • Boot: hydrate cached snapshot only (no fetch)                 │
└──────────────────────────────────────────────────────────────────┘
```

**Single-purpose units:**
- `ModelsSection` — top-level for the section. Subscribes to `modelCatalogStore` + `apiKeyStore`. Routes by state. Owns the Refresh callback and the selection-click callback. Pure composition.
- `ModelList` — pure presentation. Takes `models`, `selectedId`, `onSelect(model)`. Renders a `ModelRow` for each.
- `ModelRow` — pure presentation. Takes `model`, `isSelected`, `onClick`. One row.
- `ModelsSectionHeader` — pure: title + "Updated N min ago" + Refresh button. Refresh disabled in `'loading'`.
- `ModelsStaleNotice` — pure: takes `staleId`, `onDismiss`. Single banner row.
- `ModelsEmptyState`, `ModelsErrorState`, `ModelsLoadingState`, `ModelsIdleState` — small pure components. (Or inlined in ModelsSection if trivial; only `ModelsErrorState` has nontrivial copy mapping the reason to text.)
- `modelCatalogStore` — Zustand store. Single source of truth for catalog + selection state across the app. No persistence side effects in the store itself; persistence is the consumer's responsibility (mirrors `apiKeyStore`).
- `nanogptApi.fetchCatalog` — semantic wrapper around the same `/v1/models` request `validateKey` already makes. Same return shape.
- `settingsRepo` (extended) — six new methods. Mirrors the 4.1 pattern.

**Why a separate store and not a flag on `apiKeyStore`:** the catalog has its own lifecycle (idle/loading/ready/error) that's orthogonal to the key state machine. Coupling them produces a 4×4 = 16-state matrix; keeping them separate keeps each store's transitions linear. They communicate by having `apiKeyStore.clear()` cascade-call `modelCatalogStore.reset()` (and `settingsRepo.deleteModelCatalog/SelectedModelId`).

**Why not auto-fetch on boot:** even with a saved key blob, hitting `/v1/models` on every page load is hidden network traffic. Users explicitly Refresh when they want fresh data; otherwise the cached snapshot suffices. The cost is "the catalog might be days/weeks old" — fine, since NanoGPT's catalog is stable. The benefit is "the app never makes a paid API request the user didn't initiate."

**Why the `validateKey` / `fetchCatalog` split:** they hit the same endpoint with the same auth, but they're invoked at different points and parsed for different purposes. The split is purely for readability at the call site — `if (validateKey(k).ok)` reads as "is this key valid?" and `fetchCatalog(k)` reads as "give me the catalog." Both wrap a private `getModels(apiKey, signal)` that does the actual work; the two are aliases on the success path. (The result type is also identical; `fetchCatalog` simply re-exports the same `ValidateKeyResult` under the more specific name `ModelsFetchResult`.)

## 4. Domain, types & storage

### 4.1 Domain type

`src/domain/ai.ts` (new file):

```ts
export type Model = {
  readonly id: string;
};
```

A standalone module because 4.3+ will likely extend it (provider, contextLen, pricing). Keeps the type stable in the domain layer rather than buried in a feature. Re-exported from `src/domain/index.ts`.

### 4.2 SettingsRecord variants

`src/storage/db/schema.ts`:

```ts
export type SettingsRecord =
  | ...existing four variants from 4.1...
  | {
      readonly key: 'modelCatalog';
      readonly value: {
        readonly models: readonly { readonly id: string }[];
        readonly fetchedAt: number;
      };
    }
  | { readonly key: 'selectedModelId'; readonly value: string };
```

`fetchedAt` is `Date.now()` at fetch time. Used by the UI's "Updated N min ago" text. Inert outside that.

### 4.3 IDB schema — no migration

The `settings` store already exists. Both new records are additive variants of `SettingsRecord`; no schema bump. `CURRENT_DB_VERSION` stays at 5.

### 4.4 Validators

```ts
function isValidModelCatalogValue(v: unknown): v is { models: readonly { id: string }[]; fetchedAt: number } {
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

Same defensive-read pattern as 4.1's `isValidApiKeyValue`.

### 4.5 SettingsRepository extensions

```ts
export type ModelCatalogSnapshot = {
  readonly models: readonly Model[];
  readonly fetchedAt: number;
};

export type SettingsRepository = {
  // ...existing 11 methods from 4.1...
  getModelCatalog(): Promise<ModelCatalogSnapshot | undefined>;
  putModelCatalog(snapshot: ModelCatalogSnapshot): Promise<void>;
  deleteModelCatalog(): Promise<void>;
  getSelectedModelId(): Promise<string | undefined>;
  putSelectedModelId(id: string): Promise<void>;
  deleteSelectedModelId(): Promise<void>;
};
```

`putModelCatalog` overwrites any existing record (db.put semantics). `deleteX` removes. `getX` returns `undefined` when no record exists or when the validator rejects.

### 4.6 `modelCatalogStore`

`src/features/ai/models/modelCatalogStore.ts`:

```ts
import { create } from 'zustand';
import type { Model } from '@/domain';

export type CatalogState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly models: readonly Model[]; readonly fetchedAt: number }
  | { readonly kind: 'error'; readonly reason: 'invalid-key' | 'network' | 'other' };

type RefreshErrorReason = 'invalid-key' | 'network' | 'other';

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
  setLoading: () => { set({ state: { kind: 'loading' } }); },
  setReady: (models, fetchedAt) => {
    set({ state: { kind: 'ready', models, fetchedAt }, lastRefreshError: null });
  },
  setError: (reason) => { set({ state: { kind: 'error', reason } }); },
  setRefreshFailureWithCache: (reason) => {
    // Keeps existing 'ready' state.models intact; only sets the error flag.
    const cur = get().state;
    if (cur.kind !== 'ready') return;
    set({ lastRefreshError: reason });
  },
  setSelectedId: (id) => { set({ selectedId: id }); },
  setStaleNotice: (id) => { set({ staleNotice: id }); },
  reset: () => {
    set({ state: { kind: 'idle' }, selectedId: null, staleNotice: null, lastRefreshError: null });
  },
}));

export function useCatalogState(): CatalogState { return useModelCatalogStore((s) => s.state); }
export function useSelectedModelId(): string | null { return useModelCatalogStore((s) => s.selectedId); }
export function useStaleNotice(): string | null { return useModelCatalogStore((s) => s.staleNotice); }

/** Synchronous accessor for non-React consumers (e.g., chat fetch in 4.3+). */
export function getCurrentSelectedModelId(): string | null {
  return useModelCatalogStore.getState().selectedId;
}
```

### 4.7 `nanogptApi` extension

`src/features/ai/key/nanogptApi.ts` is refactored so the existing `validateKey` and a new `fetchCatalog` share a private `getModels`:

```ts
// existing public surface from 4.1 stays:
export async function validateKey(apiKey: string, signal?: AbortSignal): Promise<ValidateKeyResult> {
  return getModels(apiKey, signal);
}

// new:
export type ModelsFetchResult = ValidateKeyResult;
export async function fetchCatalog(apiKey: string, signal?: AbortSignal): Promise<ModelsFetchResult> {
  return getModels(apiKey, signal);
}

async function getModels(apiKey: string, signal?: AbortSignal): Promise<ValidateKeyResult> {
  // ... existing validateKey body verbatim ...
}
```

No behavior change for 4.1 callers. Net: one new export.

### 4.8 Cascade on key removal

`SettingsView.handleRemove` (existing 4.1 flow) is extended:

```ts
const handleRemove = async (): Promise<void> => {
  if (!window.confirm('...')) return;
  if (state.kind === 'unlocked' || state.kind === 'locked') {
    await settingsRepo.deleteApiKeyBlob();
  }
  // NEW: cascade to model catalog
  await Promise.all([
    settingsRepo.deleteModelCatalog(),
    settingsRepo.deleteSelectedModelId(),
  ]);
  useModelCatalogStore.getState().reset();
  // existing:
  clear();
  setShowUpgradeForm(false);
};
```

Confirm dialog text remains the existing one ("Remove API key from this device? You'll need to re-enter it next time."). Removing the key implies the catalog is no longer usable; the cascade is silent and obvious.

## 5. UI surface

### 5.1 ModelsSection placement

Inside the existing `<section className="settings-view__section">` containing the API key section, *as a sibling* below the API key UI. (Single section h2 was "API key" — rename or split. Decision: split into two `<section>`s, one per topic, each with its own h2. Cleaner semantics, easier accessibility.) Visible only when `apiKeyStore.state.kind` is `'session'` or `'unlocked'`.

```
┌────────────────────────────────────────────────────────┐
│ Settings                                                │
├────────────────────────────────────────────────────────┤
│                                                         │
│ API key                                                 │
│ [API key form / status card / unlock form]              │
│                                                         │
│ Models                                          [Refresh]│
│ Updated 5 minutes ago                                   │
│                                                         │
│ ⚠ Your previous selection 'gpt-foo' is no longer       │
│    available. Pick another model below.            [×]  │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐│
│ │ ◉  chatgpt-4o-latest                                ││
│ ├─────────────────────────────────────────────────────┤│
│ │ ○  claude-sonnet-4-5                                ││
│ ├─────────────────────────────────────────────────────┤│
│ │ ○  gemini-2.5-pro                                   ││
│ │ ...                                                 ││
│ └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 5.2 States

| State | UI |
|---|---|
| Hidden | `apiKeyStore.state.kind ∈ {'none','locked'}` — the entire ModelsSection does not render. |
| `'idle'` (no fetch yet, no cache) | "Refresh to load available models." + Refresh button enabled. |
| `'loading'` | Spinner + "Loading models…". Refresh disabled. |
| `'ready'`, models.length > 0 | Header + (optional staleNotice) + ModelList with rows. Refresh enabled. |
| `'ready'`, models.length === 0 | "NanoGPT returned no models. Check your account or refresh later." + Refresh enabled. |
| `'error'`, cached snapshot present | List of *cached* rows + small inline banner: "Couldn't refresh — using last-known list (N min old)." + Refresh enabled. |
| `'error'`, no cached snapshot | Error message (mapped from reason — see §6.4). + Refresh enabled. |

The "cached snapshot present" case is implemented via the `lastRefreshError` field defined in §4.6: when a refresh fails *while* `state.kind === 'ready'`, the caller invokes `setRefreshFailureWithCache(reason)` which keeps `state` intact (cache visible) and only flips `lastRefreshError`. The next successful `setReady` clears it.

```
At any time → setLoading() → state = 'loading'
On success     → setReady(models, fetchedAt) → state = 'ready', lastRefreshError = null
On failure     → if state was 'ready':                       (cache present)
                    setRefreshFailureWithCache(reason)
                      → state.kind stays 'ready', lastRefreshError = reason
                  else:
                    setError(reason) → state = 'error'
```

### 5.3 Refresh button

In `ModelsSectionHeader`. Pure click handler. Uses `getCurrentApiKey()` from `apiKeyStore` to get the in-memory key; if (somehow) null, it falls back to setting the error state — but in practice the button is only visible when the section is rendered, which requires `apiKeyStore.state.kind ∈ {'session','unlocked'}`, both of which guarantee a key.

### 5.4 Auto-fetch on key flows

`SettingsView.handleEntrySubmit` after `setSession(input.key)` or `setUnlocked(input.key)` and before returning `{ok:true}`:

```ts
void refreshCatalog(input.key);  // fire-and-forget; UI shows loading→ready async
```

Same for `handleUnlockSubmit` after `setUnlocked(key)`. The session→save upgrade path also runs it (the key didn't change but the catalog might be stale; refreshing on user action is fine).

`refreshCatalog(apiKey)` is a small helper inside `SettingsView` (or extracted to `models/refreshCatalog.ts`) that:
1. Calls `useModelCatalogStore.getState().setLoading()`.
2. `await fetchCatalog(apiKey)`.
3. On `{ok:true, models}`: persists snapshot via `settingsRepo`, calls `setReady(models, Date.now())`, runs the stale-selection check (see §6.3).
4. On `{ok:false, reason}`: branches on whether cache exists (calls `setRefreshFailureWithCache` or `setError`).

Decision: extract to a dedicated module `src/features/ai/models/refreshCatalog.ts` so SettingsView remains a thin composition layer. The module takes the deps it needs (settingsRepo, store, fetchCatalog) — easy to test in isolation.

### 5.5 Selection click

```ts
async function onSelect(model: Model): Promise<void> {
  store.setSelectedId(model.id);
  store.setStaleNotice(null);
  await settingsRepo.putSelectedModelId(model.id);
}
```

Errors from IDB write are caught at the boundary (`console.error`); in-memory state is not rolled back. A subsequent Refresh or reload will reconcile if the write was lost.

### 5.6 Boot hydration

`App.tsx` boot extends to:

```ts
const [persistedView, prefs, hintShown, apiKeyBlob, catalogSnapshot, selectedId] = await Promise.all([
  wiring.settingsRepo.getView(),
  wiring.readerPreferencesRepo.get(),
  wiring.settingsRepo.getFocusModeHintShown(),
  wiring.settingsRepo.getApiKeyBlob(),
  wiring.settingsRepo.getModelCatalog(),
  wiring.settingsRepo.getSelectedModelId(),
]);
if (apiKeyBlob) useApiKeyStore.getState().markLocked();
if (catalogSnapshot) {
  useModelCatalogStore.getState().setReady(catalogSnapshot.models, catalogSnapshot.fetchedAt);
}
if (selectedId !== undefined) {
  useModelCatalogStore.getState().setSelectedId(selectedId);
}
```

Boot does NOT call `fetchCatalog`. `selectedId` is hydrated even if the cached `catalogSnapshot.models` doesn't contain it — at boot the catalog might be days old and we shouldn't drop the user's selection just because they haven't refreshed yet. The next refresh reconciles via the stale-selection flow.

## 6. Data flow & error handling

### 6.1 First-time fetch (after fresh key entry)

```
User submits key in session mode (4.1 flow)
  └─ validateKey succeeds
      └─ apiKeyStore.setSession(key)
      └─ refreshCatalog(key)  [fire-and-forget]
          ├─ store.setLoading()
          ├─ const r = await fetchCatalog(key)
          │   ├─ {ok:true, models}:
          │   │   ├─ snapshot = { models, fetchedAt: Date.now() }
          │   │   ├─ await settingsRepo.putModelCatalog(snapshot)
          │   │   └─ store.setReady(models, snapshot.fetchedAt)
          │   └─ {ok:false, reason}:
          │       └─ store.setError(reason)   (no cache yet)
          └─ done
```

### 6.2 Manual refresh (cached snapshot exists)

```
User clicks Refresh
  └─ const key = getCurrentApiKey()  [from apiKeyStore]
  └─ if (!key) → setError('invalid-key'); return  (defensive)
  └─ store.setLoading()
  └─ const r = await fetchCatalog(key)
      ├─ {ok:true, models}:
      │   └─ persist + setReady (same as 6.1)
      │   └─ runStaleSelectionCheck(store, settingsRepo)
      └─ {ok:false, reason}:
          └─ if cache present (state was 'ready' before):
                store.setRefreshFailureWithCache(reason)
                  → keeps state.kind = 'ready'
                  → sets lastRefreshError = reason
                  → UI shows banner above list
             else:
                store.setError(reason)
                  → state.kind = 'error'
```

### 6.3 Stale-selection check

```
runStaleSelectionCheck:
  const sel = store.selectedId
  const models = store.state.kind === 'ready' ? store.state.models : []
  if (sel !== null && !models.find(m => m.id === sel)):
    store.setSelectedId(null)
    store.setStaleNotice(sel)
    await settingsRepo.deleteSelectedModelId()
```

Only runs after a *successful* refresh (`setReady`). On error, we don't drop the selection (the user might re-establish connectivity and the model is still actually in the catalog — we just couldn't reach it).

### 6.4 Error reason → user-facing message

`messageForCatalogError(reason, hasCache, fetchedAtMs)`:

| reason | hasCache | message |
|---|---|---|
| `'invalid-key'` | false | "NanoGPT rejected the key. Try removing it and entering it again." |
| `'invalid-key'` | true | "Couldn't refresh — NanoGPT rejected the key. Using the last-known list (N min old)." |
| `'network'` | false | "Couldn't reach NanoGPT. Check your connection and try Refresh again." |
| `'network'` | true | "Couldn't refresh — network error. Using the last-known list (N min old)." |
| `'other'` | false | "Unexpected response from NanoGPT. Try Refresh again." |
| `'other'` | true | "Couldn't refresh — unexpected error. Using the last-known list (N min old)." |

Pure function in `src/features/ai/models/messages.ts`. Tested.

### 6.5 Removal cascade

```
User clicks Remove on the API key (4.1 flow, extended in this phase)
  └─ confirm
  └─ if state was 'unlocked' or 'locked':
       await settingsRepo.deleteApiKeyBlob()
  └─ await Promise.all([
       settingsRepo.deleteModelCatalog(),
       settingsRepo.deleteSelectedModelId(),
     ])
  └─ useApiKeyStore.getState().clear()
  └─ useModelCatalogStore.getState().reset()
```

Order matters slightly: clear stores last (after IDB writes complete) so consumers don't briefly observe "key gone but catalog still ready" or vice-versa.

### 6.6 Error surfaces

| Failure | Handling |
|---|---|
| `fetchCatalog` 401/403 → `'invalid-key'` | If cache: banner + cached list. If not: full error state. (4.1's invariant: if we just validated the key, we should not see 401 immediately. Only happens on a refresh much later when NanoGPT revoked the key.) |
| `fetchCatalog` network error | Same shape, with a different message. |
| `fetchCatalog` 5xx | Same shape, generic message. |
| `settingsRepo.putModelCatalog` IDB write fails | Caught at boundary; `console.error`. In-memory store *is* updated; on reload, the persisted snapshot will be missing but the next refresh restores it. Acceptable. |
| `settingsRepo.putSelectedModelId` IDB write fails | Caught at boundary; `console.error`. Same recovery: in-memory selection holds; reload loses it, user re-selects. |
| User clicks Refresh while a previous Refresh is in flight | The store is in `'loading'`; the button is disabled. No double-submit possible. |
| User opens Settings in two tabs, refreshes in one | Other tab's IDB read on next reload picks up the new snapshot. We don't broadcast IDB changes across tabs in v1. |
| Cached snapshot has malformed models on read | Validator drops; `getModelCatalog()` returns `undefined`; store stays `'idle'` until next refresh. Logged via `console.warn`. |

### 6.7 State invariants

- `modelCatalogStore.state.kind === 'ready'` ⇔ `state.models` is the source of truth for the catalog.
- `modelCatalogStore.selectedId !== null` does NOT imply the id is in `state.models`. It means "the user picked it last time"; reconciliation happens on the next *successful* Refresh.
- `staleNotice !== null` ⇔ a recent refresh dropped the selection. Cleared by: clicking dismiss, or clicking any model row.
- `lastRefreshError !== null` ⇔ the most recent refresh failed but cached models exist. Cleared by next successful Refresh.
- `apiKeyStore.state.kind ∈ {'none','locked'}` ⇒ ModelsSection is not rendered. This is enforced at the SettingsView level; `modelCatalogStore` itself doesn't depend on the key state.
- Removing the API key cascades a `reset()` on `modelCatalogStore` — never leave a catalog without its key.
- `getCurrentSelectedModelId()` is the contract for 4.3+ chat code. It returns the id (or null). Whether the id is in the live catalog is a 4.3 concern (4.3 will also read `useCatalogState()` to detect "selection valid?" for its UI).

## 7. Testing

### 7.1 Unit tests (Vitest + happy-dom)

| File | Scope |
|---|---|
| `src/storage/repositories/settings.test.ts` (extend) | `modelCatalog` round-trip; corrupt records (missing `models` array, non-array, models with non-string id, missing `fetchedAt`, non-finite `fetchedAt`) drop to `undefined`. `selectedModelId` round-trip; empty string drops. `delete*` methods clear records. |
| `src/features/ai/models/modelCatalogStore.test.ts` (new) | Initial state `{kind:'idle'}` + `selectedId:null` + `staleNotice:null` + `lastRefreshError:null`. Transitions through `setLoading`/`setReady`/`setError`/`setSelectedId`/`setStaleNotice`/`setRefreshFailureWithCache`/`reset`. Selectors `useCatalogState`/`useSelectedModelId`/`useStaleNotice` subscribe correctly. `getCurrentSelectedModelId()` accessor. |
| `src/features/ai/key/nanogptApi.test.ts` (extend) | `fetchCatalog` is a public alias of the same `/v1/models` call. Reuses the existing 10 mock-fetch assertions; adds a sanity check that `fetchCatalog` and `validateKey` produce identical results for the same response. |
| `src/features/ai/models/messages.test.ts` (new) | `messageForCatalogError` covers all 6 reason×hasCache combinations; uses `fetchedAtMs` to format the relative time. |
| `src/features/ai/models/refreshCatalog.test.ts` (new) | Successful fetch persists snapshot + setReady. Failed fetch with no cache → setError. Failed fetch with cache → setRefreshFailureWithCache; cached models stay. Stale-selection flow: success returning catalog without persisted selection → selectedId clears + staleNotice set + IDB selection deleted. |
| `src/features/ai/models/ModelRow.test.tsx` (new) | Renders `model.id`; `aria-pressed` matches `isSelected`; click calls `onClick(model)`. |
| `src/features/ai/models/ModelList.test.tsx` (new) | Renders `n` rows for `n` models; selected row has `aria-pressed='true'`; clicking a non-selected row calls `onSelect(model)`. |
| `src/features/ai/models/ModelsSection.test.tsx` (new) | State-driven rendering: `'idle'` → "Refresh to load…" + button enabled; `'loading'` → "Loading models…" + button disabled; `'ready'` non-empty → list; `'ready'` empty → empty state; `'error'` no cache → error state with mapped message; `'ready'` + `lastRefreshError` → list + inline banner; refresh-click invokes `refreshCatalog` with mocked fetch + transitions; selection-click persists + clears staleNotice; stale-notice dismiss clears it. |
| `src/features/ai/settings/SettingsView.test.tsx` (extend) | ModelsSection hidden in `'none'` and `'locked'` key states; visible in `'session'` and `'unlocked'`. Cascade test: removing the key clears catalog + selection from store and IDB. Auto-fetch on key entry (mock `fetchCatalog` returning models) populates the store within waitFor. |
| `src/app/App.tsx` boot — covered by an extension to `src/app/App.test.tsx` if present, otherwise by the E2E load-and-select spec which reload-tests boot hydration. |

### 7.2 E2E tests (Playwright)

| File | Coverage |
|---|---|
| `e2e/settings-models-load-and-select.spec.ts` | Mock `/v1/models` returning 3 models. Enter session-mode key. ModelsSection renders with all 3 rows. Click first row → highlighted. Reload → still highlighted (boot hydration of selection + cached catalog). |
| `e2e/settings-models-refresh.spec.ts` | First mock returns 2 models. After page loads, second mock returns 4 models. Click Refresh → list updates. "Updated …" header refreshes. |
| `e2e/settings-models-stale-selection.spec.ts` | First mock returns models including `'model-x'`. User selects `'model-x'`. Second mock returns models *without* `'model-x'`. Click Refresh → stale notice appears with the dropped id. Selection is null (no row highlighted). Clicking any row clears the notice and selects that row. |
| `e2e/settings-models-error.spec.ts` | First mock returns 200 (cache populated). Second mock returns 500. Refresh → list still visible + inline banner. Third mock returns 200 → banner clears, list updates. |
| `e2e/settings-models-error-no-cache.spec.ts` | First mock returns 500. Enter session key. Section shows full error state (no cached list). Mock returns 200 → click Refresh → list appears. |
| `e2e/settings-models-cascade-on-key-remove.spec.ts` | Save key (encrypted) + refresh catalog + select a model. Reload → still selected (boot hydration). Remove key with confirm → reload → catalog gone, selection gone, ModelsSection hidden (back to entry form). |
| `e2e/settings-models-hidden-when-locked.spec.ts` | Save key + select a model. Reload (key now locked). ModelsSection should be hidden. Unlock with passphrase → ModelsSection appears. |

### 7.3 Skipped intentionally

- Auto-fetch unit assertion at SettingsView level — the auto-fetch is fire-and-forget; we test `refreshCatalog` directly and the SettingsView extension covers via mock + waitFor only.
- Provider derivation (out of scope).
- Multi-tab sync (same single-tab assumption).
- Real NanoGPT round-trip (always mocked).
- Concurrent refresh (button-disable invariant).
- Per-book selection (out of scope).

### 7.4 Test fixtures

- `crypto.subtle` is available in happy-dom (verified Phase 4.1).
- `fetch` mocked via `vi.fn()` in unit tests, `page.route()` in E2E.
- No new book fixtures.

## 8. File map

**New files:**
- `src/domain/ai.ts` — `Model` type
- `src/features/ai/models/modelCatalogStore.ts`
- `src/features/ai/models/modelCatalogStore.test.ts`
- `src/features/ai/models/refreshCatalog.ts`
- `src/features/ai/models/refreshCatalog.test.ts`
- `src/features/ai/models/messages.ts`
- `src/features/ai/models/messages.test.ts`
- `src/features/ai/models/ModelsSection.tsx`
- `src/features/ai/models/models-section.css`
- `src/features/ai/models/ModelsSection.test.tsx`
- `src/features/ai/models/ModelList.tsx`
- `src/features/ai/models/ModelList.test.tsx`
- `src/features/ai/models/ModelRow.tsx`
- `src/features/ai/models/ModelRow.test.tsx`
- 7 E2E specs under `e2e/`

**Modified files:**
- `src/storage/db/schema.ts` — extend `SettingsRecord` with `modelCatalog` + `selectedModelId` variants
- `src/storage/repositories/settings.ts` — six new methods + two validators; export `ModelCatalogSnapshot`
- `src/storage/repositories/settings.test.ts` — extend
- `src/storage/index.ts` — export `ModelCatalogSnapshot`
- `src/domain/index.ts` — re-export `Model`
- `src/features/ai/key/nanogptApi.ts` — promote body to private `getModels`; add `fetchCatalog` alias + `ModelsFetchResult` type
- `src/features/ai/key/nanogptApi.test.ts` — extend (sanity check)
- `src/features/ai/settings/SettingsView.tsx` — render `ModelsSection`; extend `handleEntrySubmit`/`handleUnlockSubmit` with `void refreshCatalog(key)`; extend `handleRemove` with cascade
- `src/features/ai/settings/SettingsView.test.tsx` — extend
- `src/app/App.tsx` — boot `Promise.all` extends with `getModelCatalog` + `getSelectedModelId`; hydrate store before `setBoot('ready')`

## 9. Migration & compatibility

- `SettingsRecord` extended with two additive variants. Existing records (librarySort, storagePersistResult, view, focusModeHintShown, apiKey from 4.1) narrow correctly. `CURRENT_DB_VERSION` stays at 5.
- The catalog snapshot format is forward-compatible: `models` is an array of `{id}`, and we'll just ignore unknown fields if NanoGPT adds them. If we ever extend `Model` with `provider`/`contextLen`, the validator widens; old persisted snapshots without those fields stay valid (we treat them as undefined and the UI degrades gracefully).
- `nanogptApi`'s public surface changes: `validateKey` keeps its exact behavior; `fetchCatalog` is added; both are aliases of a private `getModels`. No breaking changes.
- `apiKeyStore` unchanged. `modelCatalogStore` is additive.
- Boot ordering: 6 parallel reads instead of 4. Adds zero serial latency (limited by slowest fetch); two extra IDB reads. Negligible.
- No domain-type refactors. No engine adapter touches.

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| NanoGPT's `/v1/models` returns 50+ models and the list-of-rows feels long | Acceptable for v1. Visual scan still works. If we ever see 100+, add a search input — but not now (YAGNI). |
| User selects a model in 4.2 that 4.3's chat panel can't actually use (e.g., embedding-only model) | Out of scope for 4.2. 4.3 will validate against capability when it has metadata; for now, "all models" is what 4.2 surfaces. |
| Cached catalog is very stale (weeks/months) and silently wrong | "Updated N ago" header makes age visible. User can Refresh. We don't auto-purge old caches; that's not a real problem given NanoGPT's catalog is stable. |
| User has their key removed in another tab; this tab's `apiKeyStore` is still in `'unlocked'`; Refresh sends a 401 | Same multi-tab caveat as 4.1. Documented limitation. The 401 surfaces normally as `'invalid-key'`. |
| Stale-selection flow could surprise a user who didn't realize a refresh would drop their selection | Notice is explicit: shows the dropped id. User has to take an action (pick another or dismiss). Not silent. |
| `lastRefreshError` adds a fifth state-shape field that needs careful handling | Tested independently; UI explicitly checks for it in the `'ready'` branch. The store's setters guard the transitions. |
| `fetchCatalog` and `validateKey` look duplicative | They share `getModels`; only the public surface is doubled. Tests assert behavior parity. The doubled surface buys readability at call sites. |
| Boot hydration without auto-fetch means users always see a stale catalog until they Refresh | Acceptable. The whole reason to have a snapshot is to avoid network on every boot. The "last refreshed N ago" label communicates freshness; auto-fetch would defeat the no-hidden-uploads commitment. |

**Open questions (non-blocking, resolved during implementation):**
- Whether to debounce or rate-limit Refresh clicks (lean: no — the loading state already disables the button mid-flight; further rate-limiting is YAGNI for a manual user action).
- Whether to show an info chip explaining "Updated N ago" reflects local time, not NanoGPT server time (lean: no — implicit and unimportant).
- Whether to extract `<MutedRow>` styling shared between bookmarks/notes/models or duplicate (lean: duplicate for now; extract if a third use case appears).

## 11. Acceptance criteria

A working build of this PR satisfies:

1. ✅ Settings page shows a "Models" section below "API key", visible only when `apiKeyStore` state is `'session'` or `'unlocked'`.
2. ✅ After entering a valid API key (session mode), the Models section auto-loads and shows the catalog. After save+unlock, same behavior.
3. ✅ Each model is a selectable row; clicking selects it; the selected row is visually highlighted.
4. ✅ Selection persists across reload (boot hydrates from `selectedModelId`).
5. ✅ Catalog snapshot persists across reload (boot hydrates from `modelCatalog`).
6. ✅ Refresh button re-fetches; loading and ready states render correctly.
7. ✅ Refresh failure with cached snapshot shows inline banner without dropping the list.
8. ✅ Refresh failure with no cached snapshot shows full error state.
9. ✅ Stale-selection: refreshing to a catalog without the chosen id drops the selection and surfaces a dismissible notice.
10. ✅ Empty catalog (`/v1/models` returns `data: []`) shows the empty state.
11. ✅ Removing the API key cascades: catalog + selection wiped from IDB and the in-memory store.
12. ✅ Mobile (390×844): Models section is reachable; rows are tappable; refresh and selection work.
13. ✅ All copy is honest about where state comes from ("Updated N ago", explicit error messages).
14. ✅ Type-check, lint, build, all unit tests, all E2E tests pass.
15. ✅ Architecture decision history + roadmap status updated.
