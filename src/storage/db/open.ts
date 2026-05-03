import { openDB, type IDBPDatabase } from 'idb';
import { CURRENT_DB_VERSION, DB_NAME, type BookwormDBSchema } from './schema';
import { runMigrations } from './migrations';

export type BookwormDB = IDBPDatabase<BookwormDBSchema>;

export async function openBookwormDB(name: string = DB_NAME): Promise<BookwormDB> {
  return openDB<BookwormDBSchema>(name, CURRENT_DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      runMigrations({ db, tx }, oldVersion, newVersion ?? CURRENT_DB_VERSION);
    },
    blocked() {
      console.warn('Bookworm DB upgrade blocked by another tab.');
    },
  });
}
