// AppView itself is declared in src/storage/db/schema.ts because it is the
// persisted shape of the 'view' settings record. This module re-exports it
// and adds ergonomic helpers used by App.tsx.

import type { AppView } from '@/storage/db/schema';

export type { AppView };

export const LIBRARY_VIEW: AppView = { kind: 'library' };

export function readerView(bookId: string): AppView {
  return { kind: 'reader', bookId };
}

export function notebookView(bookId: string): AppView {
  return { kind: 'notebook', bookId };
}

export const SETTINGS_VIEW: AppView = { kind: 'settings' };

export function settingsView(): AppView {
  return SETTINGS_VIEW;
}
