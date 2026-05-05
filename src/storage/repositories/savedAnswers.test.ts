import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openBookwormDB, type BookwormDB } from '@/storage';
import { createSavedAnswersRepository } from './savedAnswers';
import type { SavedAnswer } from '@/domain';
import {
  BookId,
  ChatMessageId,
  ChatThreadId,
  IsoTimestamp,
  SavedAnswerId,
} from '@/domain';
import { SAVED_ANSWERS_STORE } from '../db/schema';

let db: BookwormDB;

beforeEach(async () => {
  db = await openBookwormDB(`bookworm-saved-answers-${crypto.randomUUID()}`);
});

function makeSaved(overrides: Partial<SavedAnswer> = {}): SavedAnswer {
  return {
    id: SavedAnswerId(crypto.randomUUID()),
    bookId: BookId('book-1'),
    threadId: ChatThreadId('t-1'),
    messageId: ChatMessageId(crypto.randomUUID()),
    modelId: 'gpt-x',
    mode: 'open',
    content: 'The book argues that ...',
    question: 'What is this book about?',
    contextRefs: [],
    createdAt: IsoTimestamp('2026-05-05T00:00:00.000Z'),
    ...overrides,
  };
}

describe('SavedAnswersRepository', () => {
  it('upsert → getById round-trip', async () => {
    const repo = createSavedAnswersRepository(db);
    const s = makeSaved({ userNote: 'I want to remember this' });
    await repo.upsert(s);
    const fetched = await repo.getById(s.id);
    expect(fetched?.id).toBe(s.id);
    expect(fetched?.userNote).toBe('I want to remember this');
  });

  it('getByMessage finds the saved answer linked to a message', async () => {
    const repo = createSavedAnswersRepository(db);
    const target = ChatMessageId('m-target');
    const s = makeSaved({ messageId: target });
    await repo.upsert(s);
    const found = await repo.getByMessage(target);
    expect(found?.id).toBe(s.id);
  });

  it('getByMessage returns null when not present', async () => {
    const repo = createSavedAnswersRepository(db);
    expect(await repo.getByMessage(ChatMessageId('absent'))).toBeNull();
  });

  it('listByBook returns book answers newest-first', async () => {
    const repo = createSavedAnswersRepository(db);
    const sOld = makeSaved({
      id: SavedAnswerId('s-old'),
      bookId: BookId('a'),
      createdAt: IsoTimestamp('2026-05-04T00:00:00.000Z'),
    });
    const sNew = makeSaved({
      id: SavedAnswerId('s-new'),
      bookId: BookId('a'),
      createdAt: IsoTimestamp('2026-05-06T00:00:00.000Z'),
    });
    const sOther = makeSaved({
      id: SavedAnswerId('s-other'),
      bookId: BookId('b'),
    });
    await repo.upsert(sOld);
    await repo.upsert(sNew);
    await repo.upsert(sOther);
    const list = await repo.listByBook(BookId('a'));
    expect(list.map((s) => s.id)).toEqual([SavedAnswerId('s-new'), SavedAnswerId('s-old')]);
  });

  it('drops malformed records (bad mode)', async () => {
    const repo = createSavedAnswersRepository(db);
    await db.put(SAVED_ANSWERS_STORE, {
      ...makeSaved(),
      mode: 'unknown-mode' as never,
    });
    expect(await repo.listByBook(BookId('book-1'))).toEqual([]);
  });

  it('drops malformed records (missing required field)', async () => {
    const repo = createSavedAnswersRepository(db);
    await db.put(SAVED_ANSWERS_STORE, { id: 'broken' } as never);
    expect(await repo.getById(SavedAnswerId('broken'))).toBeNull();
  });

  it('delete removes a single record', async () => {
    const repo = createSavedAnswersRepository(db);
    const s = makeSaved();
    await repo.upsert(s);
    await repo.delete(s.id);
    expect(await repo.getById(s.id)).toBeNull();
  });

  it('deleteByBook removes only matching answers', async () => {
    const repo = createSavedAnswersRepository(db);
    const a = makeSaved({ id: SavedAnswerId('a'), bookId: BookId('a') });
    const b = makeSaved({ id: SavedAnswerId('b'), bookId: BookId('b') });
    await repo.upsert(a);
    await repo.upsert(b);
    await repo.deleteByBook(BookId('a'));
    expect(await repo.getById(a.id)).toBeNull();
    expect(await repo.getById(b.id)).not.toBeNull();
  });
});
