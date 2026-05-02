import type { OpfsAdapter, BookRepository } from '@/storage';
import { BookId } from '@/domain';

// Background pass: any subdirectory under `books/` whose id isn't represented
// in IndexedDB is removed. Runs after library boot.

export async function sweepOrphans(opfs: OpfsAdapter, bookRepo: BookRepository): Promise<void> {
  let dirs: readonly string[];
  try {
    dirs = await opfs.list('books');
  } catch {
    return;
  }
  if (dirs.length === 0) return;
  const all = await bookRepo.getAll();
  const known = new Set(all.map((b) => b.id));
  await Promise.all(
    dirs.map(async (id) => {
      if (!known.has(BookId(id))) {
        try {
          await opfs.removeRecursive(`books/${id}`);
        } catch (err) {
          console.warn('orphan sweep failed for', id, err);
        }
      }
    }),
  );
}
