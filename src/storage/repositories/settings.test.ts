import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createSettingsRepository } from './settings';
import type { ApiKeyBlob } from '@/storage';
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

  describe('isValidView (notebook)', () => {
    it('round-trips a notebook view', async () => {
      const settings = createSettingsRepository(db);
      await settings.setView({ kind: 'notebook', bookId: 'b1' });
      expect(await settings.getView()).toEqual({ kind: 'notebook', bookId: 'b1' });
    });

    it('drops a notebook view with empty bookId', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'view',
        value: { kind: 'notebook', bookId: '' },
      } as never);
      expect(await settings.getView()).toBeUndefined();
    });

    it('drops a notebook view with missing bookId', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'view',
        value: { kind: 'notebook' },
      } as never);
      expect(await settings.getView()).toBeUndefined();
    });
  });

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
});
