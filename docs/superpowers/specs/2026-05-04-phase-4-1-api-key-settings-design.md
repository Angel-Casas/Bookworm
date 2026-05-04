# Phase 4.1 — API key settings design

**Status:** approved 2026-05-04
**Roadmap:** `docs/04-implementation-roadmap.md` Phase 4 → Task 4.1
**Predecessors:** Phase 3.4 notebook (introduced `'settings'`-style top-level `AppView` extension pattern, `src/shared/icons/` module, `useAppView.goX` helpers)
**Architecture decisions referenced:** `docs/02-system-architecture.md` Phase 0 decision history (API key persistence: passphrase-encrypted via WebCrypto PBKDF2 + AES-GCM; session-only otherwise) and `docs/03-ai-context-engine.md` (NanoGPT OpenAI-compatible at `/v1/models`, `/v1/chat/completions`, `/v1/embeddings`).

## 1. Goal & scope

Ship Phase 4.1 — the user can add, save, unlock, and remove their NanoGPT API key from a dedicated Settings view. Two storage modes (session-only by default, passphrase-encrypted on device) per the locked architecture decision. Validation hits `/v1/models` on submit so typos fail fast. The key entry UX is the foundation that 4.2/4.3/4.4 build on; this phase wires everything from raw key input through cryptographic persistence to in-memory availability for downstream AI features (none of which ship in 4.1).

**In scope (v1, this phase):**
- New `AppView` kind: `'settings'`. Persists across reload (same as library/reader/notebook). Accessible via a Settings icon in the library chrome (top-right, next to Import). Closes back to library via an explicit Close button.
- Settings page renders a single section in this phase: **API key**. Future settings (model preset, etc.) will land in this same page in 4.2.
- API key form: masked input + show-toggle, mode segmented control ("Use this session" / "Save on this device"), conditional passphrase field, Submit button.
- On submit: validate against `/v1/models`. On 200, save to chosen surface (in-memory store for session, encrypted IDB record for saved). On error, inline message; no save.
- Four key states surfaced clearly in the Settings page: **None / Session active / Saved + unlocked / Saved + locked**. Each shows the appropriate primary action.
- Cold-start unlock: if a saved encrypted blob exists at app boot, the Settings page shows "Unlock" (passphrase form) instead of the entry form. AI features elsewhere will read this state in later phases; in 4.1 nothing else consumes it yet.
- Remove key: confirmation dialog; on confirm, wipes IDB blob (if saved) + memory. Settings stays open, returns to "None" state.
- Crypto: WebCrypto PBKDF2 (SHA-256, 600k iterations) → derived 256-bit key → AES-GCM encryption of the API key bytes. Salt + IV stored alongside the ciphertext in IDB; passphrase never persisted.
- All copy is privacy-forward: explicit about what's stored, where, and what session-only means.
- The AI key in-memory store exposes a small handle (`getCurrentApiKey()`, `useApiKeyState()`, etc.) for 4.3+ to consume, but no consumer in this phase.

