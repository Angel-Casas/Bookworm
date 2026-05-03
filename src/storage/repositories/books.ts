import type { Book, BookId } from '@/domain';
import type { BookwormDB } from '../db/open';
import { BOOK_STORE } from '../db/schema';

export type BookRepository = {
  getAll(): Promise<readonly Book[]>;
  getById(id: BookId): Promise<Book | undefined>;
  findByChecksum(checksum: string): Promise<Book | undefined>;
  put(book: Book): Promise<void>;
  delete(id: BookId): Promise<void>;
};

export function createBookRepository(db: BookwormDB): BookRepository {
  return {
    async getAll() {
      return db.getAll(BOOK_STORE);
    },
    async getById(id) {
      return db.get(BOOK_STORE, id);
    },
    async findByChecksum(checksum) {
      return db.getFromIndex(BOOK_STORE, 'by-checksum', checksum);
    },
    async put(book) {
      await db.put(BOOK_STORE, book);
    },
    async delete(id) {
      await db.delete(BOOK_STORE, id);
    },
  };
}
