import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { BookwormDBSchema } from './schema';

type StoreName =
  | 'books'
  | 'settings'
  | 'reading_progress'
  | 'reader_preferences'
  | 'bookmarks'
  | 'highlights'
  | 'notes'
  | 'chat_threads'
  | 'chat_messages'
  | 'saved_answers'
  | 'book_chunks'
  | 'book_embeddings';

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
  // 2 → 3: Phase 3.1 bookmarks store
  2: ({ db }) => {
    if (!db.objectStoreNames.contains('bookmarks')) {
      const store = db.createObjectStore('bookmarks', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
    }
  },
  // 3 → 4: Phase 3.2 highlights store
  3: ({ db }) => {
    if (!db.objectStoreNames.contains('highlights')) {
      const store = db.createObjectStore('highlights', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
    }
  },
  // 4 → 5: Phase 3.3 notes store
  4: ({ db }) => {
    if (!db.objectStoreNames.contains('notes')) {
      const store = db.createObjectStore('notes', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
      store.createIndex('by-highlight', 'anchorRef.highlightId', { unique: true });
    }
  },
  // 5 → 6: Phase 4.3 chat + saved answers
  5: ({ db }) => {
    if (!db.objectStoreNames.contains('chat_threads')) {
      const store = db.createObjectStore('chat_threads', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
      store.createIndex('by-updated', 'updatedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('chat_messages')) {
      const store = db.createObjectStore('chat_messages', { keyPath: 'id' });
      store.createIndex('by-thread', 'threadId', { unique: false });
    }
    if (!db.objectStoreNames.contains('saved_answers')) {
      const store = db.createObjectStore('saved_answers', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
      store.createIndex('by-message', 'messageId', { unique: true });
    }
  },
  // 6 → 7: Phase 5.1 text chunks store
  6: ({ db }) => {
    if (!db.objectStoreNames.contains('book_chunks')) {
      const store = db.createObjectStore('book_chunks', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
      store.createIndex('by-book-section', ['bookId', 'sectionId'], { unique: false });
    }
  },
  // 7 → 8: Phase 5.2 book embeddings store
  7: ({ db }) => {
    if (!db.objectStoreNames.contains('book_embeddings')) {
      const store = db.createObjectStore('book_embeddings', { keyPath: 'id' });
      store.createIndex('by-book', 'bookId', { unique: false });
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
