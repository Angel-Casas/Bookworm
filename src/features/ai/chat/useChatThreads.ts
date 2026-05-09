import { useCallback, useEffect, useState } from 'react';
import type { BookId, ChatThread, ChatThreadId } from '@/domain';
import type { ChatMessagesRepository, ChatThreadsRepository } from '@/storage';

export type DraftState = {
  readonly tempId: string;
  readonly modelId: string;
};

type Args = {
  readonly bookId: BookId;
  readonly threadsRepo: ChatThreadsRepository;
  readonly messagesRepo?: ChatMessagesRepository;
};

export type UseChatThreadsHandle = {
  readonly list: readonly ChatThread[];
  readonly activeId: ChatThreadId | null;
  readonly draft: DraftState | null;
  readonly loadError: Error | null;
  readonly retryLoad: () => void;
  readonly setActive: (id: ChatThreadId) => void;
  readonly startDraft: (modelId: string) => void;
  readonly clearDraft: () => void;
  readonly rename: (id: ChatThreadId, title: string) => Promise<void>;
  readonly remove: (id: ChatThreadId) => Promise<void>;
  readonly persistDraft: (thread: ChatThread) => Promise<void>;
};

export function useChatThreads({
  bookId,
  threadsRepo,
  messagesRepo,
}: Args): UseChatThreadsHandle {
  const [list, setList] = useState<readonly ChatThread[]>([]);
  const [activeId, setActiveId] = useState<ChatThreadId | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const fetched = await threadsRepo.listByBook(bookId);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (cancelled) return;
        setList(fetched);
        if (fetched.length > 0) {
          setActiveId((prev) => prev ?? fetched[0]?.id ?? null);
        }
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (!cancelled) {
          setLoadError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, threadsRepo, loadNonce]);

  const retryLoad = useCallback(() => {
    setLoadNonce((n) => n + 1);
  }, []);

  const setActive = useCallback((id: ChatThreadId) => {
    setActiveId(id);
    setDraft(null);
  }, []);

  const startDraft = useCallback((modelId: string) => {
    setDraft({
      tempId: `draft-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
      modelId,
    });
    setActiveId(null);
  }, []);

  const clearDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const persistDraft = useCallback(
    async (thread: ChatThread): Promise<void> => {
      await threadsRepo.upsert(thread);
      setList((prev) => [thread, ...prev.filter((t) => t.id !== thread.id)]);
      setActiveId(thread.id);
      setDraft(null);
    },
    [threadsRepo],
  );

  const rename = useCallback(
    async (id: ChatThreadId, title: string): Promise<void> => {
      const before = list;
      const target = list.find((t) => t.id === id);
      if (!target) return;
      const nextUpdatedAt = new Date().toISOString() as ChatThread['updatedAt'];
      const updated: ChatThread = { ...target, title, updatedAt: nextUpdatedAt };
      setList((prev) => prev.map((t) => (t.id === id ? updated : t)));
      try {
        await threadsRepo.upsert(updated);
      } catch (err) {
        console.warn('[chatThreads] rename failed; rolling back', err);
        setList(before);
        throw err;
      }
    },
    [list, threadsRepo],
  );

  const remove = useCallback(
    async (id: ChatThreadId): Promise<void> => {
      const before = list;
      const fallback = before.find((t) => t.id !== id);
      setList((prev) => prev.filter((t) => t.id !== id));
      if (activeId === id) setActiveId(fallback?.id ?? null);
      try {
        if (messagesRepo) await messagesRepo.deleteByThread(id);
        await threadsRepo.delete(id);
      } catch (err) {
        console.warn('[chatThreads] remove failed; rolling back', err);
        setList(before);
        throw err;
      }
    },
    [list, activeId, threadsRepo, messagesRepo],
  );

  return {
    list,
    activeId,
    draft,
    loadError,
    retryLoad,
    setActive,
    startDraft,
    clearDraft,
    rename,
    remove,
    persistDraft,
  };
}
