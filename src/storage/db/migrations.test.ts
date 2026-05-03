import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { openBookwormDB } from './open';
import { runMigrations } from './migrations';
import {
  BOOK_STORE,
  SETTINGS_STORE,
  READING_PROGRESS_STORE,
  READER_PREFERENCES_STORE,
  BOOKMARKS_STORE,
  HIGHLIGHTS_STORE,
  CURRENT_DB_VERSION,
} from './schema';

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

describe('v1 → v2 migration', () => {
  it('creates reader stores and preserves existing books', async () => {
    const dbName = `bookworm-mig-${crypto.randomUUID()}`;

    // Step 1: open the database at v1 with one book record
    const v1 = await openDB(dbName, 1, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('by-checksum', 'source.checksum', { unique: true });
        books.createIndex('by-created', 'createdAt', { unique: false });
        books.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    await v1.put('books', { id: 'b1', title: 'Test Survivor' });
    v1.close();

    // Step 2: reopen at v2 — runMigrations runs the v1 → v2 step
    const v2 = await openDB(dbName, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        // The runtime accepts the wider tx; the type narrowing is only
        // checked statically against the v2 schema.
        runMigrations(
          { db: db as never, tx: tx as never },
          oldVersion,
          newVersion ?? CURRENT_DB_VERSION,
        );
      },
    });

    expect(v2.objectStoreNames.contains(READING_PROGRESS_STORE)).toBe(true);
    expect(v2.objectStoreNames.contains(READER_PREFERENCES_STORE)).toBe(true);
    const survivors = await v2.getAll('books');
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({ id: 'b1', title: 'Test Survivor' });
    v2.close();
  });
});

describe('v2 → v3 migration', () => {
  it('creates the bookmarks store with by-book index and preserves existing books', async () => {
    const dbName = `bookworm-mig3-${crypto.randomUUID()}`;

    const v2 = await openDB(dbName, 2, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('by-checksum', 'source.checksum', { unique: true });
        books.createIndex('by-created', 'createdAt', { unique: false });
        books.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('reading_progress', { keyPath: 'bookId' });
        db.createObjectStore('reader_preferences', { keyPath: 'key' });
      },
    });
    await v2.put('books', { id: 'b1', title: 'Survivor' });
    await v2.put('reading_progress', {
      bookId: 'b1',
      anchor: { kind: 'pdf', page: 3 },
      updatedAt: 1,
    });
    v2.close();

    const v3 = await openDB(dbName, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        runMigrations(
          { db: db as never, tx: tx as never },
          oldVersion,
          newVersion ?? CURRENT_DB_VERSION,
        );
      },
    });

    expect(v3.objectStoreNames.contains(BOOKMARKS_STORE)).toBe(true);
    const tx = v3.transaction(BOOKMARKS_STORE, 'readonly');
    const store = tx.objectStore(BOOKMARKS_STORE);
    expect([...store.indexNames]).toContain('by-book');

    const books = await v3.getAll('books');
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ id: 'b1', title: 'Survivor' });

    const progress = await v3.getAll('reading_progress');
    expect(progress).toHaveLength(1);

    v3.close();
  });
});

describe('v3 → v4 migration', () => {
  it('creates the highlights store with by-book index and preserves existing stores', async () => {
    const dbName = `bookworm-mig4-${crypto.randomUUID()}`;

    const v3 = await openDB(dbName, 3, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('by-checksum', 'source.checksum', { unique: true });
        books.createIndex('by-created', 'createdAt', { unique: false });
        books.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('reading_progress', { keyPath: 'bookId' });
        db.createObjectStore('reader_preferences', { keyPath: 'key' });
        const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarks.createIndex('by-book', 'bookId', { unique: false });
      },
    });
    await v3.put('books', { id: 'b1', title: 'Survivor' });
    await v3.put('bookmarks', {
      id: 'bm1',
      bookId: 'b1',
      anchor: { kind: 'pdf', page: 1 },
      snippet: null,
      sectionTitle: null,
      createdAt: '2026-05-03T12:00:00.000Z',
    });
    v3.close();

    const v4 = await openDB(dbName, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        runMigrations(
          { db: db as never, tx: tx as never },
          oldVersion,
          newVersion ?? CURRENT_DB_VERSION,
        );
      },
    });

    expect(v4.objectStoreNames.contains(HIGHLIGHTS_STORE)).toBe(true);
    const tx = v4.transaction(HIGHLIGHTS_STORE, 'readonly');
    const store = tx.objectStore(HIGHLIGHTS_STORE);
    expect([...store.indexNames]).toContain('by-book');

    const books = await v4.getAll('books');
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ id: 'b1', title: 'Survivor' });

    const bookmarks = await v4.getAll('bookmarks');
    expect(bookmarks).toHaveLength(1);

    v4.close();
  });
});
