import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type BookId,
  type HighlightId,
  IsoTimestamp,
  NoteId,
} from '@/domain';
import type {
  Bookmark,
  Highlight,
  HighlightColor,
  Note,
} from '@/domain/annotations/types';
import type { SavedAnswer, SavedAnswerId } from '@/domain';
import type {
  BookmarksRepository,
  HighlightsRepository,
  NotesRepository,
  SavedAnswersRepository,
} from '@/storage';
import { compareNotebookEntries } from './notebookSort';
import { matchesFilter } from './notebookFilter';
import { matchesQuery } from './notebookSearch';
import type { NotebookEntry, NotebookFilter } from './types';

export type UseNotebookHandle = {
  readonly entries: readonly NotebookEntry[];
  readonly totalCount: number;
  readonly query: string;
  readonly setQuery: (q: string) => void;
  readonly filter: NotebookFilter;
  readonly setFilter: (f: NotebookFilter) => void;
  readonly removeBookmark: (b: Bookmark) => Promise<void>;
  readonly removeHighlight: (h: Highlight) => Promise<void>;
  readonly changeColor: (h: Highlight, color: HighlightColor) => Promise<void>;
  readonly saveNote: (h: Highlight, content: string) => Promise<void>;
  readonly removeSavedAnswer: (id: SavedAnswerId) => Promise<void>;
};

type Options = {
  readonly bookId: BookId;
  readonly bookmarksRepo: BookmarksRepository;
  readonly highlightsRepo: HighlightsRepository;
  readonly notesRepo: NotesRepository;
  readonly savedAnswersRepo?: SavedAnswersRepository;
};

function buildNotesMap(notes: readonly Note[]): Map<HighlightId, Note> {
  const map = new Map<HighlightId, Note>();
  for (const n of notes) {
    if (n.anchorRef.kind === 'highlight') {
      map.set(n.anchorRef.highlightId, n);
    }
  }
  return map;
}

