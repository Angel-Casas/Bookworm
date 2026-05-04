import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createSettingsRepository } from './settings';
import { LIBRARY_VIEW, readerView } from '@/app/view';

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

  it('round-trips library view', async () => {
    const settings = createSettingsRepository(db);
    await settings.setView(LIBRARY_VIEW);
    expect(await settings.getView()).toEqual(LIBRARY_VIEW);
  });

  it('round-trips reader view with bookId', async () => {
    const settings = createSettingsRepository(db);
    const v = readerView('book-1');
    await settings.setView(v);
    expect(await settings.getView()).toEqual(v);
  });

  it('returns undefined when no view is persisted', async () => {
    const settings = createSettingsRepository(db);
    expect(await settings.getView()).toBeUndefined();
  });

  it('returns undefined for malformed persisted view (defensive)', async () => {
    const settings = createSettingsRepository(db);
    await db.put('settings', {
      key: 'view',
      value: { kind: 'lol' } as never,
    });
    expect(await settings.getView()).toBeUndefined();
  });

  it('round-trips focusModeHintShown', async () => {
    const settings = createSettingsRepository(db);
    expect(await settings.getFocusModeHintShown()).toBe(false);
    await settings.setFocusModeHintShown(true);
    expect(await settings.getFocusModeHintShown()).toBe(true);
  });

  it('returns false when focusModeHintShown is malformed', async () => {
    const settings = createSettingsRepository(db);
    await db.put('settings', {
      key: 'focusModeHintShown',
      value: 'oops' as never,
    });
    expect(await settings.getFocusModeHintShown()).toBe(false);
  });

});