**Out of scope (deferred):**
- Model catalog fetch + UI (Task 4.2).
- Chat panel (Task 4.3) and any actual chat requests beyond the validation `GET /v1/models`.
- Passage mode (Task 4.4).
- Provider switcher (only NanoGPT supported per PRD).
- Key rotation UX beyond "remove + add a new one."
- Multi-key support (only one active key at a time).
- Per-key model preferences (deferred to 4.2's preset system).
- Biometric / WebAuthn unlock (passphrase only).
- "Forgot passphrase" recovery (same answer as a deleted key — re-enter from NanoGPT dashboard).
- Boot-time global modal or banner — Settings is the single surface; AI features get inline empty/locked states later.
- Session-key persistence across page reloads — session = tab/window lifetime, by definition.
- A "test key" button separate from submit — submit IS the test.

## 2. Decisions locked during brainstorming

| Decision | Choice | Reasoning |
|---|---|---|
| Surface | **New `AppView` kind: `'settings'`** | AI settings are global (cross-book, cross-view). Will grow with 4.2's model catalog. A dedicated page scales; a modal would feel cramped once preset/catalog UI lands. |
| Entry point | **Gear button in library chrome** (next to Import) | Library is the app's home base. Reader chrome's existing `⚙` is per-book typography — different concern, kept separate. |
| Entry flow shape | **Single form, conditional passphrase** | Mode toggle (segmented control) reveals passphrase field inline when "Save on this device" is selected. One Submit button. Calm/minimal pattern. |
| Key input affordance | **`<input type="password">` with show-toggle** | Masked by default; eye icon to reveal. Standard pattern; makes pasted keys feel safer. |
| Validation timing | **On submit, blocking** | Fetch `/v1/models` with the entered key. 200 → save. Error → inline message, no save. Catches typos before the user reaches the chat panel. |
| Cold-start unlock | **In Settings only** | No banner, no boot modal. Single source of truth; AI features (4.3+) handle their own "no key / locked" inline empty states. |
| Removal | **Confirm dialog → wipe both surfaces** | "Remove API key from this device? You'll need to re-enter it next time." Single confirm; not zero-friction (key is hard to obtain). |
| Post-removal | **Stay in Settings; transition to "None" state** | User is in the manage-key flow; no teleport. Form re-renders for fresh entry. |
| Crypto | **WebCrypto PBKDF2-SHA256 (600k iterations) → 256-bit derived key → AES-GCM** | Locked in arch doc. 600k matches OWASP 2023 guidance for PBKDF2-SHA256. Salt + IV randomly generated per encryption, persisted alongside ciphertext. |
| Passphrase persistence | **Never** | Locked in arch doc. Held in memory only after unlock; cleared on tab close / reload. |
| Settings persistence | **`view` settings record extended for `'settings'` kind** | Same pattern as library/reader/notebook. Reloading on the Settings view restores it. |
| API-key storage | **New `apiKey` SettingsRecord variant** | Single encrypted blob: `{ kind: 'apiKey', value: { salt, iv, ciphertext, iterations } }`. Session keys never touch IDB. |
| In-memory store | **New Zustand store `apiKeyStore`** | Holds the unlocked key + state. Survives view changes; cleared on reload. Consumers (4.3+) subscribe via `useApiKeyState()`. |
| Validation request | **`GET /v1/models` to NanoGPT base URL** | Cheap, no token cost. Same call 4.2 will use; we discard the response in 4.1 — 4.2 owns the catalog. |
| NanoGPT base URL | **Configured constant** in `src/features/ai/key/nanogptApi.ts` | Locked at `https://nano-gpt.com/api/v1` per the OpenAI-compatible spec. Hardcoded for v1; if we add other providers later, that's a separate decision. |
| First-time copy tone | **Privacy-forward, plain English** | "Your key stays on this device. Use this session keeps it in memory only — closing the tab forgets it. Save on this device encrypts it on disk with your passphrase, which we never store." Spelled out, not jargon. |

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ App.tsx                                                           │
│  view.kind === 'library'  → <LibraryView ... />     (existing)    │
│  view.kind === 'reader'   → <ReaderWorkspace .../>  (existing)    │
│  view.kind === 'notebook' → <NotebookView ... />    (existing)    │
│  view.kind === 'settings' → <SettingsView ... />    NEW           │
│                                                                    │
│ SettingsView                                                       │
│  ├─ SettingsChrome — back button, "Settings" title                │
│  └─ ApiKeySection                                                 │
│      ├─ <ApiKeyForm>     (state: None or Session-upgrade)         │
│      ├─ <UnlockForm>     (state: Saved+Locked)                    │
│      └─ <ApiKeyStatusCard> (state: Session or Unlocked)           │
│         + <RemoveButton> on any non-None state                    │
│                                                                    │
│  Stores:                                                           │
│   apiKeyStore (Zustand)                                           │
│     state: { kind: 'none' }                                       │
│          | { kind: 'session';  key: string }                      │
│          | { kind: 'unlocked'; key: string }                      │
│          | { kind: 'locked' }                                     │
│     setSession(key), setUnlocked(key),                            │
│     markLocked(), clear()                                         │
│                                                                    │
│  Persistence:                                                      │
│   settingsRepo (existing) gains getApiKeyBlob / putApiKeyBlob /   │
│     deleteApiKeyBlob.                                             │
│   apiKeyCrypto module: encryptKey / decryptKey (WebCrypto)        │
│   nanogptApi module: validateKey (GET /v1/models)                 │
└──────────────────────────────────────────────────────────────────┘

Boot integration:
  App.tsx boot promise gains a 4th parallel:
    settingsRepo.getApiKeyBlob() → if present: apiKeyStore.markLocked();
                                   if absent:  remains 'none'
```

**Single-purpose units:**
- `SettingsView` — top-level page; reads from `apiKeyStore`, dispatches form/unlock/remove. Pure composition.
- `ApiKeyForm` — pure presentation. Owns local state for the input fields, mode toggle, error message. Emits `onSubmit({ key, mode, passphrase? })`.
- `UnlockForm` — pure presentation. Local state for passphrase + error. Emits `onSubmit(passphrase)`.
- `apiKeyStore` — Zustand store, single source of truth for key state across the app. No persistence (in-memory only).
- `apiKeyCrypto` — pure async functions over WebCrypto. No state. `encryptKey(key, passphrase)`, `decryptKey(blob, passphrase)`.
- `nanogptApi` — fetch wrapper for the validation call. Returns `{ ok: true; models } | { ok: false; reason: 'invalid-key' | 'network' | 'other'; status? }`.
- `settingsRepo` (extended) — adds three methods around the new `apiKey` SettingsRecord variant. Mirrors the existing pattern.

**Why a Zustand store for the in-memory key:** The key needs to be readable from many places (Settings UI, future chat panel, future model catalog fetcher) and writable from one (Settings). React context would also work but Zustand matches the project's existing pattern (`libraryStore`, `importStore`) and avoids an extra Provider wrapper at the app root.

**Why `apiKeyCrypto` is its own module:** Crypto code benefits from being trivial to read in isolation. A small dedicated file with a focused test surface (encrypt+decrypt round-trip, decrypt with wrong passphrase, decrypt with corrupted blob) is much easier to reason about than mixing it with React state code.

**No new XState machine.** The four key states are flat enough that a Zustand store with discriminated-union state is clearer than a state machine. The transitions are linear (add → session/saved; saved → locked on reload; locked → unlocked on passphrase; any → none on remove); no concurrent flows or guards that would benefit from a chart.

**Boot ordering:** The existing boot in `App.tsx` runs `Promise.all([getView, getPrefs, getFocusModeHintShown])`. We extend the parallel array with `settingsRepo.getApiKeyBlob()`. If a blob is found, we set the store to `'locked'` before `setBoot('ready')`. If not, store stays at `'none'`. This guarantees the Settings UI shows the correct initial state without a flash.

## 4. Domain, types & storage

### 4.1 No new domain entities

The API key is a string. No branded type needed — strings move through one app-internal path (Settings → store → consumers) and one external path (HTTP `Authorization` header). A nominal type would add ceremony without preventing real bugs.

### 4.2 `AppView` extended with `'settings'`

`src/storage/db/schema.ts`:

```ts
export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string }
  | { readonly kind: 'notebook'; readonly bookId: string }
  | { readonly kind: 'settings' };  // NEW — no bookId; settings are global
