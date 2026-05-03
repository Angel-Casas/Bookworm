import type { DBSchema } from 'idb';
import type { Book } from '@/domain';
import type { LocationAnchor } from '@/domain';
import type { ReaderPreferences } from '@/domain/reader';

export const DB_NAME = 'bookworm';
export const CURRENT_DB_VERSION = 2;

export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string };

export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' }
  | { readonly key: 'view'; readonly value: AppView }
  | { readonly key: 'focusModeHintShown'; readonly value: boolean };

export type ReadingProgressRecord = {
  readonly bookId: string;
  readonly anchor: LocationAnchor;
  readonly updatedAt: number;
};

export type ReaderPreferencesRecord = {
  readonly key: 'global';
  readonly value: ReaderPreferences;
};

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
  reading_progress: {
    key: string;
    value: ReadingProgressRecord;
  };
  reader_preferences: {
    key: string;
    value: ReaderPreferencesRecord;
  };
}

export const BOOK_STORE = 'books' as const;
export const SETTINGS_STORE = 'settings' as const;
export const READING_PROGRESS_STORE = 'reading_progress' as const;
export const READER_PREFERENCES_STORE = 'reader_preferences' as const;
