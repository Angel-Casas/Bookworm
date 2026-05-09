import { useCallback, useEffect, useState } from 'react';
import { type BookId, BookmarkId, IsoTimestamp } from '@/domain';
import type { Bookmark } from '@/domain/annotations/types';
import type { BookmarksRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';

export type UseBookmarksHandle = {
  readonly list: readonly Bookmark[];
  readonly loadError: Error | null;
  readonly retryLoad: () => void;
  readonly add: () => Promise<void>;
  readonly remove: (b: Bookmark) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly repo: BookmarksRepository;
  readonly readerState: ReaderViewExposedState | null;
};

function sortNewestFirst(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export function useBookmarks({ bookId, repo, readerState }: Options): UseBookmarksHandle {
  const [list, setList] = useState<readonly Bookmark[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const records = await repo.listByBook(bookId);
        if (!cancelled) setList(sortNewestFirst(records));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, repo, loadNonce]);

  const retryLoad = useCallback(() => {
    setLoadNonce((n) => n + 1);
  }, []);

  const add = useCallback(async (): Promise<void> => {
    if (!readerState) return;
    const anchor = readerState.getCurrentAnchor();
    if (!anchor) return;
    const sectionTitle = readerState.getSectionTitleAt(anchor);
    const optimistic: Bookmark = {
      id: BookmarkId(crypto.randomUUID()),
      bookId,
      anchor,
      snippet: null,
      sectionTitle,
      createdAt: IsoTimestamp(new Date().toISOString()),
    };
    setList((prev) => sortNewestFirst([optimistic, ...prev]));
    try {
      await repo.add(optimistic);
    } catch (err) {
      console.warn('[bookmarks] add failed; rolling back', err);
      setList((prev) => prev.filter((b) => b.id !== optimistic.id));
      return;
    }
    void readerState.getSnippetAt(anchor).then(async (snippet) => {
      if (snippet === null) return;
      setList((prev) =>
        prev.map((b) => (b.id === optimistic.id ? { ...b, snippet } : b)),
      );
      try {
        await repo.patch(optimistic.id, { snippet });
      } catch (err) {
        console.warn('[bookmarks] snippet patch failed', err);
      }
    });
  }, [bookId, repo, readerState]);

  const remove = useCallback(
    async (b: Bookmark): Promise<void> => {
      setList((prev) => prev.filter((x) => x.id !== b.id));
      try {
        await repo.delete(b.id);
      } catch (err) {
        console.warn('[bookmarks] delete failed; restoring', err);
        setList((prev) => sortNewestFirst([...prev, b]));
      }
    },
    [repo],
  );

  return { list, loadError, retryLoad, add, remove };
}
