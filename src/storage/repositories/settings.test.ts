import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createSettingsRepository } from './settings';

describe('SettingsRepository', () => {
  let db: BookwormDB;

  beforeEach(async () => {
    db = await openBookwormDB(`bookworm-test-${crypto.randomUUID()}`);
  });

  it('reads and writes the librarySort key', async () => {
    const settings = createSettingsRepository(db);
    expect(await settings.getLibrarySort()).toBeUndefined();
    await settings.setLibrarySort('title');
    expect(await settings.getLibrarySort()).toBe('title');
  });

  it('reads and writes the storage persist result', async () => {
    const settings = createSettingsRepository(db);
    await settings.setStoragePersistResult('granted');
    expect(await settings.getStoragePersistResult()).toBe('granted');
  });
});
