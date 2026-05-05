import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  createChatMessagesRepository,
  openBookwormDB,
  type BookwormDB,
} from '@/storage';
import { useChatMessages } from './useChatMessages';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-useChatMessages-${crypto.randomUUID()}`);
});

afterEach(() => {
  db.close();
});

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ChatMessageId(crypto.randomUUID()),
    threadId: ChatThreadId('t-1'),
    role: 'user',
    content: 'hi',
    contextRefs: [],
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    ...overrides,
  };
}

describe('useChatMessages', () => {
  it('loads messages oldest-first', async () => {
    const repo = createChatMessagesRepository(db);
    await repo.upsert(
      makeMsg({
        id: ChatMessageId('m-1'),
        createdAt: IsoTimestamp('2026-05-05T00:00:01.000Z'),
      }),
    );
    await repo.upsert(
      makeMsg({
        id: ChatMessageId('m-2'),
        role: 'assistant',
        content: 'reply',
        createdAt: IsoTimestamp('2026-05-05T00:00:02.000Z'),
      }),
    );
    const { result } = renderHook(() =>
      useChatMessages({ threadId: ChatThreadId('t-1'), messagesRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(2);
    });
    expect(result.current.list.map((m) => m.id)).toEqual([
      ChatMessageId('m-1'),
      ChatMessageId('m-2'),
    ]);
  });

  it('repairs orphaned streaming records to truncated+interrupted on mount', async () => {
    const repo = createChatMessagesRepository(db);
    const stale = new Date(Date.now() - 60_000).toISOString();
    await repo.upsert(
      makeMsg({
        id: ChatMessageId('m-stale'),
        role: 'assistant',
        content: 'partial',
        streaming: true,
        createdAt: IsoTimestamp(stale),
      }),
    );
    const { result } = renderHook(() =>
      useChatMessages({ threadId: ChatThreadId('t-1'), messagesRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(1);
    });
    expect(result.current.list[0]?.streaming).toBe(false);
    expect(result.current.list[0]?.truncated).toBe(true);
    expect(result.current.list[0]?.error).toBe('interrupted');
  });

  it('append + finalize round-trip', async () => {
    const repo = createChatMessagesRepository(db);
    const { result } = renderHook(() =>
      useChatMessages({ threadId: ChatThreadId('t-1'), messagesRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(0);
    });
    const msg = makeMsg({ id: ChatMessageId('m-1') });
    await act(async () => {
      await result.current.append(msg);
    });
    expect(result.current.list).toHaveLength(1);
    await act(async () => {
      await result.current.finalize(ChatMessageId('m-1'), { content: 'final' });
    });
    expect(result.current.list[0]?.content).toBe('final');
    expect((await repo.getById(ChatMessageId('m-1')))?.content).toBe('final');
  });

  it('finalize cancels pending debounced patch', async () => {
    const repo = createChatMessagesRepository(db);
    const { result } = renderHook(() =>
      useChatMessages({ threadId: ChatThreadId('t-1'), messagesRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(0);
    });
    const msg = makeMsg({ id: ChatMessageId('m-1'), content: '' });
    await act(async () => {
      await result.current.append(msg);
    });
    await act(async () => {
      await result.current.patch(ChatMessageId('m-1'), { content: 'partial' });
    });
    // immediate finalize wins
    await act(async () => {
      await result.current.finalize(ChatMessageId('m-1'), { content: 'final' });
    });
    // wait for any pending debounce timer (would have been 80ms)
    await new Promise((r) => setTimeout(r, 120));
    expect((await repo.getById(ChatMessageId('m-1')))?.content).toBe('final');
  });
});
