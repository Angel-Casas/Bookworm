import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createReaderPreferencesRepository } from './readerPreferences';
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from '@/domain/reader';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-prefs-${crypto.randomUUID()}`);
});

describe('readerPreferencesRepository', () => {
  it('returns defaults when nothing has been saved', async () => {
    const repo = createReaderPreferencesRepository(db);
    expect(await repo.get()).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it('round-trips a custom preferences object', async () => {
    const repo = createReaderPreferencesRepository(db);
    const custom: ReaderPreferences = {
      ...DEFAULT_READER_PREFERENCES,
      theme: 'dark',
      typography: { ...DEFAULT_READER_PREFERENCES.typography, fontSizeStep: 4 },
    };
    await repo.put(custom);
    expect(await repo.get()).toEqual(custom);
  });

  it('returns defaults and self-heals when stored record is corrupted', async () => {
    const repo = createReaderPreferencesRepository(db);
    await db.put('reader_preferences', {
      key: 'global',
      // malformed: theme is not a valid ReaderTheme
      value: { ...DEFAULT_READER_PREFERENCES, theme: 'neon-pink' as never },
    });
    expect(await repo.get()).toEqual(DEFAULT_READER_PREFERENCES);
    const raw = await db.get('reader_preferences', 'global');
    expect(raw).toBeUndefined();
  });
});
