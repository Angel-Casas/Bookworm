import type { SortKey } from '@/domain';
import type { AppView } from '@/app/view';
import type { BookwormDB } from '../db/open';
import { SETTINGS_STORE, type SettingsRecord } from '../db/schema';

export type SettingsRepository = {
  getLibrarySort(): Promise<SortKey | undefined>;
  setLibrarySort(key: SortKey): Promise<void>;
  getStoragePersistResult(): Promise<'granted' | 'denied' | undefined>;
  setStoragePersistResult(value: 'granted' | 'denied'): Promise<void>;
  getView(): Promise<AppView | undefined>;
  setView(view: AppView): Promise<void>;
  getFocusModeHintShown(): Promise<boolean>;
  setFocusModeHintShown(shown: boolean): Promise<void>;
};

function isValidView(v: unknown): v is AppView {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as { kind?: unknown; bookId?: unknown };
  if (x.kind === 'library') return true;
  if (x.kind === 'reader' && typeof x.bookId === 'string' && x.bookId.length > 0) return true;
  return false;
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
  };
}
