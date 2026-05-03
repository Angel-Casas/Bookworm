import type { OpfsAdapter, BookRepository, ReadingProgressRepository } from '@/storage';
import { BookId } from '@/domain';

// Background pass: any subdirectory under `books/` whose id isn't represented
// in IndexedDB is removed. Runs after library boot. Optionally also sweeps
// reading_progress records for books that no longer exist.

export async function sweepOrphans(
  opfs: OpfsAdapter,
  bookRepo: BookRepository,
  progressRepo?: ReadingProgressRepository,
): Promise<void> {
  const all = await bookRepo.getAll();
  const known = new Set(all.map((b) => b.id));

  // OPFS sweep
  let dirs: readonly string[] = [];
  try {
    dirs = await opfs.list('books');
  } catch {
    /* OPFS list failed; skip directory cleanup but still try progress cleanup */
  }
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

  // Reading-progress sweep
  if (progressRepo) {
    try {
      const keys = await progressRepo.listKeys();
      await Promise.all(
        keys
          .filter((k) => !known.has(BookId(k)))
          .map(async (k) => {
            try {
              await progressRepo.delete(k);
            } catch (err) {
              console.warn('progress sweep failed for', k, err);
            }
          }),
      );
    } catch (err) {
      console.warn('progress sweep listKeys failed', err);
    }
  }
}
