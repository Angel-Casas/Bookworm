import type { SortKey } from '@/domain';
import type { BookwormDB } from '../db/open';
import { SETTINGS_STORE, type SettingsRecord } from '../db/schema';

export type SettingsRepository = {
  getLibrarySort(): Promise<SortKey | undefined>;
  setLibrarySort(key: SortKey): Promise<void>;
  getStoragePersistResult(): Promise<'granted' | 'denied' | undefined>;
  setStoragePersistResult(value: 'granted' | 'denied'): Promise<void>;
};

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
      const rec = await get<Extract<SettingsRecord, { key: 'storagePersistResult' }>>(
        'storagePersistResult',
      );
      return rec?.value;
    },
    async setStoragePersistResult(value) {
      await put({ key: 'storagePersistResult', value });
    },
  };
}
