export { openBookwormDB, type BookwormDB } from './db/open';
export { CURRENT_DB_VERSION } from './db/schema';
export { createBookRepository, type BookRepository } from './repositories/books';
export { createSettingsRepository, type SettingsRepository } from './repositories/settings';
export { createOpfsAdapter, OpfsError, type OpfsAdapter } from './adapters/opfs';
export { createInMemoryOpfsAdapter } from './adapters/opfs-in-memory';
