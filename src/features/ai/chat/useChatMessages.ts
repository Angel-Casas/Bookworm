import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatMessageId, ChatThreadId } from '@/domain';
import type { ChatMessagesRepository } from '@/storage';

const STALE_THRESHOLD_MS = 30_000;
const PATCH_DEBOUNCE_MS = 80;

type Args = {
  readonly threadId: ChatThreadId;
  readonly messagesRepo: ChatMessagesRepository;
};

export type UseChatMessagesHandle = {
  readonly list: readonly ChatMessage[];
  readonly append: (msg: ChatMessage) => Promise<void>;
  readonly patch: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
  readonly finalize: (id: ChatMessageId, fields: Partial<ChatMessage>) => Promise<void>;
};

export function useChatMessages({ threadId, messagesRepo }: Args): UseChatMessagesHandle {
  const [list, setList] = useState<readonly ChatMessage[]>([]);
  const listRef = useRef<readonly ChatMessage[]>([]);
  const debouncedTimers = useRef<Map<ChatMessageId, ReturnType<typeof setTimeout>>>(new Map());
  const pendingPatches = useRef<Map<ChatMessageId, Partial<ChatMessage>>>(new Map());

  useEffect(() => {
    listRef.current = list;
  }, [list]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await messagesRepo.listByThread(threadId);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
      if (cancelled) return;
      const now = Date.now();
      const repaired: ChatMessage[] = [];
      for (const m of raw) {
        if (m.streaming === true && Date.parse(m.createdAt) < now - STALE_THRESHOLD_MS) {
          const fixed: ChatMessage = {
            ...m,
            streaming: false,
            truncated: true,
            error: 'interrupted',
          };
          await messagesRepo.upsert(fixed);
          repaired.push(fixed);
        } else {
          repaired.push(m);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
      if (!cancelled) setList(repaired);
    })();
    const timers = debouncedTimers.current;
    const patches = pendingPatches.current;
    return () => {
      cancelled = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      patches.clear();
    };
  }, [threadId, messagesRepo]);

  const append = useCallback(
    async (msg: ChatMessage): Promise<void> => {
      await messagesRepo.upsert(msg);
      setList((prev) => [...prev, msg]);
    },
    [messagesRepo],
  );

  const flushPending = useCallback(
    async (id: ChatMessageId): Promise<void> => {
      const fields = pendingPatches.current.get(id);
      if (!fields) return;
      pendingPatches.current.delete(id);
      const target = listRef.current.find((m) => m.id === id);
      if (!target) return;
      const next: ChatMessage = { ...target, ...fields };
      await messagesRepo.upsert(next);
    },
    [messagesRepo],
  );

  const patch = useCallback(
    async (id: ChatMessageId, fields: Partial<ChatMessage>): Promise<void> => {
      setList((prev) => prev.map((m) => (m.id === id ? { ...m, ...fields } : m)));
      pendingPatches.current.set(id, {
        ...(pendingPatches.current.get(id) ?? {}),
        ...fields,
      });
      const existing = debouncedTimers.current.get(id);
      if (existing) clearTimeout(existing);
      debouncedTimers.current.set(
        id,
        setTimeout(() => {
          void flushPending(id);
          debouncedTimers.current.delete(id);
        }, PATCH_DEBOUNCE_MS),
      );
      await Promise.resolve();
    },
    [flushPending],
  );

  const finalize = useCallback(
    async (id: ChatMessageId, fields: Partial<ChatMessage>): Promise<void> => {
      const t = debouncedTimers.current.get(id);
      if (t) clearTimeout(t);
      debouncedTimers.current.delete(id);
      pendingPatches.current.delete(id);

      const target = listRef.current.find((m) => m.id === id);
      if (!target) return;
      const next: ChatMessage = { ...target, ...fields };
      await messagesRepo.upsert(next);
      setList((prev) => prev.map((m) => (m.id === id ? next : m)));
    },
    [messagesRepo],
  );

  return { list, append, patch, finalize };
}
