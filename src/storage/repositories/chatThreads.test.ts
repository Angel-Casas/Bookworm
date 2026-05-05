import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createChatThreadsRepository } from './chatThreads';
import type { ChatThread } from '@/domain';
import { BookId, ChatThreadId, IsoTimestamp } from '@/domain';
import { CHAT_THREADS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-chat-threads-${crypto.randomUUID()}`);
});

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: ChatThreadId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    title: 'A conversation',
    modelId: 'gpt-x',
    answerStyle: 'open',
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ChatThreadsRepository', () => {
  it('upsert → getById round-trip', async () => {
    const repo = createChatThreadsRepository(db);
    const t = makeThread();
    await repo.upsert(t);
    const fetched = await repo.getById(t.id);
    expect(fetched?.id).toBe(t.id);
    expect(fetched?.title).toBe('A conversation');
  });

  it('getById returns null for missing thread', async () => {
    const repo = createChatThreadsRepository(db);
    expect(await repo.getById(ChatThreadId('nope'))).toBeNull();
  });

  it('upsert overwrites by id', async () => {
    const repo = createChatThreadsRepository(db);
    const t = makeThread({ title: 'Original' });
    await repo.upsert(t);
    await repo.upsert({
      ...t,
      title: 'Renamed',
      updatedAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    });
    const fetched = await repo.getById(t.id);
    expect(fetched?.title).toBe('Renamed');
  });

  it('listByBook returns only threads for that book, sorted updatedAt desc', async () => {
    const repo = createChatThreadsRepository(db);
    const tOld = makeThread({
      id: ChatThreadId('t-old'),
      bookId: BookId('a'),
      updatedAt: IsoTimestamp('2026-05-05T01:00:00.000Z'),
    });
    const tNew = makeThread({
      id: ChatThreadId('t-new'),
      bookId: BookId('a'),
      updatedAt: IsoTimestamp('2026-05-05T03:00:00.000Z'),
    });
    const tOther = makeThread({
      id: ChatThreadId('t-other'),
      bookId: BookId('b'),
      updatedAt: IsoTimestamp('2026-05-05T02:00:00.000Z'),
    });
    await repo.upsert(tOld);
    await repo.upsert(tNew);
    await repo.upsert(tOther);
    const list = await repo.listByBook(BookId('a'));
    expect(list.map((t) => t.id)).toEqual([ChatThreadId('t-new'), ChatThreadId('t-old')]);
  });

  it('drops malformed records silently', async () => {
    const repo = createChatThreadsRepository(db);
    await db.put(CHAT_THREADS_STORE, {
      id: 'corrupt',
      bookId: 42,
    } as never);
    expect(await repo.getById(ChatThreadId('corrupt'))).toBeNull();
    expect(await repo.listByBook(BookId('a'))).toEqual([]);
  });

  it('drops records with invalid answerStyle', async () => {
    const repo = createChatThreadsRepository(db);
    await db.put(CHAT_THREADS_STORE, {
      ...makeThread(),
      answerStyle: 'wizard' as never,
    });
    expect(await repo.listByBook(BookId('book-1'))).toEqual([]);
  });

  it('delete removes a single record', async () => {
    const repo = createChatThreadsRepository(db);
    const t = makeThread();
    await repo.upsert(t);
    await repo.delete(t.id);
    expect(await repo.getById(t.id)).toBeNull();
  });

  it('deleteByBook removes only matching threads', async () => {
    const repo = createChatThreadsRepository(db);
    const a = makeThread({ id: ChatThreadId('a'), bookId: BookId('a') });
    const b = makeThread({ id: ChatThreadId('b'), bookId: BookId('b') });
    await repo.upsert(a);
    await repo.upsert(b);
    await repo.deleteByBook(BookId('a'));
    expect(await repo.getById(a.id)).toBeNull();
    expect(await repo.getById(b.id)).not.toBeNull();
  });
});
