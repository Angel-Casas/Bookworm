import type { Book, BookId } from '@/domain';
import type { OpfsAdapter } from '@/storage';

// Object URLs are tied to the document. We keep one per BookId and revoke on
// removal or page hide. Resolution is best-effort: if the file or OPFS read
// fails we cache `null` for the session so we don't hammer disk on each render.

export type CoverCache = {
  getUrl(book: Book): Promise<string | null>;
  forget(id: BookId): void;
  forgetAll(): void;
};

export function createCoverCache(opfs: OpfsAdapter): CoverCache {
  const urls = new Map<BookId, string | null>();
  const inflight = new Map<BookId, Promise<string | null>>();

  return {
    async getUrl(book) {
      const cached = urls.get(book.id);
      if (cached !== undefined) return cached;
      const pending = inflight.get(book.id);
      if (pending) return pending;
      const ref = book.coverRef;
      if (ref.kind !== 'opfs') {
        urls.set(book.id, null);
        return null;
      }
      const work = (async () => {
        try {
          const blob = await opfs.readFile(ref.path);
          if (!blob) {
            urls.set(book.id, null);
            return null;
          }
          const url = URL.createObjectURL(blob);
          urls.set(book.id, url);
          return url;
        } finally {
          inflight.delete(book.id);
        }
      })();
      inflight.set(book.id, work);
      return work;
    },
    forget(id) {
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.delete(id);
    },
    forgetAll() {
      for (const url of urls.values()) {
        if (url) URL.revokeObjectURL(url);
      }
      urls.clear();
    },
  };
}
