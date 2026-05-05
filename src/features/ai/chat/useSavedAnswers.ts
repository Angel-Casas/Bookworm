import { useCallback, useEffect, useState } from 'react';
import {
  IsoTimestamp,
  SavedAnswerId,
  type BookId,
  type SavedAnswer,
} from '@/domain';
import type { SavedAnswersRepository } from '@/storage';

type Args = {
  readonly bookId: BookId;
  readonly savedAnswersRepo: SavedAnswersRepository;
};

type AddInput = Omit<SavedAnswer, 'id' | 'bookId' | 'createdAt'>;

export type UseSavedAnswersHandle = {
  readonly list: readonly SavedAnswer[];
  readonly add: (input: AddInput) => Promise<SavedAnswer>;
  readonly remove: (id: SavedAnswerId) => Promise<void>;
  readonly update: (id: SavedAnswerId, fields: Partial<SavedAnswer>) => Promise<void>;
};

export function useSavedAnswers({ bookId, savedAnswersRepo }: Args): UseSavedAnswersHandle {
  const [list, setList] = useState<readonly SavedAnswer[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await savedAnswersRepo.listByBook(bookId);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
      if (!cancelled) setList(raw);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, savedAnswersRepo]);

  const add = useCallback(
    async (input: AddInput): Promise<SavedAnswer> => {
      const saved: SavedAnswer = {
        id: SavedAnswerId(
          `s-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
        ),
        bookId,
        ...input,
        createdAt: IsoTimestamp(new Date().toISOString()),
      };
      await savedAnswersRepo.upsert(saved);
      setList((prev) => [saved, ...prev]);
      return saved;
    },
    [bookId, savedAnswersRepo],
  );

  const remove = useCallback(
    async (id: SavedAnswerId): Promise<void> => {
      const before = list;
      setList((prev) => prev.filter((s) => s.id !== id));
      try {
        await savedAnswersRepo.delete(id);
      } catch (err) {
        console.warn('[savedAnswers] remove failed; rolling back', err);
        setList(before);
        throw err;
      }
    },
    [list, savedAnswersRepo],
  );

  const update = useCallback(
    async (id: SavedAnswerId, fields: Partial<SavedAnswer>): Promise<void> => {
      const before = list;
      const target = list.find((s) => s.id === id);
      if (!target) return;
      const next: SavedAnswer = { ...target, ...fields };
      setList((prev) => prev.map((s) => (s.id === id ? next : s)));
      try {
        await savedAnswersRepo.upsert(next);
      } catch (err) {
        console.warn('[savedAnswers] update failed; rolling back', err);
        setList(before);
        throw err;
      }
    },
    [list, savedAnswersRepo],
  );

  return { list, add, remove, update };
}
