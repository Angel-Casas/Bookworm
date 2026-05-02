import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openBookwormDB } from './open';
import { BOOK_STORE, SETTINGS_STORE } from './schema';

describe('v1 baseline migration', () => {
  it('creates books and settings stores with the expected indexes', async () => {
    const db = await openBookwormDB(`bookworm-test-${crypto.randomUUID()}`);

    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining([BOOK_STORE, SETTINGS_STORE]));

    const tx = db.transaction(BOOK_STORE, 'readonly');
    const store = tx.objectStore(BOOK_STORE);
    expect([...store.indexNames]).toEqual(
      expect.arrayContaining(['by-checksum', 'by-created', 'by-last-opened']),
    );

    db.close();
  });
});
