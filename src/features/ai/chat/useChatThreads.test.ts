/* eslint-disable @typescript-eslint/unbound-method --
   The spies on ChatThreadsRepository methods are vi.fn() and don't use `this`;
   passing them to expect() is the standard pattern. */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  createChatMessagesRepository,
  createChatThreadsRepository,
  openBookwormDB,
  type BookwormDB,
  type ChatThreadsRepository,
} from '@/storage';
import { useChatThreads } from './useChatThreads';
import type { ChatThread } from '@/domain';
import { BookId, ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-useChatThreads-${crypto.randomUUID()}`);
});

afterEach(() => {
  db.close();
});

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: ChatThreadId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    title: 'Talk',
    modelId: 'gpt-x',
    answerStyle: 'open',
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    ...overrides,
  };
}

describe('useChatThreads', () => {
  it('loads existing threads sorted by updatedAt desc; sets activeId to most recent', async () => {
    const repo = createChatThreadsRepository(db);
    await repo.upsert(
      makeThread({
        id: ChatThreadId('t-old'),
        updatedAt: IsoTimestamp('2026-05-04T00:00:00.000Z'),
      }),
    );
    await repo.upsert(
      makeThread({
        id: ChatThreadId('t-new'),
        updatedAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
      }),
    );
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(2);
    });
    expect(result.current.list[0]?.id).toBe(ChatThreadId('t-new'));
    expect(result.current.activeId).toBe(ChatThreadId('t-new'));
  });

  it('startDraft sets a draft without persisting', async () => {
    const repo = createChatThreadsRepository(db);
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(0);
    });
    act(() => {
      result.current.startDraft('gpt-x');
    });
    expect(result.current.draft).not.toBeNull();
    expect(result.current.list).toEqual([]);
    expect((await repo.listByBook(BookId('book-1'))).length).toBe(0);
  });

  it('persistDraft adds to list and clears the draft', async () => {
    const repo = createChatThreadsRepository(db);
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo: repo }),
    );
    act(() => {
      result.current.startDraft('gpt-x');
    });
    const thread = makeThread({ title: 'Persisted', id: ChatThreadId('t-1') });
    await act(async () => {
      await result.current.persistDraft(thread);
    });
    expect(result.current.list.map((t) => t.id)).toEqual([ChatThreadId('t-1')]);
    expect(result.current.draft).toBeNull();
    expect(result.current.activeId).toBe(ChatThreadId('t-1'));
  });

  it('rename updates list optimistically and persists', async () => {
    const repo = createChatThreadsRepository(db);
    await repo.upsert(makeThread({ id: ChatThreadId('t-1'), title: 'Original' }));
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(1);
    });
    await act(async () => {
      await result.current.rename(ChatThreadId('t-1'), 'Renamed');
    });
    expect(result.current.list[0]?.title).toBe('Renamed');
    expect((await repo.getById(ChatThreadId('t-1')))?.title).toBe('Renamed');
  });

  it('remove deletes thread and cascades messages', async () => {
    const threadsRepo = createChatThreadsRepository(db);
    const messagesRepo = createChatMessagesRepository(db);
    await threadsRepo.upsert(makeThread({ id: ChatThreadId('t-1') }));
    await messagesRepo.upsert({
      id: ChatMessageId('m-1'),
      threadId: ChatThreadId('t-1'),
      role: 'user',
      content: 'hi',
      contextRefs: [],
      createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    });
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo, messagesRepo }),
    );
    await waitFor(() => {
      expect(result.current.list.length).toBe(1);
    });
    await act(async () => {
      await result.current.remove(ChatThreadId('t-1'));
    });
    expect(result.current.list.length).toBe(0);
    expect(await threadsRepo.getById(ChatThreadId('t-1'))).toBeNull();
    expect(await messagesRepo.getById(ChatMessageId('m-1'))).toBeNull();
  });
});

describe('useChatThreads load error handling', () => {
  function rejectingRepo(loadError: Error): ChatThreadsRepository {
    return {
      upsert: vi.fn(() => Promise.resolve()),
      getById: vi.fn(() => Promise.resolve(null)),
      listByBook: vi.fn(() => Promise.reject(loadError)),
      delete: vi.fn(() => Promise.resolve()),
      deleteByBook: vi.fn(() => Promise.resolve()),
    };
  }

  it('exposes loadError when listByBook rejects', async () => {
    const repo = rejectingRepo(new Error('db is gone'));
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.loadError).not.toBeNull();
    });
    expect(result.current.loadError?.message).toBe('db is gone');
    expect(result.current.list).toEqual([]);
  });

  it('retryLoad clears loadError and re-runs the load on success', async () => {
    let attempt = 0;
    const repo: ChatThreadsRepository = {
      upsert: vi.fn(() => Promise.resolve()),
      getById: vi.fn(() => Promise.resolve(null)),
      listByBook: vi.fn(() => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('first try'));
        return Promise.resolve([] as readonly ChatThread[]);
      }),
      delete: vi.fn(() => Promise.resolve()),
      deleteByBook: vi.fn(() => Promise.resolve()),
    };
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.loadError).not.toBeNull();
    });
    act(() => {
      result.current.retryLoad();
    });
    await waitFor(() => {
      expect(result.current.loadError).toBeNull();
    });
    expect(repo.listByBook).toHaveBeenCalledTimes(2);
  });

  it('retryLoad after a second rejection still surfaces the new error', async () => {
    const repo = rejectingRepo(new Error('still broken'));
    const { result } = renderHook(() =>
      useChatThreads({ bookId: BookId('book-1'), threadsRepo: repo }),
    );
    await waitFor(() => {
      expect(result.current.loadError?.message).toBe('still broken');
    });
    act(() => {
      result.current.retryLoad();
    });
    await waitFor(() => {
      expect(repo.listByBook).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.loadError?.message).toBe('still broken');
    });
  });
});
