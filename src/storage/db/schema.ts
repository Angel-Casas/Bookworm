import type { DBSchema } from 'idb';
import type { Book } from '@/domain';

export const DB_NAME = 'bookworm';
export const CURRENT_DB_VERSION = 1;

export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' };

export interface BookwormDBSchema extends DBSchema {
  books: {
    key: string;
    value: Book;
    indexes: {
      'by-checksum': string;
      'by-created': string;
      'by-last-opened': string;
    };
  };
  settings: {
    key: string;
    value: SettingsRecord;
  };
}

export const BOOK_STORE = 'books' as const;
export const SETTINGS_STORE = 'settings' as const;
