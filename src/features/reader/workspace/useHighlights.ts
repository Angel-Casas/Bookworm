import { useCallback, useEffect, useState } from 'react';
import {
  type BookId,
  HighlightId,
  IsoTimestamp,
  type LocationAnchor,
} from '@/domain';
import type {
  Highlight,
  HighlightAnchor,
  HighlightColor,
} from '@/domain/annotations/types';
import type { HighlightsRepository } from '@/storage';
import type { ReaderViewExposedState } from '@/features/reader/ReaderView';
import { compareHighlightsInBookOrder } from './highlightSort';

export type UseHighlightsHandle = {
  readonly list: readonly Highlight[];
  readonly add: (
    anchor: HighlightAnchor,
    selectedText: string,
    color: HighlightColor,
  ) => Promise<Highlight>;
  readonly changeColor: (h: Highlight, color: HighlightColor) => Promise<void>;
  readonly remove: (h: Highlight) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly repo: HighlightsRepository;
  readonly readerState: ReaderViewExposedState | null;
  readonly onAfterRemove?: (h: Highlight) => void;
};

function sortInBookOrder(list: readonly Highlight[]): Highlight[] {
  return [...list].sort(compareHighlightsInBookOrder);
}

function projectAnchorForLookup(anchor: HighlightAnchor): LocationAnchor {
  if (anchor.kind === 'epub-cfi') return { kind: 'epub-cfi', cfi: anchor.cfi };
  return { kind: 'pdf', page: anchor.page };
}

export function useHighlights({
  bookId,
  repo,
  readerState,
  onAfterRemove,
}: Options): UseHighlightsHandle {
  const [list, setList] = useState<readonly Highlight[]>([]);

  useEffect(() => {
    let cancelled = false;
    void repo.listByBook(bookId).then((records) => {
      if (!cancelled) setList(sortInBookOrder(records));
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, repo]);

  const add = useCallback(
    async (
      anchor: HighlightAnchor,
      selectedText: string,
      color: HighlightColor,
    ): Promise<Highlight> => {
      const sectionTitle = readerState
        ? readerState.getSectionTitleAt(projectAnchorForLookup(anchor))
        : null;
      const optimistic: Highlight = {
        id: HighlightId(crypto.randomUUID()),
        bookId,
        anchor,
        selectedText,
        sectionTitle,
        color,
        tags: [],
        createdAt: IsoTimestamp(new Date().toISOString()),
      };
      setList((prev) => sortInBookOrder([optimistic, ...prev]));
      readerState?.addHighlight(optimistic);
      try {
        await repo.add(optimistic);
      } catch (err) {
        console.warn('[highlights] add failed; rolling back', err);
        setList((prev) => prev.filter((h) => h.id !== optimistic.id));
        readerState?.removeHighlight(optimistic.id);
      }
      return optimistic;
    },
    [bookId, repo, readerState],
  );

  const changeColor = useCallback(
    async (h: Highlight, color: HighlightColor): Promise<void> => {
      const next: Highlight = { ...h, color };
      setList((prev) => sortInBookOrder(prev.map((x) => (x.id === h.id ? next : x))));
      readerState?.addHighlight(next);
      try {
        await repo.patch(h.id, { color });
      } catch (err) {
        console.warn('[highlights] color change failed; reverting', err);
        setList((prev) => sortInBookOrder(prev.map((x) => (x.id === h.id ? h : x))));
        readerState?.addHighlight(h);
      }
    },
    [repo, readerState],
  );

  const remove = useCallback(
    async (h: Highlight): Promise<void> => {
      setList((prev) => prev.filter((x) => x.id !== h.id));
      readerState?.removeHighlight(h.id);
      try {
        await repo.delete(h.id);
        onAfterRemove?.(h);
      } catch (err) {
        console.warn('[highlights] delete failed; restoring', err);
        setList((prev) => sortInBookOrder([...prev, h]));
        readerState?.addHighlight(h);
      }
    },
    [repo, readerState, onAfterRemove],
  );

  return { list, add, changeColor, remove };
}
