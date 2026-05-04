import type { DBSchema } from 'idb';
import type { Book, Bookmark, Highlight, Note } from '@/domain';
import type { LocationAnchor } from '@/domain';
import type { ReaderPreferences } from '@/domain/reader';

export const DB_NAME = 'bookworm';
export const CURRENT_DB_VERSION = 5;

export type AppView =
  | { readonly kind: 'library' }
  | { readonly kind: 'reader'; readonly bookId: string }
  | { readonly kind: 'notebook'; readonly bookId: string }
  | { readonly kind: 'settings' };

export type SettingsRecord =
  | { readonly key: 'librarySort'; readonly value: string }
  | { readonly key: 'storagePersistResult'; readonly value: 'granted' | 'denied' }
  | { readonly key: 'view'; readonly value: AppView }
  | { readonly key: 'focusModeHintShown'; readonly value: boolean }
  | {
      readonly key: 'apiKey';
      readonly value: {
        readonly salt: ArrayBuffer;
        readonly iv: ArrayBuffer;
        readonly ciphertext: ArrayBuffer;
        readonly iterations: number;
      };
    };

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
  bookmarks: {
    key: string;
    value: Bookmark;
    indexes: { 'by-book': string };
  };
  highlights: {
    key: string;
    value: Highlight;
    indexes: { 'by-book': string };
  };
  notes: {
    key: string;
    value: Note;
    indexes: {
      'by-book': string;
      'by-highlight': string;
    };
  };
}

export const BOOK_STORE = 'books' as const;
export const SETTINGS_STORE = 'settings' as const;
export const READING_PROGRESS_STORE = 'reading_progress' as const;
export const READER_PREFERENCES_STORE = 'reader_preferences' as const;
export const BOOKMARKS_STORE = 'bookmarks' as const;
export const HIGHLIGHTS_STORE = 'highlights' as const;
export const NOTES_STORE = 'notes' as const;
