import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openBookwormDB, type BookwormDB } from '../db/open';
import { createSettingsRepository } from './settings';
import type { ApiKeyBlob, ModelCatalogSnapshot } from '@/storage';
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

  describe('modelCatalog', () => {
    function makeSnapshot(): ModelCatalogSnapshot {
      return {
        models: [{ id: 'gpt-x' }, { id: 'claude-y' }],
        fetchedAt: 1_700_000_000_000,
      };
    }

    it('returns undefined when no snapshot is stored', async () => {
      const settings = createSettingsRepository(db);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('round-trips a snapshot', async () => {
      const settings = createSettingsRepository(db);
      const snap = makeSnapshot();
      await settings.putModelCatalog(snap);
      const round = await settings.getModelCatalog();
      expect(round).toEqual(snap);
    });

    it('putModelCatalog overwrites the existing record', async () => {
      const settings = createSettingsRepository(db);
      await settings.putModelCatalog(makeSnapshot());
      const next: ModelCatalogSnapshot = {
        models: [{ id: 'only-one' }],
        fetchedAt: 1_700_000_000_001,
      };
      await settings.putModelCatalog(next);
      expect(await settings.getModelCatalog()).toEqual(next);
    });

    it('deleteModelCatalog removes the record', async () => {
      const settings = createSettingsRepository(db);
      await settings.putModelCatalog(makeSnapshot());
      await settings.deleteModelCatalog();
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('returns undefined for corrupt records (missing models array)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'modelCatalog',
        value: { fetchedAt: 1 },
      } as never);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('returns undefined for corrupt records (model with non-string id)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'modelCatalog',
        value: { models: [{ id: 42 }], fetchedAt: 1 },
      } as never);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });

    it('returns undefined for corrupt records (non-finite fetchedAt)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', {
        key: 'modelCatalog',
        value: { models: [], fetchedAt: Number.NaN },
      } as never);
      expect(await settings.getModelCatalog()).toBeUndefined();
    });
  });

  describe('selectedModelId', () => {
    it('returns undefined when nothing is stored', async () => {
      const settings = createSettingsRepository(db);
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });

    it('round-trips a non-empty id', async () => {
      const settings = createSettingsRepository(db);
      await settings.putSelectedModelId('gpt-4o');
      expect(await settings.getSelectedModelId()).toBe('gpt-4o');
    });

    it('deleteSelectedModelId removes the record', async () => {
      const settings = createSettingsRepository(db);
      await settings.putSelectedModelId('gpt-4o');
      await settings.deleteSelectedModelId();
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });

    it('returns undefined for corrupt records (empty string)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', { key: 'selectedModelId', value: '' } as never);
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });

    it('returns undefined for corrupt records (non-string value)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', { key: 'selectedModelId', value: 42 } as never);
      expect(await settings.getSelectedModelId()).toBeUndefined();
    });
  });

  describe('chatPanelHintShown', () => {
    it('defaults to false when not set', async () => {
      const settings = createSettingsRepository(db);
      expect(await settings.getChatPanelHintShown()).toBe(false);
    });
    it('round-trips a value', async () => {
      const settings = createSettingsRepository(db);
      await settings.setChatPanelHintShown(true);
      expect(await settings.getChatPanelHintShown()).toBe(true);
    });
    it('returns false for corrupt records (non-boolean value)', async () => {
      const settings = createSettingsRepository(db);
      await db.put('settings', { key: 'chatPanelHintShown', value: 'yes' } as never);
      expect(await settings.getChatPanelHintShown()).toBe(false);
    });
  });
});
