import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { BookwormDBSchema } from './schema';

type StoreName = 'books' | 'settings' | 'reading_progress' | 'reader_preferences';

type UpgradeContext = {
  readonly db: IDBPDatabase<BookwormDBSchema>;
  readonly tx: IDBPTransaction<BookwormDBSchema, StoreName[], 'versionchange'>;
};

type Migration = (ctx: UpgradeContext) => void;

// Each migration moves persisted state from version N to version N+1.
const migrations: Readonly<Record<number, Migration>> = {
  // 0 → 1: initial v1 baseline
  0: ({ db }) => {
    if (!db.objectStoreNames.contains('books')) {
      const store = db.createObjectStore('books', { keyPath: 'id' });
      store.createIndex('by-checksum', 'source.checksum', { unique: true });
      store.createIndex('by-created', 'createdAt', { unique: false });
      store.createIndex('by-last-opened', 'lastOpenedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  },
  // 1 → 2: Phase 2.1 reader stores
  1: ({ db }) => {
    if (!db.objectStoreNames.contains('reading_progress')) {
      db.createObjectStore('reading_progress', { keyPath: 'bookId' });
    }
    if (!db.objectStoreNames.contains('reader_preferences')) {
      db.createObjectStore('reader_preferences', { keyPath: 'key' });
    }
  },
};

export function runMigrations(ctx: UpgradeContext, oldVersion: number, newVersion: number): void {
  for (let v = oldVersion; v < newVersion; v += 1) {
    const m = migrations[v];
    if (!m) {
      throw new Error(`No migration registered for version ${String(v)} → ${String(v + 1)}`);
    }
    m(ctx);
  }
}