export function useNotebook({
  bookId,
  bookmarksRepo,
  highlightsRepo,
  notesRepo,
  savedAnswersRepo,
}: Options): UseNotebookHandle {
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>([]);
  const [highlights, setHighlights] = useState<readonly Highlight[]>([]);
  const [notesByHighlightId, setNotesByHighlightId] = useState<ReadonlyMap<HighlightId, Note>>(
    () => new Map(),
  );
  const [savedAnswers, setSavedAnswers] = useState<readonly SavedAnswer[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<NotebookFilter>('all');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      bookmarksRepo.listByBook(bookId),
      highlightsRepo.listByBook(bookId),
      notesRepo.listByBook(bookId),
      savedAnswersRepo ? savedAnswersRepo.listByBook(bookId) : Promise.resolve([]),
    ]).then(([bms, hls, ns, sas]) => {
      if (cancelled) return;
      setBookmarks(bms);
      setHighlights(hls);
      setNotesByHighlightId(buildNotesMap(ns));
      setSavedAnswers(sas);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, bookmarksRepo, highlightsRepo, notesRepo, savedAnswersRepo]);

  const entries = useMemo<readonly NotebookEntry[]>(() => {
    const unified: NotebookEntry[] = [
      ...bookmarks.map((bookmark): NotebookEntry => ({ kind: 'bookmark', bookmark })),
      ...highlights.map(
        (highlight): NotebookEntry => ({
          kind: 'highlight',
          highlight,
          note: notesByHighlightId.get(highlight.id) ?? null,
        }),
      ),
      ...savedAnswers.map(
        (savedAnswer): NotebookEntry => ({ kind: 'savedAnswer', savedAnswer }),
      ),
    ];
    const filtered = unified.filter(
      (e) => matchesFilter(e, filter) && matchesQuery(e, query),
    );
    return filtered.sort(compareNotebookEntries);
  }, [bookmarks, highlights, notesByHighlightId, savedAnswers, filter, query]);

  const totalCount = bookmarks.length + highlights.length + savedAnswers.length;

  const removeBookmark = useCallback(
    async (b: Bookmark): Promise<void> => {
      setBookmarks((xs) => xs.filter((x) => x.id !== b.id));
      try {
        await bookmarksRepo.delete(b.id);
      } catch (err) {
        console.warn('[notebook] removeBookmark failed; restoring', err);
        setBookmarks((xs) => (xs.some((x) => x.id === b.id) ? xs : [...xs, b]));
      }
    },
    [bookmarksRepo],
  );

  const removeHighlight = useCallback(
    async (h: Highlight): Promise<void> => {
      setHighlights((xs) => xs.filter((x) => x.id !== h.id));
      let restoredNote: Note | undefined;
      setNotesByHighlightId((prev) => {
        restoredNote = prev.get(h.id);
        if (!restoredNote) return prev;
        const next = new Map(prev);
        next.delete(h.id);
        return next;
      });
      try {
        await Promise.all([
          highlightsRepo.delete(h.id),
          notesRepo.deleteByHighlight(h.id),
        ]);
      } catch (err) {
        console.warn('[notebook] removeHighlight failed; restoring', err);
        setHighlights((xs) => (xs.some((x) => x.id === h.id) ? xs : [...xs, h]));
        if (restoredNote) {
          const note = restoredNote;
          setNotesByHighlightId((prev) => {
            const next = new Map(prev);
            next.set(h.id, note);
            return next;
          });
        }
      }
    },
    [highlightsRepo, notesRepo],
  );

  const changeColor = useCallback(
    async (h: Highlight, color: HighlightColor): Promise<void> => {
      setHighlights((xs) => xs.map((x) => (x.id === h.id ? { ...x, color } : x)));
      try {
        await highlightsRepo.patch(h.id, { color });
      } catch (err) {
        console.warn('[notebook] changeColor failed; reverting', err);
        setHighlights((xs) => xs.map((x) => (x.id === h.id ? h : x)));
      }
    },
    [highlightsRepo],
  );

  const saveNote = useCallback(
    async (h: Highlight, content: string): Promise<void> => {
      const trimmed = content.trim();
      const existing = notesByHighlightId.get(h.id);
      if (trimmed === '') {
        if (!existing) return;
        setNotesByHighlightId((prev) => {
          const next = new Map(prev);
          next.delete(h.id);
          return next;
        });
        try {
          await notesRepo.deleteByHighlight(h.id);
        } catch (err) {
          console.warn('[notebook] clearNote failed; restoring', err);
          setNotesByHighlightId((prev) => {
            const next = new Map(prev);
            next.set(h.id, existing);
            return next;
          });
        }
        return;
      }
      const now = IsoTimestamp(new Date().toISOString());
      const record: Note = existing
        ? { ...existing, content: trimmed, updatedAt: now }
        : {
            id: NoteId(crypto.randomUUID()),
            bookId: h.bookId,
            anchorRef: { kind: 'highlight', highlightId: h.id },
            content: trimmed,
            createdAt: now,
            updatedAt: now,
          };
      setNotesByHighlightId((prev) => {
        const next = new Map(prev);
        next.set(h.id, record);
        return next;
      });
      try {
        await notesRepo.upsert(record);
      } catch (err) {
        console.warn('[notebook] saveNote failed; rolling back', err);
        setNotesByHighlightId((prev) => {
          const next = new Map(prev);
          if (existing) next.set(h.id, existing);
          else next.delete(h.id);
          return next;
        });
      }
    },
    [notesByHighlightId, notesRepo],
  );

  const removeSavedAnswer = useCallback(
    async (id: SavedAnswerId): Promise<void> => {
      if (!savedAnswersRepo) return;
      const before = savedAnswers;
      setSavedAnswers((xs) => xs.filter((x) => x.id !== id));
      try {
        await savedAnswersRepo.delete(id);
      } catch (err) {
        console.warn('[notebook] removeSavedAnswer failed; restoring', err);
        setSavedAnswers(before);
      }
    },
    [savedAnswers, savedAnswersRepo],
  );

  return {
    entries,
    totalCount,
    query,
    setQuery,
    filter,
    setFilter,
    removeBookmark,
    removeHighlight,
    changeColor,
    saveNote,
    removeSavedAnswer,
  };
}
