export { openBookwormDB, type BookwormDB } from './db/open';
export { CURRENT_DB_VERSION } from './db/schema';
export { createBookRepository, type BookRepository } from './repositories/books';
export {
  createSettingsRepository,
  type SettingsRepository,
  type ApiKeyBlob,
} from './repositories/settings';
export { createOpfsAdapter, OpfsError, type OpfsAdapter } from './adapters/opfs';
export { createInMemoryOpfsAdapter } from './adapters/opfs-in-memory';
export {
  createReadingProgressRepository,
  type ReadingProgressRepository,
} from './repositories/readingProgress';
export {
  createReaderPreferencesRepository,
  type ReaderPreferencesRepository,
} from './repositories/readerPreferences';
export {
  createBookmarksRepository,
  type BookmarksRepository,
} from './repositories/bookmarks';
export {
  createHighlightsRepository,
  type HighlightsRepository,
} from './repositories/highlights';
export { createNotesRepository, type NotesRepository } from './repositories/notes';
export type { AppView } from './db/schema';