```

`isValidView` extends to accept `'settings'` as a valid kind with no extra fields.

### 4.3 `SettingsRecord` extended with `apiKey`

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

Single-record-per-key store. Only one API key blob ever; new key replaces the old one.

**Why store iterations alongside the blob:** PBKDF2 iteration counts have crept upward over time (10k → 100k → 600k). Persisting the value used at encryption time means we can decrypt blobs encrypted on older app versions without bumping a migration. Forward-compat is cheap; a 4-byte int next to the blob.

**Why ArrayBuffer (not base64):** IndexedDB's structured-clone serialization stores `ArrayBuffer` natively — no encoding step, no extra bytes.

### 4.4 IDB schema — no migration

The `settings` store already exists. The new `apiKey` record is just another `SettingsRecord` variant; no schema bump. `CURRENT_DB_VERSION` stays at 5.

### 4.5 Validators

`isValidApiKeyValue` runs at read time. Drops corrupt records (returns `null`):

```ts
function isValidApiKeyValue(v: unknown): v is {
  salt: ArrayBuffer;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  iterations: number;
} {
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
```

Same defensive-read pattern as bookmarks/highlights/notes validators.

### 4.6 `SettingsRepository` extensions

```ts
export type ApiKeyBlob = {
  readonly salt: ArrayBuffer;
  readonly iv: ArrayBuffer;
  readonly ciphertext: ArrayBuffer;
  readonly iterations: number;
};

export type SettingsRepository = {
  // ...existing methods...
  getApiKeyBlob(): Promise<ApiKeyBlob | undefined>;
  putApiKeyBlob(blob: ApiKeyBlob): Promise<void>;
  deleteApiKeyBlob(): Promise<void>;
};
```

`putApiKeyBlob` overwrites any existing record (`db.put` semantics). `deleteApiKeyBlob` removes the record. `getApiKeyBlob` returns `undefined` when no record exists or when `isValidApiKeyValue` rejects the stored shape.

## 5. UI surface

### 5.1 New icons

`src/shared/icons/`:
- `SettingsIcon.tsx` — gear outline. Used in library chrome and as the title icon in the Settings page.
- `EyeIcon.tsx` / `EyeOffIcon.tsx` — for the show/hide toggle on the masked key input.

Same hand-authored monochrome SVG conventions as the existing `NotebookIcon` / `NoteIcon` / `ArrowLeftIcon`. Added to the barrel `index.ts`.

### 5.2 `apiKeyStore`

`src/features/ai/key/apiKeyStore.ts`:

```ts
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
  setSession: (key) => set({ state: { kind: 'session', key } }),
  setUnlocked: (key) => set({ state: { kind: 'unlocked', key } }),
  markLocked: () => set({ state: { kind: 'locked' } }),
  clear: () => set({ state: { kind: 'none' } }),
}));

/** Hook: read the current key state. */
export function useApiKeyState(): ApiKeyState {
  return useApiKeyStore((s) => s.state);
}

/**
 * Synchronous accessor for non-React consumers (e.g., chat fetch wrappers
 * in 4.3+). Returns the current key or null if not available.
 */
export function getCurrentApiKey(): string | null {
  const s = useApiKeyStore.getState().state;
  if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
  return null;
}
```

### 5.3 `apiKeyCrypto`

`src/features/ai/key/apiKeyCrypto.ts`. Pure async helpers around `crypto.subtle`. No React, no IDB. Tested in isolation.

```ts
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

### 5.4 `nanogptApi.validateKey`

`src/features/ai/key/nanogptApi.ts`:

```ts
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

The `models` array is returned even though 4.1 doesn't consume it — 4.2 will. We don't cache it here; 4.2 owns the model catalog store.

### 5.5 `ApiKeyForm` (entry / re-entry)

`src/features/ai/key/ApiKeyForm.tsx` — pure presentation.

```ts
type Mode = 'session' | 'save';

type SubmitInput =
  | { readonly mode: 'session'; readonly key: string }
  | { readonly mode: 'save'; readonly key: string; readonly passphrase: string };

type SubmitResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

