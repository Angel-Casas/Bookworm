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

export type ModelCatalogSnapshot = {
  readonly models: readonly { readonly id: string }[];
  readonly fetchedAt: number;
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
  getModelCatalog(): Promise<ModelCatalogSnapshot | undefined>;
  putModelCatalog(snapshot: ModelCatalogSnapshot): Promise<void>;
  deleteModelCatalog(): Promise<void>;
  getSelectedModelId(): Promise<string | undefined>;
  putSelectedModelId(id: string): Promise<void>;
  deleteSelectedModelId(): Promise<void>;
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
  };
}
