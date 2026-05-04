import { useCallback, useEffect, useState } from 'react';
import { type BookId, type HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { Note } from '@/domain/annotations/types';
import type { NotesRepository } from '@/storage';

export type UseNotesHandle = {
  readonly byHighlightId: ReadonlyMap<HighlightId, Note>;
  readonly save: (highlightId: HighlightId, content: string) => Promise<void>;
  readonly clear: (highlightId: HighlightId) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly repo: NotesRepository;
};

function buildMap(notes: readonly Note[]): Map<HighlightId, Note> {
  const map = new Map<HighlightId, Note>();
  for (const n of notes) {
    if (n.anchorRef.kind === 'highlight') {
      map.set(n.anchorRef.highlightId, n);
    }
  }
  return map;
}

export function useNotes({ bookId, repo }: Options): UseNotesHandle {
  const [byHighlightId, setByHighlightId] = useState<ReadonlyMap<HighlightId, Note>>(
    () => new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    void repo.listByBook(bookId).then((records) => {
      if (!cancelled) setByHighlightId(buildMap(records));
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, repo]);

  const clear = useCallback(
    async (highlightId: HighlightId): Promise<void> => {
      const existing = byHighlightId.get(highlightId);
      if (!existing) return;
      const next = new Map(byHighlightId);
      next.delete(highlightId);
      setByHighlightId(next);
      try {
        await repo.deleteByHighlight(highlightId);
      } catch (err) {
        console.warn('[notes] clear failed; restoring', err);
        const restored = new Map(byHighlightId);
        restored.set(highlightId, existing);
        setByHighlightId(restored);
      }
    },
    [byHighlightId, repo],
  );

  const save = useCallback(
    async (highlightId: HighlightId, content: string): Promise<void> => {
      const trimmed = content.trim();
      if (trimmed === '') {
        await clear(highlightId);
        return;
      }
      const existing = byHighlightId.get(highlightId);
      const now = IsoTimestamp(new Date().toISOString());
      const record: Note = existing
        ? { ...existing, content: trimmed, updatedAt: now }
        : {
            id: NoteId(crypto.randomUUID()),
            bookId,
            anchorRef: { kind: 'highlight', highlightId },
            content: trimmed,
            createdAt: now,
            updatedAt: now,
          };
      const next = new Map(byHighlightId);
      next.set(highlightId, record);
      setByHighlightId(next);
      try {
        await repo.upsert(record);
      } catch (err) {
        console.warn('[notes] save failed; rolling back', err);
        const restored = new Map(byHighlightId);
        if (existing) restored.set(highlightId, existing);
        else restored.delete(highlightId);
        setByHighlightId(restored);
      }
    },
    [bookId, byHighlightId, repo, clear],
  );

  return { byHighlightId, save, clear };
}