type Props = {
  readonly onSubmit: (input: SubmitInput) => Promise<SubmitResult>;
  readonly initialMode?: Mode;
  readonly initialKey?: string;
  readonly hideKeyField?: boolean;       // for the session→save upgrade path
  readonly onCancel?: () => void;
};
```

**Layout:**
```
┌─ API key ─────────────────────────────────────────┐
│                                                    │
│ NanoGPT API key                                    │
│ ┌──────────────────────────────────────────┐ ┌──┐  │
│ │ ••••••••••••••••••••••••••••••••••••     │ │👁│  │
│ └──────────────────────────────────────────┘ └──┘  │
│                                                    │
│ Where to keep it                                   │
│ ┌─────────────────────┬──────────────────────────┐ │
│ │ Use this session    │  Save on this device     │ │
│ └─────────────────────┴──────────────────────────┘ │
│                                                    │
│ ↓ when "Save on this device" is selected:          │
│                                                    │
│ Passphrase                                         │
│ ┌──────────────────────────────────────────┐       │
│ │ ••••••••••                                │       │
│ └──────────────────────────────────────────┘       │
│ Used to encrypt your key. Stored only in your      │
│ memory — we'll ask for it when you reload.         │
│                                                    │
│ [error message if submit failed]                   │
│                                                    │
│         [Cancel]              [Save key]           │
└────────────────────────────────────────────────────┘
```

(The `👁` in the diagram is `<EyeIcon />` / `<EyeOffIcon />`, not an emoji.)

**Behavior:**
- Local state: `{ key, mode, passphrase, showKey, isSubmitting, error }`.
- Submit button label is "Use this session" or "Save key" depending on mode.
- Submit flow:
  1. `setIsSubmitting(true); setError(null)`
  2. Call `props.onSubmit({...})`
  3. On `{ ok: true }`: clear local state, parent re-renders into the post-entry state (driven by store).
  4. On `{ ok: false, message }`: `setError(message); setIsSubmitting(false)`.
- Submit is disabled when key is empty (or hidden+missing initialKey), or (mode='save' AND passphrase is empty), or when `isSubmitting`.
- Show-toggle eye icon flips `showKey` and switches `<input type>` between `password` and `text`. Same toggle is *not* offered on the passphrase input — passphrases are typically muscle-memory; revealing them is a different threat model.
- Trim: `key.trim()` at submit. Passphrase is *not* trimmed (explicit).

**Privacy copy** is rendered as small muted text near the segmented control:
> Your key stays on this device. **Use this session** keeps it in memory only — closing the tab forgets it. **Save on this device** encrypts it on disk with your passphrase.

### 5.6 `UnlockForm` (cold-start unlock)

`src/features/ai/key/UnlockForm.tsx` — pure presentation. Used when the store's state is `'locked'` (a saved encrypted blob exists, but the passphrase hasn't been provided this session).

```ts
type Props = {
  readonly onSubmit: (passphrase: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  readonly onRemove: () => void;
};
```

**Layout:**
```
┌─ API key (saved on this device) ──────────────────┐
│                                                    │
│ Enter your passphrase to unlock                    │
│ ┌──────────────────────────────────────────┐       │
│ │ ••••••••••                                │       │
│ └──────────────────────────────────────────┘       │
│                                                    │
│ [error message if wrong passphrase]                │
│                                                    │
│ [Remove saved key]            [Unlock]             │
└────────────────────────────────────────────────────┘
```

**Behavior:**
- On submit: call `onSubmit(passphrase)`. Parent handles decryption + store update.
- On wrong passphrase: `decryptKey` throws (AES-GCM authentication failure). Parent catches, returns `{ ok: false, message: 'Wrong passphrase' }`. Form shows the message.
- "Remove saved key" calls `onRemove`, which opens the same confirm dialog as the post-entry remove flow.

### 5.7 `SettingsView`

`src/features/ai/settings/SettingsView.tsx`. Composes everything:

```ts
type Props = {
  readonly settingsRepo: SettingsRepository;
  readonly onClose: () => void;
};

export function SettingsView({ settingsRepo, onClose }: Props) {
  const state = useApiKeyState();
  const { setSession, setUnlocked, clear } = useApiKeyStore();
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);

  const handleEntrySubmit = async (input: SubmitInput): Promise<SubmitResult> => {
    if (input.mode === 'save' && state.kind === 'session') {
      // Upgrade path: skip re-validation, key already validated this session.
      const blob = await encryptKey(state.key, input.passphrase);
      await settingsRepo.putApiKeyBlob(blob);
      setUnlocked(state.key);
      setShowUpgradeForm(false);
      return { ok: true };
    }
    const result = await validateKey(input.key);
    if (!result.ok) return { ok: false, message: messageFor(result) };
    if (input.mode === 'session') {
      setSession(input.key);
    } else {
      const blob = await encryptKey(input.key, input.passphrase);
      await settingsRepo.putApiKeyBlob(blob);
      setUnlocked(input.key);
    }
    return { ok: true };
  };

  const handleUnlockSubmit = async (passphrase: string) => {
    const blob = await settingsRepo.getApiKeyBlob();
    if (!blob) {
      clear();
      return { ok: false as const, message: 'No saved key found.' };
    }
    try {
      const key = await decryptKey(blob, passphrase);
      setUnlocked(key);
      return { ok: true as const };
    } catch {
      return { ok: false as const, message: 'Wrong passphrase.' };
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (!confirm("Remove API key from this device? You'll need to re-enter it next time.")) return;
    if (state.kind === 'unlocked' || state.kind === 'locked') {
      await settingsRepo.deleteApiKeyBlob();
    }
    clear();
    setShowUpgradeForm(false);
  };

  return (
    <div className="settings-view">
      <SettingsChrome onClose={onClose} />
      <section className="settings-view__section">
        <h2>API key</h2>
        {state.kind === 'none' ? <ApiKeyForm onSubmit={handleEntrySubmit} /> : null}
        {state.kind === 'locked' ? (
          <UnlockForm onSubmit={handleUnlockSubmit} onRemove={handleRemove} />
        ) : null}
        {state.kind === 'session' && !showUpgradeForm ? (
          <ApiKeyStatusCard
            label="Using API key for this session"
            secondaryActionLabel="Save on this device"
            onSecondaryAction={() => setShowUpgradeForm(true)}
            onRemove={handleRemove}
          />
        ) : null}
        {state.kind === 'session' && showUpgradeForm ? (
          <ApiKeyForm
            initialMode="save"
            initialKey={state.key}
            hideKeyField
            onSubmit={handleEntrySubmit}
            onCancel={() => setShowUpgradeForm(false)}
          />
        ) : null}
        {state.kind === 'unlocked' ? (
          <ApiKeyStatusCard label="API key unlocked" onRemove={handleRemove} />
        ) : null}
      </section>
    </div>
  );
}
```

`ApiKeyStatusCard` is a small inline component (or rendered inline in `SettingsView`; it's only ~15 lines). Pure presentation.

`messageFor(ValidateKeyResult)`: maps machine reasons to human strings. `'invalid-key' → 'That key was rejected by NanoGPT (401). Double-check it on your dashboard.'`, etc. Pure function, tested.

### 5.8 `SettingsChrome`

`src/features/ai/settings/SettingsChrome.tsx`. Mirrors `NotebookChrome`. Just a back button + "Settings" title.

```
┌────────────────────────────────────────────────┐
│ ←  Settings                                    │
└────────────────────────────────────────────────┘
```

### 5.9 Library chrome — Settings button

`src/features/library/LibraryChrome.tsx` gains an `onOpenSettings` prop and a Settings button (gear icon) next to the Import button on the right.

```
desktop: Bookworm  [search]              [sort ⌄] [import] [⚙]
mobile:  Bookworm  [search]                       [import] [⚙]
```

Click → `view.goSettings()`.

### 5.10 `App.tsx` — fourth branch

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

`useAppView` gains `goSettings()`. AppView union extension already covered in §4.2.

### 5.11 Boot integration

`App.tsx` boot promise extends to:

```ts
const [persistedView, prefs, hintShown, apiKeyBlob] = await Promise.all([
  wiring.settingsRepo.getView(),
  wiring.readerPreferencesRepo.get(),
  wiring.settingsRepo.getFocusModeHintShown(),
  wiring.settingsRepo.getApiKeyBlob(),
]);
```

Right before `setBoot('ready')`, if `apiKeyBlob` exists, call `useApiKeyStore.getState().markLocked()`. Synchronous; runs before any UI mounts. The Settings page then renders the unlock form on first paint without a flash.

## 6. Data flow & error handling

### 6.1 First-time entry — session mode

```
User opens Settings (state: 'none')
  └─ <ApiKeyForm initialMode='session' />
      └─ User pastes key, clicks "Use this session"
          └─ form.handleSubmit
              └─ SettingsView.handleEntrySubmit({ mode:'session', key })
                  ├─ await validateKey(key)                      [HTTP GET /v1/models]
                  │   └─ { ok:false, reason:'invalid-key' }      → form shows
                  │     "That key was rejected (401). Double-check…"
                  │   └─ { ok:false, reason:'network' }          → form shows
                  │     "Couldn't reach NanoGPT. Check your connection."
                  │   └─ { ok:true, models }                     → continue
                  └─ apiKeyStore.setSession(key)
                      → re-render → state is now 'session'
                      → SettingsView swaps to <ApiKeyStatusCard>
```

### 6.2 First-time entry — save mode

```
User opens Settings (state: 'none')
  └─ <ApiKeyForm initialMode='session' />
      └─ User toggles to "Save on this device"
          └─ Passphrase field appears
              └─ User pastes key + types passphrase, clicks "Save key"
                  └─ form.handleSubmit
                      └─ SettingsView.handleEntrySubmit({ mode:'save', key, passphrase })
                          ├─ await validateKey(key)              [as above]
                          │   └─ on failure: form shows error, no encryption attempted
                          ├─ const blob = await encryptKey(key, passphrase)
                          │   [WebCrypto: PBKDF2 600k → AES-GCM]
                          ├─ await settingsRepo.putApiKeyBlob(blob)
                          └─ apiKeyStore.setUnlocked(key)
                              → re-render → state is 'unlocked'
                              → SettingsView swaps to <ApiKeyStatusCard label="API key unlocked">
```

### 6.3 Cold-start unlock

```
App boot
  ├─ Promise.all([... , settingsRepo.getApiKeyBlob()])
  └─ if (apiKeyBlob) useApiKeyStore.getState().markLocked()

User opens Settings (state: 'locked')
  └─ <UnlockForm />
      └─ User types passphrase, clicks "Unlock"
          └─ form.handleSubmit
              └─ SettingsView.handleUnlockSubmit(passphrase)
                  ├─ const blob = await settingsRepo.getApiKeyBlob()
                  │   └─ undefined (rare race; blob removed elsewhere)
                  │     → store.clear() + form shows "No saved key found"
                  ├─ try await decryptKey(blob, passphrase)
                  │   └─ throws (AES-GCM auth failure on wrong passphrase
                  │      OR DOMException on corrupted blob)
                  │     → form shows "Wrong passphrase"
                  └─ apiKeyStore.setUnlocked(decryptedKey)
                      → re-render → state is 'unlocked'
                      → SettingsView swaps to <ApiKeyStatusCard>
```

### 6.4 Session → save upgrade

```
User in 'session' state
  └─ <ApiKeyStatusCard label="Using API key for this session"
                       secondaryAction={"Save on this device"} />
      └─ User clicks "Save on this device"
          └─ SettingsView local state: showUpgradeForm = true
              └─ <ApiKeyForm initialMode='save'
                              initialKey={state.key}
                              hideKeyField
                              />
                  └─ User types passphrase, clicks "Save key"
                      └─ form.handleSubmit
                          └─ handleEntrySubmit({ mode:'save', key, passphrase })
                              [no re-validation: key already validated this session]
                              ├─ encryptKey + putApiKeyBlob
                              └─ apiKeyStore.setUnlocked(key)
                                  → state transitions session → unlocked
```

The upgrade path skips re-validation (the key was validated when entered as session). A small efficiency; reduces friction for users who decide to save partway through.

### 6.5 Removal

```
User clicks "Remove" on any non-None state
  └─ window.confirm("Remove API key from this device? …")
      └─ false → no-op
      └─ true:
          ├─ if state was 'unlocked' or 'locked':
          │   └─ await settingsRepo.deleteApiKeyBlob()
          ├─ apiKeyStore.clear()
          │   → state is 'none'
          │   → SettingsView swaps back to <ApiKeyForm>
          └─ done
```

### 6.6 Error surfaces

| Failure | Handling |
|---|---|
| `validateKey` returns `{ok:false, reason:'invalid-key'}` | Form shows: "That key was rejected by NanoGPT (401). Double-check it on your NanoGPT dashboard." No save. |
| `validateKey` returns `{ok:false, reason:'network'}` | Form shows: "Couldn't reach NanoGPT. Check your connection and try again." No save. |
| `validateKey` returns `{ok:false, reason:'other', status: N}` | Form shows: "NanoGPT returned an unexpected error (status N). Try again in a moment." No save. |
| `encryptKey` throws (impossible in practice — WebCrypto failure modes are exotic) | Caught at the SettingsView boundary; form shows: "Couldn't encrypt your key. Reload and try again." `console.error` for diagnostics. |
| `settingsRepo.putApiKeyBlob` throws (IDB transaction failure) | Caught at boundary; form shows: "Couldn't save your key. Reload and try again." Store **does not** transition; user sees the form again. |
| `decryptKey` throws (wrong passphrase OR corrupted blob) | UnlockForm shows: "Wrong passphrase." We don't distinguish corruption from wrong passphrase (AES-GCM gives the same error class either way). If repeated attempts fail, the user can use "Remove saved key" and start fresh. |
| `getApiKeyBlob` validator drops a corrupt record | Boot treats as "no blob present"; user lands in `'none'` state. Logged to `console.warn`. |
| User closes tab while a `validateKey` request is in flight | Handled by `AbortController` tied to component unmount. The pending validation cancels; no orphaned state updates. |
| User submits the form, hits an error, fixes the input, submits again, and the first submit was still in flight | The form's `isSubmitting` flag debounces double-submit. Submit button is disabled during the first request. |
| User opens Settings in two tabs, removes the key in one | Tab A: removes. Tab B: still shows `'unlocked'` from before. Tab B's next operation (e.g., trying to re-validate) will work normally; on next reload Tab B will see `'none'`. We don't broadcast IDB changes across tabs in v1; documented as a known limitation. |
| User submits with an empty passphrase in save mode | Submit button is disabled until non-empty. (Trim is intentional: a passphrase of all-spaces is allowed; AES-GCM doesn't care, and we don't impose policies.) |

### 6.7 State invariants

- `apiKeyStore.state` is the single source of truth for "is there a usable key right now?". Consumers (4.3+) will read this state via `useApiKeyState()` or `getCurrentApiKey()`.
- `state.kind === 'session'` and `state.kind === 'unlocked'` both mean "key available." The distinction matters only to the Settings UI (different status copy + different upgrade affordance).
- `state.kind === 'locked'` means "encrypted blob exists in IDB; no decrypted key in memory." Consumers must treat this as "no key."
- `state.kind === 'none'` means "no blob, no session key."
- Cold-start ordering guarantees: `markLocked()` runs *before* `setBoot('ready')` if a blob exists. UI never sees a transient 'none' state when there's a blob.
- The encrypted blob is never returned by `apiKeyStore`. Decrypted keys never touch IDB. (Crisp boundary: `apiKeyStore` only sees plaintext keys; `settingsRepo` only sees encrypted blobs.)
- Passphrase is *only* live within `SettingsView`'s submit handler scope and the local form state. After submit, it's eligible for GC. We do not retain it.
- Validating the key with `/v1/models` does not pre-cache the model list anywhere in 4.1. (4.2 owns the catalog.) The returned `models` array is dropped.

## 7. Testing

### 7.1 Unit tests (Vitest + happy-dom)

| File | Scope |
|---|---|
| `src/storage/repositories/settings.test.ts` (extend) | `isValidView` accepts `{kind:'settings'}`. `getApiKeyBlob`/`putApiKeyBlob`/`deleteApiKeyBlob` round-trip ArrayBuffers; corrupt records (missing fields, wrong types) drop to `undefined`; iterations stored alongside ciphertext is preserved across get. |
| `src/app/view.test.ts` (extend) | `settingsView()` returns `{kind:'settings'}`; `AppView` exhaustive narrowing now covers four kinds. |
| `src/app/useAppView.test.ts` (extend) | `goSettings()` sets view to `{kind:'settings'}`. Existing tests for goLibrary/goReader/goNotebook/goReaderAt unchanged. |
| `src/features/ai/key/apiKeyCrypto.test.ts` (new) | `encryptKey` produces a blob with non-empty salt/iv/ciphertext + correct iterations; `encryptKey` then `decryptKey` round-trips the original key string; decrypt with wrong passphrase throws (and the throw is catchable); decrypt with corrupted ciphertext throws; salt and IV are different per call (no nonce reuse). |
| `src/features/ai/key/apiKeyStore.test.ts` (new) | Initial state is `{kind:'none'}`; `setSession`/`setUnlocked`/`markLocked`/`clear` transitions; `getCurrentApiKey()` returns the key in session/unlocked, null in locked/none; `useApiKeyState` selector subscribes correctly. |
| `src/features/ai/key/nanogptApi.test.ts` (new) | `validateKey` calls `/v1/models` with `Authorization: Bearer …`; 200 response returns `{ok:true, models}` parsed from `data[]`; 401 → `{ok:false, reason:'invalid-key', status:401}`; 403 → same; 500 → `{ok:false, reason:'other', status:500}`; network failure → `{ok:false, reason:'network'}`; malformed JSON → `{ok:false, reason:'other'}`; AbortSignal cancellation propagates. (Use `vi.fn()` for `global.fetch`.) |
| `src/features/ai/key/ApiKeyForm.test.tsx` (new) | Renders masked password input + show toggle; toggling eye flips input type to text; mode segmented control toggles; passphrase field appears only in 'save' mode; submit button disabled when key is empty (any mode); disabled when passphrase is empty (save mode); submit calls `onSubmit` with the right shape; isSubmitting disables submit button + disables inputs; error message renders when onSubmit returns `{ok:false}`; cancel triggers `onCancel`. |
| `src/features/ai/key/UnlockForm.test.tsx` (new) | Renders passphrase input + Unlock button + Remove button; submit calls `onSubmit(passphrase)`; Remove triggers a separate callback; error renders on `{ok:false}`. |
| `src/features/ai/settings/SettingsView.test.tsx` (new) | Mounts based on `apiKeyStore` state. State='none' → renders ApiKeyForm. State='session' → renders status card with "Use this session" label + Save + Remove buttons. State='unlocked' → renders status card with "Unlocked" label + Remove. State='locked' → renders UnlockForm + Remove option. Clicking Remove triggers confirm dialog; on confirm, `deleteApiKeyBlob` called and store transitions to 'none'. Form submit invokes `validateKey` (mocked) + on success transitions store + UI swaps. Save-from-session upgrade path: clicking "Save on this device" reveals the form with mode='save'. |
| `src/features/library/LibraryChrome.test.tsx` (extend) | Settings button visible on both viewports; clicking calls `onOpenSettings`. |
| `src/shared/icons/icons.test.tsx` (extend) | New `SettingsIcon`, `EyeIcon`, `EyeOffIcon` render SVGs with `.icon` class. |

### 7.2 E2E tests (Playwright)

| File | Coverage |
|---|---|
| `e2e/settings-open-from-library.spec.ts` | Open library → click Settings button → Settings view renders with API key section + ApiKeyForm in 'none' state. Click back/Close → returns to library. Reload while in Settings → stays in Settings (`view` setting persists). |
| `e2e/settings-api-key-session.spec.ts` | From 'none' → paste a (mocked-valid) key → keep mode on "Use this session" → Submit → status card shows "Using API key for this session" → Remove → confirms → back to 'none'. Mock `/v1/models` response via `page.route()`. |
| `e2e/settings-api-key-save-and-reload.spec.ts` | From 'none' → paste key → toggle to "Save on this device" → enter passphrase → Submit → status card shows "Unlocked" → reload page → Settings shows UnlockForm (locked state). Enter wrong passphrase → "Wrong passphrase" error. Enter correct passphrase → status card shows "Unlocked" again. |
| `e2e/settings-validation-error.spec.ts` | Mock `/v1/models` to return 401. Paste key, submit → form shows "rejected by NanoGPT" message. Mock returns 200 → submit succeeds. |
| `e2e/settings-remove-and-reload.spec.ts` | Save a key → Remove with confirmation → reload → Settings shows fresh ApiKeyForm (no persisted blob). |
| `e2e/settings-icons.spec.ts` | Library chrome shows SettingsIcon SVG (no emoji glyph). Settings page chrome shows ArrowLeftIcon SVG. ApiKeyForm shows the show/hide eye toggle as an SVG. |

### 7.3 Skipped intentionally

- Real network round-trip to NanoGPT — all validation tests use `page.route()` (E2E) or `vi.fn()` (unit) to mock `/v1/models`. We don't want CI to depend on a paid third party.
- Specific PBKDF2 timing — the iteration count is fixed (600k); we don't measure derivation latency in tests. (Crypto correctness tests are round-trip + wrong-passphrase only.)
- Multi-tab synchronization — same single-tab assumption as the rest of the app.
- Forgot-passphrase recovery — there isn't one; "Remove saved key" is the recovery path.
- Provider switcher — only NanoGPT in v1.
- Model catalog UI — Task 4.2.
- AI features that consume the key — Tasks 4.3 / 4.4.
- Backwards compatibility with older blob formats — `iterations` is stored per-blob, so future iteration bumps don't break old blobs. We don't write a migration test now; we'll add one if we ever change the algorithm.
- Concurrent submit attempts — `isSubmitting` debounces; covered by unit tests, not E2E.

### 7.4 Test fixtures

- `crypto.subtle` is available in happy-dom for unit tests (verified earlier in the project — used by existing checksum logic).
- `fetch` is mocked via `vi.fn()` in unit tests and `page.route()` in E2E.
- No new book fixtures.

## 8. File map

**New files:**
- `src/features/ai/key/apiKeyStore.ts`
- `src/features/ai/key/apiKeyStore.test.ts`
- `src/features/ai/key/apiKeyCrypto.ts`
- `src/features/ai/key/apiKeyCrypto.test.ts`
- `src/features/ai/key/nanogptApi.ts`
- `src/features/ai/key/nanogptApi.test.ts`
- `src/features/ai/key/ApiKeyForm.tsx`
- `src/features/ai/key/api-key-form.css`
- `src/features/ai/key/ApiKeyForm.test.tsx`
- `src/features/ai/key/UnlockForm.tsx`
- `src/features/ai/key/unlock-form.css`
- `src/features/ai/key/UnlockForm.test.tsx`
- `src/features/ai/settings/SettingsView.tsx`
- `src/features/ai/settings/settings-view.css`
- `src/features/ai/settings/SettingsView.test.tsx`
- `src/features/ai/settings/SettingsChrome.tsx`
- `src/features/ai/settings/settings-chrome.css`
- `src/features/ai/settings/SettingsChrome.test.tsx`
- `src/shared/icons/SettingsIcon.tsx`
- `src/shared/icons/EyeIcon.tsx`
- `src/shared/icons/EyeOffIcon.tsx`
- 6 E2E specs under `e2e/`

**Modified files:**
- `src/storage/db/schema.ts` — extend `AppView` with `'settings'`; extend `SettingsRecord` with `apiKey` variant
- `src/storage/repositories/settings.ts` — `isValidView` accepts `'settings'`; new `getApiKeyBlob` / `putApiKeyBlob` / `deleteApiKeyBlob`; `isValidApiKeyValue` validator; export `ApiKeyBlob` type
- `src/storage/repositories/settings.test.ts` — extend
- `src/storage/index.ts` — export `ApiKeyBlob`
- `src/app/view.ts` — `settingsView()` helper
- `src/app/view.test.ts` — extend
- `src/app/useAppView.ts` — `goSettings()` method on the handle
- `src/app/useAppView.test.ts` — extend
- `src/app/App.tsx` — fourth view branch (`'settings'`); boot extends `Promise.all` with `getApiKeyBlob()`; calls `useApiKeyStore.getState().markLocked()` if blob present pre-mount
- `src/features/library/LibraryView.tsx` — pass `onOpenSettings` to `LibraryChrome`
- `src/features/library/LibraryChrome.tsx` — Settings button + `onOpenSettings` prop
- `src/features/library/LibraryChrome.test.tsx` — extend
- `src/features/library/library-chrome.css` — settings button styles
- `src/shared/icons/index.ts` — add three new icon exports
- `src/shared/icons/icons.test.tsx` — extend

## 9. Migration & compatibility

- `AppView` union extended with `'settings'`. Additive — no DB migration. Old persisted records with `'library'`/`'reader'`/`'notebook'` narrow correctly. `CURRENT_DB_VERSION` stays at 5.
- `SettingsRecord` extended with `apiKey` variant. The existing `settings` IDB store accepts arbitrary record shapes (it's keyed by `'key'`); the new variant is just another shape. No migration needed.
- `isValidView` accepts a fourth kind. Older app builds reading a `'settings'` view record would fall back to library — acceptable degradation.
- The `apiKey` blob format is forward-compatible by design: `iterations` is persisted, so future PBKDF2 bumps don't strand old blobs. If we ever change the algorithm itself (different KDF, different cipher), we'll add a `version: number` field to the value and branch on it. Not done now; YAGNI.
- No domain-type changes. No new repos. No engine adapter touches.
- Boot ordering change: `App.tsx` boots `Promise.all([getView, getPrefs, getFocusModeHintShown, getApiKeyBlob])`. Adding a fourth parallel adds zero serial latency (limited by the slowest fetch) and one extra IDB read. Negligible.

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| User loses passphrase → key is permanently inaccessible | Documented in the form's privacy copy ("we never store your passphrase"). Recovery is "Remove saved key + start fresh." Acceptable given the security model — the alternative (store passphrase) defeats the whole point of encryption. |
| User chooses a weak passphrase (e.g., `abc`) → blob is trivially crackable if the IDB is exfiltrated | We don't enforce passphrase complexity in v1. Reading IDB requires same-origin code execution; the threat model is mostly "another browser profile on shared machine," which doesn't have access to our IDB anyway. Documented; not a v1 fix. |
| `validateKey` succeeds at entry but the key is later revoked on NanoGPT's side | 4.3+'s chat code catches the 401 and surfaces "Your key was rejected. Re-enter in Settings." Not a 4.1 concern beyond defining the in-memory store contract. |
| Long-running PBKDF2 (600k iterations) blocks the main thread for ~1s on slower devices | Acceptable for a one-time submit. Measured: ~200ms on M1, ~500ms on a low-end Chromebook. The form shows `isSubmitting` state during the work, so the UI feels responsive. If we hit complaints, we move derivation to a Web Worker — but that's significant added complexity for v1. |
| `crypto.subtle` not available in dev (Vitest happy-dom or non-HTTPS contexts) | `crypto.subtle` requires secure context (HTTPS or localhost). Localhost dev satisfies this. Tests run in happy-dom, which provides `crypto.subtle` (verified). Production deploys are HTTPS-only via GitHub Pages. |
| User opens Settings in two tabs, both unlock with passphrase, one tab removes the key — the other tab still has the decrypted key in memory | Acceptable. The other tab's in-memory `apiKeyStore` will continue to work for the rest of that tab's lifetime; on its next reload, it'll see no blob and start fresh. We don't broadcast IDB changes across tabs in v1. |
| User pastes the key with leading/trailing whitespace | Form trims `key.trim()` at submit time. Documented in the form's submit handler; tested. (Passphrase is *not* trimmed — explicit decision.) |
| `validateKey` request leaks the key in browser history / DevTools | The request is in-memory; not in browser history (URL has no key). DevTools Network tab shows the `Authorization` header during the request. Acceptable: this is the standard fetch model; users with DevTools open are root on their own machine. |
| The session→save upgrade path skips re-validation, but the user might have edited the key after the original validation (e.g., backspace) | The upgrade UI uses the in-memory `state.key` (which was the validated value), not a re-typed input. The user sees a passphrase-only form with the key already known. Documented. |

**Open questions to resolve in implementation plan (not blocking):**
- Whether to lock down the SettingsChrome's height to match the existing chrome heights (LibraryChrome, ReaderChrome, NotebookChrome). Lean: yes, share a CSS variable.
- Whether to autofocus the key input on entry vs. mobile (avoid soft keyboard). Lean: desktop yes, mobile no — same heuristic as `NotebookSearchBar`.
- Final SVG geometry for SettingsIcon / EyeIcon / EyeOffIcon. Plan-level styling iteration.

## 11. Acceptance criteria

A working build of this PR satisfies:

1. ✅ Library chrome shows a Settings button (SVG icon). Clicking it opens the Settings view.
2. ✅ Settings view chrome shows back button + "Settings" title.
3. ✅ Settings view's API key section renders the correct UI for each of the four states: None / Session / Unlocked / Locked.
4. ✅ ApiKeyForm: masked input + show-toggle, segmented mode control, conditional passphrase field, submit button enabled only when valid.
5. ✅ Submit hits `/v1/models` with the key. On 200 → save (session-mode in memory; save-mode encrypted to IDB). On error → inline message; no save.
6. ✅ Encryption uses WebCrypto PBKDF2-SHA256 (600k iterations) → AES-GCM with random salt + IV per encryption. Iterations stored alongside ciphertext.
7. ✅ Reload while in `'unlocked'` state → boot reads the blob → store transitions to `'locked'` → Settings shows UnlockForm without flash.
8. ✅ UnlockForm with correct passphrase → store transitions to `'unlocked'`. Wrong passphrase → "Wrong passphrase" error; no transition.
9. ✅ "Remove" with confirmation → wipes IDB blob (if any) + clears in-memory store → state transitions to `'none'`. Reload confirms removal persisted.
10. ✅ Session → save upgrade path: from `'session'`, "Save on this device" reveals passphrase form, encrypts + persists, transitions to `'unlocked'` without re-validation.
11. ✅ AppView `'settings'` persists across reload via the existing `view` settings record.
12. ✅ Mobile (390×844): Settings layout works; segmented control, inputs, and buttons are all reachable; soft keyboard doesn't occlude submit.
13. ✅ All copy is privacy-forward (the user knows what's in memory vs. on disk vs. encrypted).
14. ✅ Type-check, lint, build all clean.
15. ✅ All existing tests pass; new unit + E2E tests pass.
