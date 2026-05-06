import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createChatMessagesRepository } from './chatMessages';
import type { ChatMessage } from '@/domain';
import { ChatMessageId, ChatThreadId, IsoTimestamp } from '@/domain';
import { CHAT_MESSAGES_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-chat-messages-${crypto.randomUUID()}`);
});

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ChatMessageId(crypto.randomUUID()),
    threadId: ChatThreadId('t-1'),
    role: 'user',
    content: 'hello',
    contextRefs: [],
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ChatMessagesRepository', () => {
  it('upsert → getById round-trip', async () => {
    const repo = createChatMessagesRepository(db);
    const m = makeMessage();
    await repo.upsert(m);
    const fetched = await repo.getById(m.id);
    expect(fetched?.id).toBe(m.id);
    expect(fetched?.content).toBe('hello');
  });

  it('listByThread returns oldest-first', async () => {
    const repo = createChatMessagesRepository(db);
    const m1 = makeMessage({
      id: ChatMessageId('m-1'),
      createdAt: IsoTimestamp('2026-05-05T00:00:01.000Z'),
    });
    const m2 = makeMessage({
      id: ChatMessageId('m-2'),
      role: 'assistant',
      content: 'reply',
      createdAt: IsoTimestamp('2026-05-05T00:00:02.000Z'),
    });
    const mOther = makeMessage({
      id: ChatMessageId('m-other'),
      threadId: ChatThreadId('t-other'),
      createdAt: IsoTimestamp('2026-05-05T00:00:00.500Z'),
    });
    await repo.upsert(m2); // upsert out of order
    await repo.upsert(m1);
    await repo.upsert(mOther);
    const list = await repo.listByThread(ChatThreadId('t-1'));
    expect(list.map((m) => m.id)).toEqual([ChatMessageId('m-1'), ChatMessageId('m-2')]);
  });

  it('round-trips streaming/truncated/mode flags', async () => {
    const repo = createChatMessagesRepository(db);
    const m = makeMessage({
      role: 'assistant',
      content: 'partial',
      mode: 'open',
      streaming: true,
    });
    await repo.upsert(m);
    const fetched = await repo.getById(m.id);
    expect(fetched?.streaming).toBe(true);
    expect(fetched?.mode).toBe('open');
  });

  it('drops malformed records (bad role)', async () => {
    const repo = createChatMessagesRepository(db);
    await db.put(CHAT_MESSAGES_STORE, {
      id: 'bad',
      threadId: 't-1',
      role: 'wizard',
      content: 'x',
      contextRefs: [],
      createdAt: '2026-05-05T00:00:00.000Z',
    } as never);
    expect(await repo.getById(ChatMessageId('bad'))).toBeNull();
  });

  it('drops malformed records (non-array contextRefs)', async () => {
    const repo = createChatMessagesRepository(db);
    await db.put(CHAT_MESSAGES_STORE, {
      ...makeMessage(),
      contextRefs: 'not-an-array' as never,
    });
    expect(await repo.listByThread(ChatThreadId('t-1'))).toEqual([]);
  });

  it('delete removes a single record', async () => {
    const repo = createChatMessagesRepository(db);
    const m = makeMessage();
    await repo.upsert(m);
    await repo.delete(m.id);
    expect(await repo.getById(m.id)).toBeNull();
  });

  it('deleteByThread removes only matching messages', async () => {
    const repo = createChatMessagesRepository(db);
    const a = makeMessage({ id: ChatMessageId('m-a'), threadId: ChatThreadId('t-a') });
    const b = makeMessage({ id: ChatMessageId('m-b'), threadId: ChatThreadId('t-b') });
    await repo.upsert(a);
    await repo.upsert(b);
    await repo.deleteByThread(ChatThreadId('t-a'));
    expect(await repo.getById(a.id)).toBeNull();
    expect(await repo.getById(b.id)).not.toBeNull();
  });

  describe('contextRef.passage validation (Phase 4.4)', () => {
    it('round-trips a well-formed passage ref', async () => {
      const repo = createChatMessagesRepository(db);
      const m = makeMessage({
        role: 'assistant',
        content: 'response',
        mode: 'passage',
        contextRefs: [
          {
            kind: 'passage',
            text: 'selected text',
            anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2)' },
            sectionTitle: 'Chapter 1',
            windowBefore: 'before…',
            windowAfter: '…after',
          },
        ],
      });
      await repo.upsert(m);
      const fetched = await repo.getById(m.id);
      expect(fetched?.contextRefs).toEqual(m.contextRefs);
    });

    it('filters a malformed passage ref (missing anchor) but keeps the message', async () => {
      const repo = createChatMessagesRepository(db);
      await db.put(CHAT_MESSAGES_STORE, {
        ...makeMessage({ role: 'assistant' }),
        contextRefs: [{ kind: 'passage', text: 'no anchor here' }] as never,
      });
      const list = await repo.listByThread(ChatThreadId('t-1'));
      expect(list).toHaveLength(1);
      expect(list[0]!.contextRefs).toEqual([]);
    });

    it('filters a passage ref with bad anchor.kind but keeps siblings', async () => {
      const repo = createChatMessagesRepository(db);
      await db.put(CHAT_MESSAGES_STORE, {
        ...makeMessage({ role: 'assistant' }),
        contextRefs: [
          { kind: 'passage', text: 'bad', anchor: { kind: 'unknown' } },
          { kind: 'highlight', highlightId: 'h1' },
        ] as never,
      });
      const list = await repo.listByThread(ChatThreadId('t-1'));
      expect(list[0]!.contextRefs).toEqual([{ kind: 'highlight', highlightId: 'h1' }]);
    });

    it('rejects a passage ref with non-string sectionTitle', async () => {
      const repo = createChatMessagesRepository(db);
      await db.put(CHAT_MESSAGES_STORE, {
        ...makeMessage({ role: 'assistant' }),
        contextRefs: [
          {
            kind: 'passage',
            text: 'x',
            anchor: { kind: 'epub-cfi', cfi: '/abc' },
            sectionTitle: 42,
          },
        ] as never,
      });
      const list = await repo.listByThread(ChatThreadId('t-1'));
      expect(list[0]!.contextRefs).toEqual([]);
    });
  });
});
